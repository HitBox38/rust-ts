// Oracle-derived tests for `Token::glue` and `TokenKind::break_two_token_op`.
// Not an upstream test file (review w23b, ast-token F3).
//
// How the expectations were obtained (pinned nightly, rustc 1.101.0-nightly 6f5da406b):
// `rustc +nightly -Zunpretty=ast-tree` on an unexpanded macro call prints the lexer's token
// stream (`MacCall { args: DelimArgs { tokens: TokenStream([Token(Token { kind, .. }, spacing)..]) } }`).
// The rustc_parse lexer (lexer/tokentrees.rs:173) glues each new single-char token onto the
// previous one with `Token::glue`, left to right, so the printed kinds are glue results:
//   `m!(== => <= << <<= <- >= >> >>= != += -= -> *= /= %= ^= &= && |= || .. ... ..= ::
//       < <= > >= . .. : ! = + - * / % ^ & | ~ @ # $ ? , ;);`
//   -> EqEq FatArrow Le Shl ShlEq LArrow Ge Shr ShrEq Ne PlusEq MinusEq RArrow StarEq SlashEq
//      PercentEq CaretEq AndEq AndAnd OrEq OrOr DotDot DotDotDot DotDotEq PathSep Lt Le Gt Ge Dot
//      DotDot Colon Bang Eq Plus Minus Star Slash Percent Caret And Or Tilde At Pound Dollar
//      Question Comma Semi
//   `m!(++ =< !! <<- ->> ::: ....);`
//   -> Plus Plus, Eq Lt, Bang Bang, Shl Minus, RArrow Gt, PathSep Colon, DotDotDot Dot
//      (each pair: first `Joint`, i.e. adjacent, yet not glued -> `glue` returned `None`).
// The glue arms whose joint token is itself multi-char (`<` `<=`, `>` `>=`, `.` `..`) are not
// reachable from the lexer and are not covered here.
//
// `break_two_token_op(op, n)` splits `op` into the tokens whose texts are the first `n` chars
// and the rest. The expected kinds are the oracle's lexing of each piece on its own (second
// list above: `<` Lt, `<=` Le, `<<` Shl, `..` DotDot, ...); the joined text of the pieces is
// the oracle text of `op` (first list).
import { expect, test } from "bun:test";
import { DUMMY_SP, ErrorGuaranteed } from "../rustc_span/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { debug_TokenKind, LitKind_eq, Token, TokenKind } from "./token.ts";

const K = TokenKind as unknown as Record<string, TokenKind>;
const tok = (k: string): Token => Token.new(K[k]!, DUMMY_SP);
const glued = (a: string, b: string): string | undefined => {
  const t = tok(a).glue(tok(b));
  return t === undefined ? undefined : debug_TokenKind(t.kind, PLAIN);
};

test("Token::glue: pairs the lexer glues (oracle: -Zunpretty=ast-tree)", () => {
  // [first, joint, glued] in the order of the oracle input above.
  const cases: [string, string, string][] = [
    ["Eq", "Eq", "EqEq"],
    ["Eq", "Gt", "FatArrow"],
    ["Lt", "Eq", "Le"],
    ["Lt", "Lt", "Shl"],
    ["Shl", "Eq", "ShlEq"],
    ["Lt", "Minus", "LArrow"],
    ["Gt", "Eq", "Ge"],
    ["Gt", "Gt", "Shr"],
    ["Shr", "Eq", "ShrEq"],
    ["Bang", "Eq", "Ne"],
    ["Plus", "Eq", "PlusEq"],
    ["Minus", "Eq", "MinusEq"],
    ["Minus", "Gt", "RArrow"],
    ["Star", "Eq", "StarEq"],
    ["Slash", "Eq", "SlashEq"],
    ["Percent", "Eq", "PercentEq"],
    ["Caret", "Eq", "CaretEq"],
    ["And", "Eq", "AndEq"],
    ["And", "And", "AndAnd"],
    ["Or", "Eq", "OrEq"],
    ["Or", "Or", "OrOr"],
    ["Dot", "Dot", "DotDot"],
    ["DotDot", "Dot", "DotDotDot"],
    ["DotDot", "Eq", "DotDotEq"],
    ["Colon", "Colon", "PathSep"],
  ];
  for (const [a, b, c] of cases) expect(glued(a, b)).toBe(c);
});

