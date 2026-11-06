// Port of ar_archive_writer 0.5.3 `src/lib.rs` (version from upstream's root Cargo.lock; plan-m6 D4, lane miri-sysroot).
//
// PORT: `coff_import_file::write_import_library` and `mangler.rs` (COFF import libraries, raw-dylib on Windows) are not
// ported. `harness/scope.json` does not list this crate yet, so its markers are spelled `// crate-pending:`; see
// docs/handoff/miri-sysroot.md for the one edit that turns them into `// crate:`.
import type { IoResult } from "../../std/io.ts";
import { get_member_alignment, get_native_object_symbols, is_64_bit_symbolic_file, is_any_arm64_coff, is_ec_object } from "./object_reader.ts";

export { ArchiveKind } from "./archive.ts";
export { NewArchiveMember, write_archive_to_stream, ArchiveWriter } from "./archive_writer.ts";

export type GetSymbolsFn = (buf: Uint8Array, f: (name: Uint8Array) => IoResult<null>) => IoResult<boolean>;
export type Is64BitObjectFileFn = (buf: Uint8Array) => boolean;
export type IsECObjectFileFn = (buf: Uint8Array) => boolean;
export type IsAnyArm64CoffFn = (buf: Uint8Array) => boolean;
export type GetXCoffMemberAlignmentFn = (buf: Uint8Array) => number;

/// Helper struct to query object file information from members.
export interface ObjectReader {
  /// Iterates over the symbols in the object file.
  get_symbols: GetSymbolsFn;
  /// Returns true if the object file is 64-bit.
  /// Note that this should match LLVM's `SymbolicFile::is64Bit`, which
  /// considers all COFF files to be 32-bit.
  is_64_bit_object_file: Is64BitObjectFileFn;
  /// Returns true if the object file is an EC (that is, an Arm64EC or x64)
  /// object file
  is_ec_object_file: IsECObjectFileFn;
  /// Returns true if the object file is any Arm64 (Native Arm64, Arm64EC or
  /// Arm64X) COFF file.
  is_any_arm64_coff: IsAnyArm64CoffFn;
  /// Returns the member alignment of an XCoff object file.
  get_xcoff_member_alignment: GetXCoffMemberAlignmentFn;
}

/// Default implementation of [ObjectReader] that uses the `object` crate.
export const DEFAULT_OBJECT_READER: ObjectReader = {
  get_symbols: get_native_object_symbols,
  is_64_bit_object_file: is_64_bit_symbolic_file,
  is_ec_object_file: is_ec_object,
  is_any_arm64_coff: is_any_arm64_coff,
  get_xcoff_member_alignment: get_member_alignment,
};
