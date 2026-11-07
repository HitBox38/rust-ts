// Port of object 0.39.1 `src/macho.rs` (the structs and constants the Mach-O reader reaches).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Mach-O definitions.
//!
//! These definitions are independent of read/write support, although we do implement
//! some traits useful for those.
//!
//! This module is based heavily on header files from MacOSX11.1.sdk.
//
// PORT: only the definitions the read path and the writer (write/macho.ts) use are ported. The `E: Endian` type parameter is
// erased (see elf.ts); `MachHeader*::magic` is `U32<BigEndian>`, read with `BigEndian`.

import { U16, U32, U64 } from "./endian.ts";
import { type Pod, pod_bytes, pod_struct, pod_u8 } from "./pod.ts";

// Definitions from "/usr/include/mach/machine.h".

/*
 * Capability bits used in the definition of cpu_type.
 */

/// 64 bit ABI
export const CPU_ARCH_ABI64 = 0x0100_0000;
/// ABI for 64-bit hardware with 32-bit types; LP32
export const CPU_ARCH_ABI64_32 = 0x0200_0000;

/*
 *	Machine types known by all.
 */

export const CPU_TYPE_X86 = 7;
export const CPU_TYPE_X86_64 = (CPU_TYPE_X86 | CPU_ARCH_ABI64) >>> 0;
export const CPU_TYPE_ARM = 12;
export const CPU_TYPE_ARM64 = (CPU_TYPE_ARM | CPU_ARCH_ABI64) >>> 0;
export const CPU_TYPE_ARM64_32 = (CPU_TYPE_ARM | CPU_ARCH_ABI64_32) >>> 0;
export const CPU_TYPE_POWERPC = 18;
export const CPU_TYPE_POWERPC64 = (CPU_TYPE_POWERPC | CPU_ARCH_ABI64) >>> 0;

/// pointer authentication with versioned ABI
export const CPU_SUBTYPE_PTRAUTH_ABI = 0x8000_0000;

/*
 *	I386 subtypes
 */

// crate: object-0.39.1/src/macho.rs:128 cpu_subtype_intel
export function cpu_subtype_intel(f: number, m: number): number {
  return f + (m << 4);
}

export const CPU_SUBTYPE_I386_ALL = cpu_subtype_intel(3, 0);

export const CPU_SUBTYPE_X86_64_ALL = 3;

/*
 *	PowerPC subtypes
 */
export const CPU_SUBTYPE_POWERPC_ALL = 0;

/*
 *	ARM subtypes
 */
export const CPU_SUBTYPE_ARM_ALL = 0;

/*
 *  ARM64 subtypes
 */
export const CPU_SUBTYPE_ARM64_ALL = 0;
export const CPU_SUBTYPE_ARM64E = 2;

/*
 *  ARM64_32 subtypes
 */
export const CPU_SUBTYPE_ARM64_32_V8 = 1;

// Definitions from "/usr/include/mach/vm_prot.h".

/// read permission
export const VM_PROT_READ = 0x01;
/// write permission
export const VM_PROT_WRITE = 0x02;
/// execute permission
export const VM_PROT_EXECUTE = 0x04;

/// The 32-bit mach header.
///
/// Appears at the very beginning of the object file for 32-bit architectures.
export class MachHeader32 {
  constructor(
    /// mach magic number identifier
    readonly magic: U32,
    /// cpu specifier
    readonly cputype: U32,
    /// machine specifier
    readonly cpusubtype: U32,
    /// type of file
    readonly filetype: U32,
    /// number of load commands
    readonly ncmds: U32,
    /// the size of all the load commands
    readonly sizeofcmds: U32,
    /// flags
    readonly flags: U32,
  ) {}

  static readonly POD: Pod<MachHeader32> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (MachHeader32 as new (...a: never[]) => MachHeader32)(...f),
  );
}

// Values for `MachHeader32::magic`.
/// the mach magic number
export const MH_MAGIC = 0xfeed_face;
/// the mach magic number (byte swapped)
export const MH_CIGAM = 0xcefa_edfe;

