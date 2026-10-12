// Oracle-derived tests for util/literal.ts (`LitKind::from_token_lit`, `LitKind` Display).
// Not an upstream test file (review w23b, ast-token F3).
//
// How the expectations were obtained (pinned nightly, rustc 1.101.0-nightly 6f5da406b):
// - The source `fn main() { let _ = <lit>; ... }` with the literals below was run through
//   `rustc +nightly --edition 2024 -Zunpretty=ast-tree` (token `Lit { kind, symbol, suffix }`:
//   the inputs), `-Zunpretty=hir-tree` (`hir::Lit.node`, the `ast::LitKind` produced by
//   `LitKind::from_token_lit` during lowering, printed with `{:#?}`: the `debug` column) and
//   `-Zunpretty=hir` (`rustc_hir_pretty::print_literal` = `lit.node.to_string()`, i.e.
//   `LitKind` Display: the `display` column).
// - The error cases come from the diagnostics `report_lit_error` (rustc_session diagnostics.rs)
//   prints for each `LitError` variant on the same kind of input:
//   `invalid width `7` for integer literal` = InvalidIntSuffix, `... for float literal` =
//   InvalidFloatSuffix, `integer literal is too large` + `value exceeds limit of `0b111..``
//   = IntTooLarge(2) (limit printed in base 2) / `340282366920938463463374607431768211455`
//   = IntTooLarge(10), `suffixes on string literals are invalid` = InvalidSuffix.
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { debug_LitKind } from "../ast.ts";
import { Lit as TokenLit, LitKind as TokenLitKind } from "../token.ts";
import { debug_LitError, display_LitKind, LitKind } from "./literal.ts";

const run = <R>(f: () => R): R => create_default_session_globals_then(f);

function token_kind(kind: string, n: number | undefined): TokenLitKind {
  if (n !== undefined) return { $: kind, _0: n } as TokenLitKind;
  return (TokenLitKind as unknown as Record<string, TokenLitKind>)[kind]!;
}

function token_lit(kind: string, n: number | undefined, symbol: string, suffix: string | undefined): TokenLit {
  return TokenLit.new(token_kind(kind, n), Symbol.intern(symbol), suffix === undefined ? undefined : Symbol.intern(suffix));
}

// [token kind, raw hashes, token symbol, token suffix, LitKind {:#?}, LitKind Display]
// Source literals, in order: "a\n\t\"\\\u{e9}é\0\r'x", "multi\<newline> line", r#"a"b\n"#,
// b"\x80\n'\"A", br"\x", c"ab\u{e9}\x01", cr"x\y", '\'', '"', 'é', b'\xff', b'"', 1u8,
// 0x_ff_u16, 0o17, 0b101i64, 1_000, 1f32, 1.5e3, 1e10_f64, 2.5, u128::MAX with `u128`.
const CASES: [string, number | undefined, string, string | undefined, string, string][] = [
  ["Str", undefined, "a\\n\\t\\\"\\\\\\u{e9}é\\0\\r'x", undefined, "Str(\n    \"a\\n\\t\\\"\\\\éé\\0\\r'x\",\n    Cooked,\n)", "\"a\\n\\t\\\"\\\\\\u{e9}\\u{e9}\\u{0}\\r\\'x\""],
  ["Str", undefined, "multi\\\n             line", undefined, "Str(\n    \"multiline\",\n    Cooked,\n)", "\"multiline\""],
  ["StrRaw", 1, "a\"b\\n", undefined, "Str(\n    \"a\\\"b\\\\n\",\n    Raw(\n        1,\n    ),\n)", "r#\"a\"b\\n\"#"],
  ["ByteStr", undefined, "\\x80\\n'\\\"A", undefined, "ByteStr(\n    [\n        128,\n        10,\n        39,\n        34,\n        65,\n    ],\n    Cooked,\n)", "b\"\\x80\\n\\'\\\"A\""],
  ["ByteStrRaw", 0, "\\x", undefined, "ByteStr(\n    [\n        92,\n        120,\n    ],\n    Raw(\n        0,\n    ),\n)", "br\"\\x\""],
  ["CStr", undefined, "ab\\u{e9}\\x01", undefined, "CStr(\n    [\n        97,\n        98,\n        195,\n        169,\n        1,\n        0,\n    ],\n    Cooked,\n)", "c\"ab\\xc3\\xa9\\x01\\x00\""],
  ["CStrRaw", 0, "x\\y", undefined, "CStr(\n    [\n        120,\n        92,\n        121,\n        0,\n    ],\n    Raw(\n        0,\n    ),\n)", "cr\"x\\y\u0000\""],
  ["Char", undefined, "\\'", undefined, "Char(\n    '\\'',\n)", "'\\''"],
  ["Char", undefined, "\"", undefined, "Char(\n    '\"',\n)", "'\\\"'"],
  ["Char", undefined, "é", undefined, "Char(\n    'é',\n)", "'\\u{e9}'"],
  ["Byte", undefined, "\\xff", undefined, "Byte(\n    255,\n)", "b'\\xff'"],
  ["Byte", undefined, "\"", undefined, "Byte(\n    34,\n)", "b'\\\"'"],
  ["Integer", undefined, "1", "u8", "Int(\n    Pu128(\n        1,\n    ),\n    Unsigned(\n        u8,\n    ),\n)", "1u8"],
  ["Integer", undefined, "0x_ff_", "u16", "Int(\n    Pu128(\n        255,\n    ),\n    Unsigned(\n        u16,\n    ),\n)", "255u16"],
  ["Integer", undefined, "0o17", undefined, "Int(\n    Pu128(\n        15,\n    ),\n    Unsuffixed,\n)", "15"],
  ["Integer", undefined, "0b101", "i64", "Int(\n    Pu128(\n        5,\n    ),\n    Signed(\n        i64,\n    ),\n)", "5i64"],
  ["Integer", undefined, "1_000", undefined, "Int(\n    Pu128(\n        1000,\n    ),\n    Unsuffixed,\n)", "1000"],
  ["Integer", undefined, "1", "f32", "Float(\n    \"1\",\n    Suffixed(\n        f32,\n    ),\n)", "1f32"],
  ["Float", undefined, "1.5e3", undefined, "Float(\n    \"1.5e3\",\n    Unsuffixed,\n)", "1.5e3"],
  ["Float", undefined, "1e10_", "f64", "Float(\n    \"1e10\",\n    Suffixed(\n        f64,\n    ),\n)", "1e10f64"],
  ["Float", undefined, "2.5", undefined, "Float(\n    \"2.5\",\n    Unsuffixed,\n)", "2.5"],
  ["Integer", undefined, "340282366920938463463374607431768211455", "u128", "Int(\n    Pu128(\n        340282366920938463463374607431768211455,\n    ),\n    Unsigned(\n        u128,\n    ),\n)", "340282366920938463463374607431768211455u128"],
];

