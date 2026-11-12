// Port of compiler/rustc_codegen_llvm/src/type_.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// The impls on `GenericCx` / `CodegenCx` (inherent, `BaseTypeCodegenMethods`, `LayoutTypeCodegenMethods`,
// `TypeMembershipCodegenMethods`) are attached with PORTING §5's extension pattern: a `declare module "./context.ts"`
// augmentation plus prototype assignments, in upstream order (lib.ts imports this file after the class's own module).
// `impl fmt::Debug for Type` is `debug_Type`, also reached as the `debug_Type` / `debug_FunctionSignature` members of
// `GenericCx` (context.ts header).
//
// PORT (cg-types-attrs):
// - `&[&'ll Type]` + `len() as c_uint` is the array and its `length` (an element count, never a UTF-8 length).
// - `SmallCStr::new(name)` is the string itself: the IR model's `Name: string` parameters take it as is.
// - `Vec::with_capacity(n)` + an out-pointer fill + `set_len(n)` is an empty array the model fills.
import { type AddressSpace, type Align, AddressSpace as AddressSpace_, Integer, type Reg, type Size } from "../rustc_abi/lib.ts";
import type { TypeKind } from "../rustc_codegen_ssa/common.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { CastTarget, FnAbi } from "../rustc_target/callconv/mod.ts";
import * as llvm from "./llvm/mod.ts";
import type { Context, Type, Value } from "./llvm/mod.ts";
import type { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { assert_eq, unported } from "../std/panic.ts";
import { bug } from "../rustc_span/macros.ts";
import { expect_result } from "../std/result.ts";
import { CodegenCx } from "./context.ts";
import { GenericCx } from "./context.ts";
import type { SCxBorrow } from "./context.ts";
import type { Debug } from "../std/fmt.ts";
import { debug_TypeKind } from "../rustc_codegen_ssa/common.ts";
import { PLAIN } from "../std/fmt.ts";
import * as common from "./common.ts";

// impl PartialEq for Type
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:22 eq
export function Type_eq(self: Type, other: Type): boolean {
  // ptr::eq(self, other)
  return self === other;
}

// impl Eq for Type {}

// impl Hash for Type
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:30 hash
export function hash_Type(_self: Type, /** `&mut H` (`H: Hasher`) */ _state: unknown): void {
  // ptr::hash(self, state);
  // PORT: a pointer address has no TS form, and nothing hashes a `Type` (maps key on the object; value.ts's `Hash for Value`).
  return unported("rustc_codegen_llvm::type_::<Type as Hash>::hash (pointer address)");
}

// impl fmt::Debug for Type
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:36 fmt
export const debug_Type: Debug<Type> = (self) => {
  return expect_result(
    llvm.build_string((s) => {
      llvm.LLVMRustWriteTypeToString(self, s);
    }),
    "non-UTF8 type description from LLVM",
    llvm.debug_FromUtf8Error,
  );
};
// `CodegenObject: Debug` of `Type` and `FunctionSignature` (both `&Type`), as `GenericCx` members (context.ts header).
Object.defineProperty(GenericCx.prototype, "debug_Type", { get: () => debug_Type, configurable: true });
Object.defineProperty(GenericCx.prototype, "debug_FunctionSignature", { get: () => debug_Type, configurable: true });

// impl<'ll> CodegenCx<'ll, '_> {}

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (type_.rs:47) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    type_named_struct(name: string): Type;
    set_struct_body(ty: Type, els: readonly Type[], packed: boolean): void;
    type_void(): Type;
    type_ix(num_bits: number): Type;
    type_vector(ty: Type, count: number): Type;
    type_scalable_vector(ty: Type, count: number): Type;
    add_func(name: string, ty: Type): Value;
    get_return_type(ty: Type): Type;
    func_params_types(ty: Type): Type[];
    func_is_variadic(ty: Type): boolean;
    struct_element_types(ty: Type): Type[];
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:48 type_named_struct
GenericCx.prototype.type_named_struct = function (this: GenericCx<SCxBorrow>, name: string): Type {
  // let name = SmallCStr::new(name);
  return llvm.LLVMStructCreateNamed(this.llcx(), name);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:53 set_struct_body
GenericCx.prototype.set_struct_body = function (this: GenericCx<SCxBorrow>, ty: Type, els: readonly Type[], packed: boolean): void {
  llvm.LLVMStructSetBody(ty, els, els.length, llvm.to_llvm_bool(packed));
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:58 type_void
GenericCx.prototype.type_void = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMVoidTypeInContext(this.llcx());
};

///x Creates an integer type with the given number of bits, e.g., i24
/** `num_bits: u64`, a bit width: a `number`. */
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:63 type_ix
GenericCx.prototype.type_ix = function (this: GenericCx<SCxBorrow>, num_bits: number): Type {
  // `num_bits as c_uint`
  return llvm.LLVMIntTypeInContext(this.llcx(), num_bits >>> 0);
};

/** `count: u64`, a lane count: a `number` (as `vector_length`). */
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:67 type_vector
GenericCx.prototype.type_vector = function (this: GenericCx<SCxBorrow>, ty: Type, count: number): Type {
  return llvm.LLVMVectorType(ty, count >>> 0);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:71 type_scalable_vector
GenericCx.prototype.type_scalable_vector = function (this: GenericCx<SCxBorrow>, ty: Type, count: number): Type {
  return llvm.LLVMScalableVectorType(ty, count >>> 0);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:75 add_func
GenericCx.prototype.add_func = function (this: GenericCx<SCxBorrow>, name: string, ty: Type): Value {
  // let name = SmallCStr::new(name);
  return llvm.LLVMAddFunction(this.llmod(), name, ty);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:80 get_return_type
GenericCx.prototype.get_return_type = function (this: GenericCx<SCxBorrow>, ty: Type): Type {
  return llvm.LLVMGetReturnType(ty);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:84 func_params_types
GenericCx.prototype.func_params_types = function (this: GenericCx<SCxBorrow>, ty: Type): Type[] {
  const n_args = llvm.LLVMCountParamTypes(ty);
  // let mut args = Vec::with_capacity(n_args);
  const args: Type[] = [];
  llvm.LLVMGetParamTypes(ty, args);
  // args.set_len(n_args);
  args.length = n_args;
  return args;
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:94 func_is_variadic
GenericCx.prototype.func_is_variadic = function (this: GenericCx<SCxBorrow>, ty: Type): boolean {
  return llvm.LLVMIsFunctionVarArg(ty).is_true();
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:98 struct_element_types
GenericCx.prototype.struct_element_types = function (this: GenericCx<SCxBorrow>, ty: Type): Type[] {
  const n_args = llvm.LLVMCountStructElementTypes(ty);
  // let mut args = Vec::with_capacity(n_args);
  const args: Type[] = [];
  llvm.LLVMGetStructElementTypes(ty, args);
  // args.set_len(n_args);
  args.length = n_args;
  return args;
};

// ---- impl<'ll, 'tcx> CodegenCx<'ll, 'tcx> (type_.rs:108) ----
declare module "./context.ts" {
  interface CodegenCx {
    type_int_from_ty(t: IntTy): Type;
    type_uint_from_ty(t: UintTy): Type;
    type_float_from_ty(t: FloatTy): Type;
    type_padding_filler(size: Size, align: Align): Type;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:109 type_int_from_ty
CodegenCx.prototype.type_int_from_ty = function (this: CodegenCx, t: IntTy): Type {
  switch (t) {
    case "Isize":
      return this.type_isize();
    case "I8":
      return this.type_i8();
    case "I16":
      return this.type_i16();
    case "I32":
      return this.type_i32();
    case "I64":
      return this.type_i64();
    case "I128":
      return this.type_i128();
  }
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:120 type_uint_from_ty
CodegenCx.prototype.type_uint_from_ty = function (this: CodegenCx, t: UintTy): Type {
  switch (t) {
    case "Usize":
      return this.type_isize();
    case "U8":
      return this.type_i8();
    case "U16":
      return this.type_i16();
    case "U32":
      return this.type_i32();
    case "U64":
      return this.type_i64();
    case "U128":
      return this.type_i128();
  }
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:131 type_float_from_ty
CodegenCx.prototype.type_float_from_ty = function (this: CodegenCx, t: FloatTy): Type {
  switch (t) {
    case "F16":
      return this.type_f16();
    case "F32":
      return this.type_f32();
    case "F64":
      return this.type_f64();
    case "F128":
      return this.type_f128();
  }
};

/// Return an LLVM type that has at most the required alignment,
/// and exactly the required size, as a best-effort padding array.
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:142 type_padding_filler
CodegenCx.prototype.type_padding_filler = function (this: CodegenCx, size: Size, align: Align): Type {
  const unit = Integer.approximate_align(this, align);
  const size_ = size.bytes();
  const unit_size = Integer.size(unit).bytes();
  assert_eq(size_ % unit_size, 0, String);
  // PORT: `size / unit_size` (`u64`, exact: asserted above) as the `u64` element count `type_array` takes.
  return this.type_array(this.type_from_integer(unit), BigInt(size_ / unit_size));
};

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (type_.rs:151) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    llcx(): Context;
    llmod(): llvm.Module;
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
GenericCx.prototype.llmod = function (this: GenericCx<SCxBorrow>): llvm.Module {
  return this.deref().borrow().llmod;
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:160 isize_ty
GenericCx.prototype.isize_ty = function (this: GenericCx<SCxBorrow>): Type {
  return this.deref().borrow().isize_ty;
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:164 type_variadic_func
GenericCx.prototype.type_variadic_func = function (this: GenericCx<SCxBorrow>, args: readonly Type[], ret: Type): Type {
  return llvm.LLVMFunctionType(ret, args, args.length, llvm.TRUE);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:168 type_i1
GenericCx.prototype.type_i1 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMInt1TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:172 type_struct
GenericCx.prototype.type_struct = function (this: GenericCx<SCxBorrow>, els: readonly Type[], packed: boolean): Type {
  return llvm.LLVMStructTypeInContext(this.llcx(), els, els.length, llvm.to_llvm_bool(packed));
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:183 type_bf16
GenericCx.prototype.type_bf16 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMBFloatTypeInContext(this.llcx());
};

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> BaseTypeCodegenMethods for GenericCx<'ll, CX> (type_.rs:188) ----
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
    type_func(args: readonly Type[], ret: Type): Type;
    type_kind(ty: Type): TypeKind;
    type_ptr(): Type;
    type_ptr_ext(address_space: AddressSpace): Type;
    element_type(ty: Type): Type;
    vector_length(ty: Type): number;
    float_width(ty: Type): number;
    int_width(ty: Type): number;
    val_ty(v: Value): Type;
    type_array(ty: Type, len: bigint): Type;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:189 type_i8
GenericCx.prototype.type_i8 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMInt8TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:193 type_i16
GenericCx.prototype.type_i16 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMInt16TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:197 type_i32
GenericCx.prototype.type_i32 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMInt32TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:201 type_i64
GenericCx.prototype.type_i64 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMInt64TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:205 type_i128
GenericCx.prototype.type_i128 = function (this: GenericCx<SCxBorrow>): Type {
  return this.type_ix(128);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:209 type_isize
GenericCx.prototype.type_isize = function (this: GenericCx<SCxBorrow>): Type {
  return this.isize_ty();
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:213 type_f16
GenericCx.prototype.type_f16 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMHalfTypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:217 type_f16b
GenericCx.prototype.type_f16b = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMBFloatTypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:221 type_f32
GenericCx.prototype.type_f32 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMFloatTypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:225 type_f64
GenericCx.prototype.type_f64 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMDoubleTypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:229 type_f128
GenericCx.prototype.type_f128 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMFP128TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:233 type_ppcf128
GenericCx.prototype.type_ppcf128 = function (this: GenericCx<SCxBorrow>): Type {
  return llvm.LLVMPPCFP128TypeInContext(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:237 type_func
GenericCx.prototype.type_func = function (this: GenericCx<SCxBorrow>, args: readonly Type[], ret: Type): Type {
  return llvm.LLVMFunctionType(ret, args, args.length, llvm.FALSE);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:241 type_kind
GenericCx.prototype.type_kind = function (this: GenericCx<SCxBorrow>, ty: Type): TypeKind {
  return llvm.ToGeneric_for_TypeKind.to_generic(llvm.LLVMGetTypeKind(ty).to_rust());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:245 type_ptr
GenericCx.prototype.type_ptr = function (this: GenericCx<SCxBorrow>): Type {
  return llvm_type_ptr(this.llcx());
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:249 type_ptr_ext
GenericCx.prototype.type_ptr_ext = function (this: GenericCx<SCxBorrow>, address_space: AddressSpace): Type {
  return llvm_type_ptr_in_address_space(this.llcx(), address_space);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:253 element_type
GenericCx.prototype.element_type = function (this: GenericCx<SCxBorrow>, ty: Type): Type {
  const other = this.type_kind(ty);
  switch (other) {
    case "Array":
    case "Vector":
      return llvm.LLVMGetElementType(ty);
    case "Pointer":
      return bug("element_type is not supported for opaque pointers");
    default:
      return bug(`element_type called on unsupported type ${debug_TypeKind(other, PLAIN)}`);
  }
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:261 vector_length
GenericCx.prototype.vector_length = function (this: GenericCx<SCxBorrow>, ty: Type): number {
  return llvm.LLVMGetVectorSize(ty);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:265 float_width
GenericCx.prototype.float_width = function (this: GenericCx<SCxBorrow>, ty: Type): number {
  const other = this.type_kind(ty);
  switch (other) {
    case "Half":
      return 16;
    case "Float":
      return 32;
    case "Double":
      return 64;
    case "X86_FP80":
      return 80;
    case "FP128":
    case "PPC_FP128":
      return 128;
    default:
      return bug(`llvm_float_width called on a non-float type ${debug_TypeKind(other, PLAIN)}`);
  }
};

/** `-> u64`, a bit width: a `number`. */
// rustc: compiler/rustc_codegen_llvm/src/type_.rs:276 int_width
GenericCx.prototype.int_width = function (this: GenericCx<SCxBorrow>, ty: Type): number {
  return llvm.LLVMGetIntTypeWidth(ty);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:280 val_ty
GenericCx.prototype.val_ty = function (this: GenericCx<SCxBorrow>, v: Value): Type {
  return common.val_ty(v);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:284 type_array
GenericCx.prototype.type_array = function (this: GenericCx<SCxBorrow>, ty: Type, len: bigint): Type {
  return llvm.LLVMArrayType2(ty, len);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:289 llvm_type_ptr
export function llvm_type_ptr(llcx: Context): Type {
  return llvm_type_ptr_in_address_space(llcx, AddressSpace_.ZERO);
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:293 llvm_type_ptr_in_address_space
export function llvm_type_ptr_in_address_space(llcx: Context, addr_space: AddressSpace): Type {
  // `addr_space.0`: `AddressSpace` is a branded number.
  return llvm.LLVMPointerTypeInContext(llcx, addr_space);
}

// ---- impl<'ll, 'tcx> LayoutTypeCodegenMethods<'tcx> for CodegenCx<'ll, 'tcx> (type_.rs:300) ----
declare module "./context.ts" {
  interface CodegenCx {
    backend_type(layout: TyAndLayout): Type;
    immediate_backend_type(layout: TyAndLayout): Type;
    scalar_pair_element_backend_type(layout: TyAndLayout, index: number, immediate: boolean): Type;
    cast_backend_type(ty: CastTarget): Type;
    fn_decl_backend_type(fn_abi: FnAbi<Ty>): Type;
    fn_ptr_backend_type(fn_abi: FnAbi<Ty>): Type;
    reg_backend_type(ty: Reg): Type;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:301 backend_type
CodegenCx.prototype.backend_type = function (this: CodegenCx, layout: TyAndLayout): Type {
  return layout.llvm_type(this);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:304 immediate_backend_type
CodegenCx.prototype.immediate_backend_type = function (this: CodegenCx, layout: TyAndLayout): Type {
  return layout.immediate_llvm_type(this);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:307 scalar_pair_element_backend_type
CodegenCx.prototype.scalar_pair_element_backend_type = function (this: CodegenCx, layout: TyAndLayout, index: number, immediate: boolean): Type {
  return layout.scalar_pair_element_llvm_type(this, index, immediate);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:315 cast_backend_type
CodegenCx.prototype.cast_backend_type = function (this: CodegenCx, ty: CastTarget): Type {
  return ty.llvm_type(this);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:318 fn_decl_backend_type
CodegenCx.prototype.fn_decl_backend_type = function (this: CodegenCx, fn_abi: FnAbi<Ty>): Type {
  return fn_abi.llvm_type(this);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:321 fn_ptr_backend_type
CodegenCx.prototype.fn_ptr_backend_type = function (this: CodegenCx, fn_abi: FnAbi<Ty>): Type {
  return fn_abi.ptr_to_llvm_type(this);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:324 reg_backend_type
CodegenCx.prototype.reg_backend_type = function (this: CodegenCx, ty: Reg): Type {
  return ty.llvm_type(this);
};

// ---- impl<'ll, 'tcx> TypeMembershipCodegenMethods<'tcx> for CodegenCx<'ll, 'tcx> (type_.rs:329) ----
declare module "./context.ts" {
  interface CodegenCx {
    add_type_metadata(function_: Value, typeid: Uint8Array): void;
    set_type_metadata(function_: Value, typeid: Uint8Array): void;
    add_kcfi_type_metadata(function_: Value, typeid: number): void;
    set_kcfi_type_metadata(function_: Value, typeid: number): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:330 add_type_metadata
CodegenCx.prototype.add_type_metadata = function (this: CodegenCx, function_: Value, typeid: Uint8Array): void {
  const typeid_metadata = this.create_metadata(typeid);
  const v = [llvm.LLVMValueAsMetadata(this.const_usize(0n)), typeid_metadata];
  this.global_add_metadata_node(function_, llvm.MD_type, v);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:336 set_type_metadata
CodegenCx.prototype.set_type_metadata = function (this: CodegenCx, function_: Value, typeid: Uint8Array): void {
  const typeid_metadata = this.create_metadata(typeid);
  const v = [llvm.LLVMValueAsMetadata(this.const_usize(0n)), typeid_metadata];
  this.global_set_metadata_node(function_, llvm.MD_type, v);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:342 add_kcfi_type_metadata
CodegenCx.prototype.add_kcfi_type_metadata = function (this: CodegenCx, function_: Value, kcfi_typeid: number): void {
  const kcfi_type_metadata = [llvm.LLVMValueAsMetadata(this.const_u32(kcfi_typeid))];
  this.global_add_metadata_node(function_, llvm.MD_kcfi_type, kcfi_type_metadata);
};

// rustc: compiler/rustc_codegen_llvm/src/type_.rs:347 set_kcfi_type_metadata
CodegenCx.prototype.set_kcfi_type_metadata = function (this: CodegenCx, function_: Value, kcfi_typeid: number): void {
  const kcfi_type_metadata = [llvm.LLVMValueAsMetadata(this.const_u32(kcfi_typeid))];
  this.global_set_metadata_node(function_, llvm.MD_kcfi_type, kcfi_type_metadata);
};
