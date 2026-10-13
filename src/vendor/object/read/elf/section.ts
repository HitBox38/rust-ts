// Port of object 0.39.1 `src/read/elf/section.rs` (the section table, `ElfSection`'s data/name
// access, and the `SectionHeader` trait's accessors).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see file.ts for the dictionary encoding of `Elf: FileHeader`; `SectionHeader` is encoded
// the same way (`SectionHeader32_impl` / `SectionHeader64_impl`, provided methods in
// `SectionHeader_provided`). `SectionTable` keeps its `Elf` dictionary in a field.
// Not ported (unused on rustc's path): dynamic/hash/version tables, notes, groups, relocations
// and compression accessors, `ElfSection::kind`/`flags`/`relocations`.

import { Err, Ok } from "../../../../std/result.ts";
import * as elf from "../../elf.ts";
import { type Endianness, U32, U64 } from "../../endian.ts";
import { type Pod, PodSlice, slice_from_all_bytes } from "../../pod.ts";
import { Error, read_error_err, read_error_opt, read_error_unit, type Result, SectionIndex } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import { type ObjectSection, str_from_utf8 } from "../traits.ts";
import { bytes_eq, data_range, StringTable } from "../util.ts";
import type { ElfFile, FileHeader } from "./file.ts";
import { RelocationSections } from "./relocation.ts";
import { SymbolTable } from "./symbol.ts";

/** `elf::SectionHeader32<Endianness>` / `elf::SectionHeader64<Endianness>`. */
export type SectionHeaderValue = elf.SectionHeader32 | elf.SectionHeader64;

/// The table of section headers in an ELF file.
///
/// Also includes the string table used for the section names.
///
/// Returned by [`FileHeader::sections`].
export class SectionTable {
  constructor(
    /** PORT: the `Elf: FileHeader` type parameter. */
    readonly Elf: FileHeader,
    readonly sections: PodSlice<SectionHeaderValue>,
    readonly strings_: StringTable,
  ) {}

  // crate: object-0.39.1/src/read/elf/section.rs:34 default
  static default(Elf: FileHeader): SectionTable {
    return new SectionTable(Elf, PodSlice.empty(Elf.SectionHeader.POD), StringTable.default());
  }

  /// Create a new section table.
  // crate: object-0.39.1/src/read/elf/section.rs:45 new
  static new(Elf: FileHeader, sections: PodSlice<SectionHeaderValue>, strings: StringTable): SectionTable {
    return new SectionTable(Elf, sections, strings);
  }

  /// Iterate over the section headers.
  ///
  /// This includes the null section at index 0, which you will usually need to skip.
  // crate: object-0.39.1/src/read/elf/section.rs:53 iter
  iter(): IterableIterator<SectionHeaderValue> {
    return this.sections[Symbol.iterator]();
  }

  /// Iterate over the section headers and their indices.
  ///
  /// This includes the null section at index 0, which you will usually need to skip.
  // crate: object-0.39.1/src/read/elf/section.rs:61 enumerate
  *enumerate(): IterableIterator<[SectionIndex, SectionHeaderValue]> {
    let i = 0;
    for (const section of this.sections) yield [SectionIndex(i++), section];
  }

  /// Return true if the section table is empty.
  // crate: object-0.39.1/src/read/elf/section.rs:70 is_empty
  is_empty(): boolean {
    return this.sections.is_empty();
  }

  /// The number of section headers.
  // crate: object-0.39.1/src/read/elf/section.rs:76 len
  len(): number {
    return this.sections.len();
  }

  /// Get the section header at the given index.
  ///
  /// Returns an error for the null section at index 0.
  // crate: object-0.39.1/src/read/elf/section.rs:83 section
  section(index: SectionIndex): Result<SectionHeaderValue> {
    if (index === SectionIndex(0)) {
      return Err(new Error("Invalid ELF section index"));
    }
    return read_error_opt(this.sections.get(index), "Invalid ELF section index");
  }

