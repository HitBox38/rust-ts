// Lane tyir-binder: binder.rs (Binder, EarlyBinder, ArgFolder / instantiate, the iterators, the manual Debug impls),
// fold.rs (container impls, Shifter / shift_vars, RegionFolder / fold_regions, the rigidness folders), visit.rs
// (TypeVisitableExt, HasTypeFlags / HasEscapingVars / HasError visitors), walk.rs (TypeWalker), generic_visit.rs and
// rustc_middle ty/fold.rs (BoundVarReplacer, BottomUpFolder), on interned types.
//
// The expectations follow upstream semantics (De Bruijn shifting, instantiation, flag queries, pre-order walk with
// dedup); the Debug strings are the `write!` formats of binder.rs's manual impls.
//
// Mocked dependencies (other lanes' stubs, with upstream's logic for the cases these tests build):
// - `Region::flags` / `outer_exclusive_binder` / `type_flags` (rustc_type_ir sty/mod.rs:199-:269) and `Region::new_bound`
//   (interning `ReBound`), `Ty::new_bound` (rustc_middle ty/sty.rs, interning `Bound`);
// - `fold_Region`'s `TypeVisitable` / `TypeFoldable` one-liners (sty/mod.rs:296-:309);
// - the `TypeSuper*` impls of `Ty` (rustc_middle ty/structural_impls.rs:330-:440) for the kinds used here
//   (`RawPtr`, `Slice`, `Tuple`, `Ref`, `FnPtr`, `Error`, leaves), installed on structural_impls.ts's `fold_Ty`
//   (its `Tuple` arm reaches the `&List<Ty>` fold of lane ty-args).
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { type ControlFlow, ControlFlow as ControlFlowC, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type Clauses, RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { create_default_session_globals_then, ErrorGuaranteed } from "../rustc_span/lib.ts";
import { kw, Symbol as Sym } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  Binder,
  BoundConst,
  BoundRegion,
  BoundRegionKind,
  BoundTy,
  BoundVariableKind,
  debug_BoundRegion,
  debug_BoundRegionKind,
  debug_BoundTy,
  debug_Placeholder,
  EarlyBinder,
  fold_Binder,
  PlaceholderRegion,
  PlaceholderType,
  ValidateBoundVars,
  visit_Binder,
} from "./binder.ts";
import type { BoundVar, DebruijnIndex, UniverseIndex } from "./decls.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  fold_regions,
  fold_Vec,
  type PredicateProxy,
  set_aliases_to_rigid,
  shift_region,
  shift_vars,
  try_fold_with_Option,
  try_fold_with_tuple2,
  try_fold_with_Vec,
  type TypeFoldable,
  type TypeFolder,
} from "./fold.ts";
import { TypeFlags } from "./flags.ts";
import { generic_visit_with_HashMap, generic_visit_with_Option, generic_visit_with_Vec } from "./generic_visit.ts";
import { debug_BoundVar, INNERMOST } from "./lib.ts";
import { Region, fold_Region, type Const } from "./sty/mod.ts";
import type { FnSigTys, TyKind } from "./ty_kind.ts";
import { FnHeader } from "./ty_kind.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided, visit_with_Option, visit_with_Vec } from "./visit.ts";
import { TypeWalker } from "./walk.ts";
import { BottomUpFolder } from "../rustc_middle/ty/fold.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";

// ---- mocks (see the module comment) --------------------------------------------------------------------------------

const D = (n: number) => n as DebruijnIndex;
const V = (n: number) => n as BoundVar;
const U = (n: number) => n as UniverseIndex;

/** `impl TypeFoldable / TypeVisitable for FnSigTys` (derived) over `Tys` (`list_fold!` / `&List<T>` visit). */
const fold_FnSigTys: TypeFoldable<FnSigTys> = {
  visit_with<R>(self: FnSigTys, visitor: TypeVisitor<R>): R {
    for (const t of self.inputs_and_output) {
      const b = visitor.Result.branch(visitor.visit_ty(t));
      if (b.$ === "Break") return visitor.Result.from_residual(b._0);
    }
    return visitor.Result.output();
  },
  try_fold_with<E>(self: FnSigTys, folder: FallibleTypeFolder<E>): Result<FnSigTys, E> {
    const out: Ty[] = [];
    for (const t of self.inputs_and_output) {
      const r = folder.try_fold_ty(t);
      if (r.$ === "Err") return r;
      out.push(r._0);
    }
    return Ok({ inputs_and_output: folder.cx().mk_type_list(out) });
  },
  fold_with(self: FnSigTys, folder: TypeFolder): FnSigTys {
    return { inputs_and_output: folder.cx().mk_type_list(self.inputs_and_output.map((t) => folder.fold_ty(t))) };
  },
};

