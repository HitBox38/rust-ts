// Port of object 0.39.1 `src/read/elf/symbol.rs` (the `SymbolTable` that `ElfFile::parse` builds).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see file.ts for the dictionary encoding of `Elf: FileHeader`. The symbol entries stay an
// undecoded `PodSlice` (decoded on access). Not ported (unused on rustc's path): most of the `Sym` trait and of `ElfSymbol`
// (only what `ar_archive_writer`'s `get_native_object_symbols` asks) and symbol lookups/maps.

import { Err, Ok, type Result as StdResult } from "../../../../std/result.ts";
import * as elf from "../../elf.ts";
import type { SymbolKind } from "../../common.ts";
import { type Endianness, U16, U32 } from "../../endian.ts";
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

/** `.read_error("Invalid ELF symbol name offset")` on `StringTable::get`'s `Result<_, ()>`. */
const read_error_opt_result = (r: StdResult<Uint8Array, undefined>): Result<Uint8Array> => (r.$ === "Ok" ? r : Err(new Error("Invalid ELF symbol name offset")));

/** `elf::Sym32<Endianness>` / `elf::Sym64<Endianness>` (`Elf::Sym`). */
type SymValue = elf.Sym32 | elf.Sym64;

/// An iterator for the symbols in an [`ElfFile32`](super::ElfFile32) or [`ElfFile64`](super::ElfFile64).
export class ElfSymbolIterator implements IterableIterator<ElfSymbol> {
  private index: number;

  // crate: object-0.39.1/src/read/elf/symbol.rs:287 new
  constructor(
    readonly endian: Endianness,
    readonly symbols: SymbolTable,
  ) {
    this.index = 1;
  }

  [Symbol.iterator](): this {
    return this;
  }

  // crate: object-0.39.1/src/read/elf/symbol.rs:309 next
  next(): IteratorResult<ElfSymbol> {
    const index = this.index;
    const symbol = this.symbols.symbols_.get(index);
    if (symbol === undefined) return { done: true, value: undefined };
    this.index += 1;
    return { done: false, value: new ElfSymbol(this.endian, this.symbols, SymbolIndex(index), symbol as SymValue) };
  }
}

/// A symbol in an [`ElfFile32`](super::ElfFile32) or [`ElfFile64`](super::ElfFile64).
export class ElfSymbol {
  constructor(
    readonly endian: Endianness,
    readonly symbols: SymbolTable,
    readonly index: SymbolIndex,
    readonly symbol: SymValue,
  ) {}

  // crate: object-0.39.1/src/read/elf/symbol.rs:376 name_bytes
  name_bytes(): Result<Uint8Array> {
    // `self.symbol.name(self.endian, self.symbols.strings())` (`Sym::name`)
    return read_error_opt_result(this.symbols.strings().get(U32.get(this.symbol.st_name, this.endian)));
  }

  // crate: object-0.39.1/src/read/elf/symbol.rs:397 kind
  kind(): SymbolKind {
    switch (this.symbol.st_type()) {
      case elf.STT_NOTYPE:
        return "Unknown";
      case elf.STT_OBJECT:
      case elf.STT_COMMON:
        return "Data";
      case elf.STT_FUNC:
      case elf.STT_GNU_IFUNC:
        return "Text";
      case elf.STT_SECTION:
        return "Section";
      case elf.STT_FILE:
        return "File";
      case elf.STT_TLS:
        return "Tls";
      default:
        return "Unknown";
    }
  }

  // crate: object-0.39.1/src/read/elf/symbol.rs:433 is_undefined
  is_undefined(): boolean {
    // `self.symbol.is_undefined(self.endian)`
    return U16.get(this.symbol.st_shndx, this.endian) === elf.SHN_UNDEF;
  }

  // crate: object-0.39.1/src/read/elf/symbol.rs:472 is_global
  is_global(): boolean {
    // `!self.symbol.is_local()`
    return !(this.symbol.st_bind() === elf.STB_LOCAL);
  }
}
