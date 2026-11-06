// Port of object 0.39.1 `src/write/mod.rs`: the relocatable-object API, as far as rustc_codegen_ssa's wrapper files reach it
// (plan-m6 D4, lane miri-sysroot).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Interface for writing object files.
//!
//! This module provides a unified write API for relocatable object files
//! using [`Object`]. This does not support writing executable files.
//! This supports the following file formats: COFF, ELF, Mach-O, and XCOFF.
//
// PORT: only ELF is ported (write/elf/object.ts); `emit` and the format dispatches stop `unported` on COFF, Mach-O and XCOFF
// (chained lane, docs/handoff/miri-sysroot.md). Not ported, because a wrapper file adds neither: symbols (`add_symbol` and
// the rest, reached only by `create_compressed_metadata_file` and the COFF/XCOFF branches of `create_wrapper_file`),
// relocations and comdats. `symbols` and `comdats` stay as empty lists so `elf_write` reads as upstream.
import { panic, unported } from "../../../std/panic.ts";
import { Ok, type Result as StdResult } from "../../../std/result.ts";
import {
  type Architecture,
  type BinaryFormat,
  type FileFlags,
  SectionFlags,
  SectionKind,
  type SubArchitecture,
  type SymbolFlags,
  type SymbolKind,
  type SymbolScope,
} from "../common.ts";
import type { Endianness } from "../endian.ts";
import { elf_section_flags, elf_section_info, elf_symbol_flags, elf_write } from "./elf/object.ts";
import { VecBuffer, type WritableBuffer } from "./util.ts";

export * from "./util.ts";
export type { StringId } from "./string.ts";

/// The error type used within the write module.
export class Error {
  constructor(readonly _0: string) {}
}

/// The result type used within the write module.
export type Result<T> = StdResult<T, Error>;

/// A writable relocatable object file.
export class Object {
  format_: BinaryFormat;
  architecture_: Architecture;
  sub_architecture_: SubArchitecture | undefined = undefined;
  endian: Endianness;
  sections: Section[] = [];
  standard_sections = new Map<StandardSection, SectionId>();
  symbols: Symbol[] = [];
  comdats: Comdat[] = [];
  /// File flags that are specific to each file format.
  flags: FileFlags = { $: "None" };
  /// The symbol name mangling scheme.
  mangling_: Mangling;

  /// Create an empty object file.
  // crate: object-0.39.1/src/write/mod.rs:102 new
  constructor(format: BinaryFormat, architecture: Architecture, endian: Endianness) {
    this.format_ = format;
    this.architecture_ = architecture;
    this.endian = endian;
    this.mangling_ = Mangling.default(format, architecture);
  }

  /// Return the file format.
  // crate: object-0.39.1/src/write/mod.rs:130 format
  format(): BinaryFormat {
    return this.format_;
  }

  /// Return the architecture.
  // crate: object-0.39.1/src/write/mod.rs:136 architecture
  architecture(): Architecture {
    return this.architecture_;
  }

  /// Return the sub-architecture.
  // crate: object-0.39.1/src/write/mod.rs:142 sub_architecture
  sub_architecture(): SubArchitecture | undefined {
    return this.sub_architecture_;
  }

  /// Specify the sub-architecture.
  // crate: object-0.39.1/src/write/mod.rs:147 set_sub_architecture
  set_sub_architecture(sub_architecture: SubArchitecture | undefined): void {
    this.sub_architecture_ = sub_architecture;
  }

  /// Return the current mangling setting.
  // crate: object-0.39.1/src/write/mod.rs:153 mangling
  mangling(): Mangling {
    return this.mangling_;
  }

  /// Specify the mangling setting.
  // crate: object-0.39.1/src/write/mod.rs:159 set_mangling
  set_mangling(mangling: Mangling): void {
    this.mangling_ = mangling;
  }

  /// Return the name for a standard segment.
  ///
  /// This will vary based on the file format.
  // crate: object-0.39.1/src/write/mod.rs:167 segment_name
  segment_name(_segment: StandardSegment): Uint8Array {
    switch (this.format_) {
      case "Coff":
        return new Uint8Array(0);
      case "Elf":
        return new Uint8Array(0);
      case "MachO":
        return unported("object::write::Object::macho_segment_name (Mach-O object files)");
      default:
        return panic("not implemented");
    }
  }

  /// Get the section with the given `SectionId`.
  // crate: object-0.39.1/src/write/mod.rs:181 section
  section(section: SectionId): Section {
    return this.sections[section]!;
  }