function ty_super_fold(t: Ty, folder: TypeFolder): Ty {
  const k = t.kind();
  let kind: TyKind;
  switch (k.$) {
    case "RawPtr":
      kind = { $: "RawPtr", _0: folder.fold_ty(k._0), _1: k._1 };
      break;
    case "Slice":
      kind = { $: "Slice", _0: folder.fold_ty(k._0) };
      break;
    case "Tuple":
      kind = { $: "Tuple", _0: folder.cx().mk_type_list(k._0.map((x) => folder.fold_ty(x))) };
      break;
    case "Ref":
      kind = { $: "Ref", _0: folder.fold_region(k._0), _1: folder.fold_ty(k._1), _2: k._2 };
      break;
    case "FnPtr":
      kind = { $: "FnPtr", _0: folder.fold_binder(k._0, fold_FnSigTys), _1: k._1 };
      break;
    default:
      return t;
  }
  return folder.cx().mk_ty_from_kind(kind);
}

function ty_try_super_fold<E>(t: Ty, folder: FallibleTypeFolder<E>): Result<Ty, E> {
  const k = t.kind();
  switch (k.$) {
    case "Tuple": {
      const out: Ty[] = [];
      for (const x of k._0) {
        const r = folder.try_fold_ty(x);
        if (r.$ === "Err") return r;
        out.push(r._0);
      }
      return Ok(folder.cx().mk_ty_from_kind({ $: "Tuple", _0: folder.cx().mk_type_list(out) }));
    }
    case "Slice": {
      const r = folder.try_fold_ty(k._0);
      if (r.$ === "Err") return r;
      return Ok(folder.cx().mk_ty_from_kind({ $: "Slice", _0: r._0 }));
    }
    default:
      return Ok(t);
  }
}

function ty_super_visit<R>(t: Ty, visitor: TypeVisitor<R>): R {
  const k = t.kind();
  const R_ = visitor.Result;
  switch (k.$) {
    case "RawPtr":
    case "Slice":
      return visitor.visit_ty(k._0);
    case "Tuple": {
      for (const x of k._0) {
        const b = R_.branch(visitor.visit_ty(x));
        if (b.$ === "Break") return R_.from_residual(b._0);
      }
      return R_.output();
    }
    case "Ref": {
      const b = R_.branch(visitor.visit_region(k._0));
      if (b.$ === "Break") return R_.from_residual(b._0);
      return visitor.visit_ty(k._1);
    }
    case "FnPtr":
      return visitor.visit_binder(k._0, fold_FnSigTys);
    case "Error":
      return visitor.visit_error(k._0);
    default:
      return R_.output();
  }
}

function region_type_flags(r: Region): TypeFlags {
  const k = r.kind();
  switch (k.$) {
    case "ReEarlyParam":
      return TypeFlags.union(TypeFlags.union(TypeFlags.HAS_FREE_REGIONS, TypeFlags.HAS_FREE_LOCAL_REGIONS), TypeFlags.HAS_RE_PARAM);
    case "ReStatic":
      return TypeFlags.HAS_FREE_REGIONS;
    case "ReBound":
      return k._0.$ === "Canonical" ? TypeFlags.union(TypeFlags.HAS_RE_BOUND, TypeFlags.HAS_CANONICAL_BOUND) : TypeFlags.HAS_RE_BOUND;
    case "ReErased":
      return TypeFlags.HAS_RE_ERASED;
    default:
      throw new Error(`test mock: region kind ${k.$}`);
  }
}

const restores: (() => void)[] = [];
function patch<O extends object, K extends keyof O>(o: O, k: K, v: O[K]): void {
  const old = o[k];
  (o as Record<K, O[K]>)[k] = v;
  restores.push(() => {
    (o as Record<K, O[K]>)[k] = old;
  });
}

beforeAll(() => {
  const RP = Region.prototype as unknown as { flags(): TypeFlags; type_flags(): TypeFlags; outer_exclusive_binder(): DebruijnIndex };
  const spies = [
    spyOn(RP, "type_flags").mockImplementation(function (this: Region) {
      return region_type_flags(this);
    }),
    spyOn(RP, "flags").mockImplementation(function (this: Region) {
      return region_type_flags(this);
    }),
    spyOn(RP, "outer_exclusive_binder").mockImplementation(function (this: Region) {
      const k = this.kind();
      return k.$ === "ReBound" && k._0.$ === "Bound" ? D(k._0._0 + 1) : INNERMOST;
    }),
    spyOn(Region, "new_bound").mockImplementation((tcx: TyCtxt, debruijn: DebruijnIndex, br: BoundRegion) =>
      tcx.intern_region({ $: "ReBound", _0: { $: "Bound", _0: debruijn }, _1: br }),
    ),
    spyOn(Ty, "new_bound").mockImplementation((tcx: TyCtxt, debruijn: DebruijnIndex, bt: BoundTy) =>
      tcx.mk_ty_from_kind({ $: "Bound", _0: { $: "Bound", _0: debruijn }, _1: bt }),
    ),
  ];
  for (const s of spies) restores.push(() => s.mockRestore());
  patch(fold_Region, "visit_with", (self, visitor) => visitor.visit_region(self));
  patch(fold_Region, "fold_with", (self, folder) => folder.fold_region(self));
  patch(fold_Region, "try_fold_with", (self, folder) => folder.try_fold_region(self));
  patch(fold_Ty, "super_fold_with", ty_super_fold);
  patch(fold_Ty, "try_super_fold_with", ty_try_super_fold);
  patch(fold_Ty, "super_visit_with", ty_super_visit);
});
afterAll(() => {
  for (const r of restores.reverse()) r();
});

