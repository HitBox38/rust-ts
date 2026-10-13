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
// PORT: only the definitions the read path uses are ported. The `E: Endian` type parameter is
// erased (see elf.ts); `MachHeader*::magic` is `U32<BigEndian>`, read with `BigEndian`.

import { U16, U32, U64 } from "./endian.ts";
import { type Pod, pod_bytes, pod_struct, pod_u8 } from "./pod.ts";

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
/// 64-bit segment of this file to be mapped
export const LC_SEGMENT_64 = 0x19;

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
/// zero fill on demand section (that can be larger than 4 gigabytes)
export const S_GB_ZEROFILL = 0xc;
/// template of initial values for TLVs
export const S_THREAD_LOCAL_ZEROFILL = 0x12;

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
