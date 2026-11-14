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

// PORT: the constants the ELF writer and `rustc_codegen_ssa::back::metadata` need (lane miri-sysroot).
export const SHN_ABS = 0xfff1;
export const SHN_COMMON = 0xfff2;
export const SHF_WRITE = 1 << 0;
export const SHF_ALLOC = 1 << 1;
export const SHF_EXECINSTR = 1 << 2;
export const SHF_MERGE = 1 << 4;
export const SHF_STRINGS = 1 << 5;
export const SHF_TLS = 1 << 10;
export const SHF_EXCLUDE = 0x80000000;
export const STB_LOCAL = 0;
/// Global symbol.
export const STB_GLOBAL = 1;
/// Weak symbol.
export const STB_WEAK = 2;
export const STT_NOTYPE = 0;
export const STT_OBJECT = 1;
export const STT_FUNC = 2;
export const STT_SECTION = 3;
export const STT_FILE = 4;
export const STT_COMMON = 5;
export const STT_TLS = 6;
export const STT_GNU_IFUNC = 10;
/// Symbol is not visible to other components.
export const STV_HIDDEN = 2;
export const NT_GNU_PROPERTY_TYPE_0 = 5;
export const GNU_PROPERTY_AARCH64_FEATURE_1_AND = 0xc0000000;
export const GNU_PROPERTY_X86_FEATURE_1_AND = 0xc0000002;
export const EF_MIPS_ABI2 = 32;
export const SHT_X86_64_UNWIND = 0x70000001;
export const EM_AARCH64 = 183;
export const EM_ALPHA = 0x9026;
export const EM_ARM = 40;
export const EM_AVR = 83;
export const EM_BPF = 247;
export const EM_CSKY = 252;
export const EM_MCST_ELBRUS = 175;
export const EM_386 = 3;
export const EM_X86_64 = 62;
export const EM_PARISC = 15;
export const EM_HEXAGON = 164;
export const EM_LOONGARCH = 258;
export const EM_68K = 4;
export const EM_MIPS = 8;
export const EM_MSP430 = 105;
export const EM_PPC = 20;
export const EM_PPC64 = 21;
export const EM_RISCV = 243;
export const EM_S390 = 22;
export const EM_SBF = 263;
export const EM_SHARC = 133;
export const EM_SPARC = 2;
export const EM_SPARC32PLUS = 18;
export const EM_SPARCV9 = 43;
export const EM_SH = 42;
export const EM_XTENSA = 94;
export const ELFOSABI_NONE = 0;
export const ELFOSABI_STANDALONE = 255;
export const ELFOSABI_FREEBSD = 9;
export const ELFOSABI_SOLARIS = 6;

