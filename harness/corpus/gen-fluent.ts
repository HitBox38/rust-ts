// Generates harness/corpus/fluent/*.msgs: every inline Fluent message literal in the pinned
// upstream `compiler/` sources, for the `fluent-parse` and `fluent-format` suites.
//
//   bun harness/corpus/gen-fluent.ts      rewrite the corpus (deterministic; commit the output)
//
// Forms extracted (see compiler/rustc_macros/src/diagnostics/{diagnostic_builder,utils,msg_macro}.rs):
//   - `#[diag("...")]`                                   (DiagnosticDeriveVariantBuilder, `diag`)
//   - `#[label|note|note_once|help|help_once|warning|suggestion|multipart_suggestion("...", ..)]`
//                                                        (SubdiagnosticVariant::from_attr; only the
//                                                         first argument is a message)
//   - `msg!("...")` / `msg![..]` / `msg!{..}`            (the `msg` proc macro)
// Every one of those takes a `syn::LitStr` and uses `LitStr::value()`. The message is the
// decoded value: cooked strings are decoded with the ported rustc-literal-escaper
// (`unescape_str`, protected by the `escape` suites), raw strings are taken verbatim. The source
// is tokenized with the ported rustc_lexer (protected by the `lex` suite), so text inside
// comments, doc comments and other string literals is never mistaken for a message.
// `#[suggestion_part(code = "...")]` and `code = "..."` arguments are Rust format strings, not
// Fluent, and are not extracted.
//
// Not extractable (counted and printed, never guessed): an attribute/`msg!` of the forms above
// whose first token is not a string literal (`#[note]`, `#[label(code = ..)]`, `msg!($m)`, ...),
// and literals that are not plain/raw `str` literals or carry a suffix.
//
// Layout: one corpus file (= one suite case) per unique message, at
// `harness/corpus/fluent/<crate>/<id>.msgs`, where <crate> is the crate of its first occurrence
// (files in sorted path order, then source order) and <id> = the first 12 hex digits of the
// SHA-256 of the message. Content-addressed ids keep a case's id stable when upstream lines move
// or files are renamed at a repin, so ordinary churn is not reported as protected-case losses.
// Identical messages are deduplicated: every occurrence is listed as provenance. The file format allows several records per file (the
// probe and subject loop over them), but the generator writes one. Format (read by
// tools/probes/fluentdump/main.rs and src/rust_ts/fluentdump.ts):
//
//   // comment lines (header)
//   @ <upstream path>:<line> <form>      one or more provenance lines
//   = <N>                                 N = byte length of the UTF-8 message
//   <exactly N bytes of message>          followed by "\n"
//
// Blank lines and `//` lines between records are ignored.
//
// Plus `harness/corpus/fluent/synthetic/<id>.msgs`: hand-written messages (list below) for the
// syntax and error paths no upstream message reaches (upstream messages all parse).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, strip_shebang, tokenize, type TokenKind } from "../../src/rustc_lexer/lib.ts";
import { Str } from "../../src/std/str.ts";
import { EscapeError, unescape_str } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import { debug_EscapeError } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import { PLAIN } from "../../src/std/fmt.ts";

const OUT = join(REPO, "harness", "corpus", "fluent");
const ATTRS = new Set(["diag", "label", "note", "note_once", "help", "help_once", "warning", "suggestion", "multipart_suggestion"]);

interface Occurrence {
  file: string;
  line: number;
  form: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(UPSTREAM, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith(".rs")) out.push(rel);
  }
  return out;
}

interface Tok {
  kind: TokenKind;
  start: number;
  len: number;
}

const stats = {
  files: 0,
  filesWithMessages: 0,
  occurrences: 0,
  byForm: new Map<string, number>(),
  nonLiteral: new Map<string, string[]>(),
  badLiteral: [] as string[],
  notUtf8: [] as string[],
};

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** `LitStr::value()` of a `str`/raw `str` literal token, or an error description. */
function literalValue(src: Str, t: Tok): { value: string } | { error: string } {
  if (t.kind.$ !== "Literal") return { error: `not a literal (${t.kind.$})` };
  const kind = t.kind.kind;
  if (t.kind.suffix_start !== t.len) return { error: "literal has a suffix" };
  if (kind.$ === "Str" && kind.terminated) {
    const content = src.slice(t.start + 1, t.start + t.len - 1);
    let value = "";
    let error: string | undefined;
    unescape_str(content, (_lo, _hi, r) => {
      if (r.$ === "Ok") value += String.fromCodePoint(r._0);
      // Non-fatal results are warnings (skipped whitespace); the decoded value omits them.
      else if (EscapeError.is_fatal(r._0)) error ??= `escape error ${debug_EscapeError(r._0, PLAIN)}`;
    });
    return error === undefined ? { value } : { error };
  }
  if (kind.$ === "RawStr" && kind.n_hashes !== undefined) {
    const n = kind.n_hashes;
    return { value: src.slice(t.start + 2 + n, t.start + t.len - 1 - n).toString() };
  }
  return { error: `literal kind ${kind.$}` };
}

