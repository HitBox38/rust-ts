// Port of compiler/rustc_borrowck/src/polonius/liveness_constraints.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `VarianceExtractor` (generated class) implements rustc_type_ir's `TypeRelation` interface with prototype
// methods (precedent rustc_infer infer/relate/type_relating.ts); the provided `relate` forwards to
// `TypeRelation_provided.relate`. `T: Relate<TyCtxt>` parameters take their descriptor last (`d`, as the interface;
// `d_T` for free fns).
import { IndexVec } from "../../rustc_index/vec.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { debug_TypeError } from "../../rustc_type_ir/error.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import {
  interner,
  type Relate,
  type RelateResult,
  relate_args_with_variances,
  structurally_relate_consts,
  structurally_relate_tys,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../../rustc_type_ir/relate.ts";
import { type Const, debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Region, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { assert_eq } from "../../std/panic.ts";
import { expect_result, Ok } from "../../std/result.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { VarianceExtractor } from "./liveness_constraints.gen.ts";
import type { ConstraintDirection, LiveRegionVariances } from "./mod.gen.ts";
export * from "./liveness_constraints.gen.ts";

declare module "./liveness_constraints.gen.ts" {
  interface VarianceExtractor {
    // liveness_constraints.rs:38
    record_variance(region: Region, variance: Variance): void;
    // `impl TypeRelation<TyCtxt> for VarianceExtractor`
    // liveness_constraints.rs:86
    cx(): TyCtxt;
    // (provided) TypeRelation::relate
    relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
    // liveness_constraints.rs:90
    relate_ty_args(a_ty: Ty, _1: Ty, def_id: DefId, a_args: GenericArgsRef, b_args: GenericArgsRef, _5: (args: GenericArgsRef) => Ty): RelateResult<Ty>;
    // liveness_constraints.rs:104
    relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
    // liveness_constraints.rs:118
    tys(a: Ty, b: Ty): RelateResult<Ty>;
    // liveness_constraints.rs:123
    regions(a: Region, b: Region): RelateResult<Region>;
    // liveness_constraints.rs:133
    consts(a: Const, b: Const): RelateResult<Const>;
    // liveness_constraints.rs:142
    binders<T>(a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
  }
}

/// Record the variance of each region contained within the given value.
// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:12 record_live_region_variance
export function record_live_region_variance<T>(
  tcx: TyCtxt,
  live_region_variances: LiveRegionVariances,
  universal_regions: UniversalRegions,
  value: T,
  d_T: Relate<T>,
): void {
  const extractor = new VarianceExtractor(tcx, Variance.Covariant, live_region_variances, universal_regions);
  expect_result(extractor.relate(value, value, d_T), "Can't have a type error relating to itself", debug_TypeError);
}

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:38 record_variance
VarianceExtractor.prototype.record_variance = function (this: VarianceExtractor, region: Region, variance: Variance): void {
  // We're only interested in the variance of vars and free regions.
  //
  // Note: even if we currently bail for two cases of unexpected region kinds here, missing
  // variance data is not a soundness problem: the regions with missing variance will still be
  // present in the constraint graph as they are live, and liveness edges construction has a
  // fallback for this case.
  //
  // FIXME: that being said, we need to investigate these cases better to not ignore regions
  // in general.
  if (region.is_bound()) {
    // We ignore these because they cannot be turned into the vids we need.
    return;
  }

  if (region.is_erased()) {
    // These cannot be turned into a vid either, and we also ignore them: the fact that they
    // show up here looks like either an issue upstream or a combination with unexpectedly
    // continuing compilation too far when we're in a tainted by errors situation.
    //
    // FIXME: investigate the `generic_const_exprs` test that triggers this issue,
    // `ui/const-generics/generic_const_exprs/issue-97047-ice-2.rs`
    return;
  }

  let direction: ConstraintDirection;
  switch (variance) {
    case "Covariant":
      direction = "Forward";
      break;
    case "Contravariant":
      direction = "Backward";
      break;
    case "Invariant":
      direction = "Bidirectional";
      break;
    case "Bivariant":
      // We don't add edges for bivariant cases.
      return;
  }

  const region_ = this.universal_regions.to_region_vid(region);
  // PORT: `ensure_contains_elem` returns `&mut Option<ConstraintDirection>`; the slot is written back by index.
  const entry = IndexVec.ensure_contains_elem<RegionVid, ConstraintDirection | undefined>(this.directions, region_, () => undefined);
  // If there's already a recorded direction for this region, we combine the two:
  // - combining the same direction is idempotent
  // - combining different directions is trivially bidirectional
  this.directions[region_] = entry !== undefined && entry !== direction ? "Bidirectional" : direction;
};

// impl<'tcx> TypeRelation<TyCtxt<'tcx>> for VarianceExtractor<'_, 'tcx>

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:86 cx
VarianceExtractor.prototype.cx = function (this: VarianceExtractor): TyCtxt {
  return this.tcx;
};

/** (provided) `TypeRelation::relate` */
VarianceExtractor.prototype.relate = function <T>(this: VarianceExtractor, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:90 relate_ty_args
VarianceExtractor.prototype.relate_ty_args = function (
  this: VarianceExtractor,
  a_ty: Ty,
  _1: Ty,
  def_id: DefId,
  a_args: GenericArgsRef,
  b_args: GenericArgsRef,
  _5: (args: GenericArgsRef) => Ty,
): RelateResult<Ty> {
  const variances = interner(this.cx()).variances_of(def_id);
  const r = relate_args_with_variances(this, variances, a_args, b_args);
  if (r.$ === "Err") return r;
  return Ok(a_ty);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:104 relate_with_variance
VarianceExtractor.prototype.relate_with_variance = function <T>(
  this: VarianceExtractor,
  variance: Variance,
  _info: VarianceDiagInfo,
  a: T,
  b: T,
  d: Relate<T>,
): RelateResult<T> {
  const old_ambient_variance = this.ambient_variance;
  this.ambient_variance = Variance.xform(this.ambient_variance, variance);
  const r = this.relate(a, b, d);
  if (r.$ === "Err") return r;
  this.ambient_variance = old_ambient_variance;
  return Ok(r._0);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:118 tys
VarianceExtractor.prototype.tys = function (this: VarianceExtractor, a: Ty, b: Ty): RelateResult<Ty> {
  assert_eq(a, b, (v) => format_debug(v, debug_Ty, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==
  return structurally_relate_tys(this, a, b);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:123 regions
VarianceExtractor.prototype.regions = function (this: VarianceExtractor, a: Region, b: Region): RelateResult<Region> {
  assert_eq(a, b, (v) => format_debug(v, debug_Region, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==
  this.record_variance(a, this.ambient_variance);
  return Ok(a);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:133 consts
VarianceExtractor.prototype.consts = function (this: VarianceExtractor, a: Const, b: Const): RelateResult<Const> {
  assert_eq(a, b, (v) => format_debug(v, debug_Const, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==
  return structurally_relate_consts(this, a, b);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:142 binders
VarianceExtractor.prototype.binders = function <T>(this: VarianceExtractor, a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  const r = this.relate(Binder.skip_binder(a), Binder.skip_binder(a), d);
  if (r.$ === "Err") return r;
  return Ok(a);
};
