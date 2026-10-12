// Generates harness/corpus/emit/gen/*.json: "diagnostic scripts" for the `emit` suite (the
// emitter's ground truth; format documented in tools/probes/emitdump/main.rs).
//
//   bun harness/corpus/gen-emit.ts      rewrite the files (output is deterministic; commit them)
//
// Hand-written cases live in harness/corpus/emit/hand/ and are not touched by this script.
//
// Families (file name prefix), each case seeded from its own name so families are independent:
// - basic:    one diagnostic, any top-level level, optional code, one primary span, a few labels
// - labels:   many labels: overlapping, nested, same start/end, multi-line, empty, several primary
//             spans, spans in other files
// - children: notes/helps/warns with and without spans, `sub` at every Sublevel, highlighted
//             notes/helps, expected/found notes, `*_once` across diagnostics
// - sugg:     every suggestion API x every Applicability (x every SuggestionStyle where it takes
//             one): insertions, deletions, replacements, multi-line code, many alternatives
// - options:  the emitter option matrix (theme x color x short_message x width x source_map x
//             terminal_url) over a fixed diagnostic, plus macro_backtrace / ignored directories
// - count:    sequences of diagnostics (levels, codes with/without long explanations, duplicates,
//             warnings off, dedup off, delayed bugs) ending in print_error_count / abort_if_errors
// - stash:    stash / steal_non_err / try_steal_modify_and_emit_err / emit_stashed sequences
// - long:     long lines and labels far apart under widths 20..200
// - unicode:  wide (CJK), combining, ZWJ, bidi controls, tabs, CRLF, BOM, control characters,
//             no trailing newline, empty files
// - combo:    ui_testing together with diagnostic_width (rustc allows both; the width wins), and
//             macro_backtrace set on the emitter and the DiagCtxt flags together (as rustc's
//             -Zmacro-backtrace does). All spans are root-context, so this is not macro-backtrace
//             rendering coverage; that needs expansion spans (later, with rustc_expand).
//
// Invariants the generator keeps (the probe panics otherwise, or upstream would ICE): every case
// sets ui_testing or diagnostic_width; spans are on char boundaries of the normalized source (BOM
// removed, CRLF -> LF); suggestions stay in one file, multipart parts never overlap and never pair
// an empty span with empty code; only errors/warnings are stashed, warnings are what steal_non_err
// takes, errors what try_steal_modify_and_emit_err takes; print_error_count only runs with nothing
// stashed; a delayed bug only appears in a case that emits an error; no reset_err_count in a case
// with delayed bugs or stashed errors.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "emit", "gen");

// ---------------------------------------------------------------------------------------------
// Deterministic randomness

