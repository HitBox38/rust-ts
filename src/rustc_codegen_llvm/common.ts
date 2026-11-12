// compiler/rustc_codegen_llvm/src/common.rs (lane cg-context, plan-m7 §8 wave 41; the skeleton is lane cg-contract's).
//! Code that is useful in various codegen modules.
//
// What is here: `maybe_sign_fn_ptr`, the struct `Funclet`, `impl BackendTypes for GenericCx` as the type record `LlvmTypes`
// (ssa-contract decision 1), the inherent impls of `GenericCx` and `CodegenCx`, `impl ConstCodegenMethods for CodegenCx`
// attached to `CodegenCx.prototype` (PORTING §5's extension pattern; lib.ts imports this file after context.ts), and the free
// fns.
//
// PORT (cg-context):
// - Integer widths: `u64` constants and addresses (`const_u64`, `const_usize`, `alloc_to_backend`'s `Err(u64)` base address) are
//   `bigint` (ssa-contract decision 6); `const_get_elt`'s `idx: u64` is an element index, a `number`.
// - `c_uint::try_from(elts.len()).expect(..)` cannot fail on a JS array (fewer than 2^32 elements); the conversions stay as
//   comments. `const_get_elt`'s index conversion can fail and is kept.
import { type Scalar as abi_Scalar, Scalar as abi_ScalarC, type Size, Primitive } from "../rustc_abi/lib.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import type { BackendTypes } from "../rustc_codegen_ssa/traits/backend.ts";
import { ConstCodegenMethods_provided } from "../rustc_codegen_ssa/traits/consts.ts";
import type { DllImport } from "../rustc_crate_store/cstore.gen.ts";
import { StableHasher, stable_hash_bytes, stable_hash_unit } from "../rustc_data_structures/stable_hash.ts";
import { Hash128 } from "../rustc_hashes/lib.ts";
import { stable_hash_Allocation } from "../rustc_middle/mir_stable_hash.gen.ts";
import { GlobalAlloc } from "../rustc_middle/mir/interpret/mod.ts";
import { CtfeProvenance, PointerArithmetic_provided } from "../rustc_middle/mir/interpret/pointer.ts";
import type { Scalar } from "../rustc_middle/mir/interpret/value.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { stable_hash_CtfeProvenance } from "../rustc_middle/ty/impls_ty.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { PointerAuthSchema } from "../rustc_session/session.ts";
import { PointerAuthARM8_3Key_discriminant } from "../rustc_session/session.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_with_ExistentialTraitRef, try_fold_with_ExistentialTraitRef, visit_with_ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8_len } from "../std/str.ts";
import { IsInitOrFini, IsStatic, const_alloc_to_llvm } from "./consts.ts";
import { CodegenCx, GenericCx, type SCxBorrow } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import type { BasicBlock, ConstantInt, DILocation, DIScope, DIVariable, OperandBundle, Type, Value } from "./llvm/mod.ts";

// rustc: compiler/rustc_codegen_llvm/src/common.rs:29 maybe_sign_fn_ptr
export function maybe_sign_fn_ptr(cx: CodegenCx, instance: Instance, llfn: Value, schema: PointerAuthSchema): Value {
  if (cx.tcx.sess.pointer_authentication_functions() === undefined) {
    return llfn;
  }

  // Only free functions or methods
  const def_id = Instance.def_id(instance);
  const def_kind = cx.tcx.def_kind(def_id);
  if (!(def_kind.$ === "Fn" || def_kind.$ === "AssocFn")) {
    return llfn;
  }
  // Only C ABI
  const abi = PolyFnSig.abi(EarlyBinder.skip_binder(cx.tcx.fn_sig(def_id)));
  if (!(abi.$ === "C" || abi.$ === "System")) {
    return llfn;
  }
  // Ignore LLVM intrinsics
  if (starts_with(llvm.get_value_name(llfn), LLVM_DOT)) {
    return llfn;
  }
  // `Some(def_id) == cx.tcx.lang_items().eh_personality()`
  const eh_personality = cx.tcx.lang_items().eh_personality();
  if (eh_personality !== undefined && DefId_eq(def_id, eh_personality)) {
    return llfn;
  }

  let addr_diversity: Value | undefined;
  switch (schema.is_address_discriminated.$) {
    case "HardwareAddress":
      addr_diversity = schema.is_address_discriminated._0 ? llfn : undefined;
      break;
    case "Synthetic": {
      const val = schema.is_address_discriminated._0;
      const llval = cx.const_u64(val);
      const llty = cx.val_ty(llfn);
      addr_diversity = llvm.LLVMConstIntToPtr(llval, llty);
      break;
    }
  }
  return llvm.const_ptr_auth(llfn, PointerAuthARM8_3Key_discriminant[schema.key], BigInt(schema.constant_discriminator), addr_diversity);
}

