// Port of compiler/rustc_mir_build/src/thir/constant.rs (lane thir-cx-print).
import { Size, type TargetDataLayout } from "../../rustc_abi/lib.ts";
import type { FloatTy as AstFloatTy } from "../../rustc_ast/lib.ts";
import { type FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import type { LitToConstInput } from "../../rustc_middle/ty/consts/lit.ts";
import { ValTree, type Value } from "../../rustc_middle/ty/consts/valtree.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { TyKind } from "../../rustc_middle/ty/sty.gen.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { Ty as TyC } from "../../rustc_middle/ty/mod.ts";
import { ByteSymbol, Symbol } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { PLAIN, display_f64 } from "../../std/fmt.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { debug_ParseError } from "../../vendor/rustc_apfloat/lib.ts";

// PORT: stand-in for `crate::builder::parse_float_into_scalar` (compiler/rustc_mir_build/src/builder/mod.rs:1100;
// builder/mod.rs is not ported yet): upstream's body, with the vendored rustc_apfloat (lane vendor-apfloat-b). Not a
// marker: it moves to builder/mod.ts (with its `// rustc:` marker) when that file is ported.
function parse_float_into_scalar(num_: Symbol, float_ty: FloatTy, neg: boolean): ScalarInt | undefined {
  const num = Symbol.as_str(num_);
  switch (float_ty) {
    // FIXME(f16_f128): When available, compare to the library parser as with `f32` and `f64`
    case "F16": {
      const r = Half.from_str(num);
      if (r.$ === "Err") return undefined;
      let f = r._0;
      if (neg) {
        f = f.neg();
      }
      return ScalarInt.from_Half(f);
    }
    case "F32": {
      const rust_f = core_parse_float(num, 32);
      if (rust_f === undefined) return undefined;
      const r = Single.from_str(num);
      if (r.$ === "Err") return panic(`apfloat::ieee::Single failed to parse \`${num}\`: ${debug_ParseError(r._0, PLAIN)}`);
      let f = r._0;

      assert(
        rust_f === f.to_bits(),
        // PORT: the message's `{}` of the host `f32` (`core::fmt::Display for f32`) is not ported; this assert cannot
        // fail (both parsers round correctly, see `core_parse_float`).
        rust_f === f.to_bits() ? "" : unported("core::fmt::Display for f32 (parse_float_into_scalar's assert message)"),
      );

      if (neg) {
        f = f.neg();
      }

      return ScalarInt.from_Single(f);
    }
    case "F64": {
      const rust_f = core_parse_float(num, 64);
      if (rust_f === undefined) return undefined;
      const r = Double.from_str(num);
      if (r.$ === "Err") return panic(`apfloat::ieee::Double failed to parse \`${num}\`: ${debug_ParseError(r._0, PLAIN)}`);
      let f = r._0;

      assert(
        rust_f === f.to_bits(),
        rust_f === f.to_bits()
          ? ""
          : `apfloat::ieee::Double gave different result for \`${display_f64(f64_from_bits(rust_f))}\`: ${f.fmt()}(0x${f.to_bits().toString(16)}) vs Rust's ${Double.from_bits(rust_f).fmt()}(0x${rust_f.toString(16)})`,
      );

      if (neg) {
        f = f.neg();
      }

      return ScalarInt.from_Double(f);
    }
    // FIXME(f16_f128): When available, compare to the library parser as with `f32` and `f64`
    case "F128": {
      const r = Quad.from_str(num);
      if (r.$ === "Err") return undefined;
      let f = r._0;
      if (neg) {
        f = f.neg();
      }
      return ScalarInt.from_Quad(f);
    }
  }
}

/** `f64::from_bits` */
function f64_from_bits(bits: bigint): number {
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, bits);
  return v.getFloat64(0);
}

/**
 * PORT: `num.parse::<f32>()` / `num.parse::<f64>()` (core::num::dec2flt, `FromStr for f32 / f64`), as the bits of the
 * result (`undefined` = `Err`). Not a port of dec2flt's algorithm (Eisel-Lemire with a big-decimal fallback): it
 * accepts the same syntax (`[+-]`, then `inf` / `infinity` / `nan` in any case, or digits with an optional `.` and at
 * least one digit, then an optional `e`/`E`, sign and digits) and returns the same value, which dec2flt defines as the
 * nearest representable value, ties to even; here that rounding is done exactly with bigints.
 */
