// Port of compiler/rustc_const_eval/src/check_consts/qualifs.rs (lane mt-promote).
//
// PORT: `trait Qualif` has only associated consts and fns without `self`, and its implementors are unit structs used
// as type parameters (`in_rvalue::<Q, _>`). It is the impl-table interface `Qualif`; each implementor is a frozen
// table of the same name (`HasMutInterior`, ...), and a generic `Q: Qualif` is the table passed first as `Q_`
// (precedent: mb-scope's `T: DropTreeBuilder` as `T_`). `in_local: &mut F` (`F: FnMut(Local) -> bool`) is a closure.
//! Structural const qualification.
//!
//! See the `Qualif` trait for more info.

// FIXME(const_trait_impl): This API should be really reworked. It's dangerously general for
// having basically only two use-cases that act in different ways.

import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import {
  Const,
  type ConstQualifs,
  type Local,
  type Operand,
  type PlaceRef,
  type Rvalue,
  Rvalue as RvalueC,
  type UnevaluatedConst,
} from "../../rustc_middle/mir/mod.ts";
import { debug_Local } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { bug } from "../../rustc_span/macros.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, PolyTraitRef, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import type { TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import type { ConstCx } from "./mod.ts";

/** PORT: D4 descriptor of `TraitRef` for `Binder::dummy` (as rustc_infer traits/util.ts's private `d_TraitRef`). */
const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:20 in_any_value_of_ty
export function in_any_value_of_ty(cx: ConstCx, ty: Ty, tainted_by_errors: ErrorGuaranteed | undefined): ConstQualifs {
  return {
    has_mut_interior: HasMutInterior.in_any_value_of_ty(cx, ty),
    needs_drop: NeedsDrop.in_any_value_of_ty(cx, ty),
    needs_non_const_drop: NeedsNonConstDrop.in_any_value_of_ty(cx, ty),
    tainted_by_errors,
  };
}

/// A "qualif"(-ication) is a way to look for something "bad" in the MIR that would disqualify some
/// code for promotion or prevent it from evaluating at compile time.
///
/// Normally, we would determine what qualifications apply to each type and error when an illegal
/// operation is performed on such a type. However, this was found to be too imprecise, especially
/// in the presence of `enum`s. If only a single variant of an enum has a certain qualification, we
/// needn't reject code unless it actually constructs and operates on the qualified variant.
///
/// To accomplish this, const-checking and promotion use a value-based analysis (as opposed to a
/// type-based one). Qualifications propagate structurally across variables: If a local (or a
/// projection of a local) is assigned a qualified value, that local itself becomes qualified.
// rustc-trait: compiler/rustc_const_eval/src/check_consts/qualifs.rs:44 Qualif
export interface Qualif {
  /// The name of the file used to debug the dataflow analysis that computes this qualif.
  readonly ANALYSIS_NAME: string;

  /// Whether this `Qualif` is cleared when a local is moved from.
  readonly IS_CLEARED_ON_MOVE: boolean;

  /// Whether this `Qualif` might be evaluated after the promotion and can encounter a promoted.
  readonly ALLOW_PROMOTED: boolean;

  /// Extracts the field of `ConstQualifs` that corresponds to this `Qualif`.
  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:55 in_qualifs
  in_qualifs(qualifs: ConstQualifs): boolean;

  /// Returns `true` if *any* value of the given type could possibly have this `Qualif`.
  ///
  /// This function determines `Qualif`s when we cannot do a value-based analysis. Since qualif
  /// propagation is context-insensitive, this includes function arguments and values returned
  /// from a call to another function.
  ///
  /// It also determines the `Qualif`s for primitive types.
  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:64 in_any_value_of_ty
  in_any_value_of_ty(cx: ConstCx, ty: Ty): boolean;

  /// Returns `true` if the `Qualif` is structural in an ADT's fields, i.e. if we may
  /// recurse into an operand *value* to determine whether it has this `Qualif`.
  ///
  /// If this returns false, `in_any_value_of_ty` will be invoked to determine the
  /// final qualif for this ADT.
  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:71 is_structural_in_adt_value
  is_structural_in_adt_value(cx: ConstCx, adt: AdtDef): boolean;
}

