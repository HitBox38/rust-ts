// Deterministic corpus of annotate-snippets render cases, shared by the `annotate` probe (which
// reads it as JSON on stdin) and src/vendor/annotate_snippets/oracle.test.ts (which renders the
// same cases with the TS port). Not a port of upstream code.
//
// Schema (JSON):
//   Case    = { name, opts: { term_width?, anon?, decor?: "Ascii"|"Unicode", short? }, groups: Group[] }
//   Group   = { title?: Title | null, level?: Level, elements: Element[] }   // no title → Group::with_level(level)
//   Title   = { level: Level, text, secondary?: bool, id?, url? }            // primary_title / secondary_title
//   Level   = { l: "ERROR"|"WARNING"|"INFO"|"NOTE"|"HELP", name?: string | null }  // name null → no_name()
//   Element = { t: "message", level, text }
//           | { t: "cause", source, path?, line_start?, fold?, anns: { kind, start, end, label?, hl? }[] }
//           | { t: "suggestion", source, path?, line_start?, fold?, patches: { start, end, rep }[] }
//           | { t: "origin", path, line?, col? } | { t: "padding" }
// Spans are UTF-8 byte offsets into `source`.

export type LevelName = "ERROR" | "WARNING" | "INFO" | "NOTE" | "HELP";
export interface LevelJ {
  l: LevelName;
  name?: string | null;
}
export interface TitleJ {
  level: LevelJ;
  text: string;
  secondary?: boolean;
  id?: string;
  url?: string;
}
export interface AnnJ {
  kind: "Primary" | "Context" | "Visible";
  start: number;
  end: number;
  label?: string;
  hl?: boolean;
}
export interface PatchJ {
  start: number;
  end: number;
  rep: string;
}
export type ElementJ =
  | { t: "message"; level: LevelJ; text: string }
  | { t: "cause"; source: string; path?: string; line_start?: number; fold?: boolean; anns: AnnJ[] }
  | { t: "suggestion"; source: string; path?: string; line_start?: number; fold?: boolean; patches: PatchJ[] }
  | { t: "origin"; path: string; line?: number; col?: number }
  | { t: "padding" };
export interface GroupJ {
  title?: TitleJ | null;
  level?: LevelJ;
  elements: ElementJ[];
}
export interface OptsJ {
  term_width?: number;
  anon?: boolean;
  decor?: "Ascii" | "Unicode";
  short?: boolean;
}
export interface Case {
  name: string;
  opts: OptsJ;
  groups: GroupJ[];
}

const enc = new TextEncoder();
const blen = (s: string): number => enc.encode(s).length;
/** Byte offset of the first occurrence of `needle` in `hay` (+ `delta` bytes). */
function at(hay: string, needle: string, delta = 0, from = 0): number {
  const i = hay.indexOf(needle, from);
  if (i < 0) throw new Error(`corpus: ${JSON.stringify(needle)} not in source`);
  return blen(hay.slice(0, i)) + delta;
}
function span(hay: string, needle: string, from = 0): [number, number] {
  const s = at(hay, needle, 0, from);
  return [s, s + blen(needle)];
}

const E = (l: LevelName, name?: string | null): LevelJ => (name === undefined ? { l } : { l, name });

// ---------------------------------------------------------------------------------------------
// Hand-written cases (shapes rustc's annotate_snippet_emitter_writer builds, plus edge cases).

const SRC_MAIN = `fn main() {
    let x: u32 = "hello";
    let y = x + 1;
    println!("{}", y);
}
`;

const SRC_MULTI = `fn foo(a: u32,
       b: u32) -> u32 {
    let c = a
        + b;
    if c > 10 {
        return c;
    }
    c * 2
}
`;

