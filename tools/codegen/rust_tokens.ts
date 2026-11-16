// Rust token streams for the rustfmt/serde generators (tools/codegen/rustfmt.ts, serde.ts, config_type.ts) and their oracle
// check (tools/codegen/rustfmt_oracle.ts): text lexed with the ported rustc_lexer, whitespace and comments dropped, so two
// texts that differ only in layout (rustc's `-Zunpretty=expanded` pretty-printer against a generator's rendering) compare equal.
import { FrontmatterAllowed, tokenize, type Token } from "../../src/rustc_lexer/lib.ts";
import { Str } from "../../src/std/str.ts";

export interface RTok {
  kind: Token["kind"]["$"];
  text: string;
  line: number;
}

/** Tokens of `src` without whitespace and comments (doc comments too: the pretty-printer prints them as `#[doc = ..]`). */
export function lexRust(src: string): RTok[] {
  const s = Str.from(src);
  const out: RTok[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(s, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    const text = s.slice(pos, pos + tok.len).toString();
    if (k !== "Whitespace" && k !== "BlockComment" && k !== "LineComment") out.push({ kind: k, text, line });
    for (let i = pos; i < pos + tok.len; i++) if (s.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

const CLOSE: Record<string, string> = { OpenParen: "CloseParen", OpenBracket: "CloseBracket", OpenBrace: "CloseBrace" };

/** Index of the delimiter closing the group that opens at `open`; throws on unbalanced input. */
export function closeOf(toks: RTok[], open: number): number {
  const stack: string[] = [];
  for (let i = open; i < toks.length; i++) {
    const k = toks[i]!.kind;
    if (k in CLOSE) stack.push(CLOSE[k]!);
    else if (k === "CloseParen" || k === "CloseBracket" || k === "CloseBrace") {
      if (stack.pop() !== k) throw new Error(`unbalanced delimiters at line ${toks[i]!.line}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error(`unclosed delimiter at line ${toks[open]?.line}`);
}

/** The token texts joined by single spaces: the layout-free form two renderings are compared in. */
export const joinToks = (toks: readonly RTok[]): string => toks.map((t) => t.text).join(" ");

/** `src` in the layout-free form. */
export const normRust = (src: string): string => joinToks(lexRust(src));

/** The first differing token of two layout-free texts, with a little context, or `undefined` if they are equal. */
export function firstTokenDiff(expected: string, actual: string): string | undefined {
  if (expected === actual) return undefined;
  const a = expected.split(" ");
  const b = actual.split(" ");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (x: string[]) => x.slice(Math.max(0, i - 12), i + 8).join(" ");
  return `token ${i}: expected …${ctx(a)}… got …${ctx(b)}…`;
}