  /// Mutably get the section with the given `SectionId`.
  // crate: object-0.39.1/src/write/mod.rs:187 section_mut
  section_mut(section: SectionId): Section {
    return this.sections[section]!;
  }

  /// Set the data for an existing section.
  ///
  /// Must not be called for sections that already have data, or that contain uninitialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:195 set_section_data
  set_section_data(section: SectionId, data: Uint8Array, align: number): void {
    this.sections[section]!.set_data(data, align);
  }

  /// Append data to an existing section. Returns the section offset of the data.
  ///
  /// Must not be called for sections that contain uninitialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:206 append_section_data
  append_section_data(section: SectionId, data: Uint8Array, align: number): number {
    return this.sections[section]!.append_data(data, align);
  }

  /// Append zero-initialized data to an existing section. Returns the section offset of the data.
  ///
  /// Must not be called for sections that contain initialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:214 append_section_bss
  append_section_bss(section: SectionId, size: number, align: number): number {
    return this.sections[section]!.append_bss(size, align);
  }

  /// Return the `SectionId` of a standard section.
  ///
  /// If the section doesn't already exist then it is created.
  // crate: object-0.39.1/src/write/mod.rs:221 section_id
  section_id(section: StandardSection): SectionId {
    const got = this.standard_sections.get(section);
    if (got !== undefined) return got;
    const [segment, name, kind, flags] = this.section_info(section);
    const id = this.add_section(segment, name, kind);
    this.section_mut(id).flags = flags;
    return id;
  }

  /// Add a new section and return its `SectionId`.
  ///
  /// This also creates a section symbol.
  // crate: object-0.39.1/src/write/mod.rs:236 add_section
  add_section(segment: Uint8Array, name: Uint8Array, kind: SectionKind): SectionId {
    const id = this.sections.length as SectionId;
    this.sections.push(new Section(segment, name, kind));

    // Add to self.standard_sections if required. This may match multiple standard sections.
    const section = this.sections[id]!;
    for (const standard_section of StandardSection.all()) {
      if (!this.standard_sections.has(standard_section)) {
        const [segment, name, kind, _flags] = this.section_info(standard_section);
        if (bytes_eq(segment, section.segment) && bytes_eq(name, section.name) && section_kind_eq(kind, section.kind)) {
          this.standard_sections.set(standard_section, id);
        }
      }
    }

    return id;
  }

  // crate: object-0.39.1/src/write/mod.rs:264 section_info
  section_info(section: StandardSection): [Uint8Array, Uint8Array, SectionKind, SectionFlags] {
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_section_info (COFF object files)");
      case "Elf":
        return elf_section_info(this, section);
      case "MachO":
        return unported("object::write::Object::macho_section_info (Mach-O object files)");
      case "Xcoff":
        return unported("object::write::Object::xcoff_section_info (XCOFF object files)");
      default:
        return panic("not implemented");
    }
  }

  /// Get the default section flags for the given section.
  // crate: object-0.39.1/src/write/mod.rs:345 default_section_flags
  default_section_flags(section: Section): SectionFlags {
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_section_flags (COFF object files)");
      case "Elf":
        return elf_section_flags(section);
      case "MachO":
        return unported("object::write::Object::macho_section_flags (Mach-O object files)");
      case "Xcoff":
        return unported("object::write::Object::xcoff_section_flags (XCOFF object files)");
      default:
        return SectionFlags.None;
    }
  }

  /// Get the section flags for the given section.
  // crate: object-0.39.1/src/write/mod.rs:364 section_flags
  section_flags(section: Section): SectionFlags {
    if (section.flags.$ !== "None") {
      return section.flags;
    } else {
      return this.default_section_flags(section);
    }
  }

  /// Get the default flags for the given symbol.
  // crate: object-0.39.1/src/write/mod.rs:477 default_symbol_flags
  default_symbol_flags(symbol: Symbol): SymbolFlags {
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_symbol_flags (COFF object files)");
      case "Elf":
        return elf_symbol_flags(symbol);
      case "MachO":
        return unported("object::write::Object::macho_symbol_flags (Mach-O object files)");
      case "Xcoff":
        return unported("object::write::Object::xcoff_symbol_flags (XCOFF object files)");
      default:
        return { $: "None" };
    }
  }

  /// Get the flags for the given symbol.
  // crate: object-0.39.1/src/write/mod.rs:496 symbol_flags
  symbol_flags(symbol: Symbol): SymbolFlags {
    if (symbol.flags.$ !== "None") {
      return symbol.flags;
    } else {
      return this.default_symbol_flags(symbol);
    }
  }

  /// Write the object to a `Vec`.
  // crate: object-0.39.1/src/write/mod.rs:804 write
  write(): Result<Uint8Array> {
    const buffer = new VecBuffer();
    const r = this.emit(buffer);
    if (r.$ === "Err") return r;
    return Ok(buffer.finish());
  }

  /// Write the object to a `WritableBuffer`.
  // crate: object-0.39.1/src/write/mod.rs:825 emit
  emit(buffer: WritableBuffer): Result<null> {
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_write (COFF object files)");
      case "Elf":
        return elf_write(this, buffer);
      case "MachO":
        return unported("object::write::Object::macho_write (Mach-O object files)");
      case "Xcoff":
        return unported("object::write::Object::xcoff_write (XCOFF object files)");
      default:
        return panic("not implemented");
    }
  }
}

