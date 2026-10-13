// Port of object 0.39.1 `src/read/macho/file.rs` (parsing and the `Object` methods the metadata
// reader uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see ../elf/file.ts for the dictionary encoding of `Mach: MachHeader` (`MachHeader32_impl`
// / `MachHeader64_impl`, provided methods in `MachHeader_provided`) and for `Endian` being
// `Endianness`. Not ported (unused on rustc's path): dyld cache images, `build_version`,
// architecture, segments/comdats/symbol iterators, imports/exports, `uuid`, `entry`, `flags`.

import { Err, Ok } from "../../../../std/result.ts";
import { BigEndian, type EndianType, Endianness, U32 } from "../../endian.ts";
import * as macho from "../../macho.ts";
import type { Pod } from "../../pod.ts";
import { Error, type ObjectKind, read_error_opt, read_error_unit, type Result, SectionIndex } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import type { Object } from "../traits.ts";
import { bytes_eq } from "../util.ts";
import { LoadCommandIterator, SymtabCommand_symbols } from "./load_command.ts";
import { type Section, MachOSection, MachOSectionInternal, MachOSectionIterator } from "./section.ts";
import { type MachOSegmentInternal, type Segment, SegmentCommand32_impl, SegmentCommand64_impl, Segment_provided } from "./segment.ts";
import { SymbolTable } from "./symbol.ts";

/** `macho::MachHeader32<Endianness>` / `macho::MachHeader64<Endianness>`. */
export type MachHeaderValue = macho.MachHeader32 | macho.MachHeader64;

/// A 32-bit Mach-O object file.
///
/// This is a file that starts with [`macho::MachHeader32`], and corresponds
/// to [`crate::FileKind::MachO32`].
export const MachOFile32 = {
  parse(data: Uint8Array): Result<MachOFile> {
    return MachOFile.parse(MachHeader32_impl, data);
  },
};

/// A 64-bit Mach-O object file.
///
/// This is a file that starts with [`macho::MachHeader64`], and corresponds
/// to [`crate::FileKind::MachO64`].
export const MachOFile64 = {
  parse(data: Uint8Array): Result<MachOFile> {
    return MachOFile.parse(MachHeader64_impl, data);
  },
};

/// A partially parsed Mach-O file.
///
/// Most of the functionality of this type is provided by the [`Object`] trait implementation.
export class MachOFile implements Object<MachOSection> {
  constructor(
    /** PORT: the `Mach: MachHeader` type parameter. */
    readonly Mach: MachHeader,
    readonly endian_: Endianness,
    readonly data_: Uint8Array,
    readonly header_offset: number,
    readonly header: MachHeaderValue,
    readonly segments: MachOSegmentInternal[],
    readonly sections_: MachOSectionInternal[],
    readonly symbols: SymbolTable,
  ) {}

  /// Parse the raw Mach-O file data.
  // crate: object-0.39.1/src/read/macho/file.rs:66 parse
  static parse(Mach: MachHeader, data: Uint8Array): Result<MachOFile> {
    const h = MachHeader_provided.parse(Mach, data, 0);
    if (h.$ === "Err") return h;
    const header = h._0;
    const e = MachHeader_provided.endian(Mach, header);
    if (e.$ === "Err") return e;
    const endian = e._0;

    // Build a list of segments and sections to make some operations more efficient.
    const segments: MachOSegmentInternal[] = [];
    const sections: MachOSectionInternal[] = [];
    let symbols = SymbolTable.default(Mach);
    const commands_r = MachHeader_provided.load_commands(Mach, header, endian, data, 0);
    if (commands_r.$ === "Ok") {
      const commands = commands_r._0;
      for (;;) {
        const c = commands.next();
        if (c.$ !== "Ok" || c._0 === undefined) break;
        const command = c._0;
        const fc = Mach.Segment.from_command(command);
        if (fc.$ === "Err") return fc;
        if (fc._0 !== undefined) {
          const [segment, section_data] = fc._0;
          segments.push({ segment, data });
          const secs = Segment_provided.sections(Mach.Segment, segment, endian, section_data);
          if (secs.$ === "Err") return secs;
          for (const section of secs._0) {
            const index = SectionIndex(sections.length + 1);
            sections.push(MachOSectionInternal.parse(Mach.Section, index, section, data));
          }
        } else {
          const st = command.symtab();
          if (st.$ === "Err") return st;
          if (st._0 !== undefined) {
            const s = SymtabCommand_symbols(st._0, Mach, endian, data);
            if (s.$ === "Err") return s;
            symbols = s._0;
          }
        }
      }
    }

    return Ok(new MachOFile(Mach, endian, data, 0, header, segments, sections, symbols));
  }

