// Port of object 0.39.1 `src/read/any.rs` (the `File` / `Section` wrappers over the format
// readers rustc reaches).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `File` is a class carrying the variant as `$` / `_0` (the enum encoding), so it can
// implement the `Object` methods; `Section` keeps upstream's `inner: SectionInternal`. The
// `with_inner!` / `map_inner*!` macros expand to the per-variant dispatch, as upstream.
// COFF/PE/XCOFF files reach `unported(...)` in `File::parse` (no rust-ts target uses them).
// Segments, symbols, comdats, relocations and the dyld cache are not ported.

import { unported } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import type { BinaryFormat } from "../common.ts";
import { ElfFile32, ElfFile64, type ElfFile, type ElfSection } from "./elf/mod.ts";
import { MachOFile32, MachOFile64, type MachOFile, type MachOSection } from "./macho/mod.ts";
import { Error, FileKind, type ObjectKind, type Result, type SectionIndex } from "./mod.ts";
import type { Object, ObjectSection } from "./traits.ts";
import { WasmFile, type WasmSection } from "./wasm.ts";

type FileInternal =
  | { $: "Elf32"; _0: ElfFile }
  | { $: "Elf64"; _0: ElfFile }
  | { $: "MachO32"; _0: MachOFile }
  | { $: "MachO64"; _0: MachOFile }
  | { $: "Wasm"; _0: WasmFile };
// PORT: `Coff(CoffFile)`, `CoffBig(CoffBigFile)`, `Pe32`, `Pe64`, `Xcoff32`, `Xcoff64` are never
// constructed (their parsers are unported).

/// An object file that can be any supported file format.
///
/// Most functionality is provided by the [`Object`] trait implementation.
export class File implements Object<Section> {
  constructor(
    readonly $: FileInternal["$"],
    readonly _0: ElfFile | MachOFile | WasmFile,
  ) {}

  /** The variant as the tagged union (`match self { ... }`). */
  private get inner(): FileInternal {
    return { $: this.$, _0: this._0 } as FileInternal;
  }

  /// Parse the raw file data.
  // crate: object-0.39.1/src/read/any.rs:241 parse
  static parse(data: Uint8Array): Result<File> {
    const k = FileKind.parse(data);
    if (k.$ === "Err") return k;
    switch (k._0) {
      case "Elf32": {
        const f = ElfFile32.parse(data);
        if (f.$ === "Err") return f;
        return Ok(new File("Elf32", f._0));
      }
      case "Elf64": {
        const f = ElfFile64.parse(data);
        if (f.$ === "Err") return f;
        return Ok(new File("Elf64", f._0));
      }
      case "MachO32": {
        const f = MachOFile32.parse(data);
        if (f.$ === "Err") return f;
        return Ok(new File("MachO32", f._0));
      }
      case "MachO64": {
        const f = MachOFile64.parse(data);
        if (f.$ === "Err") return f;
        return Ok(new File("MachO64", f._0));
      }
      case "Wasm": {
        const f = WasmFile.parse(data);
        if (f.$ === "Err") return f;
        return Ok(new File("Wasm", f._0));
      }
      case "Pe32":
        return unported("object::read::pe::PeFile32::parse (PE files: no rust-ts target)");
      case "Pe64":
        return unported("object::read::pe::PeFile64::parse (PE files: no rust-ts target)");
      case "Coff":
        return unported("object::read::coff::CoffFile::parse (COFF files: no rust-ts target)");
      case "CoffBig":
        return unported("object::read::coff::CoffBigFile::parse (COFF files: no rust-ts target)");
      case "Xcoff32":
        return unported("object::read::xcoff::XcoffFile32::parse (XCOFF files: no rust-ts target)");
      case "Xcoff64":
        return unported("object::read::xcoff::XcoffFile64::parse (XCOFF files: no rust-ts target)");
      default:
        return Err(new Error("Unsupported file format"));
    }
  }

  /// Return the file format.
  // crate: object-0.39.1/src/read/any.rs:287 format
  format(): BinaryFormat {
    switch (this.$) {
      case "Elf32":
      case "Elf64":
        return "Elf";
      case "MachO32":
      case "MachO64":
        return "MachO";
      case "Wasm":
        return "Wasm";
    }
  }

  // impl Object for File

  // crate: object-0.39.1/src/read/any.rs:370 is_little_endian
  is_little_endian(): boolean {
    return this._0.is_little_endian();
  }

  // crate: object-0.39.1/src/read/any.rs:374 is_64
  is_64(): boolean {
    return this._0.is_64();
  }

  // crate: object-0.39.1/src/read/any.rs:378 kind
  kind(): ObjectKind {
    return this._0.kind();
  }

