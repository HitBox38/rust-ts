// Port of compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs (lane errrep-infer-a; contract stub of lane errctxt-contract).
//
//! Error Reporting Code for the inference engine
//!
//! Because of the way inference, and in particular region inference,
//! works, it often happens that errors are not detected until far after
//! the relevant line of code has been type-checked. Therefore, there is
//! an elaborate system to track why a particular constraint in the
//! inference graph arose so that we can explain to the user what gave
//! rise to a particular error.
//!
//! The system is based around a set of "origin" types. An "origin" is the
//! reason that a constraint or inference variable arose. There are
//! different "origin" enums for different kinds of constraints/variables
//! (e.g., `TypeOrigin`, `RegionVariableOrigin`). An origin always has
//! a span, but also more information so that we can generate a meaningful
//! error message.
//!
//! Having a catalog of all the different reasons an error can arise is
//! also useful for other reasons, like cross-referencing FAQs etc, though
//! we are not really taking advantage of this yet.
//!
//! # Region Inference
//!
//! Region inference is particularly tricky because it always succeeds "in
//! the moment" and simply registers a constraint. Then, at the end, we
//! can compute the full graph and report errors, so we need to be able to
//! store and later report what gave rise to the conflicting constraints.
//!
//! # Subtype Trace
//!
//! Determining whether `T1 <: T2` often involves a number of subtypes and
//! subconstraints along the way. A "TypeTrace" is an extended version
//! of an origin that traces the types and other values that were being
//! compared. It is not necessarily comprehensive (in fact, at the time of
//! this writing it only tracks the root values being compared) but I'd
//! like to extend it to include significant "waypoints". For example, if
//! you are comparing `(T1, T2) <: (T3, T4)`, and the problem is that `T2
//! <: T4` fails, I'd like the trace to include enough information to say
//! "in the 2nd element of the tuple". Similarly, failures when comparing
//! arguments or return types in fn types should be able to cite the
//! specific position, etc.
//!
//! # Reality vs plan
//!
//! Of course, there is still a LOT of code in typeck that has yet to be
//! ported to this system, and which relies on string concatenation at the
//! time of error detection.
//
// The `TypeErrCtxt` methods are declared in the crate decls.ts (`// error_reporting/infer/mod.rs:<line>`) and assigned to
// `TypeErrCtxt.prototype` here; `self.tcx` / InferCtxt methods are read through the Deref forwarders, a `&TypeErrCtxt`
// passed as `&InferCtxt` is `this.infcx` (docs/handoff/errctxt-contract.md).
// Init order: top-level code here touches only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other crates;
// other rustc_trait_selection modules are read inside function bodies (`crate_()` lazy requires).
// PORT: `DiagStyledString` pairs are `[DiagStyledString, DiagStyledString]`; `(values.0).0.extend(x1.0)` is
// `values[0]._0.push(...x1._0)`. `#[derive(PartialEq)]` on `DiagStyledString` is `DiagStyledString_eq` below.
// PORT: `mod note_and_explain; mod suggest; pub mod need_type_info; pub mod nice_region_error; pub mod region;` are
// loaded by the crate's lib.ts (they extend `TypeErrCtxt.prototype`), not re-exported here (init order).
export * from "./mod.gen.ts";
import { ExternAbi, display_ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { type ControlFlow as ControlFlowT, ControlFlow, VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import type { Directive, FormatArgs } from "../../../rustc_attr_ir/diagnostic.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import type { DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import { type Diag, DiagStyledString, pluralize, StringPart } from "../../../rustc_errors/lib.ts";
import { Namespace } from "../../../rustc_hir/def.ts";
import { type CoroutineKind, Defaultness, display_CoroutineKind, Safety } from "../../../rustc_hir/hir.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type * as hir from "../../../rustc_hir/lib.ts";
import { Visitor as HirVisitor } from "../../../rustc_hir/intravisit.ts";
import { DefPathData, DefPathData_eq } from "../../../rustc_hir_id/definitions.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { TypeTrace, ValuePairs } from "../../../rustc_infer/infer/mod.ts";
import { ToTrace_TraitRef, ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { type Print, print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import { HasAttrs_DefId } from "../../../rustc_middle/ty/mod.ts";
import { fold_with_ValuePairs, try_fold_with_ValuePairs, visit_with_ValuePairs } from "../../../rustc_infer/infer/mod.gen.ts";
import { Obligation } from "../../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { ObligationCause, ObligationCauseCode, type PatternOriginExpr } from "../../../rustc_middle/traits/mod.ts";
import { fold_with_PolyFnSig, try_fold_with_PolyFnSig, visit_with_PolyFnSig } from "../../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { with_ } from "../../../rustc_middle/ty/context/tls.ts";
import { TypeError_to_string } from "../../../rustc_middle/ty/error.ts";
import { fold_GenericArgs, GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { List } from "../../../rustc_middle/ty/list.ts";
import { fold_Term, type ParamEnv, type ParamEnvAnd, Term, type Ty } from "../../../rustc_middle/ty/mod.ts";
import {
  display_GenericArg,
  display_Term,
  display_TraitRefPrintOnlyTraitName,
  display_TraitRefPrintSugared,
  display_Ty,
  FmtPrinter,
  print_Binder,
  print_ExistentialProjection,
  print_ExistentialTraitRef,
  print_FnSig,
  type TraitRefPrintSugared,
  TraitRef_print_only_trait_name,
  TraitRef_print_trait_sugared,
  with_forced_trimmed_paths,
  WrapBinderMode,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { PathBuf, Span } from "../../../rustc_span/lib.ts";
import { Span as SpanC } from "../../../rustc_span/lib.ts";
import { BytePos } from "../../../rustc_span/lib.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { display_Symbol, sym, type Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { ExpectedFound, TypeError, fold_with_ExpectedFound, try_fold_with_ExpectedFound, visit_with_ExpectedFound } from "../../../rustc_type_ir/error.ts";
import { type FallibleTypeFolder, fold_tuple2, type TypeFoldable, type TypeFolder } from "../../../rustc_type_ir/fold.ts";
import { display_AliasTerm, display_Const, display_Region, display_TraitRef } from "../../../rustc_type_ir/ir_print.ts";
import { fold_with_ExistentialProjection, fold_with_ExistentialTraitRef, try_fold_with_ExistentialProjection, try_fold_with_ExistentialTraitRef, visit_with_ExistentialProjection, visit_with_ExistentialTraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import { type ExistentialProjection, type ExistentialTraitRef, fold_with_TraitRef, PolyTraitClause, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import {
  type Relate,
  relate_args_invariantly,
  relate_Ty,
  type RelateResult,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../../../rustc_type_ir/relate.ts";
import type { Variance } from "../../../rustc_type_ir/decls.ts";
import { type Const, type Region, fold_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type AliasTerm, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { AliasTy as AliasTyC, FnSig as FnSigC, fold_FnSig, type FnSig, IsRigid, PolyFnSigTys } from "../../../rustc_type_ir/ty_kind.ts";
import type { AliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { as_interner } from "../../../rustc_type_ir/predicate.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import type { CodegenFnAttrs } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import { DesugaringKind } from "../../../rustc_span/hygiene.ts";
import { LocalDefId, LocalModId } from "../../../rustc_span/def_id.ts";
import { ClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8_len } from "../../../std/str.ts";
import type { ObligationCauseFailureCode, TypeErrorAdditionalDiags } from "../../diagnostics.gen.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { FailureCode } from "./mod.gen.ts";
import { TyCategory } from "./mod.gen.ts";

/** Lazy access to the crate modules this file uses (init order: module header). */
function crate_() {
  return {
    engine: require("../../traits/engine.ts") as typeof import("../../traits/engine.ts"),
    specialization_graph: require("../../traits/specialize/specialization_graph.ts") as typeof import("../../traits/specialize/specialization_graph.ts"),
    ambiguity: require("../traits/ambiguity.ts") as typeof import("../traits/ambiguity.ts"),
    diagnostics: require("../../diagnostics.gen.ts") as typeof import("../../diagnostics.gen.ts"),
  };
}

// ---- D4 descriptors and helpers (no upstream counterpart: in Rust the impls are found by the trait solver) ----------

const fold_PolyFnSig: TypeFoldable<PolyFnSig> = {
  visit_with: visit_with_PolyFnSig,
  try_fold_with: try_fold_with_PolyFnSig,
  fold_with: fold_with_PolyFnSig,
};

const fold_ValuePairs: TypeFoldable<ValuePairs> = {
  visit_with: visit_with_ValuePairs,
  try_fold_with: try_fold_with_ValuePairs,
  fold_with: fold_with_ValuePairs,
};

/** `impl TypeFoldable for ExpectedFound<T>` (derived) over `d_T`. */
function fold_ExpectedFound<T>(d_T: TypeFoldable<T>): TypeFoldable<ExpectedFound<T>> {
  return {
    visit_with: (self, visitor) => visit_with_ExpectedFound(self, visitor, d_T.visit_with),
    try_fold_with: <E>(self: ExpectedFound<T>, folder: FallibleTypeFolder<E>) => try_fold_with_ExpectedFound(self, folder, d_T.try_fold_with),
    fold_with: (self, folder) => fold_with_ExpectedFound(self, folder, d_T.fold_with),
  };
}

const fold_TraitRef: TypeFoldable<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
};

/** `#[derive(TypeFoldable, TypeVisitable)] struct TraitRefPrintSugared<'tcx>(ty::TraitRef<'tcx>)` (print/pretty.rs). */
const fold_TraitRefPrintSugared: TypeFoldable<TraitRefPrintSugared> = {
  visit_with: (self, visitor) => visit_with_TraitRef(self._0, visitor),
  try_fold_with: <E>(self: TraitRefPrintSugared, folder: FallibleTypeFolder<E>): Result<TraitRefPrintSugared, E> => {
    const r = try_fold_with_TraitRef(self._0, folder);
    if (r.$ === "Err") return r;
    return Ok({ _0: r._0 });
  },
  fold_with: (self, folder: TypeFolder) => ({ _0: fold_with_TraitRef(self._0, folder) }),
};

const fold_AliasTerm: TypeFoldable<AliasTerm> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTermKind),
  try_fold_with: <E>(self: AliasTerm, folder: FallibleTypeFolder<E>) => try_fold_with_Alias(self, folder, try_fold_with_AliasTermKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTermKind),
};

const fold_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

const fold_ExistentialProjection: TypeFoldable<ExistentialProjection> = {
  visit_with: visit_with_ExistentialProjection,
  try_fold_with: try_fold_with_ExistentialProjection,
  fold_with: fold_with_ExistentialProjection,
};

/** `impl Display for ty::Binder<'tcx, T>` (rustc_middle's `IrPrint<Binder<T>>`: print into a fresh `FmtPrinter`). */
function display_Binder_with<T>(self: Binder<T>, print_T: Print<T>, d_T: TypeFoldable<T>): string {
  return with_((tcx) => {
    const p = FmtPrinter.new(tcx, Namespace.TypeNS);
    const r = print_Binder(self, p, print_T, d_T);
    if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
    return p.into_buffer();
  });
}

/** `#[derive(PartialEq)] struct DiagStyledString(Vec<StringPart>)` / `struct StringPart { content, style }`. */
function DiagStyledString_eq(a: DiagStyledString, b: DiagStyledString): boolean {
  return a._0.length === b._0.length && a._0.every((p, i) => p.content === b._0[i]!.content && p.style === b._0[i]!.style);
}

/** `#[derive(PartialEq)]` on `ty::AliasTy` (`kind` and the interned `args`). */
function AliasTy_eq(a: AliasTy, b: AliasTy): boolean {
  return a.kind.$ === b.kind.$ && DefId_eq(a.kind.def_id, b.kind.def_id) && a.args === b.args;
}

/// Makes a valid string literal from a string by escaping special characters (" and \),
/// unless they are already escaped.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:97 escape_literal
export function escape_literal(s: string): string {
  let escaped = "";
  const chrs = Array.from(s);
  let i = 0;
  while (i < chrs.length) {
    const first = chrs[i++]!;
    const peek = chrs[i];
    if (first === "\\" && (peek === '"' || peek === "'")) {
      const delim = peek;
      escaped += "\\";
      escaped += delim;
      i++;
    } else if (first === '"' || first === "'") {
      escaped += "\\";
      escaped += first;
    } else {
      escaped += first;
    }
  }
  return escaped;
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:118 normalize_fn_sig
TypeErrCtxt.prototype.normalize_fn_sig = function (this: TypeErrCtxt, fn_sig: Unnormalized<PolyFnSig>): PolyFnSig {
  const param_env = this.param_env;
  if (param_env === undefined) {
    return Unnormalized.skip_normalization(fn_sig);
  }

  if (TypeVisitableExt.has_escaping_bound_vars(Unnormalized.skip_normalization(fn_sig), fold_PolyFnSig)) {
    return Unnormalized.skip_normalization(fn_sig);
  }

  return this.probe((_) => {
    const ocx = crate_().engine.ObligationCtxt.new(this.infcx);
    const normalized_fn_sig = ocx.normalize(ObligationCause.dummy(), param_env, fn_sig, fold_PolyFnSig);
    if (TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
      const normalized_fn_sig_ = this.deeply_resolve_ignoring_regions(normalized_fn_sig, fold_PolyFnSig);
      if (!TypeVisitableExt.has_infer(normalized_fn_sig_, fold_PolyFnSig)) {
        return normalized_fn_sig_;
      }
    }
    return Unnormalized.skip_normalization(fn_sig);
  });
};

// [Note-Type-error-reporting]
// An invariant is that anytime the expected or actual type is Error (the special
// error type, meaning that an error occurred when typechecking this expression),
// this is a derived error. The error cascaded from another error (that was already
// reported), so it's not useful to display it to the user.
// The following methods implement this logic.
// They check if either the actual or expected type is Error, and don't print the error
// in this case. The typechecker should only ever report type errors involving mismatched
// types using one of these methods, and should not call span_err directly for such
// errors.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:153 type_error_struct_with_diag
TypeErrCtxt.prototype.type_error_struct_with_diag = function (this: TypeErrCtxt, sp: Span, mk_diag: (_0: string) => Diag, actual_ty_: Ty): Diag {
  const actual_ty = this.deeply_resolve_ignoring_regions(actual_ty_, fold_Ty);
  // debug!("type_error_struct_with_diag({:?}, {:?})", sp, actual_ty);
  void sp;

  const err = mk_diag(this.ty_to_string(actual_ty));

  // Don't report an error if actual type is `Error`.
  if (TypeVisitableExt.references_error(actual_ty, fold_Ty)) {
    err.downgrade_to_delayed_bug();
  }

  return err;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:175 report_mismatched_types
TypeErrCtxt.prototype.report_mismatched_types = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  expected: Ty,
  actual: Ty,
  err: TypeError,
): Diag {
  const diag = this.report_and_explain_type_error(TypeTrace.types(cause, expected, actual), param_env, err);

  this.suggest_param_env_shadowing(diag, expected, actual, param_env);

  return diag;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:194 report_mismatched_consts
TypeErrCtxt.prototype.report_mismatched_consts = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  expected: Const,
  actual: Const,
  err: TypeError,
): Diag {
  return this.report_and_explain_type_error(TypeTrace.consts(cause, expected, actual), param_env, err);
};

/// Adds a note if the types come from similarly named crates
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:210 check_and_note_conflicting_crates
TypeErrCtxt.prototype.check_and_note_conflicting_crates = function (this: TypeErrCtxt, err: Diag, terr: TypeError): boolean {
  switch (terr.$) {
    case "Sorts": {
      const exp_found = terr._0;
      // if they are both "path types", there's a chance of ambiguity
      // due to different versions of the same crate
      const ek = exp_found.expected.kind();
      const fk = exp_found.found.kind();
      if (ek.$ === "Adt" && fk.$ === "Adt") {
        const exp_adt = ek._0;
        const found_adt = fk._0;
        return this.check_same_definition_different_crate(err, exp_adt.did(), [found_adt.did()], (did) => [this.tcx.def_span(did)], "type");
      }
      break;
    }
    case "Traits": {
      const exp_found = terr._0;
      return this.check_same_definition_different_crate(err, exp_found.expected, [exp_found.found], (did) => [this.tcx.def_span(did)], "trait");
    }
    default:
      break; // FIXME(#22750) handle traits and stuff
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:241 suggest_param_env_shadowing
TypeErrCtxt.prototype.suggest_param_env_shadowing = function (this: TypeErrCtxt, diag: Diag, expected: Ty, found: Ty, param_env: ParamEnv): void {
  let alias: AliasTy;
  let def_id: DefId;
  let concrete: Ty;
  const ek = expected.kind();
  const fk = found.kind();
  if (ek.$ === "Alias" && ek._1.kind.$ === "Projection") {
    [alias, def_id, concrete] = [ek._1, ek._1.kind.def_id, found];
  } else if (fk.$ === "Alias" && fk._1.kind.$ === "Projection") {
    [alias, def_id, concrete] = [fk._1, fk._1.kind.def_id, expected];
  } else {
    return;
  }

  const tcx = this.tcx;

  const trait_ref = AliasTyC.trait_ref(alias, as_interner(tcx));
  const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, Binder.dummy(trait_ref, fold_TraitRef), PolyTraitClause.upcast_from_PolyTraitRef);

  const applicable_impls = crate_().ambiguity.compute_applicable_impls_for_diagnostics(this.infcx, obligation, false);

  for (const candidate of applicable_impls) {
    let impl_def_id: DefId;
    if (candidate.$ === "DefId") {
      impl_def_id = candidate._0;
    } else {
      continue;
    }

    const is_shadowed = this.infcx.probe((_) => {
      const impl_substs = this.infcx.fresh_args_for_item(DUMMY_SP, impl_def_id);
      const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_def_id), tcx, impl_substs, fold_TraitRef));

      const expected_trait_ref = AliasTyC.trait_ref(alias, as_interner(tcx));

      if (this.infcx.at(ObligationCause.dummy(), param_env).eq("No", expected_trait_ref, impl_trait_ref, ToTrace_TraitRef).$ === "Err") {
        return false;
      }

      const leaf = crate_().specialization_graph.assoc_def(tcx, impl_def_id, def_id);
      if (leaf.$ === "Err") return false;
      const leaf_def = leaf._0;

      const trait_def_id = AliasTyC.trait_def_id(alias, as_interner(tcx));
      const rebased_args = alias.args.rebase_onto(tcx, trait_def_id, impl_substs);

      // The impl is erroneous missing a definition for the associated type.
      // Skipping it since calling `TyCtxt::type_of` on its assoc ty will trigger an ICE.
      if (!Defaultness.has_value(AssocItem.defaultness(leaf_def.item, tcx))) {
        return false;
      }

      const impl_item_def_id = leaf_def.item.def_id;
      if (!tcx.check_args_compatible(impl_item_def_id, rebased_args)) {
        return false;
      }
      const impl_assoc_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(impl_item_def_id) as EarlyBinder<Ty>, tcx, rebased_args, fold_Ty));

      return this.infcx.can_eq(param_env, impl_assoc_ty, concrete, ToTrace_Ty);
    });

    if (is_shadowed) {
      diag.note(
        `the associated type \`${this.ty_to_string(AliasTyC.to_ty(alias, tcx, IsRigid.No))}\` is defined as \`${this.ty_to_string(concrete)}\` in the implementation, ` +
          `but the where-bound \`${this.ty_to_string(AliasTyC.self_ty(alias))}\` shadows this definition\n` +
          `see issue #152409 <https://github.com/rust-lang/rust/issues/152409> for more information`,
      );
      return;
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:326 note_error_origin
TypeErrCtxt.prototype.note_error_origin = function (
  this: TypeErrCtxt,
  err: Diag,
  cause: ObligationCause,
  exp_found: ExpectedFound<Ty> | undefined,
  terr: TypeError,
  param_env: ParamEnv | undefined,
): void {
  const code = cause.code_();
  if (code.$ === "Pattern" && code.origin_expr !== undefined && code.span !== undefined) {
    const origin_expr = code.origin_expr;
    const span = code.span;
    const root_ty = code.root_ty;
    const expected_ty = this.deeply_resolve_ignoring_regions(root_ty, fold_Ty);
    const ek = expected_ty.kind();
    if (!(ek.$ === "Infer" && (ek._0.$ === "TyVar" || ek._0.$ === "FreshTy"))) {
      // don't show type `_`
      let def: AdtDef | undefined;
      let args: GenericArgs | undefined;
      let option_did: DefId | undefined;
      if (
        SpanC.desugaring_kind(span)?.$ === "ForLoop" &&
        ek.$ === "Adt" &&
        ((def = ek._0), (args = ek._1), true) &&
        ((option_did = this.tcx.get_diagnostic_item(sym.Option)), option_did !== undefined) &&
        DefId_eq(def.did(), option_did)
      ) {
        err.span_label(span, `this is an iterator with items of type \`${display_Ty(args!.type_at(0))}\``);
      } else if (!SpanC.overlaps(span, cause.span)) {
        const expected_ty_ = this.tcx.short_string(expected_ty, err.long_ty_path(), print_Ty);
        err.span_label(span, `this expression has type \`${expected_ty_}\``);
      }
    }
    let peeled_snippet_r: ReturnType<ReturnType<TyCtxt["sess"]["source_map"]>["span_to_snippet"]>;
    if (exp_found !== undefined && (peeled_snippet_r = this.tcx.sess.source_map().span_to_snippet(origin_expr.peeled_span)).$ === "Ok") {
      const found = exp_found.found;
      let peeled_snippet = peeled_snippet_r._0.toString();
      // Parentheses are needed for cases like as casts.
      // We use the peeled_span for deref suggestions.
      // It's also safe to use for box, since box only triggers if there
      // wasn't a reference to begin with.
      if (origin_expr.peeled_prefix_suggestion_parentheses) {
        peeled_snippet = `(${peeled_snippet})`;
      }

      // Try giving a box suggestion first, as it is a special case of the
      // deref suggestion.
      let prefix: string | undefined;
      if (expected_ty.boxed_ty() === found) {
        err.span_suggestion_verbose(span, "consider dereferencing the boxed value", `*${peeled_snippet}`, "MachineApplicable");
      } else if (param_env !== undefined && (prefix = this.should_deref_suggestion_on_mismatch(param_env, found, expected_ty, origin_expr)) !== undefined) {
        err.span_suggestion_verbose(span, "consider dereferencing to access the inner value using the `Deref` trait", `${prefix}${peeled_snippet}`, "MaybeIncorrect");
      }
    }
  } else if (code.$ === "Pattern" && code.origin_expr === undefined && code.span !== undefined) {
    err.span_label(code.span, "expected due to this");
  } else if (code.$ === "BlockTailExpression" && code._1.$ === "TryDesugar") {
    const scrut_hir_id = code._1._0;
    if (exp_found !== undefined) {
      const expected = exp_found.expected;
      const scrut_expr = this.tcx.hir_expect_expr(scrut_hir_id);
      let scrut_ty: Ty | undefined;
      if (scrut_expr.kind.$ === "Call") {
        const args = scrut_expr.kind._1;
        const arg_expr = unwrap(args[0], "try desugaring call w/out arg");
        scrut_ty = this.typeck_results === undefined ? undefined : this.typeck_results.expr_ty_opt(arg_expr);
      } else {
        return bug("try desugaring w/out call expr as scrutinee");
      }

      if (scrut_ty !== undefined && expected === scrut_ty) {
        const source_map = this.tcx.sess.source_map();
        err.span_suggestion_short(source_map.end_point(cause.span), "try removing this `?`", "", "MachineApplicable");
      }
    }
  } else if (code.$ === "MatchExpressionArm") {
    const { arm_block_id, arm_span, arm_ty, prior_arm_block_id, prior_arm_span, prior_arm_ty, source, prior_non_diverging_arms, scrut_span, expr_span } = code._0;
    if (source.$ === "TryDesugar") {
      const scrut_hir_id = source._0;
      if (exp_found !== undefined) {
        const expected = exp_found.expected;
        const scrut_expr = this.tcx.hir_expect_expr(scrut_hir_id);
        let scrut_ty: Ty | undefined;
        if (scrut_expr.kind.$ === "Call") {
          const args = scrut_expr.kind._1;
          const arg_expr = unwrap(args[0], "try desugaring call w/out arg");
          scrut_ty = this.typeck_results === undefined ? undefined : this.typeck_results.expr_ty_opt(arg_expr);
        } else {
          return bug("try desugaring w/out call expr as scrutinee");
        }

        if (scrut_ty !== undefined && expected === scrut_ty) {
          const source_map = this.tcx.sess.source_map();
          err.span_suggestion_short(source_map.end_point(cause.span), "try removing this `?`", "", "MachineApplicable");
        }
      }
    } else {
      // `prior_arm_ty` can be `!`, `expected` will have better info when present.
      const t = this.deeply_resolve_ignoring_regions(exp_found !== undefined ? exp_found.expected : prior_arm_ty, fold_Ty);
      const source_map = this.tcx.sess.source_map();
      let any_multiline_arm = source_map.is_multiline(arm_span);
      if (prior_non_diverging_arms.length <= 4) {
        for (const sp of prior_non_diverging_arms) {
          any_multiline_arm ||= source_map.is_multiline(sp);
          err.span_label(sp, `this is found to be of type \`${display_Ty(t)}\``);
        }
      } else {
        const sp = prior_non_diverging_arms[prior_non_diverging_arms.length - 1];
        if (sp !== undefined) {
          any_multiline_arm ||= source_map.is_multiline(sp);
          err.span_label(sp, `this and all prior arms are found to be of type \`${display_Ty(t)}\``);
        }
      }
      const outer =
        any_multiline_arm || !source_map.is_multiline(expr_span)
          ? // Cover just `match` and the scrutinee expression, not
            // the entire match body, to reduce diagram noise.
            SpanC.to(SpanC.shrink_to_lo(expr_span), scrut_span)
          : expr_span;
      const msg = "`match` arms have incompatible types";
      err.span_label(outer, msg);
      const subdiag = this.suggest_remove_semi_or_return_binding(prior_arm_block_id, prior_arm_ty, prior_arm_span, arm_block_id, arm_ty, arm_span);
      if (subdiag !== undefined) {
        err.subdiagnostic(crate_().diagnostics.SuggestRemoveSemiOrReturnBinding_subdiagnostic(subdiag));
      }
    }
  } else if (code.$ === "IfExpression") {
    const expr_id = code.expr_id;
    const node = this.tcx.hir_node(expr_id);
    if (!(node.$ === "Expr" && node._0.kind.$ === "If" && node._0.kind._2 !== undefined)) {
      return;
    }
    const cond_expr = node._0.kind._0;
    const then_expr = node._0.kind._1;
    const else_expr = node._0.kind._2;
    const expr_span = node._0.span;
    const then_span = this.find_block_span_from_hir_id(then_expr.hir_id);
    const then_ty = unwrap(this.typeck_results, "if expression only expected inside FnCtxt").expr_ty(then_expr);
    const else_span = this.find_block_span_from_hir_id(else_expr.hir_id);
    const else_ty = unwrap(this.typeck_results, "if expression only expected inside FnCtxt").expr_ty(else_expr);
    if (else_expr.kind.$ === "If" && else_expr.kind._2 === undefined && else_ty.is_unit()) {
      // Account for `let x = if a { 1 } else if b { 2 };`
      err.note("`if` expressions without `else` evaluate to `()`");
      err.note("consider adding an `else` block that evaluates to the expected type");
    }
    err.span_label(then_span, "expected because of this");

    let outer_span: Span | undefined;
    if (this.tcx.sess.source_map().is_multiline(expr_span)) {
      if (SpanC.hi(then_span) === SpanC.hi(expr_span) || SpanC.hi(else_span) === SpanC.hi(expr_span)) {
        // Point at condition only if either block has the same end point as
        // the whole expression, since that'll cause awkward overlapping spans.
        outer_span = SpanC.to(SpanC.shrink_to_lo(expr_span), cond_expr.peel_drop_temps().span);
      } else {
        outer_span = expr_span;
      }
    } else {
      outer_span = undefined;
    }
    if (outer_span !== undefined) {
      err.span_label(outer_span, "`if` and `else` have incompatible types");
    }

    const then_id = then_expr.kind.$ === "Block" ? then_expr.kind._0.hir_id : then_expr.hir_id;
    const else_id = else_expr.kind.$ === "Block" ? else_expr.kind._0.hir_id : else_expr.hir_id;
    const subdiag = this.suggest_remove_semi_or_return_binding(then_id, then_ty, then_span, else_id, else_ty, else_span);
    if (subdiag !== undefined) {
      err.subdiagnostic(crate_().diagnostics.SuggestRemoveSemiOrReturnBinding_subdiagnostic(subdiag));
    }
  } else if (code.$ === "LetElse") {
    err.help("try adding a diverging expression, such as `return` or `panic!(..)`");
    err.help("...or use `match` instead of `let...else`");
  } else {
    const peeled = ObligationCauseCode.peel_derives(cause.code_());
    if ((peeled.$ === "WhereClause" || peeled.$ === "WhereClauseInExpr") && !SpanC.is_dummy(peeled._1) && terr.$ === "RegionsPlaceholderMismatch") {
      err.span_note(peeled._1, "the lifetime requirement is introduced here");
    }
  }
};

/// Determines whether deref_to == <deref_from as Deref>::Target, and if so,
/// returns a prefix that should be added to deref_from as a suggestion.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:594 should_deref_suggestion_on_mismatch
TypeErrCtxt.prototype.should_deref_suggestion_on_mismatch = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  deref_to: Ty,
  deref_from: Ty,
  origin_expr: PatternOriginExpr,
): string | undefined {
  // origin_expr contains stripped away versions of our expression.
  // We'll want to use that to avoid suggesting things like *&x.
  // However, the type that we have access to hasn't been stripped away,
  // so we need to ignore the first n dereferences, where n is the number
  // that's been stripped away in origin_expr.

  // Find a way to autoderef from deref_from to deref_to.
  const steps = this.autoderef_steps(deref_from);
  const num_derefs = steps.findIndex(([ty, _]) => this.infcx.can_eq(param_env, ty, deref_to, ToTrace_Ty));
  if (num_derefs === -1) {
    return undefined;
  }
  const after_deref_ty = steps[num_derefs]![0];

  if (num_derefs <= origin_expr.peeled_count) {
    return undefined;
  }

  const deref_part = "*".repeat(num_derefs - origin_expr.peeled_count);

  // If the user used a reference in the original expression, they probably
  // want the suggestion to still give a reference.
  if (deref_from.is_ref() && !after_deref_ty.is_ref()) {
    return `&${deref_part}`;
  } else {
    return deref_part;
  }
};

/// Given that `other_ty` is the same as a type argument for `name` in `sub`, populate `value`
/// highlighting `name` and every type argument that isn't at `pos` (which is `other_ty`), and
/// populate `other_value` with `other_ty`.
///
/// ```text
/// Foo<Bar<Qux>>
/// ^^^^--------^ this is highlighted
/// |   |
/// |   this type argument is exactly the same as the other type, not highlighted
/// this is highlighted
/// Bar<Qux>
/// -------- this type is the same as a type argument in the other type, not highlighted
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:644 highlight_outer
TypeErrCtxt.prototype.highlight_outer = function (
  this: TypeErrCtxt,
  value: DiagStyledString,
  other_value: DiagStyledString,
  name: string,
  args: readonly GenericArg[],
  pos: number,
  other_ty: Ty,
): void {
  // `value` and `other_value` hold two incomplete type representation for display.
  // `name` is the path of both types being compared. `sub`
  value.push_highlighted(name);

  if (args.length === 0) {
    return;
  }
  value.push_highlighted("<");

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (i > 0) {
      value.push_normal(", ");
    }

    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime": {
        const s = display_Region(k._0);
        value.push_normal(s === "" ? "'_" : s);
        break;
      }
      case "Const":
        value.push_normal(display_Const(k._0));
        break;
      // Highlight all the type arguments that aren't at `pos` and compare
      // the type argument at `pos` and `other_ty`.
      case "Type": {
        const type_arg = k._0;
        if (i === pos) {
          const values = this.cmp(type_arg, other_ty);
          value._0.push(...values[0]._0);
          other_value._0.push(...values[1]._0);
        } else {
          value.push_highlighted(display_Ty(type_arg));
        }
        break;
      }
    }
  }

  value.push_highlighted(">");
};

/// If `other_ty` is the same as a type argument present in `sub`, highlight `path` in `t1_out`,
/// as that is the difference to the other type.
///
/// For the following code:
///
/// ```ignore (illustrative)
/// let x: Foo<Bar<Qux>> = foo::<Bar<Qux>>();
/// ```
///
/// The type error output will behave in the following way:
///
/// ```text
/// Foo<Bar<Qux>>
/// ^^^^--------^ this is highlighted
/// |   |
/// |   this type argument is exactly the same as the other type, not highlighted
/// this is highlighted
/// Bar<Qux>
/// -------- this type is the same as a type argument in the other type, not highlighted
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:712 cmp_type_arg
TypeErrCtxt.prototype.cmp_type_arg = function (
  this: TypeErrCtxt,
  t1_out: DiagStyledString,
  t2_out: DiagStyledString,
  path: string,
  args: readonly GenericArg[],
  other_path: string,
  other_ty: Ty,
): boolean {
  for (let i = 0; i < args.length; i++) {
    const ta = GenericArg.as_type(args[i]!);
    if (ta !== undefined) {
      if (ta === other_ty) {
        this.highlight_outer(t1_out, t2_out, path, args, i, other_ty);
        return true;
      }
      const k = ta.kind();
      if (k.$ === "Adt") {
        const path_ = this.tcx.def_path_str(k._0.did());
        if (path_ === other_path) {
          this.highlight_outer(t1_out, t2_out, path, args, i, other_ty);
          return true;
        }
      }
    }
  }
  return false;
};

/// Adds a `,` to the type representation only if it is appropriate.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:740 push_comma
TypeErrCtxt.prototype.push_comma = function (this: TypeErrCtxt, value: DiagStyledString, other_value: DiagStyledString, pos: number): void {
  if (pos > 0) {
    value.push_normal(", ");
    other_value.push_normal(", ");
  }
};

/// Given two `fn` signatures highlight only sub-parts that are different.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:753 cmp_fn_sig
TypeErrCtxt.prototype.cmp_fn_sig = function (
  this: TypeErrCtxt,
  sig1_: PolyFnSig,
  fn_def1: [DefId, readonly GenericArg[] | undefined] | undefined,
  sig2_: PolyFnSig,
  fn_def2: [DefId, readonly GenericArg[] | undefined] | undefined,
): [DiagStyledString, DiagStyledString] {
  const sig1__ = this.normalize_fn_sig(Unnormalized.new_wip(sig1_));
  const sig2__ = this.normalize_fn_sig(Unnormalized.new_wip(sig2_));

  const get_lifetimes = (sig: PolyFnSig): [string, FnSig] => {
    const [sig_, reg] = unwrap_print(FmtPrinter.new(this.tcx, Namespace.TypeNS).name_all_regions(sig, WrapBinderMode.ForAll, fold_FnSig));
    // PORT: `into_sorted_stable_ord()` on `String`s sorts by byte order (UTF-8 lexicographic; region names are ASCII).
    const lts: string[] = [...reg.values()].map((kind) => display_Region(kind)).sort(cmp_str_bytes);
    return [lts.length === 0 ? "" : `for<${lts.join(", ")}> `, sig_];
  };

  const [lt1, sig1] = get_lifetimes(sig1__);
  const [lt2, sig2] = get_lifetimes(sig2__);

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.normal(""), DiagStyledString.normal("")];

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  // ^^^^^^^^^^^^^^^^^^^^^
  const fn_item_prefix_and_safety = (fn_def: [DefId, readonly GenericArg[] | undefined] | undefined, sig: FnSig): [string, string] => {
    if (fn_def === undefined) {
      return ["", Safety.prefix_str(FnSigC.safety(sig))];
    } else {
      const did = fn_def[0];
      if ((this.tcx.codegen_fn_attrs(did) as CodegenFnAttrs).safe_target_features) {
        return ["#[target_feature(..)] ", ""];
      } else {
        return ["", Safety.prefix_str(FnSigC.safety(sig))];
      }
    }
  };
  const [prefix1, safety1] = fn_item_prefix_and_safety(fn_def1, sig1);
  const [prefix2, safety2] = fn_item_prefix_and_safety(fn_def2, sig2);
  values[0].push(prefix1, prefix1 !== prefix2);
  values[1].push(prefix2, prefix1 !== prefix2);

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                       ^^^^^^^^
  const lifetime_diff = lt1 !== lt2;
  values[0].push(lt1, lifetime_diff);
  values[1].push(lt2, lifetime_diff);

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                               ^^^^^^
  values[0].push(safety1, safety1 !== safety2);
  values[1].push(safety2, safety1 !== safety2);

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                                      ^^^^^^^^^^
  if (FnSigC.abi(sig1).$ !== "Rust") {
    values[0].push(`extern ${display_ExternAbi(FnSigC.abi(sig1))} `, !ExternAbi.eq(FnSigC.abi(sig1), FnSigC.abi(sig2)));
  }
  if (FnSigC.abi(sig2).$ !== "Rust") {
    values[1].push(`extern ${display_ExternAbi(FnSigC.abi(sig2))} `, !ExternAbi.eq(FnSigC.abi(sig1), FnSigC.abi(sig2)));
  }

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                                                 ^^^
  values[0].push_normal("fn(");
  values[1].push_normal("fn(");

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                                                    ^^^^^
  const inputs1 = FnSigC.inputs(sig1);
  const inputs2 = FnSigC.inputs(sig2);
  const len1 = inputs1.length;
  const len2 = inputs2.length;
  const splatted_arg_index1 = FnSigC.splatted(sig1);
  const splatted_arg_index2 = FnSigC.splatted(sig2);
  if (len1 === len2) {
    for (let i = 0; i < len1; i++) {
      const l = inputs1[i]!;
      const r = inputs2[i]!;
      this.push_comma(values[0], values[1], i);
      if (i === splatted_arg_index1) {
        values[0].push("#[rustc_splat]", splatted_arg_index1 !== splatted_arg_index2);
        values[0].push_normal(" ");
      }
      if (i === splatted_arg_index2) {
        values[1].push("#[rustc_splat]", splatted_arg_index1 !== splatted_arg_index2);
        values[1].push_normal(" ");
      }
      const [x1, x2] = this.cmp(l, r);
      values[0]._0.push(...x1._0);
      values[1]._0.push(...x2._0);
    }
  } else {
    for (let i = 0; i < len1; i++) {
      values[0].push_highlighted(display_Ty(inputs1[i]!));
      if (i !== len1 - 1) {
        values[0].push_highlighted(", ");
      }
    }
    for (let i = 0; i < len2; i++) {
      values[1].push_highlighted(display_Ty(inputs2[i]!));
      if (i !== len2 - 1) {
        values[1].push_highlighted(", ");
      }
    }
  }

  if (FnSigC.c_variadic(sig1)) {
    if (len1 > 0) {
      values[0].push_normal(", ");
    }
    values[0].push("...", !FnSigC.c_variadic(sig2));
  }
  if (FnSigC.c_variadic(sig2)) {
    if (len2 > 0) {
      values[1].push_normal(", ");
    }
    values[1].push("...", !FnSigC.c_variadic(sig1));
  }

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                                                         ^
  values[0].push_normal(")");
  values[1].push_normal(")");

  // #[target_feature(..)] for<'a> unsafe extern "C" fn(&'a T) -> &'a T
  //                                                           ^^^^^^^^
  const output1 = FnSigC.output(sig1);
  const output2 = FnSigC.output(sig2);
  const [x1, x2] = this.cmp(output1, output2);
  const output_diff = !DiagStyledString_eq(x1, x2);
  if (!output1.is_unit() || output_diff) {
    values[0].push_normal(" -> ");
    values[0]._0.push(...x1._0);
  }
  if (!output2.is_unit() || output_diff) {
    values[1].push_normal(" -> ");
    values[1]._0.push(...x2._0);
  }

  const fmt = (did: DefId, args: readonly GenericArg[]): string => ` {${this.tcx.def_path_str_with_args(did, args)}}`;

  if (fn_def1 !== undefined && fn_def1[1] !== undefined && fn_def2 !== undefined && fn_def2[1] !== undefined) {
    const path1 = fmt(fn_def1[0], fn_def1[1]);
    const path2 = fmt(fn_def2[0], fn_def2[1]);
    const same_path = path1 === path2;
    values[0].push(path1, !same_path);
    values[1].push(path2, !same_path);
  } else if (fn_def1 !== undefined && fn_def1[1] !== undefined && fn_def2 === undefined) {
    values[0].push_highlighted(fmt(fn_def1[0], fn_def1[1]));
  } else if (fn_def1 === undefined && fn_def2 !== undefined && fn_def2[1] !== undefined) {
    values[1].push_highlighted(fmt(fn_def2[0], fn_def2[1]));
  }

  return values;
};

/** `.unwrap()` on a `Result<_, PrintError>`. */
function unwrap_print<T>(r: Result<T, unknown>): T {
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: Error");
  return r._0;
}

/** `Ord for String`: byte order (UTF-8). */
function cmp_str_bytes(a: string, b: string): number {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return Buffer.compare(ab, bb);
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:913 cmp_traits
TypeErrCtxt.prototype.cmp_traits = function (
  this: TypeErrCtxt,
  def_id1: DefId,
  args1: readonly GenericArg[],
  def_id2: DefId,
  args2: readonly GenericArg[],
): [DiagStyledString, DiagStyledString] {
  const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];

  if (!DefId_eq(def_id1, def_id2)) {
    values[0].push_highlighted(this.tcx.def_path_str(def_id1));
    values[1].push_highlighted(this.tcx.def_path_str(def_id2));
  } else {
    values[0].push_normal(display_Symbol(this.tcx.item_name(def_id1)));
    values[1].push_normal(display_Symbol(this.tcx.item_name(def_id2)));
  }

  if (args1.length !== args2.length) {
    {
      const [pre, post] = args1.length > 0 ? ["<", ">"] : ["", ""];
      values[0].push_normal(`${pre}${args1.map((a) => display_GenericArg(a)).join(", ")}${post}`);
    }
    {
      const [pre, post] = args2.length > 0 ? ["<", ">"] : ["", ""];
      values[1].push_normal(`${pre}${args2.map((a) => display_GenericArg(a)).join(", ")}${post}`);
    }
    return values;
  }

  if (args1.length > 0) {
    values[0].push_normal("<");
    values[1].push_normal("<");
  }
  for (let i = 0; i < args1.length; i++) {
    const a = args1[i]!;
    const b = args2[i]!;
    const a_str = display_GenericArg(a);
    const b_str = display_GenericArg(b);
    const a_ty = GenericArg.as_type(a);
    const b_ty = GenericArg.as_type(b);
    if (a_ty !== undefined && b_ty !== undefined) {
      const [a_, b_] = this.cmp(a_ty, b_ty);
      values[0]._0.push(...a_._0);
      values[1]._0.push(...b_._0);
    } else if (a_str !== b_str) {
      values[0].push_highlighted(a_str);
      values[1].push_highlighted(b_str);
    } else {
      values[0].push_normal(a_str);
      values[1].push_normal(b_str);
    }
    if (i + 1 < args1.length) {
      values[0].push_normal(", ");
      values[1].push_normal(", ");
    }
  }
  if (args1.length > 0) {
    values[0].push_normal(">");
    values[1].push_normal(">");
  }
  return values;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:974 lifetime_display
TypeErrCtxt.prototype.lifetime_display = function (this: TypeErrCtxt, lifetime: Region): string {
  const s = display_Region(lifetime);
  return s === "" ? "'_" : s;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:979 compare_generics
TypeErrCtxt.prototype.compare_generics = function (
  this: TypeErrCtxt,
  values: [DiagStyledString, DiagStyledString],
  sub1: readonly GenericArg[],
  sub2: readonly GenericArg[],
): void {
  const len = sub1.length;
  // Only draw `<...>` if there are lifetime/type arguments.
  if (sub1.length > 0) {
    values[0].push_normal("<");
  }
  if (sub2.length > 0) {
    values[1].push_normal("<");
  }

  if (sub1.length === sub2.length) {
    for (let i = 0; i < len; i++) {
      const arg1 = sub1[i]!;
      const arg2 = sub2[i]!;
      this.push_comma(values[0], values[1], i);
      const k1 = GenericArg.kind(arg1);
      const k2 = GenericArg.kind(arg2);
      // At one point we'd like to elide all lifetimes here, they are
      // irrelevant for all diagnostics that use this output.
      //
      //     Foo<'x, '_, Bar>
      //     Foo<'y, '_, Qux>
      //         ^^  ^^  --- type arguments are not elided
      //         |   |
      //         |   elided as they were the same
      //         not elided, they were different, but irrelevant
      //
      // For bound lifetimes, keep the names of the lifetimes,
      // even if they are the same so that it's clear what's happening
      // if we have something like
      //
      // for<'r, 's> fn(Inv<'r>, Inv<'s>)
      // for<'r> fn(Inv<'r>, Inv<'r>)
      if (k1.$ === "Lifetime" && k2.$ === "Lifetime") {
        const l1 = k1._0;
        const l2 = k2._0;
        const l1_str = this.lifetime_display(l1);
        const l2_str = this.lifetime_display(l2);
        if (l1 !== l2) {
          values[0].push_highlighted(l1_str);
          values[1].push_highlighted(l2_str);
        } else if (l1.is_bound() || this.tcx.sess.opts.verbose) {
          values[0].push_normal(l1_str);
          values[1].push_normal(l2_str);
        } else {
          values[0].push_normal("'_");
          values[1].push_normal("'_");
        }
      } else if (k1.$ === "Type" && k2.$ === "Type") {
        const ta1 = k1._0;
        const ta2 = k2._0;
        if (ta1 === ta2 && !this.tcx.sess.opts.verbose) {
          values[0].push_normal("_");
          values[1].push_normal("_");
        } else {
          this.recurse(ta1, ta2, values);
        }
      }
      // We're comparing two types with the same path, so we compare the type
      // arguments for both. If they are the same, do not highlight and elide
      // from the output.
      //     Foo<_, Bar>
      //     Foo<_, Qux>
      //         ^ elided type as this type argument was the same in both sides

      // Do the same for const arguments, if they are equal, do not highlight and
      // elide them from the output.
      else if (k1.$ === "Const" && k2.$ === "Const") {
        this.maybe_highlight(k1._0, k2._0, values, this.tcx, display_Const);
      }
      // The two params are of different kinds. We don't highlight because the problem
      // is not with these arguments, but rather with the type containing them.
      else {
        values[0].push_normal(display_GenericArg(arg1));
        values[1].push_normal(display_GenericArg(arg2));
      }
    }
  } else {
    // The argument count is different on both sides, highlight both sides
    for (const [value, args] of [
      [values[0], sub1],
      [values[1], sub2],
    ] as const) {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (i > 0) {
          value.push_normal(", ");
        }
        const k = GenericArg.kind(arg);
        switch (k.$) {
          case "Lifetime": {
            const l = k._0;
            const l_str = this.lifetime_display(l);
            if (l.is_bound() || this.tcx.sess.opts.verbose) {
              value.push_normal(l_str);
            } else {
              value.push_normal("'_");
            }
            break;
          }
          case "Type": {
            const ty = k._0;
            if (!this.tcx.sess.opts.verbose) {
              value.push_normal("_");
            } else {
              value.push_normal(display_Ty(ty));
            }
            break;
          }
          case "Const":
            value.push_normal(display_Const(k._0));
            break;
        }
      }
    }
  }

  // Close the type argument bracket.
  // Only draw `<...>` if there are arguments.
  if (sub1.length > 0) {
    values[0].push_normal(">");
  }
  if (sub2.length > 0) {
    values[1].push_normal(">");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1097 recurse
TypeErrCtxt.prototype.recurse = function (this: TypeErrCtxt, t1: Ty, t2: Ty, values: [DiagStyledString, DiagStyledString]): void {
  const [x1, x2] = this.cmp(t1, t2);
  values[0]._0.push(...x1._0);
  values[1]._0.push(...x2._0);
};

// PORT: `T: Eq + ToString` is `===` and `to_string_T` (decls.ts).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1108 maybe_highlight
TypeErrCtxt.prototype.maybe_highlight = function <T>(
  this: TypeErrCtxt,
  t1_: T,
  t2_: T,
  [buf1, buf2]: [DiagStyledString, DiagStyledString],
  tcx: TyCtxt,
  to_string_T: (t: T) => string,
): void {
  const highlight = t1_ !== t2_;
  let t1: string;
  let t2: string;
  if (highlight || tcx.sess.opts.verbose) {
    [t1, t2] = [to_string_T(t1_), to_string_T(t2_)];
  } else {
    // The two types are the same, elide and don't highlight.
    [t1, t2] = ["_", "_"];
  }
  buf1.push(t1, highlight);
  buf2.push(t2, highlight);
};

/// Compares two given types, eliding parts that are the same between them and highlighting
/// relevant differences, and return two representation of those types for highlighted printing.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1128 cmp
TypeErrCtxt.prototype.cmp = function (this: TypeErrCtxt, t1: Ty, t2: Ty): [DiagStyledString, DiagStyledString] {
  // debug!("cmp(t1={}, t1.kind={:?}, t2={}, t2.kind={:?})", t1, t1.kind(), t2, t2.kind());

  // helper functions
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1132 fmt_region
  function fmt_region(region: Region): string {
    let r = display_Region(region);
    if (r === "'_") {
      r = "";
    } else {
      r += " ";
    }
    return `&${r}`;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1142 push_ref
  function push_ref(region: Region, mutbl: Mutability, s: DiagStyledString): void {
    s.push_highlighted(fmt_region(region));
    s.push_highlighted(Mutability.prefix_str(mutbl));
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1151 cmp_ty_refs
  function cmp_ty_refs(r1_: Region, mut1: Mutability, r2_: Region, mut2: Mutability, ss: [DiagStyledString, DiagStyledString]): void {
    const [r1, r2] = [fmt_region(r1_), fmt_region(r2_)];
    if (r1 !== r2) {
      ss[0].push_highlighted(r1);
      ss[1].push_highlighted(r2);
    } else {
      ss[0].push_normal(r1);
      ss[1].push_normal(r2);
    }

    if (mut1 !== mut2) {
      ss[0].push_highlighted(Mutability.prefix_str(mut1));
      ss[1].push_highlighted(Mutability.prefix_str(mut2));
    } else {
      ss[0].push_normal(Mutability.prefix_str(mut1));
      ss[1].push_normal(Mutability.prefix_str(mut2));
    }
  }

  // process starts here
  const k1 = t1.kind();
  const k2 = t2.kind();
  if (k1.$ === "Adt" && k2.$ === "Adt") {
    const def1 = k1._0;
    const sub1 = k1._1;
    const def2 = k2._0;
    const sub2 = k2._1;
    const did1 = def1.did();
    const did2 = def2.did();

    const generics1 = this.tcx.generics_of(did1) as Generics;
    const generics2 = this.tcx.generics_of(did2) as Generics;

    const non_default_after_default = generics1.check_concrete_type_after_default(this.tcx, sub1) || generics2.check_concrete_type_after_default(this.tcx, sub2);
    const sub_no_defaults_1 = non_default_after_default ? generics1.own_args(sub1) : generics1.own_args_no_defaults(this.tcx, sub1);
    const sub_no_defaults_2 = non_default_after_default ? generics2.own_args(sub2) : generics2.own_args_no_defaults(this.tcx, sub2);
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    const path1 = this.tcx.def_path_str(did1);
    const path2 = this.tcx.def_path_str(did2);
    if (DefId_eq(did1, did2)) {
      // Easy case. Replace same types with `_` to shorten the output and highlight
      // the differing ones.
      //     let x: Foo<Bar, Qux> = y::<Foo<Quz, Qux>>();
      //     Foo<Bar, _>
      //     Foo<Quz, _>
      //         ---  ^ type argument elided
      //         |
      //         highlighted in output
      values[0].push_normal(display_Symbol(this.tcx.item_name(did1)));
      values[1].push_normal(display_Symbol(this.tcx.item_name(did2)));

      // Avoid printing out default generic parameters that are common to both
      // types.
      const len1 = sub_no_defaults_1.length;
      const len2 = sub_no_defaults_2.length;
      const common_len = Math.min(len1, len2);
      const remainder1 = sub1.slice(common_len);
      const remainder2 = sub2.slice(common_len);
      let common_default_params = 0;
      for (let i = 0; i < Math.min(remainder1.length, remainder2.length); i++) {
        if (remainder1[remainder1.length - 1 - i] === remainder2[remainder2.length - 1 - i]) {
          common_default_params++;
        }
      }
      const len = sub1.length - common_default_params;
      this.compare_generics(values, sub1.slice(0, len), sub2.slice(0, len));
      return values;
    } else {
      // Check for case:
      //     let x: Foo<Bar<Qux> = foo::<Bar<Qux>>();
      //     Foo<Bar<Qux>
      //         ------- this type argument is exactly the same as the other type
      //     Bar<Qux>
      if (this.cmp_type_arg(values[0], values[1], path1, sub_no_defaults_1, path2, t2)) {
        return values;
      }
      // Check for case:
      //     let x: Bar<Qux> = y:<Foo<Bar<Qux>>>();
      //     Bar<Qux>
      //     Foo<Bar<Qux>>
      //         ------- this type argument is exactly the same as the other type
      if (this.cmp_type_arg(values[1], values[0], path2, sub_no_defaults_2, path1, t1)) {
        return values;
      }

      // We can't find anything in common, highlight relevant part of type path.
      //     let x: foo::bar::Baz<Qux> = y:<foo::bar::Bar<Zar>>();
      //     foo::bar::Baz<Qux>
      //     foo::bar::Bar<Zar>
      //               -------- this part of the path is different

      const t1_str = display_Ty(t1);
      const t2_str = display_Ty(t2);
      const min_len = Math.min(utf8_len(t1_str), utf8_len(t2_str));

      const SEPARATOR = "::";
      const separator_len = utf8_len(SEPARATOR);
      const split1 = t1_str.split(SEPARATOR);
      const split2 = t2_str.split(SEPARATOR);
      let split_idx = 0;
      for (let i = 0; i < Math.min(split1.length, split2.length); i++) {
        if (split1[i] !== split2[i]) break;
        split_idx += utf8_len(split1[i]!) + separator_len;
      }

      // debug!(?separator_len, ?split_idx, ?min_len, "cmp");

      if (split_idx >= min_len) {
        // paths are identical, highlight everything
        return [DiagStyledString.highlighted(t1_str), DiagStyledString.highlighted(t2_str)];
      } else {
        // PORT: `split_at` on a byte index: `split_idx` is the byte length of whole `::`-separated components, so it is a
        // char boundary; the UTF-8 buffers are split there.
        const b1 = Buffer.from(t1_str, "utf8");
        const b2 = Buffer.from(t2_str, "utf8");
        const common = b1.subarray(0, split_idx).toString("utf8");
        const uniq1 = b1.subarray(split_idx).toString("utf8");
        const uniq2 = b2.subarray(split_idx).toString("utf8");
        // debug!(?common, ?uniq1, ?uniq2, "cmp");

        values[0].push_normal(common);
        values[0].push_highlighted(uniq1);
        values[1].push_normal(common);
        values[1].push_highlighted(uniq2);

        return values;
      }
    }
  }

  // When finding `&T != &T`, compare the references, then recurse into pointee type
  else if (k1.$ === "Ref" && k2.$ === "Ref") {
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    cmp_ty_refs(k1._0, k1._2, k2._0, k2._2, values);
    this.recurse(k1._1, k2._1, values);
    return values;
  }
  // When finding T != &T, highlight the borrow
  else if (k1.$ === "Ref") {
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    push_ref(k1._0, k1._2, values[0]);
    this.recurse(k1._1, t2, values);
    return values;
  } else if (k2.$ === "Ref") {
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    push_ref(k2._0, k2._2, values[1]);
    this.recurse(t1, k2._1, values);
    return values;
  }

  // When encountering tuples of the same size, highlight only the differing types
  else if (k1.$ === "Tuple" && k2.$ === "Tuple" && k1._0.length === k2._0.length) {
    const args1 = k1._0;
    const args2 = k2._0;
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.normal("("), DiagStyledString.normal("(")];
    const len = args1.length;
    for (let i = 0; i < len; i++) {
      this.push_comma(values[0], values[1], i);
      this.recurse(args1[i]!, args2[i]!, values);
    }
    if (len === 1) {
      // Keep the output for single element tuples as `(ty,)`.
      values[0].push_normal(",");
      values[1].push_normal(",");
    }
    values[0].push_normal(")");
    values[1].push_normal(")");
    return values;
  } else if (k1.$ === "FnDef" && k2.$ === "FnDef") {
    const did1 = k1._0;
    const did2 = k2._0;
    const args1 = unwrap(Binder.no_bound_vars(k1._1, fold_GenericArgs));
    const args2 = unwrap(Binder.no_bound_vars(k2._1, fold_GenericArgs));

    const sig1 = fn_sig_instantiate(this.tcx, did1, args1);
    const sig2 = fn_sig_instantiate(this.tcx, did2, args2);
    return this.cmp_fn_sig(sig1, [did1, args1], sig2, [did2, args2]);
  } else if (k1.$ === "FnDef" && k2.$ === "FnPtr") {
    const did1 = k1._0;
    const args1 = unwrap(Binder.no_bound_vars(k1._1, fold_GenericArgs));
    const sig1 = fn_sig_instantiate(this.tcx, did1, args1);
    return this.cmp_fn_sig(sig1, [did1, args1], PolyFnSigTys.with(k2._0, k2._1), undefined);
  } else if (k1.$ === "FnPtr" && k2.$ === "FnDef") {
    const did2 = k2._0;
    const args2 = unwrap(Binder.no_bound_vars(k2._1, fold_GenericArgs));

    const sig2 = fn_sig_instantiate(this.tcx, did2, args2);
    return this.cmp_fn_sig(PolyFnSigTys.with(k1._0, k1._1), undefined, sig2, [did2, args2]);
  } else if (k1.$ === "FnPtr" && k2.$ === "FnPtr") {
    return this.cmp_fn_sig(PolyFnSigTys.with(k1._0, k1._1), undefined, PolyFnSigTys.with(k2._0, k2._1), undefined);
  } else if (k1.$ === "Alias" && k2.$ === "Alias" && k1._0 === k2._0 && AliasTy_eq(k1._1, k2._1) && !this.tcx.sess.opts.verbose) {
    const strs: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    strs[0].push_normal("_");
    strs[1].push_normal("_");
    return strs;
  } else if (k1.$ === "Alias" && k2.$ === "Alias" && k1._0 === k2._0) {
    const alias1 = k1._1;
    const alias2 = k2._1;
    const values: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    if (
      alias1.kind.$ === "Projection" &&
      alias2.kind.$ === "Projection" &&
      // RPITIT projections use anonymous associated type and have no item name,
      // so it will be ICE from call of `tcx.item_name(def_id)` below, issue #161915.
      !this.tcx.is_impl_trait_in_trait(alias1.kind.def_id) &&
      !this.tcx.is_impl_trait_in_trait(alias2.kind.def_id)
    ) {
      const def_id1 = alias1.kind.def_id;
      const def_id2 = alias2.kind.def_id;
      // `<Type as Trait>::Name<args>`
      values[0].push_normal("<");
      values[1].push_normal("<");
      const [trait_ref1, args1] = AliasTyC.trait_ref_and_own_args(alias1, as_interner(this.tcx));
      const [trait_ref2, args2] = AliasTyC.trait_ref_and_own_args(alias2, as_interner(this.tcx));
      this.recurse(TraitRef.self_ty(trait_ref1), TraitRef.self_ty(trait_ref2), values);

      values[0].push_normal(" as ");
      values[1].push_normal(" as ");
      if (DefId_eq(trait_ref1.def_id, trait_ref2.def_id)) {
        if (this.tcx.sess.opts.verbose) {
          values[0].push_normal(display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref1)));
          values[1].push_normal(display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref2)));
        } else {
          with_forced_trimmed_paths(() => {
            values[0].push_normal(display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref1)));
            values[1].push_normal(display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref2)));
          });
        }
        // We skip the type of `Self`:
        const args1_ = trait_ref1.args.slice(1);
        const args2_ = trait_ref2.args.slice(1);
        this.compare_generics(values, args1_, args2_);
      } else {
        values[0].push_highlighted(display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref1)));
        values[1].push_highlighted(display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref2)));
      }
      values[0].push_normal(">::");
      values[1].push_normal(">::");
      const name1 = this.tcx.item_name(def_id1);
      const name2 = this.tcx.item_name(def_id2);
      if (DefId_eq(def_id1, def_id2)) {
        values[0].push_normal(display_Symbol(name1));
        values[1].push_normal(display_Symbol(name2));
      } else {
        // The two types are already different, so the arguments are not
        // illuminating anything by highlighting them in any way.
        values[0].push_highlighted(display_Symbol(name1));
        values[1].push_highlighted(display_Symbol(name2));
      }
      this.compare_generics(values, args1, args2);
    } else {
      this.maybe_highlight(t1, t2, values, this.tcx, display_Ty);
    }
    return values;
  } else {
    const strs: [DiagStyledString, DiagStyledString] = [DiagStyledString.new(), DiagStyledString.new()];
    this.maybe_highlight(t1, t2, strs, this.tcx, display_Ty);
    return strs;
  }
};

