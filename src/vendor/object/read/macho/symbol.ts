// Port of object 0.39.1 `src/read/macho/symbol.rs` (the `SymbolTable` that `MachOFile::parse`
// builds).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see ../elf/file.ts for the dictionary encoding of `Mach: MachHeader`. The `Nlist`
// entries stay an undecoded `PodSlice`. Not ported (unused on rustc's path): the `Nlist` trait,
// `MachOSymbol*`, symbol and object maps.

import { PodSlice } from "../../pod.ts";
import { read_error_opt, type Result, type SymbolIndex } from "../mod.ts";
import { StringTable } from "../util.ts";
import type { MachHeader } from "./file.ts";

/// A table of symbol entries in a Mach-O file.
///
/// Also includes the string table used for the symbol names.
///
/// Returned by [`macho::SymtabCommand::symbols`].
export class SymbolTable {
  constructor(
    /** PORT: the `Mach: MachHeader` type parameter. */
    readonly Mach: MachHeader,
    readonly symbols: PodSlice<unknown>,
    readonly strings_: StringTable,
  ) {}

  // crate: object-0.39.1/src/read/macho/symbol.rs:32 default
  static default(Mach: MachHeader): SymbolTable {
    return new SymbolTable(Mach, PodSlice.empty(Mach.Nlist), StringTable.default());
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:42 new
  static new(Mach: MachHeader, symbols: PodSlice<unknown>, strings: StringTable): SymbolTable {
    return new SymbolTable(Mach, symbols, strings);
  }

  /// Return the string table used for the symbol names.
  // crate: object-0.39.1/src/read/macho/symbol.rs:48 strings
  strings(): StringTable {
    return this.strings_;
  }

  /// Iterate over the symbols.
  // crate: object-0.39.1/src/read/macho/symbol.rs:54 iter
  iter(): IterableIterator<unknown> {
    return this.symbols[Symbol.iterator]();
  }

  /// Return true if the symbol table is empty.
  // crate: object-0.39.1/src/read/macho/symbol.rs:60 is_empty
  is_empty(): boolean {
    return this.symbols.is_empty();
  }

  /// The number of symbols.
  // crate: object-0.39.1/src/read/macho/symbol.rs:66 len
  len(): number {
    return this.symbols.len();
  }

  /// Return the symbol at the given index.
  // crate: object-0.39.1/src/read/macho/symbol.rs:71 symbol
  symbol(index: SymbolIndex): Result<unknown> {
    return read_error_opt(this.symbols.get(index), "Invalid Mach-O symbol index");
  }
}