test("LitKind::from_token_lit and Display (oracle: -Zunpretty=hir-tree / hir)", () =>
  run(() => {
    for (const [kind, n, symbol, suffix, debug, display] of CASES) {
      const r = LitKind.from_token_lit(token_lit(kind, n, symbol, suffix));
      if (r.$ !== "Ok") throw new Error(`${kind} ${symbol}: ${debug_LitError(r._0, PLAIN)}`);
      expect(debug_LitKind(r._0, PRETTY)).toBe(debug);
      expect(display_LitKind(r._0)).toBe(display);
    }
  }));

test("LitKind::from_token_lit: hex integer whose digits look like a suffix", () =>
  run(() => {
    // oracle: `let _ = 0x1f32;` -> ast-tree `Lit { kind: Integer, symbol: "0x1f32", suffix: None }`,
    // hir-tree `Int(Pu128(7986), Unsuffixed)`.
    const r = LitKind.from_token_lit(token_lit("Integer", undefined, "0x1f32", undefined));
    expect(r.$ === "Ok" && debug_LitKind(r._0, PLAIN)).toBe("Int(Pu128(7986), Unsuffixed)");
  }));

test("LitKind::from_token_lit errors (oracle: report_lit_error diagnostics)", () =>
  run(() => {
    const err = (kind: string, symbol: string, suffix: string | undefined): string => {
      const r = LitKind.from_token_lit(token_lit(kind, undefined, symbol, suffix));
      return r.$ === "Err" ? debug_LitError(r._0, PLAIN) : `Ok(${debug_LitKind(r._0, PLAIN)})`;
    };
    // `1u7`: error: invalid width `7` for integer literal
    expect(err("Integer", "1", "u7")).toBe('InvalidIntSuffix("u7")');
    // `1.0f7`: error: invalid width `7` for float literal
    expect(err("Float", "1.0", "f7")).toBe('InvalidFloatSuffix("f7")');
    // `0b` + 129 ones: integer literal is too large; note: value exceeds limit of `0b` + 128 ones
    expect(err("Integer", "0b" + "1".repeat(129), undefined)).toBe("IntTooLarge(2)");
    // `340282366920938463463374607431768211456`: ... value exceeds limit of `340282366920938463463374607431768211455`
    expect(err("Integer", "340282366920938463463374607431768211456", undefined)).toBe("IntTooLarge(10)");
    // `"a"x`: error: suffixes on string literals are invalid (invalid suffix `x`)
    expect(err("Str", "a", "x")).toBe('InvalidSuffix("x")');
  }));