// PORT: `self.tcx.fn_sig(did).instantiate(self.tcx, args).skip_norm_wip()` (written four times in `cmp`) as a module-local
// helper; queries.gen.ts types the `fn_sig` query's value `unknown`, it is `EarlyBinder<PolyFnSig>`.
function fn_sig_instantiate(tcx: TyCtxt, did: DefId, args: GenericArgs): PolyFnSig {
  return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(did) as EarlyBinder<PolyFnSig>, tcx, args, fold_Binder(fold_FnSig)));
}

// ---- note_type_err's local types (mod.rs:1479..1568, 1572..1575, 1767..1771) ----

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1482 OpaqueTypesVisitor
// PORT: `FxIndexMap<TyCategory, FxIndexSet<Span>>` is a `KeyedMap` (keyed by the derived `Eq`) of insertion-ordered sets.
class OpaqueTypesVisitor implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResult.unit;

  constructor(
    public types: KeyedMap<TyCategory, Set<Span>>,
    public expected: KeyedMap<TyCategory, Set<Span>>,
    public found: KeyedMap<TyCategory, Set<Span>>,
    public ignore_span: Span,
    public tcx: TyCtxt,
  ) {}

  // impl<'tcx> OpaqueTypesVisitor<'tcx>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1491 visit_expected_found
  static visit_expected_found<E, F>(tcx: TyCtxt, expected: E, found: F, ignore_span: Span, d_E: TypeVisitable<E>, d_F: TypeVisitable<F>): OpaqueTypesVisitor {
    const types_visitor = new OpaqueTypesVisitor(
      new KeyedMap<TyCategory, Set<Span>>(intern_key),
      new KeyedMap<TyCategory, Set<Span>>(intern_key),
      new KeyedMap<TyCategory, Set<Span>>(intern_key),
      ignore_span,
      tcx,
    );
    // The visitor puts all the relevant encountered types in `self.types`, but in
    // here we want to visit two separate types with no relation to each other, so we
    // move the results from `types` to `expected` or `found` as appropriate.
    d_E.visit_with(expected, types_visitor);
    [types_visitor.expected, types_visitor.types] = [types_visitor.types, types_visitor.expected];
    d_F.visit_with(found, types_visitor);
    [types_visitor.found, types_visitor.types] = [types_visitor.types, types_visitor.found];
    return types_visitor;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1514 report
  report(err: Diag): void {
    this.add_labels_for_types(err, "expected", this.expected);
    this.add_labels_for_types(err, "found", this.found);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1519 add_labels_for_types
  add_labels_for_types(err: Diag, target: string, types: KeyedMap<TyCategory, Set<Span>>): void {
    for (const [kind, values] of types) {
      const count = values.size;
      for (const sp of values) {
        err.span_label(sp, `${count === 1 ? "the " : "one of the "}${target} ${display_TyCategory(kind, true)}${pluralize(count)}`);
      }
    }
  }

  // impl<'tcx> ty::TypeVisitor<TyCtxt<'tcx>> for OpaqueTypesVisitor<'tcx>

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1544 visit_ty
  visit_ty(t: Ty): undefined {
    const r = TyCategory_from_ty(this.tcx, t);
    if (r !== undefined) {
      const [kind, def_id] = r;
      const span = this.tcx.def_span(def_id);
      // Avoid cluttering the output when the "found" and error span overlap:
      //
      // error[E0308]: mismatched types
      //   --> $DIR/issue-20862.rs:2:5
      //    |
      // LL |     |y| x + y
      //    |     ^^^^^^^^^
      //    |     |
      //    |     the found closure
      //    |     expected `()`, found closure
      //    |
      //    = note: expected unit type `()`
      //                 found closure `{closure@$DIR/issue-20862.rs:2:5: 2:14 x:_}`
      //
      // Also ignore opaque `Future`s that come from async fns.
      if (!SpanC.overlaps(this.ignore_span, span) && !SpanC.is_desugaring(span, DesugaringKind.Async)) {
        let set = this.types.get(kind);
        if (set === undefined) {
          set = new Set();
          this.types.set(kind, set);
        }
        set.add(span);
      }
    }
    return fold_Ty.super_visit_with(t, this);
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: Parameters<typeof TypeVisitor_provided.visit_predicate<P, undefined>>[2]): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Parameters<typeof TypeVisitor_provided.visit_clauses<undefined>>[1]): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: Parameters<typeof TypeVisitor_provided.visit_error<undefined>>[1]): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `enum Mismatch<'a> { Variable(ty::error::ExpectedFound<Ty<'a>>), Fixed(&'static str) }` (local to `note_type_err`). */
type Mismatch = { readonly $: "Variable"; _0: ExpectedFound<Ty> } | { readonly $: "Fixed"; _0: string };

