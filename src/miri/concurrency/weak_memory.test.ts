// Unit tests of the weak-memory store buffers (lane miri-sb) on small hand-built scenarios: which store elements a load
// may read (CoWR, CoRR, SC fences, SC loads and the SC-marked filter), the recency report, `load_impl`'s first-load
// timestamps, `store_impl`'s SC marking and the 128-element bound. Upstream weak_memory.rs has no `#[cfg(test)]` tests
// (its behaviour is tested by Miri's tests/pass/weak_memory, a later suite).
//
// The vector-clock accessors are lane miri-race's (vector_clock.rs, not yet ported): while they are missing (or still
// `unported` placeholders) this file installs their upstream bodies for the duration of the tests and restores the
// prototypes afterwards.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { ThreadClockSet } from "./data_race.ts";
import { VClock, VTimestamp, VectorIdx } from "./vector_clock.ts";
import { clone_StoreElement, type LoadRecency, StoreBuffer, type StoreElement } from "./weak_memory.ts";
import { type Scalar } from "../lib.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { StdRng } from "../../vendor/rand/rngs/std.ts";

// ---- miri-race's accessors (vector_clock.rs:20 / :83 / :88 / :159), installed only while missing ----
const saved: [object, string, PropertyDescriptor | undefined][] = [];
function ensure(target: object, name: string, impl: unknown): void {
  const cur = (target as Record<string, unknown>)[name];
  if (typeof cur === "function" && !String(cur).includes("unported(")) return;
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { value: impl, writable: true, configurable: true });
}
beforeAll(() => {
  ensure(VectorIdx.prototype, "to_u32", function (this: VectorIdx) {
    return this._0;
  });
  ensure(VTimestamp, "new", (time: number, read_type: "Read" | "Retag", span: Span) => new VTimestamp((read_type === "Read" ? 0 : 1) | (time * 2), span));
  ensure(VTimestamp.prototype, "time", function (this: VTimestamp) {
    return this.time_and_read_type >>> 1;
  });
  ensure(VClock.prototype, "as_slice", function (this: VClock) {
    return this._0;
  });
});
afterAll(() => {
  for (const [target, name, desc] of saved.reverse()) {
    if (desc === undefined) delete (target as Record<string, unknown>)[name];
    else Object.defineProperty(target, name, desc);
  }
});

const SP = 0 as Span;
const ts = (t: number) => VTimestamp.new(t, "Read", SP);
/** A clock from per-thread times (trailing zeros trimmed, VClock's invariant). */
function clock(...times: number[]): VClock {
  while (times.length > 0 && times[times.length - 1] === 0) times.pop();
  return new VClock(times.map(ts));
}
function clocks(c: VClock, opts: { write_seqcst?: VClock; read_seqcst?: VClock } = {}): ThreadClockSet {
  return new ThreadClockSet(c, clock(), clock(), opts.write_seqcst ?? clock(), opts.read_seqcst ?? clock());
}
const S = (n: number): Scalar => ({ $: "Int", _0: ScalarInt.from_u32(n) }) as unknown as Scalar;
const val = (e: StoreElement) => (e.val === undefined ? "uninit" : String((e.val as unknown as { _0: ScalarInt })._0.to_bits_unchecked()));

/** A buffer [init=0, then thread `t` stores `v` at its time `time` for each entry]. */
function buffer(stores: [thread: number, time: number, v: number, sc?: boolean][]): StoreBuffer {
  const b = StoreBuffer.new(S(0));
  for (const [t, time, v, sc] of stores) {
    b.store_impl(S(v), new VectorIdx(t), clock(...Array.from({ length: t + 1 }, (_, i) => (i === t ? time : 0))), sc ?? false, clock());
  }
  return b;
}

/** The set of values `fetch_store` can return (many draws) and whether "Latest" is reported exactly for the last store. */
function readable(b: StoreBuffer, cs: ThreadClockSet, is_seqcst: boolean): string[] {
  const rng = StdRng.seed_from_u64(42n);
  const seen = new Set<string>();
  const last = b.buffer[b.buffer.length - 1]!;
  for (let i = 0; i < 300; i++) {
    const [e, rec]: [StoreElement, LoadRecency] = b.fetch_store(is_seqcst, cs, rng);
    expect(rec).toBe(e === last ? "Latest" : "Outdated");
    seen.add(val(e));
  }
  return [...seen].sort();
}

