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
import { parse_float_into_scalar } from "../builder/mod.ts";

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
