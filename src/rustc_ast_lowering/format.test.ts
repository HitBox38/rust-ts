// Tests of lane lower-asm-format-contract for compiler/rustc_ast_lowering/src/format.rs.
//
// Oracle test: format_oracle/run.ts lowers every outermost `format_args!` of format_oracle/<case>.rs with the ported
// `lower_format_args` (`flatten_format_args`, `inline_literals`, `try_inline_lit`, `expand_format_args`,
// `make_argument`, `make_count`, `for_all_argument_indexes`) on a recording LoweringContext and renders the result
// in `-Zunpretty=hir` syntax; each rendering must occur, in order, in the pinned rustc's `-Zunpretty=hir` of the same
// file (whitespace collapsed, literals canonicalized), and the number of `fmt::Arguments` constructions must agree.
// This checks the template bytecode (flags, width/precision, argument positions), the argument tuple and the
// `fmt::Argument` constructor list (argmap order), `from_str`/`from_str_nonconst`, literal inlining and flattening.
// The oracle runs live (needs the pinned toolchain; skipped without it unless RUST_TS_REQUIRE_PROBES=1).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import "./lib.ts";
import { format } from "../rustc_ast/lib.ts";
import { Ok, Err } from "../std/result.ts";
import { ArgumentType, for_all_argument_indexes, make_count } from "./format.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import type { Span } from "../rustc_span/lib.ts";

const DIR = join(import.meta.dir, "format_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const hex = (b: readonly number[] | Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** Rust `escape_debug` / `escape_ascii` escapes back to code points (strings) or bytes (byte strings). */
function unescape(body: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < body.length; ) {
    const c = body.codePointAt(i)!;
    i += c > 0xffff ? 2 : 1;
    if (c !== 0x5c) {
      out.push(c);
      continue;
    }
    const e = body[i++]!;
    switch (e) {
      case "n":
        out.push(10);
        break;
      case "t":
        out.push(9);
        break;
      case "r":
        out.push(13);
        break;
      case "0":
        out.push(0);
        break;
      case "\\":
      case '"':
      case "'":
        out.push(e.charCodeAt(0));
        break;
      case "x":
        out.push(parseInt(body.slice(i, i + 2), 16));
        i += 2;
        break;
      case "u": {
        const end = body.indexOf("}", i);
        out.push(parseInt(body.slice(i + 1, end), 16));
        i = end + 1;
        break;
      }
      default:
        throw new Error(`ERROR: unknown escape \\${e}`);
    }
  }
  return out;
}

/** Literals to `B[hex]` / `S[utf-8 hex]` (as format_oracle/run.ts renders them), then whitespace collapsed. */
function canon(s: string): string {
  // One left-to-right scan, so a `b` ending a string (`"acb"`) is never taken for a byte-string prefix.
  return s
    .replace(/(?<![A-Za-z0-9_])(b?)"((?:[^"\\]|\\.)*)"/g, (_, b: string, body: string) =>
      b === "b"
        ? `B[${hex(unescape(body))}]`
        : `S[${hex(new TextEncoder().encode(String.fromCodePoint(...unescape(body))))}]`,
    )
    .replace(/\s+/g, " ");
}

const CONFIGS: { name: string; file: string; flags: string[] }[] = [
  { name: "default", file: "cases.rs", flags: [] },
  { name: "no flattening, fmt-debug=none", file: "cases.rs", flags: ["-Zflatten-format-args=no", "-Zfmt-debug=none"] },
  { name: "fmt-debug=shallow", file: "cases.rs", flags: ["-Zfmt-debug=shallow"] },
];

