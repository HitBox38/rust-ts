// Port of compiler/rustc_borrowck/src/type_check/free_region_relations.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `UniversalRegionRelations::outlives(fr1, fr2)` is `outlives_()` (field `outlives`, mir-contract decision).
// PORT: the builder's `constraints: &mut Vec<&QueryRegionConstraints>` (`compute_implied_bounds`) is the array, pushed
// in place; `I: IntoIterator<Item = OutlivesBound>` is `Iterable<OutlivesBound>`; `impl Iterator` returns `Iterable`.
import type { TransitiveRelation } from "../../rustc_data_structures/transitive_relation.ts";
import type { QueryRegionConstraints } from "../../rustc_middle/infer/canonical.ts";
import type { OutlivesBound } from "../../rustc_middle/traits/query.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { type CreateResult, UniversalRegionRelations, UniversalRegionRelationsBuilder } from "./free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "./mod.gen.ts";

export * from "./free_region_relations.gen.ts";

declare module "./free_region_relations.gen.ts" {
  interface UniversalRegionRelations {
    // free_region_relations.rs:78 (lane bck-tc-b)
    postdom_upper_bound(fr1: RegionVid, fr2: RegionVid): RegionVid;
    // free_region_relations.rs:91 (lane bck-tc-b)
    non_local_upper_bounds(fr: RegionVid): RegionVid[];
    // free_region_relations.rs:103 (lane bck-tc-b)
    non_local_lower_bounds(fr: RegionVid): RegionVid[];
    // free_region_relations.rs:111 (lane bck-tc-b)
    non_local_bounds(relation: TransitiveRelation<RegionVid>, fr0: RegionVid): RegionVid[];
    // free_region_relations.rs:143 (lane bck-tc-b)
    outlives_(fr1: RegionVid, fr2: RegionVid): boolean;
    // free_region_relations.rs:150 (lane bck-tc-b)
    equal(fr1: RegionVid, fr2: RegionVid): boolean;
    // free_region_relations.rs:156 (lane bck-tc-b)
    regions_outlived_by(fr1: RegionVid): RegionVid[];
    // free_region_relations.rs:161 (lane bck-tc-b)
    known_outlives(): Iterable<[RegionVid, RegionVid]>;
  }
  interface UniversalRegionRelationsBuilder {
    // free_region_relations.rs:180 (lane bck-tc-b)
    relate_universal_regions(fr_a: RegionVid, fr_b: RegionVid): void;
    // free_region_relations.rs:188 (lane bck-tc-b)
    create_old(): CreateResult;
    // free_region_relations.rs:344 (lane bck-tc-b)
    create(): CreateResult;
    // free_region_relations.rs:462 (lane bck-tc-b)
    compute_implied_bounds(body_def_id: LocalDefId, span: Span, unnormalized_inputs_and_output: Ty[], constraints: QueryRegionConstraints[]): Ty[];
    // free_region_relations.rs:545 (lane bck-tc-b)
    add_implied_bounds(ty: Ty, span: Span): QueryRegionConstraints | undefined;
    // free_region_relations.rs:566 (lane bck-tc-b)
    add_outlives_bounds(outlives_bounds: Iterable<OutlivesBound>): void;
  }
}

// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:56 create (lane bck-tc-b)
export function create(infcx: BorrowckInferCtxt, universal_regions: UniversalRegions, constraints: MirTypeckRegionConstraints): CreateResult {
  return unported("rustc_borrowck::type_check::free_region_relations::create");
}

// ---- impl UniversalRegionRelations<'_> ----

/// Given two universal regions, returns the postdominating
/// upper-bound (effectively the least upper bound).
///
/// (See `TransitiveRelation::postdom_upper_bound` for details on
/// the postdominating upper bound in general.)
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:78 postdom_upper_bound (lane bck-tc-b)
UniversalRegionRelations.prototype.postdom_upper_bound = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): RegionVid {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::postdom_upper_bound");
};

/// Finds an "upper bound" for `fr` that is not local. In other
/// words, returns the smallest (*) known region `fr1` that (a)
/// outlives `fr` and (b) is not local.
///
/// (*) If there are multiple competing choices, we return all of them.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:91 non_local_upper_bounds (lane bck-tc-b)
UniversalRegionRelations.prototype.non_local_upper_bounds = function (this: UniversalRegionRelations, fr: RegionVid): RegionVid[] {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::non_local_upper_bounds");
};

