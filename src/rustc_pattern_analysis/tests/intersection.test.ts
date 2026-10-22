//! Test the computation of arm intersections.
//
// Port of compiler/rustc_pattern_analysis/tests/intersection.rs (lane pat-b). `pats!(ty; ..)` is `pats(ty, "..")`
// (common/mod.ts). The tests need lane pat-a's usefulness.rs: skipped until it is ported (`USEFULNESS_PORTED`).
import { expect, test } from "bun:test";
import { type CxTypes, compute_match_usefulness, pats, type Ty, USEFULNESS_PORTED } from "./common/mod.ts";
import type { MatchArm } from "../lib.ts";
import type { DeconstructedPat } from "../pat.ts";
import { PlaceValidity } from "../usefulness.ts";
import { unwrap_result } from "../../std/result.ts";

const SKIP = !USEFULNESS_PORTED;

/// Analyze a match made of these patterns and returns the computed arm intersections.
// rustc: compiler/rustc_pattern_analysis/tests/intersection.rs:14 check
function check(patterns: DeconstructedPat<CxTypes>[]): number[][] {
  const ty = patterns[0]!.ty();
  const arms: MatchArm<CxTypes>[] = patterns.map((pat) => ({ pat, has_guard: false, arm_data: null }));
  const report = unwrap_result(compute_match_usefulness(arms, ty, PlaceValidity.ValidOnly, Number.MAX_SAFE_INTEGER, false));
  return report.arm_intersections.map((bitset) => [...bitset.iter()]);
}

// #[track_caller]
// rustc: compiler/rustc_pattern_analysis/tests/intersection.rs:25 assert_intersects
function assert_intersects(patterns: DeconstructedPat<CxTypes>[], intersects: number[][]): void {
  const computed_intersects = check(patterns);
  expect(computed_intersects).toEqual(intersects);
}

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/intersection.rs:31 test_int_ranges
test.skipIf(SKIP)("test_int_ranges", () => {
  const ty: Ty = { $: "U8" };
  assert_intersects(
    pats(ty, `
            0..=100,
            100..,
        `),
    [[], [0]],
  );
  assert_intersects(
    pats(ty, `
            0..=101,
            100..,
        `),
    [[], [0]],
  );
  assert_intersects(
    pats(ty, `
            0..100,
            100..,
        `),
    [[], []],
  );
});

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/intersection.rs:57 test_nested
test.skipIf(SKIP)("test_nested", () => {
  let ty: Ty = { $: "Tuple", _0: [{ $: "Bool" }, { $: "Bool" }] };
  assert_intersects(
    pats(ty, `
            (true, true),
            (true, _),
            (_, true),
        `),
    [[], [0], [0, 1]],
  );
  // Here we shortcut because `(true, true)` is irrelevant, so we fail to detect the intersection.
  assert_intersects(
    pats(ty, `
            (true, _),
            (_, true),
        `),
    [[], []],
  );
  ty = { $: "Tuple", _0: [{ $: "Bool" }, { $: "Bool" }, { $: "Bool" }] };
  assert_intersects(
    pats(ty, `
            (true, true, _),
            (true, _, true),
            (false, _, _),
        `),
    [[], [], []],
  );
  ty = { $: "Tuple", _0: [{ $: "Bool" }, { $: "Bool" }, { $: "U8" }] };
  assert_intersects(
    pats(ty, `
            (true, _, _),
            (_, true, 0..10),
            (_, true, 10..),
            (_, true, 3),
            _,
        `),
    [[], [], [], [1], [0, 1, 2, 3]],
  );
});
