// Port of ar_archive_writer 0.5.3 `src/object_reader.rs`.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

//! Default implementation of [crate::ObjectReader] that uses the `object` crate.
//
// PORT: XCOFF files are not ported in vendor `object` (`File::parse` stops `unported`), so `get_member_alignment` (AIX big
// archives) stops `unported` on an XCOFF member; a COFF import header is `unported` the same way. `io::Result<bool>` keeps
// its shape with `IoResult`.
import { type IoResult } from "../../std/io.ts";
import { panic, unported } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import type { SymbolKind } from "../object/common.ts";
import { File } from "../object/read/any.ts";
import { FileKind } from "../object/read/mod.ts";
import { is_any_arm64 } from "./coff.ts";

const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;
/** `object::pe::ImportObjectHeader::parse`'s checks: 20 bytes, `sig1 == IMAGE_FILE_MACHINE_UNKNOWN`, `sig2 == IMPORT_OBJECT_HDR_SIG2`, `version == 0`. */
const IMPORT_OBJECT_HDR_SIG2 = 0xffff;

/** The `object::read::Symbol` methods this file uses. */
export interface ObjectSymbolLike {
  kind(): SymbolKind;
  is_global(): boolean;
  is_undefined(): boolean;
  name_bytes(): { $: "Ok"; _0: Uint8Array } | { $: "Err"; _0: unknown };
}

// crate: ar_archive_writer-0.5.3/src/object_reader.rs:15 is_archive_symbol
function is_archive_symbol(sym: ObjectSymbolLike): boolean {
  // FIXME Use a better equivalent of LLVM's SymbolRef::SF_FormatSpecific
  if (sym.kind() === "File" || sym.kind() === "Section") {
    return false;
  }
  if (!sym.is_global()) {
    return false;
  }
  if (sym.is_undefined()) {
    return false;
  }
  return true;
}

// crate: ar_archive_writer-0.5.3/src/object_reader.rs:29 get_native_object_symbols
export function get_native_object_symbols(buf: Uint8Array, f: (name: Uint8Array) => IoResult<null>): IoResult<boolean> {
  // FIXME match what LLVM does

  const file = File.parse(buf);
  if (file.$ === "Ok") {
    for (const sym of file._0.symbols()) {
      if (!is_archive_symbol(sym)) {
        continue;
      }
      const name = sym.name_bytes();
      if (name.$ === "Err") return panic("FIXME");
      const r = f(name._0);
      if (r.$ === "Err") return r;
    }
    return Ok(true);
  } else {
    // Try to handle this as a COFF import library.
    if (buf.length >= 20 && buf[0] === 0 && buf[1] === 0 && buf[2] === (IMPORT_OBJECT_HDR_SIG2 & 0xff) && buf[3] === IMPORT_OBJECT_HDR_SIG2 >> 8 && buf[4] === 0 && buf[5] === 0) {
      return unported("ar_archive_writer::coff_import_file::get_short_import_symbol (COFF import libraries)");
    } else {
      return Ok(false);
    }
  }
}

// crate: ar_archive_writer-0.5.3/src/object_reader.rs:57 is_ec_object
export function is_ec_object(obj: Uint8Array): boolean {
  const k = FileKind.parse(obj);
  if (k.$ === "Ok" && k._0 === "Coff") {
    return (obj[0]! | (obj[1]! << 8)) !== IMAGE_FILE_MACHINE_ARM64;
  } else if (k.$ === "Ok" && k._0 === "CoffImport") {
    // COFF Import Header is:
    // sig1: u16
    // sig2: u16
    // version: u16
    // machine: u16
    return (obj[6]! | (obj[7]! << 8)) !== IMAGE_FILE_MACHINE_ARM64;
  } else {
    return false;
  }
}

// crate: ar_archive_writer-0.5.3/src/object_reader.rs:74 is_any_arm64_coff
export function is_any_arm64_coff(obj: Uint8Array): boolean {
  const k = FileKind.parse(obj);
  if (k.$ === "Ok" && k._0 === "Coff") {
    return is_any_arm64(obj[0]! | (obj[1]! << 8));
  } else if (k.$ === "Ok" && k._0 === "CoffImport") {
    // COFF Import Header is:
    // sig1: u16
    // sig2: u16
    // version: u16
    // machine: u16
    return is_any_arm64(obj[6]! | (obj[7]! << 8));
  } else {
    return false;
  }
}

// crate: ar_archive_writer-0.5.3/src/object_reader.rs:93 is_64_bit_symbolic_file
export function is_64_bit_symbolic_file(obj: Uint8Array): boolean {
  const k = FileKind.parse(obj);
  if (k.$ !== "Ok") return false;
  switch (k._0) {
    case "Elf64":
    case "MachO64":
    case "Pe64":
    case "Xcoff64":
    case "MachOFat64":
      return true;
    case "Elf32":
    case "MachO32":
    case "Pe32":
    case "Xcoff32":
    case "MachOFat32":
    case "Coff":
    case "CoffBig":
    case "CoffImport":
      return false;
    default:
      return panic("Unexpected file kind");
  }
}

// In the AIX big archive format, since the data content follows the member file
// name, if the name ends on an odd byte, an extra byte will be added for
// padding. This ensures that the data within the member file starts at an even
// byte.
const MIN_BIG_ARCHIVE_MEM_DATA_ALIGN = 2;

// AIX big archives may contain shared object members. The AIX OS requires these
// members to be aligned if they are 64-bit and recommends it for 32-bit
// members. This ensures that when these members are loaded they are aligned in
// memory.
// crate: ar_archive_writer-0.5.3/src/object_reader.rs:167 get_member_alignment
export function get_member_alignment(obj: Uint8Array): number {
  // If the desired alignment is > PAGESIZE, 32-bit members are aligned on a
  // word boundary, while 64-bit members are aligned on a PAGESIZE boundary.
  const k = FileKind.parse(obj);
  if (k.$ === "Ok" && (k._0 === "Xcoff64" || k._0 === "Xcoff32")) {
    return unported("ar_archive_writer::object_reader::get_aux_max_alignment (XCOFF members of an AIX big archive)");
  }
  return MIN_BIG_ARCHIVE_MEM_DATA_ALIGN;
}
