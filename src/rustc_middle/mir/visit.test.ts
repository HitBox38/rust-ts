// Tests of the `make_mir_visitor!` expansions (visit.ts, lane mir-visit) on hand-built MIR: a recording visitor checks
// the exact sequence of callbacks, `PlaceContext`s and `TyContext`s against the walk order the macro defines
// (compiler/rustc_middle/src/mir/visit.rs), for every statement / terminator / rvalue / operand / place / constant kind;
// `MutVisitor` write-backs (locals, types, spans, regions, consts, args, projections) are checked with rewriting visitors.
import { expect, test } from "bun:test";
import type { Span } from "../../rustc_span/lib.ts";
import type { Const as ty_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Panic } from "../../std/panic.ts";
import "../lib.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Region, Ty } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import type { List } from "../ty/list.ts";
import type { CanonicalUserTypeAnnotation, UserTypeAnnotationIndex } from "../ty/typeck_results.ts";
import {
  BasicBlock,
  BasicBlockData,
  BasicBlocks,
  Body,
  ConstOperand,
  CoroutineInfo,
  debug_Location,
  Local,
  LocalDecl,
  Location,
  Place,
  PlaceRef,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  Statement,
  StmtDebugInfos,
  Terminator,
  UserTypeProjections,
  type AssertMessage,
  type Operand,
  type PlaceElem,
  type Rvalue,
  type StatementKind,
  type StmtDebugInfo,
  type TerminatorKind,
  type UserTypeProjection,
  type VarDebugInfo,
} from "./mod.ts";
import { debug_PlaceContext, MutVisitor, PlaceContext, type TyContext, Visitor, VisitPlacesWith } from "./visit.ts";

// ---- hand-built MIR ----
const names = new Map<unknown, string>();
const interned = new Map<string, object>();
/** A named stand-in for an interned value (`Ty`, `Region`, `ty::Const`, `GenericArgsRef`): unique per name. */
function named<T>(name: string): T {
  let v = interned.get(name);
  if (v === undefined) {
    v = Object.freeze({ name });
    interned.set(name, v);
    names.set(v, name);
  }
  return v as T;
}
const ty = (n: string): Ty => named<Ty>(n);
const N = (v: unknown): string => names.get(v) ?? `?${String(v)}`;
const sp = (n: number): Span => n as Span;
const L = (n: number): Local => Local.from_u32(n);
const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);
const loc = (b: number, i: number): Location => new Location(bb(b), i);
const list = (elems: readonly PlaceElem[]): List<PlaceElem> => Object.freeze([...elems]) as unknown as List<PlaceElem>;
const place = (l: number, elems: PlaceElem[] = []): Place => new Place(L(l), list(elems));
const si = (span: number, scope = 0): SourceInfo => new SourceInfo(sp(span), SourceScope.from_u32(scope));
const no_dbg = (): StmtDebugInfos => new StmtDebugInfos(undefined);
const stmt = (kind: StatementKind, debuginfos: StmtDebugInfo[] | undefined = undefined): Statement =>
  new Statement(si(1), kind, new StmtDebugInfos(debuginfos));
const term = (kind: TerminatorKind): Terminator => new Terminator(si(2), kind);
const copy = (p: Place): Operand => ({ $: "Copy", _0: p });
const move = (p: Place): Operand => ({ $: "Move", _0: p });
const cst = (span: number, c: ConstOperand["const_"]): ConstOperand => new ConstOperand(sp(span), undefined, c);
const val = (span: number, t: string): Operand => ({ $: "Constant", _0: cst(span, { $: "Val", _0: null as never, _1: ty(t) }) });
const UNWIND = { $: "Continue" } as const;

function P(local: Local, projection: readonly PlaceElem[]): string {
  return `_${local}` + projection.map((e) => `.${e.$}`).join("");
}
const C = (ctx: PlaceContext): string => debug_PlaceContext(ctx, PLAIN);
const LOC = (l: Location): string => debug_Location(l, PLAIN);
function TC(ctx: TyContext): string {
  switch (ctx.$) {
    case "LocalDecl":
      return `LocalDecl(_${ctx.local}, span ${ctx.source_info.span})`;
    case "UserTy":
      return `UserTy(${ctx._0})`;
    case "ReturnTy":
    case "YieldTy":
    case "ResumeTy":
      return `${ctx.$}(span ${ctx._0.span})`;
    case "Location":
      return `Location(${LOC(ctx._0)})`;
  }
}

/** Records every callback of `Visitor`, then runs the default (`super.visit_x` = `self.super_x`). */
class Rec extends Visitor {
  ev: string[] = [];
  override visit_body(body: Body): void {
    this.ev.push("body");
    super.visit_body(body);
  }
  override visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.ev.push(`block bb${block}`);
    super.visit_basic_block_data(block, data);
  }
  override visit_source_scope_data(scope_data: SourceScopeData): void {
    this.ev.push("scope_data");
    super.visit_source_scope_data(scope_data);
  }
  override visit_statement_debuginfo(d: StmtDebugInfo, location: Location): void {
    this.ev.push(`debuginfo ${d.$} ${LOC(location)}`);
    super.visit_statement_debuginfo(d, location);
  }
  override visit_statement(s: Statement, location: Location): void {
    this.ev.push(`statement ${s.kind.$} ${LOC(location)}`);
    super.visit_statement(s, location);
  }
  override visit_assign(p: Place, r: Rvalue, location: Location): void {
    this.ev.push("assign");
    super.visit_assign(p, r, location);
  }
  override visit_terminator(t: Terminator, location: Location): void {
    this.ev.push(`terminator ${t.kind.$} ${LOC(location)}`);
    super.visit_terminator(t, location);
  }
  override visit_assert_message(msg: AssertMessage, location: Location): void {
    this.ev.push(`assert_message ${msg.$}`);
    super.visit_assert_message(msg, location);
  }
  override visit_rvalue(r: Rvalue, location: Location): void {
    this.ev.push(`rvalue ${r.$}`);
    super.visit_rvalue(r, location);
  }
  override visit_operand(o: Operand, location: Location): void {
    this.ev.push(`operand ${o.$}`);
    super.visit_operand(o, location);
  }
  override visit_ascribe_user_ty(p: Place, variance: Variance, u: UserTypeProjection, location: Location): void {
    this.ev.push(`ascribe_user_ty ${variance}`);
    super.visit_ascribe_user_ty(p, variance, u, location);
  }
  override visit_coverage(kind: never, location: Location): void {
    this.ev.push("coverage");
    super.visit_coverage(kind, location);
  }
  override visit_place(p: Place, ctx: PlaceContext, location: Location): void {
    this.ev.push(`place ${P(p.local, p.projection)} ${C(ctx)}`);
    super.visit_place(p, ctx, location);
  }
  override visit_projection(r: PlaceRef, ctx: PlaceContext, location: Location): void {
    this.ev.push(`projection ${P(r.local, r.projection)} ${C(ctx)}`);
    super.visit_projection(r, ctx, location);
  }
  override visit_projection_elem(r: PlaceRef, elem: PlaceElem, ctx: PlaceContext, location: Location): void {
    this.ev.push(`elem ${P(r.local, r.projection)} ${elem.$} ${C(ctx)}`);
    super.visit_projection_elem(r, elem, ctx, location);
  }
  override visit_const_operand(c: ConstOperand, location: Location): void {
    this.ev.push(`const_operand ${c.const_.$} ${LOC(location)}`);
    super.visit_const_operand(c, location);
  }
  override visit_ty_const(ct: ty_Const, location: Location): void {
    this.ev.push(`ty_const ${N(ct)}`);
    super.visit_ty_const(ct, location);
  }
  override visit_span(span: Span): void {
    this.ev.push(`span ${span}`);
    super.visit_span(span);
  }
  override visit_source_info(s: SourceInfo): void {
    this.ev.push("source_info");
    super.visit_source_info(s);
  }
  override visit_ty(t: Ty, ctx: TyContext): void {
    this.ev.push(`ty ${N(t)} ${TC(ctx)}`);
    super.visit_ty(t, ctx);
  }
  override visit_user_type_projection(u: UserTypeProjection): void {
    this.ev.push(`user_type_projection ${u.base}`);
    super.visit_user_type_projection(u);
  }
  override visit_user_type_annotation(index: UserTypeAnnotationIndex, a: CanonicalUserTypeAnnotation): void {
    this.ev.push(`user_type_annotation ${index}`);
    super.visit_user_type_annotation(index, a);
  }
  override visit_region(r: Region, location: Location): void {
    this.ev.push(`region ${N(r)}`);
    super.visit_region(r, location);
  }
  override visit_args(a: GenericArgsRef, location: Location): void {
    this.ev.push(`args ${N(a)}`);
    super.visit_args(a, location);
  }
  override visit_local_decl(local: Local, d: LocalDecl): void {
    this.ev.push(`local_decl _${local}`);
    super.visit_local_decl(local, d);
  }
  override visit_var_debug_info(v: VarDebugInfo): void {
    this.ev.push("var_debug_info");
    super.visit_var_debug_info(v);
  }
  override visit_local(local: Local, ctx: PlaceContext, location: Location): void {
    this.ev.push(`local _${local} ${C(ctx)}`);
    super.visit_local(local, ctx, location);
  }
  override visit_source_scope(scope: SourceScope): void {
    this.ev.push(`source_scope ${scope}`);
    super.visit_source_scope(scope);
  }
}

