// Unit tests of rustc_mir_build builder/matches/mod.rs lines 1-1499 (lane mb-matches-a): the pure helpers, and
// `visit_primary_bindings` (a pattern walk) on a bare `Builder` object. The `Builder` methods that build MIR
// (`lower_if_condition` with `&&` / `||` / `let`, `declare_guard_bindings` under an `if let` guard, `lower_match_arms`,
// `declare_bindings`, ...) run end to end in builder/contract.test.ts, whose built MIR is compared with the oracle's.
import { expect, test } from "bun:test";
import "../../../rustc_middle/lib.ts";
import "../../lib.ts";
import { BindingMode, ByRef } from "../../../rustc_ast/lib.ts";
import { HirId_from_OwnerId, OwnerId_new, type HirId } from "../../../rustc_hir_id/lib.ts";
import { Scope as RegionScope, ScopeData } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Local, Place_from_Local, SourceInfo, type SourceScope } from "../../../rustc_middle/mir/mod.ts";
import { Pat, type ExprId, type Expr, type ExprKind, type LocalVarId, type PatKind, Thir } from "../../../rustc_middle/thir.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { Builder, CFG } from "../mod.ts";
import {
  type Ascription,
  type Binding,
  Candidate,
  DeclareLetBindings,
  FlatPat,
  LowerIfCondArgs,
  type MatchPairTree,
  MatchTreeBranch,
  MatchTreeSubBranch,
  PatternExtraData,
  type SubpatternBindings,
  TestBranch,
  TestableCase,
  sub_branch_bindings,
} from "./mod.ts";

const hir = (i: number): HirId => HirId_from_OwnerId(OwnerId_new(i));
const var_id = (i: number): LocalVarId => ({ _0: hir(i) });
const binding = (i: number): Binding => ({
  span: DUMMY_SP,
  source: Place_from_Local(i as Local),
  var_id: var_id(i),
  binding_mode: new BindingMode(ByRef.No, "Not"),
  is_shorthand: false,
});
const one = (i: number): SubpatternBindings => ({ $: "One", _0: binding(i) });
const FROM_OR: SubpatternBindings = { $: "FromOrPattern" };
const ids = (bs: readonly Binding[]): number[] => bs.map((b) => b.source.local as number);
const extra = (bindings: SubpatternBindings[] = [], ascriptions: Ascription[] = []): PatternExtraData =>
  new PatternExtraData(DUMMY_SP, bindings, ascriptions, false);
const testable = (local: number): MatchPairTree => ({
  kind: { $: "Testable", place: Place_from_Local(local as Local), testable_case: TestableCase.Never, subpairs: [] },
  pattern_span: DUMMY_SP,
});
const or_pair = (n: number): MatchPairTree => ({
  kind: { $: "Or", or_subpats: Array.from({ length: n }, () => new FlatPat([], extra())) },
  pattern_span: DUMMY_SP,
});
const leaf = (bindings: SubpatternBindings[], pre: number, otherwise: number): Candidate => {
  const c = Candidate.from_flat_pat(new FlatPat([], extra(bindings)), false);
  c.pre_binding_block = pre as BasicBlock;
  c.otherwise_block = otherwise as BasicBlock;
  return c;
};

test("LowerIfCondArgs::let_not_permitted copies the args with LetNotPermitted", () => {
  const scope = new RegionScope(3 as never, ScopeData.Node);
  const args = new LowerIfCondArgs(scope, new SourceInfo(DUMMY_SP, 0 as SourceScope), DeclareLetBindings.Yes);
  const sub = args.let_not_permitted();
  expect(sub).not.toBe(args);
  expect(sub.declare_let_bindings).toBe("LetNotPermitted");
  expect(sub.temp_scope_override).toBe(scope);
  expect(sub.variable_source_info).toBe(args.variable_source_info);
  expect(args.declare_let_bindings).toBe("Yes");
});

