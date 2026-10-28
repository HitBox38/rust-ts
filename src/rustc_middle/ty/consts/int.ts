// Port of compiler/rustc_middle/src/ty/consts/int.rs (lane ty-results).
//
// PORT: `ScalarInt` is a small value class (`data: u128` as a `bigint`, `size: NonZero<u8>` as a `number`); its derived
// `PartialEq`/`Eq`/`Hash` is `ScalarInt_eq` / the structural intern key (rust_ts/intern_key.ts compares the two fields),
// so `ValTreeKind::Leaf(ScalarInt)` interns by value.
// PORT: `ScalarInt` is a defining module of the valtree / const graph (imported by consts/valtree.ts, which the defining
// module rustc_type_ir sty/consts.ts imports): it imports no extension module.
// PORT: the float conversions (`to_float`, `From<Half/Single/Double/Quad>`) use the vendored rustc_apfloat
// (src/vendor/rustc_apfloat); `to_float::<F>` takes the float type's dictionary `F` (`Half`, `Single`, ...).
import { Size } from "../../../rustc_abi/lib.ts";
import { type StableHashCtxt, type StableHasher, stable_hash_u128, stable_hash_u8 } from "../../../rustc_data_structures/stable_hash.ts";
import type { Decoder } from "../../../rustc_serialize/serialize.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { type Debug, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { TyCtxt } from "../context.ts";
import { Double, Half, Quad, Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import type { Float, FloatType } from "../../../vendor/rustc_apfloat/lib.ts";

const U128_MAX = (1n << 128n) - 1n;

/** `NonZero::new(x as u8).unwrap()` */
function nonzero_u8(x: number): number {
  const v = x & 0xff;
  return v === 0 ? panic("called `Option::unwrap()` on a `None` value") : v;
}

// ---- PORT stand-ins for rustc_abi fns that are not ported yet (rustc_abi/lib.ts is not this lane's) ------------------

/** PORT: stand-in for `Size::sign_extend` (rustc_abi/src/lib.rs:958), upstream's body over `u128`/`i128` bigints. */
export function Size_sign_extend(self: Size, value: bigint): bigint {
  const size = self.bits();
  if (size === 0) {
    // Truncated until nothing is left.
    return 0n;
  }
  // Sign-extend it.
  const shift = BigInt(128 - size);
  // Shift the unsigned value to the left, then shift back to the right as signed
  // (essentially fills with sign bit on the left).
  return BigInt.asIntN(128, BigInt.asUintN(128, value << shift)) >> shift;
}

/** PORT: stand-in for `Size::truncate` (rustc_abi/src/lib.rs:973), upstream's body over `u128` bigints. */
export function Size_truncate(self: Size, value: bigint): bigint {
  const size = self.bits();
  if (size === 0) {
    // Truncated until nothing is left.
    return 0n;
  }
  const shift = BigInt(128 - size);
  // Truncate (shift left to drop out leftover values, shift right to fill with zeroes).
  return BigInt.asUintN(128, value << shift) >> shift;
}

/** PORT: `TargetDataLayout::pointer_size` (rustc_abi/src/lib.rs:744) of `tcx.gcx.data_layout` (typed `TargetDataLayout`
 *  since lane typeck-gaps; this helper predates it). */
export function TargetDataLayout_pointer_size(dl: unknown): Size {
  return (dl as { pointer_size(): Size }).pointer_size();
}

/** `<uN as TryFrom<u128>>::try_from(..).unwrap()` / `<iN as TryFrom<i128>>`: the value is known to fit (the callers
 *  checked the size), so this only converts; values of more than 53 bits stay `bigint` at the callers. */
function to_number(v: bigint): number {
  return Number(v);
}

/// A type for representing any integer. Only used for printing.
// rustc-type: compiler/rustc_middle/src/ty/consts/int.rs:15 ConstInt
export class ConstInt {
  constructor(
    /// The "untyped" variant of `ConstInt`.
    readonly int: ScalarInt,
    /// Whether the value is of a signed integer type.
    readonly signed: boolean,
    /// Whether the value is a `usize` or `isize` type.
    readonly is_ptr_sized_integral: boolean,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:25 new
  static new(int: ScalarInt, signed: boolean, is_ptr_sized_integral: boolean): ConstInt {
    return new ConstInt(int, signed, is_ptr_sized_integral);
  }
}

/// An enum to represent the compiler-side view of `intrinsics::AtomicOrdering`.
/// This lives here because there's a method in this file that needs it and it is entirely unclear
/// where else to put this...
// rustc-type: compiler/rustc_middle/src/ty/consts/int.rs:34 AtomicOrdering
export type AtomicOrdering = "Relaxed" | "Release" | "Acquire" | "AcqRel" | "SeqCst";
export const AtomicOrdering = {
  // These values must match `intrinsics::AtomicOrdering`!
  Relaxed: "Relaxed",
  Release: "Release",
  Acquire: "Acquire",
  AcqRel: "AcqRel",
  SeqCst: "SeqCst",
} as const;
export const AtomicOrdering_discriminant: Record<AtomicOrdering, number> = { Relaxed: 0, Release: 1, Acquire: 2, AcqRel: 3, SeqCst: 4 };
export const debug_AtomicOrdering: Debug<AtomicOrdering> = (v) => v;

/// An enum to represent the compiler-side view of `intrinsics::simd::SimdAlign`.
// rustc-type: compiler/rustc_middle/src/ty/consts/int.rs:45 SimdAlign
export type SimdAlign = "Unaligned" | "Element" | "Vector";
export const SimdAlign = {
  // These values must match `intrinsics::simd::SimdAlign`!
  Unaligned: "Unaligned",
  Element: "Element",
  Vector: "Vector",
} as const;
export const SimdAlign_discriminant: Record<SimdAlign, number> = { Unaligned: 0, Element: 1, Vector: 2 };
export const debug_SimdAlign: Debug<SimdAlign> = (v) => v;

// PORT: `write!(fmt, ..)` returns the text (Debug convention); `fmt.alternate()` is `f.alternate`.
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:53 fmt
export const debug_ConstInt: Debug<ConstInt> = (self, fmt) => {
  const { int, signed, is_ptr_sized_integral } = self;
  const size = int.size().bytes();
  const raw = int.data;
  if (signed) {
    const bit_size = size * 8;
    const min = BigInt.asUintN(128, 1n << BigInt(bit_size - 1));
    const max = BigInt.asUintN(128, min - 1n);
    if (raw === min) {
      if (is_ptr_sized_integral) return "isize::MIN";
      switch (size) {
        case 1:
          return "i8::MIN";
        case 2:
          return "i16::MIN";
        case 4:
          return "i32::MIN";
        case 8:
          return "i64::MIN";
        case 16:
          return "i128::MIN";
        default:
          return bug(`ConstInt 0x${raw.toString(16)} with size = ${size} and signed = ${signed}`);
      }
    } else if (raw === max) {
      if (is_ptr_sized_integral) return "isize::MAX";
      switch (size) {
        case 1:
          return "i8::MAX";
        case 2:
          return "i16::MAX";
        case 4:
          return "i32::MAX";
        case 8:
          return "i64::MAX";
        case 16:
          return "i128::MAX";
        default:
          return bug(`ConstInt 0x${raw.toString(16)} with size = ${size} and signed = ${signed}`);
      }
    } else {
      let out: string;
      switch (size) {
        case 1:
          out = String(BigInt.asIntN(8, raw));
          break;
        case 2:
          out = String(BigInt.asIntN(16, raw));
          break;
        case 4:
          out = String(BigInt.asIntN(32, raw));
          break;
        case 8:
          out = String(BigInt.asIntN(64, raw));
          break;
        case 16:
          out = String(BigInt.asIntN(128, raw));
          break;
        default:
          return bug(`ConstInt 0x${raw.toString(16)} with size = ${size} and signed = ${signed}`);
      }
      if (fmt.alternate) {
        if (is_ptr_sized_integral) {
          out += "_isize";
        } else {
          switch (size) {
            case 1:
              out += "_i8";
              break;
            case 2:
              out += "_i16";
              break;
            case 4:
              out += "_i32";
              break;
            case 8:
              out += "_i64";
              break;
            case 16:
              out += "_i128";
              break;
            default:
              return bug(`unexpected int size i${size}`);
          }
        }
      }
      return out;
    }
  } else {
    const max = Size_truncate(Size.from_bytes(size), U128_MAX);
    if (raw === max) {
      if (is_ptr_sized_integral) return "usize::MAX";
      switch (size) {
        case 1:
          return "u8::MAX";
        case 2:
          return "u16::MAX";
        case 4:
          return "u32::MAX";
        case 8:
          return "u64::MAX";
        case 16:
          return "u128::MAX";
        default:
          return bug(`ConstInt 0x${raw.toString(16)} with size = ${size} and signed = ${signed}`);
      }
    } else {
      let out: string;
      switch (size) {
        case 1:
          out = String(BigInt.asUintN(8, raw));
          break;
        case 2:
          out = String(BigInt.asUintN(16, raw));
          break;
        case 4:
          out = String(BigInt.asUintN(32, raw));
          break;
        case 8:
          out = String(BigInt.asUintN(64, raw));
          break;
        case 16:
          out = String(raw);
          break;
        default:
          return bug(`ConstInt 0x${raw.toString(16)} with size = ${size} and signed = ${signed}`);
      }
      if (fmt.alternate) {
        if (is_ptr_sized_integral) {
          out += "_usize";
        } else {
          switch (size) {
            case 1:
              out += "_u8";
              break;
            case 2:
              out += "_u16";
              break;
            case 4:
              out += "_u32";
              break;
            case 8:
              out += "_u64";
              break;
            case 16:
              out += "_u128";
              break;
            default:
              return bug(`unexpected unsigned int size u${size}`);
          }
        }
      }
      return out;
    }
  }
};

/// The raw bytes of a simple value.
///
/// This is a packed struct in order to allow this type to be optimally embedded in enums
/// (like Scalar).
// rustc-type: compiler/rustc_middle/src/ty/consts/int.rs:147 ScalarInt
export class ScalarInt {
  constructor(
    /// The first `size` bytes of `data` are the value.
    /// Do not try to read less or more bytes than that. The remaining bytes must be 0.
    readonly data: bigint,
    /** `NonZero<u8>` */
    readonly size_: number,
  ) {
    Object.freeze(this);
  }

  // PORT: `TRUE` / `FALSE` are associated consts.
  static readonly TRUE: ScalarInt = new ScalarInt(1n, 1);
  static readonly FALSE: ScalarInt = new ScalarInt(0n, 1);

  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:192 raw
  static raw(data: bigint, size: Size): ScalarInt {
    const s = size.bytes();
    if (s === 0) panic("called `Option::unwrap()` on a `None` value");
    // PORT: `size.bytes() as u8` truncates; sizes here are at most 16.
    return new ScalarInt(data, s & 0xff);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:197 size
  size(): Size {
    return Size.from_bytes(this.size_);
  }

  /// Make sure the `data` fits in `size`.
  /// This is guaranteed by all constructors here, but having had this check saved us from
  /// bugs many times in the past, so keeping it around is definitely worth it.
  // #[inline(always)]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:205 check_data
  check_data(): void {
    // Using a block `{self.data}` here to force a copy instead of using `self.data`
    // directly, because `debug_assert_eq` takes references to its arguments and formatting
    // arguments and would thus borrow `self.data`. Since `Self`
    // is a packed struct, that would create a possibly unaligned reference, which
    // is UB.
    // debug_assert_eq!(
    //     self.size().truncate(self.data),
    //     { self.data },
    //     "Scalar value {:#x} exceeds size of {} bytes",
    //     { self.data },
    //     self.size
    // );
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:221 null
  static null(size: Size): ScalarInt {
    return ScalarInt.raw(0n, size);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:226 is_null
  is_null(): boolean {
    return this.data === 0n;
  }

  // PORT: `i: impl Into<u128>` is the `u128` value as a `bigint`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:231 try_from_uint
  static try_from_uint(i: bigint, size: Size): ScalarInt | undefined {
    const [r, overflow] = ScalarInt.truncate_from_uint(i, size);
    return overflow ? undefined : r;
  }

  /// Returns the truncated result, and whether truncation changed the value.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:238 truncate_from_uint
  static truncate_from_uint(i: bigint, size: Size): [ScalarInt, boolean] {
    const data = i;
    const r = ScalarInt.raw(Size_truncate(size, data), size);
    return [r, r.data !== data];
  }

  // PORT: `i: impl Into<i128>` is the `i128` value as a `bigint`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:245 try_from_int
  static try_from_int(i: bigint, size: Size): ScalarInt | undefined {
    const [r, overflow] = ScalarInt.truncate_from_int(i, size);
    return overflow ? undefined : r;
  }

  /// Returns the truncated result, and whether truncation changed the value.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:252 truncate_from_int
  static truncate_from_int(i: bigint, size: Size): [ScalarInt, boolean] {
    const data = i;
    // `into` performed sign extension, we have to truncate
    const r = ScalarInt.raw(Size_truncate(size, BigInt.asUintN(128, data)), size);
    return [r, Size_sign_extend(size, r.data) !== data];
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:260 try_from_target_usize
  static try_from_target_usize(i: bigint, tcx: TyCtxt): ScalarInt | undefined {
    return ScalarInt.try_from_uint(i, TargetDataLayout_pointer_size(tcx.gcx.data_layout));
  }

  /// Convert this ScalarInt to the underlying bits.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:266 to_bits
  to_bits(expected_size: Size): bigint {
    const self_size = this.size_;
    if (expected_size.bytes() !== self_size) {
      // #[cold]
      // rustc: compiler/rustc_middle/src/ty/consts/int.rs:270 invalid
      const invalid = (expected_size: number, self_size: number): never => {
        return panic(`ScalarInt has size ${self_size} but expected ${expected_size}`);
      };

      invalid(expected_size.bytes(), self_size);
    }

    this.check_data();
    return this.data;
  }

  /// Extracts the bits from the scalar without checking the size.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:283 to_bits_unchecked
  to_bits_unchecked(): bigint {
    this.check_data();
    return this.data;
  }

  /// Converts the `ScalarInt` to an unsigned integer of the given size.
  /// Panics if the size of the `ScalarInt` is not equal to `size`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:291 to_uint
  to_uint(size: Size): bigint {
    return this.to_bits(size);
  }

  /// Converts the `ScalarInt` to `u8`.
  /// Panics if the `size` of the `ScalarInt`in not equal to 1 byte.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:298 to_u8
  to_u8(): number {
    return to_number(this.to_uint(Size.from_bits(8)));
  }

  /// Converts the `ScalarInt` to `u16`.
  /// Panics if the size of the `ScalarInt` in not equal to 2 bytes.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:305 to_u16
  to_u16(): number {
    return to_number(this.to_uint(Size.from_bits(16)));
  }

  /// Converts the `ScalarInt` to `u32`.
  /// Panics if the `size` of the `ScalarInt` in not equal to 4 bytes.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:312 to_u32
  to_u32(): number {
    return to_number(this.to_uint(Size.from_bits(32)));
  }

  /// Converts the `ScalarInt` to `u64`.
  /// Panics if the `size` of the `ScalarInt` in not equal to 8 bytes.
  // PORT: `u64` stays a `bigint` (PORTING §5).
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:319 to_u64
  to_u64(): bigint {
    return this.to_uint(Size.from_bits(64));
  }

  /// Converts the `ScalarInt` to `u128`.
  /// Panics if the `size` of the `ScalarInt` in not equal to 16 bytes.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:326 to_u128
  to_u128(): bigint {
    return this.to_uint(Size.from_bits(128));
  }

  // PORT: the `u64` result stays a `bigint` (PORTING §5).
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:331 to_target_usize
  to_target_usize(tcx: TyCtxt): bigint {
    return this.to_uint(TargetDataLayout_pointer_size(tcx.gcx.data_layout));
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:336 to_atomic_ordering
  to_atomic_ordering(): AtomicOrdering {
    const val = this.to_u32();
    if (val === AtomicOrdering_discriminant.Relaxed) {
      return "Relaxed";
    } else if (val === AtomicOrdering_discriminant.Release) {
      return "Release";
    } else if (val === AtomicOrdering_discriminant.Acquire) {
      return "Acquire";
    } else if (val === AtomicOrdering_discriminant.AcqRel) {
      return "AcqRel";
    } else if (val === AtomicOrdering_discriminant.SeqCst) {
      return "SeqCst";
    } else {
      return panic("not a valid atomic ordering");
    }
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:355 to_simd_alignment
  to_simd_alignment(): SimdAlign {
    const val = this.to_u32();
    if (val === SimdAlign_discriminant.Unaligned) {
      return "Unaligned";
    } else if (val === SimdAlign_discriminant.Element) {
      return "Element";
    } else if (val === SimdAlign_discriminant.Vector) {
      return "Vector";
    } else {
      return panic("not a valid simd alignment");
    }
  }

  /// Converts the `ScalarInt` to `bool`.
  /// Panics if the `size` of the `ScalarInt` is not equal to 1 byte.
  /// Errors if it is not a valid `bool`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:373 try_to_bool
  try_to_bool(): Result<boolean, null> {
    switch (this.to_u8()) {
      case 0:
        return Ok(false);
      case 1:
        return Ok(true);
      default:
        return Err(null);
    }
  }

  /// Converts the `ScalarInt` to a signed integer of the given size.
  /// Panics if the size of the `ScalarInt` is not equal to `size`.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:384 to_int
  to_int(size: Size): bigint {
    const b = this.to_bits(size);
    return Size_sign_extend(size, b);
  }

  /// Converts the `ScalarInt` to i8.
  /// Panics if the size of the `ScalarInt` is not equal to 1 byte.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:391 to_i8
  to_i8(): number {
    return to_number(this.to_int(Size.from_bits(8)));
  }

  /// Converts the `ScalarInt` to i16.
  /// Panics if the size of the `ScalarInt` is not equal to 2 bytes.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:397 to_i16
  to_i16(): number {
    return to_number(this.to_int(Size.from_bits(16)));
  }

  /// Converts the `ScalarInt` to i32.
  /// Panics if the size of the `ScalarInt` is not equal to 4 bytes.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:403 to_i32
  to_i32(): number {
    return to_number(this.to_int(Size.from_bits(32)));
  }

  /// Converts the `ScalarInt` to i64.
  /// Panics if the size of the `ScalarInt` is not equal to 8 bytes.
  // PORT: `i64` stays a `bigint` (PORTING §5).
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:409 to_i64
  to_i64(): bigint {
    return this.to_int(Size.from_bits(64));
  }

  /// Converts the `ScalarInt` to i128.
  /// Panics if the size of the `ScalarInt` is not equal to 16 bytes.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:415 to_i128
  to_i128(): bigint {
    return this.to_int(Size.from_bits(128));
  }

  // PORT: the `i64` result stays a `bigint` (PORTING §5).
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:420 to_target_isize
  to_target_isize(tcx: TyCtxt): bigint {
    return this.to_int(TargetDataLayout_pointer_size(tcx.gcx.data_layout));
  }

  // PORT: `F: Float` is passed as its `FloatType` dictionary.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:425 to_float
  to_float<F extends Float<F>>(F: FloatType<F>): F {
    // Going through `to_uint` to check size and truncation.
    return F.from_bits(this.to_bits(Size.from_bits(F.BITS)));
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:431 to_f16
  to_f16(): Half {
    return this.to_float(Half);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:436 to_f32
  to_f32(): Single {
    return this.to_float(Single);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:441 to_f64
  to_f64(): Double {
    return this.to_float(Double);
  }

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:446 to_f128
  to_f128(): Quad {
    return this.to_float(Quad);
  }

  // ---- `From` / `TryFrom` impls (int.rs:451-618) ----
  // PORT: `impl From<$ty> for ScalarInt` → `ScalarInt.from_<ty>(v)`; `impl From<ScalarInt> for $ty` →
  // `ScalarInt.into_<ty>(int)`. `u64`/`u128`/`i64`/`i128` values are `bigint`s, `char` a `number` (scalar value).

  // `from_x_for_scalar_int!(u8, u16, u32, u64, u128, bool)`
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_u8(u: number): ScalarInt {
    return new ScalarInt(BigInt(u), 1);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_u16(u: number): ScalarInt {
    return new ScalarInt(BigInt(u), 2);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_u32(u: number): ScalarInt {
    return new ScalarInt(BigInt(u), 4);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_u64(u: bigint): ScalarInt {
    return new ScalarInt(u, 8);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_u128(u: bigint): ScalarInt {
    return new ScalarInt(u, 16);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:456 from
  static from_bool(u: boolean): ScalarInt {
    return new ScalarInt(u ? 1n : 0n, 1);
  }

  // `from_scalar_int_for_x!(u8, u16, u32, u64, u128)`
  // The `unwrap` cannot fail because to_uint (if it succeeds)
  // is guaranteed to return a value that fits into the size.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:472 from
  static into_u8(int: ScalarInt): number {
    return to_number(int.to_uint(Size.from_bytes(1)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:472 from
  static into_u16(int: ScalarInt): number {
    return to_number(int.to_uint(Size.from_bytes(2)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:472 from
  static into_u32(int: ScalarInt): number {
    return to_number(int.to_uint(Size.from_bytes(4)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:472 from
  static into_u64(int: ScalarInt): bigint {
    return int.to_uint(Size.from_bytes(8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:472 from
  static into_u128(int: ScalarInt): bigint {
    return int.to_uint(Size.from_bytes(16));
  }

  /** `impl TryFrom<ScalarInt> for bool` */
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:489 try_from
  static try_into_bool(int: ScalarInt): Result<boolean, null> {
    return int.try_to_bool();
  }

  /** `impl From<char> for ScalarInt` */
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:496 from
  static from_char(c: number): ScalarInt {
    return ScalarInt.from_u32(c);
  }

  // `from_x_for_scalar_int_signed!(i8, i16, i32, i64, i128)`: go via the unsigned type of the same size
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:506 from
  static from_i8(u: number): ScalarInt {
    return new ScalarInt(BigInt.asUintN(8, BigInt(u)), 1);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:506 from
  static from_i16(u: number): ScalarInt {
    return new ScalarInt(BigInt.asUintN(16, BigInt(u)), 2);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:506 from
  static from_i32(u: number): ScalarInt {
    return new ScalarInt(BigInt.asUintN(32, BigInt(u)), 4);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:506 from
  static from_i64(u: bigint): ScalarInt {
    return new ScalarInt(BigInt.asUintN(64, u), 8);
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:506 from
  static from_i128(u: bigint): ScalarInt {
    return new ScalarInt(BigInt.asUintN(128, u), 16);
  }

  // `from_scalar_int_for_x_signed!(i8, i16, i32, i64, i128)`
  // The `unwrap` cannot fail because to_int (if it succeeds)
  // is guaranteed to return a value that fits into the size.
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:522 from
  static into_i8(int: ScalarInt): number {
    return to_number(int.to_int(Size.from_bytes(1)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:522 from
  static into_i16(int: ScalarInt): number {
    return to_number(int.to_int(Size.from_bytes(2)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:522 from
  static into_i32(int: ScalarInt): number {
    return to_number(int.to_int(Size.from_bytes(4)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:522 from
  static into_i64(int: ScalarInt): bigint {
    return int.to_int(Size.from_bytes(8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:522 from
  static into_i128(int: ScalarInt): bigint {
    return int.to_int(Size.from_bytes(16));
  }

  /** `impl From<std::cmp::Ordering> for ScalarInt`: `Less`/`Equal`/`Greater` as `-1`/`0`/`1`. */
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:538 from
  static from_Ordering(c: -1 | 0 | 1): ScalarInt {
    // Here we rely on `cmp::Ordering` having the same values in host and target!
    return ScalarInt.from_i8(c);
  }

  /** `impl TryFrom<ScalarInt> for char` */
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:552 try_from
  static try_into_char(int: ScalarInt): Result<number, CharTryFromScalarInt> {
    const c = int.to_u32();
    // `char::from_u32`: a Unicode scalar value (not a surrogate, at most 0x10FFFF).
    if (c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) {
      return Err(CharTryFromScalarInt);
    }
    return Ok(c);
  }

  // `impl From<Half/Single/Double/Quad> for ScalarInt` and back (`From<ScalarInt> for Half` is `ScalarInt.into_Half`).
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:562 from
  static from_Half(f: Half): ScalarInt {
    // We trust apfloat to give us properly truncated data.
    return new ScalarInt(f.to_bits(), nonzero_u8(Half.BITS / 8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:570 from
  static into_Half(int: ScalarInt): Half {
    return Half.from_bits(int.to_bits(Size.from_bytes(2)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:577 from
  static from_Single(f: Single): ScalarInt {
    // We trust apfloat to give us properly truncated data.
    return new ScalarInt(f.to_bits(), nonzero_u8(Single.BITS / 8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:585 from
  static into_Single(int: ScalarInt): Single {
    return Single.from_bits(int.to_bits(Size.from_bytes(4)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:592 from
  static from_Double(f: Double): ScalarInt {
    // We trust apfloat to give us properly truncated data.
    return new ScalarInt(f.to_bits(), nonzero_u8(Double.BITS / 8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:600 from
  static into_Double(int: ScalarInt): Double {
    return Double.from_bits(int.to_bits(Size.from_bytes(8)));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:607 from
  static from_Quad(f: Quad): ScalarInt {
    // We trust apfloat to give us properly truncated data.
    return new ScalarInt(f.to_bits(), nonzero_u8(Quad.BITS / 8));
  }
  // rustc: compiler/rustc_middle/src/ty/consts/int.rs:615 from
  static into_Quad(int: ScalarInt): Quad {
    return Quad.from_bits(int.to_bits(Size.from_bytes(16)));
  }
}

/** The derived `PartialEq` of `ScalarInt` (both fields by value). */
export function ScalarInt_eq(a: ScalarInt, b: ScalarInt): boolean {
  return a.data === b.data && a.size_ === b.size_;
}

// Cannot derive these, as the derives take references to the fields, and we
// can't take references to fields of packed structs.
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:157 stable_hash
export function stable_hash_ScalarInt(self: ScalarInt, hcx: StableHashCtxt, hasher: StableHasher): void {
  // Using a block `{self.data}` here to force a copy instead of using `self.data`
  // directly, because `stable_hash` takes `&self` and would thus borrow `self.data`.
  // Since `Self` is a packed struct, that would create a possibly unaligned reference,
  // which is UB.
  stable_hash_u128(self.data, hcx, hasher);
  stable_hash_u8(self.size_, hcx, hasher);
}

// rustc-skip: compiler/rustc_middle/src/ty/consts/int.rs:172 encode Encodable (metadata encoding, M5)

/** `impl<D: Decoder> Decodable<D> for ScalarInt` */
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:180 decode
export function decode_ScalarInt(d: Decoder): ScalarInt {
  const data = new Uint8Array(16);
  const size = d.read_u8();
  data.set(d.read_raw_bytes(size).subarray(0, size), 0);
  // `u128::from_le_bytes(data)`
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(data[i]!);
  if (size === 0) panic("called `Option::unwrap()` on a `None` value");
  return new ScalarInt(v, size);
}

/// Error returned when a conversion from ScalarInt to char fails.
// rustc-type: compiler/rustc_middle/src/ty/consts/int.rs:546 CharTryFromScalarInt
export type CharTryFromScalarInt = "CharTryFromScalarInt";
export const CharTryFromScalarInt = "CharTryFromScalarInt" as const;
export const debug_CharTryFromScalarInt: Debug<CharTryFromScalarInt> = (v) => v;

// rustc: compiler/rustc_middle/src/ty/consts/int.rs:621 fmt
export const debug_ScalarInt: Debug<ScalarInt> = (self, _f) => {
  // Dispatch to LowerHex below.
  return `0x${lower_hex_ScalarInt(self, PLAIN)}`;
};

/** `impl fmt::LowerHex for ScalarInt` */
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:628 fmt
export function lower_hex_ScalarInt(self: ScalarInt, f: Fmt): string {
  self.check_data();
  let out = "";
  if (f.alternate) {
    // Like regular ints, alternate flag adds leading `0x`.
    out += "0x";
  }
  // Format as hex number wide enough to fit any value of the given `size`.
  // So data=20, size=1 will be "0x14", but with size=4 it'll be "0x00000014".
  // Using a block `{self.data}` here to force a copy instead of using `self.data`
  // directly, because `write!` takes references to its formatting arguments and
  // would thus borrow `self.data`. Since `Self`
  // is a packed struct, that would create a possibly unaligned reference, which
  // is UB.
  out += self.data.toString(16).padStart(self.size_ * 2, "0");
  return out;
}

/** `impl fmt::UpperHex for ScalarInt` */
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:646 fmt
export function upper_hex_ScalarInt(self: ScalarInt, _f: Fmt): string {
  self.check_data();
  // Format as hex number wide enough to fit any value of the given `size`.
  // So data=20, size=1 will be "0x14", but with size=4 it'll be "0x00000014".
  // Using a block `{self.data}` here to force a copy instead of using `self.data`
  // directly, because `write!` takes references to its formatting arguments and
  // would thus borrow `self.data`. Since `Self`
  // is a packed struct, that would create a possibly unaligned reference, which
  // is UB.
  return self.data.toString(16).toUpperCase().padStart(self.size_ * 2, "0");
}

/** `impl fmt::Display for ScalarInt` */
// rustc: compiler/rustc_middle/src/ty/consts/int.rs:660 fmt
export function display_ScalarInt(self: ScalarInt): string {
  self.check_data();
  return String(self.data);
}
