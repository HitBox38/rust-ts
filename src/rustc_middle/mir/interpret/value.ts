// Port of compiler/rustc_middle/src/mir/interpret/value.rs (lanes mir-contract, mir-interp-b; plan-m4 D3 / D8 / D9).
// `Scalar<Prov>` is generated (value.gen.ts, set rustc_middle_mir); its methods are companion fns (`Scalar.from_u64(..)`,
// `Scalar.to_bits(s, size)`).
// PORT: `write!(f, "{x:?}")` formats `x` with fresh flags (`{:?}` never inherits `f`'s `alternate`): `PLAIN`.
// PORT: `u64` / `i64` / `u128` / `i128` values are `bigint`s (they exceed 2^53); `impl Into<u128>` is a bigint. `Prov` stays a
// type parameter (`Scalar<Prov = CtfeProvenance>`); the generated `debug_Scalar(v, f, debug_Prov)` call shape is kept
// (pointer.ts `provenance_of` gives the `Provenance` impl). The rustc_apfloat types (`Half`, `Single`, `Double`, `Quad`,
// `Float`; plan-m4 D9) are the vendored crate's (src/vendor/rustc_apfloat); `F: Float` is passed as its `FloatType`
// dictionary (as ty/consts/int.ts's `ScalarInt::to_float`).
import "../mod.ts";
import { type HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Double, Half, Quad, Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import type { Float, FloatType } from "../../../vendor/rustc_apfloat/lib.ts";
import { type Debug, type Fmt, PLAIN, PRETTY } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unwrap } from "../../../std/panic.ts";
import { Err, expect_result, Ok, type Result } from "../../../std/result.ts";
import { debug_ScalarInt, display_ScalarInt, lower_hex_ScalarInt, ScalarInt } from "../../ty/consts/int.ts";
import type { Either } from "../mod.ts";
import { InterpErrorInfo_from_InterpErrorKind, interp_ok, InterpResult } from "./error.ts";
import { type AllocId, debug_AllocId } from "./mod.ts";
import {
  type CtfeProvenance,
  debug_Pointer,
  Pointer,
  Pointer_Option_from_Pointer,
  PointerArithmetic_provided,
  provenance_of,
  try_from_unwrap,
} from "./pointer.ts";
import * as gen from "./value.gen.ts";
export * from "./value.gen.ts";

/** rustc_apfloat::ieee::{Half, Single, Double, Quad} (the vendored crate, plan-m4 D9). */
export type { Half, Single, Double, Quad };

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
    clear_provenance<Prov>(self: MutRef<Scalar<Prov>>): InterpResult<undefined>;
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
    to_float<Prov, F extends Float<F>>(self: Scalar<Prov>, F: FloatType<F>): InterpResult<F>;
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

const U8_MAX = 0xffn;
const U16_MAX = 0xffffn;
const U32_MAX = 0xffff_ffffn;
const U64_MAX = (1n << 64n) - 1n;

// We want the `Debug` output to be readable as it is used by `derive(Debug)` for
// all the Miri types.
// impl<Prov: Provenance> fmt::Debug for Scalar<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:43 fmt
export function debug_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt, debug_Prov: Debug<Prov>): string {
  void fmt;
  switch (self.$) {
    case "Ptr":
      return debug_Pointer(self._0, PLAIN, debug_Prov);
    case "Int":
      return debug_ScalarInt(self._0, PLAIN);
  }
}

// impl<Prov: Provenance> fmt::Display for Scalar<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:52 fmt
export function display_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt): string {
  void fmt;
  switch (self.$) {
    case "Ptr":
      return `pointer to ${debug_Pointer(self._0, PLAIN, unused_debug as Debug<Prov>)}`;
    case "Int":
      return display_ScalarInt(self._0);
  }
}

// impl<Prov: Provenance> fmt::LowerHex for Scalar<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:61 fmt
export function lower_hex_Scalar<Prov>(self: Scalar<Prov>, fmt: Fmt): string {
  void fmt;
  switch (self.$) {
    case "Ptr":
      return `pointer to ${debug_Pointer(self._0, PLAIN, unused_debug as Debug<Prov>)}`;
    case "Int":
      return lower_hex_ScalarInt(self._0, PRETTY);
  }
}
/** The `debug_Prov` argument nothing reads (`Provenance::fmt` prints the provenance). */
const unused_debug: Debug<never> = () => panic("unused");