/** Records every callback of `MutVisitor` (same format as `Rec`), then runs the default. */
class MutRec extends MutVisitor {
  ev: string[] = [];
  tcx(): TyCtxt {
    return { mk_place_elems: (v: readonly PlaceElem[]) => list(v) } as unknown as TyCtxt;
  }
  override visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.ev.push(`block bb${block}`);
    super.visit_basic_block_data(block, data);
  }
  override visit_source_scope_data(scope_data: SourceScopeData): void {
    this.ev.push("scope_data");
    super.visit_source_scope_data(scope_data);
  }
  override visit_statement_debuginfo(d: StmtDebugInfo, location: Location): void {
    this.ev.push(`debuginfo ${d.$} ${LOC(location)}`);
    super.visit_statement_debuginfo(d, location);
  }
  override visit_statement(s: Statement, location: Location): void {
    this.ev.push(`statement ${s.kind.$} ${LOC(location)}`);
    super.visit_statement(s, location);
  }
  override visit_assign(p: Place, r: Rvalue, location: Location): void {
    this.ev.push("assign");
    super.visit_assign(p, r, location);
  }
  override visit_terminator(t: Terminator, location: Location): void {
    this.ev.push(`terminator ${t.kind.$} ${LOC(location)}`);
    super.visit_terminator(t, location);
  }
  override visit_assert_message(msg: AssertMessage, location: Location): void {
    this.ev.push(`assert_message ${msg.$}`);
    super.visit_assert_message(msg, location);
  }
  override visit_rvalue(r: Rvalue, location: Location): void {
    this.ev.push(`rvalue ${r.$}`);
    super.visit_rvalue(r, location);
  }
  override visit_operand(o: Operand, location: Location): void {
    this.ev.push(`operand ${o.$}`);
    super.visit_operand(o, location);
  }
  override visit_ascribe_user_ty(p: Place, variance: MutRef<Variance>, u: UserTypeProjection, location: Location): void {
    this.ev.push(`ascribe_user_ty ${variance.value}`);
    super.visit_ascribe_user_ty(p, variance, u, location);
  }
  override visit_coverage(kind: never, location: Location): void {
    this.ev.push("coverage");
    super.visit_coverage(kind, location);
  }
  override visit_place(p: Place, ctx: PlaceContext, location: Location): void {
    this.ev.push(`place ${P(p.local, p.projection)} ${C(ctx)}`);
    super.visit_place(p, ctx, location);
  }
  override visit_const_operand(c: ConstOperand, location: Location): void {
    this.ev.push(`const_operand ${c.const_.$} ${LOC(location)}`);
    super.visit_const_operand(c, location);
  }
  override visit_ty_const(ct: MutRef<ty_Const>, location: Location): void {
    this.ev.push(`ty_const ${N(ct.value)}`);
    super.visit_ty_const(ct, location);
  }
  override visit_span(span: MutRef<Span>): void {
    this.ev.push(`span ${span.value}`);
    super.visit_span(span);
  }
  override visit_source_info(s: SourceInfo): void {
    this.ev.push("source_info");
    super.visit_source_info(s);
  }
  override visit_ty(t: MutRef<Ty>, ctx: TyContext): void {
    this.ev.push(`ty ${N(t.value)} ${TC(ctx)}`);
    super.visit_ty(t, ctx);
  }
  override visit_user_type_projection(u: UserTypeProjection): void {
    this.ev.push(`user_type_projection ${u.base}`);
    super.visit_user_type_projection(u);
  }
  override visit_user_type_annotation(index: UserTypeAnnotationIndex, a: CanonicalUserTypeAnnotation): void {
    this.ev.push(`user_type_annotation ${index}`);
    super.visit_user_type_annotation(index, a);
  }
  override visit_region(r: MutRef<Region>, location: Location): void {
    this.ev.push(`region ${N(r.value)}`);
    super.visit_region(r, location);
  }
  override visit_args(a: MutRef<GenericArgsRef>, location: Location): void {
    this.ev.push(`args ${N(a.value)}`);
    super.visit_args(a, location);
  }
  override visit_local_decl(local: Local, d: LocalDecl): void {
    this.ev.push(`local_decl _${local}`);
    super.visit_local_decl(local, d);
  }
  override visit_var_debug_info(v: VarDebugInfo): void {
    this.ev.push("var_debug_info");
    super.visit_var_debug_info(v);
  }
  override visit_local(local: MutRef<Local>, ctx: PlaceContext, location: Location): void {
    this.ev.push(`local _${local.value} ${C(ctx)}`);
    super.visit_local(local, ctx, location);
  }
  override visit_source_scope(scope: MutRef<SourceScope>): void {
    this.ev.push(`source_scope ${scope.value}`);
    super.visit_source_scope(scope);
  }
}

function rec(f: (v: Rec) => void): string[] {
  const v = new Rec();
  f(v);
  return v.ev;
}
function mrec(f: (v: MutRec) => void): string[] {
  const v = new MutRec();
  f(v);
  return v.ev;
}

const L0 = loc(0, 0);
const SI = ["source_info", "span 1", "source_scope 0"]; // a statement's `SourceInfo` (si(1))
const TI = ["source_info", "span 2", "source_scope 0"]; // a terminator's `SourceInfo` (si(2))
/** Events of `visit_place` of a projection-free place in `Visitor`. */
const plain = (l: number, ctx: string): string[] => [`place _${l} ${ctx}`, `local _${l} ${ctx}`, `projection _${l} ${ctx}`];
/** Events of `visit_place` of a projection-free place in `MutVisitor` (no `visit_projection`). */
const mplain = (l: number, ctx: string): string[] => [`place _${l} ${ctx}`, `local _${l} ${ctx}`];

