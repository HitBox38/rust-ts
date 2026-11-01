// Port of src/tools/miri/src/intrinsics/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type PlaceTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type EmulateItemResult } from "../shims/mod.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/mod.rs:39
    call_intrinsic(this: MiriInterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult<Instance | undefined>;
    // intrinsics/mod.rs:82
    emulate_intrinsic_by_name(this: MiriInterpCx, intrinsic_name: string, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<EmulateItemResult>;
    // intrinsics/mod.rs:154
    call_llvm_intrinsic(this: MiriInterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// fn check_intrinsic_arg_count (intrinsics/mod.rs:21)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::intrinsics::EvalContextExt", "src/tools/miri/src/intrinsics/mod.rs", "miri-shims-d", () => InterpCx.prototype, ["call_intrinsic", "emulate_intrinsic_by_name", "call_llvm_intrinsic"]);
