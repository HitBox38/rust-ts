// Unit tests of rustc_abi layout/coroutine.ts `coroutine_saved_local_eligibility` (lane abi-layout-b). Expectations
// follow the upstream algorithm by hand (coroutine.rs:42); `layout` needs `layout_of_univariant` (lane abi-layout-a).
import { expect, test } from "bun:test";
import { BitMatrix } from "../../rustc_index/bit_set.ts";
import { PLAIN } from "../../std/fmt.ts";
import { coroutine_saved_local_eligibility, debug_SavedLocalEligibility } from "./coroutine.ts";

function conflicts(n: number, pairs: [number, number][]): BitMatrix<number, number> {
  const m = BitMatrix.new<number, number>(n, n);
  for (const [a, b] of pairs) {
    m.insert(a, b);
    m.insert(b, a);
  }
  return m;
}

function run(n: number, variant_fields: number[][], pairs: [number, number][]): [number[], string[]] {
  const [ineligible, assignments] = coroutine_saved_local_eligibility(n, variant_fields, conflicts(n, pairs));
  return [[...ineligible.iter()], assignments.map((a) => debug_SavedLocalEligibility(a, PLAIN))];
}

test("locals of one variant each stay assigned", () => {
  expect(run(2, [[0], [1]], [])).toEqual([[], ["Assigned(0)", "Assigned(1)"]]);
});

test("a local in two variants is promoted; fewer than two used variants promotes everything", () => {
  expect(run(3, [[0, 1], [2], [0]], [[1, 2]])).toEqual([[0, 1, 2], ["Ineligible(Some(0))", "Ineligible(Some(1))", "Ineligible(Some(2))"]]);
});

test("of two conflicting locals the one with more conflicts is promoted (ties: local_b)", () => {
  expect(
    run(
      3,
      [[0, 1], [2], []],
      [
        [0, 1],
        [1, 2],
      ],
    ),
  ).toEqual([[1], ["Assigned(0)", "Ineligible(Some(0))", "Assigned(1)"]]);
  // a tie removes `local_b`; then only one variant is used, so everything is promoted
  expect(run(2, [[0], [1]], [[0, 1]])).toEqual([[0, 1], ["Ineligible(Some(0))", "Ineligible(Some(1))"]]);
});
