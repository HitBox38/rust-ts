// Port of object 0.39.1 `src/read/wasm.rs` (parsing and the section access rustc's Wasm metadata
// wrappers need).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Support for reading Wasm files.
//!
//! [`WasmFile`] implements the [`Object`] trait for Wasm files.
//
// PORT: rustc's Wasm metadata wrapper (`create_metadata_file_for_wasm`, wasm32) is a module with a
// `linking` custom section (version 2, no subsections) and one data custom section. Everything
// that path reaches is ported. Reading the items of other sections (imports, memories, globals,
// exports, names, linking symbols) needs wasmparser item readers that are not ported, so those
// steps call `unported(...)` (via the wasmparser item reader, or here where the read value is
// consumed). Symbol, segment and comdat accessors are not ported.

import { panic, unported } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import * as wp from "../../wasmparser/lib.ts";
import { SectionKind, type SymbolKind, type SymbolScope } from "../common.ts";
import { Error, type ObjectKind, read_error_opt, read_error_unit, type Result, SectionIndex, type SymbolSection } from "./mod.ts";
import { ReadRef } from "./read_ref.ts";
import type { Object, ObjectSection } from "./traits.ts";
import { bytes_eq } from "./util.ts";

const SectionId = {
  Custom: 0,
  Type: 1,
  Import: 2,
  Function: 3,
  Table: 4,
  Memory: 5,
  Global: 6,
  Export: 7,
  Start: 8,
  Element: 9,
  Code: 10,
  Data: 11,
  DataCount: 12,
  Tag: 13,
} as const;
/** PORT: `#[repr(usize)] enum SectionId` as its discriminant. */
type SectionId = (typeof SectionId)[keyof typeof SectionId];
// Update this constant when adding new section id:
const MAX_SECTION_ID: number = SectionId.Tag;

interface SectionHeader {
  id: SectionId;
  range: [number, number];
  name: string;
}

type LocalFunctionKind = "Unknown" | "Exported";

interface WasmSymbolInternal {
  name: string;
  address: number;
  size: number;
  kind: SymbolKind;
  section: SymbolSection;
  scope: SymbolScope;
  weak: boolean;
}

// impl<T> ReadError<T> for wasmparser::Result<T>
// crate: object-0.39.1/src/read/wasm.rs:73 read_error
function read_error_wasm<T>(self: wp.Result<T>, error: string): Result<T> {
  return self.$ === "Ok" ? self : Err(new Error(error));
}

/// A WebAssembly object file.
export class WasmFile implements Object<WasmSection> {
  constructor(
    readonly data: Uint8Array,
    public has_memory64: boolean,
    // All sections, including custom sections.
    readonly sections_: SectionHeader[],
    // Indices into `sections` of sections with a non-zero id.
    readonly id_sections: (number | undefined)[],
    // Whether the file has DWARF information.
    public has_debug_symbols: boolean,
    // Symbols collected from imports, exports, code and name sections.
    readonly symbols: WasmSymbolInternal[],
    // Address of the function body for the entry point.
    public entry: number,
  ) {}

