// Port of object 0.39.1 `src/read/macho/segment.rs` (the `Segment` trait and its impls).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: see ../elf/file.ts for the dictionary encoding of generic traits. `MachOSegment` /
// `MachOSegmentIterator` (the `ObjectSegment` API) are not ported (unused on rustc's path).

import type { Result as StdResult } from "../../../../std/result.ts";
import { type Endianness, U32, U64 } from "../../endian.ts";
import * as macho from "../../macho.ts";
import type { Pod, PodSlice } from "../../pod.ts";
import { read_error_unit, type Result } from "../mod.ts";
import { ReadRef } from "../read_ref.ts";
import type { LoadCommandData } from "./load_command.ts";
import { type Section, Section32_impl, Section64_impl, type SectionValue } from "./section.ts";

/** `macho::SegmentCommand32<Endianness>` / `macho::SegmentCommand64<Endianness>`. */
export type SegmentValue = macho.SegmentCommand32 | macho.SegmentCommand64;

/** `MachOSegmentInternal`: a segment and the data of the file containing it. */
export interface MachOSegmentInternal {
  readonly segment: SegmentValue;
  /// The data for the file that contains the segment data.
  ///
  /// This is required for dyld caches, where this may be a different subcache
  /// from the file containing the Mach-O load commands.
  readonly data: Uint8Array;
}

/// A trait for generic access to [`macho::SegmentCommand32`] and [`macho::SegmentCommand64`].
export interface Segment {
  // type Word: Into<u64>;   (number)
  // type Endian: endian::Endian;   (Endianness)
  /** `type Section` (its trait dictionary). */
  readonly Section: Section;
  /** `Self: Pod` */
  readonly POD: Pod<SegmentValue>;

  from_command(command: LoadCommandData): Result<[SegmentValue, Uint8Array] | undefined>;

  cmd(self: SegmentValue, endian: Endianness): number;
  cmdsize(self: SegmentValue, endian: Endianness): number;
  segname(self: SegmentValue): Uint8Array;
  vmaddr(self: SegmentValue, endian: Endianness): number;
  vmsize(self: SegmentValue, endian: Endianness): number;
  fileoff(self: SegmentValue, endian: Endianness): number;
  filesize(self: SegmentValue, endian: Endianness): number;
  maxprot(self: SegmentValue, endian: Endianness): number;
  initprot(self: SegmentValue, endian: Endianness): number;
  nsects(self: SegmentValue, endian: Endianness): number;
  flags(self: SegmentValue, endian: Endianness): number;

  // (provided) name
  // (provided) file_range
  // (provided) data
  // (provided) sections
}

export const Segment_provided = {
  /// Return the `segname` bytes up until the null terminator.
  // crate: object-0.39.1/src/read/macho/segment.rs:202 name
  name(Self: Segment, self: SegmentValue): Uint8Array {
    const segname = Self.segname(self);
    const end = segname.indexOf(0);
    return end !== -1 ? segname.subarray(0, end) : segname;
  },

  /// Return the offset and size of the segment in the file.
  // crate: object-0.39.1/src/read/macho/segment.rs:211 file_range
  file_range(Self: Segment, self: SegmentValue, endian: Endianness): [number, number] {
    return [Self.fileoff(self, endian), Self.filesize(self, endian)];
  },

  /// Get the segment data from the file data.
  ///
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/macho/segment.rs:218 data
  data(Self: Segment, self: SegmentValue, endian: Endianness, data: Uint8Array): StdResult<Uint8Array, undefined> {
    const [offset, size] = Segment_provided.file_range(Self, self, endian);
    return ReadRef.read_bytes_at(data, offset, size);
  },

  /// Get the array of sections from the data following the segment command.
  ///
  /// Returns `Err` for invalid values.
  // crate: object-0.39.1/src/read/macho/segment.rs:230 sections
  sections(Self: Segment, self: SegmentValue, endian: Endianness, section_data: Uint8Array): Result<PodSlice<SectionValue>> {
    return read_error_unit(
      ReadRef.read_slice_at(section_data, Self.Section.POD, 0, Self.nsects(self, endian)),
      "Invalid Mach-O number of sections",
    );
  },
};

/// `impl<Endian: endian::Endian> Segment for macho::SegmentCommand32<Endian>`
export const SegmentCommand32_impl: Segment = {
  get Section(): Section {
    return Section32_impl;
  },
  POD: macho.SegmentCommand32.POD,

  // crate: object-0.39.1/src/read/macho/segment.rs:246 from_command
  from_command(command: LoadCommandData): Result<[SegmentValue, Uint8Array] | undefined> {
    return command.segment_32();
  },

  // crate: object-0.39.1/src/read/macho/segment.rs:250 cmd
  cmd(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.cmd, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:253 cmdsize
  cmdsize(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.cmdsize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:256 segname
  segname(self: macho.SegmentCommand32): Uint8Array {
    return self.segname;
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:259 vmaddr
  vmaddr(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.vmaddr, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:262 vmsize
  vmsize(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.vmsize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:265 fileoff
  fileoff(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.fileoff, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:268 filesize
  filesize(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.filesize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:271 maxprot
  maxprot(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.maxprot, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:274 initprot
  initprot(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.initprot, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:277 nsects
  nsects(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.nsects, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:280 flags
  flags(self: macho.SegmentCommand32, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
} as Segment;

/// `impl<Endian: endian::Endian> Segment for macho::SegmentCommand64<Endian>`
export const SegmentCommand64_impl: Segment = {
  get Section(): Section {
    return Section64_impl;
  },
  POD: macho.SegmentCommand64.POD,

  // crate: object-0.39.1/src/read/macho/segment.rs:290 from_command
  from_command(command: LoadCommandData): Result<[SegmentValue, Uint8Array] | undefined> {
    return command.segment_64();
  },

  // crate: object-0.39.1/src/read/macho/segment.rs:294 cmd
  cmd(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.cmd, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:297 cmdsize
  cmdsize(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.cmdsize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:300 segname
  segname(self: macho.SegmentCommand64): Uint8Array {
    return self.segname;
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:303 vmaddr
  vmaddr(self: macho.SegmentCommand64, endian: Endianness): number {
    return U64.get(self.vmaddr, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:306 vmsize
  vmsize(self: macho.SegmentCommand64, endian: Endianness): number {
    return U64.get(self.vmsize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:309 fileoff
  fileoff(self: macho.SegmentCommand64, endian: Endianness): number {
    return U64.get(self.fileoff, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:312 filesize
  filesize(self: macho.SegmentCommand64, endian: Endianness): number {
    return U64.get(self.filesize, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:315 maxprot
  maxprot(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.maxprot, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:318 initprot
  initprot(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.initprot, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:321 nsects
  nsects(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.nsects, endian);
  },
  // crate: object-0.39.1/src/read/macho/segment.rs:324 flags
  flags(self: macho.SegmentCommand64, endian: Endianness): number {
    return U32.get(self.flags, endian);
  },
} as Segment;
