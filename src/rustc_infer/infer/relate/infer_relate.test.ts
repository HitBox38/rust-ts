// Unit tests of lane infer-relate on a real `InferCtxt` (`tcx.infer_ctxt().build(..)`): context.rs (`impl InferCtxtLike
// for InferCtxt`, `lower_universe`), relate/generalize.rs (instantiation, occurs check, universes), relate/
// higher_ranked.rs (`enter_forall*`, `instantiate_binder_with_infer`), relate/type_relating.rs (`eq` / `sub` through
// `TypeRelating`) and relate/lattice.rs.
//
// Expectations are upstream semantics read off the pinned sources (vids, universes, `TypeError` variants, obligations).
//
// PORT(test): the `InferCtxt` methods of other wave-16 lanes these paths call (infer-core: mod.rs's resolvers and
// variable constructors, `TypeTrace::span`, `instantiate_binder_with_fresh_vars`; infer-opaque-snapshot:
// `Obligation::new`) are still `unported` placeholders here. While a method is a placeholder, the test installs its
// upstream body (a transcription of the pinned source, cited per shim) and restores it afterwards; once the owning lane
// lands, the real port is used and the shims are skipped.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../../lib.ts";
import { unported_stub_path } from "../../../rust_ts/stubs.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { ParamEnv, Term, Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Binder, BoundTyKind, PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import type { BoundVar, DebruijnIndex, TyVid, UniverseIndex as UniverseIndexT } from "../../../rustc_type_ir/decls.ts";
import { ExpectedFound } from "../../../rustc_type_ir/error.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex, Variance } from "../../../rustc_type_ir/lib.ts";
import { relate_Binder, relate_Ty } from "../../../rustc_type_ir/relate.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Panic } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import { InferCtxt } from "../../decls.ts";
import { Obligation } from "../../traits/mod.ts";
import { DefineOpaqueTypes } from "../at.ts";
import { TypeTrace } from "../mod.ts";
import { TypeVariableValue } from "../type_variable.ts";
import { ConstVidKey_from } from "../unify_key.ts";
import { TermVid, TermVid_eq } from "./generalize.ts";
import { LatticeOp, LatticeOpKind } from "./lattice.ts";
import { TypeRelating } from "./type_relating.ts";

const D = (n: number) => n as DebruijnIndex;
const V = (n: number) => n as BoundVar;
const U = (n: number) => n as UniverseIndexT;

function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // PORT(test): `next_trait_solver_globally` reads the session; the test has none (contract.test.ts precedent).
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => false;
  return tcx;
}

const tcx = mk_tcx();
const tup = (...ts: Ty[]): Ty => tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(ts) });
const bound_ty = (debruijn: number, var_: number): Ty => tcx.mk_ty_from_kind({ $: "Bound", _0: { $: "Bound", _0: D(debruijn) }, _1: { var: V(var_), kind: BoundTyKind.Anon } });
const var_ = (vid: number): Ty => Ty.new_var(tcx, vid as TyVid);

/** An old-solver `InferCtxt` (`TypeRelating::new` asserts `!next_trait_solver`). */
function mk_infcx(): InferCtxt {
  return tcx.infer_ctxt().with_next_trait_solver(false).build(TypingMode.non_body_analysis());
}

function mk_trace(a: Ty, b: Ty): TypeTrace {
  return new TypeTrace(ObligationCause.dummy(), { $: "Terms", _0: ExpectedFound.new(Term.from_Ty(a), Term.from_Ty(b)) });
}

function relating(infcx: InferCtxt, variance: Variance, a: Ty, b: Ty): TypeRelating {
  return TypeRelating.new(infcx, mk_trace(a, b), ParamEnv.empty(), DefineOpaqueTypes.Yes, variance);
}

// ---- PORT(test) shims of other lanes' placeholders (upstream bodies) ---------------------------------------------

