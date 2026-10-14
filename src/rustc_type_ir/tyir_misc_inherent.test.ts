// Lane tyir-misc: inherent.rs (the provided methods generic code calls, and the shape of the rustc_middle impls)
// and interner.rs's `impl search_graph::Cx for I`. Expectations follow the upstream bodies (inherent.rs:142-205,
// :263-369, :401-409, :438-456, :479-513, :664-693; interner.rs:759-777); the panic messages are upstream's
// `expect` strings verbatim (including `expect_region`'s "expected a const").
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg as MGenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { Clause, Predicate } from "../rustc_middle/ty/predicate.ts";
import { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { Panic } from "../std/panic.ts";
import type { Binder, BoundVariableKind, ClauseKind, ConstVid, PredicateKind, TyVid } from "./decls.ts";
import * as inherent from "./inherent.ts";
import { Cx_for_Interner, type Interner } from "./interner.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (as in rustc_middle/ty/interning.test.ts). */
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
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const guar = ErrorGuaranteed.unchecked_error_guaranteed();

function panic_message(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  throw new Error("expected a panic");
}

// ---- type-level conformance: the rustc_middle impls have the shape of the traits (D3) -----------------------------
// `impl inherent::Ty for Ty` (rustc_middle ty/sty.rs:929): the instance methods.
const _ty_methods: inherent.Ty = null as unknown as Ty;
// `impl inherent::Predicate for Predicate` (ty/predicate.rs:50) and `impl inherent::Clause for Clause` (:140).
const _predicate: inherent.Predicate = null as unknown as Predicate;
const _clause: inherent.Clause = null as unknown as Clause;
void _ty_methods;
void _predicate;
void _clause;

describe("inherent::Ty provided methods", () => {
  test("kind predicates", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const ty_var = tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "TyVar", _0: 3 as TyVid } });
    const int_var = t.ty_vars[0]!;
    expect(inherent.Ty_provided.is_ty_var(ty_var)).toBe(true);
    expect(inherent.Ty_provided.is_ty_var(t.bool)).toBe(false);
    expect(inherent.Ty_provided.is_ty_var(int_var)).toBe(true);
    const err = tcx.mk_ty_from_kind({ $: "Error", _0: guar });
    expect(inherent.Ty_provided.is_ty_error(err)).toBe(true);
    expect(inherent.Ty_provided.is_ty_error(t.u8)).toBe(false);
    expect(inherent.Ty_provided.is_floating_point(t.f64)).toBe(true);
    expect(inherent.Ty_provided.is_floating_point(tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "FloatVar", _0: 0 as never } }))).toBe(true);
    expect(inherent.Ty_provided.is_floating_point(t.i32)).toBe(false);
    expect(inherent.Ty_provided.is_integral(t.i32)).toBe(true);
    expect(inherent.Ty_provided.is_integral(t.usize)).toBe(true);
    expect(inherent.Ty_provided.is_integral(tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "IntVar", _0: 0 as never } }))).toBe(true);
    expect(inherent.Ty_provided.is_integral(t.f32)).toBe(false);
    expect(inherent.Ty_provided.is_integral(t.char)).toBe(false);
    expect(inherent.Ty_provided.is_fn_ptr(t.bool)).toBe(false);
  });

  test("is_known_rigid / is_guaranteed_unsized_raw", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(inherent.Ty_provided.is_known_rigid(t.bool)).toBe(true);
    expect(inherent.Ty_provided.is_known_rigid(t.self_param)).toBe(false);
    expect(inherent.Ty_provided.is_known_rigid(t.ty_vars[0]!)).toBe(false);
    expect(inherent.Ty_provided.is_guaranteed_unsized_raw(t.str_)).toBe(true);
    expect(inherent.Ty_provided.is_guaranteed_unsized_raw(tcx.mk_ty_from_kind({ $: "Slice", _0: t.u8 }))).toBe(true);
    expect(inherent.Ty_provided.is_guaranteed_unsized_raw(t.u8)).toBe(false);
    expect(inherent.Ty_provided.is_guaranteed_unsized_raw(t.self_param)).toBe(false);
    expect(inherent.Ty_provided.is_guaranteed_unsized_raw(t.never)).toBe(false);
  });
});

