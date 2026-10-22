// Port of compiler/rustc_mir_build/src/builder/matches/mod.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lanes
// mb-matches-a, mb-matches-b; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BindingMode } from "../../../rustc_ast/lib.ts";
import { Mutability, Pinnedness } from "../../../rustc_ast_ir/lib.ts";
import { FieldIdx } from "../../../rustc_abi/layout.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import { type Scope as region_Scope, Scope as RegionScope, ScopeData } from "../../../rustc_middle/middle/region.ts";
import {
  type BasicBlock,
  ClearCrossCrate,
  clone_Place,
  clone_SourceInfo,
  type FakeBorrowKind,
  type Local,
  type Operand,
  type Place,
  Place_from_Local,
  type Rvalue,
  SourceInfo,
  type SourceScope,
  Statement,
  TerminatorKind,
  type UserTypeProjections,
} from "../../../rustc_middle/mir/mod.ts";
import { type Arm, type ArmId, type Ascription as thir_Ascription, type ExprId, type LocalVarId, type Pat, type PatRange } from "../../../rustc_middle/thir.ts";
import { with_ } from "../../../rustc_middle/ty/context/tls.ts";
import { type ValTree, type Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type CanonicalUserTypeAnnotation, type UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { type PlaceBuilder } from "../expr/as_place.gen.ts";
import {
  Candidate,
  clone_Ascription,
  clone_Binding,
  DeclareLetBindings,
  Exhaustive,
  FlatPat,
  HasMatchGuard,
  LowerIfCondArgs,
  MatchTreeBranch,
  MatchTreeSubBranch,
  PatternExtraData,
  ScheduleDrops,
  type ArmHasGuard,
  type Ascription,
  type Binding,
  type BuiltMatchTree,
  type MatchPairTree,
  type SubpatternBindings,
  type Test,
} from "./mod.gen.ts";
import { ProjectedUserTypesNode } from "./user_ty.ts";
import { and, BlockAnd, Builder, ForGuard, unit } from "../mod.ts";
import { LintLevel } from "../scope.gen.ts";
import { BytePos, Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { panic, unported } from "../../../std/panic.ts";
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

/// Returns a copy of `self` with [`DeclareLetBindings::LetNotPermitted`].
/// Used when recursing into a sub-condition that does not permit `let` (e.g. `||` or `!`).
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:60 let_not_permitted
LowerIfCondArgs.prototype.let_not_permitted = function (this: LowerIfCondArgs): LowerIfCondArgs {
  return new LowerIfCondArgs(this.temp_scope_override, this.variable_source_info, DeclareLetBindings.LetNotPermitted);
};

/// Lowers the condition for an `if`-expression or similar construct
/// (including `&&` and `||` expressions, and match-guard conditions).
///
/// Must be called within [`Builder::in_if_then_scope`], which keeps track
/// of drop scope and knows where to break to if the condition is false.
///
/// Returns the block for the *true* arm of the condition check.
/// The *true* and *false* arms are returned by [`Builder::in_if_then_scope`].
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:102 lower_if_condition
Builder.prototype.lower_if_condition = function (
  this: Builder,
  block: BasicBlock, // Block that the condition and branch will be lowered into
  expr_id: ExprId, // Condition expression to lower
  args: LowerIfCondArgs,
): BlockAnd<null> {
  // let this = self; // See "LET_THIS_SELF".
  const expr = this.thir.index_ExprId(expr_id);
  const expr_span = expr.span;

  const kind = expr.kind;
  if (kind.$ === "LogicalOp" && kind.op === "And") {
    const { lhs, rhs } = kind;
    // A condition of `lhs && rhs` is fairly straightforward.
    // We can just lower them in sequence, and break if either is false.
    const lhs_true_block = BlockAnd.into_block(this.lower_if_condition(block, lhs, args));
    const rhs_true_block = BlockAnd.into_block(this.lower_if_condition(lhs_true_block, rhs, args));
    return unit(rhs_true_block);
  } else if (kind.$ === "LogicalOp" && kind.op === "Or") {
    const { lhs, rhs } = kind;
    // A condition of `lhs || rhs` is more complicated, because we need to
    // short-circuit if `lhs` is *true*. So an inner condition-scope is needed.
    // See <https://github.com/rust-lang/rust/pull/111752>.
    const local_scope = this.local_scope();
    const [lhs_true_block, lhs_false_block] = this.in_if_then_scope(local_scope, expr_span, (this_) => {
      return this_.lower_if_condition(block, lhs, args.let_not_permitted());
    });
    const rhs_true_block = BlockAnd.into_block(this.lower_if_condition(lhs_false_block, rhs, args.let_not_permitted()));

    // Make the LHS-true and RHS-true arms converge to a common block.
    // (We can't just make LHS goto RHS, because `rhs_true_block`
    // might contain statements that we don't want on the LHS path.)
    const success_block = this.cfg.start_new_block();
    this.cfg.goto(lhs_true_block, args.variable_source_info, success_block);
    this.cfg.goto(rhs_true_block, args.variable_source_info, success_block);
    return unit(success_block);
  } else if (kind.$ === "Unary" && kind.op === "Not") {
    const { arg } = kind;
    // For a condition of `!cond`, lower `cond` as its own condition,
    // then invert the meaning of the true/false blocks.
    // This avoids an intermediate temporary for negating the condition value.
    // See <https://github.com/rust-lang/rust/pull/111752>.

    // Improve branch coverage instrumentation by noting conditions
    // nested within one or more `!` expressions.
    // (Skipped if branch coverage is not enabled.)
    const coverage_info = this.coverage_info;
    if (coverage_info !== undefined) {
      coverage_info.visit_unary_not(this.thir, expr_id);
    }

    const local_scope = this.local_scope();
    const [true_block, false_block] = this.in_if_then_scope(local_scope, expr_span, (this_) => {
      return this_.lower_if_condition(block, arg, args.let_not_permitted());
    });
    // Break if the condition was true; proceed if the condition was false.
    this.break_from_if_then_scope(true_block, args.variable_source_info);
    return unit(false_block);
  } else if (kind.$ === "Scope") {
    const { region_scope, hir_id, value } = kind;
    const source_info = this.source_info(expr_span);
    return this.in_scope([region_scope, source_info], { $: "Explicit", _0: hir_id }, (this_) => {
      this_.push_coverage_point_for_expr(block, source_info, hir_id);
      return this_.lower_if_condition(block, value, args);
    });
  } else if (kind.$ === "ValueExpr") {
    return this.lower_if_condition(block, kind.source, args);
  } else if (kind.$ === "Let") {
    return this.lower_fallible_let(
      block,
      kind.pat,
      kind.expr,
      args.variable_source_info.scope,
      args.variable_source_info.span,
      args.declare_let_bindings,
    );
  } else {
    // The condition is an ordinary boolean-valued expression,
    // so lower it normally and branch on the result.
    let block_ = block;
    const temp_scope = args.temp_scope_override ?? this.local_scope();
    const mutability = Mutability.Mut;

    let place: Local;
    [block_, place] = this.as_temp(
      block_,
      {
        temp_lifetime: temp_scope,
        backwards_incompatible: undefined,
      },
      expr_id,
      mutability,
    );

    const operand: Operand = { $: "Move", _0: Place_from_Local(place) };

    const true_block = this.cfg.start_new_block();
    const false_block = this.cfg.start_new_block();
    const term = TerminatorKind.if_(operand, true_block, false_block);

    // Record branch coverage info for this condition.
    // (Does nothing if branch coverage is not enabled.)
    this.visit_coverage_branch_condition(expr_id, true_block, false_block);

    const source_info = this.source_info(expr_span);
    this.cfg.terminate(block_, source_info, term);
    this.break_from_if_then_scope(false_block, source_info);

    return unit(true_block);
  }
};

/// Generates MIR for a `match` expression.
///
/// The MIR that we generate for a match looks like this.
///
/// ```text
/// [ 0. Pre-match ]
///        |
/// [ 1. Evaluate Scrutinee (expression being matched on) ]
/// [ (PlaceMention of scrutinee) ]
///        |
/// [ 2. Decision tree -- check discriminants ] <--------+
///        |                                             |
///        | (once a specific arm is chosen)             |
///        |                                             |
/// [pre_binding_block]                           [otherwise_block]
///        |                                             |
/// [ 3. Create "guard bindings" for arm ]               |
/// [ (create fake borrows) ]                            |
///        |                                             |
/// [ 4. Execute guard code ]                            |
/// [ (read fake borrows) ] --(guard is false)-----------+
///        |
///        | (guard results in true)
///        |
/// [ 5. Create real bindings and execute arm ]
///        |
/// [ Exit match ]
/// ```
///
/// All of the different arms have been stacked on top of each other to
/// simplify the diagram. For an arm with no guard the blocks marked 3 and
/// 4 and the fake borrows are omitted.
///
/// We generate MIR in the following steps:
///
/// 1. Evaluate the scrutinee and add the PlaceMention of it ([Builder::lower_scrutinee]).
/// 2. Create the decision tree ([Builder::lower_match_tree]).
/// 3. Determine the fake borrows that are needed from the places that were
///    matched against and create the required temporaries for them
///    ([util::collect_fake_borrows]).
/// 4. Create everything else: the guards and the arms ([Builder::lower_match_arms]).
///
/// ## False edges
///
/// We don't want to have the exact structure of the decision tree be visible through borrow
/// checking. Specifically we want borrowck to think that:
/// - at any point, any or none of the patterns and guards seen so far may have been tested;
/// - after the match, any of the patterns may have matched.
///
/// For example, all of these would fail to error if borrowck could see the real CFG (examples
/// taken from `tests/ui/nll/match-cfg-fake-edges.rs`):
/// ```ignore (too many errors, this is already in the test suite)
/// let x = String::new();
/// let _ = match true {
///     _ => {},
///     _ => drop(x),
/// };
/// // Borrowck must not know the second arm is never run.
/// drop(x); //~ ERROR use of moved value
///
/// let x;
/// # let y = true;
/// match y {
///     _ if { x = 2; true } => {},
///     // Borrowck must not know the guard is always run.
///     _ => drop(x), //~ ERROR used binding `x` is possibly-uninitialized
/// };
///
/// let x = String::new();
/// # let y = true;
/// match y {
///     false if { drop(x); true } => {},
///     // Borrowck must not know the guard is not run in the `true` case.
///     true => drop(x), //~ ERROR use of moved value: `x`
///     false => {},
/// };
///
/// # let mut y = (true, true);
/// let r = &mut y.1;
/// match y {
///     //~^ ERROR cannot use `y.1` because it was mutably borrowed
///     (false, true) => {}
///     // Borrowck must not know we don't test `y.1` when `y.0` is `true`.
///     (true, _) => drop(r),
///     (false, _) => {}
/// };
/// ```
///
/// We add false edges to act as if we were naively matching each arm in order. What we need is
/// a (fake) path from each candidate to the next, specifically from candidate C's pre-binding
/// block to next candidate D's pre-binding block. For maximum precision (needed for deref
/// patterns), we choose the earliest node on D's success path that doesn't also lead to C (to
/// avoid loops).
///
/// This turns out to be easy to compute: that block is the `start_block` of the first call to
/// `match_candidates` where D is the first candidate in the list.
///
/// For example:
/// ```rust
/// # let (x, y) = (true, true);
/// match (x, y) {
///   (true, true) => 1,
///   (false, true) => 2,
///   (true, false) => 3,
///   _ => 4,
/// }
/// # ;
/// ```
/// In this example, the pre-binding block of arm 1 has a false edge to the block for result
/// `false` of the first test on `x`. The other arms have false edges to the pre-binding blocks
/// of the next arm.
///
/// On top of this, we also add a false edge from the otherwise_block of each guard to the
/// aforementioned start block of the next candidate, to ensure borrock doesn't rely on which
/// guards may have run.
// #[instrument(level = "debug", skip(self, arms))]
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:335 match_expr
Builder.prototype.match_expr = function (this: Builder, destination: Place, block: BasicBlock, scrutinee_id: ExprId, arms: readonly ArmId[], span: Span): BlockAnd<null> {
  const scrutinee_span = this.thir.index_ExprId(scrutinee_id).span;
  let scrutinee_place: PlaceBuilder;
  [block, scrutinee_place] = this.lower_scrutinee(block, scrutinee_id);

  const match_start_span = Span.to(Span.shrink_to_lo(span), scrutinee_span);
  const patterns = arms.map((arm_id): [Pat, HasMatchGuard] => {
    const arm = this.thir.index_ArmId(arm_id);
    const has_match_guard = arm.guard !== undefined ? HasMatchGuard.Yes : HasMatchGuard.No;
    return [arm.pattern, has_match_guard];
  });
  const built_tree = this.lower_match_tree(block, scrutinee_span, scrutinee_place, match_start_span, patterns, Exhaustive.Yes);

  return this.lower_match_arms(destination, scrutinee_place, scrutinee_span, arms, built_tree, this.source_info(span));
};

/// Evaluate the scrutinee and add the PlaceMention for it.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:376 lower_scrutinee
Builder.prototype.lower_scrutinee = function (this: Builder, block: BasicBlock, scrutinee_id: ExprId): BlockAnd<PlaceBuilder> {
  let scrutinee_place_builder: PlaceBuilder;
  [block, scrutinee_place_builder] = this.as_place_builder(block, scrutinee_id);
  const scrutinee_place = scrutinee_place_builder.try_to_place(this);
  if (scrutinee_place !== undefined) {
    const source_info = this.source_info(this.thir.index_ExprId(scrutinee_id).span);
    this.cfg.push_place_mention(block, source_info, scrutinee_place);
  }

  return and(block, scrutinee_place_builder);
};

/// Lower the bindings, guards and arm bodies of a `match` expression.
///
/// The decision tree should have already been created
/// (by [Builder::lower_match_tree]).
///
/// `outer_source_info` is the SourceInfo for the whole match.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:396 lower_match_arms
Builder.prototype.lower_match_arms = function (
  this: Builder,
  destination: Place,
  scrutinee_place_builder: PlaceBuilder,
  scrutinee_span: Span,
  arms: readonly ArmId[],
  built_match_tree: BuiltMatchTree,
  outer_source_info: SourceInfo,
): BlockAnd<null> {
  // PORT: `arms.iter().map(..).zip(built_match_tree.branches).map(..).collect()`: one loop over the shorter of the two.
  const arm_end_blocks: BasicBlock[] = [];
  const n = Math.min(arms.length, built_match_tree.branches.length);
  for (let i = 0; i < n; i++) {
    const arm = this.thir.index_ArmId(arms[i]!);
    const branch = built_match_tree.branches[i]!;
    // debug!("lowering arm {:?}\ncorresponding branch = {:?}", arm, branch);

    const arm_source_info = this.source_info(arm.span);
    const arm_scope: [region_Scope, SourceInfo] = [arm.scope, arm_source_info];
    const match_scope = this.local_scope();
    const guard_scope = arm.guard === undefined ? undefined : new RegionScope(arm.scope.local_id, ScopeData.MatchGuard);
    arm_end_blocks.push(
      BlockAnd.into_block(
        this.in_scope(arm_scope, { $: "Explicit", _0: arm.hir_id }, (this_) => {
          return this_.opt_in_scope(guard_scope === undefined ? undefined : [guard_scope, arm_source_info], (this_) => {
            // `if let` guard temps needing deduplicating will be in the guard scope.
            const old_dedup_scope = this_.fixed_temps_scope;
            this_.fixed_temps_scope = guard_scope;

            // `try_to_place` may fail if it is unable to resolve the given
            // `PlaceBuilder` inside a closure. In this case, we don't want to include
            // a scrutinee place. `scrutinee_place_builder` will fail to be resolved
            // if the only match arm is a wildcard (`_`).
            // Example:
            // ```
            // let foo = (0, 1);
            // let c = || {
            //    match foo { _ => () };
            // };
            // ```
            const scrutinee_place = scrutinee_place_builder.try_to_place(this_);
            const opt_scrutinee_place: [Place | undefined, Span] | undefined =
              scrutinee_place === undefined ? undefined : [scrutinee_place, scrutinee_span];
            const scope = this_.declare_bindings(undefined, arm.span, arm.pattern, arm.guard, opt_scrutinee_place);

            const arm_block = this_.bind_pattern(outer_source_info, branch, built_match_tree.fake_borrow_temps, scrutinee_span, [arm, match_scope]);

            this_.fixed_temps_scope = old_dedup_scope;

            if (scope !== undefined) {
              const source_scope = scope;
              this_.source_scope = source_scope;
            }

            return this_.expr_into_dest(destination, arm_block, arm.body);
          });
        }),
      ),
    );
  }

  // all the arm blocks will rejoin here
  const end_block = this.cfg.start_new_block();

  const end_brace = this.source_info(
    Span.with_lo(outer_source_info.span, BytePos.sub(Span.hi(outer_source_info.span), BytePos.from_usize(1))),
  );
  for (const arm_block of arm_end_blocks) {
    const block = this.cfg.basic_blocks[arm_block]!;
    const last = block.statements[block.statements.length - 1];
    // PORT: `SourceInfo` is a `Copy` class: the copy taken from the statement is cloned (builder/mod.ts header).
    const last_location = last === undefined ? undefined : clone_SourceInfo(last.source_info);

    this.cfg.goto(arm_block, last_location ?? end_brace, end_block);
  }

  this.source_scope = outer_source_info.scope;

  return unit(end_block);
};

/// For a top-level `match` arm or a `let` binding, binds the variables and
/// ascribes types, and also checks the match arm guard (if present).
///
/// `arm_scope` should be `Some` if and only if this is called for a
/// `match` arm.
///
/// In the presence of or-patterns, a match arm might have multiple
/// sub-branches representing different ways to match, with each sub-branch
/// requiring its own bindings and its own copy of the guard. This method
/// handles those sub-branches individually, and then has them jump together
/// to a common block.
///
/// Returns a single block that the match arm can be lowered into.
/// (For `let` bindings, this is the code that can use the bindings.)
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:499 bind_pattern
Builder.prototype.bind_pattern = function (
  this: Builder,
  outer_source_info: SourceInfo,
  branch: MatchTreeBranch,
  fake_borrow_temps: readonly [Place, Local, FakeBorrowKind][],
  scrutinee_span: Span,
  arm_match_scope: [Arm, region_Scope] | undefined,
): BasicBlock {
  if (branch.sub_branches.length === 1) {
    const [sub_branch] = branch.sub_branches as [MatchTreeSubBranch];
    // Avoid generating another `BasicBlock` when we only have one sub branch.
    return this.bind_and_guard_matched_candidate(sub_branch, fake_borrow_temps, scrutinee_span, arm_match_scope, ScheduleDrops.Yes);
  } else {
    // It's helpful to avoid scheduling drops multiple times to save
    // drop elaboration from having to clean up the extra drops.
    //
    // If we are in a `let` then we only schedule drops for the first
    // candidate.
    //
    // If we're in a `match` arm then we could have a case like so:
    //
    // Ok(x) | Err(x) if return => { /* ... */ }
    //
    // In this case we don't want a drop of `x` scheduled when we
    // return: it isn't bound by move until right before enter the arm.
    // To handle this we instead unschedule it's drop after each time
    // we lower the guard.
    // As a result, we end up with the drop order of the last sub-branch we lower. To use
    // the drop order for the first sub-branch, we lower sub-branches in reverse (#142163).
    const target_block = this.cfg.start_new_block();
    // PORT: `.into_iter().rev().with_position()` (itertools): `pos.is_last()` (`Last | Only`) is the last index of the
    // reversed sequence.
    const sub_branches = branch.sub_branches;
    for (let i = sub_branches.length - 1; i >= 0; i--) {
      const sub_branch = sub_branches[i]!;
      const is_last = i === 0;
      // debug_assert!(!pos.is_exactly_one());
      const schedule_drops = is_last ? ScheduleDrops.Yes : ScheduleDrops.No;
      const binding_end = this.bind_and_guard_matched_candidate(sub_branch, fake_borrow_temps, scrutinee_span, arm_match_scope, schedule_drops);
      this.cfg.goto(binding_end, outer_source_info, target_block);
    }

    return target_block;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:553 expr_into_pattern
Builder.prototype.expr_into_pattern = function (this: Builder, block: BasicBlock, irrefutable_pat: Pat, initializer_id: ExprId): BlockAnd<null> {
  const kind = irrefutable_pat.kind;
  // Optimize `let x = ...` and `let x: T = ...` to write directly into `x`,
  // and then require that `T == typeof(x)` if present.
  if (kind.$ === "Binding" && kind.mode._0.$ === "No" && kind.subpattern === undefined) {
    const var_ = kind.var;
    const place = this.storage_live_binding(block, var_, irrefutable_pat.span, false, ForGuard.OutsideGuard, ScheduleDrops.Yes);
    block = BlockAnd.into_block(this.expr_into_dest(place, block, initializer_id));

    // Inject a fake read, see comments on `FakeReadCause::ForLet`.
    const source_info = this.source_info(irrefutable_pat.span);
    // PORT: `Place` is a `Copy` class: each further MIR use of `place` gets its own copy (builder/mod.ts header).
    this.cfg.push_fake_read(block, source_info, { $: "ForLet", _0: undefined }, clone_Place(place));

    const ascriptions: readonly thir_Ascription[] = irrefutable_pat.extra?.ascriptions ?? [];
    for (const { annotation } of ascriptions) {
      const ty_source_info = this.source_info(annotation.span);

      const base = IndexVec.push<UserTypeAnnotationIndex, CanonicalUserTypeAnnotation>(
        this.canonical_user_type_annotations,
        // PORT: `annotation.clone()` (derived Clone of `CanonicalUserTypeAnnotation`, as codegen's `clone_Ascription` has it).
        { user_ty: annotation.user_ty, span: annotation.span, inferred_ty: annotation.inferred_ty },
      );
      const stmt = Statement.new(ty_source_info, {
        $: "AscribeUserType",
        _0: [clone_Place(place), { base, projs: [] }],
        // We always use invariant as the variance here. This is because the
        // variance field from the ascription refers to the variance to use
        // when applying the type to the value being matched, but this
        // ascription applies rather to the type of the binding. e.g., in this
        // example:
        //
        // ```
        // let x: T = <expr>
        // ```
        //
        // We are creating an ascription that defines the type of `x` to be
        // exactly `T` (i.e., with invariance). The variance field, in
        // contrast, is intended to be used to relate `T` to the type of
        // `<expr>`.
        _1: "Invariant",
      });
      this.cfg.push(block, stmt);
    }

    this.schedule_drop_for_binding(var_, irrefutable_pat.span, ForGuard.OutsideGuard);
    return unit(block);
  } else {
    let place_builder: PlaceBuilder;
    [block, place_builder] = this.lower_scrutinee(block, initializer_id);
    return this.place_into_pattern(block, irrefutable_pat, place_builder, true);
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:619 place_into_pattern
Builder.prototype.place_into_pattern = function (this: Builder, block: BasicBlock, irrefutable_pat: Pat, initializer: PlaceBuilder, set_match_place: boolean): BlockAnd<null> {
  const built_tree = this.lower_match_tree(
    block,
    irrefutable_pat.span,
    initializer,
    irrefutable_pat.span,
    [[irrefutable_pat, HasMatchGuard.No]],
    Exhaustive.Yes,
  );
  // PORT: `let [branch] = built_tree.branches.try_into().unwrap();`
  if (built_tree.branches.length !== 1) {
    return panic("called `Result::unwrap()` on an `Err` value");
  }
  const branch = built_tree.branches[0]!;

  // For matches and function arguments, the place that is being matched
  // can be set when creating the variables. But the place for
  // let PATTERN = ... might not even exist until we do the assignment.
  // so we set it here instead.
  if (set_match_place) {
    // `try_to_place` may fail if it is unable to resolve the given `PlaceBuilder` inside a
    // closure. In this case, we don't want to include a scrutinee place.
    // `scrutinee_place_builder` will fail for destructured assignments. This is because a
    // closure only captures the precise places that it will read and as a result a closure
    // may not capture the entire tuple/struct and rather have individual places that will
    // be read in the final MIR.
    // Example:
    // ```
    // let foo = (0, 1);
    // let c = || {
    //    let (v1, v2) = foo;
    // };
    // ```
    const place = initializer.try_to_place(this);
    if (place !== undefined) {
      // Because or-alternatives bind the same variables, we only explore the first one.
      const first_sub_branch = branch.sub_branches[0];
      if (first_sub_branch === undefined) return panic("called `Option::unwrap()` on a `None` value");
      for (const binding of first_sub_branch.bindings) {
        const local = this.var_local_id(binding.var_id, ForGuard.OutsideGuard);
        const local_info = ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_mut(this.local_decls[local]!.local_info));
        if (local_info.$ === "User" && local_info._0.$ === "Var" && local_info._0._0.opt_match_place !== undefined) {
          const match_place = local_info._0._0.opt_match_place;
          // PORT: `*match_place = Some(place)` copies the `Copy` class `Place` (builder/mod.ts header).
          match_place[0] = clone_Place(place);
        } else {
          bug("Let binding to non-user variable.");
        }
      }
    }
  }

  return unit(this.bind_pattern(this.source_info(irrefutable_pat.span), branch, [], irrefutable_pat.span, undefined));
};

/// Declares the bindings of the given patterns and returns the visibility
/// scope for the bindings in these patterns, if such a scope had to be
/// created. NOTE: Declaring the bindings should always be done in their
/// drop scope.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:687 declare_bindings
Builder.prototype.declare_bindings = function (
  this: Builder,
  visibility_scope: SourceScope | undefined,
  scope_span: Span,
  pattern: Pat,
  guard: ExprId | undefined,
  opt_match_place: [Place | undefined, Span] | undefined,
): SourceScope | undefined {
  this.visit_primary_bindings_special(pattern, ProjectedUserTypesNode.None, (this_, name, mode, var_, span, ty, user_tys) => {
    const saved_scope = this_.source_scope;
    this_.set_correct_source_scope_for_arg(var_._0, saved_scope, span);
    if (visibility_scope === undefined) {
      visibility_scope = this_.new_source_scope(scope_span, LintLevel.Inherited);
    }
    const vis_scope = visibility_scope;
    const source_info = new SourceInfo(span, this_.source_scope);
    const user_tys_ = ProjectedUserTypesNode.build_user_type_projections(user_tys);

    this_.declare_binding(
      source_info,
      vis_scope,
      name,
      mode,
      var_,
      ty,
      user_tys_,
      { _0: guard !== undefined },
      opt_match_place === undefined
        ? undefined
        : [opt_match_place[0] === undefined ? undefined : clone_Place(opt_match_place[0]), opt_match_place[1]],
      pattern.span,
    );
    this_.source_scope = saved_scope;
  });
  if (guard !== undefined) {
    const guard_expr = guard;
    this.declare_guard_bindings(guard_expr, scope_span, visibility_scope);
  }
  return visibility_scope;
};

/// Declare bindings in a guard. This has to be done when declaring bindings
/// for an arm to ensure that or patterns only have one version of each
/// variable.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:730 declare_guard_bindings
Builder.prototype.declare_guard_bindings = function (this: Builder, guard_expr: ExprId, scope_span: Span, visibility_scope: SourceScope | undefined): void {
  const kind = this.thir.index_ExprId(guard_expr).kind;
  switch (kind.$) {
    case "Let": {
      const guard_pat = kind.pat;
      // FIXME: pass a proper `opt_match_place`
      this.declare_bindings(visibility_scope, scope_span, guard_pat, undefined, undefined);
      break;
    }
    case "Scope": {
      this.declare_guard_bindings(kind.value, scope_span, visibility_scope);
      break;
    }
    case "ValueExpr": {
      this.declare_guard_bindings(kind.source, scope_span, visibility_scope);
      break;
    }
    case "LogicalOp": {
      if (kind.op === "And") {
        this.declare_guard_bindings(kind.lhs, scope_span, visibility_scope);
        this.declare_guard_bindings(kind.rhs, scope_span, visibility_scope);
      }
      break;
    }
    default:
      break;
  }
};

/// Emits a [`StatementKind::StorageLive`] for the given var, and also
/// schedules a drop if requested (and possible).
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:757 storage_live_binding
Builder.prototype.storage_live_binding = function (
  this: Builder,
  block: BasicBlock,
  var_: LocalVarId,
  span: Span,
  is_shorthand: boolean,
  for_guard: ForGuard,
  schedule_drop: ScheduleDrops,
): Place {
  const local_id = this.var_local_id(var_, for_guard);
  const source_info = this.source_info(span);
  this.cfg.push(block, Statement.new(source_info, { $: "StorageLive", _0: local_id }));
  // Although there is almost always scope for given variable in corner cases
  // like #92893 we might get variable with no scope.
  const region_scope = this.region_scope_tree.var_scope(var_._0.local_id);
  if (region_scope !== undefined && schedule_drop === ScheduleDrops.Yes) {
    this.schedule_drop_storage(span, region_scope, local_id);
  }
  const local_info = ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_mut(this.local_decls[local_id]!.local_info));
  if (local_info.$ === "User" && local_info._0.$ === "Var") {
    const var_info = local_info._0._0;
    var_info.introductions.push({ span, is_shorthand });
  }
  return Place_from_Local(local_id);
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:783 schedule_drop_for_binding
Builder.prototype.schedule_drop_for_binding = function (this: Builder, var_: LocalVarId, span: Span, for_guard: ForGuard): void {
  const local_id = this.var_local_id(var_, for_guard);
  const region_scope = this.region_scope_tree.var_scope(var_._0.local_id);
  if (region_scope !== undefined) {
    this.schedule_drop_value(span, region_scope, local_id);
  }
};

/// Visits all of the "primary" bindings in a pattern, i.e. the leftmost
/// occurrence of each variable bound by the pattern.
/// See [`PatKind::Binding::is_primary`] for more context.
///
/// This variant provides only the limited subset of binding data needed
/// by its callers, and should be a "pure" visit without side-effects.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:801 visit_primary_bindings
Builder.prototype.visit_primary_bindings = function (this: Builder, pattern: Pat, f: (this_: Builder, a1: LocalVarId, a2: Span) => void): void {
  pattern.walk_always((pat) => {
    if (pat.kind.$ === "Binding" && pat.kind.is_primary === true) {
      f(this, pat.kind.var, pat.span);
    }
  });
};

/// Visits all of the "primary" bindings in a pattern, while preparing
/// additional user-type-annotation data needed by `declare_bindings`.
///
/// This also has the side-effect of pushing all user type annotations
/// onto `canonical_user_type_annotations`, so that they end up in MIR
/// even if they aren't associated with any bindings.
// #[instrument(level = "debug", skip(self, f))]
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:820 visit_primary_bindings_special
Builder.prototype.visit_primary_bindings_special = function (
  this: Builder,
  pattern: Pat,
  user_tys: ProjectedUserTypesNode,
  f: (this_: Builder, a1: Symbol, a2: BindingMode, a3: LocalVarId, a4: Span, a5: Ty, a6: ProjectedUserTypesNode) => void,
): void {
  // Ascriptions correspond to user-written types like `let A::<'a>(_): A<'static> = ...;`.
  //
  // Caution: Pushing user types here is load-bearing even for
  // patterns containing no bindings, to ensure that the type ends
  // up represented in MIR _somewhere_.
  const extra = pattern.extra;
  if (extra !== undefined && extra.ascriptions.length !== 0) {
    const base_user_tys = extra.ascriptions.map(({ annotation }) => {
      // Note that the variance doesn't apply here, as we are tracking the effect
      // of user types on any bindings contained with subpattern.
      return IndexVec.push<UserTypeAnnotationIndex, CanonicalUserTypeAnnotation>(
        this.canonical_user_type_annotations,
        // PORT: `annotation.clone()` (derived Clone of `CanonicalUserTypeAnnotation`, as codegen's `clone_Ascription` has it).
        { user_ty: annotation.user_ty, span: annotation.span, inferred_ty: annotation.inferred_ty },
      );
    });
    user_tys = ProjectedUserTypesNode.push_user_types(user_tys, base_user_tys);
  }

  // Avoid having to write the full method name at each recursive call.
  const visit_subpat = (this_: Builder, subpat: Pat, user_tys: ProjectedUserTypesNode, f_: typeof f): void => {
    this_.visit_primary_bindings_special(subpat, user_tys, f_);
  };

  const kind = pattern.kind;
  switch (kind.$) {
    case "Binding": {
      const { name, mode, var: var_, ty, subpattern, is_primary } = kind;
      if (is_primary) {
        f(this, name, mode, var_, pattern.span, ty, user_tys);
      }
      if (subpattern !== undefined) {
        visit_subpat(this, subpattern, user_tys, f);
      }
      break;
    }

    case "Array":
    case "Slice": {
      const { prefix, slice, suffix } = kind;
      const from = prefix.length;
      const to = suffix.length;
      for (const subpattern of prefix) {
        visit_subpat(this, subpattern, ProjectedUserTypesNode.index(user_tys), f);
      }
      if (slice !== undefined) {
        visit_subpat(this, slice, ProjectedUserTypesNode.subslice(user_tys, from, to), f);
      }
      for (const subpattern of suffix) {
        visit_subpat(this, subpattern, ProjectedUserTypesNode.index(user_tys), f);
      }
      break;
    }

    case "Constant":
    case "Range":
    case "Missing":
    case "Wild":
    case "Never":
    case "Error":
      break;

    case "Deref": {
      if (kind.pin === Pinnedness.Pinned) {
        // Project into the `Pin(_)` struct, then deref the inner `&` or `&mut`.
        visit_subpat(this, kind.subpattern, ProjectedUserTypesNode.deref(ProjectedUserTypesNode.leaf(user_tys, FieldIdx.ZERO)), f);
      } else {
        visit_subpat(this, kind.subpattern, ProjectedUserTypesNode.deref(user_tys), f);
      }
      break;
    }

    case "DerefPattern": {
      visit_subpat(this, kind.subpattern, ProjectedUserTypesNode.None, f);
      break;
    }

    case "Leaf": {
      for (const subpattern of kind.subpatterns) {
        const subpattern_user_tys = ProjectedUserTypesNode.leaf(user_tys, subpattern.field);
        // debug!("visit_primary_bindings: subpattern_user_tys={subpattern_user_tys:?}");
        visit_subpat(this, subpattern.pattern, subpattern_user_tys, f);
      }
      break;
    }

    case "Variant": {
      const { adt_def, variant_index } = kind;
      for (const subpattern of kind.subpatterns) {
        const subpattern_user_tys = ProjectedUserTypesNode.variant(user_tys, adt_def, variant_index, subpattern.field);
        visit_subpat(this, subpattern.pattern, subpattern_user_tys, f);
      }
      break;
    }
    case "Or": {
      // In cases where we recover from errors the primary bindings
      // may not all be in the leftmost subpattern. For example in
      // `let (x | y) = ...`, the primary binding of `y` occurs in
      // the right subpattern
      for (const subpattern of kind.pats) {
        visit_subpat(this, subpattern, user_tys, f);
      }
      break;
    }
    case "Guard": {
      visit_subpat(this, kind.subpattern, user_tys, f);
      break;
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:952 is_empty
PatternExtraData.prototype.is_empty = function (this: PatternExtraData): boolean {
  return this.bindings.length === 0 && this.ascriptions.length === 0;
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1067 new
(Candidate as unknown as { new: typeof Candidate.new }).new = function (place: PlaceBuilder, pattern: Pat, has_guard: HasMatchGuard, cx: Builder): Candidate {
  // Use `FlatPat` to build simplified match pairs, then immediately
  // incorporate them into a new candidate.
  return Candidate.from_flat_pat(FlatPat.new(place, pattern, cx), has_guard === HasMatchGuard.Yes);
};

/// Incorporates an already-simplified [`FlatPat`] into a new candidate.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1082 from_flat_pat
(Candidate as unknown as { from_flat_pat: typeof Candidate.from_flat_pat }).from_flat_pat = function (flat_pat: FlatPat, has_guard: boolean): Candidate {
  const this_ = new Candidate(
    flat_pat.match_pairs,
    [], // subcandidates
    has_guard,
    flat_pat.extra_data,
    undefined, // or_span
    undefined, // pre_binding_block
    undefined, // otherwise_block
    undefined, // false_edge_start_block
  );
  this_.sort_match_pairs();
  return this_;
};

/// Restores the invariant that or-patterns must be sorted to the end.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1098 sort_match_pairs
Candidate.prototype.sort_match_pairs = function (this: Candidate): void {
  // PORT: `sort_by_key` is a stable sort on the key `false < true`; `Array.prototype.sort` is stable.
  const key = (pair: MatchPairTree): number => (pair.kind.$ === "Or" ? 1 : 0);
  this.match_pairs.sort((a, b) => key(a) - key(b));
};

/// Returns whether the first match pair of this candidate is an or-pattern.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1103 starts_with_or_pattern
Candidate.prototype.starts_with_or_pattern = function (this: Candidate): boolean {
  const first = this.match_pairs[0];
  return first !== undefined && first.kind.$ === "Or";
};

/// Visit the leaf candidates (those with no subcandidates) contained in
/// this candidate.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1112 visit_leaves
Candidate.prototype.visit_leaves = function (this: Candidate, visit_leaf: (this_: Candidate) => void): void {
  traverse_candidate<Candidate, null, Iterable<Candidate>>(
    this,
    null,
    (c, _) => visit_leaf(c),
    (c, _) => c.subcandidates,
    (_) => {},
  );
};

/// Visit the leaf candidates in reverse order.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1123 visit_leaves_rev
Candidate.prototype.visit_leaves_rev = function (this: Candidate, visit_leaf: (this_: Candidate) => void): void {
  traverse_candidate<Candidate, null, Iterable<Candidate>>(
    this,
    null,
    (c, _) => visit_leaf(c),
    (c, _) => rev(c.subcandidates),
    (_) => {},
  );
};

/** `slice.iter_mut().rev()`. */
function* rev<T>(xs: readonly T[]): Generator<T> {
  for (let i = xs.length - 1; i >= 0; i--) yield xs[i]!;
}

/// A depth-first traversal of the `Candidate` and all of its recursive
/// subcandidates.
///
/// This signature is very generic, to support traversing candidate trees by
/// reference or by value, and to allow a mutable "context" to be shared by the
/// traversal callbacks. Most traversals can use the simpler
/// [`Candidate::visit_leaves`] wrapper instead.
// PORT: `C: Borrow<Candidate>` is `C extends Candidate` (by reference and by value are the same object here);
// `I: Iterator<Item = C>` is `I extends Iterable<C>`. `context: &mut T` is the (mutable) object itself.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1141 traverse_candidate
export function traverse_candidate<C extends Candidate, T, I extends Iterable<C>>(
  candidate: C,
  context: T,
  // Called when visiting a "leaf" candidate (with no subcandidates).
  visit_leaf: (a0: C, a1: T) => void,
  // Called when visiting a "node" candidate (with one or more subcandidates).
  // Returns an iterator over the candidate's children (by value or reference).
  // Can perform setup before visiting the node's children.
  get_children: (a0: C, a1: T) => I,
  // Called after visiting a "node" candidate's children.
  complete_children: (a0: T) => void,
): void {
  if (candidate.subcandidates.length === 0) {
    visit_leaf(candidate, context);
  } else {
    for (const child of get_children(candidate, context)) {
      traverse_candidate(child, context, visit_leaf, get_children, complete_children);
    }
    complete_children(context);
  }
}

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1209 as_range
TestableCase.as_range = function (self: TestableCase): PatRange | undefined {
  if (self.$ === "Range") {
    const v = self._0;
    return v;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1357 as_constant
TestBranch.as_constant = function (self: TestBranch): Value | undefined {
  if (self.$ === "Constant") {
    const v = self._0;
    return v;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1419 from_sub_candidate
(MatchTreeSubBranch as unknown as { from_sub_candidate: typeof MatchTreeSubBranch.from_sub_candidate }).from_sub_candidate = function (
  candidate: Candidate,
  parent_data: PatternExtraData[],
): MatchTreeSubBranch {
  // debug_assert!(candidate.match_pairs.is_empty());
  const success_block = candidate.pre_binding_block;
  if (success_block === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const otherwise_block = candidate.otherwise_block;
  if (otherwise_block === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const ascriptions: Ascription[] = [];
  for (const d of parent_data) {
    for (const a of d.ascriptions) ascriptions.push(clone_Ascription(a));
  }
  for (const a of candidate.extra_data.ascriptions) ascriptions.push(a);
  return new MatchTreeSubBranch(
    candidate.extra_data.span,
    success_block,
    otherwise_block,
    sub_branch_bindings(parent_data, candidate.extra_data.bindings),
    ascriptions,
    candidate.extra_data.is_never,
  );
};

// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1441 from_candidate
(MatchTreeBranch as unknown as { from_candidate: typeof MatchTreeBranch.from_candidate }).from_candidate = function (candidate: Candidate): MatchTreeBranch {
  const sub_branches: MatchTreeSubBranch[] = [];
  traverse_candidate<Candidate, PatternExtraData[], Iterable<Candidate>>(
    candidate,
    [],
    (candidate, parent_data) => {
      sub_branches.push(MatchTreeSubBranch.from_sub_candidate(candidate, parent_data));
    },
    (inner_candidate, parent_data) => {
      parent_data.push(inner_candidate.extra_data);
      return inner_candidate.subcandidates;
    },
    (parent_data) => {
      parent_data.pop();
    },
  );
  return new MatchTreeBranch(sub_branches);
};

/// Collects the bindings for a [`MatchTreeSubBranch`], preserving the order they appear in the
/// pattern, as though the or-alternatives chosen in this sub-branch were inlined.
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1463 sub_branch_bindings
export function sub_branch_bindings(parents: readonly PatternExtraData[], leaf_bindings: readonly SubpatternBindings[]): Binding[] {
  // In the common case, all bindings will be in leaves. Allocate to fit the leaf's bindings.
  const all_bindings: Binding[] = [];
  const remainder = (function* (): Generator<readonly SubpatternBindings[]> {
    for (const bindings of [...parents.map((parent) => parent.bindings), leaf_bindings]) {
      // Skip over unsimplified or-patterns without bindings.
      if (bindings.length !== 0) yield bindings;
    }
  })();
  const first = remainder.next();
  if (!first.done) {
    const candidate_bindings = first.value;
    push_sub_branch_bindings(all_bindings, candidate_bindings, remainder);
  }
  // Make sure we've included all bindings. For ill-formed patterns like `(x, _ | y)`, we may not
  // have collected all bindings yet, since we only check the first alternative when determining
  // whether to inline subcandidates' bindings.
  // FIXME(@dianne): prevent ill-formed patterns from getting here
  for (let next = remainder.next(); !next.done; next = remainder.next()) {
    const candidate_bindings = next.value;
    with_((tcx) => {
      tcx.dcx().delayed_bug("mismatched or-pattern bindings but no error emitted");
    });
    // To recover, we collect the rest in an arbitrary order.
    push_sub_branch_bindings(all_bindings, candidate_bindings, remainder);
  }
  return all_bindings;
}

/// Helper for [`sub_branch_bindings`]. Collects bindings from `candidate_bindings` into
/// `flattened`. Bindings in or-patterns are collected recursively from `remainder`.
// PORT: `remainder: &mut impl Iterator<..>` is the shared JS `Iterator` (the stub's `Iterable` could not be advanced).
// rustc: compiler/rustc_mir_build/src/builder/matches/mod.rs:1494 push_sub_branch_bindings
export function push_sub_branch_bindings(flattened: Binding[], candidate_bindings: readonly SubpatternBindings[], remainder: Iterator<readonly SubpatternBindings[]>): void {
  for (const subpat_bindings of candidate_bindings) {
    switch (subpat_bindings.$) {
      case "One": {
        // PORT: `*binding` copies the `Copy` struct `Binding` (its `Place` is a `Copy` class).
        flattened.push(clone_Binding(subpat_bindings._0));
        break;
      }
      case "FromOrPattern": {
        // Inline bindings from an or-pattern. By construction, this always
        // corresponds to a subcandidate and its closest descendants (i.e. those
        // from nested or-patterns, but not adjacent or-patterns). To handle
        // adjacent or-patterns, e.g. `(x | x, y | y)`, we update the `remainder` to
        // point to the first descendant candidate from outside this or-pattern.
        const next = remainder.next();
        if (!next.done) {
          const subcandidate_bindings = next.value;
          push_sub_branch_bindings(flattened, subcandidate_bindings, remainder);
        } else {
          // For ill-formed patterns like `x | _`, we may not have any subcandidates left
          // to inline bindings from.
          // FIXME(@dianne): prevent ill-formed patterns from getting here
          with_((tcx) => {
            tcx.dcx().delayed_bug("mismatched or-pattern bindings but no error emitted");
          });
        }
        break;
      }
    }
  }
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
