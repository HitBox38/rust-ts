// Port of compiler/rustc_const_eval/src/util/compare_types.rs (lane mt-validate, ahead of ctfe-util: the MIR
// `Validator` relates the two sides of assignments with `relate_types` / `sub_types`).
//
//! Routines to check for relations between fully inferred types.
//!
//! FIXME: Move this to a more general place. The utility of this extends to
//! other areas of the compiler as well.
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";

/// Returns whether `src` is a subtype of `dest`, i.e. `src <: dest`.
// rustc: compiler/rustc_const_eval/src/util/compare_types.rs:12 sub_types
export function sub_types(tcx: TyCtxt, typing_env: TypingEnv, src: Ty, dest: Ty): boolean {
  return relate_types(tcx, typing_env, Variance.Covariant, src, dest);
}

/// Returns whether `src` is a subtype of `dest`, i.e. `src <: dest`.
///
/// When validating assignments, the variance should be `Covariant`. When checking
/// during `MirPhase` >= `MirPhase::Runtime(RuntimePhase::Initial)` variance should be `Invariant`
/// because we want to check for type equality.
// rustc: compiler/rustc_const_eval/src/util/compare_types.rs:26 relate_types
export function relate_types(tcx: TyCtxt, typing_env: TypingEnv, variance: Variance, src_: Ty, dest_: Ty): boolean {
  if (src_ === dest_) {
    return true;
  }

  const [infcx, param_env] = tcx.infer_ctxt().ignoring_regions().build_with_typing_env(typing_env);
  const ocx = ObligationCtxt.new(infcx);
  const cause = ObligationCause.dummy();
  const src = ocx.normalize(cause, param_env, Unnormalized.new_wip(src_), fold_Ty);
  const dest = ocx.normalize(cause, param_env, Unnormalized.new_wip(dest_), fold_Ty);
  const r = ocx.relate(cause, param_env, variance, src, dest, ToTrace_Ty);
  switch (r.$) {
    case "Ok":
      break;
    case "Err":
      return false;
  }
  return TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
}
