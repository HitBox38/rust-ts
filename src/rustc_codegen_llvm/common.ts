// compiler/rustc_codegen_llvm/src/common.rs: the SKELETON (lane cg-contract). The fill lane cg-context (plan-m7 §8 wave 41)
// owns this file and ports the rest of common.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the inherent and free fns other fill lanes call (review F2), `impl BackendTypes for GenericCx` as the type record `LlvmTypes` (ssa-contract decision 1), the struct
// `Funclet` (its accessors ported, `new` a stub), and `impl ConstCodegenMethods for CodegenCx` as typed stubs attached to
// `CodegenCx.prototype` (PORTING §5's extension pattern; lib.ts imports this file after context.ts).
import type { Scalar as abi_Scalar, Size } from "../rustc_abi/lib.ts";
import type { Scalar } from "../rustc_middle/mir/interpret/value.ts";
import type { BackendTypes } from "../rustc_codegen_ssa/traits/backend.ts";
import { ConstCodegenMethods_provided } from "../rustc_codegen_ssa/traits/consts.ts";
import type { PointerAuthSchema } from "../rustc_session/session.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx, GenericCx, type SCxBorrow } from "./context.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { DllImport } from "../rustc_crate_store/cstore.gen.ts";
import type { BasicBlock, DILocation, DIScope, DIVariable, OperandBundle, OperandBundleBox, Type, Value } from "./llvm/mod.ts";

/// A structure representing an active landing pad for the duration of a basic
/// block.
///
/// Each `Block` may contain an instance of this, indicating whether the block
/// is part of a landing pad or not. This is used to make decision about whether
/// to emit `invoke` instructions (e.g., in a landing pad we don't continue to
/// use `invoke`) and also about various function call metadata.
///
/// For GNU exceptions (`landingpad` + `resume` instructions) this structure is
/// just a bunch of `None` instances (not too interesting), but for MSVC
/// exceptions (`cleanuppad` + `cleanupret` instructions) this contains data.
/// When inside of a landing pad, each function call in LLVM IR needs to be
/// annotated with which landing pad it's a part of. This is accomplished via
/// the `OperandBundleDef` value created for MSVC landing pads.
export class Funclet {
  constructor(
    /** private */
    public cleanuppad_: Value,
    /** private */
    public operand: OperandBundleBox,
  ) {}

  // PORT (cg-contract): the field `cleanuppad` is `cleanuppad_`: the method `cleanuppad()` returns it.

  // Stub (cg-contract): Funclet::new
  static new(_cleanuppad: Value): Funclet {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs new");
  }

  // rustc: compiler/rustc_codegen_llvm/src/common.rs:119 cleanuppad
  cleanuppad(): Value {
    return this.cleanuppad_;
  }

  // rustc: compiler/rustc_codegen_llvm/src/common.rs:123 bundle
  bundle(): OperandBundle {
    return this.operand.as_ref();
  }
}

/** `impl<'ll, CX: Borrow<SCx<'ll>>> BackendTypes for GenericCx<'ll, CX>` (common.rs:128): the type record (header). */
export interface LlvmTypes extends BackendTypes {
  // FIXME(eddyb) replace this with a `Function` "subclass" of `Value`.
  Function: Value;
  BasicBlock: BasicBlock;
  Funclet: Funclet;

  Value: Value;
  Type: Type;
  FunctionSignature: Type;

  DIScope: DIScope;
  DILocation: DILocation;
  DIVariable: DIVariable;
}

// ---- impl GenericCx (common.rs:143): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    const_array(ty: Type, elts: readonly Value[]): Value;
    const_bytes(bytes: Uint8Array): Value;
    null_terminate_const_bytes(bytes: Uint8Array): Value;
    const_null_inherent(t: Type): Value;
    const_struct_inherent(elts: readonly Value[], packed: boolean): Value;
  }
}

// Stub (cg-contract): const_array (common.rs:144)
GenericCx.prototype.const_array = function (this: GenericCx<SCxBorrow>, _ty: Type, _elts: readonly Value[]): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_array");
};

