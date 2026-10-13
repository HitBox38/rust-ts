// Scripts for the `fxorder` probe (tools/probes/fxorder/main.rs documents the format) and their
// replay through src/rust_ts/hash_map.ts's `FxHashMap` / `FxHashSet` (lane hashbrown-order).
//
//   bun src/rust_ts/hash_map_oracle/scripts.ts gen <seed> <count>      print <count> random scripts
//   bun src/rust_ts/hash_map_oracle/scripts.ts fixture <seed> <count>  the probe's answers to them,
//                                                                     as fx_order.txt (see below)
//
// fx_order.txt (committed) holds the probe's answers to `gen(FIXTURE_SEED, FIXTURE_COUNT)`: after
// `#` header lines, one line per script, the first 16 hex digits of the SHA-256 of the answer line
// (the scripts themselves are ~15 MB, so they are regenerated: the generator is deterministic and
// must not change without regenerating the fixture with the probe built
// (`bun scripts/probes.ts build fxorder`):
//   bun src/rust_ts/hash_map_oracle/scripts.ts fixture 1 6000 > src/rust_ts/hash_map_oracle/fx_order.txt
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { FxHashMap, FxHashSet, type KeyType, LAYOUT_USIZE, String_key, u32_key, u8_key } from "../hash_map.ts";

export const PROBE = join(DATA, "target", "probes", "release", "fxorder" + (process.platform === "win32" ? ".exe" : ""));

/** Deterministic PRNG (mulberry32). */
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

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (s: string): string => (s === "" ? "_" : [...enc.encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(""));
const unhex = (t: string): string => (t === "_" ? "" : dec.decode(new Uint8Array(t.match(/../g)!.map((h) => parseInt(h, 16)))));
const bytesum = (s: string): number => enc.encode(s).reduce((a, b) => a + b, 0);

const KINDS = ["u32", "str", "sym", "su32", "su8", "ssym"] as const;
type Kind = (typeof KINDS)[number];

// Symbols the oracle pre-interns (keywords and `sym::` names) mixed with fresh ones.
const PREDEFINED = ["fn", "self", "Self", "u8", "u32", "values", "hide", "show", "doc", "cfg", "test", "unix", "windows", "feature", "x", "y", "a", "b", "_", "crate", "super", "main", "std", "core"];
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.é✓日𝔘";

/** One random script `<kind> <op> ...`. */
function script(r: () => number): string {
  const kind = KINDS[Math.floor(r() * KINDS.length)]!;
  const int = (n: number) => Math.floor(r() * n);
  // Key universe of this script.
  const mode = int(4);
  const key = (): string => {
    switch (kind) {
      case "u32":
      case "su32":
        switch (mode) {
          case 0:
            return String(int(64));
          case 1:
            return String(int(4096));
          case 2:
            return String((int(512) * 0x10000) >>> 0); // equal low bits
          default:
            return String(Math.floor(r() * 4294967296));
        }
      case "su8":
        return String(int(256));
      case "str":
      case "sym": {
        if (kind === "sym" && r() < 0.3) return hex(PREDEFINED[int(PREDEFINED.length)]!);
        const len = mode === 0 ? int(3) : mode === 1 ? int(9) : mode === 2 ? 8 + int(10) : int(40);
        let s = "";
        const alpha = mode === 0 ? 4 : CHARS.length;
        for (let i = 0; i < len; i++) s += [...CHARS][int(alpha)];
        return hex(s);
      }
      case "ssym":
        return hex(r() < 0.3 ? PREDEFINED[int(PREDEFINED.length)]! : "s" + int(mode === 0 ? 40 : 3000));
    }
  };
  const live: string[] = [];
  const ops: string[] = [];
  if (r() < 0.2) {
    // Churn at a steady size: tombstones pile up until `reserve_rehash` rehashes in place.
    const present = new Set<string>();
    if (r() < 0.75) {
      // Fill to a full capacity, drain most of it (dense groups leave DELETED tombstones), then
      // refill: `growth_left` runs out with few items, so the table is rehashed in place.
      const caps = kind === "su8" ? [7, 14, 28, 56, 112] : [3, 7, 14, 28, 56, 112, 224, 448];
      const cap = caps[int(caps.length)]!;
      while (present.size < cap && ops.length < 8 * cap) {
        const k = key();
        ops.push("+" + k);
        present.add(k);
      }
      const keep = Math.floor(present.size * 0.4 * r());
      const order = [...present];
      for (let i = order.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      for (const k of order.slice(keep)) {
        ops.push("-" + k);
        present.delete(k);
      }
      if (r() < 0.3) ops.push("p");
      for (let i = 0, m = cap + int(cap * 2); i < m; i++) ops.push("+" + key());
      return [kind, ...ops].join(" ");
    }
    const fill = 4 + int(kind === "su8" ? 60 : 120);
    while (present.size < fill && ops.length < 4 * fill) {
      const k = key();
      ops.push("+" + k);
      present.add(k);
    }
    const cycles = 20 + int(250);
    for (let i = 0; i < cycles; i++) {
      const arr = [...present];
      const k = arr[int(arr.length)]!;
      ops.push("-" + k);
      present.delete(k);
      const k2 = key();
      ops.push("+" + k2);
      present.add(k2);
      if (r() < 0.02) ops.push("p");
    }
    return [kind, ...ops].join(" ");
  }
  const long = r() < 0.05;
  const n = long ? 200 + int(900) : 1 + int(60);
  const pIns = 0.45 + r() * 0.5;
  if (r() < 0.15) ops.push("W" + int(long ? 600 : 40));
  if (r() < 0.1) {
    const ks = Array.from({ length: int(30) }, key);
    ops.push("F" + ks.join(","));
    live.push(...ks);
  }
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < pIns) {
      const k = key();
      ops.push("+" + k);
      live.push(k);
    } else if (x < 0.93) {
      const k = live.length > 0 && r() < 0.85 ? live[int(live.length)]! : key();
      ops.push("-" + k);
    } else {
      const y = int(11);
      switch (y) {
        case 0:
          ops.push("r" + int(long ? 400 : 20));
          break;
        case 1:
          ops.push("s" + int(long ? 400 : 20));
          break;
        case 2:
          ops.push("S");
          break;
        case 3:
          if (r() < 0.2) ops.push("x");
          else ops.push("p");
          break;
        case 4:
          ops.push("C");
          break;
        case 5:
          ops.push("R" + (2 + int(5)));
          break;
        case 6:
        case 7: {
          const ks = Array.from({ length: int(long ? 200 : 20) }, key);
          ops.push((y === 6 ? "E" : "e") + ks.join(","));
          live.push(...ks);
          break;
        }
        case 8: {
          const ks = Array.from({ length: int(long ? 300 : 25) }, key);
          ops.push("F" + ks.join(","));
          live.push(...ks);
          break;
        }
        default:
          ops.push("p");
      }
    }
  }
  return [kind, ...ops].join(" ");
}

