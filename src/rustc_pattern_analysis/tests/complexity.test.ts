//! Test the pattern complexity limit.
//
// Port of compiler/rustc_pattern_analysis/tests/complexity.rs (lane pat-b). `pat!(ty; ..)` is `pat(ty, "..")`
// (common/mod.ts).
import { expect, test } from "bun:test";
import { type CxTypes, compute_match_usefulness, pat, type Ty } from "./common/mod.ts";
import type { MatchArm } from "../lib.ts";
import type { DeconstructedPat } from "../pat.ts";
import { PlaceValidity } from "../usefulness.ts";
import { Ok, type Result } from "../../std/result.ts";

/// Analyze a match made of these patterns. Ignore the report; we only care whether we exceeded the
/// limit or not.
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:15 check
function check(patterns: readonly DeconstructedPat<CxTypes>[], complexity_limit: number): Result<null, null> {
  const ty = patterns[0]!.ty();
  const arms: MatchArm<CxTypes>[] = patterns.map((pat) => ({ pat, has_guard: false, arm_data: null }));
  const r = compute_match_usefulness(arms, ty, PlaceValidity.ValidOnly, complexity_limit, false);
  // `.map(|_report| ())`
  return r.$ === "Ok" ? Ok(null) : r;
}

/// Asserts that analyzing this match takes exactly `complexity` steps.
// #[track_caller]
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:25 assert_complexity
function assert_complexity(patterns: DeconstructedPat<CxTypes>[], complexity: number): void {
  expect(check(patterns, complexity).$ === "Ok").toBe(true);
  expect(check(patterns, complexity - 1).$ === "Err").toBe(true);
}

/// Construct a match like:
/// ```ignore(illustrative)
/// match ... {
///     BigStruct { field01: true, .. } => {}
///     BigStruct { field02: true, .. } => {}
///     BigStruct { field03: true, .. } => {}
///     BigStruct { field04: true, .. } => {}
///     ...
///     _ => {}
/// }
/// ```
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:41 diagonal_match
function diagonal_match(arity: number): DeconstructedPat<CxTypes>[] {
  const struct_ty: Ty = { $: "BigStruct", arity, ty: { $: "Bool" } };
  const patterns: DeconstructedPat<CxTypes>[] = [];
  for (let i = 0; i < arity; i++) {
    patterns.push(pat(struct_ty, `Struct { .${i}: true }`));
  }
  patterns.push(pat(struct_ty, `_`));
  return patterns;
}

/// Construct a match like:
/// ```ignore(illustrative)
/// match ... {
///     BigStruct { field01: true, .. } => {}
///     BigStruct { field02: true, .. } => {}
///     BigStruct { field03: true, .. } => {}
///     BigStruct { field04: true, .. } => {}
///     ...
///     BigStruct { field01: false, .. } => {}
///     BigStruct { field02: false, .. } => {}
///     BigStruct { field03: false, .. } => {}
///     BigStruct { field04: false, .. } => {}
///     ...
///     _ => {}
/// }
/// ```
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:67 diagonal_exponential_match
function diagonal_exponential_match(arity: number): DeconstructedPat<CxTypes>[] {
  const struct_ty: Ty = { $: "BigStruct", arity, ty: { $: "Bool" } };
  const patterns: DeconstructedPat<CxTypes>[] = [];
  for (let i = 0; i < arity; i++) {
    patterns.push(pat(struct_ty, `Struct { .${i}: true }`));
  }
  for (let i = 0; i < arity; i++) {
    patterns.push(pat(struct_ty, `Struct { .${i}: false }`));
  }
  patterns.push(pat(struct_ty, `_`));
  return patterns;
}

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:81 test_diagonal_struct_match
test("test_diagonal_struct_match", () => {
  // These cases are nicely linear: we check `arity` patterns with exactly one `true`, matching
  // in 2 branches each, and a final pattern with all `false`, matching only the `_` branch.
  assert_complexity(diagonal_match(20), 41);
  assert_complexity(diagonal_match(30), 61);
  // This case goes exponential.
  expect(check(diagonal_exponential_match(10), 10000).$ === "Err").toBe(true);
});

/// Construct a match like:
/// ```ignore(illustrative)
/// match ... {
///     BigEnum::Variant1(_) => {}
///     BigEnum::Variant2(_) => {}
///     BigEnum::Variant3(_) => {}
///     ...
///     _ => {}
/// }
/// ```
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:100 big_enum
function big_enum(arity: number): DeconstructedPat<CxTypes>[] {
  const enum_ty: Ty = { $: "BigEnum", arity, ty: { $: "Bool" } };
  const patterns: DeconstructedPat<CxTypes>[] = [];
  for (let i = 0; i < arity; i++) {
    patterns.push(pat(enum_ty, `Variant.${i}`));
  }
  patterns.push(pat(enum_ty, `_`));
  return patterns;
}

// #[test]
// rustc: compiler/rustc_pattern_analysis/tests/complexity.rs:111 test_big_enum
test("test_big_enum", () => {
  // We try 2 branches per variant.
  assert_complexity(big_enum(20), 40);
});
