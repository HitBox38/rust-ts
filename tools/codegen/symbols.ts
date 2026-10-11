// Generates src/rustc_span/symbol.gen.ts from the `symbols! { Keywords { .. } Symbols { .. } }`
// invocation in upstream compiler/rustc_span/src/symbol.rs, reproducing the semantics of the
// proc macro in compiler/rustc_macros/src/symbols.rs (`symbols_with_errors`):
//   - prefill order: keywords, symbols (non-`env!`), digits 0..=9, letters A..=Z a..=z,
//     then `env!` symbols whose value is not already present;
//   - a duplicated string is an error (except for `env!` symbols, which reuse the index);
//   - `SYMBOL_*_BASE` constants and `PREDEFINED_SYMBOLS_COUNT`.
// The macro source is tokenized with our own rustc_lexer port.
//
//   bun tools/codegen/symbols.ts           write the file
//   bun tools/codegen/symbols.ts --check   ERROR if the committed file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterAllowed, tokenize, type Token } from "../../src/rustc_lexer/lib.ts";
import { Str, utf8_len } from "../../src/std/str.ts";
import { PIN, REPO, UPSTREAM, die, requireUpstream } from "../../scripts/lib/common.ts";

const SRC_PATH = "compiler/rustc_span/src/symbol.rs";
const OUT_PATH = "src/rustc_span/symbol.gen.ts";

/// Values of the environment variables that rustc's build sets for `env!(..)` symbols.
/// `CFG_RELEASE` is the release string printed by `rustc -vV` (`release: ...`).
const ENV: Record<string, string> = { CFG_RELEASE: PIN.release };

interface Tok {
  kind: Token["kind"];
  text: string;
  line: number;
}

function lex(src: Str): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    const text = src.slice(pos, pos + tok.len).toString();
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") out.push({ kind: tok.kind, text, line });
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

/** `LitStr::value()` for a `"..."` or `r#"..."#` literal token (no suffix allowed). */
function str_value(t: Tok): string {
  const k = t.kind;
  if (k.$ !== "Literal") fail(t, "expected a string literal");
  const lit = k.kind;
  if (k.suffix_start !== utf8_len(t.text)) fail(t, "string literal suffixes are not supported");
  if (lit.$ === "RawStr") {
    const n = lit.n_hashes;
    if (n === undefined) fail(t, "invalid raw string literal");
    return t.text.slice(2 + n, t.text.length - 1 - n);
  }
  if (lit.$ !== "Str" || !lit.terminated) fail(t, "expected a string literal");
  return unescape(t, t.text.slice(1, -1));
}

/** Rust string-literal escapes (`rustc_literal_escaper::unescape_str` semantics). */
function unescape(t: Tok, s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\r") fail(t, "bare CR in string literal");
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const e = s[i + 1];
    i += 2;
    switch (e) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "\\":
        out += "\\";
        break;
      case "0":
        out += "\0";
        break;
      case "'":
        out += "'";
        break;
      case '"':
        out += '"';
        break;
      case "x": {
        const h = s.slice(i, i + 2);
        if (!/^[0-7][0-9a-fA-F]$/.test(h)) fail(t, `bad \\x escape`);
        out += String.fromCharCode(parseInt(h, 16));
        i += 2;
        break;
      }
      case "u": {
        const m = /^\{([0-9a-fA-F_]{1,8})\}/.exec(s.slice(i));
        if (!m || m[1]!.startsWith("_")) fail(t, `bad \\u escape`);
        const cp = parseInt(m[1]!.replaceAll("_", ""), 16);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail(t, `bad \\u escape`);
        out += String.fromCodePoint(cp);
        i += m[0].length;
        break;
      }
      case "\n":
        // Line continuation: skip the newline and following ASCII whitespace.
        while (i < s.length && " \t\n\r".includes(s[i]!)) i++;
        break;
      default:
        fail(t, `unknown escape \\${e}`);
    }
  }
  return out;
}

