// Lane ty-contract: the D2 hash-consing contract (docs/plan-m3.md). Same value -> the same frozen object,
// different values -> different objects, for `Ty`, `Region`, `Const`, `Predicate`/`Clause` and the interned
// lists; `GenericArg`/`Term` packing; the D5 map keys.
//
// `FlagComputation::for_kind` / `for_const_kind` / `for_predicate` are unported until lane tyir-kind (they walk the
// generated kinds), so the tests that intern types, consts or predicates stub them with "no flags"; interning
// identity does not depend on the flags.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../lib.ts";
import { CRATE_DEF_ID, CrateNum, DefId, DefIdMap, DefIdSet, DefIndex } from "../../rustc_span/def_id.ts";
import { HirId, HirIdMap, HirIdSet, ItemLocalId, OwnerId } from "../../rustc_hir_id/lib.ts";
import { kw } from "../../rustc_span/symbol.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { type Binder, type BoundVar, type ConstVid, type DebruijnIndex, INNERMOST, type PredicateKind, type RegionVid, TypeFlags_empty } from "../../rustc_type_ir/decls.ts";
import { FlagComputation } from "../../rustc_type_ir/flags.ts";
import { CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { CommonConsts, CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { GenericArg } from "./generic_args.ts";
import { RawList } from "./list.ts";
import { ScalarInt } from "./consts/int.ts";
import { ValTree, Value } from "./consts/valtree.ts";
import { Term, Ty } from "./mod.ts";
import { Clause, Predicate } from "./predicate.ts";

const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies.push(spyOn(FlagComputation, "for_kind").mockImplementation(() => FlagComputation.new()));
  spies.push(spyOn(FlagComputation, "for_const_kind").mockImplementation(() => FlagComputation.new()));
  spies.push(spyOn(FlagComputation, "for_predicate").mockImplementation(() => FlagComputation.new()));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

/** A `TyCtxt` over a fresh `CtxtInterners` (the interning methods read only `interners` / `types` / `lifetimes`). */
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

describe("Region", () => {
  test("the same kind gives the same object; different kinds different objects", () => {
    const tcx = mk_tcx();
    const a = tcx.intern_region({ $: "ReVar", _0: 600 as RegionVid });
    expect(tcx.intern_region({ $: "ReVar", _0: 600 as RegionVid })).toBe(a);
    expect(tcx.intern_region({ $: "ReVar", _0: 601 as RegionVid })).not.toBe(a);
    expect(a).toBeInstanceOf(Region);
    expect(a.kind()).toEqual({ $: "ReVar", _0: 600 as RegionVid });
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.kind())).toBe(true);
  });

  test("CommonLifetimes are the interned objects", () => {
    const tcx = mk_tcx();
    const l = tcx.lifetimes;
    expect(tcx.intern_region({ $: "ReStatic" })).toBe(l.re_static);
    expect(tcx.intern_region({ $: "ReErased" })).toBe(l.re_erased);
    expect(l.re_static).not.toBe(l.re_erased);
    expect(l.re_vars.length).toBe(500);
    expect(tcx.intern_region({ $: "ReVar", _0: 7 as RegionVid })).toBe(l.re_vars[7]!);
    expect(l.anon_re_bounds.length).toBe(3);
    expect(l.anon_re_bounds[2]!.length).toBe(20);
    expect(l.anon_re_canonical_bounds.length).toBe(20);
    // field order of the struct literal does not matter
    expect(tcx.intern_region({ $: "ReBound", _1: { kind: { $: "Anon" }, var: 4 as BoundVar }, _0: { $: "Bound", _0: 1 as DebruijnIndex } })).toBe(l.anon_re_bounds[1]![4]!);
  });

  test("impl Interner region helpers use the pre-interned regions", () => {
    const tcx = mk_tcx();
    const l = tcx.lifetimes;
    expect(tcx.get_re_static_lifetime()).toBe(l.re_static);
    expect(tcx.intern_re_var(3 as RegionVid)).toBe(l.re_vars[3]!);
    const big = tcx.intern_re_var(9000 as RegionVid);
    expect(tcx.intern_re_var(9000 as RegionVid)).toBe(big);
    expect(tcx.intern_bound_region(2 as DebruijnIndex, { var: 19 as BoundVar, kind: { $: "Anon" } })).toBe(l.anon_re_bounds[2]![19]!);
    expect(tcx.intern_bound_region(3 as DebruijnIndex, { var: 0 as BoundVar, kind: { $: "Anon" } })).toBe(
      tcx.intern_region({ $: "ReBound", _0: { $: "Bound", _0: 3 as DebruijnIndex }, _1: { var: 0 as BoundVar, kind: { $: "Anon" } } }),
    );
    expect(tcx.intern_canonical_bound(5 as BoundVar)).toBe(l.anon_re_canonical_bounds[5]!);
    expect(tcx.get_anon_re_bounds_lifetime(0, 0)).toBe(l.anon_re_bounds[0]![0]!);
    expect(tcx.get_anon_re_bounds_lifetime(5, 0)).toBeUndefined();
    expect(tcx.get_anon_re_canonical_bounds_lifetime(30)).toBeUndefined();
  });
});

