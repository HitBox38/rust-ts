// Port of src/tools/miri/src/math.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-eval` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into math.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ImmTy, type OpTy, type PlaceTy } from "./lib.ts";
import { type MiriInterpCx } from "./machine.ts";
import { type HostUnaryFloatOp } from "./math.gen.ts";
import { type InterpResult } from "../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../rustc_type_ir/decls.ts";
import { unported } from "../std/panic.ts";
export * from "./math.gen.ts";

// math.rs:71 (pub(crate))
export function apply_random_float_error<F>(ecx: MiriInterpCx, val: F, err_scale: number): F {
  return unported("miri::math::apply_random_float_error (src/tools/miri/src/math.rs:71; lane miri-eval)");
}
// math.rs:108 (pub(crate))
export function apply_random_float_error_ulp<F>(ecx: MiriInterpCx, val: F, max_error: number): F {
  return unported("miri::math::apply_random_float_error_ulp (src/tools/miri/src/math.rs:108; lane miri-eval)");
}
// math.rs:149 (pub(crate))
export function apply_random_float_error_to_imm(ecx: MiriInterpCx, val: ImmTy, max_error: number): InterpResult<ImmTy> {
  return unported("miri::math::apply_random_float_error_to_imm (src/tools/miri/src/math.rs:149; lane miri-eval)");
}
// math.rs:187 (pub(crate))
export function clamp_float_value<S>(intrinsic_name: string, val: Pending<"IeeeFloat<S>">): Pending<"IeeeFloat<S>"> {
  return unported("miri::math::clamp_float_value (src/tools/miri/src/math.rs:187; lane miri-eval)");
}
// math.rs:264 (pub(crate))
export function fixed_float_value<S>(ecx: MiriInterpCx, intrinsic_name: string, args: readonly Pending<"IeeeFloat<S>">[]): Pending<"IeeeFloat<S>"> | undefined {
  return unported("miri::math::fixed_float_value (src/tools/miri/src/math.rs:264; lane miri-eval)");
}
// math.rs:358 (pub(crate))
export function fixed_powi_value<S>(ecx: MiriInterpCx, base: Pending<"IeeeFloat<S>">, exp: number): Pending<"IeeeFloat<S>"> | undefined {
  return unported("miri::math::fixed_powi_value (src/tools/miri/src/math.rs:358; lane miri-eval)");
}
// math.rs:380 (pub(crate))
export function sqrt<F>(x: F): F {
  return unported("miri::math::sqrt (src/tools/miri/src/math.rs:380; lane miri-eval)");
}
// math.rs:462 (pub)
export function sqrt_op<F>(this_: MiriInterpCx, f: OpTy, dest: PlaceTy): InterpResult {
  return unported("miri::math::sqrt_op (src/tools/miri/src/math.rs:462; lane miri-eval)");
}
// math.rs:535 (pub)
export function host_unary_float_op<S>(this_: MiriInterpCx, f: OpTy, op: HostUnaryFloatOp, dest: PlaceTy): InterpResult {
  return unported("miri::math::host_unary_float_op (src/tools/miri/src/math.rs:535; lane miri-eval)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// trait ToHost (math.rs:11): to_host (:13)
// trait ToSoft (math.rs:17): to_soft (:19)
// impl ToHost for rustc_apfloat::ieee::Double (math.rs:22): to_host (:25)
// impl ToSoft for f64 (math.rs:30): to_soft (:33)
// impl ToHost for rustc_apfloat::ieee::Single (math.rs:38): to_host (:41)
// impl ToSoft for f32 (math.rs:46): to_soft (:49)
// impl ToHost for rustc_apfloat::ieee::Half (math.rs:54): to_host (:57)
// impl ToSoft for f16 (math.rs:62): to_soft (:65)
// trait HostFloatOperation (math.rs:474): host_sin (:475), host_cos (:476), host_exp (:477), host_exp2 (:478), host_log (:479), host_log10 (:480), host_log2 (:481), host_powf (:482), host_powi (:483)
// macro_rules! impl_float_host_operations (math.rs:486): fns in its body: host_sin (:489), host_cos (:492), host_exp (:495), host_exp2 (:498), host_log (:501), host_log10 (:504), host_log2 (:507), host_powf (:510), host_powi (:513)
// trait IeeeExt (math.rs:586): one (:590), two (:595), three (:600), pi (:604), clamp (:607)
// macro_rules! impl_ieee_pi (math.rs:612): fns in its body: pi (:616)
// #[cfg(test)] mod tests (math.rs:629): unit tests (port into a `.test.ts` next to this file)
// fn strip_float_suffix (math.rs:174)
