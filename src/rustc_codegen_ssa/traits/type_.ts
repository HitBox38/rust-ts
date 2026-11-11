// Port of compiler/rustc_codegen_ssa/src/traits/type_.rs (lane ssa-contract). Conventions: backend.ts's header.
//
// PORT (ssa-contract): `HasTyCtxt::tcx()` and `HasTypingEnv::typing_env()` are `tcx_()` / `typing_env_()` (rustc_middle
// ty/layout.ts, layout-contract). `type_array`'s `len: u64` is a `bigint` (any array length); `int_width`'s `u64` is a
// bit width and `vector_length`/`float_width` are `usize`, so those are `number` (PORTING §5).
import { type AddressSpace, type Float, type Integer, type Primitive, Scalar as abi_Scalar, type Reg } from "../../rustc_abi/lib.ts";
import type { HasTyCtxt, HasTypingEnv, TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { ArgAbi, CastTarget, FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import type { TypeKind } from "../common.ts";
import type { PlaceRef } from "../mir/place.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";
import type { MiscCodegenMethods } from "./misc.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/type_.rs:12 BaseTypeCodegenMethods
export interface BaseTypeCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:13 type_i8
  type_i8(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:14 type_i16
  type_i16(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:15 type_i32
  type_i32(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:16 type_i64
  type_i64(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:17 type_i128
  type_i128(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:18 type_isize
  type_isize(): B["Type"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:20 type_f16
  type_f16(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:21 type_f16b
  type_f16b(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:22 type_f32
  type_f32(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:23 type_f64
  type_f64(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:24 type_f128
  type_f128(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:25 type_ppcf128
  type_ppcf128(): B["Type"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:27 type_array
  type_array(ty: B["Type"], len: bigint): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:28 type_func
  type_func(args: readonly B["Type"][], ret: B["Type"]): B["FunctionSignature"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:29 type_kind
  type_kind(ty: B["Type"]): TypeKind;
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:30 type_ptr
  type_ptr(): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:31 type_ptr_ext
  type_ptr_ext(address_space: AddressSpace): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:32 element_type
  element_type(ty: B["Type"]): B["Type"];

  /// Returns the number of elements in `self` if it is an LLVM vector type.
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:35 vector_length
  vector_length(ty: B["Type"]): number;

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:37 float_width
  float_width(ty: B["Type"]): number;

  /// Retrieves the bit width of the integer type `self`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:40 int_width
  int_width(ty: B["Type"]): number;

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:42 val_ty
  val_ty(v: B["Value"]): B["Type"];
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/type_.rs:45 DerivedTypeCodegenMethods
export interface DerivedTypeCodegenMethods<B extends BackendTypes>
  extends BaseTypeCodegenMethods<B>, MiscCodegenMethods<B>, HasTyCtxt, HasTypingEnv {
  // (provided) traits/type_.rs:48 type_int -> DerivedTypeCodegenMethods_provided.type_int
  type_int(): B["Type"];
  // (provided) traits/type_.rs:57 type_from_integer -> DerivedTypeCodegenMethods_provided.type_from_integer
  type_from_integer(i: Integer): B["Type"];
  // (provided) traits/type_.rs:68 type_from_float -> DerivedTypeCodegenMethods_provided.type_from_float
  type_from_float(f: Float): B["Type"];
  // (provided) traits/type_.rs:80 type_needs_drop -> DerivedTypeCodegenMethods_provided.type_needs_drop
  type_needs_drop(ty: Ty): boolean;
  // (provided) traits/type_.rs:84 type_is_sized -> DerivedTypeCodegenMethods_provided.type_is_sized
  type_is_sized(ty: Ty): boolean;
  // (provided) traits/type_.rs:88 type_is_freeze -> DerivedTypeCodegenMethods_provided.type_is_freeze
  type_is_freeze(ty: Ty): boolean;
  // (provided) traits/type_.rs:92 type_from_primitive -> DerivedTypeCodegenMethods_provided.type_from_primitive
  type_from_primitive(p: Primitive): B["Type"];
  // (provided) traits/type_.rs:101 type_from_scalar -> DerivedTypeCodegenMethods_provided.type_from_scalar
  type_from_scalar(s: abi_Scalar): B["Type"];
}

/** The provided methods of `DerivedTypeCodegenMethods` (PORTING §8; `self` first). All of the trait's methods are
 *  provided, and the blanket `impl<'tcx, T> DerivedTypeCodegenMethods<'tcx> for T where Self: BaseTypeCodegenMethods +
 *  MiscCodegenMethods<'tcx> + HasTyCtxt<'tcx> + HasTypingEnv<'tcx>` (type_.rs:111) gives them to every such type: an
 *  implementing class forwards each member here. */
export const DerivedTypeCodegenMethods_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:48 type_int
  type_int<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>): B["Type"] {
    const width = self.sess().target.c_int_width;
    switch (width) {
      case 16:
        return self.type_i16();
      case 32:
        return self.type_i32();
      case 64:
        return self.type_i64();
      default:
        return bug(`Unsupported c_int_width: ${width}`);
    }
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:57 type_from_integer
  type_from_integer<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, i: Integer): B["Type"] {
    // use Integer::*;
    switch (i) {
      case "I8":
        return self.type_i8();
      case "I16":
        return self.type_i16();
      case "I32":
        return self.type_i32();
      case "I64":
        return self.type_i64();
      case "I128":
        return self.type_i128();
    }
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:68 type_from_float
  type_from_float<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, f: Float): B["Type"] {
    // use Float::*;
    switch (f) {
      case "F16":
        return self.type_f16();
      case "F16B":
        return self.type_f16b();
      case "F32":
        return self.type_f32();
      case "F64":
        return self.type_f64();
      case "F128":
        return self.type_f128();
      case "PpcF128":
        return self.type_ppcf128();
    }
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:80 type_needs_drop
  type_needs_drop<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, ty: Ty): boolean {
    return ty.needs_drop(self.tcx_(), self.typing_env_());
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:84 type_is_sized
  type_is_sized<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, ty: Ty): boolean {
    return ty.is_sized(self.tcx_(), self.typing_env_());
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:88 type_is_freeze
  type_is_freeze<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, ty: Ty): boolean {
    return ty.is_freeze(self.tcx_(), self.typing_env_());
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:92 type_from_primitive
  type_from_primitive<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, p: Primitive): B["Type"] {
    // use Primitive::*;
    switch (p.$) {
      case "Int":
        return self.type_from_integer(p._0);
      case "Float":
        return self.type_from_float(p._0);
      case "Pointer":
        return self.type_ptr_ext(p._0);
    }
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:101 type_from_scalar
  type_from_scalar<B extends BackendTypes>(self: DerivedTypeCodegenMethods<B>, s: abi_Scalar): B["Type"] {
    // `MaybeUninit` being `repr(transparent)` somewhat implies that the type
    // of a scalar has to be the type of its primitive (which is true in LLVM,
    // where noundef is a parameter attribute or metadata) but if we ever get
    // a backend where that's no longer true, every use of this will need to
    // to carefully scrutinized and re-evaluated.
    return self.type_from_primitive(abi_Scalar.primitive(s));
  },
};

// impl<'tcx, T> DerivedTypeCodegenMethods<'tcx> for T where
//     Self: BaseTypeCodegenMethods + MiscCodegenMethods<'tcx> + HasTyCtxt<'tcx> + HasTypingEnv<'tcx>
// {
// }

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/type_.rs:116 LayoutTypeCodegenMethods
export interface LayoutTypeCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  /// The backend type used for a rust type when it's in memory,
  /// such as when it's stack-allocated or when it's being loaded or stored.
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:119 backend_type
  backend_type(layout: TyAndLayout): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:120 cast_backend_type
  cast_backend_type(ty: CastTarget): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:121 fn_decl_backend_type
  fn_decl_backend_type(fn_abi: FnAbi<Ty>): B["FunctionSignature"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:122 fn_ptr_backend_type
  fn_ptr_backend_type(fn_abi: FnAbi<Ty>): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:123 reg_backend_type
  reg_backend_type(ty: Reg): B["Type"];
  /// The backend type used for a rust type when it's in an SSA register.
  ///
  /// For nearly all types this is the same as the [`Self::backend_type`], however
  /// `bool` (and other `0`-or-`1` values) are kept as `i1` in registers but as
  /// [`BaseTypeCodegenMethods::type_i8`] in memory.
  ///
  /// Converting values between the two different backend types is done using
  /// [`from_immediate`](super::BuilderMethods::from_immediate) and
  /// [`to_immediate_scalar`](super::BuilderMethods::to_immediate_scalar).
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:133 immediate_backend_type
  immediate_backend_type(layout: TyAndLayout): B["Type"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:134 scalar_pair_element_backend_type
  scalar_pair_element_backend_type(layout: TyAndLayout, index: number, immediate: boolean): B["Type"];
}

// For backends that support CFI using type membership (i.e., testing whether a given pointer is
// associated with a type identifier).
// rustc-trait: compiler/rustc_codegen_ssa/src/traits/type_.rs:144 TypeMembershipCodegenMethods
export interface TypeMembershipCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // (provided) traits/type_.rs:145 add_type_metadata -> TypeMembershipCodegenMethods_provided.add_type_metadata
  add_type_metadata(function_: B["Function"], typeid: Uint8Array): void;
  // (provided) traits/type_.rs:146 set_type_metadata -> TypeMembershipCodegenMethods_provided.set_type_metadata
  set_type_metadata(function_: B["Function"], typeid: Uint8Array): void;
  // (provided) traits/type_.rs:147 add_kcfi_type_metadata -> TypeMembershipCodegenMethods_provided.add_kcfi_type_metadata
  add_kcfi_type_metadata(function_: B["Function"], typeid: number): void;
  // (provided) traits/type_.rs:148 set_kcfi_type_metadata -> TypeMembershipCodegenMethods_provided.set_kcfi_type_metadata
  set_kcfi_type_metadata(function_: B["Function"], typeid: number): void;
}

/** The provided methods of `TypeMembershipCodegenMethods` (PORTING §8; `self` first). */
export const TypeMembershipCodegenMethods_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:145 add_type_metadata
  add_type_metadata<B extends BackendTypes>(_self: TypeMembershipCodegenMethods<B>, _function: B["Function"], _typeid: Uint8Array): void {},
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:146 set_type_metadata
  set_type_metadata<B extends BackendTypes>(_self: TypeMembershipCodegenMethods<B>, _function: B["Function"], _typeid: Uint8Array): void {},
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:147 add_kcfi_type_metadata
  add_kcfi_type_metadata<B extends BackendTypes>(_self: TypeMembershipCodegenMethods<B>, _function: B["Function"], _typeid: number): void {},
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:148 set_kcfi_type_metadata
  set_kcfi_type_metadata<B extends BackendTypes>(_self: TypeMembershipCodegenMethods<B>, _function: B["Function"], _typeid: number): void {},
};

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/type_.rs:151 ArgAbiBuilderMethods
export interface ArgAbiBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:152 store_fn_arg
  store_fn_arg(arg_abi: ArgAbi<Ty>, idx: MutRef<number>, dst: PlaceRef<B["Value"]>): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/type_.rs:158 store_arg
  store_arg(arg_abi: ArgAbi<Ty>, val: B["Value"], dst: PlaceRef<B["Value"]>): void;
}

/** `pub trait TypeCodegenMethods<'tcx> = DerivedTypeCodegenMethods<'tcx> + LayoutTypeCodegenMethods<'tcx> +
 *  TypeMembershipCodegenMethods<'tcx>;` (a trait alias: no fns). */
export interface TypeCodegenMethods<B extends BackendTypes>
  extends DerivedTypeCodegenMethods<B>, LayoutTypeCodegenMethods<B>, TypeMembershipCodegenMethods<B> {}
