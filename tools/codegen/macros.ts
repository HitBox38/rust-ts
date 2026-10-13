// Parsers for the item macros tools/codegen/types.ts expands itself (PORTING.md §5 "Macros inside rustc"):
//   rustc_index::newtype_index! { [docs] [#[attr]..] [vis] struct Name { [docs] const NAME = INT; .. } }
//   bitflags::bitflags! { ([docs] [#[attr]..] [vis] struct Name: T { .. } | impl Name: T { [docs] const NAME = EXPR; .. })* }
// The typedefs probe reports the invocation (name, line, types); the body is read from the upstream
// source here. Anything outside these shapes is an error (the generator reports it), never a guess.
import { parseIntLit } from "./types.ts";

/** Text between the delimiters of the macro invocation starting on 1-based `line`. */
export function macroBody(src: string, line: number): string | undefined {
  let i = 0;
  for (let l = 1; l < line && i >= 0; l++) i = src.indexOf("\n", i) + 1;
  const bang = src.indexOf("!", i);
  if (bang < 0) return undefined;
  let j = bang + 1;
  while (j < src.length && /\s/.test(src[j]!)) j++;
  const open = src[j];
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : undefined;
  if (!close) return undefined;
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    const c = src[k]!;
    if (c === "/" && src[k + 1] === "/") {
      k = src.indexOf("\n", k);
      if (k < 0) return undefined;
    } else if (c === "/" && src[k + 1] === "*") {
      k = src.indexOf("*/", k + 2) + 1;
      if (k <= 0) return undefined;
    } else if (c === '"') {
      for (k++; k < src.length && src[k] !== '"'; k++) if (src[k] === "\\") k++;
    } else if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(j + 1, k);
  }
  return undefined;
}

export interface MacroAttr {
  name: string;
  value?: string; // `#[name = value]` (raw token text)
  text: string;
}
export interface MacroConst {
  docs: string[];
  attrs: MacroAttr[];
  name: string;
  expr: string;
}
export interface NewtypeIndex {
  docs: string[];
  attrs: MacroAttr[];
  name: string;
  consts: MacroConst[];
}
export interface BitflagsType {
  form: "struct" | "impl";
  docs: string[];
  attrs: MacroAttr[];
  name: string;
  bits: string;
  flags: MacroConst[];
}

/** Drop `//` and `/* *\/` comments except `///` doc lines (strings are respected). */
function stripComments(s: string): string {
  let out = "";
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if (c === "/" && s[k + 1] === "/" && s[k + 2] === "/" && s[k + 3] !== "/") {
      const e = s.indexOf("\n", k);
      out += e < 0 ? s.slice(k) : s.slice(k, e);
      k = e < 0 ? s.length : e - 1;
    } else if (c === "/" && s[k + 1] === "/") {
      const e = s.indexOf("\n", k);
      k = e < 0 ? s.length : e - 1;
    } else if (c === "/" && s[k + 1] === "*") {
      k = s.indexOf("*/", k + 2) + 1;
    } else if (c === '"') {
      const st = k;
      for (k++; k < s.length && s[k] !== '"'; k++) if (s[k] === "\\") k++;
      out += s.slice(st, k + 1);
    } else out += c;
  }
  return out;
}

/** Leading `///` doc lines and `#[..]` attributes of `s`; returns them and the rest. */
function leading(s: string): { docs: string[]; attrs: MacroAttr[]; rest: string } {
  const docs: string[] = [];
  const attrs: MacroAttr[] = [];
  let rest = s.trimStart();
  for (;;) {
    if (rest.startsWith("///")) {
      const e = rest.indexOf("\n");
      docs.push((e < 0 ? rest.slice(3) : rest.slice(3, e)).replace(/\r$/, ""));
      rest = (e < 0 ? "" : rest.slice(e + 1)).trimStart();
    } else if (rest.startsWith("#[")) {
      let depth = 0;
      let k = 1;
      for (; k < rest.length; k++) {
        if (rest[k] === '"') {
          for (k++; k < rest.length && rest[k] !== '"'; k++) if (rest[k] === "\\") k++;
        } else if (rest[k] === "[") depth++;
        else if (rest[k] === "]" && --depth === 0) break;
      }
      const inner = rest.slice(2, k).trim();
      const m = /^([\w:]+)\s*(?:=\s*([\s\S]+))?$/.exec(inner);
      attrs.push({ name: m ? m[1]! : inner, value: m?.[2]?.trim(), text: `#[${inner}]` });
      rest = rest.slice(k + 1).trimStart();
    } else return { docs, attrs, rest };
  }
}