// ---- helpers -------------------------------------------------------------------------------------------------------

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
const param = (index: number): Ty => tcx.mk_ty_from_kind({ $: "Param", _0: { index, name: kw.SelfUpper } });
const bound_ty = (debruijn: number, var_: number): Ty =>
  tcx.mk_ty_from_kind({ $: "Bound", _0: { $: "Bound", _0: D(debruijn) }, _1: { var: V(var_), kind: { $: "Anon" } } });
const tup = (...ts: Ty[]): Ty => tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(ts) });
const slice = (t: Ty): Ty => tcx.mk_ty_from_kind({ $: "Slice", _0: t });
const ref = (r: Region, t: Ty): Ty => tcx.mk_ty_from_kind({ $: "Ref", _0: r, _1: t, _2: "Not" });
const early_re = (index: number): Region => tcx.intern_region({ $: "ReEarlyParam", _0: { index, name: kw.UnderscoreLifetime } });
const bound_re = (debruijn: number, var_: number): Region =>
  tcx.intern_region({ $: "ReBound", _0: { $: "Bound", _0: D(debruijn) }, _1: { var: V(var_), kind: { $: "Anon" } } });
const no_vars = <T>(value: T): Binder<T> => ({ value, bound_vars: RawList.empty() });
const binder_ty = fold_Binder(fold_Ty);
const guar = ErrorGuaranteed.unchecked_error_guaranteed();

// ---- visit.rs ------------------------------------------------------------------------------------------------------

