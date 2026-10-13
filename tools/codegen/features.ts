// Generates the rustc_feature tables from the upstream sources (PORTING.md §5 "Macros inside rustc"):
//   compiler/rustc_feature/src/accepted.rs      `declare_features!` -> src/rustc_feature/accepted.gen.ts
//   compiler/rustc_feature/src/removed.rs       `declare_features!` -> src/rustc_feature/removed.gen.ts
//   compiler/rustc_feature/src/unstable.rs      `declare_features!` -> src/rustc_feature/unstable.gen.ts
//   compiler/rustc_feature/src/builtin_attrs.rs `BUILTIN_ATTRIBUTES` -> src/rustc_feature/builtin_attrs.gen.ts
// Each `declare_features!` is expanded the way the file's own `macro_rules! declare_features` does:
//   accepted: `ACCEPTED_LANG_FEATURES: &[Feature]`
//   removed:  `REMOVED_LANG_FEATURES: &[RemovedFeature]` (`opt_nonzero_u32!` pulls)
//   unstable: `UNSTABLE_LANG_FEATURES: &[Feature]` and `impl Features { fn $feature, incomplete, internal }`
// The sources are tokenized with our rustc_lexer port and string literals are decoded with the
// rustc-literal-escaper port. Input outside the macro patterns is an ERROR, never a guess.
//
//   bun tools/codegen/features.ts           write the files
//   bun tools/codegen/features.ts --check   ERROR if a committed file is stale
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterAllowed, tokenize, type Token } from "../../src/rustc_lexer/lib.ts";
import { Str, utf8_len } from "../../src/std/str.ts";
import { unescape_str } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import { PIN, REPO, UPSTREAM, die, requireUpstream } from "../../scripts/lib/common.ts";
import { parseIntLit } from "./types.ts";

const CRATE = "compiler/rustc_feature/src";
const OUT = "src/rustc_feature";

interface Tok {
  kind: Token["kind"];
  text: string;
  line: number;
}

class GenError extends Error {}

