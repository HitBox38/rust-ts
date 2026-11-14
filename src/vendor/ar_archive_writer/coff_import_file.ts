// Port of ar_archive_writer 0.5.3 `src/coff_import_file.rs`: only the name constants `archive_writer.rs` reads and the
// `COFFShortExport` struct (lane ssa-archive: `rustc_codegen_ssa::back::archive` builds it). Import libraries
// (`write_import_library`, `get_short_import_symbol`) are not ported: raw-dylib on Windows targets only.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
const encoder = new TextEncoder();
export const IMPORT_DESCRIPTOR_PREFIX: Uint8Array = encoder.encode("__IMPORT_DESCRIPTOR_");
export const NULL_IMPORT_DESCRIPTOR_SYMBOL_NAME: Uint8Array = encoder.encode("__NULL_IMPORT_DESCRIPTOR");
export const NULL_THUNK_DATA_PREFIX: Uint8Array = new Uint8Array([0x7f]);
export const NULL_THUNK_DATA_SUFFIX: Uint8Array = encoder.encode("_NULL_THUNK_DATA");

export interface COFFShortExport {
  /// The name of the export as specified in the .def file or on the command
  /// line, i.e. "foo" in "/EXPORT:foo", and "bar" in "/EXPORT:foo=bar". This
  /// may lack mangling, such as underscore prefixing and stdcall suffixing.
  name: string;

  /// The external, exported name. Only non-empty when export renaming is in
  /// effect, i.e. "foo" in "/EXPORT:foo=bar".
  ext_name: string | undefined;

  /// The real, mangled symbol name from the object file. Given
  /// "/export:foo=bar", this could be "_bar@8" if bar is stdcall.
  symbol_name: string | undefined;

  /// Creates an import library entry that imports from a DLL export with a
  /// different name. This is the name of the DLL export that should be
  /// referenced when linking against this import library entry. In a .def
  /// file, this is "baz" in "EXPORTS\nfoo = bar == baz".
  import_name: string | undefined;

  /// Specifies EXPORTAS name. In a .def file, this is "bar" in
  /// "EXPORTS\nfoo EXPORTAS bar".
  export_as: string | undefined;

  ordinal: number;
  noname: boolean;
  data: boolean;
  private: boolean;
  constant: boolean;
}