describe("TypeVisitableExt", () => {
  test("flag queries read the cached flags of types and regions", () => {
    const { bool, u8 } = tcx.types;
    expect(TypeVisitableExt.has_param(param(0), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_param(bool, fold_Ty)).toBe(false);
    expect(TypeVisitableExt.has_param(tup(bool, param(1)), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_non_region_param(ref(early_re(0), u8), fold_Ty)).toBe(false);
    expect(TypeVisitableExt.has_param(ref(early_re(0), u8), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_regions(ref(tcx.lifetimes.re_static, u8), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_free_regions(ref(bound_re(0, 0), u8), fold_Ty)).toBe(false);
    expect(TypeVisitableExt.has_bound_regions(ref(bound_re(0, 0), u8), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.is_global(param(0), fold_Ty)).toBe(false);
    expect(TypeVisitableExt.is_global(tup(bool, u8), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_bound_vars(bound_ty(0, 0), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_non_region_bound_vars(ref(bound_re(0, 0), u8), fold_Ty)).toBe(false);
    expect(TypeVisitableExt.references_error(tcx.mk_ty_from_kind({ $: "Error", _0: guar }), fold_Ty)).toBe(true);
    // A region visited directly (visit_region, no flags cache): `fold_Region` is the mocked one-liner.
    expect(TypeVisitableExt.has_free_regions(tcx.lifetimes.re_static, fold_Region)).toBe(true);
    expect(TypeVisitableExt.has_erased_regions(tcx.lifetimes.re_erased, fold_Region)).toBe(true);
  });

  test("HAS_BINDER_VARS is found on a binder's bound vars even if its value has none", () => {
    const vars = tcx.mk_bound_variable_kinds([{ $: "Ty", _0: { $: "Anon" } }]);
    const b: Binder<Ty> = { value: tcx.types.bool, bound_vars: vars };
    expect(TypeVisitableExt.has_type_flags(b, TypeFlags.HAS_BINDER_VARS, binder_ty)).toBe(true);
    expect(TypeVisitableExt.has_type_flags(no_vars(tcx.types.bool), TypeFlags.HAS_BINDER_VARS, binder_ty)).toBe(false);
  });

  test("escaping bound vars count the binders passed", () => {
    expect(TypeVisitableExt.has_escaping_bound_vars(bound_ty(0, 0), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_escaping_bound_vars(tcx.types.bool, fold_Ty)).toBe(false);
    // `for<> ^0` binds its var; `for<> ^1` escapes.
    expect(TypeVisitableExt.has_escaping_bound_vars(no_vars(bound_ty(0, 0)), binder_ty)).toBe(false);
    expect(TypeVisitableExt.has_escaping_bound_vars(no_vars(bound_ty(1, 0)), binder_ty)).toBe(true);
    expect(TypeVisitableExt.has_vars_bound_at_or_above(bound_ty(1, 0), D(1), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_vars_bound_at_or_above(bound_ty(1, 0), D(2), fold_Ty)).toBe(false);
    expect(TypeVisitableExt.has_vars_bound_above(bound_ty(1, 0), D(0), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_vars_bound_above(bound_ty(1, 0), D(1), fold_Ty)).toBe(false);
    // A region inside a type: `&'^0 u8` escapes, `for<> &'^0 u8` does not.
    expect(TypeVisitableExt.has_escaping_bound_vars(ref(bound_re(0, 0), tcx.types.u8), fold_Ty)).toBe(true);
    expect(TypeVisitableExt.has_escaping_bound_vars(no_vars(ref(bound_re(0, 0), tcx.types.u8)), binder_ty)).toBe(false);
  });

  test("error_reported finds the ErrorGuaranteed through the default visitor methods", () => {
    const err = tcx.mk_ty_from_kind({ $: "Error", _0: guar });
    expect(TypeVisitableExt.error_reported(tcx.types.bool, fold_Ty)).toEqual(Ok(null));
    expect(TypeVisitableExt.error_reported(tup(tcx.types.bool, slice(err)), fold_Ty)).toEqual(Err(guar));
    expect(TypeVisitableExt.non_region_error_reported(tup(err), fold_Ty)).toEqual(Err(guar));
  });

  test("the container impls short-circuit on Break and skip None", () => {
    const seen: Ty[] = [];
    class Collect implements TypeVisitor<ControlFlow<Ty>> {
      readonly Result = VisitorResult.ControlFlow<Ty>();
      visit_ty(t: Ty): ControlFlow<Ty> {
        seen.push(t);
        return t === tcx.types.u8 ? ControlFlowC.Break(t) : ControlFlowC.CONTINUE;
      }
      visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_binder(this, t, d);
      }
      visit_region(r: Region): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_region(this, r);
      }
      visit_const(c: Const): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_const(this, c);
      }
      visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_predicate(this, p, d);
      }
      visit_clauses(c: Clauses): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_clauses(this, c);
      }
      visit_error(g: ErrorGuaranteed): ControlFlow<Ty> {
        return TypeVisitor_provided.visit_error(this, g);
      }
    }
    const { bool, u8, char } = tcx.types;
    expect(visit_with_Vec([bool, u8, char], new Collect(), fold_Ty.visit_with)).toEqual(ControlFlowC.Break(u8));
    expect(seen).toEqual([bool, u8]);
    expect(visit_with_Option<Ty, ControlFlow<Ty>>(undefined, new Collect(), fold_Ty.visit_with)).toBe(ControlFlowC.CONTINUE);
    // `visit_binder`'s default visits the bound value.
    seen.length = 0;
    expect(binder_ty.visit_with(no_vars(char), new Collect())).toBe(ControlFlowC.CONTINUE);
    expect(seen).toEqual([char]);
  });
});

// ---- fold.rs -------------------------------------------------------------------------------------------------------

/** A fallible folder that fails on `char` (all other methods default). */
class NoChar implements FallibleTypeFolder<string> {
  folded: Ty[] = [];
  cx(): TyCtxt {
    return tcx;
  }
  try_fold_ty(t: Ty): Result<Ty, string> {
    this.folded.push(t);
    if (t === tcx.types.char) return Err("char");
    return FallibleTypeFolder_provided.try_fold_ty(this, t);
  }
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, string> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }
  try_fold_region(r: Region): Result<Region, string> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }
  try_fold_const(c: Const): Result<Const, string> {
    return FallibleTypeFolder_provided.try_fold_const(this, c);
  }
  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, string> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }
  try_fold_clauses(c: Clauses): Result<Clauses, string> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

describe("fold.rs", () => {
  test("container impls: Vec stops at the first Err, tuples and Option fold in order", () => {
    const { bool, char, u8 } = tcx.types;
    const f = new NoChar();
    expect(try_fold_with_Vec([bool, char, u8], f, fold_Ty.try_fold_with)).toEqual(Err("char"));
    expect(f.folded).toEqual([bool, char]);
    expect(try_fold_with_Vec([bool, u8], new NoChar(), fold_Ty.try_fold_with)).toEqual(Ok([bool, u8]));
    expect(try_fold_with_tuple2([u8, char], new NoChar(), fold_Ty.try_fold_with, fold_Ty.try_fold_with)).toEqual(Err("char"));
    expect(try_fold_with_Option<Ty, string>(undefined, new NoChar(), fold_Ty.try_fold_with)).toEqual(Ok(undefined));
    // The default `try_fold_ty` recurses through `try_super_fold_with`.
    expect(fold_Ty.try_fold_with(tup(bool, slice(char)), new NoChar())).toEqual(Err("char"));
    expect(fold_Ty.try_fold_with(tup(bool, slice(u8)), new NoChar())).toEqual(Ok(tup(bool, slice(u8))));
  });

  test("shift_vars shifts only the vars bound outside the value", () => {
    const { u8 } = tcx.types;
    expect(shift_vars(tcx, bound_ty(0, 3), 2, fold_Ty)).toBe(bound_ty(2, 3));
    expect(shift_vars(tcx, tup(u8, bound_ty(1, 0)), 1, fold_Ty)).toBe(tup(u8, bound_ty(2, 0)));
    expect(shift_vars(tcx, ref(bound_re(0, 1), u8), 1, fold_Ty)).toBe(ref(bound_re(1, 1), u8));
    // Nothing escapes / amount 0: the value itself.
    const closed = tup(u8, param(0));
    expect(shift_vars(tcx, closed, 3, fold_Ty)).toBe(closed);
    expect(shift_vars(tcx, bound_ty(0, 0), 0, fold_Ty)).toBe(bound_ty(0, 0));
    // Under a binder: `for<> (^0, ^1)` shifted by 1 is `for<> (^0, ^2)`.
    const b = shift_vars(tcx, no_vars(tup(bound_ty(0, 0), bound_ty(1, 0))), 1, binder_ty);
    expect(b.value).toBe(tup(bound_ty(0, 0), bound_ty(2, 0)));
    // Through a fn pointer's own binder: `fn(&'^1 u8)` (inside its binder) becomes `fn(&'^2 u8)`.
    const sig = (r: Region) =>
      tcx.mk_ty_from_kind({ $: "FnPtr", _0: no_vars({ inputs_and_output: tcx.mk_type_list([ref(r, u8), tcx.types.unit]) }), _1: FnHeader.dummy() });
    expect(shift_vars(tcx, sig(bound_re(1, 0)), 1, fold_Ty)).toBe(sig(bound_re(2, 0)));
    expect(shift_vars(tcx, sig(bound_re(0, 0)), 1, fold_Ty)).toBe(sig(bound_re(0, 0)));
  });

  test("shift_region", () => {
    expect(shift_region(tcx, bound_re(0, 2), 3)).toBe(bound_re(3, 2));
    expect(shift_region(tcx, bound_re(1, 0), 0)).toBe(bound_re(1, 0));
    expect(shift_region(tcx, tcx.lifetimes.re_static, 2)).toBe(tcx.lifetimes.re_static);
  });

  test("fold_regions replaces the free regions and reports the binder depth", () => {
    const { u8 } = tcx.types;
    const depths: number[] = [];
    const to_static = (_r: Region, d: DebruijnIndex) => {
      depths.push(d);
      return tcx.lifetimes.re_static;
    };
    expect(fold_regions(tcx, tup(ref(early_re(0), u8), ref(bound_re(0, 0), u8)), to_static, fold_Ty)).toBe(
      tup(ref(tcx.lifetimes.re_static, u8), ref(tcx.lifetimes.re_static, u8)),
    );
    expect(depths).toEqual([0, 0]);
    // Under a binder, `'^0` is bound (kept) and `'^1` is free (folded, at depth 1).
    depths.length = 0;
    const b = fold_regions(tcx, no_vars(tup(ref(bound_re(0, 0), u8), ref(bound_re(1, 0), u8))), to_static, binder_ty);
    expect(b.value).toBe(tup(ref(bound_re(0, 0), u8), ref(tcx.lifetimes.re_static, u8)));
    expect(depths).toEqual([1]);
    // No regions: `fold_ty` returns the type without visiting it.
    const plain = tup(u8, param(0));
    expect(fold_regions(tcx, plain, to_static, fold_Ty)).toBe(plain);
  });

  test("the rigidness folders return values without aliases unchanged", () => {
    const t = tup(tcx.types.u8, param(0));
    expect(set_aliases_to_rigid(tcx, t, fold_Ty)).toBe(t);
    expect(EarlyBinder.bind(tcx, t, fold_Ty)).toEqual({ value: t, _tcx: undefined });
  });

  test("fold_Vec adapts the container impls to a descriptor", () => {
    const d = fold_Vec(fold_Ty);
    expect(shift_vars(tcx, [bound_ty(0, 0), tcx.types.u8], 1, d)).toEqual([bound_ty(1, 0), tcx.types.u8]);
  });
});

// ---- binder.rs -----------------------------------------------------------------------------------------------------

describe("Binder", () => {
  test("dummy / bind_with_vars / map_bound / rebind / no_bound_vars / transpose / iter", () => {
    const { u8, bool } = tcx.types;
    const b = Binder.dummy(u8, fold_Ty);
    expect(b.value).toBe(u8);
    expect(b.bound_vars).toBe(RawList.empty());
    expect(() => Binder.dummy(bound_ty(0, 0), fold_Ty)).toThrow(Unported);
    const vars = tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "Anon" } }]);
    const b2 = Binder.bind_with_vars(tup(u8), vars);
    expect(Binder.bound_vars(b2)).toBe(vars);
    expect(Binder.skip_binder(Binder.map_bound(b2, (t) => slice(t)))).toBe(slice(tup(u8)));
    expect(Binder.map_bound_ref(b2, (t) => t).bound_vars).toBe(vars);
    expect(Binder.rebind(b2, bool)).toEqual({ value: bool, bound_vars: vars });
    expect(Binder.try_map_bound(b2, () => Err("e"))).toEqual(Err("e"));
    expect(Binder.try_map_bound(b2, (t) => Ok(slice(t)))).toEqual(Ok({ value: slice(tup(u8)), bound_vars: vars }));
    expect(Binder.no_bound_vars(b2, fold_Ty)).toBe(tup(u8));
    expect(Binder.no_bound_vars(Binder.bind_with_vars(bound_ty(0, 0), vars), fold_Ty)).toBeUndefined();
    expect(Binder.transpose({ value: undefined, bound_vars: vars })).toBeUndefined();
    expect(Binder.transpose({ value: u8, bound_vars: vars })).toEqual({ value: u8, bound_vars: vars });
    expect([...Binder.iter({ value: [u8, bool], bound_vars: vars })]).toEqual([
      { value: u8, bound_vars: vars },
      { value: bool, bound_vars: vars },
    ]);
  });

  test("fold_Binder: the default fold_binder folds the bound value", () => {
    const f = new NoChar();
    expect(fold_Binder(fold_Ty).try_fold_with(no_vars(tcx.types.char), f)).toEqual(Err("char"));
    expect(visit_Binder(fold_Ty).super_visit_with).toBeDefined();
  });
});