// Constants the writer's relocations and comdats need (lane vendor-object-write), in elf.rs order; the comment on each
// gives its elf.rs line.
/// Section group.
export const SHT_GROUP = 17; // elf.rs:710
/// Mark group as COMDAT.
export const GRP_COMDAT = 1; // elf.rs:854
/// Default symbol visibility rules.
export const STV_DEFAULT = 0; // elf.rs:1045
/// No reloc
export const R_68K_NONE = 0; // elf.rs:2091
/// Direct 32 bit
export const R_68K_32 = 1; // elf.rs:2093
/// Direct 16 bit
export const R_68K_16 = 2; // elf.rs:2095
/// Direct 8 bit
export const R_68K_8 = 3; // elf.rs:2097
/// PC relative 32 bit
export const R_68K_PC32 = 4; // elf.rs:2099
/// PC relative 16 bit
export const R_68K_PC16 = 5; // elf.rs:2101
/// PC relative 8 bit
export const R_68K_PC8 = 6; // elf.rs:2103
/// 32 bit PC relative GOT entry
export const R_68K_GOT32 = 7; // elf.rs:2105
/// 16 bit PC relative GOT entry
export const R_68K_GOT16 = 8; // elf.rs:2107
/// 8 bit PC relative GOT entry
export const R_68K_GOT8 = 9; // elf.rs:2109
/// 32 bit GOT offset
export const R_68K_GOT32O = 10; // elf.rs:2111
/// 16 bit GOT offset
export const R_68K_GOT16O = 11; // elf.rs:2113
/// 8 bit GOT offset
export const R_68K_GOT8O = 12; // elf.rs:2115
/// 32 bit PC relative PLT address
export const R_68K_PLT32 = 13; // elf.rs:2117
/// 16 bit PC relative PLT address
export const R_68K_PLT16 = 14; // elf.rs:2119
/// 8 bit PC relative PLT address
export const R_68K_PLT8 = 15; // elf.rs:2121
/// No reloc
export const R_386_NONE = 0; // elf.rs:2178
/// Direct 32 bit
export const R_386_32 = 1; // elf.rs:2180
/// PC relative 32 bit
export const R_386_PC32 = 2; // elf.rs:2182
/// 32 bit GOT entry
export const R_386_GOT32 = 3; // elf.rs:2184
/// 32 bit PLT address
export const R_386_PLT32 = 4; // elf.rs:2186
/// 32 bit offset to GOT
export const R_386_GOTOFF = 9; // elf.rs:2196
/// 32 bit PC relative offset to GOT
export const R_386_GOTPC = 10; // elf.rs:2198
/// Direct 16 bit
export const R_386_16 = 20; // elf.rs:2214
/// PC relative 16 bit
export const R_386_PC16 = 21; // elf.rs:2216
/// Direct 8 bit
export const R_386_8 = 22; // elf.rs:2218
/// PC relative 8 bit
export const R_386_PC8 = 23; // elf.rs:2220
/// 24-bit absolute address in bits 23:0 of a 48-bit instr
///
/// Targets:
///
/// * Type 25a (PC_DIRECT)
export const R_SHARC_ADDR24_V3 = 0x0b; // elf.rs:2271
/// 32-bit absolute address in bits 31:0 of a 48-bit instr
///
/// Targets:
///
/// * Type 14a
/// * Type 14d
/// * Type 15a
/// * Type 16a
/// * Type 17a
/// * Type 18a
/// * Type 19a
export const R_SHARC_ADDR32_V3 = 0x0c; // elf.rs:2284
/// 32-bit absolute address in bits 31:0 of a 32-bit data location
///
/// Represented with `RelocationEncoding::Generic`
export const R_SHARC_ADDR_VAR_V3 = 0x0d; // elf.rs:2289
/// 6-bit PC-relative address in bits 32:27 of a 48-bit instr
///
/// Targets:
///
/// * Type 9a
/// * Type 10a
export const R_SHARC_PCRSHORT_V3 = 0x0e; // elf.rs:2297
/// 24-bit PC-relative address in bits 23:0 of a 48-bit instr
///
/// Targets:
///
/// * Type 8a
/// * Type 12a (truncated to 23 bits after relocation)
/// * Type 13a (truncated to 23 bits after relocation)
/// * Type 25a (PC Relative)
export const R_SHARC_PCRLONG_V3 = 0x0f; // elf.rs:2307
/// 6-bit absolute address in bits 32:27 of a 48-bit instr
///
/// Targets:
///
/// * Type 4a
/// * Type 4b
/// * Type 4d
export const R_SHARC_DATA6_V3 = 0x10; // elf.rs:2316
/// 16-bit absolute address in bits 39:24 of a 48-bit instr
///
/// Targets:
///
/// * Type 12a
export const R_SHARC_DATA16_V3 = 0x11; // elf.rs:2323
/// 6-bit absolute address into bits 16:11 of a 32-bit instr
///
/// Targets:
///
/// * Type 4b
export const R_SHARC_DATA6_VISA_V3 = 0x12; // elf.rs:2330
/// 7-bit absolute address into bits 6:0 of a 32-bit instr
export const R_SHARC_DATA7_VISA_V3 = 0x13; // elf.rs:2333
/// 16-bit absolute address into bits 15:0 of a 32-bit instr
export const R_SHARC_DATA16_VISA_V3 = 0x14; // elf.rs:2336
/// 16-bit absolute address into bits 15:0 of a 16-bit location.
///
/// Represented with `RelocationEncoding::Generic`
export const R_SHARC_ADDR_VAR16_V3 = 0x19; // elf.rs:2348
/// No reloc
export const R_SPARC_NONE = 0; // elf.rs:2398
/// Direct 32 bit unaligned
export const R_SPARC_UA32 = 23; // elf.rs:2444
/// Direct 64 bit unaligned
export const R_SPARC_UA64 = 54; // elf.rs:2509
/// No reloc
export const R_MIPS_NONE = 0; // elf.rs:2770
/// Direct 16 bit
export const R_MIPS_16 = 1; // elf.rs:2772
/// Direct 32 bit
export const R_MIPS_32 = 2; // elf.rs:2774
export const R_MIPS_64 = 18; // elf.rs:2798
/// No reloc.
export const R_PARISC_NONE = 0; // elf.rs:3054
/// Direct 32-bit reference.
export const R_PARISC_DIR32 = 1; // elf.rs:3056
/// 32-bit rel. address.
export const R_PARISC_PCREL32 = 9; // elf.rs:3066
/// No reloc
export const R_ALPHA_NONE = 0; // elf.rs:3325
/// Direct 32 bit
export const R_ALPHA_REFLONG = 1; // elf.rs:3327
/// Direct 64 bit
export const R_ALPHA_REFQUAD = 2; // elf.rs:3329
/// PC relative 16 bit
export const R_ALPHA_SREL16 = 9; // elf.rs:3343
/// PC relative 32 bit
export const R_ALPHA_SREL32 = 10; // elf.rs:3345
/// PC relative 64 bit
export const R_ALPHA_SREL64 = 11; // elf.rs:3347
export const R_PPC_NONE = 0; // elf.rs:3401
/// 32bit absolute address
export const R_PPC_ADDR32 = 1; // elf.rs:3403
export const R_PPC64_NONE = R_PPC_NONE; // elf.rs:3569
/// 32bit absolute address
export const R_PPC64_ADDR32 = R_PPC_ADDR32; // elf.rs:3571
/// doubleword64 S + A
export const R_PPC64_ADDR64 = 38; // elf.rs:3618
/// No relocation.
export const R_AARCH64_NONE = 0; // elf.rs:3897
/// Direct 32 bit.
export const R_AARCH64_P32_ABS32 = 1; // elf.rs:3901
/// Direct 64 bit.
export const R_AARCH64_ABS64 = 257; // elf.rs:3923
/// Direct 32 bit.
export const R_AARCH64_ABS32 = 258; // elf.rs:3925
/// Direct 16-bit.
export const R_AARCH64_ABS16 = 259; // elf.rs:3927
/// PC-relative 64-bit.
export const R_AARCH64_PREL64 = 260; // elf.rs:3929
/// PC-relative 32-bit.
export const R_AARCH64_PREL32 = 261; // elf.rs:3931
/// PC-relative 16-bit.
export const R_AARCH64_PREL16 = 262; // elf.rs:3933
/// Likewise for CALL.
export const R_AARCH64_CALL26 = 283; // elf.rs:3973
export const R_AVR_NONE = 0; // elf.rs:4201
/// Direct 32 bit
export const R_AVR_32 = 1; // elf.rs:4203
/// Direct 16 bit
export const R_AVR_16 = 4; // elf.rs:4207
/// No reloc
export const R_MSP430_NONE = 0; // elf.rs:4244
/// Direct 32 bit
export const R_MSP430_32 = 1; // elf.rs:4246
/// Direct 16 bit
export const R_MSP430_16_BYTE = 5; // elf.rs:4248
/// No reloc
export const R_HEX_NONE = 0; // elf.rs:4253
/// Direct 32 bit
export const R_HEX_32 = 6; // elf.rs:4255
/// No reloc
export const R_ARM_NONE = 0; // elf.rs:4260
/// Direct 32 bit
export const R_ARM_ABS32 = 2; // elf.rs:4264
/// PC relative 32 bit
export const R_ARM_REL32 = 3; // elf.rs:4266
/// Direct 16 bit
export const R_ARM_ABS16 = 5; // elf.rs:4269
/// no reloc
export const R_CKCORE_NONE = 0; // elf.rs:4490
/// direct 32 bit (S + A)
export const R_CKCORE_ADDR32 = 1; // elf.rs:4492
/// 32-bit rel (S + A - P)
export const R_CKCORE_PCREL32 = 5; // elf.rs:4498
export const R_SH_NONE = 0; // elf.rs:4834
export const R_SH_DIR32 = 1; // elf.rs:4835
export const R_SH_REL32 = 2; // elf.rs:4836
/// No reloc.
export const R_390_NONE = 0; // elf.rs:4882
/// Direct 8 bit.
export const R_390_8 = 1; // elf.rs:4884
/// Direct 16 bit.
export const R_390_16 = 3; // elf.rs:4888
/// Direct 32 bit.
export const R_390_32 = 4; // elf.rs:4890
/// PC relative 32 bit.
export const R_390_PC32 = 5; // elf.rs:4892
/// 32 bit GOT offset.
export const R_390_GOT32 = 7; // elf.rs:4896
/// 32 bit offset to GOT.
export const R_390_GOTOFF32 = 13; // elf.rs:4908
/// 32 bit PC relative offset to GOT.
export const R_390_GOTPC = 14; // elf.rs:4910
/// 16 bit GOT offset.
export const R_390_GOT16 = 15; // elf.rs:4912
/// PC relative 16 bit.
export const R_390_PC16 = 16; // elf.rs:4914
/// PC relative 16 bit shifted by 1.
export const R_390_PC16DBL = 17; // elf.rs:4916
/// 16 bit PC rel. PLT shifted by 1.
export const R_390_PLT16DBL = 18; // elf.rs:4918
/// PC relative 32 bit shifted by 1.
export const R_390_PC32DBL = 19; // elf.rs:4920
/// 32 bit PC rel. PLT shifted by 1.
export const R_390_PLT32DBL = 20; // elf.rs:4922
/// 32 bit PC rel. GOT shifted by 1.
export const R_390_GOTPCDBL = 21; // elf.rs:4924
/// Direct 64 bit.
export const R_390_64 = 22; // elf.rs:4926
/// PC relative 64 bit.
export const R_390_PC64 = 23; // elf.rs:4928
/// 64 bit GOT offset.
export const R_390_GOT64 = 24; // elf.rs:4930
/// 32 bit PC rel. to GOT entry >> 1.
export const R_390_GOTENT = 26; // elf.rs:4934
/// 16 bit offset to GOT.
export const R_390_GOTOFF16 = 27; // elf.rs:4936
/// 64 bit offset to GOT.
export const R_390_GOTOFF64 = 28; // elf.rs:4938
/// No reloc
export const R_X86_64_NONE = 0; // elf.rs:5030
/// Direct 64 bit
export const R_X86_64_64 = 1; // elf.rs:5032
/// PC relative 32 bit signed
export const R_X86_64_PC32 = 2; // elf.rs:5034
/// 32 bit GOT entry
export const R_X86_64_GOT32 = 3; // elf.rs:5036
/// 32 bit PLT address
export const R_X86_64_PLT32 = 4; // elf.rs:5038
/// 32 bit signed PC relative offset to GOT
export const R_X86_64_GOTPCREL = 9; // elf.rs:5048
/// Direct 32 bit zero extended
export const R_X86_64_32 = 10; // elf.rs:5050
/// Direct 32 bit sign extended
export const R_X86_64_32S = 11; // elf.rs:5052
/// Direct 16 bit zero extended
export const R_X86_64_16 = 12; // elf.rs:5054
/// 16 bit sign extended pc relative
export const R_X86_64_PC16 = 13; // elf.rs:5056
/// Direct 8 bit sign extended
export const R_X86_64_8 = 14; // elf.rs:5058
/// 8 bit sign extended pc relative
export const R_X86_64_PC8 = 15; // elf.rs:5060
export const R_RISCV_NONE = 0; // elf.rs:5915
export const R_RISCV_32 = 1; // elf.rs:5916
export const R_RISCV_64 = 2; // elf.rs:5917
export const R_RISCV_32_PCREL = 57; // elf.rs:5969
/// No reloc
export const R_BPF_NONE = 0; // elf.rs:5981
export const R_BPF_64_64 = 1; // elf.rs:5982
export const R_BPF_64_32 = 10; // elf.rs:5983
/// No reloc
export const R_SBF_NONE = 0; // elf.rs:5987
export const R_SBF_64_64 = 1; // elf.rs:5988
export const R_SBF_64_32 = 10; // elf.rs:5989
/// No reloc
export const R_LARCH_NONE = 0; // elf.rs:6079
/// Runtime address resolving
export const R_LARCH_32 = 1; // elf.rs:6081
/// Runtime address resolving
export const R_LARCH_64 = 2; // elf.rs:6083
/// 18-bit PC-relative jump offset with two trailing zeros
export const R_LARCH_B16 = 64; // elf.rs:6190
/// 23-bit PC-relative jump offset with two trailing zeros
export const R_LARCH_B21 = 65; // elf.rs:6192
/// 28-bit PC-relative jump offset with two trailing zeros
export const R_LARCH_B26 = 66; // elf.rs:6194
/// 32-bit PC relative
export const R_LARCH_32_PCREL = 99; // elf.rs:6283
/// 64-bit PC relative
export const R_LARCH_64_PCREL = 109; // elf.rs:6305
export const R_XTENSA_NONE = 0; // elf.rs:6401
export const R_XTENSA_32 = 1; // elf.rs:6402
export const R_XTENSA_32_PCREL = 14; // elf.rs:6413
/// Direct 32 bit.
export const R_E2K_32_ABS = 0; // elf.rs:6521
/// Direct 64 bit.
export const R_E2K_64_ABS = 50; // elf.rs:6542
/// Direct 64 bit for literal.
export const R_E2K_64_ABS_LIT = 51; // elf.rs:6544
/// 32-bit offset of the symbol's entry in GOT.
export const R_E2K_GOT = 108; // elf.rs:6591
/// PC relative 28 bit for DISP.
export const R_E2K_DISP = 110; // elf.rs:6595
/// No reloc.
export const R_E2K_NONE = 112; // elf.rs:6599

