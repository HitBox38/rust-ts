// Port of object 0.39.1 `src/write/elf/writer.rs`: the `Writer` parts `Object::elf_write` reaches (file header, section
// headers and names, the string tables, the symbol table). The segment, dynamic-section, GNU version, hash, relocation,
// comdat and attributes helpers are not ported: nothing reaches them.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `self.buffer.write(&elf::FileHeader64 { .. })` writes the struct's fields in order: the `repr(C)` ELF structs have
// no padding, and `U16`/`U32`/`U64::new(endian, ..)` are the fields' endian encodings (`BytesWriter`). A `u64` value is
// a `number`: ELF offsets, sizes and flags of a wrapper object stay below 2^53.
import * as elf from "../../elf.ts";
import type { Endianness } from "../../endian.ts";
import { StringTable, type StringId } from "../string.ts";
import * as util from "../util.ts";
import type { WritableBuffer } from "../util.ts";

/// The index of an ELF section.
export type SectionIndex = number & { readonly __brand: "write::elf::SectionIndex" };
export const SectionIndex = (n: number): SectionIndex => n as SectionIndex;
/// The index of an ELF symbol.
export type SymbolIndex = number & { readonly __brand: "write::elf::SymbolIndex" };
export const SymbolIndex = (n: number): SymbolIndex => n as SymbolIndex;

const encoder = new TextEncoder();
const ALIGN_SYMTAB_SHNDX = 4;