/** `a == b` on `&[u8]`. */
function bytes_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The derived `PartialEq` of `SectionKind`. */
function section_kind_eq(a: SectionKind, b: SectionKind): boolean {
  if (a.$ === "Elf" && b.$ === "Elf") return a._0 === b._0;
  return a.$ === b.$;
}

/// A standard segment kind.
export type StandardSegment = "Text" | "Data" | "Debug";
export const StandardSegment = { Text: "Text", Data: "Data", Debug: "Debug" } as const;

/// A standard section kind.
export type StandardSection =
  | "Text"
  | "Data"
  | "ReadOnlyData"
  | "ReadOnlyDataWithRel"
  | "ReadOnlyString"
  | "UninitializedData"
  | "Tls"
  /// Zero-fill TLS initializers. Unsupported for COFF.
  | "UninitializedTls"
  /// TLS variable structures. Only supported for Mach-O.
  | "TlsVariables"
  /// Common data. Only supported for Mach-O.
  | "Common"
  /// Notes for GNU properties. Only supported for ELF.
  | "GnuProperty"
  /// Call frame information.
  | "EhFrame";

export const StandardSection = {
  /// Return the section kind of a standard section.
  // crate: object-0.39.1/src/write/mod.rs:875 kind
  kind(self: StandardSection): SectionKind {
    switch (self) {
      case "Text":
        return SectionKind.Text;
      case "Data":
        return SectionKind.Data;
      case "ReadOnlyData":
        return SectionKind.ReadOnlyData;
      case "ReadOnlyDataWithRel":
        return SectionKind.ReadOnlyDataWithRel;
      case "ReadOnlyString":
        return SectionKind.ReadOnlyString;
      case "UninitializedData":
        return SectionKind.UninitializedData;
      case "Tls":
        return SectionKind.Tls;
      case "UninitializedTls":
        return SectionKind.UninitializedTls;
      case "TlsVariables":
        return SectionKind.TlsVariables;
      case "Common":
        return SectionKind.Common;
      case "GnuProperty":
        return SectionKind.Note;
      case "EhFrame":
        return SectionKind.ReadOnlyData;
    }
  },

  // TODO: remembering to update this is error-prone, can we do better?
  // crate: object-0.39.1/src/write/mod.rs:893 all
  all(): readonly StandardSection[] {
    return ["Text", "Data", "ReadOnlyData", "ReadOnlyDataWithRel", "ReadOnlyString", "UninitializedData", "Tls", "UninitializedTls", "TlsVariables", "Common", "GnuProperty", "EhFrame"];
  },
};

/// An identifier used to reference a section.
export type SectionId = number & { readonly __brand: "write::SectionId" };

/// A section in an object file.
export class Section {
  size = 0;
  align = 1;
  /** PORT: `Cow<'a, [u8]>`, which is always owned here. */
  data: Uint8Array = new Uint8Array(0);
  /** PORT: `Vec<RelocationInternal>`, always empty: `add_relocation` is not ported. */
  relocations: never[] = [];
  /// Section flags that are specific to each file format.
  flags: SectionFlags = SectionFlags.None;

  constructor(
    public segment: Uint8Array,
    public name: Uint8Array,
    public kind: SectionKind,
  ) {}