describe("EarlyBinder::instantiate (ArgFolder)", () => {
  const { u8, i8, bool } = tcx.types;

  test("replaces type and region params", () => {
    const eb = EarlyBinder.bind_unchecked(tup(param(0), bool, param(1)));
    expect(EarlyBinder.instantiate(eb, tcx, [u8, i8], fold_Ty).value).toBe(tup(u8, bool, i8));
    const eb2 = EarlyBinder.bind_unchecked(ref(early_re(1), param(0)));
    expect(EarlyBinder.instantiate(eb2, tcx, [u8, tcx.lifetimes.re_static], fold_Ty).value).toBe(ref(tcx.lifetimes.re_static, u8));
    // No params: the value itself, not re-interned.
    const closed = tup(u8, bool);
    expect(EarlyBinder.instantiate(EarlyBinder.bind_unchecked(closed), tcx, [i8], fold_Ty).value).toBe(closed);
    expect(EarlyBinder.instantiate(EarlyBinder.bind_unchecked(closed), tcx, [], fold_Ty).value).toBe(closed);
  });

  test("args with escaping bound vars are shifted by the binders passed", () => {
    // `for<> (P0, &'R1 u8)` with P0 = ^0 and R1 = '^0: inside the binder both become ^1.
    const eb = EarlyBinder.bind_unchecked(no_vars(tup(param(0), ref(early_re(1), u8))));
    const out = EarlyBinder.instantiate(eb, tcx, [bound_ty(0, 0), bound_re(0, 0)], binder_ty).value;
    expect(out.value).toBe(tup(bound_ty(1, 0), ref(bound_re(1, 0), u8)));
    // Outside a binder they are not shifted.
    const eb2 = EarlyBinder.bind_unchecked(tup(param(0), ref(early_re(1), u8)));
    expect(EarlyBinder.instantiate(eb2, tcx, [bound_ty(0, 0), bound_re(0, 0)], fold_Ty).value).toBe(tup(bound_ty(0, 0), ref(bound_re(0, 0), u8)));
  });

  test("a missing or mismatched arg is an ICE; params with no args stop on the assert's Debug", () => create_default_session_globals_then(() => {
    // The panic messages print `ParamTy`'s Debug (structural_impls.rs, ported: it reads the symbol interner, hence the
    // session globals) and then `Ty`'s Debug through ty/mod.ts's `debug_Ty` stub (root repoints it at
    // structural_impls.ts's): UNPORTED.
    expect(() => EarlyBinder.instantiate(EarlyBinder.bind_unchecked(param(3)), tcx, [u8], fold_Ty)).toThrow(Unported);
    expect(() => EarlyBinder.instantiate(EarlyBinder.bind_unchecked(param(0)), tcx, [], fold_Ty)).toThrow(Unported);
    expect(() => EarlyBinder.instantiate(EarlyBinder.bind_unchecked(slice(param(0))), tcx, [], fold_Ty)).toThrow(Unported);
  }));

  test("no_bound_vars / instantiate_identity / iterators", () => {
    expect(EarlyBinder.no_bound_vars(EarlyBinder.bind_unchecked(param(0)), fold_Ty)).toBeUndefined();
    expect(EarlyBinder.no_bound_vars(EarlyBinder.bind_unchecked(u8), fold_Ty)).toBe(u8);
    expect(EarlyBinder.instantiate_identity(EarlyBinder.bind_unchecked(param(0))).value).toBe(param(0));
    expect(EarlyBinder.transpose(EarlyBinder.bind_unchecked<Ty | undefined>(undefined))).toBeUndefined();
    const it = EarlyBinder.iter_instantiated(EarlyBinder.bind_unchecked([param(0), bool, param(1)]), tcx, [u8, i8], fold_Ty);
    expect(it.size_hint()).toEqual([3, 3]);
    expect(it.next_back()?.value).toBe(i8);
    expect([...it].map((u) => u.value)).toEqual([u8, bool]);
    expect(it.next()).toBeUndefined();
    const c = EarlyBinder.iter_instantiated_copied(EarlyBinder.bind_unchecked([param(1)]), tcx, [u8, i8], fold_Ty);
    expect(c.clone().next()?.value).toBe(i8);
    expect(c.next()?.value).toBe(i8);
    expect(c.next()).toBeUndefined();
    const id = EarlyBinder.iter_identity_copied(EarlyBinder.bind_unchecked([param(1), u8]));
    expect([...id].map((u) => u.value)).toEqual([param(1), u8]);
    expect([...EarlyBinder.iter_identity(EarlyBinder.bind_unchecked([u8]))]).toEqual([{ value: u8, _tcx: undefined }]);
    expect([...EarlyBinder.transpose_iter(EarlyBinder.bind_unchecked([u8, bool]))]).toEqual([
      { value: u8, _tcx: undefined },
      { value: bool, _tcx: undefined },
    ]);
  });
});