const COPY = "NonMutatingUse(Copy)";
const MOVE = "NonMutatingUse(Move)";
const INSPECT = "NonMutatingUse(Inspect)";
const DBG = "NonUse(VarDebugInfo)";
const NM_PROJ = "NonMutatingUse(Projection)";
const M_PROJ = "MutatingUse(Projection)";

// ---- Visitor ----

test("Visitor: every StatementKind, statement debuginfos", () => {
  const field: PlaceElem = { $: "Field", _0: 0 as never, _1: ty("FT") };
  const proj = place(2, [{ $: "Deref" }, { $: "Index", _0: L(3) }, field]);
  const debuginfos: StmtDebugInfo[] = [
    { $: "AssignRef", _0: L(4), _1: place(5) },
    { $: "InvalidAssign", _0: L(6) },
  ];
  expect(rec((v) => v.visit_statement(stmt({ $: "Assign", _0: [place(1), { $: "Use", _0: copy(proj), _1: "No" }] }, debuginfos), L0))).toEqual([
    "statement Assign bb0[0]",
    ...SI,
    "debuginfo AssignRef bb0[0]",
    `local _4 ${DBG}`,
    ...plain(5, DBG),
    "debuginfo InvalidAssign bb0[0]",
    `local _6 ${DBG}`,
    "assign",
    ...plain(1, "MutatingUse(Store)"),
    "rvalue Use",
    "operand Copy",
    `place _2.Deref.Index.Field ${COPY}`,
    // a real use with projections: the base local and the projection get the `Projection` context
    `local _2 ${NM_PROJ}`,
    `projection _2.Deref.Index.Field ${NM_PROJ}`,
    // `iter_projections().rev()`: outermost projection first
    `elem _2.Deref.Index Field ${NM_PROJ}`,
    "ty FT Location(bb0[0])",
    `elem _2.Deref Index ${NM_PROJ}`,
    `local _3 ${COPY}`,
    `elem _2 Deref ${NM_PROJ}`,
  ]);
  const cases: [StatementKind, string[]][] = [
    [{ $: "FakeRead", _0: [{ $: "ForIndex" }, place(1)] }, plain(1, INSPECT)],
    [{ $: "SetDiscriminant", place: place(1), variant_index: 0 as never }, plain(1, "MutatingUse(SetDiscriminant)")],
    [{ $: "StorageLive", _0: L(3) }, ["local _3 NonUse(StorageLive)"]],
    [{ $: "StorageDead", _0: L(3) }, ["local _3 NonUse(StorageDead)"]],
    [{ $: "PlaceMention", _0: place(1) }, plain(1, "NonMutatingUse(PlaceMention)")],
    [
      { $: "AscribeUserType", _0: [place(1), { base: 7 as UserTypeAnnotationIndex, projs: [] }], _1: "Contravariant" },
      ["ascribe_user_ty Contravariant", ...plain(1, "NonUse(AscribeUserTy(-))") /* `Variance`'s Debug */, "user_type_projection 7"],
    ],
    [{ $: "Coverage", _0: null as never }, ["coverage"]],
    [{ $: "Intrinsic", _0: { $: "Assume", _0: move(place(1)) } }, ["operand Move", ...plain(1, MOVE)]],
    [
      { $: "Intrinsic", _0: { $: "CopyNonOverlapping", _0: { src: copy(place(1)), dst: copy(place(2)), count: val(9, "usize") } } },
      ["operand Copy", ...plain(1, COPY), "operand Copy", ...plain(2, COPY), "operand Constant", "const_operand Val bb0[0]", "span 9", "ty usize Location(bb0[0])"],
    ],
    [{ $: "BackwardIncompatibleDropHint", place: place(1), reason: "FieldsMutated" as never }, plain(1, "NonUse(BackwardIncompatibleDropHint)")],
    [{ $: "ConstEvalCounter" }, []],
    [{ $: "Nop" }, []],
  ];
  for (const [kind, events] of cases) {
    expect(rec((v) => v.visit_statement(stmt(kind), L0))).toEqual([`statement ${kind.$} bb0[0]`, ...SI, ...events]);
  }
});

test("Visitor: every Rvalue kind (borrow / raw-pointer contexts, aggregate kinds)", () => {
  const cases: [Rvalue, string[]][] = [
    [{ $: "Use", _0: move(place(1)), _1: "No" }, ["operand Move", ...plain(1, MOVE)]],
    [{ $: "Repeat", _0: copy(place(1)), _1: named<ty_Const>("N") }, ["operand Copy", ...plain(1, COPY), "ty_const N"]],
    [{ $: "ThreadLocalRef", _0: null as never }, []],
    [{ $: "Ref", _0: named<Region>("'a"), _1: { $: "Shared" }, _2: place(1) }, ["region 'a", ...plain(1, "NonMutatingUse(SharedBorrow)")]],
    [{ $: "Ref", _0: named<Region>("'a"), _1: { $: "Fake", _0: "Deep" as never }, _2: place(1) }, ["region 'a", ...plain(1, "NonMutatingUse(FakeBorrow)")]],
    [{ $: "Ref", _0: named<Region>("'b"), _1: { $: "Mut", kind: "Default" as never }, _2: place(1) }, ["region 'b", ...plain(1, "MutatingUse(Borrow)")]],
    [{ $: "Reborrow", _0: ty("R"), _1: "Not", _2: place(1) }, ["ty R Location(bb0[0])", ...plain(1, "NonMutatingUse(SharedBorrow)")]],
    [{ $: "Reborrow", _0: ty("R"), _1: "Mut", _2: place(1) }, ["ty R Location(bb0[0])", ...plain(1, "MutatingUse(Borrow)")]],
    [{ $: "CopyForDeref", _0: place(1) }, plain(1, INSPECT)],
    [{ $: "RawPtr", _0: "Mut", _1: place(1) }, plain(1, "MutatingUse(RawBorrow)")],
    [{ $: "RawPtr", _0: "Const", _1: place(1) }, plain(1, "NonMutatingUse(RawBorrow)")],
    [{ $: "RawPtr", _0: "FakeForPtrMetadata", _1: place(1) }, plain(1, INSPECT)],
    [{ $: "Cast", _0: { $: "IntToInt" }, _1: copy(place(1)), _2: ty("u8") }, ["operand Copy", ...plain(1, COPY), "ty u8 Location(bb0[0])"]],
    [{ $: "BinaryOp", _0: "Add", _1: [copy(place(1)), move(place(2))] }, ["operand Copy", ...plain(1, COPY), "operand Move", ...plain(2, MOVE)]],
    [{ $: "UnaryOp", _0: "Not", _1: copy(place(1)) }, ["operand Copy", ...plain(1, COPY)]],
    [{ $: "Discriminant", _0: place(1) }, plain(1, INSPECT)],
    [{ $: "Aggregate", _0: { $: "Array", _0: ty("E") }, _1: [copy(place(1)), copy(place(2))] }, ["ty E Location(bb0[0])", "operand Copy", ...plain(1, COPY), "operand Copy", ...plain(2, COPY)]],
    [{ $: "Aggregate", _0: { $: "Tuple" }, _1: [move(place(1))] }, ["operand Move", ...plain(1, MOVE)]],
    [
      { $: "Aggregate", _0: { $: "Adt", _0: null as never, _1: 0 as never, _2: named("adt_args"), _3: undefined, _4: undefined }, _1: [] },
      ["args adt_args"],
    ],
    [{ $: "Aggregate", _0: { $: "Closure", _0: null as never, _1: named("closure_args") }, _1: [] }, ["args closure_args"]],
    [{ $: "Aggregate", _0: { $: "Coroutine", _0: null as never, _1: named("coroutine_args") }, _1: [] }, ["args coroutine_args"]],
    [{ $: "Aggregate", _0: { $: "CoroutineClosure", _0: null as never, _1: named("cc_args") }, _1: [] }, ["args cc_args"]],
    [{ $: "Aggregate", _0: { $: "RawPtr", _0: ty("*T"), _1: "Mut" }, _1: [copy(place(1)), copy(place(2))] }, ["ty *T Location(bb0[0])", "operand Copy", ...plain(1, COPY), "operand Copy", ...plain(2, COPY)]],
    [{ $: "WrapUnsafeBinder", _0: copy(place(1)), _1: ty("B") }, ["operand Copy", ...plain(1, COPY), "ty B Location(bb0[0])"]],
  ];
  for (const [rvalue, events] of cases) {
    expect(rec((v) => v.visit_rvalue(rvalue, L0))).toEqual([`rvalue ${rvalue.$}`, ...events]);
  }
});