test("PatternExtraData::is_empty looks at bindings and ascriptions only", () => {
  expect(extra().is_empty()).toBe(true);
  expect(extra([one(1)]).is_empty()).toBe(false);
  const e = extra();
  e.is_never = true;
  expect(e.is_empty()).toBe(true);
});

test("Candidate::from_flat_pat sorts or-patterns to the end (stably); starts_with_or_pattern", () => {
  const pairs = [or_pair(2), testable(1), or_pair(3), testable(2)];
  const c = Candidate.from_flat_pat(new FlatPat(pairs.slice(), extra()), true);
  expect(c.match_pairs).toEqual([pairs[1], pairs[3], pairs[0], pairs[2]]);
  expect(c.has_guard).toBe(true);
  expect([c.subcandidates.length, c.or_span, c.pre_binding_block, c.otherwise_block, c.false_edge_start_block]).toEqual([0, undefined, undefined, undefined, undefined]);
  expect(c.starts_with_or_pattern()).toBe(false);
  expect(Candidate.from_flat_pat(new FlatPat([or_pair(2)], extra()), false).starts_with_or_pattern()).toBe(true);
  expect(Candidate.from_flat_pat(new FlatPat([], extra()), false).starts_with_or_pattern()).toBe(false);
});

test("Candidate::visit_leaves / visit_leaves_rev visit the leaves depth-first", () => {
  // root -> [a -> [l1, l2], l3]
  const [l1, l2, l3] = [leaf([], 1, 0), leaf([], 2, 0), leaf([], 3, 0)];
  const a = leaf([], 0, 0);
  a.subcandidates = [l1, l2];
  const root = leaf([], 0, 0);
  root.subcandidates = [a, l3];
  const seen: Candidate[] = [];
  root.visit_leaves((c) => seen.push(c));
  expect(seen).toEqual([l1, l2, l3]);
  seen.length = 0;
  root.visit_leaves_rev((c) => seen.push(c));
  expect(seen).toEqual([l3, l2, l1]);
  seen.length = 0;
  l1.visit_leaves((c) => seen.push(c));
  expect(seen).toEqual([l1]);
});

test("TestableCase::as_range / TestBranch::as_constant", () => {
  const range = { lo: "NegInfinity", hi: "PosInfinity", end: "Included", ty: undefined } as never;
  expect(TestableCase.as_range({ $: "Range", _0: range })).toBe(range);
  expect(TestableCase.as_range(TestableCase.Never)).toBe(undefined);
  const value = {} as never;
  expect(TestBranch.as_constant({ $: "Constant", _0: value })).toBe(value);
  expect(TestBranch.as_constant(TestBranch.Success)).toBe(undefined);
  expect(TestBranch.as_constant({ $: "Variant", _0: 1 as never })).toBe(undefined);
});

test("sub_branch_bindings inlines or-pattern bindings in pattern order", () => {
  // `(x | x, y)` with the leaf of the first alternative: parent [FromOr, y], leaf [x]
  expect(ids(sub_branch_bindings([extra([FROM_OR, one(2)])], [one(1)]))).toEqual([1, 2]);
  // `(x | x, y | y)`: parents [FromOr, FromOr] -> nested descendants come from `remainder` in order
  expect(ids(sub_branch_bindings([extra([FROM_OR, FROM_OR]), extra([one(1)])], [one(2)]))).toEqual([1, 2]);
  // parents without bindings (unsimplified or-patterns) are skipped
  expect(ids(sub_branch_bindings([extra([]), extra([one(3), FROM_OR])], [one(4)]))).toEqual([3, 4]);
  expect(sub_branch_bindings([], [])).toEqual([]);
  // `*binding` is a copy
  const b = one(5);
  const out = sub_branch_bindings([], [b]);
  expect(out[0]).toEqual((b as { _0: Binding })._0);
  expect(out[0]).not.toBe((b as { _0: Binding })._0);
});

