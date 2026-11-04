// Lane checks of the `Exhaustive` tables (lane miri-tb-a). Upstream exhaustive.rs has no tests of its own; the order of each
// container's elements follows from its `flat_map`s, and the exhaustive tests of perms.rs / tree/tests.rs iterate them.
import { expect, test } from "bun:test";
import {
  copy,
  Exhaustive_array1,
  Exhaustive_array2,
  Exhaustive_array3,
  Exhaustive_array4,
  Exhaustive_array5,
  Exhaustive_bool,
  Exhaustive_never,
  Exhaustive_Option,
  Exhaustive_tuple2,
  Exhaustive_unit,
} from "./exhaustive.ts";

const B = Exhaustive_bool;

test("the trivial impls", () => {
  expect([...Exhaustive_never.exhaustive()]).toEqual([]);
  expect([...Exhaustive_unit.exhaustive()]).toEqual([undefined]);
  expect([...B.exhaustive()]).toEqual([true, false]);
});

test("the container impls enumerate in upstream's order", () => {
  expect([...Exhaustive_Option(B).exhaustive()]).toEqual([undefined, true, false]);
  expect([...Exhaustive_tuple2(B, Exhaustive_unit, copy).exhaustive()]).toEqual([
    [true, undefined],
    [false, undefined],
  ]);
  expect([...Exhaustive_array1(B).exhaustive()]).toEqual([[true], [false]]);
  expect([...Exhaustive_array2(B, copy).exhaustive()]).toEqual([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]);
  const a3 = [...Exhaustive_array3(B, copy).exhaustive()];
  expect(a3.length).toBe(8);
  expect(a3[0]).toEqual([true, true, true]);
  expect(a3[1]).toEqual([true, true, false]);
  expect(a3[2]).toEqual([true, false, true]);
  expect(a3[7]).toEqual([false, false, false]);
  const a4 = [...Exhaustive_array4(B, copy).exhaustive()];
  expect(a4.length).toBe(16);
  expect(a4[1]).toEqual([true, true, true, false]);
  const a5 = [...Exhaustive_array5(B, copy).exhaustive()];
  expect(a5.length).toBe(32);
  expect(a5[1]).toEqual([true, true, true, true, false]);
  expect(a5[31]).toEqual([false, false, false, false, false]);
});

test("elements a container repeats are cloned, so a test can mutate what it gets", () => {
  const T = {
    *exhaustive(): Generator<{ n: number }> {
      yield { n: 1 };
      yield { n: 2 };
    },
  };
  const clone = (v: { n: number }) => ({ n: v.n });
  const seen: number[][] = [];
  for (const [a, b] of Exhaustive_array2(T, clone).exhaustive()) {
    seen.push([a.n, b.n]);
    a.n += 100;
    b.n += 100;
  }
  expect(seen).toEqual([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]);
  const pairs: number[][] = [];
  for (const [a, b] of Exhaustive_tuple2(T, B, clone).exhaustive()) {
    pairs.push([a.n, b ? 1 : 0]);
    a.n += 100;
  }
  expect(pairs).toEqual([
    [1, 1],
    [1, 0],
    [2, 1],
    [2, 0],
  ]);
});