describe("Ty", () => {
  test("the same kind gives the same object; different kinds different objects", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(tcx.mk_ty_from_kind({ $: "Bool" })).toBe(t.bool);
    expect(Ty.new(tcx, { $: "Char" })).toBe(t.char);
    expect(tcx.mk_ty_from_kind({ $: "Int", _0: "I8" })).toBe(t.i8);
    expect(t.i8).not.toBe(t.i16);
    expect(t.i8).not.toBe(t.u8);
    expect(t.bool).toBeInstanceOf(Ty);
    expect(Object.isFrozen(t.bool)).toBe(true);
    // a nested struct field, written in another field order
    expect(tcx.mk_ty_from_kind({ $: "Param", _0: { name: kw.SelfUpper, index: 0 } })).toBe(t.self_param);
    expect(tcx.mk_ty_from_kind({ $: "Param", _0: { name: kw.SelfUpper, index: 1 } })).not.toBe(t.self_param);
    // `()` is `Tuple(List::empty())`
    expect(t.unit.kind()).toEqual({ $: "Tuple", _0: RawList.empty() });
    expect(tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([]) })).toBe(t.unit);
    expect(t.trait_object_dummy_self).toBe(t.fresh_tys[0]!);
    expect(t.ty_vars.length).toBe(100);
    expect(new Set([t.bool, t.char, t.never, t.str_, t.unit, t.i32, t.u32, t.f32, t.isize, t.usize]).size).toBe(10);
  });

  test("children are compared by identity: types over different lists differ", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const tup = (tys: Ty[]): Ty => tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(tys) });
    expect(tup([t.bool, t.char])).toBe(tup([t.bool, t.char]));
    expect(tup([t.bool, t.char])).not.toBe(tup([t.char, t.bool]));
    expect(tup([tup([t.bool])])).toBe(tup([tup([t.bool])]));
  });

  test("flags come from FlagComputation and are cached on the object", () => {
    const tcx = mk_tcx();
    expect(tcx.types.bool.flags()).toBe(TypeFlags_empty);
    expect(tcx.types.bool.outer_exclusive_binder()).toBe(INNERMOST);
  });

  // Lane tyir-kind ported `FlagComputation::for_kind`: this used to pin it as UNPORTED; it now pins the real flags.
  test("the real FlagComputation computes the flags while interning", () => {
    const tcx = mk_tcx();
    spies[0]!.mockRestore();
    try {
      const never = tcx.mk_ty_from_kind({ $: "Never" });
      expect(never.flags()).toBe(TypeFlags_empty);
      expect(never.outer_exclusive_binder()).toBe(INNERMOST);
    } finally {
      spies[0] = spyOn(FlagComputation, "for_kind").mockImplementation(() => FlagComputation.new());
    }
  });
});

