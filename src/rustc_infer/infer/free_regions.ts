// Port of compiler/rustc_infer/src/infer/free_regions.rs (lane infer-regions).
//
//! This module handles the relationships between "free regions", i.e., lifetime parameters.
//! Ordinarily, free regions are unrelated to one another, but they can be related via implied
//! or explicit bounds. In that case, we track the bounds using the `TransitiveRelation` type,
//! and use that to decide when one free region outlives another, and so forth.
//
// `RegionRelations` and `FreeRegionMap` are generated into free_regions.gen.ts; their methods are assigned here.
//
// Init order: top-level code here may touch only ../decls.ts, this file's .gen.ts and other crates.

import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { assert } from "../../std/panic.ts";
import { FreeRegionMap, RegionRelations } from "./free_regions.gen.ts";

export * from "./free_regions.gen.ts";

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
  return [...this.relation.elements()];
};

// rustc: compiler/rustc_infer/src/infer/free_regions.rs:45 is_empty
FreeRegionMap.prototype.is_empty = function (this: FreeRegionMap): boolean {
  return this.relation.is_empty();
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
  return r_a === r_b || this.relation.contains(r_a, r_b);
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
    const r = this.relation.postdom_upper_bound(r_a, r_b);
    result = r === undefined ? tcx.lifetimes.re_static : r;
  }
  // debug!("lub_param_regions(r_a={:?}, r_b={:?}) = {:?}", r_a, r_b, result);
  return result;
};
