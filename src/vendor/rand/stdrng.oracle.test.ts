// Oracle test for the vendored rand 0.10.1 / rand_core 0.10.1 / chacha20 0.10.0 (lane vendor-rand, plan-m6 D5).
//
// `stdrng.oracle.txt` is the output of the vendor-rand probe (docs/handoff/vendor-rand-probe/: rand =0.10.1 with
// default features, resolved through upstream's Cargo.lock to chacha20 0.10.0, built with the pinned toolchain's
// cargo for the host, i.e. the `neon` ChaCha backend on aarch64). This test recomputes every line with the port
// (the portable `soft` backend) and compares them byte for byte: StdRng `seed_from_u64` / `from_seed` /
// `from_rng` streams (`next_u32`, `next_u64`, interleavings, `fill_bytes` lengths across block edges) and the
// draws Miri makes (`random::<bool>()`, `random_range` over u64/usize/u32/i64/u128, `random_bool`,
// `random_ratio`, `random::<int>()`, slice `choose`, `IteratorRandom::choose` over exact, filtered, chained and
// scheduler-shaped iterators, Miri's `mkstemp` suffix). Every line ends with the next `u32` of the generator, so
// the number of words each draw consumed is checked too.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StdRng } from "./rngs/std.ts";
import { RngExt } from "./rng.ts";
import { Range, RangeInclusive } from "./distr/uniform.ts";
import { SampleUniform_i64, SampleUniform_u128, SampleUniform_u32, SampleUniform_u64, SampleUniform_usize } from "./distr/uniform_int.ts";
import {
  StandardUniform_i128,
  StandardUniform_i32,
  StandardUniform_i64,
  StandardUniform_i8,
  StandardUniform_u128,
  StandardUniform_u16,
  StandardUniform_u64,
  StandardUniform_u8,
} from "./distr/integer.ts";
import { StandardUniform_bool } from "./distr/other.ts";
import { choose } from "./seq/slice.ts";
import { IteratorRandom, iter_nth, type RustIterator } from "./seq/iterator.ts";
import { display_f64 } from "../../std/fmt.ts";

const ORACLE = readFileSync(join(import.meta.dir, "stdrng.oracle.txt"), "utf8").split("\n").filter((l) => l !== "");

// ---- core::iter adapters with core's exact size_hint / nth (test-only) ----

/** `core::ops::Range<usize>` as an iterator (`ExactSizeIterator`, O(1) `nth`). */
class RangeIter implements RustIterator<number> {
  constructor(
    public start: number,
    public end: number,
  ) {}
  next(): number | undefined {
    return this.start < this.end ? this.start++ : undefined;
  }
  size_hint(): [number, number | undefined] {
    const n = Math.max(this.end - this.start, 0);
    return [n, n];
  }
  nth(n: number): number | undefined {
    const plus_n = this.start + n;
    if (plus_n < this.end) {
      this.start = plus_n + 1;
      return plus_n;
    }
    this.start = this.end;
    return undefined;
  }
}

/** `core::slice::Iter` */
class SliceIter<T> implements RustIterator<T> {
  constructor(
    readonly s: readonly T[],
    public i: number = 0,
  ) {}
  next(): T | undefined {
    return this.i < this.s.length ? this.s[this.i++] : undefined;
  }
  size_hint(): [number, number | undefined] {
    const n = this.s.length - this.i;
    return [n, n];
  }
  nth(n: number): T | undefined {
    if (n >= this.s.length - this.i) {
      this.i = this.s.length;
      return undefined;
    }
    this.i += n;
    return this.s[this.i++];
  }
}

/** `core::iter::Filter`: `size_hint` is `(0, upper)`; default `nth`. */
class Filter<T> implements RustIterator<T> {
  constructor(
    readonly it: RustIterator<T>,
    readonly pred: (x: T) => boolean,
  ) {}
  next(): T | undefined {
    for (;;) {
      const x = this.it.next();
      if (x === undefined || this.pred(x)) return x;
    }
  }
  size_hint(): [number, number | undefined] {
    return [0, this.it.size_hint()[1]];
  }
}

/** `core::iter::Chain` (fuses `a` to `None` once exhausted). */
class Chain<T> implements RustIterator<T> {
  constructor(
    public a: RustIterator<T> | undefined,
    public b: RustIterator<T> | undefined,
  ) {}
  next(): T | undefined {
    if (this.a !== undefined) {
      const x = this.a.next();
      if (x !== undefined) return x;
      this.a = undefined;
    }
    return this.b?.next();
  }
  size_hint(): [number, number | undefined] {
    if (this.a !== undefined && this.b !== undefined) {
      const [al, ah] = this.a.size_hint();
      const [bl, bh] = this.b.size_hint();
      return [al + bl, ah !== undefined && bh !== undefined ? ah + bh : undefined];
    }
    if (this.a !== undefined) return this.a.size_hint();
    if (this.b !== undefined) return this.b.size_hint();
    return [0, 0];
  }
  nth(n: number): T | undefined {
    if (this.a !== undefined) {
      // `a.advance_by(n)` then `a.next()`
      let k = n;
      while (k > 0 && this.a.next() !== undefined) k--;
      if (k === 0) {
        const x = this.a.next();
        if (x !== undefined) return x;
        n = 0;
      } else {
        n = k;
      }
      this.a = undefined;
    }
    return this.b === undefined ? undefined : iter_nth(this.b, n);
  }
}

