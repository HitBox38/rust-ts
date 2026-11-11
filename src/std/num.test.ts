// src/std helpers hoisted by lane driver-cli-2 (docs/reviews/driver-cli.md N4): `<u16/u32 as FromStr>::from_str`
// (num.ts), `Path::extension` (path.ts) and `str::trim{,_start,_end}` on JS strings (str.ts). The expected lines are
// the output of a Rust program built with the pinned toolchain (`rustc +nightly`, 6f5da406b) that prints
// `{s:?} u16={:?} u32={:?}` (errors as `{:?}` of `kind()`), `{p:?} ext={:?}` and `{s:?} trim={:?} start={:?} end={:?}`
// for the same inputs; the TS side formats its values the same way.
import { expect, test } from "bun:test";
import { debug_str } from "./fmt.ts";
import { u16_from_str, u32_from_str } from "./num.ts";
import { path_extension } from "./path.ts";
import type { Result } from "./result.ts";
import { string_trim, string_trim_end, string_trim_start } from "./str.ts";

const res = (x: Result<number, { kind: string }>): string => (x.$ === "Ok" ? `Ok(${x._0})` : `Err(${JSON.stringify(x._0.kind)})`);

const INTS = [
  "", "+", "-", "+5", "-5", "-0", "0", "65535", "65536", "0000065535", "4294967295", "4294967296", "1 ", " 1", "\u0661",
  "99999999999x", "6553x", "++1", "+-1", "007", "18446744073709551616",
];
const PATHS = ["foo.rs", "foo.tar.gz", ".rs", "foo.", "foo", "..", ".", "a/b.rs", "a/.b", "a/b./", "/", "", "a/..", "dir.d/file", "x.rs/"];
const TRIMS = ["  a b \t\n", "\u3000x\u2029", "", "   ", "\u0085y\u00a0", "\u200bz"];

// The Rust program's stdout, one line per entry. PORT: not a `String.raw` template: Bun rewrites a non-ASCII char in
// source as a `\u` escape, which `raw` would keep as text.
const RUST: string[] = [
  "\"\" u16=Err(\"Empty\") u32=Err(\"Empty\")",
  "\"+\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"-\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"+5\" u16=Ok(5) u32=Ok(5)",
  "\"-5\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"-0\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"0\" u16=Ok(0) u32=Ok(0)",
  "\"65535\" u16=Ok(65535) u32=Ok(65535)",
  "\"65536\" u16=Err(\"PosOverflow\") u32=Ok(65536)",
  "\"0000065535\" u16=Ok(65535) u32=Ok(65535)",
  "\"4294967295\" u16=Err(\"PosOverflow\") u32=Ok(4294967295)",
  "\"4294967296\" u16=Err(\"PosOverflow\") u32=Err(\"PosOverflow\")",
  "\"1 \" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\" 1\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"١\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"99999999999x\" u16=Err(\"PosOverflow\") u32=Err(\"PosOverflow\")",
  "\"6553x\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"++1\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"+-1\" u16=Err(\"InvalidDigit\") u32=Err(\"InvalidDigit\")",
  "\"007\" u16=Ok(7) u32=Ok(7)",
  "\"18446744073709551616\" u16=Err(\"PosOverflow\") u32=Err(\"PosOverflow\")",
  "\"foo.rs\" ext=Some(\"rs\")",
  "\"foo.tar.gz\" ext=Some(\"gz\")",
  "\".rs\" ext=None",
  "\"foo.\" ext=Some(\"\")",
  "\"foo\" ext=None",
  "\"..\" ext=None",
  "\".\" ext=None",
  "\"a/b.rs\" ext=Some(\"rs\")",
  "\"a/.b\" ext=None",
  "\"a/b./\" ext=Some(\"\")",
  "\"/\" ext=None",
  "\"\" ext=None",
  "\"a/..\" ext=None",
  "\"dir.d/file\" ext=None",
  "\"x.rs/\" ext=Some(\"rs\")",
  "\"  a b \\t\\n\" trim=\"a b\" start=\"a b \\t\\n\" end=\"  a b\"",
  "\"\\u{3000}x\\u{2029}\" trim=\"x\" start=\"x\\u{2029}\" end=\"\\u{3000}x\"",
  "\"\" trim=\"\" start=\"\" end=\"\"",
  "\"   \" trim=\"\" start=\"\" end=\"\"",
  "\"\\u{85}y\\u{a0}\" trim=\"y\" start=\"y\\u{a0}\" end=\"\\u{85}y\"",
  "\"\\u{200b}z\" trim=\"\\u{200b}z\" start=\"\\u{200b}z\" end=\"\\u{200b}z\"",
];

test("from_str, extension and trim match Rust", () => {
  const out: string[] = [];
  for (const s of INTS) out.push(`${debug_str(s)} u16=${res(u16_from_str(s))} u32=${res(u32_from_str(s))}`);
  for (const p of PATHS) {
    const e = path_extension(p);
    out.push(`${debug_str(p)} ext=${e === undefined ? "None" : `Some(${debug_str(e)})`}`);
  }
  for (const s of TRIMS) out.push(`${debug_str(s)} trim=${debug_str(string_trim(s))} start=${debug_str(string_trim_start(s))} end=${debug_str(string_trim_end(s))}`);
  expect(out).toEqual(RUST);
});
