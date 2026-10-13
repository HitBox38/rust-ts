// Port of object 0.39.1 `src/read/traits.rs` (the `Object` / `ObjectSection` methods the ported
// file formats implement).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the traits are interfaces listing only the methods ported for every implementor (ELF,
// Mach-O, Wasm and the `File` / `Section` wrappers); the provided methods live in
// `Object_provided`. `&str` results are JS strings decoded with `str::from_utf8` semantics.

import type { Endianness } from "../endian.ts";
import type { ObjectKind, Result, SectionIndex } from "./mod.ts";

/// An object file.
///
/// This is the primary trait for the unified read API.
export interface Object<Section extends ObjectSection = ObjectSection> {
  /// Return true if the file is little endian, false if it is big endian.
  is_little_endian(): boolean;

  /// Return true if the file can contain 64-bit addresses.
  is_64(): boolean;

  /// Return the kind of this object.
  kind(): ObjectKind;

  // (provided) section_by_name

  /// Like [`Self::section_by_name`], but allows names that are not UTF-8.
  section_by_name_bytes(section_name: Uint8Array): Section | undefined;

  /// Get the section at the given index.
  ///
  /// The meaning of the index depends on the object file.
  ///
  /// For some object files, this requires iterating through all sections.
  ///
  /// Returns an error if the index is invalid.
  section_by_index(index: SectionIndex): Result<Section>;

  /// Get an iterator for the sections in the file.
  sections(): Iterable<Section>;
}

export const Object_provided = {
  /// Get the endianness of the file.
  // crate: object-0.39.1/src/read/traits.rs:98 endianness
  endianness(self: Object): Endianness {
    if (self.is_little_endian()) {
      return "Little";
    } else {
      return "Big";
    }
  },

  /// Get the section named `section_name`, if such a section exists.
  ///
  /// If `section_name` starts with a '.' then it is treated as a system
  /// section name, and is compared using the conventions specific to the
  /// object file format. This includes:
  /// - if ".debug_str_offsets" is requested for a Mach-O object file, then
  ///   the actual section name that is searched for is "__debug_str_offs".
  /// - if ".debug_info" is requested for an ELF object file, then
  ///   ".zdebug_info" may be returned (and similarly for other debug
  ///   sections). Similarly, if ".debug_info" is requested for a Mach-O
  ///   object file, then "__zdebug_info" may be returned.
  ///
  /// For some object files, multiple segments may contain sections with the
  /// same name. In this case, the first matching section will be used.
  ///
  /// This method skips over sections with invalid names.
  // crate: object-0.39.1/src/read/traits.rs:139 section_by_name
  section_by_name<Section extends ObjectSection>(self: Object<Section>, section_name: string): Section | undefined {
    return self.section_by_name_bytes(new TextEncoder().encode(section_name));
  },
};

/// A section in an [`Object`].
///
/// This trait is part of the unified read API.
export interface ObjectSection {
  /// Returns the section index.
  index(): SectionIndex;

  /// Returns the address of the section.
  address(): number;

  /// Returns the size of the section in memory.
  size(): number;

  /// Returns the alignment of the section in memory.
  align(): number;

  /// Returns offset and size of on-disk segment (if any).
  file_range(): [number, number] | undefined;

  /// Returns the raw contents of the section.
  ///
  /// The length of this data may be different from the size of the
  /// section in memory.
  ///
  /// This does not do any decompression.
  data(): Result<Uint8Array>;

  /// Returns the name of the section.
  name_bytes(): Result<Uint8Array>;

  /// Returns the name of the section.
  ///
  /// Returns an error if the name is not UTF-8.
  name(): Result<string>;

  /// Returns the name of the segment for this section.
  segment_name_bytes(): Result<Uint8Array | undefined>;

  /// Returns the name of the segment for this section.
  ///
  /// Returns an error if the name is not UTF-8.
  segment_name(): Result<string | undefined>;
}

/** `str::from_utf8(bytes).ok()` */
export function str_from_utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