test("Visitor: every Operand / mir::Const kind", () => {
  expect(rec((v) => v.visit_operand({ $: "Constant", _0: cst(5, { $: "Ty", _0: ty("i32"), _1: named<ty_Const>("C") }) }, L0))).toEqual([
    "operand Constant",
    "const_operand Ty bb0[0]",
    "span 5",
    "ty_const C",
  ]);
  expect(rec((v) => v.visit_operand({ $: "Constant", _0: cst(6, { $: "Unevaluated", _0: null as never, _1: ty("U") }) }, L0))).toEqual([
    "operand Constant",
    "const_operand Unevaluated bb0[0]",
    "span 6",
    "ty U Location(bb0[0])",
  ]);
  expect(rec((v) => v.visit_operand(val(7, "V"), L0))).toEqual(["operand Constant", "const_operand Val bb0[0]", "span 7", "ty V Location(bb0[0])"]);
  expect(rec((v) => v.visit_operand({ $: "RuntimeChecks", _0: "UbChecks" as never }, L0))).toEqual(["operand RuntimeChecks"]);
});

test("Visitor: every TerminatorKind and AssertKind", () => {
  const T = (kind: TerminatorKind) => rec((v) => v.visit_terminator(term(kind), loc(1, 3)));
  const head = (k: string) => [`terminator ${k} bb1[3]`, ...TI];
  for (const kind of [
    { $: "Goto", target: bb(0), loop_hint_attrs: [] },
    { $: "UnwindResume" },
    { $: "UnwindTerminate", _0: "Abi" },
    { $: "CoroutineDrop" },
    { $: "Unreachable" },
    { $: "FalseEdge", real_target: bb(0), imaginary_target: bb(1) },
    { $: "FalseUnwind", real_target: bb(0), unwind: UNWIND },
  ] as TerminatorKind[]) {
    expect(T(kind)).toEqual(head(kind.$));
  }
  expect(T({ $: "Return" })).toEqual([...head("Return"), `local _0 ${MOVE}`]);
  expect(T({ $: "SwitchInt", discr: copy(place(1)), targets: null as never })).toEqual([...head("SwitchInt"), "operand Copy", ...plain(1, COPY)]);
  expect(T({ $: "Drop", place: place(1), target: bb(0), unwind: UNWIND, replace: false, drop: undefined })).toEqual([
    ...head("Drop"),
    ...plain(1, "MutatingUse(Drop)"),
  ]);
  const args = [
    { node: copy(place(2)), span: sp(31) },
    { node: move(place(3)), span: sp(32) },
  ];
  expect(
    T({ $: "Call", func: val(8, "fn"), args, destination: place(1), target: bb(2), unwind: UNWIND, call_source: "Normal" as never, fn_span: sp(30) }),
  ).toEqual([
    ...head("Call"),
    "span 30",
    "operand Constant",
    "const_operand Val bb1[3]",
    "span 8",
    "ty fn Location(bb1[3])",
    "operand Copy",
    ...plain(2, COPY),
    "operand Move",
    ...plain(3, MOVE),
    ...plain(1, "MutatingUse(Call)"),
  ]);
  expect(T({ $: "TailCall", func: copy(place(4)), args, fn_span: sp(33) })).toEqual([
    ...head("TailCall"),
    "span 33",
    "operand Copy",
    ...plain(4, COPY),
    "operand Copy",
    ...plain(2, COPY),
    "operand Move",
    ...plain(3, MOVE),
  ]);
  expect(T({ $: "Yield", value: move(place(1)), resume: bb(0), resume_arg: place(2), drop: undefined })).toEqual([
    ...head("Yield"),
    "operand Move",
    ...plain(1, MOVE),
    ...plain(2, "MutatingUse(Yield)"),
  ]);
  const asm = (operands: unknown[]): TerminatorKind =>
    ({ $: "InlineAsm", asm_macro: "Asm", template: [], operands, options: null, line_spans: [], targets: [], unwind: UNWIND }) as never;
  expect(
    T(
      asm([
        { $: "In", reg: null, value: copy(place(1)) },
        { $: "Out", reg: null, late: false, place: place(2) },
        { $: "Out", reg: null, late: false, place: undefined },
        { $: "InOut", reg: null, late: false, in_value: copy(place(3)), out_place: place(4) },
        { $: "InOut", reg: null, late: false, in_value: copy(place(5)), out_place: undefined },
        { $: "Const", value: cst(40, { $: "Val", _0: null as never, _1: ty("K") }) },
        { $: "SymFn", value: cst(41, { $: "Val", _0: null as never, _1: ty("F") }) },
        { $: "SymStatic", def_id: null },
        { $: "Label", target_index: 0 },
      ]),
    ),
  ).toEqual([
    ...head("InlineAsm"),
    "operand Copy",
    ...plain(1, COPY),
    ...plain(2, "MutatingUse(AsmOutput)"),
    "operand Copy",
    ...plain(3, COPY),
    ...plain(4, "MutatingUse(AsmOutput)"),
    "operand Copy",
    ...plain(5, COPY),
    "const_operand Val bb1[3]",
    "span 40",
    "ty K Location(bb1[3])",
    "const_operand Val bb1[3]",
    "span 41",
    "ty F Location(bb1[3])",
  ]);
  // Assert: `cond`, then the message's operands
  const A = (msg: AssertMessage) =>
    T({ $: "Assert", cond: copy(place(9)), expected: true, msg, target: bb(0), unwind: UNWIND }).slice(head("Assert").length + 4);
  expect(T({ $: "Assert", cond: copy(place(9)), expected: true, msg: { $: "NullPointerDereference" }, target: bb(0), unwind: UNWIND })).toEqual([
    ...head("Assert"),
    "operand Copy",
    ...plain(9, COPY),
    "assert_message NullPointerDereference",
  ]);
  const two = (a: number, b: number) => ["operand Copy", ...plain(a, COPY), "operand Copy", ...plain(b, COPY)];
  const one = (a: number) => ["operand Copy", ...plain(a, COPY)];
  expect(A({ $: "BoundsCheck", len: copy(place(1)), index: copy(place(2)) })).toEqual(["assert_message BoundsCheck", ...two(1, 2)]);
  expect(A({ $: "Overflow", _0: "Add", _1: copy(place(1)), _2: copy(place(2)) })).toEqual(["assert_message Overflow", ...two(1, 2)]);
  for (const k of ["OverflowNeg", "DivisionByZero", "RemainderByZero", "InvalidEnumConstruction"] as const) {
    expect(A({ $: k, _0: copy(place(3)) })).toEqual([`assert_message ${k}`, ...one(3)]);
  }
  for (const k of ["ResumedAfterReturn", "ResumedAfterPanic", "ResumedAfterDrop"] as const) {
    expect(A({ $: k, _0: null as never } as AssertMessage)).toEqual([`assert_message ${k}`]);
  }
  expect(A({ $: "NullReferenceConstructed" })).toEqual(["assert_message NullReferenceConstructed"]);
  expect(A({ $: "MisalignedPointerDereference", required: copy(place(1)), found: copy(place(2)) })).toEqual([
    "assert_message MisalignedPointerDereference",
    ...two(1, 2),
  ]);
});

