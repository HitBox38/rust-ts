// Port of compiler/rustc_parse/src/parser/tests.rs.
//
// Every upstream helper and `#[test]` fn is ported here, in upstream order, with markers. Each
// `#[test]` is registered through `upstream_test`; a check asserts the registered list equals
// upstream's `#[test]` fns (in order). Tests that reach parser code owned by a lane that has not
// landed yet are listed in `PENDING` with the exact `Unported` they must throw (see below).
//
// Helper API (all upstream names):
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../../scripts/lib/common.ts";

import { ast, type Expr, type Item, token, tokenstream, visit } from "../../rustc_ast/lib.ts";
import { debug_Delimiter, Delimiter, Delimiter_eq, IdentKind, TokenKind, Token_eq } from "../../rustc_ast/token.ts";
import {
  debug_TokenStream,
  debug_TokenTree,
  DelimSpacing,
  DelimSpan,
  Spacing,
  TokenStream,
  TokenTree,
} from "../../rustc_ast/tokenstream.ts";
import { item_to_string } from "../../rustc_ast_pretty/pprust/mod.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { OutputTheme } from "../../rustc_errors/emitter.ts";
import { DiagCtxt, type PResult } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { is_whitespace } from "../../rustc_lexer/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { BytePos, create_default_session_globals_then, type FileName, Span } from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { debug_Symbol, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { ch } from "../../std/char.ts";
import { debug_str, debug_vec, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches, panic, Unported, unwrap } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
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

// ---- upstream #[test] registration and the PENDING convention ----
//
// Every upstream `#[test]` is registered through `upstream_test` (in upstream order); a check below
// asserts the registered names equal upstream's `#[test]` fns. A test listed in `PENDING` reaches
// code owned by a parser lane that has not landed yet: it must throw exactly that `Unported` (any
// other outcome fails). When the owning lane lands, the test runs to completion, the check fails
// until root deletes its `PENDING` entry, so nothing passes silently and nothing is skipped.

/** test -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  bad_path_expr_1: "rustc_parse::parser::path::Parser::parse_path",
  parse_use: "rustc_parse::parser::item::Parser::parse_item",
  parse_extern_crate: "rustc_parse::parser::item::Parser::parse_item",
  span_of_self_arg_pat_idents_are_correct: "rustc_parse::parser::item::Parser::parse_item",
  parse_exprs: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  attrs_fix_bug: "rustc_parse::parser::item::Parser::parse_item",
  crlf_doc_comments: "rustc_parse::parser::item::Parser::parse_item",
  ttdelim_span: "rustc_parse::parser::path::Parser::parse_path",
  out_of_line_mod: "rustc_parse::parser::item::Parser::parse_item",
};

const REGISTERED: string[] = [];

/** PORT: `#[test] fn <name>() { <body> }` under the PENDING convention (test scaffolding, no upstream fn). */
function upstream_test(name: string, body: () => void): void {
  REGISTERED.push(name);
  test(name, () => {
    let reached: string | undefined;
    try {
      body();
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      reached = e.what;
    }
    expect(reached).toBe(PENDING[name]);
  });
}

