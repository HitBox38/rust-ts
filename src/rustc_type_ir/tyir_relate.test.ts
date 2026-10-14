// Lane tyir-relate: relate.rs (structural relation, arg relation, the `Relate` impls), relate/combine.rs and
// relate/solver_relating.rs (with a recording `InferCtxtLike` double), outlives.rs (`OutlivesCollector`), elaborate.rs
// and error.rs, on interned types.
//
// Expectations follow upstream semantics (the code paths are read off the pinned sources): e.g. `bool` vs `char` is
// `Sorts(ExpectedFound { expected: bool, found: char })`, `*const T` vs `*mut T` is `Mutability`, an `fn` argument
// mismatch is `ArgumentSorts(_, index)` with the output at index `inputs.len()`. Paths that reach a dependency not
// ported yet are asserted to stop as UNPORTED. A few stubbed one-liners of other lanes are mocked with their upstream
// bodies (each mock says which).
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { Clause, Predicate } from "../rustc_middle/ty/predicate.ts";
import { type DefIndex, DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { DUMMY_SP, ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";
import type { Binder } from "./binder.ts";
import type { ConstVid } from "./const_kind.ts";
import type { BoundVar, RegionVid, UniverseIndex } from "./decls.ts";
import { elaborate, Elaboratable_Clause, elaborate_outlives_assumptions, supertrait_def_ids, supertraits } from "./elaborate.ts";
import { ExpectedFound, NoSolution_from_TypeError, NoSolutionOrRerunNonErased_from_TypeError, TypeError } from "./error.ts";
import { Variance } from "./lib.ts";
import { type Component, OutlivesCollector, push_outlives_components } from "./outlives.ts";
import type { ClauseKind, PredicateKind } from "./predicate_kind.ts";
import type { TraitRef } from "./predicate.ts";
import type { AliasTermKind } from "./term_kind.ts";
import {
  type Relate,
  relate_args_invariantly,
  relate_args_with_variances,
  relate_AliasTy,
  relate_Binder,
  relate_Const,
  relate_FnSig,
  relate_TraitRef,
  relate_Ty,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  Variance_xform,
  VarianceDiagInfo,
} from "./relate.ts";
import { combine_ty_args, type InferCtxtLike, type PredicateEmittingRelation } from "./relate/combine.ts";
import { RelateExt_for_Infcx, SolverRelating } from "./relate/solver_relating.ts";
import type { Const } from "./sty/consts.ts";
import { Region } from "./sty/mod.ts";
import { FnSigKind, type FloatVid, type FnSig, type IntVid, type TyVid } from "./ty_kind.ts";

// ---- fixtures -------------------------------------------------------------------------------------------------------

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

const tcx = mk_tcx();
const t = tcx.types;
const guar = ErrorGuaranteed.unchecked_error_guaranteed();
const def = (i: number): DefId => new DefId(i as DefIndex, LOCAL_CRATE);
const param = (index: number): Ty => tcx.mk_ty_from_kind({ $: "Param", _0: { index, name: kw.SelfUpper } });
const ty_var = (v: number): Ty => tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "TyVar", _0: v as TyVid } });
const int_var = (v: number): Ty => tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "IntVar", _0: v as IntVid } });
const float_var = (v: number): Ty => tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "FloatVar", _0: v as FloatVid } });
const ptr = (ty: Ty, m: "Not" | "Mut"): Ty => tcx.mk_ty_from_kind({ $: "RawPtr", _0: ty, _1: m });
const tup = (...tys: Ty[]): Ty => tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(tys) });
const args = (...tys: Ty[]): GenericArgs => tcx.mk_args(tys.map((x) => GenericArg.from_Ty(x)));
const ct_param = (index: number): Const => tcx.mk_ct_from_kind({ $: "Param", _0: { index, name: kw.SelfUpper } });
const ct_var = (v: number): Const => tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: v as ConstVid } });
const no_vars = <T>(value: T): Binder<T> => ({ value, bound_vars: tcx.mk_bound_variable_kinds([]) });
const trait_ref = (d: DefId): TraitRef => ({ def_id: d, args: tcx.mk_args([]), _use_trait_ref_new_instead: null });
const pred = (kind: PredicateKind): Predicate => tcx.mk_predicate(no_vars(kind));
const trait_pred = (d: DefId): Predicate => pred({ $: "Clause", _0: { $: "Trait", _0: { trait_ref: trait_ref(d), polarity: "Positive" } } });

const sorts = <T = Ty>(a: Ty, b: Ty): RelateResult<T> => Err({ $: "Sorts", _0: ExpectedFound.new(a, b) });