function seedOf(s: string): number {
  // FNV-1a 32
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

class Rng {
  constructor(private s: number) {}
  next(): number {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------------------------------------
// Sources

interface Src {
  name?: string;
  custom?: string;
  src: string;
}

const MAIN_RS = `use std::collections::HashMap;

fn main() {
    let x: i32 = "hello";
    let y = vec![1, 2, 3];
    for i in 0..10 {
        println!("{}", i + y[0]);
    }
    if x > 5 {
        return;
    }
    let mut map = HashMap::new();
    map.insert("key", x);
}
`;

const STRUCT_RS = `#[derive(Debug, Clone)]
pub struct Point<T> {
    pub x: T,
    pub y: T,
}

impl<T: Copy + std::ops::Add<Output = T>> Point<T> {
    pub fn new(x: T, y: T) -> Self {
        Point { x, y }
    }

    pub fn sum(&self) -> T {
        self.x + self.y
    }
}

trait Shape {
    fn area(&self) -> f64;
    fn name(&self) -> String { String::from("shape") }
}
`;

const LONG_RS = `fn long() {
    let result = some_function_with_a_long_name(first_argument_value, second_argument_value, third_argument_value, fourth_argument_value, fifth_argument_value, sixth_argument_value);
    let s = "a string literal that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on";
    short();
    let v = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
}
`;

const UNICODE_RS = `fn unicode() {
    let 名前 = "日本語のテキスト";
    let emoji = "👨‍👩‍👧 family 🦀 crab";
    let accent = "é and é";
    let wide = "ＡＢＣ　全角";
    let bidi = "abc‮def‬ ghi";
    let zw = "a​b‍c";
    let arabic = "مرحبا بالعالم";
}
`;

const TABS_RS = "fn tabs() {\n\tlet a = 1;\n\t\tlet b =\t2;\n    \tlet c = a +\tb;\n\tif a == b {\t\treturn; }\n}\n";

const CRLF_RS = "fn crlf() {\r\n    let a = 1;\r\n    let b = 2;\r\n    a + b\r\n}\r\n";

const BOM_RS = "﻿fn bom() {\n    let a = 1;\n}\n";

const CTRL_RS = "fn ctrl() {\n    let bell = \"\u0007\";\n    let esc = \"\u001b[31m\";\n    let del = \"\u007f\";\n    let nul = \"\u0000\";\n    let lone_cr = \"a\rb\";\n}\n";

const NO_NL_RS = "fn f() { let x = 1; }";

const EMPTY_RS = "";

const MANY_RS = Array.from({ length: 130 }, (_, i) => (i % 10 === 0 ? `// section ${i / 10}` : `    let v${i} = ${i} + compute(${i});`)).join("\n") + "\n";

const LIB_RS = `pub mod util;

pub fn helper(a: u32) -> u32 {
    a * 2
}
`;

const DEEP_RS = `pub(crate) fn deep() -> Option<u8> {
    None
}
`;

/** File sets; each set is a list of files loaded into one SourceMap in order. */
const SOURCES: Record<string, Src[]> = {
  main: [{ name: "src/main.rs", src: MAIN_RS }],
  struct: [{ name: "src/shapes.rs", src: STRUCT_RS }],
  long: [{ name: "src/long.rs", src: LONG_RS }],
  unicode: [{ name: "src/unicode.rs", src: UNICODE_RS }],
  tabs: [{ name: "src/tabs.rs", src: TABS_RS }],
  crlf: [{ name: "src/crlf.rs", src: CRLF_RS }],
  bom: [{ name: "src/bom.rs", src: BOM_RS }],
  ctrl: [{ name: "src/ctrl.rs", src: CTRL_RS }],
  nonl: [{ name: "src/nonl.rs", src: NO_NL_RS }],
  empty: [{ name: "src/empty.rs", src: EMPTY_RS }],
  many: [{ name: "src/many.rs", src: MANY_RS }],
  multi: [
    { name: "src/main.rs", src: MAIN_RS },
    { name: "src/lib.rs", src: LIB_RS },
    { name: "src/very/deep/path/module_name.rs", src: DEEP_RS },
  ],
  custom: [
    { custom: "anon", src: MAIN_RS },
    { name: "src/lib.rs", src: LIB_RS },
  ],
};

const COMMON_SETS = ["main", "struct", "long", "unicode", "tabs", "multi", "many"];

/** What `SourceFile::new` keeps: BOM removed, CRLF -> LF (lone CR kept). */
function normalize(src: string): string {
  return (src.startsWith("﻿") ? src.slice(1) : src).replaceAll("\r\n", "\n");
}

/** A loaded file: normalized text with byte offsets of every char boundary. */
class File {
  readonly text: string;
  /** bounds[i] = byte offset of the i-th code point; bounds[n] = byte length. */
  readonly bounds: number[] = [];
  /** byte offsets of line starts */
  readonly lines: number[] = [0];
  /** code point index -> byte offset */
  constructor(readonly index: number, src: string) {
    this.text = normalize(src);
    let b = 0;
    for (const ch of this.text) {
      this.bounds.push(b);
      b += Buffer.byteLength(ch);
      if (ch === "\n") this.lines.push(b);
    }
    this.bounds.push(b);
  }
  get len(): number {
    return this.bounds[this.bounds.length - 1]!;
  }
  /** Byte offsets of tokens (identifier runs or single punctuation chars), as [lo, hi]. */
  tokens(): [number, number][] {
    const out: [number, number][] = [];
    const cps = [...this.text];
    let i = 0;
    while (i < cps.length) {
      const c = cps[i]!;
      if (/\s/u.test(c)) {
        i++;
        continue;
      }
      let j = i + 1;
      if (/[\p{L}\p{N}_]/u.test(c)) while (j < cps.length && /[\p{L}\p{N}_]/u.test(cps[j]!)) j++;
      else if (c === '"') {
        while (j < cps.length && cps[j] !== '"' && cps[j] !== "\n") j++;
        if (j < cps.length && cps[j] === '"') j++;
      }
      out.push([this.bounds[i]!, this.bounds[j]!]);
      i = j;
    }
    return out;
  }
  /** [start, end) byte offsets of line `l` without its newline. */
  line(l: number): [number, number] {
    const start = this.lines[l]!;
    const next = this.lines[l + 1];
    return [start, next === undefined ? this.len : next - 1];
  }
  lineCount(): number {
    // a trailing newline does not start a real line
    return this.lines.length - (this.len > 0 && this.text.endsWith("\n") ? 1 : 0) || 1;
  }
  /** Char-boundary byte offsets inside [lo, hi]. */
  boundariesIn(lo: number, hi: number): number[] {
    return this.bounds.filter((b) => b >= lo && b <= hi);
  }
}

type SpanJ = "dummy" | [number, number, number];

/** Random span generator over one case's files. */
class Spans {
  readonly files: File[];
  constructor(
    readonly r: Rng,
    srcs: Src[],
  ) {
    this.files = srcs.map((s, i) => new File(i, s.src));
  }
  file(fi?: number): File {
    return fi !== undefined ? this.files[fi]! : this.r.chance(0.8) ? this.files[0]! : this.r.pick(this.files);
  }
  token(fi?: number): SpanJ {
    const f = this.file(fi);
    const toks = f.tokens();
    if (toks.length === 0) return [f.index, 0, 0];
    const [lo, hi] = this.r.pick(toks);
    return [f.index, lo, hi];
  }
  /** A span within one line. */
  inLine(fi?: number): SpanJ {
    const f = this.file(fi);
    const [ls, le] = f.line(this.r.int(0, f.lineCount() - 1));
    const bs = f.boundariesIn(ls, le);
    const a = this.r.pick(bs);
    const b = this.r.pick(bs);
    return [f.index, Math.min(a, b), Math.max(a, b)];
  }
  multiLine(fi?: number): SpanJ {
    const f = this.file(fi);
    const n = f.lineCount();
    if (n < 2) return this.inLine(f.index);
    const l1 = this.r.int(0, n - 2);
    const l2 = this.r.int(l1 + 1, Math.min(n - 1, l1 + this.r.pick([1, 1, 2, 3, 5, 12])));
    const [s1, e1] = f.line(l1);
    const [s2, e2] = f.line(l2);
    const lo = this.r.pick(f.boundariesIn(s1, e1));
    const hi = this.r.pick(f.boundariesIn(s2, e2 + (f.lines[l2 + 1] !== undefined ? 1 : 0)));
    return [f.index, lo, hi];
  }
  emptyAt(fi?: number): SpanJ {
    const f = this.file(fi);
    const b = this.r.pick(f.bounds);
    return [f.index, b, b];
  }
  wholeLine(fi?: number): SpanJ {
    const f = this.file(fi);
    const l = this.r.int(0, f.lineCount() - 1);
    const [s, e] = f.line(l);
    return [f.index, s, this.r.chance(0.3) && f.lines[l + 1] !== undefined ? e + 1 : e];
  }
  any(fi?: number): SpanJ {
    const k = this.r.next();
    if (k < 0.45) return this.token(fi);
    if (k < 0.65) return this.inLine(fi);
    if (k < 0.8) return this.multiLine(fi);
    if (k < 0.88) return this.emptyAt(fi);
    if (k < 0.96) return this.wholeLine(fi);
    const f = this.file(fi);
    return this.r.chance(0.5) ? [f.index, f.len, f.len] : [f.index, 0, f.len];
  }
  /** A non-empty span, or an empty one at a boundary. Never crosses files. */
  overlapping(base: SpanJ): SpanJ {
    if (base === "dummy") return this.any();
    const [fi, lo, hi] = base;
    const f = this.files[fi]!;
    const bs = f.boundariesIn(Math.max(0, lo - 12), Math.min(f.len, hi + 12));
    const a = this.r.pick(bs);
    const b = this.r.pick(bs);
    return [fi, Math.min(a, b), Math.max(a, b)];
  }
}

// ---------------------------------------------------------------------------------------------
// Messages

const MSGS = [
  "mismatched types",
  "cannot find value `foo` in this scope",
  "unused variable: `x`",
  "expected one of `,`, `:`, or `}`, found `{`",
  "this is a very long message that keeps going so that it is wider than most terminals and the renderer has to deal with it somehow without any special treatment of its own",
  "message with `code` and `more code` and a trailing period.",
  "multi-line message\nsecond line of the message\n  indented third line",
  "unicode in message: 名前 → 🦀",
  "tab\tin message",
  "",
];

const LABELS = [
  "expected `i32`, found `&str`",
  "not found in this scope",
  "help: consider borrowing here",
  "",
  "first borrow occurs here",
  "second mutable borrow occurs here",
  "a label that is fairly long and will need to be placed below the line it points at",
  "label with\nnewline",
  "🦀",
  "this",
];

const NOTES = [
  "`#[warn(unused_variables)]` on by default",
  "for more information, see issue #12345 <https://github.com/rust-lang/rust/issues/12345>",
  "the trait `Copy` is not implemented for `String`",
  "",
  "a note\nspanning lines",
  "required by a bound in `Point::<T>::new`",
];

const INLINE = [
  { msg: "expected {$expected}, found {$found}", args: [["expected", "`i32`"], ["found", "`&str`"]] },
  { msg: "{$n ->\n    [one] one item\n    *[other] {$n} items\n} were moved", args: [["n", 1]] },
  { msg: "{$n ->\n    [one] one item\n    *[other] {$n} items\n} were moved", args: [["n", 7]] },
  { msg: "unused imports: {$names}", args: [["names", ["`a`", "`b`", "`c`"]]] },
  { msg: "unused import: {$names}", args: [["names", ["`a`"]]] },
  { msg: "the name `{$name}` is defined multiple times", args: [["name", "Foo"]] },
  { msg: "consider using `{$suggestion}`", args: [["suggestion", "x.clone()"]] },
] as const;

const CODES = ["E0308", "E0425", "E0599", "E0277", "E0382", "E0499", "E0601", "E0001", "E0000", "E9999", "E0063"];

type MsgJ = string | { inline: string };
type ArgJ = [string, string | number | string[]];

function msgOf(r: Rng, pool: readonly string[], args: ArgJ[]): MsgJ {
  if (r.chance(0.15)) {
    const m = r.pick(INLINE);
    for (const a of m.args) if (!args.some(([n]) => n === a[0])) args.push([a[0], Array.isArray(a[1]) ? [...a[1]] : a[1]] as ArgJ);
    return { inline: m.msg };
  }
  return r.pick(pool);
}

// ---------------------------------------------------------------------------------------------
// Case building

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Case {
  files: Src[];
  emitter: { [k: string]: Json };
  flags?: { [k: string]: Json };
  ops: { [k: string]: Json }[];
}

const TOP_LEVELS = ["error", "error", "error", "warning", "warning", "note", "help", "failure_note", "force_warning"];
const APPS = ["MachineApplicable", "MaybeIncorrect", "HasPlaceholders", "Unspecified"];
const STYLES = ["HideCodeInline", "HideCodeAlways", "CompletelyHidden", "ShowCode", "ShowAlways"];
const SUBLEVELS = ["Error", "Warning", "Note", "OnceNote", "Help", "OnceHelp"];

function emitterDefault(r: Rng): { [k: string]: Json } {
  const k = r.next();
  if (k < 0.6) return { ui_testing: true };
  if (k < 0.8) return { diagnostic_width: r.pick([80, 140]) };
  if (k < 0.9) return { ui_testing: true, theme: "unicode" };
  return { diagnostic_width: 140, color: "always" };
}

function labels(r: Rng, sp: Spans, n: number, primary: SpanJ): Json[] {
  const out: Json[] = [];
  for (let i = 0; i < n; i++) {
    const s = r.chance(0.5) ? sp.overlapping(primary) : sp.any();
    out.push([s, r.chance(0.1) ? { inline: "expected due to {$what}" } : r.pick(LABELS)]);
  }
  return out;
}

function child(r: Rng, sp: Spans): { [k: string]: Json } {
  const k = r.next();
  const withSpan = r.chance(0.4);
  const ms = (): Json => (r.chance(0.7) ? [sp.any()] : { primary: r.chance(0.8) ? [sp.any()] : [], labels: [[sp.any(), r.pick(LABELS)]] });
  if (k < 0.55) {
    const kind = r.pick(["note", "note", "help", "help", "warn", "note_once", "help_once"]);
    const c: { [k: string]: Json } = { kind, msg: r.pick(NOTES) };
    if (withSpan && kind !== "help_once") c.span = ms();
    return c;
  }
  if (k < 0.75) {
    const c: { [k: string]: Json } = { kind: "sub", level: r.pick(SUBLEVELS), msg: r.pick(NOTES) };
    if (withSpan) c.span = ms();
    return c;
  }
  if (k < 0.9) {
    const parts: Json[] = [];
    for (let i = r.int(1, 4); i > 0; i--) parts.push([r.pick(["expected ", "`Vec<", "i32", ">`", " found ", "", "&str"]), r.chance(0.5)]);
    const c: { [k: string]: Json } = { kind: r.pick(["highlighted_note", "highlighted_help"]), parts };
    if (withSpan) c.span = ms();
    return c;
  }
  const styled = (): Json => {
    const parts: Json[] = [];
    for (let i = r.int(1, 3); i > 0; i--) parts.push([r.pick(["Vec<", "i32", ">", "&'static str", "Option<", "String", ""]), r.chance(0.5)]);
    return parts;
  };
  return { kind: "expected_found", expected_label: r.pick(["expected", "expected type", ""]), expected: styled(), found_label: r.pick(["found", "found type"]), found: styled() };
}

const CODE_SNIPPETS = ["42", "", "&x", "x.clone()", "let y = 1;\nlet z = 2;", "名前", "\tindented", "foo::bar::<T>()", "a very long replacement snippet that does not fit on a single line of the terminal at all, not even close"];

/** A span usable as a suggestion target (one file; empty spans only with non-empty code). */
function suggSpan(r: Rng, sp: Spans, fi: number, code: string): SpanJ {
  for (;;) {
    const s = r.chance(0.5) ? sp.token(fi) : r.chance(0.5) ? sp.inLine(fi) : r.chance(0.5) ? sp.emptyAt(fi) : sp.multiLine(fi);
    if (s !== "dummy" && (s[1] !== s[2] || code !== "")) return s;
  }
}

/** Suggested code; never empty for an empty file (whose only spans are empty). */
function pickCode(r: Rng, sp: Spans, fi: number): string {
  return r.pick(sp.files[fi]!.len === 0 ? CODE_SNIPPETS.filter((c) => c !== "") : CODE_SNIPPETS);
}

function parts(r: Rng, sp: Spans, fi: number, n: number): Json[] {
  const out: [SpanJ, string][] = [];
  for (let tries = 0; out.length < n && tries < 50; tries++) {
    const code = pickCode(r, sp, fi);
    const s = suggSpan(r, sp, fi, code) as [number, number, number];
    // Parts never overlap (not even touching inside a non-empty span).
    if (out.some(([o]) => { const [, lo, hi] = o as [number, number, number]; return s[1] < hi && lo < s[2] || (s[1] === s[2] && lo === hi && lo === s[1]); })) continue;
    out.push([s, code]);
  }
  return out;
}

function suggestion(r: Rng, sp: Spans, kind?: string, app?: string): { [k: string]: Json } {
  kind ??= r.pick([
    "span_suggestion",
    "span_suggestion_verbose",
    "span_suggestion_short",
    "span_suggestion_hidden",
    "tool_only_span_suggestion",
    "span_suggestion_with_style",
    "span_suggestions",
    "span_suggestions_with_style",
    "multipart_suggestion",
    "tool_only_multipart_suggestion",
    "multipart_suggestion_with_style",
    "multipart_suggestions",
  ]);
  const fi = sp.file().index;
  const s: { [k: string]: Json } = {
    kind,
    msg: r.pick(["consider borrowing here", "try using a conversion method", "", "remove this", "use the suggestion\nwhich spans two lines"]),
    applicability: app ?? r.pick(APPS),
  };
  if (kind.startsWith("span_suggestions")) {
    const codes: string[] = [];
    for (let i = r.pick([1, 2, 3, 4, 5, 7]); i > 0; i--) codes.push(r.pick(CODE_SNIPPETS.filter((c) => c !== "")) + (codes.length ? `_${codes.length}` : ""));
    s.span = suggSpan(r, sp, fi, "x");
    s.codes = codes;
  } else if (kind.startsWith("span_suggestion") || kind === "tool_only_span_suggestion") {
    const code = pickCode(r, sp, fi);
    s.span = suggSpan(r, sp, fi, code);
    s.code = code;
  } else if (kind === "multipart_suggestions") {
    const alts: Json[] = [];
    for (let i = r.pick([1, 2, 3, 5]); i > 0; i--) alts.push(parts(r, sp, fi, r.int(1, 3)));
    s.alternatives = alts;
  } else s.parts = parts(r, sp, fi, r.int(1, 3));
  if (kind.endsWith("_with_style")) s.style = r.pick(STYLES);
  return s;
}

function diag(r: Rng, sp: Spans, opts: { level?: string; code?: boolean; labels?: number; children?: number; suggestions?: number; multiPrimary?: boolean } = {}): { [k: string]: Json } {
  const args: ArgJ[] = [];
  const level = opts.level ?? r.pick(TOP_LEVELS);
  const d: { [k: string]: Json } = { op: "diag", level, msg: msgOf(r, MSGS, args) };
  if (opts.code ?? r.chance(0.4)) d.code = r.pick(CODES);
  const primary = sp.any();
  if (r.chance(0.93)) d.span = opts.multiPrimary ? [primary, sp.any(), ...(r.chance(0.5) ? [sp.any()] : [])] : [primary];
  const nl = opts.labels ?? r.pick([0, 0, 1, 1, 2, 3]);
  if (nl > 0) d.labels = labels(r, sp, nl, primary);
  const nc = opts.children ?? r.pick([0, 0, 0, 1, 2]);
  if (nc > 0) d.children = Array.from({ length: nc }, () => child(r, sp));
  const ns = opts.suggestions ?? (r.chance(0.2) ? 1 : 0);
  if (ns > 0) d.suggestions = Array.from({ length: ns }, () => suggestion(r, sp));
  // `labels` may have added an inline label referencing {$what}
  if (JSON.stringify(d).includes("{$what}")) args.push(["what", "this"]);
  if (args.length) d.args = args;
  return d;
}

// ---------------------------------------------------------------------------------------------
// Families

type Family = (r: Rng, i: number) => Case;

const families: [string, number, Family][] = [
  [
    "basic",
    200,
    (r) => {
      const files = SOURCES[r.pick(COMMON_SETS)]!;
      const sp = new Spans(r, files);
      return { files, emitter: emitterDefault(r), ops: [diag(r, sp)] };
    },
  ],
  [
    "labels",
    200,
    (r) => {
      const files = SOURCES[r.pick([...COMMON_SETS, "multi", "multi"])]!;
      const sp = new Spans(r, files);
      const d = diag(r, sp, { labels: r.int(2, 6), children: 0, suggestions: 0, multiPrimary: r.chance(0.3) });
      return { files, emitter: emitterDefault(r), ops: [d] };
    },
  ],
  [
    "children",
    150,
    (r) => {
      const files = SOURCES[r.pick(COMMON_SETS)]!;
      const sp = new Spans(r, files);
      const ops = [diag(r, sp, { children: r.int(1, 5), suggestions: 0 })];
      if (r.chance(0.4)) ops.push(diag(r, sp, { children: r.int(1, 3), suggestions: 0 }));
      return { files, emitter: emitterDefault(r), ops };
    },
  ],
  [
    "sugg",
    264,
    (r, i) => {
      const kinds = [
        "span_suggestion",
        "span_suggestion_verbose",
        "span_suggestion_short",
        "span_suggestion_hidden",
        "tool_only_span_suggestion",
        "span_suggestion_with_style",
        "span_suggestions",
        "span_suggestions_with_style",
        "multipart_suggestion",
        "tool_only_multipart_suggestion",
        "multipart_suggestion_with_style",
        "multipart_suggestions",
      ];
      // Systematic: every kind x every applicability, 5 random variants each (+ mixed).
      const kind = kinds[i % kinds.length]!;
      const app = APPS[Math.floor(i / kinds.length) % APPS.length]!;
      const files = SOURCES[r.pick(["main", "struct", "long", "unicode", "tabs", "multi"])]!;
      const sp = new Spans(r, files);
      const d = diag(r, sp, { labels: r.pick([0, 1]), children: r.pick([0, 0, 1]), suggestions: 0 });
      const ss = [suggestion(r, sp, kind, app)];
      if (r.chance(0.3)) ss.push(suggestion(r, sp));
      d.suggestions = ss;
      return { files, emitter: emitterDefault(r), ops: [d] };
    },
  ],
  [
    "options",
    200,
    (r, i) => {
      const files = SOURCES[r.pick(["main", "multi", "unicode"])]!;
      const sp = new Spans(r, files);
      const e: { [k: string]: Json } = {};
      if (i < 160) {
        // theme x color x short x width x source_map x terminal_url = 2*2*2*5*2 (terminal_url on odd)
        const widths = [null, 20, 40, 80, 200];
        e.theme = ["ascii", "unicode"][i % 2]!;
        e.color = ["never", "always"][(i >> 1) % 2]!;
        e.short_message = Boolean((i >> 2) % 2);
        const w = widths[Math.floor(i / 8) % 5]!;
        if (w === null) e.ui_testing = true;
        else e.diagnostic_width = w;
        e.source_map = Math.floor(i / 40) % 2 === 0;
        e.terminal_url = Math.floor(i / 80) % 2 === 1;
      } else {
        Object.assign(e, emitterDefault(r));
        if (r.chance(0.5)) e.macro_backtrace = true; // with flags.macro_backtrace below, as rustc's -Zmacro-backtrace sets both
        if (r.chance(0.6)) e.ignored_directories = [r.pick(["src/very", "src", "src/very/deep/path", "other"])];
        if (r.chance(0.3)) e.short_message = true;
      }
      const ops = [diag(r, sp, { code: true, labels: r.int(0, 2), children: r.int(0, 2), suggestions: r.int(0, 1) })];
      if (r.chance(0.5)) ops.push(diag(r, sp, { level: "warning" }));
      ops.push({ op: "print_error_count" });
      const c: Case = { files, emitter: e, ops };
      if (e.macro_backtrace) c.flags = { macro_backtrace: true };
      return c;
    },
  ],
  [
    "count",
    120,
    (r) => {
      const files = SOURCES[r.pick(["main", "struct", "multi"])]!;
      const sp = new Spans(r, files);
      const ops: { [k: string]: Json }[] = [];
      const flags: { [k: string]: Json } = {};
      if (r.chance(0.2)) flags.deduplicate_diagnostics = false;
      if (r.chance(0.15)) flags.can_emit_warnings = false;
      if (r.chance(0.1)) flags.eagerly_emit_delayed_bugs = true;
      const n = r.int(1, 7);
      const levels = ["error", "error", "warning", "warning", "force_warning", "note", "help", "failure_note", "bug", "fatal", "delayed_bug"];
      for (let k = 0; k < n; k++) {
        const prev = ops.filter((o) => o.op === "diag");
        if (prev.length && r.chance(0.25)) {
          ops.push(structuredClone(r.pick(prev))); // a duplicate (dedup on/off)
          continue;
        }
        const level = r.pick(levels);
        const d = diag(r, sp, { level, children: r.pick([0, 1]), suggestions: 0, labels: r.pick([0, 1]) });
        if (level !== "delayed_bug" && r.chance(0.1)) d.then = "cancel";
        ops.push(d);
        if (r.chance(0.15)) ops.push({ op: "query" });
        if (r.chance(0.05)) ops.push({ op: "must_teach", code: r.pick(CODES) });
      }
      const delayed = ops.some((o) => o.level === "delayed_bug");
      const hasError = ops.some((o) => o.op === "diag" && o.level === "error" && o.then === undefined);
      if (delayed && !hasError) ops.push(diag(r, sp, { level: "error", children: 0, suggestions: 0 }));
      if (!delayed && r.chance(0.1)) ops.push({ op: "reset_err_count" });
      ops.push({ op: "print_error_count" });
      if (r.chance(0.4)) ops.push({ op: "abort_if_errors" });
      if (r.chance(0.3)) ops.push({ op: "query" });
      const c: Case = { files, emitter: emitterDefault(r), ops };
      if (Object.keys(flags).length) c.flags = flags;
      return c;
    },
  ],
  [
    "stash",
    60,
    (r) => {
      const files = SOURCES[r.pick(["main", "struct"])]!;
      const sp = new Spans(r, files);
      const keys = ["ItemNoType", "EarlySyntaxWarning", "CallIntoMethod", "MaybeFruTypo", "ExprInPat"];
      const ops: { [k: string]: Json }[] = [];
      const stashed: { level: string; span: SpanJ; key: string }[] = [];
      for (let k = r.int(1, 4); k > 0; k--) {
        const level = r.pick(["error", "warning"]);
        const span = sp.token();
        const key = r.pick(keys);
        const d = diag(r, sp, { level, children: r.pick([0, 1]), suggestions: 0, labels: r.pick([0, 1]) });
        d.span = [span];
        d.then = { stash: key, span };
        ops.push(d);
        stashed.push({ level, span, key });
        if (r.chance(0.3)) ops.push(diag(r, sp, { level: r.pick(["error", "warning"]), children: 0, suggestions: 0 }));
      }
      for (const s of stashed) {
        const k = r.next();
        if (k < 0.4) {
          if (s.level === "warning") ops.push({ op: "steal_non_err", span: s.span, key: s.key, then: r.pick(["emit", "cancel"]) });
          else ops.push({ op: "try_steal_modify_and_emit_err", span: s.span, key: s.key, note: r.pick(NOTES) });
        } else if (k < 0.5) {
          // a miss: other key or other span
          ops.push({ op: s.level === "warning" ? "steal_non_err" : "try_steal_modify_and_emit_err", span: sp.token(), key: r.pick(keys), ...(s.level === "warning" ? {} : { note: "never shown" }) });
        }
      }
      if (r.chance(0.3)) ops.push({ op: "query" });
      if (r.chance(0.7)) {
        ops.push({ op: "emit_stashed" });
        ops.push({ op: "print_error_count" });
      }
      return { files, emitter: emitterDefault(r), ops };
    },
  ],
  [
    "long",
    60,
    (r) => {
      const files = SOURCES[r.pick(["long", "long", "many"])]!;
      const sp = new Spans(r, files);
      const e: { [k: string]: Json } = { diagnostic_width: r.pick([20, 30, 40, 60, 80, 100, 140, 200]) };
      if (r.chance(0.3)) e.theme = "unicode";
      const d = diag(r, sp, { labels: r.int(1, 4), children: r.int(0, 2), suggestions: r.int(0, 1) });
      return { files, emitter: e, ops: [d] };
    },
  ],
  [
    "unicode",
    100,
    (r) => {
      const files = SOURCES[r.pick(["unicode", "unicode", "tabs", "crlf", "bom", "ctrl", "nonl", "empty", "custom"])]!;
      const sp = new Spans(r, files);
      const ops = [diag(r, sp, { labels: r.int(0, 3), children: r.int(0, 2), suggestions: r.int(0, 2) })];
      if (r.chance(0.3)) ops.push(diag(r, sp));
      return { files, emitter: emitterDefault(r), ops };
    },
  ],
];

families.push([
  "combo",
  60,
  (r, i) => {
    const files = SOURCES[r.pick(["long", "main", "unicode", "multi"])]!;
    const sp = new Spans(r, files);
    const e: { [k: string]: Json } = { ui_testing: true, diagnostic_width: [20, 40, 80, 200][i % 4]! };
    if (r.chance(0.4)) e.theme = "unicode";
    if (r.chance(0.2)) e.color = "always";
    if (r.chance(0.2)) e.short_message = true;
    const c: Case = { files, emitter: e, ops: [diag(r, sp, { labels: r.int(1, 3), children: r.int(0, 2), suggestions: r.int(0, 1) })] };
    if (i % 3 === 0) {
      e.macro_backtrace = true;
      c.flags = { macro_backtrace: true };
    }
    if (r.chance(0.5)) c.ops.push({ op: "print_error_count" });
    return c;
  },
]);

// ---------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, n, f] of families) {
  for (let i = 0; i < n; i++) {
    const id = `${name}-${String(i).padStart(4, "0")}`;
    const c = f(new Rng(seedOf(id)), i);
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(c, null, 1) + "\n");
    total++;
  }
}
console.log(`wrote ${total} cases to ${OUT} (${readdirSync(OUT).length} files)`);
