// Port of compiler/rustc_middle/src/ty/cast.rs (lane typeck-gaps).
//
// PORT notes:
// - `CastTy` is a data enum (PORTING §5): unit variants are frozen singletons on the companion const, which also holds
//   the inherent methods (`CastTy.from_ty(t)`, `CastTy.is_int_like(self)`, PORTING §8). Its derived `Debug` is written
//   here (`debug_CastTy`); the derived `PartialEq` has no caller in the port yet.
// - `mir::CastKind` is the generated type of mir/syntax.gen.ts (set rustc_middle_mir_syntax).
// Helpers for handling cast expressions.

import { bug } from "../../rustc_span/macros.ts";
import { debug_TypeAndMut } from "../../rustc_type_ir/ty_kind.gen.ts";
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { CastKind } from "../mir/syntax.ts";
import type { Ty } from "./mod.ts";
import { debug_Ty } from "./structural_impls.ts";
import type { TypeAndMut } from "./sty.ts";

/// Valid types for the result of a non-coercion cast
export type CastTy =
  /// `iN`, `uN`, and integer inference variables.
  | { readonly $: "Int" }
  /// C-like (fieldless) enums.
  | { readonly $: "CEnum" }
  | { readonly $: "Bool" }
  | { readonly $: "Char" }
  /// `fN` and float inference variables.
  | { readonly $: "Float" }
  /// Function pointers.
  | { readonly $: "FnPtr" }
  /// Raw pointers.
  | { readonly $: "Ptr"; _0: TypeAndMut };

/** `#[derive(Debug)]` */
export const debug_CastTy: Debug<CastTy> = (v, f) => {
  switch (v.$) {
    case "Ptr":
      return debug_tuple(f, "Ptr", [debug_TypeAndMut(v._0, f)]);
    default:
      return v.$;
  }
};

export const CastTy = {
  Int: Object.freeze({ $: "Int" as const }),
  CEnum: Object.freeze({ $: "CEnum" as const }),
  Bool: Object.freeze({ $: "Bool" as const }),
  Char: Object.freeze({ $: "Char" as const }),
  Float: Object.freeze({ $: "Float" as const }),
  FnPtr: Object.freeze({ $: "FnPtr" as const }),

  /// Returns `Some` for integral/pointer casts.
  /// Casts like unsizing casts will return `None`.
  // rustc: compiler/rustc_middle/src/ty/cast.rs:28 from_ty
  from_ty(t: Ty): CastTy | undefined {
    const k = t.kind();
    switch (k.$) {
      case "Bool":
        return CastTy.Bool;
      case "Char":
        return CastTy.Char;
      case "Int":
      case "Uint":
        return CastTy.Int;
      case "Float":
        return CastTy.Float;
      case "Infer":
        if (k._0.$ === "IntVar") return CastTy.Int;
        if (k._0.$ === "FloatVar") return CastTy.Float;
        return undefined;
      case "Adt":
        if (k._0.is_enum() && k._0.is_payloadfree()) return CastTy.CEnum;
        return undefined;
      case "RawPtr":
        return { $: "Ptr", _0: { ty: k._0, mutbl: k._1 } };
      case "FnPtr":
        return CastTy.FnPtr;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/cast.rs:42 is_int_like
  is_int_like(self: CastTy): boolean {
    switch (self.$) {
      case "Int":
      case "CEnum":
      case "Bool":
      case "Char":
        return true;
      case "Float":
      case "FnPtr":
      case "Ptr":
        return false;
    }
  },
};

/// Returns `mir::CastKind` from the given parameters.
// rustc: compiler/rustc_middle/src/ty/cast.rs:51 mir_cast_kind
export function mir_cast_kind(from_ty: Ty, cast_ty: Ty): CastKind {
  const from = CastTy.from_ty(from_ty);
  const cast = CastTy.from_ty(cast_ty);
  let cast_kind: CastKind;
  if (from !== undefined && cast !== undefined && CastTy.is_int_like(from) && CastTy.is_int_like(cast)) {
    cast_kind = CastKind.IntToInt;
  } else if ((from?.$ === "Ptr" || from?.$ === "FnPtr") && cast?.$ === "Int") {
    cast_kind = CastKind.PointerExposeProvenance;
  } else if (from?.$ === "Int" && cast?.$ === "Ptr") {
    cast_kind = CastKind.PointerWithExposedProvenance;
  } else if (from?.$ === "FnPtr" && cast?.$ === "Ptr") {
    cast_kind = CastKind.FnPtrToPtr;
  } else if (from?.$ === "Float" && cast?.$ === "Int") {
    cast_kind = CastKind.FloatToInt;
  } else if (from?.$ === "Int" && cast?.$ === "Float") {
    cast_kind = CastKind.IntToFloat;
  } else if (from?.$ === "Float" && cast?.$ === "Float") {
    cast_kind = CastKind.FloatToFloat;
  } else if (from?.$ === "Ptr" && cast?.$ === "Ptr") {
    cast_kind = CastKind.PtrToPtr;
  } else {
    return bug(`Attempting to cast non-castable types ${debug_Ty(from_ty, PLAIN)} and ${debug_Ty(cast_ty, PLAIN)}`);
  }
  return cast_kind;
}