describe("Const and Predicate", () => {
  test("mk_ct_from_kind interns", () => {
    const tcx = mk_tcx();
    const c = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 1 as ConstVid } });
    expect(tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 1 as ConstVid } })).toBe(c);
    expect(tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 2 as ConstVid } })).not.toBe(c);
    expect(c).toBeInstanceOf(Const);
    expect(c.kind()).toEqual({ $: "Infer", _0: { $: "Var", _0: 1 as ConstVid } });
  });

  test("CommonConsts interns the unit / true / false values and the zst valtree (lane ty-results)", () => {
    const tcx = mk_tcx();
    const cc = CommonConsts.new(tcx.interners, tcx.types);
    expect(cc.valtree_zst).toBeInstanceOf(ValTree);
    expect(cc.valtree_zst.kind()).toEqual({ $: "Branch", _0: RawList.empty() } as never);
    expect(cc.valtree_zst.is_zst()).toBe(true);
    // Interning again (a second `CommonConsts`) hands out the same objects.
    const cc2 = CommonConsts.new(tcx.interners, tcx.types);
    expect(cc2.valtree_zst).toBe(cc.valtree_zst);
    expect(cc2.true_).toBe(cc.true_);
    const vt_true = (cc.true_.kind() as unknown as { _0: Value })._0.valtree;
    expect(tcx.intern_valtree({ $: "Leaf", _0: ScalarInt.TRUE } as never)).toBe(vt_true);
    expect(Value.to_leaf(cc.true_.to_value() as never)).toBe(ScalarInt.TRUE);
    expect(Value.to_leaf(cc.false_.to_value() as never)).toBe(ScalarInt.FALSE);
    expect((cc.unit.kind() as unknown as { _0: Value })._0.ty).toBe(tcx.types.unit);
    expect((cc.true_.kind() as unknown as { _0: Value })._0.ty).toBe(tcx.types.bool);
  });

  test("Predicate and its Clause twin", () => {
    const tcx = mk_tcx();
    const binder: Binder<PredicateKind> = { value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.bool } }, bound_vars: RawList.empty() };
    const p = tcx.mk_predicate(binder);
    expect(tcx.mk_predicate({ value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.bool } }, bound_vars: RawList.empty() })).toBe(p);
    expect(p).toBeInstanceOf(Predicate);
    const c = Clause.of(p);
    expect(Clause.of(p)).toBe(c);
    expect(c.as_predicate()).toBe(p);
    expect(tcx.reuse_or_mk_predicate(p, { value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.bool } }, bound_vars: RawList.empty() })).toBe(p);
    const q = tcx.reuse_or_mk_predicate(p, { value: { $: "Clause", _0: { $: "WellFormed", _0: tcx.types.char } }, bound_vars: RawList.empty() });
    expect(q).not.toBe(p);
    // `Clauses`: a `ListWithCachedTypeInfo` with the union of the clauses' flags
    const cs = tcx.mk_clauses([c, Clause.of(q)]);
    expect(tcx.mk_clauses([c, Clause.of(q)])).toBe(cs);
    expect(cs.flags()).toBe(TypeFlags_empty);
    expect(tcx.mk_clauses([])).toBe(RawList.empty_with_type_info());
    expect(tcx.mk_clauses([])).not.toBe(RawList.empty());
  });
});

describe("List", () => {
  test("slice interning", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const l = tcx.mk_type_list([t.bool, t.char]);
    expect(tcx.mk_type_list([t.bool, t.char])).toBe(l);
    expect(tcx.mk_type_list([t.char, t.bool])).not.toBe(l);
    expect(tcx.mk_type_list([t.bool])).not.toBe(l);
    // a `List<T>` is a frozen `readonly T[]`
    expect(Array.isArray(l)).toBe(true);
    expect(l.length).toBe(2);
    expect(l.len()).toBe(2);
    expect(l[0]).toBe(t.bool);
    expect([...l]).toEqual([t.bool, t.char]);
    expect(Object.isFrozen(l)).toBe(true);
    expect(l.map((x) => x)).not.toBeInstanceOf(RawList);
    expect(l.as_slice()).toBe(l);
    // the empty list is one static object, shared by every element type
    expect(tcx.mk_type_list([])).toBe(RawList.empty());
    expect(tcx.mk_args([])).toBe(RawList.empty());
    // lists of different element sets are distinct interners, even for equal contents
    const args = tcx.mk_args([t.bool, t.char]);
    expect(args).not.toBe(l);
    expect(tcx.mk_args([t.bool, t.char])).toBe(args);
    // lists of non-interned values compare by value
    expect(tcx.mk_local_def_ids([CRATE_DEF_ID])).toBe(tcx.mk_local_def_ids([CRATE_DEF_ID]));
  });

  test("mk_*_from_iter: the blanket impl and the Result impl", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    function* gen(): Generator<Ty> {
      yield t.u8;
      yield t.u16;
    }
    expect(tcx.mk_type_list_from_iter(gen())).toBe(tcx.mk_type_list([t.u8, t.u16]));
    const ok: Result<Ty, string>[] = [Ok(t.u8), Ok(t.u16)];
    const r = tcx.mk_type_list_from_iter(ok, CollectAndApply_Result);
    expect(r.$ === "Ok" && r._0).toBe(tcx.mk_type_list([t.u8, t.u16]));
    let pulled = 0;
    function* bad(): Generator<Result<Ty, string>> {
      pulled++;
      yield Ok(t.u8);
      pulled++;
      yield Err("e");
      pulled++;
      yield Ok(t.u16);
    }
    expect(tcx.mk_type_list_from_iter(bad(), CollectAndApply_Result)).toEqual(Err("e"));
    expect(pulled).toBe(2);
    expect(tcx.mk_args_trait(t.bool, [t.char])).toBe(tcx.mk_args([t.bool, t.char]));
  });
});

