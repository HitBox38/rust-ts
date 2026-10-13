// Port of compiler/rustc_parse/src/parser/tests.rs (scaffolding, lane parser-core).
//
// Ported here: every helper fn of tests.rs (with markers) and the tests this lane makes work
// (`look_ahead`, `look_ahead_non_outermost_stream`, `debug_lookahead`, `eqmodws`,
// `pattern_whitespace`, `non_pattern_whitespace`). The other test bodies are left to the final lane
// of the parser chain; they are listed as `test.todo` below, in upstream order.
//
// Helper API (for the follow-on lanes; all upstream names):
//   filename(sm, path): FileName                      `FileName::Real` relative to the working dir
//   string_to_parser(psess, src): Parser             StripTokens::Nothing, `unwrap_or_emit_fatal`
//   create_test_handler(theme): [DiagCtxt, SourceMap, VecU8]   emitter into a byte buffer, width 140
//   with_error_checking_parse(src, psess, f): T      `f(p)` must be Ok and emit no errors
//   with_expected_parse_error(src, expected, f)      the rendered stderr must contain `expected`
//   string_to_stream(src): TokenStream               via `source_str_to_stream`
//   matches_codepattern(a, b): boolean               whitespace-insensitive comparison
//   test_harness(text, span_labels, notes, ascii, unicode)   emitter rendering tests
//   make_span / make_pos / parse_item_from_source_str / sp / string_to_expr / string_to_item / look
// Tests run inside `create_default_session_globals_then` like upstream.
import { expect, test } from "bun:test";

import type { Expr, Item } from "../../rustc_ast/lib.ts";
import { token } from "../../rustc_ast/lib.ts";
import type { TokenKind } from "../../rustc_ast/token.ts";
import type { TokenStream } from "../../rustc_ast/tokenstream.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { OutputTheme } from "../../rustc_errors/emitter.ts";
import { DiagCtxt, type PResult } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { is_whitespace } from "../../rustc_lexer/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { BytePos, create_default_session_globals_then, type FileName, Span } from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { kw, sym } from "../../rustc_span/symbol.ts";
import { debug_str, PRETTY } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Str, utf8_len } from "../../std/str.ts";
import { AutoStream } from "../../vendor/anstream/lib.ts";
import { type FmtArguments, VecU8, Write_default, dyn_write, type Write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, source_str_to_stream, unwrap_or_emit_fatal } from "../lib.ts";
import type { Parser } from "./mod.ts";

