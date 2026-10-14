// Lane ty-args: generic_args.rs, list.rs, predicate.rs, generics.rs on hand-built generics (no driver).
//
// `Ty::new_param` / `Ty::new_misc_error` (ty/sty.rs, lane ty-sty) are stubs on this branch; the tests that build
// identity args mock `Ty.new_param` with its upstream body (`Ty::new(tcx, ty::Param(ParamTy { index, name }))`).
// `generics_of`, `clauses_of` and `const_conditions` are queries; the tests shadow them on the `TyCtxt` instance.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../lib.ts";
import { CrateNum, DefId, type DefIndex, DefIdMap } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { BoundVar, BoundVariableKind, ClauseKind, ExistentialPredicate, PolyExistentialPredicate, PredicateKind, TraitRef } from "../../rustc_type_ir/decls.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { Panic } from "../../std/panic.ts";
import { INNERMOST } from "../../rustc_type_ir/decls.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import type { DefPathHash } from "../../rustc_span/def_id.ts";
import { fold_GenericArg, fold_GenericArgs, fold_List_Ty, GenericArg, type GenericArgs } from "./generic_args.ts";
import { ConstConditions, GenericClauses, type GenericParamDef, GenericParamDef as GenericParamDefC, Generics } from "./generics.ts";
import { cmp_RawList, hash_RawList, partial_cmp_RawList, RawList } from "./list.ts";
import { Term, Ty } from "./mod.ts";
import { Clause, Clause_upcast_from_PolyTraitRef, ExistentialPredicate_stable_cmp, Predicate, Predicate_upcast_from_ClauseKind, Predicate_upcast_from_PredicateKind, Predicate_upcast_from_TraitRef, Clause_upcast_from_TraitRef, Predicate_upcast_from_Clause } from "./predicate.ts";
import { DefId_hash_key } from "../query/caches.ts";

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

const did = (index: number) => new DefId(index as DefIndex, 0 as CrateNum);

/** Shadows the query `name` on this `TyCtxt` instance. */
function mock_query(tcx: TyCtxt, name: string, f: (def_id: DefId) => unknown): void {
  Object.defineProperty(tcx, name, { value: f, configurable: true });
}

function mk_generics(parent: DefId | undefined, parent_count: number, own_params: GenericParamDef[], has_self = false): Generics {
  const m = new KeyedMap<DefId, number>(DefId_hash_key);
  for (const p of own_params) m.set(p.def_id, p.index);
  return new Generics(parent, parent_count, own_params, m, has_self, undefined);
}

const lifetime = (name: Symbol, d: number, index: number): GenericParamDef => ({ name, def_id: did(d), index, pure_wrt_drop: false, kind: { $: "Lifetime" } });
const type_param = (name: Symbol, d: number, index: number, has_default = false): GenericParamDef => ({ name, def_id: did(d), index, pure_wrt_drop: false, kind: { $: "Type", has_default, synthetic: false } });
const const_param = (name: Symbol, d: number, index: number): GenericParamDef => ({ name, def_id: did(d), index, pure_wrt_drop: false, kind: { $: "Const", has_default: false } });

const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  // upstream body of `Ty::new_param` (ty/sty.rs, lane ty-sty)
  spies.push(spyOn(Ty, "new_param").mockImplementation((tcx: TyCtxt, index: number, name: Symbol) => Ty.new(tcx, { $: "Param", _0: { index, name } })));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

/** `trait Tr<'a>` (def 10: `Self`, `'a`) with `fn f<T, const N: usize>()` (def 20). */
function trait_and_method(tcx: TyCtxt) {
  const T = Symbol.intern("T");
  const N = Symbol.intern("N");
  const a = Symbol.intern("a");
  const trait_generics = mk_generics(undefined, 0, [type_param(kw.SelfUpper, 11, 0), lifetime(a, 12, 1)], true);
  const method_generics = mk_generics(did(10), 2, [type_param(T, 21, 2), const_param(N, 22, 3)]);
  const by_def = new DefIdMap<Generics>();
  by_def.set(did(10), trait_generics);
  by_def.set(did(20), method_generics);
  mock_query(tcx, "generics_of", (d) => by_def.get(d)!);
  return { trait_generics, method_generics, T, N, a };
}