test("tests.rs: every upstream #[test] is ported and registered; PENDING names registered tests", () => {
  const src = readFileSync(join(UPSTREAM, "compiler/rustc_parse/src/parser/tests.rs"), "utf8");
  const upstream = [...src.matchAll(/#\[test\]\s*(?:#\[[^\]]*\]\s*)*fn\s+(\w+)/g)].map((m) => m[1]!);
  expect(REGISTERED).toEqual(upstream);
  for (const name of Object.keys(PENDING)) expect(REGISTERED).toContain(name);
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:245 ends_on_col0
upstream_test("ends_on_col0", () => {
  test_harness(
    `
fn foo() {
}
`,
    [{
      start: { string: "{", count: 1 },
      end: { string: "}", count: 1 },
      label: "test",
    }],
    [],
    `
error: foo
 --> test.rs:2:10
  |
2 |   fn foo() {
  |  __________^
3 | | }
  | |_^ test

`,
    `
error: foo
  ╭▸ test.rs:2:10
  │
2 │   fn foo() {
  │ ┏━━━━━━━━━━┛
3 │ ┃ }
  ╰╴┗━┛ test

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:281 ends_on_col2
upstream_test("ends_on_col2", () => {
  test_harness(
    `
fn foo() {


  }
`,
    [{
      start: { string: "{", count: 1 },
      end: { string: "}", count: 1 },
      label: "test",
    }],
    [],
    `
error: foo
 --> test.rs:2:10
  |
2 |   fn foo() {
  |  __________^
... |
5 | |   }
  | |___^ test

`,
    `
error: foo
  ╭▸ test.rs:2:10
  │
2 │   fn foo() {
  │ ┏━━━━━━━━━━┛
  ‡ ┃
5 │ ┃   }
  ╰╴┗━━━┛ test

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:320 non_nested
upstream_test("non_nested", () => {
  test_harness(
    `
fn foo() {
  X0 Y0
  X1 Y1
  X2 Y2
}
`,
    [
      {
        start: { string: "X0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Y0", count: 1 },
        end: { string: "Y2", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |      X0 Y0
  |  ____^  -
  | | ______|
4 | ||   X1 Y1
5 | ||   X2 Y2
  | ||____^__- \`Y\` is a good letter too
  | |_____|
  |       \`X\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │      X0 Y0
  │ ┏━━━━┛  │
  │ ┃┌──────┘
4 │ ┃│   X1 Y1
5 │ ┃│   X2 Y2
  │ ┃└────╿──┘ \`Y\` is a good letter too
  │ ┗━━━━━┥
  ╰╴      \`X\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:374 nested
upstream_test("nested", () => {
  test_harness(
    `
fn foo() {
  X0 Y0
  Y1 X1
}
`,
    [
      {
        start: { string: "X0", count: 1 },
        end: { string: "X1", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Y0", count: 1 },
        end: { string: "Y1", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |      X0 Y0
  |  ____^  -
  | | ______|
4 | ||   Y1 X1
  | ||____-__^ \`X\` is a good letter
  |  |____|
  |       \`Y\` is a good letter too

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │      X0 Y0
  │ ┏━━━━┛  │
  │ ┃┌──────┘
4 │ ┃│   Y1 X1
  │ ┗│━━━━│━━┛ \`X\` is a good letter
  │  └────┤
  ╰╴      \`Y\` is a good letter too

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:425 multiline_and_normal_overlap
upstream_test("multiline_and_normal_overlap", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "X0", count: 1 },
        end: { string: "Y0", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:6
  |
3 |     X0 Y0 Z0
  |  ___---^-
  | |   |
  | |   \`Y\` is a good letter too
4 | |   X1 Y1 Z1
5 | |   X2 Y2 Z2
  | |____^ \`X\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │     X0 Y0 Z0
  │ ┏━━━┬──┛─
  │ ┃   │
  │ ┃   \`Y\` is a good letter too
4 │ ┃   X1 Y1 Z1
5 │ ┃   X2 Y2 Z2
  ╰╴┗━━━━┛ \`X\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:478 different_overlap
upstream_test("different_overlap", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Z1", count: 1 },
        end: { string: "X3", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:6
  |
3 |      X0 Y0 Z0
  |  _______^
4 | |    X1 Y1 Z1
  | | _________-
5 | ||   X2 Y2 Z2
  | ||____^ \`X\` is a good letter
6 |  |   X3 Y3 Z3
  |  |____- \`Y\` is a good letter too

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │      X0 Y0 Z0
  │ ┏━━━━━━━┛
4 │ ┃    X1 Y1 Z1
  │ ┃┌─────────┘
5 │ ┃│   X2 Y2 Z2
  │ ┗│━━━━┛ \`X\` is a good letter
6 │  │   X3 Y3 Z3
  ╰╴ └────┘ \`Y\` is a good letter too

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:533 different_note_1
upstream_test("different_note_1", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [[undefined, "bar"]],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ╰ note: bar

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:573 different_note_2
upstream_test("different_note_2", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [[undefined, "bar"], [undefined, "qux"]],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar
  = note: qux

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ├ note: bar
  ╰ note: qux

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:615 different_note_3
upstream_test("different_note_3", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [[undefined, "bar"], [undefined, "baz"], [undefined, "qux"]],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar
  = note: baz
  = note: qux

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ├ note: bar
  ├ note: baz
  ╰ note: qux

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:659 different_note_spanned_1
upstream_test("different_note_spanned_1", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [[
      [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
      "bar",
    ]],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:710 different_note_spanned_2
upstream_test("different_note_spanned_2", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "bar",
      ],
      [
        [{ string: "X2", count: 1 }, { string: "Y2", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
note: qux
 --> test.rs:5:3
  |
5 |   X2 Y2 Z2
  |   ^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━
note: qux
  ╭▸ test.rs:5:3
  │
5 │   X2 Y2 Z2
  ╰╴  ━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:777 different_note_spanned_3
upstream_test("different_note_spanned_3", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "bar",
      ],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "baz",
      ],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
note: baz
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
note: qux
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━
note: baz
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━
note: qux
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:858 different_note_spanned_4
upstream_test("different_note_spanned_4", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "bar",
      ],
      [undefined, "qux"],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
  = note: qux

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  │   ━━━━━━━━
  ╰ note: qux

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:914 different_note_spanned_5
upstream_test("different_note_spanned_5", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [undefined, "bar"],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar
note: qux
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ╰ note: bar
note: qux
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:970 different_note_spanned_6
upstream_test("different_note_spanned_6", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [undefined, "bar"],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "baz",
      ],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar
note: baz
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
note: qux
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ╰ note: bar
note: baz
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━
note: qux
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1040 different_note_spanned_7
upstream_test("different_note_spanned_7", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z3", count: 1 }],
        "bar",
      ],
      [undefined, "baz"],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 | /   X1 Y1 Z1
5 | |   X2 Y2 Z2
6 | |   X3 Y3 Z3
  | |__________^
  = note: baz
note: qux
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │ ┏   X1 Y1 Z1
5 │ ┃   X2 Y2 Z2
6 │ ┃   X3 Y3 Z3
  │ ┗━━━━━━━━━━┛
  ╰ note: baz
note: qux
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1114 different_note_spanned_8
upstream_test("different_note_spanned_8", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "bar",
      ],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "baz",
      ],
      [undefined, "qux"],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
note: baz
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
  = note: qux

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━
note: baz
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  │   ━━━━━━━━
  ╰ note: qux

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1184 different_note_spanned_9
upstream_test("different_note_spanned_9", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [undefined, "bar"],
      [undefined, "baz"],
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "qux",
      ],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
  = note: bar
  = note: baz
note: qux
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  │
  ├ note: bar
  ╰ note: baz
note: qux
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  ╰╴  ━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1243 different_note_spanned_10
upstream_test("different_note_spanned_10", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [{
      start: { string: "Y0", count: 1 },
      end: { string: "Z0", count: 1 },
      label: "`X` is a good letter",
    }],
    [
      [
        [{ string: "X1", count: 1 }, { string: "Z1", count: 1 }],
        "bar",
      ],
      [undefined, "baz"],
      [undefined, "qux"],
    ],
    `
error: foo
 --> test.rs:3:6
  |
3 |   X0 Y0 Z0
  |      ^^^^^ \`X\` is a good letter
  |
note: bar
 --> test.rs:4:3
  |
4 |   X1 Y1 Z1
  |   ^^^^^^^^
  = note: baz
  = note: qux

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │   X0 Y0 Z0
  │      ━━━━━ \`X\` is a good letter
  ╰╴
note: bar
  ╭▸ test.rs:4:3
  │
4 │   X1 Y1 Z1
  │   ━━━━━━━━
  ├ note: baz
  ╰ note: qux

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1302 triple_overlap
upstream_test("triple_overlap", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
}
`,
    [
      {
        start: { string: "X0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Y0", count: 1 },
        end: { string: "Y2", count: 1 },
        label: "`Y` is a good letter too",
      },
      {
        start: { string: "Z0", count: 1 },
        end: { string: "Z2", count: 1 },
        label: "`Z` label",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |       X0 Y0 Z0
  |  _____^  -  -
  | | _______|  |
  | || _________|
4 | |||   X1 Y1 Z1
5 | |||   X2 Y2 Z2
  | |||____^__-__- \`Z\` label
  | ||_____|__|
  | |______|  \`Y\` is a good letter too
  |        \`X\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │       X0 Y0 Z0
  │ ┏━━━━━┛  │  │
  │ ┃┌───────┘  │
  │ ┃│┌─────────┘
4 │ ┃││   X1 Y1 Z1
5 │ ┃││   X2 Y2 Z2
  │ ┃│└────╿──│──┘ \`Z\` label
  │ ┃└─────│──┤
  │ ┗━━━━━━┥  \`Y\` is a good letter too
  ╰╴       \`X\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1365 triple_exact_overlap
upstream_test("triple_exact_overlap", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
}
`,
    [
      {
        start: { string: "X0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "X0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`Y` is a good letter too",
      },
      {
        start: { string: "X0", count: 1 },
        end: { string: "X2", count: 1 },
        label: "`Z` label",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 | /   X0 Y0 Z0
4 | |   X1 Y1 Z1
5 | |   X2 Y2 Z2
  | |    ^
  | |    |
  | |    \`X\` is a good letter
  | |____\`Y\` is a good letter too
  |      \`Z\` label

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │ ┏   X0 Y0 Z0
4 │ ┃   X1 Y1 Z1
5 │ ┃   X2 Y2 Z2
  │ ┃    ╿
  │ ┃    │
  │ ┃    \`X\` is a good letter
  │ ┗━━━━\`Y\` is a good letter too
  ╰╴     \`Z\` label

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1424 minimum_depth
upstream_test("minimum_depth", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "X1", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Y1", count: 1 },
        end: { string: "Z2", count: 1 },
        label: "`Y` is a good letter too",
      },
      {
        start: { string: "X2", count: 1 },
        end: { string: "Y3", count: 1 },
        label: "`Z`",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:6
  |
3 |      X0 Y0 Z0
  |  _______^
4 | |    X1 Y1 Z1
  | | ____^_-
  | ||____|
  |  |    \`X\` is a good letter
5 |  |   X2 Y2 Z2
  |  |___-______- \`Y\` is a good letter too
  |   ___|
  |  |
6 |  |   X3 Y3 Z3
  |  |_______- \`Z\`

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │      X0 Y0 Z0
  │ ┏━━━━━━━┛
4 │ ┃    X1 Y1 Z1
  │ ┃┌────╿─┘
  │ ┗│━━━━┥
  │  │    \`X\` is a good letter
5 │  │   X2 Y2 Z2
  │  └───│──────┘ \`Y\` is a good letter too
  │  ┌───┘
  │  │
6 │  │   X3 Y3 Z3
  ╰╴ └───────┘ \`Z\`

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1492 non_overlapping
upstream_test("non_overlapping", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "X0", count: 1 },
        end: { string: "X1", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Y2", count: 1 },
        end: { string: "Z3", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 | /   X0 Y0 Z0
4 | |   X1 Y1 Z1
  | |____^ \`X\` is a good letter
5 |     X2 Y2 Z2
  |  ______-
6 | |   X3 Y3 Z3
  | |__________- \`Y\` is a good letter too

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │ ┏   X0 Y0 Z0
4 │ ┃   X1 Y1 Z1
  │ ┗━━━━┛ \`X\` is a good letter
5 │     X2 Y2 Z2
  │ ┌──────┘
6 │ │   X3 Y3 Z3
  ╰╴└──────────┘ \`Y\` is a good letter too

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1545 overlapping_start_and_end
upstream_test("overlapping_start_and_end", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "X1", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Z1", count: 1 },
        end: { string: "Z3", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:6
  |
3 |      X0 Y0 Z0
  |  _______^
4 | |    X1 Y1 Z1
  | | ____^____-
  | ||____|
  |  |    \`X\` is a good letter
5 |  |   X2 Y2 Z2
6 |  |   X3 Y3 Z3
  |  |__________- \`Y\` is a good letter too

`,
    `
error: foo
  ╭▸ test.rs:3:6
  │
3 │      X0 Y0 Z0
  │ ┏━━━━━━━┛
4 │ ┃    X1 Y1 Z1
  │ ┃┌────╿────┘
  │ ┗│━━━━┥
  │  │    \`X\` is a good letter
5 │  │   X2 Y2 Z2
6 │  │   X3 Y3 Z3
  ╰╴ └──────────┘ \`Y\` is a good letter too

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1602 multiple_labels_primary_without_message
upstream_test("multiple_labels_primary_without_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "",
      },
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "`a` is a good letter",
      },
      {
        start: { string: "c", count: 1 },
        end: { string: "c", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:7
  |
3 |   a { b { c } d }
  |   ----^^^^-^^-- \`a\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:7
  │
3 │   a { b { c } d }
  ╰╴  ────━━━━─━━── \`a\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1647 multiline_notes
upstream_test("multiline_notes", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [{
      start: { string: "a", count: 1 },
      end: { string: "d", count: 1 },
      label: "`a` is a good letter",
    }],
    [[undefined, "foo\nbar"], [undefined, "foo\nbar"]],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^^^^^^^^^^ \`a\` is a good letter
  |
  = note: foo
          bar
  = note: foo
          bar

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  │   ━━━━━━━━━━━━━ \`a\` is a good letter
  │
  ├ note: foo
  │       bar
  ╰ note: foo
          bar

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1690 multiple_labels_secondary_without_message
upstream_test("multiple_labels_secondary_without_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "`a` is a good letter",
      },
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^-------^^ \`a\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  ╰╴  ━━━━───────━━ \`a\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1730 multiple_labels_primary_without_message_2
upstream_test("multiple_labels_primary_without_message_2", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "`b` is a good letter",
      },
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "",
      },
      {
        start: { string: "c", count: 1 },
        end: { string: "c", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:7
  |
3 |   a { b { c } d }
  |   ----^^^^-^^--
  |       |
  |       \`b\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:7
  │
3 │   a { b { c } d }
  │   ────┯━━━─━━──
  │       │
  ╰╴      \`b\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1779 multiple_labels_secondary_without_message_2
upstream_test("multiple_labels_secondary_without_message_2", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "",
      },
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "`b` is a good letter",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^-------^^
  |       |
  |       \`b\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  │   ━━━━┬──────━━
  │       │
  ╰╴      \`b\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1823 multiple_labels_secondary_without_message_3
upstream_test("multiple_labels_secondary_without_message_3", () => {
  test_harness(
    `
fn foo() {
  a  bc  d
}
`,
    [
      {
        start: { string: "a", count: 1 },
        end: { string: "b", count: 1 },
        label: "`a` is a good letter",
      },
      {
        start: { string: "c", count: 1 },
        end: { string: "d", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a  bc  d
  |   ^^^^----
  |   |
  |   \`a\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a  bc  d
  │   ┯━━━────
  │   │
  ╰╴  \`a\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1867 multiple_labels_without_message
upstream_test("multiple_labels_without_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "",
      },
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^-------^^

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  ╰╴  ━━━━───────━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1907 multiple_labels_without_message_2
upstream_test("multiple_labels_without_message_2", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "",
      },
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "",
      },
      {
        start: { string: "c", count: 1 },
        end: { string: "c", count: 1 },
        label: "",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:7
  |
3 |   a { b { c } d }
  |   ----^^^^-^^--

`,
    `
error: foo
  ╭▸ test.rs:3:7
  │
3 │   a { b { c } d }
  ╰╴  ────━━━━─━━──

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1952 multiple_labels_with_message
upstream_test("multiple_labels_with_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [
      {
        start: { string: "a", count: 1 },
        end: { string: "d", count: 1 },
        label: "`a` is a good letter",
      },
      {
        start: { string: "b", count: 1 },
        end: { string: "}", count: 1 },
        label: "`b` is a good letter",
      },
    ],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^-------^^
  |   |   |
  |   |   \`b\` is a good letter
  |   \`a\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  │   ┯━━━┬──────━━
  │   │   │
  │   │   \`b\` is a good letter
  ╰╴  \`a\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:1998 single_label_with_message
upstream_test("single_label_with_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [{
      start: { string: "a", count: 1 },
      end: { string: "d", count: 1 },
      label: "`a` is a good letter",
    }],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^^^^^^^^^^ \`a\` is a good letter

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  ╰╴  ━━━━━━━━━━━━━ \`a\` is a good letter

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2031 single_label_without_message
upstream_test("single_label_without_message", () => {
  test_harness(
    `
fn foo() {
  a { b { c } d }
}
`,
    [{
      start: { string: "a", count: 1 },
      end: { string: "d", count: 1 },
      label: "",
    }],
    [],
    `
error: foo
 --> test.rs:3:3
  |
3 |   a { b { c } d }
  |   ^^^^^^^^^^^^^

`,
    `
error: foo
  ╭▸ test.rs:3:3
  │
3 │   a { b { c } d }
  ╰╴  ━━━━━━━━━━━━━

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2064 long_snippet
upstream_test("long_snippet", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
  X1 Y1 Z1
1
2
3
4
5
6
7
8
9
10
  X2 Y2 Z2
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "X1", count: 1 },
        label: "`X` is a good letter",
      },
      {
        start: { string: "Z1", count: 1 },
        end: { string: "Z3", count: 1 },
        label: "`Y` is a good letter too",
      },
    ],
    [],
    `
error: foo
  --> test.rs:3:6
   |
 3 |      X0 Y0 Z0
   |  _______^
 4 | |    X1 Y1 Z1
   | | ____^____-
   | ||____|
   |  |    \`X\` is a good letter
 5 |  | 1
 6 |  | 2
 7 |  | 3
...   |
15 |  |   X2 Y2 Z2
16 |  |   X3 Y3 Z3
   |  |__________- \`Y\` is a good letter too

`,
    `
error: foo
   ╭▸ test.rs:3:6
   │
 3 │      X0 Y0 Z0
   │ ┏━━━━━━━┛
 4 │ ┃    X1 Y1 Z1
   │ ┃┌────╿────┘
   │ ┗│━━━━┥
   │  │    \`X\` is a good letter
 5 │  │ 1
 6 │  │ 2
 7 │  │ 3
   ‡  │
15 │  │   X2 Y2 Z2
16 │  │   X3 Y3 Z3
   ╰╴ └──────────┘ \`Y\` is a good letter too

`,
  );
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2139 long_snippet_multiple_spans
upstream_test("long_snippet_multiple_spans", () => {
  test_harness(
    `
fn foo() {
  X0 Y0 Z0
1
2
3
  X1 Y1 Z1
4
5
6
  X2 Y2 Z2
7
8
9
10
  X3 Y3 Z3
}
`,
    [
      {
        start: { string: "Y0", count: 1 },
        end: { string: "Y3", count: 1 },
        label: "`Y` is a good letter",
      },
      {
        start: { string: "Z1", count: 1 },
        end: { string: "Z2", count: 1 },
        label: "`Z` is a good letter too",
      },
    ],
    [],
    `
error: foo
  --> test.rs:3:6
   |
 3 |      X0 Y0 Z0
   |  _______^
 4 | |  1
 5 | |  2
 6 | |  3
 7 | |    X1 Y1 Z1
   | | _________-
 8 | || 4
 9 | || 5
10 | || 6
11 | ||   X2 Y2 Z2
   | ||__________- \`Z\` is a good letter too
...  |
15 | |  10
16 | |    X3 Y3 Z3
   | |________^ \`Y\` is a good letter

`,
    `
error: foo
   ╭▸ test.rs:3:6
   │
 3 │      X0 Y0 Z0
   │ ┏━━━━━━━┛
 4 │ ┃  1
 5 │ ┃  2
 6 │ ┃  3
 7 │ ┃    X1 Y1 Z1
   │ ┃┌─────────┘
 8 │ ┃│ 4
 9 │ ┃│ 5
10 │ ┃│ 6
11 │ ┃│   X2 Y2 Z2
   │ ┃└──────────┘ \`Z\` is a good letter too
   ‡ ┃
15 │ ┃  10
16 │ ┃    X3 Y3 Z3
   ╰╴┗━━━━━━━━┛ \`Y\` is a good letter

`,
  );
});

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

// rustc: compiler/rustc_parse/src/parser/tests.rs:2250 bad_path_expr_1
upstream_test("bad_path_expr_1", () => {
  // This should trigger error: expected identifier, found keyword `return`
  create_default_session_globals_then(() => {
    with_expected_parse_error("::abc::def::return", "expected identifier, found keyword `return`", (p) => p.parse_expr());
  });
});

/** PORT: `stream.iter().collect::<Vec<_>>()` (test scaffolding). */
function collect_tts(iter: tokenstream.TokenStreamIter): TokenTree[] {
  const v: TokenTree[] = [];
  for (let tt = iter.next(); tt !== undefined; tt = iter.next()) v.push(tt);
  return v;
}

/** PORT: the slice-pattern piece `TokenTree::Token(Token { kind: token::Ident(name, IdentKind::Normal), .. }, _)`, binding `name`. */
function tt_ident_normal(tt: TokenTree | undefined): Symbol | undefined {
  if (tt !== undefined && tt.$ === "Token" && tt._0.kind.$ === "Ident" && tt._0.kind._1 === IdentKind.Normal) return tt._0.kind._0;
  return undefined;
}

/** PORT: the slice-pattern piece `TokenTree::Token(Token { kind: token::<kind>, .. }, _)` for a unit token kind. */
function tt_is(tt: TokenTree | undefined, kind: TokenKind["$"]): boolean {
  return tt !== undefined && tt.$ === "Token" && tt._0.kind.$ === kind;
}

/** PORT: the slice-pattern piece `TokenTree::Delimited(.., delim, tts)`, binding `(delim, tts)`. */
function tt_delimited(tt: TokenTree | undefined): [Delimiter, TokenStream] | undefined {
  if (tt !== undefined && tt.$ === "Delimited") return [tt._2, tt._3];
  return undefined;
}

const debug_tts = (tts: readonly TokenTree[]): string => debug_vec(tts, PLAIN, debug_TokenTree);

// Checks the token-tree-ization of macros.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2263 string_to_tts_macro
upstream_test("string_to_tts_macro", () => {
  create_default_session_globals_then(() => {
    const stream = string_to_stream("macro_rules! zip (($a)=>($a))");
    const tts = collect_tts(stream.iter());

    const name_macro_rules = tt_ident_normal(tts[0]);
    const name_zip = tt_ident_normal(tts[2]);
    const macro_ = tt_delimited(tts[3]);
    if (
      tts.length === 4 &&
      name_macro_rules !== undefined &&
      tt_is(tts[1], "Bang") &&
      name_zip !== undefined &&
      macro_ !== undefined &&
      name_macro_rules === kw.MacroRules &&
      Symbol.as_str(name_zip) === "zip"
    ) {
      const [macro_delim, macro_tts] = macro_;
      const tts = collect_tts(macro_tts.iter());
      const first = tt_delimited(tts[0]);
      const second = tt_delimited(tts[2]);
      if (
        tts.length === 3 &&
        first !== undefined &&
        tt_is(tts[1], "FatArrow") &&
        second !== undefined &&
        Delimiter_eq(macro_delim, Delimiter.Parenthesis)
      ) {
        const [first_delim, first_tts] = first;
        const [second_delim, second_tts] = second;
        {
          const tts = collect_tts(first_tts.iter());
          const name = tt_ident_normal(tts[1]);
          if (
            tts.length === 2 &&
            tt_is(tts[0], "Dollar") &&
            name !== undefined &&
            Delimiter_eq(first_delim, Delimiter.Parenthesis) &&
            Symbol.as_str(name) === "a"
          ) {
            // (empty arm)
          } else {
            panic(`value 3: ${debug_Delimiter(first_delim, PLAIN)} ${debug_TokenStream(first_tts, PLAIN)}`);
          }
        }
        {
          const tts = collect_tts(second_tts.iter());
          const name = tt_ident_normal(tts[1]);
          if (
            tts.length === 2 &&
            tt_is(tts[0], "Dollar") &&
            name !== undefined &&
            Delimiter_eq(second_delim, Delimiter.Parenthesis) &&
            Symbol.as_str(name) === "a"
          ) {
            // (empty arm)
          } else {
            panic(`value 4: ${debug_Delimiter(second_delim, PLAIN)} ${debug_TokenStream(second_tts, PLAIN)}`);
          }
        }
      } else {
        panic(`value 2: ${debug_Delimiter(macro_delim, PLAIN)} ${debug_TokenStream(macro_tts, PLAIN)}`);
      }
    } else {
      panic(`value: ${debug_tts(tts)}`);
    }
  });
});

// PORT: `#[derive(PartialEq)]` of `TokenStream`, `TokenTree`, `DelimSpan` and `DelimSpacing`
// (rustc_ast/src/tokenstream.rs) for `assert_eq!(tts, expected)`. rustc_ast/tokenstream.ts has no
// `_eq` fns for them yet, so they are test-local here (see the handoff).
function TokenStream_eq(a: TokenStream, b: TokenStream): boolean {
  return a._0.length === b._0.length && a._0.every((tt, i) => TokenTree_eq(tt, b._0[i]!));
}
function TokenTree_eq(a: TokenTree, b: TokenTree): boolean {
  switch (a.$) {
    case "Token":
      return b.$ === "Token" && Token_eq(a._0, b._0) && a._1 === b._1;
    case "Delimited":
      return (
        b.$ === "Delimited" &&
        a._0.open === b._0.open &&
        a._0.close === b._0.close &&
        a._1.open === b._1.open &&
        a._1.close === b._1.close &&
        Delimiter_eq(a._2, b._2) &&
        TokenStream_eq(a._3, b._3)
      );
  }
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2319 string_to_tts_1
upstream_test("string_to_tts_1", () => {
  create_default_session_globals_then(() => {
    const tts = string_to_stream("fn a(b: i32) { b; }");

    const expected = TokenStream.new([
      TokenTree.token_alone({ $: "Ident", _0: kw.Fn, _1: IdentKind.Normal }, sp(0, 2)),
      TokenTree.token_joint_hidden({ $: "Ident", _0: sym.character(ch("a")), _1: IdentKind.Normal }, sp(3, 4)),
      {
        $: "Delimited",
        _0: DelimSpan.from_pair(sp(4, 5), sp(11, 12)),
        // `JointHidden` because the `(` is followed immediately by
        // `b`, `Alone` because the `)` is followed by whitespace.
        _1: DelimSpacing.new(Spacing.JointHidden, Spacing.Alone),
        _2: Delimiter.Parenthesis,
        _3: TokenStream.new([
          TokenTree.token_joint({ $: "Ident", _0: sym.character(ch("b")), _1: IdentKind.Normal }, sp(5, 6)),
          TokenTree.token_alone(TokenKind.Colon, sp(6, 7)),
          // `JointHidden` because the `i32` is immediately followed by the `)`.
          TokenTree.token_joint_hidden({ $: "Ident", _0: sym.i32, _1: IdentKind.Normal }, sp(8, 11)),
        ]),
      },
      {
        $: "Delimited",
        _0: DelimSpan.from_pair(sp(13, 14), sp(18, 19)),
        // First `Alone` because the `{` is followed by whitespace,
        // second `Alone` because the `}` is followed immediately by
        // EOF.
        _1: DelimSpacing.new(Spacing.Alone, Spacing.Alone),
        _2: Delimiter.Brace,
        _3: TokenStream.new([
          TokenTree.token_joint({ $: "Ident", _0: sym.character(ch("b")), _1: IdentKind.Normal }, sp(15, 16)),
          // `Alone` because the `;` is followed by whitespace.
          TokenTree.token_alone(TokenKind.Semi, sp(16, 17)),
        ]),
      },
    ]);

    assert_eq(tts, expected, (v) => debug_TokenStream(v, PLAIN), TokenStream_eq);
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2371 parse_use
upstream_test("parse_use", () => {
  create_default_session_globals_then(() => {
    {
      const use_s = "use foo::bar::baz;";
      const vitem = unwrap(string_to_item(use_s));
      const vitem_s = item_to_string(vitem);
      assert_eq(vitem_s, use_s, debug_str);
    }

    {
      const use_s = "use foo::bar as baz;";
      const vitem = unwrap(string_to_item(use_s));
      const vitem_s = item_to_string(vitem);
      assert_eq(vitem_s, use_s, debug_str);
    }
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2386 parse_extern_crate
upstream_test("parse_extern_crate", () => {
  create_default_session_globals_then(() => {
    {
      const ex_s = "extern crate foo;";
      const vitem = unwrap(string_to_item(ex_s));
      const vitem_s = item_to_string(vitem);
      assert_eq(vitem_s, ex_s, debug_str);
    }

    {
      const ex_s = "extern crate foo as bar;";
      const vitem = unwrap(string_to_item(ex_s));
      const vitem_s = item_to_string(vitem);
      assert_eq(vitem_s, ex_s, debug_str);
    }
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2400 get_spans_of_pat_idents
function get_spans_of_pat_idents(src: string): Span[] {
  const item = unwrap(string_to_item(src));

  class PatIdentVisitor extends visit.Visitor {
    constructor(public spans: Span[]) {
      super();
    }

    // rustc: compiler/rustc_parse/src/parser/tests.rs:2407 visit_pat
    override visit_pat(p: ast.Pat): undefined {
      switch (p.kind.$) {
        case "Ident": {
          const ident = p.kind._1;
          this.spans.push(ident.span);
          break;
        }
        default: {
          visit.walk_pat(this, p);
        }
      }
      return undefined;
    }
  }
  const v = new PatIdentVisitor([]);
  visit.walk_item(v, item, visit.WalkItemKind.ItemKind);
  return v.spans;
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2424 span_of_self_arg_pat_idents_are_correct
upstream_test("span_of_self_arg_pat_idents_are_correct", () => {
  create_default_session_globals_then(() => {
    const srcs = [
      "impl z { fn a (&self, &myarg: i32) {} }",
      "impl z { fn a (&mut self, &myarg: i32) {} }",
      "impl z { fn a (&'a self, &myarg: i32) {} }",
      "impl z { fn a (self, &myarg: i32) {} }",
      "impl z { fn a (self: Foo, &myarg: i32) {} }",
    ];

    for (const src of srcs) {
      const spans = get_spans_of_pat_idents(src);
      const [lo, hi] = [Span.lo(spans[0]!), Span.hi(spans[0]!)];
      // PORT: `&src[lo.to_usize()..hi.to_usize()]` slices UTF-8 bytes.
      const text = Str.from(src).slice(BytePos.to_usize(lo), BytePos.to_usize(hi)).toString();
      assert("self" === text, `"${text}" != "self". src="${src}"`);
    }
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2448 parse_exprs
upstream_test("parse_exprs", () => {
  create_default_session_globals_then(() => {
    // just make sure that they parse....
    string_to_expr("3 + 4");
    string_to_expr("a::z.froob(b,&(987+3))");
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2457 attrs_fix_bug
upstream_test("attrs_fix_bug", () => {
  create_default_session_globals_then(() => {
    string_to_item(
      `pub fn mk_file_writer(path: &Path, flags: &[FileFlag])
                -> Result<Box<Writer>, String> {
#[cfg(windows)]
fn wb() -> c_int {
    (O_WRONLY | libc::consts::os::extra::O_BINARY) as c_int
}

#[cfg(unix)]
fn wb() -> c_int { O_WRONLY as c_int }

let mut fflags: c_int = wb();
}`,
    );
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2478 crlf_doc_comments
upstream_test("crlf_doc_comments", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();

    {
      const name_1: FileName = { $: "Custom", _0: "crlf_source_1" };
      const source = "/// doc comment\r\nfn foo() {}";
      const item = unwrap(unwrap_result(parse_item_from_source_str(name_1, source, psess)));
      const doc = unwrap(first_doc_str(item.attrs));
      assert_eq(Symbol.as_str(doc), " doc comment", debug_str);
    }

    {
      const name_2: FileName = { $: "Custom", _0: "crlf_source_2" };
      const source = "/// doc comment\r\n/// line 2\r\nfn foo() {}";
      const item = unwrap(unwrap_result(parse_item_from_source_str(name_2, source, psess)));
      const docs = item.attrs.map((at) => at.doc_str()).filter((s): s is Symbol => s !== undefined);
      const b: readonly Symbol[] = [Symbol.intern(" doc comment"), Symbol.intern(" line 2")];
      assert_eq<readonly Symbol[]>(
        docs,
        b,
        (v) => debug_vec(v, PLAIN, debug_Symbol),
        (x, y) => x.length === y.length && x.every((s, i) => s === y[i]),
      );
    }

    {
      const name_3: FileName = { $: "Custom", _0: "clrf_source_3" };
      const source = "/** doc comment\r\n *  with CRLF */\r\nfn foo() {}";
      const item = unwrap(unwrap_result(parse_item_from_source_str(name_3, source, psess)));
      const doc = unwrap(first_doc_str(item.attrs));
      assert_eq(Symbol.as_str(doc), " doc comment\n *  with CRLF ", debug_str);
    }
  });
});

/** PORT: `attrs.iter().filter_map(|at| at.doc_str()).next()` (test scaffolding). */
function first_doc_str(attrs: readonly ast.Attribute[]): Symbol | undefined {
  for (const at of attrs) {
    const s = at.doc_str();
    if (s !== undefined) return s;
  }
  return undefined;
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2504 ttdelim_span
upstream_test("ttdelim_span", () => {
  // rustc: compiler/rustc_parse/src/parser/tests.rs:2505 parse_expr_from_source_str
  function parse_expr_from_source_str(name: FileName, source: string, psess: ParseSess): PResult<Expr> {
    return unwrap_or_emit_fatal(new_parser_from_source_str(psess, name, source, "Nothing")).parse_expr();
  }

  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const expr = unwrap_result(
      parse_expr_from_source_str(filename(psess.source_map(), "foo"), "foo!( fn main() { body } )", psess),
    );

    if (expr.kind.$ !== "MacCall") return panic("not a macro");
    const mac = expr.kind._0;
    const span = TokenTree.span(unwrap(collect_tts(mac.args.tokens.iter()).at(-1)));

    const r = psess.source_map().span_to_snippet(span);
    switch (r.$) {
      case "Ok":
        assert_eq(r._0.toString(), "{ body }", debug_str);
        break;
      case "Err":
        panic("could not get snippet");
    }
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2534 look
function look(p: Parser, dist: number, kind: TokenKind): void {
  // Do the `assert_eq` outside the closure so that `track_caller` works.
  // (`#![feature(closure_track_caller)]` + `#[track_caller]` on the closure
  // doesn't give the line number in the test below if the assertion fails.)
  const tok = p.look_ahead(dist, (tok) => tok);
  expect(token.TokenKind_eq(kind, tok.kind)).toBe(true);
}

// rustc: compiler/rustc_parse/src/parser/tests.rs:2543 look_ahead
upstream_test("look_ahead", () => {
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
upstream_test("look_ahead_non_outermost_stream", () => {
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
upstream_test("debug_lookahead", () => {
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

// This tests that when parsing a string (rather than a file) we don't try
// and read in a file for a module declaration and just parse a stub.
// See `recurse_into_file_modules` in the parser.
// rustc: compiler/rustc_parse/src/parser/tests.rs:2877 out_of_line_mod
upstream_test("out_of_line_mod", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const item = unwrap(
      unwrap_result(
        parse_item_from_source_str(
          filename(psess.source_map(), "foo"),
          "mod foo { struct S; mod this_does_not_exist; }",
          psess,
        ),
      ),
    );

    if (item.kind.$ !== "Mod") return panic();
    const mod_kind = item.kind._2;
    assert_matches(
      mod_kind,
      mod_kind.$ === "Loaded" && mod_kind._0.length === 2,
      "ast::ModKind::Loaded(items, ..) if items.len() == 2",
      (v) => ast.debug_ModKind(v, PLAIN),
    );
  });
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2894 eqmodws
upstream_test("eqmodws", () => {
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
upstream_test("pattern_whitespace", () => {
  expect(matches_codepattern("", "\x0C")).toBe(false);
  expect(matches_codepattern("a b ", "a   \u{0085}\n\t\r  b")).toBe(true);
  expect(matches_codepattern("a b", "a   \u{0085}\n\t\r  b ")).toBe(false);
});

// rustc: compiler/rustc_parse/src/parser/tests.rs:2916 non_pattern_whitespace
upstream_test("non_pattern_whitespace", () => {
  // These have the property 'White_Space' but not 'Pattern_White_Space'
  expect(matches_codepattern("a b", "a\u{2002}b")).toBe(false);
  expect(matches_codepattern("a   b", "a\u{2002}b")).toBe(false);
  expect(matches_codepattern("\u{205F}a   b", "ab")).toBe(false);
  expect(matches_codepattern("a  \u{3000}b", "ab")).toBe(false);
});

// The `debug_lookahead` expectations, verbatim from tests.rs.
const EXPECTED_0 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_7 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"fn\",\n            Normal,\n        ),\n        Ident(\n            \"f\",\n            Normal,\n        ),\n        OpenParen,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        Colon,\n        Ident(\n            \"u32\",\n            Normal,\n        ),\n        CloseParen,\n    ],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_15 = "Parser {\n    prev_token: Token {\n        kind: Question,\n        span: Span {\n            lo: BytePos(\n                0,\n            ),\n            hi: BytePos(\n                0,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"fn\",\n            Normal,\n        ),\n        Ident(\n            \"f\",\n            Normal,\n        ),\n        OpenParen,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        Colon,\n        Ident(\n            \"u32\",\n            Normal,\n        ),\n        CloseParen,\n        OpenBrace,\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        CloseBrace,\n        Ident(\n            \"struct\",\n            Normal,\n        ),\n        Ident(\n            \"S\",\n            Normal,\n        ),\n        Semi,\n        Eof,\n    ],\n    approx_token_stream_pos: 0,\n    ..\n}";
const EXPECTED_1 = "Parser {\n    prev_token: Token {\n        kind: OpenBrace,\n        span: Span {\n            lo: BytePos(\n                13,\n            ),\n            hi: BytePos(\n                14,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"x\",\n            Normal,\n        ),\n    ],\n    approx_token_stream_pos: 8,\n    ..\n}";
const EXPECTED_4 = "Parser {\n    prev_token: Token {\n        kind: OpenBrace,\n        span: Span {\n            lo: BytePos(\n                13,\n            ),\n            hi: BytePos(\n                14,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Ident(\n            \"x\",\n            Normal,\n        ),\n        CloseBrace,\n        Ident(\n            \"struct\",\n            Normal,\n        ),\n        Ident(\n            \"S\",\n            Normal,\n        ),\n    ],\n    approx_token_stream_pos: 8,\n    ..\n}";
const EXPECTED_3 = "Parser {\n    prev_token: Token {\n        kind: Eof,\n        span: Span {\n            lo: BytePos(\n                27,\n            ),\n            hi: BytePos(\n                28,\n            ),\n            ctxt: #0,\n        },\n    },\n    tokens: [\n        Eof,\n    ],\n    approx_token_stream_pos: 14,\n    ..\n}";
