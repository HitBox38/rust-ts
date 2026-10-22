// Port of compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs (lane coherence).
//
// PORT notes (file-wide):
// - `debug!` is tracing only and stays as a comment; `?` is an early return of the `Err`.
// - `Option::or_else` chains are `??` chains (`undefined` is `None`; no value here is `undefined` otherwise).
// - `err_ctxt()` (wave 19) and the layout predicates (M4) are builtin.ts's stand-ins.
// - `CoerceSharedDiagnosticContext` and `ReborrowDataField` are `Copy`: they are passed by reference here because no
//   callee mutates them except `validate_coerce_shared_unpaired_source_field` (`mut source`), which copies.
// Init order: top-level code here touches only other crates; builtin.ts's exports are read inside function bodies.
import { ObligationCtxt } from "../../../rustc_trait_selection/traits/engine.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import type * as hir from "../../../rustc_hir/lib.ts";
import { DefineOpaqueTypes } from "../../../rustc_infer/infer/at.gen.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { Obligation } from "../../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { type ParamEnv, type Ty, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, debug_DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { fold_tuple2 } from "../../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, TraitRef } from "../../../rustc_type_ir/predicate.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import * as diagnostics from "../../diagnostics.ts";
import {
  assert_field_type_is_copy,
  collect_reborrow_data_fields,
  field_type_is_copy,
  field_type_is_reborrow,
  type ReborrowDataField,
  trait_impl_lifetime_params_count,
  upcast_TraitRef,
} from "../builtin.ts";

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:21 CoerceSharedDiagnosticContext
interface CoerceSharedDiagnosticContext {
  impl_span: Span;
  trait_span: Span;
  source_ty_span: Span;
  target_ty_span: Span;
  source_lifetime_span: Span | undefined;
  target_lifetime_span: Span | undefined;
}

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:31 CoerceSharedTypeRole
type CoerceSharedTypeRole = "Source" | "Target";
const CoerceSharedTypeRole = {
  Source: "Source",
  Target: "Target",

  // rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:37 as_str
  as_str(self: CoerceSharedTypeRole): string {
    switch (self) {
      case "Source":
        return "source";
      case "Target":
        return "target";
    }
  },

  // rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:44 type_span
  type_span(self: CoerceSharedTypeRole, diagnostic_context: CoerceSharedDiagnosticContext): Span {
    switch (self) {
      case "Source":
        return diagnostic_context.source_ty_span;
      case "Target":
        return diagnostic_context.target_ty_span;
    }
  },
} as const;

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:52 coerce_shared_diagnostic_context
function coerce_shared_diagnostic_context(tcx: TyCtxt, impl_did: LocalDefId): CoerceSharedDiagnosticContext {
  const item = tcx.hir_expect_item(impl_did);
  const fallback_span = tcx.def_span(impl_did);
  const diagnostic_context: CoerceSharedDiagnosticContext = {
    impl_span: item.span,
    trait_span: fallback_span,
    source_ty_span: fallback_span,
    target_ty_span: fallback_span,
    source_lifetime_span: undefined,
    target_lifetime_span: undefined,
  };

  if (item.kind.$ !== "Impl") {
    return diagnostic_context;
  }
  const impl_ = item.kind._0;
  const of_trait = impl_.of_trait;
  if (of_trait === undefined) {
    return diagnostic_context;
  }

  diagnostic_context.trait_span = of_trait.trait_ref.path.span;
  diagnostic_context.source_ty_span = impl_.self_ty.span;
  diagnostic_context.source_lifetime_span = first_explicit_lifetime_span_in_ty(impl_.self_ty) ?? first_explicit_impl_lifetime_param_span(impl_.generics);

  const target_ty = coerce_shared_target_ty_from_path(of_trait.trait_ref.path);
  if (target_ty !== undefined) {
    diagnostic_context.target_ty_span = target_ty.span;
    diagnostic_context.target_lifetime_span = first_explicit_lifetime_span_in_ambig_ty(target_ty);
  } else {
    diagnostic_context.target_ty_span = diagnostic_context.trait_span;
  }

  return diagnostic_context;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:90 coerce_shared_target_ty_from_path
function coerce_shared_target_ty_from_path(path: hir.Path): hir.Ty<hir.AmbigArg> | undefined {
  const last = path.segments[path.segments.length - 1];
  if (last === undefined) return undefined;
  for (const arg of last.args_().args) {
    switch (arg.$) {
      case "Type":
        return arg._0;
      case "Lifetime":
      case "Const":
      case "Infer":
        break;
    }
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:101 first_explicit_impl_lifetime_param_span
function first_explicit_impl_lifetime_param_span(generics: hir.Generics): Span | undefined {
  for (const param of generics.params) {
    if (param.kind.$ === "Lifetime" && param.kind.kind.$ === "Explicit") {
      return param.span;
    }
    // hir::GenericParamKind::Lifetime { .. }
    // | hir::GenericParamKind::Type { .. }
    // | hir::GenericParamKind::Const { .. } => None,
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:112 first_explicit_lifetime_span
function first_explicit_lifetime_span(lifetime: hir.Lifetime): Span | undefined {
  const k = lifetime.kind;
  if ((k.$ === "Param" || k.$ === "Static") && !Span.is_dummy(lifetime.ident.span)) {
    return lifetime.ident.span;
  }
  // hir::LifetimeKind::Param(_)
  // | hir::LifetimeKind::Static
  // | hir::LifetimeKind::ImplicitObjectLifetimeDefault
  // | hir::LifetimeKind::Error(_)
  // | hir::LifetimeKind::Infer => None,
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:127 first_explicit_lifetime_span_in_ambig_ty
function first_explicit_lifetime_span_in_ambig_ty(ty: hir.Ty<hir.AmbigArg>): Span | undefined {
  return first_explicit_lifetime_span_in_ty(ty.as_unambig_ty());
}

/** The `find_map` over generic params of `FnPtr` / `UnsafeBinder` (an explicit lifetime param's span). */
function find_explicit_lifetime_param(params: readonly hir.GenericParam[]): Span | undefined {
  for (const param of params) {
    if (param.kind.$ === "Lifetime" && param.kind.kind.$ === "Explicit") {
      return param.span;
    }
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:131 first_explicit_lifetime_span_in_ty
function first_explicit_lifetime_span_in_ty(ty: hir.Ty): Span | undefined {
  const k = ty.kind;
  switch (k.$) {
    case "Ref":
      return first_explicit_lifetime_span(k._0) ?? first_explicit_lifetime_span_in_ty(k._1);
    case "Slice":
    case "Array":
    case "Pat":
    case "FieldOf":
    case "View":
      return first_explicit_lifetime_span_in_ty(k._0);
    case "Ptr":
      return first_explicit_lifetime_span_in_ty(k._0);
    case "Tup":
      for (const t of k._0) {
        const s = first_explicit_lifetime_span_in_ty(t);
        if (s !== undefined) return s;
      }
      return undefined;
    case "Path":
      return first_explicit_lifetime_span_in_qpath(k._0);
    case "TraitObject": {
      for (const bound of k._0) {
        const s = first_explicit_lifetime_span_in_path(bound.trait_ref.path);
        if (s !== undefined) return s;
      }
      return first_explicit_lifetime_span(k._1.pointer());
    }
    case "OpaqueDef":
      return first_explicit_lifetime_span_in_bounds(k._0.bounds);
    case "TraitAscription":
      return first_explicit_lifetime_span_in_bounds(k._0);
    case "FnPtr":
      return find_explicit_lifetime_param(k._0.generic_params);
    case "UnsafeBinder":
      return find_explicit_lifetime_param(k._0.generic_params) ?? first_explicit_lifetime_span_in_ty(k._0.inner_ty);
    case "InferDelegation":
    case "Never":
    case "Infer":
    case "Err":
      return undefined;
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:178 first_explicit_lifetime_span_in_bounds
function first_explicit_lifetime_span_in_bounds(bounds: hir.GenericBounds): Span | undefined {
  for (const bound of bounds) {
    let s: Span | undefined;
    switch (bound.$) {
      case "Trait":
        s = first_explicit_lifetime_span_in_path(bound._0.trait_ref.path);
        break;
      case "Outlives":
        s = first_explicit_lifetime_span(bound._0);
        break;
      case "Use":
        s = undefined;
        for (const arg of bound._0) {
          switch (arg.$) {
            case "Lifetime":
              s = first_explicit_lifetime_span(arg._0);
              break;
            case "Param":
              s = undefined;
              break;
          }
          if (s !== undefined) break;
        }
        break;
    }
    if (s !== undefined) return s;
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:193 first_explicit_lifetime_span_in_qpath
function first_explicit_lifetime_span_in_qpath(qpath: hir.QPath): Span | undefined {
  switch (qpath.$) {
    case "Resolved": {
      const [qself, path] = [qpath._0, qpath._1];
      return (qself !== undefined ? first_explicit_lifetime_span_in_ty(qself) : undefined) ?? first_explicit_lifetime_span_in_path(path);
    }
    case "TypeRelative": {
      const [qself, segment] = [qpath._0, qpath._1];
      return first_explicit_lifetime_span_in_ty(qself) ?? first_explicit_lifetime_span_in_path_segment(segment);
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:203 first_explicit_lifetime_span_in_path
function first_explicit_lifetime_span_in_path(path: hir.Path): Span | undefined {
  for (const segment of path.segments) {
    const s = first_explicit_lifetime_span_in_path_segment(segment);
    if (s !== undefined) return s;
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:207 first_explicit_lifetime_span_in_path_segment
function first_explicit_lifetime_span_in_path_segment(segment: hir.PathSegment): Span | undefined {
  return first_explicit_lifetime_span_in_generic_args(segment.args_());
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:211 first_explicit_lifetime_span_in_generic_args
function first_explicit_lifetime_span_in_generic_args(args: hir.GenericArgs): Span | undefined {
  for (const arg of args.args) {
    let s: Span | undefined;
    switch (arg.$) {
      case "Lifetime":
        s = first_explicit_lifetime_span(arg._0);
        break;
      case "Type":
        s = first_explicit_lifetime_span_in_ambig_ty(arg._0);
        break;
      case "Const":
      case "Infer":
        s = undefined;
        break;
    }
    if (s !== undefined) return s;
  }
  for (const constraint of args.constraints) {
    let s = first_explicit_lifetime_span_in_generic_args(constraint.gen_args);
    if (s === undefined) {
      const ty = constraint.ty();
      s = ty !== undefined ? first_explicit_lifetime_span_in_ty(ty) : undefined;
    }
    if (s !== undefined) return s;
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:227 coerce_shared_info
export function coerce_shared_info(tcx: TyCtxt, impl_did: LocalDefId): Result<null, ErrorGuaranteed> {
  // debug!("compute_coerce_shared_info(impl_did={:?})", impl_did);
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const span = tcx.def_span(impl_did);
  const diagnostic_context = coerce_shared_diagnostic_context(tcx, impl_did);
  const trait_name = "CoerceShared";

  const coerce_shared_trait = tcx.require_lang_item(LangItem.CoerceShared, span);

  const source0 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_did) as EarlyBinder<Ty>));
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_did)));

  if (trait_impl_lifetime_params_count(tcx, impl_did) !== 1) {
    return Err(tcx.dcx().emit_err(diagnostics.CoerceSharedNotSingleLifetimeParam_diagnostic({ span, trait_name })));
  }

  assert_eq(trait_ref.def_id, coerce_shared_trait, (v) => debug_DefId(v, PLAIN), DefId_eq);
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const param_env = tcx.param_env(impl_did) as ParamEnv;
  const n = ocx.deeply_normalize(
    ObligationCause.misc(span, impl_did),
    param_env,
    Unnormalized.new_wip<[Ty, Ty]>([source0, trait_ref.args.type_at(1)]),
    fold_tuple2(fold_Ty, fold_Ty),
  );
  if (n.$ === "Err") return Err(infcx.err_ctxt().report_fulfillment_errors(n._0));
  const [source, target] = n._0;
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
  }

  assert(!TypeVisitableExt.has_escaping_bound_vars(source, fold_Ty), "assertion failed: !source.has_escaping_bound_vars()");

  const sk = source.kind();
  const tk = target.kind();
  if (sk.$ === "Adt" && tk.$ === "Adt" && (sk._0 as AdtDef).is_struct() && (tk._0 as AdtDef).is_struct()) {
    const [def_a, args_a] = [sk._0 as AdtDef, sk._1];
    const [def_b, args_b] = [tk._0 as AdtDef, tk._1];
    const a_lifetime = single_region_arg(args_a);
    const b_lifetime = single_region_arg(args_b);

    if (a_lifetime === undefined || b_lifetime === undefined) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSharedMulti_diagnostic({
            span: diagnostic_context.trait_span,
            trait_name,
          }),
        ),
      );
    }

    if (a_lifetime !== b_lifetime) {
      return Err(
        tcx.dcx().emit_err(
          diagnostics.CoerceSharedLifetimeMismatch_diagnostic({
            span: diagnostic_context.trait_span,
            source_lifetime_span: diagnostic_context.source_lifetime_span,
            target_lifetime_span: diagnostic_context.target_lifetime_span,
            trait_name,
          }),
        ),
      );
    }

    let r = validate_reborrow_field_access(tcx, impl_did, def_a, trait_name, diagnostic_context, "Source");
    if (r.$ === "Err") return r;
    r = validate_reborrow_field_access(tcx, impl_did, def_b, trait_name, diagnostic_context, "Target");
    if (r.$ === "Err") return r;

    return validate_coerce_shared_fields(infcx, impl_did, param_env, coerce_shared_trait, trait_name, span, diagnostic_context, def_a, args_a, def_b, args_b);
  } else {
    // Note: reusing CoerceUnsizedNonStruct error as it takes trait_name as argument.
    return Err(tcx.dcx().emit_err(diagnostics.CoerceUnsizedNonStruct_diagnostic({ span, trait_name })));
  }
}

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:328 CoerceSharedFieldPair
interface CoerceSharedFieldPair {
  source: ReborrowDataField;
  target: ReborrowDataField;
}

// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:333 CoerceSharedFields
interface CoerceSharedFields {
  pairs: CoerceSharedFieldPair[];
  unpaired_sources: ReborrowDataField[];
}

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:339 CoerceSharedFieldPairError
type CoerceSharedFieldPairError = { $: "FieldStyleMismatch" } | { $: "MissingSourceField"; target: ReborrowDataField };

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:344 single_region_arg
function single_region_arg(args: GenericArgs): Region | undefined {
  const lifetimes: Region[] = [];
  for (const arg of args) {
    const r = GenericArg.as_region(arg);
    if (r !== undefined) lifetimes.push(r);
  }
  const lifetime = lifetimes[0];
  if (lifetime === undefined) return undefined;
  return lifetimes.length === 1 ? lifetime : undefined;
}

// This is a coherence/WF check only. It verifies that the CoerceShared impl
// describes a structurally valid field-wise relation. Runtime lowering of the
// operation is not modeled here.
// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:353 collect_coerce_shared_field_pairs
function collect_coerce_shared_field_pairs(
  tcx: TyCtxt,
  source_def: AdtDef,
  source_args: GenericArgs,
  target_def: AdtDef,
  target_args: GenericArgs,
): Result<CoerceSharedFields, CoerceSharedFieldPairError> {
  const source_variant = source_def.non_enum_variant();
  const target_variant = target_def.non_enum_variant();
  if (source_variant.ctor_kind() !== target_variant.ctor_kind()) {
    return Err({ $: "FieldStyleMismatch" });
  }

  const source_fields = collect_reborrow_data_fields(tcx, source_def, source_args);
  const target_fields = collect_reborrow_data_fields(tcx, target_def, target_args);

  const pairs: CoerceSharedFieldPair[] = [];

  for (const target of target_fields) {
    const source = source_fields.find((source) => tcx.hygienic_eq(target.ident, source.ident, source_variant.def_id));
    if (source === undefined) return Err({ $: "MissingSourceField", target: { ...target } });

    pairs.push({ source: { ...source }, target: { ...target } });
  }

  const unpaired_sources = source_fields.filter((source) => !target_fields.some((target) => tcx.hygienic_eq(target.ident, source.ident, source_variant.def_id)));

  return Ok({ pairs, unpaired_sources });
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:392 validate_reborrow_field_access
function validate_reborrow_field_access(
  tcx: TyCtxt,
  impl_did: LocalDefId,
  def: AdtDef,
  trait_name: string,
  diagnostic_context: CoerceSharedDiagnosticContext,
  role: CoerceSharedTypeRole,
): Result<null, ErrorGuaranteed> {
  const module = tcx.parent_module_from_def_id(impl_did);
  const variant = def.non_enum_variant();

  if (variant.field_list_has_applicable_non_exhaustive() || variant.fields.some((f) => !Visibility.is_accessible_from(f.vis, module, tcx))) {
    return Err(
      tcx.dcx().emit_err(
        diagnostics.CoerceSharedInaccessibleField_diagnostic({
          span: diagnostic_context.impl_span,
          type_span: CoerceSharedTypeRole.type_span(role, diagnostic_context),
          trait_name,
          role: CoerceSharedTypeRole.as_str(role),
          type_name: tcx.item_name(def.did()),
        }),
      ),
    );
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:418 validate_coerce_shared_fields
function validate_coerce_shared_fields(
  infcx: InferCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  coerce_shared_trait: DefId,
  trait_name: string,
  span: Span,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source_def: AdtDef,
  source_args: GenericArgs,
  target_def: AdtDef,
  target_args: GenericArgs,
): Result<null, ErrorGuaranteed> {
  const tcx = infcx.tcx;
  const c = collect_coerce_shared_field_pairs(tcx, source_def, source_args, target_def, target_args);
  let fields: CoerceSharedFields;
  if (c.$ === "Ok") {
    fields = c._0;
  } else if (c._0.$ === "FieldStyleMismatch") {
    return Err(tcx.dcx().emit_err(diagnostics.CoerceSharedFieldStyleMismatch_diagnostic({ span, trait_name })));
  } else {
    const target = c._0.target;
    return Err(
      tcx.dcx().emit_err(
        diagnostics.CoerceSharedMissingField_diagnostic({
          span: target.span,
          source_ty_span: diagnostic_context.source_ty_span,
          trait_name,
          source_ty_name: tcx.item_name(source_def.did()),
          field_name: target.name,
        }),
      ),
    );
  }

  for (const field_pair of fields.pairs) {
    const r = validate_coerce_shared_field(infcx, impl_did, param_env, coerce_shared_trait, trait_name, span, diagnostic_context, field_pair.source, field_pair.target);
    if (r.$ === "Err") return r;
  }

  const reborrow_trait = tcx.require_lang_item(LangItem.Reborrow, span);
  for (const source of fields.unpaired_sources) {
    const r = validate_coerce_shared_unpaired_source_field(infcx, impl_did, param_env, reborrow_trait, trait_name, diagnostic_context, source);
    if (r.$ === "Err") return r;
  }

  // FIXME(reborrow): remove this temporary WF-side memcpy-ability guard once
  // the downstream CoerceShared implementation can correctly handle source and
  // target types that are not trivially memcpy-able. Refer to #157489
  const r = validate_coerce_shared_fields_are_memcpy_compatible(
    infcx,
    impl_did,
    param_env,
    coerce_shared_trait,
    trait_name,
    span,
    diagnostic_context,
    source_def,
    source_args,
    target_def,
    target_args,
  );
  if (r.$ === "Err") return r;

  return Ok(null);
}

/** `matches!((source.kind(), target.kind()), (&Ref(_, _, Mut), &Ref(_, _, Not)) | (&Alias(..), _) | (_, &Alias(..)))` */
function is_mut_to_shared_ref_or_alias(source: Ty, target: Ty): boolean {
  const sk = source.kind();
  const tk = target.kind();
  return (sk.$ === "Ref" && sk._2 === "Mut" && tk.$ === "Ref" && tk._2 === "Not") || sk.$ === "Alias" || tk.$ === "Alias";
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:503 validate_coerce_shared_fields_are_memcpy_compatible
function validate_coerce_shared_fields_are_memcpy_compatible(
  infcx: InferCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  coerce_shared_trait: DefId,
  trait_name: string,
  span: Span,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source_def: AdtDef,
  source_args: GenericArgs,
  target_def: AdtDef,
  target_args: GenericArgs,
): Result<null, ErrorGuaranteed> {
  const tcx = infcx.tcx;
  const source_non_zst_fields = non_zst_reborrow_data_fields(infcx, param_env, source_def, source_args);
  const target_non_zst_fields = non_zst_reborrow_data_fields(infcx, param_env, target_def, target_args);

  if (source_non_zst_fields.length === 0 && target_non_zst_fields.length === 0) {
    return Ok(null);
  } else if (source_non_zst_fields.length === 1 && target_non_zst_fields.length === 1) {
    const source = source_non_zst_fields[0]!;
    const target = target_non_zst_fields[0]!;
    if (field_tys_satisfy_relation_after_normalization_and_resolution(tcx, impl_did, param_env, source.ty, target.ty, source.span, "Equal")) {
      return Ok(null);
    }

    if (
      is_mut_to_shared_ref_or_alias(source.ty, target.ty) &&
      field_tys_satisfy_relation_after_normalization_and_resolution(tcx, impl_did, param_env, source.ty, target.ty, source.span, "MutRefToSharedRef")
    ) {
      return Ok(null);
    }

    return validate_field_tys_satisfy_coerce_shared_relation(infcx, impl_did, param_env, coerce_shared_trait, trait_name, span, diagnostic_context, { ...source }, { ...target });
  } else {
    return Err(
      tcx.dcx().emit_err(
        diagnostics.CoerceSharedMultipleNonZstFields_diagnostic({
          span: diagnostic_context.impl_span,
          source_ty_span: diagnostic_context.source_ty_span,
          target_ty_span: diagnostic_context.target_ty_span,
          trait_name,
          source_count: source_non_zst_fields.length,
          target_count: target_non_zst_fields.length,
        }),
      ),
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:577 non_zst_reborrow_data_fields
function non_zst_reborrow_data_fields(infcx: InferCtxt, param_env: ParamEnv, def: AdtDef, args: GenericArgs): ReborrowDataField[] {
  const tcx = infcx.tcx;
  return collect_reborrow_data_fields(tcx, def, args).filter((field) => {
    const layout = tcx.layout_of(infcx.typing_env(param_env).as_query_input(field.ty));
    return !(layout.$ === "Ok" && layout._0.is_zst());
  });
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:595 validate_coerce_shared_field
function validate_coerce_shared_field(
  infcx: InferCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  coerce_shared_trait: DefId,
  trait_name: string,
  span: Span,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source: ReborrowDataField,
  target: ReborrowDataField,
): Result<null, ErrorGuaranteed> {
  const tcx = infcx.tcx;
  if (
    is_mut_to_shared_ref_or_alias(source.ty, target.ty) &&
    field_tys_satisfy_relation_after_normalization_and_resolution(tcx, impl_did, param_env, source.ty, target.ty, source.span, "MutRefToSharedRef")
  ) {
    return Ok(null);
  }

  if (field_tys_satisfy_relation_after_normalization_and_resolution(tcx, impl_did, param_env, source.ty, target.ty, source.span, "Equal")) {
    return assert_field_type_is_copy(tcx, infcx, impl_did, param_env, source.ty, source.span);
  }

  return validate_field_tys_satisfy_coerce_shared_relation(infcx, impl_did, param_env, coerce_shared_trait, trait_name, span, diagnostic_context, source, target);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:649 validate_coerce_shared_unpaired_source_field
function validate_coerce_shared_unpaired_source_field(
  infcx: InferCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  reborrow_trait: DefId,
  trait_name: string,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source_: ReborrowDataField,
): Result<null, ErrorGuaranteed> {
  const source = { ...source_ };
  const tcx = infcx.tcx;
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const n = ocx.deeply_normalize(ObligationCause.misc(source.span, impl_did), param_env, Unnormalized.new_wip(source.ty), fold_Ty);
  if (n.$ === "Err") return Err(infcx.err_ctxt().report_fulfillment_errors(n._0));
  source.ty = n._0;

  if (
    field_type_is_reborrow(tcx, infcx, reborrow_trait, impl_did, param_env, source.ty, source.span) ||
    field_type_is_copy(tcx, infcx, impl_did, param_env, source.ty, source.span)
  ) {
    return Ok(null);
  }

  return Err(
    tcx.dcx().emit_err(
      diagnostics.CoerceSharedOmittedSourceFieldNotCopyOrReborrow_diagnostic({
        span: source.span,
        impl_span: diagnostic_context.impl_span,
        trait_name,
        field_name: source.name,
        field_ty: source.ty,
      }),
    ),
  );
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:690 validate_field_tys_satisfy_coerce_shared_relation
function validate_field_tys_satisfy_coerce_shared_relation(
  infcx: InferCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  coerce_shared_trait: DefId,
  trait_name: string,
  span: Span,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source: ReborrowDataField,
  target: ReborrowDataField,
): Result<null, ErrorGuaranteed> {
  const tcx = infcx.tcx;
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const cause = ObligationCause.misc(span, impl_did);
  ocx.register_obligation(
    Obligation.new(tcx, cause, param_env, TraitRef.new(as_interner(tcx), coerce_shared_trait, [GenericArg.from_Ty(source.ty), GenericArg.from_Ty(target.ty)]), upcast_TraitRef),
  );
  const errors = ocx.evaluate_obligations_error_on_ambiguity();

  if (errors.$ === "HasErrors") {
    return Err(emit_coerce_shared_field_mismatch(tcx, trait_name, diagnostic_context, source, target));
  }

  return ocx.resolve_regions_and_report_errors(impl_did, param_env, []);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:725 emit_coerce_shared_field_mismatch
function emit_coerce_shared_field_mismatch(
  tcx: TyCtxt,
  trait_name: string,
  diagnostic_context: CoerceSharedDiagnosticContext,
  source: ReborrowDataField,
  target: ReborrowDataField,
): ErrorGuaranteed {
  return tcx.dcx().emit_err(
    diagnostics.CoerceSharedFieldMismatch_diagnostic({
      span: target.span,
      source_span: source.span,
      impl_span: diagnostic_context.impl_span,
      source_name: source.name,
      source_ty: source.ty,
      target_name: target.name,
      target_ty: target.ty,
      trait_name,
    }),
  );
}

// rustc-type: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:744 FieldRelation
type FieldRelation = "Equal" | "MutRefToSharedRef";

// Normalizing the outer `CoerceShared` types does not normalize their fields:
// instantiating a field can expose projections. Each candidate relation uses a
// fresh inference context, so failed checks cannot affect the next one; this
// intentionally normalizes the fields for each check.
//
// FIXME(field_projections): This function should take `Unnormalized<Ty<'tcx>>` for
// `source_ty` and `target_ty`.
// rustc: compiler/rustc_hir_analysis/src/coherence/builtin/coerce_shared.rs:756 field_tys_satisfy_relation_after_normalization_and_resolution
function field_tys_satisfy_relation_after_normalization_and_resolution(
  tcx: TyCtxt,
  impl_did: LocalDefId,
  param_env: ParamEnv,
  source_ty0: Ty,
  target_ty0: Ty,
  span: Span,
  relation: FieldRelation,
): boolean {
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const cause = ObligationCause.misc(span, impl_did);
  const ocx = ObligationCtxt.new(infcx);

  const n = ocx.deeply_normalize(cause, param_env, Unnormalized.new_wip<[Ty, Ty]>([source_ty0, target_ty0]), fold_tuple2(fold_Ty, fold_Ty));
  if (n.$ !== "Ok") {
    return false;
  }
  const [source_ty, target_ty] = n._0;

  if (ocx.evaluate_obligations_error_on_ambiguity().$ === "HasErrors") {
    return false;
  }

  switch (relation) {
    case "Equal":
      if (infcx.at(cause, param_env).relate(DefineOpaqueTypes.Yes, source_ty, "Invariant", target_ty, ToTrace_Ty).$ === "Err") {
        return false;
      }
      break;
    case "MutRefToSharedRef": {
      const sk = source_ty.kind();
      const tk = target_ty.kind();
      if (!(sk.$ === "Ref" && sk._2 === "Mut" && tk.$ === "Ref" && tk._2 === "Not")) {
        return false;
      }
      const [source_region, source_referent_ty] = [sk._0, sk._1];
      const [target_region, target_referent_ty] = [tk._0, tk._1];
      if (source_region !== target_region) {
        return false;
      }
      if (ocx.sup(cause, param_env, target_referent_ty, source_referent_ty, ToTrace_Ty).$ === "Err") {
        return false;
      }
      break;
    }
  }

  return ocx.evaluate_obligations_error_on_ambiguity().$ === "NoErrors" && ocx.resolve_regions(impl_did, param_env, []).length === 0;
}