// Stub (cg-contract): const_bytes (common.rs:149)
GenericCx.prototype.const_bytes = function (this: GenericCx<SCxBorrow>, _bytes: Uint8Array): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_bytes");
};

// Stub (cg-contract): null_terminate_const_bytes (common.rs:153)
GenericCx.prototype.null_terminate_const_bytes = function (this: GenericCx<SCxBorrow>, _bytes: Uint8Array): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs null_terminate_const_bytes");
};

/** Inherent; `ConstCodegenMethods::const_null` has the same name (review F1: builder.ts header). */
// Stub (cg-contract): const_null (common.rs:168)
GenericCx.prototype.const_null_inherent = function (this: GenericCx<SCxBorrow>, _t: Type): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_null");
};

/** Inherent; `ConstCodegenMethods::const_struct` has the same name (review F1: builder.ts header). */
// Stub (cg-contract): const_struct (common.rs:172)
GenericCx.prototype.const_struct_inherent = function (this: GenericCx<SCxBorrow>, _elts: readonly Value[], _packed: boolean): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_struct");
};

// ---- impl ConstCodegenMethods for CodegenCx (common.rs:265) ----
declare module "./context.ts" {
  interface CodegenCx {
    const_null(t: Type): Value;
    const_undef(t: Type): Value;
    const_poison(t: Type): Value;
    const_bool(val: boolean): Value;
    const_i8(i: number): Value;
    const_i16(i: number): Value;
    const_i32(i: number): Value;
    const_i64(i: bigint): Value;
    const_int(t: Type, i: bigint): Value;
    const_u8(i: number): Value;
    const_u32(i: number): Value;
    const_u64(i: bigint): Value;
    const_u128(i: bigint): Value;
    const_usize(i: bigint): Value;
    const_uint(t: Type, i: bigint): Value;
    const_uint_big(t: Type, u: bigint): Value;
    const_real(t: Type, val: number): Value;
    const_str(s: string): [Value, Value];
    const_struct(elts: readonly Value[], packed: boolean): Value;
    const_vector(elts: readonly Value[]): Value;
    const_to_opt_uint(v: Value): bigint | undefined;
    const_to_opt_u128(v: Value, sign_ext: boolean): bigint | undefined;
    scalar_to_backend(cv: Scalar, layout: abi_Scalar, llty: Type): Value;
    scalar_to_backend_with_pac(cv: Scalar, layout: abi_Scalar, llty: Type, schema: PointerAuthSchema | undefined): Value;
    const_ptr_byte_offset(val: Value, offset: Size): Value;
  }
}

// Stub (cg-contract): ConstCodegenMethods::const_null
CodegenCx.prototype.const_null = function (this: CodegenCx, _t: Type): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_null");
};

// Stub (cg-contract): ConstCodegenMethods::const_undef
CodegenCx.prototype.const_undef = function (this: CodegenCx, _t: Type): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_undef");
};

// Stub (cg-contract): ConstCodegenMethods::const_poison
CodegenCx.prototype.const_poison = function (this: CodegenCx, _t: Type): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_poison");
};

// Stub (cg-contract): ConstCodegenMethods::const_bool
CodegenCx.prototype.const_bool = function (this: CodegenCx, _val: boolean): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_bool");
};

// Stub (cg-contract): ConstCodegenMethods::const_i8
CodegenCx.prototype.const_i8 = function (this: CodegenCx, _i: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_i8");
};

// Stub (cg-contract): ConstCodegenMethods::const_i16
CodegenCx.prototype.const_i16 = function (this: CodegenCx, _i: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_i16");
};

// Stub (cg-contract): ConstCodegenMethods::const_i32
CodegenCx.prototype.const_i32 = function (this: CodegenCx, _i: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_i32");
};

// Stub (cg-contract): ConstCodegenMethods::const_i64
CodegenCx.prototype.const_i64 = function (this: CodegenCx, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_i64");
};

// Stub (cg-contract): ConstCodegenMethods::const_int
CodegenCx.prototype.const_int = function (this: CodegenCx, _t: Type, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_int");
};