function fail(path: string, t: Tok | undefined, msg: string): never {
  throw new GenError(`${path}:${t?.line ?? "?"}: ${msg}${t ? ` (at \`${t.text}\`)` : ""}`);
}

/** Tokens of `src`; whitespace and block comments dropped, line comments kept (docs and plain). */
function lex(src: Str): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    const text = src.slice(pos, pos + tok.len).toString();
    if (k !== "Whitespace" && k !== "BlockComment") out.push({ kind: tok.kind, text, line });
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return out;
}

function isComment(t: Tok): boolean {
  return t.kind.$ === "LineComment";
}
function isOuterDoc(t: Tok): boolean {
  return t.kind.$ === "LineComment" && t.kind.doc_style === "Outer";
}

/** The value of a `"..."` or `r#"..."#` literal (no suffix). */
function strValue(path: string, t: Tok): string {
  const k = t.kind;
  if (k.$ !== "Literal") fail(path, t, "expected a string literal");
  const lit = k.kind;
  if (k.suffix_start !== utf8_len(t.text)) fail(path, t, "string literal suffixes are not supported");
  if (lit.$ === "RawStr") {
    const n = lit.n_hashes;
    if (n === undefined) fail(path, t, "invalid raw string literal");
    const body = t.text.slice(2 + n, t.text.length - 1 - n);
    if (body.includes("\r")) fail(path, t, "bare CR in raw string literal");
    return body;
  }
  if (lit.$ !== "Str" || !lit.terminated) fail(path, t, "expected a string literal");
  let out = "";
  let err: string | undefined;
  unescape_str(Str.from(t.text.slice(1, -1)), (_s, _e, res) => {
    if (res.$ === "Err") err ??= res._0;
    else out += String.fromCodePoint(res._0);
  });
  if (err !== undefined) fail(path, t, `string literal escape error ${err}`);
  return out;
}

/** A `u32` integer literal (no suffix other than `u32`). */
function u32Value(path: string, t: Tok): number {
  if (t.kind.$ !== "Literal" || t.kind.kind.$ !== "Int") fail(path, t, "expected an integer literal");
  const n = parseIntLit(t.text);
  if (n === undefined || !/^[0-9_]+(u32)?$/.test(t.text) || n > 0xffffffffn) fail(path, t, "expected a u32 literal");
  return Number(n);
}

class Parser {
  i: number;
  constructor(
    readonly path: string,
    readonly toks: Tok[],
    start: number,
    readonly end: number,
  ) {
    this.i = start;
  }
  peek(): Tok | undefined {
    return this.i < this.end ? this.toks[this.i] : undefined;
  }
  next(): Tok {
    const t = this.peek();
    if (t === undefined) fail(this.path, this.toks[this.end], "unexpected end of macro input");
    this.i++;
    return t;
  }
  eat(kind: string, text?: string): boolean {
    const t = this.peek();
    if (t !== undefined && t.kind.$ === kind && (text === undefined || t.text === text)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(kind: string, text?: string): Tok {
    const t = this.next();
    if (t.kind.$ !== kind || (text !== undefined && t.text !== text)) fail(this.path, t, `expected ${text ?? kind}`);
    return t;
  }
  ident(): Tok {
    const t = this.next();
    if (t.kind.$ !== "Ident") fail(this.path, t, "expected identifier");
    return t;
  }
  /** Plain `//` comments at the cursor (kept in the output); stops at docs and other tokens. */
  comments(): string[] {
    const out: string[] = [];
    for (let t = this.peek(); t !== undefined && isComment(t) && !isOuterDoc(t); t = this.peek()) {
      if (t.kind.$ === "LineComment" && t.kind.doc_style !== undefined) fail(this.path, t, "unexpected inner doc comment");
      out.push(t.text.trimEnd());
      this.i++;
    }
    return out;
  }
}

/** Index range (exclusive of the delimiters) of the delimited group opening at `open`. */
function group(path: string, toks: Tok[], open: number): number {
  const pairs: Record<string, string> = { OpenParen: "CloseParen", OpenBracket: "CloseBracket", OpenBrace: "CloseBrace" };
  const stack: string[] = [];
  for (let i = open; i < toks.length; i++) {
    const k = toks[i]!.kind.$;
    if (k in pairs) stack.push(pairs[k]!);
    else if (k === "CloseParen" || k === "CloseBracket" || k === "CloseBrace") {
      if (stack.pop() !== k) fail(path, toks[i], "unbalanced delimiters");
      if (stack.length === 0) return i;
    }
  }
  fail(path, toks[open], "unterminated delimiter");
}

function load(file: string): { path: string; toks: Tok[] } {
  const path = `${CRATE}/${file}`;
  const bytes = readFileSync(join(UPSTREAM, path));
  return { path, toks: lex(Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))) };
}

/// sha1 of the token texts (joined by one space, comments dropped) of the `macro_rules!` bodies whose
/// expansion this generator writes out itself, including the `incomplete`/`internal` fallback text of
/// unstable.rs's `declare_features` (review w456b F1). A mismatch means upstream changed the macro:
/// re-read it and update the generator, then the fingerprint.
const MACRO_FINGERPRINTS: [file: string, name: string, sha1: string][] = [
  ["accepted.rs", "declare_features", "ff48c70ee0547c86a9cd25284573c36788e0c8c9"],
  ["removed.rs", "opt_nonzero_u32", "f4abe38a981c32fea2b885cc56e45d6656c6e2a4"],
  ["removed.rs", "declare_features", "11ec6a4f6c710ef5c27861fac68bb1e9ce2b25b9"],
  ["unstable.rs", "status_to_enum", "52d9fb74d3f8963abaeacee06dba2dda28cc1989"],
  ["unstable.rs", "declare_features", "0cbd71e986b61bcf3e04f1f78ec4d7791f6592a3"],
];

function macroFingerprint(path: string, toks: Tok[], name: string): string {
  const at = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 1]?.text === "!" && toks[i + 2]?.text === name);
  if (at < 0) fail(path, undefined, `no macro_rules! ${name}`);
  const open = at + 3;
  if (toks[open]?.kind.$ !== "OpenBrace") fail(path, toks[open], `macro_rules! ${name}: expected \`{\``);
  const close = group(path, toks, open);
  const texts = toks.slice(open + 1, close).filter((t) => !isComment(t)).map((t) => t.text);
  return new Bun.CryptoHasher("sha1").update(texts.join(" ")).digest("hex");
}

