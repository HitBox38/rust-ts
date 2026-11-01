// Port of src/tools/miri/src/intrinsics/math.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type PlaceTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type HostUnaryFloatOp } from "../math.ts";
import { type EmulateItemResult } from "../shims/mod.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { type FloatTy } from "../../rustc_ast_ir/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { unported } from "../../std/panic.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/math.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/math.rs:92
    emulate_math_intrinsic(this: MiriInterpCx, intrinsic_name: string, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy): InterpResult<EmulateItemResult>;
  }
}

// intrinsics/math.rs:215 (pub(crate))
export function compute_crc32(crc: number, data: bigint, bit_size: number, polynomial: bigint): number {
  return unported("miri::intrinsics::math::compute_crc32 (src/tools/miri/src/intrinsics/math.rs:215; lane miri-shims-d)");
}
// intrinsics/math.rs:284 (pub(crate))
export function sub_word(word: number): number {
  return unported("miri::intrinsics::math::sub_word (src/tools/miri/src/intrinsics/math.rs:284; lane miri-shims-d)");
}
// intrinsics/math.rs:293 (pub(crate))
export function sigma0(x: number): number {
  return unported("miri::intrinsics::math::sigma0 (src/tools/miri/src/intrinsics/math.rs:293; lane miri-shims-d)");
}
// intrinsics/math.rs:297 (pub(crate))
export function sigma1(x: number): number {
  return unported("miri::intrinsics::math::sigma1 (src/tools/miri/src/intrinsics/math.rs:297; lane miri-shims-d)");
}
// intrinsics/math.rs:302 (pub(crate))
export function round(state: number[], wk: number): number[] {
  return unported("miri::intrinsics::math::round (src/tools/miri/src/intrinsics/math.rs:302; lane miri-shims-d)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// fn sqrt (intrinsics/math.rs:10)
// fn is_host_unary_float_op (intrinsics/math.rs:20)
// fn pow_intrinsic (intrinsics/math.rs:41)
// fn powi_intrinsic (intrinsics/math.rs:65)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::intrinsics::math::EvalContextExt", "src/tools/miri/src/intrinsics/math.rs", "miri-shims-d", () => InterpCx.prototype, ["emulate_math_intrinsic"]);
