// Port of wasmparser 0.247.0 `src/readers/core/code.rs` (`FunctionBody` as the parser yields it).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: locals / operator readers are not ported (unused on rustc's path).

import type { BinaryReader } from "../../binary_reader.ts";

/// Represents a WebAssembly function body.
export class FunctionBody {
  constructor(readonly reader: BinaryReader) {}

  /// Constructs a new `FunctionBody` for the given data and offset.
  // crate: wasmparser-0.247.0/src/readers/core/code.rs:30 new
  static new(reader: BinaryReader): FunctionBody {
    return new FunctionBody(reader);
  }

  /// Gets a binary reader for this function body.
  // crate: wasmparser-0.247.0/src/readers/core/code.rs:35 get_binary_reader
  get_binary_reader(): BinaryReader {
    return this.reader.clone();
  }

  /// Gets the range of the function body.
  // crate: wasmparser-0.247.0/src/readers/core/code.rs:75 range
  range(): [number, number] {
    return this.reader.range();
  }
}
