// Port of compiler/rustc_codegen_llvm/src/llvm/mod.rs (lane cg-contract).
//
// PORT (cg-contract):
// - `mod ffi` is the IR model's contract, src/rust_ts/llvm/ffi.ts (plan-m7 D4/D5): it exports ffi.rs's functions, enums,
//   bitflags and handle types under ffi.rs's names, so `llvm::LLVMFoo(..)` is `llvm.LLVMFoo(..)`. Ported code imports this
//   module (`import * as llvm from "./llvm/mod.ts"`), never the IR model's internals, and never libLLVM.
// - `mod diagnostic` is lane cg-lto-diag's; `mod enzyme_ffi` and `mod offload_ffi` are out of M7 (harness/scope.json,
//   plan-m7 D18): their items are not re-exported, and their users stop with `unported(...)`.
// - `pub(crate) use self::CallConv::*;` / `CodeGenOptSize::*` (the variants in scope unqualified) have no TS form: write
//   `CallConv.CCallConv` and `CodeGenOptSize.CodeGenOptSizeNone`.
// - Inherent methods of an enum whose companion const is generated (ffi_types.ts: `LLVMRustResult`, `AttributeKind`,
//   `MemoryEffects`) live on a `<Enum>_impl` const here, with `self` first: `LLVMRustResult_impl.into_result(r)`.
// - `&CStr` arguments are `string` (ffi.ts types `*const c_char` as `string`); `&[u8]` is `Uint8Array`; `c_uint` and
//   `usize` are `number`, `u64` is `bigint` (ffi.ts).
// - `Drop` impls are `drop()` methods (as rustc_errors does): nothing calls them at scope end, so what they release (the
//   model's objects) is left to the garbage collector.
import type { AddressSpace, Align, Size } from "../../rustc_abi/lib.ts";
import type { WrappingRange } from "../../rustc_abi/wrapping_range.ts";
import { type Debug, debug_struct, debug_vec } from "../../std/fmt.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";
import { expect_result, type Result } from "../../std/result.ts";
import { from_utf8, type Utf8Error, utf8_len } from "../../std/str.ts";
import * as ffi from "../../rust_ts/llvm/ffi.ts";
import {
  AllocKindFlags,
  type Attribute,
  type AttributeKind,
  type CallConv,
  CallConv_discriminant,
  type Context,
  DLLStorageClass,
  LLVMRustResult,
  type Linkage,
  type MemoryEffects,
  type Module,
  type ModuleFlagMergeBehavior,
  type OperandBundle,
  type ThreadLocalMode,
  to_llvm_bool,
  type Twine,
  type Type,
  type UnnamedAddr,
  type Value,
  type Visibility,
} from "../../rust_ts/llvm/ffi.ts";
// `use rustc_llvm::RustString;` (mod.rs:10): rustc_llvm's Rust items live in src/rust_ts/llvm/support.ts, the TS home of
// that crate's Rust side (src/rustc_llvm/ does not exist). ffi.rs only names the type, so ffi.ts re-exports it type-only.
import { RustString } from "../../rust_ts/llvm/support.ts";


export * from "../../rust_ts/llvm/ffi.ts";
export * from "./conversions.ts";
export * from "./metadata_kind.ts";

/** `impl LLVMRustResult` (header: the companion const is generated). */
export const LLVMRustResult_impl = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:29 into_result
  into_result(self: LLVMRustResult): Result<undefined, undefined> {
    switch (self) {
      case LLVMRustResult.Success:
        return { $: "Ok", _0: undefined };
      case LLVMRustResult.Failure:
        return { $: "Err", _0: undefined };
    }
  },
};

