//! A helper class for dealing with static archives
// compiler/rustc_codegen_llvm/src/back/archive.rs (lane cg-write, plan-m7 wave 42). Ported whole.
//
// The object crate's reader (`DEFAULT_OBJECT_READER`, src/vendor/ar_archive_writer) does the work; LLVM helps only for bitcode and
// COFF bigobj files, through `LLVMRustGetSymbols`, `LLVMRustIs64BitSymbolicFile`, `LLVMRustIsECObject` and
// `LLVMRustIsAnyArm64Coff`. Those four are the IR model's stops (docs/handoff/cg-write.md).
import { ArArchiveBuilder, type ArchiveBuilder, type ArchiveBuilderBuilder } from "../../rustc_codegen_ssa/back/archive.ts";
import type { Session } from "../../rustc_session/session.ts";
import { display_IoError, io_error_other, type IoError, type IoResult, write_stderr } from "../../std/io.ts";
import { Err, Ok } from "../../std/result.ts";
import { DEFAULT_OBJECT_READER, type ObjectReader } from "../../vendor/ar_archive_writer/lib.ts";
import * as llvm from "../llvm/mod.ts";

/** `pub(crate) struct LlvmArchiveBuilderBuilder;` with `impl ArchiveBuilderBuilder for LlvmArchiveBuilderBuilder`. */
export const LlvmArchiveBuilderBuilder: ArchiveBuilderBuilder = {
  /** `-> Box<dyn ArchiveBuilder + 'a>` */
  // rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:16 new_archive_builder
  new_archive_builder(sess: Session): ArchiveBuilder {
    // Use the `object` crate to build archives, with a little bit of help from LLVM.
    return ArArchiveBuilder.new(sess, LLVM_OBJECT_READER);
  },
};

// The object crate doesn't know how to get symbols for LLVM bitcode and COFF bigobj files.
// As such we need to use LLVM for them.

/** `static LLVM_OBJECT_READER: ObjectReader` (initialized below, after its functions: a `const` is not hoisted). */
let LLVM_OBJECT_READER: ObjectReader;

/** `f: &mut dyn FnMut(&[u8]) -> io::Result<()>` (`io::Result<()>` is `IoResult<null>`). */
// #[deny(unsafe_op_in_unsafe_fn)]
// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:34 get_llvm_object_symbols
function get_llvm_object_symbols(buf: Uint8Array, f: (name: Uint8Array) => IoResult<null>): IoResult<boolean> {
  // let mut state = Box::new(f);
  const state = { f };

  const err = llvm.LLVMRustGetSymbols(buf, buf.length, state, callback, error_callback);

  if (err === undefined || err === null) {
    return Ok(true);
  } else {
    const error = err as IoError;
    // These are the magic constants for LLVM bitcode files:
    // https://github.com/llvm/llvm-project/blob/7eadc1960d199676f04add402bb0aa6f65b7b234/llvm/lib/BinaryFormat/Magic.cpp#L90-L97
    if (starts_with(buf, [0xde, 0xce, 0x17, 0x0b]) || starts_with(buf, [0x42 /* b'B' */, 0x43 /* b'C' */, 0xc0, 0xde])) {
      // For LLVM bitcode, failure to read the symbols is not fatal. The bitcode may have been
      // produced by a newer LLVM version that the one linked to rustc. This is fine provided
      // that the linker does use said newer LLVM version. We skip writing the symbols for the
      // bitcode to the symbol table of the archive. Traditional linkers don't like this, but
      // newer linkers like lld, mold and wild ignore the symbol table anyway, so if they link
      // against a new enough LLVM it will work out in the end.
      // LLVM's archive writer also has this same behavior of only warning about invalid
      // bitcode since https://github.com/llvm/llvm-project/pull/96848

      // We don't have access to the DiagCtxt here to produce a nice warning in the correct format.
      write_stderr(`warning: Failed to read symbol table from LLVM bitcode: ${display_IoError(error)}\n`);
      return Ok(true);
    } else {
      return Err(error);
    }
  }
}

/** The nested `unsafe extern "C" fn callback(state: *mut c_void, symbol_name: *const c_char) -> *mut c_void` of
 * `get_llvm_object_symbols`: a null pointer is `undefined`, a boxed `io::Error` the error itself. */
// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:75 callback
function callback(state: unknown, symbol_name: Uint8Array): IoError | undefined {
  const f = (state as { f: (name: Uint8Array) => IoResult<null> }).f;
  // f(unsafe { CStr::from_ptr(symbol_name) }.to_bytes())
  const r = f(symbol_name);
  switch (r.$) {
    case "Ok":
      return undefined;
    case "Err":
      return r._0;
  }
}

/** The nested `unsafe extern "C" fn error_callback(error: *const c_char) -> *mut c_void` of `get_llvm_object_symbols`. */
// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:83 error_callback
function error_callback(error: Uint8Array): IoError {
  // let error = unsafe { CStr::from_ptr(error) };
  // io::Error::new(io::ErrorKind::Other, format!("LLVM error: {}", error.to_string_lossy()))
  // (`ignoreBOM`: `to_string_lossy` keeps a leading U+FEFF, which a default `TextDecoder` strips.)
  return io_error_other(`LLVM error: ${new TextDecoder("utf-8", { ignoreBOM: true }).decode(error)}`);
}

// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:92 llvm_is_64_bit_object_file
function llvm_is_64_bit_object_file(buf: Uint8Array): boolean {
  return llvm.LLVMRustIs64BitSymbolicFile(buf, buf.length);
}

// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:96 llvm_is_ec_object_file
function llvm_is_ec_object_file(buf: Uint8Array): boolean {
  return llvm.LLVMRustIsECObject(buf, buf.length);
}

// rustc: compiler/rustc_codegen_llvm/src/back/archive.rs:100 llvm_is_any_arm64_coff
function llvm_is_any_arm64_coff(buf: Uint8Array): boolean {
  return llvm.LLVMRustIsAnyArm64Coff(buf, buf.length);
}

LLVM_OBJECT_READER = {
  get_symbols: get_llvm_object_symbols,
  is_64_bit_object_file: llvm_is_64_bit_object_file,
  is_ec_object_file: llvm_is_ec_object_file,
  is_any_arm64_coff: llvm_is_any_arm64_coff,
  get_xcoff_member_alignment: DEFAULT_OBJECT_READER.get_xcoff_member_alignment,
};

/** `<[u8]>::starts_with(&[..])`. */
function starts_with(s: Uint8Array, prefix: readonly number[]): boolean {
  if (s.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (s[i] !== prefix[i]) return false;
  return true;
}