const messages = new Map<string, Occurrence[]>(); // insertion order = first occurrence order
const firstFile = new Map<string, string>();

const files = walk("compiler").sort();
for (const file of files) {
  stats.files++;
  const bytes = readFileSync(join(UPSTREAM, file));
  try {
    decoder.decode(bytes);
  } catch {
    stats.notUtf8.push(file);
    continue;
  }
  const full = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const base = strip_shebang(full) ?? 0;
  const src = full.slice(base);
  const lineStarts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) lineStarts.push(i + 1);
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // Significant tokens only (no whitespace or comments, incl. doc comments).
  const toks: Tok[] = [];
  let pos = 0;
  for (const tok of tokenize(src, FrontmatterAllowed.Yes)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") toks.push({ kind: tok.kind, start: pos, len: tok.len });
    pos += tok.len;
  }
  const text = (t: Tok | undefined): string => (t ? src.slice(t.start, t.start + t.len).toString() : "");
  const is = (t: Tok | undefined, k: TokenKind["$"]): boolean => t !== undefined && t.kind.$ === k;

  let found = false;
  const take = (form: string, lit: Tok | undefined, at: Tok): void => {
    const where = `${file}:${lineOf(base + at.start)}`;
    if (!lit || lit.kind.$ !== "Literal") {
      const l = stats.nonLiteral.get(form) ?? [];
      l.push(where);
      stats.nonLiteral.set(form, l);
      return;
    }
    const r = literalValue(src, lit);
    if ("error" in r) {
      stats.badLiteral.push(`${where} ${form}: ${r.error}`);
      return;
    }
    stats.occurrences++;
    bump(stats.byForm, form);
    found = true;
    const occ: Occurrence = { file, line: lineOf(base + lit.start), form };
    const prev = messages.get(r.value);
    if (prev) prev.push(occ);
    else {
      messages.set(r.value, [occ]);
      firstFile.set(r.value, file);
    }
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    // `#[name(` ... — attribute forms.
    if (is(t, "Pound") && is(toks[i + 1], "OpenBracket") && is(toks[i + 2], "Ident") && ATTRS.has(text(toks[i + 2]))) {
      const name = text(toks[i + 2]);
      if (is(toks[i + 3], "OpenParen")) take(`#[${name}]`, toks[i + 4], toks[i + 2]!);
      else take(`#[${name}]`, undefined, toks[i + 2]!);
      continue;
    }
    // `msg!(` / `msg![` / `msg!{`.
    if (is(t, "Ident") && text(t) === "msg" && is(toks[i + 1], "Bang")) {
      const open = toks[i + 2];
      if (is(open, "OpenParen") || is(open, "OpenBracket") || is(open, "OpenBrace")) take("msg!", toks[i + 3], t);
    }
  }
  if (found) stats.filesWithMessages++;
}

// ---- write the corpus ------------------------------------------------------------------------
const byFile = new Map<string, string[]>();
for (const [msg, file] of firstFile) {
  const l = byFile.get(file) ?? [];
  l.push(msg);
  byFile.set(file, l);
}

rmSync(OUT, { recursive: true, force: true });
let corpusFiles = 0;

const usedIds = new Map<string, string>(); // path -> message
/** Content-addressed case name: first 12 hex digits of SHA-256 of the message's UTF-8 bytes. */
function contentId(dir: string, msg: string): string {
  const id = createHash("sha256").update(encoder.encode(msg)).digest("hex").slice(0, 12);
  const prev = usedIds.get(join(dir, id));
  if (prev !== undefined && prev !== msg) throw new Error(`ERROR: content id collision ${id} in ${dir}`);
  usedIds.set(join(dir, id), msg);
  return id;
}

