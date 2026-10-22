// Port of compiler/rustc_mir_build/src/builder/matches/util.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-matches-c; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type BasicBlock, type BorrowKind, type FakeBorrowKind, type Local, type Place, type SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import { type PlaceBase } from "../expr/as_place.gen.ts";
import { type Binding, type Candidate, type FlatPat, type MatchPairTree } from "./mod.gen.ts";
import { Builder } from "../mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
import { FakeBorrowCollector } from "./util.gen.ts";
export * from "./util.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    // util.rs:17 (lane mb-matches-c)
    false_edges(from_block: BasicBlock, real_target: BasicBlock, imaginary_target: BasicBlock, source_info: SourceInfo): void;
  }
}

declare module "./util.gen.ts" {
  interface FakeBorrowCollector {
    // util.rs:117 (lane mb-matches-c)
    fake_borrow(place: Place, kind: FakeBorrowKind): void;
    // util.rs:127 (lane mb-matches-c)
    fake_borrow_deref_prefixes(place: Place, kind: FakeBorrowKind): void;
    // util.rs:141 (lane mb-matches-c)
    visit_candidate(candidate: Candidate): void;
    // util.rs:152 (lane mb-matches-c)
    visit_flat_pat(flat_pat: FlatPat): void;
    // util.rs:163 (lane mb-matches-c)
    visit_match_pair(match_pair: MatchPairTree): void;
    // util.rs:198 (lane mb-matches-c)
    visit_binding({ source }: Binding): void;
  }
}

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:17 false_edges (lane mb-matches-c)
Builder.prototype.false_edges = function (this: Builder, from_block: BasicBlock, real_target: BasicBlock, imaginary_target: BasicBlock, source_info: SourceInfo): void {
  return unported("rustc_mir_build::builder::matches::util::Builder::false_edges");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:71 collect_fake_borrows (lane mb-matches-c)
export function collect_fake_borrows(cx: Builder, candidates: readonly Candidate[], temp_span: Span, scrutinee_base: PlaceBase): [Place, Local, FakeBorrowKind][] {
  return unported("rustc_mir_build::builder::matches::util::collect_fake_borrows");
}

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:117 fake_borrow (lane mb-matches-c)
FakeBorrowCollector.prototype.fake_borrow = function (this: FakeBorrowCollector, place: Place, kind: FakeBorrowKind): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::fake_borrow");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:127 fake_borrow_deref_prefixes (lane mb-matches-c)
FakeBorrowCollector.prototype.fake_borrow_deref_prefixes = function (this: FakeBorrowCollector, place: Place, kind: FakeBorrowKind): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::fake_borrow_deref_prefixes");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:141 visit_candidate (lane mb-matches-c)
FakeBorrowCollector.prototype.visit_candidate = function (this: FakeBorrowCollector, candidate: Candidate): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::visit_candidate");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:152 visit_flat_pat (lane mb-matches-c)
FakeBorrowCollector.prototype.visit_flat_pat = function (this: FakeBorrowCollector, flat_pat: FlatPat): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::visit_flat_pat");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:163 visit_match_pair (lane mb-matches-c)
FakeBorrowCollector.prototype.visit_match_pair = function (this: FakeBorrowCollector, match_pair: MatchPairTree): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::visit_match_pair");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:198 visit_binding (lane mb-matches-c)
FakeBorrowCollector.prototype.visit_binding = function (this: FakeBorrowCollector, { source }: Binding): void {
  return unported("rustc_mir_build::builder::matches::util::FakeBorrowCollector::visit_binding");
};

// stub: compiler/rustc_mir_build/src/builder/matches/util.rs:234 ref_pat_borrow_kind (lane mb-matches-c)
export function ref_pat_borrow_kind(ref_mutability: Mutability): BorrowKind {
  return unported("rustc_mir_build::builder::matches::util::ref_pat_borrow_kind");
}
