// Fill lane: `miri-x86-a` (plan-m6 wave 38): ported by this lane.
// Port of src/tools/miri/src/intrinsics/x86/sse42.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - `u64` string lengths and indices are `bigint` (C5). `default_len::<T>` returns a `number`; a `u64` caller wraps it in
//   `BigInt`. They are at most 16, so `1 << i` on the `i32` result never overflows and `Number(i)` is exact.
import { Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { panic, unreachable } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
import { bool_to_simd_element } from "../../helpers.ts";
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { imm_to_scalar, MiriImmTy } from "../../operator.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { compute_crc32 } from "../math.ts";

/// A bitmask constant for scrutinizing the immediate byte provided
/// to the string comparison intrinsics. It distinuishes between
/// 16-bit integers and 8-bit integers. See [`compare_strings`]
/// for more details about the immediate byte.
const USE_WORDS = 1;

/// A bitmask constant for scrutinizing the immediate byte provided
/// to the string comparison intrinsics. It distinuishes between
/// signed integers and unsigned integers. See [`compare_strings`]
/// for more details about the immediate byte.
const USE_SIGNED = 2;

/// The main worker for the string comparison intrinsics, where the given
/// strings are analyzed according to the given immediate byte.
///
/// # Arguments
///
/// * `str1` - The first string argument. It is always a length 16 array of bytes
///   or a length 8 array of two-byte words.
/// * `str2` - The second string argument. It is always a length 16 array of bytes
///   or a length 8 array of two-byte words.
/// * `len` is the length values of the supplied strings. It is distinct from the operand length
///   in that it describes how much of `str1` and `str2` will be used for the calculation and may
///   be smaller than the array length of `str1` and `str2`. The string length is counted in bytes
///   if using byte operands and in two-byte words when using two-byte word operands.
///   If the value is `None`, the length of a string is determined by the first
///   null value inside the string.
/// * `imm` is the immediate byte argument supplied to the intrinsic. The byte influences
///   the operation as follows:
///
///   ```text
///   0babccddef
///     || | |||- Use of bytes vs use of two-byte words inside the operation.
///     || | ||
///     || | ||- Use of signed values versus use of unsigned values.
///     || | |
///     || | |- The comparison operation performed. A total of four operations are available.
///     || |    * Equal any: Checks which characters of `str2` are inside `str1`.
///     || |    * String ranges: Check if characters in `str2` are inside the provided character ranges.
///     || |      Adjacent characters in `str1` constitute one range.
///     || |    * String comparison: Mark positions where `str1` and `str2` have the same character.
///     || |    * Substring search: Mark positions where `str1` is a substring in `str2`.
///     || |
///     || |- Result Polarity. The result bits may be subjected to a bitwise complement
///     ||    if these bits are set.
///     ||
///     ||- Output selection. This bit has two meanings depending on the instruction.
///     |   If the instruction is generating a mask, it distinguishes between a bit mask
///     |   and a byte mask. Otherwise it distinguishes between the most significand bit
///     |   and the least significand bit when generating an index.
///     |
///     |- This bit is ignored. It is expected that this bit is set to zero, but it is
///        not a requirement.
///   ```
///
/// # Returns
///
/// A result mask. The bit at index `i` inside the mask is set if 'str2' starting at `i`
/// fulfills the test as defined inside the immediate byte.
/// The mask may be negated if negation flags inside the immediate byte are set.
///
/// For more information, see the Intel Software Developer's Manual, Vol. 2b, Chapter 4.1.
// rustc: src/tools/miri/src/intrinsics/x86/sse42.rs:73 compare_strings
function compare_strings(ecx: MiriInterpCx, str1: OpTy, str2: OpTy, len: [bigint, bigint] | undefined, imm: number): InterpResult<number> {
  const default_len_ = BigInt(default_len(imm));
  let len1: bigint;
  let len2: bigint;
  if (len !== undefined) {
    [len1, len2] = len;
  } else {
    const len1_r = implicit_len(ecx, str1, imm);
    if (len1_r.$ === "Err") return len1_r;
    len1 = len1_r._0 ?? default_len_;
    const len2_r = implicit_len(ecx, str2, imm);
    if (len2_r.$ === "Err") return len2_r;
    len2 = len2_r._0 ?? default_len_;
  }

  let result = 0;
  switch ((imm >> 2) & 3) {
    case 0: {
      // Equal any: Checks which characters of `str2` are inside `str1`.
      for (let i = 0n; i < len2; i++) {
        const ch2_p = ecx.project_index(str2, i);
        if (ch2_p.$ === "Err") return ch2_p;
        const ch2 = ecx.read_immediate(ch2_p._0);
        if (ch2.$ === "Err") return ch2;

        for (let j = 0n; j < len1; j++) {
          const ch1_p = ecx.project_index(str1, j);
          if (ch1_p.$ === "Err") return ch1_p;
          const ch1 = ecx.read_immediate(ch1_p._0);
          if (ch1.$ === "Err") return ch1;

          const eq = ecx.binary_op("Eq", ch1._0, ch2._0);
          if (eq.$ === "Err") return eq;
          const eq_b = interp_Scalar.to_bool(imm_to_scalar(eq._0));
          if (eq_b.$ === "Err") return eq_b;
          if (eq_b._0) {
            result |= 1 << Number(i);
            break;
          }
        }
      }
      break;
    }
    case 1: {
      // String ranges: Check if characters in `str2` are inside the provided character ranges.
      // Adjacent characters in `str1` constitute one range.
      const len1_even = len1 - (len1 & 1n);
      const get_ch = (ch: Scalar): InterpResult<number> => {
        const words = (imm & USE_WORDS) !== 0;
        const signed = (imm & USE_SIGNED) !== 0;
        if (words && signed) return interp_Scalar.to_i16(ch);
        if (words && !signed) return interp_Scalar.to_u16(ch);
        if (!words && signed) return interp_Scalar.to_i8(ch);
        return interp_Scalar.to_u8(ch);
      };

      for (let i = 0n; i < len2; i++) {
        for (let j = 0n; j < len1_even; j += 2n) {
          const ch2_p = ecx.project_index(str2, i);
          if (ch2_p.$ === "Err") return ch2_p;
          const ch2_s = ecx.read_scalar(ch2_p._0);
          if (ch2_s.$ === "Err") return ch2_s;
          const ch2 = get_ch(ch2_s._0);
          if (ch2.$ === "Err") return ch2;
          const ch1_1_p = ecx.project_index(str1, j);
          if (ch1_1_p.$ === "Err") return ch1_1_p;
          const ch1_1_s = ecx.read_scalar(ch1_1_p._0);
          if (ch1_1_s.$ === "Err") return ch1_1_s;
          const ch1_1 = get_ch(ch1_1_s._0);
          if (ch1_1.$ === "Err") return ch1_1;
          const ch1_2_p = ecx.project_index(str1, j + 1n);
          if (ch1_2_p.$ === "Err") return ch1_2_p;
          const ch1_2_s = ecx.read_scalar(ch1_2_p._0);
          if (ch1_2_s.$ === "Err") return ch1_2_s;
          const ch1_2 = get_ch(ch1_2_s._0);
          if (ch1_2.$ === "Err") return ch1_2;

          if (ch1_1._0 <= ch2._0 && ch2._0 <= ch1_2._0) {
            result |= 1 << Number(i);
          }
        }
      }
      break;
    }
    case 2: {
      // String comparison: Mark positions where `str1` and `str2` have the same character.
      result = (1 << Number(default_len_)) - 1;
      const len_max = len1 > len2 ? len1 : len2;
      const len_min = len1 < len2 ? len1 : len2;
      result ^= (1 << Number(len_max)) - 1;

      for (let i = 0n; i < len_min; i++) {
        const ch1_p = ecx.project_index(str1, i);
        if (ch1_p.$ === "Err") return ch1_p;
        const ch1 = ecx.read_immediate(ch1_p._0);
        if (ch1.$ === "Err") return ch1;
        const ch2_p = ecx.project_index(str2, i);
        if (ch2_p.$ === "Err") return ch2_p;
        const ch2 = ecx.read_immediate(ch2_p._0);
        if (ch2.$ === "Err") return ch2;
        const eq = ecx.binary_op("Eq", ch1._0, ch2._0);
        if (eq.$ === "Err") return eq;
        const eq_b = interp_Scalar.to_bool(imm_to_scalar(eq._0));
        if (eq_b.$ === "Err") return eq_b;
        result |= (eq_b._0 ? 1 : 0) << Number(i);
      }
      break;
    }
    case 3: {
      // Substring search: Mark positions where `str1` is a substring in `str2`.
      if (len1 === 0n) {
        result = (1 << Number(default_len_)) - 1;
      } else if (len1 <= len2) {
        for (let i = 0n; i < len2; i++) {
          if (len1 > len2 - i) {
            break;
          }

          result |= 1 << Number(i);

          for (let j = 0n; j < len1; j++) {
            const k = i + j;

            if (k >= default_len_) {
              break;
            } else {
              const ch1_p = ecx.project_index(str1, j);
              if (ch1_p.$ === "Err") return ch1_p;
              const ch1 = ecx.read_immediate(ch1_p._0);
              if (ch1.$ === "Err") return ch1;
              const ch2_p = ecx.project_index(str2, k);
              if (ch2_p.$ === "Err") return ch2_p;
              const ch2 = ecx.read_immediate(ch2_p._0);
              if (ch2.$ === "Err") return ch2;
              const ne = ecx.binary_op("Ne", ch1._0, ch2._0);
              if (ne.$ === "Err") return ne;
              const ne_b = interp_Scalar.to_bool(imm_to_scalar(ne._0));
              if (ne_b.$ === "Err") return ne_b;

              if (ne_b._0) {
                result &= ~(1 << Number(i));
                break;
              }
            }
          }
        }
      }
      break;
    }
    default:
      return unreachable();
  }

  // Polarity: Possibly perform a bitwise complement on the result.
  switch ((imm >> 4) & 3) {
    case 3:
      result ^= (1 << Number(len1)) - 1;
      break;
    case 1:
      result ^= (1 << Number(default_len_)) - 1;
      break;
    default:
      break;
  }

  return interp_ok(result);
}

/// Obtain the arguments of the intrinsic based on its name.
/// The result is a tuple with the following values:
/// * The first string argument.
/// * The second string argument.
/// * The string length values, if the intrinsic requires them.
/// * The immediate instruction byte.
///
/// The string arguments will be transmuted into arrays of bytes
/// or two-byte words, depending on the value of the immediate byte.
/// Originally, they are [__m128i](https://doc.rust-lang.org/stable/core/arch/x86_64/struct.__m128i.html) values
/// corresponding to the x86 128-bit integer SIMD type.
// rustc: src/tools/miri/src/intrinsics/x86/sse42.rs:200 deconstruct_args
function deconstruct_args(unprefixed_name: string, ecx: MiriInterpCx, link_name: Symbol, args: readonly OpTy[]): InterpResult<[OpTy, OpTy, [bigint, bigint] | undefined, number]> {
  const array_layout_fn = (ecx: MiriInterpCx, imm: number) => {
    if ((imm & USE_WORDS) !== 0) {
      return ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.tcx.deref().types.u16, 8));
    } else {
      return ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.tcx.deref().types.u8, 16));
    }
  };

  // The fourth letter of each string comparison intrinsic is either 'e' for "explicit" or 'i' for "implicit".
  // The distinction will correspond to the intrinsics type signature. In this context, "explicit" and "implicit"
  // refer to the way the string length is determined. The length is either passed explicitly in the "explicit"
  // case or determined by a null terminator in the "implicit" case.
  let is_explicit: boolean;
  switch (unprefixed_name[4]) {
    case "e":
      is_explicit = true;
      break;
    case "i":
      is_explicit = false;
      break;
    default:
      return unreachable();
  }

  if (is_explicit) {
    const c = ecx.check_shim_sig_llvm_intrinsic(link_name, args, 5);
    if (c.$ === "Err") return c;
    const [str1_, len1_, str2_, len2_, imm_] = c._0 as [OpTy, OpTy, OpTy, OpTy, OpTy];
    const imm_s = ecx.read_scalar(imm_);
    if (imm_s.$ === "Err") return imm_s;
    const imm = interp_Scalar.to_u8(imm_s._0);
    if (imm.$ === "Err") return imm;

    const default_len_ = default_len(imm._0);
    const len1_s = ecx.read_scalar(len1_);
    if (len1_s.$ === "Err") return len1_s;
    const len1_u = interp_Scalar.to_u32(len1_s._0);
    if (len1_u.$ === "Err") return len1_u;
    const len1 = BigInt(Math.min(len1_u._0, default_len_));
    const len2_s = ecx.read_scalar(len2_);
    if (len2_s.$ === "Err") return len2_s;
    const len2_u = interp_Scalar.to_u32(len2_s._0);
    if (len2_u.$ === "Err") return len2_u;
    const len2 = BigInt(Math.min(len2_u._0, default_len_));

    const array_layout = array_layout_fn(ecx, imm._0);
    if (array_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(array_layout._0));
    const str1 = str1_.transmute(array_layout._0, ecx);
    if (str1.$ === "Err") return str1;
    const str2 = str2_.transmute(array_layout._0, ecx);
    if (str2.$ === "Err") return str2;

    return interp_ok([str1._0, str2._0, [len1, len2], imm._0]);
  } else {
    const c = ecx.check_shim_sig_llvm_intrinsic(link_name, args, 3);
    if (c.$ === "Err") return c;
    const [str1_, str2_, imm_] = c._0 as [OpTy, OpTy, OpTy];
    const imm_s = ecx.read_scalar(imm_);
    if (imm_s.$ === "Err") return imm_s;
    const imm = interp_Scalar.to_u8(imm_s._0);
    if (imm.$ === "Err") return imm;

    const array_layout = array_layout_fn(ecx, imm._0);
    if (array_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(array_layout._0));
    const str1 = str1_.transmute(array_layout._0, ecx);
    if (str1.$ === "Err") return str1;
    const str2 = str2_.transmute(array_layout._0, ecx);
    if (str2.$ === "Err") return str2;

    return interp_ok([str1._0, str2._0, undefined, imm._0]);
  }
}