/** The fields of a `repr(C)` struct, in order, as bytes. */
class BytesWriter {
  private readonly bytes: number[] = [];
  constructor(private readonly little: boolean) {}
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.little ? this.u8(v).u8(v >>> 8) : this.u8(v >>> 8).u8(v);
  }
  u32(v: number): this {
    return this.little ? this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24) : this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }
  u64(v: number): this {
    const hi = Math.floor(v / 0x1_0000_0000);
    const lo = v % 0x1_0000_0000;
    return this.little ? this.u32(lo).u32(hi) : this.u32(hi).u32(lo);
  }
  raw(v: Iterable<number>): this {
    for (const x of v) this.u8(x);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/// Native endian version of [`elf::FileHeader64`].
export interface FileHeader {
  os_abi: number;
  abi_version: number;
  e_type: number;
  e_machine: number;
  e_entry: number;
  e_flags: number;
}

/// Native endian version of [`elf::SectionHeader64`].
export interface SectionHeader {
  name: StringId | undefined;
  sh_type: number;
  sh_flags: number;
  sh_addr: number;
  sh_offset: number;
  sh_size: number;
  sh_link: number;
  sh_info: number;
  sh_addralign: number;
  sh_entsize: number;
}

/// A helper for writing ELF files.
///
/// Writing uses a two phase approach. The first phase builds up all of the information
/// that may need to be known ahead of time:
/// - build string tables
/// - reserve section indices
/// - reserve symbol indices
/// - reserve file ranges for headers and sections
///
/// Some of the information has ordering requirements. For example, strings must be added
/// to string tables before reserving the file range for the string table. Symbol indices
/// must be reserved after reserving the section indices they reference. There are debug
/// asserts to check some of these requirements.
///
/// The second phase writes everything out in order. Thus the caller must ensure writing
/// is in the same order that file ranges were reserved. There are debug asserts to assist
/// with checking this.
export class Writer {
  private is_mips64el = false;
  private elf_align: number;
  private len_ = 0;
  private segment_offset = 0;
  private segment_num = 0;
  private section_offset = 0;
  private section_num = 0;
  private shstrtab = new StringTable();
  private shstrtab_str_id: StringId | undefined = undefined;
  private shstrtab_index = SectionIndex(0);
  private shstrtab_offset = 0;
  private shstrtab_data: number[] = [];
  private need_strtab = false;
  private strtab = new StringTable();
  private strtab_str_id: StringId | undefined = undefined;
  private strtab_index = SectionIndex(0);
  private strtab_offset = 0;
  private strtab_data: number[] = [];
  private symtab_str_id: StringId | undefined = undefined;
  private symtab_index_ = SectionIndex(0);
  private symtab_offset = 0;
  private symtab_num = 0;
  private need_symtab_shndx = false;
  private symtab_shndx_str_id: StringId | undefined = undefined;
  private symtab_shndx_offset = 0;
  private symtab_shndx_data: number[] = [];

  private constructor(
    private readonly endian: Endianness,
    private readonly is_64: boolean,
    private readonly buffer: WritableBuffer,
  ) {
    this.elf_align = is_64 ? 8 : 4;
  }

  /// Create a new `Writer` for the given endianness and ELF class.
  // crate: object-0.39.1/src/write/elf/writer.rs:132 new
  static new(endian: Endianness, is_64: boolean, buffer: WritableBuffer): Writer {
    return new Writer(endian, is_64, buffer);
  }

  private bytes(): BytesWriter {
    return new BytesWriter(this.endian === "Little");
  }

  // crate: object-0.39.1/src/write/elf/writer.rs:221 class
  private class_(): Class {
    return new Class(this.is_64);
  }

  /// Return the current file length that has been reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:226 reserved_len
  reserved_len(): number {
    return this.len_;
  }

  /// Return the current file length that has been written.
  // crate: object-0.39.1/src/write/elf/writer.rs:232 len
  len(): number {
    return this.buffer.len();
  }

  /// Reserve a file range with the given size and starting alignment.
  ///
  /// Returns the aligned offset of the start of the range.
  ///
  /// `align_start` must be a power of two.
  // crate: object-0.39.1/src/write/elf/writer.rs:241 reserve
  reserve(len: number, align_start: number): number {
    if (align_start > 1) {
      this.len_ = util.align(this.len_, align_start);
    }
    const offset = this.len_;
    this.len_ += len;
    return offset;
  }

  /// Write alignment padding bytes.
  // crate: object-0.39.1/src/write/elf/writer.rs:251 write_align
  write_align(align_start: number): void {
    if (align_start > 1) {
      util.write_align(this.buffer, align_start);
    }
  }

  /// Write data.
  ///
  /// This is typically used to write section data.
  // crate: object-0.39.1/src/write/elf/writer.rs:260 write
  write(data: Uint8Array): void {
    this.buffer.write_bytes(data);
  }

  /// Reserve the range for the file header.
  ///
  /// This must be at the start of the file.
  // crate: object-0.39.1/src/write/elf/writer.rs:279 reserve_file_header
  reserve_file_header(): void {
    // debug_assert_eq!(self.len, 0);
    this.reserve(this.class_().file_header_size(), 1);
  }

  /// Write the file header.
  ///
  /// This must be at the start of the file.
  ///
  /// Fields that can be derived from known information are automatically set by this function.
  // crate: object-0.39.1/src/write/elf/writer.rs:289 write_file_header
  write_file_header(header: FileHeader): void {
    // debug_assert_eq!(self.buffer.len(), 0);

    this.is_mips64el = this.is_64 && this.endian === "Little" && header.e_machine === elf.EM_MIPS;

    // Start writing.
    this.buffer.reserve(this.len_);

    // Write file header.
    const e_ident = this.bytes()
      .raw(elf.ELFMAG)
      .u8(this.is_64 ? elf.ELFCLASS64 : elf.ELFCLASS32)
      .u8(this.endian === "Little" ? elf.ELFDATA2LSB : elf.ELFDATA2MSB)
      .u8(elf.EV_CURRENT)
      .u8(header.os_abi)
      .u8(header.abi_version)
      .raw([0, 0, 0, 0, 0, 0, 0]);

    const e_ehsize = this.class_().file_header_size();

    const e_phoff = this.segment_offset;
    const e_phentsize = this.segment_num === 0 ? 0 : this.class_().program_header_size();
    // TODO: overflow
    const e_phnum = this.segment_num;

    const e_shoff = this.section_offset;
    const e_shentsize = this.section_num === 0 ? 0 : this.class_().section_header_size();
    const e_shnum = this.section_num >= elf.SHN_LORESERVE ? 0 : this.section_num;
    const e_shstrndx = this.shstrtab_index >= elf.SHN_LORESERVE ? elf.SHN_XINDEX : this.shstrtab_index;

    if (this.is_64) {
      this.buffer.write_bytes(
        e_ident
          .u16(header.e_type)
          .u16(header.e_machine)
          .u32(elf.EV_CURRENT)
          .u64(header.e_entry)
          .u64(e_phoff)
          .u64(e_shoff)
          .u32(header.e_flags)
          .u16(e_ehsize)
          .u16(e_phentsize)
          .u16(e_phnum)
          .u16(e_shentsize)
          .u16(e_shnum)
          .u16(e_shstrndx)
          .done(),
      );
    } else {
      this.buffer.write_bytes(
        e_ident
          .u16(header.e_type)
          .u16(header.e_machine)
          .u32(elf.EV_CURRENT)
          .u32(header.e_entry)
          .u32(e_phoff)
          .u32(e_shoff)
          .u32(header.e_flags)
          .u16(e_ehsize)
          .u16(e_phentsize)
          .u16(e_phnum)
          .u16(e_shentsize)
          .u16(e_shnum)
          .u16(e_shstrndx)
          .done(),
      );
    }
  }

  /// Reserve a section table index.
  ///
  /// Automatically also reserves the null section header if required.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:460 reserve_section_index
  reserve_section_index(): SectionIndex {
    // debug_assert_eq!(self.section_offset, 0);
    if (this.section_num === 0) {
      this.section_num = 1;
    }
    const index = this.section_num;
    this.section_num += 1;
    return SectionIndex(index);
  }

  /// Reserve the range for the section headers.
  ///
  /// This function does nothing if no sections were reserved.
  /// This must be called after [`Self::reserve_section_index`]
  /// and other functions that reserve section indices.
  // crate: object-0.39.1/src/write/elf/writer.rs:475 reserve_section_headers
  reserve_section_headers(): void {
    // debug_assert_eq!(self.section_offset, 0);
    if (this.section_num === 0) {
      return;
    }
    this.section_offset = this.reserve(this.section_num * this.class_().section_header_size(), this.elf_align);
  }

  /// Write the null section header.
  ///
  /// This must be the first section header that is written.
  /// This function does nothing if no sections were reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:490 write_null_section_header
  write_null_section_header(): void {
    if (this.section_num === 0) {
      return;
    }
    util.write_align(this.buffer, this.elf_align);
    // debug_assert_eq!(self.section_offset, self.buffer.len());
    this.write_section_header({
      name: undefined,
      sh_type: 0,
      sh_flags: 0,
      sh_addr: 0,
      sh_offset: 0,
      sh_size: this.section_num >= elf.SHN_LORESERVE ? this.section_num : 0,
      sh_link: this.shstrtab_index >= elf.SHN_LORESERVE ? this.shstrtab_index : 0,
      // TODO: e_phnum overflow
      sh_info: 0,
      sh_addralign: 0,
      sh_entsize: 0,
    });
  }

  /// Write a section header.
  // crate: object-0.39.1/src/write/elf/writer.rs:520 write_section_header
  write_section_header(section: SectionHeader): void {
    const sh_name = section.name !== undefined ? this.shstrtab.get_offset(section.name) : 0;
    if (this.is_64) {
      this.buffer.write_bytes(
        this.bytes()
          .u32(sh_name)
          .u32(section.sh_type)
          .u64(section.sh_flags)
          .u64(section.sh_addr)
          .u64(section.sh_offset)
          .u64(section.sh_size)
          .u32(section.sh_link)
          .u32(section.sh_info)
          .u64(section.sh_addralign)
          .u64(section.sh_entsize)
          .done(),
      );
    } else {
      this.buffer.write_bytes(
        this.bytes()
          .u32(sh_name)
          .u32(section.sh_type)
          .u32(section.sh_flags)
          .u32(section.sh_addr)
          .u32(section.sh_offset)
          .u32(section.sh_size)
          .u32(section.sh_link)
          .u32(section.sh_info)
          .u32(section.sh_addralign)
          .u32(section.sh_entsize)
          .done(),
      );
    }
  }

  /// Add a section name to the section header string table.
  ///
  /// This will be stored in the `.shstrtab` section.
  ///
  /// This must be called before [`Self::reserve_shstrtab`].
  // crate: object-0.39.1/src/write/elf/writer.rs:563 add_section_name
  add_section_name(name: Uint8Array): StringId {
    // debug_assert_eq!(self.shstrtab_offset, 0);
    return this.shstrtab.add(name);
  }

  /// Reserve the range for the section header string table.
  ///
  /// This range is used for a section named `.shstrtab`.
  ///
  /// This function does nothing if no sections were reserved.
  /// This must be called after [`Self::add_section_name`].
  /// and other functions that reserve section names and indices.
  // crate: object-0.39.1/src/write/elf/writer.rs:575 reserve_shstrtab
  reserve_shstrtab(): void {
    // debug_assert_eq!(self.shstrtab_offset, 0);
    if (this.section_num === 0) {
      return;
    }
    // Start with null section name.
    this.shstrtab_data = [0];
    this.shstrtab.write(1, this.shstrtab_data);
    this.shstrtab_offset = this.reserve(this.shstrtab_data.length, 1);
  }

  /// Write the section header string table.
  ///
  /// This function does nothing if the section was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:589 write_shstrtab
  write_shstrtab(): void {
    if (this.shstrtab_offset === 0) {
      return;
    }
    // debug_assert_eq!(self.shstrtab_offset, self.buffer.len());
    this.buffer.write_bytes(Uint8Array.from(this.shstrtab_data));
  }

  /// Reserve the section index for the section header string table.
  ///
  /// You should check [`Self::shstrtab_needed`] before calling this
  /// unless you have other means of knowing if this section is needed.
  ///
  /// This must be called before [`Self::reserve_shstrtab`]
  /// and [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:601 reserve_shstrtab_section_index
  reserve_shstrtab_section_index(): SectionIndex {
    return this.reserve_shstrtab_section_index_with_name(encoder.encode(".shstrtab"));
  }

  /// Reserve the section index for the section header string table.
  ///
  /// This must be called before [`Self::reserve_shstrtab`]
  /// and [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:609 reserve_shstrtab_section_index_with_name
  reserve_shstrtab_section_index_with_name(name: Uint8Array): SectionIndex {
    // debug_assert_eq!(self.shstrtab_index, SectionIndex(0));
    this.shstrtab_str_id = this.add_section_name(name);
    this.shstrtab_index = this.reserve_section_index();
    return this.shstrtab_index;
  }

  /// Write the section header for the section header string table.
  ///
  /// This function does nothing if the section index was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:619 write_shstrtab_section_header
  write_shstrtab_section_header(): void {
    if (this.shstrtab_index === SectionIndex(0)) {
      return;
    }
    this.write_section_header({
      name: this.shstrtab_str_id,
      sh_type: elf.SHT_STRTAB,
      sh_flags: 0,
      sh_addr: 0,
      sh_offset: this.shstrtab_offset,
      sh_size: this.shstrtab_data.length,
      sh_link: 0,
      sh_info: 0,
      sh_addralign: 1,
      sh_entsize: 0,
    });
  }

  /// Add a string to the string table.
  ///
  /// This will be stored in the `.strtab` section.
  ///
  /// This must be called before [`Self::reserve_strtab`].
  // crate: object-0.39.1/src/write/elf/writer.rs:642 add_string
  add_string(name: Uint8Array): StringId {
    // debug_assert_eq!(self.strtab_offset, 0);
    this.need_strtab = true;
    return this.strtab.add(name);
  }

  /// Reserve the range for the string table.
  ///
  /// This range is used for a section named `.strtab`.
  ///
  /// This function does nothing if no strings or symbols were defined.
  /// This must be called after [`Self::add_string`].
  // crate: object-0.39.1/src/write/elf/writer.rs:664 reserve_strtab
  reserve_strtab(): void {
    // debug_assert_eq!(self.strtab_offset, 0);
    if (!this.need_strtab) {
      return;
    }
    // Start with null string.
    this.strtab_data = [0];
    this.strtab.write(1, this.strtab_data);
    this.strtab_offset = this.reserve(this.strtab_data.length, 1);
  }

  /// Write the string table.
  ///
  /// This function does nothing if the section was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:678 write_strtab
  write_strtab(): void {
    if (this.strtab_offset === 0) {
      return;
    }
    // debug_assert_eq!(self.strtab_offset, self.buffer.len());
    this.buffer.write_bytes(Uint8Array.from(this.strtab_data));
  }

  /// Reserve the section index for the string table.
  ///
  /// You should check [`Self::strtab_needed`] before calling this
  /// unless you have other means of knowing if this section is needed.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:692 reserve_strtab_section_index
  reserve_strtab_section_index(): SectionIndex {
    return this.reserve_strtab_section_index_with_name(encoder.encode(".strtab"));
  }

  /// Reserve the section index for the string table.
  ///
  /// You should check [`Self::strtab_needed`] before calling this
  /// unless you have other means of knowing if this section is needed.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:702 reserve_strtab_section_index_with_name
  reserve_strtab_section_index_with_name(name: Uint8Array): SectionIndex {
    // debug_assert_eq!(self.strtab_index, SectionIndex(0));
    this.strtab_str_id = this.add_section_name(name);
    this.strtab_index = this.reserve_section_index();
    return this.strtab_index;
  }

  /// Write the section header for the string table.
  ///
  /// This function does nothing if the section index was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:712 write_strtab_section_header
  write_strtab_section_header(): void {
    if (this.strtab_index === SectionIndex(0)) {
      return;
    }
    this.write_section_header({
      name: this.strtab_str_id,
      sh_type: elf.SHT_STRTAB,
      sh_flags: 0,
      sh_addr: 0,
      sh_offset: this.strtab_offset,
      sh_size: this.strtab_data.length,
      sh_link: 0,
      sh_info: 0,
      sh_addralign: 1,
      sh_entsize: 0,
    });
  }

  /// Reserve the null symbol table entry.
  ///
  /// This will be stored in the `.symtab` section.
  ///
  /// The null symbol table entry is usually automatically reserved,
  /// but this can be used to force an empty symbol table.
  ///
  /// This must be called before [`Self::reserve_symtab`].
  // crate: object-0.39.1/src/write/elf/writer.rs:738 reserve_null_symbol_index
  reserve_null_symbol_index(): SymbolIndex {
    // debug_assert_eq!(self.symtab_offset, 0);
    // debug_assert_eq!(self.symtab_num, 0);
    this.symtab_num = 1;
    // The symtab must link to a strtab.
    this.need_strtab = true;
    return SymbolIndex(0);
  }

  /// Reserve a symbol table entry.
  ///
  /// This will be stored in the `.symtab` section.
  ///
  /// `section_index` is used to determine whether `.symtab_shndx` is required.
  ///
  /// Automatically also reserves the null symbol if required.
  /// Callers may assume that the returned indices will be sequential
  /// starting at 1.
  ///
  /// This must be called before [`Self::reserve_symtab`] and
  /// [`Self::reserve_symtab_shndx`].
  // crate: object-0.39.1/src/write/elf/writer.rs:759 reserve_symbol_index
  reserve_symbol_index(section_index: SectionIndex | undefined): SymbolIndex {
    // debug_assert_eq!(self.symtab_offset, 0);
    // debug_assert_eq!(self.symtab_shndx_offset, 0);
    if (this.symtab_num === 0) {
      this.symtab_num = 1;
      // The symtab must link to a strtab.
      this.need_strtab = true;
    }
    const index = this.symtab_num;
    this.symtab_num += 1;
    if (section_index !== undefined) {
      if (section_index >= elf.SHN_LORESERVE) {
        this.need_symtab_shndx = true;
      }
    }
    return SymbolIndex(index);
  }

  /// Return the number of reserved symbol table entries.
  ///
  /// Includes the null symbol.
  // crate: object-0.39.1/src/write/elf/writer.rs:780 symbol_count
  symbol_count(): number {
    return this.symtab_num;
  }

  /// Reserve the range for the symbol table.
  ///
  /// This range is used for a section named `.symtab`.
  /// This function does nothing if no symbols were reserved.
  /// This must be called after [`Self::reserve_symbol_index`].
  // crate: object-0.39.1/src/write/elf/writer.rs:789 reserve_symtab
  reserve_symtab(): void {
    // debug_assert_eq!(self.symtab_offset, 0);
    if (this.symtab_num === 0) {
      return;
    }
    this.symtab_offset = this.reserve(this.symtab_num * this.class_().sym_size(), this.elf_align);
  }

  /// Write the null symbol.
  ///
  /// This must be the first symbol that is written.
  /// This function does nothing if no symbols were reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:804 write_null_symbol
  write_null_symbol(): void {
    if (this.symtab_num === 0) {
      return;
    }
    util.write_align(this.buffer, this.elf_align);
    // debug_assert_eq!(self.symtab_offset, self.buffer.len());
    this.buffer.write_bytes(new Uint8Array(this.class_().sym_size()));

    if (this.need_symtab_shndx) {
      for (const x of this.bytes().u32(0).done()) this.symtab_shndx_data.push(x);
    }
  }

  /// Reserve the section index for the symbol table.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:871 reserve_symtab_section_index
  reserve_symtab_section_index(): SectionIndex {
    return this.reserve_symtab_section_index_with_name(encoder.encode(".symtab"));
  }

  /// Reserve the section index for the symbol table.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:878 reserve_symtab_section_index_with_name
  reserve_symtab_section_index_with_name(name: Uint8Array): SectionIndex {
    // debug_assert_eq!(self.symtab_index, SectionIndex(0));
    this.symtab_str_id = this.add_section_name(name);
    this.symtab_index_ = this.reserve_section_index();
    return this.symtab_index_;
  }

  /// Return the section index of the symbol table.
  // crate: object-0.39.1/src/write/elf/writer.rs:886 symtab_index
  symtab_index(): SectionIndex {
    return this.symtab_index_;
  }

  /// Write the section header for the symbol table.
  ///
  /// This function does nothing if the section index was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:893 write_symtab_section_header
  write_symtab_section_header(num_local: number): void {
    if (this.symtab_index_ === SectionIndex(0)) {
      return;
    }
    this.write_section_header({
      name: this.symtab_str_id,
      sh_type: elf.SHT_SYMTAB,
      sh_flags: 0,
      sh_addr: 0,
      sh_offset: this.symtab_offset,
      sh_size: this.symtab_num * this.class_().sym_size(),
      sh_link: this.strtab_index,
      sh_info: num_local,
      sh_addralign: this.elf_align,
      sh_entsize: this.class_().sym_size(),
    });
  }

  /// Return true if `.symtab_shndx` is needed.
  // crate: object-0.39.1/src/write/elf/writer.rs:912 symtab_shndx_needed
  symtab_shndx_needed(): boolean {
    return this.need_symtab_shndx;
  }

  /// Reserve the range for the extended section indices for the symbol table.
  ///
  /// This range is used for a section named `.symtab_shndx`.
  /// This also reserves a section index.
  ///
  /// This function does nothing if extended section indices are not needed.
  /// This must be called after [`Self::reserve_symbol_index`].
  // crate: object-0.39.1/src/write/elf/writer.rs:929 reserve_symtab_shndx
  reserve_symtab_shndx(): void {
    // debug_assert_eq!(self.symtab_shndx_offset, 0);
    if (!this.need_symtab_shndx) {
      return;
    }
    this.symtab_shndx_offset = this.reserve(this.symtab_num * 4, ALIGN_SYMTAB_SHNDX);
  }

  /// Write the extended section indices for the symbol table.
  ///
  /// This function does nothing if the section was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:941 write_symtab_shndx
  write_symtab_shndx(): void {
    if (this.symtab_shndx_offset === 0) {
      return;
    }
    util.write_align(this.buffer, ALIGN_SYMTAB_SHNDX);
    // debug_assert_eq!(self.symtab_shndx_offset, self.buffer.len());
    // debug_assert_eq!(self.symtab_num as usize * 4, self.symtab_shndx_data.len());
    this.buffer.write_bytes(Uint8Array.from(this.symtab_shndx_data));
  }

  /// Reserve the section index for the extended section indices symbol table.
  ///
  /// You should check [`Self::symtab_shndx_needed`] before calling this
  /// unless you have other means of knowing if this section is needed.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:957 reserve_symtab_shndx_section_index
  reserve_symtab_shndx_section_index(): SectionIndex {
    return this.reserve_symtab_shndx_section_index_with_name(encoder.encode(".symtab_shndx"));
  }

  /// Reserve the section index for the extended section indices symbol table.
  ///
  /// You should check [`Self::symtab_shndx_needed`] before calling this
  /// unless you have other means of knowing if this section is needed.
  ///
  /// This must be called before [`Self::reserve_section_headers`].
  // crate: object-0.39.1/src/write/elf/writer.rs:967 reserve_symtab_shndx_section_index_with_name
  reserve_symtab_shndx_section_index_with_name(name: Uint8Array): SectionIndex {
    // debug_assert!(self.symtab_shndx_str_id.is_none());
    this.symtab_shndx_str_id = this.add_section_name(name);
    return this.reserve_section_index();
  }

  /// Write the section header for the extended section indices for the symbol table.
  ///
  /// This function does nothing if the section index was not reserved.
  // crate: object-0.39.1/src/write/elf/writer.rs:976 write_symtab_shndx_section_header
  write_symtab_shndx_section_header(): void {
    if (this.symtab_shndx_str_id === undefined) {
      return;
    }
    const sh_size = this.symtab_shndx_offset === 0 ? 0 : this.symtab_num * 4;
    this.write_section_header({
      name: this.symtab_shndx_str_id,
      sh_type: elf.SHT_SYMTAB_SHNDX,
      sh_flags: 0,
      sh_addr: 0,
      sh_offset: this.symtab_shndx_offset,
      sh_size,
      sh_link: this.symtab_index_,
      sh_info: 0,
      sh_addralign: ALIGN_SYMTAB_SHNDX,
      sh_entsize: 4,
    });
  }
}

/// Native endian version of [`elf::Sym64`] etc.: sizes per ELF class.
export class Class {
  constructor(readonly is_64: boolean) {}

  /// Return the size of the file header.
  // crate: object-0.39.1/src/write/elf/writer.rs:2205 file_header_size
  file_header_size(): number {
    // `mem::size_of::<elf::FileHeader64<Endianness>>()` / `FileHeader32`.
    return this.is_64 ? 64 : 52;
  }

  /// Return the size of a program header.
  // crate: object-0.39.1/src/write/elf/writer.rs:2214 program_header_size
  program_header_size(): number {
    // `mem::size_of::<elf::ProgramHeader64<Endianness>>()` / `ProgramHeader32`.
    return this.is_64 ? 56 : 32;
  }

  /// Return the size of a section header.
  // crate: object-0.39.1/src/write/elf/writer.rs:2223 section_header_size
  section_header_size(): number {
    // `mem::size_of::<elf::SectionHeader64<Endianness>>()` / `SectionHeader32`.
    return this.is_64 ? 64 : 40;
  }

  /// Return the size of a symbol.
  // crate: object-0.39.1/src/write/elf/writer.rs:2232 sym_size
  sym_size(): number {
    // `mem::size_of::<elf::Sym64<Endianness>>()` / `Sym32`.
    return this.is_64 ? 24 : 16;
  }
}