function parseConsts(body: string): MacroConst[] {
  const out: MacroConst[] = [];
  // Split at `;` outside `///` doc lines (docs may contain `;`).
  const chunks: string[] = [];
  let st = 0;
  for (let k = 0; k < body.length; k++) {
    if (body.startsWith("///", k)) {
      const e = body.indexOf("\n", k);
      k = e < 0 ? body.length : e;
    } else if (body[k] === ";") {
      chunks.push(body.slice(st, k));
      st = k + 1;
    }
  }
  chunks.push(body.slice(st));
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const { docs, attrs, rest } = leading(chunk);
    const m = /^const\s+(\w+)\s*=\s*([\s\S]+)$/.exec(rest.trim());
    if (!m) throw new Error(`unexpected macro body item \`${rest.trim().slice(0, 60)}\``);
    out.push({ docs, attrs, name: m[1]!, expr: m[2]!.trim() });
  }
  return out;
}

export function parseNewtypeIndex(body: string): NewtypeIndex {
  const { docs, attrs, rest } = leading(stripComments(body));
  const m = /^(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w+)\s*\{([\s\S]*)\}\s*$/.exec(rest.trim());
  if (!m) throw new Error(`unexpected newtype_index! body \`${rest.trim().slice(0, 60)}\``);
  return { docs, attrs, name: m[1]!, consts: parseConsts(m[2]!) };
}

export function parseBitflags(body: string): BitflagsType[] {
  const out: BitflagsType[] = [];
  let s = stripComments(body);
  while (s.trim()) {
    const { docs, attrs, rest } = leading(s);
    const m = /^(?:(?:pub(?:\s*\([^)]*\))?\s+)?struct|impl)\s+(\w+)\s*:\s*([\w:]+)\s*\{/.exec(rest);
    if (!m) throw new Error(`unexpected bitflags! body \`${rest.trim().slice(0, 60)}\``);
    // The flag list ends at the first `}` outside `///` doc lines (docs may contain braces).
    let k = m[0].length;
    for (; k < rest.length && rest[k] !== "}"; k++) {
      if (rest.startsWith("///", k)) {
        const e = rest.indexOf("\n", k);
        k = e < 0 ? rest.length : e;
      } else if (rest[k] === "{") throw new Error(`unexpected bitflags! body \`${rest.trim().slice(0, 60)}\``);
    }
    if (k >= rest.length) throw new Error(`unterminated bitflags! body \`${rest.trim().slice(0, 60)}\``);
    out.push({ form: rest.startsWith("impl") ? "impl" : "struct", docs, attrs, name: m[1]!, bits: m[2]!, flags: parseConsts(rest.slice(m[0].length, k)) });
    s = rest.slice(k + 1);
  }
  return out;
}

/** Split `s` at top-level `sep` (outside (), [], {}, strings and `///` doc lines). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let st = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if (s.startsWith("///", k)) {
      const e = s.indexOf("\n", k);
      k = e < 0 ? s.length : e;
    } else if (c === '"') {
      for (k++; k < s.length && s[k] !== '"'; k++) if (s[k] === "\\") k++;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(st, k));
      st = k + 1;
    }
  }
  out.push(s.slice(st));
  return out;
}

/**
 * One row of `language_item_table!` (rustc_attr_ir/src/lang_items.rs):
 * `$(#[$attr])* $variant, $module::$name, $method, $target, $generics;`
 */
