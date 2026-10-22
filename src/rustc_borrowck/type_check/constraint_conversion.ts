// Port of compiler/rustc_borrowck/src/type_check/constraint_conversion.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `impl TypeOutlivesDelegate for &'a mut ConstraintConversion` is implemented by `ConstraintConversion`'s prototype
// (rustc_infer outlives/obligations.ts's `TypeOutlivesDelegate` interface; `&mut` is the object itself).
// PORT: `higher_ranked_assumptions: &FxHashSet<ty::ArgOutlivesClause>` is a `Set` (a `KeyedSet` at construction);
// `T: TypeFoldable` adds `d_T`.
import type { QueryRegionConstraints } from "../../rustc_middle/infer/canonical.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import type { SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import type { GenericKind, VerifyBound } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import type { GenericArgs, Region } from "../../rustc_middle/ty/decls.ts";
import type { ArgOutlivesClause, PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "../lib.gen.ts";
import type { TypeTest } from "../region_infer/mod.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { ConstraintConversion } from "./constraint_conversion.gen.ts";
import type { Locations, MirTypeckRegionConstraints } from "./mod.gen.ts";

export * from "./constraint_conversion.gen.ts";

declare module "./constraint_conversion.gen.ts" {
  interface ConstraintConversion {
    // constraint_conversion.rs:69 (lane bck-tc-b)
    convert_all(query_constraints: QueryRegionConstraints): void;
    // constraint_conversion.rs:85 (lane bck-tc-b)
    apply_closure_requirements(closure_requirements: ClosureRegionRequirements, closure_def_id: LocalDefId, closure_args: GenericArgs): void;
    // constraint_conversion.rs:125 (lane bck-tc-b)
    convert(clause: ArgOutlivesClause, constraint_category: ConstraintCategory, higher_ranked_assumptions: Set<ArgOutlivesClause>): void;
    // constraint_conversion.rs:187 (lane bck-tc-b)
    replace_placeholders_with_nll<T>(value: T, d_T: TypeFoldable<T>): T;
    // constraint_conversion.rs:200 (lane bck-tc-b)
    verify_to_type_test(generic_kind: GenericKind, region: Region, verify_bound: VerifyBound): TypeTest;
    // constraint_conversion.rs:210 (lane bck-tc-b)
    to_region_vid(r: Region): RegionVid;
    // constraint_conversion.rs:218 (lane bck-tc-b)
    add_outlives(sup: RegionVid, sub: RegionVid, category: ConstraintCategory, span: Span): void;
    // constraint_conversion.rs:240 (lane bck-tc-b)
    add_type_test(type_test: TypeTest): void;

    // `impl TypeOutlivesDelegate for &'a mut ConstraintConversion` (constraint_conversion.rs:246)
    // constraint_conversion.rs:247 (lane bck-tc-b)
    push_sub_region_constraint(origin: SubregionOrigin, a: Region, b: Region, constraint_category: ConstraintCategory): void;
    // constraint_conversion.rs:259 (lane bck-tc-b)
    push_verify(_origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void;
  }
  namespace ConstraintConversion {
    // constraint_conversion.rs:45 (lane bck-tc-b)
    function new_(
      infcx: BorrowckInferCtxt,
      universal_regions: UniversalRegions,
      region_bound_pairs: RegionBoundPairs,
      known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
      locations: Locations,
      span: Span,
      category: ConstraintCategory,
      constraints: MirTypeckRegionConstraints,
    ): ConstraintConversion;
    export { new_ as new };
  }
}

// ---- impl<'a, 'tcx> ConstraintConversion<'a, 'tcx> ----

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:45 new (lane bck-tc-b)
(ConstraintConversion as unknown as { new: typeof ConstraintConversion.new }).new = function (
  infcx: BorrowckInferCtxt,
  universal_regions: UniversalRegions,
  region_bound_pairs: RegionBoundPairs,
  known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
  locations: Locations,
  span: Span,
  category: ConstraintCategory,
  constraints: MirTypeckRegionConstraints,
): ConstraintConversion {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::new");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:69 convert_all (lane bck-tc-b)
ConstraintConversion.prototype.convert_all = function (this: ConstraintConversion, query_constraints: QueryRegionConstraints): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::convert_all");
};

/// Given an instance of the closure type, this method instantiates the "extra" requirements
/// that we computed for the closure. This has the effect of adding new outlives obligations
/// to existing region variables in `closure_args`.
// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:85 apply_closure_requirements (lane bck-tc-b)
ConstraintConversion.prototype.apply_closure_requirements = function (
  this: ConstraintConversion,
  closure_requirements: ClosureRegionRequirements,
  closure_def_id: LocalDefId,
  closure_args: GenericArgs,
): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::apply_closure_requirements");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:125 convert (lane bck-tc-b)
ConstraintConversion.prototype.convert = function (
  this: ConstraintConversion,
  clause: ArgOutlivesClause,
  constraint_category: ConstraintCategory,
  higher_ranked_assumptions: Set<ArgOutlivesClause>,
): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::convert");
};

/// Placeholder regions need to be converted eagerly because it may
/// create new region variables, which we must not do when verifying
/// our region bounds.
///
/// FIXME: This should get removed once higher ranked region obligations
/// are dealt with during trait solving.
// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:187 replace_placeholders_with_nll (lane bck-tc-b)
ConstraintConversion.prototype.replace_placeholders_with_nll = function <T>(this: ConstraintConversion, value: T, d_T: TypeFoldable<T>): T {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::replace_placeholders_with_nll");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:200 verify_to_type_test (lane bck-tc-b)
ConstraintConversion.prototype.verify_to_type_test = function (this: ConstraintConversion, generic_kind: GenericKind, region: Region, verify_bound: VerifyBound): TypeTest {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::verify_to_type_test");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:210 to_region_vid (lane bck-tc-b)
ConstraintConversion.prototype.to_region_vid = function (this: ConstraintConversion, r: Region): RegionVid {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::to_region_vid");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:218 add_outlives (lane bck-tc-b)
ConstraintConversion.prototype.add_outlives = function (this: ConstraintConversion, sup: RegionVid, sub: RegionVid, category: ConstraintCategory, span: Span): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::add_outlives");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:240 add_type_test (lane bck-tc-b)
ConstraintConversion.prototype.add_type_test = function (this: ConstraintConversion, type_test: TypeTest): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::add_type_test");
};

// ---- impl<'a, 'b, 'tcx> TypeOutlivesDelegate<'tcx> for &'a mut ConstraintConversion<'b, 'tcx> ----

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:247 push_sub_region_constraint (lane bck-tc-b)
ConstraintConversion.prototype.push_sub_region_constraint = function (
  this: ConstraintConversion,
  origin: SubregionOrigin,
  a: Region,
  b: Region,
  constraint_category: ConstraintCategory,
): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::push_sub_region_constraint");
};

// stub: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:259 push_verify (lane bck-tc-b)
ConstraintConversion.prototype.push_verify = function (this: ConstraintConversion, _origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void {
  return unported("rustc_borrowck::type_check::constraint_conversion::ConstraintConversion::push_verify");
};
