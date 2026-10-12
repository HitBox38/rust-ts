// Port of compiler/rustc_span/src/tests.rs
import { expect, test } from "bun:test";
import { debug_int, PLAIN, PRETTY } from "../std/fmt.ts";
import { unwrap_result } from "../std/result.ts";
import { Str } from "../std/str.ts";
import {
  AttrId,
  BytePos,
  debug_AttrId,
  debug_BytePos,
  debug_ErrorGuaranteed,
  debug_Spanned,
  dummy_spanned,
  ErrorGuaranteed,
  debug_Span,
  DUMMY_SP,
  create_default_session_globals_then,
  normalize_newlines,
  RelativeBytePos,
  SourceFile,
  Span,
  type NormalizedPos,
} from "./lib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { debug_LocalExpnId, LocalExpnId, SyntaxContext } from "./hygiene.ts";
import { debug_Edition, Edition } from "./edition.ts";
import { ByteSymbol, debug_ByteSymbol, debug_Ident, debug_Symbol, Ident, Symbol } from "./symbol.ts";

// rustc: compiler/rustc_span/src/tests.rs:4 test_lookup_line
test("test_lookup_line", () => {
  const source = Str.from("abcdefghijklm\nabcdefghij\n...");
  const sf = unwrap_result(SourceFile.new({ $: "Anon", _0: Hash64.ZERO }, source, "Sha256", "Sha256"));
  sf.start_pos = BytePos(3);
  expect(sf.lines()).toEqual([RelativeBytePos(0), RelativeBytePos(14), RelativeBytePos(25)]);

  expect(sf.lookup_line(RelativeBytePos(0))).toBe(0);
  expect(sf.lookup_line(RelativeBytePos(1))).toBe(0);

  expect(sf.lookup_line(RelativeBytePos(13))).toBe(0);
  expect(sf.lookup_line(RelativeBytePos(14))).toBe(1);
  expect(sf.lookup_line(RelativeBytePos(15))).toBe(1);

  expect(sf.lookup_line(RelativeBytePos(25))).toBe(2);
  expect(sf.lookup_line(RelativeBytePos(26))).toBe(2);
});

// rustc: compiler/rustc_span/src/tests.rs:28 test_normalize_newlines
test("test_normalize_newlines", () => {
  // rustc: compiler/rustc_span/src/tests.rs:29 check
  function check(before: string, after: string, expected_positions: number[]): void {
    const actual_positions_: NormalizedPos[] = [];
    const actual = normalize_newlines(Str.from(before), actual_positions_);
    const actual_positions = actual_positions_.map((nc) => nc.pos as number);
    expect(actual.toString()).toBe(after);
    expect(actual_positions).toEqual(expected_positions);
  }
  check("", "", []);
  check("\n", "\n", []);
  check("\r", "\r", []);
  check("\r\r", "\r\r", []);
  check("\r\n", "\n", [1]);
  check("hello world", "hello world", []);
  check("hello\nworld", "hello\nworld", []);
  check("hello\r\nworld", "hello\nworld", [6]);
  check("\r\nhello\r\nworld\r\n", "\nhello\nworld\n", [1, 7, 13]);
  check("\r\r\n", "\r\n", [2]);
  check("hello\rworld", "hello\rworld", []);
});

// PORT: upstream runs `test_trim` without session globals because its spans are inline-encoded.
// rust-ts interns every non-dummy span (span_encoding.ts), so the test installs session globals.

// rustc: compiler/rustc_span/src/tests.rs:51 test_trim
test("test_trim", () =>
  create_default_session_globals_then(() => {
    const span = (lo: number, hi: number): Span => Span.new(BytePos.from_usize(lo), BytePos.from_usize(hi), SyntaxContext.root(), undefined);

    // Various positions, named for their relation to `start` and `end`.
    const well_before = 1;
    const before = 3;
    const start = 5;
    const mid = 7;
    const end = 9;
    const after = 11;
    const well_after = 13;

    // The resulting span's context should be that of `self`, not `other`.
    const other = Span.with_ctxt(span(start, end), SyntaxContext.from_u32(999));

    // Test cases for `trim_end`.

    expect(Span.trim_end(span(well_before, before), other)).toBe(span(well_before, before));
    expect(Span.trim_end(span(well_before, start), other)).toBe(span(well_before, start));
    expect(Span.trim_end(span(well_before, mid), other)).toBe(span(well_before, start));
    expect(Span.trim_end(span(well_before, end), other)).toBe(span(well_before, start));
    expect(Span.trim_end(span(well_before, after), other)).toBe(span(well_before, start));

    expect(Span.trim_end(span(start, mid), other)).toBeUndefined();
    expect(Span.trim_end(span(start, end), other)).toBeUndefined();
    expect(Span.trim_end(span(start, after), other)).toBeUndefined();

    expect(Span.trim_end(span(mid, end), other)).toBeUndefined();
    expect(Span.trim_end(span(mid, after), other)).toBeUndefined();

    expect(Span.trim_end(span(end, after), other)).toBeUndefined();

    expect(Span.trim_end(span(after, well_after), other)).toBeUndefined();

    // Test cases for `trim_start`.

    expect(Span.trim_start(span(after, well_after), other)).toBe(span(after, well_after));
    expect(Span.trim_start(span(end, well_after), other)).toBe(span(end, well_after));
    expect(Span.trim_start(span(mid, well_after), other)).toBe(span(end, well_after));
    expect(Span.trim_start(span(start, well_after), other)).toBe(span(end, well_after));
    expect(Span.trim_start(span(before, well_after), other)).toBe(span(end, well_after));

    expect(Span.trim_start(span(mid, end), other)).toBeUndefined();
    expect(Span.trim_start(span(start, end), other)).toBeUndefined();
    expect(Span.trim_start(span(before, end), other)).toBeUndefined();

    expect(Span.trim_start(span(start, mid), other)).toBeUndefined();
    expect(Span.trim_start(span(before, mid), other)).toBeUndefined();

    expect(Span.trim_start(span(before, start), other)).toBeUndefined();

    expect(Span.trim_start(span(well_before, before), other)).toBeUndefined();
  }));