  /// Return the section at the given index.
  // crate: object-0.39.1/src/read/macho/file.rs:162 section_internal
  section_internal(index: SectionIndex): Result<MachOSectionInternal> {
    // `index.0.checked_sub(1).and_then(|index| self.sections.get(index))`
    return read_error_opt(index >= 1 ? this.sections_[index - 1] : undefined, "Invalid Mach-O section index");
  }

  /// Returns the endianness.
  // crate: object-0.39.1/src/read/macho/file.rs:174 endian
  endian(): Endianness {
    return this.endian_;
  }

  /// Returns the raw data.
  // crate: object-0.39.1/src/read/macho/file.rs:179 data
  data(): Uint8Array {
    return this.data_;
  }

  /// Get the raw Mach-O file header.
  // crate: object-0.39.1/src/read/macho/file.rs:190 macho_header
  macho_header(): MachHeaderValue {
    return this.header;
  }

  /// Get the Mach-O load commands.
  // crate: object-0.39.1/src/read/macho/file.rs:195 macho_load_commands
  macho_load_commands(): Result<LoadCommandIterator> {
    return MachHeader_provided.load_commands(this.Mach, this.header, this.endian_, this.data_, this.header_offset);
  }

  /// Get the Mach-O symbol table.
  ///
  /// Returns an empty symbol table if the file has no symbol table.
  // crate: object-0.39.1/src/read/macho/file.rs:203 macho_symbol_table
  macho_symbol_table(): SymbolTable {
    return this.symbols;
  }

  // impl Object for MachOFile

  // crate: object-0.39.1/src/read/macho/file.rs:309 is_little_endian
  is_little_endian(): boolean {
    return this.Mach.is_little_endian(this.header);
  }

  // crate: object-0.39.1/src/read/macho/file.rs:314 is_64
  is_64(): boolean {
    return this.Mach.is_type_64(this.header);
  }

  // crate: object-0.39.1/src/read/macho/file.rs:318 kind
  kind(): ObjectKind {
    switch (this.Mach.filetype(this.header, this.endian_)) {
      case macho.MH_OBJECT:
        return "Relocatable";
      case macho.MH_EXECUTE:
        return "Executable";
      case macho.MH_CORE:
        return "Core";
      case macho.MH_DYLIB:
        return "Dynamic";
      default:
        return "Unknown";
    }
  }

  // crate: object-0.39.1/src/read/macho/file.rs:335 section_by_name_bytes
  section_by_name_bytes(section_name: Uint8Array): MachOSection | undefined {
    // Translate the section_name by stripping the query_prefix to construct
    // a function that matches names starting with name_prefix, taking into
    // consideration the maximum section name length.
    const make_prefix_matcher = (query_prefix: Uint8Array, name_prefix: Uint8Array): ((name: Uint8Array) => boolean) => {
      const MAX_SECTION_NAME_LEN = 16;
      const stripped = strip_prefix(section_name, query_prefix);
      const suffix =
        stripped === undefined
          ? undefined
          : stripped.subarray(0, Math.min(stripped.length, MAX_SECTION_NAME_LEN - name_prefix.length));
      return (name: Uint8Array): boolean => {
        if (suffix === undefined) return false;
        const n = strip_prefix(name, name_prefix);
        return n !== undefined && bytes_eq(n, suffix);
      };
    };
    // Matches "__text" when searching for ".text" and "__debug_str_offs"
    // when searching for ".debug_str_offsets", as is common in
    // macOS/Mach-O.
    const matches_underscores_prefix = make_prefix_matcher(enc("."), enc("__"));
    // Matches "__zdebug_info" when searching for ".debug_info" and
    // "__zdebug_str_off" when searching for ".debug_str_offsets", as is
    // used by Go when using GNU-style compression.
    const matches_zdebug_prefix = make_prefix_matcher(enc(".debug_"), enc("__zdebug_"));
    for (const section of this.sections()) {
      const name = section.name_bytes();
      if (name.$ === "Ok") {
        const n = name._0;
        if (bytes_eq(n, section_name) || matches_underscores_prefix(n) || matches_zdebug_prefix(n)) return section;
      }
    }
    return undefined;
  }

