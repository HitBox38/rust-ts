// Port of object 0.39.1 `src/read/macho/section.rs` (`MachOSection`'s data/name access and the
// `Section` trait's accessors).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see ../elf/file.ts for the dictionary encoding of generic traits. Not ported (unused on
// rustc's path): relocations, compression, `flags`, `symbol_stub_size`, `indirect_symbols`.

import { Ok, type Result as StdResult } from "../../../../std/result.ts";
import { SectionKind } from "../../common.ts";
import { type Endianness, U32, U64 } from "../../endian.ts";
import * as macho from "../../macho.ts";
import type { Pod } from "../../pod.ts";
import { read_error_opt, read_error_unit, type Result, type SectionIndex } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import { type ObjectSection, str_from_utf8 } from "../traits.ts";
import { bytes_eq, data_range } from "../util.ts";
import type { MachOFile } from "./file.ts";

/** `macho::Section32<Endianness>` / `macho::Section64<Endianness>`. */
export type SectionValue = macho.Section32 | macho.Section64;

/// An iterator for the sections in a [`MachOFile`].
export class MachOSectionIterator implements Iterable<MachOSection> {
  constructor(
    readonly file: MachOFile,
    public iter: number,
  ) {}

  // crate: object-0.39.1/src/read/macho/section.rs:49 next
  next(): MachOSection | undefined {
    const internal = this.file.sections_[this.iter];
    if (internal === undefined) return undefined;
    this.iter++;
    return new MachOSection(this.file, internal);
  }

  *[Symbol.iterator](): IterableIterator<MachOSection> {
    for (;;) {
      const s = this.next();
      if (s === undefined) return;
      yield s;
    }
  }
}

/// A section in a [`MachOFile`].
///
/// Most functionality is provided by the [`ObjectSection`] trait implementation.
export class MachOSection implements ObjectSection {
  constructor(
    readonly file: MachOFile,
    readonly internal: MachOSectionInternal,
  ) {}

  /// Get the Mach-O file containing this section.
  // crate: object-0.39.1/src/read/macho/section.rs:83 macho_file
  macho_file(): MachOFile {
    return this.file;
  }

  /// Get the raw Mach-O section structure.
  // crate: object-0.39.1/src/read/macho/section.rs:88 macho_section
  macho_section(): SectionValue {
    return this.internal.section;
  }

  // crate: object-0.39.1/src/read/macho/section.rs:99 bytes
  bytes(): Result<Uint8Array> {
    return read_error_unit(
      Section_provided.data(this.file.Mach.Section, this.internal.section, this.file.endian_, this.internal.data),
      "Invalid Mach-O section size or offset",
    );
  }

  // impl ObjectSection for MachOSection

  // crate: object-0.39.1/src/read/macho/section.rs:137 index
  index(): SectionIndex {
    return this.internal.index;
  }

