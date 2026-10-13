// Port of object 0.39.1 `src/read/elf/symbol.rs` (the `SymbolTable` that `ElfFile::parse` builds).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see file.ts for the dictionary encoding of `Elf: FileHeader`. The symbol entries stay an
// undecoded `PodSlice` (decoded on access). Not ported (unused on rustc's path): the `Sym` trait,
// `ElfSymbol*` and symbol lookups/maps.

import { Err, Ok } from "../../../../std/result.ts";
import * as elf from "../../elf.ts";
import { type Endianness, U32 } from "../../endian.ts";
import { PodSlice } from "../../pod.ts";
import { Error, read_error_err, read_error_opt, type Result, SectionIndex, SymbolIndex } from "../mod.ts";
import { StringTable } from "../util.ts";
import type { FileHeader } from "./file.ts";
import { SectionHeader_provided, type SectionHeaderValue, type SectionTable } from "./section.ts";

/// A table of symbol entries in an ELF file.
///
/// Also includes the string table used for the symbol names.
///
/// Returned by [`SectionTable::symbols`].
export class SymbolTable {
  constructor(
    /** PORT: the `Elf: FileHeader` type parameter. */
    readonly Elf: FileHeader,
    readonly section_: SectionIndex,
    readonly string_section_: SectionIndex,
    readonly shndx_section_: SectionIndex,
    readonly symbols_: PodSlice<unknown>,
    readonly strings_: StringTable,
    readonly shndx: PodSlice<U32>,
  ) {}

  // crate: object-0.39.1/src/read/elf/symbol.rs:37 default
  static default(Elf: FileHeader): SymbolTable {
    return new SymbolTable(
      Elf,
      SectionIndex(0),
      SectionIndex(0),
      SectionIndex(0),
      PodSlice.empty(Elf.Sym),
      StringTable.default(),
      PodSlice.empty(U32.POD),
    );
  }

  /// Parse the given symbol table section.
  // crate: object-0.39.1/src/read/elf/symbol.rs:51 parse
  static parse(
    endian: Endianness,
    data: Uint8Array,
    sections: SectionTable,
    section_index: SectionIndex,
    section: SectionHeaderValue,
  ): Result<SymbolTable> {
    const Elf = sections.Elf;
    const SH = Elf.SectionHeader;
    // debug_assert!(
    //     section.sh_type(endian) == elf::SHT_DYNSYM
    //         || section.sh_type(endian) == elf::SHT_SYMTAB
    // );

    const symbols = read_error_err(SectionHeader_provided.data_as_array(SH, section, Elf.Sym, endian, data), "Invalid ELF symbol table data");
    if (symbols.$ === "Err") return symbols;

    const link = SectionIndex(SH.sh_link(section, endian));
    const strings = sections.strings(endian, data, link);
    if (strings.$ === "Err") return strings;

    let shndx_section = SectionIndex(0);
    let shndx = PodSlice.empty(U32.POD);
    for (const [i, s] of sections.enumerate()) {
      if (SH.sh_type(s, endian) === elf.SHT_SYMTAB_SHNDX && SectionHeader_provided.link(SH, s, endian) === section_index) {
        shndx_section = i;
        const d = read_error_err(SectionHeader_provided.data_as_array(SH, s, U32.POD, endian, data), "Invalid ELF symtab_shndx data");
        if (d.$ === "Err") return d;
        shndx = d._0;
      }
    }

    return Ok(new SymbolTable(Elf, section_index, link, shndx_section, symbols._0, strings._0, shndx));
  }

  /// Return the section index of this symbol table.
  // crate: object-0.39.1/src/read/elf/symbol.rs:93 section
  section(): SectionIndex {
    return this.section_;
  }

  /// Return the section index of the shndx table.
  // crate: object-0.39.1/src/read/elf/symbol.rs:99 shndx_section
  shndx_section(): SectionIndex {
    return this.shndx_section_;
  }

  /// Return the section index of the linked string table.
  // crate: object-0.39.1/src/read/elf/symbol.rs:105 string_section
  string_section(): SectionIndex {
    return this.string_section_;
  }

  /// Return the string table used for the symbol names.
  // crate: object-0.39.1/src/read/elf/symbol.rs:111 strings
  strings(): StringTable {
    return this.strings_;
  }

  /// Return the symbol table.
  // crate: object-0.39.1/src/read/elf/symbol.rs:117 symbols
  symbols(): PodSlice<unknown> {
    return this.symbols_;
  }

  /// Iterate over the symbols.
  ///
  /// This includes the null symbol at index 0, which you will usually need to skip.
  // crate: object-0.39.1/src/read/elf/symbol.rs:125 iter
  iter(): IterableIterator<unknown> {
    return this.symbols_[Symbol.iterator]();
  }

  /// Iterate over the symbols and their indices.
  ///
  /// This includes the null symbol at index 0, which you will usually need to skip.
  // crate: object-0.39.1/src/read/elf/symbol.rs:133 enumerate
  *enumerate(): IterableIterator<[SymbolIndex, unknown]> {
    let i = 0;
    for (const sym of this.symbols_) yield [SymbolIndex(i++), sym];
  }

  /// Return true if the symbol table is empty.
  // crate: object-0.39.1/src/read/elf/symbol.rs:142 is_empty
  is_empty(): boolean {
    return this.symbols_.is_empty();
  }

  /// The number of symbols.
  // crate: object-0.39.1/src/read/elf/symbol.rs:148 len
  len(): number {
    return this.symbols_.len();
  }

  /// Get the symbol at the given index.
  ///
  /// Returns an error for null entry at index 0.
  // crate: object-0.39.1/src/read/elf/symbol.rs:155 symbol
  symbol(index: SymbolIndex): Result<unknown> {
    if (index === SymbolIndex(0)) {
      return Err(new Error("Invalid ELF symbol index"));
    }
    return read_error_opt(this.symbols_.get(index), "Invalid ELF symbol index");
  }
}