function checkMacroFingerprints(): void {
  for (const [file, name, want] of MACRO_FINGERPRINTS) {
    const { path, toks } = load(file);
    const got = macroFingerprint(path, toks, name);
    if (got !== want) {
      fail(path, undefined, `macro_rules! ${name} changed upstream (fingerprint ${got}, expected ${want}); re-read it and update tools/codegen/features.ts`);
    }
  }
}

/** `Option<_>` expression: `None` or `Some(<lit>)`. */
function optionExpr<T>(p: Parser, value: (t: Tok) => T): T | undefined {
  const t = p.ident();
  if (t.text === "None") return undefined;
  if (t.text !== "Some") fail(p.path, t, "expected `None` or `Some(..)`");
  p.expect("OpenParen");
  const v = value(p.next());
  p.expect("CloseParen");
  return v;
}

interface FeatureEntry {
  line: number;
  docs: string[];
  /** Plain comments before the entry (output only). */
  comments: string[];
  status: string;
  name: string;
  since: string;
  issue: number | undefined;
  reason?: string | undefined;
  pull?: number | undefined;
}

/**
 * The `declare_features!( .. )` invocation of `file`: `$( $(#[doc = $doc:tt])* ($status:ident,
 * $feature:ident, $ver:expr, $issue:expr [, $reason:expr $(, $pull:expr)?]), )+`.
 */
function parseDeclareFeatures(file: string, form: "accepted" | "removed" | "unstable"): { entries: FeatureEntry[]; trailing: string[]; toks: Tok[]; path: string } {
  const { path, toks } = load(file);
  // The invocation, not the `macro_rules! declare_features` definition.
  const at = toks.findIndex((t, i) => t.text === "declare_features" && t.kind.$ === "Ident" && toks[i + 1]?.kind.$ === "Bang" && toks[i - 1]?.kind.$ !== "Bang");
  if (at < 0) fail(path, undefined, "no declare_features! invocation");
  const open = at + 2;
  if (toks[open]?.kind.$ !== "OpenParen" && toks[open]?.kind.$ !== "OpenBrace" && toks[open]?.kind.$ !== "OpenBracket") fail(path, toks[open], "expected a delimited macro input");
  const close = group(path, toks, open);
  const p = new Parser(path, toks, open + 1, close);
  const entries: FeatureEntry[] = [];
  for (;;) {
    const comments = p.comments();
    const docs: string[] = [];
    for (let t = p.peek(); t !== undefined && isComment(t); t = p.peek()) {
      if (!isOuterDoc(t)) {
        // A plain comment between doc comments is not a token; keep it with the entry.
        comments.push(t.text.trimEnd());
        p.i++;
        continue;
      }
      docs.push(t.text.slice(3).replace(/\r$/, ""));
      p.i++;
    }
    if (p.peek()?.kind.$ === "Pound") fail(path, p.peek(), "only `#[doc]` attributes match `$(#[doc = $doc:tt])*`");
    if (p.peek() === undefined) {
      if (docs.length > 0) fail(path, toks[close], "doc comment without a feature");
      if (entries.length === 0) fail(path, toks[close], "`$(..)+` needs at least one feature");
      return { entries, trailing: comments, toks, path };
    }
    const lp = p.expect("OpenParen");
    const st = p.ident();
    const ok = form === "unstable" ? ["unstable", "incomplete", "internal"].includes(st.text) : st.text === form;
    if (!ok) fail(path, st, `status \`${st.text}\` does not match this declare_features!`);
    p.expect("Comma");
    const name = p.ident();
    p.expect("Comma");
    const since = strValue(path, p.next());
    p.expect("Comma");
    const issue = optionExpr(p, (t) => u32Value(path, t));
    const e: FeatureEntry = { line: lp.line, docs, comments, status: st.text, name: name.text, since, issue };
    if (form === "removed") {
      p.expect("Comma");
      e.reason = optionExpr(p, (t) => strValue(path, t));
      e.pull = undefined;
      if (p.eat("Comma")) {
        const t = p.next();
        const n = u32Value(path, t);
        // `opt_nonzero_u32!($val)` is `Some(<NonZero<u32>>::new($val).unwrap())` in a static: 0 fails to compile.
        if (n === 0) fail(path, t, "`NonZero::new(0).unwrap()` in a static");
        e.pull = n;
      }
    }
    p.expect("CloseParen");
    p.expect("Comma");
    entries.push(e);
  }
}