test("Visitor: place contexts (projection rewrite only for real uses; Index locals; every ProjectionElem)", () => {
  const elems: PlaceElem[] = [
    { $: "Deref" },
    { $: "Field", _0: 1 as never, _1: ty("F") },
    { $: "Index", _0: L(7) },
    { $: "ConstantIndex", offset: 0, min_length: 1, from_end: false },
    { $: "Subslice", from: 0, to: 1, from_end: true },
    { $: "Downcast", _0: undefined, _1: 0 as never },
    { $: "OpaqueCast", _0: ty("O") },
    { $: "UnwrapUnsafeBinder", _0: ty("W") },
    { $: "PhantomDeref" },
  ];
  const p = place(1, elems);
  const all = "_1.Deref.Field.Index.ConstantIndex.Subslice.Downcast.OpaqueCast.UnwrapUnsafeBinder.PhantomDeref";
  const elem_events = (ctx: string, index_ctx: string) => [
    `elem _1.Deref.Field.Index.ConstantIndex.Subslice.Downcast.OpaqueCast.UnwrapUnsafeBinder PhantomDeref ${ctx}`,
    `elem _1.Deref.Field.Index.ConstantIndex.Subslice.Downcast.OpaqueCast UnwrapUnsafeBinder ${ctx}`,
    "ty W Location(bb0[0])",
    `elem _1.Deref.Field.Index.ConstantIndex.Subslice.Downcast OpaqueCast ${ctx}`,
    "ty O Location(bb0[0])",
    `elem _1.Deref.Field.Index.ConstantIndex.Subslice Downcast ${ctx}`,
    `elem _1.Deref.Field.Index.ConstantIndex Subslice ${ctx}`,
    `elem _1.Deref.Field.Index ConstantIndex ${ctx}`,
    `elem _1.Deref.Field Index ${ctx}`,
    `local _7 ${index_ctx}`,
    `elem _1.Deref Field ${ctx}`,
    "ty F Location(bb0[0])",
    `elem _1 Deref ${ctx}`,
  ];
  // a mutating use: `MutatingUse(Projection)`; the `Index` local is still a `Copy` use
  expect(rec((v) => v.visit_place(p, { $: "MutatingUse", _0: "Store" }, L0))).toEqual([
    `place ${all} MutatingUse(Store)`,
    `local _1 ${M_PROJ}`,
    `projection ${all} ${M_PROJ}`,
    ...elem_events(M_PROJ, COPY),
  ]);
  // a non-mutating use: `NonMutatingUse(Projection)`
  expect(rec((v) => v.visit_place(p, { $: "NonMutatingUse", _0: "SharedBorrow" }, L0)).slice(1, 3)).toEqual([
    `local _1 ${NM_PROJ}`,
    `projection ${all} ${NM_PROJ}`,
  ]);
  // a "use" in debuginfo is not a real use: the context (also of the `Index` local) is unchanged
  expect(rec((v) => v.visit_place(p, { $: "NonUse", _0: { $: "VarDebugInfo" } }, L0))).toEqual([
    `place ${all} ${DBG}`,
    `local _1 ${DBG}`,
    `projection ${all} ${DBG}`,
    ...elem_events(DBG, DBG),
  ]);
});

/** A small body with every `Body` part the walk visits. */
function mk_body(): Body {
  const local_decl = (t: string, span: number, user_ty?: UserTypeProjection[]): LocalDecl =>
    new LocalDecl("Mut", null as never, ty(t), user_ty === undefined ? undefined : new UserTypeProjections(user_ty), si(span));
  const bb0 = new BasicBlockData(
    [
      stmt({ $: "StorageLive", _0: L(1) }),
      stmt({ $: "Assign", _0: [place(1), { $: "Use", _0: copy(place(2, [{ $: "Index", _0: L(3) }])), _1: "No" }] }, [
        { $: "InvalidAssign", _0: L(4) },
      ]),
    ],
    new StmtDebugInfos([{ $: "AssignRef", _0: L(2), _1: place(1) }]),
    term({ $: "Goto", target: bb(1), loop_hint_attrs: [] }),
    false,
  );
  const bb1 = new BasicBlockData([], no_dbg(), term({ $: "Return" }), false);
  const coroutine = Object.assign(Object.create(CoroutineInfo.prototype) as CoroutineInfo, { yield_ty: ty("Y"), resume_ty: ty("R") });
  const var_debug_info: VarDebugInfo[] = [
    {
      name: null as never,
      source_info: si(50),
      composite: { ty: ty("Comp"), projection: [{ $: "Field", _0: 0 as never, _1: ty("F0") }, { $: "Field", _0: 1 as never, _1: ty("F1") }] },
      value: { $: "Place", _0: place(1, [{ $: "Deref" }]) },
      argument_index: undefined,
    },
    { name: null as never, source_info: si(51), composite: undefined, value: { $: "Const", _0: cst(52, { $: "Val", _0: null as never, _1: ty("DC") }) }, argument_index: undefined },
  ];
  const scopes = [
    new SourceScopeData(sp(60), undefined, undefined, undefined, null as never),
    new SourceScopeData(sp(61), SourceScope.from_u32(0), undefined, undefined, null as never),
  ];
  const annotations: CanonicalUserTypeAnnotation[] = [{ user_ty: null as never, span: sp(70), inferred_ty: ty("Ann") }];
  return Object.assign(Object.create(Body.prototype) as Body, {
    basic_blocks: BasicBlocks.new([bb0, bb1]),
    source_scopes: scopes,
    coroutine,
    local_decls: [
      local_decl("Ret", 10),
      local_decl("A1", 11, [
        { base: 0 as UserTypeAnnotationIndex, projs: [] },
        { base: 1 as UserTypeAnnotationIndex, projs: [] },
      ]),
      local_decl("A2", 12),
      local_decl("A3", 13),
      local_decl("A4", 14),
    ],
    user_type_annotations: annotations,
    var_debug_info,
    span: sp(99),
    required_consts: [cst(80, { $: "Unevaluated", _0: null as never, _1: ty("RC") })],
  });
}

