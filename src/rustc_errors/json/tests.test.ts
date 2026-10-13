// Port of compiler/rustc_errors/src/json/tests.rs
//
// PORT: `#[derive(Deserialize)] TestData` + `serde_json::from_str` -> `JSON.parse` of the emitted
// line, keeping only the `SpanTestData` fields (`Deserialize` ignores unknown fields).
import { expect, test } from "bun:test";
import { type FmtArguments, VecU8, type Write, Write_default } from "../../vendor/anstream/stream.ts";
import type { IoResult } from "../../std/io.ts";
import { BytePos, type FileName, Span, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { Str } from "../../std/str.ts";
import { HumanReadableErrorType } from "../emitter.ts";
import { JsonEmitter } from "../json.ts";
import { DiagCtxt } from "../lib.ts";

// #[derive(Deserialize, Debug, PartialEq, Eq)]
interface TestData {
  spans: SpanTestData[];
}

// #[derive(Deserialize, Debug, PartialEq, Eq)]
interface SpanTestData {
  byte_start: number;
  byte_end: number;
  line_start: number;
  column_start: number;
  line_end: number;
  column_end: number;
}

// PORT: `Shared<T> { data: Arc<Mutex<T>> }` -> `Shared { data: VecU8 }` (the one `T` used); clones
// of the `Arc` are the same `VecU8` object.
class Shared implements Write {
  constructor(public data: VecU8) {}

  // rustc: compiler/rustc_errors/src/json/tests.rs:30 write
  write(buf: Uint8Array): IoResult<number> {
    return this.data.write(buf);
  }

  // rustc: compiler/rustc_errors/src/json/tests.rs:34 flush
  flush(): IoResult<void> {
    return this.data.flush();
  }

  /** `std::io::Write` provided method. */
  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }

  /** `std::io::Write` provided method. */
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }
}

// rustc: compiler/rustc_errors/src/json/tests.rs:39 filename
function filename(sm: SourceMap, path: string): FileName {
  return { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
}

/// Test the span yields correct positions in JSON.
// rustc: compiler/rustc_errors/src/json/tests.rs:44 test_positions
function test_positions(code: string, span: [number, number], expected_output: SpanTestData): void {
  create_default_session_globals_then(() => {
    const sm = SourceMap.new(FilePathMapping.empty());
    sm.new_source_file(filename(sm, "test.rs"), Str.from(code));

    const output = new VecU8();
    const je = JsonEmitter.new(
      new Shared(output),
      sm,
      true, // pretty
      new HumanReadableErrorType(true, false),
      "Never",
    );

    const sp = Span.with_root_ctxt(BytePos(span[0]), BytePos(span[1]));
    DiagCtxt.new(je).handle().span_err(sp, "foo");

    const actual_output_ = new TextDecoder("utf-8", { fatal: true }).decode(output.bytes());
    const actual_output = JSON.parse(actual_output_) as TestData;
    const spans = actual_output.spans;
    expect(spans.length).toBe(1);

    const s = spans[0]!;
    expect({
      byte_start: s.byte_start,
      byte_end: s.byte_end,
      line_start: s.line_start,
      column_start: s.column_start,
      line_end: s.line_end,
      column_end: s.column_end,
    }).toEqual(expected_output);
  });
}

// rustc: compiler/rustc_errors/src/json/tests.rs:72 empty
test("empty", () => {
  test_positions(" ", [0, 1], {
    byte_start: 0,
    byte_end: 1,
    line_start: 1,
    column_start: 1,
    line_end: 1,
    column_end: 2,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:88 bom
test("bom", () => {
  test_positions("\u{feff} ", [0, 1], {
    byte_start: 3,
    byte_end: 4,
    line_start: 1,
    column_start: 1,
    line_end: 1,
    column_end: 2,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:104 lf_newlines
test("lf_newlines", () => {
  test_positions("\nmod foo;\nmod bar;\n", [5, 12], {
    byte_start: 5,
    byte_end: 12,
    line_start: 2,
    column_start: 5,
    line_end: 3,
    column_end: 3,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:120 crlf_newlines
test("crlf_newlines", () => {
  test_positions("\r\nmod foo;\r\nmod bar;\r\n", [5, 12], {
    byte_start: 6,
    byte_end: 14,
    line_start: 2,
    column_start: 5,
    line_end: 3,
    column_end: 3,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:136 crlf_newlines_with_bom
test("crlf_newlines_with_bom", () => {
  test_positions("\u{feff}\r\nmod foo;\r\nmod bar;\r\n", [5, 12], {
    byte_start: 9,
    byte_end: 17,
    line_start: 2,
    column_start: 5,
    line_end: 3,
    column_end: 3,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:152 span_before_crlf
test("span_before_crlf", () => {
  test_positions("foo\r\nbar", [2, 3], {
    byte_start: 2,
    byte_end: 3,
    line_start: 1,
    column_start: 3,
    line_end: 1,
    column_end: 4,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:168 span_on_crlf
test("span_on_crlf", () => {
  test_positions("foo\r\nbar", [3, 4], {
    byte_start: 3,
    byte_end: 5,
    line_start: 1,
    column_start: 4,
    line_end: 2,
    column_end: 1,
  });
});

// rustc: compiler/rustc_errors/src/json/tests.rs:184 span_after_crlf
test("span_after_crlf", () => {
  test_positions("foo\r\nbar", [4, 5], {
    byte_start: 5,
    byte_end: 6,
    line_start: 2,
    column_start: 1,
    line_end: 2,
    column_end: 2,
  });
});
