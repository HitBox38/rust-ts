// Port of object 0.39.1 `src/elf.rs` (the structs and constants the ELF reader reaches).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! ELF definitions.
//!
//! These definitions are independent of read/write support, although we do implement
//! some traits useful for those.
//!
//! This module is the equivalent of /usr/include/elf.h, and is based heavily on it.
//
// PORT: only the definitions the read path uses are ported (file/section/program headers,
// symbols, and their constants); the remaining ~6k lines of `pub const`s are not needed.
// PORT: the `E: Endian` type parameter is erased: `U16`/`U32`/`U64` fields hold raw bytes and
// are read with an explicit endian (see endian.ts). Byte-array fields are views (pod.ts).
// The `FileHeader` / `SectionHeader` trait impls (read/elf/{file,section}.rs) are installed on
// these classes by those modules.

import { U16, U32, U64 } from "./endian.ts";
import { type Pod, pod_bytes, pod_struct, pod_u8 } from "./pod.ts";

/// The header at the start of every 32-bit ELF file.
export class FileHeader32 {
  constructor(
    /// Magic number and other information.
    readonly e_ident: Ident,
    /// Object file type. One of the `ET_*` constants.
    readonly e_type: U16,
    /// Architecture. One of the `EM_*` constants.
    readonly e_machine: U16,
    /// Object file version. Must be `EV_CURRENT`.
    readonly e_version: U32,
    /// Entry point virtual address.
    readonly e_entry: U32,
    /// Program header table file offset.
    readonly e_phoff: U32,
    /// Section header table file offset.
    readonly e_shoff: U32,
    /// Processor-specific flags.
    ///
    /// A combination of the `EF_*` constants.
    readonly e_flags: U32,
    /// Size in bytes of this header.
    readonly e_ehsize: U16,
    /// Program header table entry size.
    readonly e_phentsize: U16,
    /// Program header table entry count.
    ///
    /// If the count is greater than or equal to `PN_XNUM` then this field is set to
    /// `PN_XNUM` and the count is stored in the `sh_info` field of section 0.
    readonly e_phnum: U16,
    /// Section header table entry size.
    readonly e_shentsize: U16,
    /// Section header table entry count.
    ///
    /// If the count is greater than or equal to `SHN_LORESERVE` then this field is set to
    /// `0` and the count is stored in the `sh_size` field of section 0.
    /// first section header.
    readonly e_shnum: U16,
    /// Section header string table index.
    ///
    /// If the index is greater than or equal to `SHN_LORESERVE` then this field is set to
    /// `SHN_XINDEX` and the index is stored in the `sh_link` field of section 0.
    readonly e_shstrndx: U16,
  ) {}

  static readonly POD: Pod<FileHeader32> = pod_struct(
    [
      lazyIdent(),
      U16.POD,
      U16.POD,
      U32.POD,
      U32.POD,
      U32.POD,
      U32.POD,
      U32.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
    ],
    (...f: never[]) => new (FileHeader32 as new (...a: never[]) => FileHeader32)(...f),
  );
}

/// The header at the start of every 64-bit ELF file.
export class FileHeader64 {
  constructor(
    /// Magic number and other information.
    readonly e_ident: Ident,
    /// Object file type. One of the `ET_*` constants.
    readonly e_type: U16,
    /// Architecture. One of the `EM_*` constants.
    readonly e_machine: U16,
    /// Object file version. Must be `EV_CURRENT`.
    readonly e_version: U32,
    /// Entry point virtual address.
    readonly e_entry: U64,
    /// Program header table file offset.
    readonly e_phoff: U64,
    /// Section header table file offset.
    readonly e_shoff: U64,
    /// Processor-specific flags.
    ///
    /// A combination of the `EF_*` constants.
    readonly e_flags: U32,
    /// Size in bytes of this header.
    readonly e_ehsize: U16,
    /// Program header table entry size.
    readonly e_phentsize: U16,
    /// Program header table entry count.
    ///
    /// If the count is greater than or equal to `PN_XNUM` then this field is set to
    /// `PN_XNUM` and the count is stored in the `sh_info` field of section 0.
    readonly e_phnum: U16,
    /// Section header table entry size.
    readonly e_shentsize: U16,
    /// Section header table entry count.
    ///
    /// If the count is greater than or equal to `SHN_LORESERVE` then this field is set to
    /// `0` and the count is stored in the `sh_size` field of section 0.
    /// first section header.
    readonly e_shnum: U16,
    /// Section header string table index.
    ///
    /// If the index is greater than or equal to `SHN_LORESERVE` then this field is set to
    /// `SHN_XINDEX` and the index is stored in the `sh_link` field of section 0.
    readonly e_shstrndx: U16,
  ) {}

