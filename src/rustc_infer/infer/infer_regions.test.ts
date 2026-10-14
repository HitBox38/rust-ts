// Lane infer-regions: region_constraints/{mod,leak_check}.rs, lexical_region_resolve/{mod,indexed_edges}.rs,
// free_regions.rs and outlives/env.rs, on a real `InferCtxt` (`tcx.infer_ctxt().build(..)` over a bare `TyCtxt`, as
// contract.test.ts). Expected values are read off the upstream code paths named in each test.

import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_ParamTy, ParamTy } from "../../rustc_middle/ty/sty.ts";
import { create_session_globals_then, DUMMY_SP } from "../../rustc_span/lib.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { kw } from "../../rustc_span/symbol.ts";
import type { BoundVar } from "../../rustc_type_ir/decls.ts";
import type { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { fold_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { FreeRegionMap, RegionRelations } from "./free_regions.ts";
import { IndexedConstraintEdges } from "./lexical_region_resolve/indexed_edges.ts";
import { LexicalResolver, RegionResolutionError, resolve } from "./lexical_region_resolve/mod.ts";
import { type RegionVariableOrigin, SubregionOrigin } from "./mod.ts";
import { OutlivesEnvironment, new_RegionBoundPairs } from "./outlives/env.ts";
import { LeakCheck, LeakCheckNode, MiniGraph } from "./region_constraints/leak_check.ts";
import {
  Constraint,
  debug_GenericKind,
  debug_RegionSnapshot,
  GenericKind,
  RegionConstraintData,
  type RegionVariableInfo,
  VerifyBound,
} from "./region_constraints/mod.ts";
import { type TransitiveRelation, TransitiveRelationBuilder } from "../../rustc_data_structures/transitive_relation.ts";
import { ParamEnv } from "../../rustc_middle/ty/mod.ts";

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
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => true;
  return tcx;
}

const U0 = UniverseIndex.ROOT;
const U1 = UniverseIndex.from_u32(1);
const U2 = UniverseIndex.from_u32(2);
const ORIGIN: SubregionOrigin = { $: "RelateObjectBound", _0: DUMMY_SP };
const MISC: RegionVariableOrigin = { $: "Misc", _0: DUMMY_SP };

function setup() {
  const tcx = mk_tcx();
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const rcc = () => infcx.inner.unwrap_region_constraints();
  const var_ = (vid: RegionVid): Region => Region.new_var(tcx, vid);
  const early = (index: number): Region => Region.new_early_param(tcx, { index, name: kw.UnderscoreLifetime });
  const placeholder = (universe: UniverseIndex, var_n: number): PlaceholderRegion => ({
    universe,
    bound: { var: var_n as BoundVar, kind: { $: "Anon" } },
    _tcx: undefined,
  });
  const re_placeholder = (universe: UniverseIndex, var_n: number): Region => Region.new_placeholder(tcx, placeholder(universe, var_n));
  return { tcx, infcx, rcc, var_, early, placeholder, re_placeholder, re_static: tcx.lifetimes.re_static };
}

/** `[kind, sub, sup]` of the collected constraints, for comparison. */
function kinds(data: RegionConstraintData): [string, Region, Region][] {
  return data.constraints.map(([c]) => [c.kind, c.sub, c.sup]);
}

/** A `TransitiveRelation<Region>` with no edges. */
function empty_relation(): TransitiveRelation<Region> {
  return TransitiveRelationBuilder.default<Region>().freeze();
}

describe("RegionConstraintCollector (region_constraints/mod.rs)", () => {
  test("new_region_var: vids in order, origins, universes, unification keys", () => {
    const { rcc } = setup();
    expect(rcc().num_region_vars()).toBe(0);
    const a = rcc().new_region_var(U0, MISC);
    const b = rcc().new_region_var(U1, MISC);
    expect([a, b]).toEqual([0, 1] as RegionVid[]);
    expect(rcc().num_region_vars()).toBe(2);
    expect(rcc().var_origin(b)).toBe(MISC);
    expect(rcc().try_resolve_region_var(a)).toEqual({ $: "Err", _0: U0 });
    expect(rcc().try_resolve_region_var(b)).toEqual({ $: "Err", _0: U1 });
    expect(rcc().storage.unification_table.len()).toBe(2);
  });

  test("make_subregion sorts constraints by kind (mod.rs:571)", () => {
    const { rcc, var_, early, re_static } = setup();
    const v0 = var_(rcc().new_region_var(U0, MISC));
    const v1 = var_(rcc().new_region_var(U0, MISC));
    const a = early(0);
    const b = early(1);
    rcc().make_subregion(ORIGIN, v0, v1, "Yes");
    rcc().make_subregion(ORIGIN, v0, v0, "Yes"); // same var: nothing
    rcc().make_subregion(ORIGIN, a, v0, "Yes");
    rcc().make_subregion(ORIGIN, v1, b, "No");
    rcc().make_subregion(ORIGIN, v0, re_static, "Yes"); // `(_, ReStatic)`: nothing
    rcc().make_subregion(ORIGIN, a, b, "Yes");
    rcc().make_subregion(ORIGIN, a, a, "Yes"); // equal regions: nothing
    expect(kinds(rcc().data())).toEqual([
      ["VarSubVar", v0, v1],
      ["RegSubVar", a, v0],
      ["VarSubReg", v1, b],
      ["RegSubReg", a, b],
    ]);
    expect(rcc().data().constraints[2]![0].visible_for_leak_check).toBe("No");
    expect(rcc().data().constraints[0]![1]).toBe(ORIGIN);
  });

  test("make_subregion of a bound region is a bug", () => {
    const { tcx, rcc } = setup();
    const bound = tcx.lifetimes.anon_re_bounds[0]![0]!;
    // span_bug! reads `origin.span()` first (lane infer-core's companion).
    expect(() => rcc().make_subregion(ORIGIN, bound, tcx.lifetimes.re_erased, "Yes")).toThrow(Panic);
  });

  test("make_eqregion: var==var unifies, var==reg records the value, static is one-directional (mod.rs:482)", () => {
    const { tcx, rcc, var_, early, re_static } = setup();
    const vid0 = rcc().new_region_var(U0, MISC);
    const vid1 = rcc().new_region_var(U1, MISC);
    const vid2 = rcc().new_region_var(U0, MISC);
    const vid3 = rcc().new_region_var(U0, MISC);
    const [v0, v1, v2, v3] = [var_(vid0), var_(vid1), var_(vid2), var_(vid3)];
    const a = early(0);
    const b = early(1);
    expect(rcc().storage.any_unifications).toBe(false);
    rcc().make_eqregion(ORIGIN, v0, v0, "Yes"); // a == b: nothing
    rcc().make_eqregion(ORIGIN, v0, v1, "Yes");
    expect(rcc().storage.any_unifications).toBe(true);
    rcc().make_eqregion(ORIGIN, a, v2, "Yes");
    rcc().make_eqregion(ORIGIN, v3, re_static, "Yes");
    rcc().make_eqregion(ORIGIN, a, re_static, "Yes");
    rcc().make_eqregion(ORIGIN, a, b, "Yes");
    expect(kinds(rcc().data())).toEqual([
      ["VarEqVar", v0, v1],
      ["VarEqReg", v2, a],
      ["RegSubVar", re_static, v3],
      ["RegSubReg", re_static, a],
      ["RegEqReg", a, b],
    ]);
    // `RegionVidKey::order_roots` is not overridden: ena's rank rule picks the root; both resolve to it.
    const r0 = rcc().shallow_resolve_region_var(tcx, vid0);
    expect(rcc().shallow_resolve_region_var(tcx, vid1)).toBe(r0);
    // the unified universe is the minimum (unify_key.rs:47)
    expect(rcc().universe(v1)).toBe(U0);
    expect(rcc().shallow_resolve_region_var(tcx, vid2)).toBe(a);
    expect(rcc().try_resolve_region_var(vid3)).toEqual({ $: "Ok", _0: re_static });
    expect(rcc().universe(v2)).toBe(U0);
  });

  test("universe(): ROOT for free regions, the placeholder's universe, a var's universe", () => {
    const { tcx, rcc, var_, early, re_placeholder, re_static } = setup();
    const v = var_(rcc().new_region_var(U2, MISC));
    expect(rcc().universe(re_static)).toBe(U0);
    expect(rcc().universe(early(0))).toBe(U0);
    expect(rcc().universe(tcx.lifetimes.re_erased)).toBe(U0);
    expect(rcc().universe(re_placeholder(U1, 0))).toBe(U1);
    expect(rcc().universe(v)).toBe(U2);
    expect(() => rcc().universe(tcx.lifetimes.anon_re_bounds[0]![0]!)).toThrow(Panic);
  });

  test("add_verify skips AllBounds([]); verify_generic_bound records the rest", () => {
    const { rcc, early } = setup();
    const kind: GenericKind = { $: "Param", _0: ParamTy.new(0, kw.SelfUpper) };
    rcc().verify_generic_bound(ORIGIN, kind, early(0), { $: "AllBounds", _0: [] });
    expect(rcc().data().verifys.length).toBe(0);
    rcc().verify_generic_bound(ORIGIN, kind, early(0), VerifyBound.IsEmpty);
    expect(rcc().data().verifys).toEqual([{ kind, origin: ORIGIN, region: early(0), bound: VerifyBound.IsEmpty }]);
    expect(rcc().data().is_empty()).toBe(false);
  });

  test("lub_regions / glb_regions: 'static and equal regions need no variable", () => {
    const { tcx, rcc, early, re_static } = setup();
    const a = early(0);
    expect(rcc().lub_regions(tcx, ORIGIN, a, re_static)).toBe(a);
    expect(rcc().lub_regions(tcx, ORIGIN, re_static, a)).toBe(re_static);
    expect(rcc().lub_regions(tcx, ORIGIN, a, a)).toBe(a);
    expect(rcc().glb_regions(tcx, ORIGIN, re_static, a)).toBe(a);
    expect(rcc().glb_regions(tcx, ORIGIN, a, re_static)).toBe(a);
    expect(rcc().glb_regions(tcx, ORIGIN, a, a)).toBe(a);
    expect(rcc().num_region_vars()).toBe(0);
    // two distinct non-'static regions go through combine_vars (its origin is `Misc(origin.span())`).
    expect(rcc().lub_regions(tcx, ORIGIN, a, early(1))).toBe(Region.new_var(tcx, 0 as RegionVid));
    expect(rcc().num_region_vars()).toBe(1);
    expect(rcc().storage.var_infos[0]!.origin).toEqual({ $: "Misc", _0: DUMMY_SP });
  });

  test("combine_vars: a fresh var in the max universe, edges in order, memoized per (a, b) (mod.rs:705)", () => {
    const { tcx, infcx, rcc, early, re_placeholder } = setup();
    const a = early(0);
    const p = re_placeholder(U2, 0);
    {
      const s = infcx.inner.undo_log.start_snapshot();
      const lub = rcc().lub_regions(tcx, ORIGIN, a, p);
      expect(lub).toBe(Region.new_var(tcx, 0 as RegionVid));
      expect(rcc().storage.var_infos[0]!.universe).toBe(U2);
      expect(rcc().storage.var_infos[0]!.origin).toEqual({ $: "Misc", _0: DUMMY_SP });
      expect(kinds(rcc().data())).toEqual([
        ["RegSubVar", a, lub],
        ["RegSubVar", p, lub],
      ]);
      // memoized: same pair, same var, no new constraints
      expect(rcc().lub_regions(tcx, ORIGIN, a, p)).toBe(lub);
      expect(rcc().data().constraints.length).toBe(2);
      // the reverse pair is a different key
      const lub2 = rcc().lub_regions(tcx, ORIGIN, p, a);
      expect(lub2).toBe(Region.new_var(tcx, 1 as RegionVid));
      const glb = rcc().glb_regions(tcx, ORIGIN, a, p);
      expect(glb).toBe(Region.new_var(tcx, 2 as RegionVid));
      expect(kinds(rcc().data()).slice(4)).toEqual([
        ["VarSubReg", glb, a],
        ["VarSubReg", glb, p],
      ]);
      expect(rcc().storage.lubs.size).toBe(2);
      expect(rcc().storage.glbs.size).toBe(1);
      // rollback undoes the combinations, the vars and the constraints
      infcx.inner.rollback_to(s);
      expect(rcc().storage.lubs.size).toBe(0);
      expect(rcc().storage.glbs.size).toBe(0);
      expect(rcc().num_region_vars()).toBe(0);
      expect(rcc().storage.unification_table.len()).toBe(0);
      expect(rcc().data().is_empty()).toBe(true);
    }
  });

  test("snapshots: region_constraints_added_in_snapshot, vars_since_snapshot, rollback (undo_log + Rollback)", () => {
    const { infcx, rcc, var_, early } = setup();
    const v0 = var_(rcc().new_region_var(U0, MISC));
    const s = infcx.inner.undo_log.start_snapshot();
    const rs = rcc().start_snapshot();
    expect(debug_RegionSnapshot(rs, PLAIN)).toBe("RegionSnapshot");
    expect(rcc().region_constraints_added_in_snapshot(s)).toBe(false);
    const vid1 = rcc().new_region_var(U1, { $: "Misc", _0: DUMMY_SP });
    expect(rcc().region_constraints_added_in_snapshot(s)).toBe(false);
    rcc().make_eqregion(ORIGIN, v0, var_(vid1), "Yes");
    rcc().make_subregion(ORIGIN, early(0), v0, "Yes");
    expect(rcc().region_constraints_added_in_snapshot(s)).toBe(true);
    const [range, origins] = rcc().vars_since_snapshot(1);
    expect(range).toEqual({ start: 1 as RegionVid, end: 2 as RegionVid });
    expect(origins).toEqual([{ $: "Misc", _0: DUMMY_SP }]);
    expect(rcc().storage.any_unifications).toBe(true);
    infcx.inner.rollback_to(s);
    rcc().rollback_to(rs);
    expect(rcc().storage.any_unifications).toBe(false);
    expect(rcc().num_region_vars()).toBe(1);
    expect(rcc().data().constraints.length).toBe(0);
    expect(rcc().try_resolve_region_var(0 as RegionVid)).toEqual({ $: "Err", _0: U0 });
  });

  test("take_and_reset_data takes the data and un-unifies the variables (mod.rs:384)", () => {
    const { tcx, infcx, rcc, var_, early } = setup();
    const vid0 = rcc().new_region_var(U0, MISC);
    const vid1 = rcc().new_region_var(U1, MISC);
    rcc().make_eqregion(ORIGIN, var_(vid0), var_(vid1), "Yes");
    rcc().make_subregion(ORIGIN, early(0), var_(vid0), "Yes");
    const data = rcc().take_and_reset_data();
    expect(kinds(data)).toEqual([
      ["VarEqVar", var_(vid0), var_(vid1)],
      ["RegSubVar", early(0), var_(vid0)],
    ]);
    expect(rcc().data().is_empty()).toBe(true);
    expect(rcc().storage.any_unifications).toBe(false);
    expect(rcc().shallow_resolve_region_var(tcx, vid1)).toBe(var_(vid1));
    // the universes come back from var_infos
    expect(rcc().try_resolve_region_var(vid1)).toEqual({ $: "Err", _0: U1 });
    // not legal during a snapshot
    infcx.inner.undo_log.start_snapshot();
    expect(() => rcc().take_and_reset_data()).toThrow(Panic);
  });

  test("Constraint::iter_outlives decomposes equalities; involves_placeholders", () => {
    const { rcc, var_, early, re_placeholder } = setup();
    const v = var_(rcc().new_region_var(U0, MISC));
    const w = var_(rcc().new_region_var(U0, MISC));
    const a = early(0);
    const b = early(1);
    const split = (c: Constraint) => [...c.iter_outlives()].map((x) => [x.kind, x.sub, x.sup, x.visible_for_leak_check]);
    expect(split(new Constraint("VarEqVar", v, w, "No"))).toEqual([
      ["VarSubVar", v, w, "No"],
      ["VarSubVar", w, v, "No"],
    ]);
    expect(split(new Constraint("VarEqReg", v, a, "Yes"))).toEqual([
      ["VarSubReg", v, a, "Yes"],
      ["RegSubVar", a, v, "Yes"],
    ]);
    expect(split(new Constraint("RegEqReg", a, b, "Yes"))).toEqual([
      ["RegSubReg", a, b, "Yes"],
      ["RegSubReg", b, a, "Yes"],
    ]);
    const c = new Constraint("RegSubVar", a, v, "Yes");
    expect([...c.iter_outlives()][0]).toBe(c);
    expect(c.involves_placeholders()).toBe(false);
    expect(new Constraint("RegSubVar", re_placeholder(U1, 0), v, "Yes").involves_placeholders()).toBe(true);
  });

  test("VerifyBound::{must_hold, cannot_hold, or} (mod.rs:816)", () => {
    const { early, re_static } = setup();
    const out_static: VerifyBound = { $: "OutlivedBy", _0: re_static };
    const out_a: VerifyBound = { $: "OutlivedBy", _0: early(0) };
    const any_empty: VerifyBound = { $: "AnyBound", _0: [] };
    const all_empty: VerifyBound = { $: "AllBounds", _0: [] };
    expect(VerifyBound.must_hold(out_static)).toBe(true);
    expect(VerifyBound.must_hold(out_a)).toBe(false);
    expect(VerifyBound.must_hold(all_empty)).toBe(true);
    expect(VerifyBound.must_hold(any_empty)).toBe(false);
    expect(VerifyBound.cannot_hold(any_empty)).toBe(true);
    expect(VerifyBound.cannot_hold(all_empty)).toBe(false);
    expect(VerifyBound.cannot_hold(VerifyBound.IsEmpty)).toBe(false);
    expect(VerifyBound.or(out_static, out_a)).toBe(out_static);
    expect(VerifyBound.or(out_a, any_empty)).toBe(out_a);
    expect(VerifyBound.or(any_empty, out_a)).toBe(out_a);
    expect(VerifyBound.or(out_a, VerifyBound.IsEmpty)).toEqual({ $: "AnyBound", _0: [out_a, VerifyBound.IsEmpty] });
  });

  test("GenericKind: Debug forwards to the payload, to_ty builds the type", () => {
    const { tcx } = setup();
    const p = ParamTy.new(0, kw.SelfUpper);
    const kind: GenericKind = { $: "Param", _0: p };
    expect(GenericKind.to_ty(kind, tcx)).toBe(ParamTy.to_ty(p, tcx));
    // `write!(f, "{p:?}")`: the payload's own Debug (ParamTy's reads the symbol interner)
    create_session_globals_then(Edition.Edition2021, [], undefined, () => {
      expect(debug_GenericKind(kind, PLAIN)).toBe(debug_ParamTy(p, PLAIN));
    });
  });
});

// ---- lexical region resolution -------------------------------------------------------------------------------------------

function infos(...universes: UniverseIndex[]): RegionVariableInfo[] {
  return universes.map((universe) => ({ origin: MISC, universe }));
}
function data_of(cs: [string, Region, Region][], verifys: RegionConstraintData["verifys"] = []): RegionConstraintData {
  return new RegionConstraintData(
    cs.map(([k, sub, sup]) => [new Constraint(k as Constraint["kind"], sub, sup, "Yes"), ORIGIN]),
    verifys,
  );
}

describe("lexical region resolution (lexical_region_resolve/mod.rs)", () => {
  test("expansion grows variables to the lub of their lower bounds, across VarSubVar edges", () => {
    const { tcx, var_, early } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const [v0, v1, v2] = [var_(0 as RegionVid), var_(1 as RegionVid), var_(2 as RegionVid)];
    const a = early(0);
    // `?1: ?0` comes before `?0: 'a`, so ?1 grows in the second (changes) pass.
    const [values, errors] = resolve(rels, infos(U0, U0, U0), data_of([["VarSubVar", v0, v1], ["RegSubVar", a, v0]]));
    expect(errors).toEqual([]);
    expect(values.values).toEqual([
      { $: "Value", _0: a },
      { $: "Value", _0: a },
      { $: "Empty", _0: U0 },
    ]);
    expect(values.resolve_region(tcx, v1)).toBe(a);
    expect(values.resolve_region(tcx, v2)).toBe(v2);
    expect(values.normalize(tcx, v0, fold_Region)).toBe(a);
  });

  test("two unrelated params: lub is 'static (postdom None), the upper bound fails: SubSupConflict, lower bounds in reverse order", () => {
    const { tcx, var_, early } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const v0 = var_(0 as RegionVid);
    const [a, b] = [early(0), early(1)];
    const [values, errors] = resolve(rels, infos(U0), data_of([["RegSubVar", a, v0], ["RegSubVar", b, v0], ["VarSubReg", v0, a]]));
    expect(values.values).toEqual([{ $: "ErrorValue" }]);
    expect(values.resolve_region(tcx, v0)).toBe(tcx.lifetimes.re_static);
    // in-edges are indexed in reverse constraint order (indexed_edges.rs:53): `b` is the first lower bound.
    expect(errors).toEqual([
      { $: "SubSupConflict", _0: 0 as RegionVid, _1: MISC, _2: ORIGIN, _3: b, _4: ORIGIN, _5: a, _6: [] },
    ]);
    expect(RegionResolutionError.origin(errors[0]!)).toEqual(ORIGIN);
  });

  test("RegSubReg: ConcreteFailure unless the sup is (known to be) 'static", () => {
    const { tcx, early, re_static, re_placeholder } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const a = early(0);
    const p = re_placeholder(U1, 0);
    const [, errors] = resolve(rels, [], data_of([["RegSubReg", re_static, a], ["RegSubReg", a, re_static], ["RegSubReg", p, p], ["RegSubReg", a, p]]));
    expect(errors).toEqual([
      { $: "ConcreteFailure", _0: ORIGIN, _1: re_static, _2: a },
      { $: "ConcreteFailure", _0: ORIGIN, _1: a, _2: p },
    ]);
  });

  test("placeholders: an empty var that cannot name the placeholder's universe grows to 'static", () => {
    const { tcx, var_, re_placeholder, re_static } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const p = re_placeholder(U1, 0);
    const [values, errors] = resolve(rels, infos(U0, U1), data_of([["RegSubVar", p, var_(0 as RegionVid)], ["RegSubVar", p, var_(1 as RegionVid)]]));
    expect(errors).toEqual([]);
    expect(values.values).toEqual([
      { $: "Value", _0: re_static },
      { $: "Value", _0: p },
    ]);
  });

  test("UpperBoundUniverseConflict: a var outlived by an unnameable placeholder (mod.rs:775)", () => {
    const { tcx, var_, re_placeholder } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const p = re_placeholder(U1, 0);
    const [v0, v1] = [var_(0 as RegionVid), var_(1 as RegionVid)];
    const [values, errors] = resolve(rels, infos(U0, U1), data_of([["RegSubVar", p, v1], ["VarSubVar", v0, v1], ["VarSubReg", v1, p]]));
    expect(values.values).toEqual([{ $: "Empty", _0: U0 }, { $: "ErrorValue" }]);
    expect(errors).toEqual([{ $: "UpperBoundUniverseConflict", _0: 1 as RegionVid, _1: MISC, _2: U0, _3: ORIGIN, _4: p }]);
  });

  test("verifys: OutlivedBy / IsEmpty / AnyBound against the resolved values; GenericBoundFailure", () => {
    const { tcx, var_, early } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const [v0, v1] = [var_(0 as RegionVid), var_(1 as RegionVid)];
    const [a, b] = [early(0), early(1)];
    const kind: GenericKind = { $: "Param", _0: ParamTy.new(0, kw.SelfUpper) };
    const verifys: RegionConstraintData["verifys"] = [
      { kind, origin: ORIGIN, region: v0, bound: { $: "OutlivedBy", _0: a } }, // ?0 = 'a <= 'a: met
      { kind, origin: ORIGIN, region: v0, bound: { $: "OutlivedBy", _0: b } }, // 'a <= 'b: not met
      { kind, origin: ORIGIN, region: v1, bound: VerifyBound.IsEmpty }, // ?1 empty: met
      { kind, origin: ORIGIN, region: v0, bound: { $: "AnyBound", _0: [VerifyBound.IsEmpty, { $: "OutlivedBy", _0: v0 }] } }, // ?0 <= ?0
    ];
    const [, errors] = resolve(rels, infos(U0, U0), data_of([["RegSubVar", a, v0]], verifys));
    // the failure carries the normalized region (`?0` resolved to `'a`)
    expect(errors).toEqual([{ $: "GenericBoundFailure", _0: ORIGIN, _1: kind, _2: a }]);
  });

  test("infer_variable_values deduplicates constraints and marks them Unreachable for the leak check", () => {
    const { tcx, var_, early } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    const v0 = var_(0 as RegionVid);
    const input = new RegionConstraintData(
      [
        [new Constraint("RegSubVar", early(0), v0, "Yes"), ORIGIN],
        [new Constraint("RegSubVar", early(0), v0, "No"), ORIGIN],
        [new Constraint("VarSubReg", v0, early(0), "Yes"), ORIGIN],
      ],
      [],
    );
    const resolver = new LexicalResolver(rels, infos(U0), input);
    const errors: RegionResolutionError[] = [];
    resolver.infer_variable_values(errors);
    expect(errors).toEqual([]);
    expect(resolver.data.constraints.map(([c]) => [c.kind, c.visible_for_leak_check])).toEqual([
      ["RegSubVar", "Unreachable"],
      ["VarSubReg", "Unreachable"],
    ]);
    // the caller's data is untouched
    expect(input.constraints.length).toBe(3);
    expect(input.constraints[0]![0].visible_for_leak_check).toBe("Yes");
  });

  test("resolve asserts that equalities were decomposed", () => {
    const { tcx, var_ } = setup();
    const rels = RegionRelations.new(tcx, new FreeRegionMap(empty_relation()));
    expect(() => resolve(rels, infos(U0, U0), data_of([["VarEqVar", var_(0 as RegionVid), var_(1 as RegionVid)]]))).toThrow(
      /Every constraint should be decomposed into outlives here/,
    );
  });

  test("IndexedConstraintEdges: out-edges in order, in-edges in reverse order (indexed_edges.rs:26)", () => {
    const { var_, early } = setup();
    const [v0, v1] = [var_(0 as RegionVid), var_(1 as RegionVid)];
    const a = early(0);
    const data = data_of([["RegSubVar", a, v0], ["VarSubVar", v0, v1], ["VarSubReg", v0, a], ["RegSubReg", a, a]]);
    const e = IndexedConstraintEdges.build_index(2, data);
    expect(e.adjacent_edges(0 as RegionVid, "Out").map(([c]) => c.kind)).toEqual(["VarSubVar", "VarSubReg"]);
    expect(e.adjacent_edges(0 as RegionVid, "In").map(([c]) => c.kind)).toEqual(["RegSubVar"]);
    expect(e.adjacent_edges(1 as RegionVid, "In").map(([c]) => c.kind)).toEqual(["VarSubVar"]);
    expect(e.adjacent_edges(1 as RegionVid, "Out")).toEqual([]);
    const rev = IndexedConstraintEdges.build_index(1, data_of([["RegSubVar", a, v0], ["RegSubVar", early(1), v0]]));
    expect(rev.adjacent_edges(0 as RegionVid, "In").map(([c]) => c.sub)).toEqual([early(1), a]);
  });
});

// ---- free regions / outlives env ----------------------------------------------------------------------------------------

describe("FreeRegionMap / RegionRelations (free_regions.rs) and OutlivesEnvironment (outlives/env.rs)", () => {
  test("sub_free_regions: reflexive, 'static on the right, the relation otherwise", () => {
    const { tcx, early, re_static } = setup();
    // `'0 <= '1`, `'2 <= '1`, `'static <= '4`
    const b = TransitiveRelationBuilder.default<Region>();
    b.add(early(0), early(1));
    b.add(early(2), early(1));
    b.add(re_static, early(4));
    const m = new FreeRegionMap(b.freeze());
    expect(m.elements()).toEqual([early(0), early(1), early(2), re_static, early(4)]);
    expect(m.is_empty()).toBe(false);
    expect(new FreeRegionMap(empty_relation()).is_empty()).toBe(true);
    expect(m.sub_free_regions(tcx, early(0), re_static)).toBe(true);
    expect(m.sub_free_regions(tcx, early(0), early(1))).toBe(true);
    expect(m.sub_free_regions(tcx, early(1), early(0))).toBe(false);
    // `'static <= '4`, so every region is a sub-region of `'4` (the `check_relation(re_static, r_b)` arm)
    expect(m.sub_free_regions(tcx, early(3), early(4))).toBe(true);
    expect(m.sub_free_regions(tcx, early(4), early(3))).toBe(false);
    expect(() => m.sub_free_regions(tcx, early(0), Region.new_var(tcx, 0 as RegionVid))).toThrow(Panic);
    const rels = RegionRelations.new(tcx, m);
    expect(rels.lub_param_regions(early(0), early(0))).toBe(early(0));
    expect(rels.lub_param_regions(early(0), early(2))).toBe(early(1));
    expect(rels.lub_param_regions(early(1), early(2))).toBe(early(1));
    // `'3` is not in the relation: no upper bound, so `'static`
    expect(rels.lub_param_regions(early(1), early(3))).toBe(re_static);
    expect(() => rels.lub_param_regions(re_static, early(2))).toThrow(Panic);
  });

  test("OutlivesEnvironment: accessors; from_normalized_bounds", () => {
    const { tcx, early } = setup();
    const m = new FreeRegionMap(empty_relation());
    const pairs = new_RegionBoundPairs();
    const kind: GenericKind = { $: "Param", _0: ParamTy.new(0, kw.SelfUpper) };
    pairs.add({ _0: kind, _1: early(0) });
    pairs.add({ _0: { $: "Param", _0: ParamTy.new(0, kw.SelfUpper) }, _1: early(0) }); // equal by value
    expect(pairs.size).toBe(1);
    const hra = new Set<never>();
    const env = new OutlivesEnvironment(undefined as never, m, pairs, [], hra);
    expect(env.free_region_map()).toBe(m);
    expect(env.region_bound_pairs()).toBe(pairs);
    expect(env.known_type_outlives()).toEqual([]);
    expect(env.higher_ranked_assumptions()).toBe(hra);
    // from_normalized_bounds: free-region pairs go into the relation, `R: T` into the region-bound pairs
    const env2 = OutlivesEnvironment.from_normalized_bounds(
      ParamEnv.empty(),
      [],
      [
        { $: "RegionSubRegion", _0: early(0), _1: early(1) },
        { $: "RegionSubParam", _0: early(2), _1: ParamTy.new(0, kw.SelfUpper) },
        { $: "RegionSubRegion", _0: Region.new_var(tcx, 0 as RegionVid), _1: early(1) },
      ],
      hra,
    );
    expect(env2.free_region_map().elements()).toEqual([early(0), early(1)]);
    expect(env2.free_region_map().sub_free_regions(tcx, early(0), early(1))).toBe(true);
    expect([...env2.region_bound_pairs()]).toEqual([{ _0: kind, _1: early(2) }]);
    expect(env2.higher_ranked_assumptions()).toBe(hra);
  });
});

// ---- leak check ---------------------------------------------------------------------------------------------------------

function run_leak_check(s: ReturnType<typeof setup>, outer: UniverseIndex, max: UniverseIndex) {
  const rcc = s.rcc();
  const lc = LeakCheck.new(s.tcx, outer, max, MiniGraph.new(rcc, undefined), rcc);
  const r = lc.assign_placeholder_values();
  if (r.$ === "Err") return r;
  return lc.propagate_scc_value();
}

describe("leak check (region_constraints/leak_check.rs)", () => {
  test("nothing to check when no universe was created", () => {
    const s = setup();
    s.rcc().make_subregion(ORIGIN, s.re_placeholder(U1, 0), s.re_placeholder(U1, 1), "Yes");
    expect(s.rcc().leak_check(s.tcx, U1, U1, undefined)).toEqual({ $: "Ok", _0: null });
  });

  test("otherwise the SCC graph is built and checked: P2: P1 between placeholders is an error", () => {
    const s = setup();
    s.rcc().make_subregion(ORIGIN, s.re_placeholder(U1, 0), s.re_placeholder(U1, 1), "Yes"); // !1: !0 (edge !1 -> !0)
    // post order visits `!0`'s SCC first; `!1`'s SCC then meets its successor's placeholder: placeholder_error(!1, !0)
    expect(s.rcc().leak_check(s.tcx, U0, U1, undefined)).toEqual({
      $: "Err",
      _0: { $: "RegionsInsufficientlyPolymorphic", _0: s.placeholder(U1, 1).bound, _1: s.re_placeholder(U1, 0) },
    });
  });

  test("iterate_region_constraints: R2: R1 gives each_edge(R1, R2); invisible constraints are skipped; snapshot-only", () => {
    const s = setup();
    const v0 = s.var_(s.rcc().new_region_var(U0, MISC));
    const a = s.early(0);
    s.rcc().make_eqregion(ORIGIN, v0, a, "Yes"); // VarEqReg: (v0, a), (a, v0)
    const snap = s.infcx.inner.undo_log.start_snapshot();
    s.rcc().make_subregion(ORIGIN, a, s.re_placeholder(U1, 0), "Yes");
    s.rcc().make_subregion(ORIGIN, s.early(1), s.re_placeholder(U1, 0), "No");
    const all: [Region, Region][] = [];
    MiniGraph.iterate_region_constraints(s.rcc(), undefined, (x, y) => all.push([x, y]));
    expect(all).toEqual([
      [v0, a],
      [a, v0],
      [a, s.re_placeholder(U1, 0)],
    ]);
    const in_snap: [Region, Region][] = [];
    const combined = { undo_snapshot: snap, region_constraints_snapshot: { any_unifications: false }, universe: U0 };
    MiniGraph.iterate_region_constraints(s.rcc(), combined, (x, y) => in_snap.push([x, y]));
    expect(in_snap).toEqual([[a, s.re_placeholder(U1, 0)]]);
    // add_node numbers regions in first-seen order
    const nodes = new Map<Region, LeakCheckNode>();
    expect([MiniGraph.add_node(nodes, a), MiniGraph.add_node(nodes, v0), MiniGraph.add_node(nodes, a)]).toEqual([0, 1, 0] as LeakCheckNode[]);
    expect(LeakCheckNode.debug(1 as LeakCheckNode, PLAIN)).toBe("LeakCheckNode(1)");
  });

  test("R: P1 is fine (R may be 'static)", () => {
    const s = setup();
    const v = s.var_(s.rcc().new_region_var(U0, MISC));
    s.rcc().make_subregion(ORIGIN, s.re_placeholder(U1, 0), v, "Yes"); // v: !0
    expect(run_leak_check(s, U0, U1)).toEqual({ $: "Ok", _0: null });
  });

  test("P1 == P2 in one SCC: placeholder_error from assign_placeholder_values", () => {
    const s = setup();
    s.rcc().make_eqregion(ORIGIN, s.re_placeholder(U1, 0), s.re_placeholder(U1, 1), "Yes"); // RegEqReg
    // The first outlives edge `!0 <= !1` adds `!1` (the source) first, so `!1` is the SCC's placeholder when `!0` is
    // met: `placeholder_error(!1, !0)`.
    expect(run_leak_check(s, U0, U1)).toEqual({
      $: "Err",
      _0: { $: "RegionsInsufficientlyPolymorphic", _0: s.placeholder(U1, 1).bound, _1: s.re_placeholder(U1, 0) },
    });
  });

  test("P1: R with R in a universe that cannot name P1: error naming the region that set the minimum universe", () => {
    const s = setup();
    const v = s.var_(s.rcc().new_region_var(U0, MISC));
    const p = s.re_placeholder(U1, 0);
    s.rcc().make_subregion(ORIGIN, v, p, "Yes"); // !0: v (edge !0 -> v)
    expect(run_leak_check(s, U0, U1)).toEqual({
      $: "Err",
      _0: { $: "RegionsInsufficientlyPolymorphic", _0: s.placeholder(U1, 0).bound, _1: v },
    });
    // the same constraint is fine when the outer universe can name the placeholder
    expect(run_leak_check(s, U1, U2)).toEqual({ $: "Ok", _0: null });
  });

  test("P1: P2 transitively (P1: ?0, ?0: P2): placeholder_error from propagate_scc_value", () => {
    const s = setup();
    const v = s.var_(s.rcc().new_region_var(U1, MISC));
    const pa = s.re_placeholder(U1, 0);
    const pb = s.re_placeholder(U1, 1);
    s.rcc().make_subregion(ORIGIN, v, pa, "Yes"); // !a: ?0
    s.rcc().make_subregion(ORIGIN, pb, v, "Yes"); // ?0: !b
    expect(run_leak_check(s, U0, U1)).toEqual({
      $: "Err",
      _0: { $: "RegionsInsufficientlyPolymorphic", _0: s.placeholder(U1, 0).bound, _1: pb },
    });
  });
});