describe("inherent::GenericArg / Term provided methods", () => {
  test("as_* / expect_* on a type argument", () => {
    const tcx = mk_tcx();
    const arg = MGenericArg.from_Ty(tcx.types.u8);
    expect(inherent.GenericArg_provided.as_type(arg)).toBe(tcx.types.u8);
    expect(inherent.GenericArg_provided.expect_ty(arg)).toBe(tcx.types.u8);
    expect(inherent.GenericArg_provided.as_term(arg)).toBe(tcx.types.u8);
    expect(inherent.GenericArg_provided.as_const(arg)).toBeUndefined();
    expect(inherent.GenericArg_provided.as_region(arg)).toBeUndefined();
    expect(panic_message(() => inherent.GenericArg_provided.expect_const(arg))).toBe("expected a const");
    // upstream's message for `expect_region` is also "expected a const" (inherent.rs:292)
    expect(panic_message(() => inherent.GenericArg_provided.expect_region(arg))).toBe("expected a const");
  });

  test("regions and consts", () => {
    const tcx = mk_tcx();
    const re = tcx.lifetimes.re_static;
    const r_arg = MGenericArg.from_Region(re);
    expect(inherent.GenericArg_provided.as_region(r_arg)).toBe(re);
    expect(inherent.GenericArg_provided.as_term(r_arg)).toBeUndefined();
    expect(inherent.GenericArg_provided.is_non_region_infer(r_arg)).toBe(false);
    expect(panic_message(() => inherent.GenericArg_provided.expect_ty(r_arg))).toBe("expected a type");
    const ct = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 0 as ConstVid } });
    const c_arg = MGenericArg.from_Const(ct);
    expect(inherent.GenericArg_provided.as_const(c_arg)).toBe(ct);
    expect(inherent.GenericArg_provided.expect_const(c_arg)).toBe(ct);
    expect(inherent.GenericArg_provided.as_term(c_arg)).toBe(ct);
    expect(inherent.GenericArg_provided.is_non_region_infer(c_arg)).toBe(true);
    expect(inherent.GenericArg_provided.is_non_region_infer(MGenericArg.from_Ty(tcx.types.ty_vars[1]!))).toBe(true);
    expect(inherent.GenericArg_provided.is_non_region_infer(MGenericArg.from_Ty(tcx.types.bool))).toBe(false);
  });

  test("Term", () => {
    const tcx = mk_tcx();
    const ty = tcx.types.ty_vars[0]!;
    const ct = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 1 as ConstVid } });
    const ct_err = tcx.mk_ct_from_kind({ $: "Error", _0: guar });
    expect(inherent.Term_provided.as_type(ty)).toBe(ty);
    expect(inherent.Term_provided.as_const(ty)).toBeUndefined();
    expect(inherent.Term_provided.expect_const(ct)).toBe(ct);
    expect(panic_message(() => inherent.Term_provided.expect_ty(ct))).toBe("expected a type, but found a const");
    expect(panic_message(() => inherent.Term_provided.expect_const(ty))).toBe("expected a const, but found a type");
    expect(inherent.Term_provided.is_infer(ty)).toBe(true);
    expect(inherent.Term_provided.is_infer(ct)).toBe(true);
    expect(inherent.Term_provided.is_infer(tcx.types.bool)).toBe(false);
    expect(inherent.Term_provided.is_error(ct_err)).toBe(true);
    expect(inherent.Term_provided.is_error(tcx.mk_ty_from_kind({ $: "Error", _0: guar }))).toBe(true);
    expect(inherent.Term_provided.is_error(ct)).toBe(false);
    expect(inherent.Term_provided.to_alias_term(tcx.types.bool)).toBeUndefined();
    expect(inherent.Term_provided.to_alias_term(ct)).toBeUndefined();
    expect(inherent.Term_provided.is_non_rigid_alias(tcx.types.bool)).toBe(false);
    expect(inherent.Term_provided.is_non_rigid_alias(ct)).toBe(false);
  });

  test("GenericArgs::as_closure / as_coroutine_closure / as_coroutine wrap the args", () => {
    const tcx = mk_tcx();
    const args = tcx.mk_args([MGenericArg.from_Ty(tcx.types.u8)]);
    expect(inherent.GenericArgs_provided.as_closure(args).args).toBe(args);
    expect(inherent.GenericArgs_provided.as_coroutine_closure(args).args).toBe(args);
    expect(inherent.GenericArgs_provided.as_coroutine(args).args).toBe(args);
  });
});

