// Port of object 0.39.1 `src/read/mod.rs` (the parts rustc's metadata reader reaches: the error
// type, `ReadError`, `FileKind`, `SectionIndex`, `SymbolIndex`).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Interface for reading object files.
//!
//! ## Unified read API
//!
//! The [`Object`] trait provides a unified read API for accessing common features of
//! object files, such as sections and symbols. There is an implementation of this
//! trait for [`File`], which allows reading any file format, as well as implementations
//! for each file format:
//! [`ElfFile`](elf::ElfFile), [`MachOFile`](macho::MachOFile), [`CoffFile`](coff::CoffFile),
//! [`PeFile`](pe::PeFile), [`WasmFile`](wasm::WasmFile), [`XcoffFile`](xcoff::XcoffFile).
//!
//! ## Low level read API
//!
//! The submodules for each file format define helpers that operate on the raw structs.
//! These can be used instead of the unified API, or in conjunction with it to access
//! details that are not available via the unified API.
//
// PORT: features as rustc_codegen_ssa builds object: read_core, archive, coff (via pe), elf,
// macho, pe, wasm, xcoff, unaligned, write (no `compression`, no `std`-only read items reached).
// PORT: rust-ts reads ELF, Mach-O and Wasm files (the formats of its targets: x86_64/aarch64
// linux and apple, wasm32). COFF/PE/XCOFF parsing calls `unported(...)` where it is reached.
// PORT: `R: ReadRef<'data>` is always `&'data [u8]` (`Uint8Array`).
// PORT: `Error` shadows the JS global in modules that import it; ported code never throws JS errors.

import { type Debug, debug_tuple, debug_str } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import { ReadRef } from "./read_ref.ts";

/// The error type used within the read module.
export class Error {
  constructor(readonly _0: string) {}
}
export const debug_Error: Debug<Error> = (e, f) => debug_tuple(f, "Error", [debug_str(e._0)]);

// crate: object-0.39.1/src/read/mod.rs:122 fmt
export function display_Error(self: Error): string {
  return self._0;
}

/// The result type used within the read module.
export type Result<T> = StdResult<T, Error>;

// trait ReadError<T> { fn read_error(self, error: &'static str) -> Result<T>; }

// crate: object-0.39.1/src/read/mod.rs:140 read_error
export function read_error_unit<T>(self: StdResult<T, undefined>, error: string): Result<T> {
  return self.$ === "Ok" ? self : Err(new Error(error));
}

// crate: object-0.39.1/src/read/mod.rs:146 read_error
export function read_error_err<T>(self: StdResult<T, Error>, error: string): Result<T> {
  return self.$ === "Ok" ? self : Err(new Error(error));
}

// crate: object-0.39.1/src/read/mod.rs:152 read_error
export function read_error_opt<T>(self: T | undefined, error: string): Result<T> {
  return self !== undefined ? Ok(self) : Err(new Error(error));
}

/// A file format kind.
export type FileKind =
  /// A Unix archive.
  ///
  /// See [`archive::ArchiveFile`].
  | "Archive"
  /// A COFF object file.
  ///
  /// See [`coff::CoffFile`].
  | "Coff"
  /// A COFF bigobj object file.
  ///
  /// This supports a larger number of sections.
  ///
  /// See [`coff::CoffBigFile`].
  | "CoffBig"
  /// A Windows short import file.
  ///
  /// See [`coff::ImportFile`].
  | "CoffImport"
  /// A dyld cache file containing Mach-O images.
  ///
  /// See [`macho::DyldCache`]
  | "DyldCache"
  /// A 32-bit ELF file.
  ///
  /// See [`elf::ElfFile32`].
  | "Elf32"
  /// A 64-bit ELF file.
  ///
  /// See [`elf::ElfFile64`].
  | "Elf64"
  /// A 32-bit Mach-O file.
  ///
  /// See [`macho::MachOFile32`].
  | "MachO32"
  /// A 64-bit Mach-O file.
  ///
  /// See [`macho::MachOFile64`].
  | "MachO64"
  /// A 32-bit Mach-O fat binary.
  ///
  /// See [`macho::MachOFatFile32`].
  | "MachOFat32"
  /// A 64-bit Mach-O fat binary.
  ///
  /// See [`macho::MachOFatFile64`].
  | "MachOFat64"
  /// A 32-bit PE file.
  ///
  /// See [`pe::PeFile32`].
  | "Pe32"
  /// A 64-bit PE file.
  ///
  /// See [`pe::PeFile64`].
  | "Pe64"
  /// A Wasm file.
  ///
  /// See [`wasm::WasmFile`].
  | "Wasm"
  /// A 32-bit XCOFF file.
  ///
  /// See [`xcoff::XcoffFile32`].
  | "Xcoff32"
  /// A 64-bit XCOFF file.
  ///
  /// See [`xcoff::XcoffFile64`].
  | "Xcoff64";