  static readonly POD: Pod<FileHeader64> = pod_struct(
    [
      lazyIdent(),
      U16.POD,
      U16.POD,
      U32.POD,
      U64.POD,
      U64.POD,
      U64.POD,
      U32.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
      U16.POD,
    ],
    (...f: never[]) => new (FileHeader64 as new (...a: never[]) => FileHeader64)(...f),
  );
}

/** `Ident`'s `Pod`, resolved on first use (the class is declared below the headers). */
function lazyIdent(): Pod<Ident> {
  return { size: 16, align: 1, read: (d, o) => Ident.POD.read(d, o) };
}

/// Magic number and other information.
///
/// Contained in the file header.
export class Ident {
  /// File class. One of the `ELFCLASS*` constants.
  readonly class: number;

  constructor(
    /// Magic number. Must be `ELFMAG`.
    readonly magic: Uint8Array,
    class_: number,
    /// Data encoding. One of the `ELFDATA*` constants.
    readonly data: number,
    /// ELF version. Must be `EV_CURRENT`.
    readonly version: number,
    /// OS ABI identification. One of the `ELFOSABI*` constants.
    readonly os_abi: number,
    /// ABI version.
    ///
    /// The meaning of this field depends on the `os_abi` value.
    readonly abi_version: number,
    /// Padding bytes.
    readonly padding: Uint8Array,
  ) {
    this.class = class_;
  }

  static readonly POD: Pod<Ident> = pod_struct(
    [pod_bytes(4), pod_u8, pod_u8, pod_u8, pod_u8, pod_u8, pod_bytes(7)],
    (...f: never[]) => new (Ident as new (...a: never[]) => Ident)(...f),
  );
}

/// File identification bytes stored in `Ident::magic`.
export const ELFMAG: Uint8Array = new Uint8Array([0x7f, 0x45 /* E */, 0x4c /* L */, 0x46 /* F */]);

// Values for `Ident::class`.
/// Invalid class.
export const ELFCLASSNONE = 0;
/// 32-bit object.
export const ELFCLASS32 = 1;
/// 64-bit object.
export const ELFCLASS64 = 2;

// Values for `Ident::data`.
/// Invalid data encoding.
export const ELFDATANONE = 0;
/// 2's complement, little endian.
export const ELFDATA2LSB = 1;
/// 2's complement, big endian.
export const ELFDATA2MSB = 2;

// Values for `FileHeader*::e_type`.
/// No file type.
export const ET_NONE = 0;
/// Relocatable file.
export const ET_REL = 1;
/// Executable file.
export const ET_EXEC = 2;
/// Shared object file.
export const ET_DYN = 3;
/// Core file.
export const ET_CORE = 4;

// Values for `FileHeader*::e_version` and `Ident::version`.
/// Invalid ELF version.
export const EV_NONE = 0;
/// Current ELF version.
export const EV_CURRENT = 1;

