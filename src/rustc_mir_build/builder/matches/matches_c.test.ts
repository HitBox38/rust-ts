// Unit tests of lane mb-matches-c (builder/matches/{test, match_pair, buckets, user_ty, util}.rs). MIR building does not
// reach these files end to end yet (construct_fn stops in scope.rs, docs/handoff/builder-contract.md), so the parts that
// need no other lane's stub are checked here on hand-built match pairs / candidates (upstream behaviour read off the
// pinned sources).
import { expect, test } from "bun:test";
import "../../../rustc_hir_analysis/lib.ts";
import "../../../rustc_middle/lib.ts";
import "../../lib.ts";
import { BasicBlockData, type BasicBlock, type FakeBorrowKind, Local, OUTERMOST_SOURCE_SCOPE, Place, type PlaceElem, SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import type { List } from "../../../rustc_middle/ty/list.ts";
import type { AdtDef, VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import type { UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { create_default_session_globals_then, DUMMY_SP, type Span } from "../../../rustc_span/lib.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { Builder } from "../mod.ts";
import { CFG } from "../mod.gen.ts";
import { InterPat } from "./match_pair.ts";
import { squash_inter_pat } from "./match_pair.ts";
import {
  type Binding,
  Candidate,
  FlatPat,
  type MatchPairTree,
  PatternExtraData,
  type Test,
  type TestableCase,
  type TestBranch,
} from "./mod.ts";
import { ProjectedUserTypesNode } from "./user_ty.ts";
import { FakeBorrowCollector, ref_pat_borrow_kind } from "./util.ts";

const SP = DUMMY_SP;
const NO_PROJ = Object.freeze([]) as unknown as List<PlaceElem>;
const place = (n: number): Place => new Place(Local.from_u32(n), NO_PROJ);
const testable = (p: Place, testable_case: TestableCase, subpairs: MatchPairTree[] = []): MatchPairTree => ({
  kind: { $: "Testable", place: p, testable_case, subpairs },
  pattern_span: SP,
});
const binding = (p: Place, var_id: number): Binding =>
  ({ span: SP, source: p, var_id, binding_mode: undefined, is_shorthand: false }) as unknown as Binding;
const candidate = (match_pairs: MatchPairTree[], bindings: Binding[] = []): Candidate =>
  new Candidate(
    match_pairs,
    [],
    false,
    new PatternExtraData(SP, bindings.map((b) => ({ $: "One" as const, _0: b })), [], false),
    undefined,
    undefined,
    undefined,
    undefined,
  );
/** A `Builder` stand-in for methods that only read the fields given. */
const fake_builder = (fields: object): Builder => Object.assign(Object.create(Builder.prototype), fields) as Builder;

test("user_ty: ProjectedUserTypesNode builds user-type projections in push order", () => {
  const none = ProjectedUserTypesNode.None;
  expect(ProjectedUserTypesNode.build_user_type_projections(none)).toBeUndefined();
  // ops on an empty chain stay empty (maybe_push)
  expect(ProjectedUserTypesNode.leaf(ProjectedUserTypesNode.deref(none), 1 as never)).toBe(none);
  expect(() => ProjectedUserTypesNode.push_user_types(none, [])).toThrow(Panic);

  const base = ProjectedUserTypesNode.push_user_types(none, [0 as UserTypeAnnotationIndex, 2 as UserTypeAnnotationIndex]);
  const n1 = ProjectedUserTypesNode.index(base);
  const n2 = ProjectedUserTypesNode.subslice(n1, 1, 3);
  const n3 = ProjectedUserTypesNode.deref(n2);
  const n4 = ProjectedUserTypesNode.leaf(n3, 4 as never);
  expect([...ProjectedUserTypesNode.iter_ops_reversed(n4)].map((op) => op.$)).toEqual(["Leaf", "Deref", "Subslice", "Index", "PushUserTypes"]);
  const projs = [
    { $: "Index", _0: null },
    { $: "Subslice", from: 1, to: 3, from_end: true },
    { $: "Deref" },
    { $: "Field", _0: 4, _1: null },
  ];
  expect(ProjectedUserTypesNode.build_user_type_projections(n4)!.contents as unknown).toEqual([
    { base: 0, projs },
    { base: 2, projs },
  ]);
  // the parent chain is shared, not consumed: building from n2 sees only its own ops
  expect(ProjectedUserTypesNode.build_user_type_projections(n2)!.contents[0]!.projs as unknown).toEqual(projs.slice(0, 2));

  const adt_def = { variant: (v: VariantIdx) => ({ name: 100 + v }) } as unknown as AdtDef;
  const nv = ProjectedUserTypesNode.variant(base, adt_def, 1 as VariantIdx, 0 as never);
  expect(ProjectedUserTypesNode.build_user_type_projections(nv)!.contents[1] as unknown).toEqual({
    base: 2,
    projs: [
      { $: "Downcast", _0: 101, _1: 1 },
      { $: "Field", _0: 0, _1: null },
    ],
  });
});

test("test.rs: pick_test_for_match_pair maps each testable case to its test", () => {
  const b = fake_builder({});
  const value = { ty: {}, valtree: {} } as never;
  const range = { lo: 0 } as never;
  const cases: [TestableCase, Test["kind"]][] = [
    [{ $: "Variant", adt_def: "A" as never, variant_index: 1 as VariantIdx }, { $: "Switch", adt_def: "A" as never }],
    [{ $: "Constant", value, kind: "Bool" }, { $: "If" }],
    [{ $: "Constant", value, kind: "IntOrChar" }, { $: "SwitchInt" }],
    [{ $: "Constant", value, kind: "String" }, { $: "StringEq", value }],
    [{ $: "Constant", value, kind: "Float" }, { $: "ScalarEq", value }],
    [{ $: "Constant", value, kind: "Other" }, { $: "ScalarEq", value }],
    [{ $: "Range", _0: range }, { $: "Range", _0: range }],
    [{ $: "Slice", len: 3, op: "GreaterOrEqual" }, { $: "SliceLen", len: 3, op: "GreaterOrEqual" }],
    [{ $: "Deref", temp: place(5), mutability: "Mut" }, { $: "Deref", temp: place(5), mutability: "Mut" }],
    [{ $: "Never" }, { $: "Never" }],
  ];
  for (const [tc, kind] of cases) {
    const t = b.pick_test_for_match_pair(testable(place(1), tc));
    expect(t).toEqual({ span: SP, kind });
  }
  // the range is shared (`Arc::clone`)
  const t = b.pick_test_for_match_pair(testable(place(1), { $: "Range", _0: range }));
  expect(t.kind.$ === "Range" && t.kind._0).toBe(range);
  // or-patterns are a bug here
  const or: MatchPairTree = { kind: { $: "Or", or_subpats: [] }, pattern_span: SP };
  expect(() => b.pick_test_for_match_pair(or)).toThrow("or-patterns should have already been handled");
});

test("match_pair.rs: squash_inter_pat flattens irrefutable nodes and orders bindings after subpatterns", () => {
  const [p1, p2, p3] = [place(1), place(2), place(3)];
  const asc = (n: number) => ({ source: place(n), annotation: {}, variance: "Covariant" }) as never;
  // x @ (P1 is Never with inner binding y)
  const inner = new InterPat({ $: "Irrefutable", subpats: [], binding: binding(p2, 2) }, [asc(2)], SP, false);
  const refutable = new InterPat({ $: "Refutable", place: p1, testable_case: { $: "Never" }, subpats: [inner] }, [], SP, true);
  const top = new InterPat({ $: "Irrefutable", subpats: [refutable], binding: binding(p3, 3) }, [asc(3)], 9 as Span, true);
  const flat = FlatPat.from_inter_pat(top);
  expect(flat.extra_data.span).toBe(9 as Span);
  expect(flat.extra_data.is_never).toBe(true);
  expect(flat.match_pairs).toEqual([testable(p1, { $: "Never" })]);
  // ascriptions in visit order (top first), bindings after their subpatterns (inner y before x)
  expect(flat.extra_data.ascriptions.map((a) => a.source.local)).toEqual([3, 2].map((n) => Local.from_u32(n)));
  expect(flat.extra_data.bindings.map((b) => (b.$ === "One" ? b._0.var_id : b.$)) as unknown).toEqual([2, 3]);

  // an or-pattern with bindings holds a place for them; one without does not
  const alt = (n: number, with_binding: boolean) =>
    new InterPat(
      { $: "Refutable", place: p1, testable_case: { $: "Slice", len: n, op: "Equal" }, subpats: with_binding ? [new InterPat({ $: "Irrefutable", subpats: [], binding: binding(p2, n) }, [], SP, false)] : [] },
      [],
      SP,
      false,
    );
  for (const with_binding of [true, false]) {
    const match_pairs: MatchPairTree[] = [];
    const extra = new PatternExtraData(SP, [], [], false);
    squash_inter_pat(new InterPat({ $: "Or", or_subpats: [alt(1, with_binding), alt(2, with_binding)] }, [], SP, false), match_pairs, extra);
    expect(extra.bindings.map((b) => b.$)).toEqual(with_binding ? ["FromOrPattern"] : []);
    expect(match_pairs.length).toBe(1);
    const k = match_pairs[0]!.kind;
    expect(k.$ === "Or" && k.or_subpats.map((f) => [f.match_pairs.length, f.extra_data.bindings.length])).toEqual([
      [1, with_binding ? 1 : 0],
      [1, with_binding ? 1 : 0],
    ]);
  }
});

test("buckets.rs: slice-length tests bucket candidates without fully matching them", () => {
  const p = place(1);
  const b = fake_builder({});
  const slice = (len: number, op: "Equal" | "GreaterOrEqual"): TestableCase => ({ $: "Slice", len, op });
  const eq4: Test = { span: SP, kind: { $: "SliceLen", len: 4, op: "Equal" } };
  const ge4: Test = { span: SP, kind: { $: "SliceLen", len: 4, op: "GreaterOrEqual" } };
  const none = new KeyedMap<TestBranch, Candidate[]>(intern_key);
  const cases: [Test, TestableCase, TestBranch["$"] | undefined][] = [
    [eq4, slice(5, "Equal"), "Failure"],
    [eq4, slice(5, "GreaterOrEqual"), "Failure"],
    [eq4, slice(4, "GreaterOrEqual"), undefined],
    [eq4, slice(3, "GreaterOrEqual"), undefined],
    [eq4, slice(3, "Equal"), "Failure"],
    [ge4, slice(5, "Equal"), "Success"],
    [ge4, slice(4, "Equal"), "Success"],
    [ge4, slice(3, "Equal"), "Failure"],
    [ge4, slice(3, "GreaterOrEqual"), undefined],
    // unrelated pairs: the catch-all arm
    [{ span: SP, kind: { $: "If" } }, slice(3, "Equal"), undefined],
  ];
  for (const [t, tc, want] of cases) {
    const mp = testable(p, tc);
    const c = candidate([mp]);
    expect(b.choose_bucket_for_candidate(p, t, c, none)?.$).toBe(want);
    expect(c.match_pairs).toEqual([mp]); // not fully matched: untouched
  }
  // a candidate without a pair on the tested place is not bucketed
  expect(b.choose_bucket_for_candidate(place(2), eq4, candidate([testable(p, slice(5, "Equal"))]), none)).toBeUndefined();

  // partition: bucketing stops at the first unbucketed candidate; buckets are keyed by value
  const c0 = candidate([testable(p, slice(5, "Equal"))]);
  const c1 = candidate([testable(p, slice(3, "Equal"))]);
  const c2 = candidate([testable(p, slice(4, "GreaterOrEqual"))]);
  const c3 = candidate([testable(p, slice(6, "Equal"))]);
  const parts = b.partition_candidates_into_buckets(p, eq4, [c0, c1, c2, c3]);
  expect([...parts.target_candidates.keys()]).toEqual([{ $: "Failure" }]);
  expect(parts.target_candidates.get({ $: "Failure" })).toEqual([c0, c1]);
  expect(parts.remaining_candidates.length).toBe(2);
  expect(parts.remaining_candidates[0]).toBe(c2);
  // at least the first candidate must be tested
  create_default_session_globals_then(() => {
    expect(() => b.partition_candidates_into_buckets(p, eq4, [c2])).toThrow(/^1, \[\n    Candidate \{\n/);
  });
});

test("buckets.rs: a fully matched pair is replaced by its sub-pairs", () => {
  const p = place(1);
  const b = fake_builder({});
  const sub = testable(place(2), { $: "Never" });
  const other = testable(place(3), { $: "Slice", len: 1, op: "Equal" });
  const c = candidate([testable(p, { $: "Slice", len: 4, op: "Equal" }, [sub]), other]);
  let ret: TestBranch | undefined;
  try {
    ret = b.choose_bucket_for_candidate(p, { span: SP, kind: { $: "SliceLen", len: 4, op: "Equal" } }, c, new KeyedMap<TestBranch, Candidate[]>(intern_key));
    expect(ret).toEqual({ $: "Success" });
  } catch (e) {
    // `Candidate::sort_match_pairs` is lane mb-matches-a's; until it lands the call stops there, after the splice
    if (!(e instanceof Unported) || !e.message.includes("Candidate::sort_match_pairs")) throw e;
  }
  expect(c.match_pairs).toEqual([other, sub]);
});

test("util.rs: false_edges, ref_pat_borrow_kind and the fake-borrow collector", () => {
  const cfg = new CFG([]);
  const bb = (): BasicBlock => cfg.start_new_block();
  const [b0, b1, b2, b3] = [bb(), bb(), bb(), bb()];
  const b = fake_builder({ cfg });
  const si = new SourceInfo(DUMMY_SP, OUTERMOST_SOURCE_SCOPE);
  b.false_edges(b0, b1, b2, si);
  b.false_edges(b3, b1, b1, si);
  expect(cfg.basic_blocks.map((d: BasicBlockData) => d.terminator?.kind)).toEqual([
    { $: "FalseEdge", real_target: b1, imaginary_target: b2 },
    undefined,
    undefined,
    { $: "Goto", target: b1, loop_hint_attrs: [] },
  ]);

  expect(ref_pat_borrow_kind("Not")).toEqual({ $: "Shared" });
  expect(ref_pat_borrow_kind("Mut")).toEqual({ $: "Mut", kind: "Default" });

  // places without deref projections: switched-on places are borrowed shallowly, deref-pattern places deeply,
  // and a later shallow borrow never weakens a deep one; bindings outside the scrutinee base are skipped
  const collector = new FakeBorrowCollector(fake_builder({}), { $: "Local", _0: Local.from_u32(1) }, new KeyedMap<Place, FakeBorrowKind>(intern_key));
  const p1 = place(1);
  collector.visit_candidate(
    candidate(
      [
        testable(p1, { $: "Deref", temp: place(9), mutability: "Not" }, [testable(place(9), { $: "Never" })]),
        testable(place(2), { $: "Never" }, [testable(place(4), { $: "Never" })]),
        testable(new Place(Local.from_u32(1), NO_PROJ), { $: "Never" }),
      ],
      [binding(place(7), 1)],
    ),
  );
  expect([...collector.fake_borrows].map(([p, k]) => [p.local, k])).toEqual([
    [Local.from_u32(1), "Deep"],
    [Local.from_u32(2), "Shallow"],
    [Local.from_u32(4), "Shallow"],
  ]);
});