// impl<Prov> From<Half> for Scalar<Prov>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:71 from
export function Scalar_from_Half<Prov>(f: Half): Scalar<Prov> {
  return Scalar.from_f16(f);
}

// impl<Prov> From<Single> for Scalar<Prov>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:78 from
export function Scalar_from_Single<Prov>(f: Single): Scalar<Prov> {
  return Scalar.from_f32(f);
}

// impl<Prov> From<Double> for Scalar<Prov>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:85 from
export function Scalar_from_Double<Prov>(f: Double): Scalar<Prov> {
  return Scalar.from_f64(f);
}

// impl<Prov> From<Quad> for Scalar<Prov>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:92 from
export function Scalar_from_Quad<Prov>(f: Quad): Scalar<Prov> {
  return Scalar.from_f128(f);
}

// impl<Prov> From<ScalarInt> for Scalar<Prov>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:99 from
export function Scalar_from_ScalarInt<Prov>(ptr: ScalarInt): Scalar<Prov> {
  return { $: "Int", _0: ptr };
}

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:106 from_pointer
Scalar.from_pointer = function <Prov>(ptr: Pointer<Prov>, cx: HasDataLayout): Scalar<Prov> {
  // `u8::try_from(cx.pointer_size().bytes()).ok().and_then(NonZero::new).unwrap()`
  const bytes = PointerArithmetic_provided.pointer_size(cx).bytes();
  const ptr_size = unwrap(bytes <= 0xff && bytes !== 0 ? bytes : undefined);
  return { $: "Ptr", _0: ptr, _1: ptr_size };
};

