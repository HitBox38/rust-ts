// Port of src/tools/miri/src/intrinsics/x86/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-x86-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type FloatBinOp, type FloatUnaryOp, type ShiftOp } from "./mod.gen.ts";
import { type ImmTy, type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type EmulateItemResult } from "../../shims/mod.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type BinOp } from "../../../rustc_middle/mir/syntax.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { type Round } from "../../../vendor/rustc_apfloat/lib.ts";
export * from "./mod.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/mod.rs:28
    emulate_x86_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl FloatBinOp (intrinsics/x86/mod.rs:196) [FloatBinOp is not a generated class: companion fns / hand type, lane decides]: cmp_from_imm (:199)
// fn bin_op_float (intrinsics/x86/mod.rs:243)
// fn bin_op_simd_float_first (intrinsics/x86/mod.rs:300)
// fn bin_op_simd_float_all (intrinsics/x86/mod.rs:330)
// fn unary_op_f32 (intrinsics/x86/mod.rs:371)
// fn unary_op_ss (intrinsics/x86/mod.rs:398)
// fn unary_op_ps (intrinsics/x86/mod.rs:421)
// fn shift_simd_by_scalar (intrinsics/x86/mod.rs:458)
// fn shift_simd_by_simd (intrinsics/x86/mod.rs:509)
// fn extract_first_u64 (intrinsics/x86/mod.rs:561)
// fn round_first (intrinsics/x86/mod.rs:575)
// fn round_all (intrinsics/x86/mod.rs:606)
// fn rounding_from_imm (intrinsics/x86/mod.rs:633)
// fn convert_float_to_int (intrinsics/x86/mod.rs:658)
// fn split_simd_to_128bit_chunks (intrinsics/x86/mod.rs:696)
// fn conditional_dot_product (intrinsics/x86/mod.rs:728)
// fn test_bits_masked (intrinsics/x86/mod.rs:786)
// fn test_high_bits_masked (intrinsics/x86/mod.rs:817)
// fn mpsadbw (intrinsics/x86/mod.rs:857)
// fn psadbw (intrinsics/x86/mod.rs:920)
// fn pmaddwd (intrinsics/x86/mod.rs:965)
// fn pmaddbw (intrinsics/x86/mod.rs:1013)
// fn permute (intrinsics/x86/mod.rs:1067)
// fn permute2 (intrinsics/x86/mod.rs:1115)
// fn pmulhrsw (intrinsics/x86/mod.rs:1159)
// fn pclmulqdq (intrinsics/x86/mod.rs:1200)
// fn pshufb (intrinsics/x86/mod.rs:1257)
// fn pack_generic (intrinsics/x86/mod.rs:1297)
// fn packsswb (intrinsics/x86/mod.rs:1341)
// fn packuswb (intrinsics/x86/mod.rs:1360)
// fn packssdw (intrinsics/x86/mod.rs:1379)
// fn packusdw (intrinsics/x86/mod.rs:1398)
// fn psign (intrinsics/x86/mod.rs:1415)
// fn carrying_add (intrinsics/x86/mod.rs:1445)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::intrinsics::x86::EvalContextExt", "src/tools/miri/src/intrinsics/x86/mod.rs", "miri-x86-a", () => InterpCx.prototype, ["emulate_x86_intrinsic"]);
