//! Check properties that are required by built-in traits and set
//! up data structures required by type-checking/codegen.
//
// Port of compiler/rustc_hir_analysis/src/coherence/builtin.rs (lane coherence).
//
// PORT notes (file-wide):
// - `debug!` is tracing only and stays as a comment.
// - `Result::and` evaluates its argument eagerly (the local `and`); `?` is an early return of the `Err`.
// - Iterator chains (`filter_map(..).collect()`) are loops in the same order; their closures' side effects (emitted
//   diagnostics) happen in the same order as upstream's.
// - `BTreeMap<(String, String), Vec<Span>>` (`infringing_fields_error`) is a `Map` iterated in key order: keys are
//   compared as Rust's `(String, String)` `Ord` (byte-wise, `cmp_String`).
// - `TypeErrCtxt` (`err_ctxt()`, wave 19) is pending: a view at the end of this file, whose placeholder stops as
//   UNPORTED. `ty::Pattern` is pending in rustc_middle (ty/decls.ts): its `Display` is a stand-in too.
// - Layout (`tcx.layout_of`, `LayoutData::is_1zst`) is M4: the query stops at its placeholder provider.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { type InfringingFieldsReason, type_allowed_to_implement_const_param_ty, type_allowed_to_implement_copy } from "../../rustc_trait_selection/traits/misc.ts";
import { VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { Safety } from "../../rustc_hir/lib.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import type { RegionResolutionError } from "../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import { display_GenericKind } from "../../rustc_infer/infer/region_constraints/mod.ts";
import "../../rustc_infer/lib.ts";
import type { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { Obligation, type PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause, clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { CoerceUnsizedInfo, CustomCoerceUnsized } from "../../rustc_middle/ty/adjustment.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { FieldIdx } from "../../rustc_middle/ty/decls.ts";
import { display_Pattern } from "../../rustc_middle/ty/pattern.ts";
import { suggest_constraining_type_params } from "../../rustc_middle/ty/diagnostics.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { EarlyParamRegion } from "../../rustc_middle/ty/region.ts";
import { type FieldDef, type ImplTraitHeader, type ParamEnv, Ty, TypingEnv, Visibility } from "../../rustc_middle/ty/mod.ts";
import { display_Predicate, display_TraitRefPrintSugared, display_Ty, TraitRef_print_trait_sugared } from "../../rustc_middle/ty/print/pretty.ts";
import { type Predicate, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, debug_DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { type Ident, kw, type Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { TypeError } from "../../rustc_type_ir/error.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { utf8 } from "../../std/str.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import * as coerce_shared from "./builtin/coerce_shared.ts";

// mod coerce_shared;
export { coerce_shared };

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/** `impl_header.trait_ref.instantiate_identity().skip_norm_wip()` */
function trait_ref_identity(impl_header: ImplTraitHeader): TraitRefT {
  return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_header.trait_ref));
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:32 check_trait
export function check_trait(tcx: TyCtxt, trait_def_id: DefId, impl_def_id: LocalDefId, impl_header: ImplTraitHeader): Result<null, ErrorGuaranteed> {
  const checker: Checker = { tcx, impl_def_id, impl_header };
  switch (tcx.as_lang_item(trait_def_id)) {
    case LangItem.Drop:
      return visit_implementation_of_drop(checker);
    case LangItem.AsyncDrop:
      return visit_implementation_of_drop(checker);
    case LangItem.Copy:
      return visit_implementation_of_copy(checker);
    case LangItem.Unpin:
      return visit_implementation_of_unpin(checker);
    case LangItem.ConstParamTy:
      return visit_implementation_of_const_param_ty(checker);
    case LangItem.CoerceUnsized:
      return visit_implementation_of_coerce_unsized(checker);
    case LangItem.Reborrow:
      return visit_implementation_of_reborrow(checker);
    case LangItem.CoerceShared:
      return visit_implementation_of_coerce_shared(checker);
    case LangItem.DispatchFromDyn:
      return visit_implementation_of_dispatch_from_dyn(checker);
    case LangItem.CoercePointeeValidated:
      return visit_implementation_of_coerce_pointee_validity(checker);
    default:
      return Ok(null);
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin.rs:56 Checker
interface Checker {
  tcx: TyCtxt;
  impl_def_id: LocalDefId;
  impl_header: ImplTraitHeader;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:62 visit_implementation_of_drop
function visit_implementation_of_drop(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_did = checker.impl_def_id;
  // Destructors only work on local ADT types.
  const k = TraitRef.self_ty(trait_ref_identity(checker.impl_header)).kind();
  if (k.$ === "Adt" && (k._0 as AdtDef).did().is_local()) {
    return Ok(null);
  } else if (k.$ === "Error") {
    return Ok(null);
  }

  const impl_ = tcx.hir_expect_item(impl_did).expect_impl();

  return Err(
    tcx.dcx().emit_err(
      diagnostics.DropImplOnWrongItem_diagnostic({
        span: impl_.self_ty.span,
        trait_: tcx.item_name(EarlyBinder.skip_binder(checker.impl_header.trait_ref).def_id),
      }),
    ),
  );
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:80 visit_implementation_of_copy
function visit_implementation_of_copy(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_header = checker.impl_header;
  const impl_did = checker.impl_def_id;
  // debug!("visit_implementation_of_copy: impl_did={:?}", impl_did);

  const self_type = TraitRef.self_ty(trait_ref_identity(impl_header));
  // debug!("visit_implementation_of_copy: self_type={:?} (bound)", self_type);

  const param_env = tcx.param_env(impl_did) as ParamEnv;
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_type, fold_Ty), "assertion failed: !self_type.has_escaping_bound_vars()");

  // debug!("visit_implementation_of_copy: self_type={:?} (free)", self_type);

  if (impl_header.polarity === "Negative") {
    return Ok(null);
  }

  const cause = ObligationCause.misc(DUMMY_SP, impl_did);
  const r = type_allowed_to_implement_copy(tcx, param_env, self_type, cause, impl_header.safety);
  if (r.$ === "Ok") {
    return Ok(null);
  }
  const e = r._0;
  switch (e.$) {
    case "InfringingFields": {
      const fields = e._0;
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(
        infringing_fields_error(
          tcx,
          fields.map(([field, ty, reason]) => [tcx.def_span(field.did), ty, reason]),
          LangItem.Copy,
          impl_did,
          span,
        ),
      );
    }
    case "NotAnAdt": {
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(tcx.dcx().emit_err(diagnostics.CopyImplOnNonAdt_diagnostic({ span })));
    }
    case "HasDestructor": {
      const did = e._0;
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      const impl_ = tcx.def_span(did);
      return Err(
        tcx.dcx().emit_err(
          diagnostics.TraitImplOnTypeWithDtor_diagnostic({
            span,
            impl_,
            trait_name: sym.Copy,
          }),
        ),
      );
    }
    case "HasUnsafeFields": {
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(tcx.dcx().span_delayed_bug(span, `cannot implement \`Copy\` for \`${display_Ty(self_type)}\``));
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:133 visit_implementation_of_unpin
function visit_implementation_of_unpin(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_header = checker.impl_header;
  const impl_did = checker.impl_def_id;
  // debug!("visit_implementation_of_unpin: impl_did={:?}", impl_did);

  const self_type = TraitRef.self_ty(trait_ref_identity(impl_header));
  // debug!("visit_implementation_of_unpin: self_type={:?}", self_type);

  const span = tcx.def_span(impl_did);

  if (tcx.features().pin_ergonomics()) {
    const k = self_type.kind();
    if (k.$ === "Adt" && (k._0 as AdtDef).is_pin_project()) {
      // Soundness concerns: a type `T` annotated with `#[pin_v2]` is allowed to project
      // `Pin<&mut T>` to its field `Pin<&mut U>` safely (even if `U: !Unpin`).
      // If `T` is allowed to impl `Unpin` manually (note that `Unpin` is a safe trait,
      // which cannot carry safety properties), then `&mut U` could be obtained from
      // `&mut T` that dereferenced by `Pin<&mut T>`, which breaks the safety contract of
      // `Pin<&mut U>` for `U: !Unpin`.
      const adt = k._0 as AdtDef;
      return Err(
        tcx.dcx().emit_err(
          diagnostics.ImplUnpinForPinProjectedType_diagnostic({
            span,
            adt_span: tcx.def_span(adt.did()),
            adt_name: tcx.item_name(adt.did()),
          }),
        ),
      );
    } else if (k.$ === "Adt") {
      // ty::Adt(_, _) => {}
    } else if (k.$ === "Foreign") {
      // `extern type`s have no fields, so they can't be structurally pinned.
    } else {
      return Err(tcx.dcx().span_delayed_bug(span, "impl of `Unpin` for a non-adt type"));
    }
  }
  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:170 visit_implementation_of_const_param_ty
function visit_implementation_of_const_param_ty(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const header = checker.impl_header;
  const impl_did = checker.impl_def_id;
  const self_type = TraitRef.self_ty(trait_ref_identity(header));
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_type, fold_Ty), "assertion failed: !self_type.has_escaping_bound_vars()");

  const param_env = tcx.param_env(impl_did) as ParamEnv;

  if (header.polarity === "Negative") {
    return Ok(null);
  }

  if (tcx.features().const_param_ty_unchecked()) {
    return Ok(null);
  }

  if (!tcx.features().adt_const_params()) {
    const k = self_type.kind();
    if (k.$ === "Adt" && (k._0 as AdtDef).is_struct()) {
      const adt = k._0 as AdtDef;
      const struct_vis = tcx.visibility(adt.did());
      for (const variant of adt.variants()) {
        for (const field of variant.fields) {
          if (Visibility.greater_than(struct_vis, field.vis, tcx)) {
            const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
            return Err(tcx.dcx().emit_err(diagnostics.ConstParamTyFieldVisMismatch_diagnostic({ span })));
          }
        }
      }
    }
  }

  const cause = ObligationCause.misc(DUMMY_SP, impl_did);
  const r = type_allowed_to_implement_const_param_ty(tcx, param_env, self_type, cause);
  if (r.$ === "Ok") {
    return Ok(null);
  }
  const e = r._0;
  switch (e.$) {
    case "InfrigingFields": {
      const fields = e._0;
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(
        infringing_fields_error(
          tcx,
          fields.map(([field, ty, reason]) => [tcx.def_span(field.did), ty, reason]),
          LangItem.ConstParamTy,
          impl_did,
          span,
        ),
      );
    }
    case "NotAnAdtOrBuiltinAllowed": {
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(tcx.dcx().emit_err(diagnostics.ConstParamTyImplOnNonAdt_diagnostic({ span })));
    }
    case "NonExhaustive": {
      const attr_span = e._0;
      const defn_span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(tcx.dcx().emit_err(diagnostics.ConstParamTyImplOnNonExhaustive_diagnostic({ defn_span, attr_span })));
    }
    case "InvalidInnerTyOfBuiltinTy": {
      const infringing_tys = e._0;
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(
        infringing_fields_error(
          tcx,
          infringing_tys.map(([ty, reason]) => [span, ty, reason]),
          LangItem.ConstParamTy,
          impl_did,
          span,
        ),
      );
    }
    case "UnsizedConstParamsFeatureRequired": {
      const span = tcx.hir_expect_item(impl_did).expect_impl().self_ty.span;
      return Err(tcx.dcx().emit_err(diagnostics.ConstParamTyImplOnUnsized_diagnostic({ span })));
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:247 visit_implementation_of_coerce_unsized
function visit_implementation_of_coerce_unsized(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_did = checker.impl_def_id;
  // debug!("visit_implementation_of_coerce_unsized: impl_did={:?}", impl_did);

  // Just compute this for the side-effects, in particular reporting
  // errors; other parts of the code may demand it for the info of
  // course.
  return tcx.ensure_result().coerce_unsized_info(impl_did);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:258 visit_implementation_of_reborrow
function visit_implementation_of_reborrow(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_did = checker.impl_def_id;
  // debug!("visit_implementation_of_reborrow: impl_did={:?}", impl_did);

  // Just compute this for the side-effects, in particular reporting
  // errors; other parts of the code may demand it for the info of
  // course.
  return reborrow_info(tcx, impl_did);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:269 visit_implementation_of_coerce_shared
function visit_implementation_of_coerce_shared(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_did = checker.impl_def_id;
  // debug!("visit_implementation_of_coerce_shared: impl_did={:?}", impl_did);

  // Just compute this for the side-effects, in particular reporting
  // errors; other parts of the code may demand it for the info of
  // course.
  return coerce_shared.coerce_shared_info(tcx, impl_did);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:280 is_from_coerce_pointee_derive
function is_from_coerce_pointee_derive(tcx: TyCtxt, span: Span): boolean {
  const macro_def_id = SyntaxContext.outer_expn_data(Span.ctxt(span)).macro_def_id;
  return macro_def_id !== undefined && tcx.is_diagnostic_item(sym.CoercePointee, macro_def_id);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:287 visit_implementation_of_dispatch_from_dyn
function visit_implementation_of_dispatch_from_dyn(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const impl_did = checker.impl_def_id;
  const trait_ref = trait_ref_identity(checker.impl_header);
  // debug!("visit_implementation_of_dispatch_from_dyn: impl_did={:?}", impl_did);

  const span = tcx.def_span(impl_did);
  const trait_name = "DispatchFromDyn";

  const source = TraitRef.self_ty(trait_ref);
  assert(tcx.is_lang_item(trait_ref.def_id, LangItem.DispatchFromDyn), "assertion failed: tcx.is_lang_item(trait_ref.def_id, LangItem::DispatchFromDyn)");
  const target = trait_ref.args.type_at(1);

  // Check `CoercePointee` impl is WF -- if not, then there's no reason to report
  // redundant errors for `DispatchFromDyn`. This is best effort, though.
  let res0 = Ok(null) as Result<null, ErrorGuaranteed>;
  tcx.for_each_relevant_impl(
    tcx.require_lang_item(LangItem.CoerceUnsized, span),
    source,
    (impl_def_id) => {
      res0 = and(res0, tcx.ensure_result().coerce_unsized_info(impl_def_id));
    },
    VisitorResultC.unit,
  );
  if (res0.$ === "Err") return res0;

  // debug!("visit_implementation_of_dispatch_from_dyn: {:?} -> {:?}", source, target);

  const param_env = tcx.param_env(impl_did) as ParamEnv;

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const cause = ObligationCause.misc(span, impl_did);

  // Later parts of the compiler rely on all DispatchFromDyn types to be ABI-compatible with raw
  // pointers. This is enforced here: we only allow impls for references, raw pointers, and things
  // that are effectively repr(transparent) newtypes around types that already hav a
  // DispatchedFromDyn impl. We cannot literally use repr(transparent) on those types since some
  // of them support an allocator, but we ensure that for the cases where the type implements this
  // trait, they *do* satisfy the repr(transparent) rules, and then we assume that everything else
  // in the compiler (in particular, all the call ABI logic) will treat them as repr(transparent)
  // even if they do not carry that attribute.
  const sk = source.kind();
  const tk = target.kind();
  if (sk.$ === "Pat" && tk.$ === "Pat") {
    const [pat_a, pat_b] = [sk._1, tk._1];
    if (pat_a !== pat_b) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSamePatKind_diagnostic({
            span,
            trait_name,
            pat_a: display_Pattern(pat_a),
            pat_b: display_Pattern(pat_b),
          }),
        ),
      );
    }
    return Ok(null);
  } else if (sk.$ === "Ref" && tk.$ === "Ref" && sk._0 === tk._0 && sk._2 === tk._2) {
    return Ok(null);
  } else if (sk.$ === "RawPtr" && tk.$ === "RawPtr" && sk._1 === tk._1) {
    return Ok(null);
  } else if (sk.$ === "Adt" && tk.$ === "Adt" && (sk._0 as AdtDef).is_struct() && (tk._0 as AdtDef).is_struct()) {
    const [def_a, args_a] = [sk._0 as AdtDef, sk._1];
    const [def_b, args_b] = [tk._0 as AdtDef, tk._1];
    if (def_a !== def_b) {
      const source_path = tcx.def_path_str(def_a.did());
      const target_path = tcx.def_path_str(def_b.did());
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSameStruct_diagnostic({
            span,
            trait_name,
            note: true,
            source_path,
            target_path,
          }),
        ),
      );
    }

    if (def_a.repr().c() || def_a.repr().packed()) {
      return Err(tcx.dcx().emit_err(diagnostics.DispatchFromDynRepr_diagnostic({ span })));
    }

    const fields = def_a.non_enum_variant().fields;

    let res: Result<null, ErrorGuaranteed> = Ok(null);
    const coerced_fields: [FieldIdx, Ty, Ty, Span][] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!;
      // Ignore PhantomData fields
      const unnormalized_ty = EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>);
      const n = tcx.try_normalize_erasing_regions(TypingEnv.non_body_analysis(tcx, def_a.did()), unnormalized_ty, fold_Ty);
      if ((n.$ === "Ok" ? n._0 : Unnormalized.skip_norm_wip(unnormalized_ty)).is_phantom_data()) {
        continue;
      }

      const ty_a = Unnormalized.skip_norm_wip(field.ty(tcx, args_a));
      const ty_b = Unnormalized.skip_norm_wip(field.ty(tcx, args_b));

      // FIXME: We could do normalization here, but is it really worth it?
      if (ty_a === ty_b) {
        // Allow 1-ZSTs that don't mention type params.
        //
        // Allowing type params here would allow us to possibly transmute
        // between ZSTs, which may be used to create library unsoundness.
        const layout = tcx.layout_of(infcx.typing_env(param_env).as_query_input(ty_a));
        if (layout.$ === "Ok" && layout._0.is_1zst() && !TypeVisitableExt.has_non_region_param(ty_a, fold_Ty)) {
          // ignore 1-ZST fields
          continue;
        }

        res = Err(
          tcx.dcx().emit_err(
            diagnostics.DispatchFromDynZST_diagnostic({
              span,
              name: field.ident(tcx),
              ty: ty_a,
            }),
          ),
        );

        continue;
      } else {
        coerced_fields.push([i as FieldIdx, ty_a, ty_b, tcx.def_span(field.did)]);
      }
    }
    if (res.$ === "Err") return res;

    if (coerced_fields.length === 0) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceNoField_diagnostic({
            span,
            trait_name,
            note: true,
          }),
        ),
      );
    } else if (coerced_fields.length === 1) {
      const [, ty_a, ty_b, field_span] = coerced_fields[0]!;
      const ocx = ObligationCtxt.new_with_diagnostics(infcx);
      ocx.register_obligation(Obligation.new(tcx, clone_ObligationCause(cause), param_env, TraitRef.new(as_interner(tcx), trait_ref.def_id, [GenericArg.from_Ty(ty_a), GenericArg.from_Ty(ty_b)]), upcast_TraitRef));
      const errors = ocx.evaluate_obligations_error_on_ambiguity();
      if (errors.$ === "HasErrors") {
        const errs = errors._0;
        if (is_from_coerce_pointee_derive(tcx, span)) {
          return Err(
            tcx.dcx().emit_err(
              diagnostics.CoerceFieldValidity_diagnostic({
                span,
                trait_name,
                ty: TraitRef.self_ty(trait_ref),
                field_span,
                field_ty: ty_a,
              }),
            ),
          );
        } else {
          return Err(infcx.err_ctxt().report_fulfillment_errors(errs));
        }
      }

      // Finally, resolve all regions.
      const rr = ocx.resolve_regions_and_report_errors(impl_did, param_env, []);
      if (rr.$ === "Err") return rr;

      return Ok(null);
    } else {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceMulti_diagnostic({
            span,
            trait_name,
            number: coerced_fields.length,
            fields: MultiSpan.from_spans(coerced_fields.map(([, , , s]) => s)),
          }),
        ),
      );
    }
  } else {
    return Err(tcx.dcx().emit_err(diagnostics.CoerceUnsizedNonStruct_diagnostic({ span, trait_name })));
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:465 reborrow_info
export function reborrow_info(tcx: TyCtxt, impl_did: LocalDefId): Result<null, ErrorGuaranteed> {
  // debug!("compute_reborrow_info(impl_did={:?})", impl_did);
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const span = tcx.def_span(impl_did);
  const trait_name = "Reborrow";

  const reborrow_trait = tcx.require_lang_item(LangItem.Reborrow, span);

  const source = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_did) as EarlyBinder<Ty>));
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_did)));

  if (trait_impl_lifetime_params_count(tcx, impl_did) !== 1) {
    return Err(tcx.dcx().emit_err(diagnostics.CoerceSharedNotSingleLifetimeParam_diagnostic({ span, trait_name })));
  }

  assert_eq(trait_ref.def_id, reborrow_trait, (v) => debug_DefId(v, PLAIN), DefId_eq);
  const param_env = tcx.param_env(impl_did) as ParamEnv;
  assert(!TypeVisitableExt.has_escaping_bound_vars(source, fold_Ty), "assertion failed: !source.has_escaping_bound_vars()");

  const sk = source.kind();
  let def: AdtDef;
  let args: GenericArgs;
  if (sk.$ === "Adt" && (sk._0 as AdtDef).is_struct()) {
    [def, args] = [sk._0 as AdtDef, sk._1];
  } else {
    // Note: reusing error here as it takes trait_name as argument.
    return Err(tcx.dcx().emit_err(diagnostics.CoerceUnsizedNonStruct_diagnostic({ span, trait_name })));
  }

  const lifetimes_count = generic_lifetime_params_count(args);
  const data_fields = collect_reborrow_data_fields(tcx, def, args);

  if (lifetimes_count !== 1) {
    const item = tcx.hir_expect_item(impl_did);
    const _span = item.kind.$ === "Impl" && item.kind._0.of_trait !== undefined ? item.kind._0.of_trait.trait_ref.path.span : tcx.def_span(impl_did);

    return Err(tcx.dcx().emit_err(diagnostics.CoerceSharedMulti_diagnostic({ span, trait_name })));
  }

  if (data_fields.length === 0) {
    return Ok(null);
  }

  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  // We've found some data fields. They must all be either be Copy or Reborrow.
  for (const field of data_fields) {
    const n = ocx.deeply_normalize(ObligationCause.misc(field.span, impl_did), param_env, Unnormalized.new_wip(field.ty), fold_Ty);
    if (n.$ === "Err") return Err(infcx.err_ctxt().report_fulfillment_errors(n._0));
    field.ty = n._0;
    if (field_type_is_reborrow(tcx, infcx, reborrow_trait, impl_did, param_env, field.ty, field.span)) {
      // Field implements Reborrow, check remaining fields.
      continue;
    }

    // Field does not implement Reborrow: it must be Copy.
    const r = assert_field_type_is_copy(tcx, infcx, impl_did, param_env, field.ty, field.span);
    if (r.$ === "Err") return r;
  }

  const dtor = def.destructor(tcx);
  const did = dtor !== undefined ? dtor.did : undefined;
  if (did !== undefined) {
    const impl_ = tcx.def_span(did);
    return Err(
      tcx.dcx().emit_err(
        diagnostics.TraitImplOnTypeWithDtor_diagnostic({
          span,
          impl_,
          trait_name: sym.Reborrow,
        }),
      ),
    );
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:556 trait_impl_lifetime_params_count
export function trait_impl_lifetime_params_count(tcx: TyCtxt, did: LocalDefId): number {
  return (tcx.generics_of(did) as Generics).own_params.filter((p) => p.kind.$ === "Lifetime").length;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:564 generic_lifetime_params_count
function generic_lifetime_params_count(args: readonly GenericArg[]): number {
  return args.filter((arg) => GenericArg.as_region(arg) !== undefined).length;
}

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin.rs:569 ReborrowDataField
export interface ReborrowDataField {
  ident: Ident;
  name: Symbol;
  ty: Ty;
  span: Span;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:576 collect_reborrow_data_fields
export function collect_reborrow_data_fields(tcx: TyCtxt, def: AdtDef, args: GenericArgs): ReborrowDataField[] {
  const out: ReborrowDataField[] = [];
  for (const field of def.non_enum_variant().fields) {
    const ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
    if (!ty.is_phantom_data()) {
      out.push({
        ident: field.ident(tcx),
        name: field.name,
        ty,
        span: tcx.def_span(field.did),
      });
    }
  }
  return out;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:596 field_type_is_reborrow
export function field_type_is_reborrow(tcx: TyCtxt, infcx: InferCtxt, reborrow_trait: DefId, impl_did: LocalDefId, param_env: ParamEnv, ty: Ty, span: Span): boolean {
  if (ty.ref_mutability() === "Mut") {
    // Mutable references are Reborrow but not really.
    return true;
  }

  const ocx = ObligationCtxt.new(infcx);
  const cause = ObligationCause.misc(span, impl_did);
  ocx.register_obligation(Obligation.new(tcx, cause, param_env, TraitRef.new(as_interner(tcx), reborrow_trait, [GenericArg.from_Ty(ty)]), upcast_TraitRef));
  return ocx.evaluate_obligations_error_on_ambiguity().$ === "NoErrors";
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:621 field_type_is_copy
export function field_type_is_copy(tcx: TyCtxt, infcx: InferCtxt, impl_did: LocalDefId, param_env: ParamEnv, ty: Ty, span: Span): boolean {
  const copy_trait = tcx.require_lang_item(LangItem.Copy, span);
  const ocx = ObligationCtxt.new(infcx);
  const cause = ObligationCause.misc(span, impl_did);
  ocx.register_obligation(Obligation.new(tcx, cause, param_env, TraitRef.new(as_interner(tcx), copy_trait, [GenericArg.from_Ty(ty)]), upcast_TraitRef));
  return ocx.evaluate_obligations_error_on_ambiguity().$ === "NoErrors";
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:641 assert_field_type_is_copy
export function assert_field_type_is_copy(tcx: TyCtxt, infcx: InferCtxt, impl_did: LocalDefId, param_env: ParamEnv, ty: Ty, span: Span): Result<null, ErrorGuaranteed> {
  const copy_trait = tcx.require_lang_item(LangItem.Copy, span);
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const cause = ObligationCause.misc(span, impl_did);
  const obligation = Obligation.new(tcx, cause, param_env, TraitRef.new(as_interner(tcx), copy_trait, [GenericArg.from_Ty(ty)]), upcast_TraitRef);
  ocx.register_obligation(obligation);
  const errors = ocx.evaluate_obligations_error_on_ambiguity();

  if (errors.$ === "HasErrors") {
    return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:664 coerce_unsized_info
export function coerce_unsized_info(tcx: TyCtxt, impl_did: LocalDefId): Result<CoerceUnsizedInfo, ErrorGuaranteed> {
  // debug!("compute_coerce_unsized_info(impl_did={:?})", impl_did);
  const span = tcx.def_span(impl_did);
  const trait_name = "CoerceUnsized";

  const coerce_unsized_trait = tcx.require_lang_item(LangItem.CoerceUnsized, span);
  const unsize_trait = tcx.require_lang_item(LangItem.Unsize, span);

  const source0 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_did) as EarlyBinder<Ty>));
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_did)));

  assert_eq(trait_ref.def_id, coerce_unsized_trait, (v) => debug_DefId(v, PLAIN), DefId_eq);
  const target0 = trait_ref.args.type_at(1);
  // debug!("visit_implementation_of_coerce_unsized: {:?} -> {:?} (bound)", source, target);

  const param_env = tcx.param_env(impl_did) as ParamEnv;
  assert(!TypeVisitableExt.has_escaping_bound_vars(source0, fold_Ty), "assertion failed: !source.has_escaping_bound_vars()");

  // debug!("visit_implementation_of_coerce_unsized: {:?} -> {:?} (free)", source, target);

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const cause = ObligationCause.misc(span, impl_did);
  const check_mutbl = (mt_a: TypeAndMut, mt_b: TypeAndMut, mk_ptr: (ty: Ty) => Ty): [Ty, Ty, DefId, CustomCoerceUnsized | undefined, Span] => {
    if (Mutability_lt(mt_a.mutbl, mt_b.mutbl)) {
      infcx.err_ctxt().report_mismatched_types(cause, param_env, mk_ptr(mt_b.ty), target0, TypeError.Mutability).emit();
    }
    return [mt_a.ty, mt_b.ty, unsize_trait, undefined, span];
  };
  let source: Ty;
  let target: Ty;
  let trait_def_id: DefId;
  let kind: CustomCoerceUnsized | undefined;
  let field_span: Span;
  const sk = source0.kind();
  const tk = target0.kind();
  if (sk.$ === "Pat" && tk.$ === "Pat") {
    const [ty_a, pat_a] = [sk._0, sk._1];
    const [ty_b, pat_b] = [tk._0, tk._1];
    if (pat_a !== pat_b) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSamePatKind_diagnostic({
            span,
            trait_name,
            pat_a: display_Pattern(pat_a),
            pat_b: display_Pattern(pat_b),
          }),
        ),
      );
    }
    [source, target, trait_def_id, kind, field_span] = [ty_a, ty_b, coerce_unsized_trait, undefined, span];
  } else if (sk.$ === "Ref" && tk.$ === "Ref") {
    const [r_a, ty_a, mutbl_a] = [sk._0, sk._1, sk._2];
    const [r_b, ty_b, mutbl_b] = [tk._0, tk._1, tk._2];
    infcx.sub_regions({ $: "RelateObjectBound", _0: span }, r_b, r_a, "Yes");
    const mt_a: TypeAndMut = { ty: ty_a, mutbl: mutbl_a };
    const mt_b: TypeAndMut = { ty: ty_b, mutbl: mutbl_b };
    [source, target, trait_def_id, kind, field_span] = check_mutbl(mt_a, mt_b, (ty) => Ty.new_imm_ref(tcx, r_b, ty));
  } else if ((sk.$ === "Ref" && tk.$ === "RawPtr") || (sk.$ === "RawPtr" && tk.$ === "RawPtr")) {
    const [ty_a, mutbl_a] = sk.$ === "Ref" ? [sk._1, sk._2] : [sk._0, sk._1];
    const [ty_b, mutbl_b] = [tk._0, tk._1];
    const mt_a: TypeAndMut = { ty: ty_a, mutbl: mutbl_a };
    const mt_b: TypeAndMut = { ty: ty_b, mutbl: mutbl_b };
    [source, target, trait_def_id, kind, field_span] = check_mutbl(mt_a, mt_b, (ty) => Ty.new_imm_ptr(tcx, ty));
  } else if (sk.$ === "Adt" && tk.$ === "Adt" && (sk._0 as AdtDef).is_struct() && (tk._0 as AdtDef).is_struct()) {
    const [def_a, args_a] = [sk._0 as AdtDef, sk._1];
    const [def_b, args_b] = [tk._0 as AdtDef, tk._1];
    if (def_a !== def_b) {
      const source_path = tcx.def_path_str(def_a.did());
      const target_path = tcx.def_path_str(def_b.did());
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSameStruct_diagnostic({
            span,
            trait_name,
            note: true,
            source_path,
            target_path,
          }),
        ),
      );
    }

    // Here we are considering a case of converting
    // `S<P0...Pn>` to `S<Q0...Qn>`. As an example, let's imagine a struct `Foo<T, U>`,
    // which acts like a pointer to `U`, but carries along some extra data of type `T`:
    //
    //     struct Foo<T, U> {
    //         extra: T,
    //         ptr: *mut U,
    //     }
    //
    // We might have an impl that allows (e.g.) `Foo<T, [i32; 3]>` to be unsized
    // to `Foo<T, [i32]>`. That impl would look like:
    //
    //   impl<T, U: Unsize<V>, V> CoerceUnsized<Foo<T, V>> for Foo<T, U> {}
    //
    // Here `U = [i32; 3]` and `V = [i32]`. At runtime,
    // when this coercion occurs, we would be changing the
    // field `ptr` from a thin pointer of type `*mut [i32;
    // 3]` to a wide pointer of type `*mut [i32]` (with
    // extra data `3`). **The purpose of this check is to
    // make sure that we know how to do this conversion.**
    //
    // To check if this impl is legal, we would walk down
    // the fields of `Foo` and consider their types with
    // both generic parameters. We are looking to find that
    // exactly one (non-phantom) field has changed its
    // type, which we will expect to be the pointer that
    // is becoming fat (we could probably generalize this
    // to multiple thin pointers of the same type becoming
    // fat, but we don't). In this case:
    //
    // - `extra` has type `T` before and type `T` after
    // - `ptr` has type `*mut U` before and type `*mut V` after
    //
    // Since just one field changed, we would then check
    // that `*mut U: CoerceUnsized<*mut V>` is implemented
    // (in other words, that we know how to do this
    // conversion). This will work out because `U:
    // Unsize<V>`, and we have a builtin rule that `*mut
    // U` can be coerced to `*mut V` if `U: Unsize<V>`.
    const fields = def_a.non_enum_variant().fields;
    const diff_fields: [FieldIdx, Ty, Ty, Span][] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      const [a, b] = [Unnormalized.skip_norm_wip(f.ty(tcx, args_a)), Unnormalized.skip_norm_wip(f.ty(tcx, args_b))];

      // Ignore PhantomData fields
      const unnormalized_ty = EarlyBinder.instantiate_identity(tcx.type_of(f.did) as EarlyBinder<Ty>);
      const n = tcx.try_normalize_erasing_regions(TypingEnv.non_body_analysis(tcx, def_a.did()), unnormalized_ty, fold_Ty);
      if ((n.$ === "Ok" ? n._0 : Unnormalized.skip_norm_wip(unnormalized_ty)).is_phantom_data()) {
        continue;
      }

      // Ignore fields that aren't changed; it may
      // be that we could get away with subtyping or
      // something more accepting, but we use
      // equality because we want to be able to
      // perform this check without computing
      // variance or constraining opaque types' hidden types.
      // (This is because we may have to evaluate constraint
      // expressions in the course of execution.)
      // See e.g., #41936.
      if (a === b) {
        continue;
      }

      // Collect up all fields that were significantly changed
      // i.e., those that contain T in coerce_unsized T -> U
      diff_fields.push([i as FieldIdx, a, b, tcx.def_span(f.did)]);
    }

    if (diff_fields.length === 0) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceNoField_diagnostic({
            span,
            trait_name,
            note: true,
          }),
        ),
      );
    } else if (diff_fields.length > 1) {
      const item = tcx.hir_expect_item(impl_did);
      const span = item.kind.$ === "Impl" && item.kind._0.of_trait !== undefined ? item.kind._0.of_trait.trait_ref.path.span : tcx.def_span(impl_did);

      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceMulti_diagnostic({
            span,
            trait_name,
            number: diff_fields.length,
            fields: MultiSpan.from_spans(diff_fields.map(([, , , s]) => s)),
          }),
        ),
      );
    }

    const [i, a, b, fspan] = diff_fields[0]!;
    const k: CustomCoerceUnsized = { $: "Struct", _0: i };
    [source, target, trait_def_id, kind, field_span] = [a, b, coerce_unsized_trait, k, fspan];
  } else {
    return Err(tcx.dcx().emit_err(diagnostics.CoerceUnsizedNonStruct_diagnostic({ span, trait_name })));
  }

  // Register an obligation for `A: Trait<B>`.
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const cause2 = ObligationCause.misc(span, impl_did);
  const obligation = Obligation.new(tcx, cause2, param_env, TraitRef.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(source), GenericArg.from_Ty(target)]), upcast_TraitRef);
  ocx.register_obligation(obligation);
  const errors = ocx.evaluate_obligations_error_on_ambiguity();

  if (errors.$ === "HasErrors") {
    if (is_from_coerce_pointee_derive(tcx, span)) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceFieldValidity_diagnostic({
            span,
            trait_name,
            ty: TraitRef.self_ty(trait_ref),
            field_span,
            field_ty: source,
          }),
        ),
      );
    } else {
      return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
    }
  }

  // Finally, resolve all regions.
  const rr = ocx.resolve_regions_and_report_errors(impl_did, param_env, []);
  if (rr.$ === "Err") return rr;

  return Ok({ custom_kind: kind });
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:899 infringing_fields_error
function infringing_fields_error(
  tcx: TyCtxt,
  infringing_tys: Iterable<[Span, Ty, InfringingFieldsReason]>,
  lang_item: LangItem,
  impl_did: LocalDefId,
  impl_span: Span,
): ErrorGuaranteed {
  const trait_did = tcx.require_lang_item(lang_item, impl_span);

  const trait_name = tcx.def_path_str(trait_did);

  // We'll try to suggest constraining type parameters to fulfill the requirements of
  // their `Copy` implementation.
  // PORT: `BTreeMap<(String, String), Vec<Span>>`: a `Map` keyed by the joined pair; iterated in sorted key order below.
  const errors = new Map<string, [[string, string], Span[]]>();
  const entry = (key: [string, string]): Span[] => {
    const k = JSON.stringify(key);
    let e = errors.get(k);
    if (e === undefined) {
      e = [key, []];
      errors.set(k, e);
    }
    return e[1];
  };
  const bounds: [string, string, DefId | undefined][] = [];

  const seen_tys = new Set<Ty>();

  const label_spans: Span[] = [];

  for (const [span, ty, reason] of infringing_tys) {
    // Only report an error once per type.
    if (seen_tys.has(ty)) {
      continue;
    }
    seen_tys.add(ty);

    label_spans.push(span);

    switch (reason.$) {
      case "Fulfill": {
        const fulfillment_errors = reason._0;
        for (const error of fulfillment_errors) {
          const error_predicate = error.obligation.predicate;
          // Only note if it's not the root obligation, otherwise it's trivial and
          // should be self-explanatory (i.e. a field literally doesn't implement Copy).

          // FIXME: This error could be more descriptive, especially if the error_predicate
          // contains a foreign type or if it's a deeply nested type...
          if (error_predicate !== error.root_obligation.predicate) {
            entry([display_Ty(ty), display_Predicate(error_predicate)]).push(error.obligation.cause.span);
          }
          const pk = Binder.skip_binder(error_predicate.kind());
          if (pk.$ === "Clause" && pk._0.$ === "Trait" && pk._0._0.polarity === "Positive") {
            const trait_ref = pk._0._0.trait_ref;
            const ty = TraitRef.self_ty(trait_ref);
            if (ty.kind().$ === "Param") {
              bounds.push([display_Ty(ty), display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref)), trait_ref.def_id]);
            }
          }
        }
        break;
      }
      case "Regions": {
        const region_errors = reason._0;
        for (const error of region_errors) {
          const ty_s = display_Ty(ty);
          if (error.$ === "ConcreteFailure") {
            const [origin, a, b] = [error._0, error._1, error._2];
            const predicate = `${display_Region(b)}: ${display_Region(a)}`;
            entry([ty_s, predicate]).push(SubregionOrigin.span(origin));
            const bk = b.kind();
            if (bk.$ === "ReEarlyParam" && EarlyParamRegion.is_named(bk._0)) {
              bounds.push([display_Region(b), display_Region(a), undefined]);
            }
          } else if (error.$ === "GenericBoundFailure") {
            const [origin, a, b] = [error._0, error._1, error._2];
            const predicate = `${display_GenericKind(a)}: ${display_Region(b)}`;
            entry([ty_s, predicate]).push(SubregionOrigin.span(origin));
            if (a.$ === "Param") {
              bounds.push([display_GenericKind(a), display_Region(b), undefined]);
            }
          } else {
            continue;
          }
        }
        break;
      }
    }
  }
  const notes: diagnostics.ImplForTyRequires[] = [];
  const sorted = [...errors.values()].sort(([ka], [kb]) => cmp_String(ka[0], kb[0]) || cmp_String(ka[1], kb[1]));
  for (const [[ty, error_predicate], spans] of sorted) {
    const span = MultiSpan.from_spans(spans);
    notes.push({
      span,
      error_predicate,
      trait_name,
      ty,
    });
  }

  const err = tcx.dcx().create_err(
    diagnostics.TraitCannotImplForTy_diagnostic({
      span: impl_span,
      trait_name,
      label_spans,
      notes,
    }),
  );

  const generics = tcx.hir_get_generics(impl_did);
  if (generics === undefined) return panic("impls always have generics");
  suggest_constraining_type_params(
    tcx,
    generics,
    err,
    bounds.map(([param, constraint, def_id]) => [param, constraint, def_id] as const),
    undefined,
  );

  return err.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin.rs:1022 visit_implementation_of_coerce_pointee_validity