/** `enum Similar<'tcx>` (local to `note_type_err`). */
type Similar =
  | { readonly $: "Adts"; expected: AdtDef; found: AdtDef }
  | { readonly $: "PrimitiveFound"; expected: AdtDef; found: Ty }
  | { readonly $: "PrimitiveExpected"; expected: Ty; found: AdtDef };

/// Extend a type error with extra labels pointing at "non-trivial" types, like closures and
/// the return type of `async fn`s.
///
/// `secondary_span` gives the caller the opportunity to expand `diag` with a `span_label`.
///
/// `swap_secondary_and_primary` is used to make projection errors in particular nicer by using
/// the message in `secondary_span` as the primary label, and apply the message that would
/// otherwise be used for the primary label on the `secondary_span` `Span`. This applies on
/// E0271, like `tests/ui/issues/issue-39970.stderr`.
// #[instrument(level = "debug", skip(self, diag, secondary_span, prefer_label))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1462 note_type_err
TypeErrCtxt.prototype.note_type_err = function (
  this: TypeErrCtxt,
  diag: Diag,
  cause: ObligationCause,
  secondary_span: [Span, string, boolean] | undefined,
  values_: ParamEnvAnd<ValuePairs> | undefined,
  terr: TypeError,
  prefer_label: boolean,
  override_span: Span | undefined,
): void {
  // We use `override_span` when we want the error to point at a `Span` other than
  // `cause.span`. This is used in E0271, when a closure is passed in where the return type
  // isn't what was expected. We want to point at the closure's return type (or expression),
  // instead of the expression where the closure is passed as call argument.
  const span = override_span ?? cause.span;
  // For some types of errors, expected-found does not make
  // sense, so just ignore the values we were given.
  if (terr.$ === "CyclicTy") {
    values_ = undefined;
  }

  // debug!("note_type_err(diag={:?})", diag);
  let expected_found: [DiagStyledString, DiagStyledString] | undefined;
  let exp_found: Mismatch;
  let is_simple_error: boolean;
  let values: ValuePairs | undefined;
  let param_env: ParamEnv | undefined;
  if (values_ === undefined) {
    [expected_found, exp_found, is_simple_error, values, param_env] = [undefined, { $: "Fixed", _0: "type" }, false, undefined, undefined];
  } else {
    const param_env_ = values_.param_env;
    const values__ = this.deeply_resolve_ignoring_regions(values_.value, fold_ValuePairs);
    let is_simple_error_: boolean;
    let exp_found_: Mismatch;
    switch (values__.$) {
      case "Terms": {
        const { expected, found } = values__._0;
        const ek = Term.kind(expected);
        const fk = Term.kind(found);
        if (ek.$ === "Ty" && fk.$ === "Ty") {
          const expected_ = ek._0;
          const found_ = fk._0;
          const is_simple_err = expected_.is_simple_text() && found_.is_simple_text();
          OpaqueTypesVisitor.visit_expected_found(this.tcx, expected_, found_, span, fold_Ty, fold_Ty).report(diag);

          [is_simple_error_, exp_found_] = [is_simple_err, { $: "Variable", _0: { expected: expected_, found: found_ } }];
        } else if (ek.$ === "Const" && fk.$ === "Const") {
          [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "constant" }];
        } else {
          [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "type" }];
        }
        break;
      }
      case "PolySigs": {
        const { expected, found } = values__._0 as ExpectedFound<PolyFnSig>;
        OpaqueTypesVisitor.visit_expected_found(this.tcx, expected, found, span, fold_PolyFnSig, fold_PolyFnSig).report(diag);
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "signature" }];
        break;
      }
      case "TraitRefs":
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "trait" }];
        break;
      case "Aliases": {
        const expected = values__._0.expected;
        // ty::AliasTermKind::ProjectionTy { def_id } | ... | ty::AliasTermKind::InherentConstImpl { def_id } => def_id
        const def_id = expected.kind.def_id;
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: this.tcx.def_descr(def_id) }];
        break;
      }
      case "Regions":
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "lifetime" }];
        break;
      case "ExistentialTraitRef":
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "existential trait ref" }];
        break;
      case "ExistentialProjection":
        [is_simple_error_, exp_found_] = [false, { $: "Fixed", _0: "existential projection" }];
        break;
    }
    const vals = this.values_str(values__, cause, diag.long_ty_path());
    if (vals === undefined) {
      // Derived error. Cancel the emitter.
      // NOTE(eddyb) this was `.cancel()`, but `diag`
      // is borrowed, so we can't fully defuse it.
      diag.downgrade_to_delayed_bug();
      return;
    }
    [expected_found, exp_found, is_simple_error, values, param_env] = [vals, exp_found_, is_simple_error_, values__, param_env_];
  }

  const label_or_note = (span: Span, msg: string): void => {
    const primary_spans = diag.deref().span.primary_spans_();
    if ((prefer_label && is_simple_error) || (primary_spans.length === 1 && primary_spans[0] === span)) {
      diag.span_label(span, msg);
    } else {
      diag.span_note(span, msg);
    }
  };
  let e_f: [Ty, Ty] | undefined;
  if (secondary_span !== undefined) {
    const [secondary_span_, secondary_msg, swap_secondary_and_primary] = secondary_span;
    if (swap_secondary_and_primary) {
      let terr_: string;
      if (values !== undefined && values.$ === "Terms") {
        const expected = values._0.expected;
        terr_ = `expected this to be \`${display_Term(expected)}\``;
      } else {
        terr_ = TypeError_to_string(terr, this.tcx);
      }
      label_or_note(secondary_span_, terr_);
      label_or_note(span, secondary_msg);
    } else {
      label_or_note(span, TypeError_to_string(terr, this.tcx));
      label_or_note(secondary_span_, secondary_msg);
    }
  } else if (values !== undefined && (e_f = ValuePairs.ty(values)) !== undefined && (terr.$ === "ArgumentSorts" || terr.$ === "Sorts")) {
    const e = this.tcx.erase_and_anonymize_regions(e_f[0], fold_Ty);
    const f = this.tcx.erase_and_anonymize_regions(e_f[1], fold_Ty);
    const expected = with_forced_trimmed_paths(() => e.sort_string(this.tcx));
    const found = with_forced_trimmed_paths(() => f.sort_string(this.tcx));
    if (expected === found) {
      label_or_note(span, TypeError_to_string(terr, this.tcx));
    } else {
      label_or_note(span, `expected ${expected}, found ${found}`);
    }
  } else {
    label_or_note(span, TypeError_to_string(terr, this.tcx));
  }

  if (param_env !== undefined) {
    this.note_field_shadowed_by_private_candidate_in_cause(diag, cause, param_env);
  }

  if (this.check_and_note_conflicting_crates(diag, terr)) {
    return;
  }

  if (expected_found !== undefined) {
    const [expected, found] = expected_found;
    let expected_label: string;
    let found_label: string;
    let exp_found_: ExpectedFound<Ty> | undefined;
    if (exp_found.$ === "Variable") {
      const ef = exp_found._0;
      [expected_label, found_label, exp_found_] = [ef.expected.prefix_string(this.tcx), ef.found.prefix_string(this.tcx), ef];
    } else {
      const s = exp_found._0;
      [expected_label, found_label, exp_found_] = [s, s, undefined];
    }

    const similarity = ({ expected, found }: ExpectedFound<Ty>): Similar | undefined => {
      const ek = expected.kind();
      const fk = found.kind();
      let primitive: Symbol | undefined;
      if (ek.$ === "Adt" && (primitive = found.primitive_symbol()) !== undefined) {
        const expected_ = ek._0;
        const path = this.tcx.def_path(expected_.did()).data;
        const name = DefPathData.get_opt_name(unwrap(path[path.length - 1]).data);
        if (name === primitive) {
          return { $: "PrimitiveFound", expected: expected_, found };
        }
      } else if ((primitive = expected.primitive_symbol()) !== undefined && fk.$ === "Adt") {
        const found_ = fk._0;
        const path = this.tcx.def_path(found_.did()).data;
        const name = DefPathData.get_opt_name(unwrap(path[path.length - 1]).data);
        if (name === primitive) {
          return { $: "PrimitiveExpected", expected, found: found_ };
        }
      } else if (ek.$ === "Adt" && fk.$ === "Adt") {
        const expected_ = ek._0;
        const found_ = fk._0;
        if (!expected_.did().is_local() && expected_.did().krate === found_.did().krate) {
          // Most likely types from different versions of the same crate
          // are in play, in which case this message isn't so helpful.
          // A "perhaps two different versions..." error is already emitted for that.
          return undefined;
        }
        const f_path = this.tcx.def_path(found_.did()).data;
        const e_path = this.tcx.def_path(expected_.did()).data;

        const e_last = e_path[e_path.length - 1];
        const f_last = f_path[f_path.length - 1];
        if (e_last !== undefined && f_last !== undefined && DefPathData_eq(e_last.data, f_last.data) && e_last.disambiguator === f_last.disambiguator) {
          return { $: "Adts", expected: expected_, found: found_ };
        }
      }
      return undefined;
    };

    let s: Similar | undefined;
    // If two types mismatch but have similar names, mention that specifically.
    if (terr.$ === "Sorts" && (s = similarity(terr._0)) !== undefined) {
      const values = terr._0;
      const diagnose_primitive = (prim: Ty, shadow: Ty, defid: DefId, diag: Diag): void => {
        const name = shadow.sort_string(this.tcx);
        diag.note(`\`${display_Ty(prim)}\` and ${name} have similar names, but are actually distinct types`);
        diag.note(`one \`${display_Ty(prim)}\` is a primitive defined by the language`);
        const def_span = this.tcx.def_span(defid);
        let msg: string;
        if (defid.is_local()) {
          msg = `the other ${name} is defined in the current crate`;
        } else {
          const crate_name = this.tcx.crate_name(defid.krate);
          msg = `the other ${name} is defined in crate \`${display_Symbol(crate_name)}\``;
        }
        diag.span_note(def_span, msg);
      };

      const diagnose_adts = (expected_adt: AdtDef, found_adt: AdtDef, diag: Diag): void => {
        const found_name = values.found.sort_string(this.tcx);
        const expected_name = values.expected.sort_string(this.tcx);

        const found_defid = found_adt.did();
        const expected_defid = expected_adt.did();

        diag.note(`${found_name} and ${expected_name} have similar names, but are actually distinct types`);
        for (const [defid, name] of [
          [found_defid, found_name],
          [expected_defid, expected_name],
        ] as const) {
          const def_span = this.tcx.def_span(defid);

          let msg: string;
          if (found_defid.is_local() && expected_defid.is_local()) {
            const module = LocalModId.to_def_id(this.tcx.parent_module_from_def_id(defid.expect_local()));
            const module_name = this.tcx.def_path(module).to_string_no_crate_verbose();
            msg = `${name} is defined in module \`crate${module_name}\` of the current crate`;
          } else if (defid.is_local()) {
            msg = `${name} is defined in the current crate`;
          } else {
            const crate_name = this.tcx.crate_name(defid.krate);
            msg = `${name} is defined in crate \`${display_Symbol(crate_name)}\``;
          }
          diag.span_note(def_span, msg);
        }
      };

      switch (s.$) {
        case "Adts":
          diagnose_adts(s.expected, s.found, diag);
          break;
        case "PrimitiveFound":
          diagnose_primitive(s.found, values.expected, s.expected.did(), diag);
          break;
        case "PrimitiveExpected":
          diagnose_primitive(s.expected, values.found, s.found.did(), diag);
          break;
      }
    } else if (terr.$ === "Sorts") {
      const values = terr._0;
      const extra =
        DiagStyledString_eq(expected, found) &&
        // Ensure that we don't ever say something like
        // expected `impl Trait` (opaque type `impl Trait`)
        //    found `impl Trait` (opaque type `impl Trait`)
        values.expected.sort_string(this.tcx) !== values.found.sort_string(this.tcx);
      const sort_string = (ty: Ty): DiagStyledString => {
        const k = ty.kind();
        if (extra && k.$ === "Alias" && k._1.kind.$ === "Opaque") {
          const def_id = k._1.kind.def_id;
          const sm = this.tcx.sess.source_map();
          const pos = sm.lookup_char_pos(SpanC.lo(this.tcx.def_span(def_id)));
          return DiagStyledString.normal(` (opaque type at <${sm.filename_for_diagnostics(pos.file.name).toString()}:${pos.line}:${pos.col + 1}>)`);
        } else if (extra && k.$ === "Alias" && k._1.kind.$ === "Projection" && this.tcx.is_impl_trait_in_trait(k._1.kind.def_id)) {
          const def_id = k._1.kind.def_id;
          const sm = this.tcx.sess.source_map();
          const pos = sm.lookup_char_pos(SpanC.lo(this.tcx.def_span(def_id)));
          return DiagStyledString.normal(` (trait associated opaque type at <${sm.filename_for_diagnostics(pos.file.name).toString()}:${pos.line}:${pos.col + 1}>)`);
        } else if (extra) {
          const s = DiagStyledString.normal(" (");
          s.push_highlighted(ty.sort_string(this.tcx));
          s.push_normal(")");
          return s;
        } else {
          return DiagStyledString.normal("");
        }
      };
      if (
        !(values.expected.is_simple_text() && values.found.is_simple_text()) ||
        (exp_found_ !== undefined &&
          ((ef) => {
            // This happens when the type error is a subset of the expectation,
            // like when you have two references but one is `usize` and the other
            // is `f32`. In those cases we still want to show the `note`. If the
            // value from `ef` is `Infer(_)`, then we ignore it.
            if (!ef.expected.is_ty_or_numeric_infer()) {
              return ef.expected !== values.expected;
            } else if (!ef.found.is_ty_or_numeric_infer()) {
              return ef.found !== values.found;
            } else {
              return false;
            }
          })(exp_found_))
      ) {
        if (exp_found_ !== undefined && !this.tcx.ty_is_opaque_future(exp_found_.found)) {
          // `Future` is a special opaque type that the compiler
          // will try to hide in some case such as `async fn`, so
          // to make an error more use friendly we will
          // avoid to suggest a mismatch type with a
          // type that the user usually are not using
          // directly such as `impl Future<Output = u8>`.
          diag.note_expected_found_extra(expected_label, expected, found_label, found, sort_string(values.expected), sort_string(values.found));
        }
      }
    } else {
      // debug!("note_type_err: exp_found={:?}, expected={:?} found={:?}", exp_found, expected, found);
      if (!is_simple_error || TypeError.must_include_note(terr)) {
        diag.note_expected_found(expected_label, expected, found_label, found);

        const fk = exp_found_ === undefined ? undefined : exp_found_.found.kind();
        if (fk !== undefined && fk.$ === "Closure") {
          const args = fk._1;
          diag.highlighted_note([
            StringPart.normal("closure has signature: `"),
            StringPart.highlighted(display_PolyFnSig(this.tcx.signature_unclosure(ClosureArgs.sig(args.as_closure()), "Safe"))),
            StringPart.normal("`"),
          ]);
        }
      }
    }
  }
  let exp_found_2: ExpectedFound<Ty> | undefined = exp_found.$ === "Variable" ? exp_found._0 : undefined;
  // `terr` has more accurate type information than `exp_found` in match expressions.
  if (terr.$ === "Sorts" && exp_found_2 !== undefined && terr._0.found === exp_found_2.found) {
    exp_found_2 = terr._0;
  }
  // debug!("exp_found {:?} terr {:?} cause.code {:?}", exp_found, terr, cause.code());
  if (exp_found_2 !== undefined) {
    const exp_found = exp_found_2;
    const code = cause.code_();
    const should_suggest_fixes =
      code.$ === "Pattern"
        ? // Skip if the root_ty of the pattern is not the same as the expected_ty.
          // If these types aren't equal then we've probably peeled off a layer of arrays.
          this.same_type_modulo_infer(code.root_ty, exp_found.expected, relate_Ty)
        : true;

    // FIXME(#73154): For now, we do leak check when coercing function
    // pointers in typeck, instead of only during borrowck. This can lead
    // to these `RegionsInsufficientlyPolymorphic` errors that aren't helpful.
    if (should_suggest_fixes && terr.$ !== "RegionsInsufficientlyPolymorphic") {
      this.suggest_tuple_pattern(cause, exp_found, diag);
      this.suggest_accessing_field_where_appropriate(cause, exp_found, diag);
      this.suggest_await_on_expect_found(cause, span, exp_found, diag);
      this.suggest_function_pointers(cause, span, exp_found, terr, diag);
      this.suggest_turning_stmt_into_expr(cause, exp_found, diag);
    }
  }

  const body_owner_def_id = cause.body_def_id !== CRATE_DEF_ID ? LocalDefId.to_def_id(cause.body_def_id) : undefined;
  this.note_and_explain_type_err(diag, terr, cause, span, body_owner_def_id);
  if (exp_found_2 !== undefined) {
    const exp_found: TypeError = { $: "Sorts", _0: exp_found_2 };
    // `exp_found != terr` (derived `PartialEq`): only a `Sorts` with the same types is equal.
    if (!(terr.$ === "Sorts" && terr._0.expected === exp_found_2.expected && terr._0.found === exp_found_2.found)) {
      this.note_and_explain_type_err(diag, exp_found, cause, span, body_owner_def_id);
    }
  }

  if (values !== undefined && values.$ === "TraitRefs") {
    const exp_found = values._0;
    const sk = TraitRef.self_ty(exp_found.expected).kind();
    let def_id: ReturnType<DefId["as_local"]>;
    if (sk.$ === "Closure" && (def_id = sk._0.as_local()) !== undefined && TypeError.involves_regions(terr)) {
      const span = this.tcx.def_span(def_id);
      diag.span_note(span, "this closure does not fulfill the lifetime requirements");
      this.suggest_for_all_lifetime_closure(span, this.tcx.hir_node_by_def_id(def_id), exp_found, diag);
    }
  }

  // It reads better to have the error origin as the final
  // thing.
  this.note_error_origin(diag, cause, exp_found_2, terr, param_env);

  // debug!(?diag);
};