/** Line of `fn <name>` in the `macro_rules! declare_features` definition of `toks`. */
function macroFnLine(path: string, toks: Tok[], name: string): number {
  const def = toks.findIndex((t, i) => t.text === "macro_rules" && toks[i + 2]?.text === "declare_features");
  if (def < 0) fail(path, undefined, "no macro_rules! declare_features");
  const end = group(path, toks, def + 3);
  for (let i = def; i < end; i++) if (toks[i]!.text === "fn" && toks[i + 1]?.text === name) return toks[i]!.line;
  fail(path, toks[def], `no fn ${name} in macro_rules! declare_features`);
}

function header(src: string, what: string): string[] {
  return [`// GENERATED by tools/codegen/features.ts from ${CRATE}/${src} (${what}) at ${PIN.commit.slice(0, 12)}. Do not edit.`];
}

function docLines(indent: string, e: FeatureEntry): string[] {
  return [...e.comments.map((c) => indent + c), ...e.docs.map((d) => `${indent}///${d}`)];
}

function lit(s: string): string {
  return JSON.stringify(s);
}

function opt(n: number | undefined): string {
  return n === undefined ? "undefined" : String(n);
}

function checkUnique(path: string, entries: FeatureEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    // Duplicates would be duplicate `fn $feature` / `sym::` uses; tidy and rustc reject them.
    if (e.name === "__proto__" || e.name === "constructor") fail(path, undefined, `feature name ${e.name} cannot be a JS property`);
    if (seen.has(e.name)) fail(path, undefined, `duplicate feature ${e.name}`);
    seen.add(e.name);
  }
}

function genAccepted(): string {
  const { entries, trailing, path } = parseDeclareFeatures("accepted.rs", "accepted");
  checkUnique(path, entries);
  const l = header("accepted.rs", "declare_features! expansion");
  l.push(`import { sym } from "../rustc_span/symbol.ts";`);
  l.push(`import { type Feature, to_nonzero } from "./lib.ts";`);
  l.push("");
  l.push("/// Formerly unstable features that have now been accepted (stabilized).");
  l.push("export const ACCEPTED_LANG_FEATURES: readonly Feature[] = [");
  for (const e of entries) {
    l.push(...docLines("  ", e));
    l.push(`  { name: sym.${e.name}, since: ${lit(e.since)}, issue: to_nonzero(${opt(e.issue)}) },`);
  }
  l.push(...trailing.map((c) => "  " + c));
  l.push("];");
  return l.join("\n") + "\n";
}

function genRemoved(): string {
  const { entries, trailing, path } = parseDeclareFeatures("removed.rs", "removed");
  checkUnique(path, entries);
  const l = header("removed.rs", "declare_features! expansion");
  l.push(`import { sym } from "../rustc_span/symbol.ts";`);
  l.push(`import { to_nonzero } from "./lib.ts";`);
  l.push(`import type { RemovedFeature } from "./removed.ts";`);
  l.push("");
  l.push("/// Formerly unstable features that have now been removed.");
  l.push("export const REMOVED_LANG_FEATURES: readonly RemovedFeature[] = [");
  for (const e of entries) {
    l.push(...docLines("  ", e));
    l.push(
      `  { feature: { name: sym.${e.name}, since: ${lit(e.since)}, issue: to_nonzero(${opt(e.issue)}) }, reason: ${e.reason === undefined ? "undefined" : lit(e.reason)}, pull: ${opt(e.pull)} },`,
    );
  }
  l.push(...trailing.map((c) => "  " + c));
  l.push("];");
  return l.join("\n") + "\n";
}