/// Section header.
export class SectionHeader32 {
  constructor(
    /// Section name.
    ///
    /// This is an offset into the section header string table.
    readonly sh_name: U32,
    /// Section type. One of the `SHT_*` constants.
    readonly sh_type: U32,
    /// Section flags. A combination of the `SHF_*` constants.
    readonly sh_flags: U32,
    /// Section virtual address at execution.
    readonly sh_addr: U32,
    /// Section file offset.
    readonly sh_offset: U32,
    /// Section size in bytes.
    readonly sh_size: U32,
    /// Link to another section.
    ///
    /// The section relationship depends on the `sh_type` value.
    readonly sh_link: U32,
    /// Additional section information.
    ///
    /// The meaning of this field depends on the `sh_type` value.
    readonly sh_info: U32,
    /// Section alignment.
    readonly sh_addralign: U32,
    /// Entry size if the section holds a table.
    readonly sh_entsize: U32,
  ) {}

  static readonly POD: Pod<SectionHeader32> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (SectionHeader32 as new (...a: never[]) => SectionHeader32)(...f),
  );
}

/// Section header.
export class SectionHeader64 {
  constructor(
    /// Section name.
    ///
    /// This is an offset into the section header string table.
    readonly sh_name: U32,
    /// Section type. One of the `SHT_*` constants.
    readonly sh_type: U32,
    /// Section flags. A combination of the `SHF_*` constants.
    readonly sh_flags: U64,
    /// Section virtual address at execution.
    readonly sh_addr: U64,
    /// Section file offset.
    readonly sh_offset: U64,
    /// Section size in bytes.
    readonly sh_size: U64,
    /// Link to another section.
    ///
    /// The section relationship depends on the `sh_type` value.
    readonly sh_link: U32,
    /// Additional section information.
    ///
    /// The meaning of this field depends on the `sh_type` value.
    readonly sh_info: U32,
    /// Section alignment.
    readonly sh_addralign: U64,
    /// Entry size if the section holds a table.
    readonly sh_entsize: U64,
  ) {}

  static readonly POD: Pod<SectionHeader64> = pod_struct(
    [U32.POD, U32.POD, U64.POD, U64.POD, U64.POD, U64.POD, U32.POD, U32.POD, U64.POD, U64.POD],
    (...f: never[]) => new (SectionHeader64 as new (...a: never[]) => SectionHeader64)(...f),
  );
}

// Special values for section indices.
/// Undefined section.
export const SHN_UNDEF = 0;
/// OS-specific range start.
/// Start of reserved section indices.
export const SHN_LORESERVE = 0xff00;
/// Section index is in the `SHT_SYMTAB_SHNDX` section.
export const SHN_XINDEX = 0xffff;

// Values for `SectionHeader*::sh_type`.
/// Section header table entry is unused.
export const SHT_NULL = 0;
/// Program data.
export const SHT_PROGBITS = 1;
/// Symbol table.
export const SHT_SYMTAB = 2;
/// String table.
export const SHT_STRTAB = 3;
/// Relocation entries with explicit addends.
export const SHT_RELA = 4;
/// Notes.
export const SHT_NOTE = 7;
/// Program space with no data (bss).
export const SHT_NOBITS = 8;
/// Relocation entries without explicit addends.
export const SHT_REL = 9;
/// Dynamic linker symbol table.
export const SHT_DYNSYM = 11;
/// Extended section indices for a symbol table.
export const SHT_SYMTAB_SHNDX = 18;
/// Compact relocation entries.
export const SHT_CREL = 0x40000014;

// Values for `SectionHeader*::sh_flags`.
/// `sh_info` contains SHT index.
export const SHF_INFO_LINK = 1 << 6;

/// Symbol table entry.
export class Sym32 {
  constructor(
    /// Symbol name.
    ///
    /// This is an offset into the symbol string table.
    readonly st_name: U32,
    /// Symbol value.
    readonly st_value: U32,
    /// Symbol size.
    readonly st_size: U32,
    /// Symbol type and binding.
    ///
    /// Use the `st_type` and `st_bind` methods to access this value.
    readonly st_info: number,
    /// Symbol visibility.
    ///
    /// Use the `st_visibility` method to access this value.
    readonly st_other: number,
    /// Section index or one of the `SHN_*` values.
    readonly st_shndx: U16,
  ) {}

