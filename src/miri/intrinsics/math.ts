// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/intrinsics/math.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - Generic `F: Float` / `S: Semantics` fns take the type's `FloatType` dictionary as a trailing `F_` parameter (the
//   interpreter's convention; src/miri/math.ts header). `IeeeFloat<S>: HostFloatOperation` is the impl table of
//   src/miri/math.ts (`HostFloatOperation_Half` / `_Single` / `_Double`): the host float results are the pinned Miri
//   binary's on this host (host libm through src/rust_ts/host_libm.ts, compiler-builtins `__powi*f2`), never JS `Math.*`.
// - `todo!("f128")` / `unimplemented!("f128")` are panics with the macros' texts (an ICE, as upstream).
// - `mod aes` / `mod sha256` (`pub(crate)`) are flattened into this module as `sub_word` / `sigma0` / `sigma1` / `round`
//   (the skeleton's names). `u32` arithmetic is `>>> 0` / `Math.imul`-free shifts and xors on numbers.
import { type ImmTy, type OpTy, type PlaceTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import {
  apply_random_float_error_to_imm,
  apply_random_float_error_ulp,
  fixed_float_value,
  fixed_powi_value,
  type HostFloatOperation,
  HostFloatOperation_Double,
  HostFloatOperation_Half,
  HostFloatOperation_Single,
  host_unary_float_op,
  type HostUnaryFloatOp,
  sqrt_op,
} from "../math.ts";
import { imm_to_scalar } from "../operator.ts";
import { EmulateItemResult } from "../shims/mod.ts";
import { check_intrinsic_arg_count } from "./mod.ts";
import { type FloatTy } from "../../rustc_ast_ir/lib.ts";
import { display_ImmTy } from "../../rustc_const_eval/interpret/operand.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as interp_Scalar,
  Scalar_from_Double,
  Scalar_from_Half,
  Scalar_from_Single,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type BinOp } from "../../rustc_middle/mir/syntax.ts";
import { type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { Double, Half, type IeeeFloat, Quad, type Semantics, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { type Float, type FloatType } from "../../vendor/rustc_apfloat/lib.ts";

/** `throw_ub_format!(..)` / `err_ub_format!(..)` (`err_ub!(Ub(format!(..)))`). */
function err_ub_format(msg: string): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } };
}
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(msg)));
}

/** `<IeeeFloat<S> as Into<Scalar>>::into` for the host-float types (Half, Single, Double). */
function into_Scalar<S extends Semantics>(f: IeeeFloat<S>, F_: FloatType<IeeeFloat<S>>): Scalar {
  const T = F_ as unknown;
  if (T === Half) return Scalar_from_Half(f as unknown as Half);
  if (T === Single) return Scalar_from_Single(f as unknown as Single);
  if (T === Double) return Scalar_from_Double(f as unknown as Double);
  return bug("`Into<Scalar>` on a float type other than Half / Single / Double");
}

/** The `HostFloatOperation` impl of `IeeeFloat<S>` (`where IeeeFloat<S>: HostFloatOperation`). */
function HostFloatOperation_of<S extends Semantics>(F_: FloatType<IeeeFloat<S>>): HostFloatOperation<IeeeFloat<S>> {
  const T = F_ as unknown;
  if (T === Half) return HostFloatOperation_Half as unknown as HostFloatOperation<IeeeFloat<S>>;
  if (T === Single) return HostFloatOperation_Single as unknown as HostFloatOperation<IeeeFloat<S>>;
  if (T === Double) return HostFloatOperation_Double as unknown as HostFloatOperation<IeeeFloat<S>>;
  return bug("`HostFloatOperation` on a float type other than Half / Single / Double");
}

// rustc: src/tools/miri/src/intrinsics/math.rs:10 sqrt
function sqrt<F extends Float<F>>(this_: MiriInterpCx, args: readonly OpTy[], dest: PlaceTy, F_: FloatType<F>): InterpResult {
  const c = check_intrinsic_arg_count(args, 1);
  if (c.$ === "Err") return c;
  const [f] = c._0 as [OpTy];
  return sqrt_op(this_, f, dest, F_);
}

