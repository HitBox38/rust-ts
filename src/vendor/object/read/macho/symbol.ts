// Port of object 0.39.1 `src/read/macho/symbol.rs` (the `SymbolTable` that `MachOFile::parse`
// builds).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see ../elf/file.ts for the dictionary encoding of `Mach: MachHeader`. The `Nlist`
// entries stay a `PodSlice` of `macho::Nlist32`/`Nlist64`, whose fields the `Nlist` trait reads (inlined, as in
// ../elf/symbol.ts). `MachOSymbolIterator` and the `MachOSymbol` methods ar_archive_writer's symbol table reads (its
// `ObjectSymbol` part up to `is_local`) are ported (lane object-write-macho); not ported (unused on rustc's path): the
// rest of `MachOSymbol`, `MachOSymbolTable`, symbol and object maps.

import type { SymbolKind, SymbolScope } from "../../common.ts";
import { U16, U32, U64, type Endianness } from "../../endian.ts";
import * as macho from "../../macho.ts";
import { PodSlice } from "../../pod.ts";
import { read_error_opt, type Result, type SymbolIndex, SymbolIndex as SymbolIndexOf, SymbolSection, SectionIndex } from "../mod.ts";
import { StringTable } from "../util.ts";
import type { MachHeader, MachOFile } from "./file.ts";

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

/** `Mach::Nlist`: a `macho::Nlist32` or `macho::Nlist64`. */
type NlistValue = macho.Nlist32 | macho.Nlist64;

/** `Nlist::n_value` of either struct: `U32` or `U64`. */
function nlist_n_value(nlist: NlistValue, endian: Endianness): number {
  return typeof nlist.n_value === "number" ? U32.get(nlist.n_value, endian) : U64.get(nlist.n_value, endian);
}

/// An iterator for the symbols in a [`MachOFile`].
export class MachOSymbolIterator implements IterableIterator<MachOSymbol> {
  private constructor(
    private readonly file: MachOFile,
    private index: SymbolIndex,
  ) {}

  // crate: object-0.39.1/src/read/macho/symbol.rs:236 new
  static new(file: MachOFile): MachOSymbolIterator {
    return new MachOSymbolIterator(file, SymbolIndexOf(0));
  }

  [Symbol.iterator](): this {
    return this;
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:268 next
  next(): IteratorResult<MachOSymbol> {
    for (;;) {
      const index = this.index;
      const nlist = this.file.symbols.symbols.get(index) as NlistValue | undefined;
      if (nlist === undefined) return { done: true, value: undefined };
      this.index = SymbolIndexOf(this.index + 1);
      const symbol = MachOSymbol.new(this.file, index, nlist);
      if (symbol !== undefined) {
        return { done: false, value: symbol };
      }
    }
  }
}

/// A symbol in a [`MachOFile`].
///
/// Most functionality is provided by the [`ObjectSymbol`] trait implementation.
export class MachOSymbol {
  private constructor(
    readonly file: MachOFile,
    readonly index_: SymbolIndex,
    readonly nlist: NlistValue,
  ) {}

  // crate: object-0.39.1/src/read/macho/symbol.rs:306 new
  static new(file: MachOFile, index: SymbolIndex, nlist: NlistValue): MachOSymbol | undefined {
    if ((nlist.n_type & macho.N_STAB) !== 0) {
      return undefined;
    }
    return new MachOSymbol(file, index, nlist);
  }

  // impl ObjectSymbol for MachOSymbol

  // crate: object-0.39.1/src/read/macho/symbol.rs:341 index
  index(): SymbolIndex {
    return this.index_;
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:345 name_bytes
  name_bytes(): Result<Uint8Array> {
    // `self.nlist.name(self.file.endian, self.file.symbols.strings)` (`Nlist::name`)
    const r = this.file.symbols.strings().get(U32.get(this.nlist.n_strx, this.file.endian()));
    return read_error_opt(r.$ === "Ok" ? r._0 : undefined, "Invalid Mach-O symbol name offset");
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:357 address
  address(): number {
    return nlist_n_value(this.nlist, this.file.endian());
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:366 kind
  kind(): SymbolKind {
    const section_index = SymbolSection.index(this.section());
    if (section_index === undefined) return "Unknown";
    const s = this.file.section_internal(section_index);
    if (s.$ !== "Ok") return "Unknown";
    const section = s._0;
    const name = this.name_bytes();
    if (name.$ === "Ok") {
      const n = name._0;
      // Heuristic to match LLVM's convention for section symbols; may misclassify.
      if (
        this.is_local() &&
        n.length > 4 &&
        n[0] === 0x6c && // l
        n[1] === 0x74 && // t
        n[2] === 0x6d && // m
        n[3] === 0x70 && // p
        n.subarray(4).every((b) => b >= 0x30 && b <= 0x39) &&
        this.address() === this.file.Mach.Section.addr(section.section, this.file.endian())
      ) {
        return "Section";
      }
    }
    switch (section.kind.$) {
      case "Text":
        return "Text";
      case "Data":
      case "ReadOnlyData":
      case "ReadOnlyString":
      case "UninitializedData":
      case "Common":
        return "Data";
      case "Tls":
      case "UninitializedTls":
      case "TlsVariables":
        return "Tls";
      default:
        return "Unknown";
    }
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:398 section
  section(): SymbolSection {
    switch (this.nlist.n_type & macho.N_TYPE) {
      case macho.N_UNDF:
        return { $: "Undefined" };
      case macho.N_ABS:
        return { $: "Absolute" };
      case macho.N_SECT: {
        const n_sect = this.nlist.n_sect;
        if (n_sect !== 0) {
          return { $: "Section", _0: SectionIndex(n_sect) };
        } else {
          return { $: "Unknown" };
        }
      }
      default:
        return { $: "Unknown" };
    }
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:415 is_undefined
  is_undefined(): boolean {
    return (this.nlist.n_type & macho.N_TYPE) === macho.N_UNDF;
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:431 is_weak
  is_weak(): boolean {
    return (U16.get(this.nlist.n_desc, this.file.endian()) & (macho.N_WEAK_REF | macho.N_WEAK_DEF)) !== 0;
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:435 scope
  scope(): SymbolScope {
    const n_type = this.nlist.n_type;
    if ((n_type & macho.N_TYPE) === macho.N_UNDF) {
      return "Unknown";
    } else if ((n_type & macho.N_EXT) === 0) {
      return "Compilation";
    } else if ((n_type & macho.N_PEXT) !== 0) {
      return "Linkage";
    } else {
      return "Dynamic";
    }
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:449 is_global
  is_global(): boolean {
    return this.scope() !== "Compilation";
  }

  // crate: object-0.39.1/src/read/macho/symbol.rs:454 is_local
  is_local(): boolean {
    return this.scope() === "Compilation";
  }
}