/** The `super_body` walk of `mk_body()` (visit.rs:1048 `super_body!`), parameterised by how places are walked. */
function body_events(pl: (l: number, ctx: string) => string[], index_place: string[], deref_place: string[]): string[] {
  return [
    // coroutine yield / resume types
    "ty Y YieldTy(span 99)",
    "ty R ResumeTy(span 99)",
    // var_debug_info
    "var_debug_info",
    "source_info",
    "span 50",
    "source_scope 0",
    "ty Comp Location(bb0[0])",
    "ty F0 Location(bb0[0])",
    "ty F1 Location(bb0[0])",
    ...deref_place,
    "var_debug_info",
    "source_info",
    "span 51",
    "source_scope 0",
    "const_operand Val bb0[0]",
    "span 52",
    "ty DC Location(bb0[0])",
    // basic blocks
    "block bb0",
    "statement StorageLive bb0[0]",
    ...SI,
    "local _1 NonUse(StorageLive)",
    "statement Assign bb0[1]",
    ...SI,
    "debuginfo InvalidAssign bb0[1]",
    `local _4 ${DBG}`,
    "assign",
    ...pl(1, "MutatingUse(Store)"),
    "rvalue Use",
    "operand Copy",
    ...index_place,
    // after the last statement: debuginfos, then the terminator, at statement_index = len
    "debuginfo AssignRef bb0[2]",
    `local _2 ${DBG}`,
    ...pl(1, DBG),
    "terminator Goto bb0[2]",
    ...TI,
    "block bb1",
    "terminator Return bb1[0]",
    ...TI,
    `local _0 ${MOVE}`,
    // source scopes
    "scope_data",
    "span 60",
    "scope_data",
    "span 61",
    "source_scope 0",
    // return type
    "ty Ret ReturnTy(span 99)",
    // local decls
    "local_decl _0",
    "source_info",
    "span 10",
    "source_scope 0",
    "ty Ret LocalDecl(_0, span 10)",
    "local_decl _1",
    "source_info",
    "span 11",
    "source_scope 0",
    "ty A1 LocalDecl(_1, span 11)",
    "user_type_projection 0",
    "user_type_projection 1",
    ...[2, 3, 4].flatMap((i) => [`local_decl _${i}`, "source_info", `span ${10 + i}`, "source_scope 0", `ty A${i} LocalDecl(_${i}, span ${10 + i})`]),
    // user type annotations
    "user_type_annotation 0",
    "span 70",
    "ty Ann UserTy(70)",
    // the body span
    "span 99",
    // required consts
    "const_operand Unevaluated bb0[0]",
    "span 80",
    "ty RC Location(bb0[0])",
  ];
}

test("Visitor: super_body walk order (coroutine, var_debug_info, blocks, scopes, return ty, locals, annotations, span, required consts)", () => {
  const body = mk_body();
  const cache = body.basic_blocks.cache;
  expect(rec((v) => v.visit_body(body))).toEqual([
    "body",
    ...body_events(plain, [
      `place _2.Index ${COPY}`,
      `local _2 ${NM_PROJ}`,
      `projection _2.Index ${NM_PROJ}`,
      `elem _2 Index ${NM_PROJ}`,
      `local _3 ${COPY}`,
    ],
    // var_debug_info's `_1.Deref`: a NonUse context, unchanged
    [`place _1.Deref ${DBG}`, `local _1 ${DBG}`, `projection _1.Deref ${DBG}`, `elem _1 Deref ${DBG}`]),
  ]);
  // `Visitor` reads the blocks through `Deref`: the CFG cache is kept
  expect(body.basic_blocks.cache).toBe(cache);
});

test("Visitor: super_source_scope_data (parent, inlined callee by InstanceKind, inlined parent)", () => {
  const inlined = (def: unknown): SourceScopeData =>
    new SourceScopeData(sp(1), SourceScope.from_u32(2), [{ def: def as never, args: named("cargs") }, sp(3)], SourceScope.from_u32(4), null as never);
  const head = ["scope_data", "span 1", "source_scope 2", "span 3"];
  const tail = ["args cargs", "source_scope 4"];
  const none = [
    { $: "Item", _0: null },
    { $: "Intrinsic", _0: null },
    { $: "LlvmIntrinsic", _0: null },
    { $: "Virtual", _0: null, _1: 0 },
    { $: "Shim", _0: { $: "VTable", _0: null } },
    { $: "Shim", _0: { $: "Reify", _0: null, _1: undefined } },
    { $: "Shim", _0: { $: "ThreadLocal", _0: null } },
    { $: "Shim", _0: { $: "ClosureOnce", call_once: null, closure: null, track_caller: false } },
    { $: "Shim", _0: { $: "ConstructCoroutineInClosure", coroutine_closure_def_id: null, receiver_by_ref: false } },
    { $: "Shim", _0: { $: "DropGlue", _0: null, _1: undefined } },
  ];
  for (const def of none) expect(rec((v) => v.visit_source_scope_data(inlined(def)))).toEqual([...head, ...tail]);
  for (const k of ["FnPtr", "DropGlue", "Clone", "FnPtrAsPtr", "FnPtrFromPtr", "AsyncDropGlue", "AsyncDropGlueCtor"]) {
    expect(rec((v) => v.visit_source_scope_data(inlined({ $: "Shim", _0: { $: k, _0: null, _1: ty("ST") } })))).toEqual([
      ...head,
      "ty ST Location(bb0[0])",
      ...tail,
    ]);
  }
  expect(rec((v) => v.visit_source_scope_data(inlined({ $: "Shim", _0: { $: "FutureDropPoll", _0: null, _1: ty("Proxy"), _2: ty("Impl") } })))).toEqual([
    ...head,
    "ty Proxy Location(bb0[0])",
    "ty Impl Location(bb0[0])",
    ...tail,
  ]);
  expect(rec((v) => v.visit_source_scope_data(new SourceScopeData(sp(1), undefined, undefined, undefined, null as never)))).toEqual(["scope_data", "span 1"]);
});

test("Visitor: visit_location picks the statement or the terminator", () => {
  const body = mk_body();
  expect(rec((v) => v.visit_location(body, loc(0, 0)))[0]).toBe("statement StorageLive bb0[0]");
  expect(rec((v) => v.visit_location(body, loc(0, 2)))[0]).toBe("terminator Goto bb0[2]");
  body.basic_blocks.basic_blocks[1]!.terminator = undefined;
  expect(rec((v) => v.visit_location(body, loc(1, 0)))).toEqual([]);
});

test("PlaceContext methods", () => {
  const nm = (c: string): PlaceContext => ({ $: "NonMutatingUse", _0: c as never });
  const m = (c: string): PlaceContext => ({ $: "MutatingUse", _0: c as never });
  const nu = (c: string): PlaceContext => ({ $: "NonUse", _0: c === "AscribeUserTy" ? { $: c, _0: "Contravariant" } : ({ $: c } as never) });
  const all: PlaceContext[] = [
    ...["Inspect", "Copy", "Move", "SharedBorrow", "FakeBorrow", "RawBorrow", "PlaceMention", "Projection"].map(nm),
    ...["Store", "SetDiscriminant", "AsmOutput", "Call", "Yield", "Drop", "Borrow", "RawBorrow", "Projection"].map(m),
    ...["StorageLive", "StorageDead", "AscribeUserTy", "VarDebugInfo", "BackwardIncompatibleDropHint"].map(nu),
  ];
  const which = (f: (c: PlaceContext) => boolean) => all.filter(f).map(C);
  expect(which(PlaceContext.is_drop)).toEqual(["MutatingUse(Drop)"]);
  expect(which(PlaceContext.is_borrow)).toEqual(["NonMutatingUse(SharedBorrow)", "MutatingUse(Borrow)"]);
  expect(which(PlaceContext.is_address_of)).toEqual(["NonMutatingUse(RawBorrow)", "MutatingUse(RawBorrow)"]);
  expect(which(PlaceContext.may_observe_address)).toEqual([
    "NonMutatingUse(SharedBorrow)",
    "NonMutatingUse(FakeBorrow)",
    "NonMutatingUse(RawBorrow)",
    "MutatingUse(AsmOutput)",
    "MutatingUse(Drop)",
    "MutatingUse(Borrow)",
    "MutatingUse(RawBorrow)",
  ]);
  expect(which(PlaceContext.is_storage_marker)).toEqual(["NonUse(StorageLive)", "NonUse(StorageDead)"]);
  expect(which(PlaceContext.is_mutating_use).length).toBe(9);
  expect(which(PlaceContext.is_use).length).toBe(17);
  expect(which(PlaceContext.is_place_assignment)).toEqual(["MutatingUse(Store)", "MutatingUse(AsmOutput)", "MutatingUse(Call)"]);
  expect(all.map(PlaceContext.ambient_variance).join(" ")).toBe(
    [...Array(8).fill("Covariant"), ...Array(9).fill("Invariant"), "Invariant", "Invariant", "Contravariant", "Invariant", "Invariant"].join(" "),
  );
});