describe("GenericArgs (generic_args.rs)", () => {
  test("identity_for_item maps each parameter (parents first) to itself", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      const { T, N, a } = trait_and_method(tcx);
      const args = RawList.identity_for_item(tcx, did(20));
      expect(args.length).toBe(4);
      expect(args[0]).toBe(Ty.new(tcx, { $: "Param", _0: { index: 0, name: kw.SelfUpper } }));
      expect(args[1]).toBe(Region.new_early_param(tcx, { index: 1, name: a }));
      expect(args[2]).toBe(Ty.new(tcx, { $: "Param", _0: { index: 2, name: T } }));
      expect(args[3]).toBe(Const.new_param(tcx, { index: 3, name: N }));
      // interned: the same list again
      expect(RawList.identity_for_item(tcx, did(20))).toBe(args);
      expect(args.type_at(0)).toBe(args[0] as Ty);
      expect(args.region_at(1)).toBe(args[1] as Region);
      expect(args.const_at(3)).toBe(args[3] as Const);
      expect(args.type_for_def(type_param(T, 21, 2))).toBe(args[2]!);
      expect(args.types()).toEqual([args[0] as Ty, args[2] as Ty]);
      expect(args.regions()).toEqual([args[1] as Region]);
      expect(args.consts()).toEqual([args[3] as Const]);
      expect(args.terms()).toEqual([Term.from_Ty(args[0] as Ty), Term.from_Ty(args[2] as Ty), Term.from_Const(args[3] as Const)]);
      expect([...args.non_erasable_generics()].map((k) => k.$)).toEqual(["Type", "Type", "Const"]);
      expect(() => args.type_at(9)).toThrow(new Panic("index out of bounds: the len is 4 but the index is 9"));
      expect(GenericArg.is_non_region_infer(args[1]!)).toBe(false);
    });
  });

  test("for_item / extend_to / extend_with_error / truncate_to / rebase_onto", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      const { trait_generics } = trait_and_method(tcx);
      const seen: number[] = [];
      const u8 = tcx.types.u8;
      const static_ = tcx.lifetimes.re_static;
      const args = RawList.for_item(tcx, did(10), (param, so_far) => {
        seen.push(so_far.length);
        return param.kind.$ === "Lifetime" ? static_ : u8;
      });
      expect(seen).toEqual([0, 1]);
      expect([...args]).toEqual([u8, static_]);

      // extend_to keeps the args it has and builds the rest
      const full = args.extend_to(tcx, did(20), (param) => (param.kind.$ === "Const" ? Const.new_param(tcx, { index: param.index, name: param.name }) : tcx.types.bool));
      expect(full.length).toBe(4);
      expect(full[0]).toBe(u8);
      expect(full[1]).toBe(static_);
      expect(full[2]).toBe(tcx.types.bool);

      // extend_with_error keeps the original args when all are present
      expect(RawList.extend_with_error(tcx, did(10), [u8, static_])).toBe(args);

      // truncate_to the trait's generics
      expect(full.truncate_to(tcx, trait_generics)).toBe(args);

      // rebase_onto: replace the trait's 2 args with the impl's 1
      const rebased = full.rebase_onto(tcx, did(10), tcx.mk_args([tcx.types.i32]));
      expect([...rebased]).toEqual([tcx.types.i32, full[2]!, full[3]!]);
    });
  });

  test("fill_single asserts the parameter indices", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      const bad = mk_generics(undefined, 0, [type_param(kw.SelfUpper, 11, 1)]);
      expect(() => RawList.fill_single([], bad, () => tcx.types.u8)).toThrow("assertion `left == right` failed: [], Generics {");
      expect(() => RawList.fill_single([], bad, () => tcx.types.u8)).toThrow("\n  left: 1\n right: 0");
    });
  });

  test("split_closure_args / into_type_list / as_closure", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const args = tcx.mk_args([t.u8, t.i8, t.u16, t.i16]);
    const parts = args.split_closure_args();
    expect(parts.parent_args).toEqual([t.u8]);
    expect(parts.closure_kind_ty).toBe(t.i8);
    expect(parts.closure_sig_as_fn_ptr_ty).toBe(t.u16);
    expect(parts.tupled_upvars_ty).toBe(t.i16);
    expect(() => tcx.mk_args([t.u8]).split_coroutine_args()).toThrow("coroutine args missing synthetics");
    expect(args.into_type_list(tcx)).toBe(tcx.mk_type_list([t.u8, t.i8, t.u16, t.i16]));
    expect(() => tcx.mk_args([tcx.lifetimes.re_static]).into_type_list(tcx)).toThrow("`into_type_list` called on generic arg with non-types");
    expect(args.as_closure().args).toBe(args);
  });

  test("EarlyBinder::instantiate folds args through fold_GenericArgs / fold_List_Ty (ArgFolder)", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      trait_and_method(tcx);
      const identity = RawList.identity_for_item(tcx, did(20));
      const t = tcx.types;
      const target = tcx.mk_args([t.u8, tcx.lifetimes.re_static, t.bool, identity[3]!]);
      // 2 args: the specialised arm
      const two = tcx.mk_args([identity[0]!, identity[1]!]);
      expect(TypeVisitableExt.has_param(two, fold_GenericArgs)).toBe(true);
      const r2 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_no_rigid_aliases(two), tcx, target, fold_GenericArgs));
      expect([...r2]).toEqual([t.u8, tcx.lifetimes.re_static]);
      // 4 args: `fold_list`
      const r4 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_no_rigid_aliases(identity), tcx, target, fold_GenericArgs));
      expect(r4).toBe(target);
      // nothing changes: the same list comes back
      expect(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_no_rigid_aliases(target), tcx, target, fold_GenericArgs))).toBe(target);
      // &List<Ty>
      const tys = tcx.mk_type_list([identity[2] as Ty, identity[0] as Ty]);
      const rt = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_no_rigid_aliases(tys), tcx, target, fold_List_Ty));
      expect(rt).toBe(tcx.mk_type_list([t.bool, t.u8]));
      // GenericArg
      expect(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_no_rigid_aliases<GenericArg>(identity[1]!), tcx, target, fold_GenericArg))).toBe(tcx.lifetimes.re_static);
    });
  });
});