const restores: (() => void)[] = [];
function shim<O extends object>(obj: O, name: string, impl: (...args: never[]) => unknown): void {
  const cur = (obj as Record<string, unknown>)[name];
  if (unported_stub_path(cur) === undefined) return; // ported by its lane: use the real one
  const spy = spyOn(obj as Record<string, (...args: never[]) => unknown>, name).mockImplementation(impl);
  restores.push(() => spy.mockRestore());
}

beforeAll(() => {
  const P = InferCtxt.prototype;
  // mod.rs:734
  shim(P, "next_trait_solver", function (this: InferCtxt) {
    return this.next_trait_solver_;
  });
  // mod.rs:759
  shim(P, "typing_mode_raw", function (this: InferCtxt) {
    return this.typing_mode;
  });
  // mod.rs:904 / :908 / :912 / :917 / :921 / :926
  shim(P, "next_ty_var", function (this: InferCtxt, span: never) {
    return Ty.new_var(this.tcx, this.inner.type_variables().new_var(this.universe(), { span, param_def_id: undefined }));
  });
  shim(P, "next_ty_var_in_universe", function (this: InferCtxt, span: never, universe: never) {
    return Ty.new_var(this.tcx, this.inner.type_variables().new_var(universe, { span, param_def_id: undefined }));
  });
  // mod.rs:931 / :945
  shim(P, "next_const_var", function (this: InferCtxt, span: never) {
    return Const.new_var(this.tcx, this.inner.const_unification_table().new_key({ $: "Unknown", origin: { span, param_def_id: undefined }, universe: this.universe() }).vid);
  });
  // mod.rs:1236
  shim(P, "try_resolve_ty_var", function (this: InferCtxt, vid: never) {
    const v = this.inner.type_variables().probe(vid);
    return v.$ === "Known" ? Ok(v.value) : Err(v.universe);
  });
  // mod.rs:1274 (the `TyVar` arm; the int/float arms are not reached by these tests)
  shim(P, "shallow_resolve", function (this: InferCtxt, ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar") {
      const v = k._0._0;
      const [root_vid, value] = this.inner.type_variables().probe_with_root_vid(v);
      const t = TypeVariableValue.known(value);
      return t === undefined ? (root_vid === v ? ty : Ty.new_var(this.tcx, root_vid)) : this.shallow_resolve(t);
    }
    if (k.$ === "Infer") throw new Error("PORT(test): shallow_resolve shim covers TyVar only");
    return ty;
  });
  // mod.rs:1341 (only non-infer consts reach it here)
  shim(P, "shallow_resolve_const", function (this: InferCtxt, ct: Const): Const {
    if (ct.kind().$ === "Infer") throw new Error("PORT(test): shallow_resolve_const shim covers non-infer consts only");
    return ct;
  });
  // mod.rs:1376
  shim(P, "root_var", function (this: InferCtxt, var__: never) {
    return this.inner.type_variables().root_var(var__);
  });
  // mod.rs:1399
  shim(P, "root_const_var", function (this: InferCtxt, var__: never) {
    return this.inner.const_unification_table().find(ConstVidKey_from(var__)).vid;
  });
  // mod.rs:1493
  shim(P, "try_resolve_const_var", function (this: InferCtxt, vid: never) {
    const v = this.inner.const_unification_table().probe_value(ConstVidKey_from(vid));
    return v.$ === "Known" ? Ok(v.value) : Err(v.universe);
  });
  // mod.rs:1539 (type-only binders here: `next_region_var` would need the region constraints of lane infer-regions)
  shim(P, "instantiate_binder_with_fresh_vars", function <T>(this: InferCtxt, span: never, _lbrct: unknown, value: Binder<T>, d_T: never): T {
    if (Binder.no_bound_vars(Binder.as_ref(value), d_T) !== undefined) return Binder.skip_binder(value);
    const args: GenericArg[] = [];
    for (const k of Binder.bound_vars(value)) {
      if (k.$ !== "Ty") throw new Error("PORT(test): instantiate_binder_with_fresh_vars shim covers bound types only");
      args.push(this.next_ty_var(span));
    }
    return this.tcx.replace_bound_vars_uncached(
      value,
      {
        replace_region: () => {
          throw new Error("unreachable");
        },
        replace_ty: (bt) => GenericArg.expect_ty(args[bt.var]!),
        replace_const: () => {
          throw new Error("unreachable");
        },
      },
      d_T,
    );
  });
  // mod.rs:1662 / :1668
  shim(P, "universe", function (this: InferCtxt) {
    return this.universe_;
  });
  shim(P, "create_next_universe", function (this: InferCtxt) {
    const u = UniverseIndex.next_universe(this.universe_);
    this.universe_ = u;
    return u;
  });
  // mod.rs:1810
  shim(TypeTrace.prototype, "span", function (this: TypeTrace) {
    return this.cause.span;
  });
  // traits/mod.rs:130 + :147 (`Obligation::new` = `with_depth(.., 0, ..)`)
  shim(Obligation, "new", function (tcx_: never, cause: never, param_env: never, predicate: unknown, upcast: (p: unknown, tcx: unknown) => unknown) {
    return new Obligation(cause, param_env, upcast(predicate, tcx_), 0);
  });
});