describe("format_oracle: lower_format_args against rustc -Zunpretty=hir", () => {
  for (const cfg of CONFIGS) {
    test(cfg.name, () => {
      const s = sysroot();
      if (s === undefined || !rustc_at_pin()) {
        if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
        return;
      }
      const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--edition=2021", ...cfg.flags, cfg.file];
      const oracle = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir", ...args]);
      expect(oracle.exit).toBe(0);
      const port = run(["bun", join(DIR, "run.ts"), ...args]);
      expect({ exit: port.exit, stderr: port.stderr }).toEqual({ exit: 0, stderr: "" });

      const o = canon(oracle.stdout);
      const lines = port.stdout.trimEnd().split("\n").map((l) => canon(JSON.parse(l) as string));
      expect(lines.length).toBeGreaterThan(30);
      let cursor = 0;
      for (const l of lines) {
        const at = o.indexOf(l, cursor);
        expect({ found: at >= 0, l, near: o.slice(cursor, cursor + 600) }).toEqual({ found: true, l, near: o.slice(cursor, cursor + 600) });
        cursor = at + l.length;
      }
      const count = (t: string): number => t.match(/format_arguments::/g)?.length ?? 0;
      expect(lines.map(count).reduce((a, b) => a + b, 0)).toBe(count(o));
    }, 120_000);
  }
});

// Unit tests of the free fns (shapes as the parser builds them).
const pos = (index: number, kind: format.FormatArgPositionKind = "Implicit"): format.FormatArgPosition => ({
  index: Ok(index),
  kind,
  span: undefined,
});
const opts = (o: Partial<format.FormatOptions> = {}): format.FormatOptions => ({
  width: undefined,
  precision: undefined,
  alignment: undefined,
  fill: undefined,
  sign: undefined,
  alternate: false,
  zero_pad: false,
  debug_hex: undefined,
  ...o,
});
const ph = (argument: format.FormatArgPosition, o?: Partial<format.FormatOptions>): format.FormatArgsPiece => ({
  $: "Placeholder",
  _0: { argument, span: undefined, format_trait: "Display", format_options: opts(o) },
});

test("for_all_argument_indexes visits argument, width and precision indexes (format.rs:539)", () => {
  const template: format.FormatArgsPiece[] = [
    { $: "Literal", _0: 0 as never },
    ph(pos(0), { width: { $: "Argument", _0: pos(1, "Number") }, precision: { $: "Argument", _0: pos(2, "Number") } }),
    ph({ index: Err(5), kind: "Named", span: undefined }, { width: { $: "Literal", _0: 4 } }),
  ];
  const seen: number[] = [];
  for_all_argument_indexes(template, (i) => {
    seen.push(i.value);
    i.value += 10;
  });
  expect(seen).toEqual([0, 1, 2]);
  const p = template[1]!.$ === "Placeholder" ? template[1]!._0 : undefined;
  expect(p!.argument.index).toEqual(Ok(10));
  expect(p!.format_options.width).toEqual({ $: "Argument", _0: pos(11, "Number") });
  expect(p!.format_options.precision).toEqual({ $: "Argument", _0: pos(12, "Number") });
  const q = template[2]!.$ === "Placeholder" ? template[2]!._0 : undefined;
  expect(q!.argument.index).toEqual(Err(5));
});

test("make_count: literals are direct, arguments get their argmap position (format.rs:266)", () => {
  const key = (k: readonly [number, ArgumentType]): string => `${k[0]}:${k[1].$ === "Format" ? k[1]._0 : k[1].$}`;
  const argmap = new KeyedMap<[number, ArgumentType], Span | undefined>(key);
  argmap.set([0, { $: "Format", _0: "Display" }], undefined);
  expect(make_count({ $: "Literal", _0: 7 }, argmap)).toEqual([false, 7]);
  expect(make_count({ $: "Argument", _0: pos(3) }, argmap)).toEqual([true, 1]);
  expect(make_count({ $: "Argument", _0: pos(0) }, argmap)).toEqual([true, 2]);
  // Same (index, Usize) again: the existing position.
  expect(make_count({ $: "Argument", _0: pos(3) }, argmap)).toEqual([true, 1]);
  // A missing argument (`Err`) is keyed by usize::MAX.
  expect(make_count({ $: "Argument", _0: { index: Err(9), kind: "Named", span: undefined } }, argmap)).toEqual([true, 3]);
  expect(argmap.size).toBe(4);
});
