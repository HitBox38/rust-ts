// rust-ts: the non-fn items of ffi.rs that are not enums or bitflags (those are generated into ffi_types.ts), and the shapes
// the contract's signatures use (lane llir-core-a). `Bool` and `RawEnum` are ffi.rs's own; `RustString` is rustc_llvm's
// (`compiler/rustc_llvm/src/lib.rs`, an excluded crate whose only Rust is this buffer).
import type { Debug } from "../../std/fmt.ts";

// ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:39 Bool
/** In the LLVM-C API, boolean values are passed as `typedef int LLVMBool`. This wrapper does not implement `PartialEq`;
 * to test the underlying boolean value, use `is_true`. */
export class Bool {
  private constructor(readonly value: number) {}
  static readonly TRUE: Bool = new Bool(1);
  static readonly FALSE: Bool = new Bool(0);
  /** A `Bool` holding any C int (the model hands back only 0 and 1). */
  static of(value: number): Bool {
    return value === 0 ? Bool.FALSE : value === 1 ? Bool.TRUE : new Bool(value);
  }
  // ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:50 from_bool
  static from_bool(rust_bool: boolean): Bool {
    return rust_bool ? Bool.TRUE : Bool.FALSE;
  }
  // ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:55 is_true
  /** Converts this LLVM-C boolean to a Rust `bool`. Any nonzero value is true, following the C convention. */
  is_true(): boolean {
    return this.value !== Bool.FALSE.value;
  }
}
export const TRUE = Bool.TRUE;
export const FALSE = Bool.FALSE;

// ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:63 fmt
export const debug_Bool: Debug<Bool> = (v) => {
  switch (v.value) {
    case 0:
      return "FALSE";
    case 1:
      return "TRUE";
    // As with `Self::is_true`, treat any nonzero value as true.
    default:
      return `TRUE (${v.value})`;
  }
};

// ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:83 to_llvm_bool
/** `ToLlvmBool for bool`: `b.to_llvm_bool()`. */
export const to_llvm_bool = (b: boolean): Bool => Bool.from_bool(b);

// ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:95 RawEnum
/** Wrapper for a raw enum value returned from LLVM's C APIs; `to_rust` converts it to the Rust-side enum. */
export class RawEnum<T extends string> {
  constructor(
    readonly value: number,
    private readonly variants: Readonly<Record<T, number>>,
  ) {}
  // ffi: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:103 to_rust
  to_rust(): T {
    // If this fails, the Rust-side enum is out of sync with LLVM's enum.
    for (const [k, v] of Object.entries(this.variants) as [T, number][]) if (v === this.value) return k;
    throw new Error(`enum value returned by LLVM should be known: ${this.value}`);
  }
}

/** `&mut T` out-parameters (PORTING §8). */
export interface MutRef<T> {
  value: T;
}

/** A PTR_LEN_STR argument (`*const c_uchar` with a length): raw bytes, or a JS string standing for its UTF-8 bytes. */
export type PtrLenStr = Uint8Array | string;

/** `MetadataKindId(c_uint)` (`llvm/metadata_kind.rs`): a metadata kind id. */
export type MetadataKindId = number & { readonly __brand: "MetadataKindId" };

/** `SanitizerOptions` (ffi.rs `#[repr(C)] struct`), for `LLVMRustOptimize` (driver lanes). */
export interface SanitizerOptions {
  sanitize_address: boolean;
  sanitize_address_recover: boolean;
  sanitize_cfi: boolean;
  sanitize_dataflow: boolean;
  sanitize_dataflow_abilist: readonly string[];
  sanitize_dataflow_abilist_len: number;
  sanitize_kcfi: boolean;
  sanitize_memory: boolean;
  sanitize_memory_recover: boolean;
  sanitize_memory_track_origins: number;
  sanitize_realtime: boolean;
  sanitize_thread: boolean;
  sanitize_hwaddress: boolean;
  sanitize_hwaddress_recover: boolean;
  sanitize_kernel_address: boolean;
  sanitize_kernel_address_recover: boolean;
  sanitize_kernel_hwaddress: boolean;
  sanitize_kernel_hwaddress_recover: boolean;
}

/** `ThinLTOModule` (ffi.rs `#[repr(C)] struct`), for ThinLTO (out of M7, plan-m7 D8). */
export interface ThinLTOModule {
  identifier: string;
  data: Uint8Array;
  len: number;
}

/** rustc_llvm's `RustString`: a byte buffer the C++ side writes to (`RustStringInner`'s `bytes`). */
export class RustString {
  bytes: number[] = [];
  // rustc: compiler/rustc_llvm/src/lib.rs:18 build_byte_buffer
  static build_byte_buffer(closure: (s: RustString) => void): number[] {
    const buf = new RustString();
    closure(buf);
    return buf.bytes;
  }
}

// rustc: compiler/rustc_llvm/src/lib.rs:62 LLVMRustStringWriteImpl
/** Appends the contents of a byte slice to a `RustString`. */
export function LLVMRustStringWriteImpl(buf: RustString, slice: Uint8Array): void {
  for (const b of slice) buf.bytes.push(b);
}