afterAll(() => {
  for (const r of restores) r();
});

// ---- tests --------------------------------------------------------------------------------------------------------

describe("relate/type_relating.rs: eq / sub on a real InferCtxt", () => {
  test("eq instantiates a type variable (`?0 == u32`), both directions", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const rel = relating(infcx, Variance.Invariant, v0, u32);
    expect(rel.relate(v0, u32, relate_Ty)).toEqual(Ok(v0));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(u32);
    // `u32 == ?1`: the target is on the right (`instantiate_ty_var(.., false, ..)`).
    expect(rel.relate(u32, v1, relate_Ty)).toEqual(Ok(u32));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(1 as TyVid))).toBe(u32);
    expect(rel.into_obligations()).toEqual([]);
    // Once resolved, `shallow_resolve` makes it a plain equality.
    expect(rel.relate(v0, v1, relate_Ty)).toEqual(Ok(u32));
  });

  test("eq of two type variables unifies them (no obligation)", () => {
    const infcx = mk_infcx();
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const rel = relating(infcx, Variance.Invariant, v0, v1);
    expect(rel.relate(v0, v1, relate_Ty)).toEqual(Ok(v0));
    expect(infcx.root_var(1 as TyVid)).toBe(0 as TyVid);
    expect(rel.into_obligations()).toEqual([]);
  });

  test("sub of two type variables registers a `Subtype` obligation (covariant: a <: b; contravariant: flipped)", () => {
    const infcx = mk_infcx();
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const sub = relating(infcx, Variance.Covariant, v0, v1);
    expect(sub.relate(v0, v1, relate_Ty)).toEqual(Ok(v0));
    const sup = relating(infcx, Variance.Contravariant, v0, v1);
    expect(sup.relate(v0, v1, relate_Ty)).toEqual(Ok(v0));
    const [o1] = sub.into_obligations();
    const [o2] = sup.into_obligations();
    expect(o1!.param_env).toEqual(ParamEnv.empty());
    expect(o1!.recursion_depth).toBe(0);
    expect(Binder.skip_binder(o1!.predicate.kind())).toEqual({ $: "Subtype", _0: { a_is_expected: true, a: v0, b: v1 } });
    expect(Binder.skip_binder(o2!.predicate.kind())).toEqual({ $: "Subtype", _0: { a_is_expected: false, a: v1, b: v0 } });
    // Neither variable is instantiated or unified.
    expect(infcx.root_var(1 as TyVid)).toBe(1 as TyVid);
    expect(infcx.inner.type_variables().probe(0 as TyVid).$).toBe("Unknown");
  });

  test("sub against a structured type generalizes: `?0 <: (u32, ?1)` gives `?0 := (u32, ?2)` and `?2 <: ?1`", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const target = tup(u32, v1);
    const rel = relating(infcx, Variance.Covariant, v0, target);
    expect(rel.relate(v0, target, relate_Ty)).toEqual(Ok(v0));
    // The generalizer replaces `?1` (not invariant) by a fresh variable in `?0`'s universe, sub-unified with it.
    const v2 = var_(2);
    expect(infcx.inner.type_variables().num_vars()).toBe(3);
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(tup(u32, v2));
    const tv = infcx.inner.type_variables();
    expect(tv.sub_unification_table_root_var(2 as TyVid)).toBe(tv.sub_unification_table_root_var(1 as TyVid));
    expect(infcx.root_var(2 as TyVid)).toBe(2 as TyVid);
    // Relating the generalized `(u32, ?2) <: (u32, ?1)` leaves `?2 <: ?1` as an obligation.
    const obligations = rel.into_obligations();
    expect(obligations.length).toBe(1);
    expect(Binder.skip_binder(obligations[0]!.predicate.kind())).toEqual({ $: "Subtype", _0: { a_is_expected: true, a: v2, b: v1 } });
  });

  test("eq against a structured type reuses nameable variables: `?0 == (u32, ?1)` gives `?0 := (u32, ?1)`", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const rel = relating(infcx, Variance.Invariant, v0, tup(u32, v1));
    expect(rel.relate(v0, tup(u32, v1), relate_Ty)).toEqual(Ok(v0));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(tup(u32, v1));
    expect(infcx.inner.type_variables().num_vars()).toBe(2);
    expect(rel.into_obligations()).toEqual([]);
  });

  test("mismatched rigid types are `Sorts` errors (expected/found from the relation's operands)", () => {
    const infcx = mk_infcx();
    const { u32, i32 } = tcx.types;
    const rel = relating(infcx, Variance.Invariant, u32, i32);
    expect(rel.relate(u32, i32, relate_Ty)).toEqual(Err({ $: "Sorts", _0: ExpectedFound.new(u32, i32) }));
  });
});

