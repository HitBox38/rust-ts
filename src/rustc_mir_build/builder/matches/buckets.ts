// Port of compiler/rustc_mir_build/src/builder/matches/buckets.rs (lane mb-matches-c; declared by builder-contract).
// `impl Builder` methods go on its prototype (builder/mod.ts header).
import { type Place } from "../../../rustc_middle/mir/mod.ts";
import { debug_Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { debug_AdtDef } from "../../../rustc_middle/ty/structural_impls.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { intern_key, intern_key_eq } from "../../../rust_ts/intern_key.ts";
import { type PartitionedCandidates } from "./buckets.gen.ts";
import { type Candidate, type Test, debug_Candidate } from "./mod.gen.ts";
import { TestableCase, TestBranch } from "./mod.ts";
import { Builder } from "../mod.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { PLAIN, PRETTY, debug_vec, format_debug } from "../../../std/fmt.ts";
import { assert_eq, panic } from "../../../std/panic.ts";
export * from "./buckets.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    // buckets.rs:58 (lane mb-matches-c)
    partition_candidates_into_buckets(match_place: Place, test: Test, candidates: Candidate[]): PartitionedCandidates;
    // buckets.rs:120 (lane mb-matches-c)
    choose_bucket_for_candidate(test_place: Place, test: Test, candidate: Candidate, prior_candidates: Map<TestBranch, Candidate[]>): TestBranch | undefined;
  }
}

// PORT: `Place`'s derived `PartialEq`: `local` by value, `projection` (an interned list) by identity.
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/// Given a test, we partition the input candidates into several buckets.
/// If a candidate matches in exactly one of the branches of `test`
/// (and no other branches), we put it into the corresponding bucket.
/// If it could match in more than one of the branches of `test`, the test
/// doesn't usefully apply to it, and we stop partitioning candidates.
///
/// Importantly, we also **mutate** the branched candidates to remove match pairs
/// that are entailed by the outcome of the test, and add any sub-pairs of the
/// removed pairs.
///
/// For example:
/// ```
/// # let (x, y, z) = (true, true, true);
/// match (x, y, z) {
///     (true , _    , true ) => true,  // (0)
///     (false, false, _    ) => false, // (1)
///     (_    , true , _    ) => true,  // (2)
///     (true , _    , false) => false, // (3)
/// }
/// # ;
/// ```
///
/// Assume we are testing on `x`. Conceptually, there are 2 overlapping candidate sets:
/// - If the outcome is that `x` is true, candidates {0, 2, 3} are possible
/// - If the outcome is that `x` is false, candidates {1, 2} are possible
///
/// Following our algorithm:
/// - Candidate 0 is bucketed into outcome `x == true`
/// - Candidate 1 is bucketed into outcome `x == false`
/// - Candidate 2 remains unbucketed, because testing `x` has no effect on it
/// - Candidate 3 remains unbucketed, because a previous candidate (2) was unbucketed
///   - This helps preserve the illusion that candidates are tested "in order"
///
/// The bucketed candidates are mutated to remove entailed match pairs:
/// - candidate 0 becomes `[z @ true]` since we know that `x` was `true`;
/// - candidate 1 becomes `[y @ false]` since we know that `x` was `false`.
// PORT: `candidates: &mut [&mut Candidate]` is the array; `remaining_candidates` (a subslice of it) is the
// array of the candidates after the bucketed ones (same `Candidate` objects). `target_candidates` is a `KeyedMap`
// keyed by `intern_key` (`TestBranch`'s derived `Eq`; builder/mod.ts header).
// rustc: compiler/rustc_mir_build/src/builder/matches/buckets.rs:58 partition_candidates_into_buckets
Builder.prototype.partition_candidates_into_buckets = function (this: Builder, match_place: Place, test: Test, candidates_: Candidate[]): PartitionedCandidates {
  // For each of the possible outcomes, collect a vector of candidates that apply if the test
  // has that particular outcome.
  const target_candidates = new KeyedMap<TestBranch, Candidate[]>(intern_key);

  const total_candidate_count = candidates_.length;

  // Partition the candidates into the appropriate vector in `target_candidates`.
  // Note that at some point we may encounter a candidate where the test is not relevant;
  // at that point, we stop partitioning.
  let start = 0;
  while (start < candidates_.length) {
    const candidate = candidates_[start]!;
    const branch = this.choose_bucket_for_candidate(match_place, test, candidate, target_candidates);
    if (branch === undefined) {
      break;
    }
    let bucket = target_candidates.get(branch);
    if (bucket === undefined) {
      bucket = [];
      target_candidates.set(branch, bucket);
    }
    bucket.push(candidate);
    start += 1;
  }
  const candidates = candidates_.slice(start);

  // At least the first candidate ought to be tested
  // PORT: `assert!(cond, fmt..)` formats its message only when it fails.
  if (!(total_candidate_count > candidates.length)) {
    panic(`${total_candidate_count}, ${format_debug(candidates, (v, f) => debug_vec(v, f, debug_Candidate), PRETTY)}`);
  }
  // debug!("tested_candidates: {}", total_candidate_count - candidates.len());
  // debug!("untested_candidates: {}", candidates.len());

  return { target_candidates, remaining_candidates: candidates };
};

