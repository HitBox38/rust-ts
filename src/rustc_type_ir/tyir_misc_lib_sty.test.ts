// Tests for lane tyir-misc, sub-lane lib-sty: lib.rs, sty/mod.rs, sty/consts.rs, error.rs, ty/alias.rs, upcast.rs,
// data_structures/delayed_map.rs.
//
// Oracle: a throwaway rustc-dev probe (/tmp/tyir-misc-lib-sty/main.rs, built like tyir-kind's probe): `rustc_driver`
// with an `after_expansion` callback that builds the values with the real `TyCtxt` and prints `{:?}` / `{:#?}` /
// `{}`, the flags and the predicates. The expected strings below are its output lines, copied verbatim.
// Debug arms that need another lane's still-unported fn (`debug_BoundRegion`, `debug_Placeholder`,
// `debug_EarlyParamRegion`, `debug_LateParamRegionKind`, `Debug for ParamConst`) are checked with `oracle_or_unported`:
// the port must either print the oracle's text or stop as UNPORTED (it may never print anything else).
import { describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { CRATE_DEF_ID, LocalDefId } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, ErrorGuaranteed } from "../rustc_span/lib.ts";
import { kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import { DelayedMap, DelayedSet } from "./data_structures/delayed_map.ts";
import type { BoundVar, ConstVid, RegionVid, UniverseIndex as UniverseIndexT } from "./decls.ts";
import { ExpectedFound, NoSolution_from_TypeError, NoSolutionOrRerunNonErased_from_TypeError, TypeError } from "./error.ts";
import { debug_TypeFlags, type TypeFlags } from "./flags.ts";
import type { FallibleTypeFolder, TypeFolder } from "./fold.ts";
import type { Interner } from "./interner.ts";
import {
  ClosureKind,
  DebruijnIndex,
  debug_bound_var,
  debug_ClosureKind,
  debug_DebruijnIndex,
  debug_UniverseIndex,
  debug_Variance,
  display_ClosureKind,
  INNERMOST,
  UniverseIndex,
  Variance,
} from "./lib.ts";
import { Const, debug_Const, fold_Const, relate_Const } from "./sty/consts.ts";
import { debug_Region, fold_Region, Region, relate_Region } from "./sty/mod.ts";
import type { TypeRelation } from "./relate.ts";
import { Alias } from "./ty/alias.ts";
import { upcast, upcast_from_self } from "./upcast.ts";
import type { TypeVisitor } from "./visit.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (as in tyir_kind.test.ts). */
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

const flags = (t: { flags(): TypeFlags }): string => debug_TypeFlags(t.flags(), PLAIN);
const oeb = (t: { outer_exclusive_binder(): DebruijnIndex }): string => debug_DebruijnIndex(t.outer_exclusive_binder(), PLAIN);
const guar = ErrorGuaranteed.unchecked_error_guaranteed();
const BV = (n: number) => n as BoundVar;
const D = (n: number) => DebruijnIndex.from_u32(n);

/** The port prints exactly `expected` (as `{:?}` and `{:#?}`), or stops as UNPORTED on another lane's stub. */
function oracle_or_unported<T>(v: T, debug: Debug<T>, expected: string): void {
  for (const f of [PLAIN, PRETTY]) {
    let s: string;
    try {
      s = format_debug(v, debug, f);
    } catch (e) {
      expect(e).toBeInstanceOf(Unported);
      continue;
    }
    expect(s).toBe(expected);
  }
}

describe("lib.rs", () => {
  test("Variance Debug and xform (oracle)", () => {
    const vs = [Variance.Covariant, Variance.Invariant, Variance.Contravariant, Variance.Bivariant];
    expect(vs.map((v) => `${debug_Variance(v, PLAIN)} ${format_debug(v, debug_Variance, PRETTY)}`)).toEqual(["+ +", "o o", "- -", "* *"]);
    const table: string[] = [];
    for (const a of vs) for (const b of vs) table.push(`xform ${debug_Variance(a, PLAIN)} ${debug_Variance(b, PLAIN)} = ${debug_Variance(Variance.xform(a, b), PLAIN)}`);
    expect(table).toEqual([
      "xform + + = +", "xform + o = o", "xform + - = -", "xform + * = *",
      "xform o + = o", "xform o o = o", "xform o - = o", "xform o * = o",
      "xform - + = -", "xform - o = o", "xform - - = +", "xform - * = *",
      "xform * + = *", "xform * o = *", "xform * - = *", "xform * * = *",
    ]);
  });

  test("UniverseIndex (oracle)", () => {
    const u0 = UniverseIndex.ROOT;
    const u1 = UniverseIndex.next_universe(u0);
    const u2 = UniverseIndex.next_universe(u1);
    const d = (u: UniverseIndexT) => debug_UniverseIndex(u, PLAIN);
    expect(`Universe ${d(u0)} ${format_debug(u1, debug_UniverseIndex, PRETTY)} ${d(u2)} ${d(UniverseIndex.from_u32(4294967040))} default=${d(UniverseIndex.default_())}`)
      .toBe("Universe U0 U1 U2 U4294967040 default=U0");
    expect(
      `can_name ${UniverseIndex.can_name(u1, u0)} ${UniverseIndex.can_name(u0, u1)} ${UniverseIndex.can_name(u1, u1)} cannot_name ${UniverseIndex.cannot_name(u1, u0)} ${UniverseIndex.cannot_name(u0, u1)} ${UniverseIndex.cannot_name(u1, u1)} is_root ${UniverseIndex.is_root(u0)} ${UniverseIndex.is_root(u1)}`,
    ).toBe("can_name true false true cannot_name false true false is_root true false");
    // `UniverseIndex::MAX` (0xFFFF_FF00) has no next universe: the `newtype_index!` assertion fires, as upstream.
    expect(() => UniverseIndex.next_universe(UniverseIndex.MAX)).toThrow("assertion failed: value <= 0xFFFF_FF00");
  });

  test("ClosureKind (oracle)", () => {
    const cks = [ClosureKind.Fn, ClosureKind.FnMut, ClosureKind.FnOnce];
    expect(cks.map((a) => `ClosureKind ${display_ClosureKind(a)} ${debug_ClosureKind(a, PLAIN)} ${format_debug(a, debug_ClosureKind, PRETTY)} ${ClosureKind.as_str(a)}`)).toEqual([
      "ClosureKind Fn Fn Fn Fn",
      "ClosureKind FnMut FnMut FnMut FnMut",
      "ClosureKind FnOnce FnOnce FnOnce FnOnce",
    ]);
    const ext: string[] = [];
    for (const a of cks) for (const b of cks) ext.push(`extends ${a} ${b} = ${ClosureKind.extends(a, b)}`);
    expect(ext).toEqual([
      "extends Fn Fn = true", "extends Fn FnMut = true", "extends Fn FnOnce = true",
      "extends FnMut Fn = false", "extends FnMut FnMut = true", "extends FnMut FnOnce = true",
      "extends FnOnce Fn = false", "extends FnOnce FnMut = false", "extends FnOnce FnOnce = true",
    ]);
    expect(`LATTICE_BOTTOM ${debug_ClosureKind(ClosureKind.LATTICE_BOTTOM, PLAIN)}`).toBe("LATTICE_BOTTOM Fn");
  });

  test("DebruijnIndex shifts and debug_bound_var (oracle)", () => {
    const d = D(3);
    const s = (x: DebruijnIndex) => debug_DebruijnIndex(x, PLAIN);
    expect(`Debruijn ${s(d)} in=${s(DebruijnIndex.shifted_in(d, 2))} out=${s(DebruijnIndex.shifted_out(d, 1))} to_binder=${s(DebruijnIndex.shifted_out_to_binder(d, D(2)))}`)
      .toBe("Debruijn DebruijnIndex(3) in=DebruijnIndex(5) out=DebruijnIndex(2) to_binder=DebruijnIndex(1)");
    const m = { value: d };
    DebruijnIndex.shift_in(m, 4);
    expect(`shift_in ${s(m.value)}`).toBe("shift_in DebruijnIndex(7)");
    DebruijnIndex.shift_out(m, 7);
    expect(`shift_out ${s(m.value)}`).toBe("shift_out DebruijnIndex(0)");
    // u32 wrap-around of the release-built oracle, then the `newtype_index!` assertion.
    expect(() => DebruijnIndex.shifted_out(INNERMOST, 1)).toThrow("assertion failed: value <= 0xFFFF_FF00");
    // `'^0`, `'^2_1.Env`, `'^c_3` (oracle) with a `BoundRegion`-like `{:?}`.
    const dv: Debug<string> = (v) => v;
    expect(debug_bound_var({ $: "Bound", _0: INNERMOST }, "0", dv)).toBe("^0");
    expect(debug_bound_var({ $: "Bound", _0: D(2) }, "1.Env", dv)).toBe("^2_1.Env");
    expect(debug_bound_var({ $: "Canonical" }, "3", dv)).toBe("^c_3");
  });
});

describe("sty/mod.rs: Region", () => {
  /** The probe's regions, in its order. */
  function regions(tcx: TyCtxt): [string, Region][] {
    const u1 = UniverseIndex.next_universe(UniverseIndex.ROOT);
    const scope = LocalDefId.to_def_id(CRATE_DEF_ID);
    return [
      ["static", Region.new_static(tcx)],
      ["var5", Region.new_var(tcx, 5 as RegionVid)],
      ["erased", tcx.lifetimes.re_erased],
      ["error", Region.new_error(tcx, guar)],
      ["bound0", Region.new_anon_bound(tcx, INNERMOST, BV(0))],
      ["bound2env", Region.new_bound(tcx, D(2), { var: BV(1), kind: { $: "ClosureEnv" } })],
      ["canon3", Region.new_canonical_bound(tcx, BV(3))],
      ["placeholder", Region.new_placeholder(tcx, { universe: u1, bound: { var: BV(0), kind: { $: "Anon" } }, _tcx: undefined })],
      // PORT: the probe names it `'a`; the name does not reach the flags / predicates checked here.
      ["early", Region.new_early_param(tcx, { index: 0, name: kw.StaticLifetime })],
      ["early_anon", Region.new_early_param(tcx, { index: 2, name: kw.UnderscoreLifetime })],
      ["late_anon", Region.new_late_param(tcx, scope, { $: "Anon", _0: 2 })],
      ["late_env", Region.new_late_param(tcx, scope, { $: "ClosureEnv" })],
    ];
  }

  test("constructors intern once and reuse the pre-interned regions", () => {
    const tcx = mk_tcx();
    const rs = regions(tcx);
    const again = regions(tcx);
    for (let i = 0; i < rs.length; i++) expect(again[i]![1]).toBe(rs[i]![1]);
    expect(rs[0]![1]).toBe(tcx.lifetimes.re_static);
    expect(Region.new_var(tcx, 5 as RegionVid).kind()).toEqual({ $: "ReVar", _0: 5 as RegionVid });
  });

  test("flags, outer_exclusive_binder and predicates (oracle)", () => {
    const tcx = mk_tcx();
    const lines = regions(tcx).map(([n, r]) =>
      `Region ${n} | ${flags(r)} ${oeb(r)} | b=${r.is_bound()} e=${r.is_error()} s=${r.is_static()} er=${r.is_erased()} p=${r.is_placeholder()} pa=${r.is_param()} f=${r.is_free()} v=${r.is_var()} above1=${r.bound_at_or_above_binder(D(1))}`
    );
    expect(lines).toEqual([
      "Region static | TypeFlags(HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=true er=false p=false pa=false f=true v=false above1=false",
      "Region var5 | TypeFlags(HAS_RE_INFER | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=false pa=false f=false v=true above1=false",
      "Region erased | TypeFlags(HAS_RE_ERASED) DebruijnIndex(0) | b=false e=false s=false er=true p=false pa=false f=false v=false above1=false",
      "Region error | TypeFlags(HAS_RE_ERROR | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=true s=false er=false p=false pa=false f=false v=false above1=false",
      "Region bound0 | TypeFlags(HAS_RE_BOUND) DebruijnIndex(1) | b=true e=false s=false er=false p=false pa=false f=false v=false above1=false",
      "Region bound2env | TypeFlags(HAS_RE_BOUND) DebruijnIndex(3) | b=true e=false s=false er=false p=false pa=false f=false v=false above1=true",
      "Region canon3 | TypeFlags(HAS_RE_BOUND | HAS_CANONICAL_BOUND) DebruijnIndex(0) | b=true e=false s=false er=false p=false pa=false f=false v=false above1=false",
      "Region placeholder | TypeFlags(HAS_RE_PLACEHOLDER | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=true pa=false f=false v=false above1=false",
      "Region early | TypeFlags(HAS_RE_PARAM | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=false pa=true f=true v=false above1=false",
      "Region early_anon | TypeFlags(HAS_RE_PARAM | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=false pa=true f=true v=false above1=false",
      "Region late_anon | TypeFlags(HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=false pa=true f=true v=false above1=false",
      "Region late_env | TypeFlags(HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0) | b=false e=false s=false er=false p=false pa=true f=true v=false above1=false",
    ]);
  });

  test("Ref types get the region's flags while interning (oracle)", () => {
    const tcx = mk_tcx();
    const lines = regions(tcx).map(([n, r]) => {
      const t = tcx.mk_ty_from_kind({ $: "Ref", _0: r, _1: tcx.types.u8, _2: "Not" });
      return `Ref ${n} ${flags(t)} ${oeb(t)}`;
    });
    expect(lines).toEqual([
      "Ref static TypeFlags(HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref var5 TypeFlags(HAS_RE_INFER | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref erased TypeFlags(HAS_RE_ERASED) DebruijnIndex(0)",
      "Ref error TypeFlags(HAS_RE_ERROR | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref bound0 TypeFlags(HAS_RE_BOUND) DebruijnIndex(1)",
      "Ref bound2env TypeFlags(HAS_RE_BOUND) DebruijnIndex(3)",
      "Ref canon3 TypeFlags(HAS_RE_BOUND | HAS_CANONICAL_BOUND) DebruijnIndex(0)",
      "Ref placeholder TypeFlags(HAS_RE_PLACEHOLDER | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref early TypeFlags(HAS_RE_PARAM | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref early_anon TypeFlags(HAS_RE_PARAM | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref late_anon TypeFlags(HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
      "Ref late_env TypeFlags(HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS) DebruijnIndex(0)",
    ]);
  });

  test("Debug, {:?} and {:#?} (oracle)", () => {
    const tcx = mk_tcx();
    const expected: Record<string, string> = {
      static: "'static",
      var5: "'?5",
      erased: "'{erased}",
      error: "'{region error}",
      bound0: "'^0",
      bound2env: "'^2_1.Env",
      canon3: "'^c_3",
      placeholder: "'!1_0",
      late_anon: "ReLateParam(DefId(0:0 ~ empty[152e]), LateAnon(2))",
      late_env: "ReLateParam(DefId(0:0 ~ empty[152e]), LateEnv)",
      early_anon: "'_/#2",
    };
    for (const [n, r] of regions(tcx)) {
      if (expected[n] === undefined) continue;
      if (n === "static" || n === "var5" || n === "erased" || n === "error") {
        expect(format_debug(r, debug_Region, PLAIN)).toBe(expected[n]!);
        expect(format_debug(r, debug_Region, PRETTY)).toBe(expected[n]!);
      } else {
        oracle_or_unported(r, debug_Region, expected[n]!);
      }
    }
    expect(() => regions(tcx)[0]![1].as_var()).toThrow("expected region 'static to be of kind ReVar");
    expect(regions(tcx)[1]![1].as_var()).toBe(5 as RegionVid);
  });

  test("get_name / is_named / get_name_or_anon (oracle)", () => {
    const tcx = mk_tcx();
    const [st, var5, erased, error] = regions(tcx).map(([, r]) => r);
    // RegionName static Some("'static") true "'static"; var5 / erased / error: None false "anon"
    expect([st!.get_name(tcx), st!.is_named(tcx), st!.get_name_or_anon(tcx)]).toEqual([kw.StaticLifetime, true, kw.StaticLifetime]);
    for (const r of [var5!, erased!, error!]) {
      expect([r.get_name(tcx), r.is_named(tcx), r.get_name_or_anon(tcx)]).toEqual([undefined, false, sym.anon]);
    }
  });

  test("TypeFoldable / TypeVisitable dispatch to the folder / visitor; Relate to the relation", () => {
    const tcx = mk_tcx();
    const a = tcx.lifetimes.re_static;
    const b = tcx.lifetimes.re_erased;
    const seen: Region[] = [];
    const folder = { cx: () => tcx, fold_region: (r: Region) => (seen.push(r), b) } as unknown as TypeFolder;
    const ffolder = { cx: () => tcx, try_fold_region: (r: Region) => (seen.push(r), Ok(b)) } as unknown as FallibleTypeFolder<never>;
    const visitor = { visit_region: (r: Region) => (seen.push(r), 7) } as unknown as TypeVisitor<number>;
    expect(fold_Region.fold_with(a, folder)).toBe(b);
    expect(fold_Region.try_fold_with(a, ffolder)).toEqual(Ok(b));
    expect(fold_Region.visit_with(a, visitor)).toBe(7);
    expect(seen).toEqual([a, a, a]);
    // merge-w15a: a partial `TypeRelation` double (only `regions` is reached).
    expect(relate_Region({ regions: (x: Region, y: Region) => Ok(x === a && y === b ? b : a) } as unknown as TypeRelation, a, b)).toEqual(Ok(b));
  });
});

describe("sty/consts.rs: Const", () => {
  function consts(tcx: TyCtxt): [string, Const][] {
    const u2 = UniverseIndex.from_u32(2);
    return [
      ["var3", Const.new_var(tcx, 3 as ConstVid)],
      ["fresh2", Const.new_fresh(tcx, 2)],
      // The bound consts are built from the struct (`BoundConst { var, _tcx: PhantomData }`).
      ["bound0", Const.new_bound(tcx, INNERMOST, { var: BV(0), _tcx: undefined })],
      ["bound1", Const.new_bound(tcx, D(1), { var: BV(4), _tcx: undefined })],
      ["canon2", Const.new(tcx, { $: "Bound", _0: { $: "Canonical" }, _1: { var: BV(2), _tcx: undefined } })],
      ["placeholder", Const.new_placeholder(tcx, { universe: u2, bound: { var: BV(1), _tcx: undefined }, _tcx: undefined })],
      ["error", Const.new_error(tcx, guar)],
      ["param", Const.new_param(tcx, { index: 0, name: create_default_session_globals_then(() => Symbol.intern("N")) })],
    ];
  }

  test("flags, outer_exclusive_binder and predicates (oracle)", () => {
    const tcx = mk_tcx();
    const vid = (c: Const) => {
      const v = c.ct_vid();
      return v === undefined ? "None" : `Some(?${v}c)`;
    };
    const lines = consts(tcx).map(([n, c]) =>
      `Const ${n} | ${flags(c)} ${oeb(c)} | var=${c.is_ct_var()} err=${c.is_ct_error()} wf=${c.is_trivially_wf()} infer=${c.is_ct_infer()} vid=${vid(c)}`
    );
    expect(lines).toEqual([
      "Const var3 | TypeFlags(HAS_CT_INFER) DebruijnIndex(0) | var=true err=false wf=false infer=true vid=Some(?3c)",
      "Const fresh2 | TypeFlags(HAS_CT_FRESH) DebruijnIndex(0) | var=false err=false wf=false infer=true vid=None",
      "Const bound0 | TypeFlags(HAS_CT_BOUND) DebruijnIndex(1) | var=false err=false wf=true infer=false vid=None",
      "Const bound1 | TypeFlags(HAS_CT_BOUND) DebruijnIndex(2) | var=false err=false wf=true infer=false vid=None",
      "Const canon2 | TypeFlags(HAS_CT_BOUND | HAS_CANONICAL_BOUND) DebruijnIndex(0) | var=false err=false wf=true infer=false vid=None",
      "Const placeholder | TypeFlags(HAS_CT_PLACEHOLDER) DebruijnIndex(0) | var=false err=false wf=true infer=false vid=None",
      "Const error | TypeFlags(HAS_NON_REGION_ERROR) DebruijnIndex(0) | var=false err=true wf=false infer=false vid=None",
      "Const param | TypeFlags(HAS_CT_PARAM) DebruijnIndex(0) | var=false err=false wf=true infer=false vid=None",
    ]);
    // merge-w15a: `BoundConst::new` is binder.ts's now; `new_anon_bound` / `new_canonical_bound` intern the same consts.
    expect(Const.new_anon_bound(tcx, INNERMOST, BV(0))).toBe(Const.new_bound(tcx, INNERMOST, { var: BV(0), _tcx: undefined }));
    expect(Const.new_canonical_bound(tcx, BV(2))).toBe(Const.new(tcx, { $: "Bound", _0: { $: "Canonical" }, _1: { var: BV(2), _tcx: undefined } }));
  });

  test("Debug, {:?} and {:#?} (oracle)", () => {
    const tcx = mk_tcx();
    const expected: Record<string, string> = {
      var3: "?3c",
      fresh2: "Fresh(2)",
      bound0: "^BoundConst { var: 0, .. }",
      bound1: "^1_BoundConst { var: 4, .. }",
      canon2: "^c_BoundConst { var: 2, .. }",
      placeholder: "!2_BoundConst { var: 1, .. }",
      error: "{const error}",
      param: "N/#0",
    };
    for (const [n, c] of consts(tcx)) {
      if (n === "var3" || n === "fresh2" || n === "error" || n.startsWith("bound") || n === "canon2") {
        expect(format_debug(c, debug_Const, PLAIN)).toBe(expected[n]!);
        expect(format_debug(c, debug_Const, PRETTY)).toBe(expected[n]!);
      } else {
        oracle_or_unported(c, debug_Const, expected[n]!);
      }
    }
  });

  test("fold / super_fold / visit dispatch; Relate to the relation", () => {
    const tcx = mk_tcx();
    const [var3, fresh2] = consts(tcx).map(([, c]) => c);
    const folder = { cx: () => tcx, fold_const: () => fresh2 } as unknown as TypeFolder;
    const ffolder = { cx: () => tcx, try_fold_const: () => Ok(fresh2) } as unknown as FallibleTypeFolder<never>;
    const visitor = { visit_const: () => 3, Result: { output: () => 0 } } as unknown as TypeVisitor<number>;
    expect(fold_Const.fold_with(var3!, folder)).toBe(fresh2);
    expect(fold_Const.try_fold_with(var3!, ffolder)).toEqual(Ok(fresh2));
    expect(fold_Const.visit_with(var3!, visitor)).toBe(3);
    // leaves: `super_*` returns `self` / `V::Result::output()`
    expect(fold_Const.super_fold_with(var3!, folder)).toBe(var3);
    expect(fold_Const.try_super_fold_with(var3!, ffolder)).toEqual(Ok(var3));
    expect(fold_Const.super_visit_with(var3!, visitor)).toBe(0);
    // merge-w15a: a partial `TypeRelation` double (only `consts` is reached).
    expect(relate_Const({ consts: (a: Const, _b: Const) => Ok(a) } as unknown as TypeRelation, var3!, fresh2!)).toEqual(Ok(var3));
  });
});

describe("error.rs, ty/alias.rs, upcast.rs", () => {
  test("TypeError helpers", () => {
    expect(ExpectedFound.new(1, 2)).toEqual({ expected: 1, found: 2 });
    expect(TypeError.involves_regions(TypeError.RegionsPlaceholderMismatch)).toBe(true);
    expect(TypeError.involves_regions(TypeError.Mismatch)).toBe(false);
    expect(TypeError.must_include_note(TypeError.Mismatch)).toBe(false);
    expect(TypeError.must_include_note(TypeError.ArgCount)).toBe(true);
    expect(TypeError.must_include_note({ $: "TupleSize", _0: { expected: 1, found: 2 } })).toBe(true);
    expect(NoSolution_from_TypeError(TypeError.Mismatch)).toEqual({});
    expect(NoSolutionOrRerunNonErased_from_TypeError(TypeError.Mismatch)).toEqual({ $: "NoSolution", _0: {} });
  });

  test("Alias::kind and Upcast", () => {
    const tcx = mk_tcx();
    // PORT: `TyCtxt` does not implement every `Interner` method yet (contract.test.ts pins the missing ones).
    const cx = tcx as unknown as Interner;
    expect(Alias.kind({ kind: "k", args: tcx.mk_args([]), _use_alias_new_instead: null }, cx)).toBe("k");
    expect(upcast_from_self(5, cx)).toBe(5);
    expect(upcast(5, cx, (x: number) => `${x}!`)).toBe("5!");
  });
});

describe("data_structures/delayed_map.rs", () => {
  test("DelayedMap ignores the first 32 inserts, then caches", () => {
    const m = DelayedMap.default_<[number, number], string>(([a, b]) => `${a},${b}`);
    for (let i = 0; i < 32; i++) expect(m.insert([i, i], "x")).toBe(true);
    expect(m.get([0, 0])).toBe(undefined);
    expect(m.insert([1, 2], "a")).toBe(true);
    expect(m.insert([1, 2], "b")).toBe(false);
    expect(m.get([1, 2])).toBe("b");
    m.clear();
    expect([m.count, m.get([1, 2])]).toEqual([0, undefined]);
  });

  test("DelayedSet ignores the first 32 inserts, then caches", () => {
    const s = DelayedSet.default_<number>();
    for (let i = 0; i < 32; i++) expect(s.insert(i)).toBe(true);
    expect(s.contains(0)).toBe(false);
    expect(s.insert(40)).toBe(true);
    expect(s.insert(40)).toBe(false);
    expect(s.contains(40)).toBe(true);
    s.clear();
    expect([s.count, s.contains(40)]).toEqual([0, false]);
  });
});
