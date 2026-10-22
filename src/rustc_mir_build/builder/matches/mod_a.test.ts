// Unit tests of rustc_mir_build builder/matches/mod.rs lines 1-1499 (lane mb-matches-a). MIR building does not reach these
// fns end to end yet (it stops at mb-scope's `in_scope`), so the pure helpers are tested directly and the `Builder` methods
// on a builder whose collaborators (other lanes' stubs) are replaced on the instance.
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

// --- `Builder` methods on a builder with stubbed collaborators ---

function exprs_thir(kinds: ExprKind[]): Thir {
  const thir = Thir.new({ $: "Const" } as never);
  for (const kind of kinds) thir.exprs.push({ kind, ty: undefined as never, temp_scope_id: 0 as never, span: DUMMY_SP } as Expr);
  return thir;
}

function fake_builder(thir: Thir): Builder {
  const b = Object.create(Builder.prototype) as Builder;
  Object.assign(b, { thir, cfg: new CFG([]), coverage_info: undefined, source_scope: 0 as SourceScope });
  b.source_info = (span) => new SourceInfo(span, 0 as SourceScope);
  b.local_scope = () => new RegionScope(0 as never, ScopeData.Node);
  return b;
}

test("Builder::lower_if_condition: `a && b` lowers both as plain conditions; `||` converges; `let` goes to lower_fallible_let", () => {
  // 0: a, 1: b, 2: a && b, 3: a || b, 4: ValueExpr(let), 5: let
  const thir = exprs_thir([
    { $: "VarRef", id: var_id(1) } as ExprKind,
    { $: "VarRef", id: var_id(2) } as ExprKind,
    { $: "LogicalOp", op: "And", lhs: 0 as ExprId, rhs: 1 as ExprId },
    { $: "LogicalOp", op: "Or", lhs: 0 as ExprId, rhs: 1 as ExprId },
    { $: "ValueExpr", source: 5 as ExprId },
    { $: "Let", expr: 0 as ExprId, pat: new Pat(undefined as never, DUMMY_SP, undefined, { $: "Wild" }) },
  ]);
  const b = fake_builder(thir);
  const log: string[] = [];
  let next_local = 10;
  b.as_temp = (block, _tl, expr_id) => {
    log.push(`as_temp(bb${block}, e${expr_id})`);
    return [block, next_local++ as Local];
  };
  b.visit_coverage_branch_condition = () => {};
  b.break_from_if_then_scope = (block) => void log.push(`break(bb${block})`);
  const args = new LowerIfCondArgs(undefined, new SourceInfo(DUMMY_SP, 0 as SourceScope), DeclareLetBindings.Yes);

  const start = b.cfg.start_new_block();
  const [t] = b.lower_if_condition(start, 2 as ExprId, args);
  // a: bb0 -> if(_10) bb1 / bb2 (break), b: bb1 -> if(_11) bb3 / bb4 (break); true block bb3
  expect(log).toEqual(["as_temp(bb0, e0)", "break(bb2)", "as_temp(bb1, e1)", "break(bb4)"]);
  expect(t).toBe(3 as BasicBlock);
  expect(b.cfg.basic_blocks[0]!.terminator!.kind.$).toBe("SwitchInt");

  log.length = 0;
  b.in_if_then_scope = (_scope, _span, f) => {
    const [then_block] = f(b);
    const else_block = b.cfg.start_new_block();
    log.push(`if_then(bb${then_block}, bb${else_block})`);
    return [then_block, else_block];
  };
  const start2 = b.cfg.start_new_block();
  const [t2] = b.lower_if_condition(start2, 3 as ExprId, args);
  // lhs in the inner scope (bb5 -> bb6 / bb7), else bb8; rhs from bb8 (-> bb9 / bb10); both true arms goto bb11
  expect(log).toEqual(["as_temp(bb5, e0)", "break(bb7)", "if_then(bb6, bb8)", "as_temp(bb8, e1)", "break(bb10)"]);
  expect(t2).toBe(11 as BasicBlock);
  for (const bb of [6, 9]) {
    const term = b.cfg.basic_blocks[bb]!.terminator!.kind;
    expect(term.$ === "Goto" && term.target).toBe(11 as BasicBlock);
  }

  let let_args: unknown[] = [];
  b.lower_fallible_let = (...a) => {
    let_args = a;
    return [99 as BasicBlock, null];
  };
  expect(b.lower_if_condition(0 as BasicBlock, 4 as ExprId, args.let_not_permitted())[0]).toBe(99 as BasicBlock);
  expect([let_args[0], let_args[2], let_args[3], let_args[5]]).toEqual([0, 0, 0, "LetNotPermitted"]);
});

test("Builder::declare_guard_bindings declares the `let` patterns under Scope / ValueExpr / `&&` only", () => {
  const pat = (i: number) => new Pat(undefined as never, DUMMY_SP, undefined, { $: "Wild" }) as Pat & { i?: number };
  const [p1, p2, p3] = [pat(1), pat(2), pat(3)];
  // 0: let p1, 1: let p2, 2: let p3, 3: Scope(0), 4: ValueExpr(1), 5: 3 && 4, 6: 5 || 2
  const thir = exprs_thir([
    { $: "Let", expr: 0 as ExprId, pat: p1 },
    { $: "Let", expr: 0 as ExprId, pat: p2 },
    { $: "Let", expr: 0 as ExprId, pat: p3 },
    { $: "Scope", region_scope: new RegionScope(0 as never, ScopeData.Node), hir_id: hir(0), value: 0 as ExprId },
    { $: "ValueExpr", source: 1 as ExprId },
    { $: "LogicalOp", op: "And", lhs: 3 as ExprId, rhs: 4 as ExprId },
    { $: "LogicalOp", op: "Or", lhs: 5 as ExprId, rhs: 2 as ExprId },
  ]);
  const b = fake_builder(thir);
  const seen: Pat[] = [];
  b.declare_bindings = (vis, _span, p, guard, place) => {
    expect([vis, guard, place]).toEqual([7 as SourceScope, undefined, undefined]);
    seen.push(p);
    return vis;
  };
  b.declare_guard_bindings(5 as ExprId, DUMMY_SP, 7 as SourceScope);
  expect(seen).toEqual([p1, p2]);
  expect(seen[0]).toBe(p1);
  seen.length = 0;
  b.declare_guard_bindings(6 as ExprId, DUMMY_SP, 7 as SourceScope);
  expect(seen).toEqual([]);
});

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