/// The 64-bit mach header.
///
/// Appears at the very beginning of object files for 64-bit architectures.
export class MachHeader64 {
  constructor(
    /// mach magic number identifier
    readonly magic: U32,
    /// cpu specifier
    readonly cputype: U32,
    /// machine specifier
    readonly cpusubtype: U32,
    /// type of file
    readonly filetype: U32,
    /// number of load commands
    readonly ncmds: U32,
    /// the size of all the load commands
    readonly sizeofcmds: U32,
    /// flags
    readonly flags: U32,
    /// reserved
    readonly reserved: U32,
  ) {}

  static readonly POD: Pod<MachHeader64> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (MachHeader64 as new (...a: never[]) => MachHeader64)(...f),
  );
}

// Values for `MachHeader64::magic`.
/// the 64-bit mach magic number
export const MH_MAGIC_64 = 0xfeed_facf;
/// the 64-bit mach magic number (byte swapped)
export const MH_CIGAM_64 = 0xcffa_edfe;

// Values for `MachHeader*::filetype`.
/// relocatable object file
export const MH_OBJECT = 0x1;
/// demand paged executable file
export const MH_EXECUTE = 0x2;
/// fixed VM shared library file
export const MH_FVMLIB = 0x3;
/// core file
export const MH_CORE = 0x4;
/// preloaded executable file
export const MH_PRELOAD = 0x5;
/// dynamically bound shared library
export const MH_DYLIB = 0x6;

// Constants for the flags field of the mach_header
/// safe to divide up the sections into sub-sections via symbols for dead code stripping
export const MH_SUBSECTIONS_VIA_SYMBOLS = 0x2000;

/// Common fields at the start of every load command.
///
/// The load commands directly follow the mach_header.  The total size of all
/// of the commands is given by the sizeofcmds field in the mach_header.  All
/// load commands must have as their first two fields `cmd` and `cmdsize`.  The `cmd`
/// field is filled in with a constant for that command type.  Each command type
/// has a structure specifically for it.  The `cmdsize` field is the size in bytes
/// of the particular load command structure plus anything that follows it that
/// is a part of the load command (i.e. section structures, strings, etc.).  To
/// advance to the next load command the `cmdsize` can be added to the offset or
/// pointer of the current load command.  The `cmdsize` for 32-bit architectures
/// MUST be a multiple of 4 bytes and for 64-bit architectures MUST be a multiple
/// of 8 bytes (these are forever the maximum alignment of any load commands).
/// The padded bytes must be zero.  All tables in the object file must also
/// follow these rules so the file can be memory mapped.  Otherwise the pointers
/// to these tables will not work well or at all on some machines.  With all
/// padding zeroed like objects will compare byte for byte.
export class LoadCommand {
  constructor(
    /// Type of load command.
    ///
    /// One of the `LC_*` constants.
    readonly cmd: U32,
    /// Total size of command in bytes.
    readonly cmdsize: U32,
  ) {}

  static readonly POD: Pod<LoadCommand> = pod_struct(
    [U32.POD, U32.POD],
    (...f: never[]) => new (LoadCommand as new (...a: never[]) => LoadCommand)(...f),
  );
}

// Constants for the cmd field of all load commands, the type
/// segment of this file to be mapped
export const LC_SEGMENT = 0x1;
/// link-edit stab symbol table info
export const LC_SYMTAB = 0x2;
/// dynamic link-edit symbol table info
export const LC_DYSYMTAB = 0xb;
/// 64-bit segment of this file to be mapped
export const LC_SEGMENT_64 = 0x19;
/// build for platform min OS version
export const LC_BUILD_VERSION = 0x32;

/// 32-bit segment load command.
///
/// The segment load command indicates that a part of this file is to be
/// mapped into the task's address space.  The size of this segment in memory,
/// vmsize, maybe equal to or larger than the amount to map from this file,
/// filesize.  The file is mapped starting at fileoff to the beginning of
/// the segment in memory, vmaddr.  The rest of the memory of the segment,
/// if any, is allocated zero fill on demand.  The segment's maximum virtual
/// memory protection and initial virtual memory protection are specified
/// by the maxprot and initprot fields.  If the segment has sections then the
/// `Section32` structures directly follow the segment command and their size is
/// reflected in `cmdsize`.
export class SegmentCommand32 {
  constructor(
    /// LC_SEGMENT
    readonly cmd: U32,
    /// includes sizeof section structs
    readonly cmdsize: U32,
    /// segment name
    readonly segname: Uint8Array,
    /// memory address of this segment
    readonly vmaddr: U32,
    /// memory size of this segment
    readonly vmsize: U32,
    /// file offset of this segment
    readonly fileoff: U32,
    /// amount to map from the file
    readonly filesize: U32,
    /// maximum VM protection
    readonly maxprot: U32,
    /// initial VM protection
    readonly initprot: U32,
    /// number of sections in segment
    readonly nsects: U32,
    /// flags
    readonly flags: U32,
  ) {}