export interface LangItemRow {
  docs: string[];
  attrs: MacroAttr[];
  variant: string;
  /** `$module::$name`, e.g. `sym::sized` */
  name: string;
  method: string;
  target: string;
  generics: string;
}
export function parseLanguageItemTable(body: string): LangItemRow[] {
  const out: LangItemRow[] = [];
  for (const chunk of splitTop(stripComments(body), ";")) {
    if (!chunk.trim()) continue;
    const { docs, attrs, rest } = leading(chunk);
    const parts = splitTop(rest, ",").map((p) => p.trim().replace(/\s+/g, " "));
    if (parts.length !== 5 || !/^\w+$/.test(parts[0]!) || !/^\w+::(?:r#)?\w+$/.test(parts[1]!) || !/^\w+$/.test(parts[2]!))
      throw new Error(`unexpected language_item_table! row \`${rest.trim().slice(0, 80)}\``);
    out.push({ docs, attrs, variant: parts[0]!, name: parts[1]!, method: parts[2]!, target: parts[3]!, generics: parts[4]! });
  }
  return out;
}
/** The enum `language_item_table!`'s `macro_rules!` definition declares: its docs, derives and name. */
export function parseLanguageItemTableDef(def: string): { docs: string[]; derives: string[]; name: string } {
  const m = /((?:[ \t]*\/\/\/[^\n]*\n)*)[ \t]*#\[derive\(([^)]*)\)\]\s*pub\s+enum\s+(\w+)\s*\{/.exec(def);
  if (!m) throw new Error("cannot find the `#[derive(..)] pub enum` of the macro_rules! definition");
  const docs = m[1]!
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.trim().slice(3));
  return { docs, derives: m[2]!.split(",").map((d) => d.trim()).filter(Boolean), name: m[3]! };
}

/** `#[debug_format = "..."]` (a Rust string literal with one `{}`) -> JS template literal over `n`. */
export function debugFormatTemplate(lit: string): string {
  const m = /^"([^"\\]*)"$/.exec(lit.trim());
  if (!m) throw new Error(`unsupported debug_format ${lit}`);
  let out = "";
  const s = m[1]!;
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if ((c === "{" || c === "}") && s[k + 1] === c) {
      out += c;
      k++;
    } else if (c === "{" && s[k + 1] === "}") {
      out += "${n}";
      k++;
    } else if (c === "{" || c === "}") throw new Error(`unsupported debug_format ${lit}`);
    else if (c === "`" || c === "\\" || c === "$") out += "\\" + c;
    else out += c;
  }
  return "`" + out + "`";
}

/**
 * Value of a bitflags constant: integer literals, `!`, `<<`, `>>`, `&`, `^`, `|`, parentheses and
 * `Self::NAME.bits()` / `Type::NAME.bits()` of earlier flags; masked to `width` bits.
 */
export function evalFlagExpr(expr: string, known: Map<string, bigint>, width: number): bigint {
  const mask = (1n << BigInt(width)) - 1n;
  const toks = expr.match(/0[xob][0-9a-fA-F_]+\w*|\d[\d_]*\w*|(?:\w+::)+\w+\s*\.\s*bits\s*\(\s*\)|<<|>>|[!&|^()]/g) ?? [];
  if (toks.join("").replace(/\s/g, "") !== expr.replace(/\s/g, "")) throw new Error(`unsupported flag expression \`${expr}\``);
  let p = 0;
  const peek = () => toks[p];
  const prim = (): bigint => {
    const t = toks[p++];
    if (t === undefined) throw new Error(`unexpected end of \`${expr}\``);
    if (t === "(") {
      const v = bor();
      if (toks[p++] !== ")") throw new Error(`missing ) in \`${expr}\``);
      return v;
    }
    if (t === "!") return ~prim() & mask;
    const r = /^(?:\w+::)+(\w+)\s*\.\s*bits/.exec(t);
    if (r) {
      const v = known.get(r[1]!);
      if (v === undefined) throw new Error(`unknown flag ${r[1]} in \`${expr}\``);
      return v;
    }
    const n = parseIntLit(t);
    if (n === undefined) throw new Error(`bad literal ${t} in \`${expr}\``);
    return n & mask;
  };
  const shift = (): bigint => {
    let v = prim();
    while (peek() === "<<" || peek() === ">>") v = toks[p++] === "<<" ? (v << prim()) & mask : v >> prim();
    return v;
  };
  const band = (): bigint => {
    let v = shift();
    while (peek() === "&") (p++, (v &= shift()));
    return v;
  };
  const bxor = (): bigint => {
    let v = band();
    while (peek() === "^") (p++, (v ^= band()));
    return v;
  };
  const bor = (): bigint => {
    let v = bxor();
    while (peek() === "|") (p++, (v |= bxor()));
    return v;
  };
  const v = bor();
  if (p !== toks.length) throw new Error(`trailing tokens in \`${expr}\``);
  return v;
}