test("VisitPlacesWith: places (then their projections' Index locals) and locals", () => {
  const seen: string[] = [];
  const v = new VisitPlacesWith((p, ctxt) => seen.push(`${P(p.local, p.projection)} ${C(ctxt)}`));
  const p = place(1, [{ $: "Index", _0: L(2) }, { $: "Deref" }]);
  // `visit_place` hands over a copy of the place, then walks the projection with the context as given (the
  // `Index` local reaches `visit_local` as a `Copy` use)
  v.visit_place(p, { $: "MutatingUse", _0: "Store" }, L0);
  expect(seen.slice(0, 1)).toEqual(["_1.Index.Deref MutatingUse(Store)"]);
  v.visit_local(L(5), { $: "NonUse", _0: { $: "StorageDead" } }, L0);
  expect(seen).toEqual(["_1.Index.Deref MutatingUse(Store)", `_2 ${COPY}`, "_5 NonUse(StorageDead)"]);
});

// ---- MutVisitor ----

test("MutVisitor: the same walk, places through visit_local + process_projection", () => {
  const body = mk_body();
  const cache = body.basic_blocks.cache;
  const ev = mrec((v) => v.visit_body(body));
  // `MutVisitor::super_place` keeps the context for the base local and visits `Index` locals as `Copy`, without
  // `visit_projection` / `visit_projection_elem`
  expect(ev).toEqual(body_events(mplain, [`place _2.Index ${COPY}`, `local _2 ${COPY}`, `local _3 ${COPY}`], [`place _1.Deref ${DBG}`, `local _1 ${DBG}`]));
  // `super_body` takes the blocks with `as_mut()`: the CFG cache is invalidated; `super_body_preserves_cfg` keeps it
  expect(body.basic_blocks.cache).not.toBe(cache);
  const cache2 = body.basic_blocks.cache;
  expect(mrec((v) => v.visit_body_preserves_cfg(body))).toEqual(ev);
  expect(body.basic_blocks.cache).toBe(cache2);
  // statements, rvalues and terminators walk as in `Visitor`, modulo places
  const strip = (es: string[]) => es.filter((e) => !e.startsWith("projection ") && !e.startsWith("elem "));
  const kinds: StatementKind[] = [
    { $: "AscribeUserType", _0: [place(1), { base: 7 as UserTypeAnnotationIndex, projs: [] }], _1: "Invariant" },
    { $: "StorageDead", _0: L(3) },
    { $: "Assign", _0: [place(1), { $: "Repeat", _0: copy(place(2)), _1: named<ty_Const>("N") }] },
    { $: "Assign", _0: [place(1), { $: "Ref", _0: named<Region>("'r"), _1: { $: "Shared" }, _2: place(2) }] },
    { $: "Assign", _0: [place(1), { $: "Aggregate", _0: { $: "Closure", _0: null as never, _1: named("ca") }, _1: [copy(place(2))] }] },
    { $: "Assign", _0: [place(1), { $: "Cast", _0: { $: "IntToInt" }, _1: val(4, "V"), _2: ty("T") }] },
  ];
  for (const kind of kinds) {
    expect(mrec((v) => v.visit_statement(stmt(kind), L0))).toEqual(strip(rec((v) => v.visit_statement(stmt(kind), L0))));
  }
});

/** Renames `_1` to `_9`; replaces types / spans / regions / consts / args by name. */
class Rewrite extends MutVisitor {
  tcx(): TyCtxt {
    return { mk_place_elems: (v: readonly PlaceElem[]) => list(v) } as unknown as TyCtxt;
  }
  override visit_local(local: MutRef<Local>, _ctx: PlaceContext, _location: Location): void {
    if (local.value === L(1)) local.value = L(9);
  }
  override visit_ty(t: MutRef<Ty>, _ctx: TyContext): void {
    t.value = ty(`${N(t.value)}'`);
  }
  override visit_span(span: MutRef<Span>): void {
    span.value = sp(span.value + 1000);
  }
  override visit_source_scope(scope: MutRef<SourceScope>): void {
    scope.value = SourceScope.from_u32(scope.value + 1);
  }
  override visit_region(r: MutRef<Region>, _location: Location): void {
    r.value = named<Region>(`${N(r.value)}'`);
  }
  override visit_ty_const(ct: MutRef<ty_Const>, _location: Location): void {
    ct.value = named<ty_Const>(`${N(ct.value)}'`);
  }
  override visit_args(a: MutRef<GenericArgsRef>, _location: Location): void {
    a.value = named<GenericArgsRef>(`${N(a.value)}'`);
  }
  override visit_ascribe_user_ty(p: Place, variance: MutRef<Variance>, u: UserTypeProjection, location: Location): void {
    variance.value = "Covariant";
    super.visit_ascribe_user_ty(p, variance, u, location);
  }
}

