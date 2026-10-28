// Port of datafrog =2.0.1 `src/test.rs` (`#![cfg(test)] mod test`), plus the three doc-tests of
// `Variable::from_join` / `from_antijoin` / `from_map` (lib.rs) at the end.
//
// PORT: `proptest!` properties run `CASES` cases from fixed seeds (mulberry32, as anstream's tests do);
// `inputs()` draws `Vec<(u32, u32)>` of length 1..500 with both fields in 0..100, as the strategy does.
// They do not shrink; a failure reports the seed.
import { expect, test } from "bun:test";
import { Iteration, Relation } from "./lib.ts";

const CASES = 64;

/** mulberry32 */
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

type P = readonly [number, number];

// crate: datafrog-2.0.1/src/test.rs:9 inputs
function inputs(r: () => number): P[] {
  // prop::collection::vec((0_u32..100, 0_u32..100), 1..500)
  const n = 1 + Math.floor(r() * 499);
  const v: P[] = [];
  for (let i = 0; i < n; i++) v.push([Math.floor(r() * 100), Math.floor(r() * 100)]);
  return v;
}

/// The original way to use datafrog -- computes reachable nodes from a set of edges
// crate: datafrog-2.0.1/src/test.rs:14 reachable_with_var_join
function reachable_with_var_join(edges_: readonly P[]): Relation<P> {
  const edges: Relation<P> = Relation.collect(edges_);
  const iteration = Iteration.new();

  const edges_by_successor = iteration.variable<P>("edges_invert");
  edges_by_successor.extend(edges.iter().map(([n1, n2]): P => [n2, n1]));

  const reachable = iteration.variable<P>("reachable");
  reachable.insert(edges);

  while (iteration.changed()) {
    // reachable(N1, N3) :- edges(N1, N2), reachable(N2, N3).
    reachable.from_join(reachable, edges_by_successor, (_, n3, n1): P => [n1, n3]);
  }

  return reachable.complete();
}

/// Like `reachable`, but using a relation as an input to `from_join`
// crate: datafrog-2.0.1/src/test.rs:33 reachable_with_relation_join
function reachable_with_relation_join(edges_: readonly P[]): Relation<P> {
  const edges: Relation<P> = Relation.collect(edges_);
  const iteration = Iteration.new();

  // NB. Changed from `reachable_with_var_join`:
  const edges_by_successor: Relation<P> = Relation.collect(edges.iter().map(([n1, n2]): P => [n2, n1]));

  const reachable = iteration.variable<P>("reachable");
  reachable.insert(edges);

  while (iteration.changed()) {
    // reachable(N1, N3) :- edges(N1, N2), reachable(N2, N3).
    reachable.from_join(reachable, edges_by_successor, (_, n3, n1): P => [n1, n3]);
  }

  return reachable.complete();
}

// crate: datafrog-2.0.1/src/test.rs:51 reachable_with_leapfrog
function reachable_with_leapfrog(edges_: readonly P[]): Relation<P> {
  const edges: Relation<P> = Relation.collect(edges_);
  const iteration = Iteration.new();

  const edges_by_successor: Relation<P> = Relation.collect(edges.iter().map(([n1, n2]): P => [n2, n1]));

  const reachable = iteration.variable<P>("reachable");
  reachable.insert(edges);

  while (iteration.changed()) {
    // reachable(N1, N3) :- edges(N1, N2), reachable(N2, N3).
    reachable.from_leapjoin(
      reachable,
      edges_by_successor.extend_with(([n2, _]: P) => n2),
      ([_, n3], n1): P => [n1, n3],
    );
  }

  return reachable.complete();
}

/// Computes a join where the values are summed -- uses iteration
/// variables (the original datafrog technique).
// crate: datafrog-2.0.1/src/test.rs:74 sum_join_via_var
function sum_join_via_var(input1_slice: readonly P[], input2_slice: readonly P[]): Relation<P> {
  const iteration = Iteration.new();

  const input1 = iteration.variable<P>("input1");
  input1.extend(input1_slice);

  const input2 = iteration.variable<P>("input1");
  input2.extend(input2_slice);

  const output = iteration.variable<P>("output");

  while (iteration.changed()) {
    // output(K1, V1 * 100 + V2) :- input1(K1, V1), input2(K1, V2).
    output.from_join(input1, input2, (k1, v1, v2): P => [k1, v1 * 100 + v2]);
  }

  return output.complete();
}

/// Computes a join where the values are summed -- uses iteration
/// variables (the original datafrog technique).
// crate: datafrog-2.0.1/src/test.rs:98 sum_join_via_relation
function sum_join_via_relation(input1_slice: readonly P[], input2_slice: readonly P[]): Relation<P> {
  const input1: Relation<P> = Relation.collect(input1_slice);
  const input2: Relation<P> = Relation.collect(input2_slice);
  return Relation.from_join(input1, input2, (k1, v1, v2): P => [k1, v1 * 100 + v2]);
}

/** `input2.elements.binary_search(&t).is_ok()` */
function contains(sorted: readonly P[], t: P): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const e = sorted[mid]!;
    const c = e[0] - t[0] || e[1] - t[1];
    if (c === 0) return true;
    if (c < 0) lo = mid + 1;
    else hi = mid;
  }
  return false;
}

// proptest! {

// crate: datafrog-2.0.1/src/test.rs:109 reachable_leapfrog_vs_var_join
test("reachable_leapfrog_vs_var_join", () => {
  for (let seed = 0; seed < CASES; seed++) {
    const edges = inputs(rng(0x109_0000 + seed));
    const reachable1 = reachable_with_var_join(edges);
    const reachable2 = reachable_with_leapfrog(edges);
    expect(reachable2.elements, `seed ${seed}`).toEqual(reachable1.elements);
  }
}, 60_000);

