// Port of ena =0.14.4 `src/unify/tests.rs`.
//
// PORT: the key newtypes (`UnitKey(u32)`, `IntKey(u32)`, `OrderedKey(u32)`) are their `u32`;
// `OrderedRank(u32)` likewise. `all_modes!` runs the body for `InPlace` only (`persistent` is
// off); its `test_body::<S>()` takes `S: Default` as `S_default`. The `bench` feature is off.
import { expect, test } from "bun:test";
import { type Result, Ok } from "../../../std/result.ts";
import { clone_UndoLog } from "../snapshot_vec.ts";
import { VecLog } from "../undo_log.ts";
import {
  type EqUnifyValue,
  InPlace,
  type InPlaceUndoLog,
  type InPlaceUnificationTable,
  NoError,
  UnificationTable,
  type UnifyKey,
  UnifyKey_provided,
  type UnifyValue,
  UnifyValue_EqUnifyValue,
  UnifyValue_Option,
  UnifyValue_unit,
} from "./mod.ts";

/** `InPlace<K>` with its default `VecLog`. */
type InPlaceT<V, E> = InPlace<number, V, E, VecLog<InPlaceUndoLog<number, V>>>;

function in_place<V, E>(K: UnifyKey<number, V, E>): () => InPlaceT<V, E> {
  return () => InPlace.default(K, () => VecLog.default<InPlaceUndoLog<number, V>>());
}

/** `#[derive(Copy, Clone, Debug, Hash, PartialEq, Eq)] struct UnitKey(u32);` */
const UnitKey: UnifyKey<number, undefined, NoError> = {
  Value: UnifyValue_unit,
  eq: (a, b) => a === b,
  // crate: ena-0.14.4/src/unify/tests.rs:30 index
  index(self: number): number {
    return self;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:33 from_index
  from_index(u: number): number {
    return u;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:36 tag
  tag(): string {
    return "UnitKey";
  },
  order_roots: UnifyKey_provided.order_roots,
};

/** `all_modes! { S for $t => $body }`: `test_body::<InPlace<$t>>()`. */
function all_modes<V, E>(K: UnifyKey<number, V, E>, body: (S_default: () => InPlaceT<V, E>) => void): void {
  // crate: ena-0.14.4/src/unify/tests.rs:43 test_body
  function test_body(S_default: () => InPlaceT<V, E>): void {
    body(S_default);
  }

  test_body(in_place(K));
}

// crate: ena-0.14.4/src/unify/tests.rs:57 basic
test("basic", () => {
  all_modes(UnitKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(ut.unioned(k1, k2)).toBe(false);
    ut.union(k1, k2);
    expect(ut.unioned(k1, k2)).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:71 big_array
test("big_array", () => {
  all_modes(UnitKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const keys: number[] = [];
    const MAX = 1 << 15;

    for (let _ = 0; _ < MAX; _++) {
      keys.push(ut.new_key(undefined));
    }

    for (let i = 1; i < MAX; i++) {
      const l = keys[i - 1]!;
      const r = keys[i]!;
      ut.union(l, r);
    }

    for (let i = 0; i < MAX; i++) {
      expect(ut.unioned(keys[0]!, keys[i]!)).toBe(true);
    }
  });
});

// crate-skip: ena-0.14.4/src/unify/tests.rs:96 big_array_bench_generic benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:122 big_array_bench_InPlace benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:128 big_array_bench_Persistent benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:133 big_array_bench_in_snapshot_generic benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:163 big_array_bench_in_snapshot_InPlace benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:169 big_array_bench_in_snapshot_Persistent benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:174 big_array_bench_clone_generic benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:206 big_array_bench_clone_InPlace benchmark (feature "bench" off)
// crate-skip: ena-0.14.4/src/unify/tests.rs:212 big_array_bench_clone_Persistent benchmark (feature "bench" off)

// crate: ena-0.14.4/src/unify/tests.rs:217 even_odd
test("even_odd", () => {
  all_modes(UnitKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const keys: number[] = [];
    const MAX = 1 << 10;

    for (let i = 0; i < MAX; i++) {
      const key = ut.new_key(undefined);
      keys.push(key);

      if (i >= 2) {
        ut.union(key, keys[i - 2]!);
      }
    }

    for (let i = 1; i < MAX; i++) {
      expect(!ut.unioned(keys[i - 1]!, keys[i]!)).toBe(true);
    }

    for (let i = 2; i < MAX; i++) {
      expect(ut.unioned(keys[i - 2]!, keys[i]!)).toBe(true);
    }
  });
});

/** `impl EqUnifyValue for i32 {}` */
const i32_EqUnifyValue: EqUnifyValue<number> = { eq: (a, b) => a === b, clone: (v) => v };

/** `#[derive(Copy, Clone, Debug, Hash, PartialEq, Eq)] struct IntKey(u32);` (`Value = Option<i32>`) */
const IntKey: UnifyKey<number, number | undefined, [number, number]> = {
  Value: UnifyValue_Option(UnifyValue_EqUnifyValue(i32_EqUnifyValue)),
  eq: (a, b) => a === b,
  // crate: ena-0.14.4/src/unify/tests.rs:249 index
  index(self: number): number {
    return self;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:252 from_index
  from_index(u: number): number {
    return u;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:255 tag
  tag(): string {
    return "IntKey";
  },
  order_roots: UnifyKey_provided.order_roots,
};

const is_ok = <T, E>(r: Result<T, E>): boolean => r.$ === "Ok";
const is_err = <T, E>(r: Result<T, E>): boolean => r.$ === "Err";

// crate: ena-0.14.4/src/unify/tests.rs:263 unify_same_int_twice
test("unify_same_int_twice", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_ok(ut.unify_var_value(k2, 22))).toBe(true);
    expect(is_ok(ut.unify_var_var(k1, k2))).toBe(true);
    expect(ut.probe_value(k1)).toBe(22);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:278 unify_vars_then_int_indirect
test("unify_vars_then_int_indirect", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_var(k1, k2))).toBe(true);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(ut.probe_value(k2)).toBe(22);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:292 unify_vars_different_ints_1
test("unify_vars_different_ints_1", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_var(k1, k2))).toBe(true);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_err(ut.unify_var_value(k2, 23))).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:306 unify_vars_different_ints_2
test("unify_vars_different_ints_2", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_var(k2, k1))).toBe(true);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_err(ut.unify_var_value(k2, 23))).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:320 unify_distinct_ints_then_vars
test("unify_distinct_ints_then_vars", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_ok(ut.unify_var_value(k2, 23))).toBe(true);
    expect(is_err(ut.unify_var_var(k2, k1))).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:334 unify_root_value_1
