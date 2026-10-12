// Generates src/rustc_lint_defs/builtin.gen.ts from upstream compiler/rustc_lint_defs/src/builtin.rs
// (PORTING.md §5 "Macros inside rustc": `declare_lint!` is generated, never hand-ported).
//
// Every `declare_lint! { .. }` invocation is parsed token by token (our rustc_lexer port) against the
// arms of `macro_rules! declare_lint` (lib.rs) and expanded the way the macro builds its static:
//   name: stringify!($NAME), default_level: $crate::$Level, desc: $desc, is_externally_loaded: false,
//   $($v: true,)* feature_gate: Some(sym::$gate), future_incompatible: Some(FutureIncompatibleInfo {
//   reason, $($field: $val,)* ..FutureIncompatibleInfo::default_fields_for_macro() }),
//   edition_lint_opts: Some((Edition::$e, $level)), eval_always: $lit, ..Lint::default_fields_for_macro()
// The two `default_fields_for_macro` bodies and the field order of `struct Lint` are read from lib.rs,
// so every static is written out field by field in declaration order. `fcw!(..)` reasons are expanded
// per the arms of `macro_rules! fcw`. `hardwired::lint_vec` (the HardwiredLints list) keeps its order.
//
// The `declare_lint!` and `fcw!` macro_rules bodies are fingerprinted: if upstream changes them, this
// generator stops with an ERROR instead of guessing the new expansion.
//
//   bun tools/codegen/lints.ts           write the file
//   bun tools/codegen/lints.ts --check   ERROR if the committed file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterAllowed, tokenize, type Token } from "../../src/rustc_lexer/lib.ts";
import { unescape_str } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import { Str, utf8_len } from "../../src/std/str.ts";
import { PIN, REPO, UPSTREAM, die, hash, requireUpstream } from "../../scripts/lib/common.ts";

const LIB_PATH = "compiler/rustc_lint_defs/src/lib.rs";
const SRC_PATH = "compiler/rustc_lint_defs/src/builtin.rs";
const EDITION_PATH = "compiler/rustc_span/src/edition.rs";
const OUT_PATH = "src/rustc_lint_defs/builtin.gen.ts";

/// sha1 of the token texts (joined by one space) of the macro_rules bodies this generator implements.
/// A mismatch means upstream changed the macro: re-read it and update the expansion below.
const MACRO_FINGERPRINTS: Record<string, string> = {
  declare_lint: "85d8adc4220264d494b05c020aadd3107e332595",
  fcw: "b5491f8095064b93d368a93ea8ba44fd6f8a4e1f",
};

// ---- tokens -----------------------------------------------------------------------------------

export interface Tok {
  kind: Token["kind"];
  text: string;
  line: number;
  /** `///` doc text (after the `///`) for outer line doc comments. */
  doc?: string;
  /** Plain `//` comment text (kept for the output). */
  comment?: string;
}

class GenError extends Error {}

function fail(path: string, t: { line: number } | undefined, msg: string): never {
  throw new GenError(`ERROR: ${path}:${t?.line ?? "?"}: ${msg}`);
}