describe("relate/generalize.rs: occurs check and universes", () => {
  test("`?0 == (u32, ?0)` fails the occurs check with `CyclicTy` of the source type; `?0` stays unknown", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const source = tup(u32, v0);
    for (const variance of [Variance.Invariant, Variance.Covariant, Variance.Contravariant]) {
      const rel = relating(infcx, variance, v0, source);
      expect(rel.relate(v0, source, relate_Ty)).toEqual(Err({ $: "CyclicTy", _0: source }));
      // Flipped (`(u32, ?0) rel ?0`): still the source term.
      expect(rel.relate(source, v0, relate_Ty)).toEqual(Err({ $: "CyclicTy", _0: source }));
    }
    expect(infcx.inner.type_variables().probe(0 as TyVid).$).toBe("Unknown");
  });

  test("the occurs check goes through unified variables: `?1 == ?0` then `?0 == (?1,)` is cyclic", () => {
    const infcx = mk_infcx();
    const v0 = infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const rel = relating(infcx, Variance.Invariant, v0, v1);
    expect(rel.relate(v1, v0, relate_Ty).$).toBe("Ok");
    expect(rel.relate(v0, tup(v1), relate_Ty)).toEqual(Err({ $: "CyclicTy", _0: tup(v1) }));
  });

  test("a placeholder the target's universe cannot name is a `Mismatch`; a nameable one instantiates", () => {
    const infcx = mk_infcx();
    const v0 = infcx.next_ty_var(DUMMY_SP); // universe 0
    const u1 = infcx.create_next_universe();
    const p1 = Ty.new_placeholder(tcx, PlaceholderType.new_anon(u1, V(0)));
    const rel = relating(infcx, Variance.Invariant, v0, p1);
    expect(rel.relate(v0, p1, relate_Ty)).toEqual(Err({ $: "Mismatch" }));
    expect(infcx.inner.type_variables().probe(0 as TyVid).$).toBe("Unknown");
    const v1 = infcx.next_ty_var(DUMMY_SP); // universe 1
    expect(rel.relate(v1, p1, relate_Ty)).toEqual(Ok(v1));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(1 as TyVid))).toBe(p1);
  });

  test("an invariant variable of a higher universe is pulled down into a fresh one (sub-unified)", () => {
    const infcx = mk_infcx();
    const v0 = infcx.next_ty_var(DUMMY_SP); // universe 0
    infcx.create_next_universe();
    const v1 = infcx.next_ty_var(DUMMY_SP); // universe 1
    const rel = relating(infcx, Variance.Invariant, v0, tup(v1));
    expect(rel.relate(v0, tup(v1), relate_Ty).$).toBe("Ok");
    // `?1` (U1) cannot be named by `?0` (U0): `?2` is created in U0 and sub-unified with `?1`, then `(?2,) == (?1,)`
    // equates them, which lowers `?1`'s universe to U0.
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(tup(var_(2)));
    expect(infcx.root_var(2 as TyVid)).toBe(infcx.root_var(1 as TyVid));
    expect(infcx.inner.type_variables().probe(1 as TyVid)).toEqual({ $: "Unknown", universe: UniverseIndex.ROOT });
  });

  test("InferCtxt::generalize returns the generalized term; union_var_term rejects mismatched kinds", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    infcx.next_ty_var(DUMMY_SP);
    const v1 = infcx.next_ty_var(DUMMY_SP);
    const g = infcx.generalize(DUMMY_SP, TermVid.from_TyVid(0 as TyVid), Variance.Covariant, Term.from_Ty(tup(u32, v1)));
    expect(g).toEqual(Ok({ value_may_be_infer: tup(u32, var_(2)) }));
    // Generalizing does not instantiate the target.
    expect(infcx.inner.type_variables().probe(0 as TyVid).$).toBe("Unknown");
    const ct = infcx.next_const_var(DUMMY_SP);
    expect(() => infcx.union_var_term(TermVid.from_TyVid(0 as TyVid), Term.from_Const(ct))).toThrow(Panic);
  });

  test("TermVid: From impls and derived PartialEq", () => {
    expect(TermVid.from_TyVid(3 as TyVid)).toEqual({ $: "Ty", _0: 3 as TyVid });
    expect(TermVid_eq(TermVid.from_TyVid(3 as TyVid), { $: "Ty", _0: 3 as TyVid })).toBe(true);
    expect(TermVid_eq(TermVid.from_TyVid(3 as TyVid), { $: "Const", _0: 3 as never })).toBe(false);
  });
});