export function gen(seed: number, count: number): string[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => script(r));
}

interface Ops<K> {
  parse(tok: string): K;
  token(k: K): string;
  keynum(k: K): number;
  key: KeyType<K>;
}

const U32: Ops<number> = { parse: (t) => Number(t), token: String, keynum: (k) => k, key: u32_key };
const U8: Ops<number> = { parse: (t) => Number(t), token: String, keynum: (k) => k, key: u8_key };
const STR: Ops<string> = { parse: unhex, token: hex, keynum: bytesum, key: String_key };
const SYM: Ops<Symbol> = {
  parse: (t) => Symbol.intern(unhex(t)),
  token: (k) => hex(Symbol.as_str(k)),
  keynum: (k) => bytesum(Symbol.as_str(k)),
  key: u32_key,
};

const list = <K>(o: Ops<K>, s: string): K[] => (s === "" ? [] : s.split(",").map(o.parse));
const state = <K>(cap: number, ks: Iterable<K>, o: Ops<K>): string => `${cap}:${[...ks].map(o.token).join(",")}`;

function run_map<K>(o: Ops<K>, ops: string[]): string {
  let m = FxHashMap.default<K, number>(o.key, LAYOUT_USIZE);
  const out: string[] = [];
  ops.forEach((op, i) => {
    const c = op[0]!;
    const rest = op.slice(1);
    switch (c) {
      case "+":
        m.set(o.parse(rest), i);
        break;
      case "-":
        m.delete(o.parse(rest));
        break;
      case "r":
        m.reserve(Number(rest));
        break;
      case "s":
        m.shrink_to(Number(rest));
        break;
      case "S":
        m.shrink_to_fit();
        break;
      case "x":
        m.clear();
        break;
      case "C":
        m = m.clone();
        break;
      case "R": {
        const n = Number(rest);
        m.retain((k) => o.keynum(k) % n !== 0);
        break;
      }
      case "E": {
        const ks = list(o, rest);
        m.extend(ks.map((k) => [k, i] as const), ks.length);
        break;
      }
      case "e":
        m.extend(list(o, rest).map((k) => [k, i] as const), 0);
        break;
      case "F": {
        const ks = list(o, rest);
        m = FxHashMap.from_iter(ks.map((k) => [k, i] as const), ks.length, o.key, LAYOUT_USIZE);
        break;
      }
      case "W":
        m = FxHashMap.with_capacity<K, number>(Number(rest), o.key, LAYOUT_USIZE);
        break;
      case "p":
        out.push(state(m.capacity(), m.keys(), o));
        break;
      default:
        throw new Error(`bad op ${op}`);
    }
  });
  out.push(state(m.capacity(), m.keys(), o));
  return out.join(" | ");
}