  // crate: object-0.39.1/src/read/macho/section.rs:142 address
  address(): number {
    return this.file.Mach.Section.addr(this.internal.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/macho/section.rs:147 size
  size(): number {
    return this.file.Mach.Section.size(this.internal.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/macho/section.rs:152 align
  align(): number {
    const align = this.file.Mach.Section.align(this.internal.section, this.file.endian_);
    if (align < 64) {
      // PORT: `1 << align` as u64; exact for align < 53 (see endian.ts for larger values).
      return 2 ** align;
    } else {
      return 0;
    }
  }

  // crate: object-0.39.1/src/read/macho/section.rs:162 file_range
  file_range(): [number, number] | undefined {
    return Section_provided.file_range(this.file.Mach.Section, this.internal.section, this.file.endian_);
  }

  // crate: object-0.39.1/src/read/macho/section.rs:167 data
  data(): Result<Uint8Array> {
    return this.bytes();
  }

  // crate: object-0.39.1/src/read/macho/section.rs:171 data_range
  data_range(address: number, size: number): Result<Uint8Array | undefined> {
    const bytes = this.bytes();
    if (bytes.$ === "Err") return bytes;
    return Ok(data_range(bytes._0, this.address(), address, size));
  }

  // crate: object-0.39.1/src/read/macho/section.rs:193 name_bytes
  name_bytes(): Result<Uint8Array> {
    return Ok(Section_provided.name(this.file.Mach.Section, this.internal.section));
  }

  // crate: object-0.39.1/src/read/macho/section.rs:198 name
  name(): Result<string> {
    return read_error_opt(str_from_utf8(Section_provided.name(this.file.Mach.Section, this.internal.section)), "Non UTF-8 Mach-O section name");
  }

  // crate: object-0.39.1/src/read/macho/section.rs:205 segment_name_bytes
  segment_name_bytes(): Result<Uint8Array | undefined> {
    return Ok(Section_provided.segment_name(this.file.Mach.Section, this.internal.section));
  }

  // crate: object-0.39.1/src/read/macho/section.rs:210 segment_name
  segment_name(): Result<string | undefined> {
    const s = read_error_opt(
      str_from_utf8(Section_provided.segment_name(this.file.Mach.Section, this.internal.section)),
      "Non UTF-8 Mach-O segment name",
    );
    if (s.$ === "Err") return s;
    return Ok(s._0);
  }

  // crate: object-0.39.1/src/read/macho/section.rs:218 kind
  kind(): SectionKind {
    return this.internal.kind;
  }
}

/** `MachOSectionInternal` */
export class MachOSectionInternal {
  constructor(
    readonly index: SectionIndex,
    readonly kind: SectionKind,
    readonly section: SectionValue,
    /// The data for the file that contains the section data.
    ///
    /// This is required for dyld caches, where this may be a different subcache
    /// from the file containing the Mach-O load commands.
    readonly data: Uint8Array,
  ) {}

  // crate: object-0.39.1/src/read/macho/section.rs:253 parse
  static parse(Section: Section, index: SectionIndex, section: SectionValue, data: Uint8Array): MachOSectionInternal {
    // TODO: we don't validate flags, should we?
    const seg = Section_provided.segment_name(Section, section);
    const name = Section_provided.name(Section, section);
    const is = (s: string, n: string): boolean => bytes_eq(seg, enc(s)) && bytes_eq(name, enc(n));
    let kind: SectionKind;
    if (is("__TEXT", "__text")) kind = SectionKind.Text;
    else if (is("__TEXT", "__const")) kind = SectionKind.ReadOnlyData;
    else if (is("__TEXT", "__cstring")) kind = SectionKind.ReadOnlyString;
    else if (is("__TEXT", "__literal4")) kind = SectionKind.ReadOnlyData;
    else if (is("__TEXT", "__literal8")) kind = SectionKind.ReadOnlyData;
    else if (is("__TEXT", "__literal16")) kind = SectionKind.ReadOnlyData;
    else if (is("__TEXT", "__eh_frame")) kind = SectionKind.ReadOnlyData;
    else if (is("__TEXT", "__gcc_except_tab")) kind = SectionKind.ReadOnlyData;
    else if (is("__DATA", "__data")) kind = SectionKind.Data;
    else if (is("__DATA", "__const")) kind = SectionKind.ReadOnlyData;
    else if (is("__DATA", "__bss")) kind = SectionKind.UninitializedData;
    else if (is("__DATA", "__common")) kind = SectionKind.Common;
    else if (is("__DATA", "__thread_data")) kind = SectionKind.Tls;
    else if (is("__DATA", "__thread_bss")) kind = SectionKind.UninitializedTls;
    else if (is("__DATA", "__thread_vars")) kind = SectionKind.TlsVariables;
    else if (bytes_eq(seg, enc("__DWARF"))) kind = SectionKind.Debug;
    else kind = SectionKind.Unknown;
    return new MachOSectionInternal(index, kind, section, data);
  }
}

const enc = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/// A trait for generic access to [`macho::Section32`] and [`macho::Section64`].
export interface Section {
  // type Word: Into<u64>;   (number)
  // type Endian: endian::Endian;   (Endianness)
  /** `Self: Pod` */
  readonly POD: Pod<SectionValue>;

  sectname(self: SectionValue): Uint8Array;
  segname(self: SectionValue): Uint8Array;
  addr(self: SectionValue, endian: Endianness): number;
  size(self: SectionValue, endian: Endianness): number;
  offset(self: SectionValue, endian: Endianness): number;
  align(self: SectionValue, endian: Endianness): number;
  reloff(self: SectionValue, endian: Endianness): number;
  nreloc(self: SectionValue, endian: Endianness): number;
  flags(self: SectionValue, endian: Endianness): number;
  reserved1(self: SectionValue, endian: Endianness): number;
  reserved2(self: SectionValue, endian: Endianness): number;

  // (provided) name
  // (provided) segment_name
  // (provided) section_type
  // (provided) file_range
  // (provided) data
}

export const Section_provided = {
  /// Return the `sectname` bytes up until the null terminator.
  // crate: object-0.39.1/src/read/macho/section.rs:302 name
  name(Self: Section, self: SectionValue): Uint8Array {
    const sectname = Self.sectname(self);
    const end = sectname.indexOf(0);
    return end !== -1 ? sectname.subarray(0, end) : sectname;
  },

  /// Return the `segname` bytes up until the null terminator.
  // crate: object-0.39.1/src/read/macho/section.rs:311 segment_name
  segment_name(Self: Section, self: SectionValue): Uint8Array {
    const segname = Self.segname(self);
    const end = segname.indexOf(0);
    return end !== -1 ? segname.subarray(0, end) : segname;
  },

  /// Return the section type from the flags field.
  // crate: object-0.39.1/src/read/macho/section.rs:320 section_type
  section_type(Self: Section, self: SectionValue, endian: Endianness): number {
    return Self.flags(self, endian) & macho.SECTION_TYPE;
  },

  /// Return the offset and size of the section in the file.
  ///
  /// Returns `None` for sections that have no data in the file.
  // crate: object-0.39.1/src/read/macho/section.rs:327 file_range
  file_range(Self: Section, self: SectionValue, endian: Endianness): [number, number] | undefined {
    switch (Section_provided.section_type(Self, self, endian)) {
      case macho.S_ZEROFILL:
      case macho.S_GB_ZEROFILL:
      case macho.S_THREAD_LOCAL_ZEROFILL:
        return undefined;
      default:
        return [Self.offset(self, endian), Self.size(self, endian)];
    }
  },

  /// Return the section data.
  ///
  /// Returns `Ok(&[])` if the section has no data.
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/macho/section.rs:338 data
  data(Self: Section, self: SectionValue, endian: Endianness, data: Uint8Array): StdResult<Uint8Array, undefined> {
    const range = Section_provided.file_range(Self, self, endian);
    if (range !== undefined) {
      const [offset, size] = range;
      return ReadRef.read_bytes_at(data, offset, size);
    } else {
      return Ok(new Uint8Array(0));
    }
  },
};

/// `impl<Endian: endian::Endian> Section for macho::Section32<Endian>`
export const Section32_impl: Section = {
  POD: macho.Section32.POD,

  // crate: object-0.39.1/src/read/macho/section.rs:408 sectname
  sectname(self: macho.Section32): Uint8Array {
    return self.sectname;
  },
  // crate: object-0.39.1/src/read/macho/section.rs:411 segname
  segname(self: macho.Section32): Uint8Array {
    return self.segname;
  },
  // crate: object-0.39.1/src/read/macho/section.rs:414 addr
  addr(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.addr, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:417 size
  size(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.size, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:420 offset
  offset(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.offset, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:423 align
  align(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.align, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:426 reloff
  reloff(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.reloff, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:429 nreloc
  nreloc(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.nreloc, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:432 flags
  flags(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:435 reserved1
  reserved1(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.reserved1, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:438 reserved2
  reserved2(self: macho.Section32, endian: Endianness): number {
    return U32.get(self.reserved2, endian);
  },
} as Section;

/// `impl<Endian: endian::Endian> Section for macho::Section64<Endian>`
export const Section64_impl: Section = {
  POD: macho.Section64.POD,

  // crate: object-0.39.1/src/read/macho/section.rs:447 sectname
  sectname(self: macho.Section64): Uint8Array {
    return self.sectname;
  },
  // crate: object-0.39.1/src/read/macho/section.rs:450 segname
  segname(self: macho.Section64): Uint8Array {
    return self.segname;
  },
  // crate: object-0.39.1/src/read/macho/section.rs:453 addr
  addr(self: macho.Section64, endian: Endianness): number {
    return U64.get(self.addr, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:456 size
  size(self: macho.Section64, endian: Endianness): number {
    return U64.get(self.size, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:459 offset
  offset(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.offset, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:462 align
  align(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.align, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:465 reloff
  reloff(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.reloff, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:468 nreloc
  nreloc(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.nreloc, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:471 flags
  flags(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:474 reserved1
  reserved1(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.reserved1, endian);
  },
  // crate: object-0.39.1/src/read/macho/section.rs:477 reserved2
  reserved2(self: macho.Section64, endian: Endianness): number {
    return U32.get(self.reserved2, endian);
  },
} as Section;