function core_parse_float(s: string, bits: 32 | 64): bigint | undefined {
  const P = bits === 32 ? 24 : 53; // precision (with the implicit bit)
  const EXP_BITS = bits === 32 ? 8 : 11;
  const BIAS = (1 << (EXP_BITS - 1)) - 1;
  const EMIN = 1 - BIAS;
  const EMAX = BIAS;
  const SIGN = 1n << BigInt(bits - 1);
  const INF = BigInt((1 << EXP_BITS) - 1) << BigInt(P - 1);
  const NAN = INF | (1n << BigInt(P - 2));

  let i = 0;
  let negative = false;
  if (s[0] === "+" || s[0] === "-") {
    negative = s[0] === "-";
    i = 1;
  }
  const sign = negative ? SIGN : 0n;
  const rest = s.slice(i).toLowerCase();
  if (rest === "inf" || rest === "infinity") return sign | INF;
  if (rest === "nan") return sign | NAN;

  const m = /^([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(s.slice(i));
  if (m === null) return undefined;
  const int_digits = m[1]!;
  const frac_digits = m[2] ?? "";
  if (int_digits.length + frac_digits.length === 0) return undefined;
  const digits = (int_digits + frac_digits).replace(/^0+/, "");
  if (digits.length === 0) return sign;
  // `exp` is clamped: beyond these bounds the value is certainly infinite / zero for both formats.
  const exp_raw = m[3] === undefined ? 0n : BigInt(m[3]);
  const e10_big = exp_raw - BigInt(frac_digits.length);
  const magnitude = e10_big + BigInt(digits.length); // value in [10^(magnitude-1), 10^magnitude)
  if (magnitude > 400n) return sign | INF;
  if (magnitude < -400n) return sign;
  const e10 = Number(e10_big);

  // value = num / den
  let num = BigInt(digits);
  let den = 1n;
  if (e10 >= 0) num *= 10n ** BigInt(e10);
  else den = 10n ** BigInt(-e10);

  // b = floor(log2(num / den))
  const bitlen = (x: bigint) => x.toString(2).length;
  let b = bitlen(num) - bitlen(den);
  const ge_pow2 = (k: number) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);
  if (!ge_pow2(b)) b -= 1;

  let e = Math.max(b, EMIN);
  // q = num / den in units of 2^(e - (P - 1)), rounded to nearest, ties to even.
  const shift = P - 1 - e;
  const n2 = shift >= 0 ? num << BigInt(shift) : num;
  const d2 = shift >= 0 ? den : den << BigInt(-shift);
  let q = n2 / d2;
  const r2 = (n2 % d2) * 2n;
  if (r2 > d2 || (r2 === d2 && (q & 1n) === 1n)) q += 1n;
  if (q === 1n << BigInt(P)) {
    q >>= 1n;
    e += 1;
  }
  if (e > EMAX) return sign | INF;
  if (q < 1n << BigInt(P - 1)) {
    // Subnormal (or zero): biased exponent 0.
    return sign | q;
  }
  return sign | (BigInt(e + BIAS) << BigInt(P - 1)) | (q - (1n << BigInt(P - 1)));
}

/** `u128::wrapping_neg` */
function u128_wrapping_neg(n: bigint): bigint {
  return BigInt.asUintN(128, -n);
}

// rustc: compiler/rustc_mir_build/src/thir/constant.rs:11 lit_to_const
export function lit_to_const(tcx: TyCtxt, lit_input: LitToConstInput): Value | undefined {
  const { lit, ty: expected_ty, neg } = lit_input;

  if (expected_ty !== undefined && TypeVisitableExt.error_reported(expected_ty, fold_Ty).$ === "Err") {
    return undefined;
  }

  const trunc = (n: bigint, width_: UintTy): ScalarInt => {
    const bw = UintTy.bit_width(UintTy.normalize(width_, (tcx.gcx.data_layout as TargetDataLayout).pointer_size().bits()));
    if (bw === undefined) return bug("called `Option::unwrap()` on a `None` value");
    const width = Size.from_bits(bw);
    // trace!("trunc {} with size {} and shift {}", n, width.bits(), 128 - width.bits());
    const result = width.truncate(n);
    // trace!("trunc result: {}", result);

    const r = ScalarInt.try_from_uint(result, width);
    if (r === undefined) return bug(`expected to create ScalarInt from uint ${result}`);
    return r;
  };

  const ek: TyKind | undefined = expected_ty === undefined ? undefined : expected_ty.kind();
  let valtree: ValTree;
  let valtree_ty: Ty;
  if (lit.$ === "Str") {
    const s = lit._0;
    const str_bytes = new TextEncoder().encode(Symbol.as_str(s));
    valtree_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_static, tcx.types.str_);
    valtree = ValTree.from_raw_bytes(tcx, str_bytes);
  } else if (lit.$ === "ByteStr" && ek !== undefined && ek.$ === "Ref" && ref_inner_is_u8_slice_or_array(ek._1)) {
    valtree = ValTree.from_raw_bytes(tcx, ByteSymbol.as_byte_str(lit._0));
    valtree_ty = expected_ty!;
  } else if (
    lit.$ === "ByteStr" &&
    ek !== undefined &&
    (ek.$ === "Slice" || ek.$ === "Array") &&
    tcx.features().deref_patterns() &&
    ek._0.kind().$ === "Uint" &&
    (ek._0.kind() as { _0: UintTy })._0 === "U8"
  ) {
    // Byte string literal patterns may have type `[u8]` or `[u8; N]` if `deref_patterns` is
    // enabled, in order to allow, e.g., `deref!(b"..."): Vec<u8>`.
    valtree = ValTree.from_raw_bytes(tcx, ByteSymbol.as_byte_str(lit._0));
    valtree_ty = expected_ty!;
  } else if (lit.$ === "ByteStr") {
    const byte_sym = lit._0;
    valtree = ValTree.from_raw_bytes(tcx, ByteSymbol.as_byte_str(byte_sym));
    valtree_ty = TyC.new_array(tcx, tcx.types.u8, ByteSymbol.as_byte_str(byte_sym).length);
  } else if (lit.$ === "Byte") {
    valtree = ValTree.from_scalar_int(tcx, ScalarInt.from_u8(lit._0));
    valtree_ty = tcx.types.u8;
  } else if (lit.$ === "CStr" && tcx.lang_items().get("CStr") !== undefined) {
    const cstr_def_id = tcx.lang_items().get("CStr")!;
    // A CStr is a newtype around a byte slice, so we create the inner slice here.
    // We need a branch for each "level" of the data structure.
    const cstr_ty = EarlyBinder.skip_binder(tcx.type_of(cstr_def_id) as EarlyBinder<Ty>);
    const bytes = ValTree.from_raw_bytes(tcx, ByteSymbol.as_byte_str(lit._0));
    valtree = ValTree.from_branches(tcx, [Const.new_value(tcx, bytes, cstr_ty)]);
    valtree_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_static, cstr_ty);
  } else if (lit.$ === "Int" && lit._1.$ === "Unsigned" && !neg) {
    const ui = lit._1._0;
    const scalar_int = trunc(lit._0, ui);
    valtree = ValTree.from_scalar_int(tcx, scalar_int);
    valtree_ty = TyC.new_uint(tcx, ui);
  } else if (lit.$ === "Int" && lit._1.$ === "Unsigned" && neg) {
    return undefined;
  } else if (lit.$ === "Int" && lit._1.$ === "Signed") {
    const i = lit._1._0;
    const n = lit._0;
    const scalar_int = trunc(neg ? u128_wrapping_neg(n) : n, IntTy.to_unsigned(i));
    valtree = ValTree.from_scalar_int(tcx, scalar_int);
    valtree_ty = TyC.new_int(tcx, i);
  } else if (lit.$ === "Int" && lit._1.$ === "Unsuffixed" && ek !== undefined && ek.$ === "Uint" && !neg) {
    const ui = ek._0;
    const scalar_int = trunc(lit._0, ui);
    valtree = ValTree.from_scalar_int(tcx, scalar_int);
    valtree_ty = TyC.new_uint(tcx, ui);
  } else if (lit.$ === "Int" && lit._1.$ === "Unsuffixed" && ek !== undefined && ek.$ === "Int") {
    const i = ek._0;
    const n = lit._0;
    // Unsigned "negation" has the same bitwise effect as signed negation,
    // which gets the result we want without additional casts.
    const scalar_int = trunc(neg ? u128_wrapping_neg(n) : n, IntTy.to_unsigned(i));
    valtree = ValTree.from_scalar_int(tcx, scalar_int);
    valtree_ty = TyC.new_int(tcx, i);
  } else if (lit.$ === "Bool") {
    valtree = ValTree.from_scalar_int(tcx, ScalarInt.from_bool(lit._0));
    valtree_ty = tcx.types.bool;
  } else if (lit.$ === "Float" && lit._1.$ === "Suffixed") {
    const fty_: AstFloatTy = lit._1._0;
    let fty: FloatTy;
    switch (fty_) {
      case "F16":
        fty = "F16";
        break;
      case "F32":
        fty = "F32";
        break;
      case "F64":
        fty = "F64";
        break;
      case "F128":
        fty = "F128";
        break;
    }
    const bits = parse_float_into_scalar(lit._0, fty, neg);
    if (bits === undefined) return undefined;
    valtree = ValTree.from_scalar_int(tcx, bits);
    valtree_ty = TyC.new_float(tcx, fty);
  } else if (lit.$ === "Float" && lit._1.$ === "Unsuffixed" && ek !== undefined && ek.$ === "Float") {
    const fty = ek._0;
    const bits = parse_float_into_scalar(lit._0, fty, neg);
    if (bits === undefined) return undefined;
    valtree = ValTree.from_scalar_int(tcx, bits);
    valtree_ty = TyC.new_float(tcx, fty);
  } else if (lit.$ === "Char") {
    valtree = ValTree.from_scalar_int(tcx, ScalarInt.from_char(lit._0));
    valtree_ty = tcx.types.char;
  } else if (lit.$ === "Err") {
    return undefined;
  } else {
    return undefined;
  }

  return { ty: valtree_ty, valtree };
}

/** The guard of the second arm: `if let ty::Slice(ty) | ty::Array(ty, _) = inner_ty.kind() && let ty::Uint(UintTy::U8) = ty.kind()`. */
function ref_inner_is_u8_slice_or_array(inner_ty: Ty): boolean {
  const k = inner_ty.kind();
  if (k.$ === "Slice" || k.$ === "Array") {
    const tk = k._0.kind();
    return tk.$ === "Uint" && tk._0 === "U8";
  }
  return false;
}