// Stub (cg-contract): ConstCodegenMethods::const_u8
CodegenCx.prototype.const_u8 = function (this: CodegenCx, _i: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_u8");
};

// Stub (cg-contract): ConstCodegenMethods::const_u32
CodegenCx.prototype.const_u32 = function (this: CodegenCx, _i: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_u32");
};

// Stub (cg-contract): ConstCodegenMethods::const_u64
CodegenCx.prototype.const_u64 = function (this: CodegenCx, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_u64");
};

// Stub (cg-contract): ConstCodegenMethods::const_u128
CodegenCx.prototype.const_u128 = function (this: CodegenCx, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_u128");
};

// Stub (cg-contract): ConstCodegenMethods::const_usize
CodegenCx.prototype.const_usize = function (this: CodegenCx, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_usize");
};

// Stub (cg-contract): ConstCodegenMethods::const_uint
CodegenCx.prototype.const_uint = function (this: CodegenCx, _t: Type, _i: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_uint");
};

// Stub (cg-contract): ConstCodegenMethods::const_uint_big
CodegenCx.prototype.const_uint_big = function (this: CodegenCx, _t: Type, _u: bigint): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_uint_big");
};

// Stub (cg-contract): ConstCodegenMethods::const_real
CodegenCx.prototype.const_real = function (this: CodegenCx, _t: Type, _val: number): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_real");
};

// Stub (cg-contract): ConstCodegenMethods::const_str
CodegenCx.prototype.const_str = function (this: CodegenCx, _s: string): [Value, Value] {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_str");
};

// Stub (cg-contract): ConstCodegenMethods::const_struct
CodegenCx.prototype.const_struct = function (this: CodegenCx, _elts: readonly Value[], _packed: boolean): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_struct");
};

// Stub (cg-contract): ConstCodegenMethods::const_vector
CodegenCx.prototype.const_vector = function (this: CodegenCx, _elts: readonly Value[]): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_vector");
};

// Stub (cg-contract): ConstCodegenMethods::const_to_opt_uint
CodegenCx.prototype.const_to_opt_uint = function (this: CodegenCx, _v: Value): bigint | undefined {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_to_opt_uint");
};

// Stub (cg-contract): ConstCodegenMethods::const_to_opt_u128
CodegenCx.prototype.const_to_opt_u128 = function (this: CodegenCx, _v: Value, _sign_ext: boolean): bigint | undefined {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_to_opt_u128");
};

// (provided) ConstCodegenMethods::scalar_to_backend -> ConstCodegenMethods_provided.scalar_to_backend
CodegenCx.prototype.scalar_to_backend = function (this: CodegenCx, cv: Scalar, layout: abi_Scalar, llty: Type): Value {
  return ConstCodegenMethods_provided.scalar_to_backend(this, cv, layout, llty);
};

// Stub (cg-contract): ConstCodegenMethods::scalar_to_backend_with_pac
CodegenCx.prototype.scalar_to_backend_with_pac = function (this: CodegenCx, _cv: Scalar, _layout: abi_Scalar, _llty: Type, _schema: PointerAuthSchema | undefined): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs scalar_to_backend_with_pac");
};

// Stub (cg-contract): ConstCodegenMethods::const_ptr_byte_offset
CodegenCx.prototype.const_ptr_byte_offset = function (this: CodegenCx, _val: Value, _offset: Size): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs const_ptr_byte_offset");
};

// Cross-lane surface (cg-contract, review F2)
// Stub (cg-contract): val_ty (common.rs:468)
export function val_ty(_v: Value): Type {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs val_ty");
}

// Stub (cg-contract): named_struct (common.rs:483)
export function named_struct(_ty: Type, _elts: readonly Value[]): Value {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs named_struct");
}

// Stub (cg-contract): get_dllimport (common.rs:506)
export function get_dllimport(_tcx: TyCtxt, _id: DefId, _name: string): DllImport | undefined {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/common.rs get_dllimport");
}