  // crate: object-0.39.1/src/read/any.rs:388 section_by_name_bytes
  section_by_name_bytes(section_name: Uint8Array): Section | undefined {
    const inner = this.inner;
    let s: SectionInternal | undefined;
    switch (inner.$) {
      case "Elf32": {
        const x = inner._0.section_by_name_bytes(section_name);
        s = x === undefined ? undefined : { $: "Elf32", _0: x };
        break;
      }
      case "Elf64": {
        const x = inner._0.section_by_name_bytes(section_name);
        s = x === undefined ? undefined : { $: "Elf64", _0: x };
        break;
      }
      case "MachO32": {
        const x = inner._0.section_by_name_bytes(section_name);
        s = x === undefined ? undefined : { $: "MachO32", _0: x };
        break;
      }
      case "MachO64": {
        const x = inner._0.section_by_name_bytes(section_name);
        s = x === undefined ? undefined : { $: "MachO64", _0: x };
        break;
      }
      case "Wasm": {
        const x = inner._0.section_by_name_bytes(section_name);
        s = x === undefined ? undefined : { $: "Wasm", _0: x };
        break;
      }
    }
    return s === undefined ? undefined : new Section(s);
  }

  // crate: object-0.39.1/src/read/any.rs:397 section_by_index
  section_by_index(index: SectionIndex): Result<Section> {
    const inner = this.inner;
    let s: Result<SectionInternal>;
    switch (inner.$) {
      case "Elf32": {
        const x = inner._0.section_by_index(index);
        s = x.$ === "Err" ? x : Ok({ $: "Elf32", _0: x._0 });
        break;
      }
      case "Elf64": {
        const x = inner._0.section_by_index(index);
        s = x.$ === "Err" ? x : Ok({ $: "Elf64", _0: x._0 });
        break;
      }
      case "MachO32": {
        const x = inner._0.section_by_index(index);
        s = x.$ === "Err" ? x : Ok({ $: "MachO32", _0: x._0 });
        break;
      }
      case "MachO64": {
        const x = inner._0.section_by_index(index);
        s = x.$ === "Err" ? x : Ok({ $: "MachO64", _0: x._0 });
        break;
      }
      case "Wasm": {
        const x = inner._0.section_by_index(index);
        s = x.$ === "Err" ? x : Ok({ $: "Wasm", _0: x._0 });
        break;
      }
    }
    if (s.$ === "Err") return s;
    return Ok(new Section(s._0));
  }

  // crate: object-0.39.1/src/read/any.rs:402 sections
  *sections(): IterableIterator<Section> {
    const inner = this.inner;
    switch (inner.$) {
      case "Elf32":
        for (const x of inner._0.sections()) yield new Section({ $: "Elf32", _0: x });
        return;
      case "Elf64":
        for (const x of inner._0.sections()) yield new Section({ $: "Elf64", _0: x });
        return;
      case "MachO32":
        for (const x of inner._0.sections()) yield new Section({ $: "MachO32", _0: x });
        return;
      case "MachO64":
        for (const x of inner._0.sections()) yield new Section({ $: "MachO64", _0: x });
        return;
      case "Wasm":
        for (const x of inner._0.sections()) yield new Section({ $: "Wasm", _0: x });
        return;
    }
  }
}

type SectionInternal =
  | { $: "Elf32"; _0: ElfSection }
  | { $: "Elf64"; _0: ElfSection }
  | { $: "MachO32"; _0: MachOSection }
  | { $: "MachO64"; _0: MachOSection }
  | { $: "Wasm"; _0: WasmSection };

/// A section in a [`File`].
///
/// Most functionality is provided by the [`ObjectSection`] trait implementation.
export class Section implements ObjectSection {
  constructor(readonly inner: SectionInternal) {}

  // impl ObjectSection for Section (`with_inner!(self.inner, SectionInternal, |x| x.<method>())`)

  // crate: object-0.39.1/src/read/any.rs:771 index
  index(): SectionIndex {
    return this.inner._0.index();
  }

  // crate: object-0.39.1/src/read/any.rs:775 address
  address(): number {
    return this.inner._0.address();
  }

  // crate: object-0.39.1/src/read/any.rs:779 size
  size(): number {
    return this.inner._0.size();
  }

  // crate: object-0.39.1/src/read/any.rs:783 align
  align(): number {
    return this.inner._0.align();
  }

  // crate: object-0.39.1/src/read/any.rs:787 file_range
  file_range(): [number, number] | undefined {
    return this.inner._0.file_range();
  }

  // crate: object-0.39.1/src/read/any.rs:791 data
  data(): Result<Uint8Array> {
    return this.inner._0.data();
  }

  // crate: object-0.39.1/src/read/any.rs:807 name_bytes
  name_bytes(): Result<Uint8Array> {
    return this.inner._0.name_bytes();
  }

  // crate: object-0.39.1/src/read/any.rs:811 name
  name(): Result<string> {
    return this.inner._0.name();
  }

  // crate: object-0.39.1/src/read/any.rs:815 segment_name_bytes
  segment_name_bytes(): Result<Uint8Array | undefined> {
    return this.inner._0.segment_name_bytes();
  }

  // crate: object-0.39.1/src/read/any.rs:819 segment_name
  segment_name(): Result<string | undefined> {
    return this.inner._0.segment_name();
  }
}
