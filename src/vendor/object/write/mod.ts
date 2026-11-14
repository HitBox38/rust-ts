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
// PORT: ELF (write/elf/object.ts) and Mach-O (write/macho.ts) are ported; `emit` and the format dispatches stop `unported` on
// COFF and XCOFF (docs/handoff/miri-sysroot.md, docs/handoff/object-write-macho.md, docs/handoff/vendor-object-write.md).
// Symbols, relocations, comdats and subsections are ported (lane vendor-object-write). `u64` offsets and sizes are `number`s
// (a relocatable object rustc writes stays far below 2^53); relocation addends (`i64`) are `bigint`s.
import { debug_str } from "../../../std/fmt.ts";
import { panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import {
  type Architecture,
  type BinaryFormat,
  type ComdatKind,
  debug_RelocationFlags,
  type FileFlags,
  type RelocationFlags,
  SectionFlags,
  SectionKind,
  type SubArchitecture,
  type SymbolFlags,
  type SymbolKind,
  type SymbolScope,
} from "../common.ts";
import type { Endianness } from "../endian.ts";
import {
  elf_adjust_addend,
  elf_relocation_size,
  elf_section_flags,
  elf_section_info,
  elf_subsection_name,
  elf_symbol_flags,
  elf_translate_relocation,
  elf_write,
} from "./elf/object.ts";
import {
  type MachOBuildVersion,
  macho_add_thread_var,
  macho_adjust_addend,
  macho_relocation_size,
  macho_section_flags,
  macho_section_info,
  macho_segment_name,
  macho_symbol_flags,
  macho_translate_relocation,
  macho_write,
} from "./macho.ts";
import { VecBuffer, type WritableBuffer, write_at } from "./util.ts";

export * from "./util.ts";
export type { StringId } from "./string.ts";
export { MachOBuildVersion, set_macho_build_version, set_macho_cpu_subtype } from "./macho.ts";

/// The error type used within the write module.
export class Error {
  constructor(readonly _0: string) {}

  // impl fmt::Display for Error
  // crate: object-0.39.1/src/write/mod.rs:56 fmt
  fmt(): string {
    return this._0;
  }
}

/** `{:?}` of `Error` (derived): a tuple struct around a `String`. */
export function debug_Error(e: Error): string {
  return `Error(${debug_str(e._0)})`;
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
  /** PORT: `HashMap<Vec<u8>, SymbolId>`, keyed by the name's latin-1 spelling (one char per byte, so injective). */
  symbol_map = new Map<string, SymbolId>();
  comdats: Comdat[] = [];
  /// File flags that are specific to each file format.
  flags: FileFlags = { $: "None" };
  /// The symbol name mangling scheme.
  mangling_: Mangling;
  /** `#[cfg(feature = "coff")] stub_symbols`: only the COFF writer (not ported) reads it. */
  stub_symbols = new Map<SymbolId, SymbolId>();
  /// Mach-O "_tlv_bootstrap" symbol.
  tlv_bootstrap: SymbolId | undefined = undefined;
  /// Mach-O CPU subtype.
  macho_cpu_subtype: number | undefined = undefined;
  macho_build_version: MachOBuildVersion | undefined = undefined;
  /// Mach-O MH_SUBSECTIONS_VIA_SYMBOLS flag. Only ever set if format is Mach-O.
  macho_subsections_via_symbols = false;

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
  segment_name(segment: StandardSegment): Uint8Array {
    switch (this.format_) {
      case "Coff":
        return new Uint8Array(0);
      case "Elf":
        return new Uint8Array(0);
      case "MachO":
        return macho_segment_name(segment);
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
        return macho_section_info(section);
      case "Xcoff":
        return unported("object::write::Object::xcoff_section_info (XCOFF object files)");
      default:
        return panic("not implemented");
    }
  }

  /// Add a subsection. Returns the `SectionId` and section offset of the data.
  ///
  /// For Mach-O, this does not create a subsection, and instead uses the
  /// section from [`Self::section_id`]. Use [`Self::set_subsections_via_symbols`]
  /// to enable subsections via symbols.
  // crate: object-0.39.1/src/write/mod.rs:286 add_subsection
  add_subsection(section: StandardSection, name: Uint8Array): SectionId {
    if (this.has_subsections_via_symbols()) {
      return this.section_id(section);
    } else {
      const [segment, name_, kind, flags] = this.subsection_info(section, name);
      const id = this.add_section(segment.slice(), name_, kind);
      this.section_mut(id).flags = flags;
      return id;
    }
  }

  // crate: object-0.39.1/src/write/mod.rs:297 has_subsections_via_symbols
  has_subsections_via_symbols(): boolean {
    return this.format_ === "MachO";
  }

  /// Enable subsections via symbols if supported.
  ///
  /// This should be called before adding any subsections or symbols.
  ///
  /// For Mach-O, this sets the `MH_SUBSECTIONS_VIA_SYMBOLS` flag.
  /// For other formats, this does nothing.
  // crate: object-0.39.1/src/write/mod.rs:307 set_subsections_via_symbols
  set_subsections_via_symbols(): void {
    if (this.format_ === "MachO") {
      this.macho_subsections_via_symbols = true;
    }
  }

  // crate: object-0.39.1/src/write/mod.rs:314 subsection_info
  subsection_info(section: StandardSection, value: Uint8Array): [Uint8Array, Uint8Array, SectionKind, SectionFlags] {
    const [segment, section_, kind, flags] = this.section_info(section);
    const name = this.subsection_name(section_, value);
    return [segment, name, kind, flags];
  }

  // crate: object-0.39.1/src/write/mod.rs:325 subsection_name
  subsection_name(section: Uint8Array, value: Uint8Array): Uint8Array {
    // debug_assert!(!self.has_subsections_via_symbols());
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_subsection_name (COFF object files)");
      case "Elf":
        return elf_subsection_name(section, value);
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
        return macho_section_flags(section);
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

  /// Mutably get the flags for a section.
  ///
  /// If `section.flags` is `SectionFlags::None`, then replace it with
  /// [`Self::default_section_flags`] first.
  /// Otherwise, `&mut section.flags` is returned as is.
  /** PORT: `&mut SectionFlags` is the section that holds it: a caller writes `.flags` on the result. */
  // crate: object-0.39.1/src/write/mod.rs:377 section_flags_mut
  section_flags_mut(section_id: SectionId): Section {
    if (this.section(section_id).flags.$ !== "None") {
      return this.section_mut(section_id);
    } else {
      const flags = this.default_section_flags(this.section(section_id));
      const section = this.section_mut(section_id);
      section.flags = flags;
      return section;
    }
  }

  /// Get the COMDAT section group with the given `ComdatId`.
  // crate: object-0.39.1/src/write/mod.rs:390 comdat
  comdat(comdat: ComdatId): Comdat {
    return index(this.comdats, comdat);
  }

  /// Mutably get the COMDAT section group with the given `ComdatId`.
  // crate: object-0.39.1/src/write/mod.rs:396 comdat_mut
  comdat_mut(comdat: ComdatId): Comdat {
    return index(this.comdats, comdat);
  }

  /// Add a new COMDAT section group and return its `ComdatId`.
  // crate: object-0.39.1/src/write/mod.rs:401 add_comdat
  add_comdat(comdat: Comdat): ComdatId {
    const comdat_id = this.comdats.length as ComdatId;
    this.comdats.push(comdat);
    return comdat_id;
  }

  /// Get the `SymbolId` of the symbol with the given name.
  // crate: object-0.39.1/src/write/mod.rs:408 symbol_id
  symbol_id(name: Uint8Array): SymbolId | undefined {
    return this.symbol_map.get(bytes_key(name));
  }

  /// Get the symbol with the given `SymbolId`.
  // crate: object-0.39.1/src/write/mod.rs:414 symbol
  symbol(symbol: SymbolId): Symbol {
    return index(this.symbols, symbol);
  }

  /// Mutably get the symbol with the given `SymbolId`.
  // crate: object-0.39.1/src/write/mod.rs:420 symbol_mut
  symbol_mut(symbol: SymbolId): Symbol {
    return index(this.symbols, symbol);
  }

  /// Add a new symbol and return its `SymbolId`.
  ///
  /// If the symbol is a section symbol that is already defined,
  /// it will update the flags of the existing section symbol
  /// instead of creating adding a new symbol.
  ///
  /// The symbol name will be modified to include the global prefix
  /// if the mangling scheme has one.
  // crate: object-0.39.1/src/write/mod.rs:432 add_symbol
  add_symbol(symbol: Symbol): SymbolId {
    // Defined symbols must have a scope.
    // debug_assert!(symbol.is_undefined() || symbol.scope != SymbolScope::Unknown);
    if (symbol.kind === "Section") {
      // There can only be one section symbol, but update its flags, since
      // the automatically generated section symbol will have none.
      const id = SymbolSection.id(symbol.section);
      if (id === undefined) return panic("called `Option::unwrap()` on a `None` value");
      const symbol_id = this.section_symbol(id);
      if (symbol.flags.$ !== "None") {
        this.symbol_mut(symbol_id).flags = symbol.flags;
      }
      return symbol_id;
    }
    if (symbol.name.length !== 0 && (symbol.kind === "Text" || symbol.kind === "Data" || symbol.kind === "Tls")) {
      const unmangled_name = symbol.name.slice();
      const prefix = Mangling.global_prefix(this.mangling_);
      if (prefix !== undefined) {
        // `symbol.name.insert(0, prefix)`
        const name = new Uint8Array(symbol.name.length + 1);
        name[0] = prefix;
        name.set(symbol.name, 1);
        symbol.name = name;
      }
      const symbol_id = this.add_raw_symbol(symbol);
      this.symbol_map.set(bytes_key(unmangled_name), symbol_id);
      return symbol_id;
    } else {
      return this.add_raw_symbol(symbol);
    }
  }

  // crate: object-0.39.1/src/write/mod.rs:461 add_raw_symbol
  add_raw_symbol(symbol: Symbol): SymbolId {
    const symbol_id = this.symbols.length as SymbolId;
    this.symbols.push(symbol);
    return symbol_id;
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
        return macho_symbol_flags(symbol);
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

  /// Mutably get the flags for a symbol.
  ///
  /// If `symbol.flags` is `SymbolFlags::None`, then replace it with
  /// [`Self::default_symbol_flags`].
  /// Otherwise, `&mut symbol.flags` is returned as is.
  /** PORT: `&mut SymbolFlags` is the symbol that holds it: a caller writes `.flags` on the result. */
  // crate: object-0.39.1/src/write/mod.rs:509 symbol_flags_mut
  symbol_flags_mut(symbol_id: SymbolId): Symbol {
    if (this.symbol(symbol_id).flags.$ !== "None") {
      return this.symbol_mut(symbol_id);
    } else {
      const flags = this.default_symbol_flags(this.symbol(symbol_id));
      const symbol = this.symbol_mut(symbol_id);
      symbol.flags = flags;
      return symbol;
    }
  }

  /// Return true if the file format supports `StandardSection::UninitializedTls`.
  // crate: object-0.39.1/src/write/mod.rs:525 has_uninitialized_tls
  has_uninitialized_tls(): boolean {
    return this.format_ !== "Coff";
  }

  /// Return true if the file format supports `StandardSection::Common`.
  // crate: object-0.39.1/src/write/mod.rs:531 has_common
  has_common(): boolean {
    return this.format_ === "MachO";
  }

  /// Add a new common symbol and return its `SymbolId`.
  ///
  /// For Mach-O, this appends the symbol to the `__common` section.
  ///
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:540 add_common_symbol
  add_common_symbol(symbol: Symbol, size: number, align: number): SymbolId {
    if (this.has_common()) {
      const symbol_id = this.add_symbol(symbol);
      const section = this.section_id("Common");
      this.add_symbol_bss(symbol_id, section, size, align);
      return symbol_id;
    } else {
      symbol.section = { $: "Common" };
      symbol.size = size;
      return this.add_symbol(symbol);
    }
  }

  /// Add a new file symbol and return its `SymbolId`.
  // crate: object-0.39.1/src/write/mod.rs:554 add_file_symbol
  add_file_symbol(name: Uint8Array): SymbolId {
    return this.add_raw_symbol(new Symbol(name, 0, 0, "File", "Compilation", false, { $: "None" }, { $: "None" }));
  }

  /// Get the symbol for a section.
  // crate: object-0.39.1/src/write/mod.rs:568 section_symbol
  section_symbol(section_id: SectionId): SymbolId {
    const section = index(this.sections, section_id);
    if (section.symbol !== undefined) {
      return section.symbol;
    }
    let name: Uint8Array;
    if (this.format_ === "Coff") {
      name = section.name.slice();
    } else if (this.format_ === "MachO") {
      // Use LLVM's convention for section symbols.
      name = new TextEncoder().encode(`ltmp${section_id}`);
    } else {
      name = new Uint8Array(0);
    }
    const symbol_id = this.symbols.length as SymbolId;
    this.symbols.push(new Symbol(name, 0, 0, "Section", "Compilation", false, { $: "Section", _0: section_id }, { $: "None" }));
    section.symbol = symbol_id;
    return symbol_id;
  }

  /// Append data to an existing section, and update a symbol to refer to it.
  ///
  /// For Mach-O, this also creates a `__thread_vars` entry for TLS symbols, and the
  /// symbol will indirectly point to the added data via the `__thread_vars` entry.
  ///
  /// For Mach-O, if [`Self::set_subsections_via_symbols`] is enabled, this will
  /// automatically ensure the data size is at least 1.
  ///
  /// Returns the section offset of the data.
  ///
  /// Must not be called for sections that contain uninitialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:608 add_symbol_data
  add_symbol_data(symbol_id: SymbolId, section: SectionId, data: Uint8Array, align: number): number {
    if (data.length === 0 && this.macho_subsections_via_symbols) {
      data = Uint8Array.of(0);
    }
    const offset = this.append_section_data(section, data, align);
    this.set_symbol_data(symbol_id, section, offset, data.length);
    return offset;
  }

  /// Append zero-initialized data to an existing section, and update a symbol to refer to it.
  ///
  /// For Mach-O, this also creates a `__thread_vars` entry for TLS symbols, and the
  /// symbol will indirectly point to the added data via the `__thread_vars` entry.
  ///
  /// For Mach-O, if [`Self::set_subsections_via_symbols`] is enabled, this will
  /// automatically ensure the data size is at least 1.
  ///
  /// Returns the section offset of the data.
  ///
  /// Must not be called for sections that contain initialized data.
  /// `align` must be a power of two.
  // crate: object-0.39.1/src/write/mod.rs:636 add_symbol_bss
  add_symbol_bss(symbol_id: SymbolId, section: SectionId, size: number, align: number): number {
    if (size === 0 && this.macho_subsections_via_symbols) {
      size = 1;
    }
    const offset = this.append_section_bss(section, size, align);
    this.set_symbol_data(symbol_id, section, offset, size);
    return offset;
  }

  /// Update a symbol to refer to the given data within a section.
  ///
  /// For Mach-O, this also creates a `__thread_vars` entry for TLS symbols, and the
  /// symbol will indirectly point to the data via the `__thread_vars` entry.
  // crate: object-0.39.1/src/write/mod.rs:657 set_symbol_data
  set_symbol_data(symbol_id: SymbolId, section: SectionId, offset: number, size: number): void {
    // Defined symbols must have a scope.
    // debug_assert!(self.symbol(symbol_id).scope != SymbolScope::Unknown);
    switch (this.format_) {
      case "MachO":
        symbol_id = macho_add_thread_var(this, symbol_id);
        break;
      default:
        break;
    }
    const symbol = this.symbol_mut(symbol_id);
    symbol.value = offset;
    symbol.size = size;
    symbol.section = { $: "Section", _0: section };
  }

  /// Convert a symbol to a section symbol and offset.
  ///
  /// Returns `None` if the symbol does not have a section.
  // crate: object-0.39.1/src/write/mod.rs:680 symbol_section_and_offset
  symbol_section_and_offset(symbol_id: SymbolId): [SymbolId, number] | undefined {
    const symbol = this.symbol(symbol_id);
    if (symbol.kind === "Section") {
      return [symbol_id, 0];
    }
    const symbol_offset = symbol.value;
    const section = SymbolSection.id(symbol.section);
    if (section === undefined) return undefined;
    const section_symbol = this.section_symbol(section);
    return [section_symbol, symbol_offset];
  }

  /// Add a relocation to a section.
  ///
  /// Relocations must only be added after the referenced symbols have been added
  /// and defined (if applicable).
  // crate: object-0.39.1/src/write/mod.rs:695 add_relocation
  add_relocation(section: SectionId, relocation: Relocation): Result<null> {
    return this.add_relocation_internal(section, RelocationInternal_from(relocation));
  }

  /// Add a relocation with a subtractor to a section.
  ///
  /// Relocations must only be added after the referenced symbols have been added
  /// and defined (if applicable).
  ///
  /// This is like [`Self::add_relocation`], but the relocation operation
  /// calculates the difference of two symbols. Currently, only some Mach-O
  /// targets support this.
  // crate: object-0.39.1/src/write/mod.rs:707 add_relocation_with_subtractor
  add_relocation_with_subtractor(section: SectionId, relocation: Relocation, subtractor: SymbolId | undefined): Result<null> {
    if (subtractor !== undefined) {
      if (this.format_ !== "MachO") {
        return Err(new Error(`unsupported relocation subtractor ${debug_SymbolId(subtractor)} for ${debug_Relocation(relocation)}`));
      }
    }
    return this.add_relocation_internal(section, { ...RelocationInternal_from(relocation), subtractor });
  }

  // crate: object-0.39.1/src/write/mod.rs:730 add_relocation_internal
  add_relocation_internal(section: SectionId, relocation: RelocationInternal): Result<null> {
    let r: Result<null>;
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_translate_relocation (COFF object files)");
      case "Elf":
        r = elf_translate_relocation(this, relocation);
        break;
      case "MachO":
        r = macho_translate_relocation(this, section, relocation);
        break;
      case "Xcoff":
        return unported("object::write::Object::xcoff_translate_relocation (XCOFF object files)");
      default:
        return panic("not implemented");
    }
    if (r.$ === "Err") return r;
    let implicit_: Result<boolean>;
    switch (this.format_) {
      case "Elf":
        implicit_ = elf_adjust_addend(this, relocation);
        break;
      case "MachO":
        implicit_ = macho_adjust_addend(this, relocation);
        break;
      default:
        return panic("not implemented");
    }
    if (implicit_.$ === "Err") return implicit_;
    const implicit = implicit_._0;
    if (implicit && relocation.addend !== 0n) {
      const w = this.write_relocation_addend(section, relocation);
      if (w.$ === "Err") return w;
      relocation.addend = 0n;
    }
    index(this.sections, section).relocations.push(relocation);
    return Ok(null);
  }

  // crate: object-0.39.1/src/write/mod.rs:765 write_relocation_addend
  write_relocation_addend(section: SectionId, relocation: RelocationInternal): Result<null> {
    let size_: Result<number>;
    switch (this.format_) {
      case "Coff":
        return unported("object::write::Object::coff_relocation_size (COFF object files)");
      case "Elf":
        size_ = elf_relocation_size(this, relocation);
        break;
      case "MachO":
        size_ = macho_relocation_size(relocation);
        break;
      case "Xcoff":
        return unported("object::write::Object::xcoff_relocation_size (XCOFF object files)");
      default:
        return panic("not implemented");
    }
    if (size_.$ === "Err") return size_;
    const size = size_._0;
    const data = index(this.sections, section).data_mut();
    const offset = relocation.offset;
    let r: StdResult<null, null>;
    switch (size) {
      case 32:
        r = write_at(data, offset, uint_bytes(this.endian, BigInt.asUintN(32, relocation.addend), 4));
        break;
      case 64:
        r = write_at(data, offset, uint_bytes(this.endian, BigInt.asUintN(64, relocation.addend), 8));
        break;
      default: {
        return Err(new Error(`unimplemented relocation addend ${debug_RelocationInternal(relocation)}`));
      }
    }
    if (r.$ === "Err") {
      return Err(new Error(`invalid relocation offset ${relocation.offset}+${size} (max ${data.length})`));
    }
    return Ok(null);
  }

  /// Write the object to a `Vec`.
  // crate: object-0.39.1/src/write/mod.rs:804 write
  write(): Result<Uint8Array> {
    const buffer = new VecBuffer();
    const r = this.emit(buffer);
    if (r.$ === "Err") return r;
    return Ok(buffer.finish());
  }

  /// Write the object to a `Write` implementation.
  ///
  /// Also flushes the writer.
  ///
  /// It is advisable to use a buffered writer like [`BufWriter`](std::io::BufWriter)
  /// instead of an unbuffered writer like [`File`](std::fs::File).
  // crate: object-0.39.1/src/write/mod.rs:817 write_stream
  write_stream(_w: unknown): never {
    // PORT: needs `StreamingBuffer` over an `io::Write` (util.rs), which is not ported: rustc only calls `write`.
    return unported("object::write::Object::write_stream (StreamingBuffer over std::io::Write)");
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
        return macho_write(this, buffer);
      case "Xcoff":
        return unported("object::write::Object::xcoff_write (XCOFF object files)");
      default:
        return panic("not implemented");
    }
  }
}

/** `v[i]` on a `Vec` indexed by an id: core's out-of-bounds panic. */
function index<T>(v: T[], i: number): T {
  if (i >= v.length) return panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** The `symbol_map` key of a name: its latin-1 spelling (one char per byte). */
function bytes_key(name: Uint8Array): string {
  let s = "";
  for (let i = 0; i < name.length; i++) s += String.fromCharCode(name[i]!);
  return s;
}

/** `U32::new(endian, v)` / `U64::new(endian, v)` as bytes. */
function uint_bytes(endian: Endianness, v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const byte = Number((v >> BigInt(8 * i)) & 0xffn);
    out[endian === "Little" ? i : n - 1 - i] = byte;
  }
  return out;
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
  relocations: RelocationInternal[] = [];
  symbol: SymbolId | undefined = undefined;
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

  /// Try to convert the segment to a utf8 string.
  // crate: object-0.39.1/src/write/mod.rs:939 segment
  segment_str(): string | undefined {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.segment);
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

  /// Returns the section as-built so far.
  ///
  /// This requires that the section is not a bss section.
  // crate: object-0.39.1/src/write/mod.rs:1009 data
  data_(): Uint8Array {
    // debug_assert!(!self.is_bss());
    return this.data;
  }

  /// Returns the section as-built so far.
  ///
  /// This requires that the section is not a bss section.
  // crate: object-0.39.1/src/write/mod.rs:1017 data_mut
  data_mut(): Uint8Array {
    // debug_assert!(!self.is_bss());
    return this.data;
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

/// An identifier used to reference a symbol.
export type SymbolId = number & { readonly __brand: "write::SymbolId" };

/** `{:?}` of `SymbolId` (derived): `SymbolId(3)`. */
export function debug_SymbolId(id: SymbolId): string {
  return `SymbolId(${id})`;
}

/// A relocation in an object file.
export interface Relocation {
  /// The section offset of the place of the relocation.
  offset: number;
  /// The symbol referred to by the relocation.
  ///
  /// This may be a section symbol.
  symbol: SymbolId;
  /// The addend to use in the relocation calculation.
  ///
  /// This may be in addition to an implicit addend stored at the place of the relocation.
  addend: bigint;
  /// The fields that define the relocation type.
  flags: RelocationFlags;
}

/** `{:?}` of `Relocation` (derived). */
export function debug_Relocation(r: Relocation): string {
  return `Relocation { offset: ${r.offset}, symbol: ${debug_SymbolId(r.symbol)}, addend: ${r.addend}, flags: ${debug_RelocationFlags(r.flags)} }`;
}

/** `pub(crate) struct RelocationInternal`. */
export interface RelocationInternal {
  offset: number;
  symbol: SymbolId;
  subtractor: SymbolId | undefined;
  addend: bigint;
  flags: RelocationFlags;
}

/** `{:?}` of `RelocationInternal` (derived). */
export function debug_RelocationInternal(r: RelocationInternal): string {
  const subtractor = r.subtractor === undefined ? "None" : `Some(${debug_SymbolId(r.subtractor)})`;
  return `RelocationInternal { offset: ${r.offset}, symbol: ${debug_SymbolId(r.symbol)}, subtractor: ${subtractor}, addend: ${r.addend}, flags: ${debug_RelocationFlags(r.flags)} }`;
}

// impl From<Relocation> for RelocationInternal
// crate: object-0.39.1/src/write/mod.rs:1136 from
export function RelocationInternal_from(value: Relocation): RelocationInternal {
  return {
    offset: value.offset,
    symbol: value.symbol,
    subtractor: undefined,
    addend: value.addend,
    flags: value.flags,
  };
}

/// An identifier used to reference a COMDAT section group.
export type ComdatId = number & { readonly __brand: "write::ComdatId" };

/// A COMDAT section group.
export interface Comdat {
  /// The COMDAT selection kind.
  ///
  /// This determines the way in which the linker resolves multiple definitions of the COMDAT
  /// sections.
  kind: ComdatKind;
  /// The COMDAT symbol.
  ///
  /// If this symbol is referenced, then all sections in the group will be included by the
  /// linker.
  symbol: SymbolId;
  /// The sections in the group.
  sections: SectionId[];
}

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

  /// Return the prefix to use for global symbols.
  // crate: object-0.39.1/src/write/mod.rs:1200 global_prefix
  global_prefix(self: Mangling): number | undefined {
    switch (self) {
      case "None":
      case "Elf":
      case "Coff":
      case "Xcoff":
        return undefined;
      case "CoffI386":
      case "MachO":
        return 0x5f; // b'_'
    }
  },
};
