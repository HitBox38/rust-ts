// Port of wasmparser 0.247.0 `src/readers.rs` (`FromReader` for `u32`, `SectionLimited`,
// `Subsections`).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: `T: FromReader` / `T: Subsection` bounds are passed as function values (the item type's
// `from_reader`). `Range<usize>` is `[start, end]`.

import { Err, Ok } from "../../std/result.ts";
import { type BinaryReader, BinaryReaderError, type FromReader, type Result } from "./binary_reader.ts";

// impl<'a> FromReader<'a> for u32
// crate: wasmparser-0.247.0/src/readers.rs:54 from_reader
export const u32_from_reader: FromReader<number> = (reader) => reader.read_var_u32();

// impl<'a> FromReader<'a> for &'a str
// crate: wasmparser-0.247.0/src/readers.rs:60 from_reader
export const str_from_reader: FromReader<string> = (reader) => reader.read_string();

/// A generic structure for reading a section of a WebAssembly binary which has
/// a limited number of items within it.
///
/// Many WebAssembly sections are a count of items followed by that many items.
/// This helper structure can be used to parse these sections and provides
/// an iteration-based API for reading the contents.
///
/// Note that this always implements the [`Clone`] trait to represent the
/// ability to parse the section multiple times.
export class SectionLimited<T> {
  constructor(
    readonly T: FromReader<T>,
    readonly reader: BinaryReader,
    readonly count_: number,
  ) {}

  /// Creates a new section reader from the provided contents.
  ///
  /// The `data` provided here is the data of the section itself that will be
  /// parsed. The `offset` argument is the byte offset, in the original wasm
  /// binary, that the section was found. The `offset` argument is used
  /// for error reporting.
  ///
  /// # Errors
  ///
  /// Returns an error if a 32-bit count couldn't be read from the `data`.
  // crate: wasmparser-0.247.0/src/readers.rs:101 new
  static new<T>(T: FromReader<T>, reader: BinaryReader): Result<SectionLimited<T>> {
    const count = reader.read_var_u32();
    if (count.$ === "Err") return count;
    return Ok(new SectionLimited(T, reader, count._0));
  }

  /// Returns the count of total items within this section.
  // crate: wasmparser-0.247.0/src/readers.rs:111 count
  count(): number {
    return this.count_;
  }

  /// Returns whether the original byte offset of this section.
  // crate: wasmparser-0.247.0/src/readers.rs:116 original_position
  original_position(): number {
    return this.reader.original_position();
  }

  /// Returns the range, as byte offsets, of this section within the original
  /// wasm binary.
  // crate: wasmparser-0.247.0/src/readers.rs:122 range
  range(): [number, number] {
    return this.reader.range();
  }

  // crate: wasmparser-0.247.0/src/readers.rs:139 clone
  clone(): SectionLimited<T> {
    return new SectionLimited(this.T, this.reader.clone(), this.count_);
  }

  // crate: wasmparser-0.247.0/src/readers.rs:164 into_iter
  into_iter(): SectionLimitedIntoIter<T> {
    return new SectionLimitedIntoIter(this, this.count_, false);
  }

  [Symbol.iterator](): Iterator<Result<T>> {
    return this.into_iter()[Symbol.iterator]();
  }
}

/// A consuming iterator of a [`SectionLimited`].
///
/// This is created via the [`IntoIterator`] `impl` for the [`SectionLimited`]
/// type.
export class SectionLimitedIntoIter<T> {
  constructor(
    readonly section: SectionLimited<T>,
    public remaining: number,
    public end: boolean,
  ) {}

  /// Returns the current byte offset of the section within this iterator.
  // crate: wasmparser-0.247.0/src/readers.rs:185 original_position
  original_position(): number {
    return this.section.reader.original_position();
  }

  // crate: wasmparser-0.247.0/src/readers.rs:196 next
  next(): Result<T> | undefined {
    if (this.end) {
      return undefined;
    }
    if (this.remaining === 0) {
      this.end = true;
      if (this.section.reader.eof()) {
        return undefined;
      }
      return Err(
        BinaryReaderError.new("section size mismatch: unexpected data at the end of the section", this.section.reader.original_position()),
      );
    }
    const result = this.section.reader.read(this.section.T);
    this.end = result.$ === "Err";
    this.remaining -= 1;
    return result;
  }

  *[Symbol.iterator](): IterableIterator<Result<T>> {
    for (;;) {
      const r = this.next();
      if (r === undefined) return;
      yield r;
    }
  }
}

/// A trait implemented for subsections of another outer section.
///
/// This is currently only used for subsections within custom sections, such as
/// the `name` section of core wasm.
///
/// This is used in conjunction with [`Subsections`].
/// PORT: the trait is its `from_reader` function value.
export type Subsection<T> = (id: number, reader: BinaryReader) => Result<T>;

/// Iterator/reader over the contents of a section which is composed of
/// subsections.
///
/// This reader is used for the core `name` section, for example. This type
/// primarily implements [`Iterator`] for advancing through the sections.
export class Subsections<T> {
  constructor(
    readonly T: Subsection<T>,
    readonly reader: BinaryReader,
  ) {}

  /// Creates a new reader for the specified section contents starting at
  /// `offset` within the original wasm file.
  // crate: wasmparser-0.247.0/src/readers.rs:272 new
  static new<T>(T: Subsection<T>, reader: BinaryReader): Subsections<T> {
    return new Subsections(T, reader);
  }

  /// Returns whether the original byte offset of this section.
  // crate: wasmparser-0.247.0/src/readers.rs:280 original_position
  original_position(): number {
    return this.reader.original_position();
  }

  /// Returns the range, as byte offsets, of this section within the original
  /// wasm binary.
  // crate: wasmparser-0.247.0/src/readers.rs:286 range
  range(): [number, number] {
    return this.reader.range();
  }

  // crate: wasmparser-0.247.0/src/readers.rs:290 read
  read(): Result<T> {
    const id = this.reader.read_u7();
    if (id.$ === "Err") return id;
    const reader = this.reader.read_reader();
    if (reader.$ === "Err") return reader;
    return this.T(id._0, reader._0);
  }

  // crate: wasmparser-0.247.0/src/readers.rs:301 clone
  clone(): Subsections<T> {
    return new Subsections(this.T, this.reader.clone());
  }

  // crate: wasmparser-0.247.0/src/readers.rs:323 next
  next(): Result<T> | undefined {
    if (this.reader.eof()) {
      return undefined;
    } else {
      return this.read();
    }
  }

  *[Symbol.iterator](): IterableIterator<Result<T>> {
    for (;;) {
      const r = this.next();
      if (r === undefined) return;
      yield r;
    }
  }
}
