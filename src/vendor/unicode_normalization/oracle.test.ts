// rust-ts: unicode-normalization (=0.1.25) against the oracle (the `nfc` probe, tools/probes/nfc):
// per-char properties and one-char normalizations over all scalar values, `char::compose` over all
// composition-relevant pairs, and nfc/nfd/nfkc/nfkd/stream_safe/is_* over 30000 deterministic
// pseudo-random strings. Skips (visibly) if the probe isn't built, fails instead under
// RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Str } from "../../std/str.ts";
import {
  type CharIterator,
  char,
  is_nfc,
  is_nfc_quick,
  is_nfc_stream_safe,
  is_nfd,
  is_nfd_quick,
  is_nfd_stream_safe,
  is_nfkc,
  is_nfkc_quick,
  is_nfkd,
  is_nfkd_quick,
  type IsNormalized,
  OptionIntoIter,
  UNICODE_VERSION,
  UnicodeNormalization_char,
  UnicodeNormalization_str,
} from "./lib.ts";

const PROBE = join(DATA, "target", "probes", "release", "nfc" + (process.platform === "win32" ? ".exe" : ""));
// Missing probe: a visible skip, or a failure under RUST_TS_REQUIRE_PROBES=1 (gate hosts build the probes).
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: nfc probe not built (bun scripts/probes.ts build nfc); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

type Runs = [number, number, number][];
interface Oracle {
  unicode_version: string;
  ccc: Runs;
  combining_mark: Runs;
  public_assigned: Runs;
  qc_nfc: Runs;
  qc_nfkc: Runs;
  qc_nfd: Runs;
  qc_nfkd: Runs;
  nfd: [number, number[]][];
  nfkd: [number, number[]][];
  nfc: [number, number[]][];
  nfkc: [number, number[]][];
  cjk: [number, number[]][];
  compose_a: number[];
  compose_b: number[];
  compose: [number, number, number][];
  strings: number[][];
  results: [number[], number[], number[], number[], number[], number][];
}

let oracle: Oracle | undefined;
function load(): Oracle {
  if (!existsSync(PROBE)) throw new Error(`ERROR: nfc probe not built (${PROBE}) and RUST_TS_REQUIRE_PROBES=1`);
  if (oracle) return oracle;
  const r = Bun.spawnSync([PROBE], { stdout: "pipe" });
  expect(r.exitCode).toBe(0);
  oracle = JSON.parse(r.stdout.toString()) as Oracle;
  return oracle;
}

const QC: Record<IsNormalized, number> = { Yes: 0, No: 1, Maybe: 2 };
function collect(it: CharIterator): number[] {
  const out: number[] = [];
  for (let c = it.next(); c !== undefined; c = it.next()) out.push(c);
  return out;
}
const hex = (cs: readonly number[]) => cs.map((c) => c.toString(16)).join(" ");