  /// Parse the raw wasm data.
  // crate: object-0.39.1/src/read/wasm.rs:80 parse
  static parse(data_: Uint8Array): Result<WasmFile> {
    const len = read_error_unit(ReadRef.len(data_), "Unknown Wasm file size");
    if (len.$ === "Err") return len;
    const d = read_error_unit(ReadRef.read_bytes_at(data_, 0, len._0), "Wasm read failed");
    if (d.$ === "Err") return d;
    const data = d._0;
    const parser = wp.Parser.new(0).parse_all(data);

    const file = new WasmFile(data, false, [], new Array<number | undefined>(MAX_SECTION_ID + 1).fill(undefined), false, [], 0);

    let main_file_symbol: WasmSymbolInternal | undefined = {
      name: "",
      address: 0,
      size: 0,
      kind: "File",
      section: { $: "None" },
      scope: "Compilation",
      weak: false,
    };

    let local_func_kinds: LocalFunctionKind[] = [];
    let entry_func_id: number | undefined;
    let code_range_start = 0;
    const code_ranges: [number, number][] = [];
    let imports_section: wp.SectionReader | undefined;
    let exports: wp.SectionReader | undefined;
    let names: wp.Subsections<never> | undefined;
    let symbols: wp.SectionLimited<never> | undefined;
    // One-to-one mapping of globals to their value (if the global is a constant integer).
    // (`global_values`: only filled by the unported global section items.)

    for (const p of parser) {
      const pr = read_error_wasm(p, "Invalid Wasm section header");
      if (pr.$ === "Err") return pr;
      const payload = pr._0;

      switch (payload.$) {
        case "Version": {
          if (payload.encoding !== "Module") {
            return Err(new Error("Unsupported Wasm encoding"));
          }
          break;
        }
        case "TypeSection": {
          file.add_section(SectionId.Type, payload._0.range(), "");
          break;
        }
        case "ImportSection": {
          file.add_section(SectionId.Import, payload._0.range(), "");
          imports_section = payload._0;
          break;
        }
        case "FunctionSection": {
          file.add_section(SectionId.Function, payload._0.range(), "");
          let count = 0;
          for (const _ of payload._0.into_iter()) count++;
          local_func_kinds = new Array<LocalFunctionKind>(count).fill("Unknown");
          break;
        }
        case "TableSection": {
          file.add_section(SectionId.Table, payload._0.range(), "");
          break;
        }
        case "MemorySection": {
          file.add_section(SectionId.Memory, payload._0.range(), "");
          for (const memory of payload._0.into_iter()) {
            const m = read_error_wasm(memory, "Couldn't read a memory item");
            if (m.$ === "Err") return m;
            // `file.has_memory64 |= memory.memory64;` (the item reader is unported)
          }
          break;
        }
        case "GlobalSection": {
          file.add_section(SectionId.Global, payload._0.range(), "");
          for (const global of payload._0.into_iter()) {
            const g = read_error_wasm(global, "Couldn't read a global item");
            if (g.$ === "Err") return g;
            // (the item reader is unported: the init expression read never runs)
          }
          break;
        }
        case "ExportSection": {
          file.add_section(SectionId.Export, payload._0.range(), "");
          exports = payload._0;
          break;
        }
        case "StartSection": {
          file.add_section(SectionId.Start, payload.range, "");
          entry_func_id = payload.func;
          break;
        }
        case "ElementSection": {
          file.add_section(SectionId.Element, payload._0.range(), "");
          break;
        }
        case "CodeSectionStart": {
          code_range_start = payload.range[0];
          file.add_section(SectionId.Code, payload.range, "");
          break;
        }
        case "CodeSectionEntry": {
          const range = payload._0.range();
          const address = range[0] - code_range_start;
          const size = range[1] - range[0];
          code_ranges.push([address, size]);
          break;
        }
        case "DataSection": {
          file.add_section(SectionId.Data, payload._0.range(), "");
          break;
        }
        case "DataCountSection": {
          file.add_section(SectionId.DataCount, payload.range, "");
          break;
        }
        case "TagSection": {
          file.add_section(SectionId.Tag, payload._0.range(), "");
          break;
        }
        case "CustomSection": {
          const section = payload._0;
          const name = section.name();
          const size = section.data().length;
          const range = section.range();
          range[0] = range[1] - size;
          file.add_section(SectionId.Custom, range, name);
          if (name === "name") {
            const reader = wp.BinaryReader.new(section.data(), section.data_offset());
            names = wp.Subsections.new<never>(() => unported("wasmparser::readers::core::names::Name::from_reader"), reader);
          } else if (name === "linking") {
            // https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md
            const reader = wp.BinaryReader.new(section.data(), section.data_offset());
            const linking = read_error_wasm(wp.LinkingSectionReader.new(reader), "Invalid Wasm linking section");
            if (linking.$ === "Err") return linking;
            for (const ss of linking._0.into_iter()) {
              const subsection = read_error_wasm(ss, "Invalid Wasm linking subsection");
              if (subsection.$ === "Err") return subsection;
              if (subsection._0.$ === "SymbolTable") {
                symbols = subsection._0._0;
              }
            }
          } else if (name.startsWith(".debug_")) {
            file.has_debug_symbols = true;
          }
          break;
        }
        default:
          break;
      }
    }

    if (entry_func_id !== undefined) {
      const range = code_ranges[entry_func_id];
      if (range !== undefined) {
        file.entry = range[0];
      }
    }

    if (imports_section !== undefined) {
      for (const imports of imports_section.into_iter()) {
        const i = read_error_wasm(imports, "Couldn't read an imports item");
        if (i.$ === "Err") return i;
        // (the item reader is unported: the import symbols are never added)
      }
    }

    if (symbols !== undefined) {
      // We have a symbol table, so we don't need to add symbols for locals or exports.
      // These sections shouldn't be present at the same time as a symbol table anyway.
      // TODO: never add symbols for exports. Return them via Object::exports instead.
      exports = undefined;
      names = undefined;

      for (const symbol of symbols.into_iter()) {
        const s = read_error_wasm(symbol, "Invalid Wasm linking symbol");
        if (s.$ === "Err") return s;
        // (the item reader is unported: the symbol is never pushed)
      }
    }

    if (exports !== undefined) {
      if (main_file_symbol !== undefined) {
        file.symbols.push(main_file_symbol);
        main_file_symbol = undefined;
      }

      for (const export_ of exports.into_iter()) {
        const e = read_error_wasm(export_, "Couldn't read an export item");
        if (e.$ === "Err") return e;
        // (the item reader is unported: the export symbols are never pushed)
      }
    }
    if (names !== undefined) {
      if (main_file_symbol !== undefined) {
        file.symbols.push(main_file_symbol);
        main_file_symbol = undefined;
      }
      for (const name of names) {
        const n = read_error_wasm(name, "Invalid wasm name section");
        if (n.$ === "Err") return n;
        // (the subsection reader is unported: the function names are never pushed)
      }
    }

    void local_func_kinds;
    return Ok(file);
  }