test("StoreBuffer::new holds the initial value as a store of thread 0 at time 0", () => {
  const b = StoreBuffer.new(S(5));
  expect(b.buffer.length).toBe(1);
  expect(val(b.buffer[0]!)).toBe("5");
  expect(b.buffer[0]!.store_thread._0).toBe(0);
  expect(b.buffer[0]!.store_timestamp.time()).toBe(0);
  expect(StoreBuffer.new(undefined).buffer[0]!.val).toBeUndefined();
});

test("CoWR: a load cannot read before a store that happens-before it", () => {
  const b = buffer([
    [1, 1, 10],
    [1, 2, 20],
  ]);
  // Thread 2 knows nothing of thread 1: every store (back to the init store, which thread 0 did at time 0) is readable.
  expect(readable(b, clocks(clock()), false)).toEqual(["0", "10", "20"]);
  // Knows thread 1 up to time 1: the store at time 1 and later.
  expect(readable(b, clocks(clock(0, 1)), false)).toEqual(["10", "20"]);
  // Knows time 2: only the latest.
  expect(readable(b, clocks(clock(0, 2)), false)).toEqual(["20"]);
});

test("a cloned store element finds its load timestamps by `VectorIdx` value (LoadInfo.timestamps is keyed by value)", () => {
  const b = buffer([[1, 1, 10]]);
  const e = b.buffer[1]!;
  e.load_impl(new VectorIdx(2), clocks(clock(0, 0, 3)), false);
  const c = clone_StoreElement(e);
  expect(c.load_info.timestamps.get(new VectorIdx(2))?.time()).toBe(3);
  expect(c.load_info.timestamps.has(new VectorIdx(1))).toBe(false);
  // A later load by the same thread keeps the first timestamp and adds no second entry.
  c.load_impl(new VectorIdx(2), clocks(clock(0, 0, 4)), false);
  expect(c.load_info.timestamps.size).toBe(1);
  expect(c.load_info.timestamps.get(new VectorIdx(2))?.time()).toBe(3);
  // The clone does not share the original's map.
  c.load_impl(new VectorIdx(1), clocks(clock(0, 5)), false);
  expect(e.load_info.timestamps.size).toBe(1);
  expect(c.load_info.timestamps.size).toBe(2);
});

test("CoRR: a load cannot read before a store an earlier (happens-before) load has read", () => {
  const b = buffer([
    [1, 1, 10],
    [1, 2, 20],
  ]);
  // Thread 2 at time 3 reads the store `10`.
  const e10 = b.buffer[1]!;
  expect(val(e10)).toBe("10");
  e10.load_impl(new VectorIdx(2), clocks(clock(0, 0, 3)), false);
  expect(e10.load_info.timestamps.get(new VectorIdx(2))!.time()).toBe(3);
  // A load that knows thread 2's time 3 can no longer read `0`.
  expect(readable(b, clocks(clock(0, 0, 3)), false)).toEqual(["10", "20"]);
  // One that does not know it still can.
  expect(readable(b, clocks(clock(0, 0, 2)), false)).toEqual(["0", "10", "20"]);
  // `load_impl` keeps the first timestamp per thread (`try_insert`).
  e10.load_impl(new VectorIdx(2), clocks(clock(0, 0, 9)), true);
  expect(e10.load_info.timestamps.get(new VectorIdx(2))!.time()).toBe(3);
  expect(e10.load_info.timestamps.size).toBe(1);
  expect(e10.load_info.sc_loaded).toBe(true);
});