/** A plain structural relation (no inference): equal types are equal, everything else is structural. */
class StructRelation implements TypeRelation {
  calls: [Variance, VarianceDiagInfo][] = [];
  cx(): TyCtxt {
    return tcx;
  }
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }
  relate_ty_args(a_ty: Ty, _b_ty: Ty, _def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _mk: (args: GenericArgs) => Ty): RelateResult<Ty> {
    const r = relate_args_invariantly(this, a_args, b_args);
    return r.$ === "Err" ? r : Ok(a_ty);
  }
  relate_with_variance<T>(variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    this.calls.push([variance, info]);
    return this.relate(a, b, d);
  }
  tys(a: Ty, b: Ty): RelateResult<Ty> {
    return a === b ? Ok(a) : structurally_relate_tys(this, a, b);
  }
  regions(a: Region, b: Region): RelateResult<Region> {
    return a === b ? Ok(a) : Err({ $: "RegionsDoesNotOutlive", _0: a, _1: b });
  }
  consts(a: Const, b: Const): RelateResult<Const> {
    return structurally_relate_consts(this, a, b);
  }
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    const r = this.relate(a.value, b.value, d);
    return r.$ === "Err" ? r : Ok(a);
  }
}

/** An `InferCtxtLike` double that records the calls the relation makes. */
class RecordingInfcx implements InferCtxtLike {
  log: string[] = [];
  next_solver = true;
  cx(): TyCtxt {
    return tcx;
  }
  next_trait_solver(): boolean {
    return this.next_solver;
  }
  typing_mode_raw() {
    return { $: "Coherence" } as const;
  }
  next_ty_infer(): Ty {
    return ty_var(99);
  }
  instantiate_binder_with_infer<T>(value: Binder<T>): T {
    return value.value;
  }
  enter_forall_with_empty_assumptions<T, U>(value: Binder<T>, f: (value: T) => U): U {
    return f(value.value);
  }
  equate_ty_vids_raw(a: TyVid, b: TyVid): void {
    this.log.push(`equate_ty_vids_raw(${a}, ${b})`);
  }
  equate_int_vids_raw(a: IntVid, b: IntVid): void {
    this.log.push(`equate_int_vids_raw(${a}, ${b})`);
  }
  equate_float_vids_raw(a: FloatVid, b: FloatVid): void {
    this.log.push(`equate_float_vids_raw(${a}, ${b})`);
  }
  equate_const_vids_raw(a: ConstVid, b: ConstVid): void {
    this.log.push(`equate_const_vids_raw(${a}, ${b})`);
  }
  instantiate_ty_var(_r: PredicateEmittingRelation, target_is_expected: boolean, target_vid: TyVid, v: Variance, source_ty: Ty): RelateResult<null> {
    this.log.push(`instantiate_ty_var(${target_is_expected}, ${target_vid}, ${v}, ${source_ty === t.bool ? "bool" : "?"})`);
    return Ok(null);
  }
  instantiate_int_var_raw(vid: IntVid, value: { $: string; _0?: unknown }): void {
    this.log.push(`instantiate_int_var_raw(${vid}, ${value.$}(${String(value._0)}))`);
  }
  instantiate_float_var_raw(vid: FloatVid, value: { $: string; _0?: unknown }): void {
    this.log.push(`instantiate_float_var_raw(${vid}, ${value.$}(${String(value._0)}))`);
  }
  instantiate_const_var(_r: PredicateEmittingRelation, target_is_expected: boolean, target_vid: ConstVid): RelateResult<null> {
    this.log.push(`instantiate_const_var(${target_is_expected}, ${target_vid})`);
    return Ok(null);
  }
  set_tainted_by_errors(): void {
    this.log.push("set_tainted_by_errors");
  }
  shallow_resolve(ty: Ty): Ty {
    return ty;
  }
  shallow_resolve_const(ct: Const): Const {
    return ct;
  }
  deeply_resolve_ignoring_regions<T>(value: T): T {
    return value;
  }
  sub_regions(sub: Region, sup: Region): void {
    this.log.push(`sub_regions(${sub === tcx.lifetimes.re_static ? "'static" : "'?"}, ${sup === tcx.lifetimes.re_static ? "'static" : "'?"})`);
  }
  equate_regions(): void {
    this.log.push("equate_regions");
  }
}

// `impl inherent::Tys for &List<Ty>` (rustc_middle ty/sty.rs:2180, lane ty-sty) is not ported yet; `FnSig::inputs` /
// `output` need it: upstream's two one-liners (`split_last().unwrap()`).
const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies.push(spyOn(RawList.prototype as unknown as { inputs(): readonly Ty[] }, "inputs").mockImplementation(function (this: readonly Ty[]) {
    return this.slice(0, this.length - 1);
  }));
  spies.push(spyOn(RawList.prototype as unknown as { output(): Ty }, "output").mockImplementation(function (this: readonly Ty[]) {
    return this[this.length - 1]!;
  }));
  // `TyCtxt::features` needs a session; these relations run without `generic_const_exprs`.
  spies.push(spyOn(TyCtxt.prototype, "features").mockImplementation(() => ({ generic_const_exprs: () => false }) as unknown as ReturnType<TyCtxt["features"]>));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