  // crate: object-0.39.1/src/read/macho/file.rs:367 section_by_index
  section_by_index(index: SectionIndex): Result<MachOSection> {
    const internal = this.section_internal(index);
    if (internal.$ === "Err") return internal;
    return Ok(new MachOSection(this, internal._0));
  }

  // crate: object-0.39.1/src/read/macho/file.rs:375 sections
  sections(): MachOSectionIterator {
    return new MachOSectionIterator(this, 0);
  }
}

const enc = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** `<[u8]>::strip_prefix` */
function strip_prefix(s: Uint8Array, prefix: Uint8Array): Uint8Array | undefined {
  if (s.length < prefix.length) return undefined;
  for (let i = 0; i < prefix.length; i++) if (s[i] !== prefix[i]) return undefined;
  return s.subarray(prefix.length);
}

/// A trait for generic access to [`macho::MachHeader32`] and [`macho::MachHeader64`].
export interface MachHeader {
  // type Word: Into<u64>;   (number)
  /** `type Endian: endian::Endian;` */
  readonly Endian: EndianType<Endianness>;
  /** `type Segment` (its trait dictionary). */
  readonly Segment: Segment;
  /** `type Section` (its trait dictionary). */
  readonly Section: Section;
  /** `type Nlist` (its `Pod`). */
  readonly Nlist: Pod<unknown>;
  /** `Self: Pod` */
  readonly POD: Pod<MachHeaderValue>;

  /// Return true if this type is a 64-bit header.
  ///
  /// This is a property of the type, not a value in the header data.
  is_type_64(self: MachHeaderValue): boolean;

  /// Return true if the `magic` field signifies big-endian.
  is_big_endian(self: MachHeaderValue): boolean;

  /// Return true if the `magic` field signifies little-endian.
  is_little_endian(self: MachHeaderValue): boolean;

  magic(self: MachHeaderValue): number;
  cputype(self: MachHeaderValue, endian: Endianness): number;
  cpusubtype(self: MachHeaderValue, endian: Endianness): number;
  filetype(self: MachHeaderValue, endian: Endianness): number;
  ncmds(self: MachHeaderValue, endian: Endianness): number;
  sizeofcmds(self: MachHeaderValue, endian: Endianness): number;
  flags(self: MachHeaderValue, endian: Endianness): number;

  // Provided methods: `MachHeader_provided`.
  // (provided) parse
  // (provided) is_supported
  // (provided) endian
  // (provided) load_commands
  // (provided) uuid
}