/// Calculate the c-style string length for a given string `str`.
/// The string is either a length 16 array of bytes a length 8 array of two-byte words.
// rustc: src/tools/miri/src/intrinsics/x86/sse42.rs:251 implicit_len
function implicit_len(ecx: MiriInterpCx, str: OpTy, imm: number): InterpResult<bigint | undefined> {
  let result: bigint | undefined = undefined;
  const zero = MiriImmTy.from_int(0n, str.layout.field(ecx, 0));

  const n = BigInt(default_len(imm));
  for (let i = 0n; i < n; i++) {
    const ch_p = ecx.project_index(str, i);
    if (ch_p.$ === "Err") return ch_p;
    const ch = ecx.read_immediate(ch_p._0);
    if (ch.$ === "Err") return ch;
    const is_zero = ecx.binary_op("Eq", ch._0, zero);
    if (is_zero.$ === "Err") return is_zero;
    const is_zero_b = interp_Scalar.to_bool(imm_to_scalar(is_zero._0));
    if (is_zero_b.$ === "Err") return is_zero_b;
    if (is_zero_b._0) {
      result = i;
      break;
    }
  }
  return interp_ok(result);
}

// rustc: src/tools/miri/src/intrinsics/x86/sse42.rs:271 default_len
function default_len(imm: number): number {
  return (imm & USE_WORDS) !== 0 ? 8 : 16;
}

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sse42.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sse42.rs:277
    emulate_x86_sse42_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