  static readonly POD: Pod<SegmentCommand32> = pod_struct(
    [U32.POD, U32.POD, pod_bytes(16), U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (SegmentCommand32 as new (...a: never[]) => SegmentCommand32)(...f),
  );
}

/// 64-bit segment load command.
///
/// The 64-bit segment load command indicates that a part of this file is to be
/// mapped into a 64-bit task's address space.  If the 64-bit segment has
/// sections then `Section64` structures directly follow the 64-bit segment
/// command and their size is reflected in `cmdsize`.
export class SegmentCommand64 {
  constructor(
    /// LC_SEGMENT_64
    readonly cmd: U32,
    /// includes sizeof section_64 structs
    readonly cmdsize: U32,
    /// segment name
    readonly segname: Uint8Array,
    /// memory address of this segment
    readonly vmaddr: U64,
    /// memory size of this segment
    readonly vmsize: U64,
    /// file offset of this segment
    readonly fileoff: U64,
    /// amount to map from the file
    readonly filesize: U64,
    /// maximum VM protection
    readonly maxprot: U32,
    /// initial VM protection
    readonly initprot: U32,
    /// number of sections in segment
    readonly nsects: U32,
    /// flags
    readonly flags: U32,
  ) {}

  static readonly POD: Pod<SegmentCommand64> = pod_struct(
    [U32.POD, U32.POD, pod_bytes(16), U64.POD, U64.POD, U64.POD, U64.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (SegmentCommand64 as new (...a: never[]) => SegmentCommand64)(...f),
  );
}

/// 32-bit section.
export class Section32 {
  constructor(
    /// name of this section
    readonly sectname: Uint8Array,
    /// segment this section goes in
    readonly segname: Uint8Array,
    /// memory address of this section
    readonly addr: U32,
    /// size in bytes of this section
    readonly size: U32,
    /// file offset of this section
    readonly offset: U32,
    /// section alignment (power of 2)
    readonly align: U32,
    /// file offset of relocation entries
    readonly reloff: U32,
    /// number of relocation entries
    readonly nreloc: U32,
    /// flags (section type and attributes)
    readonly flags: U32,
    /// reserved (for offset or index)
    readonly reserved1: U32,
    /// reserved (for count or sizeof)
    readonly reserved2: U32,
  ) {}

  static readonly POD: Pod<Section32> = pod_struct(
    [pod_bytes(16), pod_bytes(16), U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (Section32 as new (...a: never[]) => Section32)(...f),
  );
}

/// 64-bit section.
export class Section64 {
  constructor(
    /// name of this section
    readonly sectname: Uint8Array,
    /// segment this section goes in
    readonly segname: Uint8Array,
    /// memory address of this section
    readonly addr: U64,
    /// size in bytes of this section
    readonly size: U64,
    /// file offset of this section
    readonly offset: U32,
    /// section alignment (power of 2)
    readonly align: U32,
    /// file offset of relocation entries
    readonly reloff: U32,
    /// number of relocation entries
    readonly nreloc: U32,
    /// flags (section type and attributes)
    readonly flags: U32,
    /// reserved (for offset or index)
    readonly reserved1: U32,
    /// reserved (for count or sizeof)
    readonly reserved2: U32,
    /// reserved
    readonly reserved3: U32,
  ) {}

