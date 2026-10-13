// Port of object 0.39.1 `src/read/elf/file.rs` (parsing and the `Object` methods the metadata
// reader uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the generic `Elf: FileHeader` parameter is a dictionary value (`FileHeader`): the trait's
// required methods plus its associated types (`SectionHeader` as that trait's dictionary, and the
// `Pod`s of `Self`, `ProgramHeader`, `Sym`). `FileHeader32_impl` / `FileHeader64_impl` are the two
// `impl FileHeader for elf::FileHeader{32,64}<Endianness>`; the provided methods are
// `FileHeader_provided` and take the dictionary first. Structs generic over `Elf` store it in an
// `Elf` field. `Endian` is `Endianness`: `File::parse` (the only entry point rustc uses)
// instantiates the ELF types with it.
// PORT: rustc builds object without the `compression` feature, so `zdebug_section_by_name` is the
// `cfg(not(feature = "compression"))` one (line 186).
// Not ported (unused on rustc's path): `architecture`, segments/comdats/symbol iterators,
// imports/exports, build ids/debug links, `flags`.

import { Err, Ok } from "../../../../std/result.ts";
import * as elf from "../../elf.ts";
import { type EndianType, Endianness, U16, U32, U64 } from "../../endian.ts";
import { type Pod, PodSlice } from "../../pod.ts";
import { Error, type ObjectKind, read_error_opt, read_error_unit, type Result, SectionIndex } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import type { Object } from "../traits.ts";
import { StringTable } from "../util.ts";
import { RelocationSections } from "./relocation.ts";
import {
  ElfSection,
  ElfSectionIterator,
  type SectionHeader,
  SectionHeader32_impl,
  SectionHeader64_impl,
  SectionHeader_provided,
  type SectionHeaderValue,
  SectionTable,
} from "./section.ts";
import { SymbolTable } from "./symbol.ts";

/** `elf::FileHeader32<Endianness>` / `elf::FileHeader64<Endianness>` (the `Self` of `FileHeader`). */
export type FileHeaderValue = elf.FileHeader32 | elf.FileHeader64;

/// A 32-bit ELF object file.
///
/// This is a file that starts with [`elf::FileHeader32`], and corresponds
/// to [`crate::FileKind::Elf32`].
export const ElfFile32 = {
  parse(data: Uint8Array): Result<ElfFile> {
    return ElfFile.parse(FileHeader32_impl, data);
  },
};

/// A 64-bit ELF object file.
///
/// This is a file that starts with [`elf::FileHeader64`], and corresponds
/// to [`crate::FileKind::Elf64`].
export const ElfFile64 = {
  parse(data: Uint8Array): Result<ElfFile> {
    return ElfFile.parse(FileHeader64_impl, data);
  },
};

/// A partially parsed ELF file.
///
/// Most functionality is provided by the [`Object`] trait implementation.
export class ElfFile implements Object<ElfSection> {
  constructor(
    /** PORT: the `Elf: FileHeader` type parameter. */
    readonly Elf: FileHeader,
    readonly endian_: Endianness,
    readonly data_: Uint8Array,
    readonly header: FileHeaderValue,
    readonly segments: PodSlice<unknown>,
    readonly sections_: SectionTable,
    readonly relocations: RelocationSections,
    readonly symbols: SymbolTable,
    readonly dynamic_symbols: SymbolTable,
  ) {}

  /// Parse the raw ELF file data.
  // crate: object-0.39.1/src/read/elf/file.rs:68 parse
  static parse(Elf: FileHeader, data: Uint8Array): Result<ElfFile> {
    const h = FileHeader_provided.parse(Elf, data);
    if (h.$ === "Err") return h;
    const header = h._0;
    const e = FileHeader_provided.endian(Elf, header);
    if (e.$ === "Err") return e;
    const endian = e._0;
    const segments = FileHeader_provided.program_headers(Elf, header, endian, data);
    if (segments.$ === "Err") return segments;
    const sections = FileHeader_provided.sections(Elf, header, endian, data);
    if (sections.$ === "Err") return sections;
    const symbols = sections._0.symbols(endian, data, elf.SHT_SYMTAB);
    if (symbols.$ === "Err") return symbols;
    // TODO: get dynamic symbols from DT_SYMTAB if there are no sections
    const dynamic_symbols = sections._0.symbols(endian, data, elf.SHT_DYNSYM);
    if (dynamic_symbols.$ === "Err") return dynamic_symbols;
    // The API we provide requires a mapping from section to relocations, so build it now.
    const relocations = sections._0.relocation_sections(endian, symbols._0.section());
    if (relocations.$ === "Err") return relocations;

    return Ok(
      new ElfFile(Elf, endian, data, header, segments._0, sections._0, relocations._0, symbols._0, dynamic_symbols._0),
    );
  }