test("MatchTreeBranch::from_candidate builds one sub-branch per leaf with the parents' data", () => {
  const asc = (n: number): Ascription => ({ source: Place_from_Local(n as Local), annotation: { user_ty: undefined as never, span: DUMMY_SP, inferred_ty: undefined as never }, variance: "Covariant" });
  // arm `(x | x, y)` with a parent ascription: root extra [FromOr, y] / asc 7, leaves [x@1] and [x@2]
  const root = Candidate.from_flat_pat(new FlatPat([], extra([FROM_OR, one(9)], [asc(7)])), true);
  const l1 = leaf([one(1)], 10, 11);
  l1.extra_data.ascriptions = [asc(8)];
  const l2 = leaf([one(2)], 12, 13);
  l2.extra_data.is_never = true;
  root.subcandidates = [l1, l2];
  const branch = MatchTreeBranch.from_candidate(root);
  expect(branch.sub_branches.length).toBe(2);
  const [s1, s2] = branch.sub_branches as [MatchTreeSubBranch, MatchTreeSubBranch];
  expect([s1.success_block, s1.otherwise_block, s2.success_block, s2.otherwise_block]).toEqual([10, 11, 12, 13] as BasicBlock[]);
  expect(ids(s1.bindings)).toEqual([1, 9]);
  expect(ids(s2.bindings)).toEqual([2, 9]);
  expect(s1.ascriptions.map((a) => a.source.local as number)).toEqual([7, 8]);
  expect(s2.ascriptions.map((a) => a.source.local as number)).toEqual([7]);
  expect([s1.is_never, s2.is_never]).toEqual([false, true]);
  // a leaf root is its own single sub-branch
  expect(MatchTreeBranch.from_candidate(leaf([one(4)], 1, 2)).sub_branches.map((s) => ids(s.bindings))).toEqual([[4]]);
  // `pre_binding_block.unwrap()`
  expect(() => MatchTreeSubBranch.from_sub_candidate(Candidate.from_flat_pat(new FlatPat([], extra()), false), [])).toThrow();
});

// --- `visit_primary_bindings` ---

function exprs_thir(kinds: ExprKind[]): Thir {
  const thir = Thir.new({ $: "Const" } as never);
  for (const kind of kinds) thir.exprs.push({ kind, ty: undefined as never, temp_scope_id: 0 as never, span: DUMMY_SP } as Expr);
  return thir;
}

/** A bare `Builder` object with the fields `visit_primary_bindings` may read (no method is replaced). */
function fake_builder(thir: Thir): Builder {
  const b = Object.create(Builder.prototype) as Builder;
  Object.assign(b, { thir, cfg: new CFG([]), coverage_info: undefined, source_scope: 0 as SourceScope });
  return b;
}

test("Builder::visit_primary_bindings visits the primary bindings in walk order", () => {
  const bind = (i: number, is_primary: boolean, subpattern?: Pat): Pat =>
    new Pat(undefined as never, DUMMY_SP, undefined, {
      $: "Binding",
      name: 0 as Symbol,
      mode: new BindingMode(ByRef.No, "Not"),
      var: var_id(i),
      ty: undefined as never,
      subpattern,
      is_primary,
      is_shorthand: false,
    } as PatKind);
  const p = new Pat(undefined as never, DUMMY_SP, undefined, {
    $: "Or",
    pats: [new Pat(undefined as never, DUMMY_SP, undefined, { $: "Leaf", subpatterns: [{ field: 0 as never, pattern: bind(1, true, bind(2, true)) }] }), bind(1, false)],
  });
  const b = fake_builder(exprs_thir([]));
  const seen: HirId[] = [];
  b.visit_primary_bindings(p, (this_, v) => {
    expect(this_).toBe(b);
    seen.push(v._0);
  });
  expect(seen).toEqual([hir(1), hir(2)]);
});