  static readonly POD: Pod<Section64> = pod_struct(
    [pod_bytes(16), pod_bytes(16), U64.POD, U64.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (Section64 as new (...a: never[]) => Section64)(...f),
  );
}

/*
 * The flags field of a section structure is separated into two parts a section
 * type and section attributes.  The section types are mutually exclusive (it
 * can only have one type) but the section attributes are not (it may have more
 * than one attribute).
 */
/// 256 section types
export const SECTION_TYPE = 0x0000_00ff;

/* Constants for the type of a section */
/// zero fill on demand section
export const S_ZEROFILL = 0x1;
/// section with only literal C strings
export const S_CSTRING_LITERALS = 0x2;
/// section contains symbols that are to be coalesced
export const S_COALESCED = 0xb;
/// zero fill on demand section (that can be larger than 4 gigabytes)
export const S_GB_ZEROFILL = 0xc;
/// template of initial values for TLVs
/// template of initial values for TLVs
export const S_THREAD_LOCAL_REGULAR = 0x11;
/// template of initial values for TLVs
export const S_THREAD_LOCAL_ZEROFILL = 0x12;
/// TLV descriptors
export const S_THREAD_LOCAL_VARIABLES = 0x13;

/*
 * Constants for the section attributes part of the flags field of a section
 * structure.
 */
/// section contains only true machine instructions
export const S_ATTR_PURE_INSTRUCTIONS = 0x8000_0000;
/// section contains coalesced symbols that are not to be in a ranlib table of contents
export const S_ATTR_NO_TOC = 0x4000_0000;
/// ok to strip static symbols in this section in files with the MH_DYLDLINK flag
export const S_ATTR_STRIP_STATIC_SYMS = 0x2000_0000;
/// blocks are live if they reference live blocks
export const S_ATTR_LIVE_SUPPORT = 0x0800_0000;
/// a debug section
export const S_ATTR_DEBUG = 0x0200_0000;
/// section contains some machine instructions
export const S_ATTR_SOME_INSTRUCTIONS = 0x0000_0400;

/// Symbol table load command.
export class SymtabCommand {
  constructor(
    /// LC_SYMTAB
    readonly cmd: U32,
    /// sizeof(struct SymtabCommand)
    readonly cmdsize: U32,
    /// symbol table offset
    readonly symoff: U32,
    /// number of symbol table entries
    readonly nsyms: U32,
    /// string table offset
    readonly stroff: U32,
    /// string table size in bytes
    readonly strsize: U32,
  ) {}

  static readonly POD: Pod<SymtabCommand> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (SymtabCommand as new (...a: never[]) => SymtabCommand)(...f),
  );
}

/// Dynamic symbol table load command (see upstream for the description of its groups).
export class DysymtabCommand {
  constructor(
    /// LC_DYSYMTAB
    readonly cmd: U32,
    /// sizeof(struct DysymtabCommand)
    readonly cmdsize: U32,
    /// index to local symbols
    readonly ilocalsym: U32,
    /// number of local symbols
    readonly nlocalsym: U32,
    /// index to externally defined symbols
    readonly iextdefsym: U32,
    /// number of externally defined symbols
    readonly nextdefsym: U32,
    /// index to undefined symbols
    readonly iundefsym: U32,
    /// number of undefined symbols
    readonly nundefsym: U32,
    /// file offset to table of contents
    readonly tocoff: U32,
    /// number of entries in table of contents
    readonly ntoc: U32,
    /// file offset to module table
    readonly modtaboff: U32,
    /// number of module table entries
    readonly nmodtab: U32,
    /// offset to referenced symbol table
    readonly extrefsymoff: U32,
    /// number of referenced symbol table entries
    readonly nextrefsyms: U32,
    /// file offset to the indirect symbol table
    readonly indirectsymoff: U32,
    /// number of indirect symbol table entries
    readonly nindirectsyms: U32,
    /// offset to external relocation entries
    readonly extreloff: U32,
    /// number of external relocation entries
    readonly nextrel: U32,
    /// offset to local relocation entries
    readonly locreloff: U32,
    /// number of local relocation entries
    readonly nlocrel: U32,
  ) {}