function hand(): Case[] {
  const out: Case[] = [];
  const add = (name: string, groups: GroupJ[], opts: OptsJ = {}) => out.push({ name, opts, groups });

  const [xs, xe] = span(SRC_MAIN, `"hello"`);
  const [ts, te] = span(SRC_MAIN, "u32");
  const mismatched: GroupJ = {
    title: { level: E("ERROR"), text: "mismatched types", id: "E0308" },
    elements: [
      {
        t: "cause",
        source: SRC_MAIN,
        path: "src/main.rs",
        anns: [
          { kind: "Primary", start: xs, end: xe, label: "expected `u32`, found `&str`" },
          { kind: "Context", start: ts, end: te, label: "expected due to this" },
        ],
      },
    ],
  };
  add("mismatched", [mismatched]);
  add("mismatched-note", [
    { ...mismatched, elements: [...mismatched.elements, { t: "message", level: E("NOTE"), text: "a note\nwith two lines" }] },
  ]);
  const help: GroupJ = {
    title: { level: E("HELP"), text: "change the type", secondary: true },
    elements: [{ t: "suggestion", source: SRC_MAIN, path: "src/main.rs", patches: [{ start: ts, end: te, rep: "&str" }] }],
  };
  add("mismatched-help", [mismatched, help]);
  add("mismatched-help-url", [
    { ...mismatched, title: { level: E("ERROR"), text: "mismatched types", id: "E0308", url: "https://doc.rust-lang.org/error_codes/E0308.html" } },
    help,
  ]);
  add("ice-name", [{ ...mismatched, title: { level: E("ERROR", "error: internal compiler error"), text: "boom" } }]);
  add("failure-note", [{ title: { level: E("NOTE", null), text: "For more information about this error, try `rustc --explain E0308`." }, elements: [] }]);
  add("title-only-warning", [{ title: { level: E("WARNING"), text: "unused variable: `x`" }, elements: [] }]);
  add("title-styled", [{ title: { level: E("ERROR"), text: "\x1b[1mbold\x1b[0m text\nsecond line", secondary: true }, elements: [] }]);
  add("title-untrusted-ctrl", [{ title: { level: E("ERROR"), text: "tab\there\u0007bell‮RTL‍zwj" }, elements: [] }]);
  add("info-level", [{ title: { level: E("INFO"), text: "info title" }, elements: [{ t: "message", level: E("INFO", "custom"), text: "custom named" }] }]);

  // Multi-line spans.
  const [as_, _ae] = span(SRC_MULTI, "a: u32");
  const [_bs, be] = span(SRC_MULTI, "b: u32)");
  const [cs, _ce] = span(SRC_MULTI, "a\n");
  const [_ds, de] = span(SRC_MULTI, "+ b");
  const [is, _ie] = span(SRC_MULTI, "if c");
  const [_je, je] = span(SRC_MULTI, "    }\n");
  for (const decor of ["Ascii", "Unicode"] as const) {
    add(`multiline-${decor}`, [
      {
        title: { level: E("ERROR"), text: "multiline spans" },
        elements: [
          {
            t: "cause",
            source: SRC_MULTI,
            path: "src/lib.rs",
            line_start: 10,
            anns: [
              { kind: "Primary", start: as_, end: be - 1, label: "params" },
              { kind: "Context", start: cs, end: de, label: "sum" },
              { kind: "Context", start: is, end: je - 1, label: "" },
            ],
          },
        ],
      },
    ], { decor });
    add(`multiline-nested-${decor}`, [
      {
        title: { level: E("ERROR"), text: "nested" },
        elements: [
          {
            t: "cause",
            source: SRC_MULTI,
            path: "src/lib.rs",
            anns: [
              { kind: "Primary", start: 0, end: blen(SRC_MULTI) - 1, label: "whole fn" },
              { kind: "Context", start: is, end: je - 1, label: "the if" },
              { kind: "Context", start: is, end: is + 2, label: "kw" },
            ],
          },
        ],
      },
    ], { decor });
  }

  // Origins, padding, notes (unannotated_messages shape).
  add("origins", [
    {
      title: { level: E("ERROR"), text: "cannot find derive macro `Eqr` in this scope" },
      elements: [
        { t: "cause", source: "#[derive(Eqr)]\nstruct S;\n", path: "src/a.rs", anns: [{ kind: "Primary", start: 9, end: 12 }] },
      ],
    },
    {
      level: E("ERROR"),
      elements: [
        { t: "origin", path: "$SRC_DIR/core/src/option.rs", line: 594, col: 0 },
        { t: "origin", path: "$SRC_DIR/core/src/option.rs", line: 602, col: 4 },
        { t: "padding" },
        { t: "message", level: E("NOTE"), text: "not covered" },
      ],
    },
  ]);
  add("origin-only", [{ title: { level: E("WARNING"), text: "w" }, elements: [{ t: "origin", path: "p.rs" }, { t: "origin", path: "q.rs", line: 3 }] }]);

  // Suggestions: insertion, deletion, replacement, multi-line, add-line, removal of whole lines.
  const SRC_S = "fn f() {\n    let v = vec![1, 2, 3];\n    v.iter().map(|x| x * 2);\n    drop(v)\n}\n";
  const [ms, me] = span(SRC_S, ".map");
  const [dvs, dve] = span(SRC_S, "drop(v)");
  const sugg = (name: string, patches: PatchJ[], fold?: boolean, path: string | undefined = "src/s.rs") =>
    add(name, [
      { title: { level: E("WARNING"), text: "unused result" }, elements: [{ t: "cause", source: SRC_S, path: "src/s.rs", anns: [{ kind: "Primary", start: ms, end: me }] }] },
      {
        title: { level: E("HELP"), text: "try this", secondary: true },
        elements: [{ t: "suggestion", source: SRC_S, ...(path === undefined ? {} : { path }), ...(fold === undefined ? {} : { fold }), patches }],
      },
    ]);
  sugg("sugg-insert", [{ start: me, end: me, rep: ".collect::<Vec<_>>()" }]);
  sugg("sugg-insert-semi", [{ start: dve, end: dve, rep: ";" }]);
  sugg("sugg-delete", [{ start: ms, end: me, rep: "" }]);
  sugg("sugg-replace", [{ start: dvs, end: dve, rep: "std::mem::drop(v);" }]);
  sugg("sugg-two-parts", [
    { start: ms, end: ms, rep: "let _ = " },
    { start: dve, end: dve, rep: ";" },
  ]);
  sugg("sugg-multiline-rep", [{ start: dvs, end: dve, rep: "if true {\n        drop(v)\n    }" }]);
  sugg("sugg-add-line", [{ start: at(SRC_S, "    drop"), end: at(SRC_S, "    drop"), rep: "    let w = 1;\n" }]);
  sugg("sugg-remove-line", [{ start: at(SRC_S, "    drop"), end: at(SRC_S, "}\n"), rep: "" }]);
  sugg("sugg-nofold", [{ start: dve, end: dve, rep: ";" }], false);
  sugg("sugg-otherfile", [{ start: dve, end: dve, rep: ";" }], true, "src/other.rs");
  sugg("sugg-nopath", [{ start: dve, end: dve, rep: ";" }], true, undefined);
  sugg("sugg-whitespace-only", [{ start: dve, end: dve, rep: "   " }]);
  sugg("sugg-unicode", [{ start: dvs, end: dve, rep: "drop(日本語)" }]);
  add("multi-suggestions", [
    mismatched,
    {
      title: { level: E("HELP"), text: "consider one of", secondary: true },
      elements: [
        { t: "suggestion", source: SRC_MAIN, path: "src/main.rs", patches: [{ start: ts, end: te, rep: "&str" }] },
        { t: "suggestion", source: SRC_MAIN, path: "src/main.rs", patches: [{ start: xs, end: xe, rep: "5" }] },
        { t: "message", level: E("NOTE", null), text: "and 2 other candidates" },
      ],
    },
  ]);

  // Fold: many unannotated lines between annotations.
  const LONG = Array.from({ length: 30 }, (_, i) => `line number ${i + 1} here;`).join("\n") + "\n";
  const [l3s, l3e] = span(LONG, "3 here");
  const [l25s, l25e] = span(LONG, "25 here");
  for (const fold of [true, false]) {
    add(`fold-${fold}`, [
      {
        title: { level: E("ERROR"), text: "fold" },
        elements: [
          {
            t: "cause",
            source: LONG,
            path: "f.rs",
            fold,
            line_start: 95,
            anns: [
              { kind: "Primary", start: l3s, end: l25e, label: "big" },
              { kind: "Context", start: l25s, end: l25e, label: "end" },
              { kind: "Visible", start: at(LONG, "10 here"), end: at(LONG, "10 here") + 2 },
            ],
          },
        ],
      },
    ]);
    add(`fold-single-${fold}`, [
      { title: { level: E("ERROR"), text: "fold" }, elements: [{ t: "cause", source: LONG, path: "f.rs", fold, anns: [{ kind: "Primary", start: l3s, end: l3e, label: "x" }] }] },
    ]);
  }

  // Long lines and term widths.
  const WIDE = "let value = " + "some_function_call(argument_one, argument_two); ".repeat(12) + "final_thing();\n";
  const [fs, fe] = span(WIDE, "final_thing");
  for (const term_width of [140, 60, 20, 5, 0]) {
    add(`long-line-${term_width}`, [
      {
        title: { level: E("ERROR"), text: "long" },
        elements: [
          { t: "cause", source: WIDE, path: "w.rs", anns: [{ kind: "Primary", start: fs, end: fe, label: "here" }, { kind: "Context", start: 4, end: 9, label: "binding" }] },
        ],
      },
    ], { term_width });
    add(`long-span-${term_width}`, [
      { title: { level: E("ERROR"), text: "long span" }, elements: [{ t: "cause", source: WIDE, path: "w.rs", anns: [{ kind: "Primary", start: 12, end: fe, label: "everything" }] }] },
    ], { term_width });
  }
  const INDENT = " ".repeat(60) + "deeply_indented();\n";
  add("whitespace-margin", [{ title: { level: E("ERROR"), text: "ws" }, elements: [{ t: "cause", source: INDENT, path: "i.rs", anns: [{ kind: "Primary", start: 60, end: 75, label: "x" }] }] }]);

  // Unicode / special source text.
  const UNI = "﻿let s = \"日本語\"; // 🦀\r\n\tlet t = 'a‍b';\r\nlet c = '\u0001';\u007f\r\nlet r = \"‮abc‬\";";
  const [us, ue] = span(UNI, "日本語");
  const [cs2, ce2] = span(UNI, "🦀");
  const [tz, tze] = span(UNI, "a‍b");
  const [cc, cce] = span(UNI, "\u0001");
  const [rr, rre] = span(UNI, "‮abc‬");
  for (const decor of ["Ascii", "Unicode"] as const) {
    add(`unicode-${decor}`, [
      {
        title: { level: E("ERROR"), text: "unicode" },
        elements: [
          {
            t: "cause",
            source: UNI,
            path: "u.rs",
            anns: [
              { kind: "Primary", start: us, end: ue, label: "wide" },
              { kind: "Context", start: cs2, end: ce2, label: "crab" },
              { kind: "Context", start: tz, end: tze, label: "zwj" },
              { kind: "Context", start: cc, end: cce, label: "ctrl" },
              { kind: "Context", start: rr, end: rre, label: "bidi" },
            ],
          },
        ],
      },
      { title: { level: E("HELP"), text: "replace", secondary: true }, elements: [{ t: "suggestion", source: UNI, path: "u.rs", patches: [{ start: us, end: ue, rep: "ｗｉｄｅ" }] }] },
    ], { decor });
  }

  // Empty source, EOF annotations, line-number widths, anonymized.
  add("empty-source", [{ title: { level: E("ERROR"), text: "empty" }, elements: [{ t: "cause", source: "", path: "e.rs", anns: [{ kind: "Primary", start: 0, end: 0, label: "here" }] }] }]);
  add("empty-source-noann", [{ title: { level: E("ERROR"), text: "empty" }, elements: [{ t: "cause", source: "", path: "e.rs", anns: [] }] }]);
  add("eof-ann", [{ title: { level: E("ERROR"), text: "eof" }, elements: [{ t: "cause", source: "abc\ndef", path: "e.rs", anns: [{ kind: "Primary", start: 7, end: 7, label: "eof" }] }] }]);
  add("eof-ann-nl", [{ title: { level: E("ERROR"), text: "eof" }, elements: [{ t: "cause", source: "abc\ndef\n", path: "e.rs", anns: [{ kind: "Primary", start: 8, end: 8, label: "eof" }] }] }]);
  for (const line_start of [1, 9, 10, 99, 100, 99999, 123456789]) {
    for (const anon of [false, true]) {
      add(`line-width-${line_start}-${anon}`, [mismatched].map((g) => ({ ...g, elements: g.elements.map((e) => ({ ...e, line_start })) })), { anon });
    }
  }
  add("no-path-cause", [{ title: { level: E("ERROR"), text: "nopath" }, elements: [{ t: "cause", source: SRC_MAIN, anns: [{ kind: "Primary", start: xs, end: xe, label: "x" }] }] }]);
  add("no-path-cause-unicode", [
    {
      title: { level: E("ERROR"), text: "nopath" },
      elements: [
        { t: "cause", source: SRC_MAIN, anns: [{ kind: "Primary", start: xs, end: xe, label: "x" }] },
        { t: "cause", source: SRC_MULTI, anns: [{ kind: "Context", start: 0, end: 2, label: "y" }] },
      ],
    },
  ], { decor: "Unicode" });
  add("no-title-group", [{ level: E("WARNING"), elements: [{ t: "cause", source: SRC_MAIN, path: "a.rs", anns: [{ kind: "Primary", start: xs, end: xe }] }] }]);
  add("highlight-source", [
    {
      title: { level: E("ERROR"), text: "hl" },
      elements: [{ t: "cause", source: SRC_MAIN, path: "a.rs", anns: [{ kind: "Primary", start: xs, end: xe, hl: true }, { kind: "Context", start: ts, end: te, label: "t", hl: true }] }],
    },
  ]);
  add("same-span-labels", [
    {
      title: { level: E("ERROR"), text: "same" },
      elements: [
        {
          t: "cause",
          source: SRC_MAIN,
          path: "a.rs",
          anns: [
            { kind: "Primary", start: xs, end: xe, label: "one" },
            { kind: "Context", start: xs, end: xe, label: "two" },
            { kind: "Context", start: xs, end: xe },
            { kind: "Context", start: xs + 1, end: xs + 3, label: "inner" },
          ],
        },
      ],
    },
  ]);

  // Short messages.
  for (const decor of ["Ascii", "Unicode"] as const) {
    add(`short-${decor}`, [mismatched, help], { short: true, decor });
  }
  add("short-labels", [
    {
      title: { level: E("ERROR"), text: "short" },
      elements: [{ t: "cause", source: SRC_MAIN, path: "a.rs", anns: [{ kind: "Primary", start: xs, end: xe, label: "a" }, { kind: "Primary", start: ts, end: te, label: " " }, { kind: "Primary", start: 0, end: 2, label: "b" }] }],
    },
  ], { short: true });
  add("short-nopath", [{ title: { level: E("ERROR"), text: "short" }, elements: [{ t: "cause", source: SRC_MAIN, anns: [{ kind: "Primary", start: xs, end: xe, label: "a" }] }] }], { short: true });
  add("short-no-group", [], { short: true }); // panics: "Expected at least one group"
  add("short-no-title", [{ level: E("ERROR"), elements: [] }], { short: true }); // panics: "Expected a Title"

  // Panicking inputs (both sides must panic).
  add("span-out-of-range", [{ title: { level: E("ERROR"), text: "oob" }, elements: [{ t: "cause", source: "abc\n", path: "a.rs", anns: [{ kind: "Primary", start: 2, end: 99, label: "x" }] }] }]);

  return out;
}

