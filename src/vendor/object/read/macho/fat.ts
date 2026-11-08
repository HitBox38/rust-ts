// Port of object 0.39.1 `src/read/macho/fat.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the `FatArch` trait is a dictionary (`FatArch32_impl`, `FatArch64_impl`: the two `impl FatArch for
// macho::FatArch{32,64}`), with its associated `MAGIC` and the `Pod` of `Self`; its provided methods are
// `FatArch_provided` and take the dictionary first. `MachOFatFile<'data, Fat>` stores its dictionary in a `Fat`
// field. `Word` is a `number` (a `u64` offset or size stays below 2^53 in any file that can be read).

import type { Architecture } from "../../common.ts";
import { BE, U32, U64 } from "../../endian.ts";
import * as macho from "../../macho.ts";
import type { Pod, PodSlice } from "../../pod.ts";
import { Error, read_error_unit, type Result } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import { Err, Ok } from "../../../../std/result.ts";

export { FatArch32, FatArch64, FatHeader } from "../../macho.ts";

/// A Mach-O universal binary.
///
/// This is a file that starts with [`macho::FatHeader`], and corresponds
/// to [`crate::FileKind::MachOFat32`] or [`crate::FileKind::MachOFat64`].
// #[derive(Debug, Clone)]
export class MachOFatFile<F> {
  constructor(
    readonly Fat: FatArch<F>,
    readonly header_: macho.FatHeader,
    readonly arches_: PodSlice<F>,
  ) {}

  /// Attempt to parse the fat header and fat arches.
  // crate: object-0.39.1/src/read/macho/fat.rs:32 parse
  static parse<F>(Fat: FatArch<F>, data: Uint8Array): Result<MachOFatFile<F>> {
    const offset = { value: 0 };
    const h = read_error_unit(ReadRef.read(data, macho.FatHeader.POD, offset), "Invalid fat header size or alignment");
    if (h.$ === "Err") return h;
    const header = h._0;
    if (U32.get(header.magic, BE) !== Fat.MAGIC) {
      return Err(new Error("Invalid fat magic"));
    }
    const arches = read_error_unit(ReadRef.read_slice(data, Fat.POD, offset, U32.get(header.nfat_arch, BE)), "Invalid nfat_arch");
    if (arches.$ === "Err") return arches;
    return Ok(new MachOFatFile(Fat, header, arches._0));
  }

  /// Return the fat header
  // crate: object-0.39.1/src/read/macho/fat.rs:47 header
  header(): macho.FatHeader {
    return this.header_;
  }

  /// Return the array of fat arches.
  // crate: object-0.39.1/src/read/macho/fat.rs:52 arches
  arches(): PodSlice<F> {
    return this.arches_;
  }
}

/// A 32-bit Mach-O universal binary.
///
/// This is a file that starts with [`macho::FatHeader`], and corresponds
/// to [`crate::FileKind::MachOFat32`].
export const MachOFatFile32 = {
  parse(data: Uint8Array): Result<MachOFatFile<macho.FatArch32>> {
    return MachOFatFile.parse(FatArch32_impl, data);
  },
};

/// A 64-bit Mach-O universal binary.
///
/// This is a file that starts with [`macho::FatHeader`], and corresponds
/// to [`crate::FileKind::MachOFat64`].
export const MachOFatFile64 = {
  parse(data: Uint8Array): Result<MachOFatFile<macho.FatArch64>> {
    return MachOFatFile.parse(FatArch64_impl, data);
  },
};

/// A trait for generic access to [`macho::FatArch32`] and [`macho::FatArch64`].
export interface FatArch<F> {
  // type Word: Into<u64>;   (number)
  readonly MAGIC: number;
  /** `Pod` of `Self`. */
  readonly POD: Pod<F>;

  cputype(self: F): number;
  cpusubtype(self: F): number;
  offset(self: F): number;
  size(self: F): number;
  align(self: F): number;

  // architecture (provided)
  // file_range (provided)
  // data (provided)
}

export const FatArch_provided = {
  // crate: object-0.39.1/src/read/macho/fat.rs:69 architecture
  architecture<F>(Fat: FatArch<F>, self: F): Architecture {
    switch (Fat.cputype(self)) {
      case macho.CPU_TYPE_ARM:
        return "Arm";
      case macho.CPU_TYPE_ARM64:
        return "Aarch64";
      case macho.CPU_TYPE_X86:
        return "I386";
      case macho.CPU_TYPE_X86_64:
        return "X86_64";
      case macho.CPU_TYPE_MIPS:
        return "Mips";
      case macho.CPU_TYPE_POWERPC:
        return "PowerPc";
      case macho.CPU_TYPE_POWERPC64:
        return "PowerPc64";
      default:
        return "Unknown";
    }
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:82 file_range
  file_range<F>(Fat: FatArch<F>, self: F): [number, number] {
    return [Fat.offset(self), Fat.size(self)];
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:86 data
  data<F>(Fat: FatArch<F>, self: F, file: Uint8Array): Result<Uint8Array> {
    return read_error_unit(ReadRef.read_bytes_at(file, Fat.offset(self), Fat.size(self)), "Invalid fat arch offset or size");
  },
};

export const FatArch32_impl: FatArch<macho.FatArch32> = {
  MAGIC: macho.FAT_MAGIC,
  POD: macho.FatArch32.POD,

  // crate: object-0.39.1/src/read/macho/fat.rs:96 cputype
  cputype(self: macho.FatArch32): number {
    return U32.get(self.cputype, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:100 cpusubtype
  cpusubtype(self: macho.FatArch32): number {
    return U32.get(self.cpusubtype, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:104 offset
  offset(self: macho.FatArch32): number {
    return U32.get(self.offset, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:108 size
  size(self: macho.FatArch32): number {
    return U32.get(self.size, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:112 align
  align(self: macho.FatArch32): number {
    return U32.get(self.align, BE);
  },
};

export const FatArch64_impl: FatArch<macho.FatArch64> = {
  MAGIC: macho.FAT_MAGIC_64,
  POD: macho.FatArch64.POD,

  // crate: object-0.39.1/src/read/macho/fat.rs:121 cputype
  cputype(self: macho.FatArch64): number {
    return U32.get(self.cputype, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:125 cpusubtype
  cpusubtype(self: macho.FatArch64): number {
    return U32.get(self.cpusubtype, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:129 offset
  offset(self: macho.FatArch64): number {
    return U64.get(self.offset, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:133 size
  size(self: macho.FatArch64): number {
    return U64.get(self.size, BE);
  },

  // crate: object-0.39.1/src/read/macho/fat.rs:137 align
  align(self: macho.FatArch64): number {
    return U32.get(self.align, BE);
  },
};