  static readonly POD: Pod<DysymtabCommand> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (DysymtabCommand as new (...a: never[]) => DysymtabCommand)(...f),
  );
}

/*
 * The BuildVersionCommand contains the min OS version on which this
 * binary was built to run for its platform.  The list of known platforms and
 * tool values following it.
 */
export class BuildVersionCommand {
  constructor(
    /// LC_BUILD_VERSION
    readonly cmd: U32,
    /// sizeof(struct BuildVersionCommand) plus ntools * sizeof(struct BuildToolVersion)
    readonly cmdsize: U32,
    /// platform
    readonly platform: U32,
    /// X.Y.Z is encoded in nibbles xxxx.yy.zz
    readonly minos: U32,
    /// X.Y.Z is encoded in nibbles xxxx.yy.zz
    readonly sdk: U32,
    /// number of tool entries following this
    readonly ntools: U32,
  ) {}

  static readonly POD: Pod<BuildVersionCommand> = pod_struct(
    [U32.POD, U32.POD, U32.POD, U32.POD, U32.POD, U32.POD],
    (...f: never[]) => new (BuildVersionCommand as new (...a: never[]) => BuildVersionCommand)(...f),
  );
}

/* Known values for the platform field above. */
export const PLATFORM_MACOS = 1;
export const PLATFORM_IOS = 2;
export const PLATFORM_TVOS = 3;
export const PLATFORM_WATCHOS = 4;
export const PLATFORM_MACCATALYST = 6;
export const PLATFORM_IOSSIMULATOR = 7;
export const PLATFORM_TVOSSIMULATOR = 8;
export const PLATFORM_WATCHOSSIMULATOR = 9;
export const PLATFORM_VISIONOS = 11;
export const PLATFORM_VISIONOSSIMULATOR = 12;
/// Compatibility alias for [`PLATFORM_VISIONOS`].
export const PLATFORM_XROS = PLATFORM_VISIONOS;
/// Compatibility alias for [`PLATFORM_VISIONOSSIMULATOR`].
export const PLATFORM_XROSSIMULATOR = PLATFORM_VISIONOSSIMULATOR;

/// 32-bit symbol table entry.
export class Nlist32 {
  constructor(
    /// index into the string table
    readonly n_strx: U32,
    /// type flag, see below
    readonly n_type: number,
    /// section number or NO_SECT
    readonly n_sect: number,
    /// see <mach-o/stab.h>
    readonly n_desc: U16,
    /// value of this symbol (or stab offset)
    readonly n_value: U32,
  ) {}

  static readonly POD: Pod<Nlist32> = pod_struct(
    [U32.POD, pod_u8, pod_u8, U16.POD, U32.POD],
    (...f: never[]) => new (Nlist32 as new (...a: never[]) => Nlist32)(...f),
  );
}

/// 64-bit symbol table entry.
export class Nlist64 {
  constructor(
    /// index into the string table
    readonly n_strx: U32,
    /// type flag, see below
    readonly n_type: number,
    /// section number or NO_SECT
    readonly n_sect: number,
    /// see <mach-o/stab.h>
    readonly n_desc: U16,
    /// value of this symbol (or stab offset)
    readonly n_value: U64,
  ) {}

  static readonly POD: Pod<Nlist64> = pod_struct(
    [U32.POD, pod_u8, pod_u8, U16.POD, U64.POD],
    (...f: never[]) => new (Nlist64 as new (...a: never[]) => Nlist64)(...f),
  );
}

/*
 * The n_type field really contains four fields:
 *	unsigned char N_STAB:3,
 *		      N_PEXT:1,
 *		      N_TYPE:3,
 *		      N_EXT:1;
 * which are used via the following masks.
 */
/// if any of these bits set, a symbolic debugging entry
export const N_STAB = 0xe0;
/// private external symbol bit
export const N_PEXT = 0x10;
/// mask for the type bits
export const N_TYPE = 0x0e;
/// external symbol bit, set for external symbols
export const N_EXT = 0x01;

/*
 * Values for N_TYPE bits of the n_type field.
 */
/// undefined, n_sect == NO_SECT
export const N_UNDF = 0x0;
/// absolute, n_sect == NO_SECT
export const N_ABS = 0x2;
/// defined in section number n_sect
export const N_SECT = 0xe;

/// symbol is weak referenced
export const N_WEAK_REF = 0x0040;
/// coalesced symbol is a weak definition
export const N_WEAK_DEF = 0x0080;