// ---------------------------------------------------------------------------------------------
// Seeded random cases.

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS = [
  "fn main() {",
  "    let x = 1;",
  "    foo(bar, baz);",
  "}",
  "",
  "  ",
  "struct S { a: u32 }",
  "x.iter().map(|y| y + 1).collect::<Vec<_>>()",
  'let s = "日本語";',
  "// émoji 🦀🦀",
  "\tlet t = 1;\t// tab",
  "a‍b zwj",
  "ctrl\u0001\u0007x",
  "rtl ‮abc‬ end",
  "wide ｗｉｄｅ text",
  "combining é é",
  " nbsp　ideo",
  "zero​width",
  "        deeply nested code here",
  "                                  very far right",
  "x".repeat(170),
  "let v = [" + "0, ".repeat(60) + "];",
  "match x { A => 1, B => 2, _ => 3 }",
  "\u000b\u000c vt ff",
];

const LABELS = [undefined, undefined, "", "label", "expected `u32`, found `&str`", "日本語 label", "a much longer label that keeps going on and on", "x", "tab\there", "multi\nline label"];
const TEXTS = ["mismatched types", "unused variable: `x`", "this is a\nmulti-line message", "", "a `quoted` thing", "日本語のメッセージ", "ctrl\u0007 in title"];
const LEVELS: LevelName[] = ["ERROR", "WARNING", "INFO", "NOTE", "HELP"];
const REPS = ["", ";", "foo", "&str", "日本語", "\n", "    let z = 0;\n", "a\nb", "if x {\n    y\n}", "   ", "\t", "x".repeat(40), "a‍b"];

