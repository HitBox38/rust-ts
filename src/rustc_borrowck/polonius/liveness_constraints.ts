// Port of compiler/rustc_borrowck/src/polonius/liveness_constraints.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `VarianceExtractor` (generated class) implements rustc_type_ir's `TypeRelation` interface with prototype
// methods (precedent rustc_infer infer/relate/type_relating.ts); the provided `relate` forwards to
// `TypeRelation_provided.relate`. `T: Relate<TyCtxt>` parameters take their descriptor last (`d`, as the interface;
// `d_T` for free fns).
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { type Relate, type RelateResult, TypeRelation_provided, type VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { VarianceExtractor } from "./liveness_constraints.gen.ts";
import type { LiveRegionVariances } from "./mod.gen.ts";
export * from "./liveness_constraints.gen.ts";

declare module "./liveness_constraints.gen.ts" {
  interface VarianceExtractor {
    // liveness_constraints.rs:38 (lane bck-polonius)
    record_variance(region: Region, variance: Variance): void;
    // `impl TypeRelation<TyCtxt> for VarianceExtractor`
    // liveness_constraints.rs:86 (lane bck-polonius)
    cx(): TyCtxt;
    // (provided) TypeRelation::relate
    relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
    // liveness_constraints.rs:90 (lane bck-polonius)
    relate_ty_args(a_ty: Ty, _1: Ty, def_id: DefId, a_args: GenericArgsRef, b_args: GenericArgsRef, _5: (args: GenericArgsRef) => Ty): RelateResult<Ty>;
    // liveness_constraints.rs:104 (lane bck-polonius)
    relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
    // liveness_constraints.rs:118 (lane bck-polonius)
    tys(a: Ty, b: Ty): RelateResult<Ty>;
    // liveness_constraints.rs:123 (lane bck-polonius)
    regions(a: Region, b: Region): RelateResult<Region>;
    // liveness_constraints.rs:133 (lane bck-polonius)
    consts(a: Const, b: Const): RelateResult<Const>;
    // liveness_constraints.rs:142 (lane bck-polonius)
    binders<T>(a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
  }
}

/// Record the variance of each region contained within the given value.
// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:12 record_live_region_variance (lane bck-polonius)
export function record_live_region_variance<T>(
  tcx: TyCtxt,
  live_region_variances: LiveRegionVariances,
  universal_regions: UniversalRegions,
  value: T,
  d_T: Relate<T>,
): void {
  return unported("rustc_borrowck::polonius::liveness_constraints::record_live_region_variance");
}

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:38 record_variance (lane bck-polonius)
VarianceExtractor.prototype.record_variance = function (this: VarianceExtractor, region: Region, variance: Variance): void {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::record_variance");
};

// impl<'tcx> TypeRelation<TyCtxt<'tcx>> for VarianceExtractor<'_, 'tcx>

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:86 cx (lane bck-polonius)
VarianceExtractor.prototype.cx = function (this: VarianceExtractor): TyCtxt {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::cx");
};

/** (provided) `TypeRelation::relate` */
VarianceExtractor.prototype.relate = function <T>(this: VarianceExtractor, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:90 relate_ty_args (lane bck-polonius)
VarianceExtractor.prototype.relate_ty_args = function (
  this: VarianceExtractor,
  a_ty: Ty,
  _1: Ty,
  def_id: DefId,
  a_args: GenericArgsRef,
  b_args: GenericArgsRef,
  _5: (args: GenericArgsRef) => Ty,
): RelateResult<Ty> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::relate_ty_args");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:104 relate_with_variance (lane bck-polonius)
VarianceExtractor.prototype.relate_with_variance = function <T>(
  this: VarianceExtractor,
  variance: Variance,
  _info: VarianceDiagInfo,
  a: T,
  b: T,
  d: Relate<T>,
): RelateResult<T> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::relate_with_variance");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:118 tys (lane bck-polonius)
VarianceExtractor.prototype.tys = function (this: VarianceExtractor, a: Ty, b: Ty): RelateResult<Ty> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::tys");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:123 regions (lane bck-polonius)
VarianceExtractor.prototype.regions = function (this: VarianceExtractor, a: Region, b: Region): RelateResult<Region> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::regions");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:133 consts (lane bck-polonius)
VarianceExtractor.prototype.consts = function (this: VarianceExtractor, a: Const, b: Const): RelateResult<Const> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::consts");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness_constraints.rs:142 binders (lane bck-polonius)
VarianceExtractor.prototype.binders = function <T>(this: VarianceExtractor, a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  return unported("rustc_borrowck::polonius::liveness_constraints::VarianceExtractor::binders");
};