describe("relate/higher_ranked.rs and context.rs: binders", () => {
  const vars = tcx.mk_bound_variable_kinds([{ $: "Ty", _0: BoundTyKind.Anon }]);
  const binder_ty = relate_Binder(relate_Ty);

  test("enter_forall replaces bound types by placeholders of a new universe; no bound vars: no new universe", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const forall = Binder.bind_with_vars(tup(bound_ty(0, 0), u32), vars);
    const seen: Ty[] = [];
    const r = infcx.enter_forall(forall, (t: Ty) => (seen.push(t), 7), fold_Ty);
    expect(r).toBe(7);
    expect(infcx.universe()).toBe(U(1));
    expect(seen).toEqual([tup(Ty.new_placeholder(tcx, PlaceholderType.new_anon(U(1), V(0))), u32)]);
    expect(infcx.enter_forall_and_leak_universe(Binder.dummy(u32, fold_Ty), fold_Ty)).toBe(u32);
    expect(infcx.universe()).toBe(U(1));
  });

  test("enter_forall_with_empty_assumptions enters the universe, then stops at `Assumptions::empty` (PENDING)", () => {
    // PENDING: `Assumptions::empty()` builds a `TransitiveRelationBuilder`, still a stand-in of rustc_data_structures
    // (merge-w16a "Other"); upstream inserts `(U1, Assumptions::empty())` and calls `f`.
    const infcx = mk_infcx();
    const forall = Binder.bind_with_vars(tup(bound_ty(0, 0)), vars);
    let called = false;
    expect(() =>
      infcx.enter_forall_with_empty_assumptions(
        forall,
        () => {
          called = true;
        },
        fold_Ty,
      ),
    ).toThrow(/TransitiveRelationBuilder::default/);
    expect(infcx.universe()).toBe(U(1));
    expect(called).toBe(false);
  });

  test("instantiate_binder_with_infer instantiates bound types with fresh variables", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const forall = Binder.bind_with_vars(tup(bound_ty(0, 0), u32), vars);
    expect(infcx.instantiate_binder_with_infer(forall, fold_Ty)).toEqual(tup(var_(0), u32));
    expect(infcx.universe()).toBe(UniverseIndex.ROOT);
  });

  test("TypeRelating::binders: `for<T> (T,) <: for<T> (T,)` is the identity; `(u32,)` vs `for<T> (T,)` relates via a placeholder", () => {
    const infcx = mk_infcx();
    const { u32 } = tcx.types;
    const a = Binder.bind_with_vars(tup(bound_ty(0, 0)), vars);
    const rel = relating(infcx, Variance.Covariant, u32, u32);
    expect(rel.relate(a, a, binder_ty)).toEqual(Ok(a));
    // `for<> (u32,) <: for<T> (T,)`: `T` becomes a placeholder `!1_0`, and `u32 <: !1_0` fails.
    const b = Binder.dummy(tup(u32), fold_Ty);
    const r = rel.relate(b, a, binder_ty);
    expect(r.$).toBe("Err");
    expect((r as { _0: { $: string } })._0.$).toBe("Sorts");
    expect(infcx.universe()).toBe(U(1));
    // `for<T> (T,) <: for<> (u32,)`: `T` is instantiated with a fresh variable, which becomes `u32`.
    const r2 = rel.relate(a, b, binder_ty);
    expect(r2).toEqual(Ok(a));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(u32);
  });
});