function random_cases(count: number): Case[] {
  const r = rng(0x5eed_a11);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const chance = (p: number) => r() < p;
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  const source = (): string => {
    const n = int(0, 10);
    const eol = chance(0.2) ? "\r\n" : "\n";
    const lines = Array.from({ length: n }, () => pick(FRAGMENTS));
    let s = lines.join(eol);
    if (n > 0 && chance(0.6)) s += eol;
    if (chance(0.05)) s = "﻿" + s;
    return s;
  };
  const boundaries = (s: string): number[] => {
    const b: number[] = [0];
    let off = 0;
    for (const c of s) {
      off += blen(c);
      b.push(off);
    }
    return b;
  };
  /** A byte range on char boundaries; biased towards spans inside one line. */
  const range = (s: string): [number, number] => {
    const b = boundaries(s);
    if (chance(0.6)) {
      // within one line
      const cps = [...s];
      const nls: number[] = [];
      for (let i = 0; i < b.length; i++) if (i === 0 || cps[i - 1] === "\n") nls.push(i);
      const li = pick(nls);
      let lj = li;
      while (lj < cps.length && cps[lj] !== "\n") lj++;
      const a = int(li, lj);
      const c = int(a, Math.min(lj, a + int(0, 12)));
      return [b[a]!, b[c]!];
    }
    const a = int(0, b.length - 1);
    const c = int(a, b.length - 1);
    return [b[a]!, b[c]!];
  };
  const level = (): LevelJ => {
    const l = pick(LEVELS);
    const k = r();
    if (k < 0.08) return { l, name: null };
    if (k < 0.15) return { l, name: pick(["custom", "error: internal compiler error", "日本"]) };
    return { l };
  };
  const cause = (src: string, path: string | undefined): ElementJ => {
    const anns: AnnJ[] = [];
    const n = src.length === 0 ? int(0, 1) : int(0, 5);
    for (let i = 0; i < n; i++) {
      const [start, end] = range(src);
      const kind = chance(0.45) ? "Primary" : chance(0.85) ? "Context" : "Visible";
      const label = pick(LABELS);
      const a: AnnJ = { kind, start, end };
      if (label !== undefined) a.label = label;
      if (chance(0.1)) a.hl = true;
      anns.push(a);
    }
    const e: ElementJ = { t: "cause", source: src, anns };
    if (path !== undefined) e.path = path;
    if (chance(0.3)) e.line_start = pick([1, 2, 9, 10, 99, 1000, 4242]);
    if (chance(0.25)) e.fold = false;
    return e;
  };
  const suggestion = (src: string, path: string | undefined): ElementJ => {
    // Non-overlapping, sorted patches (rustc never sends overlapping parts in one substitution).
    const b = boundaries(src);
    const n = int(1, 3);
    const pts = Array.from({ length: 2 * n }, () => b[int(0, b.length - 1)]!).sort((x, y) => x - y);
    const patches: PatchJ[] = [];
    for (let i = 0; i < n; i++) {
      let start = pts[2 * i]!;
      let end = pts[2 * i + 1]!;
      if (chance(0.4)) end = start; // insertion
      const prev = patches[patches.length - 1];
      if (prev !== undefined && start < prev.end) start = end = prev.end;
      if (prev !== undefined && start === prev.end && prev.start === prev.end) continue;
      patches.push({ start, end, rep: pick(REPS) });
    }
    const e: ElementJ = { t: "suggestion", source: src, patches };
    if (path !== undefined) e.path = path;
    if (chance(0.3)) e.line_start = pick([1, 5, 10, 99, 100]);
    if (chance(0.25)) e.fold = false;
    return e;
  };
  const path = (): string | undefined => (chance(0.1) ? undefined : pick(["src/main.rs", "src/lib.rs", "$DIR/other.rs", "日本/パス.rs"]));
  const elements = (n: number, allow_sugg: boolean): ElementJ[] => {
    const out: ElementJ[] = [];
    for (let i = 0; i < n; i++) {
      const k = r();
      if (k < 0.5) out.push(cause(source(), path()));
      else if (k < 0.7) out.push({ t: "message", level: level(), text: pick(TEXTS) });
      else if (k < 0.8) {
        const o: ElementJ = { t: "origin", path: path() ?? "x.rs" };
        if (chance(0.7)) o.line = int(1, 2000);
        if (chance(0.6)) o.col = int(0, 80);
        out.push(o);
      } else if (k < 0.87) out.push({ t: "padding" });
      else if (allow_sugg) out.push(suggestion(source(), path()));
      else out.push(cause(source(), path()));
    }
    return out;
  };
  const title = (secondary: boolean): TitleJ => {
    const t: TitleJ = { level: level(), text: pick(TEXTS) };
    if (secondary) t.secondary = true;
    if (chance(0.3)) t.id = pick(["E0308", "E0599", "unused_variables"]);
    if (t.id !== undefined && chance(0.3)) t.url = `https://doc.rust-lang.org/error_codes/${t.id}.html`;
    return t;
  };

  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const groups: GroupJ[] = [];
    const g0: GroupJ = chance(0.92) ? { title: title(chance(0.15)), elements: elements(int(0, 4), true) } : { level: level(), elements: elements(int(1, 3), true) };
    groups.push(g0);
    const extra = int(0, 2);
    for (let k = 0; k < extra; k++) {
      if (chance(0.5)) {
        const src = source();
        const g: GroupJ = { title: { level: { l: "HELP" }, text: pick(TEXTS), secondary: true }, elements: [] };
        const ns = int(1, 3);
        for (let j = 0; j < ns; j++) g.elements.push(suggestion(chance(0.7) ? src : source(), chance(0.8) ? "src/main.rs" : path()));
        if (chance(0.3)) g.elements.push({ t: "message", level: { l: "NOTE", name: null }, text: "and 3 other candidates" });
        groups.push(g);
      } else {
        groups.push(chance(0.85) ? { title: title(true), elements: elements(int(0, 3), true) } : { level: level(), elements: elements(int(1, 3), true) });
      }
    }
    const opts: OptsJ = {};
    if (chance(0.4)) opts.decor = "Unicode";
    if (chance(0.25)) opts.anon = true;
    if (chance(0.3)) opts.term_width = pick([0, 5, 20, 40, 80, 140, 200]);
    if (chance(0.06)) opts.short = true;
    out.push({ name: `random-${i}`, opts, groups });
  }
  return out;
}