test("unify_root_value_1", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    const k3 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_ok(ut.unify_var_var(k1, k2))).toBe(true);
    expect(is_ok(ut.unify_var_value(k3, 23))).toBe(true);
    expect(is_err(ut.unify_var_var(k1, k3))).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:350 unify_root_value_2
test("unify_root_value_2", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    const k3 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_ok(ut.unify_var_var(k2, k1))).toBe(true);
    expect(is_ok(ut.unify_var_value(k3, 23))).toBe(true);
    expect(is_err(ut.unify_var_var(k1, k3))).toBe(true);
  });
});

/** `#[derive(Copy, Clone, Debug, Hash, PartialEq, Eq, PartialOrd, Ord)] struct OrderedRank(u32);` */
const OrderedRank: UnifyValue<number, NoError> = {
  clone: (v) => v,

  // crate: ena-0.14.4/src/unify/tests.rs:402 unify_values
  unify_values(value1: number, value2: number): Result<number, NoError> {
    return Ok(Math.max(value1, value2));
  },
};

/** `#[derive(Copy, Clone, Debug, Hash, PartialEq, Eq)] struct OrderedKey(u32);` (`Value = OrderedRank`) */
const OrderedKey: UnifyKey<number, number, NoError> = {
  Value: OrderedRank,
  eq: (a, b) => a === b,
  // crate: ena-0.14.4/src/unify/tests.rs:373 index
  index(self: number): number {
    return self;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:376 from_index
  from_index(u: number): number {
    return u;
  },
  // crate: ena-0.14.4/src/unify/tests.rs:379 tag
  tag(): string {
    return "OrderedKey";
  },
  // crate: ena-0.14.4/src/unify/tests.rs:382 order_roots
  order_roots(a: number, a_rank: number, b: number, b_rank: number): [number, number] | undefined {
    // PORT: the test's stdout (`println!("{:?} vs {:?}", a_rank, b_rank)`) is not reproduced.
    if (a_rank > b_rank) {
      return [a, b];
    } else if (b_rank > a_rank) {
      return [b, a];
    } else {
      return undefined;
    }
  },
};

// crate: ena-0.14.4/src/unify/tests.rs:408 ordered_key
test("ordered_key", () => {
  all_modes(OrderedKey, (S_default) => {
    const ut = UnificationTable.new(S_default);

    const k0_1 = ut.new_key(0);
    const k0_2 = ut.new_key(0);
    const k0_3 = ut.new_key(0);
    const k0_4 = ut.new_key(0);

    ut.union(k0_1, k0_2); // rank of one of those will now be 1
    ut.union(k0_3, k0_4); // rank of new root also 1
    ut.union(k0_1, k0_3); // rank of new root now 2

    const k0_5 = ut.new_key(0);
    const k0_6 = ut.new_key(0);
    ut.union(k0_5, k0_6); // rank of new root now 1

    ut.union(k0_1, k0_5); // new root rank 2, should not be k0_5 or k0_6
    expect([k0_1, k0_2, k0_3, k0_4].includes(ut.find(k0_1))).toBe(true);
  });
});

// crate: ena-0.14.4/src/unify/tests.rs:433 ordered_key_k1
test("ordered_key_k1", () => {
  all_modes(UnitKey, (_S_default) => {
    const ut: InPlaceUnificationTable<number, number, NoError> = UnificationTable.new(in_place(OrderedKey));

    const k0_1 = ut.new_key(0);
    const k0_2 = ut.new_key(0);
    const k0_3 = ut.new_key(0);
    const k0_4 = ut.new_key(0);

    ut.union(k0_1, k0_2); // rank of one of those will now be 1
    ut.union(k0_3, k0_4); // rank of new root also 1
    ut.union(k0_1, k0_3); // rank of new root now 2

    const k1_5 = ut.new_key(1);
    const k1_6 = ut.new_key(1);
    ut.union(k1_5, k1_6); // rank of new root now 1

    ut.union(k0_1, k1_5); // even though k1 has lower rank, it wins
    expect([k1_5, k1_6].includes(ut.find(k0_1)), `unexpected choice for root: ${ut.find(k0_1)}`).toBe(true);
  });
});

/// Test that we *can* clone.
// crate: ena-0.14.4/src/unify/tests.rs:463 clone_table
test("clone_table", () => {
  all_modes(IntKey, (S_default) => {
    const ut = UnificationTable.new(S_default);
    const k1 = ut.new_key(undefined);
    const k2 = ut.new_key(undefined);
    const k3 = ut.new_key(undefined);
    expect(is_ok(ut.unify_var_value(k1, 22))).toBe(true);
    expect(is_ok(ut.unify_var_value(k2, 22))).toBe(true);
    expect(is_ok(ut.unify_var_var(k1, k2))).toBe(true);
    expect(ut.probe_value(k3)).toBe(undefined);

    const ut1 = ut.clone((s) => s.clone((l) => l.clone((u) => clone_UndoLog(u, (v) => v.clone(IntKey.Value), (x) => x))));
    expect(ut1.probe_value(k1)).toBe(22);
    expect(ut1.probe_value(k3)).toBe(undefined);

    expect(is_ok(ut.unify_var_value(k3, 44))).toBe(true);

    expect(ut1.probe_value(k1)).toBe(22);
    expect(ut1.probe_value(k3)).toBe(undefined);
    expect(ut.probe_value(k3)).toBe(44);
  });
});

// ---- rust-ts's own checks (not upstream tests): the root choice, rank and path compression of
// `unify_roots` / `inlined_get_root_key`, read off ena's source, and snapshot rollback. ----

test("root choice follows union-by-rank (rust-ts)", () => {
  const ut = UnificationTable.new(in_place(UnitKey));
  const k = [0, 1, 2, 3, 4].map(() => ut.new_key(undefined));
  // Equal ranks: `key_a` redirects to `key_b`, whose rank becomes 1.
  ut.union(k[0]!, k[1]!);
  expect(ut.find(k[0]!)).toBe(k[1]!);
  expect(ut.value(k[1]!).rank).toBe(1);
  // rank_a (0) < rank_b (1)... here a = k2 (rank 0), b's root k1 (rank 1): k2 redirects to k1.
  ut.union(k[2]!, k[0]!);
  expect(ut.find(k[2]!)).toBe(k[1]!);
  expect(ut.value(k[1]!).rank).toBe(1);
  // rank_a (1) > rank_b (0): b redirects to a.
  ut.union(k[0]!, k[3]!);
  expect(ut.find(k[3]!)).toBe(k[1]!);
  // A rank-1 tree {4, ..} unioned with the rank-1 root k1 as `key_b`: k1 becomes the child.
  const k5 = ut.new_key(undefined);
  ut.union(k[4]!, k5);
  expect(ut.find(k[4]!)).toBe(k5);
  ut.union(k[1]!, k[4]!);
  expect(ut.find(k[0]!)).toBe(k5);
  expect(ut.value(k5).rank).toBe(2);
  // Path compression: k0 pointed at k1 and now points straight at the root.
  expect(ut.value(k[0]!).parent).toBe(k5);
});

test("snapshot rollback restores parents, ranks and values (rust-ts)", () => {
  const ut = UnificationTable.new(in_place(IntKey));
  const a = ut.new_key(undefined);
  const b = ut.new_key(7);
  const snapshot = ut.snapshot();
  const c = ut.new_key(undefined);
  expect(is_ok(ut.unify_var_var(a, b))).toBe(true);
  expect(is_ok(ut.unify_var_var(c, a))).toBe(true);
  expect(ut.vars_since_snapshot(snapshot)).toEqual({ start: 2, end: 3 });
  expect(ut.probe_value(c)).toBe(7);
  ut.rollback_to(snapshot);
  expect(ut.len()).toBe(2);
  expect(ut.unioned(a, b)).toBe(false);
  expect(ut.probe_value(a)).toBe(undefined);
  expect(ut.value(b).rank).toBe(0);
  expect(ut.try_probe_value(a)).toEqual({ $: "Some", _0: undefined });
});