export function lex(src: string): Tok[] {
  const s = Str.from(src);
  const out: Tok[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(s, FrontmatterAllowed.No)) {
    const k = tok.kind;
    const text = s.slice(pos, pos + tok.len).toString();
    if (k.$ === "LineComment") {
      if (k.doc_style === "Outer") out.push({ kind: k, text, line, doc: text.slice(3) });
      else if (k.doc_style === undefined) out.push({ kind: k, text, line, comment: text });
    } else if (k.$ === "BlockComment") {
      if (k.doc_style !== undefined) out.push({ kind: k, text, line });
    } else if (k.$ !== "Whitespace") out.push({ kind: k, text, line });
    for (let i = pos; i < pos + tok.len; i++) if (s.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

const isComment = (t: Tok): boolean => t.kind.$ === "LineComment" || t.kind.$ === "BlockComment";

/** `LitStr::value()` of a `"..."` / `r#"..."#` token. */
function strValue(path: string, t: Tok): string {
  const k = t.kind;
  if (k.$ !== "Literal") fail(path, t, `expected a string literal, found \`${t.text}\``);
  if (k.suffix_start !== utf8_len(t.text)) fail(path, t, "string literal suffixes are not supported");
  const lit = k.kind;
  if (lit.$ === "RawStr") {
    const n = lit.n_hashes;
    if (n === undefined) fail(path, t, "invalid raw string literal");
    return t.text.slice(2 + n, t.text.length - 1 - n);
  }
  if (lit.$ !== "Str" || !lit.terminated) fail(path, t, `expected a string literal, found \`${t.text}\``);
  const body = Str.from(t.text.slice(1, -1));
  let out = "";
  unescape_str(body, (_s, _e, res) => {
    if (res.$ === "Err") fail(path, t, `invalid escape in string literal (${res._0})`);
    out += String.fromCodePoint(res._0);
  });
  return out;
}

function intValue(path: string, t: Tok): number {
  const k = t.kind;
  if (k.$ !== "Literal" || k.kind.$ !== "Int" || k.suffix_start !== utf8_len(t.text) || !/^[0-9_]+$/.test(t.text)) {
    fail(path, t, `expected an unsuffixed decimal integer literal, found \`${t.text}\``);
  }
  return Number(t.text.replaceAll("_", ""));
}

/** Cursor over the non-comment tokens (comments are collected separately where wanted). */
class Cursor {
  i = 0;
  constructor(
    readonly path: string,
    readonly toks: Tok[],
    readonly end = toks.length,
  ) {}
  /** Skips comments, collecting plain `//` comments into `sink` when given. */
  skipComments(sink?: string[]): void {
    while (this.i < this.end && isComment(this.toks[this.i]!) && this.toks[this.i]!.doc === undefined) {
      const c = this.toks[this.i]!.comment;
      if (c !== undefined) sink?.push(c);
      else fail(this.path, this.toks[this.i], "block doc comments are not supported");
      this.i++;
    }
  }
  peek(sink?: string[]): Tok | undefined {
    this.skipComments(sink);
    return this.i < this.end ? this.toks[this.i] : undefined;
  }
  next(sink?: string[]): Tok {
    const t = this.peek(sink);
    if (t === undefined) fail(this.path, this.toks[this.end - 1], "unexpected end of macro input");
    this.i++;
    return t;
  }
  eat(text: string, sink?: string[]): boolean {
    const t = this.peek(sink);
    if (t !== undefined && t.text === text && t.doc === undefined) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(text: string, sink?: string[]): Tok {
    const t = this.next(sink);
    if (t.text !== text || t.doc !== undefined) fail(this.path, t, `expected \`${text}\`, found \`${t.text}\``);
    return t;
  }
  ident(sink?: string[]): Tok {
    const t = this.next(sink);
    if (t.kind.$ !== "Ident") fail(this.path, t, `expected an identifier, found \`${t.text}\``);
    return t;
  }
  atEnd(sink?: string[]): boolean {
    return this.peek(sink) === undefined;
  }
  /** Index just past the delimiter closing the one at `this.i - 1`. */
  closing(open: Tok): number {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const close = pairs[open.text];
    if (close === undefined) fail(this.path, open, `expected a delimiter, found \`${open.text}\``);
    let depth = 1;
    for (let j = this.i; j < this.end; j++) {
      const t = this.toks[j]!;
      if (isComment(t)) continue;
      if (t.text in pairs) depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") {
        if (--depth === 0) {
          if (t.text !== close) fail(this.path, t, `mismatched delimiter \`${t.text}\``);
          return j;
        }
      }
    }
    fail(this.path, open, "unclosed delimiter");
  }
  /** Sub-cursor over the group opened by `open` (just consumed); moves past its closing delimiter. */
  group(open: Tok): Cursor {
    const j = this.closing(open);
    const c = new Cursor(this.path, this.toks, j);
    c.i = this.i;
    this.i = j + 1;
    return c;
  }
  /** Tokens up to (not including) the next `,` at depth 0, or the end. */
  exprUntilComma(): Tok[] {
    const out: Tok[] = [];
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t === undefined) break;
      if (depth === 0 && t.text === ",") break;
      if (t.text === "(" || t.text === "[" || t.text === "{" || t.text === "<") depth++;
      if (t.text === ")" || t.text === "]" || t.text === "}" || t.text === ">") depth--;
      out.push(t);
      this.i++;
    }
    return out;
  }
}

// ---- lib.rs: struct fields, default_fields_for_macro, macro fingerprints ---------------------

/** Index of the token after `kw name` (e.g. `struct Lint`, `enum Level`, `fn default_fields_for_macro`). */
function findItem(toks: Tok[], kw: string, name: string, from = 0): number {
  for (let i = from; i + 1 < toks.length; i++) {
    if (toks[i]!.text === kw && toks[i + 1]!.text === name && toks[i]!.doc === undefined) return i + 2;
  }
  return -1;
}

/** Skips `#[..]` attributes and doc comments. */
function skipAttrs(c: Cursor): void {
  for (;;) {
    const t = c.peek();
    if (t === undefined) return;
    if (t.doc !== undefined) {
      c.i++;
      continue;
    }
    if (t.text === "#") {
      c.i++;
      c.group(c.expect("["));
      continue;
    }
    return;
  }
}

/** Field names, in declaration order, of `pub struct <name> { .. }`. */
function structFields(path: string, toks: Tok[], name: string): string[] {
  const at = findItem(toks, "struct", name);
  if (at < 0) fail(path, undefined, `struct ${name} not found`);
  const c = new Cursor(path, toks);
  c.i = at;
  const body = c.group(c.expect("{"));
  const out: string[] = [];
  while (!body.atEnd()) {
    skipAttrs(body);
    if (body.atEnd()) break;
    body.expect("pub");
    out.push(body.ident().text);
    body.expect(":");
    if (body.exprUntilComma().length === 0) fail(path, body.peek(), `struct ${name}: missing field type`);
    body.eat(",");
  }
  return out;
}

/** Variant names of the fieldless `pub enum <name> { .. }`. */
function enumVariants(path: string, toks: Tok[], name: string): string[] {
  const at = findItem(toks, "enum", name);
  if (at < 0) fail(path, undefined, `enum ${name} not found`);
  const c = new Cursor(path, toks);
  c.i = at;
  const body = c.group(c.expect("{"));
  const out: string[] = [];
  while (!body.atEnd()) {
    skipAttrs(body);
    if (body.atEnd()) break;
    out.push(body.ident().text);
    if (!body.atEnd()) body.expect(",");
  }
  return out;
}

/** `impl <ty> { pub const fn default_fields_for_macro() -> Self { <ty> { f: expr, .. } } }` → field → expr tokens. */
function defaultFields(path: string, toks: Tok[], ty: string): Map<string, Tok[]> {
  let at = -1;
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i]!.text === "impl" && toks[i + 1]!.text === ty && toks[i + 2]!.text === "{") {
      at = findItem(toks, "fn", "default_fields_for_macro", i);
      break;
    }
  }
  if (at < 0) fail(path, undefined, `${ty}::default_fields_for_macro not found`);
  const c = new Cursor(path, toks);
  c.i = at;
  c.group(c.expect("("));
  c.expect("-");
  c.expect(">");
  c.expect("Self");
  const fnBody = c.group(c.expect("{"));
  fnBody.expect(ty);
  const lit = fnBody.group(fnBody.expect("{"));
  if (!fnBody.atEnd()) fail(path, fnBody.peek(), `${ty}::default_fields_for_macro: unexpected tokens after the struct literal`);
  const out = new Map<string, Tok[]>();
  while (!lit.atEnd()) {
    const f = lit.ident();
    lit.expect(":");
    const e = lit.exprUntilComma();
    if (e.length === 0) fail(path, f, `${ty}::default_fields_for_macro: empty value for ${f.text}`);
    if (out.has(f.text)) fail(path, f, `${ty}::default_fields_for_macro: duplicate field ${f.text}`);
    out.set(f.text, e);
    lit.eat(",");
  }
  return out;
}

