// Port of wasmparser 0.247.0 `src/parser.rs` (the incremental parser: header, section dispatch,
// code section entries, `parse_all`).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: features as in binary_reader.ts (`component-model` on, `features` off). Component
// sections are only reachable after a component header, which object's Wasm reader rejects
// right after the `Version` payload; their arms call `unported(...)`. The module section readers
// are `SectionLimited`s whose item readers (`RecGroup`, `Imports`, `MemoryType`, ...) are not
// ported except `u32` (function and start/data-count sections).
// PORT: `max_size: u64` is a `number`; `u64::MAX` rounds to 2^64, and subtracting section sizes
// (< 2^32) from it never goes negative, so the overflow checks behave as upstream's.
// `Range<usize>` is `[start, end]`.

import { panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { BinaryReader, BinaryReaderError, bytes_eq, type FromReader, type Result, WASM_MAGIC_NUMBER } from "./binary_reader.ts";
import { SectionLimited, u32_from_reader } from "./readers.ts";
import { FunctionBody } from "./readers/core/code.ts";
import { CustomSectionReader } from "./readers/core/custom.ts";

export const WASM_MODULE_VERSION = 0x1;

// Note that this started at `0xa` and we're incrementing up from there. When
// the component model is stabilized this will become 0x1. The changes here are:
//
// * [????-??-??] 0xa - original version
// * [2023-01-05] 0xb - `export` introduces an alias
// * [2023-02-06] 0xc - `export` has an optional type ascribed to it
// * [2023-05-10] 0xd - imports/exports drop URLs, new discriminator byte which
//                      allows for `(import (interface "...") ...)` syntax.
export const WASM_COMPONENT_VERSION = 0xd;

const KIND_MODULE = 0x00;
const KIND_COMPONENT = 0x01;

/// The supported encoding formats for the parser.
export type Encoding =
  /// The encoding format is a WebAssembly module.
  | "Module"
  /// The encoding format is a WebAssembly component.
  | "Component";

interface ParserCounts {
  function_entries: number | undefined;
  code_entries: number | undefined;
  data_entries: number | undefined;
  data_count: number | undefined;
  component_start_sections: boolean;
}

// Section order for WebAssembly modules.
//
// Component sections are unordered and allow for duplicates,
// so this isn't used for components.
export const Order = {
  Initial: 0,
  Type: 1,
  Import: 2,
  Function: 3,
  Table: 4,
  Memory: 5,
  Tag: 6,
  Global: 7,
  Export: 8,
  Start: 9,
  Element: 10,
  DataCount: 11,
  Code: 12,
  Data: 13,
} as const;
/** PORT: `Order` as its discriminant (it derives `Ord`). */
export type Order = (typeof Order)[keyof typeof Order];

type State = { $: "Header" } | { $: "SectionStart" } | { $: "FunctionBody"; remaining: number; len: number };

/// A successful return payload from [`Parser::parse`].
///
/// On success one of two possible values can be returned, either that more data
/// is needed to continue parsing or a chunk of the input was parsed, indicating
/// how much of it was parsed.
export type Chunk =
  /// This can be returned at any time and indicates that more data is needed
  /// to proceed with parsing. Zero bytes were consumed from the input to
  /// [`Parser::parse`]. The `u64` value here is a hint as to how many more
  /// bytes are needed to continue parsing.
  | { $: "NeedMoreData"; _0: number }
  /// A chunk was successfully parsed.
  | {
      $: "Parsed";
      /// This many bytes of the `data` input to [`Parser::parse`] were
      /// consumed to produce `payload`.
      consumed: number;
      /// The value that we actually parsed.
      payload: Payload;
    };

/** A module section reader whose items are not ported (see the header). */
export type SectionReader = SectionLimited<never>;

/// Values that can be parsed from a WebAssembly module or component.
///
/// (See upstream for the full documentation of each variant.)
export type Payload =
  /// Indicates the header of a WebAssembly module or component.
  | { $: "Version"; num: number; encoding: Encoding; range: [number, number] }
  /// A module type section was received and the provided reader can be
  /// used to parse the contents of the type section.
  | { $: "TypeSection"; _0: SectionReader }
  /// A module import section was received and the provided reader can be
  /// used to parse the contents of the import section.
  | { $: "ImportSection"; _0: SectionReader }
  /// A module function section was received and the provided reader can be
  /// used to parse the contents of the function section.
  | { $: "FunctionSection"; _0: SectionLimited<number> }
  /// A module table section was received and the provided reader can be
  /// used to parse the contents of the table section.
  | { $: "TableSection"; _0: SectionReader }
  /// A module memory section was received and the provided reader can be
  /// used to parse the contents of the memory section.
  | { $: "MemorySection"; _0: SectionReader }
  /// A module tag section was received, and the provided reader can be
  /// used to parse the contents of the tag section.
  | { $: "TagSection"; _0: SectionReader }
  /// A module global section was received and the provided reader can be
  /// used to parse the contents of the global section.
  | { $: "GlobalSection"; _0: SectionReader }
  /// A module export section was received, and the provided reader can be
  /// used to parse the contents of the export section.
  | { $: "ExportSection"; _0: SectionReader }
  /// A module start section was received.
  | { $: "StartSection"; func: number; range: [number, number] }
  /// A module element section was received and the provided reader can be
  /// used to parse the contents of the element section.
  | { $: "ElementSection"; _0: SectionReader }
  /// A module data count section was received.
  | { $: "DataCountSection"; count: number; range: [number, number] }
  /// A module data section was received and the provided reader can be
  /// used to parse the contents of the data section.
  | { $: "DataSection"; _0: SectionReader }
  /// Indicator of the start of the code section of a WebAssembly module.
  | { $: "CodeSectionStart"; count: number; range: [number, number]; size: number }
  /// An entry of the code section, a function, was parsed from a WebAssembly
  /// module.
  | { $: "CodeSectionEntry"; _0: FunctionBody }
  /// A module or component custom section was received.
  | { $: "CustomSection"; _0: CustomSectionReader }
  /// An unknown section was found.
  | { $: "UnknownSection"; id: number; contents: Uint8Array; range: [number, number] }
  /// The end of the WebAssembly module or component was reached.
  ///
  /// The value is the offset in the input byte stream where the end
  /// was reached.
  | { $: "End"; _0: number };
// PORT: the `component-model` variants (`ModuleSection`, `ComponentSection`, ...) are never
// constructed (their parser arms are unported).

const CUSTOM_SECTION = 0; // (matched as the literal `0` below, as upstream)
const TYPE_SECTION = 1;
const IMPORT_SECTION = 2;
const FUNCTION_SECTION = 3;
const TABLE_SECTION = 4;
const MEMORY_SECTION = 5;
const GLOBAL_SECTION = 6;
const EXPORT_SECTION = 7;
const START_SECTION = 8;
const ELEMENT_SECTION = 9;
const CODE_SECTION = 10;
const DATA_SECTION = 11;
const DATA_COUNT_SECTION = 12;
const TAG_SECTION = 13;

/** The item readers of the module sections (not ported: see the header). */
const unported_item =
  (what: string): FromReader<never> =>
  () =>
    unported(`wasmparser::${what}::from_reader`);

/** `u64::MAX` as a `number` (see the header). */
const U64_MAX = 2 ** 64 - 1;

/// An incremental parser of a binary WebAssembly module or component.
///
/// This type is intended to be used to incrementally parse a WebAssembly module
/// or component as bytes become available for the module. This can also be used
/// to parse modules or components that are already entirely resident within memory.
///
/// This primary function for a parser is the [`Parser::parse`] function which
/// will incrementally consume input. You can also use the [`Parser::parse_all`]
/// function to parse a module or component that is entirely resident in memory.
export class Parser {
  constructor(
    public state: State,
    public offset_: number,
    public max_size: number,
    public encoding: Encoding,
    public counts: ParserCounts,
    public order: [Order, number],
  ) {}

  /// Creates a new parser.
  ///
  /// Reports errors and ranges relative to `offset` provided, where `offset`
  /// is some logical offset within the input stream that we're parsing.
  // crate: wasmparser-0.247.0/src/parser.rs:402 new
  static new(offset: number): Parser {
    return new Parser(
      { $: "Header" },
      offset,
      U64_MAX,
      // Assume the encoding is a module until we know otherwise
      "Module",
      {
        function_entries: undefined,
        code_entries: undefined,
        data_entries: undefined,
        data_count: undefined,
        component_start_sections: false,
      },
      [Order.Initial, offset],
    );
  }

  /// Returns the original offset that this parser is currently at.
  // crate: wasmparser-0.247.0/src/parser.rs:474 offset
  offset(): number {
    return this.offset_;
  }

  /// Attempts to parse a chunk of data.
  ///
  /// This method will attempt to parse the next incremental portion of a
  /// WebAssembly binary. Data available for the module or component is
  /// provided as `data`, and the data can be incomplete if more data has yet
  /// to arrive. The `eof` flag indicates whether more data will ever be received.
  // crate: wasmparser-0.247.0/src/parser.rs:623 parse
  parse(data_: Uint8Array, eof_: boolean): Result<Chunk> {
    let data = data_;
    let eof = eof_;
    if (usize_to_u64(data.length) > this.max_size) {
      data = data.subarray(0, this.max_size);
      eof = true;
    }
    // TODO: thread through `offset: u64` to `BinaryReader`, remove
    // the cast here.
    const starting_offset = this.offset_;
    const reader = BinaryReader.new(data, starting_offset);
    const r = this.parse_reader(reader, eof);
    if (r.$ === "Ok") {
      const payload = r._0;
      // Be sure to update our offset with how far we got in the
      // reader
      const consumed = reader.original_position() - starting_offset;
      this.offset_ += usize_to_u64(consumed);
      this.max_size -= usize_to_u64(consumed);
      return Ok({ $: "Parsed", consumed, payload });
    } else {
      const e = r._0;
      // If we're at EOF then there's no way we can recover from any
      // error, so continue to propagate it.
      if (eof) {
        return Err(e);
      }

      // If our error doesn't look like it can be resolved with more
      // data being pulled down, then propagate it, otherwise switch
      // the error to "feed me please"
      const hint = e.inner.needed_hint;
      if (hint !== undefined) {
        return Ok({ $: "NeedMoreData", _0: usize_to_u64(hint) });
      } else {
        return Err(e);
      }
    }
  }

  // crate: wasmparser-0.247.0/src/parser.rs:667 update_order
  update_order(order: Order, pos: number): Result<undefined> {
    const pos_u64 = usize_to_u64(pos);
    if (this.encoding === "Module") {
      const [last_order, last_pos] = this.order;
      if (last_order >= order && last_pos < pos_u64) {
        return Err(BinaryReaderError.fmt("section out of order", pos));
      }
    }

    this.order = [order, pos_u64];

    return Ok(undefined);
  }

  // crate: wasmparser-0.247.0/src/parser.rs:683 parse_reader
  parse_reader(reader: BinaryReader, eof: boolean): Result<Payload> {
    const state = this.state;
    switch (state.$) {
      case "Header": {
        const start = reader.original_position();
        const hv = reader.read_header_version();
        if (hv.$ === "Err") return hv;
        const header_version = hv._0;
        const num = header_version & 0xffff;
        const kind = header_version >>> 16;
        if (num === WASM_MODULE_VERSION && kind === KIND_MODULE) {
          this.encoding = "Module";
        } else if (num === WASM_COMPONENT_VERSION && kind === KIND_COMPONENT) {
          this.encoding = "Component";
        } else {
          return Err(BinaryReaderError.fmt(`unknown binary version: ${format_hex_10(header_version)}`, start + 4));
        }
        this.state = { $: "SectionStart" };
        return Ok({ $: "Version", num, encoding: this.encoding, range: [start, reader.original_position()] });
      }
      case "SectionStart": {
        // If we're at eof and there are no bytes in our buffer, then
        // that means we reached the end of the data since it's
        // just a bunch of sections concatenated after the header.
        if (eof && reader.bytes_remaining() === 0) {
          const c1 = this.check_function_code_counts(reader.original_position());
          if (c1.$ === "Err") return c1;
          const c2 = this.check_data_count(reader.original_position());
          if (c2.$ === "Err") return c2;
          return Ok({ $: "End", _0: reader.original_position() });
        }

        // Corrupted binaries containing multiple modules or
        // components will fail because a section can never start with
        // the magic number: 0 is custom section, 'a' is section len
        // of 97, `s` is section name string len of 115, at which
        // point validation will fail because name string is bigger
        // than section. Report a better error instead:
        const peek = reader.peek_bytes(4);
        if (peek.$ === "Ok" && bytes_eq(peek._0, WASM_MAGIC_NUMBER)) {
          return Err(BinaryReaderError.new("expected section, got wasm magic number", reader.original_position()));
        }

        const id_pos = reader.original_position();
        const id_r = reader.read_u8();
        if (id_r.$ === "Err") return id_r;
        const id = id_r._0;
        if ((id & 0x80) !== 0) {
          return Err(BinaryReaderError.new("malformed section id", id_pos));
        }
        const len_pos = reader.original_position();
        const len_r = reader.read_var_u32();
        if (len_r.$ === "Err") return len_r;
        const len = { value: len_r._0 };

        // Test to make sure that this section actually fits within
        // `Parser::max_size`. This doesn't matter for top-level modules
        // but it is required for nested modules/components to correctly ensure
        // that all sections live entirely within their section of the
        // file.
        const consumed = reader.original_position() - id_pos;
        const section_overflow = this.max_size - usize_to_u64(consumed) < 0 || this.max_size - usize_to_u64(consumed) - len.value < 0;
        if (section_overflow) {
          return Err(BinaryReaderError.new("section too large", len_pos));
        }

        if (id === 0) {
          // Custom sections for both modules and components.
          return section(reader, len.value, CustomSectionReader.new, (s) => ({ $: "CustomSection", _0: s }));
        }
        if (this.encoding === "Module") {
          // Module sections
          switch (id) {
            case TYPE_SECTION: {
              const o = this.update_order(Order.Type, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("RecGroup")), (s) => ({ $: "TypeSection", _0: s }));
            }
            case IMPORT_SECTION: {
              const o = this.update_order(Order.Import, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("Imports")), (s) => ({ $: "ImportSection", _0: s }));
            }
            case FUNCTION_SECTION: {
              const o = this.update_order(Order.Function, reader.original_position());
              if (o.$ === "Err") return o;
              const s = section(reader, len.value, limited(u32_from_reader), (s) => ({ $: "FunctionSection", _0: s }) as Payload);
              if (s.$ === "Err") return s;
              if (s._0.$ === "FunctionSection") {
                this.counts.function_entries = s._0._0.count();
              } else {
                unreachable();
              }
              return s;
            }
            case TABLE_SECTION: {
              const o = this.update_order(Order.Table, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("Table")), (s) => ({ $: "TableSection", _0: s }));
            }
            case MEMORY_SECTION: {
              const o = this.update_order(Order.Memory, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("MemoryType")), (s) => ({ $: "MemorySection", _0: s }));
            }
            case GLOBAL_SECTION: {
              const o = this.update_order(Order.Global, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("Global")), (s) => ({ $: "GlobalSection", _0: s }));
            }
            case EXPORT_SECTION: {
              const o = this.update_order(Order.Export, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("Export")), (s) => ({ $: "ExportSection", _0: s }));
            }
            case START_SECTION: {
              const o = this.update_order(Order.Start, reader.original_position());
              if (o.$ === "Err") return o;
              const r = single_item(reader, len.value, u32_from_reader, "start");
              if (r.$ === "Err") return r;
              const [func, range] = r._0;
              return Ok({ $: "StartSection", func, range });
            }
            case ELEMENT_SECTION: {
              const o = this.update_order(Order.Element, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("Element")), (s) => ({ $: "ElementSection", _0: s }));
            }
            case CODE_SECTION: {
              const o = this.update_order(Order.Code, reader.original_position());
              if (o.$ === "Err") return o;
              const start = reader.original_position();
              const c = delimited(reader, len, (r) => r.read_var_u32());
              if (c.$ === "Err") return c;
              const count = c._0;
              this.counts.code_entries = count;
              const cc = this.check_function_code_counts(start);
              if (cc.$ === "Err") return cc;
              const range: [number, number] = [start, reader.original_position() + len.value];
              this.state = { $: "FunctionBody", remaining: count, len: len.value };
              return Ok({ $: "CodeSectionStart", count, range, size: len.value });
            }
            case DATA_SECTION: {
              const o = this.update_order(Order.Data, reader.original_position());
              if (o.$ === "Err") return o;
              const s = section(reader, len.value, limited(unported_item("Data")), (s) => ({ $: "DataSection", _0: s }) as Payload);
              if (s.$ === "Err") return s;
              if (s._0.$ === "DataSection") {
                this.counts.data_entries = s._0._0.count();
              } else {
                unreachable();
              }
              const cd = this.check_data_count(reader.original_position());
              if (cd.$ === "Err") return cd;
              return s;
            }
            case DATA_COUNT_SECTION: {
              const o = this.update_order(Order.DataCount, reader.original_position());
              if (o.$ === "Err") return o;
              const r = single_item(reader, len.value, u32_from_reader, "data count");
              if (r.$ === "Err") return r;
              const [count, range] = r._0;
              this.counts.data_count = count;
              return Ok({ $: "DataCountSection", count, range });
            }
            case TAG_SECTION: {
              const o = this.update_order(Order.Tag, reader.original_position());
              if (o.$ === "Err") return o;
              return section(reader, len.value, limited(unported_item("TagType")), (s) => ({ $: "TagSection", _0: s }));
            }
          }
        } else if (id >= 1 && id <= 11) {
          // Component sections
          return unported("wasmparser::Parser::parse_reader (component sections)");
        }
        {
          const offset = reader.original_position();
          const contents = reader.read_bytes(len.value);
          if (contents.$ === "Err") return contents;
          const range: [number, number] = [offset, offset + len.value];
          return Ok({ $: "UnknownSection", id, contents: contents._0, range });
        }
      }
      case "FunctionBody": {
        // Once we hit 0 remaining incrementally parsed items, with 0
        // remaining bytes in each section, we're done and can switch back
        // to parsing sections.
        if (state.remaining === 0 && state.len === 0) {
          this.state = { $: "SectionStart" };
          return this.parse_reader(reader, eof);
        }

        // ... otherwise trailing bytes with no remaining entries in these
        // sections indicates an error.
        if (state.remaining === 0) {
          // debug_assert!(len > 0);
          const offset = reader.original_position();
          return Err(BinaryReaderError.new("trailing bytes at end of section", offset));
        }

        // Functions are relatively easy to parse when we know there's at
        // least one remaining and at least one byte available to read
        // things.
        //
        // We use the remaining length try to read a u32 size of the
        // function, and using that size we require the entire function be
        // resident in memory. This means that we're reading whole chunks of
        // functions at a time.
        //
        // Limiting via `Parser::max_size` (nested parsing) happens above in
        // `fn parse`, and limiting by our section size happens via
        // `delimited`. Actual parsing of the function body is delegated to
        // the caller to iterate over the `FunctionBody` structure.
        const len = { value: state.len };
        const body = delimited(reader, len, (r) => {
          const rr = r.read_reader();
          if (rr.$ === "Err") return rr;
          return Ok(FunctionBody.new(rr._0));
        });
        if (body.$ === "Err") return body;
        this.state = { $: "FunctionBody", remaining: state.remaining - 1, len: len.value };
        return Ok({ $: "CodeSectionEntry", _0: body._0 });
      }
    }
  }

  /// Convenience function that can be used to parse a module or component
  /// that is entirely resident in memory.
  ///
  /// This function will parse the `data` provided as a WebAssembly module
  /// or component.
  ///
  /// Note that when this function yields sections that provide parsers,
  /// no further action is required for those sections as payloads from
  /// those parsers will be automatically returned.
  // crate: wasmparser-0.247.0/src/parser.rs:1086 parse_all
  *parse_all(data_: Uint8Array): IterableIterator<Result<Payload>> {
    let data = data_;
    const stack: Parser[] = [];
    let cur: Parser = this;
    let done = false;
    for (;;) {
      if (done) {
        return;
      }
      const r = cur.parse(data, true);
      let payload: Payload;
      if (r.$ === "Err") {
        // Propagate all errors
        done = true;
        yield r;
        continue;
      }
      const chunk = r._0;
      if (chunk.$ === "NeedMoreData") {
        // This isn't possible because `eof` is always true.
        unreachable();
      } else {
        data = data.subarray(chunk.consumed);
        payload = chunk.payload;
      }

      if (payload.$ === "End") {
        const p = stack.pop();
        if (p !== undefined) {
          cur = p;
        } else {
          done = true;
        }
      }

      yield Ok(payload);
    }
  }

  /// Skip parsing the code section entirely.
  ///
  /// This function can be used to indicate, after receiving
  /// `CodeSectionStart`, that the section will not be parsed.
  ///
  /// The caller will be responsible for skipping `size` bytes (found in the
  /// `CodeSectionStart` payload). Bytes should only be fed into `parse`
  /// after the `size` bytes have been skipped.
  ///
  /// # Panics
  ///
  /// This function will panic if the parser is not in a state where it's
  /// parsing the code section.
  // crate: wasmparser-0.247.0/src/parser.rs:1183 skip_section
  skip_section(): void {
    const state = this.state;
    if (state.$ !== "FunctionBody") return panic("wrong state to call `skip_section`");
    const skip = state.len;
    this.offset_ += skip;
    this.max_size -= skip;
    this.state = { $: "SectionStart" };
  }

  // crate: wasmparser-0.247.0/src/parser.rs:1193 check_function_code_counts
  check_function_code_counts(pos: number): Result<undefined> {
    const n = this.counts.function_entries;
    const m = this.counts.code_entries;
    if (n !== undefined && m !== undefined && n !== m) {
      return Err(BinaryReaderError.fmt("function and code section have inconsistent lengths", pos));
    } else if (n !== undefined && m === undefined && n > 0) {
      return Err(BinaryReaderError.fmt("function section has non-zero count but code section is absent", pos));
    } else if (n === undefined && m !== undefined && m > 0) {
      return Err(BinaryReaderError.fmt("function section is absent but code section has non-zero count", pos));
    } else {
      return Ok(undefined);
    }
  }

  // crate: wasmparser-0.247.0/src/parser.rs:1210 check_data_count
  check_data_count(pos: number): Result<undefined> {
    const n = this.counts.data_count;
    const m = this.counts.data_entries;
    if (n !== undefined && m !== undefined && n !== m) {
      return Err(BinaryReaderError.fmt("data count and data section have inconsistent lengths", pos));
    } else if (n !== undefined && m === undefined && n > 0) {
      return Err(BinaryReaderError.fmt("data count is non-zero but data section is absent", pos));
    } else {
      return Ok(undefined);
    }
  }

  // crate: wasmparser-0.247.0/src/parser.rs:1299 default
  static default(): Parser {
    return Parser.new(0);
  }
}

