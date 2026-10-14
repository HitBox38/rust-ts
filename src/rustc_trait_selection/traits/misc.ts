//! Miscellaneous type-system utilities that are too small to deserve their own modules.
//
// Port of compiler/rustc_trait_selection/src/traits/misc.rs (lane trait-sel-traits-a). The three error enums are
// generated (misc.gen.ts); `&'tcx ty::FieldDef` is the `FieldDef` object.
//
// PORT: `find_attr!(tcx, def_id, Pat => e)` is `find_attr(tcx.get_all_attrs(def_id), ..)` (`HasAttrs::get_attrs` of a
// `DefId`, rustc_attr_ir lib.ts). `Unnormalized<Ty>::references_error()` is the inner type's (the `TypeVisitable` of
// `Unnormalized<T>` visits `T`).

export * from "./misc.gen.ts";

import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { Safety } from "../../rustc_hir/hir.ts";
import type { RegionResolutionError } from "../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { type ObligationCause, ObligationCause as ObligationCauseC, clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArgs, ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type FieldDef, Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import type { ClauseKind } from "../../rustc_type_ir/decls.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { ObligationCtxt } from "./engine.ts";
import type { ConstParamTyImplementationError, CopyImplementationError, InfringingFieldsReason } from "./misc.gen.ts";

/// Checks that the fields of the type (an ADT) all implement copy.
///
/// If fields don't implement copy, return an error containing a list of
/// those violating fields.
///
/// If it's not an ADT, int ty, `bool`, float ty, `char`, raw pointer, `!`,
/// a reference or an array returns `Err(NotAnAdt)`.
///
/// If the impl is `Safe`, `self_type` must not have unsafe fields. When used to
/// generate suggestions in lints, `Safe` should be supplied so as to not
/// suggest implementing `Copy` for types with unsafe fields.
// rustc: compiler/rustc_trait_selection/src/traits/misc.rs:47 type_allowed_to_implement_copy
export function type_allowed_to_implement_copy(
  tcx: TyCtxt,
  param_env: ParamEnv,
  self_type: Ty,
  parent_cause: ObligationCause,
  impl_safety: Safety,
): Result<null, CopyImplementationError> {
  let adt: AdtDef;
  let args: GenericArgs;
  const k = self_type.kind();
  switch (k.$) {
    // These types used to have a builtin impl.
    // Now libcore provides that impl.
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      return Ok(null);
    case "Ref":
      if (k._2 === "Not") {
        return Ok(null);
      }
      return Err({ $: "NotAnAdt" });

    case "Adt":
      adt = k._0;
      args = k._1;
      break;

    default:
      return Err({ $: "NotAnAdt" });
  }

  const r = all_fields_implement_trait(tcx, param_env, self_type, adt, args, parent_cause, "Copy");
  if (r.$ === "Err") {
    return Err({ $: "InfringingFields", _0: r._0 });
  }

  const did = adt.destructor(tcx)?.did;
  if (did !== undefined) {
    return Err({ $: "HasDestructor", _0: did });
  }

  if (Safety.is_safe(impl_safety) && self_type.has_unsafe_fields()) {
    return Err({ $: "HasUnsafeFields" });
  }

  return Ok(null);
}

/// Checks that the fields of the type (an ADT) all implement `(Unsized?)ConstParamTy`.
///
/// If fields don't implement `(Unsized?)ConstParamTy`, return an error containing a list of
/// those violating fields.
///
/// If it's not an ADT, int ty, `bool` or `char`, returns `Err(NotAnAdtOrBuiltinAllowed)`.
// rustc: compiler/rustc_trait_selection/src/traits/misc.rs:92 type_allowed_to_implement_const_param_ty
export function type_allowed_to_implement_const_param_ty(
  tcx: TyCtxt,
  param_env: ParamEnv,
  self_type: Ty,
  parent_cause: ObligationCause,
): Result<null, ConstParamTyImplementationError> {
  let need_unstable_feature_bound = false;

  let inner_tys: Ty[];
  const k = self_type.kind();
  switch (k.$) {
    // Trivially okay as these types are all:
    // - Sized
    // - Contain no nested types
    // - Have structural equality
    case "Uint":
    case "Int":
    case "Bool":
    case "Char":
      return Ok(null);

    // Handle types gated under `feature(unsized_const_params)`
    // FIXME(unsized_const_params): Make `const N: [u8]` work then forbid references
    case "Slice": {
      const inner_ty = k._0;
      need_unstable_feature_bound = true;
      inner_tys = [inner_ty];
      break;
    }
    case "Ref": {
      if (k._2 !== "Not") {
        return Err({ $: "NotAnAdtOrBuiltinAllowed" });
      }
      const inner_ty = k._1;
      need_unstable_feature_bound = true;
      inner_tys = [inner_ty];
      break;
    }
    case "Str":
      need_unstable_feature_bound = true;
      inner_tys = [Ty.new_slice(tcx, tcx.types.u8)];
      break;
    case "Array": {
      const inner_ty = k._0;
      inner_tys = [inner_ty];
      break;
    }

    // `str` morally acts like a newtype around `[u8]`
    case "Tuple":
      inner_tys = [...k._0];
      break;

    case "Adt": {
      const adt = k._0;
      const args = k._1;
      if (!(adt.is_enum() || adt.is_struct())) {
        return Err({ $: "NotAnAdtOrBuiltinAllowed" });
      }
      if (!tcx.features().adt_const_params()) {
        for (const variant of adt.variants()) {
          if (variant.is_field_list_non_exhaustive()) {
            const sp = find_attr(tcx.get_all_attrs(variant.def_id), (a) => (a.$ === "NonExhaustive" ? a._0 : undefined));
            let attr_span: Span;
            if (sp !== undefined) {
              attr_span = sp;
            } else {
              return bug("non_exhaustive variant missing NonExhaustive attribute");
            }
            return Err({ $: "NonExhaustive", _0: attr_span });
          }
        }
      }

      const r = all_fields_implement_trait(tcx, param_env, self_type, adt, args, clone_ObligationCause(parent_cause), "ConstParamTy");
      if (r.$ === "Err") {
        return Err({ $: "InfrigingFields", _0: r._0 });
      }

      inner_tys = [];
      break;
    }

    default:
      return Err({ $: "NotAnAdtOrBuiltinAllowed" });
  }

  const infringing_inner_tys: [Ty, InfringingFieldsReason][] = [];
  for (const inner_ty of inner_tys) {
    // We use an ocx per inner ty for better diagnostics
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const ocx = ObligationCtxt.new_with_diagnostics(infcx);

    // Make sure impls certain types are gated with #[unstable_feature_bound(unsized_const_params)]
    if (need_unstable_feature_bound) {
      ocx.register_obligation(
        Obligation.new(
          tcx,
          clone_ObligationCause(parent_cause),
          param_env,
          { $: "UnstableFeature", _0: sym.unsized_const_params } as ClauseKind,
          Predicate_upcast_from_ClauseKind as (from: ClauseKind, tcx: Interner) => Predicate,
        ),
      );

      if (!TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
        return Err({ $: "UnsizedConstParamsFeatureRequired" });
      }
    }

    ocx.register_bound(clone_ObligationCause(parent_cause), param_env, inner_ty, tcx.require_lang_item("ConstParamTy", parent_cause.span));

    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (errors.$ === "HasErrors") {
      infringing_inner_tys.push([inner_ty, { $: "Fulfill", _0: errors._0 }]);
      continue;
    }

    // Check regions assuming the self type of the impl is WF
    const errors2 = infcx.resolve_regions(parent_cause.body_def_id, param_env, [self_type]);
    if (errors2.length !== 0) {
      infringing_inner_tys.push([inner_ty, { $: "Regions", _0: errors2 }]);
      continue;
    }
  }

  if (infringing_inner_tys.length !== 0) {
    return Err({ $: "InvalidInnerTyOfBuiltinTy", _0: infringing_inner_tys });
  }

  return Ok(null);
}

