// Port of compiler/rustc_middle/src/mir/interpret/value.rs (lane mir-contract, plan-m4 D3 / D8 / D9). `Scalar<Prov>` is
// generated (value.gen.ts, set rustc_middle_mir); its methods are companion fns (`Scalar.from_u64(..)`,
// `Scalar.to_bits(s, size)`), stubs for lane mir-interp-b (docs/handoff/mir-contract.md "How to fill a stub").
// PORT: `u64` / `i64` / `u128` / `i128` values are `bigint`s (they exceed 2^53); `impl Into<u128>` is a bigint. `Prov` stays a
// type parameter (`Scalar<Prov = CtfeProvenance>`); the generated `debug_Scalar(v, f, debug_Prov)` call shape is kept
// (pointer.ts `provenance_of` gives the `Provenance` impl). The rustc_apfloat types (`Half`, `Single`, `Double`, `Quad`,
// `Float`; plan-m4 D9, lanes vendor-apfloat-a/-b) are placeholders here until the vendored crate lands.
import "../mod.ts";
import type { HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import type { Pending } from "../../../rustc_type_ir/decls.ts";
import type { Debug, Fmt } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { ScalarInt } from "../../ty/consts/int.ts";
import type { Either } from "../mod.ts";
import type { InterpResult } from "./error.ts";
import type { AllocId } from "./mod.ts";
import type { CtfeProvenance, Pointer } from "./pointer.ts";
import * as gen from "./value.gen.ts";
export * from "./value.gen.ts";

/** PORT: rustc_apfloat::ieee::Half (vendor-apfloat lanes, plan-m4 D9): a placeholder until the crate is vendored. */
export type Half = Pending<"rustc_apfloat::ieee::Half">;
/** PORT: rustc_apfloat::ieee::Single (placeholder, see `Half`). */
export type Single = Pending<"rustc_apfloat::ieee::Single">;
/** PORT: rustc_apfloat::ieee::Double (placeholder, see `Half`). */
export type Double = Pending<"rustc_apfloat::ieee::Double">;
/** PORT: rustc_apfloat::ieee::Quad (placeholder, see `Half`). */
export type Quad = Pending<"rustc_apfloat::ieee::Quad">;

export interface Scalar_methods {
    // interpret/value.rs:106 (lane mir-interp-b)
    from_pointer<Prov>(ptr: Pointer<Prov>, cx: HasDataLayout): Scalar<Prov>;
    // interpret/value.rs:113 (lane mir-interp-b)
    from_maybe_pointer<Prov>(ptr: Pointer<Prov | undefined>, cx: HasDataLayout): Scalar<Prov>;
    // interpret/value.rs:123 (lane mir-interp-b)
    null_ptr<Prov>(cx: HasDataLayout): Scalar<Prov>;
    // interpret/value.rs:128 (lane mir-interp-b)
    from_bool<Prov>(b: boolean): Scalar<Prov>;
    // interpret/value.rs:133 (lane mir-interp-b)
    from_char<Prov>(c: number): Scalar<Prov>;
    // interpret/value.rs:138 (lane mir-interp-b)
    from_uint<Prov>(i: bigint, size: Size): Scalar<Prov>;
    // interpret/value.rs:146 (lane mir-interp-b)
    from_u8<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:151 (lane mir-interp-b)
    from_u16<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:156 (lane mir-interp-b)
    from_u32<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:161 (lane mir-interp-b)
    from_u64<Prov>(i: bigint): Scalar<Prov>;
    // interpret/value.rs:166 (lane mir-interp-b)
    from_u128<Prov>(i: bigint): Scalar<Prov>;
    // interpret/value.rs:171 (lane mir-interp-b)
    from_target_usize<Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov>;
    // interpret/value.rs:176 (lane mir-interp-b)
    from_int<Prov>(i: bigint, size: Size): Scalar<Prov>;
    // interpret/value.rs:184 (lane mir-interp-b)
    from_i8<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:189 (lane mir-interp-b)
    from_i16<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:194 (lane mir-interp-b)
    from_i32<Prov>(i: number): Scalar<Prov>;
    // interpret/value.rs:199 (lane mir-interp-b)
    from_i64<Prov>(i: bigint): Scalar<Prov>;
    // interpret/value.rs:204 (lane mir-interp-b)
    from_i128<Prov>(i: bigint): Scalar<Prov>;
    // interpret/value.rs:209 (lane mir-interp-b)
    from_target_isize<Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov>;
    // interpret/value.rs:214 (lane mir-interp-b)
    from_f16<Prov>(f: Half): Scalar<Prov>;
    // interpret/value.rs:219 (lane mir-interp-b)
    from_f32<Prov>(f: Single): Scalar<Prov>;
    // interpret/value.rs:224 (lane mir-interp-b)
    from_f64<Prov>(f: Double): Scalar<Prov>;
    // interpret/value.rs:229 (lane mir-interp-b)
    from_f128<Prov>(f: Quad): Scalar<Prov>;
    // interpret/value.rs:242 (lane mir-interp-b)
    to_bits_or_ptr_internal<Prov>(self: Scalar<Prov>, expected_size: Size): Either<bigint, Pointer<Prov>>;
    // interpret/value.rs:262 (lane mir-interp-b)
    size<Prov>(self: Scalar<Prov>): Size;
    // interpret/value.rs:271 (lane mir-interp-b)
    to_pointer<Prov>(self: Scalar<Prov>, cx: HasDataLayout): Pointer<Prov | undefined>;
    // interpret/value.rs:291 (lane mir-interp-b)
    try_to_scalar_int<Prov>(self: Scalar<Prov>): Result<ScalarInt, Scalar<AllocId>>;
    // interpret/value.rs:308 (lane mir-interp-b)
    clear_provenance<Prov>(self: Scalar<Prov>): InterpResult<undefined>;
    // interpret/value.rs:316 (lane mir-interp-b)
    to_scalar_int<Prov>(self: Scalar<Prov>): InterpResult<ScalarInt>;
    // interpret/value.rs:322 (lane mir-interp-b)
    assert_scalar_int<Prov>(self: Scalar<Prov>): ScalarInt;
    // interpret/value.rs:329 (lane mir-interp-b)
    to_bits<Prov>(self: Scalar<Prov>, target_size: Size): InterpResult<bigint>;
    // interpret/value.rs:334 (lane mir-interp-b)
    to_bool<Prov>(self: Scalar<Prov>): InterpResult<boolean>;
    // interpret/value.rs:343 (lane mir-interp-b)
    to_char<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:354 (lane mir-interp-b)
    to_uint<Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint>;
    // interpret/value.rs:359 (lane mir-interp-b)
    to_u8<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:364 (lane mir-interp-b)
    to_u16<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:369 (lane mir-interp-b)
    to_u32<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:374 (lane mir-interp-b)
    to_u64<Prov>(self: Scalar<Prov>): InterpResult<bigint>;
    // interpret/value.rs:379 (lane mir-interp-b)
    to_u128<Prov>(self: Scalar<Prov>): InterpResult<bigint>;
    // interpret/value.rs:385 (lane mir-interp-b)
    to_target_usize<Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint>;
    // interpret/value.rs:393 (lane mir-interp-b)
    to_int<Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint>;
    // interpret/value.rs:399 (lane mir-interp-b)
    to_i8<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:404 (lane mir-interp-b)
    to_i16<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:409 (lane mir-interp-b)
    to_i32<Prov>(self: Scalar<Prov>): InterpResult<number>;
    // interpret/value.rs:414 (lane mir-interp-b)
    to_i64<Prov>(self: Scalar<Prov>): InterpResult<bigint>;
    // interpret/value.rs:419 (lane mir-interp-b)
    to_i128<Prov>(self: Scalar<Prov>): InterpResult<bigint>;
    // interpret/value.rs:425 (lane mir-interp-b)
    to_target_isize<Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint>;
    // interpret/value.rs:431 (lane mir-interp-b)
    to_float<Prov, F>(self: Scalar<Prov>): InterpResult<F>;
    // interpret/value.rs:437 (lane mir-interp-b)
    to_f16<Prov>(self: Scalar<Prov>): InterpResult<Half>;
    // interpret/value.rs:442 (lane mir-interp-b)
    to_f32<Prov>(self: Scalar<Prov>): InterpResult<Single>;
    // interpret/value.rs:447 (lane mir-interp-b)
    to_f64<Prov>(self: Scalar<Prov>): InterpResult<Double>;
    // interpret/value.rs:452 (lane mir-interp-b)
    to_f128<Prov>(self: Scalar<Prov>): InterpResult<Quad>;
}
export type Scalar<Prov = CtfeProvenance> = gen.Scalar<Prov>;
export const Scalar = {} as Scalar_methods;

// stub: compiler/rustc_middle/src/mir/interpret/value.rs:43 fmt (lane mir-interp-b)
export function debug_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt, debug_Prov: Debug<Prov>): string {
  return unported("rustc_middle::mir::interpret::value::<Scalar as Debug>::fmt");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:52 fmt (lane mir-interp-b)
export function display_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt): string {
  return unported("rustc_middle::mir::interpret::value::<Scalar as Display>::fmt");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:61 fmt (lane mir-interp-b)
export function lower_hex_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt): string {
  return unported("rustc_middle::mir::interpret::value::<Scalar as LowerHex>::fmt");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:71 from (lane mir-interp-b)
export function Scalar_from_Half<Prov>(f: Half): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::<Scalar as From<Half>>::from");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:78 from (lane mir-interp-b)
export function Scalar_from_Single<Prov>(f: Single): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::<Scalar as From<Single>>::from");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:85 from (lane mir-interp-b)
export function Scalar_from_Double<Prov>(f: Double): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::<Scalar as From<Double>>::from");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:92 from (lane mir-interp-b)
export function Scalar_from_Quad<Prov>(f: Quad): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::<Scalar as From<Quad>>::from");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:99 from (lane mir-interp-b)
export function Scalar_from_ScalarInt<Prov>(ptr: ScalarInt): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::<Scalar as From<ScalarInt>>::from");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:106 from_pointer (lane mir-interp-b)
Scalar.from_pointer = function <Prov>(ptr: Pointer<Prov>, cx: HasDataLayout): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_pointer");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:113 from_maybe_pointer (lane mir-interp-b)
Scalar.from_maybe_pointer = function <Prov>(ptr: Pointer<Prov | undefined>, cx: HasDataLayout): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_maybe_pointer");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:123 null_ptr (lane mir-interp-b)
Scalar.null_ptr = function <Prov>(cx: HasDataLayout): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::null_ptr");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:128 from_bool (lane mir-interp-b)
Scalar.from_bool = function <Prov>(b: boolean): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_bool");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:133 from_char (lane mir-interp-b)
Scalar.from_char = function <Prov>(c: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_char");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:138 from_uint (lane mir-interp-b)
Scalar.from_uint = function <Prov>(i: bigint, size: Size): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_uint");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:146 from_u8 (lane mir-interp-b)
Scalar.from_u8 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_u8");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:151 from_u16 (lane mir-interp-b)
Scalar.from_u16 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_u16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:156 from_u32 (lane mir-interp-b)
Scalar.from_u32 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_u32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:161 from_u64 (lane mir-interp-b)
Scalar.from_u64 = function <Prov>(i: bigint): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_u64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:166 from_u128 (lane mir-interp-b)
Scalar.from_u128 = function <Prov>(i: bigint): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_u128");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:171 from_target_usize (lane mir-interp-b)
Scalar.from_target_usize = function <Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_target_usize");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:176 from_int (lane mir-interp-b)
Scalar.from_int = function <Prov>(i: bigint, size: Size): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_int");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:184 from_i8 (lane mir-interp-b)
Scalar.from_i8 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_i8");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:189 from_i16 (lane mir-interp-b)
Scalar.from_i16 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_i16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:194 from_i32 (lane mir-interp-b)
Scalar.from_i32 = function <Prov>(i: number): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_i32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:199 from_i64 (lane mir-interp-b)
Scalar.from_i64 = function <Prov>(i: bigint): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_i64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:204 from_i128 (lane mir-interp-b)
Scalar.from_i128 = function <Prov>(i: bigint): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_i128");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:209 from_target_isize (lane mir-interp-b)
Scalar.from_target_isize = function <Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_target_isize");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:214 from_f16 (lane mir-interp-b)
Scalar.from_f16 = function <Prov>(f: Half): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_f16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:219 from_f32 (lane mir-interp-b)
Scalar.from_f32 = function <Prov>(f: Single): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_f32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:224 from_f64 (lane mir-interp-b)
Scalar.from_f64 = function <Prov>(f: Double): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_f64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:229 from_f128 (lane mir-interp-b)
Scalar.from_f128 = function <Prov>(f: Quad): Scalar<Prov> {
  return unported("rustc_middle::mir::interpret::value::Scalar::from_f128");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:242 to_bits_or_ptr_internal (lane mir-interp-b)
Scalar.to_bits_or_ptr_internal = function <Prov>(self: Scalar<Prov>, expected_size: Size): Either<bigint, Pointer<Prov>> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_bits_or_ptr_internal");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:249 invalid (lane mir-interp-b)
// PORT: nested fn of impl<Prov> Scalar<Prov> > fn to_bits_or_ptr_internal; a module-level stub until its lane ports it inside the parent.
function invalid(expected_size: number, self_size: number): never {
  return unported("rustc_middle::mir::interpret::value::invalid");
}


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:262 size (lane mir-interp-b)
Scalar.size = function <Prov>(self: Scalar<Prov>): Size {
  return unported("rustc_middle::mir::interpret::value::Scalar::size");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:271 to_pointer (lane mir-interp-b)
Scalar.to_pointer = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): Pointer<Prov | undefined> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_pointer");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:291 try_to_scalar_int (lane mir-interp-b)
Scalar.try_to_scalar_int = function <Prov>(self: Scalar<Prov>): Result<ScalarInt, Scalar<AllocId>> {
  return unported("rustc_middle::mir::interpret::value::Scalar::try_to_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:308 clear_provenance (lane mir-interp-b)
Scalar.clear_provenance = function <Prov>(self: Scalar<Prov>): InterpResult<undefined> {
  return unported("rustc_middle::mir::interpret::value::Scalar::clear_provenance");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:316 to_scalar_int (lane mir-interp-b)
Scalar.to_scalar_int = function <Prov>(self: Scalar<Prov>): InterpResult<ScalarInt> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:322 assert_scalar_int (lane mir-interp-b)
Scalar.assert_scalar_int = function <Prov>(self: Scalar<Prov>): ScalarInt {
  return unported("rustc_middle::mir::interpret::value::Scalar::assert_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:329 to_bits (lane mir-interp-b)
Scalar.to_bits = function <Prov>(self: Scalar<Prov>, target_size: Size): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_bits");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:334 to_bool (lane mir-interp-b)
Scalar.to_bool = function <Prov>(self: Scalar<Prov>): InterpResult<boolean> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_bool");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:343 to_char (lane mir-interp-b)
Scalar.to_char = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_char");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:354 to_uint (lane mir-interp-b)
Scalar.to_uint = function <Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_uint");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:359 to_u8 (lane mir-interp-b)
Scalar.to_u8 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_u8");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:364 to_u16 (lane mir-interp-b)
Scalar.to_u16 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_u16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:369 to_u32 (lane mir-interp-b)
Scalar.to_u32 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_u32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:374 to_u64 (lane mir-interp-b)
Scalar.to_u64 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_u64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:379 to_u128 (lane mir-interp-b)
Scalar.to_u128 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_u128");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:385 to_target_usize (lane mir-interp-b)
Scalar.to_target_usize = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_target_usize");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:393 to_int (lane mir-interp-b)
Scalar.to_int = function <Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_int");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:399 to_i8 (lane mir-interp-b)
Scalar.to_i8 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_i8");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:404 to_i16 (lane mir-interp-b)
Scalar.to_i16 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_i16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:409 to_i32 (lane mir-interp-b)
Scalar.to_i32 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_i32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:414 to_i64 (lane mir-interp-b)
Scalar.to_i64 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_i64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:419 to_i128 (lane mir-interp-b)
Scalar.to_i128 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_i128");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:425 to_target_isize (lane mir-interp-b)
Scalar.to_target_isize = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_target_isize");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:431 to_float (lane mir-interp-b)
Scalar.to_float = function <Prov, F>(self: Scalar<Prov>): InterpResult<F> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_float");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:437 to_f16 (lane mir-interp-b)
Scalar.to_f16 = function <Prov>(self: Scalar<Prov>): InterpResult<Half> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_f16");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:442 to_f32 (lane mir-interp-b)
Scalar.to_f32 = function <Prov>(self: Scalar<Prov>): InterpResult<Single> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_f32");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:447 to_f64 (lane mir-interp-b)
Scalar.to_f64 = function <Prov>(self: Scalar<Prov>): InterpResult<Double> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_f64");
};


// stub: compiler/rustc_middle/src/mir/interpret/value.rs:452 to_f128 (lane mir-interp-b)
Scalar.to_f128 = function <Prov>(self: Scalar<Prov>): InterpResult<Quad> {
  return unported("rustc_middle::mir::interpret::value::Scalar::to_f128");
};
