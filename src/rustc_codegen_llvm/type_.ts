// compiler/rustc_codegen_llvm/src/type_.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave 41) owns this file and ports
// type_.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the inherent fns other lanes call (review F2; `llcx`, `llmod`, `isize_ty` ported), `impl BaseTypeCodegenMethods for GenericCx`, `impl LayoutTypeCodegenMethods for CodegenCx` and `impl
// TypeMembershipCodegenMethods for CodegenCx`, and `impl fmt::Debug for Type` (the `debug_Type` / `debug_FunctionSignature`
// members of `GenericCx`, context.ts header), as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { AddressSpace, Reg } from "../rustc_abi/lib.ts";
import type { TypeKind } from "../rustc_codegen_ssa/common.ts";
import type { BaseTypeCodegenMethods, LayoutTypeCodegenMethods, TypeMembershipCodegenMethods } from "../rustc_codegen_ssa/traits/type_.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { CastTarget, FnAbi } from "../rustc_target/callconv/mod.ts";
import type { Context, Module, Type, Value } from "./llvm/mod.ts";
import type { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";
import { GenericCx } from "./context.ts";
import type { SCxBorrow } from "./context.ts";
import type { Debug } from "../std/fmt.ts";

// impl fmt::Debug for Type
// Stub (cg-contract): <Type as Debug>::fmt (type_.rs:36)
export const debug_Type: Debug<Type> = (_self) => {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs fmt");
};
// `CodegenObject: Debug` of `Type` and `FunctionSignature` (both `&Type`), as `GenericCx` members (context.ts header).
Object.defineProperty(GenericCx.prototype, "debug_Type", { get: () => debug_Type, configurable: true });
Object.defineProperty(GenericCx.prototype, "debug_FunctionSignature", { get: () => debug_Type, configurable: true });

// ---- impl GenericCx (type_.rs:47): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    type_named_struct(name: string): Type;
    set_struct_body(ty: Type, els: readonly Type[], packed: boolean): void;
    type_void(): Type;
    type_ix(num_bits: number): Type;
    type_vector(ty: Type, count: number): Type;
    get_return_type(ty: Type): Type;
    func_params_types(ty: Type): Type[];
    func_is_variadic(ty: Type): boolean;
    struct_element_types(ty: Type): Type[];
  }
}

// Stub (cg-contract): type_named_struct (type_.rs:48)
GenericCx.prototype.type_named_struct = function (this: GenericCx<SCxBorrow>, _name: string): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_named_struct");
};

// Stub (cg-contract): set_struct_body (type_.rs:53)
GenericCx.prototype.set_struct_body = function (this: GenericCx<SCxBorrow>, _ty: Type, _els: readonly Type[], _packed: boolean): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs set_struct_body");
};

// Stub (cg-contract): type_void (type_.rs:58)
GenericCx.prototype.type_void = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_void");
};

/** x Creates an integer type with the given number of bits, e.g., i24. `num_bits: u64`, a bit width: a `number`. */
// Stub (cg-contract): type_ix (type_.rs:63)
GenericCx.prototype.type_ix = function (this: GenericCx<SCxBorrow>, _num_bits: number): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_ix");
};

/** `count: u64`, a lane count: a `number` (as `vector_length`). */
// Stub (cg-contract): type_vector (type_.rs:67)
GenericCx.prototype.type_vector = function (this: GenericCx<SCxBorrow>, _ty: Type, _count: number): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_vector");
};

// Stub (cg-contract): get_return_type (type_.rs:80)
GenericCx.prototype.get_return_type = function (this: GenericCx<SCxBorrow>, _ty: Type): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs get_return_type");
};

// Stub (cg-contract): func_params_types (type_.rs:84)
GenericCx.prototype.func_params_types = function (this: GenericCx<SCxBorrow>, _ty: Type): Type[] {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs func_params_types");
};

// Stub (cg-contract): func_is_variadic (type_.rs:94)
GenericCx.prototype.func_is_variadic = function (this: GenericCx<SCxBorrow>, _ty: Type): boolean {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs func_is_variadic");
};

// Stub (cg-contract): struct_element_types (type_.rs:98)
GenericCx.prototype.struct_element_types = function (this: GenericCx<SCxBorrow>, _ty: Type): Type[] {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs struct_element_types");
};

// ---- impl CodegenCx (type_.rs:108): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface CodegenCx {
    type_int_from_ty(t: IntTy): Type;
    type_uint_from_ty(t: UintTy): Type;
    type_float_from_ty(t: FloatTy): Type;
  }
}

// Stub (cg-contract): type_int_from_ty (type_.rs:109)
CodegenCx.prototype.type_int_from_ty = function (this: CodegenCx, _t: IntTy): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_int_from_ty");
};

// Stub (cg-contract): type_uint_from_ty (type_.rs:120)
CodegenCx.prototype.type_uint_from_ty = function (this: CodegenCx, _t: UintTy): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_uint_from_ty");
};

// Stub (cg-contract): type_float_from_ty (type_.rs:131)
CodegenCx.prototype.type_float_from_ty = function (this: CodegenCx, _t: FloatTy): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_float_from_ty");
};

// ---- impl GenericCx (type_.rs:151): `llcx` / `llmod` / `isize_ty` ported (`(**self).borrow().x`); Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    llcx(): Context;
    llmod(): Module;
    isize_ty(): Type;
    type_variadic_func(args: readonly Type[], ret: Type): Type;
    type_i1(): Type;
    type_struct(els: readonly Type[], packed: boolean): Type;
    type_bf16(): Type;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:152 llcx
GenericCx.prototype.llcx = function (this: GenericCx<SCxBorrow>): Context {
  return this.deref().borrow().llcx;
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:156 llmod
GenericCx.prototype.llmod = function (this: GenericCx<SCxBorrow>): Module {
  return this.deref().borrow().llmod;
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:160 isize_ty
GenericCx.prototype.isize_ty = function (this: GenericCx<SCxBorrow>): Type {
  return this.deref().borrow().isize_ty;
};

// Stub (cg-contract): type_variadic_func (type_.rs:164)
GenericCx.prototype.type_variadic_func = function (this: GenericCx<SCxBorrow>, _args: readonly Type[], _ret: Type): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_variadic_func");
};

// Stub (cg-contract): type_i1 (type_.rs:168)
GenericCx.prototype.type_i1 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i1");
};

// Stub (cg-contract): type_struct (type_.rs:172)
GenericCx.prototype.type_struct = function (this: GenericCx<SCxBorrow>, _els: readonly Type[], _packed: boolean): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_struct");
};

// Stub (cg-contract): type_bf16 (type_.rs:183)
GenericCx.prototype.type_bf16 = function (this: GenericCx<SCxBorrow>): Type {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_bf16");
};

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
