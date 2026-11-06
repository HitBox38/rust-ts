// Port of ar_archive_writer 0.5.3 `src/coff_import_file.rs`: only the name constants `archive_writer.rs` reads. Import
// libraries (`write_import_library`, `get_short_import_symbol`) are not ported: raw-dylib on Windows targets only.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
const encoder = new TextEncoder();
export const IMPORT_DESCRIPTOR_PREFIX: Uint8Array = encoder.encode("__IMPORT_DESCRIPTOR_");
export const NULL_IMPORT_DESCRIPTOR_SYMBOL_NAME: Uint8Array = encoder.encode("__NULL_IMPORT_DESCRIPTOR");
export const NULL_THUNK_DATA_PREFIX: Uint8Array = new Uint8Array([0x7f]);
export const NULL_THUNK_DATA_SUFFIX: Uint8Array = encoder.encode("_NULL_THUNK_DATA");