/// Check that all fields of a given `adt` implement `lang_item` trait.
// rustc: compiler/rustc_trait_selection/src/traits/misc.rs:204 all_fields_implement_trait
export function all_fields_implement_trait(
  tcx: TyCtxt,
  param_env: ParamEnv,
  self_type: Ty,
  adt: AdtDef,
  args: GenericArgs,
  parent_cause: ObligationCause,
  lang_item: LangItem,
): Result<null, [FieldDef, Ty, InfringingFieldsReason][]> {
  const trait_def_id = tcx.require_lang_item(lang_item, parent_cause.span);

  const infringing: [FieldDef, Ty, InfringingFieldsReason][] = [];
  for (const variant of adt.variants()) {
    for (const field of variant.fields) {
      // Do this per-field to get better error messages.
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const ocx = ObligationCtxt.new_with_diagnostics(infcx);

      const unnormalized_ty = field.ty(tcx, args);
      if (TypeVisitableExt.references_error(Unnormalized.skip_normalization(Unnormalized.as_ref(unnormalized_ty)), fold_Ty)) {
        continue;
      }

      const field_span = tcx.def_span(field.did);
      const node = tcx.hir_get_if_local(field.did);
      const field_ty_span = node !== undefined && node.$ === "Field" ? node._0.ty.span : field_span;

      // FIXME(compiler-errors): This gives us better spans for bad
      // projection types like in issue-50480.
      // If the ADT has args, point to the cause we are given.
      // If it does not, then this field probably doesn't normalize
      // to begin with, and point to the bad field's span instead.
      const normalization_cause = TypeVisitableExt.has_non_region_param(
        Unnormalized.skip_normalization(field.ty(tcx, RawList.identity_for_item(tcx, adt.did()))),
        fold_Ty,
      )
        ? clone_ObligationCause(parent_cause)
        : ObligationCauseC.dummy_with_span(field_ty_span);
      const ty: Ty = ocx.normalize(normalization_cause, param_env, unnormalized_ty, fold_Ty);
      const normalization_errors = ocx.try_evaluate_obligations();

      // NOTE: The post-normalization type may also reference errors,
      // such as when we project to a missing type or we have a mismatch
      // between expected and found const-generic types. Don't report an
      // additional copy error here, since it's not typically useful.
      if (!TraitErrors.no_errors(normalization_errors) || TypeVisitableExt.references_error(ty, fold_Ty)) {
        tcx.dcx().span_delayed_bug(field_span, `couldn't normalize struct field \`${display_Ty(ty)}\` when checking ${tcx.def_path_str(trait_def_id)} implementation`);
        continue;
      }

      ocx.register_bound(ObligationCauseC.dummy_with_span(field_ty_span), param_env, ty, trait_def_id);
      const errors = ocx.evaluate_obligations_error_on_ambiguity();
      if (errors.$ === "HasErrors") {
        infringing.push([field, ty, { $: "Fulfill", _0: errors._0 }]);
      }

      // Check regions assuming the self type of the impl is WF
      const errors2: RegionResolutionError[] = infcx.resolve_regions(parent_cause.body_def_id, param_env, [self_type]);
      if (errors2.length !== 0) {
        infringing.push([field, ty, { $: "Regions", _0: errors2 }]);
      }
    }
  }

  if (infringing.length === 0) {
    return Ok(null);
  } else {
    return Err(infringing);
  }
}
