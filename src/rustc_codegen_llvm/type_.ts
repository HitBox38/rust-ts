// compiler/rustc_codegen_llvm/src/type_.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave 41) owns this file and ports
// type_.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl BaseTypeCodegenMethods for GenericCx`, `impl LayoutTypeCodegenMethods for CodegenCx` and `impl
// TypeMembershipCodegenMethods for CodegenCx`, and `impl fmt::Debug for Type` (the `debug_Type` / `debug_FunctionSignature`
// members of `GenericCx`, context.ts header), as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { AddressSpace, Reg } from "../rustc_abi/lib.ts";
import type { TypeKind } from "../rustc_codegen_ssa/common.ts";
import type { BaseTypeCodegenMethods, LayoutTypeCodegenMethods, TypeMembershipCodegenMethods } from "../rustc_codegen_ssa/traits/type_.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { CastTarget, FnAbi } from "../rustc_target/callconv/mod.ts";
import type { Type, Value } from "./llvm/mod.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";
import { GenericCx } from "./context.ts";
import type { SCxBorrow } from "./context.ts";
import type { Debug } from "../std/fmt.ts";
import { GenericCx as GenericCx_ } from "./context.ts";

// impl fmt::Debug for Type
// Stub (cg-contract): <Type as Debug>::fmt (type_.rs:36)
export const debug_Type: Debug<Type> = (_self) => {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs fmt");
};
// `CodegenObject: Debug` of `Type` and `FunctionSignature` (both `&Type`), as `GenericCx` members (context.ts header).
Object.defineProperty(GenericCx_.prototype, "debug_Type", { get: () => debug_Type, configurable: true });
Object.defineProperty(GenericCx_.prototype, "debug_FunctionSignature", { get: () => debug_Type, configurable: true });

// ---- impl BaseTypeCodegenMethods for GenericCx (type_.rs:188) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    type_i8(): Type;
    type_i16(): Type;
    type_i32(): Type;
    type_i64(): Type;
    type_i128(): Type;
    type_isize(): Type;
    type_f16(): Type;
    type_f16b(): Type;
    type_f32(): Type;
    type_f64(): Type;
    type_f128(): Type;
    type_ppcf128(): Type;
    type_array(ty: Type, len: bigint): Type;
    type_func(args: readonly Type[], ret: Type): Type;
    type_kind(ty: Type): TypeKind;
    type_ptr(): Type;
    type_ptr_ext(address_space: AddressSpace): Type;
    element_type(ty: Type): Type;
    vector_length(ty: Type): number;
    float_width(ty: Type): number;
    int_width(ty: Type): number;
    val_ty(v: Value): Type;
  }
}

// Stub (cg-contract): BaseTypeCodegenMethods::type_i8
GenericCx.prototype.type_i8 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i8");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_i16
GenericCx.prototype.type_i16 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i16");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_i32
GenericCx.prototype.type_i32 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i32");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_i64
GenericCx.prototype.type_i64 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i64");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_i128
GenericCx.prototype.type_i128 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i128");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_isize
GenericCx.prototype.type_isize = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_isize");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_f16
GenericCx.prototype.type_f16 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_f16");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_f16b
GenericCx.prototype.type_f16b = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_f16b");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_f32
GenericCx.prototype.type_f32 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_f32");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_f64
GenericCx.prototype.type_f64 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_f64");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_f128
GenericCx.prototype.type_f128 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_f128");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_ppcf128
GenericCx.prototype.type_ppcf128 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_ppcf128");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_array
GenericCx.prototype.type_array = function (this: GenericCx<SCxBorrow>, _ty: Type, _len: bigint): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_array");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_func
GenericCx.prototype.type_func = function (this: GenericCx<SCxBorrow>, _args: readonly Type[], _ret: Type): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_func");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_kind
GenericCx.prototype.type_kind = function (this: GenericCx<SCxBorrow>, _ty: Type): TypeKind {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_kind");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_ptr
GenericCx.prototype.type_ptr = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_ptr");
};

// Stub (cg-contract): BaseTypeCodegenMethods::type_ptr_ext
GenericCx.prototype.type_ptr_ext = function (this: GenericCx<SCxBorrow>, _address_space: AddressSpace): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_ptr_ext");
};

// Stub (cg-contract): BaseTypeCodegenMethods::element_type
GenericCx.prototype.element_type = function (this: GenericCx<SCxBorrow>, _ty: Type): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs element_type");
};

