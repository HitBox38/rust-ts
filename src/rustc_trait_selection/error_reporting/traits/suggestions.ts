// Port of compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs (lanes errrep-sugg-a, errrep-sugg-b, errrep-sugg-c; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/suggestions.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// Ported here by lane errctxt-contract (small visitors other crates use: rustc_hir_analysis check reads `ReturnsVisitor`):
// the hand classes `SelfVisitor`, `ReturnsVisitor`, `AwaitsVisitor` (intravisit `Visitor`s) with their impls.
export * from "./suggestions.gen.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { debug_Ty as debug_hir_Ty } from "../../../rustc_hir/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { debug_Symbol, display_Ident, display_Symbol, Ident, kw, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_vec } from "../../../std/fmt.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { assert, unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_traits_suggestions } from "../../decls.ts";
// ---- imports of lane errrep-sugg-c ----
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { type Stability, StabilityLevel } from "../../../rustc_attr_ir/stability.ts";
import type { MultiSpan as MultiSpanT } from "../../../rustc_error_messages/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import type { Diag } from "../../../rustc_errors/lib.ts";
import type { DefKind } from "../../../rustc_hir/def.ts";
import { HirId_eq } from "../../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.ts";
import { ToTrace_GenericArg, ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, ObligationCause, ObligationCauseCode, type ImplDerivedCause } from "../../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../../rustc_middle/traits/select.ts";
import type { AdtDef } from "../../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type GenericParamDef } from "../../../rustc_middle/ty/generics.ts";
import { type Clauses, RawList } from "../../../rustc_middle/ty/list.ts";
import { Asyncness, Term, Ty } from "../../../rustc_middle/ty/mod.ts";
import {
  type Clause,
  type Predicate,
  Predicate_upcast_from_Binder_PredicateKind,
  Predicate_upcast_from_PolyTraitClause,
  Predicate_upcast_from_PolyTraitRef,
  Predicate_upcast_from_TraitRef,
} from "../../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_Ty,
  PolyTraitClause_print_modifiers_and_trait_path,
  print_Binder,
  print_TraitClause,
  print_TraitClausePrintModifiersAndPath,
  type TraitClausePrintModifiersAndPath,
  with_forced_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Clauses, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { type DefId, DefId_eq, type LocalDefId, LocalDefId as LocalDefIdC } from "../../../rustc_span/def_id.ts";
import { type BytePos, DUMMY_SP, type ErrorGuaranteed, type PathBuf, Span } from "../../../rustc_span/lib.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT, PolyProjectionClause, PolyTraitClause, PredicateKind, TraitClause as TraitClauseT, TraitRef as TraitRefT } from "../../../rustc_type_ir/decls.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { display_TraitRef } from "../../../rustc_type_ir/ir_print.ts";
import {
  as_interner,
  fold_with_ProjectionClause,
  fold_with_TraitClause,
  PolyTraitClause as PolyTraitClauseC,
  ProjectionClause,
  TraitClause,
  TraitRef,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitClause,
  visit_with_ProjectionClause,
  visit_with_TraitClause,
} from "../../../rustc_type_ir/predicate.ts";
import { d_PredicateKind } from "../../../rustc_type_ir/relate/combine.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTermKind, AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { AliasTy, debug_TyKind, type FnSig, FnSig as FnSigC, FnSigTys, PolyFnSig, type TyKind } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { format_debug, PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import type { Result } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { to_uppercase } from "../../../std/char.ts";
import type { ImplCandidate } from "./mod.gen.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_FnSigTys, try_fold_with_FnSigTys, visit_with_FnSigTys, type FnSigTys as FnSigTysT } from "../../../rustc_type_ir/ty_kind.ts";
import { Ok } from "../../../std/result.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6875 SelfVisitor
// PORT: hand-written with its derived Debug (types.sets.json `skip`); `paths: Vec<&hir::Ty> = Vec::new()` (default field
// value) is the constructor's default.
export class SelfVisitor extends hir.intravisit.Visitor {
  constructor(
    public paths: hir.Ty[] = [],
    public name: Symbol | undefined,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for SelfVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6881 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    let path: hir.QPath, inner_ty: hir.Ty, segment: hir.PathSegment, inner_path_: hir.QPath, inner_path: hir.Path;
    if (
      ty.kind.$ === "Path" &&
      ((path = ty.kind._0), true) &&
      path.$ === "TypeRelative" &&
      ((inner_ty = path._0), (segment = path._1), true) &&
      (segment.ident.name === this.name || this.name === undefined) &&
      inner_ty.kind.$ === "Path" &&
      ((inner_path_ = inner_ty.kind._0), true) &&
      inner_path_.$ === "Resolved" &&
      inner_path_._0 === undefined &&
      ((inner_path = inner_path_._1), true) &&
      inner_path.res.$ === "SelfTyAlias"
    ) {
      this.paths.push(ty.as_unambig_ty());
    }
    hir.intravisit.walk_ty(this, ty);
    return undefined;
  }
}

/** `#[derive(Debug)]` on `SelfVisitor`. */
export const debug_SelfVisitor: Debug<SelfVisitor> = (v, f) =>
  debug_struct(f, "SelfVisitor", [
    ["paths", debug_vec(v.paths, f, (x, f) => debug_hir_Ty(x, f, (_x, _f) => "()"))],
    ["name", debug_option(v.name, f, debug_Symbol)],
  ]);

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6898 ReturnsVisitor
/// Collect all the returned expressions within the input expression.
/// Used to point at the return spans when we want to suggest some change to them.
// PORT: `#[derive(Default)]` is the constructor's defaults (`ReturnsVisitor.default()` = `new ReturnsVisitor()`).
export class ReturnsVisitor extends hir.intravisit.Visitor {
  constructor(
    public returns: hir.Expr[] = [],
    public in_block_tail: boolean = false,
  ) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): ReturnsVisitor {
    return new ReturnsVisitor();
  }

  // impl<'v> Visitor<'v> for ReturnsVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6904 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const kind = ex.kind;
    if (kind.$ === "Ret" && kind._0 !== undefined) {
      const ex = kind._0;
      this.returns.push(ex);
    } else if (kind.$ === "Block" && this.in_block_tail) {
      const block = kind._0;
      this.in_block_tail = false;
      for (const stmt of block.stmts) {
        hir.intravisit.walk_stmt(this, stmt);
      }
      this.in_block_tail = true;
      if (block.expr !== undefined) {
        const expr = block.expr;
        this.visit_expr(expr);
      }
    } else if (kind.$ === "If" && this.in_block_tail) {
      const then = kind._1;
      const else_opt = kind._2;
      this.visit_expr(then);
      if (else_opt !== undefined) {
        const el = else_opt;
        this.visit_expr(el);
      }
    } else if (kind.$ === "Match" && this.in_block_tail) {
      const arms = kind._1;
      for (const arm of arms) {
        this.visit_expr(arm.body);
      }
    } else if (!this.in_block_tail) {
      hir.intravisit.walk_expr(this, ex);
    } else {
      this.returns.push(ex);
    }
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6940 visit_body
  override visit_body(body: hir.Body): undefined {
    assert(!this.in_block_tail, "assertion failed: !self.in_block_tail");
    this.in_block_tail = true;
    hir.intravisit.walk_body(this, body);
    return undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6949 AwaitsVisitor
/// Collect all the awaited expressions within the input expression.
// PORT: `#[derive(Default)]` is the constructor's default.
export class AwaitsVisitor extends hir.intravisit.Visitor {
  constructor(public awaits: HirId[] = []) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): AwaitsVisitor {
    return new AwaitsVisitor();
  }

  // impl<'v> Visitor<'v> for AwaitsVisitor

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6954 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Yield" && ex.kind._1.$ === "Await" && ex.kind._1.expr !== undefined) {
      const id = ex.kind._1.expr;
      this.awaits.push(id);
    }
    return hir.intravisit.walk_expr(this, ex);
  }
}

// error_reporting/traits/suggestions.rs:113 (stub; lane errrep-sugg-a)
export const predicate_constraint = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::predicate_constraint")) as Fns_error_reporting_traits_suggestions["predicate_constraint"];
// error_reporting/traits/suggestions.rs:123 (stub; lane errrep-sugg-a)
export const suggest_restriction = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::suggest_restriction")) as Fns_error_reporting_traits_suggestions["suggest_restriction"];

// ==== lane errrep-sugg-a: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "note_field_shadowed_by_private_candidate_in_cause", "note_field_shadowed_by_private_candidate", "suggest_restricting_param_bound", "suggest_dereferences", "get_closure_name", "suggest_fn_call", "suggest_cast_to_fn_pointer", "check_for_binding_assigned_block_without_tail_expression", "suggest_add_clone_to_arg", "extract_callable_info", "where_clause_expr_matches_failed_self_ty", "suggest_add_reference_to_arg", "suggest_borrowing_for_object_cast", "peel_expr_refs", "suggest_remove_reference", "suggest_remove_ref_from_param", "suggest_remove_await",
]);

// ==== lane errrep-sugg-b: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_change_mut", "suggest_semicolon_removal", "removable_trailing_semicolon", "emit_semicolon_removal_suggestion", "suggest_semicolon_removal_in_closure_arg", "suggest_borrow_for_unsized_closure_return", "return_type_span", "suggest_impl_trait", "report_closure_arg_mismatch", "note_conflicting_fn_args", "note_conflicting_closure_bounds", "suggest_fully_qualified_path", "maybe_note_obligation_cause_for_async_await", "note_obligation_cause_for_async_await", "note_closure_capture", "note_obligation_cause_code", "note_obligation_cause_code_inner",
]);

// =====================================================================================================================
// lane errrep-sugg-c: error_reporting/traits/suggestions.rs:5018..7379 (`impl TypeErrCtxt` from `suggest_await_before_try`
// to `is_truly_imperfect_derive`, then the free fns and helper types after the impl; `SelfVisitor`, `ReturnsVisitor` and
// `AwaitsVisitor` are above, ported by errctxt-contract).
// =====================================================================================================================

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (continued)

