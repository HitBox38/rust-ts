// Port of compiler/rustc_const_eval/src/interpret/intrinsics/atomic.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-intrinsics; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { InterpCx } from "../eval_context.ts";
import { type Machine } from "../machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock } from "../../../rustc_middle/mir/mod.ts";
import { type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { unported } from "../../../std/panic.ts";
import { OpTy } from "../operand.gen.ts";
import { PlaceTy } from "../place.gen.ts";

declare module "../eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // atomic.rs:15 (lane interp-intrinsics)
    eval_atomic_intrinsic(intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/atomic.rs:15 eval_atomic_intrinsic (lane interp-intrinsics)
InterpCx.prototype.eval_atomic_intrinsic = function (this: InterpCx, intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::intrinsics::atomic::InterpCx::eval_atomic_intrinsic");
};
