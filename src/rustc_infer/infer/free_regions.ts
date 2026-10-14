// Port of compiler/rustc_infer/src/infer/free_regions.rs (lane infer-regions).
//
//! This module handles the relationships between "free regions", i.e., lifetime parameters.
//! Ordinarily, free regions are unrelated to one another, but they can be related via implied
//! or explicit bounds. In that case, we track the bounds using the `TransitiveRelation` type,
//! and use that to decide when one free region outlives another, and so forth.
//
// `RegionRelations` and `FreeRegionMap` are generated into free_regions.gen.ts; their methods are assigned here.
//
// PORT: rustc_data_structures `transitive_relation.rs` is not ported (no lane owns it; `TransitiveRelation<T>` is
// rustc_middle ty/decls.ts's `Pending1`). `FreeRegionMap.relation` is seen through the `TransitiveRelation` view below
// (the methods this file calls), as rustc_type_ir region_constraint.ts does. No relation can be built yet
// (`TransitiveRelationBuilder` stops UNPORTED in outlives/env.ts), so these calls reach only relations built elsewhere.
//
// Init order: top-level code here may touch only ../decls.ts, this file's .gen.ts and other crates.

import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TransitiveRelation as TransitiveRelationPending } from "../../rustc_middle/ty/decls.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { assert } from "../../std/panic.ts";
import { FreeRegionMap, RegionRelations } from "./free_regions.gen.ts";

export * from "./free_regions.gen.ts";

/**
 * PORT: the `TransitiveRelation<Region>` methods this file calls (rustc_data_structures transitive_relation.rs, not
 * ported), as a view of the pending relation object.
 */
export interface TransitiveRelationView<T> {
  // transitive_relation.rs `elements`
  elements(): Iterable<T>;
  // transitive_relation.rs `is_empty`
  is_empty(): boolean;
  // transitive_relation.rs `contains`
  contains(a: T, b: T): boolean;
  // transitive_relation.rs `postdom_upper_bound`
  postdom_upper_bound(a: T, b: T): T | undefined;
}

/** `self.relation` through the view. */
function relation(self: FreeRegionMap): TransitiveRelationView<Region> {
  return self.relation as TransitiveRelationPending<Region> as unknown as TransitiveRelationView<Region>;
}

// ---- impl RegionRelations ----------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/free_regions.rs:22 new
(RegionRelations as unknown as { new: typeof RegionRelations.new }).new = function (tcx: TyCtxt, free_regions: FreeRegionMap): RegionRelations {
  return new RegionRelations(tcx, free_regions);
};

// rustc: compiler/rustc_infer/src/infer/free_regions.rs:26 lub_param_regions
RegionRelations.prototype.lub_param_regions = function (this: RegionRelations, r_a: Region, r_b: Region): Region {
  return this.free_regions.lub_param_regions(this.tcx, r_a, r_b);
};

// ---- impl FreeRegionMap ------------------------------------------------------------------------------------------------

// PORT: `impl Iterator<Item = Region>` is an array (the relation's elements, in its order).
// rustc: compiler/rustc_infer/src/infer/free_regions.rs:41 elements
FreeRegionMap.prototype.elements = function (this: FreeRegionMap): Region[] {
  return [...relation(this).elements()];
};

// rustc: compiler/rustc_infer/src/infer/free_regions.rs:45 is_empty
FreeRegionMap.prototype.is_empty = function (this: FreeRegionMap): boolean {
  return relation(this).is_empty();
};

/// Tests whether `r_a <= r_b`.
///
/// Both regions must meet `is_free_or_static`.
///
/// Subtle: one tricky case that this code gets correct is as
/// follows. If we know that `r_b: 'static`, then this function
/// will return true, even though we don't know anything that
/// directly relates `r_a` and `r_b`.
// rustc: compiler/rustc_infer/src/infer/free_regions.rs:57 sub_free_regions
FreeRegionMap.prototype.sub_free_regions = function (this: FreeRegionMap, tcx: TyCtxt, r_a: Region, r_b: Region): boolean {
  assert(r_a.is_free() && r_b.is_free(), "assertion failed: r_a.is_free() && r_b.is_free()");
  const re_static = tcx.lifetimes.re_static;
  if (this.check_relation(re_static, r_b)) {
    // `'a <= 'static` is always true, and not stored in the
    // relation explicitly, so check if `'b` is `'static` (or
    // equivalent to it)
    return true;
  } else {
    return this.check_relation(r_a, r_b);
  }
};

/// Check whether `r_a <= r_b` is found in the relation.
// rustc: compiler/rustc_infer/src/infer/free_regions.rs:76 check_relation
FreeRegionMap.prototype.check_relation = function (this: FreeRegionMap, r_a: Region, r_b: Region): boolean {
  return r_a === r_b || relation(this).contains(r_a, r_b);
};

/// Computes the least-upper-bound of two free regions. In some
/// cases, this is more conservative than necessary, in order to
/// avoid making arbitrary choices. See
/// `TransitiveRelation::postdom_upper_bound` for more details.
// rustc: compiler/rustc_infer/src/infer/free_regions.rs:84 lub_param_regions
FreeRegionMap.prototype.lub_param_regions = function (this: FreeRegionMap, tcx: TyCtxt, r_a: Region, r_b: Region): Region {
  // debug!("lub_param_regions(r_a={:?}, r_b={:?})", r_a, r_b);
  assert(r_a.is_param(), "assertion failed: r_a.is_param()");
  assert(r_b.is_param(), "assertion failed: r_b.is_param()");
  let result: Region;
  if (r_a === r_b) {
    result = r_a;
  } else {
    const r = relation(this).postdom_upper_bound(r_a, r_b);
    result = r === undefined ? tcx.lifetimes.re_static : r;
  }
  // debug!("lub_param_regions(r_a={:?}, r_b={:?}) = {:?}", r_a, r_b, result);
  return result;
};