/** `format!("{header_version:#10x}")`: `0x`-prefixed hex, right-aligned in width 10. */
function format_hex_10(n: number): string {
  return `0x${n.toString(16)}`.padStart(10, " ");
}

/** `SectionLimited::new` for an item type: a section reader constructor. */
function limited<T>(T: FromReader<T>): (reader: BinaryReader) => Result<SectionLimited<T>> {
  return (reader) => SectionLimited.new(T, reader);
}

// crate: wasmparser-0.247.0/src/parser.rs:1223 usize_to_u64
function usize_to_u64(a: number): number {
  return a;
}

/// Parses an entire section resident in memory into a `Payload`.
///
/// Requires that `len` bytes are resident in `reader` and uses `ctor`/`variant`
/// to construct the section to return.
// crate: wasmparser-0.247.0/src/parser.rs:1231 section
function section<T>(reader_: BinaryReader, len: number, ctor: (reader: BinaryReader) => Result<T>, variant: (t: T) => Payload): Result<Payload> {
  const reader = reader_.skip((r) => {
    const b = r.read_bytes(len);
    if (b.$ === "Err") return b;
    return Ok(undefined);
  });
  if (reader.$ === "Err") return reader;
  // clear the hint for "need this many more bytes" here because we already
  // read all the bytes, so it's not possible to read more bytes if this
  // fails.
  const t = ctor(reader._0);
  if (t.$ === "Err") return Err(clear_hint(t._0));
  return Ok(variant(t._0));
}

