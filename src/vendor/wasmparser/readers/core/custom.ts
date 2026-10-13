// Port of wasmparser 0.247.0 `src/readers/core/custom.rs` (`CustomSectionReader`).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: `as_known` / `KnownCustom` are not ported (unused on rustc's path).

import { Ok } from "../../../../std/result.ts";
import type { BinaryReader, Result } from "../../binary_reader.ts";

/// A reader for custom sections of a WebAssembly module.
export class CustomSectionReader {
  constructor(
    readonly name_: string,
    readonly reader: BinaryReader,
  ) {}

  /// Constructs a new `CustomSectionReader` for the given data and offset.
  // crate: wasmparser-0.247.0/src/readers/core/custom.rs:14 new
  static new(reader: BinaryReader): Result<CustomSectionReader> {
    const name = reader.read_string();
    if (name.$ === "Err") return name;
    return Ok(new CustomSectionReader(name._0, reader));
  }

  /// The name of the custom section.
  // crate: wasmparser-0.247.0/src/readers/core/custom.rs:20 name
  name(): string {
    return this.name_;
  }

  /// The offset, relative to the start of the original module or component,
  /// that the `data` payload for this custom section starts at.
  // crate: wasmparser-0.247.0/src/readers/core/custom.rs:26 data_offset
  data_offset(): number {
    return this.reader.original_position();
  }

  /// The actual contents of the custom section.
  // crate: wasmparser-0.247.0/src/readers/core/custom.rs:31 data
  data(): Uint8Array {
    return this.reader.remaining_buffer();
  }

  /// The range of bytes that specify this whole custom section (including
  /// both the name of this custom section and its data) specified in
  /// offsets relative to the start of the byte stream.
  // crate: wasmparser-0.247.0/src/readers/core/custom.rs:38 range
  range(): [number, number] {
    return this.reader.range();
  }
}