  /// Returns the endianness.
  // crate: object-0.39.1/src/read/elf/file.rs:92 endian
  endian(): Endianness {
    return this.endian_;
  }

  /// Returns the raw data.
  // crate: object-0.39.1/src/read/elf/file.rs:97 data
  data(): Uint8Array {
    return this.data_;
  }

  /// Get the raw ELF file header.
  // crate: object-0.39.1/src/read/elf/file.rs:114 elf_header
  elf_header(): FileHeaderValue {
    return this.header;
  }

  /// Get the raw ELF program headers.
  ///
  /// Returns an empty slice if the file has no program headers.
  // crate: object-0.39.1/src/read/elf/file.rs:121 elf_program_headers
  elf_program_headers(): PodSlice<unknown> {
    return this.segments;
  }

  /// Get the ELF section table.
  ///
  /// Returns an empty section table if the file has no section headers.
  // crate: object-0.39.1/src/read/elf/file.rs:128 elf_section_table
  elf_section_table(): SectionTable {
    return this.sections_;
  }

  /// Get the ELF symbol table.
  ///
  /// Returns an empty symbol table if the file has no symbol table.
  // crate: object-0.39.1/src/read/elf/file.rs:135 elf_symbol_table
  elf_symbol_table(): SymbolTable {
    return this.symbols;
  }

  /// Get the ELF dynamic symbol table.
  ///
  /// Returns an empty symbol table if the file has no dynamic symbol table.
  // crate: object-0.39.1/src/read/elf/file.rs:142 elf_dynamic_symbol_table
  elf_dynamic_symbol_table(): SymbolTable {
    return this.dynamic_symbols;
  }

  /// Get a mapping for linked relocation sections.
  // crate: object-0.39.1/src/read/elf/file.rs:147 elf_relocation_sections
  elf_relocation_sections(): RelocationSections {
    return this.relocations;
  }

  // crate: object-0.39.1/src/read/elf/file.rs:158 raw_section_by_name
  raw_section_by_name(section_name: Uint8Array): ElfSection | undefined {
    const r = this.sections_.section_by_name(this.endian_, section_name);
    if (r === undefined) return undefined;
    const [index, section] = r;
    return new ElfSection(this, index, section);
  }

  // crate: object-0.39.1/src/read/elf/file.rs:186 zdebug_section_by_name
  zdebug_section_by_name(_section_name: Uint8Array): ElfSection | undefined {
    return undefined;
  }

  // impl Object for ElfFile

  // crate: object-0.39.1/src/read/elf/file.rs:307 is_little_endian
  is_little_endian(): boolean {
    return FileHeader_provided.is_little_endian(this.Elf, this.header);
  }

  // crate: object-0.39.1/src/read/elf/file.rs:312 is_64
  is_64(): boolean {
    return FileHeader_provided.is_class_64(this.Elf, this.header);
  }

  // crate: object-0.39.1/src/read/elf/file.rs:316 kind
  kind(): ObjectKind {
    switch (this.Elf.e_type(this.header, this.endian_)) {
      case elf.ET_REL:
        return "Relocatable";
      case elf.ET_EXEC:
        return "Executable";
      // TODO: check for `DF_1_PIE`?
      case elf.ET_DYN:
        return "Dynamic";
      case elf.ET_CORE:
        return "Core";
      default:
        return "Unknown";
    }
  }

  // crate: object-0.39.1/src/read/elf/file.rs:334 section_by_name_bytes
  section_by_name_bytes(section_name: Uint8Array): ElfSection | undefined {
    return this.raw_section_by_name(section_name) ?? this.zdebug_section_by_name(section_name);
  }

  // crate: object-0.39.1/src/read/elf/file.rs:342 section_by_index
  section_by_index(index: SectionIndex): Result<ElfSection> {
    const section = this.sections_.section(index);
    if (section.$ === "Err") return section;
    return Ok(new ElfSection(this, index, section._0));
  }

  // crate: object-0.39.1/src/read/elf/file.rs:351 sections
  sections(): ElfSectionIterator {
    return ElfSectionIterator.new(this);
  }
}