describe("Generics (generics.rs)", () => {
  test("param_at / params_to / *_param / own_args / defaults", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      const { trait_generics, method_generics, a } = trait_and_method(tcx);
      expect(method_generics.param_at(1, tcx)).toBe(trait_generics.own_params[1]!);
      expect(method_generics.param_at(3, tcx)).toBe(method_generics.own_params[1]!);
      expect(method_generics.params_to(3, tcx)).toEqual([method_generics.own_params[0]!]);
      expect(method_generics.params_to(1, tcx)).toEqual([trait_generics.own_params[0]!]);
      expect(method_generics.region_param({ index: 1, name: a }, tcx)).toBe(trait_generics.own_params[1]!);
      expect(method_generics.param_region_def_id(tcx, { index: 1, name: a })).toEqual(did(12));
      expect(method_generics.type_param({ index: 2, name: Symbol.intern("T") }, tcx).def_id).toEqual(did(21));
      expect(method_generics.const_param({ index: 3, name: Symbol.intern("N") }, tcx).def_id).toEqual(did(22));
      expect(() => method_generics.type_param({ index: 1, name: a }, tcx)).toThrow("expected type parameter, but found another generic parameter: GenericParamDef {\n    name: \"a\",\n");
      expect(() => method_generics.param_at(7, tcx)).toThrow(new Panic("index out of bounds: the len is 2 but the index is 5"));
      expect(() => mk_generics(undefined, 1, []).param_at(0, tcx)).toThrow(new Panic("parent_count > 0 but no parent?"));

      const args = RawList.identity_for_item(tcx, did(20));
      // own args of the trait exclude `Self`
      expect(trait_generics.own_args(args)).toEqual([args[1]!]);
      expect(method_generics.own_args(args)).toEqual([args[2]!, args[3]!]);
      expect(method_generics.own_args_no_defaults(tcx, args)).toEqual([args[2]!, args[3]!]);
      expect(trait_generics.own_args_no_defaults(tcx, args.slice(0, 2))).toEqual([args[1]!]);
      expect(method_generics.check_concrete_type_after_default(tcx, args)).toBe(false);

      // a defaulted parameter whose default equals the arg is dropped (`struct S<T = u8>`)
      const s_generics = mk_generics(undefined, 0, [type_param(Symbol.intern("T"), 31, 0, true)]);
      mock_query(tcx, "generics_of", () => s_generics);
      mock_query(tcx, "type_of", () => EarlyBinder.bind_no_rigid_aliases(tcx.types.u8));
      expect(s_generics.own_args_no_defaults(tcx, [tcx.types.u8])).toEqual([]);
      expect(s_generics.own_args_no_defaults(tcx, [tcx.types.i8])).toEqual([tcx.types.i8]);
      expect(GenericParamDefC.default_value(s_generics.own_params[0]!, tcx)).toEqual(EarlyBinder.bind_no_rigid_aliases<GenericArg>(tcx.types.u8));
      expect(GenericParamDefC.to_early_bound_region_data(trait_generics.own_params[1]!)).toEqual({ index: 1, name: a });
      expect(() => GenericParamDefC.to_early_bound_region_data(trait_generics.own_params[0]!)).toThrow("cannot convert a non-lifetime parameter def to an early bound region");
    });
  });

  test("GenericClauses / ConstConditions identity instantiation walks the parents", () => {
    const tcx = mk_tcx();
    const p1 = Clause_upcast_from_TraitRef({ def_id: did(1), args: tcx.mk_args([tcx.types.u8]), _use_trait_ref_new_instead: null }, tcx);
    const p2 = Clause_upcast_from_TraitRef({ def_id: did(2), args: tcx.mk_args([tcx.types.i8]), _use_trait_ref_new_instead: null }, tcx);
    const sp = DUMMY_SP as Span;
    const parent: GenericClauses = { parent: undefined, clauses: [[p1, sp]] };
    const child: GenericClauses = { parent: did(5), clauses: [[p2, sp]] };
    mock_query(tcx, "clauses_of", () => parent);
    const inst = GenericClauses.instantiate_identity(child, tcx);
    expect(inst.clauses.map((u) => Unnormalized.skip_normalization(u))).toEqual([p1, p2]);
    expect(inst.spans).toEqual([sp, sp]);
    const own = GenericClauses.instantiate_own_identity(child);
    expect(own.size_hint()).toEqual([1, 1]);
    expect([...own.clone()].map(([c, s]) => [Unnormalized.skip_normalization(c), s])).toEqual([[p2, sp]]);
    expect(own.next_back()?.[1]).toBe(sp);
    expect(own.next()).toBeUndefined();
    expect(GenericClauses.default_()).toEqual({ parent: undefined, clauses: [] });

    const tr: TraitRef = { def_id: did(3), args: tcx.mk_args([]), _use_trait_ref_new_instead: null };
    const b = Binder.dummy(tr, { visit_with: (_s, v) => v.Result.output() });
    const cc_parent: ConstConditions = { parent: undefined, clauses: [[b, sp]] };
    const cc: ConstConditions = { parent: did(5), clauses: [[b, sp]] };
    mock_query(tcx, "const_conditions", () => cc_parent);
    expect(ConstConditions.instantiate_identity(cc, tcx).map(([u, s]) => [Unnormalized.skip_normalization(u), s])).toEqual([
      [b, sp],
      [b, sp],
    ]);
  });
});