// ---- error.rs / lib.rs helpers --------------------------------------------------------------------------------------

describe("error.rs", () => {
  test("ExpectedFound::new and the TypeError predicates", () => {
    expect(ExpectedFound.new(1, 2)).toEqual({ expected: 1, found: 2 });
    expect(TypeError.involves_regions(TypeError.RegionsPlaceholderMismatch)).toBe(true);
    expect(TypeError.involves_regions(TypeError.Mismatch)).toBe(false);
    expect(TypeError.must_include_note({ $: "Sorts", _0: ExpectedFound.new(t.bool, t.char) })).toBe(false);
    expect(TypeError.must_include_note(TypeError.ArgCount)).toBe(true);
    expect(TypeError.must_include_note({ $: "TargetFeatureCast", _0: def(1) })).toBe(false);
    expect(NoSolution_from_TypeError(TypeError.Mismatch)).toEqual({});
    expect(NoSolutionOrRerunNonErased_from_TypeError(TypeError.Mismatch)).toEqual({ $: "NoSolution", _0: {} });
  });

  test("VarianceDiagInfo::xform keeps the first Invariant; Variance::xform is the PLDI'11 table", () => {
    const inv: VarianceDiagInfo = { $: "Invariant", ty: t.bool, param_index: 1 };
    expect(VarianceDiagInfo.xform(VarianceDiagInfo.None, inv)).toBe(inv);
    expect(VarianceDiagInfo.xform(inv, VarianceDiagInfo.None)).toBe(inv);
    const vs = [Variance.Covariant, Variance.Contravariant, Variance.Invariant, Variance.Bivariant];
    const table = vs.map((a) => vs.map((b) => Variance_xform(a, b)).join(" "));
    expect(table).toEqual([
      "Covariant Contravariant Invariant Bivariant",
      "Contravariant Covariant Invariant Bivariant",
      "Invariant Invariant Invariant Invariant",
      "Bivariant Bivariant Bivariant Bivariant",
    ]);
  });
});

// ---- relate.rs ------------------------------------------------------------------------------------------------------

describe("structurally_relate_tys", () => {
  const rel = new StructRelation();

  test("equal leaves relate to themselves; different leaves are Sorts", () => {
    for (const ty of [t.bool, t.char, t.i32, t.u8, t.f64, t.str_, t.never]) {
      expect(structurally_relate_tys(rel, ty, ty)).toEqual(Ok(ty));
    }
    expect(structurally_relate_tys(rel, t.bool, t.char)).toEqual(sorts(t.bool, t.char));
    expect(structurally_relate_tys(rel, t.i32, t.i64)).toEqual(sorts(t.i32, t.i64));
    expect(structurally_relate_tys(rel, t.i32, t.u32)).toEqual(sorts(t.i32, t.u32));
  });

  test("params relate by index", () => {
    expect(structurally_relate_tys(rel, param(0), param(0))).toEqual(Ok(param(0)));
    expect(structurally_relate_tys(rel, param(0), param(1))).toEqual(sorts(param(0), param(1)));
    expect(structurally_relate_tys(rel, param(0), t.bool)).toEqual(sorts(param(0), t.bool));
  });

  test("placeholders relate by value", () => {
    const ph = (u: number) =>
      tcx.mk_ty_from_kind({ $: "Placeholder", _0: { universe: u as UniverseIndex, bound: { var: 0 as BoundVar, kind: { $: "Anon" } }, _tcx: undefined } });
    expect(structurally_relate_tys(rel, ph(1), ph(1))).toEqual(Ok(ph(1)));
    expect(structurally_relate_tys(rel, ph(1), ph(2))).toEqual(sorts(ph(1), ph(2)));
  });

  test("raw pointers: mutability mismatch, then the pointee under the pointer's variance", () => {
    expect(structurally_relate_tys(rel, ptr(t.bool, "Not"), ptr(t.bool, "Mut"))).toEqual(Err(TypeError.Mutability));
    rel.calls = [];
    // `*const bool` vs `*const char`: Covariant, no diag info; the pointee mismatch propagates.
    expect(structurally_relate_tys(rel, ptr(t.bool, "Not"), ptr(t.char, "Not"))).toEqual(sorts(t.bool, t.char));
    expect(rel.calls).toEqual([[Variance.Covariant, VarianceDiagInfo.None]]);
    rel.calls = [];
    // `*mut bool` vs `*mut char`: Invariant with `Invariant { ty: a, param_index: 0 }`.
    const a = ptr(t.bool, "Mut");
    expect(structurally_relate_tys(rel, a, ptr(t.char, "Mut"))).toEqual(sorts(t.bool, t.char));
    expect(rel.calls).toEqual([[Variance.Invariant, { $: "Invariant", ty: a, param_index: 0 }]]);
    // Rebuilding the pointer needs `Ty::new_ptr` (rustc_middle ty/sty.rs, lane ty-sty).
    expect(() => structurally_relate_tys(rel, ptr(t.bool, "Not"), ptr(t.bool, "Not"))).toThrow(Unported);
  });

  test("tuples: TupleSize when both are non-empty, Sorts when one is empty", () => {
    expect(structurally_relate_tys(rel, tup(t.bool, t.char), tup(t.bool))).toEqual(Err({ $: "TupleSize", _0: ExpectedFound.new(2, 1) }));
    expect(structurally_relate_tys(rel, t.unit, tup(t.bool))).toEqual(sorts(t.unit, tup(t.bool)));
    // Equal lengths rebuild the tuple through `Ty::new_tup_from_iter` (lane ty-sty).
    expect(() => structurally_relate_tys(rel, tup(t.bool), tup(t.char))).toThrow(Unported);
  });

  test("inference and bound variables are the caller's job", () => {
    expect(() => structurally_relate_tys(rel, ty_var(0), t.bool)).toThrow(new Panic("var types encountered in structurally_relate_tys"));
    expect(() => structurally_relate_tys(rel, t.bool, int_var(0))).toThrow(new Panic("var types encountered in structurally_relate_tys"));
    const bound = tcx.mk_ty_from_kind({ $: "Bound", _0: { $: "Canonical" }, _1: { var: 0 as BoundVar, kind: { $: "Anon" } } });
    expect(() => structurally_relate_tys(rel, bound, t.bool)).toThrow(new Panic("bound types encountered in structurally_relate_tys"));
  });

  test("foreign types relate by DefId", () => {
    const f = (i: number) => tcx.mk_ty_from_kind({ $: "Foreign", _0: def(i) });
    expect(structurally_relate_tys(rel, f(1), f(2))).toEqual(sorts(f(1), f(2)));
    expect(() => structurally_relate_tys(rel, f(1), f(1))).toThrow(Unported); // `Ty::new_foreign`
    expect(() => structurally_relate_tys(rel, t.bool, tcx.mk_ty_from_kind({ $: "Error", _0: guar }))).toThrow(Unported); // `Ty::new_error`
  });
});

