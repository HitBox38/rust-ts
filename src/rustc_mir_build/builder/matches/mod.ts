// Port of compiler/rustc_mir_build/src/builder/matches/mod.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lanes
// mb-matches-a, mb-matches-b; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BindingMode } from "../../../rustc_ast/lib.ts";
import { type Scope as region_Scope } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type FakeBorrowKind, type Local, type Place, type Rvalue, type SourceInfo, type SourceScope, type UserTypeProjections } from "../../../rustc_middle/mir/mod.ts";
import { type Arm, type ArmId, type ExprId, type LocalVarId, type Pat, type PatRange } from "../../../rustc_middle/thir.ts";
import { type ValTree, type Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type PlaceBuilder } from "../expr/as_place.gen.ts";
import { Candidate, LowerIfCondArgs, MatchTreeBranch, MatchTreeSubBranch, PatternExtraData, type ArmHasGuard, type Ascription, type Binding, type BuiltMatchTree, type DeclareLetBindings, type Exhaustive, type FlatPat, type HasMatchGuard, type MatchPairTree, type ScheduleDrops, type SubpatternBindings, type Test } from "./mod.gen.ts";
import { type ProjectedUserTypesNode } from "./user_ty.ts";
import { Builder, type BlockAnd, type ForGuard } from "../mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { unported } from "../../../std/panic.ts";
// PORT: rustc_pattern_analysis is not ported (wave 22 lanes pat-a/-b/-c): its types are pending.
type RustcPatCtxt = unknown;
type DeconstructedPat = unknown;
import * as gen from "./mod.gen.ts";
export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface LowerIfCondArgs {
    // mod.rs:60 (lane mb-matches-a)
    let_not_permitted(): LowerIfCondArgs;
  }
  interface PatternExtraData {
    // mod.rs:952 (lane mb-matches-a)
    is_empty(): boolean;
  }
  interface Candidate {
    // mod.rs:1098 (lane mb-matches-a)
    sort_match_pairs(): void;
    // mod.rs:1103 (lane mb-matches-a)
    starts_with_or_pattern(): boolean;
    // mod.rs:1112 (lane mb-matches-a)
    visit_leaves(visit_leaf: (this_: Candidate) => void): void;
    // mod.rs:1123 (lane mb-matches-a)
    visit_leaves_rev(visit_leaf: (this_: Candidate) => void): void;
  }
  namespace Candidate {
    // mod.rs:1067 (lane mb-matches-a)
    function new_(place: PlaceBuilder, pattern: Pat, has_guard: HasMatchGuard, cx: Builder): Candidate;
    export { new_ as new };
    // mod.rs:1082 (lane mb-matches-a)
    export function from_flat_pat(flat_pat: FlatPat, has_guard: boolean): Candidate;
  }
  namespace MatchTreeSubBranch {
    // mod.rs:1419 (lane mb-matches-a)
    export function from_sub_candidate(candidate: Candidate, parent_data: PatternExtraData[]): MatchTreeSubBranch;
  }
  namespace MatchTreeBranch {
    // mod.rs:1441 (lane mb-matches-a)
    export function from_candidate(candidate: Candidate): MatchTreeBranch;
  }
}