describe("Predicate / Clause (predicate.rs)", () => {
  test("trait clauses: upcast, as_clause, kind, as_*_clause, flip_polarity", () => {
    const tcx = mk_tcx();
    const tr: TraitRef = { def_id: did(1), args: tcx.mk_args([tcx.types.u8]), _use_trait_ref_new_instead: null };
    const p = Predicate_upcast_from_TraitRef(tr, tcx);
    expect(p).toBeInstanceOf(Predicate);
    expect(Predicate_upcast_from_TraitRef(tr, tcx)).toBe(p);
    const c = p.expect_clause();
    expect(c).toBeInstanceOf(Clause);
    expect(p.as_clause()).toBe(c);
    expect(Clause_upcast_from_TraitRef(tr, tcx)).toBe(c);
    expect(Predicate_upcast_from_Clause(c, tcx)).toBe(p);
    expect(c.kind().value).toEqual({ $: "Trait", _0: { trait_ref: tr, polarity: "Positive" } });
    expect(c.as_trait_clause()?.value).toEqual({ trait_ref: tr, polarity: "Positive" });
    expect(c.as_projection_clause()).toBeUndefined();
    expect(c.as_type_outlives_clause()).toBeUndefined();
    expect(c.as_region_outlives_clause()).toBeUndefined();
    expect(p.as_trait_clause()?.value).toEqual({ trait_ref: tr, polarity: "Positive" });
    expect(p.as_projection_clause()).toBeUndefined();
    expect(p.allow_normalization()).toBe(true);

    const neg = p.flip_polarity(tcx)!;
    expect(neg.kind().value).toEqual({ $: "Clause", _0: { $: "Trait", _0: { trait_ref: tr, polarity: "Negative" } } });
    expect(neg.flip_polarity(tcx)).toBe(p);

    // `'static: 'static` is a clause, not a trait clause
    const re = tcx.lifetimes.re_static;
    const r_outlives = Predicate_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: re, _1: re } } as ClauseKind, tcx);
    expect(r_outlives.flip_polarity(tcx)).toBeUndefined();
    expect(r_outlives.expect_clause().as_region_outlives_clause()?.value).toEqual({ _0: re, _1: re });
    expect(r_outlives.expect_clause().as_trait_clause()).toBeUndefined();
    // (interned directly: `Binder::dummy` over a `Ty` / `Term` visits through structural_impls.rs, lane ty-results)
    const bv = RawList.empty<BoundVariableKind>();
    const t_outlives = tcx.mk_predicate({ value: { $: "Clause", _0: { $: "TypeOutlives", _0: { _0: tcx.types.u8, _1: re } } } as PredicateKind, bound_vars: bv });
    expect(t_outlives.expect_clause().as_type_outlives_clause()?.value).toEqual({ _0: tcx.types.u8, _1: re });
    // WF is not normalizable
    const wf = tcx.mk_predicate({ value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.u8 } } as PredicateKind, bound_vars: bv });
    expect(wf.allow_normalization()).toBe(false);

    // not a clause
    const amb = Predicate_upcast_from_PredicateKind({ $: "Ambiguous" } as PredicateKind, tcx);
    expect(amb.as_clause()).toBeUndefined();
    expect(() => amb.expect_clause()).toThrow();
  });

  test("instantiate_supertrait: early params replaced, bound vars shifted and concatenated", () => {
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      const { a } = trait_and_method(tcx);
      const identity = RawList.identity_for_item(tcx, did(10)); // [Self, 'a]
      const anon: BoundVariableKind = { $: "Region", _0: { $: "Anon" } } as BoundVariableKind;
      const one = tcx.mk_bound_variable_kinds([anon]);
      const re_b = (v: number) => Region.new_anon_bound(tcx, INNERMOST, v as BoundVar);
      const bar1 = (args: GenericArg[]): Clause => {
        const tr: TraitRef = { def_id: did(2), args: tcx.mk_args(args), _use_trait_ref_new_instead: null };
        return Clause_upcast_from_PolyTraitRef({ value: tr, bound_vars: one }, tcx);
      };
      // `trait Foo1<'a>: Bar1<Self>` (no binder on the supertrait, upstream's first example) for `u8: Foo1<'static>`
      const sup0 = Clause_upcast_from_TraitRef({ def_id: did(2), args: tcx.mk_args([identity[0]!, identity[1]!]), _use_trait_ref_new_instead: null }, tcx);
      const tr0: TraitRef = { def_id: did(10), args: tcx.mk_args([tcx.types.u8, tcx.lifetimes.re_static]), _use_trait_ref_new_instead: null };
      const out0 = sup0.instantiate_supertrait(tcx, { value: tr0, bound_vars: RawList.empty<BoundVariableKind>() });
      expect(out0.kind().value).toEqual({ $: "Trait", _0: { trait_ref: { def_id: did(2), args: tcx.mk_args([tcx.types.u8, tcx.lifetimes.re_static]), _use_trait_ref_new_instead: null }, polarity: "Positive" } });
      expect(out0.kind().bound_vars).toBe(RawList.empty<BoundVariableKind>());

      // upstream's second example: `trait Foo1<'a>: for<'b> Bar1<'a, 'b>`, `for<'x> T: Foo1<'x>`
      // trait_ref: for<'x> T: Foo1<'^0.0>; predicate: for<'b> Self: Bar1<'a, '^0.0>
      const sup = bar1([identity[0]!, Region.new_early_param(tcx, { index: 1, name: a }), re_b(0)]);
      const tr: TraitRef = { def_id: did(10), args: tcx.mk_args([tcx.types.u8, re_b(0)]), _use_trait_ref_new_instead: null };
      const out = sup.instantiate_supertrait(tcx, { value: tr, bound_vars: one });
      // => for<'x, 'b> T: Bar1<'^0.0, '^0.1>
      expect(out.kind().value).toEqual({ $: "Trait", _0: { trait_ref: { def_id: did(2), args: tcx.mk_args([tcx.types.u8, re_b(0), re_b(1)]), _use_trait_ref_new_instead: null }, polarity: "Positive" } });
      expect(out.kind().bound_vars).toBe(tcx.mk_bound_variable_kinds([anon, anon]));
    });
  });

  test("List<PolyExistentialPredicate> and stable_cmp", () => {
    const tcx = mk_tcx();
    const bv = RawList.empty<BoundVariableKind>();
    const b = (value: ExistentialPredicate): PolyExistentialPredicate => ({ value, bound_vars: bv });
    const principal = b({ $: "Trait", _0: { def_id: did(1), args: tcx.mk_args([]), _use_existential_trait_ref_new_instead: null } } as unknown as ExistentialPredicate);
    const proj = b({ $: "Projection", _0: { def_id: did(2), args: tcx.mk_args([]), term: tcx.types.u8 } } as unknown as ExistentialPredicate);
    const send = b({ $: "AutoTrait", _0: did(3) });
    const sync = b({ $: "AutoTrait", _0: did(4) });
    // test-only list construction (the interner's `mk_poly_existential_predicates` sorts with `stable_cmp`)
    const list = RawList.of_slice(null, [principal, proj, send, sync]);
    expect(list.principal()?.value).toBe(principal.value._0 as never);
    expect(list.principal_def_id()).toEqual(did(1));
    expect([...list.projection_bounds()].map((p) => p.value)).toEqual([proj.value._0 as never]);
    expect(list.auto_traits()).toEqual([did(3), did(4)]);
    expect(list.without_auto_traits()).toEqual([principal, proj]);
    const no_principal = RawList.of_slice(null, [send]);
    expect(no_principal.principal()).toBeUndefined();
    expect(no_principal.principal_def_id()).toBeUndefined();
    expect(() => RawList.of_slice<null, PolyExistentialPredicate>(null, []).principal()).toThrow(new Panic("index out of bounds: the len is 0 but the index is 0"));

    mock_query(tcx, "def_path_hash", (d) => BigInt(1000 - d.index) as DefPathHash);
    const cmp = (x: PolyExistentialPredicate, y: PolyExistentialPredicate) => ExistentialPredicate_stable_cmp(x.value, tcx, y.value);
    expect(cmp(principal, principal)).toBe("Equal");
    expect(cmp(principal, send)).toBe("Less");
    expect(cmp(proj, principal)).toBe("Greater");
    expect(cmp(proj, send)).toBe("Less");
    expect(cmp(send, principal)).toBe("Greater");
    expect(cmp(send, proj)).toBe("Greater");
    // by def-path hash (mocked: decreasing in the def index)
    expect(cmp(send, sync)).toBe("Greater");
    expect(cmp(sync, send)).toBe("Less");
    expect(cmp(send, send)).toBe("Equal");
  });
});