  // crate: object-0.39.1/src/read/wasm.rs:511 add_section
  add_section(id: SectionId, range: [number, number], name: string): void {
    const section: SectionHeader = { id, range, name };
    this.id_sections[id] = this.sections_.length;
    this.sections_.push(section);
  }

  // impl Object for WasmFile

  // crate: object-0.39.1/src/read/wasm.rs:582 is_little_endian
  is_little_endian(): boolean {
    return true;
  }

  // crate: object-0.39.1/src/read/wasm.rs:587 is_64
  is_64(): boolean {
    return this.has_memory64;
  }

  // crate: object-0.39.1/src/read/wasm.rs:591 kind
  kind(): ObjectKind {
    // TODO: check for `linking` custom section
    return "Unknown";
  }

  // crate: object-0.39.1/src/read/wasm.rs:600 section_by_name_bytes
  section_by_name_bytes(section_name: Uint8Array): WasmSection | undefined {
    for (const section of this.sections()) {
      const n = section.name_bytes();
      if (n.$ === "Ok" && bytes_eq(n._0, section_name)) return section;
    }
    return undefined;
  }

  // crate: object-0.39.1/src/read/wasm.rs:608 section_by_index
  section_by_index(index: SectionIndex): Result<WasmSection> {
    // TODO: Missing sections should return an empty section.
    const id_section = read_error_opt(this.id_sections[index], "Invalid Wasm section index");
    if (id_section.$ === "Err") return id_section;
    const section = this.sections_[id_section._0]!;
    return Ok(new WasmSection(this, section));
  }

  // crate: object-0.39.1/src/read/wasm.rs:622 sections
  sections(): WasmSectionIterator {
    return new WasmSectionIterator(this, 0);
  }
}

/// An iterator for the sections in a [`WasmFile`].
export class WasmSectionIterator implements Iterable<WasmSection> {
  constructor(
    readonly file: WasmFile,
    public sections: number,
  ) {}

  // crate: object-0.39.1/src/read/wasm.rs:788 next
  next(): WasmSection | undefined {
    const section = this.file.sections_[this.sections];
    if (section === undefined) return undefined;
    this.sections++;
    return new WasmSection(this.file, section);
  }

  *[Symbol.iterator](): IterableIterator<WasmSection> {
    for (;;) {
      const s = this.next();
      if (s === undefined) return;
      yield s;
    }
  }
}

