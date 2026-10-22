// Port of compiler/rustc_const_eval/src/util/check_validity_requirement.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-util; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type LayoutCx, type LayoutError, type TyAndLayout, type ValidityRequirement } from "../../rustc_middle/ty/layout.ts";
import { type PseudoCanonicalInput, type Ty } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";

// stub: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:25 check_validity_requirement (lane ctfe-util)
export function check_validity_requirement(tcx: TyCtxt, kind: ValidityRequirement, input: PseudoCanonicalInput<Ty>): Result<boolean, LayoutError> {
  return unported("rustc_const_eval::util::check_validity_requirement::check_validity_requirement");
}

// stub: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:47 check_validity_requirement_strict (lane ctfe-util)
export function check_validity_requirement_strict(ty: TyAndLayout, cx: LayoutCx, kind: ValidityRequirement): boolean {
  return unported("rustc_const_eval::util::check_validity_requirement::check_validity_requirement_strict");
}

// stub: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:91 check_validity_requirement_lax (lane ctfe-util)
export function check_validity_requirement_lax(this_: TyAndLayout, cx: LayoutCx, init_kind: ValidityRequirement): Result<boolean, LayoutError> {
  return unported("rustc_const_eval::util::check_validity_requirement::check_validity_requirement_lax");
}

// stub: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:183 validate_scalar_in_layout (lane ctfe-util)
export function validate_scalar_in_layout(tcx: TyCtxt, scalar: ScalarInt, ty: Ty): boolean {
  return unported("rustc_const_eval::util::check_validity_requirement::validate_scalar_in_layout");
}