function writeRecord(dir: string, name: string, provenance: string[], msg: string): void {
  mkdirSync(dir, { recursive: true });
  const parts: Uint8Array[] = [];
  const push = (s: string) => parts.push(encoder.encode(s));
  push(`// GENERATED by harness/corpus/gen-fluent.ts at ${PIN.commit.slice(0, 12)}; do not edit.\n`);
  for (const p of provenance) push(`@ ${p}\n`);
  const body = encoder.encode(msg);
  push(`= ${body.length}\n`);
  parts.push(body);
  push("\n");
  writeFileSync(join(dir, `${name}.msgs`), Buffer.concat(parts));
  corpusFiles++;
}

for (const [file, msgs] of byFile) {
  // compiler/rustc_parse/src/diagnostics.rs -> harness/corpus/fluent/rustc_parse/
  const dir = join(OUT, file.split("/")[1]!);
  for (const msg of msgs) {
    const occs = messages.get(msg)!;
    writeRecord(
      dir,
      contentId(dir, msg),
      occs.map((o) => `${o.file}:${o.line} ${o.form}`),
      msg,
    );
  }
}

// ---- synthetic messages ------------------------------------------------------------------------
// Upstream messages all parse (rustc_macros rejects invalid Fluent at build time) and use a small
// part of the syntax. These cover the rest of fluent-syntax/fluent-bundle as `format_fluent_str`
// can reach it: everything after `generated_msg = ` up to the final "\n" is the message, so a
// newline followed by an unindented line starts a new entry. Provenance: `synthetic:<n> <what>`.
const SYNTHETIC: [string, string][] = [
  // text, lines, indentation
  ["empty message", ""],
  ["only spaces", "   "],
  ["leading spaces", "   leading"],
  ["trailing spaces", "trailing   "],
  ["multiline, indented", "line one\n    line two"],
  ["multiline, blank line inside", "line one\n\n    after blank"],
  ["multiline, deeper indent kept", "line one\n        deeper\n    shallow"],
  ["multiline, first line empty", "\n    starts on next line"],
  ["unindented second line (new entry: junk)", "line one\nnot indented"],
  ["tab inside text", "a\tb"],
  ["tab indentation (not Fluent indentation)", "line one\n\tline two"],
  ["CRLF line ending", "line one\r\n    line two"],
  ["bare CR", "a\rb"],
  ["NUL", "a\u0000b"],
  ["non-ASCII", "é 中 😀 {\"中\"}"],
  ["`=` in text", "a = b"],
  ["continuation line starting with `[`", "x\n    [not a key]"],
  ["continuation line starting with `*`", "x\n    *star"],
  ["continuation line starting with `.`", "x\n    .dot"],
  ["continuation line starting with `{`", "x\n    {\"y\"}"],
  // further entries
  ["attribute", "x\n    .attr = attribute value"],
  ["only an attribute (no value)", "\n    .attr = attribute value"],
  ["second message", "x\nother = second message"],
  ["duplicate id", "x\ngenerated_msg = duplicate"],
  ["comment after", "x\n# comment"],
  ["group comment after", "x\n## group comment"],
  ["resource comment after", "x\n### resource comment"],
  ["term defined after", "{ -term }\n-term = T"],
  ["term with attribute and parameters", "{ -term(case: \"x\") }\n-term = { $case ->\n    [x] X\n   *[other] other\n}\n    .attr = A"],
  ["message reference, defined", "{ other }\nother = O"],
  ["message attribute reference, defined", "{ other.attr }\nother = O\n    .attr = A"],
  ["message reference, undefined", "{ missing }"],
  ["term reference, undefined", "{ -missing }"],
  ["self reference (cycle)", "{ generated_msg }"],
  ["term attribute as placeable", "{ -term.attr }\n-term = T\n    .attr = A"],
  // placeables and literals
  ["string literal", "{ \"string literal\" }"],
  ["braces via string literals", "{\"{\"}x{\"}\"}"],
  ["string escapes", "{\"\\u0041\\U01F600\\\\\\\"\"}"],
  ["string escape \\q (invalid)", "{\"\\q\"}"],
  ["string escape \\u12 (too short)", "{\"\\u12\"}"],
  ["string escape \\UD800 (surrogate)", "{\"\\UD800\"}"],
  ["string escape \\UFFFFFF (out of range)", "{\"\\UFFFFFF\"}"],
  ["unterminated string literal", "{\"abc}"],
  ["string literal with newline", "{\"a\n    b\"}"],
  ["number literals", "{ 42 } { -3.14 } { 007 } { 0.50 }"],
  ["bad number literal", "{ 1. }"],
  ["empty placeable", "{}"],
  ["unterminated placeable", "{ $a"],
  ["lone `{`", "a { b"],
  ["lone `}`", "a } b"],
  ["nested placeable", "{ { \"nested\" } }"],
  ["placeable spanning lines", "{\n    $a\n}"],
  ["adjacent placeables", "{$a}{$b}{\"c\"}"],
  ["101 placeables", "{$a}".repeat(101)],
  // variables
  ["`$` alone", "{ $ }"],
  ["`$1`", "{ $1 }"],
  ["variable with `-` and `_`", "{ $a-b_c }"],
  ["variable starting with `-`", "{ $-a }"],
  // functions
  ["STREQ variable", "{ STREQ($a, \"x\") }"],
  ["STREQ literals equal", "{ STREQ(\"a\", \"a\") }"],
  ["STREQ one argument", "{ STREQ($a) }"],
  ["STREQ numbers", "{ STREQ(1, 1) }"],
  ["unknown function", "{ NUMBER($n) }"],
  ["lowercase callee", "{ lower() }"],
  ["named arguments", "{ FOO(a: 1, b: \"x\") }"],
  ["named argument with variable value", "{ FOO(a: $x) }"],
  ["duplicate named argument", "{ FOO(a: 1, a: 2) }"],
  ["positional after named", "{ FOO(a: 1, 2) }"],
  ["trailing comma in call", "{ FOO(1,) }"],
  // selects
  ["select on one line", "{ $n -> [one] one *[other] other }"],
  ["plural select", "{ $n ->\n    [one] {$n} item\n   *[other] {$n} items\n}"],
  ["numeric keys", "{ $n ->\n    [0] zero\n    [1.0] one\n    [-1] minus one\n   *[other] other\n}"],
  ["key with spaces", "{ $n ->\n    [ one ] one\n   *[ other ] other\n}"],
  ["default first", "{ $n ->\n   *[other] other\n    [one] one\n}"],
  ["missing default", "{ $n ->\n    [one] one\n    [other] other\n}"],
  ["two defaults", "{ $n ->\n   *[one] one\n   *[other] other\n}"],
  ["no variants", "{ $n ->\n}"],
  ["string literal selector", "{ \"b\" ->\n    [a] A\n   *[b] B\n}"],
  ["number literal selector", "{ 1 ->\n    [one] one\n   *[other] other\n}"],
  ["message reference selector", "{ other ->\n   *[a] A\n}\nother = O"],
  ["term selector", "{ -term ->\n   *[a] A\n}\n-term = T"],
  ["term attribute selector", "{ -term.attr ->\n    [a] A\n   *[b] B\n}\n-term = T\n    .attr = a"],
  ["STREQ selector", "{ STREQ($a, \"x\") ->\n    [true] yes\n   *[false] no\n}"],
  ["nested select", "{ $a ->\n    [true] { $b ->\n        [true] both\n       *[false] a only\n    }\n   *[false] not a\n}"],
  ["select with empty variant", "{ $n ->\n    [one] {\"\"}\n   *[other]\n}"],
  ["select in text, multiline variants", "before { $n ->\n    [one] one\n        line two\n   *[other] other\n} after"],
  ["bad variant key", "{ $n ->\n    [a b] x\n   *[c] y\n}"],
];