describe("relate_args_*", () => {
  test("invariant args: equal lists intern to the same list; the first mismatch stops the iteration", () => {
    const rel = new StructRelation();
    const a = args(t.bool, t.char);
    expect(relate_args_invariantly(rel, a, args(t.bool, t.char))).toEqual(Ok(a));
    expect(rel.calls).toEqual([
      [Variance.Invariant, VarianceDiagInfo.None],
      [Variance.Invariant, VarianceDiagInfo.None],
    ]);
    rel.calls = [];
    expect(relate_args_invariantly(rel, args(t.u8, t.char), args(t.bool, t.bool))).toEqual(sorts(t.u8, t.bool));
    expect(rel.calls.length).toBe(1);
  });

  test("with variances: one variance per argument", () => {
    const rel = new StructRelation();
    const a = args(t.bool, t.char);
    expect(relate_args_with_variances(rel, [Variance.Covariant, Variance.Bivariant], a, a)).toEqual(Ok(a));
    expect(rel.calls.map((c) => c[0])).toEqual([Variance.Covariant, Variance.Bivariant]);
  });
});

describe("Relate impls", () => {
  const sig = (io: Ty[], kind = FnSigKind.dummy()): FnSig => ({ inputs_and_output: tcx.mk_type_list(io), fn_sig_kind: kind });
  const kind = (abi: ExternAbi, safety: "Safe" | "Unsafe", c_variadic: boolean): FnSigKind => {
    const r = FnSigKind.new(abi, safety, c_variadic, undefined, 0);
    if (r.$ === "Err") throw new Error("bad FnSigKind");
    return r._0;
  };

  test("FnSig: header mismatches, ArgCount, ArgumentSorts by index, success", () => {
    const rel = new StructRelation();
    expect(relate_FnSig.relate(rel, sig([t.unit], kind(ExternAbi.C(false), "Unsafe", true)), sig([t.unit], kind(ExternAbi.C(false), "Unsafe", false)))).toEqual(
      Err({ $: "VariadicMismatch", _0: ExpectedFound.new(true, false) }),
    );
    expect(relate_FnSig.relate(rel, sig([t.unit]), sig([t.unit], FnSigKind.default_()))).toEqual(Err({ $: "SafetyMismatch", _0: ExpectedFound.new<"Safe" | "Unsafe">("Safe", "Unsafe") }));
    const r = relate_FnSig.relate(rel, sig([t.unit]), sig([t.unit], kind(ExternAbi.C(false), "Safe", false)));
    expect(r.$ === "Err" && r._0.$).toBe("AbiMismatch");
    expect(relate_FnSig.relate(rel, sig([t.bool, t.unit]), sig([t.unit]))).toEqual(Err(TypeError.ArgCount));
    // inputs are related contravariantly, the output covariantly (plain `relate`).
    rel.calls = [];
    expect(relate_FnSig.relate(rel, sig([t.bool, t.char, t.unit]), sig([t.bool, t.u8, t.unit]))).toEqual(
      Err({ $: "ArgumentSorts", _0: ExpectedFound.new(t.char, t.u8), _1: 1 }),
    );
    expect(rel.calls).toEqual([
      [Variance.Contravariant, VarianceDiagInfo.None],
      [Variance.Contravariant, VarianceDiagInfo.None],
    ]);
    expect(relate_FnSig.relate(rel, sig([t.bool, t.unit]), sig([t.bool, t.never]))).toEqual(Err({ $: "ArgumentSorts", _0: ExpectedFound.new(t.unit, t.never), _1: 1 }));
    expect(relate_FnSig.relate(rel, sig([ptr(t.bool, "Mut"), t.unit]), sig([ptr(t.bool, "Not"), t.unit]))).toEqual(Err({ $: "ArgumentMutability", _0: 0 }));
    const s = sig([t.bool, t.unit]);
    expect(relate_FnSig.relate(rel, s, sig([t.bool, t.unit]))).toEqual(Ok(s));
  });

  test("TraitRef: different traits are a Traits error; AliasTy: different kinds are ProjectionMismatched", () => {
    const rel = new StructRelation();
    expect(relate_TraitRef.relate(rel, trait_ref(def(1)), trait_ref(def(2)))).toEqual(Err({ $: "Traits", _0: ExpectedFound.new(def(1), def(2)) }));
    const alias = (k: "Projection" | "Opaque", i: number) => ({ kind: { $: k, def_id: def(i) }, args: tcx.mk_args([]), _use_alias_new_instead: null });
    expect(relate_AliasTy.relate(rel, alias("Projection", 1), alias("Opaque", 1))).toEqual(
      Err({ $: "ProjectionMismatched", _0: ExpectedFound.new<AliasTermKind>({ $: "ProjectionTy", def_id: def(1) }, { $: "OpaqueTy", def_id: def(1) }) }),
    );
  });

  test("Binder: equality by value and bound vars; relate goes through `binders`", () => {
    const d = relate_Binder(relate_Ty);
    expect(d.eq(no_vars(t.bool), no_vars(t.bool))).toBe(true);
    expect(d.eq(no_vars(t.bool), no_vars(t.char))).toBe(false);
    const rel = new StructRelation();
    expect(d.relate(rel, no_vars(t.bool), no_vars(t.char))).toEqual(sorts(t.bool, t.char));
  });
});