describe("RawList (list.rs)", () => {
  test("Default, PartialEq, Ord, Hash, Deref, IntoIterator, from_vars", () => {
    const tcx = mk_tcx();
    expect(RawList.default<number>()).toBe(RawList.empty<number>());
    const a = RawList.of_slice<null, number>(null, [1, 2]);
    const b = RawList.of_slice<null, number>(null, [1, 3]);
    const c = RawList.of_slice<null, number>(null, [1]);
    const ord = (x: number, y: number) => (x < y ? "Less" : x > y ? "Greater" : "Equal") as "Less" | "Equal" | "Greater";
    expect(a.eq(a)).toBe(true);
    expect(a.eq(b)).toBe(false);
    expect(cmp_RawList(a, a, ord)).toBe("Equal");
    expect(cmp_RawList(a, b, ord)).toBe("Less");
    expect(cmp_RawList(b, a, ord)).toBe("Greater");
    expect(cmp_RawList(c, a, ord)).toBe("Less");
    expect(partial_cmp_RawList(a, c, ord)).toBe("Greater");
    expect(partial_cmp_RawList(a, b, () => undefined)).toBeUndefined();
    const written: number[] = [];
    hash_RawList(a, { write_usize: (n: number) => void written.push(n) } as never);
    expect(written).toEqual([a.id]);
    expect(a.deref()).toBe(a);
    expect(a.as_ref()).toBe(a);
    expect([...a.into_iter()]).toEqual([1, 2]);
    expect([...a.iter()]).toEqual([1, 2]);
    expect(a.as_slice()).toBe(a);
    const vars: BoundVariableKind[] = [{ $: "Region", _0: { $: "Anon" } } as BoundVariableKind];
    expect(RawList.from_vars(tcx, vars)).toBe(tcx.mk_bound_variable_kinds(vars));
  });
});

// `GenericArgs` is used as a type in the declarations above.
export type { GenericArgs };