/// Create a Scalar from a pointer with an `Option<_>` provenance (where `None` represents a
/// plain integer / "invalid" pointer).
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:113 from_maybe_pointer
Scalar.from_maybe_pointer = function <Prov>(ptr: Pointer<Prov | undefined>, cx: HasDataLayout): Scalar<Prov> {
  const [prov, offset] = ptr.into_raw_parts();
  if (prov !== undefined) {
    return Scalar.from_pointer(Pointer.new(prov, offset), cx);
  } else {
    return {
      $: "Int",
      _0: unwrap(ScalarInt.try_from_uint(offset.bytes_u64(), PointerArithmetic_provided.pointer_size(cx))),
    };
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:123 null_ptr
Scalar.null_ptr = function <Prov>(cx: HasDataLayout): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.null(PointerArithmetic_provided.pointer_size(cx)) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:128 from_bool
Scalar.from_bool = function <Prov>(b: boolean): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_bool(b) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:133 from_char
Scalar.from_char = function <Prov>(c: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_char(c) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:138 from_uint
Scalar.from_uint = function <Prov>(i: bigint, size: Size): Scalar<Prov> {
  const int = ScalarInt.try_from_uint(i, size);
  if (int === undefined) {
    return bug(`Unsigned value 0x${BigInt.asUintN(128, i).toString(16)} does not fit in ${size.bits()} bits`);
  }
  return Scalar_from_ScalarInt(int);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:146 from_u8
Scalar.from_u8 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_u8(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:151 from_u16
Scalar.from_u16 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_u16(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:156 from_u32
Scalar.from_u32 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_u32(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:161 from_u64
Scalar.from_u64 = function <Prov>(i: bigint): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_u64(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:166 from_u128
Scalar.from_u128 = function <Prov>(i: bigint): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_u128(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:171 from_target_usize
Scalar.from_target_usize = function <Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov> {
  return Scalar.from_uint(i, cx.data_layout().pointer_offset());
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:176 from_int
Scalar.from_int = function <Prov>(i: bigint, size: Size): Scalar<Prov> {
  const int = ScalarInt.try_from_int(i, size);
  if (int === undefined) {
    // `{:#x}` of an `i128` prints its two's complement bits.
    return bug(`Signed value 0x${BigInt.asUintN(128, i).toString(16)} does not fit in ${size.bits()} bits`);
  }
  return Scalar_from_ScalarInt(int);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:184 from_i8
Scalar.from_i8 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_i8(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:189 from_i16
Scalar.from_i16 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_i16(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:194 from_i32
Scalar.from_i32 = function <Prov>(i: number): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_i32(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:199 from_i64
Scalar.from_i64 = function <Prov>(i: bigint): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_i64(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:204 from_i128
Scalar.from_i128 = function <Prov>(i: bigint): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_i128(i) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:209 from_target_isize
Scalar.from_target_isize = function <Prov>(i: bigint, cx: HasDataLayout): Scalar<Prov> {
  return Scalar.from_int(i, cx.data_layout().pointer_offset());
};

// `f.into()` is `ScalarInt`'s `From<Half / Single / Double / Quad>` (ty/consts/int.ts).

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:214 from_f16
Scalar.from_f16 = function <Prov>(f: Half): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_Half(f) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:219 from_f32
Scalar.from_f32 = function <Prov>(f: Single): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_Single(f) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:224 from_f64
Scalar.from_f64 = function <Prov>(f: Double): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_Double(f) };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:229 from_f128
Scalar.from_f128 = function <Prov>(f: Quad): Scalar<Prov> {
  return { $: "Int", _0: ScalarInt.from_Quad(f) };
};

/// This is almost certainly not the method you want!  You should dispatch on the type
/// and use `to_{u8,u16,...}`/`to_pointer` to perform ptr-to-int / int-to-ptr casts as needed.
///
/// This method only exists for the benefit of low-level operations that truly need to treat the
/// scalar in whatever form it is.
///
/// This throws UB (instead of ICEing) on a size mismatch since size mismatches can arise in
/// Miri when someone declares a function that we shim (such as `malloc`) with a wrong type.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:242 to_bits_or_ptr_internal
Scalar.to_bits_or_ptr_internal = function <Prov>(self: Scalar<Prov>, expected_size: Size): Either<bigint, Pointer<Prov>> {
  switch (self.$) {
    case "Int":
      return { $: "Left", _0: self._0.to_bits(expected_size) };
    case "Ptr": {
      const self_size = self._1;
      if (expected_size.bytes() !== self_size) {
        // #[cold]
        // rustc: compiler/rustc_middle/src/mir/interpret/value.rs:249 invalid
        const invalid = (expected_size: number, self_size: number): never => {
          return panic(`Scalar pointer has size ${self_size} but expected ${expected_size}`);
        };

        invalid(expected_size.bytes(), self_size);
      }

      return { $: "Right", _0: self._0 };
    }
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:262 size
Scalar.size = function <Prov>(self: Scalar<Prov>): Size {
  switch (self.$) {
    case "Int":
      return self._0.size();
    case "Ptr":
      return Size.from_bytes(self._1);
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:271 to_pointer
Scalar.to_pointer = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): Pointer<Prov | undefined> {
  const r = Scalar.to_bits_or_ptr_internal(self, PointerArithmetic_provided.pointer_size(cx));
  switch (r.$) {
    case "Right":
      return Pointer_Option_from_Pointer(r._0);
    case "Left": {
      const bits = r._0;
      const addr = try_from_unwrap(bits, 0n, U64_MAX);
      return Pointer.without_provenance<Prov>(addr);
    }
  }
};

/// Fundamental scalar-to-int (cast) operation. Many convenience wrappers exist below, that you
/// likely want to use instead.
///
/// Will perform ptr-to-int casts if needed and possible.
/// If that fails, we know the offset is relative, so we return an "erased" Scalar
/// (which is useful for error messages but not much else).
///
/// The error type is `AllocId`, not `CtfeProvenance`, since `AllocId` is the "minimal"
/// component all provenance types must have.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:291 try_to_scalar_int
Scalar.try_to_scalar_int = function <Prov>(self: Scalar<Prov>): Result<ScalarInt, Scalar<AllocId>> {
  switch (self.$) {
    case "Int":
      return Ok(self._0);
    case "Ptr": {
      const ptr = self._0;
      const sz = self._1;
      const prov_impl = provenance_of(ptr.provenance);
      if (prov_impl.OFFSET_IS_ADDR) {
        return Ok(unwrap(ScalarInt.try_from_uint(ptr.offset.bytes_u64(), Size.from_bytes(sz))));
      } else {
        // We know `offset` is relative, since `OFFSET_IS_ADDR == false`.
        const [prov, offset] = ptr.into_raw_parts();
        // Because `OFFSET_IS_ADDR == false`, this unwrap can never fail.
        return Err({ $: "Ptr", _0: Pointer.new(unwrap(prov_impl.get_alloc_id(prov)), offset), _1: sz });
      }
    }
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:308 clear_provenance
Scalar.clear_provenance = function <Prov>(self: MutRef<Scalar<Prov>>): InterpResult<undefined> {
  if (self.value.$ === "Ptr") {
    const r = Scalar.to_scalar_int(self.value);
    if (r.$ === "Err") return r;
    self.value = Scalar_from_ScalarInt(r._0);
  }
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:316 to_scalar_int
Scalar.to_scalar_int = function <Prov>(self: Scalar<Prov>): InterpResult<ScalarInt> {
  const r = Scalar.try_to_scalar_int(self);
  return InterpResult.from_result(
    r.$ === "Ok" ? r : Err({ $: "Unsupported", _0: { $: "ReadPointerAsInt", _0: undefined } } as const),
    InterpErrorInfo_from_InterpErrorKind,
  );
};

// #[inline(always)]
// #[cfg_attr(debug_assertions, track_caller)] // only in debug builds due to perf (see #98980)
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:322 assert_scalar_int
Scalar.assert_scalar_int = function <Prov>(self: Scalar<Prov>): ScalarInt {
  return expect_result(Scalar.try_to_scalar_int(self), "got a pointer where a ScalarInt was expected", (v, f) =>
    debug_Scalar(v, f, debug_AllocId),
  );
};

/// This throws UB (instead of ICEing) on a size mismatch since size mismatches can arise in
/// Miri when someone declares a function that we shim (such as `malloc`) with a wrong type.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:329 to_bits
Scalar.to_bits = function <Prov>(self: Scalar<Prov>, target_size: Size): InterpResult<bigint> {
  // assert_ne!(target_size.bytes(), 0, "you should never look at the bits of a ZST");
  if (target_size.bytes() === 0) {
    return panic("assertion `left != right` failed: you should never look at the bits of a ZST\n  left: 0\n right: 0");
  }
  const r = Scalar.to_scalar_int(self);
  if (r.$ === "Err") return r;
  return interp_ok(r._0.to_bits(target_size));
};

// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:334 to_bool
Scalar.to_bool = function <Prov>(self: Scalar<Prov>): InterpResult<boolean> {
  const r = Scalar.to_u8(self);
  if (r.$ === "Err") return r;
  const val = r._0;
  switch (val) {
    case 0:
      return interp_ok(false);
    case 1:
      return interp_ok(true);
    default:
      // throw_ub!(InvalidBool(val))
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidBool", _0: val } }));
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:343 to_char
Scalar.to_char = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  const r = Scalar.to_u32(self);
  if (r.$ === "Err") return r;
  const val = r._0;
  // `std::char::from_u32(val)`
  if (val <= 0x10ffff && !(val >= 0xd800 && val <= 0xdfff)) {
    const c = val;
    return interp_ok(c);
  } else {
    // throw_ub!(InvalidChar(val))
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidChar", _0: val } }));
  }
};

/// Converts the scalar to produce an unsigned integer of the given size.
/// Fails if the scalar is a pointer.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:354 to_uint
Scalar.to_uint = function <Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint> {
  return Scalar.to_bits(self, size);
};

/// Converts the scalar to produce a `u8`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:359 to_u8
Scalar.to_u8 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_uint(self, Size.from_bits(8)), (v) => Number(try_from_unwrap(v, 0n, U8_MAX)));
};

/// Converts the scalar to produce a `u16`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:364 to_u16
Scalar.to_u16 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_uint(self, Size.from_bits(16)), (v) => Number(try_from_unwrap(v, 0n, U16_MAX)));
};

/// Converts the scalar to produce a `u32`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:369 to_u32
Scalar.to_u32 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_uint(self, Size.from_bits(32)), (v) => Number(try_from_unwrap(v, 0n, U32_MAX)));
};

/// Converts the scalar to produce a `u64`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:374 to_u64
Scalar.to_u64 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return InterpResult.map(Scalar.to_uint(self, Size.from_bits(64)), (v) => try_from_unwrap(v, 0n, U64_MAX));
};

/// Converts the scalar to produce a `u128`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:379 to_u128
Scalar.to_u128 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return Scalar.to_uint(self, Size.from_bits(128));
};

/// Converts the scalar to produce a machine-pointer-sized unsigned integer.
/// Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:385 to_target_usize
Scalar.to_target_usize = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint> {
  const r = Scalar.to_uint(self, cx.data_layout().pointer_size());
  if (r.$ === "Err") return r;
  const b = r._0;
  return interp_ok(try_from_unwrap(b, 0n, U64_MAX));
};

/// Converts the scalar to produce a signed integer of the given size.
/// Fails if the scalar is a pointer.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:393 to_int
Scalar.to_int = function <Prov>(self: Scalar<Prov>, size: Size): InterpResult<bigint> {
  const r = Scalar.to_bits(self, size);
  if (r.$ === "Err") return r;
  const b = r._0;
  return interp_ok(size.sign_extend(b));
};

/// Converts the scalar to produce an `i8`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:399 to_i8
Scalar.to_i8 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_int(self, Size.from_bits(8)), (v) => Number(try_from_unwrap(v, -0x80n, 0x7fn)));
};

/// Converts the scalar to produce an `i16`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:404 to_i16
Scalar.to_i16 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_int(self, Size.from_bits(16)), (v) => Number(try_from_unwrap(v, -0x8000n, 0x7fffn)));
};

/// Converts the scalar to produce an `i32`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:409 to_i32
Scalar.to_i32 = function <Prov>(self: Scalar<Prov>): InterpResult<number> {
  return InterpResult.map(Scalar.to_int(self, Size.from_bits(32)), (v) =>
    Number(try_from_unwrap(v, -0x8000_0000n, 0x7fff_ffffn)),
  );
};

/// Converts the scalar to produce an `i64`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:414 to_i64
Scalar.to_i64 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return InterpResult.map(Scalar.to_int(self, Size.from_bits(64)), (v) => try_from_unwrap(v, -(1n << 63n), (1n << 63n) - 1n));
};

/// Converts the scalar to produce an `i128`. Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:419 to_i128
Scalar.to_i128 = function <Prov>(self: Scalar<Prov>): InterpResult<bigint> {
  return Scalar.to_int(self, Size.from_bits(128));
};

/// Converts the scalar to produce a machine-pointer-sized signed integer.
/// Fails if the scalar is a pointer.
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:425 to_target_isize
Scalar.to_target_isize = function <Prov>(self: Scalar<Prov>, cx: HasDataLayout): InterpResult<bigint> {
  const r = Scalar.to_int(self, cx.data_layout().pointer_size());
  if (r.$ === "Err") return r;
  const b = r._0;
  return interp_ok(try_from_unwrap(b, -(1n << 63n), (1n << 63n) - 1n));
};

// PORT: `F: Float` is passed as its `FloatType` dictionary.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:431 to_float
Scalar.to_float = function <Prov, F extends Float<F>>(self: Scalar<Prov>, F: FloatType<F>): InterpResult<F> {
  // Going through `to_bits` to check size and truncation.
  const r = Scalar.to_bits(self, Size.from_bits(F.BITS));
  if (r.$ === "Err") return r;
  return interp_ok(F.from_bits(r._0));
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:437 to_f16
Scalar.to_f16 = function <Prov>(self: Scalar<Prov>): InterpResult<Half> {
  return Scalar.to_float(self, Half);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:442 to_f32
Scalar.to_f32 = function <Prov>(self: Scalar<Prov>): InterpResult<Single> {
  return Scalar.to_float(self, Single);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:447 to_f64
Scalar.to_f64 = function <Prov>(self: Scalar<Prov>): InterpResult<Double> {
  return Scalar.to_float(self, Double);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/value.rs:452 to_f128
Scalar.to_f128 = function <Prov>(self: Scalar<Prov>): InterpResult<Quad> {
  return Scalar.to_float(self, Quad);
};