/** `b"llvm."` */
const LLVM_DOT = new TextEncoder().encode("llvm.");

/** `<[u8]>::starts_with` */
function starts_with(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

/*
 * A note on nomenclature of linking: "extern", "foreign", and "upcall".
 *
 * An "extern" is an LLVM symbol we wind up emitting an undefined external
 * reference to. This means "we don't have the thing in this compilation unit,
 * please make sure you link it in at runtime". This could be a reference to
 * C code found in a C library, or rust code found in a rust crate.
 *
 * Most "externs" are implicitly declared (automatically) as a result of a
 * user declaring an extern _module_ dependency; this causes the rust driver
 * to locate an extern crate, scan its compilation metadata, and emit extern
 * declarations for any symbols used by the declaring crate.
 *
 * A "foreign" is an extern that references C (or other non-rust ABI) code.
 * There is no metadata to scan for extern references so in these cases either
 * a header-digester like bindgen, or manual function prototypes, have to
 * serve as declarators. So these are usually given explicitly as prototype
 * declarations, in rust code, with ABI attributes on them noting which ABI to
 * link via.
 *
 * An "upcall" is a foreign call generated by the compiler (not corresponding
 * to any user-written call in the code) into the runtime library, to perform
 * some helper task such as bringing a task to life, allocating memory, etc.
 *
 */

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
    public operand: llvm.OperandBundleBox,
  ) {}

  // PORT (cg-contract): the field `cleanuppad` is `cleanuppad_`: the method `cleanuppad()` returns it.

  // rustc: compiler/rustc_codegen_llvm/src/common.rs:115 new
  static new(cleanuppad: Value): Funclet {
    return new Funclet(cleanuppad, llvm.OperandBundleBox.new("funclet", [cleanuppad]));
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

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (common.rs:143) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    const_array(ty: Type, elts: readonly Value[]): Value;
    const_bytes(bytes: Uint8Array): Value;
    null_terminate_const_bytes(bytes: Uint8Array): Value;
    const_get_elt(v: Value, idx: number): Value;
    const_null_inherent(t: Type): Value;
    const_struct_inherent(elts: readonly Value[], packed: boolean): Value;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:144 const_array
GenericCx.prototype.const_array = function (this: GenericCx<SCxBorrow>, ty: Type, elts: readonly Value[]): Value {
  // let len = u64::try_from(elts.len()).expect("LLVMConstArray2 elements len overflow");
  const len = BigInt(elts.length);
  return llvm.LLVMConstArray2(ty, elts, len);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:149 const_bytes
GenericCx.prototype.const_bytes = function (this: GenericCx<SCxBorrow>, bytes: Uint8Array): Value {
  return bytes_in_context(this.llcx(), bytes);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:153 null_terminate_const_bytes
GenericCx.prototype.null_terminate_const_bytes = function (this: GenericCx<SCxBorrow>, bytes: Uint8Array): Value {
  return null_terminate_bytes_in_context(this.llcx(), bytes);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:157 const_get_elt
GenericCx.prototype.const_get_elt = function (this: GenericCx<SCxBorrow>, v: Value, idx: number): Value {
  // `c_uint::try_from(idx).expect("LLVMGetAggregateElement index overflow")`
  if (idx > 0xffffffff) panic("LLVMGetAggregateElement index overflow: TryFromIntError(())");
  const r = llvm.LLVMGetAggregateElement(v, idx);
  if (r === undefined) return panic("called `Option::unwrap()` on a `None` value");

  // debug!("const_get_elt(v={:?}, idx={}, r={:?})", v, idx, r);

  return r;
};

/** Inherent; `ConstCodegenMethods::const_null` has the same name (review F1: builder.ts header). */
// rustc: compiler/rustc_codegen_llvm/src/common.rs:168 const_null
GenericCx.prototype.const_null_inherent = function (this: GenericCx<SCxBorrow>, t: Type): Value {
  return llvm.LLVMConstNull(t);
};

/** Inherent; `ConstCodegenMethods::const_struct` has the same name (review F1: builder.ts header). */
// rustc: compiler/rustc_codegen_llvm/src/common.rs:172 const_struct
GenericCx.prototype.const_struct_inherent = function (this: GenericCx<SCxBorrow>, elts: readonly Value[], packed: boolean): Value {
  return struct_in_context(this.llcx(), elts, packed);
};

// ---- impl<'ll, 'tcx> CodegenCx<'ll, 'tcx> (common.rs:177) ----
declare module "./context.ts" {
  interface CodegenCx {
    /** `-> Result<&'ll Value, u64>`: the `Err` is a base address, a `bigint` (header). */
    alloc_to_backend(global_alloc: GlobalAlloc, need_symbol_name: boolean, schema: PointerAuthSchema | undefined): Result<Value, bigint>;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:178 alloc_to_backend
CodegenCx.prototype.alloc_to_backend = function (
  this: CodegenCx,
  global_alloc: GlobalAlloc,
  need_symbol_name: boolean,
  schema: PointerAuthSchema | undefined,
): Result<Value, bigint> {
  let alloc;
  switch (global_alloc.$) {
    case "Function": {
      const instance = global_alloc.instance;
      return Ok(this.get_fn_addr(instance, schema));
    }
    case "Static": {
      const def_id = global_alloc._0;
      assert(this.tcx.is_static(def_id), "assertion failed: self.tcx.is_static(def_id)");
      assert(!this.tcx.is_thread_local_static(def_id), "assertion failed: !self.tcx.is_thread_local_static(def_id)");
      return Ok(
        // `alloc_to_backend` might be called by `global_asm!` codegen. In which case
        // `global_asm!` would need to find the renamed statics to use for symbol name.
        this.renamed_statics.get(def_id) ?? this.get_static(def_id),
      );
    }
    case "TypeId": {
      // Drop the provenance, the offset contains the bytes of the hash, so
      // just return 0 as base address.
      return Err(0n);
    }

    case "Memory": {
      const alloc_ = global_alloc._0;
      if (alloc_.inner().len() === 0) {
        // For ZSTs directly codegen an aligned pointer.
        // This avoids generating a zero-sized constant value and actually needing a
        // real address at runtime.
        return Err(BigInt(alloc_.inner().align.bytes()));
      }

      alloc = alloc_;
      break;
    }
    case "VTable": {
      const ty = global_alloc._0;
      const dyn_ty = global_alloc._1;
      const principal = dyn_ty.principal();
      alloc = GlobalAlloc.unwrap_memory(
        this.tcx.global_alloc(
          this.tcx.vtable_allocation([ty, principal !== undefined ? this.tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef) : undefined]),
        ),
      );
      break;
    }
  }

  const init = const_alloc_to_llvm(this, alloc.inner(), IsStatic.No, IsInitOrFini.No);
  const alloc_ = alloc.inner();

  if (need_symbol_name) {
    // If a symbol name is needed, use `static_addr_of_mut` so we can give it unique symbol names.
    const value = this.static_addr_of_mut(init, alloc_.align, undefined);
    if (Mutability.is_not(alloc_.mutability)) {
      llvm.set_global_constant(value, true);
    }

    // Even though we're generating with internal linkage, this symbol name still needs to
    // be globally unique. LTO can rename symbol names if there are duplicates, but the
    // names inserted into global asm as text cannot be updated.
    const name = this.generate_global_symbol_name();
    llvm.set_value_name(value, new TextEncoder().encode(name));
    llvm.set_linkage(value, "InternalLinkage");
    return Ok(value);
  }

  let value: Value;
  switch (alloc_.mutability) {
    case "Mut":
      value = this.static_addr_of_mut(init, alloc_.align, undefined);
      break;
    default:
      value = this.static_addr_of_impl(init, alloc_.align, undefined);
      break;
  }
  if (!this.sess().fewer_names() && llvm.get_value_name(value).length === 0) {
    const hash = this.tcx.with_stable_hashing_context((hcx) => {
      const hasher = StableHasher.new();
      // `alloc.stable_hash(..)` of `Allocation` (`<CtfeProvenance, (), Box<[u8]>>`): the generated derive, given the
      // type arguments' impls
      stable_hash_Allocation(alloc_, hcx, hasher, stable_hash_CtfeProvenance, stable_hash_unit, stable_hash_bytes);
      return hasher.finish(Hash128);
    });
    // `format!("alloc_{hash:032x}")`: `LowerHex` of `Hash128` is its `u128`'s
    llvm.set_value_name(value, new TextEncoder().encode(`alloc_${Hash128.as_u128(hash).toString(16).padStart(32, "0")}`));
  }

  return Ok(value);
};

/** `TypeFoldable` of `ExistentialTraitRef`, for `instantiate_bound_regions_with_erased` (rustc_monomorphize collector.ts's form). */
const d_ExistentialTraitRef = { visit_with: visit_with_ExistentialTraitRef, try_fold_with: try_fold_with_ExistentialTraitRef, fold_with: fold_with_ExistentialTraitRef };

// ---- impl<'ll, 'tcx> ConstCodegenMethods for CodegenCx<'ll, 'tcx> (common.rs:265) ----
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

// rustc: compiler/rustc_codegen_llvm/src/common.rs:266 const_null
CodegenCx.prototype.const_null = function (this: CodegenCx, t: Type): Value {
  return llvm.LLVMConstNull(t);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:270 const_undef
CodegenCx.prototype.const_undef = function (this: CodegenCx, t: Type): Value {
  return llvm.LLVMGetUndef(t);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:274 const_poison
CodegenCx.prototype.const_poison = function (this: CodegenCx, t: Type): Value {
  return llvm.LLVMGetPoison(t);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:278 const_bool
CodegenCx.prototype.const_bool = function (this: CodegenCx, val: boolean): Value {
  return this.const_uint(this.type_i1(), val ? 1n : 0n);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:282 const_i8
CodegenCx.prototype.const_i8 = function (this: CodegenCx, i: number): Value {
  return this.const_int(this.type_i8(), BigInt(i));
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:286 const_i16
CodegenCx.prototype.const_i16 = function (this: CodegenCx, i: number): Value {
  return this.const_int(this.type_i16(), BigInt(i));
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:290 const_i32
CodegenCx.prototype.const_i32 = function (this: CodegenCx, i: number): Value {
  return this.const_int(this.type_i32(), BigInt(i));
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:294 const_i64
CodegenCx.prototype.const_i64 = function (this: CodegenCx, i: bigint): Value {
  return this.const_int(this.type_i64(), i);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:298 const_int
CodegenCx.prototype.const_int = function (this: CodegenCx, t: Type, i: bigint): Value {
  // debug_assert!(
  //     self.type_kind(t) == TypeKind::Integer,
  //     "only allows integer types in const_int"
  // );
  // `i as u64`
  return llvm.LLVMConstInt(t, BigInt.asUintN(64, i), llvm.TRUE);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:306 const_u8
CodegenCx.prototype.const_u8 = function (this: CodegenCx, i: number): Value {
  return this.const_uint(this.type_i8(), BigInt(i));
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:310 const_u32
CodegenCx.prototype.const_u32 = function (this: CodegenCx, i: number): Value {
  return this.const_uint(this.type_i32(), BigInt(i));
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:314 const_u64
CodegenCx.prototype.const_u64 = function (this: CodegenCx, i: bigint): Value {
  return this.const_uint(this.type_i64(), i);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:318 const_u128
CodegenCx.prototype.const_u128 = function (this: CodegenCx, i: bigint): Value {
  return this.const_uint_big(this.type_i128(), i);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:322 const_usize
CodegenCx.prototype.const_usize = function (this: CodegenCx, i: bigint): Value {
  const bit_size = this.data_layout().pointer_size().bits();
  if (bit_size < 64) {
    // make sure it doesn't overflow
    assert(i < 1n << BigInt(bit_size), "assertion failed: i < (1 << bit_size)");
  }

  return this.const_uint(this.isize_ty(), i);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:332 const_uint
CodegenCx.prototype.const_uint = function (this: CodegenCx, t: Type, i: bigint): Value {
  // debug_assert!(
  //     self.type_kind(t) == TypeKind::Integer,
  //     "only allows integer types in const_uint"
  // );
  return llvm.LLVMConstInt(t, i, llvm.FALSE);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:340 const_uint_big
CodegenCx.prototype.const_uint_big = function (this: CodegenCx, t: Type, u: bigint): Value {
  // debug_assert!(
  //     self.type_kind(t) == TypeKind::Integer,
  //     "only allows integer types in const_uint_big"
  // );
  // `[u as u64, (u >> 64) as u64]`
  const words = [BigInt.asUintN(64, u), BigInt.asUintN(64, u >> 64n)];
  return llvm.LLVMConstIntOfArbitraryPrecision(t, 2, words);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:351 const_real
CodegenCx.prototype.const_real = function (this: CodegenCx, t: Type, val: number): Value {
  return llvm.LLVMConstReal(t, val);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:355 const_str
CodegenCx.prototype.const_str = function (this: CodegenCx, s: string): [Value, Value] {
  const const_str_cache = this.const_str_cache;
  let str_global = const_str_cache.get(s);
  if (str_global === undefined) {
    const sc = this.const_bytes(new TextEncoder().encode(s));
    const sym = this.generate_local_symbol_name("str");
    const g = this.define_global(sym, this.val_ty(sc)) ?? bug(`symbol \`${sym}\` is already defined`);
    llvm.set_initializer(g, sc);

    llvm.set_global_constant(g, true);
    llvm.set_unnamed_address(g, "Global");

    llvm.set_linkage(g, "InternalLinkage");
    // Cast to default address space if globals are in a different addrspace
    const g_ = this.const_pointercast(g, this.type_ptr());
    const_str_cache.set(s, g_);
    str_global = g_;
  }
  const len = utf8_len(s);
  return [str_global, this.const_usize(BigInt(len))];
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:378 const_struct
CodegenCx.prototype.const_struct = function (this: CodegenCx, elts: readonly Value[], packed: boolean): Value {
  return struct_in_context(this.llcx(), elts, packed);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:382 const_vector
CodegenCx.prototype.const_vector = function (this: CodegenCx, elts: readonly Value[]): Value {
  // let len = c_uint::try_from(elts.len()).expect("LLVMConstVector elements len overflow");
  const len = elts.length;
  return llvm.LLVMConstVector(elts, len);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:387 const_to_opt_uint
CodegenCx.prototype.const_to_opt_uint = function (this: CodegenCx, v: Value): bigint | undefined {
  const ci = try_as_const_integral(v);
  if (ci === undefined) return undefined;
  const i: MutRef<bigint> = { value: 0n };
  const success = llvm.LLVMRustConstIntGetZExtValue(ci, i);
  return success ? i.value : undefined;
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:395 const_to_opt_u128
CodegenCx.prototype.const_to_opt_u128 = function (this: CodegenCx, v: Value, sign_ext: boolean): bigint | undefined {
  const ci = try_as_const_integral(v);
  if (ci === undefined) return undefined;
  const lo: MutRef<bigint> = { value: 0n };
  const hi: MutRef<bigint> = { value: 0n };
  const success = llvm.LLVMRustConstInt128Get(ci, sign_ext, hi, lo);
  return success ? hi_lo_to_u128(lo.value, hi.value) : undefined;
};

// (provided) ConstCodegenMethods::scalar_to_backend -> ConstCodegenMethods_provided.scalar_to_backend
CodegenCx.prototype.scalar_to_backend = function (this: CodegenCx, cv: Scalar, layout: abi_Scalar, llty: Type): Value {
  return ConstCodegenMethods_provided.scalar_to_backend(this, cv, layout, llty);
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:403 scalar_to_backend_with_pac
CodegenCx.prototype.scalar_to_backend_with_pac = function (
  this: CodegenCx,
  cv: Scalar,
  layout: abi_Scalar,
  llty: Type,
  schema: PointerAuthSchema | undefined,
): Value {
  const bitsize = abi_ScalarC.is_bool(layout) ? 1 : abi_ScalarC.size(layout, this).bits();
  switch (cv.$) {
    case "Int": {
      const int = cv._0;
      const data = int.to_bits(abi_ScalarC.size(layout, this));
      const llval = this.const_uint_big(this.type_ix(bitsize), data);
      if (abi_ScalarC.primitive(layout).$ === "Pointer") {
        return llvm.LLVMConstIntToPtr(llval, llty);
      } else {
        return this.const_bitcast(llval, llty);
      }
    }
    case "Ptr": {
      const ptr = cv._0;
      const [prov, offset] = ptr.prov_and_relative_offset();
      const global_alloc = this.tcx.global_alloc(CtfeProvenance.alloc_id(prov));
      const base_addr_space = GlobalAlloc.address_space(global_alloc, this);
      const r = this.alloc_to_backend(global_alloc, false, schema);
      let base_addr: Value;
      if (r.$ === "Ok") {
        base_addr = r._0;
      } else {
        // `base_addr.wrapping_add(offset.bytes())` on `u64`
        const val = BigInt.asUintN(64, r._0 + offset.bytes_u64());
        const llval = this.const_usize(PointerArithmetic_provided.truncate_to_target_usize(this.tcx, val));
        return abi_ScalarC.primitive(layout).$ === "Pointer" ? llvm.LLVMConstIntToPtr(llval, llty) : this.const_bitcast(llval, llty);
      }
      const llval = llvm.LLVMConstInBoundsGEP2(
        this.type_i8(),
        // Cast to the required address space if necessary
        this.const_pointercast(base_addr, this.type_ptr_ext(base_addr_space)),
        [this.const_usize(offset.bytes_u64())],
        1,
      );
      if (!(abi_ScalarC.primitive(layout).$ === "Pointer")) {
        return llvm.LLVMConstPtrToInt(llval, llty);
      } else {
        return this.const_bitcast(llval, llty);
      }
    }
  }
};

// rustc: compiler/rustc_codegen_llvm/src/common.rs:455 const_ptr_byte_offset
CodegenCx.prototype.const_ptr_byte_offset = function (this: CodegenCx, base_addr: Value, offset: Size): Value {
  return llvm.LLVMConstInBoundsGEP2(this.type_i8(), base_addr, [this.const_usize(offset.bytes_u64())], 1);
};

/// Get the [LLVM type][Type] of a [`Value`].
// rustc: compiler/rustc_codegen_llvm/src/common.rs:468 val_ty
export function val_ty(v: Value): Type {
  return llvm.LLVMTypeOf(v);
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:472 bytes_in_context
export function bytes_in_context(llcx: llvm.Context, bytes: Uint8Array): Value {
  return llvm.LLVMConstStringInContext2(llcx, bytes, bytes.length, llvm.TRUE);
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:476 null_terminate_bytes_in_context
export function null_terminate_bytes_in_context(llcx: llvm.Context, bytes: Uint8Array): Value {
  return llvm.LLVMConstStringInContext2(llcx, bytes, bytes.length, llvm.FALSE);
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:483 named_struct
export function named_struct(ty: Type, elts: readonly Value[]): Value {
  // let len = c_uint::try_from(elts.len()).expect("LLVMConstStructInContext elements len overflow");
  const len = elts.length;
  return llvm.LLVMConstNamedStruct(ty, elts, len);
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:488 struct_in_context
function struct_in_context(llcx: llvm.Context, elts: readonly Value[], packed: boolean): Value {
  // let len = c_uint::try_from(elts.len()).expect("LLVMConstStructInContext elements len overflow");
  const len = elts.length;
  return llvm.LLVMConstStructInContext(llcx, elts, len, llvm.to_llvm_bool(packed));
}

// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/common.rs:498 hi_lo_to_u128
function hi_lo_to_u128(lo: bigint, hi: bigint): bigint {
  return (hi << 64n) | lo;
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:502 try_as_const_integral
function try_as_const_integral(v: Value): ConstantInt | undefined {
  return llvm.LLVMIsAConstantInt(v);
}

// rustc: compiler/rustc_codegen_llvm/src/common.rs:506 get_dllimport
export function get_dllimport(tcx: TyCtxt, id: DefId, name: string): DllImport | undefined {
  const lib = tcx.native_library(id);
  return lib === undefined ? undefined : lib.dll_imports.find((di) => Symbol.as_str(di.name) === name);
}