/// Constant containing interior mutability (`UnsafeCell<T>`).
/// This must be ruled out to make sure that evaluating the constant at compile-time
/// and at *any point* during the run-time would produce the same result. In particular,
/// promotion of temporaries must not change program behavior; if the promoted could be
/// written to, that would be a problem.
// rustc-type: compiler/rustc_const_eval/src/check_consts/qualifs.rs:79 HasMutInterior
export const HasMutInterior: Qualif = Object.freeze({
  ANALYSIS_NAME: "flow_has_mut_interior",
  IS_CLEARED_ON_MOVE: false,
  ALLOW_PROMOTED: false,

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:86 in_qualifs
  in_qualifs(qualifs: ConstQualifs): boolean {
    return qualifs.has_mut_interior;
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:90 in_any_value_of_ty
  in_any_value_of_ty(cx: ConstCx, ty: Ty): boolean {
    // Avoid selecting for simple cases, such as builtin types.
    if (ty.is_trivially_freeze()) {
      return false;
    }

    // Avoid selecting for `UnsafeCell` either.
    const adt = ty.ty_adt_def();
    if (adt !== undefined && adt.is_unsafe_cell()) {
      return true;
    }

    // We do not use `ty.is_freeze` here, because that requires revealing opaque types, which
    // requires borrowck, which in turn will invoke mir_const_qualifs again, causing a cycle error.
    // Instead we invoke an obligation context manually, and provide the opaque type inference settings
    // that allow the trait solver to just error out instead of cycling.
    const freeze_def_id = cx.tcx.require_lang_item(LangItem.Freeze, cx.body.span);
    const did = cx.body.source.def_id().expect_local();

    const typing_env = cx.tcx.use_typing_mode_post_typeck_until_borrowck()
      ? cx.typing_env
      : TypingEnv.new(cx.typing_env.param_env, TypingMode.analysis_in_body(as_interner(cx.tcx), did));

    const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(typing_env);
    const ocx = ObligationCtxt.new(infcx);
    const obligation = Obligation.new(
      cx.tcx,
      ObligationCause.dummy_with_span(cx.body.span),
      param_env,
      // `[ty::GenericArg::from(ty)]`: a `Ty` is a `GenericArg` (PORTING §5 packed pointers).
      TraitRef.new(as_interner(cx.tcx), freeze_def_id, [ty]),
      (from, _cx) => Predicate_upcast_from_TraitRef(from, cx.tcx),
    );
    ocx.register_obligation(obligation);
    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    return !TraitErrors.no_errors(errors);
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:127 is_structural_in_adt_value
  is_structural_in_adt_value(_cx: ConstCx, adt: AdtDef): boolean {
    // Exactly one type, `UnsafeCell`, has the `HasMutInterior` qualif inherently.
    // It arises structurally for all other types.
    return !adt.is_unsafe_cell();
  },
});

/// Constant containing an ADT that implements `Drop`.
/// This must be ruled out because implicit promotion would remove side-effects
/// that occur as part of dropping that value. N.B., the implicit promotion has
/// to reject const Drop implementations because even if side-effects are ruled
/// out through other means, the execution of the drop could diverge.
// rustc-type: compiler/rustc_const_eval/src/check_consts/qualifs.rs:139 NeedsDrop
export const NeedsDrop: Qualif = Object.freeze({
  ANALYSIS_NAME: "flow_needs_drop",
  IS_CLEARED_ON_MOVE: true,
  ALLOW_PROMOTED: true,

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:146 in_qualifs
  in_qualifs(qualifs: ConstQualifs): boolean {
    return qualifs.needs_drop;
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:150 in_any_value_of_ty
  in_any_value_of_ty(cx: ConstCx, ty: Ty): boolean {
    return ty.needs_drop(cx.tcx, cx.typing_env);
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:154 is_structural_in_adt_value
  is_structural_in_adt_value(cx: ConstCx, adt: AdtDef): boolean {
    return !adt.has_dtor(cx.tcx);
  },
});

/// Constant containing an ADT that implements non-const `Drop`.
/// This must be ruled out because we cannot run `Drop` during compile-time.
// rustc-type: compiler/rustc_const_eval/src/check_consts/qualifs.rs:161 NeedsNonConstDrop
export const NeedsNonConstDrop: Qualif = Object.freeze({
  ANALYSIS_NAME: "flow_needs_nonconst_drop",
  IS_CLEARED_ON_MOVE: true,
  ALLOW_PROMOTED: true,

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:168 in_qualifs
  in_qualifs(qualifs: ConstQualifs): boolean {
    return qualifs.needs_non_const_drop;
  },

  // #[instrument(level = "trace", skip(cx), ret)]
  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:173 in_any_value_of_ty
  in_any_value_of_ty(cx: ConstCx, ty: Ty): boolean {
    // If this doesn't need drop at all, then don't select `[const] Destruct`.
    if (!ty.needs_drop(cx.tcx, cx.typing_env)) {
      return false;
    }

    // We check that the type is `[const] Destruct` since that will verify that
    // the type is both `[const] Drop` (if a drop impl exists for the adt), *and*
    // that the components of this type are also `[const] Destruct`. This
    // amounts to verifying that there are no values in this ADT that may have
    // a non-const drop.
    const destruct_def_id = cx.tcx.require_lang_item(LangItem.Destruct, cx.body.span);
    const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(cx.typing_env);
    const ocx = ObligationCtxt.new(infcx);
    const k = cx.const_kind_();
    ocx.register_obligation(
      Obligation.new(
        cx.tcx,
        ObligationCause.misc(cx.body.span, cx.def_id()),
        param_env,
        PolyTraitRef.to_host_effect_clause(
          Binder.dummy(TraitRef.new(as_interner(cx.tcx), destruct_def_id, [ty]), d_TraitRef),
          cx.tcx,
          k.$ === "ConstFn" ? "Maybe" : /* ConstContext::Static(_) | ConstContext::Const { .. } */ "Const",
        ),
        (from, _cx) => Predicate_upcast_from_Clause(from, cx.tcx),
      ),
    );
    return !TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:204 is_structural_in_adt_value
  is_structural_in_adt_value(cx: ConstCx, adt: AdtDef): boolean {
    // As soon as an ADT has a destructor, then the drop becomes non-structural
    // in its value since:
    // 1. The destructor may have `[const]` bounds which are not present on the type.
    //   Someone needs to check that those are satisfied.
    //   While this could be instead satisfied by checking that the `[const] Drop`
    //   impl holds (i.e. replicating part of the `in_any_value_of_ty` logic above),
    //   even in this case, we have another problem, which is,
    // 2. The destructor may *modify* the operand being dropped, so even if we
    //   did recurse on the components of the operand, we may not be even dropping
    //   the same values that were present before the custom destructor was invoked.
    return !adt.has_dtor(cx.tcx);
  },
});

// FIXME: Use `mir::visit::Visitor` for the `in_*` functions if/when it supports early return.

/// Returns `true` if this `Rvalue` contains qualif `Q`.
// rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:222 in_rvalue
export function in_rvalue(Q_: Qualif, cx: ConstCx, in_local: (local: Local) => boolean, rvalue: Rvalue): boolean {
  switch (rvalue.$) {
    case "ThreadLocalRef":
      return Q_.in_any_value_of_ty(cx, RvalueC.ty(rvalue, cx.body, cx.tcx));

    case "Discriminant":
      return in_place(Q_, cx, in_local, rvalue._0.as_ref());

    case "CopyForDeref":
      return in_place(Q_, cx, in_local, rvalue._0.as_ref());

    case "Use":
    case "Repeat":
    case "UnaryOp":
      return in_operand(Q_, cx, in_local, rvalue.$ === "UnaryOp" ? rvalue._1 : rvalue._0);
    case "Cast":
      return in_operand(Q_, cx, in_local, rvalue._1);

    case "BinaryOp": {
      const [lhs, rhs] = rvalue._1;
      return in_operand(Q_, cx, in_local, lhs) || in_operand(Q_, cx, in_local, rhs);
    }

    case "Ref":
    case "RawPtr": {
      const place = rvalue.$ === "Ref" ? rvalue._2 : rvalue._1;
      // Special-case reborrows to be more like a copy of the reference.
      const last = place.as_ref().last_projection();
      if (last !== undefined && last[1].$ === "Deref") {
        const place_base = last[0];
        const base_ty = place_base.ty(cx.body, cx.tcx).ty;
        if (base_ty.kind().$ === "Ref") {
          return in_place(Q_, cx, in_local, place_base);
        }
      }

      return in_place(Q_, cx, in_local, place.as_ref());
    }

    case "Reborrow":
      return in_place(Q_, cx, in_local, rvalue._2.as_ref());

    case "WrapUnsafeBinder":
      return in_operand(Q_, cx, in_local, rvalue._0);

    case "Aggregate": {
      const kind = rvalue._0;
      const operands = rvalue._1;
      // Return early if we know that the struct or enum being constructed is always
      // qualified.
      if (kind.$ === "Adt") {
        const adt_did = kind._0;
        // PORT: the `adt_def` query value is `unknown` in queries.gen.ts.
        const def = cx.tcx.adt_def(adt_did) as AdtDef;
        // Don't do any value-based reasoning for unions.
        // Also, if the ADT is not structural in its fields,
        // then we cannot recurse on its fields. Instead,
        // we fall back to checking the qualif for *any* value
        // of the ADT.
        if (def.is_union() || !Q_.is_structural_in_adt_value(cx, def)) {
          return Q_.in_any_value_of_ty(cx, RvalueC.ty(rvalue, cx.body, cx.tcx));
        }
      }

      // Otherwise, proceed structurally...
      return operands.some((o) => in_operand(Q_, cx, in_local, o));
    }
  }
}

/// Returns `true` if this `Place` contains qualif `Q`.
// rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:285 in_place
export function in_place(Q_: Qualif, cx: ConstCx, in_local: (local: Local) => boolean, place_: PlaceRef): boolean {
  let place = place_;
  for (let last = place.last_projection(); last !== undefined; last = place.last_projection()) {
    const [place_base, elem] = last;
    switch (elem.$) {
      case "Index":
        if (in_local(elem._0)) return true;
        break;

      case "Deref":
      case "PhantomDeref":
      case "Field":
      case "OpaqueCast":
      case "ConstantIndex":
      case "Subslice":
      case "Downcast":
      case "UnwrapUnsafeBinder":
        break;
    }

    const base_ty = place_base.ty(cx.body, cx.tcx);
    const proj_ty = base_ty.projection_ty(cx.tcx, elem, debug_Local).ty;
    if (!Q_.in_any_value_of_ty(cx, proj_ty)) {
      return false;
    }

    // `Deref` currently unconditionally "qualifies" if `in_any_value_of_ty` returns true,
    // i.e., we treat all qualifs as non-structural for deref projections. Generally,
    // we can say very little about `*ptr` even if we know that `ptr` satisfies all
    // sorts of properties.
    if (elem.$ === "Deref") {
      // We have to assume that this qualifies.
      return true;
    }

    place = place_base;
  }

  assert(place.projection.length === 0, "assertion failed: place.projection.is_empty()");
  return in_local(place.local);
}

/// Returns `true` if this `Operand` contains qualif `Q`.
// rustc: compiler/rustc_const_eval/src/check_consts/qualifs.rs:329 in_operand
export function in_operand(Q_: Qualif, cx: ConstCx, in_local: (local: Local) => boolean, operand: Operand): boolean {
  let constant;
  switch (operand.$) {
    case "Copy":
    case "Move":
      return in_place(Q_, cx, in_local, operand._0.as_ref());
    case "RuntimeChecks":
      return Q_.in_any_value_of_ty(cx, cx.tcx.types.bool);

    case "Constant":
      constant = operand._0;
      break;
  }

  // Check the qualifs of the value of `const` items.
  let uneval: UnevaluatedConst | undefined;
  const c = constant.const_;
  switch (c.$) {
    case "Ty": {
      const ct = c._1;
      const k = ct.kind();
      switch (k.$) {
        case "Param":
        case "Error":
          uneval = undefined;
          break;
        // Alias consts in MIR bodies don't have associated MIR (e.g. `type const`).
        case "Alias":
          uneval = undefined;
          break;
        // FIXME(mgca): Investigate whether using `None` for `ConstKind::Value` is overly
        // strict, and if instead we should be doing some kind of value-based analysis.
        case "Value":
          uneval = undefined;
          break;
        default:
          return bug(
            `expected ConstKind::Param, ConstKind::Value, ConstKind::Alias, or ConstKind::Error here, found ${debug_Const(ct, PLAIN)}`,
          );
      }
      break;
    }
    case "Unevaluated":
      uneval = c._0;
      break;
    case "Val":
      uneval = undefined;
      break;
  }

  if (uneval !== undefined) {
    const { def, promoted } = uneval;
    // Use qualifs of the type for the promoted. Promoteds in MIR body should be possible
    // only for `NeedsNonConstDrop` with precise drop checking. This is the only const
    // check performed after the promotion. Verify that with an assertion.
    assert(promoted === undefined || Q_.ALLOW_PROMOTED, "assertion failed: promoted.is_none() || Q::ALLOW_PROMOTED");

    // Don't peak inside trait associated constants.
    if (promoted === undefined && cx.tcx.trait_of_assoc(def) === undefined) {
      const qualifs = cx.tcx.at(constant.span).mir_const_qualif(def);

      if (!Q_.in_qualifs(qualifs)) {
        return false;
      }

      // Just in case the type is more specific than
      // the definition, e.g., impl associated const
      // with type parameters, take it into account.
    }
  }

  // Otherwise use the qualifs of the type.
  return Q_.in_any_value_of_ty(cx, Const.ty(constant.const_));
}