test("SC: fences, SC loads, and the last-SC-store filter", () => {
  const b = buffer([
    [1, 1, 10, true],
    [1, 2, 20, true],
    [1, 3, 30],
  ]);
  // The SC stores also marked the stores that happen-before them SC (the init store too).
  expect(b.buffer.map((e) => e.is_seqcst)).toEqual([true, true, true, false]);
  // An SC load ignores all but the last SC-marked store: `10` and the init store are filtered out.
  expect(readable(b, clocks(clock()), true)).toEqual(["20", "30"]);
  // A non-SC load after an SC fence that saw thread 1's SC store at time 2 cannot read before it.
  expect(readable(b, clocks(clock(), { write_seqcst: clock(0, 2) }), false)).toEqual(["20", "30"]);
  // An SC load after an SC fence (read_seqcst) cannot read before the last store sequenced before it.
  expect(readable(b, clocks(clock(), { read_seqcst: clock(0, 3) }), true)).toEqual(["30"]);
  // An SC load cannot read before a store an earlier SC load has observed.
  // (The search is an inclusive take-while: the observed store itself stays readable.)
  b.buffer[2]!.load_impl(new VectorIdx(2), clocks(clock(0, 0, 1)), true);
  expect(val(b.buffer[2]!)).toBe("20");
  expect(readable(b, clocks(clock()), true)).toEqual(["20", "30"]);
  b.buffer[3]!.load_impl(new VectorIdx(2), clocks(clock(0, 0, 2)), true);
  expect(readable(b, clocks(clock()), true)).toEqual(["30"]);
  expect(readable(b, clocks(clock()), false)).toEqual(["0", "10", "20", "30"]);
});

test("store_impl: SC marking of happens-before and coherence-before stores", () => {
  const b = buffer([
    [1, 1, 10],
    [2, 1, 20],
  ]);
  // Thread 2 read `10` at its time 1; thread 3 then does an SC store knowing thread 2's time 1 but not thread 1.
  b.buffer[1]!.load_impl(new VectorIdx(2), clocks(clock(0, 0, 1)), false);
  b.store_impl(S(30), new VectorIdx(3), clock(0, 0, 1, 5), true, clock());
  expect(b.buffer.map((e) => e.is_seqcst)).toEqual([
    true, // init: thread 0 at time 0 happens-before everything
    true, // `10`: a load of it happens-before the SC store
    true, // `20`: thread 2's store at time 1 happens-before
    true, // the SC store itself
  ]);
  const b2 = buffer([[1, 4, 10]]);
  b2.store_impl(S(30), new VectorIdx(3), clock(0, 0, 0, 5), true, clock());
  expect(b2.buffer.map((e) => e.is_seqcst)).toEqual([true, false, true]);
  expect(b2.buffer[2]!.store_timestamp.time()).toBe(5);
});

test("the store buffer keeps at most 128 elements (oldest dropped)", () => {
  const b = StoreBuffer.new(S(0));
  for (let i = 1; i <= 200; i++) b.store_impl(S(i), new VectorIdx(1), clock(0, i), false, clock());
  expect(b.buffer.length).toBe(128);
  expect(val(b.buffer[0]!)).toBe("73");
  expect(val(b.buffer[127]!)).toBe("200");
});

test("fetch_store draws are deterministic for a seed", () => {
  const b = buffer([
    [1, 1, 10],
    [1, 2, 20],
    [1, 3, 30],
  ]);
  const draw = () => {
    const rng = StdRng.seed_from_u64(7n);
    return Array.from({ length: 20 }, () => val(b.fetch_store(false, clocks(clock()), rng)[0])).join(",");
  };
  expect(draw()).toBe(draw());
});

// Regression (lane miri-thread-exit): `VTimestamp` is `Copy`. A store element's `store_timestamp` and a load's
// `load_info` entry are copies of the thread's clock slot at the time of the access; they must not move when the thread's
// clock is later incremented in place. With the slot aliased, a joiner's clock no longer covered the joined thread's last
// `Arc` decrement and std's `JoinInner::join` panicked ("threads should not terminate unexpectedly").
test("store_impl / load_impl keep a copy of the thread's timestamp, not its live clock slot", () => {
  const b = StoreBuffer.new(S(2));
  const t1 = new VectorIdx(1);
  const c1 = clock(0, 16);
  b.store_impl(S(1), t1, c1, false, clock());
  const store = b.buffer[1]!;
  store.load_impl(t1, clocks(c1), false);
  c1.increment_index(t1, SP);
  c1.increment_index(t1, SP);
  expect(store.store_timestamp.time()).toBe(16);
  expect(store.load_info.timestamps.get(t1)!.time()).toBe(16);
  // A load that knows thread 1 up to time 17 (it joined thread 1 after the store) reads only the latest store.
  expect(readable(b, clocks(clock(2, 17)), false)).toEqual(["1"]);
});