// rustc: src/tools/miri/src/intrinsics/x86/sse42.rs:277 emulate_x86_sse42_intrinsic
InterpCx.prototype.emulate_x86_sse42_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const e = this_.expect_target_feature_for_intrinsic(link_name, "sse4.2");
  if (e.$ === "Err") return e;
  // Prefix should have already been checked.
  const link_name_str = Symbol.as_str(link_name);
  if (!link_name_str.startsWith("llvm.x86.sse42.")) return panic("called `Option::unwrap()` on a `None` value");
  const unprefixed_name = link_name_str.slice("llvm.x86.sse42.".length);

  switch (unprefixed_name) {
    // Used to implement the `_mm_cmpestrm` and the `_mm_cmpistrm` functions.
    // These functions compare the input strings and return the resulting mask.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=1044,922
    case "pcmpistrm128":
    case "pcmpestrm128": {
      const a = deconstruct_args(unprefixed_name, this_, link_name, args);
      if (a.$ === "Err") return a;
      const [str1, str2, len, imm] = a._0;
      const mask_r = compare_strings(this_, str1, str2, len, imm);
      if (mask_r.$ === "Err") return mask_r;
      const mask = mask_r._0;

      // The sixth bit inside the immediate byte distinguishes
      // between a bit mask or a byte mask when generating a mask.
      if ((imm & 0b100_0000) !== 0) {
        let array_layout_r;
        let size_: number;
        if ((imm & USE_WORDS) !== 0) {
          array_layout_r = this_.layout_of(Ty.new_array(this_.tcx.deref(), this_.tcx.deref().types.u16, 8));
          size_ = 2;
        } else {
          array_layout_r = this_.layout_of(Ty.new_array(this_.tcx.deref(), this_.tcx.deref().types.u8, 16));
          size_ = 1;
        }
        if (array_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(array_layout_r._0));
        const size = Size.from_bytes(size_);
        const dest_t = dest.transmute(array_layout_r._0, this_);
        if (dest_t.$ === "Err") return dest_t;

        const n = default_len(imm);
        for (let i = 0; i < n; i++) {
          const result = bool_to_simd_element((mask & (1 << i)) !== 0, size);
          const d = this_.project_index(dest_t._0, BigInt(i));
          if (d.$ === "Err") return d;
          const w = this_.write_scalar(result, d._0);
          if (w.$ === "Err") return w;
        }
      } else {
        const layout = this_.layout_of(this_.tcx.deref().types.i128);
        if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
        const dest_t = dest.transmute(layout._0, this_);
        if (dest_t.$ === "Err") return dest_t;
        const w = this_.write_scalar(interp_Scalar.from_i128(BigInt(mask)), dest_t._0);
        if (w.$ === "Err") return w;
      }
      break;
    }

    // Used to implement the `_mm_cmpestra` and the `_mm_cmpistra` functions.
    // These functions compare the input strings and return `1` if the end of the second
    // input string is not reached and the resulting mask is zero, and `0` otherwise.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=919,1041
    case "pcmpistria128":
    case "pcmpestria128": {
      const a = deconstruct_args(unprefixed_name, this_, link_name, args);
      if (a.$ === "Err") return a;
      const [str1, str2, len, imm] = a._0;
      const mask_r = compare_strings(this_, str1, str2, len, imm);
      if (mask_r.$ === "Err") return mask_r;
      let result: boolean;
      if (mask_r._0 !== 0) {
        result = false;
      } else if (len !== undefined) {
        result = len[1] >= BigInt(default_len(imm));
      } else {
        const l = implicit_len(this_, str1, imm);
        if (l.$ === "Err") return l;
        result = l._0 !== undefined;
      }

      const w = this_.write_scalar(interp_Scalar.from_i32(result ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_cmpestri` and the `_mm_cmpistri` functions.
    // These functions compare the input strings and return the bit index
    // for most significant or least significant bit of the resulting mask.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=921,1043
    case "pcmpistri128":
    case "pcmpestri128": {
      const a = deconstruct_args(unprefixed_name, this_, link_name, args);
      if (a.$ === "Err") return a;
      const [str1, str2, len_, imm] = a._0;
      const mask_r = compare_strings(this_, str1, str2, len_, imm);
      if (mask_r.$ === "Err") return mask_r;
      const mask = mask_r._0;

      const len = default_len(imm);
      // The sixth bit inside the immediate byte distinguishes between the least
      // significant bit and the most significant bit when generating an index.
      let result: number;
      if ((imm & 0b100_0000) !== 0) {
        // most significant bit
        // `31u32.wrapping_sub(mask.leading_zeros())`: 31 - 32 on a zero mask wraps to `u32::MAX`.
        result = Math.min((31 - Math.clz32(mask)) >>> 0, len);
      } else {
        // least significant bit
        // `mask.trailing_zeros()` (32 on a zero mask)
        const trailing_zeros = mask === 0 ? 32 : 31 - Math.clz32(mask & -mask);
        result = Math.min(trailing_zeros, len);
      }
      const w = this_.write_scalar(interp_Scalar.from_i32(result), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_cmpestro` and the `_mm_cmpistro` functions.
    // These functions compare the input strings and return the lowest bit of the
    // resulting mask.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=923,1045
    case "pcmpistrio128":
    case "pcmpestrio128": {
      const a = deconstruct_args(unprefixed_name, this_, link_name, args);
      if (a.$ === "Err") return a;
      const [str1, str2, len, imm] = a._0;
      const mask_r = compare_strings(this_, str1, str2, len, imm);
      if (mask_r.$ === "Err") return mask_r;
      const w = this_.write_scalar(interp_Scalar.from_i32(mask_r._0 & 1), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_cmpestrc` and the `_mm_cmpistrc` functions.
    // These functions compare the input strings and return `1` if the resulting
    // mask was non-zero, and `0` otherwise.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=920,1042
    case "pcmpistric128":
    case "pcmpestric128": {
      const a = deconstruct_args(unprefixed_name, this_, link_name, args);
      if (a.$ === "Err") return a;
      const [str1, str2, len, imm] = a._0;
      const mask_r = compare_strings(this_, str1, str2, len, imm);
      if (mask_r.$ === "Err") return mask_r;
      const w = this_.write_scalar(interp_Scalar.from_i32(mask_r._0 !== 0 ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_cmpistrz` and the `_mm_cmpistrs` functions.
    // These functions return `1` if the string end has been reached and `0` otherwise.
    // Since these functions define the string length implicitly, it is equal to a
    // search for a null terminator (see `deconstruct_args` for more details).
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=924,925
    case "pcmpistriz128":
    case "pcmpistris128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (c.$ === "Err") return c;
      const [str1, str2, imm_] = c._0 as [OpTy, OpTy, OpTy];
      const imm_s = this_.read_scalar(imm_);
      if (imm_s.$ === "Err") return imm_s;
      const imm = interp_Scalar.to_u8(imm_s._0);
      if (imm.$ === "Err") return imm;

      const str_ = unprefixed_name === "pcmpistris128" ? str1 : str2;
      const array_layout =
        (imm._0 & USE_WORDS) !== 0
          ? this_.layout_of(Ty.new_array(this_.tcx.deref(), this_.tcx.deref().types.u16, 8))
          : this_.layout_of(Ty.new_array(this_.tcx.deref(), this_.tcx.deref().types.u8, 16));
      if (array_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(array_layout._0));
      const str = str_.transmute(array_layout._0, this_);
      if (str.$ === "Err") return str;
      const l = implicit_len(this_, str._0, imm._0);
      if (l.$ === "Err") return l;
      const result = l._0 !== undefined;

      const w = this_.write_scalar(interp_Scalar.from_i32(result ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_cmpestrz` and the `_mm_cmpestrs` functions.
    // These functions return 1 if the explicitly passed string length is smaller
    // than 16 for byte-sized operands or 8 for word-sized operands.
    // https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#ig_expand=1046,1047
    case "pcmpestriz128":
    case "pcmpestris128": {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 5);
      if (c.$ === "Err") return c;
      const [, len1, , len2, imm_] = c._0 as [OpTy, OpTy, OpTy, OpTy, OpTy];
      const len_ = unprefixed_name === "pcmpestris128" ? len1 : len2;
      const len_s = this_.read_scalar(len_);
      if (len_s.$ === "Err") return len_s;
      const len = interp_Scalar.to_i32(len_s._0);
      if (len.$ === "Err") return len;
      const imm_s = this_.read_scalar(imm_);
      if (imm_s.$ === "Err") return imm_s;
      const imm = interp_Scalar.to_u8(imm_s._0);
      if (imm.$ === "Err") return imm;
      const w = this_.write_scalar(interp_Scalar.from_i32(len._0 < default_len(imm._0) ? 1 : 0), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Used to implement the `_mm_crc32_u{8, 16, 32, 64}` functions.
    // These functions calculate a 32-bit CRC using `0x11EDC6F41`
    // as the polynomial, also known as CRC32C.
    // https://datatracker.ietf.org/doc/html/rfc3720#section-12.1
    case "crc32.32.8":
    case "crc32.32.16":
    case "crc32.32.32":
    case "crc32.64.64": {
      let bit_size: number;
      switch (unprefixed_name) {
        case "crc32.32.8":
          bit_size = 8;
          break;
        case "crc32.32.16":
          bit_size = 16;
          break;
        case "crc32.32.32":
          bit_size = 32;
          break;
        case "crc32.64.64":
          bit_size = 64;
          break;
      }

      if (bit_size === 64 && this_.tcx.deref().sess.target.arch.$ !== "X86_64") {
        return interp_ok(EmulateItemResult.NotSupported);
      }

      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (c.$ === "Err") return c;
      const [left_, right_] = c._0 as [OpTy, OpTy];
      const left = this_.read_scalar(left_);
      if (left.$ === "Err") return left;
      const right = this_.read_scalar(right_);
      if (right.$ === "Err") return right;

      let crc: number;
      if (bit_size === 64) {
        // The 64-bit version will only consider the lower 32 bits,
        // while the upper 32 bits get discarded.
        const l = interp_Scalar.to_u64(left._0);
        if (l.$ === "Err") return l;
        crc = Number(BigInt.asUintN(32, l._0));
      } else {
        const l = interp_Scalar.to_u32(left._0);
        if (l.$ === "Err") return l;
        crc = l._0;
      }
      let data: bigint;
      switch (bit_size) {
        case 8: {
          const d = interp_Scalar.to_u8(right._0);
          if (d.$ === "Err") return d;
          data = BigInt(d._0);
          break;
        }
        case 16: {
          const d = interp_Scalar.to_u16(right._0);
          if (d.$ === "Err") return d;
          data = BigInt(d._0);
          break;
        }
        case 32: {
          const d = interp_Scalar.to_u32(right._0);
          if (d.$ === "Err") return d;
          data = BigInt(d._0);
          break;
        }
        case 64: {
          const d = interp_Scalar.to_u64(right._0);
          if (d.$ === "Err") return d;
          data = d._0;
          break;
        }
        default:
          return unreachable();
      }

      const result_u = compute_crc32(crc, data, bit_size, 0x11edc6f41n);
      const result: Scalar = bit_size === 64 ? interp_Scalar.from_u64(BigInt(result_u)) : interp_Scalar.from_u32(result_u);

      const w = this_.write_scalar(result, dest);
      if (w.$ === "Err") return w;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};