  /// Return the section header with the given name.
  ///
  /// Ignores sections with invalid names.
  // crate: object-0.39.1/src/read/elf/section.rs:95 section_by_name
  section_by_name(endian: Endianness, name: Uint8Array): [SectionIndex, SectionHeaderValue] | undefined {
    for (const [i, section] of this.enumerate()) {
      const n = this.section_name(endian, section);
      if (n.$ === "Ok" && bytes_eq(n._0, name)) return [i, section];
    }
    return undefined;
  }

  /// Return the section name for the given section header.
  // crate: object-0.39.1/src/read/elf/section.rs:105 section_name
  section_name(endian: Endianness, section: SectionHeaderValue): Result<Uint8Array> {
    return SectionHeader_provided.name(this.Elf.SectionHeader, section, endian, this.strings_);
  }

  /// Return the string table at the given section index.
  ///
  /// Returns an empty string table if the index is 0.
  /// Returns an error if the section is not a string table.
  // crate: object-0.39.1/src/read/elf/section.rs:118 strings
  strings(endian: Endianness, data: Uint8Array, index: SectionIndex): Result<StringTable> {
    if (index === SectionIndex(0)) {
      return Ok(StringTable.default());
    }
    const section = this.section(index);
    if (section.$ === "Err") return section;
    const strings = SectionHeader_provided.strings(this.Elf.SectionHeader, section._0, endian, data);
    if (strings.$ === "Err") return strings;
    return read_error_opt(strings._0, "Invalid ELF string section type");
  }

  /// Return the symbol table of the given section type.
  ///
  /// Returns an empty symbol table if the symbol table does not exist.
  // crate: object-0.39.1/src/read/elf/section.rs:136 symbols
  symbols(endian: Endianness, data: Uint8Array, sh_type: number): Result<SymbolTable> {
    // debug_assert!(sh_type == elf::SHT_DYNSYM || sh_type == elf::SHT_SYMTAB);

    let found: [SectionIndex, SectionHeaderValue] | undefined;
    for (const s of this.enumerate()) {
      if (this.Elf.SectionHeader.sh_type(s[1], endian) === sh_type) {
        found = s;
        break;
      }
    }
    if (found === undefined) return Ok(SymbolTable.default(this.Elf));
    const [index, section] = found;

    return SymbolTable.parse(endian, data, this, index, section);
  }

  /// Return the symbol table at the given section index.
  ///
  /// Returns an error if the section is not a symbol table.
  // crate: object-0.39.1/src/read/elf/section.rs:156 symbol_table_by_index
  symbol_table_by_index(endian: Endianness, data: Uint8Array, index: SectionIndex): Result<SymbolTable> {
    const section = this.section(index);
    if (section.$ === "Err") return section;
    switch (this.Elf.SectionHeader.sh_type(section._0, endian)) {
      case elf.SHT_DYNSYM:
      case elf.SHT_SYMTAB:
        break;
      default:
        return Err(new Error("Invalid ELF symbol table section type"));
    }
    return SymbolTable.parse(endian, data, this, index, section._0);
  }

  /// Create a mapping from section index to associated relocation sections.
  // crate: object-0.39.1/src/read/elf/section.rs:172 relocation_sections
  relocation_sections(endian: Endianness, symbol_section: SectionIndex): Result<RelocationSections> {
    return RelocationSections.parse(endian, this, symbol_section);
  }
}

/// An iterator for the sections in an [`ElfFile`].
export class ElfSectionIterator implements Iterable<ElfSection> {
  constructor(
    readonly file: ElfFile,
    readonly iter: Iterator<[SectionIndex, SectionHeaderValue]>,
  ) {}

  // crate: object-0.39.1/src/read/elf/section.rs:387 new
  static new(file: ElfFile): ElfSectionIterator {
    const iter = file.sections_.enumerate();
    iter.next(); // Skip null section.
    return new ElfSectionIterator(file, iter);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:401 next
  next(): ElfSection | undefined {
    const r = this.iter.next();
    if (r.done) return undefined;
    const [index, section] = r.value;
    return new ElfSection(this.file, index, section);
  }

  *[Symbol.iterator](): IterableIterator<ElfSection> {
    for (;;) {
      const s = this.next();
      if (s === undefined) return;
      yield s;
    }
  }
}

/// A section in an [`ElfFile`].
///
/// Most functionality is provided by the [`ObjectSection`] trait implementation.
export class ElfSection implements ObjectSection {
  constructor(
    readonly file: ElfFile,
    readonly index_: SectionIndex,
    readonly section: SectionHeaderValue,
  ) {}