export const MachHeader_provided = {
  /// Read the file header.
  ///
  /// Also checks that the magic field in the file header is a supported format.
  // crate: object-0.39.1/src/read/macho/file.rs:716 parse
  parse(Self: MachHeader, data: Uint8Array, offset: number): Result<MachHeaderValue> {
    const h = read_error_unit(ReadRef.read_at(data, Self.POD, offset), "Invalid Mach-O header size or alignment");
    if (h.$ === "Err") return h;
    const header = h._0;
    if (!MachHeader_provided.is_supported(Self, header)) {
      return Err(new Error("Unsupported Mach-O header"));
    }
    return Ok(header);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:726 is_supported
  is_supported(Self: MachHeader, self: MachHeaderValue): boolean {
    return Self.is_little_endian(self) || Self.is_big_endian(self);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:730 endian
  endian(Self: MachHeader, self: MachHeaderValue): Result<Endianness> {
    return read_error_opt(Self.Endian.from_big_endian(Self.is_big_endian(self)), "Unsupported Mach-O endian");
  },

  // crate: object-0.39.1/src/read/macho/file.rs:734 load_commands
  load_commands(Self: MachHeader, self: MachHeaderValue, endian: Endianness, data_: Uint8Array, header_offset: number): Result<LoadCommandIterator> {
    const data = read_error_unit(
      ReadRef.read_bytes_at(data_, header_offset + Self.POD.size, Self.sizeofcmds(self, endian)),
      "Invalid Mach-O load command table size",
    );
    if (data.$ === "Err") return data;
    return Ok(LoadCommandIterator.new(endian, data._0, Self.ncmds(self, endian)));
  },
};

/// `impl<Endian: endian::Endian> MachHeader for macho::MachHeader32<Endian>`
export const MachHeader32_impl: MachHeader = {
  Endian: Endianness,
  Segment: SegmentCommand32_impl,
  get Section(): Section {
    return SegmentCommand32_impl.Section;
  },
  Nlist: macho.Nlist32.POD,
  POD: macho.MachHeader32.POD,

  // crate: object-0.39.1/src/read/macho/file.rs:773 is_type_64
  is_type_64(_self: macho.MachHeader32): boolean {
    return false;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:777 is_big_endian
  is_big_endian(self: macho.MachHeader32): boolean {
    return MachHeader32_impl.magic(self) === macho.MH_MAGIC;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:781 is_little_endian
  is_little_endian(self: macho.MachHeader32): boolean {
    return MachHeader32_impl.magic(self) === macho.MH_CIGAM;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:785 magic
  magic(self: macho.MachHeader32): number {
    return U32.get(self.magic, BigEndian.value);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:789 cputype
  cputype(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.cputype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:793 cpusubtype
  cpusubtype(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.cpusubtype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:797 filetype
  filetype(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.filetype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:801 ncmds
  ncmds(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.ncmds, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:805 sizeofcmds
  sizeofcmds(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.sizeofcmds, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:809 flags
  flags(self: macho.MachHeader32, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
} as MachHeader;

/// `impl<Endian: endian::Endian> MachHeader for macho::MachHeader64<Endian>`
export const MachHeader64_impl: MachHeader = {
  Endian: Endianness,
  Segment: SegmentCommand64_impl,
  get Section(): Section {
    return SegmentCommand64_impl.Section;
  },
  Nlist: macho.Nlist64.POD,
  POD: macho.MachHeader64.POD,

  // crate: object-0.39.1/src/read/macho/file.rs:821 is_type_64
  is_type_64(_self: macho.MachHeader64): boolean {
    return true;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:825 is_big_endian
  is_big_endian(self: macho.MachHeader64): boolean {
    return MachHeader64_impl.magic(self) === macho.MH_MAGIC_64;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:829 is_little_endian
  is_little_endian(self: macho.MachHeader64): boolean {
    return MachHeader64_impl.magic(self) === macho.MH_CIGAM_64;
  },

  // crate: object-0.39.1/src/read/macho/file.rs:833 magic
  magic(self: macho.MachHeader64): number {
    return U32.get(self.magic, BigEndian.value);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:837 cputype
  cputype(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.cputype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:841 cpusubtype
  cpusubtype(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.cpusubtype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:845 filetype
  filetype(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.filetype, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:849 ncmds
  ncmds(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.ncmds, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:853 sizeofcmds
  sizeofcmds(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.sizeofcmds, endian);
  },

  // crate: object-0.39.1/src/read/macho/file.rs:857 flags
  flags(self: macho.MachHeader64, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
} as MachHeader;