describe("ValidateBoundVars", () => {
  test("checks the kinds of the vars bound by the innermost binder", () => {
    const tys = tcx.mk_bound_variable_kinds([{ $: "Ty", _0: { $: "Anon" } }]);
    const res = tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "Anon" } }]);
    expect(fold_Ty.visit_with(bound_ty(0, 0), ValidateBoundVars.new(tys))).toBe(ControlFlowC.CONTINUE);
    expect(() => fold_Ty.visit_with(bound_ty(0, 0), ValidateBoundVars.new(res))).toThrow(new Panic("expected a type, but found another kind"));
    expect(fold_Region.visit_with(bound_re(0, 0), ValidateBoundVars.new(res))).toBe(ControlFlowC.CONTINUE);
    expect(() => fold_Region.visit_with(bound_re(0, 0), ValidateBoundVars.new(tys))).toThrow(new Panic("expected a region, but found another kind"));
    // A var bound further out is not checked.
    expect(fold_Ty.visit_with(bound_ty(1, 0), ValidateBoundVars.new(res))).toBe(ControlFlowC.CONTINUE);
  });
});

describe("binder.rs manual Debug impls and small types", () => {
  test("Debug", () => create_default_session_globals_then(() => {
    const a = Sym.intern("a");
    expect(debug_BoundRegionKind({ $: "Anon" }, PLAIN)).toBe("BrAnon");
    expect(debug_BoundRegionKind({ $: "ClosureEnv" }, PLAIN)).toBe("BrEnv");
    expect(debug_BoundRegionKind({ $: "NamedForPrinting", _0: a }, PLAIN)).toBe('BrNamedForPrinting("a")');
    expect(debug_BoundRegion({ var: V(0), kind: { $: "Anon" } }, PLAIN)).toBe("0");
    expect(debug_BoundRegion({ var: V(2), kind: { $: "ClosureEnv" } }, PLAIN)).toBe("2.Env");
    expect(debug_BoundRegion({ var: V(1), kind: { $: "NamedForPrinting", _0: a } }, PLAIN)).toBe('1.NamedAnon("a")');
    expect(debug_BoundTy({ var: V(4), kind: { $: "Anon" } }, PLAIN)).toBe("4");
    expect(debug_Placeholder(PlaceholderType.new_anon(U(0), V(1)), PLAIN, debug_BoundTy)).toBe("!1");
    expect(debug_Placeholder(PlaceholderRegion.new_anon(U(3), V(0)), PLAIN, debug_BoundRegion)).toBe("!3_0");
    expect(debug_Placeholder({ universe: U(2), bound: V(5), _tcx: undefined }, PLAIN, debug_BoundVar)).toBe("!2_5");
  }));

  test("BoundVariableKind / BoundRegion / BoundConst / Placeholder helpers", () => {
    expect(BoundVariableKind.expect_region({ $: "Region", _0: BoundRegionKind.Anon })).toBe(BoundRegionKind.Anon);
    expect(() => BoundVariableKind.expect_ty(BoundVariableKind.Const)).toThrow(new Panic("expected a type, but found another kind"));
    expect(() => BoundVariableKind.expect_const({ $: "Ty", _0: { $: "Anon" } })).toThrow(new Panic("expected a const, but found another kind"));
    expect(() => BoundRegion.assert_eq({ var: V(0), kind: BoundRegionKind.Anon }, { $: "Region", _0: BoundRegionKind.ClosureEnv })).toThrow(
      new Panic("assertion `left == right` failed\n  left: BrAnon\n right: BrEnv"),
    );
    BoundRegion.assert_eq({ var: V(0), kind: BoundRegionKind.Anon }, { $: "Region", _0: { $: "Anon" } });
    BoundTy.assert_eq({ var: V(0), kind: { $: "Anon" } }, { $: "Ty", _0: { $: "Anon" } });
    BoundConst.assert_eq(BoundConst.new(V(1)), BoundVariableKind.Const);
    expect(BoundRegionKind.get_id(BoundRegionKind.Anon)).toBeUndefined();
    expect(BoundRegionKind.get_name({ $: "NamedForPrinting", _0: kw.SelfUpper }, tcx)).toBe(kw.SelfUpper);
    const p = PlaceholderRegion.new_anon(U(1), V(2));
    expect(PlaceholderRegion.var(p)).toBe(V(2));
    expect(PlaceholderRegion.universe(PlaceholderRegion.with_updated_universe(p, U(4)))).toBe(U(4));
  });
});

