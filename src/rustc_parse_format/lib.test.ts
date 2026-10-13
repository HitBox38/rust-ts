// Oracle replay for the format-string parser (`lib.ts`).
//
// `pf_oracle/cases.jsonl` was produced by `pf_oracle/gen.rs`, a scratch Rust program built against
// the pinned toolchain's own `rustc_parse_format` (rustc-dev component of nightly-2026-10-11). It
// parses ~440 format strings (hand-written edge cases: escapes, nested/unmatched braces,
// positional/named/implicit args, width/precision with `$` and `*`, fill/alignment, sign/`#`/`0`
// flags, `{:#x?}`, invalid specs, raw identifiers, field access, python-isms, u16 overflow,
// multi-byte chars, newlines; plus deterministic pseudo-random strings) in up to 13
// configurations each (snippet none / `"..."` / raw / mismatching, appended newline, all three
// `ParseMode`s) and records the `{:?}` of the collected pieces, every `ParseError`, `curarg`,
// `arg_places`, `line_spans` and `is_source_literal`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { debug_str, debug_vec, PLAIN } from "../std/fmt.ts";
import { Str } from "../std/str.ts";
import { debug_Piece, type ParseError, type ParseMode, Parser, type Suggestion } from "./lib.ts";

interface Case {
  input: string;
  style: number | null;
  snippet: string | null;
  nl: boolean;
  mode: ParseMode;
  pieces: string;
  errors: string[];
  curarg: number;
  arg_places: string;
  line_spans: string;
  src: boolean;
}

const CASES: Case[] = readFileSync(join(import.meta.dir, "pf_oracle", "cases.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l !== "")
  .map((l) => JSON.parse(l));

type Range = { start: number; end: number };
const r = (x: Range): string => `${x.start}..${x.end}`;
const ranges = (xs: Range[]): string => "[" + xs.map(r).join(", ") + "]";
const opt_str = (s: string | undefined): string => (s === undefined ? "None" : `Some(${debug_str(s)})`);

function sugg(s: Suggestion): string {
  switch (s.$) {
    case "None":
    case "UsePositional":
    case "UseRustDebugPrintingMacro":
      return s.$;
    case "RemoveRawIdent":
    case "AddMissingColon":
      return `${s.$}(${r(s._0)})`;
    case "ReorderFormatParameter":
      return `${s.$}(${r(s._0)}, ${debug_str(s._1)})`;
  }
}

function err_line(e: ParseError): string {
  const sec = e.secondary_label === undefined ? "None" : `Some((${debug_str(e.secondary_label[0])}, ${r(e.secondary_label[1])}))`;
  return `description=${debug_str(e.description)} note=${opt_str(e.note)} label=${debug_str(e.label)} span=${r(e.span)} secondary_label=${sec} suggestion=${sugg(e.suggestion)}`;
}

describe("rustc_parse_format oracle", () => {
  test("fixture loaded", () => {
    expect(CASES.length).toBeGreaterThan(4000);
  });

  test("every case matches the oracle", () => {
    const failures: string[] = [];
    for (const c of CASES) {
      const parser = Parser.new(Str.from(c.input), c.style ?? undefined, c.snippet === null ? undefined : Str.from(c.snippet), c.nl, c.mode);
      const pieces = parser.collect();
      const got = {
        pieces: debug_vec(pieces, PLAIN, debug_Piece),
        errors: parser.errors.map(err_line),
        curarg: parser.curarg,
        arg_places: ranges(parser.arg_places),
        line_spans: ranges(parser.line_spans),
        src: parser.is_source_literal,
      };
      const want = { pieces: c.pieces, errors: c.errors, curarg: c.curarg, arg_places: c.arg_places, line_spans: c.line_spans, src: c.src };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`${JSON.stringify([c.input, c.style, c.snippet, c.nl, c.mode])}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
      }
    }
    if (failures.length) console.log(`ERROR: ${failures.length}/${CASES.length} cases differ; first:\n${failures[0]}`);
    expect(failures.length).toBe(0);
  });
});