declare module "../mod.ts" {
  interface Builder {
    // mod.rs:102 (lane mb-matches-a)
    lower_if_condition(block: BasicBlock, expr_id: ExprId, args: LowerIfCondArgs): BlockAnd<null>;
    // mod.rs:335 (lane mb-matches-a)
    match_expr(destination: Place, block: BasicBlock, scrutinee_id: ExprId, arms: readonly ArmId[], span: Span): BlockAnd<null>;
    // mod.rs:376 (lane mb-matches-a)
    lower_scrutinee(block: BasicBlock, scrutinee_id: ExprId): BlockAnd<PlaceBuilder>;
    // mod.rs:396 (lane mb-matches-a)
    lower_match_arms(destination: Place, scrutinee_place_builder: PlaceBuilder, scrutinee_span: Span, arms: readonly ArmId[], built_match_tree: BuiltMatchTree, outer_source_info: SourceInfo): BlockAnd<null>;
    // mod.rs:499 (lane mb-matches-a)
    bind_pattern(outer_source_info: SourceInfo, branch: MatchTreeBranch, fake_borrow_temps: readonly [Place, Local, FakeBorrowKind][], scrutinee_span: Span, arm_match_scope: [Arm, region_Scope] | undefined): BasicBlock;
    // mod.rs:553 (lane mb-matches-a)
    expr_into_pattern(block: BasicBlock, irrefutable_pat: Pat, initializer_id: ExprId): BlockAnd<null>;
    // mod.rs:619 (lane mb-matches-a)
    place_into_pattern(block: BasicBlock, irrefutable_pat: Pat, initializer: PlaceBuilder, set_match_place: boolean): BlockAnd<null>;
    // mod.rs:687 (lane mb-matches-a)
    declare_bindings(visibility_scope: SourceScope | undefined, scope_span: Span, pattern: Pat, guard: ExprId | undefined, opt_match_place: [Place | undefined, Span] | undefined): SourceScope | undefined;
    // mod.rs:730 (lane mb-matches-a)
    declare_guard_bindings(guard_expr: ExprId, scope_span: Span, visibility_scope: SourceScope | undefined): void;
    // mod.rs:757 (lane mb-matches-a)
    storage_live_binding(block: BasicBlock, var_: LocalVarId, span: Span, is_shorthand: boolean, for_guard: ForGuard, schedule_drop: ScheduleDrops): Place;
    // mod.rs:783 (lane mb-matches-a)
    schedule_drop_for_binding(var_: LocalVarId, span: Span, for_guard: ForGuard): void;
    // mod.rs:801 (lane mb-matches-a)
    visit_primary_bindings(pattern: Pat, f: (this_: Builder, a1: LocalVarId, a2: Span) => void): void;
    // mod.rs:820 (lane mb-matches-a)
    visit_primary_bindings_special(pattern: Pat, user_tys: ProjectedUserTypesNode, f: (this_: Builder, a1: Symbol, a2: BindingMode, a3: LocalVarId, a4: Span, a5: Ty, a6: ProjectedUserTypesNode) => void): void;
    // mod.rs:1547 (lane mb-matches-b)
    lower_match_tree(block: BasicBlock, scrutinee_span: Span, scrutinee_place_builder: PlaceBuilder, match_start_span: Span, patterns: [Pat, HasMatchGuard][], exhaustive: Exhaustive): BuiltMatchTree;
    // mod.rs:1721 (lane mb-matches-b)
    match_candidates(span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BasicBlock;
    // mod.rs:1733 (lane mb-matches-b)
    match_candidates_inner(span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BasicBlock;
    // mod.rs:1805 (lane mb-matches-b)
    select_matched_candidate(candidate: Candidate, start_block: BasicBlock): BasicBlock;
    // mod.rs:1825 (lane mb-matches-b)
    expand_and_match_or_candidates(span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BlockAnd<Candidate[]>;
    // mod.rs:1925 (lane mb-matches-b)
    create_or_subcandidates(candidate: Candidate, match_pair: MatchPairTree): void;
    // mod.rs:1997 (lane mb-matches-b)
    merge_trivial_subcandidates(candidate: Candidate): void;
    // mod.rs:2040 (lane mb-matches-b)
    remove_never_subcandidates(candidate: Candidate): void;
    // mod.rs:2075 (lane mb-matches-b)
    test_remaining_match_pairs_after_or(span: Span, scrutinee_span: Span, candidate: Candidate): void;
    // mod.rs:2145 (lane mb-matches-b)
    pick_test(candidates: readonly Candidate[]): [Place, Test];
    // mod.rs:2255 (lane mb-matches-b)
    test_candidates(span: Span, scrutinee_span: Span, candidates: Candidate[], start_block: BasicBlock): BlockAnd<Candidate[]>;
    // mod.rs:2321 (lane mb-matches-b)
    lower_fallible_let(block: BasicBlock, pat: Pat, scrutinee_id: ExprId, source_scope: SourceScope | undefined, scope_span: Span, declare_let_bindings: DeclareLetBindings): BlockAnd<null>;
    // mod.rs:2388 (lane mb-matches-b)
    bind_and_guard_matched_candidate(sub_branch: MatchTreeSubBranch, fake_borrows: readonly [Place, Local, FakeBorrowKind][], scrutinee_span: Span, arm_match_scope: [Arm, region_Scope] | undefined, schedule_drops: ScheduleDrops): BasicBlock;
    // mod.rs:2534 (lane mb-matches-b)
    ascribe_types(block: BasicBlock, ascriptions: Iterable<Ascription>): void;
    // mod.rs:2635 (lane mb-matches-b)
    bind_matched_candidate_for_guard(block: BasicBlock, bindings: Iterable<Binding>): void;
    // mod.rs:2700 (lane mb-matches-b)
    bind_matched_candidate_for_arm_body(block: BasicBlock, schedule_drops: ScheduleDrops, bindings: Iterable<Binding>): void;
    // mod.rs:2749 (lane mb-matches-b)
    pin_borrowed_local(block: BasicBlock, local: Local, borrow: Rvalue, source_info: SourceInfo): Rvalue;
    // mod.rs:2788 (lane mb-matches-b)
    declare_binding(source_info: SourceInfo, visibility_scope: SourceScope, name: Symbol, mode: BindingMode, var_id: LocalVarId, var_ty: Ty, user_ty: UserTypeProjections | undefined, has_guard: ArmHasGuard, opt_match_place: [Place | undefined, Span] | undefined, pat_span: Span): void;
    // mod.rs:2864 (lane mb-matches-b)
    should_emit_debug_info_for_binding(name: Symbol, var_id: LocalVarId): boolean;
    // mod.rs:2883 (lane mb-matches-b)
    static_pattern_match(cx: RustcPatCtxt, valtree: ValTree, arms: readonly ArmId[], built_match_tree: BuiltMatchTree): BasicBlock | undefined;
    // mod.rs:2922 (lane mb-matches-b)
    static_pattern_match_inner(valtree: ValTree, pat: DeconstructedPat): boolean;
  }
}

export interface TestableCase_methods {
  // mod.rs:1209 (lane mb-matches-a)
  as_range(self: TestableCase): PatRange | undefined;
}
export type TestableCase = gen.TestableCase;
export const TestableCase = gen.TestableCase as typeof gen.TestableCase & TestableCase_methods;

export interface TestBranch_methods {
  // mod.rs:1357 (lane mb-matches-a)
  as_constant(self: TestBranch): Value | undefined;
}
export type TestBranch = gen.TestBranch;
export const TestBranch = gen.TestBranch as typeof gen.TestBranch & TestBranch_methods;

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:60 let_not_permitted (lane mb-matches-a)
LowerIfCondArgs.prototype.let_not_permitted = function (this: LowerIfCondArgs): LowerIfCondArgs {
  return unported("rustc_mir_build::builder::matches::LowerIfCondArgs::let_not_permitted");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:102 lower_if_condition (lane mb-matches-a)
Builder.prototype.lower_if_condition = function (this: Builder, block: BasicBlock, expr_id: ExprId, args: LowerIfCondArgs): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::lower_if_condition");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:335 match_expr (lane mb-matches-a)
Builder.prototype.match_expr = function (this: Builder, destination: Place, block: BasicBlock, scrutinee_id: ExprId, arms: readonly ArmId[], span: Span): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::match_expr");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:376 lower_scrutinee (lane mb-matches-a)
Builder.prototype.lower_scrutinee = function (this: Builder, block: BasicBlock, scrutinee_id: ExprId): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::matches::Builder::lower_scrutinee");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:396 lower_match_arms (lane mb-matches-a)
Builder.prototype.lower_match_arms = function (this: Builder, destination: Place, scrutinee_place_builder: PlaceBuilder, scrutinee_span: Span, arms: readonly ArmId[], built_match_tree: BuiltMatchTree, outer_source_info: SourceInfo): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::lower_match_arms");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:499 bind_pattern (lane mb-matches-a)
Builder.prototype.bind_pattern = function (this: Builder, outer_source_info: SourceInfo, branch: MatchTreeBranch, fake_borrow_temps: readonly [Place, Local, FakeBorrowKind][], scrutinee_span: Span, arm_match_scope: [Arm, region_Scope] | undefined): BasicBlock {
  return unported("rustc_mir_build::builder::matches::Builder::bind_pattern");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:553 expr_into_pattern (lane mb-matches-a)
Builder.prototype.expr_into_pattern = function (this: Builder, block: BasicBlock, irrefutable_pat: Pat, initializer_id: ExprId): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::expr_into_pattern");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:619 place_into_pattern (lane mb-matches-a)
Builder.prototype.place_into_pattern = function (this: Builder, block: BasicBlock, irrefutable_pat: Pat, initializer: PlaceBuilder, set_match_place: boolean): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::place_into_pattern");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:687 declare_bindings (lane mb-matches-a)
Builder.prototype.declare_bindings = function (this: Builder, visibility_scope: SourceScope | undefined, scope_span: Span, pattern: Pat, guard: ExprId | undefined, opt_match_place: [Place | undefined, Span] | undefined): SourceScope | undefined {
  return unported("rustc_mir_build::builder::matches::Builder::declare_bindings");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:730 declare_guard_bindings (lane mb-matches-a)
Builder.prototype.declare_guard_bindings = function (this: Builder, guard_expr: ExprId, scope_span: Span, visibility_scope: SourceScope | undefined): void {
  return unported("rustc_mir_build::builder::matches::Builder::declare_guard_bindings");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:757 storage_live_binding (lane mb-matches-a)
Builder.prototype.storage_live_binding = function (this: Builder, block: BasicBlock, var_: LocalVarId, span: Span, is_shorthand: boolean, for_guard: ForGuard, schedule_drop: ScheduleDrops): Place {
  return unported("rustc_mir_build::builder::matches::Builder::storage_live_binding");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:783 schedule_drop_for_binding (lane mb-matches-a)
Builder.prototype.schedule_drop_for_binding = function (this: Builder, var_: LocalVarId, span: Span, for_guard: ForGuard): void {
  return unported("rustc_mir_build::builder::matches::Builder::schedule_drop_for_binding");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:801 visit_primary_bindings (lane mb-matches-a)
Builder.prototype.visit_primary_bindings = function (this: Builder, pattern: Pat, f: (this_: Builder, a1: LocalVarId, a2: Span) => void): void {
  return unported("rustc_mir_build::builder::matches::Builder::visit_primary_bindings");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:820 visit_primary_bindings_special (lane mb-matches-a)
Builder.prototype.visit_primary_bindings_special = function (this: Builder, pattern: Pat, user_tys: ProjectedUserTypesNode, f: (this_: Builder, a1: Symbol, a2: BindingMode, a3: LocalVarId, a4: Span, a5: Ty, a6: ProjectedUserTypesNode) => void): void {
  return unported("rustc_mir_build::builder::matches::Builder::visit_primary_bindings_special");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:952 is_empty (lane mb-matches-a)
PatternExtraData.prototype.is_empty = function (this: PatternExtraData): boolean {
  return unported("rustc_mir_build::builder::matches::PatternExtraData::is_empty");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1067 new (lane mb-matches-a)
(Candidate as unknown as { new: typeof Candidate.new }).new = function (place: PlaceBuilder, pattern: Pat, has_guard: HasMatchGuard, cx: Builder): Candidate {
  return unported("rustc_mir_build::builder::matches::Candidate::new");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1082 from_flat_pat (lane mb-matches-a)
(Candidate as unknown as { from_flat_pat: typeof Candidate.from_flat_pat }).from_flat_pat = function (flat_pat: FlatPat, has_guard: boolean): Candidate {
  return unported("rustc_mir_build::builder::matches::Candidate::from_flat_pat");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1098 sort_match_pairs (lane mb-matches-a)
Candidate.prototype.sort_match_pairs = function (this: Candidate): void {
  return unported("rustc_mir_build::builder::matches::Candidate::sort_match_pairs");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1103 starts_with_or_pattern (lane mb-matches-a)
Candidate.prototype.starts_with_or_pattern = function (this: Candidate): boolean {
  return unported("rustc_mir_build::builder::matches::Candidate::starts_with_or_pattern");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1112 visit_leaves (lane mb-matches-a)
Candidate.prototype.visit_leaves = function (this: Candidate, visit_leaf: (this_: Candidate) => void): void {
  return unported("rustc_mir_build::builder::matches::Candidate::visit_leaves");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1123 visit_leaves_rev (lane mb-matches-a)
Candidate.prototype.visit_leaves_rev = function (this: Candidate, visit_leaf: (this_: Candidate) => void): void {
  return unported("rustc_mir_build::builder::matches::Candidate::visit_leaves_rev");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1141 traverse_candidate (lane mb-matches-a)
export function traverse_candidate<C, T, I>(candidate: C, context: T, visit_leaf: (a0: C, a1: T) => void, get_children: (a0: C, a1: T) => I, complete_children: (a0: T) => void): void {
  return unported("rustc_mir_build::builder::matches::traverse_candidate");
}

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1209 as_range (lane mb-matches-a)
TestableCase.as_range = function (self: TestableCase): PatRange | undefined {
  return unported("rustc_mir_build::builder::matches::TestableCase::as_range");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1357 as_constant (lane mb-matches-a)
TestBranch.as_constant = function (self: TestBranch): Value | undefined {
  return unported("rustc_mir_build::builder::matches::TestBranch::as_constant");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1419 from_sub_candidate (lane mb-matches-a)
(MatchTreeSubBranch as unknown as { from_sub_candidate: typeof MatchTreeSubBranch.from_sub_candidate }).from_sub_candidate = function (candidate: Candidate, parent_data: PatternExtraData[]): MatchTreeSubBranch {
  return unported("rustc_mir_build::builder::matches::MatchTreeSubBranch::from_sub_candidate");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1441 from_candidate (lane mb-matches-a)
(MatchTreeBranch as unknown as { from_candidate: typeof MatchTreeBranch.from_candidate }).from_candidate = function (candidate: Candidate): MatchTreeBranch {
  return unported("rustc_mir_build::builder::matches::MatchTreeBranch::from_candidate");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1463 sub_branch_bindings (lane mb-matches-a)
export function sub_branch_bindings(parents: readonly PatternExtraData[], leaf_bindings: readonly SubpatternBindings[]): Binding[] {
  return unported("rustc_mir_build::builder::matches::sub_branch_bindings");
}

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1494 push_sub_branch_bindings (lane mb-matches-a)
export function push_sub_branch_bindings(flattened: Binding[], candidate_bindings: readonly SubpatternBindings[], remainder: Iterable<readonly SubpatternBindings[]>): void {
  return unported("rustc_mir_build::builder::matches::push_sub_branch_bindings");
}

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1547 lower_match_tree (lane mb-matches-b)
Builder.prototype.lower_match_tree = function (this: Builder, block: BasicBlock, scrutinee_span: Span, scrutinee_place_builder: PlaceBuilder, match_start_span: Span, patterns: [Pat, HasMatchGuard][], exhaustive: Exhaustive): BuiltMatchTree {
  return unported("rustc_mir_build::builder::matches::Builder::lower_match_tree");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1721 match_candidates (lane mb-matches-b)
Builder.prototype.match_candidates = function (this: Builder, span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BasicBlock {
  return unported("rustc_mir_build::builder::matches::Builder::match_candidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1733 match_candidates_inner (lane mb-matches-b)
Builder.prototype.match_candidates_inner = function (this: Builder, span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BasicBlock {
  return unported("rustc_mir_build::builder::matches::Builder::match_candidates_inner");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1805 select_matched_candidate (lane mb-matches-b)
Builder.prototype.select_matched_candidate = function (this: Builder, candidate: Candidate, start_block: BasicBlock): BasicBlock {
  return unported("rustc_mir_build::builder::matches::Builder::select_matched_candidate");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1825 expand_and_match_or_candidates (lane mb-matches-b)
Builder.prototype.expand_and_match_or_candidates = function (this: Builder, span: Span, scrutinee_span: Span, start_block: BasicBlock, candidates: Candidate[]): BlockAnd<Candidate[]> {
  return unported("rustc_mir_build::builder::matches::Builder::expand_and_match_or_candidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1925 create_or_subcandidates (lane mb-matches-b)
Builder.prototype.create_or_subcandidates = function (this: Builder, candidate: Candidate, match_pair: MatchPairTree): void {
  return unported("rustc_mir_build::builder::matches::Builder::create_or_subcandidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:1997 merge_trivial_subcandidates (lane mb-matches-b)
Builder.prototype.merge_trivial_subcandidates = function (this: Builder, candidate: Candidate): void {
  return unported("rustc_mir_build::builder::matches::Builder::merge_trivial_subcandidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2040 remove_never_subcandidates (lane mb-matches-b)
Builder.prototype.remove_never_subcandidates = function (this: Builder, candidate: Candidate): void {
  return unported("rustc_mir_build::builder::matches::Builder::remove_never_subcandidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2075 test_remaining_match_pairs_after_or (lane mb-matches-b)
Builder.prototype.test_remaining_match_pairs_after_or = function (this: Builder, span: Span, scrutinee_span: Span, candidate: Candidate): void {
  return unported("rustc_mir_build::builder::matches::Builder::test_remaining_match_pairs_after_or");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2145 pick_test (lane mb-matches-b)
Builder.prototype.pick_test = function (this: Builder, candidates: readonly Candidate[]): [Place, Test] {
  return unported("rustc_mir_build::builder::matches::Builder::pick_test");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2255 test_candidates (lane mb-matches-b)
Builder.prototype.test_candidates = function (this: Builder, span: Span, scrutinee_span: Span, candidates: Candidate[], start_block: BasicBlock): BlockAnd<Candidate[]> {
  return unported("rustc_mir_build::builder::matches::Builder::test_candidates");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2321 lower_fallible_let (lane mb-matches-b)
Builder.prototype.lower_fallible_let = function (this: Builder, block: BasicBlock, pat: Pat, scrutinee_id: ExprId, source_scope: SourceScope | undefined, scope_span: Span, declare_let_bindings: DeclareLetBindings): BlockAnd<null> {
  return unported("rustc_mir_build::builder::matches::Builder::lower_fallible_let");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2388 bind_and_guard_matched_candidate (lane mb-matches-b)
Builder.prototype.bind_and_guard_matched_candidate = function (this: Builder, sub_branch: MatchTreeSubBranch, fake_borrows: readonly [Place, Local, FakeBorrowKind][], scrutinee_span: Span, arm_match_scope: [Arm, region_Scope] | undefined, schedule_drops: ScheduleDrops): BasicBlock {
  return unported("rustc_mir_build::builder::matches::Builder::bind_and_guard_matched_candidate");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2534 ascribe_types (lane mb-matches-b)
Builder.prototype.ascribe_types = function (this: Builder, block: BasicBlock, ascriptions: Iterable<Ascription>): void {
  return unported("rustc_mir_build::builder::matches::Builder::ascribe_types");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2635 bind_matched_candidate_for_guard (lane mb-matches-b)
Builder.prototype.bind_matched_candidate_for_guard = function (this: Builder, block: BasicBlock, bindings: Iterable<Binding>): void {
  return unported("rustc_mir_build::builder::matches::Builder::bind_matched_candidate_for_guard");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2700 bind_matched_candidate_for_arm_body (lane mb-matches-b)
Builder.prototype.bind_matched_candidate_for_arm_body = function (this: Builder, block: BasicBlock, schedule_drops: ScheduleDrops, bindings: Iterable<Binding>): void {
  return unported("rustc_mir_build::builder::matches::Builder::bind_matched_candidate_for_arm_body");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2749 pin_borrowed_local (lane mb-matches-b)
Builder.prototype.pin_borrowed_local = function (this: Builder, block: BasicBlock, local: Local, borrow: Rvalue, source_info: SourceInfo): Rvalue {
  return unported("rustc_mir_build::builder::matches::Builder::pin_borrowed_local");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2788 declare_binding (lane mb-matches-b)
Builder.prototype.declare_binding = function (this: Builder, source_info: SourceInfo, visibility_scope: SourceScope, name: Symbol, mode: BindingMode, var_id: LocalVarId, var_ty: Ty, user_ty: UserTypeProjections | undefined, has_guard: ArmHasGuard, opt_match_place: [Place | undefined, Span] | undefined, pat_span: Span): void {
  return unported("rustc_mir_build::builder::matches::Builder::declare_binding");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2864 should_emit_debug_info_for_binding (lane mb-matches-b)
Builder.prototype.should_emit_debug_info_for_binding = function (this: Builder, name: Symbol, var_id: LocalVarId): boolean {
  return unported("rustc_mir_build::builder::matches::Builder::should_emit_debug_info_for_binding");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2883 static_pattern_match (lane mb-matches-b)
Builder.prototype.static_pattern_match = function (this: Builder, cx: RustcPatCtxt, valtree: ValTree, arms: readonly ArmId[], built_match_tree: BuiltMatchTree): BasicBlock | undefined {
  return unported("rustc_mir_build::builder::matches::Builder::static_pattern_match");
};

// stub: compiler/rustc_mir_build/src/builder/matches/mod.rs:2922 static_pattern_match_inner (lane mb-matches-b)
Builder.prototype.static_pattern_match_inner = function (this: Builder, valtree: ValTree, pat: DeconstructedPat): boolean {
  return unported("rustc_mir_build::builder::matches::Builder::static_pattern_match_inner");
};