/** `core::iter::Skip` */
class Skip<T> implements RustIterator<T> {
  constructor(
    readonly it: RustIterator<T>,
    public n: number,
  ) {}
  next(): T | undefined {
    if (this.n > 0) {
      const n = this.n;
      this.n = 0;
      return iter_nth(this.it, n);
    }
    return this.it.next();
  }
  size_hint(): [number, number | undefined] {
    const [lo, hi] = this.it.size_hint();
    return [Math.max(lo - this.n, 0), hi === undefined ? undefined : Math.max(hi - this.n, 0)];
  }
}

/** `core::iter::Take` */
class Take<T> implements RustIterator<T> {
  constructor(
    readonly it: RustIterator<T>,
    public n: number,
  ) {}
  next(): T | undefined {
    if (this.n !== 0) {
      this.n--;
      return this.it.next();
    }
    return undefined;
  }
  size_hint(): [number, number | undefined] {
    if (this.n === 0) return [0, 0];
    const [lo, hi] = this.it.size_hint();
    return [Math.min(lo, this.n), hi === undefined ? this.n : Math.min(hi, this.n)];
  }
}

// ---- the probe, in TS ----

const hex = (b: Uint8Array) => "x" + Buffer.from(b).toString("hex");
/** The probe's FNV-1a 64. */
function fnv1a64(b: Uint8Array): bigint {
  let h = 0xcbf2_9ce4_8422_2325n;
  for (const x of b) {
    h ^= BigInt(x);
    h = (h * 0x0000_0100_0000_01b3n) & 0xffff_ffff_ffff_ffffn;
  }
  return h;
}
const opt = (o: number | string | undefined) => (o === undefined ? "-" : String(o));