/// A section in a [`WasmFile`].
///
/// Most functionality is provided by the [`ObjectSection`] trait implementation.
export class WasmSection implements ObjectSection {
  constructor(
    readonly file: WasmFile,
    readonly section: SectionHeader,
  ) {}

  // crate: object-0.39.1/src/read/wasm.rs:812 index
  index(): SectionIndex {
    // Note that we treat all custom sections as index 0.
    // This is ok because they are never looked up by index.
    return SectionIndex(this.section.id);
  }

  // crate: object-0.39.1/src/read/wasm.rs:819 address
  address(): number {
    return 0;
  }

  // crate: object-0.39.1/src/read/wasm.rs:824 size
  size(): number {
    const range = this.section.range;
    return range[1] - range[0];
  }

  // crate: object-0.39.1/src/read/wasm.rs:830 align
  align(): number {
    return 1;
  }

  // crate: object-0.39.1/src/read/wasm.rs:835 file_range
  file_range(): [number, number] | undefined {
    const range = this.section.range;
    return [range[0], range[1]];
  }

  // crate: object-0.39.1/src/read/wasm.rs:841 data
  data(): Result<Uint8Array> {
    const range = this.section.range;
    return read_error_unit(ReadRef.read_bytes_at(this.file.data, range[0], range[1] - range[0]), "Invalid Wasm section size or offset");
  }

  // crate: object-0.39.1/src/read/wasm.rs:849 data_range
  data_range(_address: number, _size: number): Result<Uint8Array | undefined> {
    return panic("not implemented");
  }

  // crate: object-0.39.1/src/read/wasm.rs:864 name_bytes
  name_bytes(): Result<Uint8Array> {
    const name = this.name();
    if (name.$ === "Err") return name;
    return Ok(new TextEncoder().encode(name._0));
  }

  // crate: object-0.39.1/src/read/wasm.rs:869 name
  name(): Result<string> {
    switch (this.section.id) {
      case SectionId.Custom:
        return Ok(this.section.name);
      case SectionId.Type:
        return Ok("<type>");
      case SectionId.Import:
        return Ok("<import>");
      case SectionId.Function:
        return Ok("<function>");
      case SectionId.Table:
        return Ok("<table>");
      case SectionId.Memory:
        return Ok("<memory>");
      case SectionId.Global:
        return Ok("<global>");
      case SectionId.Export:
        return Ok("<export>");
      case SectionId.Start:
        return Ok("<start>");
      case SectionId.Element:
        return Ok("<element>");
      case SectionId.Code:
        return Ok("<code>");
      case SectionId.Data:
        return Ok("<data>");
      case SectionId.DataCount:
        return Ok("<data_count>");
      case SectionId.Tag:
        return Ok("<tag>");
    }
  }

  // crate: object-0.39.1/src/read/wasm.rs:889 segment_name_bytes
  segment_name_bytes(): Result<Uint8Array | undefined> {
    return Ok(undefined);
  }

  // crate: object-0.39.1/src/read/wasm.rs:894 segment_name
  segment_name(): Result<string | undefined> {
    return Ok(undefined);
  }

  // crate: object-0.39.1/src/read/wasm.rs:899 kind
  kind(): SectionKind {
    switch (this.section.id) {
      case SectionId.Custom:
        switch (this.section.name) {
          case "reloc.":
          case "linking":
            return SectionKind.Linker;
          default:
            return SectionKind.Other;
        }
      case SectionId.Type:
        return SectionKind.Metadata;
      case SectionId.Import:
        return SectionKind.Linker;
      case SectionId.Function:
        return SectionKind.Metadata;
      case SectionId.Table:
        return SectionKind.UninitializedData;
      case SectionId.Memory:
        return SectionKind.UninitializedData;
      case SectionId.Global:
        return SectionKind.Data;
      case SectionId.Export:
        return SectionKind.Linker;
      case SectionId.Start:
        return SectionKind.Linker;
      case SectionId.Element:
        return SectionKind.Data;
      case SectionId.Code:
        return SectionKind.Text;
      case SectionId.Data:
        return SectionKind.Data;
      case SectionId.DataCount:
        return SectionKind.UninitializedData;
      case SectionId.Tag:
        return SectionKind.Data;
    }
  }
}