describe("inherent::Predicate / Clause provided methods", () => {
  // `Clause::kind` (rustc_middle ty/predicate.rs:173, lane ty-args) is still a stub; these tests provide upstream's
  // body (`map_bound_no_validate_bound_vars` taking the `PredicateKind::Clause` payload).
  let spy: { mockRestore(): void } | undefined;
  beforeAll(() => {
    spy = spyOn(Clause.prototype as unknown as { kind(): Binder<ClauseKind> }, "kind").mockImplementation(function (this: Clause) {
      const b = this.as_predicate().kind();
      if (b.value.$ !== "Clause") throw new Error("unreachable");
      return { value: b.value._0, bound_vars: b.bound_vars };
    });
  });
  afterAll(() => spy?.mockRestore());
  const vars = () => RawList.empty<BoundVariableKind>() as never;

  test("allow_normalization: false only for WellFormed clauses", () => {
    const tcx = mk_tcx();
    const wf: PredicateKind = { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.u8 } };
    expect(inherent.Predicate_provided.allow_normalization(tcx.mk_predicate({ value: wf, bound_vars: vars() }))).toBe(false);
    const amb: PredicateKind = { $: "Ambiguous" };
    expect(inherent.Predicate_provided.allow_normalization(tcx.mk_predicate({ value: amb, bound_vars: vars() }))).toBe(true);
    const ce: PredicateKind = { $: "Clause", _0: { $: "ConstEvaluatable", _0: tcx.mk_ct_from_kind({ $: "Error", _0: guar }) } };
    expect(inherent.Predicate_provided.allow_normalization(tcx.mk_predicate({ value: ce, bound_vars: vars() }))).toBe(true);
  });

  test("as_*_clause keep the bound vars and select the variant", () => {
    const tcx = mk_tcx();
    const bv = vars();
    const wf = Clause.of(tcx.mk_predicate({ value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.u8 } }, bound_vars: bv }));
    expect(inherent.Clause_provided.as_type_outlives_clause(wf)).toBeUndefined();
    expect(inherent.Clause_provided.as_trait_clause(wf)).toBeUndefined();
    expect(inherent.Clause_provided.as_host_effect_clause(wf)).toBeUndefined();
    expect(inherent.Clause_provided.as_projection_clause(wf)).toBeUndefined();
    const outlives = { _0: tcx.types.u8, _1: tcx.lifetimes.re_static };
    const to = Clause.of(tcx.mk_predicate({ value: { $: "Clause", _0: { $: "TypeOutlives", _0: outlives } }, bound_vars: bv }));
    const b = inherent.Clause_provided.as_type_outlives_clause(to);
    expect(b).toBeDefined();
    expect(b!.bound_vars).toBe(bv);
    expect(b!.value._0).toBe(tcx.types.u8);
    expect(b!.value._1).toBe(tcx.lifetimes.re_static);
    expect(inherent.Clause_provided.as_trait_clause(to)).toBeUndefined();
  });
});

describe("inherent::SliceLike", () => {
  test("provided methods over arrays and interned lists", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const list = tcx.mk_type_list([t.u8, t.bool, t.char]);
    const S = inherent.SliceLike_provided;
    expect(S.len(list)).toBe(3);
    expect(S.is_empty(list)).toBe(false);
    expect(S.is_empty(tcx.mk_type_list([]))).toBe(true);
    expect(S.get(list, 1)).toBe(t.bool);
    expect(S.get(list, 3)).toBeUndefined();
    expect(S.contains(list, t.char)).toBe(true);
    expect(S.contains(list, t.str_)).toBe(false);
    expect(S.to_vec(list)).toEqual([t.u8, t.bool, t.char]);
    expect(S.last(list)).toBe(t.char);
    expect(S.last([])).toBeUndefined();
    const [last, rest] = S.split_last(list)!;
    expect(last).toBe(t.char);
    expect(rest).toEqual([t.u8, t.bool]);
    expect(S.split_last([])).toBeUndefined();
    expect([...inherent.SliceLike_for_slice.iter([1, 2])]).toEqual([1, 2]);
    expect(inherent.SliceLike_for_ref(inherent.SliceLike_for_array).as_slice([4])).toEqual([4]);
  });
});

describe("impl search_graph::Cx for I", () => {
  test("every method forwards to the interner", () => {
    const calls: string[] = [];
    const cx = {
      mk_tracked: (d: unknown, n: unknown) => (calls.push("mk_tracked"), [d, n]),
      get_tracked: (t: unknown) => (calls.push("get_tracked"), t),
      with_cached_task: (task: () => unknown) => (calls.push("with_cached_task"), [task(), 7]),
      with_global_cache: (f: (c: unknown) => unknown) => (calls.push("with_global_cache"), f("cache")),
      assert_evaluation_is_concurrent: () => void calls.push("assert_evaluation_is_concurrent"),
    } as unknown as Interner;
    expect(Cx_for_Interner.mk_tracked(cx, 1, 2 as never)).toEqual([1, 2] as never);
    expect(Cx_for_Interner.get_tracked(cx, 5 as never)).toBe(5 as never);
    expect(Cx_for_Interner.with_cached_task(cx, () => "r")).toEqual(["r", 7] as never);
    expect(Cx_for_Interner.with_global_cache(cx, (c) => c)).toBe("cache" as never);
    Cx_for_Interner.assert_evaluation_is_concurrent(cx);
    expect(calls).toEqual(["mk_tracked", "get_tracked", "with_cached_task", "with_global_cache", "assert_evaluation_is_concurrent"]);
  });
});