describe("structurally_relate_consts", () => {
  test("params by index; errors win; inference variables are the caller's job", () => {
    const rel = new StructRelation();
    expect(structurally_relate_consts(rel, ct_param(0), ct_param(0))).toEqual(Ok(ct_param(0)));
    expect(structurally_relate_consts(rel, ct_param(0), ct_param(1))).toEqual(Err({ $: "ConstMismatch", _0: ExpectedFound.new(ct_param(0), ct_param(1)) }));
    const err = tcx.mk_ct_from_kind({ $: "Error", _0: guar });
    expect(structurally_relate_consts(rel, err, ct_param(1))).toEqual(Ok(err));
    expect(structurally_relate_consts(rel, ct_param(1), err)).toEqual(Ok(err));
    // the panic message formats both consts with `{:?}` (`Debug for Const` is not ported yet).
    expect(() => structurally_relate_consts(rel, ct_var(0), ct_param(1))).toThrow(Unported);
    expect(relate_Const.relate(rel, ct_param(2), ct_param(2))).toEqual(Ok(ct_param(2)));
  });
});

// ---- combine.rs / solver_relating.rs -------------------------------------------------------------------------------

describe("SolverRelating", () => {
  const solver = (v: Variance, infcx = new RecordingInfcx()) => [SolverRelating.new(infcx, v, {} as never, DUMMY_SP), infcx] as const;

  test("equal types short-circuit; structural mismatches are Sorts", () => {
    const [r, infcx] = solver(Variance.Covariant);
    expect(r.tys(t.bool, t.bool)).toEqual(Ok(t.bool));
    expect(r.tys(t.bool, t.char)).toEqual(sorts(t.bool, t.char));
    expect(infcx.log).toEqual([]);
    expect(r.goals).toEqual([]);
  });

  test("int / float variables go through super_combine_tys", () => {
    const [r, infcx] = solver(Variance.Covariant);
    expect(r.tys(int_var(1), t.i32)).toEqual(Ok(int_var(1)));
    expect(r.tys(t.u8, int_var(2))).toEqual(Ok(t.u8));
    expect(r.tys(int_var(3), int_var(4))).toEqual(Ok(int_var(3)));
    expect(r.tys(float_var(5), t.f32)).toEqual(Ok(float_var(5)));
    expect(r.tys(float_var(6), float_var(7))).toEqual(Ok(float_var(6)));
    expect(infcx.log).toEqual([
      "instantiate_int_var_raw(1, IntType(I32))",
      "instantiate_int_var_raw(2, UintType(U8))",
      "equate_int_vids_raw(3, 4)",
      "instantiate_float_var_raw(5, Known(F32))",
      "equate_float_vids_raw(6, 7)",
    ]);
    // An int variable against a non-integer is an error.
    expect(r.tys(int_var(1), t.bool)).toEqual(sorts(int_var(1), t.bool));
  });

  test("type variables: equate when invariant, instantiate otherwise (with the flipped variance on the right)", () => {
    const [inv, infcx1] = solver(Variance.Invariant);
    expect(inv.tys(ty_var(1), ty_var(2))).toEqual(Ok(ty_var(1)));
    expect(infcx1.log).toEqual(["equate_ty_vids_raw(1, 2)"]);

    const [co, infcx2] = solver(Variance.Covariant);
    expect(co.tys(ty_var(3), t.bool)).toEqual(Ok(ty_var(3)));
    expect(co.tys(t.bool, ty_var(4))).toEqual(Ok(t.bool));
    expect(infcx2.log).toEqual(["instantiate_ty_var(true, 3, Covariant, bool)", "instantiate_ty_var(false, 4, Contravariant, bool)"]);
    // Two type variables under co-/contravariance record a `Subtype` goal (`Binder::dummy`, lane tyir-binder).
    expect(() => co.tys(ty_var(5), ty_var(6))).toThrow(Unported);
  });

  test("relate_with_variance composes and restores the ambient variance; bivariance is a no-op", () => {
    const [r, infcx] = solver(Variance.Contravariant);
    expect(r.relate_with_variance(Variance.Contravariant, VarianceDiagInfo.None, ty_var(1), t.bool, relate_Ty)).toEqual(Ok(ty_var(1)));
    expect(r.ambient_variance).toBe(Variance.Contravariant);
    expect(infcx.log).toEqual(["instantiate_ty_var(true, 1, Covariant, bool)"]);
    expect(r.relate_with_variance(Variance.Bivariant, VarianceDiagInfo.None, t.bool, t.char, relate_Ty)).toEqual(Ok(t.bool));
  });

  test("regions follow the ambient variance", () => {
    const s = tcx.lifetimes.re_static;
    const v = tcx.intern_re_var(3 as RegionVid);
    const [co, i1] = solver(Variance.Covariant);
    expect(co.regions(s, v)).toEqual(Ok(s));
    expect(i1.log).toEqual(["sub_regions('?, 'static)"]);
    const [contra, i2] = solver(Variance.Contravariant);
    contra.regions(s, v);
    expect(i2.log).toEqual(["sub_regions('static, '?)"]);
    const [inv, i3] = solver(Variance.Invariant);
    inv.regions(s, v);
    expect(i3.log).toEqual(["equate_regions"]);
    expect(co.span()).toBe(DUMMY_SP);
  });

  test("consts: equal short-circuit, variables equate or instantiate", () => {
    const [r, infcx] = solver(Variance.Invariant);
    expect(r.consts(ct_param(0), ct_param(0))).toEqual(Ok(ct_param(0)));
    expect(r.consts(ct_var(1), ct_var(2))).toEqual(Ok(ct_var(1)));
    expect(r.consts(ct_var(3), ct_param(0))).toEqual(Ok(ct_param(0)));
    expect(r.consts(ct_param(0), ct_var(4))).toEqual(Ok(ct_param(0)));
    expect(infcx.log).toEqual(["equate_const_vids_raw(1, 2)", "instantiate_const_var(true, 3)", "instantiate_const_var(false, 4)"]);
    expect(r.consts(ct_param(0), ct_param(1))).toEqual(Err({ $: "ConstMismatch", _0: ExpectedFound.new(ct_param(0), ct_param(1)) }));
  });

  test("binders: equal binders short-circuit", () => {
    const [r] = solver(Variance.Covariant);
    const b = no_vars(t.bool);
    expect(r.binders(b, no_vars(t.bool), relate_Ty)).toEqual(Ok(b));
    // Otherwise `Binder::no_bound_vars` (lane tyir-binder) decides the path.
    expect(() => r.binders(b, no_vars(t.char), relate_Ty)).toThrow(Unported);
  });

  test("RelateExt::relate returns the goals of a successful relation", () => {
    const infcx = new RecordingInfcx();
    expect(RelateExt_for_Infcx.relate(infcx, {} as never, int_var(1), Variance.Invariant, t.i32, DUMMY_SP, relate_Ty)).toEqual(Ok([]));
    expect(RelateExt_for_Infcx.relate(infcx, {} as never, t.bool, Variance.Invariant, t.i32, DUMMY_SP, relate_Ty)).toEqual(sorts(t.bool, t.i32));
    expect(infcx.log).toEqual(["instantiate_int_var_raw(1, IntType(I32))"]);
  });

  test("relate_ty_args in an invariant context relates the args invariantly and keeps a", () => {
    const [r] = solver(Variance.Invariant);
    const a_ty = tup(t.bool);
    expect(r.relate_ty_args(a_ty, tup(t.char), def(1), args(t.bool), args(t.bool), () => t.never)).toEqual(Ok(a_ty));
    expect(r.relate_ty_args(a_ty, tup(t.char), def(1), args(t.bool), args(t.char), () => t.never)).toEqual(sorts(t.bool, t.char));
  });

  test("combine_ty_args: diag info per variance; unchanged args keep a_ty", () => {
    const infcx = new RecordingInfcx();
    const calls: [Variance, VarianceDiagInfo][] = [];
    const [r] = solver(Variance.Covariant, infcx);
    const recording = Object.assign(Object.create(r) as SolverRelating, {
      relate_with_variance<T>(v: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
        calls.push([v, info]);
        return SolverRelating.prototype.relate_with_variance.call(r, v, info, a, b, d) as RelateResult<T>;
      },
    });
    const a_ty = tup(t.bool, t.char);
    let made = 0;
    const mk = (): Ty => {
      made++;
      return t.never;
    };
    expect(combine_ty_args(infcx, recording, a_ty, a_ty, [Variance.Covariant, Variance.Invariant], args(t.bool, t.char), args(t.bool, t.char), mk)).toEqual(Ok(a_ty));
    expect(calls).toEqual([
      [Variance.Covariant, VarianceDiagInfo.None],
      [Variance.Invariant, { $: "Invariant", ty: a_ty, param_index: 1 }],
    ]);
    expect(made).toBe(0);
    expect(combine_ty_args(infcx, recording, a_ty, a_ty, [Variance.Covariant, Variance.Invariant], args(t.bool, t.char), args(t.bool, t.u8), mk)).toEqual(sorts(t.char, t.u8));
  });
});

