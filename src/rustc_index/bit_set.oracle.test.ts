// rust-ts: the 32-bit-word bit sets (plan-m4 D6) against the oracle's u64-word ones. bit_set_oracle.json is the output
// of `bitsetprobe` (src/rustc_index/bit_set_probe/main.rs, a rustc-dev probe built against the pinned nightly): for a
// battery of deterministic sets, what the pinned rustc_index computes where the words are observable (`StableHash` as
// `Hash128`, `Hash` through `FxHasher`, `DenseBitSet::to_string`, the opaque encoding of `DenseBitSet<u32>`, the
// derived `Debug` of `GrowableBitSet`), plus element-level `Debug` of the other sets (null for large sets). Every
// value is rebuilt from its inputs and compared. A second test checks the hash call sequence against a u64-word model.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hash128 } from "../rustc_hashes/lib.ts";
import type { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import {
  type RawDefId,
  type RawSpan,
  type StableHashControls,
  type StableHashCtxt,
  StableHasher,
  stable_hash_BitMatrix,
  stable_hash_DenseBitSet,
} from "../rustc_data_structures/stable_hash.ts";
import { MAGIC_END_BYTES, MemDecoder } from "../rustc_serialize/opaque.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { FxHasher } from "../vendor/rustc_hash/lib.ts";
import type { Hasher } from "../vendor/rustc_stable_hash/stable_hasher.ts";
import {
  BitMatrix,
  ChunkedBitSet,
  DenseBitSet,
  DenseBitSet_eq,
  debug_BitMatrix,
  debug_ChunkedBitSet,
  debug_DenseBitSet,
  debug_GrowableBitSet,
  debug_SparseBitMatrix,
  GrowableBitSet,
  hash_BitMatrix,
  hash_DenseBitSet,
  MixedBitSet,
  SparseBitMatrix,
} from "./bit_set.ts";
import { decode_DenseBitSet } from "./decodable.gen.ts";
import { range_inclusive } from "./idx.ts";
import { debug_IntervalSet, IntervalSet } from "./interval.ts";

interface Oracle {
  dense: { domain: number; elems: number[]; stable: string; fx: string; to_string: string; debug: string | null; encoded: string }[];
  matrix: { rows: number; cols: number; cells: [number, number][]; stable: string; fx: string; debug: string | null }[];
  growable: { elems: number[]; debug: string; count: number }[];
  mixed: { domain: number; elems: number[]; count: number; chunked: string | null; mixed: string | null; mixed_alt: string | null }[];
  interval: { domain: number; ranges: [number, number][]; debug: string }[];
  sparse: { cols: number; cells: [number, number][]; debug: string; debug_alt: string }[];
}

const oracle: Oracle = JSON.parse(readFileSync(join(import.meta.dir, "bit_set_oracle.json"), "utf8"));

const NO_HCX: StableHashCtxt = {
  stable_hash_span(_: RawSpan, __: StableHasher): void {
    panic("span");
  },
  def_path_hash(_: RawDefId): Fingerprint {
    panic("def_path_hash");
  },
  stable_hash_controls(): StableHashControls {
    panic("controls");
  },
  assert_default_stable_hash_controls(_: string): void {
    panic("assert");
  },
};

function hex_bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2 + MAGIC_END_BYTES.length);
  for (let i = 0; i < s.length / 2; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  out.set(MAGIC_END_BYTES, s.length / 2);
  return out;
}

function dense(domain: number, elems: number[]): DenseBitSet<number> {
  const s = DenseBitSet.new_empty<number>(domain);
  for (const e of elems) s.insert(e);
  return s;
}

test("DenseBitSet: StableHash, FxHasher, to_string, Debug, Decodable as over u64 words", () => {
  expect(oracle.dense.length).toBeGreaterThan(90);
  for (const c of oracle.dense) {
    const s = dense(c.domain, c.elems);
    const sh = StableHasher.new();
    stable_hash_DenseBitSet(s, NO_HCX, sh);
    const fx = FxHasher.default();
    hash_DenseBitSet(s, fx);
    const got = { stable: String(sh.finish(Hash128)), fx: String(fx.finish_u64()), to_string: s.to_string(), debug: c.debug === null ? null : debug_DenseBitSet(s, PLAIN) };
    expect({ domain: c.domain, ...got }).toEqual({ domain: c.domain, stable: c.stable, fx: c.fx, to_string: c.to_string, debug: c.debug });

    const d = MemDecoder.new(hex_bytes(c.encoded), 0);
    if (d.$ !== "Ok") throw new Error("MemDecoder::new");
    const decoded = decode_DenseBitSet(d._0);
    expect(decoded.domain_size()).toBe(c.domain);
    expect([...decoded.iter()]).toEqual(c.elems);
    expect(DenseBitSet_eq(decoded, s)).toBe(true);
  }
});

test("BitMatrix: StableHash, FxHasher, Debug as over u64 words", () => {
  for (const c of oracle.matrix) {
    const m = BitMatrix.new<number, number>(c.rows, c.cols);
    for (const [r, col] of c.cells) m.insert(r, col);
    const sh = StableHasher.new();
    stable_hash_BitMatrix(m, NO_HCX, sh);
    const fx = FxHasher.default();
    hash_BitMatrix(m, fx);
    expect({ rows: c.rows, cols: c.cols, stable: String(sh.finish(Hash128)), fx: String(fx.finish_u64()), debug: c.debug === null ? null : debug_BitMatrix(m, PLAIN) }).toEqual({
      rows: c.rows,
      cols: c.cols,
      stable: c.stable,
      fx: c.fx,
      debug: c.debug,
    });
  }
});