// #[instrument(level = "debug", skip(self, err), fields(trait_pred.self_ty = ?trait_pred.self_ty()))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5022 suggest_await_before_try
TypeErrCtxt.prototype.suggest_await_before_try = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClause,
  span: Span,
): void {
  const future_trait = this.tcx.require_lang_item("Future", span);

  const self_ty = this.deeply_resolve_ignoring_regions(PolyTraitClauseC.self_ty(trait_pred), d_Binder_Ty());
  const impls_future = this.type_implements_trait(
    future_trait,
    [this.tcx.instantiate_bound_regions_with_erased(self_ty, fold_Ty)],
    obligation.param_env,
  );
  if (!EvaluationResult.must_apply_modulo_regions(impls_future)) {
    return;
  }

  const item_def_id = this.tcx.associated_item_def_ids(future_trait)[0];
  // `<T as Future>::Output`
  const projection_ty_ = Binder.map_bound(trait_pred, (trait_pred) =>
    Ty.new_projection(
      this.tcx,
      "No",
      item_def_id,
      // Future::Output has no args
      [TraitClause.self_ty(trait_pred)],
    ),
  );
  const projection_ty = this.at(obligation.cause, obligation.param_env).normalize(Unnormalized.new_wip(projection_ty_), d_Binder_Ty()).value;

  // debug!(normalized_projection_type = ?self.deeply_resolve_ignoring_regions(projection_ty));
  const try_obligation = this.mk_trait_obligation_with_new_self_ty(
    obligation.param_env,
    Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, Binder.skip_binder(projection_ty)]),
  );
  // debug!(try_trait_obligation = ?try_obligation);
  let snippet: Result<Str, unknown>;
  if (
    this.predicate_may_hold(try_obligation) &&
    (snippet = this.tcx.sess.source_map().span_to_snippet(span)).$ === "Ok" &&
    snippet._0.toString().endsWith("?")
  ) {
    const k = this.tcx.coroutine_kind(obligation.cause.body_def_id) as hir.CoroutineKind | undefined;
    if (k !== undefined && k.$ === "Desugared" && k._0 === "Async") {
      err.span_suggestion_verbose(
        Span.shrink_to_hi(Span.with_hi(span, (Span.hi(span) - 1) as BytePos)),
        "consider `await`ing on the `Future`",
        ".await",
        "MaybeIncorrect",
      );
    } else {
      const span_: MultiSpan = MultiSpan.from_Span(Span.with_lo(span, (Span.hi(span) - 1) as BytePos));
      span_.push_span_label(this.tcx.def_span(obligation.cause.body_def_id), "this is not `async`");
      err.span_note(
        span_,
        "this implements `Future` and its output type supports `?`, but the future cannot be awaited in a synchronous function",
      );
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5093 suggest_floating_point_literal
TypeErrCtxt.prototype.suggest_floating_point_literal = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClause,
): void {
  const code = obligation.cause.code_();
  let rhs_span: Span;
  if (code.$ === "BinOp" && code.rhs_is_lit) {
    rhs_span = code.rhs_span;
  } else {
    return;
  }
  let k: TyKind;
  if (
    TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind().$ === "Float" &&
    (k = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Infer" &&
    k._0.$ === "IntVar"
  ) {
    err.span_suggestion_verbose(
      Span.shrink_to_hi(rhs_span),
      "consider using a floating-point literal by writing it with `.0`",
      ".0",
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5116 can_suggest_derive
TypeErrCtxt.prototype.can_suggest_derive = function (this: TypeErrCtxt, obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean {
  if (PolyTraitClauseC.polarity(trait_pred) === "Negative") {
    return false;
  }
  const diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitClauseC.def_id(trait_pred));
  if (diagnostic_name === undefined) {
    return false;
  }
  const self_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  let adt: AdtDef, args: GenericArgs;
  if (self_kind.$ === "Adt" && self_kind._0.did().is_local()) {
    [adt, args] = [self_kind._0, self_kind._1];
  } else {
    return false;
  }
  if (!Span.can_be_used_for_suggestions(this.tcx.def_span(adt.did()))) {
    return false;
  }
  let is_derivable_trait: boolean;
  if (diagnostic_name === sym.Copy || diagnostic_name === sym.Clone) {
    is_derivable_trait = true;
  } else if (adt.is_union()) {
    is_derivable_trait = false;
  } else if (diagnostic_name === sym.PartialEq || diagnostic_name === sym.PartialOrd) {
    const rhs_ty = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1);
    is_derivable_trait = TraitClause.self_ty(Binder.skip_binder(trait_pred)) === rhs_ty;
  } else if (
    diagnostic_name === sym.Eq ||
    diagnostic_name === sym.Ord ||
    diagnostic_name === sym.Hash ||
    diagnostic_name === sym.Debug ||
    diagnostic_name === sym.Default
  ) {
    is_derivable_trait = true;
  } else {
    is_derivable_trait = false;
  }
  if (!is_derivable_trait) {
    return false;
  }
  // Ensure all fields impl the trait.
  for (const field of adt.all_fields()) {
    const field_ty: GenericArg = Unnormalized.skip_norm_wip(field.ty(this.tcx, args));
    let trait_args: GenericArg | undefined;
    if (diagnostic_name === sym.PartialEq || diagnostic_name === sym.PartialOrd) {
      trait_args = field_ty;
    } else {
      trait_args = undefined;
    }
    const trait_pred_ = Binder.map_bound_ref(trait_pred, (tr): TraitClause => ({
      ...tr,
      trait_ref: TraitRef.new(as_interner(this.tcx), PolyTraitClauseC.def_id(trait_pred), trait_args === undefined ? [field_ty] : [field_ty, trait_args]),
    }));
    const field_obl = Obligation.new(this.tcx, clone_ObligationCause(obligation.cause), obligation.param_env, trait_pred_, upcast_PolyTraitClause);
    if (!this.predicate_must_hold_modulo_regions(field_obl)) {
      return false;
    }
  }
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5171 suggest_derive
TypeErrCtxt.prototype.suggest_derive = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void {
  const diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitClauseC.def_id(trait_pred));
  if (diagnostic_name === undefined) {
    return;
  }
  const self_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  let adt: AdtDef;
  if (self_kind.$ === "Adt" && self_kind._0.did().is_local()) {
    adt = self_kind._0;
  } else {
    return;
  }
  if (this.can_suggest_derive(obligation, trait_pred)) {
    err.span_suggestion_verbose(
      Span.shrink_to_lo(this.tcx.def_span(adt.did())),
      `consider annotating \`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\` with \`#[derive(${display_Symbol(diagnostic_name)})]\``,
      // FIXME(const_trait_impl) derive_const as suggestion?
      `#[derive(${display_Symbol(diagnostic_name)})]\n`,
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5199 suggest_dereferencing_index
TypeErrCtxt.prototype.suggest_dereferencing_index = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void {
  let inner_kind: TyKind;
  if (
    obligation.cause.code_().$ === "ImplDerived" &&
    this.tcx.is_diagnostic_item(sym.SliceIndex, Binder.skip_binder(trait_pred).trait_ref.def_id) &&
    Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind().$ === "Slice" &&
    (inner_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind()).$ === "Ref" &&
    ((k) => k.$ === "Uint" && k._0 === "Usize")(inner_kind._1.kind())
  ) {
    // If the index is written as `&i`, suggest removing the borrow instead of
    // dereferencing it, i.e. `v[&i]` -> `v[i]` rather than `v[*&i]`.
    const span = obligation.cause.span;
    let body: hir.Body | undefined, expr: hir.Expr | undefined, amp_span: Span | undefined;
    if (
      !Span.from_expansion(span) &&
      (body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id)) !== undefined &&
      (expr = (() => {
        const finder = traits_mod().FindExprBySpan.new(span, this.tcx);
        finder.visit_expr(body.value);
        return finder.result;
      })()) !== undefined &&
      expr.kind.$ === "AddrOf" &&
      expr.kind._0 === "Ref" &&
      expr.kind._1 === "Not" &&
      (amp_span = ((borrowed: hir.Expr, expr: hir.Expr) => {
        const borrowed_span = Span.find_ancestor_inside_same_ctxt(borrowed.span, expr.span);
        return borrowed_span === undefined ? undefined : Span.until(expr.span, borrowed_span);
      })(expr.kind._2, expr)) !== undefined &&
      ((r) => r.$ === "Ok" && r._0.starts_with("&"))(this.tcx.sess.source_map().span_to_snippet(amp_span))
    ) {
      err.span_suggestion_verbose(amp_span, "remove this reference", "", "MachineApplicable");
      return;
    }

    err.span_suggestion_verbose(Span.shrink_to_lo(obligation.cause.span), "dereference this index", "*", "MachineApplicable");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5254 note_function_argument_obligation
TypeErrCtxt.prototype.note_function_argument_obligation = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  arg_hir_id: HirId,
  parent_code: ObligationCauseCode,
  param_env: ParamEnv,
  failed_pred: Predicate,
  call_hir_id: HirId,
): void {
  const tcx = this.tcx;
  const arg_node = tcx.hir_node(arg_hir_id);
  if (arg_node.$ === "Expr" && this.typeck_results !== undefined) {
    const expr = arg_node._0;
    const typeck_results = this.typeck_results;
    let rcvr: hir.Expr, ty: Ty | undefined, failed_pred_: PolyTraitClause | undefined, pred: PolyTraitClause;
    if (
      expr.kind.$ === "MethodCall" &&
      ((rcvr = expr.kind._1), true) &&
      (ty = typeck_results.node_type_opt(rcvr.hir_id)) !== undefined &&
      (failed_pred_ = failed_pred.as_trait_clause()) !== undefined &&
      ((pred = Binder.map_bound(failed_pred_, (pred) => TraitClause.with_replaced_self_ty(pred, as_interner(tcx), ty!))), true) &&
      this.predicate_must_hold_modulo_regions(Obligation.misc(tcx, expr.span, body_def_id, param_env, pred, upcast_PolyTraitClause)) &&
      Span.hi(expr.span) !== Span.hi(rcvr.span)
    ) {
      const ty_ = ty;
      let should_sugg: boolean;
      const call_node = tcx.hir_node(call_hir_id);
      let tdd: [DefKind, DefId] | undefined;
      if (
        call_node.$ === "Expr" &&
        call_node._0.kind.$ === "MethodCall" &&
        (tdd = typeck_results.type_dependent_def(call_hir_id)) !== undefined &&
        tdd[0].$ === "AssocFn" &&
        HirId_eq(call_node._0.kind._1.hir_id, arg_hir_id)
      ) {
        const did = tdd[1];
        // Avoid suggesting removing a method call if the argument is the receiver of the parent call and
        // removing the receiver would make the method inaccessible. i.e. `x.a().b()`, suggesting removing
        // `.a()` could change the type and make `.b()` unavailable.
        if (tcx.inherent_impl_of_assoc(did) !== undefined) {
          // if we're calling an inherent impl method, just try to make sure that the receiver type stays the same.
          should_sugg = ty_ === typeck_results.node_type_opt(arg_hir_id);
        } else {
          // we're calling a trait method, so we just check removing the method call still satisfies the trait.
          const trait_id = tcx.trait_of_assoc(did) ?? tcx.impl_trait_id(tcx.parent(did));
          const args = typeck_results.node_args(call_hir_id);
          const tr = TraitRef.with_replaced_self_ty(TraitRef.from_assoc(as_interner(tcx), trait_id, args), as_interner(tcx), ty_);
          should_sugg = EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(tr.def_id, tr.args, param_env));
        }
      } else {
        should_sugg = true;
      }

      if (should_sugg) {
        err.span_suggestion_verbose(
          Span.with_lo(expr.span, Span.hi(rcvr!.span)),
          `consider removing this method call, as the receiver has type \`${display_Ty(ty_)}\` and \`${display_PolyTraitClause(pred!)}\` trivially holds`,
          "",
          "MaybeIncorrect",
        );
      }
    }
    if (expr.kind.$ === "Block") {
      const block = expr.kind._0;
      const inner_expr = expr.peel_blocks();
      const ty = typeck_results.expr_ty_adjusted_opt(inner_expr) ?? Ty.new_misc_error(tcx);
      const span = inner_expr.span;
      if (span !== err.deref().span.primary_span() && !Span.in_external_macro(span, tcx.sess.source_map())) {
        err.span_label(
          span,
          TypeVisitableExt.references_error(ty, fold_Ty)
            ? ""
            : (() => {
                const ty_ = with_forced_trimmed_paths(() => this.ty_to_string(ty));
                return `this tail expression is of type \`${ty_}\``;
              })(),
        );
        const pk = Binder.skip_binder(failed_pred.kind());
        let stmt: hir.Stmt | undefined, value: hir.Expr, closure: hir.Closure, body: hir.Body;
        if (
          pk.$ === "Clause" &&
          pk._0.$ === "Trait" &&
          tcx.fn_trait_kind_from_def_id(TraitClause.def_id(pk._0._0)) !== undefined
        ) {
          const pred = pk._0._0;
          if (
            (stmt = block.stmts[0]) !== undefined &&
            stmt.kind.$ === "Semi" &&
            ((value = stmt.kind._0), true) &&
            value.kind.$ === "Closure" &&
            ((closure = value.kind._0), true) &&
            ((body = tcx.hir_body(closure.body)), true) &&
            !(body.value.kind.$ === "Block")
          ) {
            // Check if the failed predicate was an expectation of a closure type
            // and if there might have been a `{ |args|` typo instead of `|args| {`.
            err.multipart_suggestion(
              "you might have meant to open the closure body instead of placing a closure within a block",
              [
                [Span.with_hi(expr.span, Span.lo(value!.span)), ""],
                [Span.shrink_to_hi(closure!.fn_decl_span), " {"],
              ],
              "MaybeIncorrect",
            );
          } else {
            // Maybe the bare block was meant to be a closure.
            err.span_suggestion_verbose(
              Span.shrink_to_lo(expr.span),
              "you might have meant to create the closure instead of a block",
              `|${Array.from({ length: pred.trait_ref.args.length - 1 }, () => "_").join(", ")}| `,
              "MaybeIncorrect",
            );
          }
        }
      }
    }

    // FIXME: visit the ty to see if there's any closure involved, and if there is,
    // check whether its evaluated return type is the same as the one corresponding
    // to an associated type (as seen from `trait_pred`) in the predicate. Like in
    // trait_pred `S: Sum<<Self as Iterator>::Item>` and predicate `i32: Sum<&()>`
    let type_diffs: TypeError[] = [];
    let node_args: GenericArgs | undefined, where_pred_u: Unnormalized<Clause> | undefined;
    if (
      parent_code.$ === "WhereClauseInExpr" &&
      (node_args = typeck_results.node_args_opt(call_hir_id)) !== undefined &&
      (where_pred_u = GenericClauses.instantiate(this.tcx.clauses_of(parent_code._0) as GenericClauses, this.tcx, node_args).clauses[parent_code._3]) !== undefined
    ) {
      const where_pred = Unnormalized.skip_norm_wip(where_pred_u);
      let where_pred_t: PolyTraitClause | undefined, failed_pred_t: PolyTraitClause | undefined;
      let where_pred_p: PolyProjectionClause | undefined, failed_pred_p: PolyProjectionClause | undefined, found: Ty | undefined;
      if (
        (where_pred_t = where_pred.as_trait_clause()) !== undefined &&
        (failed_pred_t = failed_pred.as_trait_clause()) !== undefined &&
        DefId_eq(PolyTraitClauseC.def_id(where_pred_t), PolyTraitClauseC.def_id(failed_pred_t))
      ) {
        const failed_pred_t_ = failed_pred_t;
        this.enter_forall(
          where_pred_t,
          (where_pred) => {
            const failed_pred = this.instantiate_binder_with_fresh_vars(expr.span, BoundRegionConversionTime.FnCall, failed_pred_t_, d_TraitClause);

            const zipped_a = where_pred.trait_ref.args;
            const zipped_b = failed_pred.trait_ref.args;
            for (let i = 0; i < Math.min(zipped_a.length, zipped_b.length); i++) {
              const [expected, actual] = [zipped_a[i], zipped_b[i]];
              this.probe((_) => {
                const r = this.at(ObligationCause.misc(expr.span, body_def_id), param_env)
                  // Doesn't actually matter if we define opaque types here, this is just used for
                  // diagnostics, and the result is never kept around.
                  .eq("Yes", expected, actual, ToTrace_GenericArg);
                if (r.$ === "Ok") {
                  // We ignore nested obligations here for now.
                } else {
                  type_diffs.push(r._0);
                }
              });
            }
          },
          d_TraitClause,
        );
      } else if (
        (where_pred_p = where_pred.as_projection_clause()) !== undefined &&
        (failed_pred_p = failed_pred.as_projection_clause()) !== undefined &&
        (found = ((t: Binder<Ty> | undefined) =>
          t === undefined ? undefined : this.instantiate_binder_with_fresh_vars(expr.span, BoundRegionConversionTime.FnCall, t, fold_Ty))(
          Binder.transpose(Binder.map_bound(failed_pred_p, (pred) => Term.as_type(pred.term))),
        )) !== undefined
      ) {
        type_diffs = [
          {
            $: "Sorts",
            _0: {
              expected: AliasTy.to_ty(
                AliasTerm.expect_ty(
                  this.instantiate_binder_with_fresh_vars(
                    expr.span,
                    BoundRegionConversionTime.FnCall,
                    Binder.map_bound(where_pred_p, (pred) => pred.projection_term),
                    d_AliasTerm,
                  ),
                ),
                this.tcx,
                "No",
              ),
              found,
            },
          },
        ];
      }
    }
    let path: hir.Path, binding_node: hir.Node, local_node: hir.Node;
    if (
      expr.kind.$ === "Path" &&
      expr.kind._0.$ === "Resolved" &&
      expr.kind._0._0 === undefined &&
      ((path = expr.kind._0._1), true) &&
      path.res.$ === "Local" &&
      (binding_node = this.tcx.hir_node(path.res._0)).$ === "Pat" &&
      (local_node = this.tcx.parent_hir_node(binding_node._0.hir_id)).$ === "LetStmt" &&
      local_node._0.init !== undefined
    ) {
      const binding_expr = local_node._0.init;
      // If the expression we're calling on is a binding, we want to point at the
      // `let` when talking about the type. Otherwise we'll point at every part
      // of the method chain with the type.
      this.point_at_chain(binding_expr, typeck_results, type_diffs, param_env, err);
    } else {
      this.point_at_chain(expr, typeck_results, type_diffs, param_env, err);
    }
  }
  const call_node = tcx.hir_node(call_hir_id);
  if (call_node.$ === "Expr" && call_node._0.kind.$ === "MethodCall") {
    const path = call_node._0.kind._0;
    const rcvr = call_node._0.kind._1;
    if (rcvr.span === err.deref().span.primary_span()) {
      err.replace_span_with(path.ident.span, true);
    }
  }

  if (call_node.$ === "Expr") {
    const expr = call_node._0;
    let span: Span | undefined;
    if (expr.kind.$ === "Call") {
      span = expr.kind._0.span;
    } else if (expr.kind.$ === "MethodCall") {
      span = expr.kind._0.ident.span;
    }
    if (span !== undefined) {
      if (span !== err.deref().span.primary_span()) {
        let msg: string;
        if (Span.is_desugaring(span, { $: "FormatLiteral", source: true })) {
          msg = "required by this formatting parameter";
        } else if (Span.is_desugaring(span, { $: "FormatLiteral", source: false })) {
          msg = "required by a formatting parameter in this expression";
        } else {
          msg = "required by a bound introduced by this call";
        }
        err.span_label(span, msg);
      }
    }

    if (expr.kind.$ === "MethodCall") {
      const expr_ = expr.kind._1;
      this.suggest_option_method_if_applicable(failed_pred, param_env, err, expr_);
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5493 suggest_option_method_if_applicable
TypeErrCtxt.prototype.suggest_option_method_if_applicable = function (
  this: TypeErrCtxt,
  failed_pred: Predicate,
  param_env: ParamEnv,
  err: Diag,
  expr: hir.Expr,
): void {
  const tcx = this.tcx;
  const infcx = this.infcx;
  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) return;

  // Make sure we're dealing with the `Option` type.
  const option_ty_adt = typeck_results.expr_ty_adjusted(expr).ty_adt_def();
  if (option_ty_adt === undefined) {
    return;
  }
  if (!tcx.is_diagnostic_item(sym.Option, option_ty_adt.did())) {
    return;
  }

  // Given the predicate `fn(&T): FnOnce<(U,)>`, extract `fn(&T)` and `(U,)`,
  // then suggest `Option::as_deref(_mut)` if `U` can deref to `T`
  const pk = Binder.skip_binder(failed_pred.kind());
  let trait_ref: TraitRef, self_ty: GenericArg, found_ty_arg: GenericArg, fn_ty: Ty | undefined, fn_sig: FnSig;
  let first_input: TyKind | undefined, target_ty: Ty, needs_mut: Mutability, tup: TyKind | undefined, found_ty: Ty;
  let deref_target_did: DefId | undefined, projection: Ty, deref_target: Ty, obligations: PredicateObligations;
  if (
    pk.$ === "Clause" &&
    pk._0.$ === "Trait" &&
    ((trait_ref = pk._0._0.trait_ref), true) &&
    tcx.is_fn_trait(trait_ref.def_id) &&
    trait_ref.args.length === 2 &&
    (([self_ty, found_ty_arg] = [trait_ref.args[0], trait_ref.args[1]]), true) &&
    (fn_ty = ((ty: Ty | undefined) => (ty !== undefined && ty.is_fn() ? ty : undefined))(GenericArg.as_type(self_ty))) !== undefined &&
    ((fn_sig = Binder.skip_binder(fn_ty.fn_sig(tcx))), true) &&
    // FIXME(splat): this might need to change if the Fn* traits start using/supporting splat
    FnSigC.abi(fn_sig).$ === "Rust" &&
    !FnSigC.c_variadic(fn_sig) &&
    FnSigC.safety(fn_sig) === "Safe" &&
    // Extract first param of fn sig with peeled refs, e.g. `fn(&T)` -> `T`
    (first_input = FnSigC.inputs(fn_sig)[0]?.kind()) !== undefined &&
    first_input.$ === "Ref" &&
    ((target_ty = first_input._1), (needs_mut = first_input._2), true) &&
    !TypeVisitableExt.has_escaping_bound_vars(target_ty, fold_Ty) &&
    // Extract first tuple element out of fn trait, e.g. `FnOnce<(U,)>` -> `U`
    (tup = GenericArg.as_type(found_ty_arg)?.kind()) !== undefined &&
    tup.$ === "Tuple" &&
    tup._0.length === 1 &&
    ((found_ty = tup._0[0]), true) &&
    !TypeVisitableExt.has_escaping_bound_vars(found_ty, fold_Ty) &&
    // Extract `<U as Deref>::Target` assoc type and check that it is `T`
    (deref_target_did = tcx.lang_items().deref_target()) !== undefined &&
    ((projection = Ty.new_projection_from_args(tcx, "No", deref_target_did, tcx.mk_args([found_ty]))), true) &&
    ((({ value: deref_target, obligations } = infcx.at(ObligationCause.dummy(), param_env).normalize(Unnormalized.new_wip(projection), fold_Ty))), true) &&
    obligations.every((obligation) => infcx.predicate_must_hold_modulo_regions(obligation)) &&
    infcx.can_eq(param_env, deref_target, target_ty, ToTrace_Ty)
  ) {
    let help: [string, string] | undefined;
    let deref_mut_did: DefId | undefined;
    if (
      needs_mut! === "Mut" &&
      (deref_mut_did = tcx.lang_items().deref_mut_trait()) !== undefined &&
      EvaluationResult.must_apply_modulo_regions(infcx.type_implements_trait(deref_mut_did, [found_ty!], param_env))
    ) {
      help = ["call `Option::as_deref_mut()` first", ".as_deref_mut()"];
    } else if (needs_mut! === "Not") {
      help = ["call `Option::as_deref()` first", ".as_deref()"];
    } else {
      help = undefined;
    }

    if (help !== undefined) {
      const [msg, sugg] = help;
      err.span_suggestion_with_style(Span.shrink_to_hi(expr.span), msg, sugg, "MaybeIncorrect", "ShowAlways");
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5568 look_for_iterator_item_mistakes
TypeErrCtxt.prototype.look_for_iterator_item_mistakes = function (
  this: TypeErrCtxt,
  assocs_in_this_method: readonly ([Span, [DefId, Ty]] | undefined)[],
  typeck_results: TypeckResults,
  type_diffs: readonly TypeError[],
  param_env: ParamEnv,
  path_segment: hir.PathSegment,
  args: readonly hir.Expr[],
  prev_ty: Ty,
  err: Diag,
): void {
  const tcx = this.tcx;
  // Special case for iterator chains, we look at potential failures of `Iterator::Item`
  // not being `: Clone` and `Iterator::map` calls with spurious trailing `;`.
  for (const entry of assocs_in_this_method) {
    if (entry === undefined) {
      continue;
    }
    const [_span, [def_id, ty]] = entry;
    for (const diff of type_diffs) {
      if (diff.$ !== "Sorts") {
        continue;
      }
      const expected_found = diff._0;
      if (
        tcx.is_diagnostic_item(sym.IntoIteratorItem, def_id) &&
        path_segment.ident.name === sym.iter &&
        this.can_eq(param_env, Ty.new_ref(tcx, tcx.lifetimes.re_erased, expected_found.found, "Not"), ty, ToTrace_Ty) &&
        args.length === 0
      ) {
        // Used `.iter()` when `.into_iter()` was likely meant.
        err.span_suggestion_verbose(
          path_segment.ident.span,
          `consider consuming the \`${display_Ty(prev_ty)}\` to construct the \`Iterator\``,
          "into_iter",
          "MachineApplicable",
        );
      }
      if (
        tcx.is_diagnostic_item(sym.IntoIteratorItem, def_id) &&
        path_segment.ident.name === sym.into_iter &&
        this.can_eq(param_env, expected_found.found, Ty.new_ref(tcx, tcx.lifetimes.re_erased, ty, "Not"), ToTrace_Ty) &&
        args.length === 0
      ) {
        // Used `.into_iter()` when `.iter()` was likely meant.
        err.span_suggestion_verbose(
          path_segment.ident.span,
          `consider not consuming the \`${display_Ty(prev_ty)}\` to construct the \`Iterator\``,
          "iter",
          "MachineApplicable",
        );
      }
      let arg: hir.Expr;
      if (
        tcx.is_diagnostic_item(sym.IteratorItem, def_id) &&
        path_segment.ident.name === sym.map &&
        this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty) &&
        args.length === 1 &&
        ((arg = args[0]), true) &&
        arg.kind.$ === "Closure"
      ) {
        const closure = arg.kind._0;
        const body = tcx.hir_body(closure.body);
        let block: hir.Block, stmt: hir.Stmt, expr: hir.Expr;
        if (
          body.value.kind.$ === "Block" &&
          body.value.kind._1 === undefined &&
          ((block = body.value.kind._0), true) &&
          block.expr === undefined &&
          block.stmts.length >= 1 &&
          ((stmt = block.stmts[block.stmts.length - 1]), true) &&
          stmt.kind.$ === "Semi" &&
          ((expr = stmt.kind._0), true) &&
          // FIXME: actually check the expected vs found types, but right now
          // the expected is a projection that we need to resolve.
          // && let Some(tail_ty) = typeck_results.expr_ty_opt(expr)
          expected_found.found.is_unit() &&
          // FIXME: this happens with macro calls. Need to figure out why the stmt
          // `println!();` doesn't include the `;` in its `Span`. (#133845)
          // We filter these out to avoid ICEs with debug assertions on caused by
          // empty suggestions.
          Span.hi(expr.span) !== Span.hi(stmt.span)
        ) {
          err.span_suggestion_verbose(
            Span.with_hi(Span.shrink_to_hi(expr!.span), Span.hi(stmt!.span)),
            "consider removing this semicolon",
            "",
            "MachineApplicable",
          );
        }
        let expr_: hir.Expr;
        if (body.value.kind.$ === "Block" && body.value.kind._1 === undefined && body.value.kind._0.expr !== undefined) {
          expr_ = body.value.kind._0.expr;
        } else {
          expr_ = body.value;
        }
        const expr2 = expr_;
        let path_segment_: hir.PathSegment, rcvr: hir.Expr, span: Span, expr_ty: Ty | undefined, rcvr_ty: Ty | undefined, ref_kind: TyKind;
        if (
          expr2.kind.$ === "MethodCall" &&
          expr2.kind._2.length === 0 &&
          (([path_segment_, rcvr, span] = [expr2.kind._0, expr2.kind._1, expr2.kind._3]), true) &&
          path_segment_.ident.name === sym.clone &&
          (expr_ty = typeck_results.expr_ty_opt(expr2)) !== undefined &&
          (rcvr_ty = typeck_results.expr_ty_opt(rcvr)) !== undefined &&
          this.can_eq(param_env, expr_ty, rcvr_ty, ToTrace_Ty) &&
          (ref_kind = expr_ty.kind()).$ === "Ref"
        ) {
          const ty = ref_kind._1;
          err.span_label(
            span!,
            `this method call is cloning the reference \`${display_Ty(expr_ty)}\`, not \`${display_Ty(ty)}\` which doesn't implement \`Clone\``,
          );
          if (ty.kind().$ !== "Param") {
            continue;
          }
          const node = tcx.hir_node_by_def_id(tcx.hir_get_parent_item(expr2.hir_id).def_id);

          const pred: PolyTraitClause = Binder.dummy(
            {
              trait_ref: TraitRef.new(as_interner(tcx), tcx.require_lang_item("Clone", span!), [ty]),
              polarity: "Positive",
            },
            d_TraitClause,
          );
          const generics = hir.Node.generics(node);
          if (generics === undefined) {
            continue;
          }
          const body_id = hir.Node.body_id(node);
          if (body_id === undefined) {
            continue;
          }
          suggest_restriction(
            tcx,
            tcx.hir_body_owner_def_id(body_id),
            generics,
            `type parameter \`${display_Ty(ty)}\``,
            err,
            hir.Node.fn_sig(node),
            undefined,
            pred,
            undefined,
          );
        }
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5717 point_at_chain
TypeErrCtxt.prototype.point_at_chain = function (
  this: TypeErrCtxt,
  expr_: hir.Expr,
  typeck_results: TypeckResults,
  type_diffs: TypeError[],
  param_env: ParamEnv,
  err: Diag,
): void {
  const primary_spans: Span[] = [];
  const span_labels: [Span, string][] = [];

  const tcx = this.tcx;

  let print_root_expr = true;
  const assocs: ([Span, [DefId, Ty]] | undefined)[][] = [];
  let expr = expr_;
  let prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
  while (expr.kind.$ === "MethodCall") {
    const [path_segment, rcvr_expr, args, span] = [expr.kind._0, expr.kind._1, expr.kind._2, expr.kind._3];
    // Point at every method call in the chain with the resulting type.
    // vec![1, 2, 3].iter().map(mapper).sum<i32>()
    //               ^^^^^^ ^^^^^^^^^^^
    expr = rcvr_expr;
    const assocs_in_this_method = this.probe_assoc_types_at_expr(type_diffs, span, prev_ty, expr.hir_id, param_env);
    prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
    this.look_for_iterator_item_mistakes(assocs_in_this_method, typeck_results, type_diffs, param_env, path_segment, args, prev_ty, err);
    assocs.push(assocs_in_this_method);

    let path: hir.Path, binding_node: hir.Node;
    if (
      expr.kind.$ === "Path" &&
      expr.kind._0.$ === "Resolved" &&
      expr.kind._0._0 === undefined &&
      ((path = expr.kind._0._1), true) &&
      path.res.$ === "Local" &&
      (binding_node = this.tcx.hir_node(path.res._0)).$ === "Pat"
    ) {
      const parent = this.tcx.parent_hir_node(binding_node._0.hir_id);
      // We've reached the root of the method call chain...
      if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
        // ...and it is a binding. Get the binding creation and continue the chain.
        expr = parent._0.init;
      }
      if (parent.$ === "Param") {
        const param = parent._0;
        // ...and it is an fn argument.
        const prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.node_type_opt(param.hir_id) ?? Ty.new_misc_error(tcx), fold_Ty);
        const assocs_in_this_method = this.probe_assoc_types_at_expr(type_diffs, param.ty_span, prev_ty, param.hir_id, param_env);
        if (assocs_in_this_method.some((a) => a !== undefined)) {
          assocs.push(assocs_in_this_method);
          print_root_expr = false;
        }
        break;
      }
    }
  }
  // We want the type before deref coercions, otherwise we talk about `&[_]`
  // instead of `Vec<_>`.
  const root_ty = typeck_results.expr_ty_opt(expr);
  if (root_ty !== undefined && print_root_expr) {
    const ty = with_forced_trimmed_paths(() => this.ty_to_string(root_ty));
    // Point at the root expression
    // vec![1, 2, 3].iter().map(mapper).sum<i32>()
    // ^^^^^^^^^^^^^
    span_labels.push([expr.span, `this expression has type \`${ty}\``]);
  }
  // Only show this if it is not a "trivial" expression (not a method
  // chain) and there are associated types to talk about.
  for (let ai = 0; ai < assocs.length; ai++) {
    const assocs_in_method = assocs[ai];
    if (ai + 1 >= assocs.length) {
      for (const entry of assocs_in_method) {
        if (entry === undefined) {
          continue;
        }
        const [span, [assoc, ty]] = entry;
        if (
          primary_spans.length === 0 ||
          type_diffs.some((diff) => {
            if (diff.$ !== "Sorts") {
              return false;
            }
            const expected_found = diff._0;
            return this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty);
          })
        ) {
          // FIXME: this doesn't quite work for `Iterator::collect`
          // because we have `Vec<i32>` and `()`, but we'd want `i32`
          // to point at the `.into_iter()` call, but as long as we
          // still point at the other method calls that might have
          // introduced the issue, this is fine for now.
          primary_spans.push(span);
        }
        span_labels.push([span, with_forced_trimmed_paths(() => `\`${this.tcx.def_path_str(assoc)}\` is \`${display_Ty(ty)}\` here`)]);
      }
      break;
    }
    const prev_assoc_in_method = assocs[ai + 1];
    for (let i = 0; i < Math.min(assocs_in_method.length, prev_assoc_in_method.length); i++) {
      const entry = assocs_in_method[i];
      const prev_entry = prev_assoc_in_method[i];
      if (entry !== undefined && prev_entry !== undefined) {
        const [span, [assoc, ty]] = entry;
        const prev_ty = prev_entry[1][1];
        const ty_str = with_forced_trimmed_paths(() => this.ty_to_string(ty));

        const assoc_ = with_forced_trimmed_paths(() => this.tcx.def_path_str(assoc));
        if (!this.can_eq(param_env, ty, prev_ty, ToTrace_Ty)) {
          if (
            type_diffs.some((diff) => {
              if (diff.$ !== "Sorts") {
                return false;
              }
              const expected_found = diff._0;
              return this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty);
            })
          ) {
            primary_spans.push(span);
          }
          span_labels.push([span, `\`${assoc_}\` changed to \`${ty_str}\` here`]);
        } else {
          span_labels.push([span, `\`${assoc_}\` remains \`${ty_str}\` here`]);
        }
      } else if (entry !== undefined && prev_entry === undefined) {
        const [span, [assoc, ty]] = entry;
        span_labels.push([
          span,
          with_forced_trimmed_paths(() => `\`${this.tcx.def_path_str(assoc)}\` is \`${this.ty_to_string(ty)}\` here`),
        ]);
      } else {
        // (None, Some(_)) | (None, None) => {}
      }
    }
  }
  if (primary_spans.length !== 0) {
    const multi_span: MultiSpan = MultiSpan.from_Vec(primary_spans);
    for (const [span, label] of span_labels) {
      multi_span.push_span_label(span, label);
    }
    err.span_note(multi_span, "the method call chain might not have had the expected associated types");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5886 probe_assoc_types_at_expr
TypeErrCtxt.prototype.probe_assoc_types_at_expr = function (
  this: TypeErrCtxt,
  type_diffs: readonly TypeError[],
  span: Span,
  prev_ty: Ty,
  body_id: HirId,
  param_env: ParamEnv,
): ([Span, [DefId, Ty]] | undefined)[] {
  const ocx = engine_mod().ObligationCtxt.new(this.infcx);
  const assocs_in_this_method: ([Span, [DefId, Ty]] | undefined)[] = [];
  for (const diff of type_diffs) {
    if (diff.$ !== "Sorts") {
      continue;
    }
    const expected_found = diff._0;
    const ek = expected_found.expected.kind();
    if (!(ek.$ === "Alias" && ek._1.kind.$ === "Projection")) {
      continue;
    }
    const kind = ek._1.kind;
    const def_id = kind.def_id;

    // Make `Self` be equivalent to the type of the call chain
    // expression we're looking at now, so that we can tell what
    // for example `Iterator::Item` is at this point in the chain.
    const args = RawList.for_item(this.tcx, def_id, (param, _) => {
      if (param.index === 0) {
        // debug_assert_matches!(param.kind, ty::GenericParamDefKind::Type { .. });
        return prev_ty;
      }
      return this.var_for_def(span, param);
    });
    // This will hold the resolved type of the associated type, if the
    // current expression implements the trait that associated type is
    // in. For example, this would be what `Iterator::Item` is here.
    const ty = this.infcx.next_ty_var(span);
    // This corresponds to `<ExprTy as Iterator>::Item = _`.
    const projection = Binder.dummy<PredicateKind>(
      {
        $: "Clause",
        _0: {
          $: "Projection",
          _0: {
            projection_term: AliasTerm.new_from_args(this.tcx, AliasTermKind.from_AliasTyKind(kind), args),
            term: ty,
          },
        },
      },
      d_PredicateKind,
    );
    const body_def_id = this.tcx.hir_enclosing_body_owner(body_id);
    // Add `<ExprTy as Iterator>::Item = _` obligation.
    ocx.register_obligation(Obligation.misc(this.tcx, span, body_def_id, param_env, projection, upcast_Binder_PredicateKind));
    let ty_: Ty;
    if (
      TraitErrors.no_errors(ocx.try_evaluate_obligations()) &&
      ((ty_ = this.deeply_resolve_ignoring_regions(ty, fold_Ty)), true) &&
      !ty_.is_ty_var()
    ) {
      assocs_in_this_method.push([span, [def_id, ty_]]);
    } else {
      // `<ExprTy as Iterator>` didn't select, so likely we've
      // reached the end of the iterator chain, like the originating
      // `Vec<_>` or the `ty` couldn't be determined.
      // Keep the space consistent for later zipping.
      assocs_in_this_method.push(undefined);
    }
  }
  return assocs_in_this_method;
};

/// When a `-> impl Trait<Assoc = Ty>` return type obligation fails, walk the method call
/// chain in the returned expression to point at where the associated type diverged from
/// what the signature expects.
///
/// ```text
/// note: the method call chain might not have had the expected associated types
///   --> $DIR/invalid-iterator-chain-in-return-position.rs:16:18
///    |
/// LL |     x.iter_mut().map(foo)
///    |     - ---------- ^^^^^^^^ `Iterator::Item` changed to `()` here
///    |     | |
///    |     | `Iterator::Item` is `&mut Vec<u8>` here
///    |     this expression has type `Vec<Vec<u8>>`
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5966 point_at_chain_in_return_position
TypeErrCtxt.prototype.point_at_chain_in_return_position = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  expr_: hir.Expr,
  typeck_results: TypeckResults,
  param_env: ParamEnv,
  err: Diag,
): void {
  const tcx = this.tcx;
  const dk = tcx.def_kind(body_def_id) as DefKind;
  if (!(dk.$ === "Fn" || dk.$ === "AssocFn")) {
    return;
  }

  const binder = PolyFnSig.output(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(body_def_id) as EarlyBinder<PolyFnSigT>)));
  this.enter_forall(
    binder,
    (output) => {
      const ok = output.kind();
      if (!(ok.$ === "Alias" && ok._1.kind.$ === "Opaque")) {
        return;
      }
      const opaque_def_id = ok._1.kind.def_id;
      const args = ok._1.args;

      // The predicate that reaches here has been rewritten through the impls it was
      // derived from (e.g. `Iterator for Map<I, F>` turns `Iterator::Item` requirements
      // into requirements on `F`'s return type), so the associated types the user wrote
      // in the signature are recovered from the opaque's bounds instead.
      const probe_diffs: TypeError[] = [];
      for (const clause of Unnormalized.skip_norm_wip(
        EarlyBinder.instantiate(tcx.item_bounds(opaque_def_id) as EarlyBinder<Clauses>, tcx, args, fold_Clauses),
      )) {
        const proj_ = clause.as_projection_clause();
        if (proj_ === undefined) continue;
        const proj = this.instantiate_binder_with_fresh_vars(expr_.span, BoundRegionConversionTime.FnCall, proj_, d_ProjectionClause);
        const expected_term = Term.as_type(proj.term);
        if (expected_term === undefined) continue;
        // Only the projection (for its `DefId`) is used when probing the chain; the
        // bound's own term is carried in `found` for the divergence check below and
        // is replaced with the probed type afterwards.
        probe_diffs.push({
          $: "Sorts",
          _0: {
            expected: AliasTy.to_ty(AliasTerm.expect_ty(proj.projection_term), tcx, "No"),
            found: expected_term,
          },
        });
      }
      if (probe_diffs.length === 0) {
        return;
      }

      // If the returned expression is a binding, walk the chain that created it instead.
      let path: hir.Path, binding_node: hir.Node, local_node: hir.Node;
      let expr: hir.Expr;
      if (
        expr_.kind.$ === "Path" &&
        expr_.kind._0.$ === "Resolved" &&
        expr_.kind._0._0 === undefined &&
        ((path = expr_.kind._0._1), true) &&
        path.res.$ === "Local" &&
        (binding_node = tcx.hir_node(path.res._0)).$ === "Pat" &&
        (local_node = tcx.parent_hir_node(binding_node._0.hir_id)).$ === "LetStmt" &&
        local_node._0.init !== undefined
      ) {
        expr = local_node._0.init;
      } else {
        expr = expr_;
      }

      // Resolve what each bound associated type actually is for the returned expression,
      // and keep only the ones that diverged from the signature.
      const expr_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
      const assocs = this.probe_assoc_types_at_expr(probe_diffs, expr.span, expr_ty, expr.hir_id, param_env);
      const type_diffs: TypeError[] = [];
      for (let i = 0; i < Math.min(probe_diffs.length, assocs.length); i++) {
        const probe_diff = probe_diffs[i];
        const assoc = assocs[i];
        if (probe_diff.$ !== "Sorts") {
          continue;
        }
        const { expected, found: expected_term } = probe_diff._0;
        if (assoc === undefined) continue;
        const actual_ty = assoc[1][1];
        if (!this.can_eq(param_env, expected_term, actual_ty, ToTrace_Ty)) {
          type_diffs.push({ $: "Sorts", _0: { expected, found: actual_ty } });
        }
      }
      if (type_diffs.length !== 0) {
        this.point_at_chain(expr, typeck_results, type_diffs, param_env, err);
      }
    },
    fold_Ty,
  );
};

/// If the type that failed selection is an array or a reference to an array,
/// but the trait is implemented for slices, suggest that the user converts
/// the array into a slice.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6060 suggest_convert_to_slice
TypeErrCtxt.prototype.suggest_convert_to_slice = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClause,
  candidate_impls: readonly ImplCandidate[],
  span: Span,
): void {
  if (Span.in_external_macro(span, this.tcx.sess.source_map())) {
    return;
  }
  // We can only suggest the slice coercion for function and binary operation arguments,
  // since the suggestion would make no sense in turbofish or call
  const code = obligation.cause.code_();
  if (!(code.$ === "BinOp" || code.$ === "FunctionArg")) {
    return;
  }

  // Three cases where we can make a suggestion:
  // 1. `[T; _]` (array of T)
  // 2. `&[T; _]` (reference to array of T)
  // 3. `&mut [T; _]` (mutable reference to array of T)
  let element_ty: Ty, mutability: Mutability | undefined;
  const sk = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  if (sk.$ === "Array") {
    [element_ty, mutability] = [sk._0, undefined];
  } else if (sk.$ === "Ref") {
    const pk = sk._1.kind();
    if (pk.$ === "Array") {
      [element_ty, mutability] = [pk._0, sk._2];
    } else {
      return;
    }
  } else {
    return;
  }

  // Go through all the candidate impls to see if any of them is for
  // slices of `element_ty` with `mutability`.
  const is_slice = (candidate: Ty): boolean => {
    const ck = candidate.kind();
    if (ck.$ === "RawPtr" || ck.$ === "Ref") {
      const [t, m] = ck.$ === "RawPtr" ? [ck._0, ck._1] : [ck._1, ck._2];
      const tk = t.kind();
      if (tk.$ === "Slice" && tk._0 === element_ty && m === (mutability ?? m)) {
        // Use the candidate's mutability going forward.
        mutability = m;
        return true;
      } else {
        return false;
      }
    }
    return false;
  };

  // Grab the first candidate that matches, if any, and make a suggestion.
  let slice_ty: Ty | undefined;
  for (const trait_ref of candidate_impls) {
    const t = TraitRef.self_ty(trait_ref.trait_ref);
    if (is_slice(t)) {
      slice_ty = t;
      break;
    }
  }
  if (slice_ty !== undefined) {
    const msg = `convert the array to a \`${display_Ty(slice_ty)}\` slice instead`;

    const r = this.tcx.sess.source_map().span_to_snippet(span);
    if (r.$ === "Ok") {
      const snippet = r._0;
      const suggestions: [Span, string][] = [];
      if (snippet.starts_with("&")) {
        // (nothing)
      } else if (mutability === "Mut") {
        suggestions.push([Span.shrink_to_lo(span), "&mut "]);
      } else {
        suggestions.push([Span.shrink_to_lo(span), "&"]);
      }
      suggestions.push([Span.shrink_to_hi(span), "[..]"]);
      err.multipart_suggestion(msg, suggestions, "MaybeIncorrect");
    } else {
      err.span_help(span, msg);
    }
  }
};

/// If the type failed selection but the trait is implemented for `(T,)`, suggest that the user
/// creates a unary tuple
///
/// This is a common gotcha when using libraries that emulate variadic functions with traits for tuples.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6140 suggest_tuple_wrapping
TypeErrCtxt.prototype.suggest_tuple_wrapping = function (
  this: TypeErrCtxt,
  err: Diag,
  root_obligation: PredicateObligation,
  obligation: PredicateObligation,
): void {
  const code = obligation.cause.code_();
  if (code.$ !== "FunctionArg") {
    return;
  }
  const arg_hir_id = code.arg_hir_id;

  const root_pred = root_obligation.predicate.as_trait_clause();
  if (root_pred === undefined) return;

  const trait_ref = Binder.map_bound(root_pred, (root_pred) =>
    TraitRef.with_replaced_self_ty(root_pred.trait_ref, as_interner(this.tcx), Ty.new_tup(this.tcx, [TraitRef.self_ty(root_pred.trait_ref)])),
  );

  const obligation_ = Obligation.new(this.tcx, clone_ObligationCause(obligation.cause), obligation.param_env, trait_ref, upcast_PolyTraitRef);

  if (this.predicate_must_hold_modulo_regions(obligation_)) {
    const arg_span = this.tcx.hir_span(arg_hir_id);
    err.multipart_suggestion(
      "use a unary tuple instead",
      [
        [Span.shrink_to_lo(arg_span), "("],
        [Span.shrink_to_hi(arg_span), ",)"],
      ],
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6172 suggest_shadowed_inherent_method
TypeErrCtxt.prototype.suggest_shadowed_inherent_method = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClause,
): void {
  const code = obligation.cause.code_();
  if (code.$ !== "FunctionArg") {
    return;
  }
  const call_hir_id = code.call_hir_id;
  const call_node = this.tcx.hir_node(call_hir_id);
  if (call_node.$ !== "Expr") return;
  const call = call_node._0;
  if (call.kind.$ !== "MethodCall") return;
  const [segment, rcvr, args] = [call.kind._0, call.kind._1, call.kind._2];
  const typeck = this.typeck_results;
  if (typeck === undefined) return;
  const rcvr_ty_ = typeck.expr_ty_adjusted_opt(rcvr);
  if (rcvr_ty_ === undefined) return;
  const rcvr_ty = this.deeply_resolve_ignoring_regions(rcvr_ty_, fold_Ty);
  const autoderef = this.autoderef_steps(rcvr_ty);
  // PORT: the lazy `autoderef.iter().filter_map(..)` is a generator, so the filter runs interleaved with the body.
  const steps = function* (this: TypeErrCtxt): Generator<[Ty, DefId]> {
    for (const [ty, obligations] of autoderef) {
      const tk = ty.kind();
      if (tk.$ === "Adt" && ty !== rcvr_ty.peel_refs() && obligations.every((obligation) => this.predicate_may_hold(obligation))) {
        yield [ty, tk._0.did()];
      }
    }
  }.call(this);
  for (const [ty, def_id] of steps) {
    for (const impl_def_id of this.tcx.inherent_impls(def_id) as readonly DefId[]) {
      if (DefId_eq(impl_def_id, PolyTraitClauseC.def_id(trait_predicate))) {
        continue;
      }
      for (const m of this.tcx.provided_trait_methods(impl_def_id)) {
        if (AssocItem.name(m) !== segment.ident.name) continue;
        const fn_sig = this.tcx.fn_sig(m.def_id) as EarlyBinder<PolyFnSigT>;
        if (Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(fn_sig))).length !== args.length + 1) {
          continue;
        }
        const rcvr_ty = Binder.skip_binder(PolyFnSig.input(EarlyBinder.skip_binder(fn_sig), 0));
        const rk = rcvr_ty.kind();
        let mutability: string, _ty: Ty;
        if (rk.$ === "Ref" && rk._2 === "Mut") {
          [mutability, _ty] = ["&mut ", rk._1];
        } else if (rk.$ === "Ref") {
          [mutability, _ty] = ["&", rk._1];
        } else {
          [mutability, _ty] = ["", rcvr_ty];
        }
        const path = this.tcx.def_path_str(def_id);
        err.note(
          `there's an inherent method on \`${display_Ty(ty)}\` of the same name, which can be auto-dereferenced from \`${display_Ty(rcvr_ty)}\``,
        );
        err.multipart_suggestion(
          `to access the inherent method on \`${display_Ty(ty)}\`, use the fully-qualified path`,
          [
            [Span.until(call.span, rcvr.span), `${path}::${display_Symbol(AssocItem.name(m))}(${mutability}`],
            args.length === 0
              ? [Span.with_hi(Span.shrink_to_hi(rcvr.span), Span.hi(call.span)), ")"]
              : [Span.between(rcvr.span, args[0].span), ", "],
          ],
          "MaybeIncorrect",
        );
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6245 explain_hrtb_projection
TypeErrCtxt.prototype.explain_hrtb_projection = function (
  this: TypeErrCtxt,
  diag: Diag,
  pred: PolyTraitClause,
  param_env: ParamEnv,
  cause: ObligationCause,
): void {
  if (
    TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(pred), d_TraitClause) &&
    TypeVisitableExt.has_non_region_infer(Binder.skip_binder(pred), d_TraitClause)
  ) {
    this.probe((_) => {
      const ocx = engine_mod().ObligationCtxt.new(this.infcx);
      ocx.register_obligation(Obligation.new(this.tcx, ObligationCause.dummy(), param_env, pred, upcast_PolyTraitClause));
      if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
        // encountered errors.
        return;
      }

      const code = cause.code_();
      if (code.$ === "FunctionArg") {
        const { call_hir_id, arg_hir_id } = code;
        const arg_span = this.tcx.hir_span(arg_hir_id);
        const sp: MultiSpan = MultiSpan.from_Span(arg_span);

        sp.push_span_label(arg_span, "the trait solver is unable to infer the generic types that should be inferred from this argument");
        sp.push_span_label(this.tcx.hir_span(call_hir_id), "add turbofish arguments to this call to specify the types manually, even if it's redundant");
        diag.span_note(sp, "this is a known limitation of the trait solver that will be lifted in the future");
      } else {
        const sp: MultiSpan = MultiSpan.from_Span(cause.span);
        sp.push_span_label(cause.span, "try adding turbofish arguments to this expression to specify the types manually, even if it's redundant");
        diag.span_note(sp, "this is a known limitation of the trait solver that will be lifted in the future");
      }
    });
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6308 suggest_desugaring_async_fn_in_trait
TypeErrCtxt.prototype.suggest_desugaring_async_fn_in_trait = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClause): void {
  // Don't suggest if RTN is active -- we should prefer a where-clause bound instead.
  if (this.tcx.features().return_type_notation()) {
    return;
  }

  const trait_def_id = PolyTraitClauseC.def_id(trait_pred);

  // Only suggest specifying auto traits
  if (!this.tcx.trait_is_auto(trait_def_id)) {
    return;
  }

  // Look for an RPITIT
  const sk = Binder.skip_binder(PolyTraitClauseC.self_ty(trait_pred)).kind();
  if (!(sk.$ === "Alias" && sk._1.kind.$ === "Projection")) {
    return;
  }
  const alias_ty = sk._1;
  const def_id = sk._1.kind.def_id;
  const rpitit = this.tcx.opt_rpitit_info(def_id);
  if (rpitit === undefined || rpitit.$ !== "Trait") {
    return;
  }
  const { fn_def_id: fn_def_id_, opaque_def_id } = rpitit;

  const auto_trait = this.tcx.def_path_str(trait_def_id);
  // ... which is a local function
  const fn_def_id = fn_def_id_.as_local();
  if (fn_def_id === undefined) {
    // If it's not local, we can at least mention that the method is async, if it is.
    if (Asyncness.is_async(this.tcx.asyncness(fn_def_id_) as Asyncness)) {
      err.span_note(
        this.tcx.def_span(fn_def_id_),
        `\`${display_TraitRef(AliasTy.trait_ref(alias_ty, as_interner(this.tcx)))}::${display_Symbol(this.tcx.item_name(fn_def_id_))}\` is an \`async fn\` in trait, which does not automatically imply that its future is \`${auto_trait}\``,
      );
    }
    return;
  }
  const item_node = this.tcx.hir_node_by_def_id(fn_def_id);
  if (item_node.$ !== "TraitItem") {
    return;
  }
  const item = item_node._0;

  // ... whose signature is `async` (i.e. this is an AFIT)
  const [sig, body] = item.expect_fn();
  const output = sig.decl.output;
  if (!(output.$ === "Return" && output._0.kind.$ === "OpaqueDef")) {
    // This should never happen, but let's not ICE.
    return;
  }
  const opaq_def = output._0.kind._0;

  // Check that this is *not* a nested `impl Future` RPIT in an async fn
  // (i.e. `async fn foo() -> impl Future`)
  if (!DefId_eq(LocalDefIdC.to_def_id(opaq_def.def_id), opaque_def_id)) {
    return;
  }

  const sugg = suggest_desugaring_async_fn_to_impl_future_in_trait(this.tcx, sig, body, opaque_def_id.expect_local(), ` + ${auto_trait}`);
  if (sugg === undefined) {
    return;
  }

  const function_name = this.tcx.def_path_str(fn_def_id);
  err.multipart_suggestion(
    `\`${auto_trait}\` can be made part of the associated future's guarantees for all implementations of \`${function_name}\``,
    sugg,
    "MachineApplicable",
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6394 ty_kind_suggestion
TypeErrCtxt.prototype.ty_kind_suggestion = function (this: TypeErrCtxt, param_env: ParamEnv, ty: Ty): string | undefined {
  const tcx = this.infcx.tcx;
  const implements_default = (ty: Ty): boolean => {
    const default_trait = tcx.get_diagnostic_item(sym.Default);
    if (default_trait === undefined) {
      return false;
    }
    return EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(default_trait, [ty], param_env));
  };

  const k = ty.kind();
  const is_item = (def: AdtDef, name: Symbol): boolean => {
    const item = tcx.get_diagnostic_item(name);
    return item !== undefined && DefId_eq(def.did(), item);
  };
  let len: number | undefined;
  switch (k.$) {
    case "Never":
    case "Error":
      return undefined;
    case "Bool":
      return "false";
    case "Char":
      return "'x'";
    case "Int":
    case "Uint":
      return "42";
    case "Float":
      return "3.14159";
    case "Slice":
      return "[]";
    case "Adt": {
      const [def, args] = [k._0, k._1];
      if (is_item(def, sym.Vec)) {
        return "vec![]";
      }
      if (is_item(def, sym.String)) {
        return "String::new()";
      }
      if (def.is_box()) {
        const inner = this.ty_kind_suggestion(param_env, GenericArg.expect_ty(args[0]));
        if (inner === undefined) return undefined;
        return `Box::new(${inner})`;
      }
      if (is_item(def, sym.Option)) {
        return "None";
      }
      if (is_item(def, sym.Result)) {
        const inner = this.ty_kind_suggestion(param_env, GenericArg.expect_ty(args[0]));
        if (inner === undefined) return undefined;
        return `Ok(${inner})`;
      }
      if (implements_default(ty)) {
        return "Default::default()";
      }
      return "/* value */";
    }
    case "Ref": {
      const [ty_, mutability] = [k._1, k._2];
      if (ty_.kind().$ === "Str" && mutability === "Not") {
        return '""';
      } else {
        const ty = this.ty_kind_suggestion(param_env, ty_);
        if (ty === undefined) return undefined;
        return `&${Mutability.prefix_str(mutability)}${ty}`;
      }
    }
    case "Array":
      if ((len = k._1.try_to_target_usize(tcx)) !== undefined) {
        const ty_ = k._0;
        if (len === 0) {
          return "[]";
        } else if (this.type_is_copy_modulo_regions(param_env, ty_) || len === 1) {
          // Can only suggest `[ty; 0]` if sz == 1 or copy
          const inner = this.ty_kind_suggestion(param_env, ty_);
          if (inner === undefined) return undefined;
          return `[${inner}; ${len}]`;
        } else {
          return "/* value */";
        }
      }
      return "/* value */";
    case "Tuple": {
      const tys = k._0;
      const parts: string[] = [];
      for (const ty of tys) {
        const s = this.ty_kind_suggestion(param_env, ty);
        if (s === undefined) return undefined;
        parts.push(s);
      }
      return `(${parts.join(", ")}${tys.length === 1 ? "," : ""})`;
    }
    default:
      return "/* value */";
  }
};

// For E0277 when use `?` operator, suggest adding
// a suitable return type in `FnSig`, and a default
// return value at the end of the function's body.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6463 suggest_add_result_as_return_type
TypeErrCtxt.prototype.suggest_add_result_as_return_type = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClause,
): void {
  if (ObligationCauseCode.peel_derives(obligation.cause.code_()).$ !== "QuestionMark") {
    return;
  }

  // Only suggest for local function and associated method,
  // because this suggest adding both return type in
  // the `FnSig` and a default return value in the body, so it
  // is not suitable for foreign function without a local body,
  // and neither for trait method which may be also implemented
  // in other place, so shouldn't change it's FnSig.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6479 choose_suggest_items
  function choose_suggest_items(tcx: TyCtxt, node: hir.Node): [hir.FnDecl, hir.BodyId] | undefined {
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const { sig, body: body_id } = node._0.kind;
      return [sig.decl, body_id];
    } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
      const item = node._0;
      const [sig, body_id] = [node._0.kind._0, node._0.kind._1];
      const parent = tcx.parent_hir_node(item.hir_id());
      if (parent.$ === "Item" && parent._0.kind.$ === "Impl" && parent._0.kind._0.of_trait === undefined) {
        return [sig.decl, body_id];
      }
      return undefined;
    } else {
      return undefined;
    }
  }

  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  const items = choose_suggest_items(this.tcx, node);
  let def_kind: TyKind;
  if (
    items !== undefined &&
    items[0].output.$ === "DefaultReturn" &&
    this.tcx.is_diagnostic_item(sym.FromResidual, PolyTraitClauseC.def_id(trait_pred)) &&
    Binder.skip_binder(trait_pred).trait_ref.args.type_at(0).is_unit() &&
    (def_kind = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Adt" &&
    this.tcx.is_diagnostic_item(sym.Result, def_kind._0.did())
  ) {
    const [fn_decl, body_id] = items;
    const ret_span = (fn_decl.output as { $: "DefaultReturn"; _0: Span })._0;
    const sugg_spans: [Span, string][] = [[ret_span, " -> Result<(), Box<dyn std::error::Error>>"]];
    const body = this.tcx.hir_body(body_id);
    if (body.value.kind.$ === "Block" && body.value.kind._0.expr === undefined) {
      const b = body.value.kind._0;
      // The span of '}' in the end of block.
      const span = this.tcx.sess.source_map().end_point(b.span);
      sugg_spans.push([
        Span.shrink_to_lo(span),
        `${"    Ok(())\n"}${this.tcx.sess.source_map().indentation_before(span)?.toString() ?? ""}`,
      ]);
    }
    err.multipart_suggestion("consider adding return type", sugg_spans, "MaybeIncorrect");
  }
};

// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6539 suggest_unsized_bound_if_applicable
TypeErrCtxt.prototype.suggest_unsized_bound_if_applicable = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): void {
  const pk = Binder.skip_binder(obligation.predicate.kind());
  if (!(pk.$ === "Clause" && pk._0.$ === "Trait")) {
    return;
  }
  const pred = pk._0._0;
  const code = ObligationCauseCode.peel_derives(obligation.cause.code_());
  let item_def_id: DefId, span: Span;
  if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
    [item_def_id, span] = [code._0, code._1];
  } else {
    return;
  }
  if (Span.is_dummy(span)) {
    return;
  }
  // debug!(?pred, ?item_def_id, ?span);

  const node = this.tcx.hir_get_if_local(item_def_id);
  if (!(node !== undefined && this.tcx.is_lang_item(TraitClause.def_id(pred), "Sized"))) {
    return;
  }

  const generics = hir.Node.generics(node);
  if (generics === undefined) {
    return;
  }
  const sized_trait = this.tcx.lang_items().sized_trait();
  // debug!(?generics.params);
  // debug!(?generics.predicates);
  const param = generics.params.find((param) => param.span === span);
  if (param === undefined) {
    return;
  }
  // Check that none of the explicit trait bounds is `Sized`. Assume that an explicit
  // `Sized` bound is there intentionally and we don't need to suggest relaxing it.
  let explicitly_sized = false;
  outer: for (const bp of generics.bounds_for_param(param.def_id)) {
    for (const bound of bp.bounds) {
      const tr = hir.GenericBound.trait_ref(bound);
      const tr_did = tr === undefined ? undefined : tr.trait_def_id();
      if (tr_did === sized_trait || (tr_did !== undefined && sized_trait !== undefined && DefId_eq(tr_did, sized_trait))) {
        explicitly_sized = true;
        break outer;
      }
    }
  }
  if (explicitly_sized) {
    return;
  }
  // debug!(?param);
  if (node.$ === "Item" && (node._0.kind.$ === "Enum" || node._0.kind.$ === "Struct" || node._0.kind.$ === "Union")) {
    // Only suggest indirection for uses of type parameters in ADTs.
    const item = node._0;
    if (this.suggest_indirection_for_unsized(err, item, param)) {
      return;
    }
  }

  // Didn't add an indirection suggestion, so add a general suggestion to relax `Sized`.
  let span_: Span, separator: string, open_paren_sp: Span | undefined;
  const bs = generics.bounds_span_for_suggestions(param.def_id);
  if (bs !== undefined) {
    const [s, open_paren_sp_] = bs;
    [span_, separator, open_paren_sp] = [s, " +", open_paren_sp_];
  } else {
    [span_, separator, open_paren_sp] = [Span.shrink_to_hi(hir.ParamName.ident(param.name).span), ":", undefined];
  }

  const suggs: [Span, string][] = [];
  const suggestion = `${separator} ?Sized`;

  if (open_paren_sp !== undefined) {
    suggs.push([open_paren_sp, "("]);
    suggs.push([span_, `)${suggestion}`]);
  } else {
    suggs.push([span_, suggestion]);
  }

  err.multipart_suggestion("consider relaxing the implicit `Sized` restriction", suggs, "MachineApplicable");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6627 suggest_indirection_for_unsized
TypeErrCtxt.prototype.suggest_indirection_for_unsized = function (this: TypeErrCtxt, err: Diag, item: hir.Item, param: hir.GenericParam): boolean {
  // Suggesting `T: ?Sized` is only valid in an ADT if `T` is only used in a
  // borrow. `struct S<'a, T: ?Sized>(&'a T);` is valid, `struct S<T: ?Sized>(T);`
  // is not. Look for invalid "bare" parameter uses, and suggest using indirection.
  const visitor = new FindTypeParam(hir.ParamName.ident(param.name).name);
  visitor.visit_item(item);
  if (visitor.invalid_spans.length === 0) {
    return false;
  }
  const multispan: MultiSpan = MultiSpan.from_Span(param.span);
  multispan.push_span_label(param.span, `this could be changed to \`${display_Ident(hir.ParamName.ident(param.name))}: ?Sized\`...`);
  for (const sp of visitor.invalid_spans) {
    multispan.push_span_label(sp, `...if indirection were used here: \`Box<${display_Ident(hir.ParamName.ident(param.name))}>\``);
  }
  const T = display_Ident(hir.ParamName.ident(param.name));
  err.span_help(
    multispan,
    `you could relax the implicit \`Sized\` bound on \`${T}\` if it were used through indirection like \`&${T}\` or \`Box<${T}>\``,
  );
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6662 suggest_swapping_lhs_and_rhs
TypeErrCtxt.prototype.suggest_swapping_lhs_and_rhs = function <T>(
  this: TypeErrCtxt,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const tcx = this.tcx;
  const predicate = upcast_from_T(predicate_, as_interner(tcx));
  let typeck_results: TypeckResults | undefined, lhs_node: hir.Node, rhs_node: hir.Node, lhs_ty: Ty | undefined, rhs_ty: Ty | undefined;
  if (
    cause_code.$ === "BinOp" &&
    (typeck_results = this.typeck_results) !== undefined &&
    (lhs_node = tcx.hir_node(cause_code.lhs_hir_id)).$ === "Expr" &&
    (rhs_node = tcx.hir_node(cause_code.rhs_hir_id)).$ === "Expr" &&
    (lhs_ty = typeck_results.expr_ty_opt(lhs_node._0)) !== undefined &&
    (rhs_ty = typeck_results.expr_ty_opt(rhs_node._0)) !== undefined
  ) {
    const { lhs_hir_id, rhs_span } = cause_code;
    const pred = predicate.as_trait_clause();
    if (
      pred !== undefined &&
      tcx.is_lang_item(PolyTraitClauseC.def_id(pred), "PartialEq") &&
      EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(PolyTraitClauseC.def_id(pred), [rhs_ty, lhs_ty], param_env))
    ) {
      const lhs_span = tcx.hir_span(lhs_hir_id);
      const sm = tcx.sess.source_map();
      const rhs_snippet = sm.span_to_snippet(rhs_span);
      let lhs_snippet: ReturnType<typeof sm.span_to_snippet>;
      if (rhs_snippet.$ === "Ok" && (lhs_snippet = sm.span_to_snippet(lhs_span)).$ === "Ok") {
        err.note(`\`${display_Ty(rhs_ty)}\` implements \`PartialEq<${display_Ty(lhs_ty)}>\``);
        err.multipart_suggestion(
          "consider swapping the equality",
          [
            [lhs_span, rhs_snippet._0.toString()],
            [rhs_span, lhs_snippet._0.toString()],
          ],
          "MaybeIncorrect",
        );
      }
    }
  }
};

/// Checks whether the field independently satisfies the trait bound, ignoring
/// the specific generic parameter that caused the original E0277 error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6708 is_truly_imperfect_derive
TypeErrCtxt.prototype.is_truly_imperfect_derive = function (
  this: TypeErrCtxt,
  parent_trait_pred: PolyTraitClause,
  predicate: Predicate,
  param_env: ParamEnv,
): boolean {
  const tcx = this.tcx;
  const sk = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)).kind();
  if (sk.$ !== "Adt") {
    return false;
  }
  const [adt_def, parent_args] = [sk._0, sk._1];
  const trait_clause = predicate.as_trait_clause();
  if (trait_clause === undefined) {
    return false;
  }
  const failing_ty = TraitClause.self_ty(Binder.skip_binder(trait_clause));
  const trait_def_id = PolyTraitClauseC.def_id(parent_trait_pred);

  const failing_adt_param_indices = new Set<number>();
  parent_args.forEach((arg, idx) => {
    const t = GenericArg.as_type(arg);
    if (t !== undefined && t === failing_ty) {
      failing_adt_param_indices.add(idx);
    }
  });

  if (failing_adt_param_indices.size === 0) {
    return false;
  }

  for (const field of adt_def.all_fields()) {
    const ok = ((): boolean => {
      const raw_field_ty = EarlyBinder.skip_binder(tcx.type_of(field.did) as EarlyBinder<Ty>);
      // If the field type is exactly one of the failing parameters, it is not an imperfect derive.
      const rk = raw_field_ty.kind();
      if (rk.$ === "Param" && failing_adt_param_indices.has(rk._0.index)) {
        return false;
      }
      // If the field type doesn't mention the parameter at all, it's independent.
      let mentions = false;
      for (const arg of raw_field_ty.walk()) {
        const t = GenericArg.as_type(arg);
        const tk = t === undefined ? undefined : t.kind();
        if (tk !== undefined && tk.$ === "Param" && failing_adt_param_indices.has(tk._0.index)) {
          mentions = true;
          break;
        }
      }
      if (!mentions) {
        return true;
      }

      return this.probe((_) => {
        // We keep the generic parameters that didn't fail as-is from the parent args,
        // but replace the ones that did fail with fresh inference variable placeholders.
        const fresh_args = RawList.for_item(tcx, adt_def.did(), (param, _) => {
          if (failing_adt_param_indices.has(param.index)) {
            return this.var_for_def(DUMMY_SP, param);
          } else {
            return parent_args[param.index];
          }
        });

        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, fresh_args));
        // Substitute the field's type for the bound's `Self` type to check whether
        // the field alone would satisfy the trait, independent of other generics.
        const parent_trait_args = Binder.skip_binder(parent_trait_pred).trait_ref.args;
        const trait_args = parent_trait_args.map((arg): GenericArg => {
          if (GenericArg.as_type(arg) === TraitClause.self_ty(Binder.skip_binder(parent_trait_pred))) {
            return field_ty;
          } else {
            return arg;
          }
        });
        const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, TraitRef.new(as_interner(tcx), trait_def_id, trait_args), upcast_TraitRef);
        return this.predicate_may_hold(obligation);
      });
    })();
    if (!ok) {
      return false;
    }
  }
  return true;
};

/// Add a hint to add a missing borrow or remove an unnecessary one.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6792 hint_missing_borrow
export function hint_missing_borrow(
  infcx: InferCtxt,
  param_env: ParamEnv,
  span: Span,
  found: Ty,
  expected: Ty,
  found_node: hir.Node,
  err: Diag,
): void {
  if (found_node.$ === "TraitItem") {
    return;
  }

  const fk = found.kind();
  let found_args: readonly Ty[];
  if (fk.$ === "FnPtr") {
    found_args = infcx.enter_forall(fk._0, (sig_tys) => FnSigTys.inputs(sig_tys), d_FnSigTys);
  } else {
    return span_bug(span, `found was converted to a FnPtr above but is now ${format_debug(fk, debug_TyKind, PLAIN)}`);
  }
  const ek = expected.kind();
  let expected_args: readonly Ty[];
  if (ek.$ === "FnPtr") {
    expected_args = infcx.enter_forall(ek._0, (sig_tys) => FnSigTys.inputs(sig_tys), d_FnSigTys);
  } else {
    return span_bug(span, `expected was converted to a FnPtr above but is now ${format_debug(ek, debug_TyKind, PLAIN)}`);
  }

  // This could be a variant constructor, for example.
  const fn_decl = hir.Node.fn_decl(found_node);
  if (fn_decl === undefined) {
    return;
  }

  const args = fn_decl.inputs;

  const to_borrow: [Span, string][] = [];
  const remove_borrow: [Span, string][] = [];

  const n = Math.min(found_args.length, expected_args.length, args.length);
  for (let i = 0; i < n; i++) {
    const [found_arg, expected_arg, arg] = [found_args[i], expected_args[i], args[i]];
    const [found_ty, found_refs] = get_deref_type_and_refs(found_arg);
    const [expected_ty, expected_refs] = get_deref_type_and_refs(expected_arg);

    if (infcx.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty)) {
      // FIXME: This could handle more exotic cases like mutability mismatches too!
      if (
        found_refs.length < expected_refs.length &&
        found_refs.every((m, j) => m === expected_refs[expected_refs.length - found_refs.length + j])
      ) {
        to_borrow.push([
          Span.shrink_to_lo(arg.span),
          expected_refs
            .slice(0, expected_refs.length - found_refs.length)
            .map((mutbl) => `&${Mutability.prefix_str(mutbl)}`)
            .join(""),
        ]);
      } else if (found_refs.length > expected_refs.length) {
        let span = Span.shrink_to_lo(arg.span);
        let left = found_refs.length - expected_refs.length;
        let ty = arg;
        while (ty.kind.$ === "Ref" && left > 0) {
          const inner_ty = ty.kind._1;
          span = Span.with_hi(span, Span.lo(inner_ty.span));
          ty = inner_ty;
          left -= 1;
        }
        if (left === 0) {
          remove_borrow.push([span, ""]);
        }
      }
    }
  }

  if (to_borrow.length !== 0) {
    err.subdiagnostic(diagnostics_mod().AdjustSignatureBorrow_subdiagnostic({ $: "Borrow", to_borrow }));
  }

  if (remove_borrow.length !== 0) {
    err.subdiagnostic(diagnostics_mod().AdjustSignatureBorrow_subdiagnostic({ $: "RemoveBorrow", remove_borrow }));
  }
}

/// Suggest a new type parameter name for diagnostic purposes.
///
/// `name` is the preferred name you'd like to suggest if it's not in use already.
// PORT: the trait's only impl is for `&[hir::GenericParam]`; `NextTypeParamName` is an interface over that slice and the
// impl's method is the free fn `next_type_param_name(self_, name)` (also on the companion `NextTypeParamName`).
export interface NextTypeParamName {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6966 next_type_param_name
  next_type_param_name(name: string | undefined): string;
}

// impl NextTypeParamName for &[hir::GenericParam<'_>]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6970 next_type_param_name
export function next_type_param_name(self_: readonly hir.GenericParam[], name_: string | undefined): string {
  // Type names are usually single letters in uppercase. So convert the first letter of input string to uppercase.
  const first = name_ === undefined ? undefined : name_.codePointAt(0);
  const name = first === undefined ? undefined : String.fromCodePoint(...to_uppercase(first));

  // This is the list of possible parameter names that we might suggest.
  const possible_names = [name ?? "T", "T", "U", "V", "X", "Y", "Z", "A", "B", "C"];

  // Filter out used names based on `filter_fn`.
  const used_names: Symbol[] = [];
  for (const param of self_) {
    if (param.name.$ === "Plain") {
      used_names.push(param.name._0.name);
    }
  }

  // Find a name from `possible_names` that is not in `used_names`.
  return possible_names.find((n) => !used_names.includes(Symbol.intern(n))) ?? "ParamName";
}
/** `impl NextTypeParamName for &[hir::GenericParam]` as a companion. */
export const NextTypeParamName = { next_type_param_name };


// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6997 ReplaceImplTraitVisitor
/// Collect the spans that we see the generic param `param_did`
// PORT: `ty_spans: &'a mut Vec<Span>` is the caller's array (mutated in place).
export class ReplaceImplTraitVisitor extends hir.intravisit.Visitor {
  constructor(
    public ty_spans: Span[],
    public param_did: DefId,
  ) {
    super();
  }

  // impl<'a, 'hir> hir::intravisit::Visitor<'hir> for ReplaceImplTraitVisitor<'a>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7003 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    if (t.kind.$ === "Path" && t.kind._0.$ === "Resolved" && t.kind._0._0 === undefined && t.kind._0._1.res.$ === "Def") {
      const segment_did = t.kind._0._1.res._1;
      if (DefId_eq(this.param_did, segment_did)) {
        // `fn foo(t: impl Trait)`
        //            ^^^^^^^^^^ get this to suggest `T` instead

        // There might be more than one `impl Trait`.
        this.ty_spans.push(t.span);
        return undefined;
      }
    }

    hir.intravisit.walk_ty(this, t);
    return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7023 get_explanation_based_on_obligation
export function get_explanation_based_on_obligation(
  tcx: TyCtxt,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClause,
  pre_message: string,
  long_ty_path: MutRef<PathBuf | undefined>,
): string {
  if (obligation.cause.code_().$ === "MainFunctionType") {
    return "consider using `()`, or a `Result`";
  } else {
    let ty_desc: string | undefined;
    const sk = Binder.skip_binder(PolyTraitClauseC.self_ty(trait_predicate)).kind();
    if (sk.$ === "FnDef") {
      ty_desc = "fn item";
    } else if (sk.$ === "Closure") {
      ty_desc = "closure";
    } else {
      ty_desc = undefined;
    }

    const desc = ty_desc !== undefined ? ` ${ty_desc}` : "";
    if (PolyTraitClauseC.polarity(trait_predicate) === "Positive") {
      // If the trait in question is unstable, mention that fact in the diagnostic.
      // But if we're building with `-Zforce-unstable-if-unmarked` then _any_ trait
      // not explicitly marked stable is considered unstable, so the extra text is
      // unhelpful noise. See <https://github.com/rust-lang/rust/issues/152692>.
      const mention_unstable =
        !tcx.sess.opts.unstable_opts.force_unstable_if_unmarked &&
        ((): boolean | undefined => {
          const stab = tcx.lookup_stability(PolyTraitClauseC.def_id(trait_predicate)) as Stability | undefined;
          return stab === undefined ? undefined : StabilityLevel.is_stable(stab.level);
        })() === false;
      const unstable = mention_unstable ? "nightly-only, unstable " : "";

      return `${pre_message}the ${unstable}trait \`${display_Binder_TraitClausePrintModifiersAndPath(
        PolyTraitClause_print_modifiers_and_trait_path(trait_predicate),
      )}\` is not implemented for${desc} \`${tcx.short_string(Binder.skip_binder(PolyTraitClauseC.self_ty(trait_predicate)), long_ty_path, print_Ty)}\``;
    } else {
      // "the trait bound `T: !Send` is not satisfied" reads better than "`!Send` is
      // not implemented for `T`".
      // FIXME: add note explaining explicit negative trait bounds.
      return `${pre_message}the trait bound \`${display_PolyTraitClause(trait_predicate)}\` is not satisfied`;
    }
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7068 ReplaceImplTraitFolder
// Replace `param` with `replace_ty`
export class ReplaceImplTraitFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public param: GenericParamDef,
    public replace_ty: Ty,
  ) {}

  // impl<'tcx> TypeFolder<TyCtxt<'tcx>> for ReplaceImplTraitFolder<'tcx>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7075 fold_ty
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (k.$ === "Param") {
      const index = k._0.index;
      if (this.param.index === index) {
        return this.replace_ty;
      }
    }
    return fold_Ty.super_fold_with(t, this);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7084 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // (provided)
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7089 suggest_desugaring_async_fn_to_impl_future_in_trait
export function suggest_desugaring_async_fn_to_impl_future_in_trait(
  tcx: TyCtxt,
  sig: hir.FnSig,
  body: hir.TraitFn,
  opaque_def_id: LocalDefId,
  add_bounds: string,
): [Span, string][] | undefined {
  const asyncness = sig.header.asyncness;
  if (asyncness.$ !== "Async") {
    return undefined;
  }
  const async_span = tcx.sess.source_map().span_extend_while_whitespace(asyncness._0);

  const future = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(opaque_def_id));
  if (!(future.bounds.length === 1 && future.bounds[0].$ === "Trait")) {
    // `async fn` should always lower to a single bound... but don't ICE.
    return undefined;
  }
  const trait_ref = future.bounds[0]._0;
  const last = trait_ref.trait_ref.path.segments[trait_ref.trait_ref.path.segments.length - 1];
  if (last === undefined || last.args === undefined) {
    // desugaring to a single path segment for `Future<...>`.
    return undefined;
  }
  const args = last.args;
  const first_constraint = args.constraints[0];
  const future_output_ty = first_constraint === undefined ? undefined : first_constraint.ty();
  if (future_output_ty === undefined) {
    // Also should never happen.
    return undefined;
  }

  let sugg: [Span, string][];
  if (Span.is_empty(future_output_ty.span)) {
    sugg = [
      [async_span, ""],
      [future_output_ty.span, ` -> impl std::future::Future<Output = ()>${add_bounds}`],
    ];
  } else {
    sugg = [
      [Span.shrink_to_lo(future_output_ty.span), "impl std::future::Future<Output = "],
      [Span.shrink_to_hi(future_output_ty.span), `>${add_bounds}`],
      [async_span, ""],
    ];
  }

  // If there's a body, we also need to wrap it in `async {}`
  if (body.$ === "Provided") {
    const body_ = tcx.hir_body(body._0);
    const body_span = body_.value.span;
    const body_span_without_braces = Span.with_hi(
      Span.with_lo(body_span, (Span.lo(body_span) + 1) as BytePos),
      (Span.hi(body_span) - 1) as BytePos,
    );
    if (Span.is_empty(body_span_without_braces)) {
      sugg.push([body_span_without_braces, " async {} "]);
    } else {
      sugg.push([Span.shrink_to_lo(body_span_without_braces), "async {"], [Span.shrink_to_hi(body_span_without_braces), "} "]);
    }
  }

  return sugg;
}

/// On `impl` evaluation cycles, look for `Self::AssocTy` restrictions in `where` clauses, explain
/// they are not allowed and if possible suggest alternatives.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7154 point_at_assoc_type_restriction
export function point_at_assoc_type_restriction(
  tcx: TyCtxt,
  err: Diag,
  self_ty_str: string,
  trait_name: string,
  predicate: Predicate,
  generics: hir.Generics,
  data: ImplDerivedCause,
): void {
  const pk = Binder.skip_binder(predicate.kind());
  if (pk.$ !== "Clause") {
    return;
  }
  const clause = pk._0;
  if (clause.$ !== "Projection") {
    return;
  }
  const proj = clause._0;
  const rpitit = tcx.opt_rpitit_info(ProjectionClause.def_id(proj));
  let name: Symbol | undefined;
  if (rpitit !== undefined) {
    if (rpitit.$ === "Trait") {
      name = tcx.item_name(rpitit.fn_def_id);
    } else {
      name = undefined;
    }
  }
  if (name === undefined) {
    name = tcx.opt_item_name(ProjectionClause.def_id(proj));
  }
  if (name === undefined) {
    return;
  }
  const name_ = name;
  const predicates = generics.predicates;
  let prev: [hir.WhereBoundPredicate, Span] | undefined;
  for (let pi = 0; pi < predicates.length; pi++) {
    const pred_ = predicates[pi];
    const curr_span = pred_.span;
    if (pred_.kind.$ !== "BoundPredicate") {
      continue;
    }
    const pred = pred_.kind._0;
    for (const bound of pred.bounds) {
      const trait_ref = hir.GenericBound.trait_ref(bound);
      if (trait_ref === undefined) {
        continue;
      }
      if (hir.GenericBound.span(bound) !== data.span) {
        continue;
      }
      let path: hir.QPath, ty: hir.Ty, segment: hir.PathSegment, inner_path_: hir.QPath, inner_path: hir.Path;
      if (
        pred.bounded_ty.kind.$ === "Path" &&
        ((path = pred.bounded_ty.kind._0), true) &&
        path.$ === "TypeRelative" &&
        (([ty, segment] = [path._0, path._1]), true) &&
        segment.ident.name === name_ &&
        ty.kind.$ === "Path" &&
        ((inner_path_ = ty.kind._0), true) &&
        inner_path_.$ === "Resolved" &&
        inner_path_._0 === undefined &&
        ((inner_path = inner_path_._1), true) &&
        inner_path.res.$ === "SelfTyAlias"
      ) {
        // The following block is to determine the right span to delete for this bound
        // that will leave valid code after the suggestion is applied.
        let span: Span;
        let next_pred: hir.WherePredicate | undefined;
        if (
          pred.origin === "WhereClause" &&
          generics.predicates.filter((p) => p.kind.$ === "BoundPredicate" && "WhereClause" === p.kind._0.origin).length === 1
        ) {
          // There's only one `where` bound, that needs to be removed. Remove the whole
          // `where` clause.
          span = generics.where_clause_span;
        } else if (
          (next_pred = predicates[pi + 1]) !== undefined &&
          next_pred.kind.$ === "BoundPredicate" &&
          pred.origin === next_pred.kind._0.origin
        ) {
          // There's another bound, include the comma for the current one.
          span = Span.until(curr_span, next_pred.span);
        } else if (prev !== undefined && pred.origin === prev[0].origin) {
          const prev_span = prev[1];
          // Last bound, try to remove the previous comma.
          span = Span.to(Span.shrink_to_hi(prev_span), curr_span);
        } else if (pred.origin === "WhereClause") {
          span = Span.with_hi(curr_span, Span.hi(generics.where_clause_span));
        } else {
          span = curr_span;
        }

        err.span_suggestion_verbose(
          span,
          "associated type for the current `impl` cannot be restricted in `where` clauses, remove this bound",
          "",
          "MaybeIncorrect",
        );
      }
      const new_ = AssocItems.find_by_ident_and_kind(
        tcx.associated_items(data.impl_or_alias_def_id) as AssocItems,
        tcx,
        Ident.with_dummy_span(name_),
        "Type",
        data.impl_or_alias_def_id,
      );
      if (new_ !== undefined) {
        // The associated type is specified in the `impl` we're
        // looking at. Point at it.
        const span = tcx.def_span(new_.def_id);
        err.span_label(span, `associated type \`<${self_ty_str} as ${trait_name}>::${display_Symbol(name_)}\` is specified here`);
        // Search for the associated type `Self::{name}`, get
        // its type and suggest replacing the bound with it.
        const visitor = new SelfVisitor(undefined, name_);
        visitor.visit_trait_ref(trait_ref);
        for (const path of visitor.paths) {
          err.span_suggestion_verbose(
            path.span,
            "replace the associated type with the type specified in this `impl`",
            display_Ty(EarlyBinder.skip_binder(tcx.type_of(new_.def_id) as EarlyBinder<Ty>)),
            "MachineApplicable",
          );
        }
      } else {
        const visitor = new SelfVisitor(undefined, undefined);
        visitor.visit_trait_ref(trait_ref);
        const span: MultiSpan = MultiSpan.from_Vec(visitor.paths.map((p) => p.span));
        err.span_note(span, "associated types for the current `impl` cannot be restricted in `where` clauses");
      }
    }
    prev = [pred, curr_span];
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7291 get_deref_type_and_refs
export function get_deref_type_and_refs(ty_: Ty): [Ty, Mutability[]] {
  let ty = ty_;
  const refs: Mutability[] = [];

  let k: TyKind;
  while ((k = ty.kind()).$ === "Ref") {
    ty = k._1;
    refs.push(k._2);
  }

  return [ty, refs];
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7304 FindTypeParam
/// Look for type `param` in an ADT being used only through a reference to confirm that suggesting
/// `param: ?Sized` would be a valid constraint.
// PORT: the default field values (`= Vec::new()`, `= false`) are the constructor's defaults.
export class FindTypeParam extends hir.intravisit.Visitor {
  constructor(
    public param: Symbol,
    public invalid_spans: Span[] = [],
    public nested: boolean = false,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for FindTypeParam

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7311 visit_where_predicate
  override visit_where_predicate(_: hir.WherePredicate): undefined {
    // Skip where-clauses, to avoid suggesting indirection for type parameters found there.
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7315 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    // We collect the spans of all uses of the "bare" type param, like in `field: T` or
    // `field: (T, T)` where we could make `T: ?Sized` while skipping cases that are known to be
    // valid like `field: &'a T` or `field: *mut T` and cases that *might* have further `Sized`
    // obligations like `Box<T>` and `Vec<T>`, but we perform no extra analysis for those cases
    // and suggest `T: ?Sized` regardless of their obligations. This is fine because the errors
    // in that case should make what happened clear enough.
    const k = ty.kind;
    if (k.$ === "Ptr" || k.$ === "Ref" || k.$ === "TraitObject") {
      // (nothing)
    } else if (
      k.$ === "Path" &&
      k._0.$ === "Resolved" &&
      k._0._0 === undefined &&
      k._0._1.segments.length === 1 &&
      k._0._1.segments[0].ident.name === this.param
    ) {
      if (!this.nested) {
        // debug!(?ty, "FindTypeParam::visit_ty");
        this.invalid_spans.push(ty.span);
      }
    } else if (k.$ === "Path") {
      const prev = this.nested;
      this.nested = true;
      hir.intravisit.walk_ty(this, ty);
      this.nested = prev;
    } else {
      hir.intravisit.walk_ty(this, ty);
    }
    return undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7348 ParamFinder
/// Look for type parameters in predicates. We use this to identify whether a bound is suitable in
/// on a given item.
// PORT: the default field value (`= Vec::new()`) is the constructor's default.
export class ParamFinder implements TypeVisitor<undefined> {
  constructor(public params: Symbol[] = []) {}

  readonly Result = VisitorResult.unit;

  // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ParamFinder

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7353 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Param") {
      this.params.push(k._0.name);
    }
    return fold_Ty.super_visit_with(t, this);
  }

  // (provided)
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }

  // impl ParamFinder

  /// Whether the `hir::Generics` of the current item can suggest the evaluated bound because its
  /// references to type parameters are present in the generics.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7365 can_suggest_bound
  can_suggest_bound(generics: hir.Generics): boolean {
    if (this.params.length === 0) {
      // There are no references to type parameters at all, so suggesting the bound
      // would be reasonable.
      return true;
    }
    return generics.params.some((p) => {
      if (p.name.$ === "Plain") {
        const p_name = p.name._0;
        // All of the parameters in the bound can be referenced in the current item.
        return this.params.some((p) => p === p_name.name || p === kw.SelfUpper);
      }
      return true;
    });
  }
}

// ---- lane errrep-sugg-c helpers ----

/** `impl Display for ty::Binder<'tcx, TraitClause>` (rustc_type_ir ir_print.rs:89 through `IrPrint` for `TyCtxt`). */
function display_PolyTraitClause(self: PolyTraitClause): string {
  return IrPrint_print(self, { alternate: false }, (v, p) => print_Binder(v, p, print_TraitClause, d_TraitClause));
}

/** `impl Display for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (ir_print.rs:89 through `IrPrint` for `TyCtxt`). */
function display_Binder_TraitClausePrintModifiersAndPath(self: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(self, { alternate: false }, (v, p) =>
    print_Binder(v, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath),
  );
}

/** The generated `TypeFoldable` impl fns of `TraitClause` as a descriptor. */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
const d_Binder_Ty = (): TypeFoldable<Binder<Ty>> => fold_Binder(fold_Ty);
/** The derived `TypeFoldable` of `ProjectionClause`. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
/** The derived `TypeFoldable` of `AliasTerm` (`Alias<AliasTermKind>`). */
const d_AliasTerm: TypeFoldable<AliasTermT> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};
/** The derived `TypeFoldable` of `FnSigTys`. */
const d_FnSigTys: TypeFoldable<FnSigTysT> = {
  visit_with: visit_with_FnSigTys,
  try_fold_with: try_fold_with_FnSigTys,
  fold_with: fold_with_FnSigTys,
};
/**
 * pretty.rs:3057 `#[derive(TypeFoldable, TypeVisitable, Lift)] struct TraitClausePrintModifiersAndPath(ty::TraitClause)`:
 * the derive forwards to the single field.
 */
// PORT: hand-written derive (the struct is hand-written in pretty.ts; no generated impls yet).
const d_TraitClausePrintModifiersAndPath: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};
/** `T: Upcast<TyCtxt, Predicate>` descriptors (the `Interner` parameter is the `TyCtxt`). */
const upcast_PolyTraitClause = Predicate_upcast_from_PolyTraitClause as unknown as (from: PolyTraitClause, tcx: Interner) => Predicate;
const upcast_PolyTraitRef = Predicate_upcast_from_PolyTraitRef as unknown as (from: Binder<TraitRefT>, tcx: Interner) => Predicate;
const upcast_TraitRef = Predicate_upcast_from_TraitRef as unknown as (from: TraitRefT, tcx: Interner) => Predicate;
const upcast_Binder_PredicateKind = Predicate_upcast_from_Binder_PredicateKind as unknown as (from: Binder<PredicateKind>, tcx: Interner) => Predicate;

/** Same-crate modules, read lazily (init order: see the header). */
function traits_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
function engine_mod(): typeof import("../../traits/engine.ts") {
  return require("../../traits/engine.ts") as typeof import("../../traits/engine.ts");
}
function diagnostics_mod(): typeof import("../../diagnostics.ts") {
  return require("../../diagnostics.ts") as typeof import("../../diagnostics.ts");
}