/// Determine which float operation on which type this is.
// rustc: src/tools/miri/src/intrinsics/math.rs:20 is_host_unary_float_op
function is_host_unary_float_op(intrinsic_name: string, generic_args: GenericArgsRef): [FloatTy, HostUnaryFloatOp] | undefined {
  let host_float_op: HostUnaryFloatOp;
  switch (intrinsic_name) {
    case "sin":
      host_float_op = "Sin";
      break;
    case "cos":
      host_float_op = "Cos";
      break;
    case "exp":
      host_float_op = "Exp";
      break;
    case "exp2":
      host_float_op = "Exp2";
      break;
    case "log":
      host_float_op = "Log";
      break;
    case "log10":
      host_float_op = "Log10";
      break;
    case "log2":
      host_float_op = "Log2";
      break;
    default:
      return undefined;
  }

  const kind = generic_args.type_at(0).kind();
  if (kind.$ !== "Float") {
    return bug(`\`${intrinsic_name}\` intrinsic called on non-float type`);
  }
  const float_ty = kind._0;
  return [float_ty, host_float_op];
}

// rustc: src/tools/miri/src/intrinsics/math.rs:41 pow_intrinsic
function pow_intrinsic<S extends Semantics>(this_: MiriInterpCx, args: readonly OpTy[], dest: PlaceTy, F_: FloatType<IeeeFloat<S>>): InterpResult<null> {
  const c = check_intrinsic_arg_count(args, 2);
  if (c.$ === "Err") return c;
  const [f1_op, f2_op] = c._0 as [OpTy, OpTy];
  const f1_r = read_float(this_, f1_op, F_);
  if (f1_r.$ === "Err") return f1_r;
  const f1: IeeeFloat<S> = f1_r._0;
  const f2_r = read_float(this_, f2_op, F_);
  if (f2_r.$ === "Err") return f2_r;
  const f2: IeeeFloat<S> = f2_r._0;

  let res =
    fixed_float_value(this_, "pow", [f1, f2], F_) ??
    (() => {
      // Using host floats (but it's fine, this operation does not have guaranteed precision).
      const res = HostFloatOperation_of(F_).host_powf(f1, f2);

      // Apply a relative error of 4ULP to introduce some non-determinism
      // simulating imprecise implementations and optimizations.
      return apply_random_float_error_ulp(this_, res, 4);
    })();
  res = this_.adjust_nan(res, [f1, f2], F_);
  const w = this_.write_scalar(into_Scalar(res, F_) as never, dest as never);
  if (w.$ === "Err") return w;
  return interp_ok(null);
}
// rustc: src/tools/miri/src/intrinsics/math.rs:65 powi_intrinsic
function powi_intrinsic<S extends Semantics>(this_: MiriInterpCx, args: readonly OpTy[], dest: PlaceTy, F_: FloatType<IeeeFloat<S>>): InterpResult<null> {
  const c = check_intrinsic_arg_count(args, 2);
  if (c.$ === "Err") return c;
  const [f_op, i_op] = c._0 as [OpTy, OpTy];
  const f_r = read_float(this_, f_op, F_);
  if (f_r.$ === "Err") return f_r;
  const f: IeeeFloat<S> = f_r._0;
  const i_s = this_.read_scalar(i_op);
  if (i_s.$ === "Err") return i_s;
  const i_r = interp_Scalar.to_i32(i_s._0 as Scalar);
  if (i_r.$ === "Err") return i_r;
  const i = i_r._0;

  let res =
    fixed_powi_value(this_, f, i) ??
    (() => {
      // Using host floats (but it's fine, this operation does not have guaranteed precision).
      const res = HostFloatOperation_of(F_).host_powi(f, i);

      // Apply a relative error of 4ULP to introduce some non-determinism
      // simulating imprecise implementations and optimizations.
      return apply_random_float_error_ulp(this_, res, 4);
    })();
  res = this_.adjust_nan(res, [f], F_);
  const w = this_.write_scalar(into_Scalar(res, F_) as never, dest as never);
  if (w.$ === "Err") return w;
  return interp_ok(null);
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/math.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/math.rs:92
    emulate_math_intrinsic(this: MiriInterpCx, intrinsic_name: string, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/math.rs:92 emulate_math_intrinsic
InterpCx.prototype.emulate_math_intrinsic = function (
  this: MiriInterpCx,
  intrinsic_name: string,
  generic_args: GenericArgsRef,
  args: readonly OpTy[],
  dest: PlaceTy,
): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();

  // PORT: the `match intrinsic_name` arms in order; the guard arm (`_ if let Some(..) = is_host_unary_float_op(..)`) sits
  // between `float_to_int_unchecked` and `powf16`, so it is checked after the earlier literal arms only.
  let r: InterpResult<unknown>;
  switch (intrinsic_name) {
    // Operations we can do with soft-floats.
    case "sqrtf16":
      r = sqrt(this_, args, dest, Half);
      break;
    case "sqrtf32":
      r = sqrt(this_, args, dest, Single);
      break;
    case "sqrtf64":
      r = sqrt(this_, args, dest, Double);
      break;
    case "sqrtf128":
      r = sqrt(this_, args, dest, Quad);
      break;

    case "fadd_fast":
    case "fsub_fast":
    case "fmul_fast":
    case "fdiv_fast":
    case "frem_fast": {
      const c = check_intrinsic_arg_count(args, 2);
      if (c.$ === "Err") return c;
      const [a_op, b_op] = c._0 as [OpTy, OpTy];
      const a_r = this_.read_immediate(a_op as never);
      if (a_r.$ === "Err") return a_r;
      const a = a_r._0 as unknown as ImmTy;
      const b_r = this_.read_immediate(b_op as never);
      if (b_r.$ === "Err") return b_r;
      const b = b_r._0 as unknown as ImmTy;
      let op: BinOp;
      switch (intrinsic_name) {
        case "fadd_fast":
          op = "Add";
          break;
        case "fsub_fast":
          op = "Sub";
          break;
        case "fmul_fast":
          op = "Mul";
          break;
        case "fdiv_fast":
          op = "Div";
          break;
        case "frem_fast":
          op = "Rem";
          break;
      }
      const float_finite = (x: ImmTy): InterpResult<boolean> => {
        const kind = x.layout.ty.kind();
        if (kind.$ !== "Float") {
          return bug(`float_finite: non-float input type ${display_Ty(x.layout.ty)}`);
        }
        const fty = kind._0;
        const s = imm_to_scalar(x);
        switch (fty) {
          case "F16": {
            const f = interp_Scalar.to_f16(s);
            if (f.$ === "Err") return f;
            return interp_ok(f._0.is_finite());
          }
          case "F32": {
            const f = interp_Scalar.to_f32(s);
            if (f.$ === "Err") return f;
            return interp_ok(f._0.is_finite());
          }
          case "F64": {
            const f = interp_Scalar.to_f64(s);
            if (f.$ === "Err") return f;
            return interp_ok(f._0.is_finite());
          }
          case "F128": {
            const f = interp_Scalar.to_f128(s);
            if (f.$ === "Err") return f;
            return interp_ok(f._0.is_finite());
          }
        }
      };
      const fa = float_finite(a);
      if (fa.$ === "Err") return fa;
      const fb = float_finite(b);
      if (fb.$ === "Err") return fb;
      if (!fa._0 && !fb._0) {
        return throw_ub_format(`\`${intrinsic_name}\` intrinsic called with non-finite value as both parameters`);
      } else if (!fa._0) {
        return throw_ub_format(`\`${intrinsic_name}\` intrinsic called with non-finite value as first parameter`);
      } else if (!fb._0) {
        return throw_ub_format(`\`${intrinsic_name}\` intrinsic called with non-finite value as second parameter`);
      }
      const res_r = this_.binary_op(op, a as never, b as never);
      if (res_r.$ === "Err") return res_r;
      const res0 = res_r._0 as unknown as ImmTy;
      // This cannot be a NaN so we also don't have to apply any non-determinism.
      // (Also, `binary_op` already called `generate_nan` if needed.)
      const fr = float_finite(res0);
      if (fr.$ === "Err") return fr;
      if (!fr._0) {
        return throw_ub_format(`\`${intrinsic_name}\` intrinsic produced non-finite value as result`);
      }
      // Apply a relative error of 4ULP to simulate non-deterministic precision loss
      // due to optimizations.
      const res = apply_random_float_error_to_imm(this_, res0, 4);
      if (res.$ === "Err") return res;
      r = this_.write_immediate(res._0.imm as never, dest as never);
      break;
    }

    case "float_to_int_unchecked": {
      const c = check_intrinsic_arg_count(args, 1);
      if (c.$ === "Err") return c;
      const [val_op] = c._0 as [OpTy];
      const val_r = this_.read_immediate(val_op as never);
      if (val_r.$ === "Err") return val_r;
      const val = val_r._0 as unknown as ImmTy;

      const res_r = this_.float_to_int_checked(val as never, dest.layout, "TowardZero");
      if (res_r.$ === "Err") return res_r;
      const res = res_r._0;
      if (res === undefined) {
        return throw_ub_format(
          `\`float_to_int_unchecked\` intrinsic called on ${display_ImmTy(val as never, PLAIN)} which cannot be represented in target type \`${debug_Ty(dest.layout.ty, PLAIN)}\``,
        );
      }

      r = this_.write_immediate(res.imm as never, dest as never);
      break;
    }

    case "powf16":
      r = pow_intrinsic(this_, args, dest, Half);
      break;
    case "powf32":
      r = pow_intrinsic(this_, args, dest, Single);
      break;
    case "powf64":
      r = pow_intrinsic(this_, args, dest, Double);
      break;
    case "powf128":
      return panic("not yet implemented: f128"); // FIXME(f128)

    case "powif16":
      r = powi_intrinsic(this_, args, dest, Half);
      break;
    case "powif32":
      r = powi_intrinsic(this_, args, dest, Single);
      break;
    case "powif64":
      r = powi_intrinsic(this_, args, dest, Double);
      break;
    case "powif128":
      return panic("not yet implemented: f128"); // FIXME(f128)

    default: {
      // Operations that need host floats.
      const host = is_host_unary_float_op(intrinsic_name, generic_args);
      if (host !== undefined) {
        const [float_ty, op] = host;
        const c = check_intrinsic_arg_count(args, 1);
        if (c.$ === "Err") return c;
        const [f] = c._0 as [OpTy];
        switch (float_ty) {
          case "F16":
            r = host_unary_float_op(this_, f, op, dest, Half);
            break;
          case "F32":
            r = host_unary_float_op(this_, f, op, dest, Single);
            break;
          case "F64":
            r = host_unary_float_op(this_, f, op, dest, Double);
            break;
          case "F128":
            return panic("not yet implemented: f128"); // FIXME(f128)
        }
        break;
      }
      return interp_ok(EmulateItemResult.NotSupported);
    }
  }
  if (r.$ === "Err") return r;

  return interp_ok(EmulateItemResult.NeedsReturn);
};

/// Compute a CRC32 checksum using the given polynomial.
///
/// `bit_size` is the number of relevant data bits (8, 16, 32, or 64).
/// Only the low `bit_size` bits of `data` are used; higher bits must be zero.
/// `polynomial` includes the leading 1 bit (e.g. `0x11EDC6F41` for CRC32C).
///
/// Following hardware CRC conventions, `crc` and `data` bits are assumed to be reversed,
/// and output bits will be equally reversed.
// rustc: src/tools/miri/src/intrinsics/math.rs:215 compute_crc32
export function compute_crc32(crc: number, data: bigint, bit_size: number, polynomial: bigint): number {
  assert(bit_size === 64 || data < u64_strict_shl(1n, bit_size), () => `crc32: \`data\` is larger than ${bit_size} bits`);
  // Bit-reverse inputs to match hardware CRC conventions.
  const crc_ = BigInt(u32_reverse_bits(crc));
  // Reverse all 64 bits of `data`, then shift right by `64 - bit_size`. This
  // discards the (now-reversed) higher bits, leaving only the reversed low
  // `bit_size` bits in the lowest positions (with zeros above).
  const v = u64_reverse_bits(data) >> BigInt(u32_strict_sub(64, bit_size));

  // Perform polynomial division modulo 2.
  // The algorithm for the division is an adapted version of the
  // schoolbook division algorithm used for normal integer or polynomial
  // division. In this context, the quotient is not calculated, since
  // only the remainder is needed.
  //
  // The algorithm works as follows:
  // 1. Pull down digits until division can be performed. In the context of division
  //    modulo 2 it means locating the most significant digit of the dividend and shifting
  //    the divisor such that the position of the divisors most significand digit and the
  //    dividends most significand digit match.
  // 2. Perform a division and determine the remainder. Since it is arithmetic modulo 2,
  //    this operation is a simple bitwise exclusive or.
  // 3. Repeat steps 1. and 2. until the full remainder is calculated. This is the case
  //    once the degree of the remainder polynomial is smaller than the degree of the
  //    divisor polynomial. In other words, the number of leading zeros of the remainder
  //    is larger than the number of leading zeros of the divisor. It is important to
  //    note that standard arithmetic comparison is not applicable here:
  //    0b10011 / 0b11111 = 0b01100 is a valid division, even though the dividend is
  //    smaller than the divisor.
  let dividend = (u128_shl(crc_, bit_size)) ^ (u128_shl(v, 32));
  while (u128_leading_zeros(dividend) <= u128_leading_zeros(polynomial)) {
    dividend ^= u128_shl(polynomial, u128_leading_zeros(polynomial)) >> BigInt(u128_leading_zeros(dividend));
  }

  if (dividend > 0xffff_ffffn) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return u32_reverse_bits(Number(dividend));
}

/// AES primitives
// pub(crate) mod aes {
/// AES S-box
///
/// Source: [NIST Advanced Encryption Standar][1], Figure 7 (page 16)
///
/// [1]: https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=901427
const SBOX: readonly number[] = [
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab,
  0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4,
  0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71,
  0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2,
  0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6,
  0xb3, 0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb,
  0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45,
  0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5,
  0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44,
  0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a,
  0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49,
  0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d,
  0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08, 0xba, 0x78, 0x25,
  0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70, 0x3e,
  0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1,
  0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb,
  0x16,
];

/// Applies S-box substitution to each byte of a 32-bit word
// rustc: src/tools/miri/src/intrinsics/math.rs:284 sub_word
export function sub_word(word: number): number {
  // PORT: `to_ne_bytes` / `from_ne_bytes` round-trip: the per-byte map is independent of the byte order.
  const b0 = SBOX[word & 0xff]!;
  const b1 = SBOX[(word >>> 8) & 0xff]!;
  const b2 = SBOX[(word >>> 16) & 0xff]!;
  const b3 = SBOX[(word >>> 24) & 0xff]!;
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}
// }

// sha256 primitives shared by the x86 and aarch64 intrinsics. Math helpers adapted from RustCrypto soft impl:
// https://github.com/RustCrypto/hashes/blob/3d2bc57db40fd6aeb25d6c6da98d67e2784c2985/sha2/src/sha256/soft/compact.rs
// pub(crate) mod sha256 {
// rustc: src/tools/miri/src/intrinsics/math.rs:293 sigma0
export function sigma0(x: number): number {
  return (u32_rotate_right(x, 7) ^ u32_rotate_right(x, 18) ^ (x >>> 3)) >>> 0;
}

// rustc: src/tools/miri/src/intrinsics/math.rs:297 sigma1
export function sigma1(x: number): number {
  return (u32_rotate_right(x, 17) ^ u32_rotate_right(x, 19) ^ (x >>> 10)) >>> 0;
}

/// One round of the compression; `wk` is the round's `w[i] + k[i]`.
// rustc: src/tools/miri/src/intrinsics/math.rs:302 round
export function round(state: readonly number[], wk: number): number[] {
  const [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];

  const s1 = (u32_rotate_right(e, 6) ^ u32_rotate_right(e, 11) ^ u32_rotate_right(e, 25)) >>> 0;
  const ch = ((e & f) ^ (~e & g)) >>> 0;
  const t1 = (((((s1 + ch) >>> 0) + wk) >>> 0) + h) >>> 0;

  const s0 = (u32_rotate_right(a, 2) ^ u32_rotate_right(a, 13) ^ u32_rotate_right(a, 22)) >>> 0;
  const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
  const t2 = (s0 + maj) >>> 0;

  return [
    (t1 + t2) >>> 0, // a
    a, // b
    b, // c
    c, // d
    (d + t1) >>> 0, // e
    e, // f
    f, // g
    g, // h
  ];
}
// }

// ---------------------------------------------------------------- private glue of this module ----

/** `this.read_scalar(op)?.to_float()?`. */
function read_float<F extends Float<F>>(this_: MiriInterpCx, op: OpTy, F_: FloatType<F>): InterpResult<F> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_float(s._0 as Scalar, F_);
}