test("GrowableBitSet: derived Debug prints u64 words", () => {
  for (const c of oracle.growable) {
    const g = GrowableBitSet.new_empty<number>();
    for (const e of c.elems) g.insert(e);
    expect(debug_GrowableBitSet(g, PLAIN, "u32")).toBe(c.debug);
    expect(g.count()).toBe(c.count);
  }
});

test("ChunkedBitSet / MixedBitSet: count and Debug", () => {
  for (const c of oracle.mixed) {
    const ch = ChunkedBitSet.new_empty<number>(c.domain);
    const mx = MixedBitSet.new_empty<number>(c.domain);
    for (const e of c.elems) {
      ch.insert(e);
      MixedBitSet.insert(mx, e);
    }
    ch.assert_valid();
    expect(ch.count()).toBe(c.count);
    expect([...ch.iter()]).toEqual(c.elems);
    expect([...MixedBitSet.iter(mx)]).toEqual(c.elems);
    if (c.chunked !== null) expect(debug_ChunkedBitSet(ch, PLAIN)).toBe(c.chunked);
    if (c.mixed !== null) expect(MixedBitSet.fmt(mx, PLAIN)).toBe(c.mixed);
    if (c.mixed_alt !== null) expect(MixedBitSet.fmt(mx, PRETTY)).toBe(c.mixed_alt);
  }
});

test("IntervalSet: derived Debug", () => {
  for (const c of oracle.interval) {
    const s = IntervalSet.new<number>(c.domain);
    for (const [a, b] of c.ranges) s.insert_range(range_inclusive(a, b));
    expect(debug_IntervalSet(s, PLAIN, "u32")).toBe(c.debug);
  }
});

test("SparseBitMatrix: derived Debug", () => {
  for (const c of oracle.sparse) {
    const m = SparseBitMatrix.new<number, number>(c.cols);
    for (const [r, col] of c.cells) m.insert(r, col);
    expect(debug_SparseBitMatrix(m, PLAIN)).toBe(c.debug);
    expect(debug_SparseBitMatrix(m, PRETTY)).toBe(c.debug_alt);
  }
});

/** A `Hasher` that records its calls. */
function recorder(): Hasher & { calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string) => (v: unknown) => {
    calls.push(`${name}(${v instanceof Uint8Array ? Array.from(v).join(" ") : String(v)})`);
  };
  return {
    calls,
    finish_u64: () => 0n,
    write: rec("write"),
    write_u8: rec("write_u8"),
    write_u16: rec("write_u16"),
    write_u32: rec("write_u32"),
    write_u64: rec("write_u64"),
    write_u128: rec("write_u128"),
    write_usize: rec("write_usize"),
    write_i8: rec("write_i8"),
    write_i16: rec("write_i16"),
    write_i32: rec("write_i32"),
    write_i64: rec("write_i64"),
    write_i128: rec("write_i128"),
    write_isize: rec("write_isize"),
    write_length_prefix: rec("write_length_prefix"),
    write_str: rec("write_str"),
  };
}

/** Upstream's u64 words of a set of elements, computed independently with bigints. */
function u64_words(domain: number, elems: number[]): bigint[] {
  const words = new Array<bigint>(Math.ceil(domain / 64)).fill(0n);
  for (const e of elems) words[Math.floor(e / 64)]! |= 1n << BigInt(e % 64);
  return words;
}

/** `[u64]::hash`: length prefix, then the little-endian bytes of every word in one `write`. */
function model_hash_u64_slice(words: bigint[], h: Hasher): void {
  h.write_length_prefix(words.length);
  const bytes = new Uint8Array(words.length * 8);
  words.forEach((w, k) => {
    for (let b = 0; b < 8; b++) bytes[8 * k + b] = Number((w >> BigInt(8 * b)) & 0xffn);
  });
  h.write(bytes);
}

test("D6 hash equivalence: DenseBitSet / BitMatrix hash exactly as upstream's u64-word derive(Hash)", () => {
  for (const domain of [0, 1, 31, 32, 33, 63, 64, 65, 96, 97, 128, 129, 191, 1000]) {
    const elems = Array.from({ length: domain }, (_, i) => i).filter((i) => (i * 7 + 3) % 5 < 2 || i === domain - 1);
    const got = recorder();
    hash_DenseBitSet(dense(domain, elems), got);
    const want = recorder();
    want.write_usize(domain);
    model_hash_u64_slice(u64_words(domain, elems), want);
    expect(got.calls).toEqual(want.calls);
  }
  for (const [rows, cols] of [
    [0, 0],
    [3, 1],
    [3, 20],
    [2, 32],
    [3, 33],
    [2, 64],
    [4, 65],
    [2, 97],
  ] as [number, number][]) {
    const m = BitMatrix.new<number, number>(rows, cols);
    const per_row: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const cs = Array.from({ length: cols }, (_, i) => i).filter((i) => (i + r) % 3 === 0 || i === cols - 1);
      for (const c of cs) m.insert(r, c);
      per_row.push(cs);
    }
    const got = recorder();
    hash_BitMatrix(m, got);
    const want = recorder();
    want.write_usize(rows);
    want.write_usize(cols);
    model_hash_u64_slice(
      per_row.flatMap((cs) => u64_words(cols, cs)),
      want,
    );
    expect(got.calls).toEqual(want.calls);
  }
});