function genUnstable(): string {
  const { entries, trailing, path, toks } = parseDeclareFeatures("unstable.rs", "unstable");
  checkUnique(path, entries);
  for (const reserved of ["enabled", "incomplete", "internal", "gca", "enabled_features", "enabled_lang_features", "enabled_lib_features"]) {
    // Same-named inherent fns would not compile upstream.
    if (entries.some((e) => e.name === reserved)) fail(path, undefined, `feature ${reserved} collides with a Features method`);
  }
  const incompleteLine = macroFnLine(path, toks, "incomplete");
  const internalLine = macroFnLine(path, toks, "internal");
  const l = header("unstable.rs", "declare_features! expansion");
  l.push("// Extends `Features` (unstable.ts); loaded for its side effects by lib.ts (PORTING.md §5 \"Methods defined in another file\").");
  l.push(`import { panic } from "../std/panic.ts";`);
  l.push(`import { Symbol, sym } from "../rustc_span/symbol.ts";`);
  l.push(`import { type Feature, to_nonzero } from "./lib.ts";`);
  l.push(`import { Features } from "./unstable.ts";`);
  l.push("");
  l.push("/// Unstable language features that are being implemented or being");
  l.push("/// considered for acceptance (stabilization) or removal.");
  l.push("export const UNSTABLE_LANG_FEATURES: readonly Feature[] = [");
  for (const e of entries) {
    l.push(...docLines("  ", e));
    l.push(`  { name: sym.${e.name}, since: ${lit(e.since)}, issue: to_nonzero(${opt(e.issue)}) }, // ${e.status}`);
  }
  l.push(...trailing.map((c) => "  " + c));
  l.push("];");
  l.push("");
  l.push(`declare module "./unstable.ts" {`);
  l.push("  interface Features {");
  for (const e of entries) l.push(`    ${e.name}(): boolean;`);
  l.push("    incomplete(feature: Symbol): boolean;");
  l.push("    internal(feature: Symbol): boolean;");
  l.push("  }");
  l.push("}");
  l.push("");
  l.push("// `pub fn $feature(&self) -> bool { self.enabled(sym::$feature) }` for each feature.");
  for (const e of entries) {
    l.push(`Features.prototype.${e.name} = function (this: Features): boolean {`);
    l.push(`  return this.enabled(sym.${e.name});`);
    l.push("};");
  }
  const statusFn = (fn: string, marker: number, want: string, docs: string[], fallback: string[]) => {
    l.push("");
    l.push(...docs);
    l.push(`// rustc: ${CRATE}/unstable.rs:${marker} ${fn}`);
    l.push(`Features.prototype.${fn} = function (this: Features, feature: Symbol): boolean {`);
    l.push(`  // PORT: \`f if f == sym::$feature => status_to_enum!($status) == FeatureStatus::${want}\` per feature,`);
    l.push("  // in declaration order; the status comparison is folded here (the generator knows `$status`).");
    l.push("  switch (feature) {");
    for (const e of entries) {
      l.push(`    case sym.${e.name}: // ${e.status}`);
      l.push(`      return ${e.status === want.toLowerCase()};`);
    }
    l.push("  }");
    l.push("  if (this.enabled_features_.has(feature)) {");
    l.push(...fallback.map((s) => "    " + s));
    l.push("  }");
    l.push("  panic(`\\`${Symbol.as_str(feature)}\\` was not listed in \\`declare_features\\``);");
    l.push("};");
  };
  statusFn(
    "incomplete",
    incompleteLine,
    "Incomplete",
    [
      "/// Some features are known to be incomplete and using them is likely to have",
      "/// unanticipated results, such as compiler crashes. We warn the user about these",
      "/// to alert them.",
    ],
    ["// Accepted/removed features and library features aren't in this file but", "// are never incomplete.", "return false;"],
  );
  statusFn(
    "internal",
    internalLine,
    "Internal",
    ["/// Some features are internal to the compiler and standard library and should not", "/// be used in normal projects. We warn the user about these to alert them."],
    [
      "// This could be accepted/removed, or a libs feature.",
      "// Accepted/removed features aren't in this file but are never internal",
      "// (a removed feature might have been internal, but that's now irrelevant).",
      "// Libs features are internal if they end in `_internal` or `_internals`.",
      "// As a special exception we also consider `core_intrinsics` internal;",
      "// renaming that age-old feature is just not worth the hassle.",
      "// We just always test the name; it's not a big deal if we accidentally hit",
      "// an accepted/removed lang feature that way.",
      "const name = Symbol.as_str(feature);",
      'return name === "core_intrinsics" || name.endsWith("_internal") || name.endsWith("_internals");',
    ],
  );
  return l.join("\n") + "\n";
}