// rustc: compiler/rustc_span/src/tests.rs:108 test_unnormalized_source_length
test("test_unnormalized_source_length", () => {
  const source = Str.from("\u{feff}hello\r\nferries\r\n");
  const sf = unwrap_result(SourceFile.new({ $: "Anon", _0: Hash64.ZERO }, source, "Sha256", "Sha256"));
  expect(sf.unnormalized_source_len).toBe(19);
  expect(sf.normalized_source_len as number).toBe(14);
});

// rust-ts only: the representation guarantees of span_encoding.ts (see its PORT block).
test("rust-ts: dummy span and span equality", () => {
  // Upstream's inline `DUMMY_SP` works without session globals; so does ours.
  expect(Span.is_dummy(DUMMY_SP)).toBe(true);
  expect(Span.new(BytePos(0), BytePos(0), SyntaxContext.root(), undefined)).toBe(DUMMY_SP);
  expect(debug_Span(DUMMY_SP, PLAIN)).toBe("Span { lo: BytePos(0), hi: BytePos(0), ctxt: #0 }");
  create_default_session_globals_then(() => {
    const a = Span.new(BytePos(9), BytePos(4), SyntaxContext.root(), undefined);
    expect(Span.lo_hi(a)).toEqual([BytePos(4), BytePos(9)]);
    expect(Span.with_root_ctxt(BytePos(4), BytePos(9))).toBe(a);
    expect(Span.to(a, Span.with_root_ctxt(BytePos(12), BytePos(20)))).toBe(Span.with_root_ctxt(BytePos(4), BytePos(20)));
    expect(Span.ctxt(Span.with_ctxt(a, SyntaxContext.from_u32(7)))).toBe(SyntaxContext.from_u32(7));
    expect(debug_Span(a, PLAIN)).toBe("Span { lo: BytePos(4), hi: BytePos(9), ctxt: #0 }");
  });
});

// rust-ts only: the Debug functions tools/codegen/typemap.json maps rustc_span types to. Expected
// strings follow the upstream impls (derives, `newtype_index!` debug_format, symbol.rs Debug impls).
test("rust-ts: typemap Debug exports", () =>
  create_default_session_globals_then(() => {
    expect(debug_Symbol(Symbol.intern("main"), PLAIN)).toBe('"main"');
    expect(debug_ByteSymbol(ByteSymbol.intern(new TextEncoder().encode("hi")), PLAIN)).toBe("[104, 105]");
    expect(debug_Ident(Ident.from_str("main"), PLAIN)).toBe("main#0");
    expect(debug_BytePos(BytePos(7), PLAIN)).toBe("BytePos(7)");
    expect(debug_AttrId(AttrId.from_u32(3), PLAIN)).toBe("AttrId(3)");
    expect(debug_ErrorGuaranteed(ErrorGuaranteed.unchecked_error_guaranteed(), PLAIN)).toBe("ErrorGuaranteed(())");
    expect(debug_ErrorGuaranteed(ErrorGuaranteed.unchecked_error_guaranteed(), PRETTY)).toBe("ErrorGuaranteed(\n    (),\n)");
    expect(debug_Spanned(dummy_spanned(1), PLAIN, debug_int)).toBe(
      "Spanned { node: 1, span: Span { lo: BytePos(0), hi: BytePos(0), ctxt: #0 } }",
    );
    expect(debug_LocalExpnId(LocalExpnId.ROOT, PLAIN)).toBe("expn0");
    expect(debug_Edition(Edition.Edition2021, PLAIN)).toBe("Edition2021");
  }));
