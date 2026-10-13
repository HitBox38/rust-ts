// Port of wasmparser 0.247.0 `src/readers/core/linking.rs` (`LinkingSectionReader` and the
// subsection dispatch).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: the subsection item types (`Segment`, `InitFunc`, `Comdat`, `SymbolInfo`) are not ported:
// reading one calls `unported(...)`. rustc's Wasm metadata wrapper has a `linking` section with
// only the version (no subsections).

import { unported } from "../../../../std/panic.ts";
import { Err, Ok } from "../../../../std/result.ts";
import { type BinaryReader, BinaryReaderError, type FromReader, type Result } from "../../binary_reader.ts";
import { SectionLimited, Subsections } from "../../readers.ts";

const segment_from_reader: FromReader<never> = () => unported("wasmparser::readers::core::linking::Segment::from_reader");
const init_func_from_reader: FromReader<never> = () => unported("wasmparser::readers::core::linking::InitFunc::from_reader");
const comdat_from_reader: FromReader<never> = () => unported("wasmparser::readers::core::linking::Comdat::from_reader");
const symbol_info_from_reader: FromReader<never> = () => unported("wasmparser::readers::core::linking::SymbolInfo::from_reader");

/// Represents a reader for segments from the linking custom section.
export type SegmentMap = SectionLimited<never>;
/// Represents a reader for init functions from the linking custom section.
export type InitFuncMap = SectionLimited<never>;
/// Represents a reader for COMDAT data from the linking custom section.
export type ComdatMap = SectionLimited<never>;
/// Represents a reader for symbol info from the linking custom section.
export type SymbolInfoMap = SectionLimited<never>;

/// A reader for the `linking` custom section of a WebAssembly module.
///
/// This format is currently defined upstream at
/// <https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md>.
export class LinkingSectionReader {
  constructor(
    /// The version of linking metadata contained in this section.
    readonly version_: number,
    /// The subsections in this section.
    readonly subsections_: Subsections<Linking>,
    /// The range of the entire section, including the version.
    readonly range_: [number, number],
  ) {}

  /// Creates a new reader for the linking section contents starting at
  /// `offset` within the original wasm file.
  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:406 new
  static new(reader: BinaryReader): Result<LinkingSectionReader> {
    const range = reader.range();
    const offset = reader.original_position();

    const v = reader.read_var_u32();
    if (v.$ === "Err") return v;
    const version = v._0;
    if (version !== 2) {
      return Err(BinaryReaderError.new(`unsupported linking section version: ${version}`, offset));
    }

    const subsections = Subsections.new(Linking_from_reader, reader.shrink());
    return Ok(new LinkingSectionReader(version, subsections, range));
  }

  /// Returns the version of linking metadata contained in this section.
  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:427 version
  version(): number {
    return this.version_;
  }

  /// Returns the original byte offset of this section.
  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:432 original_position
  original_position(): number {
    return this.subsections_.original_position();
  }

  /// Returns the range, as byte offsets, of this section within the original
  /// wasm binary.
  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:438 range
  range(): [number, number] {
    return this.range_;
  }

  /// Returns the iterator for advancing through the subsections.
  ///
  /// You can also use [`IntoIterator::into_iter`] directly on this type.
  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:445 subsections
  subsections(): Subsections<Linking> {
    return this.subsections_.clone();
  }

  // crate: wasmparser-0.247.0/src/readers/core/linking.rs:454 into_iter
  into_iter(): Subsections<Linking> {
    return this.subsections_;
  }
}

/// Represents a subsection read from the linking custom section.
export type Linking =
  /// Extra metadata about the data segments.
  | { $: "SegmentInfo"; _0: SegmentMap }
  /// A list of constructor functions to be called at startup.
  | { $: "InitFuncs"; _0: InitFuncMap }
  /// The [COMDAT](https://llvm.org/docs/LangRef.html#comdats) groups of associated linking objects.
  | { $: "ComdatInfo"; _0: ComdatMap }
  /// Extra information about the symbols present in the module.
  | { $: "SymbolTable"; _0: SymbolInfoMap }
  /// An unknown [linking subsection](https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md#linking-metadata-section).
  | {
      $: "Unknown";
      /// The identifier for this subsection.
      ty: number;
      /// The contents of this subsection.
      data: Uint8Array;
      /// The range of bytes, relative to the start of the original data
      /// stream, that the contents of this subsection reside in.
      range: [number, number];
    };

// impl<'a> Subsection<'a> for Linking<'a>
// crate: wasmparser-0.247.0/src/readers/core/linking.rs:386 from_reader
export function Linking_from_reader(id: number, reader: BinaryReader): Result<Linking> {
  const data = reader.remaining_buffer();
  const offset = reader.original_position();
  switch (id) {
    case 5: {
      const m = SectionLimited.new(segment_from_reader, reader);
      if (m.$ === "Err") return m;
      return Ok({ $: "SegmentInfo", _0: m._0 });
    }
    case 6: {
      const m = SectionLimited.new(init_func_from_reader, reader);
      if (m.$ === "Err") return m;
      return Ok({ $: "InitFuncs", _0: m._0 });
    }
    case 7: {
      const m = SectionLimited.new(comdat_from_reader, reader);
      if (m.$ === "Err") return m;
      return Ok({ $: "ComdatInfo", _0: m._0 });
    }
    case 8: {
      const m = SectionLimited.new(symbol_info_from_reader, reader);
      if (m.$ === "Err") return m;
      return Ok({ $: "SymbolTable", _0: m._0 });
    }
    default:
      return Ok({ $: "Unknown", ty: id, data, range: [offset, offset + data.length] });
  }
}