// rustc: compiler/rustc_parse/src/parser/tests.rs:26 filename
function filename(sm: SourceMap, path: string): FileName {
  return { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
}

/// Map string to parser (via tts).
// rustc: compiler/rustc_parse/src/parser/tests.rs:31 string_to_parser
function string_to_parser(psess: ParseSess, source_str: string): Parser {
  return unwrap_or_emit_fatal(
    new_parser_from_source_str(psess, filename(psess.source_map(), "bogofile"), source_str, "Nothing"),
  );
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:40 create_test_handler
function create_test_handler(theme: OutputTheme): [DiagCtxt, SourceMap, VecU8] {
  const output = new VecU8();
  const source_map = SourceMap.new(FilePathMapping.empty());
  // PORT: `Shared { data: output.clone() }` (an `Arc<Mutex<Vec<u8>>>` writer) is the shared `VecU8`.
  const shared = new Shared(output);
  const auto_stream = AutoStream.never(dyn_write(shared));
  let em = AnnotateSnippetEmitter.new(auto_stream);
  em = AnnotateSnippetEmitter.sm(em, source_map);
  em = AnnotateSnippetEmitter.diagnostic_width(em, 140);
  em = AnnotateSnippetEmitter.theme(em, theme);
  const dcx = DiagCtxt.new(em);
  return [dcx, source_map, output];
}

/// Returns the result of parsing the given string via the given callback.
///
/// If there are any errors, this will panic.
// rustc: compiler/rustc_parse/src/parser/tests.rs:57 with_error_checking_parse
function with_error_checking_parse<T>(s: string, psess: ParseSess, f: (p: Parser) => PResult<T>): T {
  const p = string_to_parser(psess, s);
  const r = f(p);
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
  const x = r._0;
  p.dcx().abort_if_errors();
  return x;
}

/// Verifies that parsing the given string using the given callback will
/// generate an error that contains the given text.
// rustc: compiler/rustc_parse/src/parser/tests.rs:69 with_expected_parse_error
function with_expected_parse_error<T>(source_str: string, expected_output: string, f: (p: Parser) => PResult<T>): void {
  const [handler, source_map, output] = create_test_handler(OutputTheme.Ascii);
  const psess = ParseSess.with_dcx(handler, source_map);
  const p = string_to_parser(psess, source_str);
  const result = f(p);
  assert(result.$ === "Ok", "assertion failed: result.is_ok()");

  const actual_output = new TextDecoder().decode(output.bytes());
  assert(actual_output.includes(expected_output), "assertion failed: actual_output.contains(expected_output)");
}

/// Maps a string to tts, using a made-up filename.
// rustc: compiler/rustc_parse/src/parser/tests.rs:88 string_to_stream
export function string_to_stream(source_str: string): TokenStream {
  const psess = ParseSess.new();
  return unwrap_or_emit_fatal(source_str_to_stream(psess, filename(psess.source_map(), "bogofile"), source_str, undefined));
}

/// Does the given string match the pattern? whitespace in the first string
/// may be deleted or replaced with other whitespace to match the pattern.
/// This function is relatively Unicode-ignorant; fortunately, the careful design
/// of UTF-8 mitigates this ignorance. It doesn't do NKF-normalization(?).
// rustc: compiler/rustc_parse/src/parser/tests.rs:102 matches_codepattern
export function matches_codepattern(a_: string, b_: string): boolean {
  const a_iter = new Peekable([...a_].map((c) => c.codePointAt(0)!));
  const b_iter = new Peekable([...b_].map((c) => c.codePointAt(0)!));

  for (;;) {
    const pa = a_iter.peek();
    const pb = b_iter.peek();
    let a: number;
    let b: number;
    if (pa === undefined && pb === undefined) return true;
    else if (pa === undefined) return false;
    else if (pb === undefined) {
      if (is_whitespace(pa)) {
        break; // Trailing whitespace check is out of loop for borrowck.
      } else {
        return false;
      }
    } else {
      a = pa;
      b = pb;
    }

    if (is_whitespace(a) && is_whitespace(b)) {
      // Skip whitespace for `a` and `b`.
      scan_for_non_ws_or_end(a_iter);
      scan_for_non_ws_or_end(b_iter);
    } else if (is_whitespace(a)) {
      // Skip whitespace for `a`.
      scan_for_non_ws_or_end(a_iter);
    } else if (a === b) {
      a_iter.next();
      b_iter.next();
    } else {
      return false;
    }
  }

  // Check if a has *only* trailing whitespace.
  for (let c = a_iter.next(); c !== undefined; c = a_iter.next()) if (!is_whitespace(c)) return false;
  return true;
}

/// PORT: `std::iter::Peekable` over a char array (test helper, no upstream fn).
class Peekable {
  private i = 0;
  constructor(private readonly xs: number[]) {}
  peek(): number | undefined {
    return this.xs[this.i];
  }
  next(): number | undefined {
    return this.xs[this.i++];
  }
}

/// Advances the given peekable `Iterator` until it reaches a non-whitespace character.
// rustc: compiler/rustc_parse/src/parser/tests.rs:140 scan_for_non_ws_or_end
function scan_for_non_ws_or_end(iter: Peekable): void {
  for (let c = iter.peek(); c !== undefined && is_whitespace(c); c = iter.peek()) {
    iter.next();
  }
}

/// Identifies a position in the text by the n'th occurrence of a string.
interface Position {
  string: string;
  count: number;
}

interface SpanLabel {
  start: Position;
  end: Position;
  label: string;
}

/// `struct Shared<T: Write> { data: Arc<Mutex<T>> }` with `impl Write`.
class Shared implements Write {
  constructor(public data: VecU8) {}

  // (provided methods of `std::io::Write`)
  write_all(buf: Uint8Array) {
    return Write_default.write_all(this, buf);
  }
  write_fmt(args: FmtArguments) {
    return Write_default.write_fmt(this, args);
  }

  // rustc: compiler/rustc_parse/src/parser/tests.rs:163 write
  write(buf: Uint8Array) {
    return this.data.write(buf);
  }

  // rustc: compiler/rustc_parse/src/parser/tests.rs:167 flush
  flush() {
    return this.data.flush();
  }
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:172 test_harness
export function test_harness(
  file_text: string,
  span_labels: SpanLabel[],
  notes: [[Position, Position] | undefined, string][],
  expected_output_ascii: string,
  expected_output_unicode: string,
): void {
  create_default_session_globals_then(() => {
    for (const [theme, expected_output_] of [
      [OutputTheme.Ascii, expected_output_ascii],
      [OutputTheme.Unicode, expected_output_unicode],
    ] as const) {
      const [dcx, source_map, output] = create_test_handler(theme);
      source_map.new_source_file(filename(source_map, "test.rs"), Str.from(file_text));

      const primary_span = make_span(file_text, span_labels[0]!.start, span_labels[0]!.end);
      const msp = MultiSpan.from_span(primary_span);
      for (const span_label of span_labels) {
        const span = make_span(file_text, span_label.start, span_label.end);
        msp.push_span_label(span, span_label.label);
      }

      const err = dcx.handle().struct_span_err(msp, "foo");
      for (const [position, note] of notes) {
        if (position !== undefined) {
          const [start, end] = position;
          const span = make_span(file_text, start, end);
          err.span_note(span, note);
        } else {
          err.note(note);
        }
      }
      err.emit();

      assert(expected_output_.startsWith("\n"), "expected output should begin with newline");
      const expected_output = expected_output_.slice(1);

      const actual_output = new TextDecoder().decode(output.bytes());
      assert(expected_output === actual_output, "assertion failed: expected_output == actual_output");
    }
  });
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:223 make_span
function make_span(file_text: string, start_: Position, end_: Position): Span {
  const start = make_pos(file_text, start_);
  const end = make_pos(file_text, end_) + utf8_len(end_.string); // just after matching thing ends
  assert(start <= end, "assertion failed: start <= end");
  return Span.with_root_ctxt(BytePos(start), BytePos(end));
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:230 make_pos
function make_pos(file_text: string, pos: Position): number {
  // PORT: byte offsets over UTF-8 (`str::find` / `&remainder[n + 1..]`).
  let remainder = Str.from(file_text);
  let offset = 0;
  for (let i = 0; i < pos.count; i++) {
    const n = remainder.find(pos.string);
    if (n !== undefined) {
      offset += n;
      remainder = remainder.slice(n + 1);
    } else {
      panic(`failed to find ${pos.count} instances of ${debug_str(pos.string)} in ${debug_str(file_text)}`);
    }
  }
  return offset;
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2223 parse_item_from_source_str
function parse_item_from_source_str(name: FileName, source: string, psess: ParseSess): PResult<Item | undefined> {
  return unwrap_or_emit_fatal(new_parser_from_source_str(psess, name, source, "Nothing")).parse_item("No", "Yes");
}

// Produces a `rustc_span::span`.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2233 sp
function sp(a: number, b: number): Span {
  return Span.with_root_ctxt(BytePos(a), BytePos(b));
}

/// Parses a string, return an expression.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2238 string_to_expr
function string_to_expr(source_str: string): Expr {
  return with_error_checking_parse(source_str, ParseSess.new(), (p) => p.parse_expr());
}

/// Parses a string, returns an item.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2243 string_to_item
function string_to_item(source_str: string): Item | undefined {
  return with_error_checking_parse(source_str, ParseSess.new(), (p) => p.parse_item("No", "Yes"));
}

// (`parse_expr_from_source_str`, tests.rs:2505, is a nested fn of `ttdelim_span`; it is ported with
// that test.)

// rustc: compiler/rustc_parse/src/parser/tests.rs:2534 look
function look(p: Parser, dist: number, kind: TokenKind): void {
  // Do the `assert_eq` outside the closure so that `track_caller` works.
  // (`#![feature(closure_track_caller)]` + `#[track_caller]` on the closure
  // doesn't give the line number in the test below if the assertion fails.)
  const tok = p.look_ahead(dist, (tok) => tok);
  expect(token.TokenKind_eq(kind, tok.kind)).toBe(true);
}

// ---- tests left to the final lane of the parser chain (upstream order) ----
for (const name of [
  "ends_on_col0", "ends_on_col2", "non_nested", "nested", "multiline_and_normal_overlap", "different_overlap",
  "different_note_1", "different_note_2", "different_note_3", "different_note_spanned_1", "different_note_spanned_2",
  "different_note_spanned_3", "different_note_spanned_4", "different_note_spanned_5", "different_note_spanned_6",
  "different_note_spanned_7", "different_note_spanned_8", "different_note_spanned_9", "different_note_spanned_10",
  "triple_overlap", "triple_exact_overlap", "minimum_depth", "non_overlapping", "overlapping_start_and_end",
  "multiple_labels_primary_without_message", "multiline_notes", "multiple_labels_secondary_without_message",
  "multiple_labels_primary_without_message_2", "multiple_labels_secondary_without_message_2",
  "multiple_labels_secondary_without_message_3", "multiple_labels_without_message", "multiple_labels_without_message_2",
  "multiple_labels_with_message", "single_label_with_message", "single_label_without_message", "long_snippet",
  "long_snippet_multiple_spans", "bad_path_expr_1", "string_to_tts_macro", "string_to_tts_1", "parse_use",
  "parse_extern_crate", "span_of_self_arg_pat_idents_are_correct (+ get_spans_of_pat_idents)", "parse_exprs",
  "attrs_fix_bug", "crlf_doc_comments", "ttdelim_span (+ parse_expr_from_source_str)", "out_of_line_mod",
]) {
  test.todo(`tests.rs ${name}`, () => {});
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2543 look_ahead
test("look_ahead", () => {
  create_default_session_globals_then(() => {
    const sym_f = sym.character("f".codePointAt(0)!);
    const sym_x = sym.character("x".codePointAt(0)!);
    const sym_S = sym.character("S".codePointAt(0)!);
    const normal = token.IdentKind.Normal;
    const Ident = (s: typeof sym_f): TokenKind => ({ $: "Ident", _0: s, _1: normal });
    const K = token.TokenKind;

    const psess = ParseSess.new();
    const p = string_to_parser(psess, "fn f(x: u32) { x } struct S;");

    // Current position is the `fn`.
    look(p, 0, Ident(kw.Fn));
    look(p, 1, Ident(sym_f));
    look(p, 2, K.OpenParen);
    look(p, 3, Ident(sym_x));
    look(p, 4, K.Colon);
    look(p, 5, Ident(sym.u32));
    look(p, 6, K.CloseParen);
    look(p, 7, K.OpenBrace);
    look(p, 8, Ident(sym_x));
    look(p, 9, K.CloseBrace);
    look(p, 10, Ident(kw.Struct));
    look(p, 11, Ident(sym_S));
    look(p, 12, K.Semi);
    // Any lookahead past the end of the token stream returns `Eof`.
    look(p, 13, K.Eof);
    look(p, 14, K.Eof);
    look(p, 15, K.Eof);
    look(p, 100, K.Eof);

    // Move forward to the first `x`.
    for (let i = 0; i < 3; i++) {
      p.bump();
    }
    look(p, 0, Ident(sym_x));
    look(p, 1, K.Colon);
    look(p, 2, Ident(sym.u32));
    look(p, 3, K.CloseParen);
    look(p, 4, K.OpenBrace);
    look(p, 5, Ident(sym_x));
    look(p, 6, K.CloseBrace);
    look(p, 7, Ident(kw.Struct));
    look(p, 8, Ident(sym_S));
    look(p, 9, K.Semi);
    look(p, 10, K.Eof);
    look(p, 11, K.Eof);
    look(p, 100, K.Eof);

    // Move forward to the `;`.
    for (let i = 0; i < 9; i++) {
      p.bump();
    }
    look(p, 0, K.Semi);
    // Any lookahead past the end of the token stream returns `Eof`.
    look(p, 1, K.Eof);
    look(p, 100, K.Eof);

    // Move one past the `;`, i.e. past the end of the token stream.
    p.bump();
    look(p, 0, K.Eof);
    look(p, 1, K.Eof);
    look(p, 100, K.Eof);

    // Bumping after Eof is idempotent.
    p.bump();
    look(p, 0, K.Eof);
    look(p, 1, K.Eof);
    look(p, 100, K.Eof);
  });
});

/// There used to be some buggy behaviour when using `look_ahead` not within
/// the outermost token stream, which this test covers.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2618 look_ahead_non_outermost_stream
test("look_ahead_non_outermost_stream", () => {
  create_default_session_globals_then(() => {
    const sym_f = sym.character("f".codePointAt(0)!);
    const sym_x = sym.character("x".codePointAt(0)!);
    const sym_S = sym.character("S".codePointAt(0)!);
    const normal = token.IdentKind.Normal;
    const Ident = (s: typeof sym_f): TokenKind => ({ $: "Ident", _0: s, _1: normal });
    const K = token.TokenKind;

    const psess = ParseSess.new();
    const p = string_to_parser(psess, "mod m { fn f(x: u32) { x } struct S; }");

    // Move forward to the `fn`, which is not within the outermost token
    // stream (because it's inside the `mod { ... }`).
    for (let i = 0; i < 3; i++) {
      p.bump();
    }
    look(p, 0, Ident(kw.Fn));
    look(p, 1, Ident(sym_f));
    look(p, 2, K.OpenParen);
    look(p, 3, Ident(sym_x));
    look(p, 4, K.Colon);
    look(p, 5, Ident(sym.u32));
    look(p, 6, K.CloseParen);
    look(p, 7, K.OpenBrace);
    look(p, 8, Ident(sym_x));
    look(p, 9, K.CloseBrace);
    look(p, 10, Ident(kw.Struct));
    look(p, 11, Ident(sym_S));
    look(p, 12, K.Semi);
    look(p, 13, K.CloseBrace);
    // Any lookahead past the end of the token stream returns `Eof`.
    look(p, 14, K.Eof);
    look(p, 15, K.Eof);
    look(p, 100, K.Eof);
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2656 debug_lookahead
test("debug_lookahead", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const p = string_to_parser(psess, "fn f(x: u32) { x } struct S;");

    // Current position is the `fn`.
    expect(p.debug_lookahead(0)(PRETTY)).toBe(EXPECTED_0);
    expect(p.debug_lookahead(7)(PRETTY)).toBe(EXPECTED_7);
    // There are 13 tokens. We request 15, get 14; the last one is `Eof`.
    expect(p.debug_lookahead(15)(PRETTY)).toBe(EXPECTED_15);

    // Move forward to the second `x`.
    for (let i = 0; i < 8; i++) {
      p.bump();
    }
    expect(p.debug_lookahead(1)(PRETTY)).toBe(EXPECTED_1);
    expect(p.debug_lookahead(4)(PRETTY)).toBe(EXPECTED_4);

    // Move two past the final token (the `;`).
    for (let i = 0; i < 6; i++) {
      p.bump();
    }
    expect(p.debug_lookahead(3)(PRETTY)).toBe(EXPECTED_3);
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2894 eqmodws
test("eqmodws", () => {
  expect(matches_codepattern("", "")).toBe(true);
  expect(matches_codepattern("", "a")).toBe(false);
  expect(matches_codepattern("a", "")).toBe(false);
  expect(matches_codepattern("a", "a")).toBe(true);
  expect(matches_codepattern("a b", "a   \n\t\r  b")).toBe(true);
  expect(matches_codepattern("a b ", "a   \n\t\r  b")).toBe(true);
  expect(matches_codepattern("a b", "a   \n\t\r  b ")).toBe(false);
  expect(matches_codepattern("a   b", "a b")).toBe(true);
  expect(matches_codepattern("ab", "a b")).toBe(false);
  expect(matches_codepattern("a   b", "ab")).toBe(true);
  expect(matches_codepattern(" a   b", "ab")).toBe(true);
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2909 pattern_whitespace
test("pattern_whitespace", () => {
  expect(matches_codepattern("", "\x0C")).toBe(false);
  expect(matches_codepattern("a b ", "a   \u{0085}\n\t\r  b")).toBe(true);
  expect(matches_codepattern("a b", "a   \u{0085}\n\t\r  b ")).toBe(false);
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2916 non_pattern_whitespace
test("non_pattern_whitespace", () => {
  // These have the property 'White_Space' but not 'Pattern_White_Space'
  expect(matches_codepattern("a b", "a\u{2002}b")).toBe(false);
  expect(matches_codepattern("a   b", "a\u{2002}b")).toBe(false);
  expect(matches_codepattern("\u{205F}a   b", "ab")).toBe(false);
  expect(matches_codepattern("a  \u{3000}b", "ab")).toBe(false);
});

// Unused-for-now helpers are referenced so the scaffolding type-checks without warnings.
void [with_expected_parse_error, string_to_stream, test_harness, parse_item_from_source_str, sp, string_to_expr, string_to_item, unwrap];

// The `debug_lookahead` expectations, verbatim from tests.rs.
const EXPECTED_0 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_7 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"fn\",\n            Normal,\n        ),\n        Ident(\n            \"f\",\n            Normal,\n        ),\n        OpenParen,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        Colon,\n        Ident(\n            \"u32\",\n            Normal,\n        ),\n        CloseParen,\n    ],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_15 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"fn\",\n            Normal,\n        ),\n        Ident(\n            \"f\",\n            Normal,\n        ),\n        OpenParen,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        Colon,\n        Ident(\n            \"u32\",\n            Normal,\n        ),\n        CloseParen,\n        OpenBrace,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        CloseBrace,\n        Ident(\n            \"struct\",\n            Normal,\n        ),\n        Ident(\n            \"S\",\n            Normal,\n        ),\n        Semi,\n        Eof,\n    ],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_1 = "Parser {\n    prev_token: Token {\n        kind: OpenBrace,\n        span: Span {\n            lo: BytePos(\n                13,\n            ),\n            hi: BytePos(\n                14,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"x\",\n            Normal,\n        ),\n    ],\n    approx_token_stream_pos: 8,\n    ..\n}";
const EXPECTED_4 = "Parser {\n    prev_token: Token {\n        kind: OpenBrace,\n        span: Span {\n            lo: BytePos(\n                13,\n            ),\n            hi: BytePos(\n                14,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        CloseBrace,\n        Ident(\n            \"struct\",\n            Normal,\n        ),\n        Ident(\n            \"S\",\n            Normal,\n        ),\n    ],\n    approx_token_stream_pos: 8,\n    ..\n}";
const EXPECTED_3 = "Parser {\n    prev_token: Token {\n        kind: Eof,\n        span: Span {\n            lo: BytePos(\n                27,\n            ),\n            hi: BytePos(\n                28,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Eof,\n    ],\n    approx_token_stream_pos: 14,\n    ..\n}";
