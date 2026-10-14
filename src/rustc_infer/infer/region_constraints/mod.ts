// Port of compiler/rustc_infer/src/infer/region_constraints/mod.rs (lane infer-regions).
//
//! See `README.md`.
//
// The types of this file (with their derived Debug / Clone / TypeFoldable) are generated into mod.gen.ts, except the hand
// class `RegionConstraintStorage` (it holds an ena table). The methods of `RegionConstraintCollector`,
// `RegionConstraintData`, `Constraint` and `RegionConstraintStorage` are assigned onto the prototypes (declared in
// ../../decls.ts); `GenericKind` / `VerifyBound` methods live on their companions.
//
// Init order: top-level code here may touch only ../../decls.ts, this file's .gen.ts and other crates; every other
// rustc_infer export is read inside function bodies only.

import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { ParamTy, debug_ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { display_ParamTy } from "../../../rustc_middle/ty/print/pretty.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { debug_BoundTy, debug_Placeholder, type PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import { display_AliasTy } from "../../../rustc_type_ir/ir_print.ts";
import { interner } from "../../../rustc_type_ir/relate.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { RegionVid as RegionVidC, type RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { VisibleForLeakCheck } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy, IsRigid } from "../../../rustc_type_ir/ty_kind.ts";
import { debug_AliasTyKind } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { debug_Region, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type Debug, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, unported, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { InPlace, UnificationTable, type Range, type UnificationTableStorage } from "../../../vendor/ena/unify/mod.ts";
import type { Companions } from "../../decls.ts";
import type { UnificationTable as InferUnificationTable } from "../mod.ts";
import { clone_SubregionOrigin, SubregionOrigin } from "../mod.ts";
import type { RegionVariableOrigin } from "../mod.ts";
import { type InferCtxtUndoLogs, type Snapshot, UndoLog as InferUndoLog } from "../snapshot/undo_log.ts";
import type { RegionUnificationError, RegionVariableValue, RegionVidKey } from "../unify_key.ts";
import { RegionVidKey_from, UnifyKey_RegionVidKey } from "../unify_key.ts";
import * as gen from "./mod.gen.ts";
import {
  type CombineMap,
  type CombineMapType,
  clone_RegionConstraintData,
  clone_RegionVariableInfo,
  Constraint,
  default_RegionConstraintData,
  RegionConstraintCollector,
  RegionConstraintData,
  type RegionSnapshot,
  type RegionVariableInfo,
  type TwoRegions,
  type UndoLog,
  type Verify,
} from "./mod.gen.ts";

export * from "./mod.gen.ts";

// mod leak_check; (loaded by ../../lib.ts)

// rustc-type: compiler/rustc_infer/src/infer/region_constraints/mod.rs:24 RegionConstraintStorage
// PORT: hand class (codegen `hand`): it holds an ena table (`ut::UnificationTableStorage<RegionVidKey>`). `IndexVec`s are
// arrays. `CombineMap` (`FxHashMap<TwoRegions, RegionVid>`) is keyed by a plain struct, so `lubs` / `glbs` are
// `KeyedMap`s on `intern_key` (`new_CombineMap`); the map is never iterated, so hash order does not matter.
export class RegionConstraintStorage {
  constructor(
    /// For each `RegionVid`, the corresponding `RegionVariableOrigin`.
    public var_infos: RegionVariableInfo[],

    public data: RegionConstraintData,

    /// For a given pair of regions (R1, R2), maps to a region R3 that
    /// is designated as their LUB (edges R1 <= R3 and R2 <= R3
    /// exist). This prevents us from making many such regions.
    public lubs: CombineMap,

    /// For a given pair of regions (R1, R2), maps to a region R3 that
    /// is designated as their GLB (edges R3 <= R1 and R3 <= R2
    /// exist). This prevents us from making many such regions.
    public glbs: CombineMap,

    /// When we add a R1 == R2 constraint, we currently add (a) edges
    /// R1 <= R2 and R2 <= R1 and (b) we unify the two regions in this
    /// table. You can then call `opportunistic_resolve_var` early
    /// which will map R1 and R2 to some common region (i.e., either
    /// R1 or R2). This is important when fulfillment, dropck and other such
    /// code is iterating to a fixed point, because otherwise we sometimes
    /// would wind up with a fresh stream of region variables that have been
    /// equated but appear distinct.
    public unification_table: UnificationTableStorage<RegionVidKey, RegionVariableValue, RegionUnificationError>,

    /// a flag set to true when we perform any unifications; this is used
    /// to micro-optimize `take_and_reset_data`
    public any_unifications: boolean,
  ) {}

  /** `#[derive(Default)]` (`InferCtxtInner::new` builds one). */
  static default_(): RegionConstraintStorage {
    return new RegionConstraintStorage(
      [],
      default_RegionConstraintData(),
      new_CombineMap(),
      new_CombineMap(),
      UnificationTable.new(() => InPlace.default(UnifyKey_RegionVidKey, () => undefined)),
      false,
    );
  }
}

/** PORT: an empty `CombineMap` (`FxHashMap<TwoRegions, RegionVid>`): a `KeyedMap` on the derived `Hash` + `Eq`. */
function new_CombineMap(entries?: Iterable<readonly [TwoRegions, RegionVid]>): CombineMap {
  return new KeyedMap<TwoRegions, RegionVid>(intern_key, entries);
}

/** `#[derive(Clone)]` of `RegionConstraintStorage` (a hand type: codegen does not derive its Clone). */
export function clone_RegionConstraintStorage(v: RegionConstraintStorage): RegionConstraintStorage {
  return new RegionConstraintStorage(
    v.var_infos.map(clone_RegionVariableInfo),
    clone_RegionConstraintData(v.data),
    new_CombineMap(v.lubs),
    new_CombineMap(v.glbs),
    v.unification_table.clone((s) => s.clone((l) => l)),
    v.any_unifications,
  );
}

// ---- impl Constraint ----------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:126 involves_placeholders
Constraint.prototype.involves_placeholders = function (this: Constraint): boolean {
  return this.sub.is_placeholder() || this.sup.is_placeholder();
};

// PORT: `impl Iterator<Item = Self>` (`iter::once(..).chain(..)`) is an array of one or two constraints.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:130 iter_outlives
Constraint.prototype.iter_outlives = function (this: Constraint): Constraint[] {
  const { kind, sub, sup, visible_for_leak_check } = this;

  switch (kind) {
    case "VarSubVar":
    case "RegSubVar":
    case "VarSubReg":
    case "RegSubReg":
      return [this];

    case "VarEqVar":
      return [new Constraint("VarSubVar", sub, sup, visible_for_leak_check), new Constraint("VarSubVar", sup, sub, visible_for_leak_check)];
    case "VarEqReg":
      return [new Constraint("VarSubReg", sub, sup, visible_for_leak_check), new Constraint("RegSubVar", sup, sub, visible_for_leak_check)];
    case "RegEqReg":
      return [new Constraint("RegSubReg", sub, sup, visible_for_leak_check), new Constraint("RegSubReg", sup, sub, visible_for_leak_check)];
  }
};

// ---- impl RegionConstraintStorage ---------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:359 with_log
RegionConstraintStorage.prototype.with_log = function (this: RegionConstraintStorage, undo_log: InferCtxtUndoLogs): RegionConstraintCollector {
  return new RegionConstraintCollector(this, undo_log);
};

// ---- impl RegionConstraintCollector -------------------------------------------------------------------------------------

/** `self.undo_log.push(..)` at `UndoLog` (`impl UndoLogs<UndoLog> for InferCtxtUndoLogs`, via `From`). */
function push_undo(self: RegionConstraintCollector, undo: UndoLog): void {
  self.undo_log.as_(InferUndoLog.from_RegionConstraintCollector).push(undo);
}

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:368 num_region_vars
RegionConstraintCollector.prototype.num_region_vars = function (this: RegionConstraintCollector): number {
  return this.storage.var_infos.length;
};

/// Takes (and clears) the current set of constraints. Note that
/// the set of variables remains intact, but all relationships
/// between them are reset. This is used during NLL checking to
/// grab the set of constraints that arose from a particular
/// operation.
///
/// We don't want to leak relationships between variables between
/// points because just because (say) `r1 == r2` was true at some
/// point P in the graph doesn't imply that it will be true at
/// some other point Q, in NLL.
///
/// Not legal during a snapshot.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:384 take_and_reset_data
RegionConstraintCollector.prototype.take_and_reset_data = function (this: RegionConstraintCollector): RegionConstraintData {
  assert(!this.undo_log.as_(InferUndoLog.from_RegionConstraintCollector).in_snapshot(), "assertion failed: !UndoLogs::<UndoLog<'_>>::in_snapshot(&self.undo_log)");

  // If you add a new field to `RegionConstraintCollector`, you
  // should think carefully about whether it needs to be cleared
  // or updated in some way.
  const storage = this.storage;

  // Clear the tables of (lubs, glbs), so that we will create
  // fresh regions if we do a LUB operation. As it happens,
  // LUB/GLB are not performed by the MIR type-checker, which is
  // the one that uses this method, but it's good to be correct.
  storage.lubs.clear();
  storage.glbs.clear();

  // `mem::take(data)`
  const data = storage.data;
  storage.data = default_RegionConstraintData();

  // Clear all unifications and recreate the variables a "now
  // un-unified" state. Note that when we unify `a` and `b`, we
  // also insert `a <= b` and a `b <= a` edges, so the
  // `RegionConstraintData` contains the relationship here.
  if (storage.any_unifications) {
    storage.any_unifications = false;
    // Manually inlined `self.unification_table_mut()` as `self` is used in the closure.
    storage.unification_table
      .with_log(this.undo_log.as_(InferUndoLog.from_RegionUnificationTable))
      .reset_unifications((key) => ({ $: "Unknown", universe: index_var_infos(storage.var_infos, key.vid).universe }));
  }

  return data;
};

/** `var_infos[vid]` (panics out of bounds, as `IndexVec` indexing). */
function index_var_infos(var_infos: readonly RegionVariableInfo[], vid: RegionVid): RegionVariableInfo {
  const i = RegionVidC.as_usize(vid);
  assert(i < var_infos.length, `index out of bounds: the len is ${var_infos.length} but the index is ${i}`);
  return var_infos[i]!;
}

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:424 data
RegionConstraintCollector.prototype.data = function (this: RegionConstraintCollector): RegionConstraintData {
  return this.storage.data;
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:428 start_snapshot
RegionConstraintCollector.prototype.start_snapshot = function (this: RegionConstraintCollector): RegionSnapshot {
  // debug!("RegionConstraintCollector: start_snapshot");
  return { any_unifications: this.storage.any_unifications };
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:433 rollback_to
RegionConstraintCollector.prototype.rollback_to = function (this: RegionConstraintCollector, snapshot: RegionSnapshot): void {
  // debug!("RegionConstraintCollector: rollback_to({:?})", snapshot);
  this.storage.any_unifications = snapshot.any_unifications;
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:438 new_region_var
RegionConstraintCollector.prototype.new_region_var = function (this: RegionConstraintCollector, universe: UniverseIndex, origin: RegionVariableOrigin): RegionVid {
  // `IndexVec::push` returns the index of the new element.
  const vid = RegionVidC.from_usize(this.storage.var_infos.length);
  this.storage.var_infos.push({ origin, universe });

  const u_vid = this.unification_table_mut().new_key({ $: "Unknown", universe });
  assert_eq(vid, u_vid.vid, (v) => RegionVidC.debug(v, PLAIN));
  push_undo(this, { $: "AddVar", _0: vid });
  // debug!("created new region variable {:?} in {:?} with origin {:?}", vid, universe, origin);
  return vid;
};

/// Returns the origin for the given variable.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:453 var_origin
RegionConstraintCollector.prototype.var_origin = function (this: RegionConstraintCollector, vid: RegionVid): RegionVariableOrigin {
  return index_var_infos(this.storage.var_infos, vid).origin;
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:457 add_constraint
RegionConstraintCollector.prototype.add_constraint = function (this: RegionConstraintCollector, constraint: Constraint, origin: SubregionOrigin): void {
  // cannot add constraints once regions are resolved
  // debug!("RegionConstraintCollector: add_constraint({:?})", constraint);

  const index = this.storage.data.constraints.length;
  this.storage.data.constraints.push([constraint, origin]);
  push_undo(this, { $: "AddConstraint", _0: index });
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:466 add_verify
RegionConstraintCollector.prototype.add_verify = function (this: RegionConstraintCollector, verify: Verify): void {
  // cannot add verifys once regions are resolved
  // debug!("RegionConstraintCollector: add_verify({:?})", verify);

  // skip no-op cases known to be satisfied
  if (verify.bound.$ === "AllBounds" && verify.bound._0.length === 0) {
    return;
  }

  const index = this.storage.data.verifys.length;
  this.storage.data.verifys.push(verify);
  push_undo(this, { $: "AddVerify", _0: index });
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:482 make_eqregion
RegionConstraintCollector.prototype.make_eqregion = function (
  this: RegionConstraintCollector,
  origin: SubregionOrigin,
  a: Region,
  b: Region,
  visible_for_leak_check: VisibleForLeakCheck,
): void {
  if (a !== b) {
    // FIXME: We could only emit constraints if `unify_var_{var, value}` fails when
    // equating region vars.
    // PORT: `match (a.kind(), b.kind(), a, b)`, arms in order; the or-patterns bind `(vid, var, reg)` / `(st, reg)`
    // from whichever side matched first.
    const a_kind = a.kind();
    const b_kind = b.kind();
    if (a_kind.$ === "ReBound" || b_kind.$ === "ReBound") {
      span_bug(SubregionOrigin.span(origin), `cannot relate bound region: ${debug_Region(a, PLAIN)} == ${debug_Region(b, PLAIN)}`);
    } else if (a_kind.$ === "ReVar" && b_kind.$ === "ReVar") {
      const a_vid = a_kind._0;
      const b_vid = b_kind._0;
      this.add_constraint(new Constraint("VarEqVar", a, b, visible_for_leak_check), origin);
      // debug!("make_eqregion: unifying {:?} with {:?}", a_vid, b_vid);
      if (this.unification_table_mut().unify_var_var(RegionVidKey_from(a_vid), RegionVidKey_from(b_vid)).$ === "Ok") {
        this.storage.any_unifications = true;
      }
    } else if (a_kind.$ === "ReVar" || b_kind.$ === "ReVar") {
      let vid: RegionVid;
      let var_: Region;
      let reg: Region;
      if (a_kind.$ === "ReVar") {
        vid = a_kind._0;
        var_ = a;
        reg = b;
      } else {
        vid = (b_kind as { _0: RegionVid })._0;
        reg = a;
        var_ = b;
      }
      if (reg.is_static()) {
        // all regions are subregions of static, so don't go bidirectional here
        this.add_constraint(new Constraint("RegSubVar", reg, var_, visible_for_leak_check), origin);
      } else {
        this.add_constraint(new Constraint("VarEqReg", var_, reg, visible_for_leak_check), origin);
      }
      // debug!("make_eqregion: unifying {:?} with {:?}", vid, reg);
      if (this.unification_table_mut().unify_var_value(RegionVidKey_from(vid), { $: "Known", value: reg }).$ === "Ok") {
        this.storage.any_unifications = true;
      }
    } else if (a_kind.$ === "ReStatic" || b_kind.$ === "ReStatic") {
      let st: Region;
      let reg: Region;
      if (a_kind.$ === "ReStatic") {
        st = a;
        reg = b;
      } else {
        reg = a;
        st = b;
      }
      // all regions are subregions of static, so don't go bidirectional here
      this.add_constraint(new Constraint("RegSubReg", st, reg, visible_for_leak_check), origin);
    } else {
      this.add_constraint(new Constraint("RegEqReg", a, b, visible_for_leak_check), origin);
    }
  }
};

// #[instrument(skip(self, origin), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:571 make_subregion
RegionConstraintCollector.prototype.make_subregion = function (
  this: RegionConstraintCollector,
  origin: SubregionOrigin,
  sub: Region,
  sup: Region,
  visible_for_leak_check: VisibleForLeakCheck,
): void {
  // cannot add constraints once regions are resolved
  // debug!("origin = {:#?}", origin);

  const sub_kind = sub.kind();
  const sup_kind = sup.kind();
  if (sub_kind.$ === "ReBound" || sup_kind.$ === "ReBound") {
    span_bug(SubregionOrigin.span(origin), `cannot relate bound region: ${debug_Region(sub, PLAIN)} <= ${debug_Region(sup, PLAIN)}`);
  } else if (sup_kind.$ === "ReStatic") {
    // all regions are subregions of static, so we can ignore this
  } else if (sub_kind.$ === "ReVar" && sup_kind.$ === "ReVar") {
    const sub_id = sub_kind._0;
    const sup_id = sup_kind._0;
    if (sub_id !== sup_id) {
      this.add_constraint(new Constraint("VarSubVar", sub, sup, visible_for_leak_check), origin);
    }
  } else if (sup_kind.$ === "ReVar") {
    this.add_constraint(new Constraint("RegSubVar", sub, sup, visible_for_leak_check), origin);
  } else if (sub_kind.$ === "ReVar") {
    this.add_constraint(new Constraint("VarSubReg", sub, sup, visible_for_leak_check), origin);
  } else {
    if (sub !== sup) {
      this.add_constraint(new Constraint("RegSubReg", sub, sup, visible_for_leak_check), origin);
    }
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:625 verify_generic_bound
RegionConstraintCollector.prototype.verify_generic_bound = function (
  this: RegionConstraintCollector,
  origin: SubregionOrigin,
  kind: gen.GenericKind,
  sub: Region,
  bound: gen.VerifyBound,
): void {
  this.add_verify({ kind, origin, region: sub, bound });
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:635 lub_regions
RegionConstraintCollector.prototype.lub_regions = function (this: RegionConstraintCollector, tcx: TyCtxt, origin: SubregionOrigin, a: Region, b: Region): Region {
  // cannot add constraints once regions are resolved
  // debug!("RegionConstraintCollector: lub_regions({:?}, {:?})", a, b);
  if (a.is_static() || b.is_static()) {
    return a; // nothing lives longer than static
  } else if (a === b) {
    return a; // LUB(a,a) = a
  } else {
    return this.combine_vars(tcx, "Lub", a, b, origin);
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:653 glb_regions
RegionConstraintCollector.prototype.glb_regions = function (this: RegionConstraintCollector, tcx: TyCtxt, origin: SubregionOrigin, a: Region, b: Region): Region {
  // cannot add constraints once regions are resolved
  // debug!("RegionConstraintCollector: glb_regions({:?}, {:?})", a, b);
  if (a.is_static()) {
    return b; // static lives longer than everything else
  } else if (b.is_static()) {
    return a; // static lives longer than everything else
  } else if (a === b) {
    return a; // GLB(a,a) = a
  } else {
    return this.combine_vars(tcx, "Glb", a, b, origin);
  }
};

/// Resolves a region var to its value in the unification table, if it exists.
/// Otherwise, it is resolved to the root `ReVar` in the table.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:675 shallow_resolve_region_var
RegionConstraintCollector.prototype.shallow_resolve_region_var = function (this: RegionConstraintCollector, tcx: TyCtxt, vid: RegionVid): Region {
  const ut = this.unification_table_mut();
  const root_vid = ut.find(RegionVidKey_from(vid)).vid;
  const value = ut.probe_value(RegionVidKey_from(root_vid));
  switch (value.$) {
    case "Known":
      return value.value;
    case "Unknown":
      return Region.new_var(tcx, root_vid);
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:688 try_resolve_region_var
RegionConstraintCollector.prototype.try_resolve_region_var = function (this: RegionConstraintCollector, vid: RegionVid): Result<Region, UniverseIndex> {
  const value = this.unification_table_mut().probe_value(RegionVidKey_from(vid));
  switch (value.$) {
    case "Known":
      return Ok(value.value);
    case "Unknown":
      return Err(value.universe);
  }
};

// PORT: `&mut CombineMap` is the map itself.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:698 combine_map
RegionConstraintCollector.prototype.combine_map = function (this: RegionConstraintCollector, t: CombineMapType): CombineMap {
  switch (t) {
    case "Glb":
      return this.storage.glbs;
    case "Lub":
      return this.storage.lubs;
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:705 combine_vars
RegionConstraintCollector.prototype.combine_vars = function (
  this: RegionConstraintCollector,
  tcx: TyCtxt,
  t: CombineMapType,
  a: Region,
  b: Region,
  origin: SubregionOrigin,
): Region {
  const vars: TwoRegions = { a, b };
  const found = this.combine_map(t).get(vars);
  if (found !== undefined) {
    const c = found;
    return Region.new_var(tcx, c);
  }
  const a_universe = this.universe(a);
  const b_universe = this.universe(b);
  // `cmp::max` (returns the second argument when equal)
  const c_universe = a_universe > b_universe ? a_universe : b_universe;
  const c = this.new_region_var(c_universe, { $: "Misc", _0: SubregionOrigin.span(origin) });
  this.combine_map(t).set(vars, c);
  push_undo(this, { $: "AddCombination", _0: t, _1: vars });
  const new_r = Region.new_var(tcx, c);
  for (const old_r of [a, b]) {
    switch (t) {
      case "Glb":
        this.make_subregion(clone_SubregionOrigin(origin), new_r, old_r, "Yes");
        break;
      case "Lub":
        this.make_subregion(clone_SubregionOrigin(origin), old_r, new_r, "Yes");
        break;
    }
  }
  // debug!("combine_vars() c={:?}", c);
  return new_r;
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:738 universe
RegionConstraintCollector.prototype.universe = function (this: RegionConstraintCollector, region: Region): UniverseIndex {
  const kind = region.kind();
  switch (kind.$) {
    case "ReStatic":
    case "ReErased":
    case "ReLateParam":
    case "ReEarlyParam":
    case "ReError":
      return UniverseIndex.ROOT;
    case "RePlaceholder":
      return kind._0.universe;
    case "ReVar": {
      const r = this.try_resolve_region_var(kind._0);
      switch (r.$) {
        case "Ok":
          return this.universe(r._0);
        case "Err":
          return r._0;
      }
      break;
    }
    case "ReBound":
      return bug(`universe(): encountered bound region ${debug_Region(region, PLAIN)}`);
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:754 vars_since_snapshot
RegionConstraintCollector.prototype.vars_since_snapshot = function (this: RegionConstraintCollector, value_count: number): [Range<RegionVid>, RegionVariableOrigin[]] {
  const range: Range<RegionVid> = { start: RegionVidC.from_usize(value_count), end: RegionVidC.from_usize(this.storage.unification_table.len()) };
  const origins: RegionVariableOrigin[] = [];
  for (let index = RegionVidC.as_usize(range.start); index < RegionVidC.as_usize(range.end); index++) {
    origins.push(index_var_infos(this.storage.var_infos, RegionVidC.from_usize(index)).origin);
  }
  return [{ start: range.start, end: range.end }, origins];
};

/// See `InferCtxt::region_constraints_added_in_snapshot`.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:767 region_constraints_added_in_snapshot
RegionConstraintCollector.prototype.region_constraints_added_in_snapshot = function (this: RegionConstraintCollector, mark: Snapshot): boolean {
  return this.undo_log.region_constraints_in_snapshot(mark).some((elt) => elt.$ === "AddConstraint");
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:774 unification_table_mut
RegionConstraintCollector.prototype.unification_table_mut = function (
  this: RegionConstraintCollector,
): InferUnificationTable<RegionVidKey, RegionVariableValue, RegionUnificationError> {
  return this.storage.unification_table.with_log(this.undo_log.as_(InferUndoLog.from_RegionUnificationTable));
};

// ---- Debug / Display ----------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:780 fmt
export const debug_RegionSnapshot: Debug<RegionSnapshot> = (_v: RegionSnapshot, _f: Fmt) => "RegionSnapshot";

// PORT: `write!(f, "{p:?}")` formats `p` with a fresh `{:?}` spec (no `#` flag), hence `PLAIN`.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:786 fmt
export const debug_GenericKind: Debug<gen.GenericKind> = (v: gen.GenericKind, _f: Fmt) => {
  switch (v.$) {
    case "Param":
      return debug_ParamTy(v._0, PLAIN);
    case "Placeholder":
      return debug_Placeholder(v._0, PLAIN, debug_BoundTy);
    case "Alias":
      return debug_Alias(v._0, PLAIN, debug_AliasTyKind);
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:796 fmt
export function display_GenericKind(v: gen.GenericKind): string {
  switch (v.$) {
    case "Param":
      return display_ParamTy(v._0);
    case "Placeholder":
      return display_PlaceholderType(v._0);
    case "Alias":
      return display_AliasTy(v._0);
  }
}

/**
 * PORT: stand-in for `<ty::PlaceholderType as fmt::Display>::fmt` (rustc_type_ir ir_print.rs:98 through
 * `<TyCtxt as IrPrint<PlaceholderType>>`): rustc_type_ir's `IR_PRINT` registry has no `Placeholder` slot yet and
 * rustc_middle's `forward_display_to_print` is module-private.
 */
function display_PlaceholderType(_p: PlaceholderType): string {
  return unported("<TyCtxt as IrPrint<ty::PlaceholderType>>::print (rustc_type_ir ir_print registry)");
}

// ---- impl GenericKind / VerifyBound (companions) ------------------------------------------------------------------------

export type GenericKind = gen.GenericKind;
export const GenericKind: Companions["GenericKind"] = {
  // rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:806 to_ty
  to_ty(self: GenericKind, tcx: TyCtxt): Ty {
    switch (self.$) {
      case "Param":
        return ParamTy.to_ty(self._0, tcx);
      case "Placeholder":
        return Ty.new_placeholder(tcx, self._0);
      case "Alias":
        return AliasTy.to_ty(self._0, tcx, IsRigid.yes_if_next_solver(interner(tcx)));
    }
  },
};

export type VerifyBound = gen.VerifyBound;
export const VerifyBound = {
  ...gen.VerifyBound,

  // rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:816 must_hold
  must_hold(self: VerifyBound): boolean {
    switch (self.$) {
      case "IfEq":
        return false;
      case "OutlivedBy":
        return self._0.is_static();
      case "IsEmpty":
        return false;
      case "AnyBound":
        return self._0.some((b) => VerifyBound.must_hold(b));
      case "AllBounds":
        return self._0.every((b) => VerifyBound.must_hold(b));
    }
  },

  // rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:826 cannot_hold
  cannot_hold(self: VerifyBound): boolean {
    switch (self.$) {
      case "IfEq":
        return false;
      case "IsEmpty":
        return false;
      case "OutlivedBy":
        return false;
      case "AnyBound":
        return self._0.every((b) => VerifyBound.cannot_hold(b));
      case "AllBounds":
        return self._0.some((b) => VerifyBound.cannot_hold(b));
    }
  },

  // rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:836 or
  or(self: VerifyBound, vb: VerifyBound): VerifyBound {
    if (VerifyBound.must_hold(self) || VerifyBound.cannot_hold(vb)) {
      return self;
    } else if (VerifyBound.cannot_hold(self) || VerifyBound.must_hold(vb)) {
      return vb;
    } else {
      return { $: "AnyBound", _0: [self, vb] };
    }
  },
} as typeof gen.VerifyBound & Companions["VerifyBound"];

// ---- impl RegionConstraintData ------------------------------------------------------------------------------------------

/// Returns `true` if this region constraint data contains no constraints, and `false`
/// otherwise.
// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:850 is_empty
RegionConstraintData.prototype.is_empty = function (this: RegionConstraintData): boolean {
  const { constraints, verifys } = this;
  return constraints.length === 0 && verifys.length === 0;
};

// ---- impl Rollback<UndoLog> for RegionConstraintStorage ----------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/mod.rs:857 reverse
RegionConstraintStorage.prototype.reverse = function (this: RegionConstraintStorage, undo: UndoLog): void {
  switch (undo.$) {
    case "AddVar": {
      const vid = undo._0;
      unwrap(this.var_infos.pop());
      assert_eq(this.var_infos.length, RegionVidC.index(vid), String);
      break;
    }
    case "AddConstraint": {
      const index = undo._0;
      unwrap(this.data.constraints.pop());
      assert_eq(this.data.constraints.length, index, String);
      break;
    }
    case "AddVerify": {
      const index = undo._0;
      this.data.verifys.pop();
      assert_eq(this.data.verifys.length, index, String);
      break;
    }
    case "AddCombination": {
      const regions = undo._1;
      switch (undo._0) {
        case "Glb":
          this.glbs.delete(regions);
          break;
        case "Lub":
          this.lubs.delete(regions);
          break;
      }
      break;
    }
  }
};