// ---- outlives.rs ----------------------------------------------------------------------------------------------------

describe("outlives", () => {
  test("OutlivesCollector::visit_ty: params, placeholders and inference variables are components; leaves are trivial", () => {
    const out: Component[] = [];
    const c = new OutlivesCollector(tcx, out, new Set());
    c.visit_ty(param(0));
    c.visit_ty(param(0)); // visited: pushed once
    c.visit_ty(t.bool);
    c.visit_ty(int_var(3));
    expect(out).toEqual([
      { $: "Param", _0: { index: 0, name: kw.SelfUpper } },
      { $: "UnresolvedInferenceVariable", _0: { $: "IntVar", _0: 3 as IntVid } },
    ]);
    // Structural types descend with `Ty::super_visit_with` (lane tyir-binder).
    expect(() => c.visit_ty(tup(t.bool))).toThrow(Unported);
  });

  test("OutlivesCollector::visit_region skips bound regions", () => {
    const out: Component[] = [];
    const c = new OutlivesCollector(tcx, out, new Set());
    // `Region::is_bound` (sty/mod.rs:140) is `matches!(self.kind(), ReBound(..))`.
    const spy = spyOn(Region.prototype, "is_bound").mockImplementation(function (this: Region) {
      return this.kind().$ === "ReBound";
    });
    try {
      c.visit_region(tcx.lifetimes.re_static);
      c.visit_region(tcx.intern_bound_region(0 as never, { var: 0 as BoundVar, kind: { $: "Anon" } }));
    } finally {
      spy.mockRestore();
    }
    expect(out).toEqual([{ $: "Region", _0: tcx.lifetimes.re_static }]);
  });

  test("push_outlives_components starts with `Ty::visit_with` (structural_impls.rs, not ported yet)", () => {
    expect(() => push_outlives_components(tcx, param(0), [])).toThrow(Unported);
  });
});