// crate: datafrog-2.0.1/src/test.rs:116 reachable_rel_join_vs_var_join
test("reachable_rel_join_vs_var_join", () => {
  for (let seed = 0; seed < CASES; seed++) {
    const edges = inputs(rng(0x116_0000 + seed));
    const reachable1 = reachable_with_var_join(edges);
    const reachable2 = reachable_with_relation_join(edges);
    expect(reachable2.elements, `seed ${seed}`).toEqual(reachable1.elements);
  }
}, 60_000);

// crate: datafrog-2.0.1/src/test.rs:123 sum_join_from_var_vs_rel
test("sum_join_from_var_vs_rel", () => {
  for (let seed = 0; seed < CASES; seed++) {
    const r = rng(0x123_0000 + seed);
    const set1 = inputs(r);
    const set2 = inputs(r);
    const output1 = sum_join_via_var(set1, set2);
    const output2 = sum_join_via_relation(set1, set2);
    expect(output2.elements, `seed ${seed}`).toEqual(output1.elements);
  }
}, 60_000);

/// Test the behavior of `filter_anti` used on its own in a
/// leapjoin -- effectively it becomes an "intersection"
/// operation.
// crate: datafrog-2.0.1/src/test.rs:133 filter_with_on_its_own
test("filter_with_on_its_own", () => {
  for (let seed = 0; seed < CASES; seed++) {
    const r = rng(0x133_0000 + seed);
    const set1 = inputs(r);
    const set2 = inputs(r);
    const input1: Relation<P> = Relation.collect(set1);
    const input2: Relation<P> = Relation.collect(set2);
    const intersection1 = Relation.from_leapjoin(
      input1,
      input2.filter_with((tuple: P) => tuple),
      (tuple, _: undefined) => tuple,
    );

    const intersection2: Relation<P> = Relation.collect(input1.elements.filter((t) => contains(input2.elements, t)));

    expect(intersection1.elements, `seed ${seed}`).toEqual(intersection2.elements);
  }
}, 60_000);

/// Test the behavior of `filter_anti` used on its own in a
/// leapjoin -- effectively it becomes a "set minus" operation.
// crate: datafrog-2.0.1/src/test.rs:152 filter_anti_on_its_own
test("filter_anti_on_its_own", () => {
  for (let seed = 0; seed < CASES; seed++) {
    const r = rng(0x152_0000 + seed);
    const set1 = inputs(r);
    const set2 = inputs(r);
    const input1: Relation<P> = Relation.collect(set1);
    const input2: Relation<P> = Relation.collect(set2);

    const difference1 = Relation.from_leapjoin(
      input1,
      input2.filter_anti((tuple: P) => tuple),
      (tuple, _: undefined) => tuple,
    );

    const difference2: Relation<P> = Relation.collect(input1.elements.filter((t) => !contains(input2.elements, t)));

    expect(difference1.elements, `seed ${seed}`).toEqual(difference2.elements);
  }
}, 60_000);

// }

/// Test that `from_leapjoin` matches against the tuples from an
/// `extend` that precedes first iteration.
///
/// This was always true, but wasn't immediately obvious to me until I
/// re-read the code more carefully. -nikomatsakis
// crate: datafrog-2.0.1/src/test.rs:176 leapjoin_from_extend
test("leapjoin_from_extend", () => {
  const doubles: Relation<P> = Relation.collect(Array.from({ length: 10 }, (_, i): P => [i, i * 2]));

  const iteration = Iteration.new();

  const variable = iteration.variable<P>("variable");
  variable.extend([[2, 2]]);

  while (iteration.changed()) {
    variable.from_leapjoin(
      variable,
      doubles.extend_with(([i, _]: P) => i),
      ([i, _], j): P => [i, j],
    );
  }

  const result = variable.complete();

  expect(result.elements).toEqual([
    [2, 2],
    [2, 4],
  ]);
});

// ---- doc-tests of lib.rs ----

test("doctest Variable::from_join (lib.rs:304)", () => {
  const iteration = Iteration.new();
  const variable = iteration.variable<P>("source");
  variable.extend(Array.from({ length: 10 }, (_, x): P => [x, x + 1]));
  variable.extend(Array.from({ length: 10 }, (_, x): P => [x + 1, x]));

  while (iteration.changed()) {
    variable.from_join(variable, variable, (_key, val1, val2): P => [val1, val2]);
  }

  const result = variable.complete();
  expect(result.len()).toBe(121);
});

test("doctest Variable::from_antijoin (lib.rs:341)", () => {
  const iteration = Iteration.new();
  const variable = iteration.variable<P>("source");
  variable.extend(Array.from({ length: 10 }, (_, x): P => [x, x + 1]));

  const relation: Relation<number> = Relation.collect(Array.from({ length: 10 }, (_, x) => x).filter((x) => x % 3 === 0));

  while (iteration.changed()) {
    variable.from_antijoin(variable, relation, (key, val): P => [val, key]);
  }

  const result = variable.complete();
  expect(result.len()).toBe(16);
});

test("doctest Variable::from_map (lib.rs:375)", () => {
  const iteration = Iteration.new();
  const variable = iteration.variable<P>("source");
  variable.extend(Array.from({ length: 10 }, (_, x): P => [x, x]));

  while (iteration.changed()) {
    variable.from_map(variable, ([key, val]): P => (val % 2 === 0 ? [key, val / 2] : [key, 3 * val + 1]));
  }

  const result = variable.complete();
  expect(result.len()).toBe(74);
});
