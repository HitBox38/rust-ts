// Port of compiler/rustc_const_eval/src/util/compare_types.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-util; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { type Variance } from "../../rustc_type_ir/lib.ts";
import { unported } from "../../std/panic.ts";

// stub: compiler/rustc_const_eval/src/util/compare_types.rs:12 sub_types (lane ctfe-util)
export function sub_types(tcx: TyCtxt, typing_env: TypingEnv, src: Ty, dest: Ty): boolean {
  return unported("rustc_const_eval::util::compare_types::sub_types");
}

// stub: compiler/rustc_const_eval/src/util/compare_types.rs:26 relate_types (lane ctfe-util)
export function relate_types(tcx: TyCtxt, typing_env: TypingEnv, variance: Variance, src: Ty, dest: Ty): boolean {
  return unported("rustc_const_eval::util::compare_types::relate_types");
}
