// compiler/rustc_codegen_llvm/src/type_of.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave
// 41) owns this file and ports type_of.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns of type_of.rs that other fill lanes call (review F2), as typed stubs.
// PORT (cg-contract): `pub(crate) trait LayoutLlvmExt<'tcx>` (implemented only for `TyAndLayout<'tcx>`) is a `declare module`
// augmentation of rustc_abi's class `TyAndLayout`, plus prototype assignments (the miri decision C2 form for an extension trait
// on a foreign class): `layout.llvm_type(cx)` reads as upstream. cg-types-attrs adds the trait's other methods the same way.
import type { Align, Size } from "../rustc_abi/lib.ts";
import { TyAndLayout } from "../rustc_abi/layout/ty.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";
import type { Type } from "./llvm/mod.ts";

// ---- impl CodegenCx (type_of.rs:191): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface CodegenCx {
    align_of(ty: Ty): Align;
    size_of(ty: Ty): Size;
  }
}

// Stub (cg-contract): align_of (type_of.rs:192)
CodegenCx.prototype.align_of = function (this: CodegenCx, _ty: Ty): Align {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_of.rs align_of");
};

// Stub (cg-contract): size_of (type_of.rs:196)
CodegenCx.prototype.size_of = function (this: CodegenCx, _ty: Ty): Size {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_of.rs size_of");
};

// ---- impl LayoutLlvmExt for TyAndLayout (type_of.rs:233): Cross-lane surface (cg-contract, review F2) ----
declare module "../rustc_abi/layout/ty.ts" {
  interface TyAndLayout<Ty> {
    llvm_type(cx: CodegenCx): Type;
    immediate_llvm_type(cx: CodegenCx): Type;
    scalar_pair_element_llvm_type(cx: CodegenCx, index: number, immediate: boolean): Type;
  }
}

// Stub (cg-contract): llvm_type (type_of.rs:234)
TyAndLayout.prototype.llvm_type = function (this: TyAndLayout<Ty>, _cx: CodegenCx): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_of.rs llvm_type");
};

// Stub (cg-contract): immediate_llvm_type (type_of.rs:287)
TyAndLayout.prototype.immediate_llvm_type = function (this: TyAndLayout<Ty>, _cx: CodegenCx): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_of.rs immediate_llvm_type");
};

// Stub (cg-contract): scalar_pair_element_llvm_type (type_of.rs:318)
TyAndLayout.prototype.scalar_pair_element_llvm_type = function (this: TyAndLayout<Ty>, _cx: CodegenCx, _index: number, _immediate: boolean): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_of.rs scalar_pair_element_llvm_type");
};