function run_set<K>(o: Ops<K>, ops: string[]): string {
  let m = FxHashSet.default<K>(o.key);
  const out: string[] = [];
  for (const op of ops) {
    const c = op[0]!;
    const rest = op.slice(1);
    switch (c) {
      case "+":
        m.add(o.parse(rest));
        break;
      case "-":
        m.delete(o.parse(rest));
        break;
      case "r":
        m.reserve(Number(rest));
        break;
      case "s":
        m.shrink_to(Number(rest));
        break;
      case "S":
        m.shrink_to_fit();
        break;
      case "x":
        m.clear();
        break;
      case "C":
        m = m.clone();
        break;
      case "R": {
        const n = Number(rest);
        m.retain((k) => o.keynum(k) % n !== 0);
        break;
      }
      case "E": {
        const ks = list(o, rest);
        m.extend(ks, ks.length);
        break;
      }
      case "e":
        m.extend(list(o, rest), 0);
        break;
      case "F": {
        const ks = list(o, rest);
        m = FxHashSet.from_iter(ks, ks.length, o.key);
        break;
      }
      case "W":
        m = FxHashSet.with_capacity<K>(Number(rest), o.key);
        break;
      case "p":
        out.push(state(m.capacity(), m, o));
        break;
      default:
        throw new Error(`bad op ${op}`);
    }
  }
  out.push(state(m.capacity(), m, o));
  return out.join(" | ");
}

/** The port's answers for `scripts`, in one session (symbols interned in script order, like the probe). */
export function replay(scripts: readonly string[]): string[] {
  return create_default_session_globals_then(() =>
    scripts.map((line) => {
      const [kind, ...ops] = line.split(" ").filter((t, i) => i === 0 || t !== "") as [Kind, ...string[]];
      switch (kind) {
        case "u32":
          return run_map(U32, ops);
        case "str":
          return run_map(STR, ops);
        case "sym":
          return run_map(SYM, ops);
        case "su32":
          return run_set(U32, ops);
        case "su8":
          return run_set(U8, ops);
        case "ssym":
          return run_set(SYM, ops);
      }
    }),
  );
}

export const FIXTURE_SEED = 1;
export const FIXTURE_COUNT = 6000;

/** First 16 hex digits of the SHA-256 of an answer line. */
export function digest(answer: string): string {
  return createHash("sha256").update(answer).digest("hex").slice(0, 16);
}

/** The probe's answers for `scripts`. */
export function probe(scripts: readonly string[]): string[] {
  if (!existsSync(PROBE)) throw new Error(`ERROR: fxorder probe not built (${PROBE}); run: bun scripts/probes.ts build fxorder`);
  const r = Bun.spawnSync([PROBE], { stdin: Buffer.from(scripts.map((s) => s + "\n").join("")), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: fxorder failed: ${r.stderr.toString().trim().split("\n")[0]}`);
  const lines = r.stdout.toString().split("\n");
  lines.pop();
  return lines;
}

if (import.meta.main) {
  const [cmd, seed, count] = process.argv.slice(2);
  const scripts = gen(Number(seed), Number(count));
  if (cmd === "gen") {
    process.stdout.write(scripts.map((s) => s + "\n").join(""));
  } else if (cmd === "fixture") {
    const answers = probe(scripts);
    if (answers.length !== scripts.length) throw new Error("ERROR: fxorder answered a different number of scripts");
    process.stdout.write(`# fxorder answers (SHA-256 prefixes) to scripts.ts gen(${seed}, ${count}); see scripts.ts\n`);
    process.stdout.write(answers.map((a) => digest(a) + "\n").join(""));
  } else {
    console.log("ERROR: usage: scripts.ts gen|fixture <seed> <count>");
    process.exit(2);
  }
}
