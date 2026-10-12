// Oracle tests for the Oppen printer engine (`pp.ts`, `pp/ring.ts`).
//
// `pp_oracle/cases.json` was produced by `pp_oracle/gen.rs`, a scratch Rust program built
// against the pinned toolchain's own `rustc_ast_pretty` (rustc-dev component of
// nightly-2026-10-11). It drives `rustc_ast_pretty::pp::Printer` through its public API with
// hand-written edge cases plus deterministic pseudo-random op sequences (nested
// ibox/cbox/rbox/visual_align boxes with positive and negative indents; words of 0..120 bytes,
// punctuation and multi-byte UTF-8; space/zerobreak/hardbreak/break_offset/trailing_comma(_or_space);
// *_if_not_bol; synth_comment; is_beginning_of_line probes; pprust-shaped lists and blocks) and
// records the `eof()` output, or the panic message, plus every `is_beginning_of_line()` result.
// The op encoding is documented at the top of `gen.rs`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Panic } from "../std/panic.ts";
import { BoxMarker, Breaks, MARGIN, Printer, SIZE_INFINITY, Token } from "./pp.ts";
import { RingBuffer } from "./pp/ring.ts";

type Op =
  | ["i" | "c", number]
  | ["r", number, "C" | "I"]
  | ["v" | "e" | "n" | "s" | "z" | "h" | "po" | "pc" | "hb" | "sb" | "tc" | "tcs" | "bol"]
  | ["w" | "ws" | "wn" | "sc", string]
  | ["b", number, number];

interface Case {
  ops: Op[];
  out?: string;
  panic?: string;
  bol: string;
}

const CASES_: Case[] = JSON.parse(readFileSync(join(import.meta.dir, "pp_oracle", "cases.json"), "utf8"));

function replay(ops: Op[]): { out?: string; panic?: string; bol: string } {
  const p = Printer.new();
  const stack: BoxMarker[] = [];
  let bol = "";
  try {
    for (const op of ops) {
      switch (op[0]) {
        case "i":
          stack.push(p.ibox(op[1]));
          break;
        case "c":
          stack.push(p.cbox(op[1]));
          break;
        case "r":
          stack.push(p.rbox(op[1], op[2] === "C" ? Breaks.Consistent : Breaks.Inconsistent));
          break;
        case "v":
          stack.push(p.visual_align());
          break;
        case "e":
          // An unbalanced `end` cannot be expressed with real markers; the marker is only a token.
          p.end(stack.pop() ?? new BoxMarker());
          break;
        case "w":
          p.word(op[1]);
          break;
        case "ws":
          p.word_space(op[1]);
          break;
        case "wn":
          p.word_nbsp(op[1]);
          break;
        case "n":
          p.nbsp();
          break;
        case "s":
          p.space();
          break;
        case "z":
          p.zerobreak();
          break;
        case "h":
          p.hardbreak();
          break;
        case "b":
          p.break_offset(op[1], op[2]);
          break;
        case "po":
          p.popen();
          break;
        case "pc":
          p.pclose();
          break;
        case "hb":
          p.hardbreak_if_not_bol();
          break;
        case "sb":
          p.space_if_not_bol();
          break;
        case "tc":
          p.trailing_comma();
          break;
        case "tcs":
          p.trailing_comma_or_space();
          break;
        case "sc":
          p.synth_comment(op[1]);
          break;
        case "bol":
          bol += p.is_beginning_of_line() ? "1" : "0";
          break;
      }
    }
    return { out: p.eof(), bol };
  } catch (e) {
    if (e instanceof Panic) return { panic: e.message, bol };
    throw e;
  }
}

describe("pp oracle", () => {
  test("fixture is non-trivial", () => {
    expect(CASES_.length).toBeGreaterThan(500);
    expect(CASES_.filter((c) => c.panic !== undefined).length).toBeGreaterThan(10);
    expect(CASES_.filter((c) => c.out !== undefined && c.out.includes("\n")).length).toBeGreaterThan(300);
  });

  test("every case matches rustc_ast_pretty::pp::Printer", () => {
    let bad = 0;
    const first: string[] = [];
    CASES_.forEach((c, k) => {
      const got = replay(c.ops);
      const want = c.panic !== undefined ? { panic: c.panic, bol: c.bol } : { out: c.out, bol: c.bol };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        bad++;
        if (first.length < 3) first.push(`case ${k}: want ${JSON.stringify(want).slice(0, 300)} got ${JSON.stringify(got).slice(0, 300)}`);
      }
    });
    expect(first).toEqual([]);
    expect(bad).toBe(0);
  });
});

describe("pp unit", () => {
  test("is_hardbreak_tok", () => {
    expect(Token.is_hardbreak_tok(Printer.hardbreak_tok_offset(0))).toBe(true);
    expect(Token.is_hardbreak_tok(Printer.hardbreak_tok_offset(-4))).toBe(false);
    expect(Token.is_hardbreak_tok(Token.End)).toBe(false);
    expect(Token.is_hardbreak_tok({ $: "Break", _0: { offset: 0, blank_space: SIZE_INFINITY, pre_break: 0x2c } })).toBe(false);
  });

  test("last_token / replace_last_token_still_buffered / offset", () => {
    const p = Printer.new();
    expect(p.last_token()).toBeUndefined();
    const b = p.cbox(4);
    p.word("{");
    p.hardbreak();
    expect(p.last_token_still_buffered()).toEqual(Printer.hardbreak_tok_offset(0));
    p.replace_last_token_still_buffered(Printer.hardbreak_tok_offset(-4));
    p.offset(2);
    expect(p.last_token()).toEqual(Printer.hardbreak_tok_offset(-2));
    p.word("}");
    p.end(b);
    expect(p.eof()).toBe("{\n  }");
  });

  test("width counts UTF-8 bytes", () => {
    // 26 * 3 = 78 bytes: exactly fills the margin, so the following space breaks.
    const p = Printer.new();
    const b = p.ibox(0);
    p.word("日".repeat(26));
    p.space();
    p.word("z");
    p.end(b);
    expect(p.eof()).toBe(`${"日".repeat(26)}\nz`);
    expect(MARGIN).toBe(78);
  });

  test("BoxMarker::drop panics", () => {
    expect(() => new BoxMarker().drop()).toThrow("BoxMarker not ended with `Printer::end()`");
  });
});

describe("RingBuffer", () => {
  test("indexing follows the infinite-sequence view", () => {
    const r = RingBuffer.new<string>();
    expect(r.is_empty()).toBe(true);
    expect(r.push("a")).toBe(0);
    expect(r.push("b")).toBe(1);
    expect(r.pop_first()).toBe("a");
    expect(r.index_of_first()).toBe(1);
    expect(r.index(1)).toBe("b");
    expect(r.push("c")).toBe(2);
    expect(r.index_mut(2)).toBe("c");
    expect(r.first()).toBe("b");
    expect(r.last()).toBe("c");
    expect(() => r.index(0)).toThrow("called `Option::unwrap()` on a `None` value");
    expect(() => r.index(3)).toThrow("Out of bounds access");
    r.clear();
    expect(r.is_empty()).toBe(true);
    expect(r.pop_first()).toBeUndefined();
    // `clear` keeps the offset (1, after one `pop_first`): indices continue from there.
    expect(r.push("d")).toBe(1);
  });
});