function run(): string[] {
  const out: string[] = [];
  const line = (name: string, vals: Iterable<unknown>, r: StdRng) => {
    out.push(`${name}: ${[...vals].map(String).join(" ")} tail=${r.next_u32()}`);
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const SEEDS = [0n, 1n, 2n, 42n, 0xdead_beefn, 0xffff_ffff_ffff_ffffn];
  for (const seed of SEEDS) {
    let r = StdRng.seed_from_u64(seed);
    let v: unknown[] = range(200).map(() => r.next_u32());
    line(`u32 ${seed}`, v, r);

    r = StdRng.seed_from_u64(seed);
    v = range(100).map(() => r.next_u64());
    line(`u64 ${seed}`, v, r);

    r = StdRng.seed_from_u64(seed);
    v = [];
    for (let i = 0; i < 300; i++) v.push(i % 3 === 0 ? r.next_u32() : r.next_u64());
    line(`mixed ${seed}`, v, r);

    r = StdRng.seed_from_u64(seed);
    v = [];
    for (const len of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 63, 64, 65, 255, 256, 257, 1000]) {
      const buf = new Uint8Array(len);
      r.fill_bytes(buf);
      v.push(`${hex(buf)}/${r.next_u32()}`);
    }
    line(`fill ${seed}`, v, r);
  }

  // Every buffer offset: `k` words consumed, then fills / u64s that start on each index of the 64-word block.
  for (let k = 0; k < 130; k++) {
    const r = StdRng.seed_from_u64(3n);
    for (let i = 0; i < k; i++) r.next_u32();
    const v: string[] = [];
    for (const len of [1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 256, 257]) {
      const buf = new Uint8Array(len);
      r.fill_bytes(buf);
      v.push(len <= 9 ? hex(buf) : `fnv${fnv1a64(buf).toString(16).padStart(16, "0")}`);
    }
    const r2 = StdRng.seed_from_u64(3n);
    for (let i = 0; i < k; i++) r2.next_u32();
    v.push(`${r2.next_u64()}/${r2.next_u64()}/${r2.next_u32()}`);
    line(`offset ${k}`, v, r);
  }

  for (let k = 0; k < 4; k++) {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = (i * 37 + k * 101) & 0xff;
    const r = StdRng.from_seed(seed);
    line(`from_seed ${k}`, range(20).map(() => r.next_u64()), r);
    const child = StdRng.from_rng(r);
    line(`from_rng ${k}`, range(20).map(() => child.next_u64()), r);
  }

  for (const seed of [0n, 7n]) {
    const r = StdRng.seed_from_u64(seed);
    line(`bool ${seed}`, range(300).map(() => (RngExt.random(r, StandardUniform_bool) ? 1 : 0)), r);

    line(`u64range16 ${seed}`, range(200).map(() => RngExt.random_range(r, new Range(SampleUniform_u64, 0n, 16n))), r);

    line(`usize32 ${seed}`, range(200).map(() => RngExt.random_range(r, new Range(SampleUniform_usize, 0, 32))), r);

    for (const [lo, hi] of [
      [3, 10],
      [0, 1],
      [5, 6],
      [0, 1000],
      [7, 2 ** 20],
      [2 ** 20, 2 ** 33],
      [0, 2 ** 32 + 1],
    ] as const) {
      line(`usize ${lo}..${hi} ${seed}`, range(50).map(() => RngExt.random_range(r, new Range(SampleUniform_usize, lo, hi))), r);
    }

    for (const [lo, hi] of [
      [12, 24],
      [0, 0],
      [0, 0xffff_ffff],
      [1, 0xffff_ffff],
    ] as const) {
      line(`u32incl ${lo}..=${hi} ${seed}`, range(50).map(() => RngExt.random_range(r, new RangeInclusive(SampleUniform_u32, lo, hi))), r);
    }

    for (const m of [0n, 1n, 3n, 16n, 1000n, 0x7fff_ffff_ffff_ffffn]) {
      line(`i64incl ${m} ${seed}`, range(60).map(() => RngExt.random_range(r, new RangeInclusive(SampleUniform_i64, -m, m))), r);
    }
    line(`i64full ${seed}`, range(30).map(() => RngExt.random_range(r, new RangeInclusive(SampleUniform_i64, -(2n ** 63n), 2n ** 63n - 1n))), r);

    for (const p of [11n, 24n, 53n, 64n, 113n]) {
      line(`u128range ${p} ${seed}`, range(40).map(() => RngExt.random_range(r, new Range(SampleUniform_u128, 0n, 1n << p))), r);
    }

    for (const p of [0.0, 1e-9, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999, 1.0]) {
      line(`random_bool ${display_f64(p)} ${seed}`, range(100).map(() => (RngExt.random_bool(r, p) ? 1 : 0)), r);
    }

    for (const [n, d] of [
      [1, 3],
      [2, 7],
      [5, 5],
      [0, 4],
    ] as const) {
      line(`random_ratio ${n}/${d} ${seed}`, range(60).map(() => (RngExt.random_ratio(r, n, d) ? 1 : 0)), r);
    }

    line(
      `ints ${seed}`,
      range(10).map(() =>
        [
          RngExt.random(r, StandardUniform_u8),
          RngExt.random(r, StandardUniform_u16),
          RngExt.random(r, StandardUniform_i8),
          RngExt.random(r, StandardUniform_i32),
          RngExt.random(r, StandardUniform_i64),
          RngExt.random(r, StandardUniform_u128),
          RngExt.random(r, StandardUniform_i128),
          RngExt.random(r, StandardUniform_u64),
        ].join(","),
      ),
      r,
    );

    let w: string[] = [];
    for (let n = 0; n < 12; n++) {
      const xs = range(n);
      for (let i = 0; i < 5; i++) w.push(opt(choose(xs, r)));
    }
    line(`slice_choose ${seed}`, w, r);

    w = [];
    for (let n = 0; n < 10; n++) {
      for (let i = 0; i < 3; i++) w.push(opt(IteratorRandom.choose(new RangeIter(0, n), r)));
    }
    line(`iter_exact ${seed}`, w, r);

    w = [];
    for (let n = 0; n < 40; n++) {
      for (let i = 0; i < 3; i++) w.push(opt(IteratorRandom.choose(new Filter(new RangeIter(0, n), (x) => x % 3 !== 1), r)));
    }
    line(`iter_filter ${seed}`, w, r);

    w = [];
    for (const [n, m] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 5],
      [5, 9],
      [10, 1],
      [3, 30],
      [17, 17],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        const it = new Chain<number>(new RangeIter(0, n), new Filter(new RangeIter(100, 100 + m), (x) => x % 2 === 0));
        w.push(opt(IteratorRandom.choose(it, r)));
      }
    }
    line(`iter_chain ${seed}`, w, r);

    // The scheduler's shape: skip(k).chain(take(k)).filter(enabled).
    w = [];
    for (let len = 1; len < 9; len++) {
      const threads = range(len).map((i) => [i, i % 4 !== 2] as const);
      for (let k = 0; k < len; k++) {
        const it = new Filter(
          new Chain<readonly [number, boolean]>(new Skip(new SliceIter(threads), k + 1), new Take(new SliceIter(threads), k + 1)),
          ([, enabled]) => enabled,
        );
        w.push(opt(IteratorRandom.choose(it, r)?.[0]));
      }
    }
    line(`iter_sched ${seed}`, w, r);

    const SUBSTITUTIONS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
    line(`mkstemp ${seed}`, range(10).map(() => range(6).map(() => choose(SUBSTITUTIONS, r)!).join("")), r);
  }
  return out;
}

test("StdRng streams and Miri's draws match the oracle-built rand 0.10.1", () => {
  const got = run();
  expect(got.length).toBe(ORACLE.length);
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== ORACLE[i]) {
      // first difference only (keep the output short)
      expect(got[i]!.slice(0, 400)).toBe(ORACLE[i]!.slice(0, 400));
      expect(got[i]).toBe(ORACLE[i]!);
    }
  }
});