test.skipIf(SKIP)("per-char properties match the oracle for all scalars", () => {
  const o = load();
  expect(`(${UNICODE_VERSION.join(", ")})`).toBe(o.unicode_version);
  const one = (c: number) => new OptionIntoIter(c);
  for (const [name, f, runs] of [
    ["canonical_combining_class", char.canonical_combining_class, o.ccc],
    ["is_combining_mark", (c: number) => Number(char.is_combining_mark(c)), o.combining_mark],
    ["is_public_assigned", (c: number) => Number(char.is_public_assigned(c)), o.public_assigned],
    ["is_nfc_quick", (c: number) => QC[is_nfc_quick(one(c))], o.qc_nfc],
    ["is_nfkc_quick", (c: number) => QC[is_nfkc_quick(one(c))], o.qc_nfkc],
    ["is_nfd_quick", (c: number) => QC[is_nfd_quick(one(c))], o.qc_nfd],
    ["is_nfkd_quick", (c: number) => QC[is_nfkd_quick(one(c))], o.qc_nfkd],
  ] as const) {
    let checked = 0;
    const bad: string[] = [];
    for (const [lo, hi, want] of runs) {
      for (let c = lo; c <= hi; c++, checked++) {
        const got = f(c);
        if (got !== want && bad.length < 10) bad.push(`${name}(U+${c.toString(16)}) = ${got}, oracle ${want}`);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(0x110000 - 0x800);
  }
}, 60_000);

test.skipIf(SKIP)("one-char nfd/nfkd/nfc/nfkc/cjk_compat_variants match the oracle for all scalars", () => {
  const o = load();
  const U = UnicodeNormalization_char;
  for (const [name, f, list] of [
    ["nfd", (c: number) => collect(U.nfd(c)), o.nfd],
    ["nfkd", (c: number) => collect(U.nfkd(c)), o.nfkd],
    ["nfc", (c: number) => collect(U.nfc(c)), o.nfc],
    ["nfkc", (c: number) => collect(U.nfkc(c)), o.nfkc],
    ["cjk_compat_variants", (c: number) => collect(U.cjk_compat_variants(c)), o.cjk],
  ] as const) {
    const want = new Map(list.map(([c, s]) => [c, hex(s)]));
    const bad: string[] = [];
    for (let c = 0; c < 0x110000; c++) {
      if (c === 0xd800) c = 0xe000;
      const got = hex(f(c));
      const exp = want.get(c) ?? c.toString(16);
      if (got !== exp && bad.length < 10) bad.push(`${name}(U+${c.toString(16)}) = [${got}], oracle [${exp}]`);
    }
    expect(bad).toEqual([]);
  }
}, 60_000);

test.skipIf(SKIP)("char::compose matches the oracle over all composition-relevant pairs", () => {
  const o = load();
  const want = new Map<number, number>();
  // Keys a * 0x110000 + b stay below 2^53.
  for (const [a, b, r] of o.compose) want.set(a * 0x110000 + b, r);
  let some = 0;
  const bad: string[] = [];
  for (const a of o.compose_a) {
    for (const b of o.compose_b) {
      const got = char.compose(a, b);
      const exp = want.get(a * 0x110000 + b);
      if (got !== undefined) some++;
      if (got !== exp && bad.length < 10) bad.push(`compose(U+${a.toString(16)}, U+${b.toString(16)}) = ${got}, oracle ${exp}`);
    }
  }
  expect(bad).toEqual([]);
  expect(some).toBe(o.compose.length);
}, 120_000);

test.skipIf(SKIP)("string normalization and is_* checks match the oracle on 30000 strings", () => {
  const o = load();
  const U = UnicodeNormalization_str;
  const bad: string[] = [];
  for (let i = 0; i < o.strings.length; i++) {
    const s = Str.from(String.fromCodePoint(...o.strings[i]!));
    const [nfc, nfd, nfkc, nfkd, ss, flags] = o.results[i]!;
    const got_flags =
      QC[is_nfc_quick(s.chars())] |
      (Number(is_nfc(s)) << 2) |
      (Number(is_nfd(s)) << 3) |
      (Number(is_nfkc(s)) << 4) |
      (Number(is_nfkd(s)) << 5) |
      (Number(is_nfc_stream_safe(s)) << 6) |
      (Number(is_nfd_stream_safe(s)) << 7);
    for (const [name, got, exp] of [
      ["nfc", hex(collect(U.nfc(s))), hex(nfc)],
      ["nfd", hex(collect(U.nfd(s))), hex(nfd)],
      ["nfkc", hex(collect(U.nfkc(s))), hex(nfkc)],
      ["nfkd", hex(collect(U.nfkd(s))), hex(nfkd)],
      ["stream_safe", hex(collect(U.stream_safe(s))), hex(ss)],
      ["flags", String(got_flags), String(flags)],
    ] as const) {
      if (got !== exp && bad.length < 10) bad.push(`${name}([${hex(o.strings[i]!)}]) = [${got}], oracle [${exp}]`);
    }
  }
  expect(bad).toEqual([]);
}, 60_000);