// ---- elaborate.rs ---------------------------------------------------------------------------------------------------

describe("elaborate", () => {
  // Mocks of rustc_middle stubs with their upstream bodies (ty/predicate.rs, ty/fold.rs):
  // - `Predicate::as_clause`: `Some(self.expect_clause())` for `PredicateKind::Clause`, else `None`;
  // - `Predicate::expect_clause`: the `Clause` twin;
  // - `Clause::kind`: the binder mapped to its `ClauseKind`;
  // - `Clause::as_trait_clause`: `Some(binder)` for `ClauseKind::Trait`;
  // - `TyCtxt::anonymize_bound_vars`: the identity for a binder without bound vars;
  // - `Clause::instantiate_supertrait`: the clause itself for a supertrait clause without generics or bound vars.
  const mocks: { mockRestore(): void }[] = [];
  beforeAll(() => {
    const P = Predicate.prototype as unknown as Record<string, unknown>;
    const C = Clause.prototype as unknown as Record<string, unknown>;
    mocks.push(spyOn(P as { as_clause(): Clause | undefined }, "as_clause").mockImplementation(function (this: Predicate) {
      return this.kind().value.$ === "Clause" ? Clause.of(this) : undefined;
    }));
    mocks.push(spyOn(P as { expect_clause(): Clause }, "expect_clause").mockImplementation(function (this: Predicate) {
      return Clause.of(this);
    }));
    mocks.push(spyOn(C as { kind(): Binder<ClauseKind> }, "kind").mockImplementation(function (this: Clause) {
      const k = this.as_predicate().kind();
      if (k.value.$ !== "Clause") throw new Error("unreachable");
      return { value: k.value._0, bound_vars: k.bound_vars };
    }));
    mocks.push(spyOn(C as { as_trait_clause(): unknown }, "as_trait_clause").mockImplementation(function (this: Clause) {
      const k = (this as unknown as { kind(): Binder<ClauseKind> }).kind();
      return k.value.$ === "Trait" ? { value: k.value._0, bound_vars: k.bound_vars } : undefined;
    }));
    mocks.push(spyOn(C as { instantiate_supertrait(): Clause }, "instantiate_supertrait").mockImplementation(function (this: Clause) {
      return this;
    }));
    mocks.push(spyOn(TyCtxt.prototype, "anonymize_bound_vars").mockImplementation(<T>(b: Binder<T>) => b));
    mocks.push(spyOn(TyCtxt.prototype as unknown as { is_trait_lang_item(): boolean }, "is_trait_lang_item").mockImplementation(() => false));
  });
  afterAll(() => {
    for (const m of mocks) m.mockRestore();
  });

  test("obligations are deduplicated and popped LIFO; non-clauses elaborate to nothing", () => {
    const p1 = pred({ $: "Ambiguous" });
    const p2 = pred({ $: "DynCompatible", _0: def(7) });
    const wf = pred({ $: "Clause", _0: { $: "WellFormed", _0: t.bool } });
    const e = elaborate(tcx, [p1, p2, p1, wf], { predicate: (p) => p, child: (_p, c) => c.as_predicate(), child_with_derived_cause: (_p, c) => c.as_predicate() });
    expect(e.size_hint()).toEqual([3, undefined]);
    expect([...e]).toEqual([wf, p2, p1]);
    expect(e.next()).toBeUndefined();
  });

  test("supertrait_def_ids walks explicit super clauses depth-first, each trait once", () => {
    // trait A: B {}  trait B: C + A {}  trait C {}
    const [A, B, C] = [def(10), def(11), def(12)];
    const supers = new Map([
      [A.index as number, [B]],
      [B.index as number, [C, A]],
      [C.index as number, []],
    ]);
    const spy = spyOn(TyCtxt.prototype, "explicit_super_clauses_of").mockImplementation(((d: DefId) => ({
      value: supers.get(d.index)!.map((s) => [Clause.of(trait_pred(s)), DUMMY_SP] as [Clause, Span]),
      _tcx: undefined,
    })) as never);
    try {
      expect([...supertrait_def_ids(tcx, A)].map((d) => d.index)).toEqual([A.index, B.index, C.index]);
      // `supertraits` elaborates `A` with `filter_only_self` and keeps the trait clauses.
      const traits = [...supertraits(tcx, no_vars(trait_ref(A)))].map((b) => b.value.def_id.index);
      expect(traits).toEqual([A.index, B.index, C.index]);
    } finally {
      spy.mockRestore();
    }
  });

  test("elaborate_outlives_assumptions collects each assumption once; regions elaborate to nothing", () => {
    const s = tcx.lifetimes.re_static;
    const v = tcx.intern_re_var(1 as RegionVid);
    const a1 = { _0: GenericArg.from_Region(v), _1: s };
    const set = elaborate_outlives_assumptions(tcx, [a1, { _0: GenericArg.from_Region(v), _1: s }, { _0: GenericArg.from_Region(s), _1: v }]);
    expect([...set]).toEqual([a1, { _0: GenericArg.from_Region(s), _1: v }]);
    // A type argument is decomposed with `push_outlives_components` (needs `Ty::visit_with`).
    expect(() => elaborate_outlives_assumptions(tcx, [{ _0: GenericArg.from_Ty(param(0)), _1: s }])).toThrow(Unported);
  });

  test("Elaboratable for Clause is the identity on clauses", () => {
    const c = Clause.of(trait_pred(def(3)));
    expect(Elaboratable_Clause.predicate(c)).toBe(c.as_predicate());
    expect(Elaboratable_Clause.child(c, c)).toBe(c);
  });
});