{
  const dir = join(OUT, "synthetic");
  SYNTHETIC.forEach(([what, msg], i) => {
    writeRecord(dir, contentId(dir, msg), [`synthetic:${i + 1} ${what}`], msg);
  });
  // Records are length-framed and synthetic messages contain CR, CRLF and NUL on purpose: never
  // let git normalize line endings (core.autocrlf) anywhere in the corpus.
  writeFileSync(
    join(OUT, ".gitattributes"),
    "# Generated by harness/corpus/gen-fluent.ts. Records are length-framed and synthetic messages contain bare CR, CRLF and NUL: never normalize.\n* -text\n",
  );
}

// ---- report ----------------------------------------------------------------------------------
console.log(`scanned ${stats.files} files; ${stats.filesWithMessages} contain messages; ${byFile.size} have new messages; ${corpusFiles} corpus files (${SYNTHETIC.length} synthetic)`);
console.log(`occurrences ${stats.occurrences}, unique messages ${messages.size}`);
console.log(`by form: ${[...stats.byForm].sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
for (const [form, l] of [...stats.nonLiteral].sort()) console.log(`not a literal: ${form} ${l.length} (e.g. ${l.slice(0, 3).join(", ")})`);
for (const b of stats.badLiteral) console.log(`ERROR: unextractable literal: ${b}`);
for (const f of stats.notUtf8) console.log(`not utf-8: ${f}`);
