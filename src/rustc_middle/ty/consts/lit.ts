// Port of compiler/rustc_middle/src/ty/consts/lit.rs (lane ty-results).
import type { LitKind } from "../../../rustc_ast/lib.ts";
import { type Debug, debug_bool, debug_option, debug_struct } from "../../../std/fmt.ts";
import type { TyCtxt } from "../context.ts";
import type { Ty } from "../mod.ts";

/// Input argument for `tcx.lit_to_const`.
// rustc-type: compiler/rustc_middle/src/ty/consts/lit.rs:9 LitToConstInput
export interface LitToConstInput {
  /// The absolute value of the resultant constant.
  lit: LitKind;
  /// The type of the constant.
  ///
  /// `None` is used by const generics when the type of the constant is unknown, e.g.
  /// if there are inference variables
  ty: Ty | undefined;
  /// If the constant is negative.
  neg: boolean;
}
/** The derived `Debug` of `LitToConstInput` (lit.rs:8). */
export const debug_LitToConstInput: Debug<LitToConstInput> = (v, f) => {
  const { debug_LitKind } = require("../../../rustc_ast/lib.ts") as typeof import("../../../rustc_ast/lib.ts");
  const { debug_Ty } = require("../structural_impls.ts") as typeof import("../structural_impls.ts");
  return debug_struct(f, "LitToConstInput", [
    ["lit", debug_LitKind(v.lit, f)],
    ["ty", debug_option(v.ty, f, debug_Ty)],
    ["neg", debug_bool(v.neg, f)],
  ]);
};

/// Checks whether a literal can be interpreted as a const of the given type.
// rustc: compiler/rustc_middle/src/ty/consts/lit.rs:22 const_lit_matches_ty
export function const_lit_matches_ty(tcx: TyCtxt, kind: LitKind, ty: Ty, neg: boolean): boolean {
  const k = ty.kind();
  if (kind.$ === "Str" && k.$ === "Ref" && k._1.is_str()) {
    return true;
  } else if (kind.$ === "Str" && k.$ === "Str" && tcx.features().deref_patterns()) {
    return true;
  } else if (kind.$ === "ByteStr" && k.$ === "Ref" && byte_str_inner_is_u8(k._1)) {
    return true;
  } else if (kind.$ === "ByteStr" && (k.$ === "Slice" || k.$ === "Array") && tcx.features().deref_patterns() && is_u8(k._0)) {
    return true;
  } else if (kind.$ === "Byte" && k.$ === "Uint" && k._0 === "U8") {
    return true;
  } else if (kind.$ === "CStr" && k.$ === "Ref" && is_cstr_adt(tcx, k._1)) {
    return true;
  } else if (kind.$ === "Int" && kind._1.$ === "Unsigned" && k.$ === "Uint" && !neg) {
    return kind._1._0 === k._0;
  } else if (kind.$ === "Int" && kind._1.$ === "Signed" && k.$ === "Int") {
    return kind._1._0 === k._0;
  } else if (kind.$ === "Int" && kind._1.$ === "Unsuffixed" && k.$ === "Uint" && !neg) {
    return true;
  } else if (kind.$ === "Int" && kind._1.$ === "Unsuffixed" && k.$ === "Int") {
    return true;
  } else if (kind.$ === "Bool" && k.$ === "Bool") {
    return true;
  } else if (kind.$ === "Float" && kind._1.$ === "Suffixed" && k.$ === "Float") {
    return kind._1._0 === k._0;
  } else if (kind.$ === "Float" && kind._1.$ === "Unsuffixed" && k.$ === "Float") {
    return true;
  } else if (kind.$ === "Char" && k.$ === "Char") {
    return true;
  } else if (kind.$ === "Err") {
    return true;
  } else {
    return false;
  }
}

/** `matches!(ty.kind(), ty::Uint(ty::UintTy::U8))` */
function is_u8(ty: Ty): boolean {
  const k = ty.kind();
  return k.$ === "Uint" && k._0 === "U8";
}
/** The guard `if let ty::Slice(ty) | ty::Array(ty, _) = inner_ty.kind() && matches!(ty.kind(), ty::Uint(ty::UintTy::U8))`. */
function byte_str_inner_is_u8(inner_ty: Ty): boolean {
  const k = inner_ty.kind();
  return (k.$ === "Slice" || k.$ === "Array") && is_u8(k._0);
}
/** The guard `matches!(inner_ty.kind(), ty::Adt(def, _) if tcx.is_lang_item(def.did(), LangItem::CStr))`. */
function is_cstr_adt(tcx: TyCtxt, inner_ty: Ty): boolean {
  const k = inner_ty.kind();
  if (k.$ !== "Adt") return false;
  return tcx.is_lang_item(k._0.did(), "CStr");
}
