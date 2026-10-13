// src/std/char.ts and src/std/unicode/str_case.ts against the oracle's core/alloc (the `lexdump` probe,
// built with the pinned toolchain):
//   - every `char` predicate and case mapping for every scalar value (`lexdump --unicode`);
//   - `str::to_lowercase`/`str::to_uppercase` (final sigma) for every cased / case-ignorable / mapped
//     char and a sample of the rest, in sigma contexts (`lexdump --str-case`).
// Skips (visibly) if the probe isn't built, fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import {
  is_alphabetic,
  is_alphanumeric,
  is_case_ignorable,
  is_cased,
  is_control,
  is_lowercase,
  is_numeric,
  is_titlecase,
  is_uppercase,
  is_whitespace,
  to_lowercase,
  to_uppercase,
} from "../char.ts";
import { str_to_lowercase, str_to_uppercase } from "./str_case.ts";

const PROBE = join(DATA, "target", "probes", "release", "lexdump" + (process.platform === "win32" ? ".exe" : ""));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: lexdump probe not built (bun scripts/probes.ts build lexdump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

function probe(args: string[], stdin?: string): string {
  if (!existsSync(PROBE)) throw new Error(`ERROR: lexdump probe not built (${PROBE}) and RUST_TS_REQUIRE_PROBES=1`);
  const r = Bun.spawnSync([PROBE, ...args], { stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: lexdump ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

const isScalar = (c: number): boolean => c < 0xd800 || c > 0xdfff;
const hex = (c: number): string => "U+" + c.toString(16).toUpperCase();

let unicode: Record<string, string | number[][]> | undefined;
function data(): Record<string, string | number[][]> {
  if (unicode === undefined) unicode = JSON.parse(probe(["--unicode"])) as Record<string, string | number[][]>;
  return unicode;
}

/** Membership bitmap (by code point) of a probe range list. */
function bitmap(ranges: number[][]): Uint8Array {
  const m = new Uint8Array(0x110000);
  for (const [lo, hi] of ranges) m.fill(1, lo!, hi! + 1);
  return m;
}

const PREDICATES: [string, (c: number) => boolean][] = [
  ["alphabetic", is_alphabetic],
  ["numeric", is_numeric],
  ["alphanumeric", is_alphanumeric],
  ["lowercase", is_lowercase],
  ["uppercase", is_uppercase],
  ["titlecase", is_titlecase],
  ["cased", is_cased],
  ["case_ignorable", is_case_ignorable],
  ["white_space", is_whitespace],
  ["control", is_control],
];

for (const [name, f] of PREDICATES) {
  test.skipIf(SKIP)(`char::is_${name} matches the oracle for every scalar`, () => {
    const want = bitmap(data()[name] as number[][]);
    const bad: string[] = [];
    let checked = 0;
    for (let c = 0; c <= 0x10ffff; c++) {
      if (!isScalar(c)) continue;
      checked++;
      if (f(c) !== (want[c] === 1) && bad.length < 10) bad.push(`${name}(${hex(c)}) = ${f(c)}`);
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(0x110000 - 0x800);
  });
}

for (const [name, f] of [
  ["to_lower", to_lowercase],
  ["to_upper", to_uppercase],
] as const) {
  test.skipIf(SKIP)(`char::${name}case matches the oracle for every scalar`, () => {
    const want = new Map<number, number[]>();
    for (const [c, ...m] of data()[name] as number[][]) want.set(c!, m.filter((x) => x !== 0));
    const bad: string[] = [];
    for (let c = 0; c <= 0x10ffff; c++) {
      if (!isScalar(c)) continue;
      const got = f(c).join(",");
      const exp = (want.get(c) ?? [c]).join(",");
      if (got !== exp && bad.length < 10) bad.push(`${name}(${hex(c)}) = [${got}], oracle [${exp}]`);
    }
    expect(bad).toEqual([]);
  });
}

test.skipIf(SKIP)("str::to_lowercase/to_uppercase match the oracle (final sigma contexts)", () => {
  const d = data();
  const interesting = new Uint8Array(0x110000);
  for (const key of ["cased", "case_ignorable"]) interesting.set(bitmap(d[key] as number[][]).map((x, i) => x | interesting[i]!));
  for (const key of ["to_lower", "to_upper"]) for (const [c] of d[key] as number[][]) interesting[c!] = 1;
  const cs: number[] = [];
  for (let c = 0; c <= 0x10ffff; c++) if (isScalar(c) && (interesting[c] === 1 || c % 251 === 0)) cs.push(c);
  const S = "Σ";
  const strs: string[] = ["", S, S + S, "A" + S, S + "a", "A" + S + "b", "OD" + S + "SEUS", "A'" + S, "A" + S + "'", "A" + S + "'b", "a.b" + S + ":", "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + S + "abc", "mixed CASE ascii only 0123"];
  for (const c of cs) {
    const x = String.fromCodePoint(c);
    strs.push(x, x + S, S + x, "A" + x + S, "A" + S + x, "A" + S + x + "b", x + "A" + S);
  }
  const enc = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const out = probe(["--str-case"], strs.map(enc).join("\n") + "\n").split("\n");
  const bad: string[] = [];
  strs.forEach((s, i) => {
    const got = `${enc(str_to_lowercase(s))} ${enc(str_to_uppercase(s))}`;
    if (got !== out[i] && bad.length < 10) bad.push(`${JSON.stringify(s)}: ${got} vs oracle ${out[i]}`);
  });
  expect(bad).toEqual([]);
  expect(strs.length).toBeGreaterThan(10000);
});