/** `impl Display for ty::PolyFnSig<'tcx>` (`Binder<FnSig>`, printed by rustc_middle's `IrPrint`). */
function display_PolyFnSig(sig: PolyFnSig): string {
  return display_Binder_with(sig, print_FnSig, fold_FnSig);
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:1984 type_error_additional_suggestions
TypeErrCtxt.prototype.type_error_additional_suggestions = function (
  this: TypeErrCtxt,
  trace: TypeTrace,
  terr: TypeError,
  long_ty_path: MutRef<PathBuf | undefined>,
): TypeErrorAdditionalDiags[] {
  const suggestions: TypeErrorAdditionalDiags[] = [];
  const span = trace.cause.span;
  const values = this.deeply_resolve_ignoring_regions(trace.values, fold_ValuePairs);
  const ty = ValuePairs.ty(values);
  if (ty !== undefined) {
    const [expected, found] = ty;
    const ek = expected.kind();
    const fk = found.kind();
    if (ek.$ === "Tuple" && fk.$ === "Tuple") {
      // nothing
    }
    // If a tuple of length one was expected and the found expression has
    // parentheses around it, perhaps the user meant to write `(expr,)` to
    // build a tuple (issue #86100)
    else if (ek.$ === "Tuple") {
      const s = this.suggest_wrap_to_build_a_tuple(span, found, ek._0);
      if (s !== undefined) suggestions.push(s);
    }
    // If a byte was expected and the found expression is a char literal
    // containing a single ASCII character, perhaps the user meant to write `b'c'` to
    // specify a byte literal
    else if (ek.$ === "Uint" && ek._0 === "U8" && fk.$ === "Char") {
      const r = this.tcx.sess.source_map().span_to_snippet(span);
      let code: string | undefined;
      if (
        r.$ === "Ok" &&
        (code = strip_circumfix(r._0.toString(), "'", "'")) !== undefined &&
        // forbid all Unicode escapes
        !code.startsWith("\\u") &&
        // forbids literal Unicode characters beyond ASCII
        code.length > 0 &&
        code.codePointAt(0)! < 0x80
      ) {
        suggestions.push({ $: "MeantByteLiteral", span, code: escape_literal(code) });
      }
    }
    // If a character was expected and the found expression is a string literal
    // containing a single character, perhaps the user meant to write `'c'` to
    // specify a character literal (issue #92479)
    else if (ek.$ === "Char" && fk.$ === "Ref" && fk._1.is_str()) {
      const r = this.tcx.sess.source_map().span_to_snippet(span);
      let code: string | undefined;
      if (r.$ === "Ok" && (code = strip_circumfix(r._0.toString(), '"', '"')) !== undefined && Array.from(code).length === 1) {
        suggestions.push({ $: "MeantCharLiteral", span, code: escape_literal(code) });
      }
    }
    // If a string was expected and the found expression is a character literal,
    // perhaps the user meant to write `"s"` to specify a string literal.
    else if (ek.$ === "Ref" && ek._1.is_str() && fk.$ === "Char") {
      const r = this.tcx.sess.source_map().span_to_snippet(span);
      if (r.$ === "Ok") {
        const code = r._0.toString();
        if (code.startsWith("'") && code.endsWith("'")) {
          suggestions.push({
            $: "MeantStrLiteral",
            start: SpanC.with_hi(span, BytePos.add(SpanC.lo(span), BytePos.from_u32(1))),
            end: SpanC.with_lo(span, BytePos.sub(SpanC.hi(span), BytePos.from_u32(1))),
          });
        }
      }
    }
    // For code `if Some(..) = expr `, the type mismatch may be expected `bool` but found `()`,
    // we try to suggest to add the missing `let` for `if let Some(..) = expr`
    else if (ek.$ === "Bool" && fk.$ === "Tuple") {
      if (fk._0.length === 0) {
        const s = this.suggest_let_for_letchains(trace.cause, span);
        if (s !== undefined) suggestions.push(s);
      }
    } else if (ek.$ === "Array" && fk.$ === "Array") {
      const s = this.suggest_specify_actual_length(terr, trace, span);
      if (s !== undefined) suggestions.push(s);
    }
  }
  const code = trace.cause.code_();
  let source: hir.MatchSource | undefined;
  if (code.$ === "MatchExpressionArm") {
    source = code._0.source;
  } else if (code.$ === "BlockTailExpression") {
    source = code._1;
  }
  let vals: [DiagStyledString, DiagStyledString] | undefined;
  if (source !== undefined && source.$ === "TryDesugar" && (vals = this.values_str(trace.values, trace.cause, long_ty_path)) !== undefined) {
    const [expected_ty, found_ty] = vals;
    suggestions.push({ $: "TryCannotConvert", found: found_ty.content(), expected: expected_ty.content() });
  }
  return suggestions;
};

/** `str::strip_circumfix(prefix, suffix)` (unstable core). */
function strip_circumfix(s: string, prefix: string, suffix: string): string | undefined {
  if (s.startsWith(prefix)) {
    const rest = s.slice(prefix.length);
    if (rest.endsWith(suffix)) {
      return rest.slice(0, rest.length - suffix.length);
    }
  }
  return undefined;
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2076 suggest_specify_actual_length
TypeErrCtxt.prototype.suggest_specify_actual_length = function (this: TypeErrCtxt, terr: TypeError, trace: TypeTrace, span: Span): TypeErrorAdditionalDiags | undefined {
  if (terr.$ !== "ArraySize") {
    return undefined;
  }
  const sz = terr._0;
  let tykind: hir.TyKind | undefined;
  const node = this.tcx.hir_node_by_def_id(trace.cause.body_def_id);
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    const body = this.tcx.hir_body(node._0.kind.body);
    const r = new LetVisitor(span).visit_body(body);
    tykind = r.$ === "Break" ? r._0 : undefined;
  } else if (node.$ === "Item" && node._0.kind.$ === "Const") {
    tykind = node._0.kind._2.peel_refs().kind;
  } else {
    tykind = undefined;
  }
  let length_val: number | undefined;
  if (tykind !== undefined && tykind.$ === "Array" && (length_val = sz.found.try_to_target_usize(this.tcx)) !== undefined) {
    const length_arg = tykind._1;
    return { $: "ConsiderSpecifyingLength", span: length_arg.span, length: length_val };
  } else {
    return undefined;
  }
};

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2091 LetVisitor
class LetVisitor extends HirVisitor<ControlFlowT<hir.TyKind>> {
  // impl<'v> Visitor<'v> for LetVisitor
  // type Result = ControlFlow<&'v hir::TyKind<'v>>;
  override Result = VisitorResult.ControlFlow<hir.TyKind>();

  constructor(public span: Span) {
    super();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2095 visit_stmt
  override visit_stmt(s: hir.Stmt): ControlFlowT<hir.TyKind> {
    // Find a local statement where the initializer has
    // the same span as the error and the type is specified.
    if (s.kind.$ === "Let" && s.kind._0.init !== undefined && s.kind._0.ty !== undefined && s.kind._0.init.span === this.span) {
      const array_ty = s.kind._0.ty;
      return ControlFlow.Break(array_ty.peel_refs().kind);
    } else {
      return ControlFlow.CONTINUE;
    }
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2135 check_on_type_error_attribute
TypeErrCtxt.prototype.check_on_type_error_attribute = function (this: TypeErrCtxt, expected_ty: Ty, found_ty: Ty): string[] {
  const seen = new Set<string>();
  const unique_notes: string[] = [];

  // Check found type for attribute
  const fk = found_ty.kind();
  if (fk.$ === "Adt") {
    const item_def = fk._0;
    const args = fk._1;
    const directive = find_on_type_error(this.tcx, item_def.did());
    if (directive !== undefined && directive._0 !== undefined) {
      const notes = this.format_on_type_error_notes(directive._0, args, item_def, expected_ty, found_ty);

      for (const note of notes) {
        if (!seen.has(note)) {
          seen.add(note);
          unique_notes.push(note);
        }
      }
    }
  }

  // Check expected type for attribute
  const ek = expected_ty.kind();
  if (ek.$ === "Adt") {
    const item_def = ek._0;
    const args = ek._1;
    const directive = find_on_type_error(this.tcx, item_def.did());
    if (directive !== undefined && directive._0 !== undefined) {
      const notes = this.format_on_type_error_notes(directive._0, args, item_def, expected_ty, found_ty);

      for (const note of notes) {
        if (!seen.has(note)) {
          seen.add(note);
          unique_notes.push(note);
        }
      }
    }
  }

  return unique_notes;
};

/** `find_attr!(self.tcx, did, OnTypeError { directive, .. } => directive)`: `Option<Option<&Directive>>` (PORT: the outer
 *  `Some` is `{ $: "Some" }`: the first `OnTypeError` attribute wins even when its directive is `None`). */
function find_on_type_error(tcx: TyCtxt, did: DefId): { $: "Some"; _0: Directive | undefined } | undefined {
  return find_attr(HasAttrs_DefId.get_attrs(did, tcx), (k) => (k.$ === "OnTypeError" ? { $: "Some" as const, _0: k.directive } : undefined));
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2188 format_on_type_error_notes
TypeErrCtxt.prototype.format_on_type_error_notes = function (
  this: TypeErrCtxt,
  directive: Directive,
  args: GenericArgs,
  item_def: AdtDef,
  expected_ty: Ty,
  found_ty: Ty,
): string[] {
  const item_name = display_Symbol(this.tcx.item_name(item_def.did()));
  const generic_args: [Symbol, string][] = (this.tcx.generics_of(item_def.did()) as Generics).own_params.map((param): [Symbol, string] => [param.name, display_GenericArg(args[param.index]!)]);

  const format_args: FormatArgs = {
    this: item_name,
    this_resolved: "",
    this_path: "",
    found: display_Ty(found_ty),
    expected: display_Ty(expected_ty),
    unresolved: "",
    item_context: "",
    generic_args,
  };
  const { notes } = directive.eval(undefined, format_args);

  return notes;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2217 report_and_explain_type_error
TypeErrCtxt.prototype.report_and_explain_type_error = function (this: TypeErrCtxt, trace: TypeTrace, param_env: ParamEnv, terr: TypeError): Diag {
  // debug!("report_and_explain_type_error(trace={:?}, terr={:?})", trace, terr);

  const span = trace.cause.span;
  const path: MutRef<PathBuf | undefined> = { value: undefined };

  this.simplify_pin_macro_arg_ty_mismatch(trace);

  // Check for on_type_error attribute
  const tys = ValuePairs.ty(trace.values);
  const on_type_error_notes = tys !== undefined ? this.check_on_type_error_attribute(tys[0], tys[1]) : [];

  const failure_code = trace.cause.as_failure_code_diag(terr, span, this.type_error_additional_suggestions(trace, terr, path));
  const diag = this.dcx().create_err(crate_().diagnostics.ObligationCauseFailureCode_diagnostic(failure_code));
  diag.long_ty_path().value = path.value;

  // Add custom notes
  for (const note of on_type_error_notes) {
    diag.note(note);
  }

  this.note_type_err(diag, trace.cause, undefined, param_env.and(trace.values), terr, false, undefined);
  return diag;
};

/// If the `pin!()` macro gets a wrong argument type, don't show its internals
/// in user-facing diagnostics.
/// See the `ui/pin/dont-deref-coerce-pinned-value` test.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2265 simplify_pin_macro_arg_ty_mismatch
TypeErrCtxt.prototype.simplify_pin_macro_arg_ty_mismatch = function (this: TypeErrCtxt, trace: TypeTrace): void {
  // Check whether `expected_ty` and `found_ty` are both `&mut PinMacroHelper<....>`,
  // in which case we peel off the wrapping.
  const tys = ValuePairs.ty(trace.values);
  if (tys === undefined) return;
  const [expected_ty, found_ty] = tys;
  const ek = expected_ty.kind();
  if (!(ek.$ === "Ref" && ek._2 === "Mut")) return;
  const eik = ek._1.kind();
  if (!(eik.$ === "Adt")) return;
  const expected_adt = eik._0;
  const expected_generics = eik._1;
  if (!this.tcx.is_diagnostic_item(sym.PinMacroHelper, expected_adt.did())) return;
  const fk = found_ty.kind();
  if (!(fk.$ === "Ref" && fk._2 === "Mut")) return;
  const fik = fk._1.kind();
  if (!(fik.$ === "Adt")) return;
  const found_adt = fik._0;
  const found_generics = fik._1;
  if (!this.tcx.is_diagnostic_item(sym.PinMacroHelper, found_adt.did())) return;

  if (expected_generics.length !== 1) return panic("PinMacroHelper should only have one generic");
  const expected_generic = expected_generics[0]!;
  if (found_generics.length !== 1) return panic("PinMacroHelper should only have one generic");
  const found_generic = found_generics[0]!;
  const expected_ty_inner = unwrap(GenericArg.as_type(expected_generic), "PinMacroHelper should have a generic type");
  const found_ty_inner = unwrap(GenericArg.as_type(found_generic), "PinMacroHelper should have a generic type");
  trace.values = { $: "Terms", _0: ExpectedFound.new(Term.from_Ty(expected_ty_inner), Term.from_Ty(found_ty_inner)) };
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2295 suggest_wrap_to_build_a_tuple
TypeErrCtxt.prototype.suggest_wrap_to_build_a_tuple = function (this: TypeErrCtxt, span: Span, found: Ty, expected_fields: List<Ty>): TypeErrorAdditionalDiags | undefined {
  if (expected_fields.length !== 1) return undefined;
  const expected_tup_elem = expected_fields[0]!;

  if (!this.same_type_modulo_infer(expected_tup_elem, found, relate_Ty)) {
    return undefined;
  }

  const r = this.tcx.sess.source_map().span_to_snippet(span);
  if (r.$ === "Err") return undefined;
  const code = r._0.toString();

  let sugg: TypeErrorAdditionalDiags;
  if (code.startsWith("(") && code.endsWith(")")) {
    const before_close = BytePos.sub(SpanC.hi(span), BytePos.from_u32(1));
    sugg = { $: "TupleOnlyComma", span: SpanC.shrink_to_hi(SpanC.with_hi(span, before_close)) };
  } else {
    sugg = { $: "TupleAlsoParentheses", span_low: SpanC.shrink_to_lo(span), span_high: SpanC.shrink_to_hi(span) };
  }
  return sugg;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2323 values_str
TypeErrCtxt.prototype.values_str = function (
  this: TypeErrCtxt,
  values: ValuePairs,
  cause: ObligationCause,
  long_ty_path: MutRef<PathBuf | undefined>,
): [DiagStyledString, DiagStyledString] | undefined {
  switch (values.$) {
    case "Regions":
      return this.expected_found_str(values._0, display_Region, fold_Region);
    case "Terms":
      return this.expected_found_str_term(values._0, long_ty_path);
    case "Aliases":
      return this.expected_found_str(values._0, display_AliasTerm, fold_AliasTerm);
    case "ExistentialTraitRef":
      return this.expected_found_str(
        values._0 as ExpectedFound<Binder<ExistentialTraitRef>>,
        (t) => display_Binder_with(t, print_ExistentialTraitRef, fold_ExistentialTraitRef),
        fold_Binder(fold_ExistentialTraitRef),
      );
    case "ExistentialProjection":
      return this.expected_found_str(
        values._0 as ExpectedFound<Binder<ExistentialProjection>>,
        (t) => display_Binder_with(t, print_ExistentialProjection, fold_ExistentialProjection),
        fold_Binder(fold_ExistentialProjection),
      );
    case "TraitRefs": {
      const exp_found = values._0;
      const pretty_exp_found: ExpectedFound<TraitRefPrintSugared> = {
        expected: TraitRef_print_trait_sugared(exp_found.expected),
        found: TraitRef_print_trait_sugared(exp_found.found),
      };
      const ret = this.expected_found_str(pretty_exp_found, display_TraitRefPrintSugared, fold_TraitRefPrintSugared);
      if (ret !== undefined && DiagStyledString_eq(ret[0], ret[1])) {
        return this.expected_found_str(exp_found, display_TraitRef, fold_TraitRef);
      } else {
        return ret;
      }
    }
    case "PolySigs": {
      const exp_found = this.deeply_resolve_ignoring_regions(values._0 as ExpectedFound<PolyFnSig>, fold_ExpectedFound(fold_PolyFnSig));
      if (TypeVisitableExt.references_error(exp_found, fold_ExpectedFound(fold_PolyFnSig))) {
        return undefined;
      }
      const code = cause.code_();
      let fn_def1: [DefId, readonly GenericArg[] | undefined] | undefined;
      let fn_def2: [DefId, readonly GenericArg[] | undefined] | undefined;
      if (code.$ === "CompareImplItem") {
        [fn_def1, fn_def2] = [
          [code.trait_item_def_id, undefined],
          [LocalDefId.to_def_id(code.impl_item_def_id), undefined],
        ];
      } else {
        [fn_def1, fn_def2] = [undefined, undefined];
      }

      return this.cmp_fn_sig(exp_found.expected, fn_def1, exp_found.found, fn_def2);
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2368 expected_found_str_term
TypeErrCtxt.prototype.expected_found_str_term = function (
  this: TypeErrCtxt,
  exp_found_: ExpectedFound<Term>,
  long_ty_path: MutRef<PathBuf | undefined>,
): [DiagStyledString, DiagStyledString] | undefined {
  const exp_found = this.deeply_resolve_ignoring_regions(exp_found_, fold_ExpectedFound(fold_Term));
  if (TypeVisitableExt.references_error(exp_found, fold_ExpectedFound(fold_Term))) {
    return undefined;
  }

  const ek = Term.kind(exp_found.expected);
  const fk = Term.kind(exp_found.found);
  if (ek.$ === "Ty" && fk.$ === "Ty") {
    const expected = ek._0;
    const found = fk._0;
    let [exp, fnd] = this.cmp(expected, found);
    // Use the terminal width as the basis to determine when to compress the printed
    // out type, but give ourselves some leeway to avoid ending up creating a file for
    // a type that is somewhat shorter than the path we'd write to.
    const len = this.tcx.sess.diagnostic_width();
    const exp_s = exp.content();
    const fnd_s = fnd.content();
    if (!this.tcx.sess.opts.verbose && this.tcx.sess.opts.unstable_opts.write_long_types_to_disk) {
      // We aren't explicitly asking for `--verbose` output, and we are storing long
      // types to disk, so we try to shorten the output.
      if (utf8_len(exp_s) > len && utf8_len(fnd_s) > len) {
        const exp_short = this.tcx.short_string(expected, long_ty_path, print_Ty);
        const fnd_short = this.tcx.short_string(found, long_ty_path, print_Ty);
        // We use a crude shortening on the highlighted strings themselves. This
        // doesn't ensure that the two strings will look different, or that the
        // output is very readable, but at least keeps the highlighting around.
        exp.shorten();
        fnd.shorten();
        if (exp_short !== fnd_short) {
          // The short strings aren't the same visually, so it might make sense
          // to use them instead.
          if (exp._0.length <= 1) {
            // The entire type is highlighted, let's use the short string
            // instead, which is slightly better.
            exp = DiagStyledString.highlighted(exp_short);
          }
          if (fnd._0.length <= 1) {
            // The entire type is highlighted, let's use the short string
            // instead, which is slightly better.
            fnd = DiagStyledString.highlighted(fnd_short);
          }
        }
      } else {
        if (utf8_len(exp_s) > len) {
          exp.shorten();
          const exp_short = this.tcx.short_string(expected, long_ty_path, print_Ty);
          if (exp._0.length <= 1) {
            exp = DiagStyledString.highlighted(exp_short);
          }
        }
        if (utf8_len(fnd_s) > len) {
          fnd.shorten();
          const fnd_short = this.tcx.short_string(found, long_ty_path, print_Ty);
          if (fnd._0.length <= 1) {
            fnd = DiagStyledString.highlighted(fnd_short);
          }
        }
      }
    }
    return [exp, fnd];
  } else {
    return [DiagStyledString.highlighted(display_Term(exp_found.expected)), DiagStyledString.highlighted(display_Term(exp_found.found))];
  }
};

/// Returns a string of the form "expected `{}`, found `{}`".
// PORT: `T: fmt::Display + TypeFoldable` are `display_T` and `d_T` (decls.ts).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2441 expected_found_str
TypeErrCtxt.prototype.expected_found_str = function <T>(
  this: TypeErrCtxt,
  exp_found_: ExpectedFound<T>,
  display_T: (t: T) => string,
  d_T: TypeFoldable<T>,
): [DiagStyledString, DiagStyledString] | undefined {
  const exp_found = this.deeply_resolve_ignoring_regions(exp_found_, fold_ExpectedFound(d_T));
  if (TypeVisitableExt.references_error(exp_found, fold_ExpectedFound(d_T))) {
    return undefined;
  }

  return [DiagStyledString.highlighted(display_T(exp_found.expected)), DiagStyledString.highlighted(display_T(exp_found.found))];
};

/// Determine whether an error associated with the given span and definition
/// should be treated as being caused by the implicit `From` conversion
/// within `?` desugaring.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2459 is_try_conversion
TypeErrCtxt.prototype.is_try_conversion = function (this: TypeErrCtxt, span: Span, trait_def_id: DefId): boolean {
  return SpanC.is_desugaring(span, DesugaringKind.QuestionMark) && this.tcx.is_diagnostic_item(sym.From, trait_def_id);
};

/// Structurally compares two types, modulo any inference variables.
///
/// Returns `true` if two types are equal, or if one type is an inference variable compatible
/// with the other type. A TyVar inference type is compatible with any type, and an IntVar or
/// FloatVar inference type are compatible with themselves or their concrete types (Int and
/// Float types, respectively). When comparing two ADTs, these rules apply recursively.
// PORT: `T: Relate` is `d_T` (decls.ts).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2470 same_type_modulo_infer
TypeErrCtxt.prototype.same_type_modulo_infer = function <T>(this: TypeErrCtxt, a_: T, b_: T, d_T: Relate<T>): boolean {
  const [a, b] = this.deeply_resolve_ignoring_regions<[T, T]>([a_, b_], fold_tuple2(d_T, d_T));
  return new SameTypeModuloInfer(this.infcx).relate(a, b, d_T).$ === "Ok";
};

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2476 SameTypeModuloInfer
export class SameTypeModuloInfer implements TypeRelation {
  constructor(public _0: InferCtxt) {}

  // impl<'tcx> TypeRelation<TyCtxt<'tcx>> for SameTypeModuloInfer<'_, 'tcx>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2479 cx
  cx(): TyCtxt {
    return this._0.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2483 relate_ty_args
  relate_ty_args(a_ty: Ty, _1: Ty, _2: DefId, a_args: GenericArgs, b_args: GenericArgs, _5: (args: GenericArgs) => Ty): RelateResult<Ty> {
    const r = relate_args_invariantly(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2496 relate_with_variance
  relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    return this.relate(a, b, d);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2506 tys
  tys(a: Ty, b: Ty): RelateResult<Ty> {
    const ak = a.kind();
    const bk = b.kind();
    const a_infer = ak.$ === "Infer" ? ak._0 : undefined;
    const b_infer = bk.$ === "Infer" ? bk._0 : undefined;
    if (
      ((ak.$ === "Int" || ak.$ === "Uint") && b_infer?.$ === "IntVar") ||
      (a_infer?.$ === "IntVar" && (bk.$ === "Int" || bk.$ === "Uint" || b_infer?.$ === "IntVar")) ||
      (ak.$ === "Float" && b_infer?.$ === "FloatVar") ||
      (a_infer?.$ === "FloatVar" && (bk.$ === "Float" || b_infer?.$ === "FloatVar")) ||
      a_infer?.$ === "TyVar" ||
      b_infer?.$ === "TyVar"
    ) {
      return Ok(a);
    } else if (ak.$ === "Infer" || bk.$ === "Infer") {
      return Err(TypeError.Mismatch);
    } else {
      return structurally_relate_tys(this, a, b);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2525 regions
  regions(a: Region, b: Region): RelateResult<Region> {
    if ((a.is_var() && b.is_free()) || (b.is_var() && a.is_free()) || (a.is_var() && b.is_var()) || a === b) {
      return Ok(a);
    } else {
      return Err(TypeError.Mismatch);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2541 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    const r = this.relate(Binder.skip_binder(a), Binder.skip_binder(b), d);
    if (r.$ === "Err") return r;
    return Ok(Binder.rebind(a, r._0));
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2552 consts
  consts(a: Const, _b: Const): RelateResult<Const> {
    // FIXME(compiler-errors): This could at least do some first-order
    // relation
    return Ok(a);
  }

  /** (provided) `TypeRelation::relate` */
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }
}

// `#[extension(pub trait ObligationCauseExt<'tcx>)] impl<'tcx> ObligationCause<'tcx>` (declared in the crate decls.ts on
// rustc_middle's `ObligationCause`): the methods are on `ObligationCause.prototype`. Ported by lane errctxt-contract
// (the first stop of `check_function_signature` errors).

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2572 as_failure_code
ObligationCause.prototype.as_failure_code = function (this: ObligationCause, terr: TypeError): FailureCode {
  const code = this.code_();
  switch (code.$) {
    case "IfExpressionWithNoElse":
      return "Error0317";
    case "MainFunctionType":
      return "Error0580";
    case "CompareImplItem":
    case "MatchExpressionArm":
    case "IfExpression":
    case "LetElse":
    case "LangFunctionType":
    case "IntrinsicType":
    case "MethodReceiver":
      return "Error0308";

    // In the case where we have no more specific thing to
    // say, also take a look at the error code, maybe we can
    // tailor to that.
    default:
      if (terr.$ === "CyclicTy" && (terr._0.is_closure() || terr._0.is_coroutine() || terr._0.is_coroutine_closure())) {
        return "Error0644";
      } else if (terr.$ === "IntrinsicCast" || terr.$ === "ForceInlineCast") {
        return "Error0308";
      } else {
        return "Error0308";
      }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2599 as_failure_code_diag
ObligationCause.prototype.as_failure_code_diag = function (
  this: ObligationCause,
  terr: TypeError,
  span: Span,
  subdiags: TypeErrorAdditionalDiags[],
): ObligationCauseFailureCode {
  const code = this.code_();
  if (code.$ === "CompareImplItem" && code.kind.$ === "Fn") {
    return { $: "MethodCompat", span, subdiags };
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Type") {
    return { $: "TypeCompat", span, subdiags };
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Const") {
    return { $: "ConstCompat", span, subdiags };
  } else if (code.$ === "BlockTailExpression" && code._1.$ === "TryDesugar") {
    return { $: "TryCompat", span, subdiags };
  } else if (code.$ === "MatchExpressionArm") {
    const source = code._0.source;
    switch (source.$) {
      case "TryDesugar":
        return { $: "TryCompat", span, subdiags };
      default:
        return { $: "MatchCompat", span, subdiags };
    }
  } else if (code.$ === "IfExpression") {
    return { $: "IfElseDifferent", span, subdiags };
  } else if (code.$ === "IfExpressionWithNoElse") {
    return { $: "NoElse", span };
  } else if (code.$ === "LetElse") {
    return { $: "NoDiverge", span, subdiags };
  } else if (code.$ === "MainFunctionType") {
    return { $: "FnMainCorrectType", span };
  } else if (code.$ === "LangFunctionType") {
    const lang_item_name = code._0;
    return { $: "FnLangCorrectType", span, subdiags, lang_item_name };
  } else if (code.$ === "IntrinsicType") {
    return { $: "IntrinsicCorrectType", span, subdiags };
  } else if (code.$ === "MethodReceiver") {
    return { $: "MethodCorrectType", span, subdiags };
  } else {
    // In the case where we have no more specific thing to
    // say, also take a look at the error code, maybe we can
    // tailor to that.
    if (terr.$ === "CyclicTy" && (terr._0.is_closure() || terr._0.is_coroutine() || terr._0.is_coroutine_closure())) {
      return { $: "ClosureSelfref", span };
    } else if (terr.$ === "ForceInlineCast") {
      return { $: "CantCoerceForceInline", span, subdiags };
    } else if (terr.$ === "IntrinsicCast") {
      return { $: "CantCoerceIntrinsic", span, subdiags };
    } else {
      return { $: "Generic", span, subdiags };
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2668 as_requirement_str
ObligationCause.prototype.as_requirement_str = function (this: ObligationCause): string {
  const code = this.code_();
  if (code.$ === "CompareImplItem" && code.kind.$ === "Fn") {
    return "method type is compatible with trait";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Type") {
    return "associated type is compatible with trait";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Const") {
    return "const is compatible with trait";
  } else if (code.$ === "MainFunctionType") {
    return "`main` function has the correct type";
  } else if (code.$ === "LangFunctionType") {
    return "lang item function has the correct type";
  } else if (code.$ === "IntrinsicType") {
    return "intrinsic has the correct type";
  } else if (code.$ === "MethodReceiver") {
    return "method receiver has the correct type";
  } else {
    return "types are compatible";
  }
};

/// Newtype to allow implementing IntoDiagArg
// (the struct is generated: mod.gen.ts `ObligationCauseAsDiagArg`)
// impl IntoDiagArg for ObligationCauseAsDiagArg<'_>
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2692 into_diag_arg
export function ObligationCauseAsDiagArg_into_diag_arg(self: { _0: ObligationCause }, _: MutRef<PathBuf | undefined>): DiagArgValue {
  const code = self._0.code_();
  let kind: string;
  if (code.$ === "CompareImplItem" && code.kind.$ === "Fn") {
    kind = "method_compat";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Type") {
    kind = "type_compat";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Const") {
    kind = "const_compat";
  } else if (code.$ === "MainFunctionType") {
    kind = "fn_main_correct_type";
  } else if (code.$ === "LangFunctionType") {
    kind = "fn_lang_correct_type";
  } else if (code.$ === "IntrinsicType") {
    kind = "intrinsic_correct_type";
  } else if (code.$ === "MethodReceiver") {
    kind = "method_correct_type";
  } else {
    kind = "other";
  }
  return { $: "Str", _0: kind };
}

// impl fmt::Display for TyCategory
// PORT: `alternate` is the formatter's `{:#}` flag (forwarded to `CoroutineKind`'s Display).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2726 fmt
export function display_TyCategory(self: TyCategory, alternate = false): string {
  switch (self.$) {
    case "Closure":
      return "closure";
    case "Opaque":
      return "opaque type";
    case "OpaqueFuture":
      return "future";
    case "Coroutine":
      return display_CoroutineKind(self._0, alternate);
    case "Foreign":
      return "foreign type";
  }
}

// impl TyCategory
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2738 from_ty
export function TyCategory_from_ty(tcx: TyCtxt, ty: Ty): [TyCategory, DefId] | undefined {
  const k = ty.kind();
  switch (k.$) {
    case "Closure":
      return [TyCategory.Closure, k._0];
    case "Alias":
      if (k._1.kind.$ === "Opaque") {
        const def_id = k._1.kind.def_id;
        const kind = tcx.ty_is_opaque_future(ty) ? TyCategory.OpaqueFuture : TyCategory.Opaque;
        return [kind, def_id];
      }
      return undefined;
    case "Coroutine": {
      const def_id = k._0;
      return [{ $: "Coroutine", _0: unwrap(tcx.coroutine_kind(def_id)) as CoroutineKind }, def_id];
    }
    case "Foreign":
      return [TyCategory.Foreign, k._0];
    default:
      return undefined;
  }
}
