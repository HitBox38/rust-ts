// Oracle-derived tests for tokenstream.ts (`desugar_doc_comments`, `TokenCursor`).
// Not an upstream test file (upstream's tests live in tokenstream/tests.test.ts); review w23b,
// ast-token F1/F3.
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { debug_TokenKind, Delimiter, Token, TokenKind } from "./token.ts";
import { DelimSpacing, DelimSpan, Spacing, TokenCursor, TokenStream, type TokenTree } from "./tokenstream.ts";

const run = <R>(f: () => R): R => create_default_session_globals_then(f);

// Oracle (pinned nightly, rustc 1.101.0-nightly 6f5da406b): a scratch program
//   macro_rules! m { (#[doc = $s:literal]) => { stringify!($s) } }
//   ... m!(\n/// <doc text>\n) ...
// prints the `StrRaw` literal that `desugar_doc_comments` built; its number of leading `#`s
// after `r` is `num_of_hashes`. `num_of_hashes` is a `u8` that wraps (no overflow checks), so
// it saturates at 255 once 254+ `#`s follow a `"`.
test("desugar_doc_comments: raw-string hash count (oracle: stringify! probe)", () =>
  run(() => {
    const cases: [string, number][] = [
      ["abc d", 0],
      ['abc "d"', 1],
      ['abc "##d##"', 3],
      ['"', 1],
      ['"#', 2],
      ['"###', 4],
      ['"' + "#".repeat(253), 254],
      ['"' + "#".repeat(254), 255],
      ['"' + "#".repeat(255), 255],
      ['"' + "#".repeat(256), 255],
      ['"' + "#".repeat(300), 255],
      ['"' + "#".repeat(300) + ' "##', 255],
    ];
    for (const [text, want] of cases) {
      // `/// <text>`: the doc comment symbol keeps the leading space.
      const doc = Symbol.intern(" " + text);
      const ts = TokenStream.token_alone({ $: "DocComment", _0: "Line", _1: "Outer", _2: doc }, DUMMY_SP);
      ts.desugar_doc_comments();
      // `#` `[doc = r"..."]`
      expect(ts._0.length).toBe(2);
      const body = ts._0[1]!;
      if (body.$ !== "Delimited") throw new Error("expected Delimited");
      const lit = body._3._0[2]!;
      if (lit.$ !== "Token" || lit._0.kind.$ !== "Literal") throw new Error("expected literal");
      expect(lit._0.kind._0.kind).toEqual({ $: "StrRaw", _0: want });
    }
  }));

// Input: the oracle's lexed tree for `m!(a, (b [c]){d}.);` (`rustc +nightly -Zunpretty=ast-tree`,
// `MacCall` args, spans dropped):
//   Token(a, Joint) Token(Comma, Alone)
//   Delimited(DelimSpacing { open: JointHidden, close: JointHidden }, Parenthesis,
//     [Token(b, Alone), Delimited(DelimSpacing { JointHidden, JointHidden }, Bracket, [Token(c, JointHidden)])])
//   Delimited(DelimSpacing { open: JointHidden, close: Joint }, Brace, [Token(d, JointHidden)])
//   Token(Dot, JointHidden)
// Expectation: the parser's linear view of that tree in source-text order, delimiters
// carrying their `DelimSpacing` open/close spacing, then `Eof` (`Alone`) for ever.
test("TokenCursor linearizes the oracle token tree", () =>
  run(() => {
    const ident = (s: string): TokenKind => ({ $: "Ident", _0: Symbol.intern(s), _1: "Normal" });
    const t = (k: TokenKind, sp: Spacing): TokenTree => ({ $: "Token", _0: Token.new(k, DUMMY_SP), _1: sp });
    const d = (open: Spacing, close: Spacing, delim: Delimiter, tts: TokenTree[]): TokenTree => ({
      $: "Delimited",
      _0: DelimSpan.dummy(),
      _1: DelimSpacing.new(open, close),
      _2: delim,
      _3: TokenStream.new(tts),
    });
    const { Joint, Alone, JointHidden } = Spacing;
    const stream = TokenStream.new([
      t(ident("a"), Joint),
      t(TokenKind.Comma, Alone),
      d(JointHidden, JointHidden, Delimiter.Parenthesis, [
        t(ident("b"), Alone),
        d(JointHidden, JointHidden, Delimiter.Bracket, [t(ident("c"), JointHidden)]),
      ]),
      d(JointHidden, Joint, Delimiter.Brace, [t(ident("d"), JointHidden)]),
      t(TokenKind.Dot, JointHidden),
    ]);
    const cursor = TokenCursor.new(stream);
    const got: string[] = [];
    const depths: number[] = [];
    for (let i = 0; i < 14; i++) {
      const [tok, sp] = cursor.next_and_bump();
      got.push(`${debug_TokenKind(tok.kind, PLAIN)} ${sp}`);
      depths.push(cursor.depth());
    }
    expect(got).toEqual([
      'Ident("a", Normal) Joint',
      "Comma Alone",
      "OpenParen JointHidden",
      'Ident("b", Normal) Alone',
      "OpenBracket JointHidden",
      'Ident("c", Normal) JointHidden',
      "CloseBracket JointHidden",
      "CloseParen JointHidden",
      "OpenBrace JointHidden",
      'Ident("d", Normal) JointHidden',
      "CloseBrace Joint",
      "Dot JointHidden",
      "Eof Alone",
      "Eof Alone",
    ]);
    expect(depths).toEqual([0, 0, 1, 1, 2, 2, 1, 0, 1, 1, 0, 0, 0, 0]);
  }));