/// Given that we are performing `test` against `test_place`, this job
/// sorts out what the status of `candidate` will be after the test. See
/// `test_candidates` for the usage of this function. The candidate may
/// be modified to update its `match_pairs`.
///
/// So, for example, if this candidate is `x @ Some(P0)` and the `Test` is
/// a variant test, then we would modify the candidate to be `(x as
/// Option).0 @ P0` and return the index corresponding to the variant
/// `Some`.
///
/// However, in some cases, the test may just not be relevant to candidate.
/// For example, suppose we are testing whether `foo.x == 22`, but in one
/// match arm we have `Foo { x: _, ... }`... in that case, the test for
/// the value of `x` has no particular relevance to this candidate. In
/// such cases, this function just returns None without doing anything.
/// This is used by the overall `match_candidates` algorithm to structure
/// the match as a whole. See `match_candidates` for more details.
///
/// FIXME(#29623). In some cases, we have some tricky choices to make. for
/// example, if we are testing that `x == 22`, but the candidate is `x @
/// 13..55`, what should we do? In the event that the test is true, we know
/// that the candidate applies, but in the event of false, we don't know
/// that it *doesn't* apply. For now, we return false, indicate that the
/// test does not apply to this candidate, but it might be we can get
/// tighter match code if we do something a bit different.
// rustc: compiler/rustc_mir_build/src/builder/matches/buckets.rs:120 choose_bucket_for_candidate
Builder.prototype.choose_bucket_for_candidate = function (this: Builder, test_place: Place, test: Test, candidate: Candidate, prior_candidates: Map<TestBranch, Candidate[]>): TestBranch | undefined {
  // Find the match_pair for this place (if any). At present,
  // afaik, there can be at most one. (In the future, if we
  // adopted a more general `@` operator, there might be more
  // than one, but it'd be very unusual to have two sides that
  // both require tests; you'd expect one side to be simplified
  // away.)
  let found: [number, TestableCase] | undefined;
  for (let i = 0; i < candidate.match_pairs.length; i++) {
    const mp = candidate.match_pairs[i]!;
    if (mp.kind.$ === "Testable" && place_eq(mp.kind.place, test_place)) {
      found = [i, mp.kind.testable_case];
      break;
    }
  }
  if (found === undefined) return undefined;
  const [match_pair_index, match_pair_testable_case] = found;

  // If true, the match pair is completely entailed by its corresponding test
  // branch, so it can be removed. If false, the match pair is _compatible_
  // with its test branch, but still needs a more specific test.
  let fully_matched: boolean;
  let ret: TestBranch | undefined;
  const test_kind = test.kind;
  const case_ = match_pair_testable_case;
  // If we are performing a variant switch, then this
  // informs variant patterns, but nothing else.
  if (test_kind.$ === "Switch" && case_.$ === "Variant") {
    const tested_adt_def = test_kind.adt_def;
    const { adt_def, variant_index } = case_;
    assert_eq(adt_def, tested_adt_def, (v) => debug_AdtDef(v, PLAIN));
    fully_matched = true;
    ret = { $: "Variant", _0: variant_index };
  }
  // If we are performing a switch over integers, then this informs integer
  // equality, but nothing else.
  //
  // FIXME(#29623) we could use PatKind::Range to rule
  // things out here, in some cases.
  else if (test_kind.$ === "SwitchInt" && case_.$ === "Constant" && case_.kind === "IntOrChar") {
    const value = case_.value;
    // An important invariant of candidate bucketing is that a candidate
    // must not match in multiple branches. For `SwitchInt` tests, adding
    // a new value might invalidate that property for range patterns that
    // have already been partitioned into the failure arm, so we must take care
    // not to add such values here.
    const is_covering_range = (testable_case: TestableCase): boolean => {
      const range = TestableCase.as_range(testable_case);
      return range !== undefined && range.contains(value, this.tcx) !== false;
    };
    const is_conflicting_candidate = (candidate: Candidate): boolean =>
      candidate.match_pairs.some(
        (mp) => mp.kind.$ === "Testable" && place_eq(mp.kind.place, test_place) && is_covering_range(mp.kind.testable_case),
      );
    const failure_candidates = prior_candidates.get(TestBranch.Failure);
    if (failure_candidates !== undefined && failure_candidates.some(is_conflicting_candidate)) {
      fully_matched = false;
      ret = undefined;
    } else {
      fully_matched = true;
      ret = { $: "Constant", _0: value };
    }
  } else if (test_kind.$ === "SwitchInt" && case_.$ === "Range") {
    const range = case_._0;
    // When performing a `SwitchInt` test, a range pattern can be
    // sorted into the failure arm if it doesn't contain _any_ of
    // the values being tested. (This restricts what values can be
    // added to the test by subsequent candidates.)
    fully_matched = false;
    let not_contained = true;
    for (const br of prior_candidates.keys()) {
      const val = TestBranch.as_constant(br);
      if (val === undefined) continue;
      if (!(range.contains(val, this.tcx) === false)) {
        not_contained = false;
        break;
      }
    }

    // No switch values are contained in the pattern range,
    // so the pattern can be matched only if this test fails.
    ret = not_contained ? TestBranch.Failure : undefined;
  } else if (test_kind.$ === "If" && case_.$ === "Constant" && case_.kind === "Bool") {
    const value_ = case_.value;
    fully_matched = true;
    const value = Value.try_to_bool(value_) ?? span_bug(test.span, `expected boolean value but got ${debug_Value(value_, PLAIN)}`);
    ret = value ? TestBranch.Success : TestBranch.Failure;
  }
  // Determine how the proposed slice-length test interacts with the
  // slice pattern we're currently looking at.
  //
  // Keep in mind the invariant that a case is not allowed to succeed
  // on multiple arms of the same test. For example, even though the
  // test `len == 4` logically implies `len >= 4` on its success arm,
  // the case `len >= 4` could also succeed on the test's failure arm,
  // so it can't be included in the success bucket or failure bucket.
  else if (test_kind.$ === "SliceLen" && test_kind.op === "Equal" && case_.$ === "Slice") {
    const test_len = test_kind.len;
    const { len: pat_len, op: pat_op } = case_;
    const ord = test_len < pat_len ? "Less" : test_len > pat_len ? "Greater" : "Equal";
    if (ord === "Equal" && pat_op === "Equal") {
      // E.g. test is `len == 4` and pattern is `len == 4`.
      // Pattern is fully matched on the success arm.
      fully_matched = true;
      ret = TestBranch.Success;
    } else if (ord === "Less") {
      // E.g. test is `len == 4` and pattern is `len == 5` or `len >= 5`.
      // Pattern can only succeed on the failure arm, but isn't fully matched.
      fully_matched = false;
      ret = TestBranch.Failure;
    } else if ((ord === "Equal" || ord === "Greater") && pat_op === "GreaterOrEqual") {
      // E.g. test is `len == 4` and pattern is `len >= 4` or `len >= 3`.
      // Pattern could succeed on both arms, so it can't be bucketed.
      fully_matched = false;
      ret = undefined;
    } else {
      // (Ordering::Greater, SliceLenOp::Equal)
      // E.g. test is `len == 4` and pattern is `len == 3`.
      // Pattern can only succeed on the failure arm, but isn't fully matched.
      fully_matched = false;
      ret = TestBranch.Failure;
    }
  } else if (test_kind.$ === "SliceLen" && test_kind.op === "GreaterOrEqual" && case_.$ === "Slice") {
    const test_len = test_kind.len;
    const { len: pat_len, op: pat_op } = case_;
    const ord = test_len < pat_len ? "Less" : test_len > pat_len ? "Greater" : "Equal";
    if (ord === "Equal" && pat_op === "GreaterOrEqual") {
      // E.g. test is `len >= 4` and pattern is `len >= 4`.
      // Pattern is fully matched on the success arm.
      fully_matched = true;
      ret = TestBranch.Success;
    } else if (ord === "Less" || (ord === "Equal" && pat_op === "Equal")) {
      // E.g. test is `len >= 4` and pattern is `len == 5` or `len >= 5` or `len == 4`.
      // Pattern can only succeed on the success arm, but isn't fully matched.
      fully_matched = false;
      ret = TestBranch.Success;
    } else if (ord === "Greater" && pat_op === "Equal") {
      // E.g. test is `len >= 4` and pattern is `len == 3`.
      // Pattern can only succeed on the failure arm, but isn't fully matched.
      fully_matched = false;
      ret = TestBranch.Failure;
    } else {
      // (Ordering::Greater, SliceLenOp::GreaterOrEqual)
      // E.g. test is `len >= 4` and pattern is `len >= 3`.
      // Pattern could succeed on both arms, so it can't be bucketed.
      fully_matched = false;
      ret = undefined;
    }
  } else if (test_kind.$ === "Range" && case_.$ === "Range") {
    const test_ = test_kind._0;
    const pat = case_._0;
    // PORT: `Arc<PatRange>`'s `PartialEq` compares the ranges by value (derived `PartialEq`: interned `Ty` /
    // `ValTree` by identity, the rest by value), which is `intern_key_eq`.
    if (intern_key_eq(test_, pat)) {
      fully_matched = true;
      ret = TestBranch.Success;
    } else {
      fully_matched = false;
      // If the testing range does not overlap with pattern range,
      // the pattern can be matched only if this test fails.
      const overlaps = test_.overlaps(pat, this.tcx);
      if (overlaps === undefined) return undefined;
      if (!overlaps) {
        ret = TestBranch.Failure;
      } else {
        ret = undefined;
      }
    }
  } else if (
    test_kind.$ === "Range" &&
    case_.$ === "Constant" &&
    (case_.kind === "Bool" || case_.kind === "IntOrChar" || case_.kind === "Float")
  ) {
    const range = test_kind._0;
    const value = case_.value;
    fully_matched = false;
    const contains = range.contains(value, this.tcx);
    if (contains === undefined) return undefined;
    if (!contains) {
      // `value` is not contained in the testing range,
      // so `value` can be matched only if this test fails.
      ret = TestBranch.Failure;
    } else {
      ret = undefined;
    }
  } else if (
    (test_kind.$ === "StringEq" && case_.$ === "Constant" && case_.kind === "String") ||
    (test_kind.$ === "ScalarEq" && case_.$ === "Constant" && (case_.kind === "Float" || case_.kind === "Other"))
  ) {
    const test_val = test_kind.value;
    const case_val = case_.value;
    // PORT: `ty::Value`'s derived `PartialEq`: the interned `ty` and `valtree` by identity.
    if (test_val.ty === case_val.ty && test_val.valtree === case_val.valtree) {
      fully_matched = true;
      ret = TestBranch.Success;
    } else {
      fully_matched = false;
      ret = TestBranch.Failure;
    }
  } else if (test_kind.$ === "Deref" && case_.$ === "Deref" && place_eq(test_kind.temp, case_.temp)) {
    fully_matched = true;
    ret = TestBranch.Success;
  } else if (test_kind.$ === "Never") {
    fully_matched = true;
    ret = TestBranch.Success;
  } else {
    // (Switch | SwitchInt | If | SliceLen | Range | StringEq | ScalarEq | Deref, _)
    fully_matched = false;
    ret = undefined;
  }

  if (fully_matched) {
    // Replace the match pair by its sub-pairs.
    const match_pair = candidate.match_pairs.splice(match_pair_index, 1)[0]!;
    if (match_pair.kind.$ !== "Testable") {
      return bug("match pair must have been refutable");
    }
    const subpairs = match_pair.kind.subpairs;
    candidate.match_pairs.push(...subpairs);
    // Move or-patterns to the end.
    candidate.sort_match_pairs();
  }

  return ret;
};