/// A trait for generic access to [`elf::FileHeader32`] and [`elf::FileHeader64`].
export interface FileHeader {
  // Ideally this would be a `u64: From<Word>`, but can't express that.
  // type Word: Into<u64> + Default + Copy;   (number)
  // type Sword: Into<i64>;
  /** `type Endian: endian::Endian;` */
  readonly Endian: EndianType<Endianness>;
  /** `type ProgramHeader` (its `Pod`). */
  readonly ProgramHeader: Pod<unknown>;
  /** `type SectionHeader` (its trait dictionary). */
  readonly SectionHeader: SectionHeader;
  /** `type Sym` (its `Pod`). */
  readonly Sym: Pod<unknown>;
  /** `Self: Pod` */
  readonly POD: Pod<FileHeaderValue>;

  /// Return true if this type is a 64-bit header.
  ///
  /// This is a property of the type, not a value in the header data.
  is_type_64(self: FileHeaderValue): boolean;

  /// Return true if this type is a 64-bit header.
  ///
  /// This is a property of the type, not a value in the header data.
  ///
  /// This is the same as [`Self::is_type_64`], but is non-dispatchable.
  is_type_64_sized(): boolean;

  e_ident(self: FileHeaderValue): elf.Ident;
  e_type(self: FileHeaderValue, endian: Endianness): number;
  e_machine(self: FileHeaderValue, endian: Endianness): number;
  e_version(self: FileHeaderValue, endian: Endianness): number;
  e_entry(self: FileHeaderValue, endian: Endianness): number;
  e_phoff(self: FileHeaderValue, endian: Endianness): number;
  e_shoff(self: FileHeaderValue, endian: Endianness): number;
  e_flags(self: FileHeaderValue, endian: Endianness): number;
  e_ehsize(self: FileHeaderValue, endian: Endianness): number;
  e_phentsize(self: FileHeaderValue, endian: Endianness): number;
  e_phnum(self: FileHeaderValue, endian: Endianness): number;
  e_shentsize(self: FileHeaderValue, endian: Endianness): number;
  e_shnum(self: FileHeaderValue, endian: Endianness): number;
  e_shstrndx(self: FileHeaderValue, endian: Endianness): number;

  // Provided methods: `FileHeader_provided`.
  // (provided) parse
  // (provided) is_supported
  // (provided) is_class_32
  // (provided) is_class_64
  // (provided) is_little_endian
  // (provided) is_big_endian
  // (provided) endian
  // (provided) section_0
  // (provided) phnum
  // (provided) shnum
  // (provided) shstrndx
  // (provided) program_headers
  // (provided) section_headers
  // (provided) section_strings_index
  // (provided) section_strings
  // (provided) sections
  // (provided) is_mips64el
}