function visit_implementation_of_coerce_pointee_validity(checker: Checker): Result<null, ErrorGuaranteed> {
  const tcx = checker.tcx;
  const self_ty = TraitRef.self_ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(checker.impl_def_id))));
  const span0 = tcx.def_span(checker.impl_def_id);
  if (!tcx.is_builtin_derived(LocalDefId.to_def_id(checker.impl_def_id))) {
    return Err(tcx.dcx().emit_err(diagnostics.CoercePointeeNoUserValidityAssertion_diagnostic({ span: span0 })));
  }
  const k = self_ty.kind();
  if (k.$ !== "Adt") {
    return Err(tcx.dcx().emit_err(diagnostics.CoercePointeeNotConcreteType_diagnostic({ span: span0 })));
  }
  const def = k._0 as AdtDef;
  const did = def.did();
  // Now get a more precise span of the `struct`.
  const span = tcx.def_span(did);
  if (!def.is_struct()) {
    return Err(tcx.dcx().emit_err(diagnostics.CoercePointeeNotStruct_diagnostic({ span, kind: def.descr() })));
  }
  if (!def.repr().transparent()) {
    return Err(tcx.dcx().emit_err(diagnostics.CoercePointeeNotTransparent_diagnostic({ span })));
  }
  if (def.all_fields().next().done === true) {
    return Err(tcx.dcx().emit_err(diagnostics.CoercePointeeNoField_diagnostic({ span })));
  }
  return Ok(null);
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

/** `ty::TypeAndMut<'tcx>` (rustc_middle ty/sty.rs), a plain data struct (as variance/constraints.ts). */
interface TypeAndMut {
  ty: Ty;
  mutbl: "Not" | "Mut";
}

/** `TraitRef<TyCtxt>: Upcast<TyCtxt, Predicate>` (rustc_middle ty/predicate.rs) as `Obligation::new`'s upcast. */
export function upcast_TraitRef(from: TraitRefT, cx: Interner): Predicate {
  return Predicate_upcast_from_TraitRef(from, cx as unknown as TyCtxt);
}

/** `Mutability`'s derived `PartialOrd` (`Not < Mut`). */
function Mutability_lt(a: "Not" | "Mut", b: "Not" | "Mut"): boolean {
  return a === "Not" && b === "Mut";
}

/** `<String as Ord>::cmp` (byte-wise on the UTF-8 encoding). */
function cmp_String(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}


// ---- stand-ins: pending types and other lanes' items -----------------------------------------------------------------