  /// Get the ELF file containing this section.
  // crate: object-0.39.1/src/read/elf/section.rs:433 elf_file
  elf_file(): ElfFile {
    return this.file;
  }

  /// Get the raw ELF section header.
  // crate: object-0.39.1/src/read/elf/section.rs:438 elf_section_header
  elf_section_header(): SectionHeaderValue {
    return this.section;
  }

  /// Get the index of the relocation section that references this section.
  ///
  /// Returns `None` if there are no relocations.
  /// Returns an error if there are multiple relocation sections that reference this section.
  // crate: object-0.39.1/src/read/elf/section.rs:446 elf_relocation_section_index
  elf_relocation_section_index(): Result<SectionIndex | undefined> {
    const relocation_index = this.file.relocations.get(this.index_);
    if (relocation_index === undefined) {
      return Ok(undefined);
    }
    if (this.file.relocations.get(relocation_index) !== undefined) {
      return Err(new Error("Unsupported ELF section with multiple relocation sections"));
    }
    return Ok(relocation_index);
  }

  /// Get the relocation section that references this section.
  ///
  /// Returns `None` if there are no relocations.
  /// Returns an error if there are multiple relocation sections that reference this section.
  // crate: object-0.39.1/src/read/elf/section.rs:462 elf_relocation_section
  elf_relocation_section(): Result<SectionHeaderValue | undefined> {
    const r = this.elf_relocation_section_index();
    if (r.$ === "Err") return r;
    const relocation_index = r._0;
    if (relocation_index === undefined) {
      return Ok(undefined);
    }
    return this.file.sections_.section(relocation_index);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:499 bytes
  bytes(): Result<Uint8Array> {
    return read_error_err(
      SectionHeader_provided.data(this.file.Elf.SectionHeader, this.section, this.file.endian_, this.file.data_),
      "Invalid ELF section size or offset",
    );
  }

  // impl ObjectSection for ElfSection

  // crate: object-0.39.1/src/read/elf/section.rs:558 index
  index(): SectionIndex {
    return this.index_;
  }

  // crate: object-0.39.1/src/read/elf/section.rs:563 address
  address(): number {
    return this.file.Elf.SectionHeader.sh_addr(this.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:568 size
  size(): number {
    return this.file.Elf.SectionHeader.sh_size(this.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:573 align
  align(): number {
    return this.file.Elf.SectionHeader.sh_addralign(this.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:578 file_range
  file_range(): [number, number] | undefined {
    return SectionHeader_provided.file_range(this.file.Elf.SectionHeader, this.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:583 data
  data(): Result<Uint8Array> {
    return this.bytes();
  }

  // crate: object-0.39.1/src/read/elf/section.rs:587 data_range
  data_range(address: number, size: number): Result<Uint8Array | undefined> {
    const bytes = this.bytes();
    if (bytes.$ === "Err") return bytes;
    return Ok(data_range(bytes._0, this.address(), address, size));
  }

  // crate: object-0.39.1/src/read/elf/section.rs:610 name_bytes
  name_bytes(): Result<Uint8Array> {
    return this.file.sections_.section_name(this.file.endian_, this.section);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:616 name
  name(): Result<string> {
    const name = this.name_bytes();
    if (name.$ === "Err") return name;
    return read_error_opt(str_from_utf8(name._0), "Non UTF-8 ELF section name");
  }

  // crate: object-0.39.1/src/read/elf/section.rs:624 segment_name_bytes
  segment_name_bytes(): Result<Uint8Array | undefined> {
    return Ok(undefined);
  }

  // crate: object-0.39.1/src/read/elf/section.rs:629 segment_name
  segment_name(): Result<string | undefined> {
    return Ok(undefined);
  }
}

/// A trait for generic access to [`elf::SectionHeader32`] and [`elf::SectionHeader64`].
export interface SectionHeader {
  // type Elf: FileHeader<SectionHeader = Self, Endian = Self::Endian, Word = Self::Word>;
  //   (PORT: callers that need it pass the `Elf` dictionary)
  // type Word: Into<u64>;   (number)
  // type Endian: endian::Endian;   (Endianness)
  /** `Self: Pod` */
  readonly POD: Pod<SectionHeaderValue>;

  sh_name(self: SectionHeaderValue, endian: Endianness): number;
  sh_type(self: SectionHeaderValue, endian: Endianness): number;
  sh_flags(self: SectionHeaderValue, endian: Endianness): number;
  sh_addr(self: SectionHeaderValue, endian: Endianness): number;
  sh_offset(self: SectionHeaderValue, endian: Endianness): number;
  sh_size(self: SectionHeaderValue, endian: Endianness): number;
  sh_link(self: SectionHeaderValue, endian: Endianness): number;
  sh_info(self: SectionHeaderValue, endian: Endianness): number;
  sh_addralign(self: SectionHeaderValue, endian: Endianness): number;
  sh_entsize(self: SectionHeaderValue, endian: Endianness): number;

  // (provided) name
  // (provided) link
  // (provided) has_info_link
  // (provided) info_link
  // (provided) file_range
  // (provided) data
  // (provided) data_as_array
  // (provided) strings
  // (provided) symbols
}

export const SectionHeader_provided = {
  /// Parse the section name from the string table.
  // crate: object-0.39.1/src/read/elf/section.rs:718 name
  name(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness, strings: StringTable): Result<Uint8Array> {
    return read_error_unit(strings.get(Self.sh_name(self, endian)), "Invalid ELF section name offset");
  },

  /// Get the `sh_link` field as a section index.
  ///
  /// This may return a null section index, and does not check for validity.
  // crate: object-0.39.1/src/read/elf/section.rs:731 link
  link(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness): SectionIndex {
    return SectionIndex(Self.sh_link(self, endian));
  },

  /// Return true if the `SHF_INFO_LINK` flag is set.
  // crate: object-0.39.1/src/read/elf/section.rs:736 has_info_link
  has_info_link(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness): boolean {
    // PORT: `sh_flags` is exact below 2^53; SHF_INFO_LINK is bit 6, so the low 32 bits suffice
    // (ToInt32 of an integer < 2^53 keeps its low 32 bits).
    return (Self.sh_flags(self, endian) & elf.SHF_INFO_LINK) !== 0;
  },

  /// Get the `sh_info` field as a section index.
  ///
  /// This does not check the `SHF_INFO_LINK` flag.
  /// This may return a null section index, and does not check for validity.
  // crate: object-0.39.1/src/read/elf/section.rs:744 info_link
  info_link(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness): SectionIndex {
    return SectionIndex(Self.sh_info(self, endian));
  },

  /// Return the offset and size of the section in the file.
  ///
  /// Returns `None` for sections that have no data in the file.
  // crate: object-0.39.1/src/read/elf/section.rs:751 file_range
  file_range(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness): [number, number] | undefined {
    if (Self.sh_type(self, endian) === elf.SHT_NOBITS) {
      return undefined;
    } else {
      return [Self.sh_offset(self, endian), Self.sh_size(self, endian)];
    }
  },

  /// Return the section data.
  ///
  /// Returns `Ok(&[])` if the section has no data.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/section.rs:763 data
  data(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness, data: Uint8Array): Result<Uint8Array> {
    const range = SectionHeader_provided.file_range(Self, self, endian);
    if (range !== undefined) {
      const [offset, size] = range;
      return read_error_unit(ReadRef.read_bytes_at(data, offset, size), "Invalid ELF section size or offset");
    } else {
      return Ok(new Uint8Array(0));
    }
  },

  /// Return the section data as a slice of the given type.
  ///
  /// Allows padding at the end of the data.
  /// Returns `Ok(&[])` if the section has no data.
  /// Returns `Err` for invalid values, including bad alignment.
  // crate: object-0.39.1/src/read/elf/section.rs:781 data_as_array
  data_as_array<T>(Self: SectionHeader, self: SectionHeaderValue, T: Pod<T>, endian: Endianness, data: Uint8Array): Result<PodSlice<T>> {
    const d = SectionHeader_provided.data(Self, self, endian, data);
    if (d.$ === "Err") return d;
    return read_error_unit(slice_from_all_bytes(T, d._0), "Invalid ELF section size or offset");
  },

  /// Return the strings in the section.
  ///
  /// Returns `Ok(None)` if the section does not contain strings.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/section.rs:794 strings
  strings(Self: SectionHeader, self: SectionHeaderValue, endian: Endianness, data: Uint8Array): Result<StringTable | undefined> {
    if (Self.sh_type(self, endian) !== elf.SHT_STRTAB) {
      return Ok(undefined);
    }
    const str_offset = Self.sh_offset(self, endian);
    const str_size = Self.sh_size(self, endian);
    // `str_offset.checked_add(str_size)`
    const str_end = str_offset + str_size;
    if (str_end > U64_MAX) return Err(new Error("Invalid ELF string section offset or size"));
    return Ok(StringTable.new(data, str_offset, str_end));
  },

  /// Return the symbols in the section.
  ///
  /// Also finds the linked string table in `sections`.
  ///
  /// `section_index` must be the 0-based index of this section, and is used
  /// to find the corresponding extended section index table in `sections`.
  ///
  /// Returns `Ok(None)` if the section does not contain symbols.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/section.rs:819 symbols
  symbols(
    Self: SectionHeader,
    self: SectionHeaderValue,
    endian: Endianness,
    data: Uint8Array,
    sections: SectionTable,
    section_index: SectionIndex,
  ): Result<SymbolTable | undefined> {
    const sh_type = Self.sh_type(self, endian);
    if (sh_type !== elf.SHT_SYMTAB && sh_type !== elf.SHT_DYNSYM) {
      return Ok(undefined);
    }
    return SymbolTable.parse(endian, data, sections, section_index, self);
  },
};

/** `u64::MAX` as a `number` (rounded; see endian.ts). */
const U64_MAX = 2 ** 64 - 1;

/// `impl<Endian: endian::Endian> SectionHeader for elf::SectionHeader32<Endian>`
export const SectionHeader32_impl: SectionHeader = {
  POD: elf.SectionHeader32.POD,

  // crate: object-0.39.1/src/read/elf/section.rs:1211 sh_name
  sh_name(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_name, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1216 sh_type
  sh_type(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_type, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1221 sh_flags
  sh_flags(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_flags, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1226 sh_addr
  sh_addr(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_addr, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1231 sh_offset
  sh_offset(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_offset, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1236 sh_size
  sh_size(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_size, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1241 sh_link
  sh_link(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_link, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1246 sh_info
  sh_info(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_info, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1251 sh_addralign
  sh_addralign(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_addralign, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1256 sh_entsize
  sh_entsize(self: elf.SectionHeader32, endian: Endianness): number {
    return U32.get(self.sh_entsize, endian);
  },
} as SectionHeader;

/// `impl<Endian: endian::Endian> SectionHeader for elf::SectionHeader64<Endian>`
export const SectionHeader64_impl: SectionHeader = {
  POD: elf.SectionHeader64.POD,

  // crate: object-0.39.1/src/read/elf/section.rs:1267 sh_name
  sh_name(self: elf.SectionHeader64, endian: Endianness): number {
    return U32.get(self.sh_name, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1272 sh_type
  sh_type(self: elf.SectionHeader64, endian: Endianness): number {
    return U32.get(self.sh_type, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1277 sh_flags
  sh_flags(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_flags, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1282 sh_addr
  sh_addr(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_addr, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1287 sh_offset
  sh_offset(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_offset, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1292 sh_size
  sh_size(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_size, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1297 sh_link
  sh_link(self: elf.SectionHeader64, endian: Endianness): number {
    return U32.get(self.sh_link, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1302 sh_info
  sh_info(self: elf.SectionHeader64, endian: Endianness): number {
    return U32.get(self.sh_info, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1307 sh_addralign
  sh_addralign(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_addralign, endian);
  },

  // crate: object-0.39.1/src/read/elf/section.rs:1312 sh_entsize
  sh_entsize(self: elf.SectionHeader64, endian: Endianness): number {
    return U64.get(self.sh_entsize, endian);
  },
} as SectionHeader;