// The `r_info` constructors of the relocation entries (lane vendor-object-write). PORT: they return the field's value; the
// writer stores it with the file's endianness (write/elf/writer.ts). A 64-bit `r_info` is a `bigint`.

/// Calculate the `r_info` field given the `r_sym` and `r_type` components.
// crate: object-0.39.1/src/elf.rs:1077 r_info
export function Rel32_r_info(r_sym: number, r_type: number): number {
  return ((r_sym << 8) | (r_type & 0xff)) >>> 0;
}

/// Calculate the `r_info` field given the `r_sym` and `r_type` components.
// crate: object-0.39.1/src/elf.rs:1113 r_info
export function Rela32_r_info(r_sym: number, r_type: number): number {
  return ((r_sym << 8) | (r_type & 0xff)) >>> 0;
}

/// Calculate the `r_info` field given the `r_sym` and `r_type` components.
// crate: object-0.39.1/src/elf.rs:1157 r_info
export function Rel64_r_info(r_sym: number, r_type: number): bigint {
  return (BigInt(r_sym >>> 0) << 32n) | BigInt(r_type >>> 0);
}

/// Calculate the `r_info` field given the `r_sym` and `r_type` components.
// crate: object-0.39.1/src/elf.rs:1215 r_info
export function Rela64_r_info(is_mips64el: boolean, r_sym: number, r_type: number): bigint {
  let t = (BigInt(r_sym >>> 0) << 32n) | BigInt(r_type >>> 0);
  if (is_mips64el) {
    t =
      (t >> 32n) |
      ((t & 0xff000000n) << 8n) |
      ((t & 0x00ff0000n) << 24n) |
      ((t & 0x0000ff00n) << 40n) |
      ((t & 0x000000ffn) << 56n);
    t = BigInt.asUintN(64, t);
  }
  return t;
}