/** Fingerprint of the body of `macro_rules! <name> { .. }`. */
function macroFingerprint(path: string, toks: Tok[], name: string): string {
  let at = -1;
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i]!.text === "macro_rules" && toks[i + 1]!.text === "!" && toks[i + 2]!.text === name) {
      at = i + 3;
      break;
    }
  }
  if (at < 0) fail(path, undefined, `macro_rules! ${name} not found`);
  const c = new Cursor(path, toks);
  c.i = at;
  const body = c.group(c.expect("{"));
  const texts: string[] = [];
  for (let j = body.i; j < body.end; j++) if (!isComment(toks[j]!)) texts.push(toks[j]!.text);
  return hash(texts.join(" "));
}

// ---- expressions -> TS ----------------------------------------------------------------------

interface Ctx {
  levels: string[];
  editions: string[];
}

/** The constant expressions that appear in `default_fields_for_macro` bodies. */
function constExpr(path: string, e: Tok[], ctx: Ctx): string {
  const text = e.map((t) => t.text).join("");
  if (e.length === 1) {
    const t = e[0]!;
    if (t.text === "true" || t.text === "false") return t.text;
    if (t.text === "None") return "undefined";
    if (t.kind.$ === "Literal") return JSON.stringify(strValue(path, t));
  }
  let m = /^Level::(\w+)$/.exec(text);
  if (m && ctx.levels.includes(m[1]!)) return JSON.stringify(m[1]);
  m = /^FutureIncompatibilityReason::Unreachable$/.exec(text);
  if (m) return `{ $: "Unreachable" }`;
  fail(path, e[0], `unsupported constant expression \`${text}\``);
}