/// Reads a section that is represented by a single uleb-encoded `u32`.
// crate: wasmparser-0.247.0/src/parser.rs:1249 single_item
function single_item<T>(reader: BinaryReader, len: number, T: FromReader<T>, desc: string): Result<[T, [number, number]]> {
  const range: [number, number] = [reader.original_position(), reader.original_position() + len];
  const c = reader.skip((r) => {
    const b = r.read_bytes(len);
    if (b.$ === "Err") return b;
    return Ok(undefined);
  });
  if (c.$ === "Err") return c;
  const content = c._0;
  // We can't recover from "unexpected eof" here because our entire section is
  // already resident in memory, so clear the hint for how many more bytes are
  // expected.
  const ret = content.read(T);
  if (ret.$ === "Err") return Err(clear_hint(ret._0));
  if (!content.eof()) {
    return Err(BinaryReaderError.fmt(`unexpected content in the ${desc} section`, content.original_position()));
  }
  return Ok([ret._0, range]);
}

/// Attempts to parse using `f`.
///
/// This will update `*len` with the number of bytes consumed, and it will cause
/// a failure to be returned instead of the number of bytes consumed exceeds
/// what `*len` currently is.
// crate: wasmparser-0.247.0/src/parser.rs:1280 delimited
function delimited<T>(reader: BinaryReader, len: { value: number }, f: (reader: BinaryReader) => Result<T>): Result<T> {
  const start = reader.original_position();
  const ret = f(reader);
  if (ret.$ === "Err") return ret;
  const used = reader.original_position() - start;
  // `.try_into().ok().and_then(|i| len.checked_sub(i))`
  if (used > 0xffff_ffff || used > len.value) {
    return Err(BinaryReaderError.new("unexpected end-of-file", start));
  }
  len.value = len.value - used;
  return ret;
}

// crate: wasmparser-0.247.0/src/parser.rs:1488 clear_hint
function clear_hint(err: BinaryReaderError): BinaryReaderError {
  err.inner.needed_hint = undefined;
  return err;
}