/** `name.len()` of a Rust `&str` (PORTING §5: `utf8_len`). */
const str_len = utf8_len;

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:37 AddFunctionAttributes
export function AddFunctionAttributes(llfn: Value, idx: AttributePlace, attrs: readonly Attribute[]): void {
  ffi.LLVMRustAddFunctionAttributes(llfn, AttributePlace.as_uint(idx), attrs, attrs.length);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:47 HasStringAttribute
export function HasStringAttribute(_llfn: Value, _name: string): boolean {
  // unsafe { LLVMRustHasFnAttribute(llfn, name.as_ptr(), name.len()) }
  // PORT: `LLVMRustHasFnAttribute` is declared in llvm/enzyme_ffi.rs, which is out of M7 (harness/scope.json), so the IR
  // model's contract (ffi.ts, ffi.rs's functions) has no such function. Callers: attributes.rs:42 and the CFI/KCFI arms of
  // builder.rs (handoff).
  return unported("llir: LLVMRustHasFnAttribute (llvm/enzyme_ffi.rs, not in the IR model's contract)");
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:51 RemoveStringAttrFromFn
export function RemoveStringAttrFromFn(_llfn: Value, _name: string): void {
  // unsafe { LLVMRustRemoveFnAttribute(llfn, name.as_ptr(), name.len()) }
  // PORT: as `HasStringAttribute`: declared in llvm/enzyme_ffi.rs (out of M7).
  return unported("llir: LLVMRustRemoveFnAttribute (llvm/enzyme_ffi.rs, not in the IR model's contract)");
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:55 AddCallSiteAttributes
export function AddCallSiteAttributes(callsite: Value, idx: AttributePlace, attrs: readonly Attribute[]): void {
  ffi.LLVMRustAddCallSiteAttributes(callsite, AttributePlace.as_uint(idx), attrs, attrs.length);
}

/** `.try_into().unwrap()` of a `usize` length into `c_uint`. */
function len_to_c_uint(len: number): number {
  assert(len <= 0xffffffff, "called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return len;
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:65 CreateAttrStringValue
export function CreateAttrStringValue(llcx: Context, attr: string, value: string): Attribute {
  return ffi.LLVMCreateStringAttribute(llcx, attr, len_to_c_uint(str_len(attr)), value, len_to_c_uint(str_len(value)));
}
/** `attr: &CStr`, `value: &CStr`: their bytes without the NUL. */
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:80 CreateAttrStringValueFromCStr
export function CreateAttrStringValueFromCStr(llcx: Context, attr: Uint8Array, value: Uint8Array): Attribute {
  // `to_bytes()`; `len() as c_uint` truncates.
  return ffi.LLVMCreateStringAttribute(llcx, attr, attr.length >>> 0, value, value.length >>> 0);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:98 CreateAttrString
export function CreateAttrString(llcx: Context, attr: string): Attribute {
  return ffi.LLVMCreateStringAttribute(llcx, attr, len_to_c_uint(str_len(attr)), /* std::ptr::null() */ undefined, 0);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:110 CreateAlignmentAttr
export function CreateAlignmentAttr(llcx: Context, bytes: bigint): Attribute {
  return ffi.LLVMRustCreateAlignmentAttr(llcx, bytes);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:114 CreateDereferenceableAttr
export function CreateDereferenceableAttr(llcx: Context, bytes: bigint): Attribute {
  return ffi.LLVMRustCreateDereferenceableAttr(llcx, bytes);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:118 CreateDereferenceableOrNullAttr
export function CreateDereferenceableOrNullAttr(llcx: Context, bytes: bigint): Attribute {
  return ffi.LLVMRustCreateDereferenceableOrNullAttr(llcx, bytes);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:122 CreateByValAttr
export function CreateByValAttr(llcx: Context, ty: Type): Attribute {
  return ffi.LLVMRustCreateByValAttr(llcx, ty);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:126 CreateByRefAttr
export function CreateByRefAttr(llcx: Context, ty: Type): Attribute {
  return ffi.LLVMRustCreateByRefAttr(llcx, ty);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:130 CreateStructRetAttr
export function CreateStructRetAttr(llcx: Context, ty: Type): Attribute {
  return ffi.LLVMRustCreateStructRetAttr(llcx, ty);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:134 CreateUWTableAttr
export function CreateUWTableAttr(llcx: Context, async_: boolean): Attribute {
  return ffi.LLVMRustCreateUWTableAttr(llcx, async_);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:138 CreateAllocSizeAttr
export function CreateAllocSizeAttr(llcx: Context, size_arg: number): Attribute {
  return ffi.LLVMRustCreateAllocSizeAttr(llcx, size_arg);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:142 CreateAllocKindAttr
export function CreateAllocKindAttr(llcx: Context, kind_arg: AllocKindFlags): Attribute {
  // `kind_arg.bits()` is a `u64` (ffi.rs `AllocKindFlags: u64`).
  return ffi.LLVMRustCreateAllocKindAttr(llcx, BigInt(AllocKindFlags.bits(kind_arg)));
}

const U64_MASK = (1n << 64n) - 1n;

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:146 CreateRangeAttr
export function CreateRangeAttr(llcx: Context, size: Size, range: WrappingRange): Attribute {
  const lower = range.start;
  // LLVM treats the upper bound as exclusive, but allows wrapping.
  const upper = BigInt.asUintN(128, range.end + 1n);

  // Pass each `u128` endpoint value as a `[u64; 2]` array, least-significant part first.
  const as_u64_array = (x: bigint): [bigint, bigint] => [x & U64_MASK, (x >> 64n) & U64_MASK];
  const lower_words: [bigint, bigint] = as_u64_array(lower);
  const upper_words: [bigint, bigint] = as_u64_array(upper);

  // To ensure that LLVM doesn't try to read beyond the `[u64; 2]` arrays,
  // we must explicitly check that `size_bits` does not exceed 128.
  const size_bits = size.bits();
  assert(size_bits <= 128, "assertion failed: size_bits <= 128");
  // More robust assertions that are redundant with `size_bits <= 128` and
  // should be optimized away.
  assert(Math.ceil(size_bits / 64) <= lower_words.length, "assertion failed: size_bits.div_ceil(64) <= u64::try_from(lower_words.len()).unwrap()");
  assert(Math.ceil(size_bits / 64) <= upper_words.length, "assertion failed: size_bits.div_ceil(64) <= u64::try_from(upper_words.len()).unwrap()");
  // `c_uint::try_from(size_bits).unwrap()`: at most 128 here.

  return ffi.LLVMRustCreateRangeAttribute(llcx, size_bits, lower_words, upper_words);
}

// #[derive(Copy, Clone)]
export type AttributePlace = { readonly $: "ReturnValue" } | { readonly $: "Argument"; readonly _0: number } | { readonly $: "Function" };
export const AttributePlace = {
  ReturnValue: Object.freeze({ $: "ReturnValue" }) as { readonly $: "ReturnValue" },
  Function: Object.freeze({ $: "Function" }) as { readonly $: "Function" },

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:179 as_uint
  as_uint(self: AttributePlace): number {
    switch (self.$) {
      case "ReturnValue":
        return 0;
      case "Argument":
        // `1 + i` (u32; overflow would panic in debug builds only, and rustc ships without them).
        return (1 + self._0) >>> 0;
      case "Function":
        // `!0`
        return 0xffffffff;
    }
  },
} as const;

// #[derive(Copy, Clone, PartialEq)]
// #[repr(C)]
export type CodeGenOptSize = "CodeGenOptSizeNone" | "CodeGenOptSizeDefault" | "CodeGenOptSizeAggressive";
export const CodeGenOptSize = {
  CodeGenOptSizeNone: "CodeGenOptSizeNone",
  CodeGenOptSizeDefault: "CodeGenOptSizeDefault",
  CodeGenOptSizeAggressive: "CodeGenOptSizeAggressive",
} as const;
export const CodeGenOptSize_discriminant: Readonly<Record<CodeGenOptSize, number>> = {
  CodeGenOptSizeNone: 0,
  CodeGenOptSizeDefault: 1,
  CodeGenOptSizeAggressive: 2,
};

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:196 SetInstructionCallConv
export function SetInstructionCallConv(instr: Value, cc: CallConv): void {
  ffi.LLVMSetInstructionCallConv(instr, CallConv_discriminant[cc]);
}
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:201 SetFunctionCallConv
export function SetFunctionCallConv(fn_: Value, cc: CallConv): void {
  ffi.LLVMSetFunctionCallConv(fn_, CallConv_discriminant[cc]);
}

// Externally visible symbols that might appear in multiple codegen units need to appear in
// their own comdat section so that the duplicates can be discarded at link time. This can for
// example happen for generics when using multiple codegen units. This function simply uses the
// value's name as the comdat value to make sure that it is in a 1-to-1 relationship to the
// function.
// For more details on COMDAT sections see e.g., https://www.airs.com/blog/archives/52
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:213 SetUniqueComdat
export function SetUniqueComdat(llmod: Module, val: Value): void {
  const name_buf = get_value_name(val);
  // `CString::from_vec_with_nul(name_buf).or_else(|buf| CString::new(buf.into_bytes())).unwrap()`: the name up to its
  // first NUL if it ends in one, else the whole name (which must then have no interior NUL).
  const name = cstring_from_vec_with_nul_or_new(name_buf);
  set_comdat(llmod, val, name);
}

/** `CString::from_vec_with_nul(buf).or_else(|buf| CString::new(buf.into_bytes())).unwrap()`, as a JS string of the bytes
 *  before the terminator. */
function cstring_from_vec_with_nul_or_new(buf: Uint8Array): string {
  const nul = buf.indexOf(0);
  // `from_vec_with_nul` succeeds iff the only NUL is the last byte.
  if (nul === buf.length - 1) return new TextDecoder().decode(buf.subarray(0, nul));
  // `CString::new` fails on an interior NUL: `.unwrap()` panics.
  assert(nul < 0, () => `called \`Result::unwrap()\` on an \`Err\` value: NulError(${nul}, [${[...buf].join(", ")}])`);
  return new TextDecoder().decode(buf);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:220 set_unnamed_address
export function set_unnamed_address(global: Value, unnamed: UnnamedAddr): void {
  ffi.LLVMSetUnnamedAddress(global, unnamed);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:224 set_thread_local_mode
export function set_thread_local_mode(global: Value, mode: ThreadLocalMode): void {
  ffi.LLVMSetThreadLocalMode(global, mode);
}

/** `impl AttributeKind` (header). */
export const AttributeKind_impl = {
  /// Create an LLVM Attribute with no associated value.
  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:232 create_attr
  create_attr(self: AttributeKind, llcx: Context): Attribute {
    return ffi.LLVMRustCreateAttrNoValue(llcx, self);
  },
};

/** `impl MemoryEffects` (header). */
export const MemoryEffects_impl = {
  /// Create an LLVM Attribute with these memory effects.
  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:239 create_attr
  create_attr(self: MemoryEffects, llcx: Context): Attribute {
    return ffi.LLVMRustCreateMemoryEffectsAttr(llcx, self);
  },
};

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:244 set_section
export function set_section(llglobal: Value, section_name: string): void {
  ffi.LLVMSetSection(llglobal, section_name);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:250 add_global
export function add_global(llmod: Module, ty: Type, name_cstr: string): Value {
  return ffi.LLVMAddGlobal(llmod, ty, name_cstr);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:254 set_initializer
export function set_initializer(llglobal: Value, constant_val: Value): void {
  ffi.LLVMSetInitializer(llglobal, constant_val);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:260 set_global_constant
export function set_global_constant(llglobal: Value, is_constant: boolean): void {
  ffi.LLVMSetGlobalConstant(llglobal, to_llvm_bool(is_constant));
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:264 get_linkage
export function get_linkage(llglobal: Value): Linkage {
  return ffi.LLVMGetLinkage(llglobal).to_rust();
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:268 set_linkage
export function set_linkage(llglobal: Value, linkage: Linkage): void {
  ffi.LLVMSetLinkage(llglobal, linkage);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:274 is_declaration
export function is_declaration(llglobal: Value): boolean {
  return ffi.LLVMIsDeclaration(llglobal).is_true();
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:278 get_visibility
export function get_visibility(llglobal: Value): Visibility {
  return ffi.LLVMGetVisibility(llglobal).to_rust();
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:282 set_visibility
export function set_visibility(llglobal: Value, visibility: Visibility): void {
  ffi.LLVMSetVisibility(llglobal, visibility);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:288 set_alignment
export function set_alignment(llglobal: Value, align: Align): void {
  // `align.bytes() as c_uint`
  ffi.LLVMSetAlignment(llglobal, align.bytes() >>> 0);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:294 set_externally_initialized
export function set_externally_initialized(llglobal: Value, is_ext_init: boolean): void {
  ffi.LLVMSetExternallyInitialized(llglobal, to_llvm_bool(is_ext_init));
}

/// Get the `name`d comdat from `llmod` and assign it to `llglobal`.
///
/// Inserts the comdat into `llmod` if it does not exist.
/// It is an error to call this if the target does not support comdat.
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:302 set_comdat
export function set_comdat(llmod: Module, llglobal: Value, name: string): void {
  const comdat = ffi.LLVMGetOrInsertComdat(llmod, name);
  ffi.LLVMSetComdat(llglobal, comdat);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:309 count_params
export function count_params(llfn: Value): number {
  return ffi.LLVMCountParams(llfn);
}

/// Safe wrapper around `LLVMGetParam`, because segfaults are no fun.
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:314 get_param
export function get_param(llfn: Value, index: number): Value {
  assert(index < ffi.LLVMCountParams(llfn), () => `out of bounds argument access: ${index} out of ${ffi.LLVMCountParams(llfn)} arguments`);
  return ffi.LLVMGetParam(llfn, index);
}

/// Safe wrapper for `LLVMGetValueName2`
/// Needs to allocate the value, because `set_value_name` will invalidate
/// the pointer.
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:329 get_value_name
export function get_value_name(value: Value): Uint8Array {
  const len: ffi.MutRef<number> = { value: 0 };
  const data = ffi.LLVMGetValueName2(value, len);
  // `std::slice::from_raw_parts(data.cast(), len).to_vec()`. PORT: the contract hands back the name decoded from UTF-8
  // (ffi.ts `LLVMGetValueName2`), so its bytes are its UTF-8 encoding, `len` long.
  const bytes = new TextEncoder().encode(data ?? "");
  assert(bytes.length === len.value, "LLVMGetValueName2: length mismatch");
  return bytes;
}

// #[derive(Debug, Copy, Clone)]
export class Intrinsic {
  /** `id: NonZero<c_uint>` */
  constructor(readonly id: number) {}

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:343 lookup
  static lookup(name: Uint8Array): Intrinsic | undefined {
    const id = ffi.LLVMLookupIntrinsicID(name, name.length);
    // `NonZero::new(id).map(|id| Self { id })`
    return id !== 0 ? new Intrinsic(id) : undefined;
  }

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:348 is_overloaded
  is_overloaded(): boolean {
    return ffi.LLVMIntrinsicIsOverloaded(this.id).is_true();
  }

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:352 is_target_specific
  is_target_specific(): boolean {
    return ffi.LLVMRustIsTargetIntrinsic(this.id);
  }

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:356 get_declaration
  get_declaration(llmod: Module, type_params: readonly Type[]): Value {
    return ffi.LLVMGetIntrinsicDeclaration(llmod, this.id, type_params, type_params.length);
  }
}
export const debug_Intrinsic: Debug<Intrinsic> = (v, f) => debug_struct(f, "Intrinsic", [["id", String(v.id)]]);

/// Safe wrapper for `LLVMSetValueName2` from a byte slice
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:368 set_value_name
export function set_value_name(value: Value, name: Uint8Array): void {
  ffi.LLVMSetValueName2(value, name, name.length);
}

/** `alloc::string::FromUtf8Error` (library/alloc/src/string.rs, `#[derive(Debug)]`): the bytes and the error. */
export interface FromUtf8Error {
  readonly bytes: Uint8Array;
  readonly error: Utf8Error;
}
export const debug_FromUtf8Error: Debug<FromUtf8Error> = (v, f) =>
  debug_struct(f, "FromUtf8Error", [
    ["bytes", debug_vec([...v.bytes], f, (b) => String(b))],
    // PORT: `Utf8Error`'s non-alternate `Debug` (src/std/str.ts); no caller prints it with `{:#?}`.
    ["error", v.error.debug()],
  ]);

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:372 build_string
export function build_string(f: (s: RustString) => void): Result<string, FromUtf8Error> {
  // `String::from_utf8(RustString::build_byte_buffer(f))`
  const bytes = Uint8Array.from(RustString.build_byte_buffer(f));
  const r = from_utf8(bytes);
  if (r.$ === "Err") return { $: "Err", _0: { bytes, error: r._0 } };
  return r;
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:376 build_byte_buffer
export function build_byte_buffer(f: (s: RustString) => void): Uint8Array {
  return Uint8Array.from(RustString.build_byte_buffer(f));
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:380 twine_to_string
export function twine_to_string(tr: Twine): string {
  return expect_result(
    build_string((s) => ffi.LLVMRustWriteTwineToString(tr, s)),
    "got a non-UTF8 Twine from LLVM",
    debug_FromUtf8Error,
  );
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:386 last_error
export function last_error(): string | undefined {
  const cstr = ffi.LLVMRustGetLastError();
  if (cstr === undefined) {
    return undefined;
  } else {
    // `CStr::from_ptr(cstr).to_bytes()` then `String::from_utf8_lossy`: the contract already hands back a string.
    const err = cstr;
    // libc::free(cstr as *mut _);
    return err;
  }
}

/// Owning pointer to an [`OperandBundle`] that will dispose of the bundle
/// when dropped.
export class OperandBundleBox {
  /** `raw: ptr::NonNull<OperandBundle<'a>>` */
  constructor(readonly raw: OperandBundle) {}

  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:407 new
  static new(name: string, vals: readonly Value[]): OperandBundleBox {
    // `vals.len() as c_uint`
    const raw = ffi.LLVMCreateOperandBundle(name, str_len(name), vals, vals.length >>> 0);
    return new OperandBundleBox(unwrap(raw));
  }

  /// Dereferences to the underlying `&OperandBundle`.
  ///
  /// This can't be a `Deref` implementation because `OperandBundle` transitively
  /// contains an extern type, which is incompatible with `Deref::Target: ?Sized`.
  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:418 as_ref
  as_ref(): OperandBundle {
    // SAFETY: The returned reference is opaque and can only used for FFI.
    // It is valid for as long as `&self` is.
    return this.raw;
  }

  // impl Drop for OperandBundleBox<'_>
  // rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:426 drop
  drop(): void {
    ffi.LLVMDisposeOperandBundle(this.raw);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:433 add_module_flag_u32
export function add_module_flag_u32(module: Module, merge_behavior: ModuleFlagMergeBehavior, key: string, value: number): void {
  ffi.LLVMRustAddModuleFlagU32(module, merge_behavior, key, str_len(key), value);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:444 add_module_flag_str
export function add_module_flag_str(module: Module, merge_behavior: ModuleFlagMergeBehavior, key: string, value: string): void {
  ffi.LLVMRustAddModuleFlagString(module, merge_behavior, key, str_len(key), value, str_len(value));
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:462 set_dllimport_storage_class
export function set_dllimport_storage_class(v: Value): void {
  ffi.LLVMSetDLLStorageClass(v, DLLStorageClass.DllImport);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:468 set_dso_local
export function set_dso_local(v: Value): void {
  ffi.LLVMRustSetDSOLocal(v, true);
}

/// Safe wrapper for `LLVMRustAppendModuleInlineAsm`, which delegates to
/// `Module::appendModuleInlineAsm`.
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:476 append_module_inline_asm
export function append_module_inline_asm(llmod: Module, asm: Uint8Array, target_features: string, target_cpu: string): void {
  ffi.LLVMRustAppendModuleInlineAsm(llmod, asm, asm.length, target_features, str_len(target_features), target_cpu, str_len(target_cpu));
}

/// Safe wrapper for `LLVMAddAlias2`
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:496 add_alias
export function add_alias(module: Module, ty: Type, address_space: AddressSpace, aliasee: Value, name: string): Value {
  // `address_space.0`
  return ffi.LLVMAddAlias2(module, ty, address_space, aliasee, name);
}

/// Safe wrapper for `LLVMRustConstPtrAuth`.
// rustc: compiler/rustc_codegen_llvm/src/llvm/mod.rs:507 const_ptr_auth
export function const_ptr_auth(ptr: Value, key: number, disc: bigint, addr_diversity: Value | undefined): Value {
  // `addr_diversity.map_or(std::ptr::null(), |v| v as *const Value)`
  const addr_div_ptr = addr_diversity;
  const deactivation_symbol = undefined;
  const result = ffi.LLVMRustConstPtrAuth(ptr, key, disc, addr_div_ptr, deactivation_symbol);
  // `&*result`
  return unwrap(result);
}