export const FileHeader_provided = {
  /// Read the file header.
  ///
  /// Also checks that the ident field in the file header is a supported format.
  // crate: object-0.39.1/src/read/elf/file.rs:595 parse
  parse(Self: FileHeader, data: Uint8Array): Result<FileHeaderValue> {
    const h = read_error_unit(ReadRef.read_at(data, Self.POD, 0), "Invalid ELF header size or alignment");
    if (h.$ === "Err") return h;
    const header = h._0;
    if (!FileHeader_provided.is_supported(Self, header)) {
      return Err(new Error("Unsupported ELF header"));
    }
    // TODO: Check self.e_ehsize?
    return Ok(header);
  },

  /// Check that the ident field in the file header is a supported format.
  ///
  /// This checks the magic number, version, class, and endianness.
  // crate: object-0.39.1/src/read/elf/file.rs:609 is_supported
  is_supported(Self: FileHeader, self: FileHeaderValue): boolean {
    const ident = Self.e_ident(self);
    // TODO: Check self.e_version too? Requires endian though.
    return (
      bytes_eq4(ident.magic, elf.ELFMAG) &&
      (Self.is_type_64(self) || FileHeader_provided.is_class_32(Self, self)) &&
      (!Self.is_type_64(self) || FileHeader_provided.is_class_64(Self, self)) &&
      (FileHeader_provided.is_little_endian(Self, self) || FileHeader_provided.is_big_endian(Self, self)) &&
      ident.version === elf.EV_CURRENT
    );
  },

  // crate: object-0.39.1/src/read/elf/file.rs:619 is_class_32
  is_class_32(Self: FileHeader, self: FileHeaderValue): boolean {
    return Self.e_ident(self).class === elf.ELFCLASS32;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:623 is_class_64
  is_class_64(Self: FileHeader, self: FileHeaderValue): boolean {
    return Self.e_ident(self).class === elf.ELFCLASS64;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:627 is_little_endian
  is_little_endian(Self: FileHeader, self: FileHeaderValue): boolean {
    return Self.e_ident(self).data === elf.ELFDATA2LSB;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:631 is_big_endian
  is_big_endian(Self: FileHeader, self: FileHeaderValue): boolean {
    return Self.e_ident(self).data === elf.ELFDATA2MSB;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:635 endian
  endian(Self: FileHeader, self: FileHeaderValue): Result<Endianness> {
    return read_error_opt(Self.Endian.from_big_endian(FileHeader_provided.is_big_endian(Self, self)), "Unsupported ELF endian");
  },

  /// Return the first section header, if present.
  ///
  /// Section 0 is a special case because getting the section headers normally
  /// requires `shnum`, but `shnum` may be in the first section header.
  // crate: object-0.39.1/src/read/elf/file.rs:643 section_0
  section_0(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<SectionHeaderValue | undefined> {
    const shoff = Self.e_shoff(self, endian);
    if (shoff === 0) {
      // No section headers is ok.
      return Ok(undefined);
    }
    const shentsize = Self.e_shentsize(self, endian);
    if (shentsize !== Self.SectionHeader.POD.size) {
      // Section header size must match.
      return Err(new Error("Invalid ELF section header entry size"));
    }
    return read_error_unit(ReadRef.read_at(data, Self.SectionHeader.POD, shoff), "Invalid ELF section header offset or size");
  },

  /// Return the `e_phnum` field of the header. Handles extended values.
  ///
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/file.rs:666 phnum
  phnum(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<number> {
    const e_phnum = Self.e_phnum(self, endian);
    if (e_phnum < elf.PN_XNUM) {
      return Ok(e_phnum);
    }
    const s0 = FileHeader_provided.section_0(Self, self, endian, data);
    if (s0.$ === "Err") return s0;
    if (s0._0 !== undefined) {
      return Ok(Self.SectionHeader.sh_info(s0._0, endian));
    } else {
      // Section 0 must exist if e_phnum overflows.
      return Err(new Error("Missing ELF section headers for e_phnum overflow"));
    }
  },

  /// Return the `e_shnum` field of the header. Handles extended values.
  ///
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/file.rs:685 shnum
  shnum(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<number> {
    const e_shnum = Self.e_shnum(self, endian);
    if (e_shnum > 0) {
      return Ok(e_shnum);
    }
    const s0 = FileHeader_provided.section_0(Self, self, endian, data);
    if (s0.$ === "Err") return s0;
    if (s0._0 !== undefined) {
      // `.into().try_into().ok()`: u64 -> usize is lossless on the 64-bit host.
      // ("Invalid ELF extended e_shnum" cannot occur.)
      return Ok(Self.SectionHeader.sh_size(s0._0, endian));
    } else {
      // No section headers is ok.
      return Ok(0);
    }
  },

  /// Return the `e_shstrndx` field of the header. Handles extended values.
  ///
  /// Returns `Err` for invalid values (including if the index is 0).
  // crate: object-0.39.1/src/read/elf/file.rs:709 shstrndx
  shstrndx(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<number> {
    const e_shstrndx = Self.e_shstrndx(self, endian);
    let index: number;
    if (e_shstrndx !== elf.SHN_XINDEX) {
      index = e_shstrndx;
    } else {
      const s0 = FileHeader_provided.section_0(Self, self, endian, data);
      if (s0.$ === "Err") return s0;
      if (s0._0 !== undefined) {
        index = Self.SectionHeader.sh_link(s0._0, endian);
      } else {
        // Section 0 must exist if we're trying to read e_shstrndx.
        return Err(new Error("Missing ELF section headers for e_shstrndx overflow"));
      }
    }
    if (index === 0) {
      return Err(new Error("Missing ELF e_shstrndx"));
    }
    return Ok(index);
  },

  /// Return the slice of program headers.
  ///
  /// Returns `Ok(&[])` if there are no program headers.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/file.rs:733 program_headers
  program_headers(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<PodSlice<unknown>> {
    const phoff = Self.e_phoff(self, endian);
    if (phoff === 0) {
      // No program headers is ok.
      return Ok(PodSlice.empty(Self.ProgramHeader));
    }
    const phnum = FileHeader_provided.phnum(Self, self, endian, data);
    if (phnum.$ === "Err") return phnum;
    if (phnum._0 === 0) {
      // No program headers is ok.
      return Ok(PodSlice.empty(Self.ProgramHeader));
    }
    const phentsize = Self.e_phentsize(self, endian);
    if (phentsize !== Self.ProgramHeader.size) {
      // Program header size must match.
      return Err(new Error("Invalid ELF program header entry size"));
    }
    return read_error_unit(ReadRef.read_slice_at(data, Self.ProgramHeader, phoff, phnum._0), "Invalid ELF program header size or alignment");
  },

  /// Return the slice of section headers.
  ///
  /// Returns `Ok(&[])` if there are no section headers.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/elf/file.rs:761 section_headers
  section_headers(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<PodSlice<SectionHeaderValue>> {
    const shoff = Self.e_shoff(self, endian);
    if (shoff === 0) {
      // No section headers is ok.
      return Ok(PodSlice.empty(Self.SectionHeader.POD));
    }
    const shnum = FileHeader_provided.shnum(Self, self, endian, data);
    if (shnum.$ === "Err") return shnum;
    if (shnum._0 === 0) {
      // No section headers is ok.
      return Ok(PodSlice.empty(Self.SectionHeader.POD));
    }
    const shentsize = Self.e_shentsize(self, endian);
    if (shentsize !== Self.SectionHeader.POD.size) {
      // Section header size must match.
      return Err(new Error("Invalid ELF section header entry size"));
    }
    return read_error_unit(
      ReadRef.read_slice_at(data, Self.SectionHeader.POD, shoff, shnum._0),
      "Invalid ELF section header offset/size/alignment",
    );
  },

  /// Get the section index of the section header string table.
  ///
  /// Returns `Err` for invalid values (including if the index is 0).
  // crate: object-0.39.1/src/read/elf/file.rs:788 section_strings_index
  section_strings_index(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<SectionIndex> {
    const r = FileHeader_provided.shstrndx(Self, self, endian, data);
    if (r.$ === "Err") return r;
    return Ok(SectionIndex(r._0));
  },

  /// Return the string table for the section headers.
  // crate: object-0.39.1/src/read/elf/file.rs:798 section_strings
  section_strings(
    Self: FileHeader,
    self: FileHeaderValue,
    endian: Endianness,
    data: Uint8Array,
    sections: PodSlice<SectionHeaderValue>,
  ): Result<StringTable> {
    if (sections.is_empty()) {
      return Ok(StringTable.default());
    }
    const index = FileHeader_provided.section_strings_index(Self, self, endian, data);
    if (index.$ === "Err") return index;
    const shstrtab = read_error_opt(sections.get(index._0), "Invalid ELF e_shstrndx");
    if (shstrtab.$ === "Err") return shstrtab;
    let strings: StringTable;
    const range = SectionHeader_provided.file_range(Self.SectionHeader, shstrtab._0, endian);
    if (range !== undefined) {
      const [shstrtab_offset, shstrtab_size] = range;
      // `shstrtab_offset.checked_add(shstrtab_size)`
      const shstrtab_end = shstrtab_offset + shstrtab_size;
      if (shstrtab_end > U64_MAX) return Err(new Error("Invalid ELF shstrtab size"));
      strings = StringTable.new(data, shstrtab_offset, shstrtab_end);
    } else {
      strings = StringTable.default();
    }
    return Ok(strings);
  },

  /// Return the section table.
  // crate: object-0.39.1/src/read/elf/file.rs:821 sections
  sections(Self: FileHeader, self: FileHeaderValue, endian: Endianness, data: Uint8Array): Result<SectionTable> {
    const sections = FileHeader_provided.section_headers(Self, self, endian, data);
    if (sections.$ === "Err") return sections;
    const strings = FileHeader_provided.section_strings(Self, self, endian, data, sections._0);
    if (strings.$ === "Err") return strings;
    return Ok(SectionTable.new(Self, sections._0, strings._0));
  },

  /// Returns whether this is a mips64el elf file.
  // crate: object-0.39.1/src/read/elf/file.rs:832 is_mips64el
  is_mips64el(Self: FileHeader, self: FileHeaderValue, endian: Endianness): boolean {
    return (
      FileHeader_provided.is_class_64(Self, self) &&
      FileHeader_provided.is_little_endian(Self, self) &&
      Self.e_machine(self, endian) === EM_MIPS
    );
  },
};

/** `elf::EM_MIPS` */
const EM_MIPS = 8;

/** `u64::MAX` as a `number` (rounded; see endian.ts). */
const U64_MAX = 2 ** 64 - 1;

function bytes_eq4(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/// `impl<Endian: endian::Endian> FileHeader for elf::FileHeader32<Endian>`
export const FileHeader32_impl: FileHeader = {
  Endian: Endianness,
  ProgramHeader: elf.ProgramHeader32.POD,
  get SectionHeader(): SectionHeader {
    return SectionHeader32_impl;
  },
  Sym: elf.Sym32.POD,
  POD: elf.FileHeader32.POD,

  // crate: object-0.39.1/src/read/elf/file.rs:852 is_type_64
  is_type_64(_self: elf.FileHeader32): boolean {
    return false;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:857 is_type_64_sized
  is_type_64_sized(): boolean {
    return false;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:865 e_ident
  e_ident(self: elf.FileHeader32): elf.Ident {
    return self.e_ident;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:870 e_type
  e_type(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_type, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:875 e_machine
  e_machine(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_machine, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:880 e_version
  e_version(self: elf.FileHeader32, endian: Endianness): number {
    return U32.get(self.e_version, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:885 e_entry
  e_entry(self: elf.FileHeader32, endian: Endianness): number {
    return U32.get(self.e_entry, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:890 e_phoff
  e_phoff(self: elf.FileHeader32, endian: Endianness): number {
    return U32.get(self.e_phoff, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:895 e_shoff
  e_shoff(self: elf.FileHeader32, endian: Endianness): number {
    return U32.get(self.e_shoff, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:900 e_flags
  e_flags(self: elf.FileHeader32, endian: Endianness): number {
    return U32.get(self.e_flags, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:905 e_ehsize
  e_ehsize(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_ehsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:910 e_phentsize
  e_phentsize(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_phentsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:915 e_phnum
  e_phnum(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_phnum, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:920 e_shentsize
  e_shentsize(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_shentsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:925 e_shnum
  e_shnum(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_shnum, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:930 e_shstrndx
  e_shstrndx(self: elf.FileHeader32, endian: Endianness): number {
    return U16.get(self.e_shstrndx, endian);
  },
} as FileHeader;

/// `impl<Endian: endian::Endian> FileHeader for elf::FileHeader64<Endian>`
export const FileHeader64_impl: FileHeader = {
  Endian: Endianness,
  ProgramHeader: elf.ProgramHeader64.POD,
  get SectionHeader(): SectionHeader {
    return SectionHeader64_impl;
  },
  Sym: elf.Sym64.POD,
  POD: elf.FileHeader64.POD,

  // crate: object-0.39.1/src/read/elf/file.rs:950 is_type_64
  is_type_64(_self: elf.FileHeader64): boolean {
    return true;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:955 is_type_64_sized
  is_type_64_sized(): boolean {
    return true;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:963 e_ident
  e_ident(self: elf.FileHeader64): elf.Ident {
    return self.e_ident;
  },

  // crate: object-0.39.1/src/read/elf/file.rs:968 e_type
  e_type(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_type, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:973 e_machine
  e_machine(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_machine, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:978 e_version
  e_version(self: elf.FileHeader64, endian: Endianness): number {
    return U32.get(self.e_version, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:983 e_entry
  e_entry(self: elf.FileHeader64, endian: Endianness): number {
    return U64.get(self.e_entry, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:988 e_phoff
  e_phoff(self: elf.FileHeader64, endian: Endianness): number {
    return U64.get(self.e_phoff, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:993 e_shoff
  e_shoff(self: elf.FileHeader64, endian: Endianness): number {
    return U64.get(self.e_shoff, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:998 e_flags
  e_flags(self: elf.FileHeader64, endian: Endianness): number {
    return U32.get(self.e_flags, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1003 e_ehsize
  e_ehsize(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_ehsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1008 e_phentsize
  e_phentsize(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_phentsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1013 e_phnum
  e_phnum(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_phnum, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1018 e_shentsize
  e_shentsize(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_shentsize, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1023 e_shnum
  e_shnum(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_shnum, endian);
  },

  // crate: object-0.39.1/src/read/elf/file.rs:1028 e_shstrndx
  e_shstrndx(self: elf.FileHeader64, endian: Endianness): number {
    return U16.get(self.e_shstrndx, endian);
  },
} as FileHeader;