const ch = (s: string): number => s.charCodeAt(0);

export const FileKind = {
  /// Determine a file kind by parsing the start of the file.
  // crate: object-0.39.1/src/read/mod.rs:272 parse
  parse(data: Uint8Array): Result<FileKind> {
    return FileKind.parse_at(data, 0);
  },

  /// Determine a file kind by parsing at the given offset.
  // crate: object-0.39.1/src/read/mod.rs:277 parse_at
  parse_at(data: Uint8Array, offset: number): Result<FileKind> {
    const r = read_error_unit(ReadRef.read_bytes_at(data, offset, 16), "Could not read file magic");
    if (r.$ === "Err") return r;
    const magic = r._0;
    if (magic.length < 16) {
      return Err(new Error("File too short"));
    }

    const m = (i: number): number => magic[i]!;
    const is = (bytes: readonly (number | string)[]): boolean =>
      bytes.every((b, i) => m(i) === (typeof b === "string" ? ch(b) : b));
    let kind: FileKind;
    if (is(["!", "<", "a", "r", "c", "h", ">", "\n"]) || is(["!", "<", "t", "h", "i", "n", ">", "\n"])) {
      kind = "Archive";
    } else if (is(["d", "y", "l", "d", "_", "v", "1", " "])) {
      kind = "DyldCache";
    } else if (is([0x7f, "E", "L", "F", 1])) {
      kind = "Elf32";
    } else if (is([0x7f, "E", "L", "F", 2])) {
      kind = "Elf64";
    } else if (is([0xfe, 0xed, 0xfa, 0xce]) || is([0xce, 0xfa, 0xed, 0xfe])) {
      kind = "MachO32";
    } else if (is([0xfe, 0xed, 0xfa, 0xcf]) || is([0xcf, 0xfa, 0xed, 0xfe])) {
      kind = "MachO64";
    } else if (is([0xca, 0xfe, 0xba, 0xbe])) {
      kind = "MachOFat32";
    } else if (is([0xca, 0xfe, 0xba, 0xbf])) {
      kind = "MachOFat64";
    } else if (is([0x00, "a", "s", "m"]) && m(6) === 0x00 && m(7) === 0x00) {
      kind = "Wasm";
    } else if (is(["M", "Z"]) && offset === 0) {
      // offset == 0 restriction is because optional_header_magic only looks at offset 0
      return unported("object::read::pe::optional_header_magic (PE files: no rust-ts target)");
    } else if (
      // TODO: more COFF machines
      // COFF arm
      is([0xc4, 0x01]) ||
      // COFF arm64
      is([0x64, 0xaa]) ||
      // COFF arm64ec
      is([0x41, 0xa6]) ||
      // COFF ppc
      is([0xf0, 0x01]) ||
      is([0xf1, 0x01]) ||
      is([0xf2, 0x01]) ||
      // COFF x86
      is([0x4c, 0x01]) ||
      // COFF x86-64
      is([0x64, 0x86])
    ) {
      kind = "Coff";
    } else if (is([0x00, 0x00, 0xff, 0xff, 0x00, 0x00])) {
      kind = "CoffImport";
    } else if (is([0x00, 0x00, 0xff, 0xff, 0x02, 0x00]) && offset === 0) {
      // offset == 0 restriction is because anon_object_class_id only looks at offset 0
      return unported("object::read::coff::anon_object_class_id (COFF bigobj files: no rust-ts target)");
    } else if (is([0x01, 0xdf])) {
      kind = "Xcoff32";
    } else if (is([0x01, 0xf7])) {
      kind = "Xcoff64";
    } else {
      return Err(new Error("Unknown file magic"));
    }
    return Ok(kind);
  },
};

/// An object kind.
///
/// Returned by [`Object::kind`].
export type ObjectKind = "Unknown" | "Relocatable" | "Executable" | "Dynamic" | "Core";

/// The index used to identify a section in a file.
export type SectionIndex = number & { readonly __brand: "SectionIndex" };
export function SectionIndex(i: number): SectionIndex {
  return i as SectionIndex;
}

// crate: object-0.39.1/src/read/mod.rs:379 fmt
export function display_SectionIndex(self: SectionIndex): string {
  return String(self);
}

/// The index used to identify a symbol in a symbol table.
export type SymbolIndex = number & { readonly __brand: "SymbolIndex" };
export function SymbolIndex(i: number): SymbolIndex {
  return i as SymbolIndex;
}

// crate: object-0.39.1/src/read/mod.rs:389 fmt
export function display_SymbolIndex(self: SymbolIndex): string {
  return String(self);
}