/** `pub static BUILTIN_ATTRIBUTES: &[Symbol] = &[ sym::$name, .. ];` */
function genBuiltinAttrs(): string {
  const { path, toks } = load("builtin_attrs.rs");
  const at = toks.findIndex((t, i) => t.text === "BUILTIN_ATTRIBUTES" && toks[i - 1]?.text === "static");
  if (at < 0) fail(path, undefined, "no `static BUILTIN_ATTRIBUTES`");
  const open = toks.findIndex((t, i) => i > at && t.kind.$ === "OpenBracket" && toks[i - 1]?.kind.$ === "And" && toks[i - 2]?.kind.$ === "Eq");
  if (open < 0) fail(path, toks[at], "expected `= &[`");
  const close = group(path, toks, open);
  const p = new Parser(path, toks, open + 1, close);
  const l = header("builtin_attrs.rs", "BUILTIN_ATTRIBUTES");
  l.push(`import { type Symbol, sym } from "../rustc_span/symbol.ts";`);
  l.push("");
  l.push("/// Attributes that have a special meaning to rustc or rustdoc.");
  l.push("export const BUILTIN_ATTRIBUTES: readonly Symbol[] = [");
  let n = 0;
  for (;;) {
    for (let t = p.peek(); t !== undefined && isComment(t); t = p.peek()) {
      if (t.kind.$ === "LineComment" && t.kind.doc_style !== undefined) fail(path, t, "unexpected doc comment");
      l.push("  " + t.text.trimEnd());
      p.i++;
    }
    if (p.peek() === undefined) break;
    p.expect("Ident", "sym");
    p.expect("Colon");
    p.expect("Colon");
    const name = p.ident();
    let line = `  sym.${name.text},`;
    if (!p.eat("Comma")) {
      if (p.peek() !== undefined) fail(path, p.peek(), "expected `,`");
      line = `  sym.${name.text}`;
    }
    // A trailing comment on the same line stays on that line.
    const t = p.peek();
    if (t !== undefined && isComment(t) && t.line === name.line) {
      line += " " + t.text.trimEnd();
      p.i++;
    }
    l.push(line);
    n++;
  }
  if (n === 0) fail(path, toks[open], "empty BUILTIN_ATTRIBUTES");
  l.push("];");
  return l.join("\n") + "\n";
}

/** Output path (relative to the repo) -> text. Throws `GenError` on malformed input. */
export function generate(): Map<string, string> {
  checkMacroFingerprints();
  return new Map([
    [`${OUT}/accepted.gen.ts`, genAccepted()],
    [`${OUT}/removed.gen.ts`, genRemoved()],
    [`${OUT}/unstable.gen.ts`, genUnstable()],
    [`${OUT}/builtin_attrs.gen.ts`, genBuiltinAttrs()],
  ]);
}

function main(): void {
  requireUpstream();
  let head = "";
  try {
    head = execFileSync("git", ["-C", UPSTREAM, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    head = "";
  }
  if (head !== PIN.commit) die(`upstream checkout ${UPSTREAM} is at ${head || "?"}, UPSTREAM.json pins ${PIN.commit}`);
  let files: Map<string, string>;
  try {
    files = generate();
  } catch (e) {
    if (e instanceof GenError) die(e.message);
    throw e;
  }
  const check = process.argv.includes("--check");
  for (const [rel, text] of files) {
    const out = join(REPO, rel);
    if (check) {
      let cur = "";
      try {
        cur = readFileSync(out, "utf8");
      } catch {}
      if (cur !== text) die(`${rel} is stale; run: bun tools/codegen/features.ts`);
    } else writeFileSync(out, text);
  }
  console.log(`${check ? "up to date" : "wrote"}: ${[...files.keys()].join(", ")}`);
}

if (import.meta.main) main();