  /// Get the `st_bind` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:883 st_bind
  st_bind(): number {
    return this.st_info >> 4;
  }

  /// Get the `st_type` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:889 st_type
  st_type(): number {
    return this.st_info & 0xf;
  }

  /// Get the `st_visibility` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:901 st_visibility
  st_visibility(): number {
    return this.st_other & 0x3;
  }

  static readonly POD: Pod<Sym32> = pod_struct(
    [U32.POD, U32.POD, U32.POD, pod_u8, pod_u8, U16.POD],
    (...f: never[]) => new (Sym32 as new (...a: never[]) => Sym32)(...f),
  );
}

/// Symbol table entry.
export class Sym64 {
  constructor(
    /// Symbol name.
    ///
    /// This is an offset into the symbol string table.
    readonly st_name: U32,
    /// Symbol type and binding.
    ///
    /// Use the `st_bind` and `st_type` methods to access this value.
    readonly st_info: number,
    /// Symbol visibility.
    ///
    /// Use the `st_visibility` method to access this value.
    readonly st_other: number,
    /// Section index or one of the `SHN_*` values.
    readonly st_shndx: U16,
    /// Symbol value.
    readonly st_value: U64,
    /// Symbol size.
    readonly st_size: U64,
  ) {}

  /// Get the `st_bind` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:933 st_bind
  st_bind(): number {
    return this.st_info >> 4;
  }

  /// Get the `st_type` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:939 st_type
  st_type(): number {
    return this.st_info & 0xf;
  }

  /// Get the `st_visibility` component of the `st_info` field.
  // crate: object-0.39.1/src/elf.rs:951 st_visibility
  st_visibility(): number {
    return this.st_other & 0x3;
  }

  static readonly POD: Pod<Sym64> = pod_struct(
    [U32.POD, pod_u8, pod_u8, U16.POD, U64.POD, U64.POD],
    (...f: never[]) => new (Sym64 as new (...a: never[]) => Sym64)(...f),
  );
}

/// Program segment header.
export class ProgramHeader32 {
  constructor(
    /// Segment type. One of the `PT_*` constants.
    readonly p_type: U32,
    /// Segment file offset.
    readonly p_offset: U32,
    /// Segment virtual address.
    readonly p_vaddr: U32,
    /// Segment physical address.
    readonly p_paddr: U32,
    /// Segment size in the file.
    readonly p_filesz: U32,
    /// Segment size in memory.
    readonly p_memsz: U32,
    /// Segment flags. A combination of the `PF_*` constants.
    readonly p_flags: U32,
    /// Segment alignment.
    readonly p_align: U32,
  ) {}

  static readonly POD: Pod<ProgramHeader32> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (ProgramHeader32 as new (...a: never[]) => ProgramHeader32)(...f),
  );
}

/// Program segment header.
export class ProgramHeader64 {
  constructor(
    /// Segment type. One of the `PT_*` constants.
    readonly p_type: U32,
    /// Segment flags. A combination of the `PF_*` constants.
    readonly p_flags: U32,
    /// Segment file offset.
    readonly p_offset: U64,
    /// Segment virtual address.
    readonly p_vaddr: U64,
    /// Segment physical address.
    readonly p_paddr: U64,
    /// Segment size in the file.
    readonly p_filesz: U64,
    /// Segment size in memory.
    readonly p_memsz: U64,
    /// Segment alignment.
    readonly p_align: U64,
  ) {}

  static readonly POD: Pod<ProgramHeader64> = pod_struct(
    [U32.POD, U32.POD, U64.POD, U64.POD, U64.POD, U64.POD, U64.POD, U64.POD],
    (...f: never[]) => new (ProgramHeader64 as new (...a: never[]) => ProgramHeader64)(...f),
  );
}

/// Special value for `FileHeader*::e_phnum`.
///
/// This indicates that the real number of program headers is too large to fit into e_phnum.
/// Instead the real value is in the field `sh_info` of section 0.
export const PN_XNUM = 0xffff;