describe("GenericArg and Term", () => {
  test("pack/kind round-trip on the objects themselves", () => {
    const tcx = mk_tcx();
    const ty = tcx.types.bool;
    const re = tcx.lifetimes.re_static;
    const ct = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 0 as ConstVid } });
    expect(GenericArg.from_Ty(ty)).toBe(ty);
    expect(GenericArg.kind(ty)).toEqual({ $: "Type", _0: ty });
    expect(GenericArg.kind(re)).toEqual({ $: "Lifetime", _0: re });
    expect(GenericArg.kind(ct)).toEqual({ $: "Const", _0: ct });
    expect(GenericArg.pack(GenericArg.kind(re))).toBe(re);
    expect(GenericArg.as_type(re)).toBeUndefined();
    expect(GenericArg.expect_ty(ty)).toBe(ty);
    expect(() => GenericArg.expect_ty(re)).toThrow();
    expect(GenericArg.as_term(re)).toBeUndefined();
    expect(GenericArg.as_term(ct)).toBe(ct);
    expect(Term.kind(ty)).toEqual({ $: "Ty", _0: ty });
    expect(Term.into_arg(ct)).toBe(ct);
    expect(Term.expect_const(ct)).toBe(ct);
    expect(() => Term.expect_type(ct)).toThrow();
  });
});

describe("intern_key", () => {
  test("field order, undefined fields and interned children", () => {
    const tcx = mk_tcx();
    expect(intern_key({ a: 1, b: [2, "x"] })).toBe(intern_key({ b: [2, "x"], a: 1 }));
    expect(intern_key({ a: 1, b: undefined })).toBe(intern_key({ a: 1 }));
    expect(intern_key({ a: 1 })).not.toBe(intern_key({ a: "1" }));
    expect(intern_key({ a: 1n })).not.toBe(intern_key({ a: 1 }));
    expect(intern_key([tcx.types.bool])).toBe(`[#${tcx.types.bool.id}]`);
    expect(intern_key(null)).not.toBe(intern_key(undefined));
    expect(() => intern_key({ m: new Map() })).toThrow();
  });
});

describe("D5 map keys", () => {
  test("DefIdMap / DefIdSet compare DefIds by value", () => {
    const a = new DefId(DefIndex.from_u32(5), CrateNum.from_u32(0));
    const a2 = new DefId(DefIndex.from_u32(5), CrateNum.from_u32(0));
    const b = new DefId(DefIndex.from_u32(5), CrateNum.from_u32(1));
    const m = new DefIdMap<string>();
    m.set(a, "x");
    expect(m.get(a2)).toBe("x");
    expect(m.has(b)).toBe(false);
    m.set(b, "y");
    m.set(a2, "z");
    expect(m.size).toBe(2);
    expect([...m.values()]).toEqual(["z", "y"]);
    expect([...m.keys()][0]).toBe(a);
    const s = new DefIdSet([a, a2, b]);
    expect(s.size).toBe(2);
    expect(s.has(new DefId(DefIndex.from_u32(5), CrateNum.from_u32(1)))).toBe(true);
  });

  test("HirIdMap / HirIdSet compare HirIds by value, insertion ordered", () => {
    const h = (owner: number, local: number): HirId => new HirId(new OwnerId(owner as never), ItemLocalId.from_u32(local));
    const m = new HirIdMap<number>();
    m.set(h(3, 1), 1);
    m.set(h(1, 3), 2);
    m.set(h(3, 1), 3);
    expect(m.size).toBe(2);
    expect(m.get(h(3, 1))).toBe(3);
    expect([...m.values()]).toEqual([3, 2]);
    expect(new HirIdSet([h(0, 0), h(0, 0), h(0, 1)]).size).toBe(2);
  });
});
