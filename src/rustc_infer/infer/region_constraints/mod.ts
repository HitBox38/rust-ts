// Port of compiler/rustc_infer/src/infer/region_constraints/mod.rs (lane infer-regions).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { Constraint, RegionConstraintCollector, RegionConstraintData } from "./mod.gen.ts";
import type { Companions } from "../../decls.ts";
import * as gen from "./mod.gen.ts";

export * from "./mod.gen.ts";

import type { RegionVid } from "../../../rustc_type_ir/decls.ts";
import { InPlace, type NoError, UnificationTable, type UnificationTableStorage } from "../../../vendor/ena/unify/mod.ts";
import { type Debug, type Fmt } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { RegionUnificationError, RegionVariableValue, RegionVidKey } from "../unify_key.ts";
import { UnifyKey_RegionVidKey } from "../unify_key.ts";
import {
  type CombineMap,
  clone_RegionConstraintData,
  clone_RegionVariableInfo,
  default_RegionConstraintData,
  type RegionSnapshot,
  type RegionVariableInfo,
} from "./mod.gen.ts";

// rustc-type: compiler/rustc_infer/src/infer/region_constraints/mod.rs:24 RegionConstraintStorage
// PORT: hand class (codegen `hand`): it holds an ena table (`ut::UnificationTableStorage<RegionVidKey>`). `IndexVec`s are
// arrays. `CombineMap` (`FxHashMap<TwoRegions, RegionVid>`) is keyed by a plain struct: the port of this file must use
// a `KeyedMap` (rust_ts/keyed.ts). `#[derive(Clone)]` (`clone_RegionConstraintStorage`) is written with the port.
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

  /**
   * `#[derive(Default)]` (lane infcx-contract: `InferCtxtInner::new` builds one). PORT: the `CombineMap`s start as plain
   * `Map`s; the port of this file switches them to `KeyedMap`s (see the class comment).
   */
  static default_(): RegionConstraintStorage {
    return new RegionConstraintStorage(
      [],
      default_RegionConstraintData(),
      new Map(),
      new Map(),
      UnificationTable.new(() => InPlace.default(UnifyKey_RegionVidKey, () => undefined)),
      false,
    );
  }
}

/** `#[derive(Clone)]` of `RegionConstraintStorage` (a hand type: codegen does not derive its Clone). */
export function clone_RegionConstraintStorage(v: RegionConstraintStorage): RegionConstraintStorage {
  return new RegionConstraintStorage(
    v.var_infos.map(clone_RegionVariableInfo),
    clone_RegionConstraintData(v.data),
    new Map(v.lubs),
    new Map(v.glbs),
    v.unification_table.clone((s) => s.clone((l) => l)),
    v.any_unifications,
  );
}

// Stubs of the manual `Debug` impls of this file (mod.rs:779 RegionSnapshot, mod.rs:785 GenericKind).
export const debug_RegionSnapshot: Debug<RegionSnapshot> = () =>
  unported("rustc_infer::infer::region_constraints::<RegionSnapshot as Debug>::fmt");
export const debug_GenericKind: Debug<gen.GenericKind> = (_v: gen.GenericKind, _f: Fmt) =>
  unported("rustc_infer::infer::region_constraints::<GenericKind as Debug>::fmt");

/** PORT: type-only names used by the declarations above. */
export type RegionConstraintStorage_unused = RegionVid | NoError;

unported_methods(RegionConstraintCollector.prototype, "rustc_infer::infer::region_constraints::RegionConstraintCollector", ["num_region_vars", "take_and_reset_data", "data", "start_snapshot", "rollback_to", "new_region_var", "var_origin", "add_constraint", "add_verify", "make_eqregion", "make_subregion", "verify_generic_bound", "lub_regions", "glb_regions", "shallow_resolve_region_var", "try_resolve_region_var", "combine_map", "combine_vars", "universe", "vars_since_snapshot", "region_constraints_added_in_snapshot", "unification_table_mut"]);
unported_methods(RegionConstraintData.prototype, "rustc_infer::infer::region_constraints::RegionConstraintData", ["is_empty"]);
unported_methods(Constraint.prototype, "rustc_infer::infer::region_constraints::Constraint", ["involves_placeholders", "iter_outlives"]);
unported_methods(RegionConstraintStorage.prototype, "rustc_infer::infer::region_constraints::RegionConstraintStorage", ["with_log", "reverse"]);

export type GenericKind = gen.GenericKind;
export const GenericKind = {} as Companions["GenericKind"];
unported_methods(GenericKind, "rustc_infer::infer::region_constraints::GenericKind", ["to_ty"]);

export type VerifyBound = gen.VerifyBound;
export const VerifyBound = { ...gen.VerifyBound } as typeof gen.VerifyBound & Companions["VerifyBound"];
unported_methods(VerifyBound, "rustc_infer::infer::region_constraints::VerifyBound", ["must_hold", "cannot_hold", "or"]);
