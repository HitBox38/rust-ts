// rust-ts: unicode-width (=0.2.2) against the oracle (the `uwidth` probe built from the pinned crate):
//   - `UnicodeWidthChar::width`/`width_cjk` for every scalar value;
//   - `UnicodeWidthStr::width`/`width_cjk` for every scalar value placed in each of PATTERNS
//     (alone, before U+FE0E / U+FE0F / VS1-3 / U+0338 / modifiers / ZWJ, after a Khmer coeng, ...);
//   - explicit sequences (ZWJ sequences, regional-indicator pairs, emoji modifiers, Hangul L/V/T,
//     Arabic lam-alef ligatures) and a large deterministic random sample of mixed strings.
// Skips (visibly) if the probe isn't built, fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { UNICODE_VERSION, UnicodeWidthChar, UnicodeWidthStr } from "./lib.ts";

const PROBE = join(DATA, "target", "probes", "release", "uwidth" + (process.platform === "win32" ? ".exe" : ""));
// Missing probe: a visible skip, or a failure under RUST_TS_REQUIRE_PROBES=1 (gate hosts build the probes).
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: uwidth probe not built (bun scripts/probes.ts build uwidth); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

function probe(args: string[], stdin?: string): string {
  if (!existsSync(PROBE)) {
    throw new Error(`ERROR: uwidth probe not built (${PROBE}) and RUST_TS_REQUIRE_PROBES=1`);
  }
  const r = Bun.spawnSync([PROBE, ...args], { stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: uwidth ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

const SCALARS = 0x110000 - 0x800;
const isScalar = (c: number): boolean => c < 0xd800 || c > 0xdfff;
const hex = (c: number): string => c.toString(16).toUpperCase();
const show = (cps: readonly number[]): string => cps.map((c) => "U+" + hex(c)).join(" ");

test.skipIf(SKIP)("width/width_cjk match the oracle for all scalars", () => {
  const data = JSON.parse(probe([])) as { unicode_version: string; width: [number, number, number][]; width_cjk: [number, number, number][] };
  expect(`(${UNICODE_VERSION.join(", ")})`).toBe(data.unicode_version);
  for (const [name, f, runs] of [
    ["width", UnicodeWidthChar.width, data.width],
    ["width_cjk", UnicodeWidthChar.width_cjk, data.width_cjk],
  ] as const) {
    let checked = 0;
    const bad: string[] = [];
    for (const [lo, hi, w] of runs) {
      const want = w < 0 ? undefined : w;
      for (let c = lo; c <= hi; c++, checked++) {
        if (f(c) !== want && bad.length < 10) bad.push(`${name}(U+${hex(c)}) = ${f(c)}, oracle ${want}`);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(SCALARS);
  }
});

// Every scalar `c` substituted into each pattern (see tools/probes/uwidth/main.rs).
const PATTERNS: string[][] = [
  // alone, and with the variation selectors after it
  ["c", "c,FE0E", "c,FE0F", "c,FE00", "c,FE01", "c,FE02", "c,FE0E,FE0F", "c,FE0F,FE0E"],
  // combining long solidus overlay (cjk), keycaps, line feed
  ["c,0338", "c,0338,FE0F", "3D,c,0338", "c,20E3", "c,FE0F,20E3", "c,0A", "0D,c,0A"],
  // emoji modifiers, ZWJ sequences, regional indicators, tags
  ["c,1F3FB", "c,1F3FF", "c,200D,1F466", "1F466,200D,c", "c,FE0F,200D,1F466", "1F469,200D,c,FE0F", "c,1F1E6", "1F1E6,c", "1F1E6,200D,c", "1F3F4,c,E007F"],
  // ligatures: Arabic lam-alef, Hebrew alef-lamed, Khmer coeng, Buginese, Tifinagh, Lisu, Old Turkic, Kirat Rai
  ["c,0627", "0644,c", "0644,c,0627", "c,200D,05DC", "05D0,c,05DC", "17D2,c", "c,17D2,1780", "1A15,1A17,c,1A10", "2D4F,c,2D3E", "c,2D7F,2D3E", "A4EA,c", "A4F8,c", "c,200D,10C03", "10C32,c,10C03", "c,16D67", "16D67,c", "16D63,16D67,c"],
  // Hangul L/V/T
  ["1100,c", "c,1161", "1100,c,11A8", "1100,1161,c"],
];

function spell(pat: string, c: number): string {
  let s = "";
  for (const p of pat.split(",")) s += String.fromCodePoint(p === "c" ? c : parseInt(p, 16));
  return s;
}

for (const group of PATTERNS) {
  test.skipIf(SKIP)(
    `str width/width_cjk match the oracle for every scalar in ${group.join(" | ")}`,
    () => {
      const data = JSON.parse(probe(["patterns", ...group])) as Record<string, [number, number, number, number][]>;
      const bad: string[] = [];
      for (const pat of group) {
        const runs = data[pat];
        expect(runs).toBeDefined();
        let checked = 0;
        for (const [lo, hi, w, wc] of runs!) {
          for (let c = lo; c <= hi; c++, checked++) {
            const s = spell(pat, c);
            const gw = UnicodeWidthStr.width(s);
            const gwc = UnicodeWidthStr.width_cjk(s);
            if ((gw !== w || gwc !== wc) && bad.length < 10) bad.push(`${pat} c=U+${hex(c)}: width ${gw}/${gwc}, oracle ${w}/${wc}`);
          }
        }
        expect(checked).toBe(SCALARS);
      }
      expect(bad).toEqual([]);
    },
    120_000,
  );
}

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** Explicit sequences: ZWJ sequences, RI pairs, emoji modifiers, Hangul L/V/T, Arabic lam-alef. */
function explicitStrings(): number[][] {
  const out: number[][] = [];
  const RI = range(0x1f1e6, 0x1f1ff);
  const MOD = range(0x1f3fb, 0x1f3ff);
  const EMOJI = [0x1f466, 0x1f469, 0x1f468, 0x1f9d1, 0x1f52c, 0x1f91d, 0x2764, 0x1f48b, 0x1f3f4, 0x2620, 0x1f308, 0x26a7, 0x1f441, 0x1f5e8, 0x1f46a, 0x1f3fb, 0x24c2, 0x23, 0x2a, 0x31, 0x1f1e6, 0x1f1ff, 0x61, 0x2648, 0x1f21a, 0x1f700, 0xa9];
  const JOIN = [[0x200d], [0xfe0f, 0x200d], [0x200d, 0x200d], [0xfe0e, 0x200d], [0x20e3, 0x200d], [0xfe0f, 0x20e3, 0x200d], [0x1f3fb, 0x200d], [0xe007f, 0x200d]];
  // ZWJ sequences
  for (const a of EMOJI) for (const j of JOIN) for (const b of EMOJI) out.push([a, ...j, b], [a, ...j, b, 0xfe0f]);
  for (const a of EMOJI) for (const b of EMOJI) for (const c of EMOJI.slice(0, 8)) out.push([a, 0x200d, b, 0x200d, c]);
  // regional-indicator pairs, triples, and with ZWJ
  for (const a of RI) for (const b of RI) out.push([a, b], [a, b, a], [a, 0x200d, b], [a, b, 0x200d, a, b], [a, b, 0x200d, a, b, a]);
  for (let n = 1; n <= 9; n++) out.push([...Array(n).fill(0x1f1e6)], [0x1f1e6, 0x1f1e6, 0x200d, ...Array(n).fill(0x1f1e6), 0x200d, 0x1f1e6, 0x1f1e6]);
  // emoji modifiers after every emoji-ish base
  for (const base of [...range(0x261d, 0x270d), ...range(0x1f385, 0x1f3cc), ...range(0x1f442, 0x1f4aa), ...range(0x1f574, 0x1f6cc), ...range(0x1f90c, 0x1f9dd), ...range(0x1fac3, 0x1faf8)]) {
    for (const m of MOD) out.push([base, m], [base, 0x200d, m], [base, m, 0x200d, 0x1f466], [base, 0xfe0f, m]);
  }
  // tag sequences (subdivision flags)
  const TAGS = [[0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067], [0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074], [0xe0031], [0xe0031, 0xe0031, 0xe0031], [0xe0063, 0xe0063, 0xe0063, 0xe0063, 0xe0063, 0xe0063, 0xe0063], [0xe0031, 0xe0031, 0xe0031, 0xe0063]];
  for (const t of TAGS) out.push([0x1f3f4, ...t, 0xe007f], [0x1f3f4, ...t, 0xe007f, 0x200d, 0x24c2, 0xfe0f], [0x61, 0x200d, 0x1f3f4, ...t, 0xe007f]);
  // Hangul L/V/T
  const L = [...range(0x1100, 0x115f), ...range(0xa960, 0xa97c)];
  const V = [...range(0x1160, 0x11a7), ...range(0xd7b0, 0xd7c6)];
  const T = [...range(0x11a8, 0x11ff), ...range(0xd7cb, 0xd7fb)];
  for (const l of L) for (const v of V) out.push([l, v]);
  for (let i = 0; i < L.length; i++) for (const t of T) out.push([L[i]!, V[(i * 7) % V.length]!, t]);
  for (const l of L) out.push([l, l, V[0]!], [0x61, l], [l, 0xac00], [0xac00, T[0]!]);
  // Arabic lam-alef (with transparent marks, ZWJ, variation selectors and the solidus between)
  const LAM = [0x644, 0x6b5, 0x6b6, 0x6b7, 0x6b8, 0x76a, 0x8a6, 0x8c7];
  const ALEF = [0x622, 0x623, 0x625, 0x627, 0x671, 0x672, 0x673, 0x675, 0x773, 0x774, 0x870, 0x882];
  const MID = [[], [0x65f], [0x65f, 0x65e], [0x200d], [0xfe0e], [0xfe0f], [0x17b5], [0x338], [0x338, 0xfe0f], [0xfe0f, 0x338], [0x1e94b], [0x64b], [0x670]];
  for (const l of LAM) for (const m of MID) for (const a of ALEF) out.push([l, ...m, a], [l, l, ...m, a]);
  for (const a of ALEF) out.push([0x3d, 0x338, a], [0x3c, 0x338, a]);
  return out;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A large deterministic random sample of mixed strings, biased towards the chars the state machine handles. */
function randomStrings(n: number): number[][] {
  const rnd = mulberry32(0x5eed_0002);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const SPECIAL = [
    0x0a, 0x0d, 0x23, 0x2a, 0x30, 0x39, 0x3c, 0x3d, 0x3e, 0x61, 0xa0, 0xa9, 0xb7, 0x200d, 0x20e3, 0x338, 0x34f, 0x5d0, 0x5dc, 0x644, 0x627, 0x623, 0x6b8, 0x65f,
    0x17d2, 0x17b5, 0x1780, 0x1783, 0x17a4, 0x17d8, 0x1a10, 0x1a15, 0x1a17, 0x2d31, 0x2d3e, 0x2d4f, 0x2d66, 0x2d6f, 0x2d7f, 0xa4f8, 0xa4fb, 0xa4fc, 0xa4fd,
    0x10c03, 0x10c32, 0x16d63, 0x16d67, 0x16d68, 0x16d69, 0x2018, 0x2019, 0x201c, 0x201d, 0x2648, 0x24c2, 0x1f21a, 0x1f700, 0xfe00, 0xfe01, 0xfe02,
    0xfe0e, 0xfe0f, 0x1f1e6, 0x1f1e7, 0x1f1ff, 0x1f3fb, 0x1f3ff, 0x1f466, 0x1f469, 0x1f46a, 0x1f3f4, 0xe0031, 0xe0063, 0xe007f, 0x1100, 0x1161, 0x11a8, 0xac00,
  ];
  const BLOCKS: [number, number][] = [
    [0x20, 0x7e], [0x80, 0x2ff], [0x300, 0x36f], [0x590, 0x5ff], [0x600, 0x8ff], [0x1100, 0x11ff], [0x1780, 0x17ff], [0x1800, 0x18af], [0x1a00, 0x1a1f],
    [0x2000, 0x206f], [0x20d0, 0x20ff], [0x2190, 0x2bff], [0x2d30, 0x2d7f], [0x3000, 0x30ff], [0xa4d0, 0xa4ff], [0xa960, 0xa97f], [0xd7b0, 0xd7ff],
    [0xfe00, 0xfe0f], [0xff00, 0xffef], [0x10c00, 0x10c4f], [0x16d40, 0x16d7f], [0x1f000, 0x1faff], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
  ];
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(rnd() * 10);
    const s: number[] = [];
    while (s.length < len) {
      const r = rnd();
      let c: number;
      if (r < 0.45) c = pick(SPECIAL);
      else if (r < 0.85) {
        const [lo, hi] = pick(BLOCKS);
        c = lo + Math.floor(rnd() * (hi - lo + 1));
      } else c = Math.floor(rnd() * 0x110000);
      if (isScalar(c)) s.push(c);
    }
    out.push(s);
  }
  return out;
}

function checkStrings(strs: number[][]): void {
  const want = probe(["strs"], strs.map((s) => s.map(hex).join(" ")).join("\n") + "\n").split("\n");
  expect(want.length).toBe(strs.length + 1);
  const bad: string[] = [];
  for (let i = 0; i < strs.length; i++) {
    const s = String.fromCodePoint(...strs[i]!);
    const got = `${UnicodeWidthStr.width(s)} ${UnicodeWidthStr.width_cjk(s)}`;
    if (got !== want[i] && bad.length < 10) bad.push(`${show(strs[i]!)}: width/width_cjk ${got}, oracle ${want[i]}`);
  }
  expect(bad).toEqual([]);
}

test.skipIf(SKIP)("str width/width_cjk match the oracle on ZWJ, RI, modifier, Hangul and lam-alef sequences", () => checkStrings(explicitStrings()), 120_000);

test.skipIf(SKIP)("str width/width_cjk match the oracle on 300,000 random mixed strings", () => checkStrings(randomStrings(300_000)), 120_000);