/// Finds a "lower bound" for `fr` that is not local. In other
/// words, returns the largest (*) known region `fr1` that (a) is
/// outlived by `fr` and (b) is not local.
///
/// (*) If there are multiple competing choices, we return all of them.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:103 non_local_lower_bounds (lane bck-tc-b)
UniversalRegionRelations.prototype.non_local_lower_bounds = function (this: UniversalRegionRelations, fr: RegionVid): RegionVid[] {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::non_local_lower_bounds");
};

/// Helper for `non_local_upper_bounds` and `non_local_lower_bounds`.
/// Repeatedly invokes `postdom_parent` until we find something that is not
/// local. Returns `None` if we never do so.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:111 non_local_bounds (lane bck-tc-b)
UniversalRegionRelations.prototype.non_local_bounds = function (this: UniversalRegionRelations, relation: TransitiveRelation<RegionVid>, fr0: RegionVid): RegionVid[] {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::non_local_bounds");
};

/// Returns `true` if fr1 is known to outlive fr2.
///
/// This will only ever be true for universally quantified regions.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:143 outlives (lane bck-tc-b)
UniversalRegionRelations.prototype.outlives_ = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): boolean {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::outlives");
};

/// Returns `true` if fr1 is known to equal fr2.
///
/// This will only ever be true for universally quantified regions.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:150 equal (lane bck-tc-b)
UniversalRegionRelations.prototype.equal = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): boolean {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::equal");
};

/// Returns a vector of free regions `x` such that `fr1: x` is
/// known to hold.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:156 regions_outlived_by (lane bck-tc-b)
UniversalRegionRelations.prototype.regions_outlived_by = function (this: UniversalRegionRelations, fr1: RegionVid): RegionVid[] {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::regions_outlived_by");
};

/// Returns the _non-transitive_ set of known `outlives` constraints between free regions.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:161 known_outlives (lane bck-tc-b)
UniversalRegionRelations.prototype.known_outlives = function (this: UniversalRegionRelations): Iterable<[RegionVid, RegionVid]> {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelations::known_outlives");
};

// ---- impl<'tcx> UniversalRegionRelationsBuilder<'_, 'tcx> ----

/// Records in the `outlives_relation` (and
/// `inverse_outlives_relation`) that `fr_a: fr_b`.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:180 relate_universal_regions (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.relate_universal_regions = function (this: UniversalRegionRelationsBuilder, fr_a: RegionVid, fr_b: RegionVid): void {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::relate_universal_regions");
};

// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:188 create_old (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.create_old = function (this: UniversalRegionRelationsBuilder): CreateResult {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::create_old");
};

// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:344 create (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.create = function (this: UniversalRegionRelationsBuilder): CreateResult {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::create");
};

/// Computes the implied bounds for the current body by using a separate query.
/// This is necessary as we need to make sure that all implied bounds are checked
/// by the user of this item.
///
/// If we're a defining scope but can be used by caller which does not define the
/// same opaques, we must not get any assumptions from the hidden type of an opaque
/// type in our signature. We avoid this by computing implied bounds in a different
/// context which cannot normalize opaque types if we're in a typeck root.
///
/// This also returns the function signature as normalized in that separate environment
/// which we then renormalize. This is necessary to correctly handle implied bounds
/// involving unconstrained regions due to #136547.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:462 compute_implied_bounds (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.compute_implied_bounds = function (
  this: UniversalRegionRelationsBuilder,
  body_def_id: LocalDefId,
  span: Span,
  unnormalized_inputs_and_output: Ty[],
  constraints: QueryRegionConstraints[],
): Ty[] {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::compute_implied_bounds");
};

// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:545 add_implied_bounds (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.add_implied_bounds = function (this: UniversalRegionRelationsBuilder, ty: Ty, span: Span): QueryRegionConstraints | undefined {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::add_implied_bounds");
};

/// Registers the `OutlivesBound` items from `outlives_bounds` in
/// the outlives relation as well as the region-bound pairs
/// listing.
// stub: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:566 add_outlives_bounds (lane bck-tc-b)
UniversalRegionRelationsBuilder.prototype.add_outlives_bounds = function (this: UniversalRegionRelationsBuilder, outlives_bounds: Iterable<OutlivesBound>): void {
  return unported("rustc_borrowck::type_check::free_region_relations::UniversalRegionRelationsBuilder::add_outlives_bounds");
};