// ---- walk.rs -------------------------------------------------------------------------------------------------------

describe("TypeWalker", () => {
  test("pre-order, each subtree visited once, skip_current_subtree", () => {
    const { u8, bool } = tcx.types;
    const st = tcx.lifetimes.re_static;
    const root = tup(ref(st, u8), slice(u8), bool);
    const walked = [...TypeWalker.new(GenericArg.from_Ty(root))];
    expect(walked).toEqual([root, ref(st, u8), st, u8, slice(u8), bool]);
    const w = TypeWalker.new(GenericArg.from_Ty(root));
    expect(w.next()).toBe(root);
    expect(w.next()).toBe(ref(st, u8));
    w.skip_current_subtree();
    expect([...w]).toEqual([slice(u8), u8, bool]);
  });
});

// ---- generic_visit.rs ----------------------------------------------------------------------------------------------

describe("generic_visit", () => {
  test("visits every element, map entries as (key, value) pairs", () => {
    const out: string[] = [];
    const g = (s: string, v: string[]) => void v.push(s);
    generic_visit_with_Vec(["a", "b"], out, g);
    generic_visit_with_Option<string, string[]>(undefined, out, g);
    generic_visit_with_HashMap(new Map([["k", "v"]]), out, g, g);
    expect(out).toEqual(["a", "b", "k", "v"]);
  });
});