// Stub (cg-contract): BaseTypeCodegenMethods::vector_length
GenericCx.prototype.vector_length = function (this: GenericCx<SCxBorrow>, _ty: Type): number {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs vector_length");
};

// Stub (cg-contract): BaseTypeCodegenMethods::float_width
GenericCx.prototype.float_width = function (this: GenericCx<SCxBorrow>, _ty: Type): number {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs float_width");
};

// Stub (cg-contract): BaseTypeCodegenMethods::int_width
GenericCx.prototype.int_width = function (this: GenericCx<SCxBorrow>, _ty: Type): number {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs int_width");
};

// Stub (cg-contract): BaseTypeCodegenMethods::val_ty
GenericCx.prototype.val_ty = function (this: GenericCx<SCxBorrow>, _v: Value): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs val_ty");
};

// ---- impl LayoutTypeCodegenMethods for CodegenCx (type_.rs:300) ----
declare module "./context.ts" {
  interface CodegenCx {
    backend_type(layout: TyAndLayout): Type;
    cast_backend_type(ty: CastTarget): Type;
    fn_decl_backend_type(fn_abi: FnAbi<Ty>): Type;
    fn_ptr_backend_type(fn_abi: FnAbi<Ty>): Type;
    reg_backend_type(ty: Reg): Type;
    immediate_backend_type(layout: TyAndLayout): Type;
    scalar_pair_element_backend_type(layout: TyAndLayout, index: number, immediate: boolean): Type;
  }
}

// Stub (cg-contract): LayoutTypeCodegenMethods::backend_type
CodegenCx.prototype.backend_type = function (this: CodegenCx, _layout: TyAndLayout): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::cast_backend_type
CodegenCx.prototype.cast_backend_type = function (this: CodegenCx, _ty: CastTarget): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs cast_backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::fn_decl_backend_type
CodegenCx.prototype.fn_decl_backend_type = function (this: CodegenCx, _fn_abi: FnAbi<Ty>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs fn_decl_backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::fn_ptr_backend_type
CodegenCx.prototype.fn_ptr_backend_type = function (this: CodegenCx, _fn_abi: FnAbi<Ty>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs fn_ptr_backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::reg_backend_type
CodegenCx.prototype.reg_backend_type = function (this: CodegenCx, _ty: Reg): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs reg_backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::immediate_backend_type
CodegenCx.prototype.immediate_backend_type = function (this: CodegenCx, _layout: TyAndLayout): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs immediate_backend_type");
};

// Stub (cg-contract): LayoutTypeCodegenMethods::scalar_pair_element_backend_type
CodegenCx.prototype.scalar_pair_element_backend_type = function (this: CodegenCx, _layout: TyAndLayout, _index: number, _immediate: boolean): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs scalar_pair_element_backend_type");
};

// ---- impl TypeMembershipCodegenMethods for CodegenCx (type_.rs:329) ----
declare module "./context.ts" {
  interface CodegenCx {
    add_type_metadata(function_: Value, typeid: Uint8Array): void;
    set_type_metadata(function_: Value, typeid: Uint8Array): void;
    add_kcfi_type_metadata(function_: Value, typeid: number): void;
    set_kcfi_type_metadata(function_: Value, typeid: number): void;
  }
}

// Stub (cg-contract): TypeMembershipCodegenMethods::add_type_metadata
CodegenCx.prototype.add_type_metadata = function (this: CodegenCx, _function_: Value, _typeid: Uint8Array): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs add_type_metadata");
};

// Stub (cg-contract): TypeMembershipCodegenMethods::set_type_metadata
CodegenCx.prototype.set_type_metadata = function (this: CodegenCx, _function_: Value, _typeid: Uint8Array): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs set_type_metadata");
};

// Stub (cg-contract): TypeMembershipCodegenMethods::add_kcfi_type_metadata
CodegenCx.prototype.add_kcfi_type_metadata = function (this: CodegenCx, _function_: Value, _typeid: number): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs add_kcfi_type_metadata");
};

// Stub (cg-contract): TypeMembershipCodegenMethods::set_kcfi_type_metadata
CodegenCx.prototype.set_kcfi_type_metadata = function (this: CodegenCx, _function_: Value, _typeid: number): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs set_kcfi_type_metadata");
};