/** `fcw!(..)` per the arms of `macro_rules! fcw` (lib.rs:806). */
function fcw(path: string, c: Cursor): string {
  c.expect("fcw");
  c.expect("!");
  const open = c.next();
  const a = c.group(open);
  const first = a.next();
  const release = (variant: string, custom?: string): string => {
    a.expect("#");
    const n = intValue(path, a.next());
    if (!a.atEnd()) fail(path, a.peek(), "unexpected tokens in fcw!");
    const fcw_ = `{ issue_number: ${n} }`;
    return custom === undefined ? `{ $: "${variant}", _0: ${fcw_} }` : `{ $: "Custom", _0: ${JSON.stringify(custom)}, _1: ${fcw_} }`;
  };
  switch (first.text) {
    case "FutureReleaseError":
    case "FutureReleaseSemanticsChange":
      return release(first.text);
    case "EditionError":
    case "EditionSemanticsChange":
    case "EditionAndFutureReleaseSemanticsChange":
    case "EditionAndFutureReleaseError": {
      // (@edition 2024) => Edition2024, (@edition 2021) => Edition2021, (@edition 2018) => Edition2018
      const ed = a.next();
      if (!["2024", "2021", "2018"].includes(ed.text)) fail(path, ed, `fcw!(@edition ${ed.text}) has no arm`);
      const slug = strValue(path, a.next());
      if (!a.atEnd()) fail(path, a.peek(), "unexpected tokens in fcw!");
      return `{ $: "${first.text}", _0: { edition: "Edition${ed.text}", page_slug: ${JSON.stringify(slug)} } }`;
    }
  }
  if (first.kind.$ === "Literal") return release("Custom", strValue(path, first));
  fail(path, first, `fcw!(${first.text} ..) has no arm`);
}

// ---- builtin.rs ---------------------------------------------------------------------------------

export interface LintDecl {
  /** Line of `$NAME`. */
  line: number;
  name: string;
  /** Doc lines (`///` text) and raw attributes (`#[..]`), in order. */
  docs: string[];
  /** Plain `//` comments inside the invocation. */
  comments: string[];
  /** Field -> TS expression, explicit fields only (in macro expansion order). */
  fields: Map<string, string>;
}