describe("context.rs: impl InferCtxtLike for InferCtxt", () => {
  test("cx / enable_next_solver_overflow_fcw / universe_of_ty / root_ty_var / next_ty_infer", () => {
    const infcx = mk_infcx();
    expect(infcx.cx()).toBe(tcx);
    expect(infcx.enable_next_solver_overflow_fcw()).toBe(infcx.enable_next_solver_overflow_fcw_);
    const v0 = infcx.next_ty_infer();
    expect(v0).toBe(var_(0));
    expect(infcx.universe_of_ty(0 as TyVid)).toBe(UniverseIndex.ROOT);
    infcx.equate_ty_vids_raw(0 as TyVid, (infcx.next_ty_infer().ty_vid() as TyVid));
    expect(infcx.root_ty_var(1 as TyVid)).toBe(0 as TyVid);
    infcx.instantiate_ty_var_raw(0 as TyVid, tcx.types.u8);
    expect(infcx.universe_of_ty(1 as TyVid)).toBeUndefined();
  });

  test("is_sub_unification_table_root_var follows the sub-unification table", () => {
    const infcx = mk_infcx();
    infcx.next_ty_infer();
    infcx.next_ty_infer();
    expect(infcx.is_sub_unification_table_root_var(1 as TyVid)).toBe(true);
    infcx.inner.type_variables().sub_unify(0 as TyVid, 1 as TyVid);
    const root = infcx.inner.type_variables().sub_unification_table_root_var(1 as TyVid);
    expect(infcx.is_sub_unification_table_root_var(root)).toBe(true);
    expect(infcx.is_sub_unification_table_root_var(root === 0 ? (1 as TyVid) : (0 as TyVid))).toBe(false);
  });

  test("int / float / const variables: equate_*_vids_raw and instantiate_*_var_raw", () => {
    const infcx = mk_infcx();
    const i0 = infcx.inner.int_unification_table().new_key({ $: "Unknown" });
    const i1 = infcx.inner.int_unification_table().new_key({ $: "Unknown" });
    infcx.equate_int_vids_raw(i0, i1);
    infcx.instantiate_int_var_raw(i1, { $: "IntType", _0: "I32" } as never);
    expect(infcx.inner.int_unification_table().probe_value(i0)).toEqual({ $: "IntType", _0: "I32" } as never);
    const f0 = infcx.inner.float_unification_table().new_key({ $: "Unknown" });
    infcx.instantiate_float_var_raw(f0, { $: "Known", _0: "F64" } as never);
    expect(infcx.inner.float_unification_table().probe_value(f0)).toEqual({ $: "Known", _0: "F64" } as never);
    const c0 = infcx.next_const_var(DUMMY_SP);
    const c1 = infcx.next_const_var(DUMMY_SP);
    infcx.equate_const_vids_raw(c0.ct_vid()!, c1.ct_vid()!);
    expect(infcx.root_const_var(c1.ct_vid()!)).toBe(infcx.root_const_var(c0.ct_vid()!));
    expect(infcx.universe_of_const(c1.ct_vid()!)).toBe(UniverseIndex.ROOT);
  });

  test("instantiate_ty_var_raw lowers the universes of the value (lower_universe)", () => {
    const infcx = mk_infcx();
    infcx.next_ty_infer(); // ?0 in U0
    infcx.create_next_universe();
    const v1 = infcx.next_ty_infer(); // ?1 in U1
    infcx.instantiate_ty_var_raw(0 as TyVid, tup(v1));
    // `?1` is replaced by `?2` (U0), equated with `?1`: the root `?1` now has universe U0.
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(0 as TyVid))).toBe(tup(var_(2)));
    expect(infcx.root_var(2 as TyVid)).toBe(1 as TyVid);
    expect(infcx.inner.type_variables().probe(1 as TyVid)).toEqual({ $: "Unknown", universe: UniverseIndex.ROOT });
    // A value whose variables are nameable is unchanged.
    infcx.next_ty_infer(); // ?3 in U1
    infcx.instantiate_ty_var_raw(3 as TyVid, tup(var_(1)));
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(3 as TyVid))).toBe(tup(var_(1)));
  });
});