test("MutVisitor: write-backs land (locals, projections, types, spans, scopes, regions, consts, args, variance)", () => {
  const body = mk_body();
  const bb0 = body.basic_blocks.basic_blocks[0]!;
  const assign = bb0.statements[1]!.kind as Extract<StatementKind, { $: "Assign" }>;
  const unchanged_projection = (assign._0[1] as Extract<Rvalue, { $: "Use" }>)._0;
  const before = (unchanged_projection as Extract<Operand, { $: "Copy" }>)._0.projection;
  new Rewrite().visit_body(body);
  // locals: StorageLive, the assigned place, the after-last debuginfo's place
  expect((bb0.statements[0]!.kind as Extract<StatementKind, { $: "StorageLive" }>)._0).toBe(L(9));
  expect(assign._0[0].local).toBe(L(9));
  const dbg = bb0.after_last_stmt_debuginfos._0![0] as Extract<StmtDebugInfo, { $: "AssignRef" }>;
  expect([dbg._0, dbg._1.local]).toEqual([L(2), L(9)]);
  // `_2[_3]`: nothing changed, so the projection is not re-interned
  expect((unchanged_projection as Extract<Operand, { $: "Copy" }>)._0.projection).toBe(before);
  // spans / scopes of source infos, the body span, const spans, annotation span and inferred type
  expect([bb0.statements[0]!.source_info.span, bb0.statements[0]!.source_info.scope]).toEqual([sp(1001), SourceScope.from_u32(1)]);
  expect(bb0.terminator!.source_info.span).toBe(sp(1002));
  expect(body.span).toBe(sp(1099));
  expect(body.required_consts![0]!.span).toBe(sp(1080));
  expect(N((body.required_consts![0]!.const_ as { _1: Ty })._1)).toBe("RC'");
  expect([body.user_type_annotations[0]!.span, N(body.user_type_annotations[0]!.inferred_ty)]).toEqual([sp(1070), "Ann'"]);
  // source scopes: span, parent
  expect([body.source_scopes[1]!.span, body.source_scopes[1]!.parent_scope]).toEqual([sp(1061), SourceScope.from_u32(1)]);
  // types: coroutine yield / resume, local decls, var debug info composite + its field projection
  expect([N(body.coroutine!.yield_ty), N(body.coroutine!.resume_ty)]).toEqual(["Y'", "R'"]);
  expect(body.local_decls.map((d) => N(d.ty))).toEqual(["Ret'", "A1'", "A2'", "A3'", "A4'"]);
  const comp = body.var_debug_info[0]!.composite!;
  expect([N(comp.ty), ...comp.projection.map((e) => N((e as { _1: Ty })._1))]).toEqual(["Comp'", "F0'", "F1'"]);
  expect((body.var_debug_info[0]!.value as { _0: Place })._0.local).toBe(L(9));
  // the `Return` terminator's `_0` is a temporary: renaming `_1` leaves it alone

  // rvalues / places with projections
  const s = (kind: StatementKind) => {
    const st = stmt(kind);
    new Rewrite().visit_statement(st, L0);
    return st.kind;
  };
  const idx = s({ $: "Assign", _0: [place(2, [{ $: "Index", _0: L(1) }, { $: "Field", _0: 0 as never, _1: ty("F") }, { $: "OpaqueCast", _0: ty("O") }, { $: "UnwrapUnsafeBinder", _0: ty("W") }, { $: "Deref" }]), { $: "Use", _0: copy(place(1)), _1: "No" }] }) as Extract<
    StatementKind,
    { $: "Assign" }
  >;
  const proj = idx._0[0].projection;
  expect(proj.map((e) => (e.$ === "Index" ? `Index(_${e._0})` : e.$ === "Deref" ? "Deref" : `${e.$}(${N(e.$ === "Field" ? e._1 : (e as { _0: unknown })._0)})`))).toEqual([
    "Index(_9)",
    "Field(F')",
    "OpaqueCast(O')",
    "UnwrapUnsafeBinder(W')",
    "Deref",
  ]);
  expect(((idx._0[1] as Extract<Rvalue, { $: "Use" }>)._0 as { _0: Place })._0.local).toBe(L(9));
  const rep = s({ $: "Assign", _0: [place(3), { $: "Repeat", _0: copy(place(3)), _1: named<ty_Const>("N") }] }) as Extract<StatementKind, { $: "Assign" }>;
  expect(N((rep._0[1] as Extract<Rvalue, { $: "Repeat" }>)._1)).toBe("N'");
  const rf = s({ $: "Assign", _0: [place(3), { $: "Ref", _0: named<Region>("'r"), _1: { $: "Shared" }, _2: place(1) }] }) as Extract<StatementKind, { $: "Assign" }>;
  const ref = rf._0[1] as Extract<Rvalue, { $: "Ref" }>;
  expect([N(ref._0), ref._2.local]).toEqual(["'r'", L(9)]);
  const agg = s({ $: "Assign", _0: [place(3), { $: "Aggregate", _0: { $: "Adt", _0: null as never, _1: 0 as never, _2: named("aa"), _3: undefined, _4: undefined }, _1: [] }] }) as Extract<
    StatementKind,
    { $: "Assign" }
  >;
  expect(N(((agg._0[1] as Extract<Rvalue, { $: "Aggregate" }>)._0 as { _2: unknown })._2)).toBe("aa'");
  const cast = s({ $: "Assign", _0: [place(3), { $: "Cast", _0: { $: "IntToInt" }, _1: { $: "Constant", _0: cst(5, { $: "Ty", _0: ty("i8"), _1: named<ty_Const>("K") }) }, _2: ty("T") }] }) as Extract<
    StatementKind,
    { $: "Assign" }
  >;
  const c = cast._0[1] as Extract<Rvalue, { $: "Cast" }>;
  const cop = (c._1 as { _0: ConstOperand })._0;
  expect([N(c._2), cop.span, N((cop.const_ as { _1: unknown })._1)]).toEqual(["T'", sp(1005), "K'"]);
  // `Const::Ty`'s own `Ty` is not visited (upstream visits only the `ty::Const`)
  expect(N((cop.const_ as { _0: Ty })._0)).toBe("i8");
  const asc = s({ $: "AscribeUserType", _0: [place(1), { base: 0 as UserTypeAnnotationIndex, projs: [] }], _1: "Invariant" }) as Extract<StatementKind, { $: "AscribeUserType" }>;
  expect([asc._0[0].local, asc._1]).toEqual([L(9), "Covariant"]);
  // call: fn_span written back
  const call = term({ $: "Call", func: copy(place(1)), args: [], destination: place(1), target: undefined, unwind: UNWIND, call_source: "Normal" as never, fn_span: sp(7) });
  new Rewrite().visit_terminator(call, L0);
  expect((call.kind as Extract<TerminatorKind, { $: "Call" }>).fn_span).toBe(sp(1007));
  // inlined callee: callsite span, shim type, callee args
  const scope = new SourceScopeData(sp(1), undefined, [{ def: { $: "Shim", _0: { $: "Clone", _0: null as never, _1: ty("CT") } }, args: named("ia") }, sp(2)], SourceScope.from_u32(0), null as never);
  new Rewrite().visit_source_scope_data(scope);
  const [callee, callsite_span] = scope.inlined!;
  expect([scope.span, callsite_span, N((callee.def as { _0: { _1: Ty } })._0._1), N(callee.args), scope.inlined_parent_scope]).toEqual([
    sp(1001),
    sp(1002),
    "CT'",
    "ia'",
    SourceScope.from_u32(1),
  ]);
});

test("MutVisitor: renaming the return place of `return` panics", () => {
  class RenameRet extends MutRec {
    override visit_local(local: MutRef<Local>): void {
      local.value = L(5);
    }
  }
  let err: unknown;
  try {
    new RenameRet().visit_terminator(term({ $: "Return" }), L0);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Panic);
  expect((err as Panic).message).toBe(
    "assertion `left == right` failed: `MutVisitor` tried to mutate return place of `return` terminator\n  left: _5\n right: _0",
  );
});

test("MutVisitor: process_projection returns undefined when nothing changes, else a fresh copy", () => {
  const v = new MutRec();
  const elems: PlaceElem[] = [{ $: "Deref" }, { $: "Index", _0: L(2) }, { $: "Field", _0: 0 as never, _1: ty("F") }];
  expect(v.process_projection(elems, L0)).toBeUndefined();
  expect(v.ev).toEqual([`local _2 ${COPY}`, "ty F Location(bb0[0])"]);
  const r = new Rewrite().process_projection(elems, L0)!;
  expect(r).not.toBe(elems);
  expect(r[0]).toBe(elems[0]!);
  expect(r.map((e) => e.$)).toEqual(["Deref", "Index", "Field"]);
  expect((r[1] as { _0: Local })._0).toBe(L(2));
  expect(N((r[2] as { _1: Ty })._1)).toBe("F'");
  expect(elems[2]).toEqual({ $: "Field", _0: 0 as never, _1: ty("F") });
});