function parseDeclareLint(path: string, c: Cursor, ctx: Ctx, lintFields: string[], fiiFields: Map<string, Tok[]>): LintDecl {
  const docs: string[] = [];
  const comments: string[] = [];
  // $(#[$attr:meta])*
  for (;;) {
    const t = c.peek(comments);
    if (t === undefined) fail(path, undefined, "empty declare_lint!");
    if (t.doc !== undefined) {
      docs.push(`///${t.doc}`);
      c.i++;
      continue;
    }
    if (t.text === "#") {
      c.i++;
      const open = c.expect("[");
      const g = c.group(open);
      const inner = g.toks.slice(g.i, g.end).filter((x) => !isComment(x));
      const first = inner[0]?.text;
      if (first === "cfg" || first === "cfg_attr") fail(path, t, "#[cfg] on a declare_lint! is not supported");
      docs.push(`// #[${rawText(inner)}]`);
      continue;
    }
    break;
  }
  // $vis
  c.expect("pub", comments);
  const nameTok = c.ident(comments);
  const name = nameTok.text;
  const fields = new Map<string, string>();
  const set = (f: string, v: string, at: Tok): void => {
    if (!lintFields.includes(f)) fail(path, at, `Lint has no field \`${f}\``);
    if (fields.has(f)) fail(path, at, `field \`${f}\` specified more than once`);
    fields.set(f, v);
  };
  c.expect(",", comments);
  const level = c.ident(comments);
  if (!ctx.levels.includes(level.text)) fail(path, level, `unknown lint level \`${level.text}\``);
  c.expect(",", comments);
  const descToks = c.exprUntilComma();
  if (descToks.length !== 1) fail(path, descToks[0] ?? nameTok, "only a string literal `$desc` is supported");
  const desc = strValue(path, descToks[0]!);
  // name: stringify!($NAME), default_level: $crate::$Level, desc: $desc, is_externally_loaded: false,
  set("name", JSON.stringify(name), nameTok);
  set("default_level", JSON.stringify(level.text), level);
  set("desc", JSON.stringify(desc), descToks[0]!);
  set("is_externally_loaded", "false", nameTok);
  // first arm: no trailing comma after $desc
  c.eat(",", comments);
  let feature_gate: string | undefined;
  let future_incompatible: string | undefined;
  let edition: string | undefined;
  let eval_always: string | undefined;
  // $(@eval_always = $eval_always:literal)?
  let at = c.peek(comments);
  const isAt = (kw: string): boolean => at?.text === "@" && c.toks[c.i + 1]?.text === kw;
  if (isAt("eval_always")) {
    c.expect("@");
    c.expect("eval_always");
    c.expect("=");
    const lit = c.next();
    if (lit.text !== "true" && lit.text !== "false") fail(path, lit, "@eval_always must be a bool literal");
    eval_always = lit.text;
    at = c.peek(comments);
  }
  // $(@feature_gate = $gate:ident;)?
  if (isAt("feature_gate")) {
    c.expect("@");
    c.expect("feature_gate");
    c.expect("=");
    feature_gate = `sym.${c.ident().text}`;
    c.expect(";");
    at = c.peek(comments);
  }
  // $(@future_incompatible = FutureIncompatibleInfo { reason: $reason:expr, $($field:ident : $val:expr),* $(,)* }; )?
  if (isAt("future_incompatible")) {
    c.expect("@");
    c.expect("future_incompatible");
    c.expect("=");
    c.expect("FutureIncompatibleInfo");
    const g = c.group(c.expect("{"));
    g.expect("reason", comments);
    g.expect(":");
    const vals = new Map<string, string>();
    vals.set("reason", fcw(path, g));
    while (!g.atEnd(comments)) {
      g.expect(",", comments);
      if (g.atEnd(comments)) break;
      const f = g.ident(comments);
      g.expect(":");
      const v = g.next();
      if (!fiiFields.has(f.text) || f.text === "reason") fail(path, f, `FutureIncompatibleInfo field \`${f.text}\` not supported`);
      if (v.text !== "true" && v.text !== "false") fail(path, v, `FutureIncompatibleInfo.${f.text}: only bool literals are supported`);
      if (vals.has(f.text)) fail(path, f, `field \`${f.text}\` specified more than once`);
      vals.set(f.text, v.text);
    }
    c.expect(";", comments);
    // ..$crate::FutureIncompatibleInfo::default_fields_for_macro()
    const parts: string[] = [];
    for (const f of fiiFields.keys()) parts.push(`${f}: ${vals.get(f) ?? fii_defaults.get(f)}`);
    future_incompatible = `Object.freeze<FutureIncompatibleInfo>({ ${parts.join(", ")} })`;
    at = c.peek(comments);
  }
  // $(@edition $lint_edition:ident => $edition_level:ident;)?
  if (isAt("edition")) {
    c.expect("@");
    c.expect("edition");
    const e = c.ident();
    if (!ctx.editions.includes(e.text)) fail(path, e, `unknown edition \`${e.text}\``);
    c.expect("=");
    c.expect(">");
    const l = c.ident();
    if (!ctx.levels.includes(l.text)) fail(path, l, `unknown lint level \`${l.text}\``);
    c.expect(";");
    edition = `[${JSON.stringify(e.text)}, ${JSON.stringify(l.text)}]`;
    at = c.peek(comments);
  }
  // $(@msrv = $msrv:literal;)?
  if (isAt("msrv")) fail(path, at, "@msrv (Lint::parse_rust_version) is not supported by the generator yet");
  if (at?.text === "@") fail(path, at, `unexpected \`@${c.toks[c.i + 1]?.text}\` (out of macro order or unknown)`);
  // $($v:ident),*
  const flags: Tok[] = [];
  while (!c.atEnd(comments)) {
    flags.push(c.ident(comments));
    if (!c.atEnd(comments)) c.expect(",", comments);
  }
  // expansion order: $($v: true,)* feature_gate, future_incompatible, edition_lint_opts, eval_always
  for (const v of flags) {
    if (lint_defaults_raw.get(v.text) !== "false") fail(path, v, `\`${v.text}\` is not a bool field defaulting to false`);
    set(v.text, "true", v);
  }
  if (feature_gate !== undefined) set("feature_gate", feature_gate, nameTok);
  if (future_incompatible !== undefined) set("future_incompatible", future_incompatible, nameTok);
  if (edition !== undefined) set("edition_lint_opts", edition, nameTok);
  if (eval_always !== undefined) set("eval_always", eval_always, nameTok);
  return { line: nameTok.line, name, docs, comments, fields };
}

