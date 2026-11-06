// Lane perf-near-limit: `WriteWatch` (snapshot_vec.ts) must never miss a change to what `StalledPrefix` reads of a variable:
// whether it is a root, and its value's variant. The walk runs every table operation against a model of the answers.
import { expect, test } from "bun:test";
import { Ok } from "../../std/result.ts";
import { NO_READER, type WriteWatch } from "./snapshot_vec.ts";
import { VecLog } from "./undo_log.ts";
import { InPlace, type InPlaceUndoLog, NoError, UnificationTable, type UnifyKey, UnifyKey_provided, type UnifyValue } from "./unify/mod.ts";

type V = { readonly $: "Unknown"; readonly u: number } | { readonly $: "Known"; readonly n: number };

const Value: UnifyValue<V, NoError> = {
  clone: (v) => v,
  // A root that stays `Unknown` gets a new value object, as `TypeVariableValue` does.
  unify_values: (a, b) => Ok(a.$ === "Known" ? a : b.$ === "Known" ? b : { $: "Unknown", u: Math.min(a.u, b.u) }),
} as UnifyValue<V, NoError>;

const Key: UnifyKey<number, V, NoError> = {
  Value,
  eq: (a, b) => a === b,
  index: (k) => k,
  from_index: (u) => u,
  tag: () => "Key",
  order_roots: UnifyKey_provided.order_roots,
};

function new_table(): UnificationTable<number, V, NoError, InPlace<number, V, NoError, VecLog<InPlaceUndoLog<number, V>>>> {
  return UnificationTable.new(() => InPlace.default(Key, () => VecLog.default<InPlaceUndoLog<number, V>>()));
}

/** What `try_probe_value` + `v.$ === "Unknown"` answer. */
function answer(t: ReturnType<typeof new_table>, k: number): string {
  const v = t.values.values.values[k]!;
  return v.parent === k ? `root ${v.value.$}` : "child";
}

function watch_of(t: ReturnType<typeof new_table>): WriteWatch {
  return t.values.values.watch;
}

function set_readers(t: ReturnType<typeof new_table>, readers: Map<number, number>): void {
  const w = watch_of(t);
  const first_reader = new Int32Array(t.values.values.values.length + 4).fill(NO_READER);
  for (const [k, entry] of readers) first_reader[k] = entry;
  w.first_reader = first_reader;
  w.changed_from = NO_READER;
}

test("the entry that read a changed variable is the one reported", () => {
  const t = new_table();
  const [a, b, c] = [t.new_key({ $: "Unknown", u: 0 }), t.new_key({ $: "Unknown", u: 0 }), t.new_key({ $: "Unknown", u: 0 })];
  set_readers(t, new Map([[a, 2], [b, 5]]));
  // Not read by any entry.
  t.union_value(c, { $: "Known", n: 1 });
  expect(watch_of(t).changed_from).toBe(NO_READER);
  t.union_value(b, { $: "Known", n: 1 });
  expect(watch_of(t).changed_from).toBe(5);
  t.union_value(a, { $: "Known", n: 1 });
  expect(watch_of(t).changed_from).toBe(2);
});

test("a new key, a rank change and path compression change no answer and are not reported", () => {
  const t = new_table();
  const keys = Array.from({ length: 8 }, () => t.new_key({ $: "Unknown", u: 0 }));
  t.union(keys[0]!, keys[1]!);
  t.union(keys[2]!, keys[3]!);
  t.union(keys[0]!, keys[2]!);
  const root = t.find(keys[3]!);
  set_readers(t, new Map([[root, 0]]));
  t.new_key({ $: "Unknown", u: 0 });
  for (const k of keys) t.find(k);
  // An unread root joins this one: it stays the root, its rank or `Unknown` universe may change.
  t.union(root, keys[5]!);
  expect(t.find(root)).toBe(root);
  expect(watch_of(t).changed_from).toBe(NO_READER);
});

test("set, set_all and get_mut always count", () => {
  for (const write of [
    (t: ReturnType<typeof new_table>): void => t.values.values.get_mut(0) as unknown as void,
    (t: ReturnType<typeof new_table>): void => t.reset_unifications(() => ({ $: "Unknown", u: 0 })),
  ]) {
    const t = new_table();
    t.new_key({ $: "Unknown", u: 0 });
    set_readers(t, new Map([[0, 3]]));
    write(t);
    expect(watch_of(t).changed_from).toBeLessThanOrEqual(3);
  }
});

test("random walk: while an entry is not reported, every answer it read is unchanged", () => {
  let seed = 0x2f6e2b1;
  const next = (n: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % n;
  };
  let reported = 0;
  for (let round = 0; round < 300; round++) {
    const t = new_table();
    const n = 4 + next(12);
    for (let i = 0; i < n; i++) t.new_key({ $: "Unknown", u: next(3) });
    const snapshots: unknown[] = [];
    const steps = 40 + next(40);
    let readers = new Map<number, number>();
    let read = new Map<number, string>();
    const reset = (): void => {
      readers = new Map();
      read = new Map();
      const len = t.values.values.values.length;
      for (let k = 0; k < len; k++) {
        if (next(2) === 0) {
          readers.set(k, next(10));
          read.set(k, answer(t, k));
        }
      }
      set_readers(t, readers);
    };
    reset();
    for (let s = 0; s < steps; s++) {
      const len = t.values.values.values.length;
      const a = next(len);
      const b = next(len);
      switch (next(8)) {
        case 0:
          t.union(a, b);
          break;
        case 1:
          t.union_value(a, next(4) === 0 ? { $: "Known", n: next(3) } : { $: "Unknown", u: next(3) });
          break;
        case 2:
          t.find(a);
          break;
        case 3:
          t.new_key({ $: "Unknown", u: 0 });
          break;
        case 4:
          snapshots.push(t.snapshot());
          break;
        case 5:
          if (snapshots.length > 0) t.rollback_to(snapshots.pop() as never);
          break;
        case 6:
          if (snapshots.length > 0) t.commit(snapshots.pop() as never);
          break;
        case 7:
          if (next(10) === 0) reset();
          break;
      }
      const from = watch_of(t).changed_from;
      if (from !== NO_READER) reported++;
      const now = t.values.values.values.length;
      for (const [k, entry] of readers) {
        // A rolled back variable is gone: its removal must have been reported to its entry.
        if (entry < from) expect({ k, answer: k < now ? answer(t, k) : "gone" }).toEqual({ k, answer: read.get(k)! });
      }
    }
  }
  // The walk does reach the case under test.
  expect(reported).toBeGreaterThan(1000);
});