/**
 * Suggestions whose patches overlap or are unsorted. rustc does not normally send these, but
 * `splice_lines` then produces `SubstitutionHighlight`s from negative `isize`s cast to `usize`,
 * which the renderer adds to and compares in wrapping (release-mode) arithmetic.
 */
function overlap_cases(count: number): Case[] {
  const r = rng(0x0de1a9);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const srcs = ["; n日yn// c{b", "fn main() {\n    let x = 1;\n}\n", "abc def ghi\njkl mno\n", "日本語のテキスト\nmore\n", "\tx\ty\tz\n\ta\n"];
  const reps = ["", "x", "日", "a\nb", "  ", "longer replacement", "\t"];
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const src = pick(srcs);
    const b: number[] = [0];
    let off = 0;
    for (const c of src) b.push((off += blen(c)));
    const patches: PatchJ[] = Array.from({ length: 2 + Math.floor(r() * 3) }, () => {
      const x = pick(b);
      const y = pick(b);
      return { start: Math.min(x, y), end: Math.max(x, y), rep: pick(reps) };
    });
    const sugg: ElementJ = { t: "suggestion", source: src, path: "a.rs", patches };
    if (r() < 0.3) sugg.fold = false;
    const opts: OptsJ = r() < 0.5 ? {} : { decor: "Unicode" };
    out.push({ name: `overlap-${i}`, opts, groups: [{ title: { level: { l: "HELP" }, text: "t", secondary: true }, elements: [sugg] }] });
  }
  return out;
}

export const RANDOM_CASES = 600;
export const OVERLAP_CASES = 200;

export function corpus(): Case[] {
  return [...hand(), ...random_cases(RANDOM_CASES), ...overlap_cases(OVERLAP_CASES)];
}

if (import.meta.main) {
  process.stdout.write(JSON.stringify(corpus()));
}
