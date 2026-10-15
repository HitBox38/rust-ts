// Port of compiler/rustc_middle/src/ty/layout.rs: PARTIAL (lane typeck-gaps). Ported: the `IntegerExt` extension of
// `abi::Integer` except `discr_range_of_repr` (as the companion const `IntegerExt`, its fns taking the `Integer` first,
// PORTING §8) and `impl HasDataLayout for TyCtxt` (`TyCtxt.prototype.data_layout`). The rest of the file (layout
// computation, `FloatExt` (rustc_abi `Float` is not ported), `SizeSkeleton`, `LayoutCx`, fn ABIs) is M4.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import type { HasDataLayout, Integer, TargetDataLayout } from "../../rustc_abi/lib.ts";
import type { IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import { TyCtxt } from "./context.ts";
import type { Ty } from "./mod.ts";

declare module "./context.ts" {
  interface TyCtxt {
    data_layout(): TargetDataLayout;
  }
}

// #[extension(pub trait IntegerExt)] impl abi::Integer
export const IntegerExt = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/layout.rs:31 to_ty
  to_ty(self: Integer, tcx: TyCtxt, signed: boolean): Ty {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (self) {
      case "I8":
        return signed ? tcx.types.i8 : tcx.types.u8;
      case "I16":
        return signed ? tcx.types.i16 : tcx.types.u16;
      case "I32":
        return signed ? tcx.types.i32 : tcx.types.u32;
      case "I64":
        return signed ? tcx.types.i64 : tcx.types.u64;
      case "I128":
        return signed ? tcx.types.i128 : tcx.types.u128;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/layout.rs:47 from_int_ty
  from_int_ty(cx: HasDataLayout, ity: IntTy): Integer {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (ity) {
      case "I8":
        return "I8";
      case "I16":
        return "I16";
      case "I32":
        return "I32";
      case "I64":
        return "I64";
      case "I128":
        return "I128";
      case "Isize":
        return cx.data_layout().ptr_sized_integer();
    }
  },
  // rustc: compiler/rustc_middle/src/ty/layout.rs:58 from_uint_ty
  from_uint_ty(cx: HasDataLayout, ity: UintTy): Integer {
    // use abi::Integer::{I8, I16, I32, I64, I128};
    switch (ity) {
      case "U8":
        return "I8";
      case "U16":
        return "I16";
      case "U32":
        return "I32";
      case "U64":
        return "I64";
      case "U128":
        return "I128";
      case "Usize":
        return cx.data_layout().ptr_sized_integer();
    }
  },
};

// impl<'tcx> HasDataLayout for TyCtxt<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/ty/layout.rs:622 data_layout
TyCtxt.prototype.data_layout = function (this: TyCtxt): TargetDataLayout {
  return this.gcx.data_layout;
};