test("Token::glue: adjacent pairs the lexer leaves apart (oracle: -Zunpretty=ast-tree)", () => {
  const cases: [string, string][] = [
    ["Plus", "Plus"],
    ["Eq", "Lt"],
    ["Bang", "Bang"],
    ["Shl", "Minus"],
    ["RArrow", "Gt"],
    ["PathSep", "Colon"],
    ["DotDotDot", "Dot"],
  ];
  for (const [a, b] of cases) expect(glued(a, b)).toBeUndefined();
});

test("TokenKind::break_two_token_op (pieces lexed by the oracle)", () => {
  const brk = (op: string, n: number): string | undefined => {
    const r = TokenKind.break_two_token_op(K[op]!, n);
    return r === undefined ? undefined : `${debug_TokenKind(r[0], PLAIN)} ${debug_TokenKind(r[1], PLAIN)}`;
  };
  // [op (text), n, first piece kind, second piece kind]
  const cases: [string, number, string][] = [
    ["Le", 1, "Lt Eq"], // `<` `=`
    ["EqEq", 1, "Eq Eq"], // `=` `=`
    ["Ne", 1, "Bang Eq"], // `!` `=`
    ["Ge", 1, "Gt Eq"], // `>` `=`
    ["AndAnd", 1, "And And"], // `&` `&`
    ["OrOr", 1, "Or Or"], // `|` `|`
    ["Shl", 1, "Lt Lt"], // `<` `<`
    ["Shr", 1, "Gt Gt"], // `>` `>`
    ["PlusEq", 1, "Plus Eq"], // `+` `=`
    ["MinusEq", 1, "Minus Eq"], // `-` `=`
    ["StarEq", 1, "Star Eq"], // `*` `=`
    ["SlashEq", 1, "Slash Eq"], // `/` `=`
    ["PercentEq", 1, "Percent Eq"], // `%` `=`
    ["CaretEq", 1, "Caret Eq"], // `^` `=`
    ["AndEq", 1, "And Eq"], // `&` `=`
    ["OrEq", 1, "Or Eq"], // `|` `=`
    ["ShlEq", 1, "Lt Le"], // `<` `<=`
    ["ShlEq", 2, "Shl Eq"], // `<<` `=`
    ["ShrEq", 1, "Gt Ge"], // `>` `>=`
    ["ShrEq", 2, "Shr Eq"], // `>>` `=`
    ["DotDot", 1, "Dot Dot"], // `.` `.`
    ["DotDotDot", 1, "Dot DotDot"], // `.` `..`
    ["DotDotDot", 2, "DotDot Dot"], // `..` `.`
    ["DotDotEq", 2, "DotDot Eq"], // `..` `=`
    ["PathSep", 1, "Colon Colon"], // `:` `:`
    ["RArrow", 1, "Minus Gt"], // `-` `>`
    ["LArrow", 1, "Lt Minus"], // `<` `-`
    ["FatArrow", 1, "Eq Gt"], // `=` `>`
  ];
  for (const [op, n, want] of cases) expect(brk(op, n)).toBe(want);
  // Single-char tokens and splits at a non-boundary give `None`.
  expect(brk("Lt", 1)).toBeUndefined();
  expect(brk("Le", 2)).toBeUndefined();
  expect(brk("DotDotEq", 1)).toBeUndefined();
  expect(() => TokenKind.break_two_token_op(K.ShlEq!, 3)).toThrow("assertion failed: n == 1 || n == 2");
});

// `ErrorGuaranteed(())` is a ZST with derived `PartialEq` (rustc_span lib.rs), so two
// `LitKind::Err(_)` values are always equal, whichever guarantee they carry.
test("LitKind_eq: Err(_) == Err(_)", () => {
  const a = { $: "Err" as const, _0: ErrorGuaranteed.unchecked_error_guaranteed() };
  const b = { $: "Err" as const, _0: ErrorGuaranteed.unchecked_error_guaranteed() };
  expect(LitKind_eq(a, b)).toBe(true);
  expect(LitKind_eq(a, { $: "Str" })).toBe(false);
});