  /// Try to convert the name to a utf8 string.
  // crate: object-0.39.1/src/write/mod.rs:933 name
  name_str(): string | undefined {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.name);
    } catch {
      return undefined;
    }
  }

  /// Return true if this section contains zerofill data.
  // crate: object-0.39.1/src/write/mod.rs:945 is_bss
  is_bss(): boolean {
    return this.kind.$ === "UninitializedData" || this.kind.$ === "UninitializedTls" || this.kind.$ === "Common";
  }

  /// Set the data for a section.
  ///
  /// Must not be called for sections that already have data, or that contain uninitialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:953 set_data
  set_data(data: Uint8Array, align: number): void {
    // debug_assert!(!self.is_bss());
    // debug_assert_eq!(align & (align - 1), 0);
    // debug_assert!(self.data.is_empty());
    this.data = data;
    this.size = this.data.length;
    this.align = align;
  }

  /// Append data to a section.
  ///
  /// Must not be called for sections that contain uninitialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:969 append_data
  append_data(append_data: Uint8Array, align: number): number {
    // debug_assert!(!self.is_bss());
    // debug_assert_eq!(align & (align - 1), 0);
    if (this.align < align) {
      this.align = align;
    }
    let offset = this.data.length;
    if (offset % align !== 0) {
      offset += align - (offset % align);
    }
    // PORT: `data.resize(offset, 0)` + `extend_from_slice`.
    const data = new Uint8Array(offset + append_data.length);
    data.set(this.data);
    data.set(append_data, offset);
    this.data = data;
    this.size = data.length;
    return offset;
  }

  /// Append uninitialized data to a section.
  ///
  /// Must not be called for sections that contain initialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:991 append_bss
  append_bss(size: number, align: number): number {
    // debug_assert!(self.is_bss());
    // debug_assert_eq!(align & (align - 1), 0);
    if (this.align < align) {
      this.align = align;
    }
    let offset = this.size;
    if (offset % align !== 0) {
      offset += align - (offset % align);
      this.size = offset;
    }
    this.size += size;
    return offset;
  }
}

/// The section where a symbol is defined.
export type SymbolSection = { $: "None" } | { $: "Undefined" } | { $: "Absolute" } | { $: "Common" } | { $: "Section"; _0: SectionId };

export const SymbolSection = {
  /// Returns the section id for the section where the symbol is defined.
  ///
  /// May return `None` if the symbol is not defined in a section.
  // crate: object-0.39.1/src/write/mod.rs:1044 id
  id(self: SymbolSection): SectionId | undefined {
    if (self.$ === "Section") {
      return self._0;
    } else {
      return undefined;
    }
  },
};

/// A symbol in an object file.
export class Symbol {
  constructor(
    /// The name of the symbol.
    public name: Uint8Array,
    /// The value of the symbol.
    ///
    /// If the symbol defined in a section, then this is the section offset of the symbol.
    public value: number,
    /// The size of the symbol.
    public size: number,
    /// The kind of the symbol.
    public kind: SymbolKind,
    /// The scope of the symbol.
    public scope: SymbolScope,
    /// Whether the symbol has weak binding.
    public weak: boolean,
    /// The section containing the symbol.
    public section: SymbolSection,
    /// Symbol flags that are specific to each file format.
    public flags: SymbolFlags,
  ) {}

  /// Try to convert the name to a utf8 string.
  // crate: object-0.39.1/src/write/mod.rs:1083 name
  name_str(): string | undefined {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.name);
    } catch {
      return undefined;
    }
  }

  /// Return true if the symbol is undefined.
  // crate: object-0.39.1/src/write/mod.rs:1089 is_undefined
  is_undefined(): boolean {
    return this.section.$ === "Undefined";
  }

  /// Return true if the symbol is common data.
  ///
  /// Note: does not check for `SymbolSection::Section` with `SectionKind::Common`.
  // crate: object-0.39.1/src/write/mod.rs:1097 is_common
  is_common(): boolean {
    return this.section.$ === "Common";
  }

  /// Return true if the symbol scope is local.
  // crate: object-0.39.1/src/write/mod.rs:1103 is_local
  is_local(): boolean {
    return this.scope === "Compilation";
  }
}

/** PORT: `struct Comdat`: `add_comdat` is not ported, so `Object.comdats` stays empty. */
export type Comdat = never;

/// The symbol name mangling scheme.
export type Mangling = "None" | "Coff" | "CoffI386" | "Elf" | "MachO" | "Xcoff";

export const Mangling = {
  /// Return the default symboling mangling for the given format and architecture.
  // crate: object-0.39.1/src/write/mod.rs:1188 default
  default(format: BinaryFormat, architecture: Architecture): Mangling {
    if (format === "Coff" && architecture === "I386") return "CoffI386";
    if (format === "Coff") return "Coff";
    if (format === "Elf") return "Elf";
    if (format === "MachO") return "MachO";
    if (format === "Xcoff") return "Xcoff";
    return "None";
  },
};
