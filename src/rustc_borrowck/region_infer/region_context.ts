// Port of compiler/rustc_borrowck/src/region_infer/region_context.rs (lane borrowck-contract: declarations and the
// `Deref` glue; fill lane bck-regions-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Deref<Target = RegionInferenceContextInner>` of `RegionInferenceContext` and `Deref` / `DerefMut` of
// `UnsolvedRegionInferenceContext` are the field `inner` + rust_ts/deref.ts forwarders (`register_deref` below; the
// crate root calls `install_derefs()`); `Frozen<RegionInferenceContextInner>` is the inner value. The TS side is
// `interface RegionInferenceContext extends Omit<RegionInferenceContextInner, RegionInferenceContext_shadowed>`.
// Other files (graphviz.rs, dump_mir.rs, opaque_types/mod.rs, diagnostics/region_errors.rs, diagnostics/var_name.rs)
// add `impl RegionInferenceContext` methods by augmenting region_context.gen.ts.
// PORT: `constraint_sccs()` / `liveness_constraints()` are `constraint_sccs_()` / `liveness_constraints_()`: the
// fields of `RegionInferenceContextInner` have the same names.
// PORT: `Option<&mut Vec<ClosureOutlivesRequirement>>` is the vector or `undefined`; `&mut Option<&mut Vec<..>>` is a
// `MutRef` of it. `impl Fn(RegionVid) -> bool` is an arrow fn. `T: TypeFoldable` adds the descriptor `d_T` last.
import type { ConstraintSccIndex, OutlivesConstraint } from "../constraints/mod.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { UniverseInfo } from "../diagnostics/bound_region_errors.gen.ts";
import type { RegionErrors } from "../diagnostics/region_errors.gen.ts";
import type { LoweredConstraints } from "../handle_placeholders.gen.ts";
import type {
  BorrowckInferCtxt,
  ClosureOutlivesRequirement,
  ClosureOutlivesSubject,
  ClosureRegionRequirements,
} from "../lib.gen.ts";
import type { PoloniusOutput } from "../polonius/legacy/facts.gen.ts";
import type { UniversalRegionRelations } from "../type_check/free_region_relations.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { BestBlame, ConstraintSccs, RegionDefinition, RegionRelationCheckResult, TypeTest } from "./mod.gen.ts";
import type { LivenessValues, RegionElement } from "./values.gen.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import type { VerifyBound, VerifyIfEq } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { BasicBlock, Body, Location } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import type { Binder, PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { register_deref } from "../../rust_ts/deref.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import { RegionInferenceContext, RegionInferenceContextInner, UnsolvedRegionInferenceContext } from "./region_context.gen.ts";

export * from "./region_context.gen.ts";

/** Members of `RegionInferenceContextInner` that `RegionInferenceContext` declares itself (shadowing the forwarders). */
export type RegionInferenceContext_shadowed = never;
/** Members of `RegionInferenceContextInner` that `UnsolvedRegionInferenceContext` declares itself. */
export type UnsolvedRegionInferenceContext_shadowed = never;

