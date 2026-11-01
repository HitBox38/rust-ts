// Port of src/tools/miri/src/operator.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-eval` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ImmTy } from "./lib.ts";
import { type MiriInterpCx } from "./machine.ts";
import { stub_methods } from "../rust_ts/miri_stub.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../rustc_middle/mir/interpret/mod.ts";
import { type BinOp } from "../rustc_middle/mir/syntax.ts";

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- operator.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // operator.rs:13 (PORT: decision C8, `binary_ptr_op` is also a rustc_const_eval `InterpCx` method)
    binary_ptr_op_(this: MiriInterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:74
    generate_nan<F1, F2>(this: MiriInterpCx, inputs: readonly F1[]): F2;
    // operator.rs:119
    equal_float_min_max<F>(this: MiriInterpCx, a: F, b: F): F;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::operator::EvalContextExt", "src/tools/miri/src/operator.rs", "miri-eval", () => InterpCx.prototype, ["binary_ptr_op_", "generate_nan", "equal_float_min_max"]);
