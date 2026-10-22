//! Test exhaustiveness checking.
//
// Port of compiler/rustc_pattern_analysis/tests/exhaustiveness.rs (lane pat-b). `pats!(ty; ..)` is `pats(ty, "..")`
// (common/mod.ts). The tests need lane pat-a's usefulness.rs: skipped until it is ported (`USEFULNESS_PORTED`).
import { expect, test } from "bun:test";
import { type CxTypes, CX_STATIC, compute_match_usefulness, NEVER, pats, type Ty, UNIT, USEFULNESS_PORTED } from "./common/mod.ts";
import type { MatchArm } from "../lib.ts";
import { type DeconstructedPat, debug_WitnessPat, type WitnessPat } from "../pat.ts";
import { PlaceValidity } from "../usefulness.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";

const SKIP = !USEFULNESS_PORTED;

/// Analyze a match made of these patterns.
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:14 run
function run(ty: Ty, patterns: DeconstructedPat<CxTypes>[], exhaustive_witnesses: boolean): WitnessPat<CxTypes>[] {
  const arms: MatchArm<CxTypes>[] = patterns.map((pat) => ({ pat, has_guard: false, arm_data: null }));
  const report = unwrap_result(
    compute_match_usefulness(arms, ty, PlaceValidity.ValidOnly, Number.MAX_SAFE_INTEGER, exhaustive_witnesses),
  );
  return report.non_exhaustiveness_witnesses;
}

/// Analyze a match made of these patterns. Panics if there are no patterns
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:33 check
function check(patterns: DeconstructedPat<CxTypes>[]): WitnessPat<CxTypes>[] {
  const ty = patterns[0]!.ty();
  return run(ty, patterns, true);
}

// #[track_caller]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:39 assert_exhaustive
function assert_exhaustive(patterns: DeconstructedPat<CxTypes>[]): void {
  const witnesses = check(patterns);
  if (witnesses.length !== 0) {
    panic(`non-exhaustive match: missing ${debug_vec(witnesses, PLAIN, debug_WitnessPat(CX_STATIC))}`);
  }
}

// #[track_caller]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:47 assert_non_exhaustive
function assert_non_exhaustive(patterns: DeconstructedPat<CxTypes>[]): void {
  const witnesses = check(patterns);
  expect(witnesses.length !== 0).toBe(true);
}

// use WhichWitnesses::*;
// rustc-type: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:53 WhichWitnesses
type WhichWitnesses = "AllOfThem" | "OnlySome";
const AllOfThem: WhichWitnesses = "AllOfThem";
const OnlySome: WhichWitnesses = "OnlySome";

// #[track_caller]
/// We take the type as input to support empty matches.
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:60 assert_witnesses
function assert_witnesses(which: WhichWitnesses, ty: Ty, patterns: DeconstructedPat<CxTypes>[], expected: string[]): void {
  const exhaustive_wit = which === AllOfThem;
  const witnesses = run(ty, patterns, exhaustive_wit);
  const debug = debug_WitnessPat(CX_STATIC);
  const witnesses_ = witnesses.map((w) => debug(w, PLAIN));
  expect(witnesses_).toEqual(expected);
}

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:73 test_int_ranges
test.skipIf(SKIP)("test_int_ranges", () => {
  const ty: Ty = { $: "U8" };
  assert_exhaustive(pats(ty, `
        0..=255,
    `));
  assert_exhaustive(pats(ty, `
        0..,
    `));
  assert_non_exhaustive(pats(ty, `
        0..255,
    `));
  assert_exhaustive(pats(ty, `
        0..255,
        255,
    `));
  assert_exhaustive(pats(ty, `
        ..10,
        10..
    `));
});

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:95 test_nested
test.skipIf(SKIP)("test_nested", () => {
  // enum E { A(bool), B(bool) }
  // ty = (E, E)
  const ty: Ty = { $: "BigStruct", arity: 2, ty: { $: "BigEnum", arity: 2, ty: { $: "Bool" } } };
  assert_non_exhaustive(pats(ty, `
        Struct(Variant.0, _),
    `));
  assert_exhaustive(pats(ty, `
        Struct(Variant.0, _),
        Struct(Variant.1, _),
    `));
  assert_non_exhaustive(pats(ty, `
        Struct(Variant.0, _),
        Struct(_, Variant.0),
    `));
  assert_exhaustive(pats(ty, `
        Struct(Variant.0, _),
        Struct(_, Variant.0),
        Struct(Variant.1, Variant.1),
    `));
});

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:118 test_witnesses
test.skipIf(SKIP)("test_witnesses", () => {
  // TY = Option<bool>
  const TY: Ty = { $: "Enum", _0: [{ $: "Bool" }, UNIT] };
  // ty = (Option<bool>, Option<bool>)
  let ty: Ty = { $: "Tuple", _0: [TY, TY] };
  assert_witnesses(AllOfThem, ty, [], ["(_, _)"]);
  assert_witnesses(
    OnlySome,
    ty,
    pats(ty, `
            (Variant.0(false), Variant.0(false)),
        `),
    ["(Enum::Variant1(_), _)"],
  );
  assert_witnesses(
    AllOfThem,
    ty,
    pats(ty, `
            (Variant.0(false), Variant.0(false)),
        `),
    [
      "(Enum::Variant0(false), Enum::Variant0(true))",
      "(Enum::Variant0(false), Enum::Variant1(_))",
      "(Enum::Variant0(true), _)",
      "(Enum::Variant1(_), _)",
    ],
  );
  assert_witnesses(
    OnlySome,
    ty,
    pats(ty, `
            (_, Variant.0(false)),
        `),
    ["(_, Enum::Variant1(_))"],
  );
  assert_witnesses(
    AllOfThem,
    ty,
    pats(ty, `
            (_, Variant.0(false)),
        `),
    ["(_, Enum::Variant0(true))", "(_, Enum::Variant1(_))"],
  );

  ty = { $: "NonExhaustiveEnum", _0: [UNIT, UNIT, UNIT] };
  assert_witnesses(
    OnlySome,
    ty,
    pats(ty, `
            Variant.0,
        `),
    ["_"],
  );
  assert_witnesses(
    AllOfThem,
    ty,
    pats(ty, `
            Variant.0,
        `),
    ["Enum::Variant1(_)", "Enum::Variant2(_)", "_"],
  );

  // Assert we put `true` before `false`.
  assert_witnesses(AllOfThem, { $: "Bool" }, [], ["true", "false"]);
});

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/exhaustiveness.rs:185 test_empty
test.skipIf(SKIP)("test_empty", () => {
  // `TY = Result<bool, !>`
  const TY: Ty = { $: "Enum", _0: [{ $: "Bool" }, NEVER] };
  assert_exhaustive(pats(TY, `
        Variant.0,
    `));
  const ty: Ty = { $: "Tuple", _0: [{ $: "Bool" }, TY] };
  assert_exhaustive(pats(ty, `
        (true, Variant.0),
        (false, Variant.0),
    `));
});