function rawText(toks: Tok[]): string {
  let s = "";
  let prev: Tok | undefined;
  const word = (t: Tok): boolean => /^[\w"']/.test(t.text);
  for (const t of toks) {
    if (prev !== undefined && ((word(prev) && word(t)) || prev.text === "=" || t.text === "=")) s += " ";
    s += t.text;
    prev = t;
  }
  return s;
}

// Defaults (filled in by main before parsing builtin.rs).
let lint_defaults_raw = new Map<string, string>();
let fii_defaults = new Map<string, string>();

export interface Generated {
  text: string;
  lints: LintDecl[];
  hardwired: string[];
}

export function generate(libSrc: string, builtinSrc: string, editionSrc: string): Generated {
  const libToks = lex(libSrc);
  for (const [name, want] of Object.entries(MACRO_FINGERPRINTS)) {
    const got = macroFingerprint(LIB_PATH, libToks, name);
    if (got !== want) {
      fail(LIB_PATH, undefined, `macro_rules! ${name} changed upstream (fingerprint ${got}, expected ${want}); re-read it and update tools/codegen/lints.ts`);
    }
  }
  const ctx: Ctx = { levels: enumVariants(LIB_PATH, libToks, "Level"), editions: enumVariants(EDITION_PATH, lex(editionSrc), "Edition") };
  const lintFields = structFields(LIB_PATH, libToks, "Lint");
  const fiiFieldNames = structFields(LIB_PATH, libToks, "FutureIncompatibleInfo");
  const lintDef = defaultFields(LIB_PATH, libToks, "Lint");
  const fiiDef = defaultFields(LIB_PATH, libToks, "FutureIncompatibleInfo");
  const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
  if (!sameSet(lintFields, [...lintDef.keys()])) fail(LIB_PATH, undefined, "Lint::default_fields_for_macro does not list exactly the fields of Lint");
  if (!sameSet(fiiFieldNames, [...fiiDef.keys()])) fail(LIB_PATH, undefined, "FutureIncompatibleInfo::default_fields_for_macro does not list exactly its fields");
  lint_defaults_raw = new Map(lintFields.map((f) => [f, constExpr(LIB_PATH, lintDef.get(f)!, ctx)]));
  // FutureIncompatibleInfo fields in declaration order
  const fiiFields = new Map(fiiFieldNames.map((f) => [f, fiiDef.get(f)!]));
  fii_defaults = new Map(fiiFieldNames.map((f) => [f, constExpr(LIB_PATH, fiiDef.get(f)!, ctx)]));

  const toks = lex(builtinSrc);
  const top = new Cursor(SRC_PATH, toks);
  const lints: LintDecl[] = [];
  let hardwired: string[] | undefined;
  let hardwiredLine = 0;
  const passes: { line: number; name: string; lints: string[]; after: number }[] = [];
  while (!top.atEnd()) {
    const t = top.next();
    if (t.text === "use") {
      // `use crate::{declare_lint, declare_lint_pass, fcw};`
      while (top.next().text !== ";");
      continue;
    }
    if (t.text === "pub" && top.peek()?.text === "mod") {
      top.expect("mod");
      const name = top.ident();
      if (name.text !== "hardwired") fail(SRC_PATH, name, `unexpected module \`${name.text}\``);
      const m = top.group(top.expect("{"));
      // use super::*; pub fn lint_vec() -> crate::LintVec { vec![ .. ] }
      m.expect("use");
      m.expect("super");
      m.expect(":");
      m.expect(":");
      m.expect("*");
      m.expect(";");
      m.expect("pub");
      const fnTok = m.expect("fn");
      m.expect("lint_vec");
      m.group(m.expect("("));
      for (const x of ["-", ">", "crate", ":", ":", "LintVec"]) m.expect(x);
      const body = m.group(m.expect("{"));
      body.expect("vec");
      body.expect("!");
      const list = body.group(body.expect("["));
      if (!body.atEnd()) fail(SRC_PATH, body.peek(), "unexpected tokens in lint_vec");
      if (!m.atEnd()) fail(SRC_PATH, m.peek(), "unexpected items in mod hardwired");
      hardwired = [];
      hardwiredLine = fnTok.line;
      while (!list.atEnd()) {
        hardwired.push(list.ident().text);
        if (!list.atEnd()) list.expect(",");
      }
      continue;
    }
    if (t.text === "declare_lint" && top.peek()?.text === "!") {
      top.expect("!");
      const g = top.group(top.expect("{"));
      lints.push(parseDeclareLint(SRC_PATH, g, ctx, lintFields, fiiFields));
      continue;
    }
    if (t.text === "declare_lint_pass" && top.peek()?.text === "!") {
      // declare_lint_pass!($(#[$m:meta])* $name:ident => [$($lint:expr),* $(,)?]);
      top.expect("!");
      const g = top.group(top.expect("("));
      top.expect(";");
      const name = g.ident();
      g.expect("=");
      g.expect(">");
      const list = g.group(g.expect("["));
      if (!g.atEnd()) fail(SRC_PATH, g.peek(), "unexpected tokens in declare_lint_pass!");
      const lintsOf: string[] = [];
      while (!list.atEnd()) {
        lintsOf.push(list.ident().text);
        if (!list.atEnd()) list.expect(",");
      }
      passes.push({ line: t.line, name: name.text, lints: lintsOf, after: lints.length });
      continue;
    }
    if (t.doc !== undefined) fail(SRC_PATH, t, "doc comment outside a declare_lint!");
    if (t.kind.$ === "BlockComment") fail(SRC_PATH, t, "block doc comments are not supported");
    fail(SRC_PATH, t, `unexpected top-level item starting with \`${t.text}\` (only use, mod hardwired and declare_lint! are handled)`);
  }
  if (hardwired === undefined) fail(SRC_PATH, undefined, "mod hardwired { fn lint_vec } not found");
  const declared = new Set(lints.map((l) => l.name));
  if (declared.size !== lints.length) fail(SRC_PATH, undefined, "a lint is declared twice");
  for (const h of hardwired) if (!declared.has(h)) fail(SRC_PATH, undefined, `hardwired::lint_vec lists undeclared lint ${h}`);
  for (const p of passes) for (const l of p.lints) if (!declared.has(l)) fail(SRC_PATH, p, `declare_lint_pass!(${p.name}) lists undeclared lint ${l}`);

  const L: string[] = [];
  L.push(`// GENERATED by tools/codegen/lints.ts from ${SRC_PATH} @ ${PIN.commit.slice(0, 12)}. Do not edit.`);
  L.push(`// Each \`declare_lint!\` (${LIB_PATH}) expanded field by field (struct order), with the defaults of`);
  L.push(`// \`Lint::default_fields_for_macro\` and \`FutureIncompatibleInfo::default_fields_for_macro\`. Hand module: builtin.ts.`);
  L.push(`import type { FutureIncompatibleInfo, Lint${passes.length ? ", LintPass" : ""}, LintVec } from "./lib.ts";`);
  if (lints.some((l) => l.fields.has("feature_gate"))) L.push(`import { sym } from "../rustc_span/symbol.ts";`);
  L.push("");
  L.push("export const hardwired = {");
  L.push(`  // rustc: ${SRC_PATH}:${hardwiredLine} lint_vec`);
  L.push("  lint_vec(): LintVec {");
  L.push("    return [");
  L.push("      // tidy-alphabetical-start");
  for (const h of hardwired) L.push(`      ${h},`);
  L.push("      // tidy-alphabetical-end");
  L.push("    ];");
  L.push("  },");
  L.push("};");
  const emitPass = (p: (typeof passes)[number]): void => {
    const list = p.lints.join(", ");
    L.push("");
    L.push(`// rustc-lint-pass: ${SRC_PATH}:${p.line} ${p.name}`);
    L.push(`// declare_lint_pass!(${p.name} => [${list}]): \`#[derive(Copy, Clone)] pub struct ${p.name};\` + impl_lint_pass! (lib.rs).`);
    L.push(`export class ${p.name} implements LintPass {`);
    L.push(`  name(): string {`);
    L.push(`    return ${JSON.stringify(p.name)};`);
    L.push(`  }`);
    L.push(`  get_lints(): LintVec {`);
    L.push(`    return [${list}];`);
    L.push(`  }`);
    L.push(`  static lint_vec(): LintVec {`);
    L.push(`    return [${list}];`);
    L.push(`  }`);
    L.push(`}`);
  };
  for (const [i, l] of lints.entries()) {
    for (const p of passes) if (p.after === i) emitPass(p);
    L.push("");
    L.push(`// rustc-lint: ${SRC_PATH}:${l.line} ${l.name}`);
    for (const d of l.docs) L.push(d);
    for (const cm of l.comments) L.push(cm);
    L.push(`export const ${l.name}: Lint = Object.freeze<Lint>({`);
    for (const f of lintFields) L.push(`  ${f}: ${l.fields.get(f) ?? lint_defaults_raw.get(f)},`);
    L.push("});");
  }
  for (const p of passes) if (p.after === lints.length) emitPass(p);
  return { text: L.join("\n") + "\n", lints, hardwired };
}

function main(): void {
  requireUpstream();
  const read = (p: string): string => readFileSync(join(UPSTREAM, p), "utf8");
  let g: Generated;
  try {
    g = generate(read(LIB_PATH), read(SRC_PATH), read(EDITION_PATH));
  } catch (e) {
    if (e instanceof GenError) die(e.message.replace(/^ERROR: /, ""));
    throw e;
  }
  const out = join(REPO, OUT_PATH);
  if (process.argv.includes("--check")) {
    let cur = "";
    try {
      cur = readFileSync(out, "utf8");
    } catch {}
    if (cur !== g.text) die(`${OUT_PATH} is stale; run: bun tools/codegen/lints.ts`);
    console.log(`${OUT_PATH} up to date (${g.lints.length} lints)`);
    return;
  }
  writeFileSync(out, g.text);
  console.log(`wrote ${OUT_PATH}: ${g.lints.length} lints, ${g.hardwired.length} in hardwired::lint_vec`);
}

if (import.meta.main) main();