function fail(t: Tok | undefined, msg: string): never {
  die(`${SRC_PATH}:${t?.line ?? "?"}: ${msg}${t ? ` (at \`${t.text}\`)` : ""}`);
}

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  next(): Tok {
    const t = this.toks[this.i++];
    if (t === undefined) fail(undefined, "unexpected end of input");
    return t;
  }
  eat(kind: string): boolean {
    if (this.peek()?.kind.$ === kind) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(kind: string, text?: string): Tok {
    const t = this.next();
    if (t.kind.$ !== kind || (text !== undefined && t.text !== text)) fail(t, `expected ${text ?? kind}`);
    return t;
  }
  ident(): Tok {
    const t = this.next();
    if (t.kind.$ === "RawIdent") fail(t, "raw identifiers are not supported");
    if (t.kind.$ !== "Ident") fail(t, "expected identifier");
    return t;
  }
}

type Value = { $: "SameAsName" } | { $: "String"; value: string } | { $: "Env"; var: string };

interface Entry {
  name: Tok;
  value: Value;
}

/** `Punctuated::parse_terminated` over a braced group. */
function terminated(p: Parser, item: (p: Parser) => Entry): Entry[] {
  p.expect("OpenBrace");
  const out: Entry[] = [];
  while (!p.eat("CloseBrace")) {
    out.push(item(p));
    if (p.eat("CloseBrace")) break;
    p.expect("Comma");
  }
  return out;
}

function parse_keyword(p: Parser): Entry {
  const name = p.ident();
  p.expect("Colon");
  return { name, value: { $: "String", value: str_value(p.next()) } };
}

function parse_symbol(p: Parser): Entry {
  const name = p.ident();
  if (!p.eat("Colon")) return { name, value: { $: "SameAsName" } };
  const t = p.next();
  if (t.kind.$ === "Literal") return { name, value: { $: "String", value: str_value(t) } };
  // `env!("VAR")` with any delimiter; anything else is `Value::Unsupported` (a macro error).
  if (t.kind.$ === "Ident" && t.text === "env" && p.eat("Bang")) {
    const open = p.next();
    const close = { OpenParen: "CloseParen", OpenBracket: "CloseBracket", OpenBrace: "CloseBrace" }[open.kind.$ as string];
    if (close !== undefined) {
      const lit = p.next();
      p.expect(close);
      return { name, value: { $: "Env", var: str_value(lit) } };
    }
  }
  fail(t, "unsupported expression for symbol value");
}

function main(): void {
  requireUpstream();
  const bytes = readFileSync(join(UPSTREAM, SRC_PATH));
  const toks = lex(Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  const start = toks.findIndex((t, i) => t.text === "symbols" && toks[i + 1]?.kind.$ === "Bang" && toks[i + 2]?.kind.$ === "OpenBrace");
  if (start < 0) die(`${SRC_PATH}: no symbols! invocation`);
  const p = new Parser(toks);
  p.i = start + 2;
  p.expect("OpenBrace");
  p.expect("Ident", "Keywords");
  const keywords = terminated(p, parse_keyword);
  p.expect("Ident", "Symbols");
  const symbols = terminated(p, parse_symbol);
  p.expect("CloseBrace");

  // Entries::insert
  const entries = new Map<string, number>();
  const prefill: string[] = [];
  const insert = (t: Tok | undefined, s: string): number => {
    const prev = entries.get(s);
    if (prev !== undefined) fail(t, `Symbol \`${s}\` is duplicated`);
    const idx = entries.size;
    entries.set(s, idx);
    prefill.push(s);
    return idx;
  };
  const kw: [string, number][] = [];
  const sym: [string, number][] = [];
  const names = (list: [string, number][], t: Tok): void => {
    if (t.text === "__proto__") fail(t, "name cannot be a JS object key");
    if (list.some(([n]) => n === t.text)) fail(t, `duplicate definition of \`${t.text}\``);
  };

  for (const k of keywords) {
    if (k.value.$ !== "String") fail(k.name, "keyword needs a string value");
    names(kw, k.name);
    kw.push([k.name.text, insert(k.name, k.value.value)]);
  }
  for (const s of symbols) {
    let value: string;
    if (s.value.$ === "SameAsName") value = s.name.text;
    else if (s.value.$ === "String") value = s.value.value;
    else continue; // Env: in another loop below
    names(sym, s.name);
    sym.push([s.name.text, insert(s.name, value)]);
  }
  const ints = Array.from({ length: 10 }, (_, n) => String(n));
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];
  for (const s of [...ints, ...letters]) insert(undefined, s);
  for (const s of symbols) {
    if (s.value.$ !== "Env") continue;
    const value = ENV[s.value.var];
    if (value === undefined) fail(s.name, `environment variable ${s.value.var} has no known value`);
    names(sym, s.name);
    sym.push([s.name.text, entries.get(value) ?? insert(s.name, value)]);
  }

  const lines: string[] = [];
  lines.push(`// GENERATED by tools/codegen/symbols.ts from ${SRC_PATH} (symbols! macro) at ${PIN.commit.slice(0, 12)}. Do not edit.`);
  lines.push(`// Semantics: compiler/rustc_macros/src/symbols.rs. env!("CFG_RELEASE") = ${JSON.stringify(ENV.CFG_RELEASE)}.`);
  lines.push(`import type { Symbol } from "./symbol.ts";`);
  lines.push("");
  lines.push(`export const SYMBOL_DIGITS_BASE: number = ${entries.get("0")};`);
  lines.push(`export const SYMBOL_UPPERCASE_LETTERS_BASE: number = ${entries.get("A")};`);
  lines.push(`export const SYMBOL_LOWERCASE_LETTERS_BASE: number = ${entries.get("a")};`);
  lines.push("");
  lines.push("/// The number of predefined symbols; this is the first index for");
  lines.push("/// extra pre-interned symbols in an Interner created via");
  lines.push("/// [`Interner::with_extra_symbols`].");
  lines.push(`export const PREDEFINED_SYMBOLS_COUNT: number = ${entries.size};`);
  lines.push("");
  lines.push("export const kw_generated = {");
  for (const [n, i] of kw) lines.push(`  ${n}: ${i} as Symbol,`);
  lines.push("} as const;");
  lines.push("");
  lines.push("export const sym_generated = {");
  for (const [n, i] of sym) lines.push(`  ${n}: ${i} as Symbol,`);
  lines.push("} as const;");
  lines.push("");
  lines.push("/// The `&[..]` passed to `Interner::prefill` by `Interner::with_extra_symbols`.");
  lines.push("export const PREFILL: readonly string[] = [");
  for (const s of prefill) lines.push(`  ${JSON.stringify(s)},`);
  lines.push("];");
  const text = lines.join("\n") + "\n";

  const out = join(REPO, OUT_PATH);
  if (process.argv.includes("--check")) {
    let cur = "";
    try {
      cur = readFileSync(out, "utf8");
    } catch {}
    if (cur !== text) die(`${OUT_PATH} is stale; run: bun tools/codegen/symbols.ts`);
    console.log(`${OUT_PATH} up to date (${entries.size} predefined symbols)`);
    return;
  }
  writeFileSync(out, text);
  console.log(`wrote ${OUT_PATH}: ${kw.length} keywords, ${sym.length} symbols, ${entries.size} predefined`);
}

main();