describe("relate/lattice.rs", () => {
  test("LatticeOpKind::invert; LUB/GLB of equal types is the type; of unrelated rigid types a `Sorts` error", () => {
    expect(LatticeOpKind.invert(LatticeOpKind.Glb)).toBe("Lub");
    expect(LatticeOpKind.invert(LatticeOpKind.Lub)).toBe("Glb");
    const infcx = mk_infcx();
    const { u32, i32 } = tcx.types;
    for (const kind of [LatticeOpKind.Lub, LatticeOpKind.Glb]) {
      const op = LatticeOp.new(infcx, mk_trace(u32, i32), ParamEnv.empty(), kind);
      expect(op.relate(tup(u32), tup(u32), relate_Ty)).toEqual(Ok(tup(u32)));
      expect(op.relate(u32, i32, relate_Ty)).toEqual(Err({ $: "Sorts", _0: ExpectedFound.new(u32, i32) }));
      expect(op.relate(tup(u32, u32), tup(u32, i32), relate_Ty)).toEqual(Err({ $: "Sorts", _0: ExpectedFound.new(u32, i32) }));
      expect(op.into_obligations()).toEqual([]);
    }
  });

  test("bivariant arguments are kept from the left operand", () => {
    const infcx = mk_infcx();
    const { u32, i32 } = tcx.types;
    const op = LatticeOp.new(infcx, mk_trace(u32, i32), ParamEnv.empty(), LatticeOpKind.Lub);
    expect(op.relate_with_variance(Variance.Bivariant, { $: "None" }, u32, i32, relate_Ty)).toEqual(Ok(u32));
    // Contravariance flips the kind for the nested relation and restores it.
    expect(op.relate_with_variance(Variance.Contravariant, { $: "None" }, u32, u32, relate_Ty)).toEqual(Ok(u32));
    expect(op.kind).toBe("Lub");
  });
});