// ---- rustc_middle ty/fold.rs (BoundVarReplacer) ----------------------------------------------------------------------

describe("rustc_middle ty/fold.rs: BoundVarReplacer", () => {
  const { u8, i8 } = tcx.types;
  const st = tcx.lifetimes.re_static;
  const er = tcx.lifetimes.re_erased;

  test("instantiate_bound_regions calls the closure once per bound region and keeps inner binders", () => {
    const calls: number[] = [];
    const fld_r = (br: BoundRegion) => {
      calls.push(br.var);
      return br.var === 0 ? st : er;
    };
    const value = no_vars(tup(ref(bound_re(0, 0), u8), ref(bound_re(0, 1), i8), ref(bound_re(0, 0), i8)));
    const [out, map] = tcx.instantiate_bound_regions(value, fld_r, fold_Ty);
    expect(out).toBe(tup(ref(st, u8), ref(er, i8), ref(st, i8)));
    expect(calls).toEqual([0, 1]);
    expect([...map.values()]).toEqual([st, er]);
    // Inside a fn pointer's binder the outer var is `'^1` and the fn's own `'^0` stays bound.
    const sig = (a: Region, b: Region) =>
      tcx.mk_ty_from_kind({ $: "FnPtr", _0: no_vars({ inputs_and_output: tcx.mk_type_list([ref(a, u8), ref(b, u8)]) }), _1: FnHeader.dummy() });
    expect(tcx.instantiate_bound_regions_with_erased(no_vars(sig(bound_re(1, 0), bound_re(0, 0))), fold_Ty)).toBe(sig(er, bound_re(0, 0)));
    // Nothing escapes: the value itself.
    expect(tcx.instantiate_bound_regions_uncached(no_vars(u8), () => st, fold_Ty)).toBe(u8);
    // A bound type is an ICE (`bug!`).
    expect(() => tcx.instantiate_bound_regions_uncached(no_vars(bound_ty(0, 0)), () => st, fold_Ty)).toThrow();
  });

  test("anonymize_bound_vars renumbers vars in first-use order", () => {
    const vars = tcx.mk_bound_variable_kinds([
      { $: "Region", _0: { $: "Anon" } },
      { $: "Ty", _0: { $: "Anon" } },
    ]);
    const b: Binder<Ty> = { value: tup(bound_ty(0, 1), ref(bound_re(0, 0), u8)), bound_vars: vars };
    const out = tcx.anonymize_bound_vars(b, fold_Ty);
    expect(out.value).toBe(tup(bound_ty(0, 0), ref(bound_re(0, 1), u8)));
    expect([...out.bound_vars]).toEqual([
      { $: "Ty", _0: { $: "Anon" } },
      { $: "Region", _0: { $: "Anon" } },
    ]);
  });

  test("shift_bound_var_indices adds to the var of every escaping bound var", () => {
    expect(tcx.shift_bound_var_indices(2, tup(bound_ty(0, 0), ref(bound_re(0, 1), u8)), fold_Ty)).toBe(tup(bound_ty(0, 2), ref(bound_re(0, 3), u8)));
  });

  test("BottomUpFolder rebuilds bottom-up", () => {
    const f = new BottomUpFolder(tcx, (t) => (t === u8 ? i8 : t), (r) => r, (c) => c);
    expect(fold_Ty.fold_with(tup(u8, slice(u8)), f)).toBe(tup(i8, slice(i8)));
  });
});
