// Port of compiler/rustc_mir_build/src/builder/matches/buckets.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-matches-c; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Place } from "../../../rustc_middle/mir/mod.ts";
import { type PartitionedCandidates } from "./buckets.gen.ts";
import { type Candidate, type Test } from "./mod.gen.ts";
import { type TestBranch } from "./mod.ts";
import { Builder } from "../mod.ts";
import { unported } from "../../../std/panic.ts";
export * from "./buckets.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    // buckets.rs:58 (lane mb-matches-c)
    partition_candidates_into_buckets(match_place: Place, test: Test, candidates: Candidate[]): PartitionedCandidates;
    // buckets.rs:120 (lane mb-matches-c)
    choose_bucket_for_candidate(test_place: Place, test: Test, candidate: Candidate, prior_candidates: Map<TestBranch, Candidate[]>): TestBranch | undefined;
  }
}

// stub: compiler/rustc_mir_build/src/builder/matches/buckets.rs:58 partition_candidates_into_buckets (lane mb-matches-c)
Builder.prototype.partition_candidates_into_buckets = function (this: Builder, match_place: Place, test: Test, candidates: Candidate[]): PartitionedCandidates {
  return unported("rustc_mir_build::builder::matches::buckets::Builder::partition_candidates_into_buckets");
};

// stub: compiler/rustc_mir_build/src/builder/matches/buckets.rs:120 choose_bucket_for_candidate (lane mb-matches-c)
Builder.prototype.choose_bucket_for_candidate = function (this: Builder, test_place: Place, test: Test, candidate: Candidate, prior_candidates: Map<TestBranch, Candidate[]>): TestBranch | undefined {
  return unported("rustc_mir_build::builder::matches::buckets::Builder::choose_bucket_for_candidate");
};