/** `u32::rotate_right`. */
function u32_rotate_right(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** `u32::reverse_bits`. */
function u32_reverse_bits(x: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) {
    r = ((r << 1) | ((x >>> i) & 1)) >>> 0;
  }
  return r;
}

/** `u64::reverse_bits`. */
function u64_reverse_bits(x: bigint): bigint {
  let r = 0n;
  for (let i = 0n; i < 64n; i++) {
    r = (r << 1n) | ((x >> i) & 1n);
  }
  return r;
}

/** `u64::strict_shl` (panics on a shift >= 64). */
function u64_strict_shl(x: bigint, n: number): bigint {
  if (n >= 64) panic("attempt to shift left with overflow");
  return (x << BigInt(n)) & 0xffff_ffff_ffff_ffffn;
}

/** `u32::strict_sub`. */
function u32_strict_sub(a: number, b: number): number {
  if (b > a) panic("attempt to subtract with overflow");
  return a - b;
}

const U128_MASK = (1n << 128n) - 1n;
/** `u128 << n` (`n < 128`; wrapping in the `u128` width). */
function u128_shl(x: bigint, n: number): bigint {
  return (x << BigInt(n)) & U128_MASK;
}

/** `u128::leading_zeros`. */
function u128_leading_zeros(x: bigint): number {
  if (x === 0n) return 128;
  return 128 - x.toString(2).length;
}