declare module "./region_context.gen.ts" {
  interface RegionInferenceContext extends Omit<RegionInferenceContextInner, RegionInferenceContext_shadowed> {
    // region_context.rs:92 (Deref)
    deref(): RegionInferenceContextInner;
    // region_context.rs:255 (lane bck-regions-a)
    region_contains_point(r: RegionVid, p: Location): boolean;
    // region_context.rs:261 (lane bck-regions-a)
    first_non_contained_inclusive(r: RegionVid, block: BasicBlock, start: number, end: number): number | undefined;
  }
  namespace RegionInferenceContext {
    // region_context.rs:105 (lane bck-regions-a)
    function solve(
      infcx: BorrowckInferCtxt,
      lowered_constraints: LoweredConstraints,
      universal_region_relations: UniversalRegionRelations,
      location_map: DenseLocationMap,
      body: Body,
      polonius_output: PoloniusOutput | undefined,
    ): [RegionInferenceContext, ClosureRegionRequirements | undefined, RegionErrors];
  }
  interface UnsolvedRegionInferenceContext extends Omit<RegionInferenceContextInner, UnsolvedRegionInferenceContext_shadowed> {
    // region_context.rs:284 (Deref)
    deref(): RegionInferenceContextInner;
    // region_context.rs:290 (DerefMut)
    deref_mut(): RegionInferenceContextInner;
    // region_context.rs:861 (lane bck-regions-a)
    propagate_constraints(): void;
    // region_context.rs:888 (lane bck-regions-a)
    can_name_all_placeholders(scc_a: ConstraintSccIndex, scc_b: ConstraintSccIndex): boolean;
    // region_context.rs:900 (lane bck-regions-a)
    check_type_tests(
      infcx: InferCtxt,
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1011 (lane bck-regions-a)
    try_promote_type_test(
      infcx: InferCtxt,
      type_test: TypeTest,
      propagated_outlives_requirements: ClosureOutlivesRequirement[],
    ): boolean;
    // region_context.rs:1094 (lane bck-regions-a)
    try_promote_type_test_subject(infcx: InferCtxt, ty: Ty): ClosureOutlivesSubject | undefined;
    // region_context.rs:1135 (lane bck-regions-a)
    eval_verify_bound(infcx: InferCtxt, generic_ty: Ty, lower_bound: RegionVid, verify_bound: VerifyBound): boolean;
    // region_context.rs:1169 (lane bck-regions-a)
    eval_if_eq(infcx: InferCtxt, generic_ty: Ty, lower_bound: RegionVid, verify_if_eq_b: Binder<VerifyIfEq>): boolean;
    // region_context.rs:1219 (lane bck-regions-a)
    normalize_to_scc_representatives<T>(tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T;
    // region_context.rs:1235 (lane bck-regions-a)
    eval_equal(r1: RegionVid, r2: RegionVid): boolean;
    // region_context.rs:1244 (lane bck-regions-a)
    eval_outlives(sup_region: RegionVid, sub_region: RegionVid): boolean;
    // region_context.rs:1331 (lane bck-regions-a)
    check_universal_regions(
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1382 (lane bck-regions-a)
    check_polonius_subset_errors(
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
      polonius_output: PoloniusOutput,
    ): void;
    // region_context.rs:1472 (lane bck-regions-a)
    check_universal_region(
      longer_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1534 (lane bck-regions-a)
    check_universal_region_relation(
      longer_fr: RegionVid,
      shorter_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
    ): RegionRelationCheckResult;
    // region_context.rs:1560 (lane bck-regions-a)
    try_propagate_universal_region_error(
      longer_fr: RegionVid,
      shorter_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
    ): RegionRelationCheckResult;
    // region_context.rs:1654 (lane bck-regions-a)
    check_bound_universal_region(longer_fr: RegionVid, placeholder: PlaceholderRegion, errors_buffer: RegionErrors): void;
    // region_context.rs:1685 (lane bck-regions-a)
    region_from_element(longer_fr: RegionVid, element: RegionElement): RegionVid;
    // region_context.rs:1712 (lane bck-regions-a)
    scc_representative(scc: ConstraintSccIndex): RegionVid;
  }
  interface RegionInferenceContextInner {
    // region_context.rs:297 (lane bck-regions-a)
    regions(): Iterable<RegionVid>;
    // region_context.rs:307 (lane bck-regions-a)
    to_region_vid(r: Region): RegionVid;
    // region_context.rs:312 (lane bck-regions-a)
    outlives_constraints(): Iterable<OutlivesConstraint>;
    // region_context.rs:317 (lane bck-regions-a)
    annotate(tcx: TyCtxt, err: Diag): void;
    // region_context.rs:322 (lane bck-regions-a)
    region_value_str(r: RegionVid): string;
    // region_context.rs:327 (lane bck-regions-a)
    placeholders_contained_in(r: RegionVid): Iterable<PlaceholderRegion>;
    // region_context.rs:347 (lane bck-regions-a)
    approx_universal_upper_bound(r: RegionVid): RegionVid;
    // region_context.rs:387 (lane bck-regions-a)
    max_nameable_universe(scc: ConstraintSccIndex): UniverseIndex;
    // region_context.rs:391 (lane bck-regions-a)
    constraint_path_between_regions(from_region: RegionVid, to_region: RegionVid): OutlivesConstraint[] | undefined;
    // region_context.rs:412 (lane bck-regions-a)
    constraint_path_to(
      from_region: RegionVid,
      target_test: (a0: RegionVid) => boolean,
      include_placeholder_static: boolean,
    ): [OutlivesConstraint[], RegionVid] | undefined;
    // region_context.rs:446 (lane bck-regions-a)
    find_constraint_path_between_regions_inner(
      ignore_opaque_type_constraints: boolean,
      from_region: RegionVid,
      target_test: (a0: RegionVid) => boolean,
      include_placeholder_static: boolean,
    ): [OutlivesConstraint[], RegionVid] | undefined;
    // region_context.rs:563 (lane bck-regions-a)
    find_sub_region_live_at(fr1: RegionVid, location: Location): RegionVid;
    // region_context.rs:573 (lane bck-regions-a)
    region_definition(r: RegionVid): RegionDefinition;
    // region_context.rs:578 (lane bck-regions-a)
    upper_bound_in_region_scc(r: RegionVid, upper: RegionVid): boolean;
    // region_context.rs:583 (lane bck-regions-a)
    universal_regions(): UniversalRegions;
    // region_context.rs:594 (lane bck-regions-a)
    best_blame_constraint(from_region: RegionVid, from_region_origin: NllRegionVariableOrigin, to_region: RegionVid): BestBlame;
    // region_context.rs:802 (lane bck-regions-a)
    universe_info(universe: UniverseIndex): UniverseInfo;
    // region_context.rs:815 (lane bck-regions-a)
    find_loop_terminator_location(r: RegionVid, body: Body): Location | undefined;
    // region_context.rs:838 (lane bck-regions-a); `constraint_sccs_`: the field `constraint_sccs` has the same name
    constraint_sccs_(): ConstraintSccs;
    // region_context.rs:842 (lane bck-regions-a); `liveness_constraints_`: the field has the same name
    liveness_constraints_(): LivenessValues;
    // region_context.rs:849 (lane bck-regions-a)
    is_loan_live_at(loan_idx: BorrowIndex, location: Location): boolean;
  }
}

register_deref(RegionInferenceContext, "inner", RegionInferenceContextInner);
register_deref(UnsolvedRegionInferenceContext, "inner", RegionInferenceContextInner);

// ---- impl Deref for RegionInferenceContext ----

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:92 deref
RegionInferenceContext.prototype.deref = function (this: RegionInferenceContext): RegionInferenceContextInner {
  return this.inner;
};

// ---- impl RegionInferenceContext ----

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:105 solve (lane bck-regions-a)
(RegionInferenceContext as unknown as { solve: typeof RegionInferenceContext.solve }).solve = function (
  infcx: BorrowckInferCtxt,
  lowered_constraints: LoweredConstraints,
  universal_region_relations: UniversalRegionRelations,
  location_map: DenseLocationMap,
  body: Body,
  polonius_output: PoloniusOutput | undefined,
): [RegionInferenceContext, ClosureRegionRequirements | undefined, RegionErrors] {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContext::solve");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:255 region_contains_point (lane bck-regions-a)
RegionInferenceContext.prototype.region_contains_point = function (this: RegionInferenceContext, r: RegionVid, p: Location): boolean {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContext::region_contains_point");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:261 first_non_contained_inclusive (lane bck-regions-a)
RegionInferenceContext.prototype.first_non_contained_inclusive = function (
  this: RegionInferenceContext,
  r: RegionVid,
  block: BasicBlock,
  start: number,
  end: number,
): number | undefined {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContext::first_non_contained_inclusive");
};

// ---- impl Deref / DerefMut for UnsolvedRegionInferenceContext ----

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:284 deref
UnsolvedRegionInferenceContext.prototype.deref = function (this: UnsolvedRegionInferenceContext): RegionInferenceContextInner {
  return this.inner;
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:290 deref_mut
UnsolvedRegionInferenceContext.prototype.deref_mut = function (this: UnsolvedRegionInferenceContext): RegionInferenceContextInner {
  return this.inner;
};

// ---- impl RegionInferenceContextInner ----

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:297 regions (lane bck-regions-a)
RegionInferenceContextInner.prototype.regions = function (this: RegionInferenceContextInner): Iterable<RegionVid> {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::regions");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:307 to_region_vid (lane bck-regions-a)
RegionInferenceContextInner.prototype.to_region_vid = function (this: RegionInferenceContextInner, r: Region): RegionVid {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::to_region_vid");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:312 outlives_constraints (lane bck-regions-a)
RegionInferenceContextInner.prototype.outlives_constraints = function (this: RegionInferenceContextInner): Iterable<OutlivesConstraint> {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::outlives_constraints");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:317 annotate (lane bck-regions-a)
RegionInferenceContextInner.prototype.annotate = function (this: RegionInferenceContextInner, tcx: TyCtxt, err: Diag): void {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::annotate");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:322 region_value_str (lane bck-regions-a)
RegionInferenceContextInner.prototype.region_value_str = function (this: RegionInferenceContextInner, r: RegionVid): string {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::region_value_str");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:327 placeholders_contained_in (lane bck-regions-a)
RegionInferenceContextInner.prototype.placeholders_contained_in = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
): Iterable<PlaceholderRegion> {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::placeholders_contained_in");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:347 approx_universal_upper_bound (lane bck-regions-a)
RegionInferenceContextInner.prototype.approx_universal_upper_bound = function (this: RegionInferenceContextInner, r: RegionVid): RegionVid {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::approx_universal_upper_bound");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:387 max_nameable_universe (lane bck-regions-a)
RegionInferenceContextInner.prototype.max_nameable_universe = function (
  this: RegionInferenceContextInner,
  scc: ConstraintSccIndex,
): UniverseIndex {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::max_nameable_universe");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:391 constraint_path_between_regions (lane bck-regions-a)
RegionInferenceContextInner.prototype.constraint_path_between_regions = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  to_region: RegionVid,
): OutlivesConstraint[] | undefined {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::constraint_path_between_regions");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:412 constraint_path_to (lane bck-regions-a)
RegionInferenceContextInner.prototype.constraint_path_to = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  target_test: (a0: RegionVid) => boolean,
  include_placeholder_static: boolean,
): [OutlivesConstraint[], RegionVid] | undefined {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::constraint_path_to");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:446 find_constraint_path_between_regions_inner (lane bck-regions-a)
RegionInferenceContextInner.prototype.find_constraint_path_between_regions_inner = function (
  this: RegionInferenceContextInner,
  ignore_opaque_type_constraints: boolean,
  from_region: RegionVid,
  target_test: (a0: RegionVid) => boolean,
  include_placeholder_static: boolean,
): [OutlivesConstraint[], RegionVid] | undefined {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::find_constraint_path_between_regions_inner");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:563 find_sub_region_live_at (lane bck-regions-a)
RegionInferenceContextInner.prototype.find_sub_region_live_at = function (
  this: RegionInferenceContextInner,
  fr1: RegionVid,
  location: Location,
): RegionVid {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::find_sub_region_live_at");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:573 region_definition (lane bck-regions-a)
RegionInferenceContextInner.prototype.region_definition = function (this: RegionInferenceContextInner, r: RegionVid): RegionDefinition {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::region_definition");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:578 upper_bound_in_region_scc (lane bck-regions-a)
RegionInferenceContextInner.prototype.upper_bound_in_region_scc = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
  upper: RegionVid,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::upper_bound_in_region_scc");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:583 universal_regions (lane bck-regions-a)
RegionInferenceContextInner.prototype.universal_regions = function (this: RegionInferenceContextInner): UniversalRegions {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::universal_regions");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:594 best_blame_constraint (lane bck-regions-a)
RegionInferenceContextInner.prototype.best_blame_constraint = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  from_region_origin: NllRegionVariableOrigin,
  to_region: RegionVid,
): BestBlame {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::best_blame_constraint");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:802 universe_info (lane bck-regions-a)
RegionInferenceContextInner.prototype.universe_info = function (this: RegionInferenceContextInner, universe: UniverseIndex): UniverseInfo {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::universe_info");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:815 find_loop_terminator_location (lane bck-regions-a)
RegionInferenceContextInner.prototype.find_loop_terminator_location = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
  body: Body,
): Location | undefined {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::find_loop_terminator_location");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:838 constraint_sccs (lane bck-regions-a)
RegionInferenceContextInner.prototype.constraint_sccs_ = function (this: RegionInferenceContextInner): ConstraintSccs {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::constraint_sccs");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:842 liveness_constraints (lane bck-regions-a)
RegionInferenceContextInner.prototype.liveness_constraints_ = function (this: RegionInferenceContextInner): LivenessValues {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::liveness_constraints");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:849 is_loan_live_at (lane bck-regions-a)
RegionInferenceContextInner.prototype.is_loan_live_at = function (
  this: RegionInferenceContextInner,
  loan_idx: BorrowIndex,
  location: Location,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::RegionInferenceContextInner::is_loan_live_at");
};

// ---- impl UnsolvedRegionInferenceContext ----

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:861 propagate_constraints (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.propagate_constraints = function (this: UnsolvedRegionInferenceContext): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::propagate_constraints");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:888 can_name_all_placeholders (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.can_name_all_placeholders = function (
  this: UnsolvedRegionInferenceContext,
  scc_a: ConstraintSccIndex,
  scc_b: ConstraintSccIndex,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::can_name_all_placeholders");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:900 check_type_tests (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_type_tests = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_type_tests");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1011 try_promote_type_test (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.try_promote_type_test = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  type_test: TypeTest,
  propagated_outlives_requirements: ClosureOutlivesRequirement[],
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::try_promote_type_test");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1094 try_promote_type_test_subject (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.try_promote_type_test_subject = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  ty: Ty,
): ClosureOutlivesSubject | undefined {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::try_promote_type_test_subject");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1135 eval_verify_bound (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.eval_verify_bound = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  generic_ty: Ty,
  lower_bound: RegionVid,
  verify_bound: VerifyBound,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::eval_verify_bound");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1169 eval_if_eq (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.eval_if_eq = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  generic_ty: Ty,
  lower_bound: RegionVid,
  verify_if_eq_b: Binder<VerifyIfEq>,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::eval_if_eq");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1219 normalize_to_scc_representatives (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.normalize_to_scc_representatives = function <T>(
  this: UnsolvedRegionInferenceContext,
  tcx: TyCtxt,
  value: T,
  d_T: TypeFoldable<T>,
): T {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::normalize_to_scc_representatives");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1235 eval_equal (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.eval_equal = function (this: UnsolvedRegionInferenceContext, r1: RegionVid, r2: RegionVid): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::eval_equal");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1244 eval_outlives (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.eval_outlives = function (
  this: UnsolvedRegionInferenceContext,
  sup_region: RegionVid,
  sub_region: RegionVid,
): boolean {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::eval_outlives");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1331 check_universal_regions (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_universal_regions = function (
  this: UnsolvedRegionInferenceContext,
  propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_universal_regions");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1382 check_polonius_subset_errors (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_polonius_subset_errors = function (
  this: UnsolvedRegionInferenceContext,
  propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
  polonius_output: PoloniusOutput,
): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_polonius_subset_errors");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1472 check_universal_region (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_universal_region = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
  errors_buffer: RegionErrors,
): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_universal_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1534 check_universal_region_relation (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_universal_region_relation = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  shorter_fr: RegionVid,
  propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
): RegionRelationCheckResult {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_universal_region_relation");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1560 try_propagate_universal_region_error (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.try_propagate_universal_region_error = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  shorter_fr: RegionVid,
  propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
): RegionRelationCheckResult {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::try_propagate_universal_region_error");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1654 check_bound_universal_region (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.check_bound_universal_region = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  placeholder: PlaceholderRegion,
  errors_buffer: RegionErrors,
): void {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::check_bound_universal_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1685 region_from_element (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.region_from_element = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  element: RegionElement,
): RegionVid {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::region_from_element");
};

// stub: compiler/rustc_borrowck/src/region_infer/region_context.rs:1712 scc_representative (lane bck-regions-a)
UnsolvedRegionInferenceContext.prototype.scc_representative = function (
  this: UnsolvedRegionInferenceContext,
  scc: ConstraintSccIndex,
): RegionVid {
  return unported("rustc_borrowck::region_infer::region_context::UnsolvedRegionInferenceContext::scc_representative");
};
