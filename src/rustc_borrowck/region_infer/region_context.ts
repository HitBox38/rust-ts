// Port of compiler/rustc_borrowck/src/region_infer/region_context.rs (lane borrowck-contract: declarations and the
// `Deref` glue; filled by lane bck-regions-a, plan-m4 wave 23).
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
import { Iterator_EdgesFromGraph, Iterator_EdgesFromStatic } from "../constraints/graph.ts";
import { clone_OutlivesConstraint, type ConstraintSccIndex, type OutlivesConstraint } from "../constraints/mod.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import { UniverseInfo } from "../diagnostics/bound_region_errors.ts";
import { clone_UniverseInfo } from "../diagnostics/bound_region_errors.gen.ts";
import { RegionErrors } from "../diagnostics/region_errors.gen.ts";
import type { LoweredConstraints } from "../handle_placeholders.gen.ts";
import {
  type BorrowckInferCtxt,
  type ClosureOutlivesRequirement,
  type ClosureOutlivesSubject,
  ClosureOutlivesSubjectTy,
  type ClosureRegionRequirements,
} from "../lib.gen.ts";
import { type PoloniusOutput, PoloniusRegionVid } from "../polonius/legacy/facts.gen.ts";
import type { UniversalRegionRelations } from "../type_check/free_region_relations.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { Representative } from "./mod.ts";
import { BestBlame, clone_TypeTest, type ConstraintSccs, type RegionDefinition, RegionRelationCheckResult, Trace, type TypeTest } from "./mod.ts";
import { type LivenessValues, type RegionElement, RegionValues } from "./values.gen.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import { extract_verify_if_eq } from "../../rustc_infer/infer/outlives/test_type_match.ts";
import { GenericKind, type VerifyBound, type VerifyIfEq } from "../../rustc_infer/infer/region_constraints/mod.ts";
import {
  fold_with_GenericKind,
  fold_with_VerifyIfEq,
  try_fold_with_GenericKind,
  try_fold_with_VerifyIfEq,
  visit_with_GenericKind,
  visit_with_VerifyIfEq,
} from "../../rustc_infer/infer/region_constraints/mod.gen.ts";
import type { BasicBlock, Body, Location } from "../../rustc_middle/mir/mod.ts";
import { ConstraintCategory } from "../../rustc_middle/mir/query.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { FieldIdx } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import "../../rustc_session/lib.ts";
import { Polonius } from "../../rustc_session/config.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Binder, fold_Binder, type PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import { fold_regions, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { debug_RegionVid, RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { TyKind } from "../../rustc_type_ir/ty_kind.ts";
import { intern_key, intern_key_eq } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { register_deref } from "../../rust_ts/deref.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
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
    // region_context.rs:255
    region_contains_point(r: RegionVid, p: Location): boolean;
    // region_context.rs:261
    first_non_contained_inclusive(r: RegionVid, block: BasicBlock, start: number, end: number): number | undefined;
  }
  namespace RegionInferenceContext {
    // region_context.rs:105
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
    // region_context.rs:861
    propagate_constraints(): void;
    // region_context.rs:888
    can_name_all_placeholders(scc_a: ConstraintSccIndex, scc_b: ConstraintSccIndex): boolean;
    // region_context.rs:900
    check_type_tests(
      infcx: InferCtxt,
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1011
    try_promote_type_test(
      infcx: InferCtxt,
      type_test: TypeTest,
      propagated_outlives_requirements: ClosureOutlivesRequirement[],
    ): boolean;
    // region_context.rs:1094
    try_promote_type_test_subject(infcx: InferCtxt, ty: Ty): ClosureOutlivesSubject | undefined;
    // region_context.rs:1135
    eval_verify_bound(infcx: InferCtxt, generic_ty: Ty, lower_bound: RegionVid, verify_bound: VerifyBound): boolean;
    // region_context.rs:1169
    eval_if_eq(infcx: InferCtxt, generic_ty: Ty, lower_bound: RegionVid, verify_if_eq_b: Binder<VerifyIfEq>): boolean;
    // region_context.rs:1219
    normalize_to_scc_representatives<T>(tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T;
    // region_context.rs:1235
    eval_equal(r1: RegionVid, r2: RegionVid): boolean;
    // region_context.rs:1244
    eval_outlives(sup_region: RegionVid, sub_region: RegionVid): boolean;
    // region_context.rs:1331
    check_universal_regions(
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1382
    check_polonius_subset_errors(
      propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
      errors_buffer: RegionErrors,
      polonius_output: PoloniusOutput,
    ): void;
    // region_context.rs:1472
    check_universal_region(
      longer_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
      errors_buffer: RegionErrors,
    ): void;
    // region_context.rs:1534
    check_universal_region_relation(
      longer_fr: RegionVid,
      shorter_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
    ): RegionRelationCheckResult;
    // region_context.rs:1560
    try_propagate_universal_region_error(
      longer_fr: RegionVid,
      shorter_fr: RegionVid,
      propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
    ): RegionRelationCheckResult;
    // region_context.rs:1654
    check_bound_universal_region(longer_fr: RegionVid, placeholder: PlaceholderRegion, errors_buffer: RegionErrors): void;
    // region_context.rs:1685
    region_from_element(longer_fr: RegionVid, element: RegionElement): RegionVid;
    // region_context.rs:1712
    scc_representative(scc: ConstraintSccIndex): RegionVid;
  }
  interface RegionInferenceContextInner {
    // region_context.rs:297
    regions(): Iterable<RegionVid>;
    // region_context.rs:307
    to_region_vid(r: Region): RegionVid;
    // region_context.rs:312
    outlives_constraints(): Iterable<OutlivesConstraint>;
    // region_context.rs:317
    annotate(tcx: TyCtxt, err: Diag): void;
    // region_context.rs:322
    region_value_str(r: RegionVid): string;
    // region_context.rs:327
    placeholders_contained_in(r: RegionVid): Iterable<PlaceholderRegion>;
    // region_context.rs:347
    approx_universal_upper_bound(r: RegionVid): RegionVid;
    // region_context.rs:387
    max_nameable_universe(scc: ConstraintSccIndex): UniverseIndex;
    // region_context.rs:391
    constraint_path_between_regions(from_region: RegionVid, to_region: RegionVid): OutlivesConstraint[] | undefined;
    // region_context.rs:412
    constraint_path_to(
      from_region: RegionVid,
      target_test: (a0: RegionVid) => boolean,
      include_placeholder_static: boolean,
    ): [OutlivesConstraint[], RegionVid] | undefined;
    // region_context.rs:446
    find_constraint_path_between_regions_inner(
      ignore_opaque_type_constraints: boolean,
      from_region: RegionVid,
      target_test: (a0: RegionVid) => boolean,
      include_placeholder_static: boolean,
    ): [OutlivesConstraint[], RegionVid] | undefined;
    // region_context.rs:563
    find_sub_region_live_at(fr1: RegionVid, location: Location): RegionVid;
    // region_context.rs:573
    region_definition(r: RegionVid): RegionDefinition;
    // region_context.rs:578
    upper_bound_in_region_scc(r: RegionVid, upper: RegionVid): boolean;
    // region_context.rs:583
    universal_regions(): UniversalRegions;
    // region_context.rs:594
    best_blame_constraint(from_region: RegionVid, from_region_origin: NllRegionVariableOrigin, to_region: RegionVid): BestBlame;
    // region_context.rs:802
    universe_info(universe: UniverseIndex): UniverseInfo;
    // region_context.rs:815
    find_loop_terminator_location(r: RegionVid, body: Body): Location | undefined;
    // region_context.rs:838; `constraint_sccs_`: the field `constraint_sccs` has the same name
    constraint_sccs_(): ConstraintSccs;
    // region_context.rs:842; `liveness_constraints_`: the field has the same name
    liveness_constraints_(): LivenessValues;
    // region_context.rs:849
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

/// Performs region inference and report errors if we see any
/// unsatisfiable constraints. If this is a closure, returns the
/// region requirements to propagate to our creator, if any.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:105 solve
(RegionInferenceContext as unknown as { solve: typeof RegionInferenceContext.solve }).solve = function (
  infcx: BorrowckInferCtxt,
  lowered_constraints: LoweredConstraints,
  universal_region_relations: UniversalRegionRelations,
  location_map: DenseLocationMap,
  body: Body,
  polonius_output: PoloniusOutput | undefined,
): [RegionInferenceContext, ClosureRegionRequirements | undefined, RegionErrors] {
  // 1. We first prepare the data needed for the `UnsolvedRegionInferenceContext` to do the
  //    solving work.
  const universal_regions = universal_region_relations.universal_regions;

  const {
    constraint_sccs,
    definitions,
    outlives_constraints,
    scc_annotations,
    type_tests,
    liveness_constraints,
    universe_causes,
    placeholder_indices,
  } = lowered_constraints;

  // debug!("universal_regions: {:#?}", universal_region_relations.universal_regions);
  // debug!("outlives constraints: {:#?}", outlives_constraints);
  // debug!("placeholder_indices: {:#?}", placeholder_indices);
  // debug!("type tests: {:#?}", type_tests);

  const constraint_graph = outlives_constraints.graph(definitions.length);

  // PORT: `if cfg!(debug_assertions) { sccs_info(infcx, &constraint_sccs); }` is compiled out (rustc ships without
  // debug assertions).

  const scc_values = RegionValues.new<ConstraintSccIndex>(location_map, universal_regions.len(), placeholder_indices);

  // Initializes the region variables with their initial live points.
  for (let region = 0 as RegionVid; region < definitions.length; region++) {
    const definition = definitions[region]!;
    const scc = constraint_sccs.scc(region);

    // For each universally quantified region (lifetime parameter). The
    // first N variables always correspond to the regions appearing in the
    // function signature (both named and anonymous) and in where-clauses.
    switch (definition.origin.$) {
      // For each free, universally quantified region X:
      case "FreeRegion": {
        // Add `end(X)` into the set for X.
        scc_values.add_free_region(scc, region);
        break;
      }

      case "Placeholder": {
        const placeholder = definition.origin._0;
        scc_values.add_placeholder(scc, placeholder);
        break;
      }

      case "Existential": {
        // For existential, regions, nothing to do.
        break;
      }
    }

    // Initially copy the liveness constraints of any region that
    // has them, setting `scc_values[scc(region)] |= liveness_constraints[region]`.
    //
    // These values will later be propagated during
    // [`UnsolvedRegionInferenceContext::propagate_constraints()`].
    // The values include any live-at-all-points constraints added previously in `liveness::generate`.
    const liveness = liveness_constraints.point_liveness(region);
    if (liveness !== undefined) {
      scc_values.merge_liveness(scc, liveness);
    }
  }

  const unsolved_regioncx = new UnsolvedRegionInferenceContext(
    new RegionInferenceContextInner(
      definitions,
      liveness_constraints,
      outlives_constraints,
      constraint_graph,
      constraint_sccs,
      scc_annotations,
      universe_causes,
      scc_values,
      universal_region_relations,
    ),
    type_tests,
  );

  // 2. And now we can do the actual solving, the region inference.
  const mir_def_id = body.source.def_id();
  unsolved_regioncx.propagate_constraints();

  const errors_buffer = RegionErrors.new(infcx.tcx);

  // If this is a nested body, we propagate unsatisfied
  // outlives constraints to the parent body instead of
  // eagerly erroing.
  const propagated_outlives_requirements_: ClosureOutlivesRequirement[] | undefined = infcx.tcx.is_typeck_child(mir_def_id)
    ? []
    : undefined;

  unsolved_regioncx.check_type_tests(infcx.infcx, propagated_outlives_requirements_, errors_buffer);

  // debug!(?errors_buffer);
  // debug!(?propagated_outlives_requirements);

  // In Polonius mode, the errors about missing universal region relations are in the output
  // and need to be emitted or propagated. Otherwise, we need to check whether the
  // constraints were too strong, and if so, emit or propagate those errors.
  if (Polonius.is_legacy_enabled(infcx.tcx.sess.opts.unstable_opts.polonius)) {
    unsolved_regioncx.check_polonius_subset_errors(
      propagated_outlives_requirements_,
      errors_buffer,
      unwrap(polonius_output, "Polonius output is unavailable despite `-Z polonius`"),
    );
  } else {
    unsolved_regioncx.check_universal_regions(propagated_outlives_requirements_, errors_buffer);
  }

  // debug!(?errors_buffer);

  const propagated_outlives_requirements = propagated_outlives_requirements_ ?? [];
  if (propagated_outlives_requirements.length === 0) {
    return [new RegionInferenceContext(unsolved_regioncx.inner), undefined, errors_buffer];
  } else {
    const num_external_vids = unsolved_regioncx.universal_regions().num_global_and_external_regions();
    return [
      new RegionInferenceContext(unsolved_regioncx.inner),
      {
        num_external_vids,
        outlives_requirements: propagated_outlives_requirements,
      },
      errors_buffer,
    ];
  }
};

/// Returns `true` if the region `r` contains the point `p`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:255 region_contains_point
RegionInferenceContext.prototype.region_contains_point = function (this: RegionInferenceContext, r: RegionVid, p: Location): boolean {
  const scc = this.constraint_sccs.scc(r);
  return this.scc_values.contains_point(scc, p);
};

/// Returns the lowest statement index in `start..=end` which is not contained by `r`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:261 first_non_contained_inclusive
RegionInferenceContext.prototype.first_non_contained_inclusive = function (
  this: RegionInferenceContext,
  r: RegionVid,
  block: BasicBlock,
  start: number,
  end: number,
): number | undefined {
  const scc = this.constraint_sccs.scc(r);
  return this.scc_values.first_non_contained_inclusive(scc, block, start, end);
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

/// Returns an iterator over all the region indices.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:297 regions
RegionInferenceContextInner.prototype.regions = function* (this: RegionInferenceContextInner): Generator<RegionVid> {
  const n = this.definitions.length;
  for (let r = 0; r < n; r++) yield r as RegionVid;
};

/// Given a universal region in scope on the MIR, returns the
/// corresponding index.
///
/// Panics if `r` is not a registered universal region, most notably
/// if it is a placeholder. Handling placeholders requires access to the
/// `MirTypeckRegionConstraints`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:307 to_region_vid
RegionInferenceContextInner.prototype.to_region_vid = function (this: RegionInferenceContextInner, r: Region): RegionVid {
  return this.universal_regions().to_region_vid(r);
};

/// Returns an iterator over all the outlives constraints.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:312 outlives_constraints
RegionInferenceContextInner.prototype.outlives_constraints = function* (this: RegionInferenceContextInner): Generator<OutlivesConstraint> {
  for (const c of this.constraints.outlives_()) yield clone_OutlivesConstraint(c);
};

/// Adds annotations for `#[rustc_regions]`; see `UniversalRegions::annotate`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:317 annotate
RegionInferenceContextInner.prototype.annotate = function (this: RegionInferenceContextInner, tcx: TyCtxt, err: Diag): void {
  this.universal_regions().annotate(tcx, err);
};

/// Returns access to the value of `r` for debugging purposes.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:322 region_value_str
RegionInferenceContextInner.prototype.region_value_str = function (this: RegionInferenceContextInner, r: RegionVid): string {
  const scc = this.constraint_sccs.scc(r);
  return this.scc_values.region_value_str(scc);
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:327 placeholders_contained_in
RegionInferenceContextInner.prototype.placeholders_contained_in = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
): Iterable<PlaceholderRegion> {
  const scc = this.constraint_sccs.scc(r);
  return this.scc_values.placeholders_contained_in(scc);
};

/// Like `universal_upper_bound`, but returns an approximation more suitable
/// for diagnostics. If `r` contains multiple disjoint universal regions
/// (e.g. 'a and 'b in `fn foo<'a, 'b> { ... }`, we pick the lower-numbered region.
/// This corresponds to picking named regions over unnamed regions
/// (e.g. picking early-bound regions over a closure late-bound region).
///
/// This means that the returned value may not be a true upper bound, since
/// only 'static is known to outlive disjoint universal regions.
/// Therefore, this method should only be used in diagnostic code,
/// where displaying *some* named universal region is better than
/// falling back to 'static.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:347 approx_universal_upper_bound
RegionInferenceContextInner.prototype.approx_universal_upper_bound = function (this: RegionInferenceContextInner, r: RegionVid): RegionVid {
  // debug!("{}", self.region_value_str(r));

  // Find the smallest universal region that contains all other
  // universal regions within `region`.
  let lub = this.universal_regions().fr_fn_body;
  const r_scc = this.constraint_sccs.scc(r);
  const static_r = this.universal_regions().fr_static;
  for (const ur of this.scc_values.universal_regions_outlived_by(r_scc)) {
    const new_lub = this.universal_region_relations.postdom_upper_bound(lub, ur);
    // debug!(?ur, ?lub, ?new_lub);
    // The upper bound of two non-static regions is static: this
    // means we know nothing about the relationship between these
    // two regions. Pick a 'better' one to use when constructing
    // a diagnostic
    if (ur !== static_r && lub !== static_r && new_lub === static_r) {
      // Prefer the region with an `external_name` - this
      // indicates that the region is early-bound, so working with
      // it can produce a nicer error.
      if (this.region_definition(ur).external_name !== undefined) {
        lub = ur;
      } else if (this.region_definition(lub).external_name !== undefined) {
        // Leave lub unchanged
      } else {
        // If we get here, we don't have any reason to prefer
        // one region over the other. Just pick the
        // one with the lower index for now.
        lub = Math.min(ur, lub) as RegionVid;
      }
    } else {
      lub = new_lub;
    }
  }

  // debug!(?r, ?lub);

  return lub;
};

/// The largest universe of any region nameable from this SCC.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:387 max_nameable_universe
RegionInferenceContextInner.prototype.max_nameable_universe = function (
  this: RegionInferenceContextInner,
  scc: ConstraintSccIndex,
): UniverseIndex {
  return this.scc_annotations[scc]!.max_nameable_universe_();
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:391 constraint_path_between_regions
RegionInferenceContextInner.prototype.constraint_path_between_regions = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  to_region: RegionVid,
): OutlivesConstraint[] | undefined {
  if (from_region === to_region) {
    bug(`Tried to find a path between ${debug_RegionVid(from_region, PLAIN)} and itself!`);
  }
  return this.constraint_path_to(from_region, (to) => to === to_region, true)?.[0];
};

/// Walks the graph of constraints (where `'a: 'b` is considered
/// an edge `'a -> 'b`) to find a path from `from_region` to
/// `to_region`.
///
/// Returns: a series of constraints as well as the region `R`
/// that passed the target test.
/// If `include_static_outlives_all` is `true`, then the synthetic
/// outlives constraints `'static -> a` for every region `a` are
/// considered in the search, otherwise they are ignored.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:412 constraint_path_to
RegionInferenceContextInner.prototype.constraint_path_to = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  target_test: (a0: RegionVid) => boolean,
  include_placeholder_static: boolean,
): [OutlivesConstraint[], RegionVid] | undefined {
  return (
    this.find_constraint_path_between_regions_inner(true, from_region, target_test, include_placeholder_static) ??
    this.find_constraint_path_between_regions_inner(false, from_region, target_test, include_placeholder_static)
  );
};

/// The constraints we get from equating the hidden type of each use of an opaque
/// with its final hidden type may end up getting preferred over other, potentially
/// longer constraint paths.
///
/// Given that we compute the final hidden type by relying on this existing constraint
/// path, this can easily end up hiding the actual reason for why we require these regions
/// to be equal.
///
/// To handle this, we first look at the path while ignoring these constraints and then
/// retry while considering them. This is not perfect, as the `from_region` may have already
/// been partially related to its argument region, so while we rely on a member constraint
/// to get a complete path, the most relevant step of that path already existed before then.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:446 find_constraint_path_between_regions_inner
RegionInferenceContextInner.prototype.find_constraint_path_between_regions_inner = function (
  this: RegionInferenceContextInner,
  ignore_opaque_type_constraints: boolean,
  from_region: RegionVid,
  target_test: (a0: RegionVid) => boolean,
  include_placeholder_static: boolean,
): [OutlivesConstraint[], RegionVid] | undefined {
  const context: Trace[] = this.definitions.map(() => Trace.NotVisited);
  context[from_region] = Trace.StartRegion;

  const fr_static = this.universal_regions().fr_static;

  // Use a deque so that we do a breadth-first search. We will
  // stop at the first match, which ought to be the shortest
  // path (fewest constraints).
  // PORT: `VecDeque` is an array with a read cursor (only `push_back` / `pop_front` are used).
  const deque: RegionVid[] = [];
  let deque_head = 0;
  deque.push(from_region);

  while (deque_head < deque.length) {
    const r = deque[deque_head++]!;
    // debug!(
    //     "constraint_path_to: from_region={:?} r={:?} value={}",
    //     from_region,
    //     r,
    //     self.region_value_str(r),
    // );

    // Check if we reached the region we were looking for. If so,
    // we can reconstruct the path that led to it and return it.
    if (target_test(r)) {
      const result: OutlivesConstraint[] = [];
      let p = r;
      // This loop is cold and runs at the end, which is why we delay
      // `OutlivesConstraint` construction until now.
      for (;;) {
        const trace = context[p]!;
        switch (trace.$) {
          case "FromGraph": {
            const c = trace._0;
            p = c.sup;
            result.push(clone_OutlivesConstraint(c));
            break;
          }

          case "FromStatic": {
            const sub = trace._0;
            const c: OutlivesConstraint = {
              sup: fr_static,
              sub,
              locations: { $: "All", _0: DUMMY_SP },
              span: DUMMY_SP,
              category: ConstraintCategory.Internal,
              variance_info: VarianceDiagInfo.None,
              from_closure: false,
            };
            p = c.sup;
            result.push(c);
            break;
          }

          case "StartRegion": {
            result.reverse();
            return [result, r];
          }

          case "NotVisited": {
            bug(`found unvisited region ${debug_RegionVid(p, PLAIN)} on path to ${debug_RegionVid(r, PLAIN)}`);
          }
        }
      }
    }

    // Otherwise, walk over the outgoing constraints and
    // enqueue any regions we find, keeping track of how we
    // reached them.

    // A constraint like `'r: 'x` can come from our constraint
    // graph.

    // Always inline this closure because it can be hot.
    const handle_trace = (sub: RegionVid, trace: Trace) => {
      if (context[sub]!.$ === "NotVisited") {
        context[sub] = trace;
        deque.push(sub);
      }
    };

    // If this is the `'static` region and the graph's direction is normal, then set up the
    // Edges iterator to return all regions (#53178).
    if (r === fr_static && this.constraint_graph.is_normal()) {
      const edges = this.constraint_graph.outgoing_edges_from_static();
      for (let n = Iterator_EdgesFromStatic.next(edges); !n.done; n = Iterator_EdgesFromStatic.next(edges)) {
        const sub = n.value;
        handle_trace(sub, { $: "FromStatic", _0: sub });
      }
    } else {
      const edges = this.constraint_graph.outgoing_edges_from_graph(r, this.constraints);
      // This loop can be hot.
      for (let n = Iterator_EdgesFromGraph.next(edges); !n.done; n = Iterator_EdgesFromGraph.next(edges)) {
        const constraint = n.value;
        if (constraint.category.$ === "OutlivesUnnameablePlaceholder" && !include_placeholder_static) {
          // debug!("Ignoring illegal placeholder constraint: {constraint:?}");
          continue;
        } else if (constraint.category.$ === "OpaqueType" && ignore_opaque_type_constraints) {
          // debug!("Ignoring member constraint: {constraint:?}");
          continue;
        }

        // debug_assert_eq!(constraint.sup, r);
        handle_trace(constraint.sub, { $: "FromGraph", _0: constraint });
      }
    }
  }

  return undefined;
};

/// Finds some region R such that `fr1: R` and `R` is live at `location`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:563 find_sub_region_live_at
RegionInferenceContextInner.prototype.find_sub_region_live_at = function (
  this: RegionInferenceContextInner,
  fr1: RegionVid,
  location: Location,
): RegionVid {
  // trace!(scc = ?self.constraint_sccs.scc(fr1));
  // trace!(universe = ?self.max_nameable_universe(self.constraint_sccs.scc(fr1)));
  return unwrap(
    this.constraint_path_to(
      fr1,
      (r) => {
        // trace!(?r, liveness_constraints=?self.liveness_constraints.pretty_print_live_points(r));
        return this.liveness_constraints.is_live_at(r, location);
      },
      true,
    ),
  )[1];
};

/// Get the region definition of `r`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:573 region_definition
RegionInferenceContextInner.prototype.region_definition = function (this: RegionInferenceContextInner, r: RegionVid): RegionDefinition {
  return index_vec(this.definitions, r);
};

/// Check if the SCC of `r` contains `upper`, a free region.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:578 upper_bound_in_region_scc
RegionInferenceContextInner.prototype.upper_bound_in_region_scc = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
  upper: RegionVid,
): boolean {
  const r_scc = this.constraint_sccs.scc(r);
  return this.scc_values.contains_free_region(r_scc, upper);
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:583 universal_regions
RegionInferenceContextInner.prototype.universal_regions = function (this: RegionInferenceContextInner): UniversalRegions {
  return this.universal_region_relations.universal_regions;
};

/// Tries to find the best constraint to blame for the fact that
/// `R: from_region`, where `R` is some region that meets
/// `target_test`. This works by following the constraint graph,
/// creating a constraint path that forces `R` to outlive
/// `from_region`, and then finding the best choices within that
/// path to blame.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:594 best_blame_constraint
RegionInferenceContextInner.prototype.best_blame_constraint = function (
  this: RegionInferenceContextInner,
  from_region: RegionVid,
  from_region_origin: NllRegionVariableOrigin,
  to_region: RegionVid,
): BestBlame {
  assert(from_region !== to_region, "Trying to blame a region for itself!");

  const path_ = unwrap(this.constraint_path_between_regions(from_region, to_region));

  // If we are passing through a constraint added because we reached an unnameable placeholder `'unnameable`,
  // redirect search towards `'unnameable`.
  let due_to_placeholder_outlives: RegionVid | undefined = undefined;
  for (const c of path_) {
    if (c.category.$ === "OutlivesUnnameablePlaceholder") {
      due_to_placeholder_outlives = c.category._0;
      break;
    }
  }

  // Edge case: it's possible that `'from_region` is an unnameable placeholder.
  let path: OutlivesConstraint[];
  if (due_to_placeholder_outlives !== undefined && due_to_placeholder_outlives !== from_region) {
    const unnameable = due_to_placeholder_outlives;
    // We ignore the extra edges due to unnameable placeholders to get
    // an explanation that was present in the original constraint graph.
    path = unwrap(this.constraint_path_to(from_region, (r) => r === unnameable, false))[0];
  } else {
    path = path_;
  }

  // debug!(
  //     "path={:#?}",
  //     path.iter()
  //         .map(|c| format!(
  //             "{:?} ({:?}: {:?})",
  //             c,
  //             self.constraint_sccs.scc(c.sup),
  //             self.constraint_sccs.scc(c.sub),
  //         ))
  //         .collect::<Vec<_>>()
  // );

  // When reporting an error, there is typically a chain of constraints leading from some
  // "source" region which must outlive some "target" region.
  // In most cases, we prefer to "blame" the constraints closer to the target --
  // but there is one exception. When constraints arise from higher-ranked subtyping,
  // we generally prefer to blame the source value,
  // as the "target" in this case tends to be some type annotation that the user gave.
  // Therefore, if we find that the region origin is some instantiation
  // of a higher-ranked region, we start our search from the "source" point
  // rather than the "target", and we also tweak a few other things.
  //
  // An example might be this bit of Rust code:
  //
  // ```rust
  // let x: fn(&'static ()) = |_| {};
  // let y: for<'a> fn(&'a ()) = x;
  // ```
  //
  // In MIR, this will be converted into a combination of assignments and type ascriptions.
  // In particular, the 'static is imposed through a type ascription:
  //
  // ```rust
  // x = ...;
  // AscribeUserType(x, fn(&'static ())
  // y = x;
  // ```
  //
  // We wind up ultimately with constraints like
  //
  // ```rust
  // !a: 'temp1 // from the `y = x` statement
  // 'temp1: 'temp2
  // 'temp2: 'static // from the AscribeUserType
  // ```
  //
  // and here we prefer to blame the source (the y = x statement).
  let blame_source!: boolean;
  switch (from_region_origin.$) {
    case "FreeRegion":
      blame_source = true;
      break;
    case "Placeholder":
      blame_source = false;
      break;
    // `'existential: 'whatever` never results in a region error by itself.
    // We may always infer it to `'static` afterall. This means while an error
    // path may go through an existential, these existentials are never the
    // `from_region`.
    case "Existential":
      unreachable("internal error: entered unreachable code: existentials can outlive everything");
  }

  // To pick a constraint to blame, we organize constraints by how interesting we expect them
  // to be in diagnostics, then pick the most interesting one closest to either the source or
  // the target on our constraint path.
  const constraint_interest = (constraint: OutlivesConstraint): number => {
    // Try to avoid blaming constraints from desugarings, since they may not clearly match
    // match what users have written. As an exception, allow blaming returns generated by
    // `?` desugaring, since the correspondence is fairly clear.
    let category: ConstraintCategory;
    const kind = Span.desugaring_kind(constraint.span);
    if (kind !== undefined && (kind.$ !== "QuestionMark" || !(constraint.category.$ === "Return"))) {
      category = ConstraintCategory.Boring;
    } else {
      category = constraint.category;
    }

    let interest!: number;
    switch (category.$) {
      // Returns usually provide a type to blame and have specially written diagnostics,
      // so prioritize them.
      case "Return":
        interest = 0;
        break;
      case "Cast": {
        // Unsizing coercions are interesting, since we have a note for that:
        // `BorrowExplanation::add_object_lifetime_default_note`.
        // FIXME(dianne): That note shouldn't depend on a coercion being blamed; see issue
        // #131008 for an example of where we currently don't emit it but should.
        // Once the note is handled properly, this case should be removed. Until then, it
        // should be as limited as possible; the note is prone to false positives and this
        // constraint usually isn't best to blame.
        const unsize_ty = category.unsize_to;
        let unsize_kind: TyKind | undefined;
        if (
          unsize_ty !== undefined &&
          category.is_implicit_coercion === true &&
          to_region === this.universal_regions().fr_static &&
          // Mirror the note's condition, to minimize how often this diverts blame.
          (unsize_kind = unsize_ty.kind()).$ === "Adt" &&
          unsize_kind._1.some((arg: GenericArg) => {
            const ty = GenericArg.as_type(arg);
            return ty !== undefined && ty.is_trait();
          }) &&
          // Mimic old logic for this, to minimize false positives in tests.
          !path.some((c) => c.category.$ === "TypeAnnotation")
        ) {
          interest = 1;
        } else {
          // Between other interesting constraints, order by their position on the `path`.
          interest = 2;
        }
        break;
      }
      // Between other interesting constraints, order by their position on the `path`.
      case "Yield":
      case "UseAsConst":
      case "UseAsStatic":
      case "CallArgument":
      case "CopyBound":
      case "SizedBound":
      case "Assignment":
      case "Usage":
      case "ClosureUpvar":
        interest = 2;
        break;
      case "TypeAnnotation":
        switch (category._0) {
          case "Ascription":
          case "Declaration":
          case "OpaqueCast":
            interest = 2;
            break;
          // Generic arguments are unlikely to be what relates regions together
          case "GenericArg":
            interest = 3;
            break;
        }
        break;
      // We handle predicates and opaque types specially; don't prioritize them here.
      case "Predicate":
      case "OpaqueType":
        interest = 4;
        break;
      // `Boring` constraints can correspond to user-written code and have useful spans,
      // but don't provide any other useful information for diagnostics.
      case "Boring":
        interest = 5;
        break;
      // `BoringNoLocation` constraints can point to user-written code, but are less
      // specific, and are not used for relations that would make sense to blame.
      case "BoringNoLocation":
        interest = 6;
        break;
      // Do not blame internal constraints if we can avoid it. Never blame
      // the `'region: 'static` constraints introduced by placeholder outlives.
      case "Internal":
        interest = 7;
        break;
      case "OutlivesUnnameablePlaceholder":
        interest = 8;
        break;
      case "SolverRegionConstraint":
        interest = 9;
        break;
    }

    // debug!("constraint {constraint:?} category: {category:?}, interest: {interest:?}");

    return interest;
  };

  // PORT: `Iterator::min_by_key` keeps the first of several equal minima (of the reversed enumeration when
  // `blame_source`).
  let best_choice: number;
  if (blame_source) {
    let best: [number, number] | undefined = undefined;
    for (let i = path.length - 1; i >= 0; i--) {
      const k = constraint_interest(path[i]!);
      if (best === undefined || k < best[1]) best = [i, k];
    }
    best_choice = unwrap(best)[0];
  } else {
    let best: [number, number] | undefined = undefined;
    for (let i = 0; i < path.length; i++) {
      const k = constraint_interest(path[i]!);
      if (best === undefined || k < best[1]) best = [i, k];
    }
    best_choice = unwrap(best)[0];
  }

  // debug!(?best_choice, ?blame_source);

  let best_blame_idx: number;
  const next = best_choice + 1 < path.length ? path[best_choice + 1] : undefined;
  let field: FieldIdx | undefined;
  if (next !== undefined && index_vec(path, best_choice).category.$ === "Return" && next.category.$ === "OpaqueType") {
    // The return expression is being influenced by the return type being
    // impl Trait, point at the return type and not the return expr.
    best_blame_idx = best_choice + 1;
  } else if (
    is_return_normal(index_vec(path, best_choice).category) &&
    (field = find_closure_upvar(path)) !== undefined
  ) {
    index_vec(path, best_choice).category = { $: "Return", _0: { $: "ClosureUpvar", _0: field } };
    best_blame_idx = best_choice;
  } else {
    best_blame_idx = best_choice;
  }

  assert(
    !(index_vec(path, best_blame_idx).category.$ === "OutlivesUnnameablePlaceholder"),
    "Illegal placeholder constraint blamed; should have redirected to other region relation",
  );

  return new BestBlame(path, best_blame_idx);
};

/** `category == ConstraintCategory::Return(ReturnConstraint::Normal)` (derived `PartialEq`). */
function is_return_normal(category: ConstraintCategory): boolean {
  return category.$ === "Return" && category._0.$ === "Normal";
}

/** `path.iter().find_map(|p| if let ConstraintCategory::ClosureUpvar(f) = p.category { Some(f) } else { None })` */
function find_closure_upvar(path: readonly OutlivesConstraint[]): FieldIdx | undefined {
  for (const p of path) {
    if (p.category.$ === "ClosureUpvar") return p.category._0;
  }
  return undefined;
}

/** `vec[i]` (panics out of bounds, like `Index for Vec`). */
function index_vec<T>(v: T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:802 universe_info
RegionInferenceContextInner.prototype.universe_info = function (this: RegionInferenceContextInner, universe: UniverseIndex): UniverseInfo {
  // Query canonicalization can create local superuniverses (for example in
  // `InferCtx::query_response_instantiation_guess`), but they don't have an associated
  // `UniverseInfo` explaining why they were created.
  // This can cause ICEs if these causes are accessed in diagnostics, for example in issue
  // #114907 where this happens via liveness and dropck outlives results.
  // Therefore, we return a default value in case that happens, which should at worst emit a
  // suboptimal error, instead of the ICE.
  const info = this.universe_causes.get(universe);
  return info !== undefined ? clone_UniverseInfo(info) : UniverseInfo.other();
};

/// Tries to find the terminator of the loop in which the region 'r' resides.
/// Returns the location of the terminator if found.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:815 find_loop_terminator_location
RegionInferenceContextInner.prototype.find_loop_terminator_location = function (
  this: RegionInferenceContextInner,
  r: RegionVid,
  body: Body,
): Location | undefined {
  const scc = this.constraint_sccs.scc(r);
  const locations = this.scc_values.locations_outlived_by(scc);
  for (const location of locations) {
    const bb = body.index(location.block);
    const terminator = bb.terminator;
    if (
      terminator !== undefined &&
      // terminator of a loop should be TerminatorKind::FalseUnwind
      terminator.kind.$ === "FalseUnwind"
    ) {
      return location;
    }
  }
  return undefined;
};

/// Access to the SCC constraint graph.
/// This can be used to quickly under-approximate the regions which are equal to each other
/// and their relative orderings.
// This is `pub` because it's used by unstable external borrowck data users, see `consumers.rs`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:838 constraint_sccs
RegionInferenceContextInner.prototype.constraint_sccs_ = function (this: RegionInferenceContextInner): ConstraintSccs {
  return this.constraint_sccs;
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:842 liveness_constraints
RegionInferenceContextInner.prototype.liveness_constraints_ = function (this: RegionInferenceContextInner): LivenessValues {
  return this.liveness_constraints;
};

/// Returns whether the `loan_idx` is live at the given `location`: whether its issuing
/// region is contained within the type of a variable that is live at this point.
/// Note: for now, the sets of live loans is only available when using `-Zpolonius=next`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:849 is_loan_live_at
RegionInferenceContextInner.prototype.is_loan_live_at = function (
  this: RegionInferenceContextInner,
  loan_idx: BorrowIndex,
  location: Location,
): boolean {
  const point = this.liveness_constraints.location_map_().point_from_location(location);
  return this.liveness_constraints.is_loan_live_at(loan_idx, point);
};

// ---- impl UnsolvedRegionInferenceContext ----

/// Propagate the region constraints: this will grow the values
/// for each region variable until all the constraints are
/// satisfied. Note that some values may grow **too** large to be
/// feasible, but we check this later.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:861 propagate_constraints
UnsolvedRegionInferenceContext.prototype.propagate_constraints = function (this: UnsolvedRegionInferenceContext): void {
  // debug!("constraints={:#?}", {
  //     let mut constraints: Vec<_> = self.outlives_constraints().collect();
  //     constraints.sort_by_key(|c| (c.sup, c.sub));
  //     constraints
  //         .into_iter()
  //         .map(|c| (c, self.constraint_sccs.scc(c.sup), self.constraint_sccs.scc(c.sub)))
  //         .collect::<Vec<_>>()
  // });

  // To propagate constraints, we walk the DAG induced by the
  // SCC. For each SCC `A`, we visit its successors and compute
  // their values, then we union all those values to get our
  // own. This one-shot approach works because iteration is in
  // dependency order. I.e. a chain A: B: C will visit C, B, A.
  for (const scc_a of this.constraint_sccs.all_sccs()) {
    // Walk each SCC `B` such that `A: B`...
    for (const scc_b of this.inner.constraint_sccs.successors(scc_a)) {
      // debug!(?scc_b);
      this.inner.scc_values.add_region(scc_a, scc_b);
    }
  }
};

/// Returns `true` if all the placeholders in the value of `scc_b` are nameable
/// in `scc_a`. Used during constraint propagation, and only once
/// the value of `scc_b` has been computed.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:888 can_name_all_placeholders
UnsolvedRegionInferenceContext.prototype.can_name_all_placeholders = function (
  this: UnsolvedRegionInferenceContext,
  scc_a: ConstraintSccIndex,
  scc_b: ConstraintSccIndex,
): boolean {
  return index_vec(this.scc_annotations, scc_a).can_name_all_placeholders(index_vec(this.scc_annotations, scc_b));
};

/// Once regions have been propagated, this method is used to see
/// whether the "type tests" produced by typeck were satisfied;
/// type tests encode type-outlives relationships like `T:
/// 'a`. See `TypeTest` for more details.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:900 check_type_tests
UnsolvedRegionInferenceContext.prototype.check_type_tests = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  propagated_outlives_requirements: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
): void {
  const tcx = infcx.tcx;

  // Sometimes we register equivalent type-tests that would
  // result in basically the exact same error being reported to
  // the user. Avoid that.
  const deduplicate_errors = new KeyedSet<[GenericKind, RegionVid, Span]>(intern_key);
  const failed_type_tests: [GenericKind, TypeTest][] = [];

  for (const type_test of this.type_tests) {
    // debug!("check_type_test: {:?}", type_test);

    const generic_ty = GenericKind.to_ty(type_test.generic_kind, tcx);
    if (this.eval_verify_bound(infcx, generic_ty, type_test.lower_bound, type_test.verify_bound)) {
      continue;
    }

    if (propagated_outlives_requirements !== undefined && this.try_promote_type_test(infcx, type_test, propagated_outlives_requirements)) {
      continue;
    }

    // Type-test failed. Collect it so we can suppress redundant errors below.
    const erased_generic_kind = infcx.tcx.erase_and_anonymize_regions(type_test.generic_kind, fold_GenericKind);
    failed_type_tests.push([erased_generic_kind, type_test]);
  }

  // An async body can produce both `G: 'static` and `G: 'a` type-test failures at
  // the same span, as in `tests/ui/async-await/spurious-static-bound-issue-115376.rs`.
  // Reporting the weaker bound adds a redundant diagnostic and suggests a lifetime
  // bound that cannot fix the missing `G: 'static` requirement. Keep the `'static`
  // error and suppress weaker failures for the same erased generic kind and span.
  // This is a diagnostic heuristic, using the same erasure as deduplication below.
  //
  // Collect all failed `'static` bounds before reporting errors so suppression does
  // not depend on the order of the type tests. Compare SCCs because a lower-bound
  // region can be equivalent to `'static` without being `fr_static` itself.
  const static_scc = this.constraint_sccs.scc(this.universal_regions().fr_static);
  const static_bound_errors = new KeyedSet<[GenericKind, Span]>(intern_key);
  for (const [erased_generic_kind, type_test] of failed_type_tests) {
    if (this.constraint_sccs.scc(type_test.lower_bound) === static_scc) {
      static_bound_errors.add([erased_generic_kind, type_test.span]);
    }
  }

  // If `G: 'static` failed at this span, then same-span `G: 'a` failures are weaker.
  for (const [erased_generic_kind, type_test] of failed_type_tests) {
    if (
      this.constraint_sccs.scc(type_test.lower_bound) !== static_scc &&
      static_bound_errors.has([erased_generic_kind, type_test.span])
    ) {
      continue;
    }

    // Skip duplicate-ish errors.
    const key: [GenericKind, RegionVid, Span] = [erased_generic_kind, type_test.lower_bound, type_test.span];
    if (!deduplicate_errors.has(key)) {
      deduplicate_errors.add(key);
      // debug!(
      //     "check_type_test: reporting error for erased_generic_kind={:?}, \
      //      lower_bound_region={:?}, \
      //      type_test.span={:?}",
      //     erased_generic_kind, type_test.lower_bound, type_test.span,
      // );

      errors_buffer.push({ $: "TypeTestError", type_test: clone_TypeTest(type_test) });
    }
  }
};

/// Invoked when we have some type-test (e.g., `T: 'X`) that we cannot
/// prove to be satisfied. If this is a closure, we will attempt to
/// "promote" this type-test into our `ClosureRegionRequirements` and
/// hence pass it up the creator. To do this, we have to phrase the
/// type-test in terms of external free regions, as local free
/// regions are not nameable by the closure's creator.
///
/// Promotion works as follows: we first check that the type `T`
/// contains only regions that the creator knows about. If this is
/// true, then -- as a consequence -- we know that all regions in
/// the type `T` are free regions that outlive the closure body. If
/// false, then promotion fails.
///
/// Once we've promoted T, we have to "promote" `'X` to some region
/// that is "external" to the closure. Generally speaking, a region
/// may be the union of some points in the closure body as well as
/// various free lifetimes. We can ignore the points in the closure
/// body: if the type T can be expressed in terms of external regions,
/// we know it outlives the points in the closure body. That
/// just leaves the free regions.
///
/// The idea then is to lower the `T: 'X` constraint into multiple
/// bounds -- e.g., if `'X` is the union of two free lifetimes,
/// `'1` and `'2`, then we would create `T: '1` and `T: '2`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1011 try_promote_type_test
UnsolvedRegionInferenceContext.prototype.try_promote_type_test = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  type_test: TypeTest,
  propagated_outlives_requirements: ClosureOutlivesRequirement[],
): boolean {
  const tcx = infcx.tcx;
  const { generic_kind, lower_bound, span: blame_span } = type_test;

  const generic_ty = GenericKind.to_ty(generic_kind, tcx);
  const subject = this.try_promote_type_test_subject(infcx, generic_ty);
  if (subject === undefined) {
    return false;
  }

  const r_scc = this.constraint_sccs.scc(lower_bound);
  // debug!(
  //     "lower_bound = {:?} r_scc={:?} universe={:?}",
  //     lower_bound,
  //     r_scc,
  //     self.max_nameable_universe(r_scc)
  // );
  // If the type test requires that `T: 'a` where `'a` is a
  // placeholder from another universe, that effectively requires
  // `T: 'static`, so we have to propagate that requirement.
  //
  // It doesn't matter *what* universe because the promoted `T` will
  // always be in the root universe.
  for (const _p of this.scc_values.placeholders_contained_in(r_scc)) {
    // debug!("encountered placeholder in higher universe: {:?}, requiring 'static", p);
    const static_r = this.universal_regions().fr_static;
    propagated_outlives_requirements.push({
      subject,
      outlived_free_region: static_r,
      blame_span,
      category: ConstraintCategory.Boring,
    });

    // we can return here -- the code below might push add'l constraints
    // but they would all be weaker than this one.
    return true;
  }

  // For each region outlived by lower_bound find a non-local,
  // universal region (it may be the same region) and add it to
  // `ClosureOutlivesRequirement`.
  let found_outlived_universal_region = false;
  for (const ur of this.scc_values.universal_regions_outlived_by(r_scc)) {
    found_outlived_universal_region = true;
    // debug!("universal_region_outlived_by ur={:?}", ur);
    const non_local_ub = this.universal_region_relations.non_local_upper_bounds(ur);
    // debug!(?non_local_ub);

    // This is slightly too conservative. To show T: '1, given `'2: '1`
    // and `'3: '1` we only need to prove that T: '2 *or* T: '3, but to
    // avoid potential non-determinism we approximate this by requiring
    // T: '1 and T: '2.
    for (const upper_bound of non_local_ub) {
      // debug_assert!(self.universal_regions().is_universal_region(upper_bound));
      // debug_assert!(!self.universal_regions().is_local_free_region(upper_bound));

      const requirement: ClosureOutlivesRequirement = {
        subject,
        outlived_free_region: upper_bound,
        blame_span,
        category: ConstraintCategory.Boring,
      };
      // debug!(?requirement, "adding closure requirement");
      propagated_outlives_requirements.push(requirement);
    }
  }
  // If we succeed to promote the subject, i.e. it only contains non-local regions,
  // and fail to prove the type test inside of the closure, the `lower_bound` has to
  // also be at least as large as some universal region, as the type test is otherwise
  // trivial.
  assert(found_outlived_universal_region, "assertion failed: found_outlived_universal_region");
  return true;
};

/// When we promote a type test `T: 'r`, we have to replace all region
/// variables in the type `T` with an equal universal region from the
/// closure signature.
/// This is not always possible, so this is a fallible process.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1094 try_promote_type_test_subject
UnsolvedRegionInferenceContext.prototype.try_promote_type_test_subject = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  ty_: Ty,
): ClosureOutlivesSubject | undefined {
  const tcx = infcx.tcx;
  let failed = false;
  const ty = fold_regions(
    tcx,
    ty_,
    (r, _depth) => {
      const r_vid = this.to_region_vid(r);
      const r_scc = this.constraint_sccs.scc(r_vid);

      // The challenge is this. We have some region variable `r`
      // whose value is a set of CFG points and universal
      // regions. We want to find if that set is *equivalent* to
      // any of the named regions found in the closure.
      // To do so, we simply check every candidate `u_r` for equality.
      for (const u_r of this.scc_values.universal_regions_outlived_by(r_scc)) {
        if (this.universal_regions().is_local_free_region(u_r)) continue;
        if (this.eval_equal(u_r, r_vid)) return Region.new_var(tcx, u_r);
      }
      // In case we could not find a named region to map to,
      // we will return `None` below.
      failed = true;
      return r;
    },
    fold_Ty,
  );

  // debug!("try_promote_type_test_subject: folded ty = {:?}", ty);

  // This will be true if we failed to promote some region.
  if (failed) {
    return undefined;
  }

  return { $: "Ty", _0: ClosureOutlivesSubjectTy.bind(tcx, ty) };
};

/// Tests if `test` is true when applied to `lower_bound` at
/// `point`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1135 eval_verify_bound
UnsolvedRegionInferenceContext.prototype.eval_verify_bound = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  generic_ty: Ty,
  lower_bound: RegionVid,
  verify_bound: VerifyBound,
): boolean {
  // debug!("eval_verify_bound(lower_bound={:?}, verify_bound={:?})", lower_bound, verify_bound);

  switch (verify_bound.$) {
    case "IfEq": {
      const verify_if_eq_b = verify_bound._0;
      return this.eval_if_eq(infcx, generic_ty, lower_bound, verify_if_eq_b);
    }

    case "IsEmpty": {
      const lower_bound_scc = this.constraint_sccs.scc(lower_bound);
      for (const _e of this.scc_values.elements_contained_in(lower_bound_scc)) return false;
      return true;
    }

    case "OutlivedBy": {
      const r = verify_bound._0;
      const r_vid = this.to_region_vid(r);
      return this.eval_outlives(r_vid, lower_bound);
    }

    case "AnyBound": {
      const verify_bounds = verify_bound._0;
      return verify_bounds.some((verify_bound) => this.eval_verify_bound(infcx, generic_ty, lower_bound, verify_bound));
    }

    case "AllBounds": {
      const verify_bounds = verify_bound._0;
      return verify_bounds.every((verify_bound) => this.eval_verify_bound(infcx, generic_ty, lower_bound, verify_bound));
    }
  }
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1169 eval_if_eq
UnsolvedRegionInferenceContext.prototype.eval_if_eq = function (
  this: UnsolvedRegionInferenceContext,
  infcx: InferCtxt,
  generic_ty_: Ty,
  lower_bound: RegionVid,
  verify_if_eq_b_: Binder<VerifyIfEq>,
): boolean {
  const generic_ty = this.normalize_to_scc_representatives(infcx.tcx, generic_ty_, fold_Ty);
  const verify_if_eq_b = this.normalize_to_scc_representatives(infcx.tcx, verify_if_eq_b_, fold_Binder(fold_VerifyIfEq()));
  const r = extract_verify_if_eq(infcx.tcx, verify_if_eq_b, generic_ty);
  if (r !== undefined) {
    const r_vid = this.to_region_vid(r);
    return this.eval_outlives(r_vid, lower_bound);
  } else {
    return false;
  }
};

/// This is a conservative normalization procedure. It takes every
/// free region in `value` and replaces it with the
/// "representative" of its SCC (see `scc_representatives` field).
/// We are guaranteed that if two values normalize to the same
/// thing, then they are equal; this is a conservative check in
/// that they could still be equal even if they normalize to
/// different results. (For example, there might be two regions
/// with the same value that are not in the same SCC).
///
/// N.B., this is not an ideal approach and I would like to revisit
/// it. However, it works pretty well in practice. In particular,
/// this is needed to deal with projection outlives bounds like
///
/// ```text
/// <T as Foo<'0>>::Item: '1
/// ```
///
/// In particular, this routine winds up being important when
/// there are bounds like `where <T as Foo<'a>>::Item: 'b` in the
/// environment. In this case, if we can show that `'0 == 'a`,
/// and that `'b: '1`, then we know that the clause is
/// satisfied. In such cases, particularly due to limitations of
/// the trait solver =), we usually wind up with a where-clause like
/// `T: Foo<'a>` in scope, which thus forces `'0 == 'a` to be added as
/// a constraint, and thus ensures that they are in the same SCC.
///
/// So why can't we do a more correct routine? Well, we could
/// *almost* use the `relate_tys` code, but the way it is
/// currently setup it creates inference variables to deal with
/// higher-ranked things and so forth, and right now the inference
/// context is not permitted to make more inference variables. So
/// we use this kind of hacky solution.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1219 normalize_to_scc_representatives
UnsolvedRegionInferenceContext.prototype.normalize_to_scc_representatives = function <T>(
  this: UnsolvedRegionInferenceContext,
  tcx: TyCtxt,
  value: T,
  d_T: TypeFoldable<T>,
): T {
  return fold_regions(
    tcx,
    value,
    (r, _db) => {
      const vid = this.to_region_vid(r);
      const scc = this.constraint_sccs.scc(vid);
      const repr = this.scc_representative(scc);
      return Region.new_var(tcx, repr);
    },
    d_T,
  );
};

/// Evaluate whether `sup_region == sub_region`.
///
/// Panics if called before `solve()` executes,
// This is `pub` because it's used by unstable external borrowck data users, see `consumers.rs`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1235 eval_equal
UnsolvedRegionInferenceContext.prototype.eval_equal = function (this: UnsolvedRegionInferenceContext, r1: RegionVid, r2: RegionVid): boolean {
  return this.eval_outlives(r1, r2) && this.eval_outlives(r2, r1);
};

/// Evaluate whether `sup_region: sub_region`.
///
/// Panics if called before `solve()` executes,
// This is `pub` because it's used by unstable external borrowck data users, see `consumers.rs`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1244 eval_outlives
UnsolvedRegionInferenceContext.prototype.eval_outlives = function (
  this: UnsolvedRegionInferenceContext,
  sup_region: RegionVid,
  sub_region: RegionVid,
): boolean {
  // debug!(
  //     "sup_region's value = {:?} universal={:?}",
  //     self.region_value_str(sup_region),
  //     self.universal_regions().is_universal_region(sup_region),
  // );
  // debug!(
  //     "sub_region's value = {:?} universal={:?}",
  //     self.region_value_str(sub_region),
  //     self.universal_regions().is_universal_region(sub_region),
  // );

  const sub_region_scc = this.constraint_sccs.scc(sub_region);
  const sup_region_scc = this.constraint_sccs.scc(sup_region);

  if (sub_region_scc === sup_region_scc) {
    // debug!("{sup_region:?}: {sub_region:?} holds trivially; they are in the same SCC");
    return true;
  }

  const fr_static = this.universal_regions().fr_static;

  // If we are checking that `'sup: 'sub`, and `'sub` contains
  // some placeholder that `'sup` cannot name, then this is only
  // true if `'sup` outlives static.
  //
  // Avoid infinite recursion if `sub_region` is already `'static`
  if (sub_region !== fr_static && !this.can_name_all_placeholders(sup_region_scc, sub_region_scc)) {
    // debug!(
    //     "sub universe `{sub_region_scc:?}` is not nameable \
    //     by super `{sup_region_scc:?}`, promoting to static",
    // );

    return this.eval_outlives(sup_region, fr_static);
  }

  // Both the `sub_region` and `sup_region` consist of the union
  // of some number of universal regions (along with the union
  // of various points in the CFG; ignore those points for
  // now). Therefore, the sup-region outlives the sub-region if,
  // for each universal region R1 in the sub-region, there
  // exists some region R2 in the sup-region that outlives R1.
  let universal_outlives = true;
  for (const r1 of this.scc_values.universal_regions_outlived_by(sub_region_scc)) {
    let any = false;
    for (const r2 of this.scc_values.universal_regions_outlived_by(sup_region_scc)) {
      if (this.universal_region_relations.outlives_(r2, r1)) {
        any = true;
        break;
      }
    }
    if (!any) {
      universal_outlives = false;
      break;
    }
  }

  if (!universal_outlives) {
    // debug!("sub region contains a universal region not present in super");
    return false;
  }

  // Now we have to compare all the points in the sub region and make
  // sure they exist in the sup region.

  if (this.universal_regions().is_universal_region(sup_region)) {
    // Micro-opt: universal regions contain all points.
    // debug!("super is universal and hence contains all points");
    return true;
  }

  // debug!("comparison between points in sup/sub");

  return this.scc_values.contains_points(sup_region_scc, sub_region_scc);
};

/// Once regions have been propagated, this method is used to see
/// whether any of the constraints were too strong. In particular,
/// we want to check for a case where a universally quantified
/// region exceeded its bounds. Consider:
/// ```compile_fail
/// fn foo<'a, 'b>(x: &'a u32) -> &'b u32 { x }
/// ```
/// In this case, returning `x` requires `&'a u32 <: &'b u32`
/// and hence we establish (transitively) a constraint that
/// `'a: 'b`. The `propagate_constraints` code above will
/// therefore add `end('a)` into the region for `'b` -- but we
/// have no evidence that `'b` outlives `'a`, so we want to report
/// an error.
///
/// If `propagated_outlives_requirements` is `Some`, then we will
/// push unsatisfied obligations into there. Otherwise, we'll
/// report them as errors.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1331 check_universal_regions
UnsolvedRegionInferenceContext.prototype.check_universal_regions = function (
  this: UnsolvedRegionInferenceContext,
  propagated_outlives_requirements_: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
): void {
  const propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined> = { value: propagated_outlives_requirements_ };
  const definitions = this.definitions;
  for (let fr = 0 as RegionVid; fr < definitions.length; fr++) {
    const fr_definition = definitions[fr]!;
    // debug!(?fr, ?fr_definition);
    switch (fr_definition.origin.$) {
      case "FreeRegion": {
        // Go through each of the universal regions `fr` and check that
        // they did not grow too large, accumulating any requirements
        // for our caller into the `outlives_requirements` vector.
        this.check_universal_region(fr, propagated_outlives_requirements, errors_buffer);
        break;
      }

      case "Placeholder": {
        const placeholder = fr_definition.origin._0;
        this.check_bound_universal_region(fr, placeholder, errors_buffer);
        break;
      }

      case "Existential": {
        // nothing to check here
        break;
      }
    }
  }
};

/// Checks if Polonius has found any unexpected free region relations.
///
/// In Polonius terms, a "subset error" (or "illegal subset relation error") is the equivalent
/// of NLL's "checking if any region constraints were too strong": a placeholder origin `'a`
/// was unexpectedly found to be a subset of another placeholder origin `'b`, and means in NLL
/// terms that the "longer free region" `'a` outlived the "shorter free region" `'b`.
///
/// More details can be found in this blog post by Niko:
/// <https://smallcultfollowing.com/babysteps/blog/2019/01/17/polonius-and-region-errors/>
///
/// In the canonical example
/// ```compile_fail
/// fn foo<'a, 'b>(x: &'a u32) -> &'b u32 { x }
/// ```
/// returning `x` requires `&'a u32 <: &'b u32` and hence we establish (transitively) a
/// constraint that `'a: 'b`. It is an error that we have no evidence that this
/// constraint holds.
///
/// If `propagated_outlives_requirements` is `Some`, then we will
/// push unsatisfied obligations into there. Otherwise, we'll
/// report them as errors.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1382 check_polonius_subset_errors
UnsolvedRegionInferenceContext.prototype.check_polonius_subset_errors = function (
  this: UnsolvedRegionInferenceContext,
  propagated_outlives_requirements_: ClosureOutlivesRequirement[] | undefined,
  errors_buffer: RegionErrors,
  polonius_output: PoloniusOutput,
): void {
  const propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined> = { value: propagated_outlives_requirements_ };
  // debug!(
  //     "check_polonius_subset_errors: {} subset_errors",
  //     polonius_output.subset_errors.len()
  // );

  // Similarly to `check_universal_regions`: a free region relation, which was not explicitly
  // declared ("known") was found by Polonius, so emit an error, or propagate the
  // requirements for our caller into the `propagated_outlives_requirements` vector.
  //
  // Polonius doesn't model regions ("origins") as CFG-subsets or durations, but the
  // `longer_fr` and `shorter_fr` terminology will still be used here, for consistency with
  // the rest of the NLL infrastructure. The "subset origin" is the "longer free region",
  // and the "superset origin" is the outlived "shorter free region".
  //
  // Note: Polonius will produce a subset error at every point where the unexpected
  // `longer_fr`'s "placeholder loan" is contained in the `shorter_fr`. This can be helpful
  // for diagnostics in the future, e.g. to point more precisely at the key locations
  // requiring this constraint to hold. However, the error and diagnostics code downstream
  // expects that these errors are not duplicated (and that they are in a certain order).
  // Otherwise, diagnostics messages such as the ones giving names like `'1` to elided or
  // anonymous lifetimes for example, could give these names differently, while others like
  // the outlives suggestions or the debug output from `#[rustc_regions]` would be
  // duplicated. The polonius subset errors are deduplicated here, while keeping the
  // CFG-location ordering.
  // We can iterate the HashMap here because the result is sorted afterwards.
  const subset_errors_: (readonly [PoloniusRegionVid, PoloniusRegionVid])[] = [];
  for (const [_location, subset_errors] of polonius_output.subset_errors) {
    for (const e of subset_errors.iter()) subset_errors_.push(e);
  }
  // `sort` + `dedup` on `(Origin, Origin)` tuples (lexicographic `Ord`).
  subset_errors_.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const subset_errors = subset_errors_.filter((e, i) => i === 0 || e[0] !== subset_errors_[i - 1]![0] || e[1] !== subset_errors_[i - 1]![1]);

  for (const [longer_fr, shorter_fr] of subset_errors) {
    // debug!(
    //     "check_polonius_subset_errors: subset_error longer_fr={:?},\
    //      shorter_fr={:?}",
    //     longer_fr, shorter_fr
    // );

    const propagated = this.try_propagate_universal_region_error(
      RegionVid.from_usize(PoloniusRegionVid.as_usize(longer_fr)),
      RegionVid.from_usize(PoloniusRegionVid.as_usize(shorter_fr)),
      propagated_outlives_requirements,
    );
    if (propagated === RegionRelationCheckResult.Error) {
      errors_buffer.push({
        $: "RegionError",
        longer_fr: RegionVid.from_usize(PoloniusRegionVid.as_usize(longer_fr)),
        shorter_fr: RegionVid.from_usize(PoloniusRegionVid.as_usize(shorter_fr)),
        fr_origin: NllRegionVariableOrigin.FreeRegion,
        is_reported: true,
      });
    }
  }

  // Handle the placeholder errors as usual, until the chalk-rustc-polonius triumvirate has
  // a more complete picture on how to separate this responsibility.
  const definitions = this.definitions;
  for (let fr = 0 as RegionVid; fr < definitions.length; fr++) {
    const fr_definition = definitions[fr]!;
    switch (fr_definition.origin.$) {
      case "FreeRegion": {
        // handled by polonius above
        break;
      }

      case "Placeholder": {
        const placeholder = fr_definition.origin._0;
        this.check_bound_universal_region(fr, placeholder, errors_buffer);
        break;
      }

      case "Existential": {
        // nothing to check here
        break;
      }
    }
  }
};

/// Checks the final value for the free region `fr` to see if it
/// grew too large. In particular, examine what `end(X)` points
/// wound up in `fr`'s final value; for each `end(X)` where `X !=
/// fr`, we want to check that `fr: X`. If not, that's either an
/// error, or something we have to propagate to our creator.
///
/// Things that are to be propagated are accumulated into the
/// `outlives_requirements` vector.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1472 check_universal_region
UnsolvedRegionInferenceContext.prototype.check_universal_region = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
  errors_buffer: RegionErrors,
): void {
  const longer_fr_scc = this.constraint_sccs.scc(longer_fr);

  // Because this free region must be in the ROOT universe, we
  // know it cannot contain any bound universes.
  assert(UniverseIndex.is_root(this.max_nameable_universe(longer_fr_scc)), "assertion failed: self.max_nameable_universe(longer_fr_scc).is_root()");

  // Only check all of the relations for the main representative of each
  // SCC, otherwise just check that we outlive said representative. This
  // reduces the number of redundant relations propagated out of
  // closures.
  // Note that the representative will be a universal region if there is
  // one in this SCC, so we will always check the representative here.
  const representative = this.scc_representative(longer_fr_scc);
  if (representative !== longer_fr) {
    if (this.check_universal_region_relation(longer_fr, representative, propagated_outlives_requirements) === RegionRelationCheckResult.Error) {
      errors_buffer.push({
        $: "RegionError",
        longer_fr,
        shorter_fr: representative,
        fr_origin: NllRegionVariableOrigin.FreeRegion,
        is_reported: true,
      });
    }
    return;
  }

  // Find every region `o` such that `fr: o`
  // (because `fr` includes `end(o)`).
  let error_reported = false;
  for (const shorter_fr of this.scc_values.universal_regions_outlived_by(longer_fr_scc)) {
    if (this.check_universal_region_relation(longer_fr, shorter_fr, propagated_outlives_requirements) === RegionRelationCheckResult.Error) {
      // We only report the first region error. Subsequent errors are hidden so as
      // not to overwhelm the user, but we do record them so as to potentially print
      // better diagnostics elsewhere...
      errors_buffer.push({
        $: "RegionError",
        longer_fr,
        shorter_fr,
        fr_origin: NllRegionVariableOrigin.FreeRegion,
        is_reported: !error_reported,
      });

      error_reported = true;
    }
  }
};

/// Checks that we can prove that `longer_fr: shorter_fr`. If we can't we attempt to propagate
/// the constraint outward (e.g. to a closure environment), but if that fails, there is an
/// error.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1534 check_universal_region_relation
UnsolvedRegionInferenceContext.prototype.check_universal_region_relation = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  shorter_fr: RegionVid,
  propagated_outlives_requirements: MutRef<ClosureOutlivesRequirement[] | undefined>,
): RegionRelationCheckResult {
  // If it is known that `fr: o`, carry on.
  if (this.universal_region_relations.outlives_(longer_fr, shorter_fr)) {
    return RegionRelationCheckResult.Ok;
  } else {
    // If we are not in a context where we can't propagate errors, or we
    // could not shrink `fr` to something smaller, then just report an
    // error.
    //
    // Note: in this case, we use the unapproximated regions to report the
    // error. This gives better error messages in some cases.
    return this.try_propagate_universal_region_error(longer_fr, shorter_fr, propagated_outlives_requirements);
  }
};

/// Attempt to propagate a region error (e.g. `'a: 'b`) that is not met to a closure's
/// creator. If we cannot, then the caller should report an error to the user.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1560 try_propagate_universal_region_error
UnsolvedRegionInferenceContext.prototype.try_propagate_universal_region_error = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  shorter_fr: RegionVid,
  propagated_outlives_requirements_: MutRef<ClosureOutlivesRequirement[] | undefined>,
): RegionRelationCheckResult {
  const propagated_outlives_requirements = propagated_outlives_requirements_.value;
  if (propagated_outlives_requirements !== undefined) {
    // Shrink `longer_fr` until we find some non-local regions.
    // We'll call them `longer_fr-` -- they are ever so slightly smaller than
    // `longer_fr`.
    const longer_fr_minus = this.universal_region_relations.non_local_lower_bounds(longer_fr);

    // debug!("try_propagate_universal_region_error: fr_minus={:?}", longer_fr_minus);

    // If we don't find a any non-local regions, we should error out as there is nothing
    // to propagate.
    if (longer_fr_minus.length === 0) {
      return RegionRelationCheckResult.Error;
    }

    const best_blame = this.best_blame_constraint(longer_fr, NllRegionVariableOrigin.FreeRegion, shorter_fr);
    const { category, span } = best_blame.constraint();

    // Grow `shorter_fr` until we find some non-local regions.
    // We will always find at least one: `'static`. We'll call
    // them `shorter_fr+` -- they're ever so slightly larger
    // than `shorter_fr`.
    const shorter_fr_plus = this.universal_region_relations.non_local_upper_bounds(shorter_fr);
    // debug!("try_propagate_universal_region_error: shorter_fr_plus={:?}", shorter_fr_plus);

    // We then create constraints `longer_fr-: shorter_fr+` that may or may not
    // be propagated (see below).
    const constraints: [RegionVid, RegionVid][] = [];
    for (const fr_minus of longer_fr_minus) {
      for (const shorter_fr_plus_ of shorter_fr_plus) {
        constraints.push([fr_minus, shorter_fr_plus_]);
      }
    }

    // We only need to propagate at least one of the constraints for
    // soundness. However, we want to avoid arbitrary choices here
    // and currently don't support returning OR constraints.
    //
    // If any of the `shorter_fr+` regions are already outlived by `longer_fr-`,
    // we propagate only those.
    //
    // Consider this example (`'b: 'a` == `a -> b`), where we try to propagate `'d: 'a`:
    // a --> b --> d
    //  \
    //   \-> c
    // Here, `shorter_fr+` of `'a` == `['b, 'c]`.
    // Propagating `'d: 'b` is correct and should occur; `'d: 'c` is redundant because of
    // `'d: 'b` and could reject valid code.
    //
    // So we filter the constraints to regions already outlived by `longer_fr-`, but if
    // the filter yields an empty set, we fall back to the original one.
    const subset = constraints.filter(([fr_minus, shorter_fr_plus_]) => this.eval_outlives(fr_minus, shorter_fr_plus_));
    const propagated_constraints = subset.length === 0 ? constraints : subset;
    // debug!(
    //     "try_propagate_universal_region_error: constraints={:?}",
    //     propagated_constraints
    // );

    assert(propagated_constraints.length !== 0, "Expected at least one constraint to propagate here");

    for (const [fr_minus, fr_plus] of propagated_constraints) {
      // Push the constraint `long_fr-: shorter_fr+`
      propagated_outlives_requirements.push({
        subject: { $: "Region", _0: fr_minus },
        outlived_free_region: fr_plus,
        blame_span: span,
        category,
      });
    }
    return RegionRelationCheckResult.Propagated;
  }

  return RegionRelationCheckResult.Error;
};

// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1654 check_bound_universal_region
UnsolvedRegionInferenceContext.prototype.check_bound_universal_region = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  placeholder: PlaceholderRegion,
  errors_buffer: RegionErrors,
): void {
  // debug!("check_bound_universal_region(fr={:?}, placeholder={:?})", longer_fr, placeholder,);

  const longer_fr_scc = this.constraint_sccs.scc(longer_fr);
  // debug!("check_bound_universal_region: longer_fr_scc={:?}", longer_fr_scc,);

  // If we have some bound universal region `'a`, then the only
  // elements it can contain is itself -- we don't know anything
  // else about it!
  const placeholder_element: RegionElement = { $: "PlaceholderRegion", _0: placeholder };
  let error_element: RegionElement | undefined = undefined;
  for (const e of this.scc_values.elements_contained_in(longer_fr_scc)) {
    if (!intern_key_eq(e, placeholder_element)) {
      error_element = e;
      break;
    }
  }
  if (error_element !== undefined) {
    const illegally_outlived_r = this.region_from_element(longer_fr, error_element);
    // Stop after the first error, it gets too noisy otherwise, and does not provide more information.
    errors_buffer.push({
      $: "PlaceholderOutlivesIllegalRegion",
      longer_fr,
      illegally_outlived_r,
    });
  } else {
    // debug!("check_bound_universal_region: all bounds satisfied");
  }
};

/// Get the region outlived by `longer_fr` and live at `element`.
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1685 region_from_element
UnsolvedRegionInferenceContext.prototype.region_from_element = function (
  this: UnsolvedRegionInferenceContext,
  longer_fr: RegionVid,
  element: RegionElement,
): RegionVid {
  switch (element.$) {
    case "Location": {
      const l = element._0;
      return this.find_sub_region_live_at(longer_fr, l);
    }
    case "RootUniversalRegion": {
      const r = element._0;
      return r;
    }
    case "PlaceholderRegion": {
      const error_placeholder = element._0;
      const definitions = this.definitions;
      for (let r = 0 as RegionVid; r < definitions.length; r++) {
        const definition = definitions[r]!;
        if (definition.origin.$ === "Placeholder" && intern_key_eq(definition.origin._0, error_placeholder)) {
          return r;
        }
      }
      return unwrap<RegionVid>(undefined);
    }
  }
};

/// Returns the representative `RegionVid` for a given SCC.
/// See `RegionTracker` for how a region variable ID is chosen.
///
/// It is a hacky way to manage checking regions for equality,
/// since we can 'canonicalize' each region to the representative
/// of its SCC and be sure that -- if they have the same repr --
/// they *must* be equal (though not having the same repr does not
/// mean they are unequal).
// rustc: compiler/rustc_borrowck/src/region_infer/region_context.rs:1712 scc_representative
UnsolvedRegionInferenceContext.prototype.scc_representative = function (
  this: UnsolvedRegionInferenceContext,
  scc: ConstraintSccIndex,
): RegionVid {
  return Representative.rvid(index_vec(this.scc_annotations, scc).representative);
};

// PORT: the derived `TypeFoldable` / `TypeVisitable` impls of `GenericKind` and `VerifyIfEq`
// (region_constraints/mod.gen.ts) as descriptors (built on use: init order).
const fold_GenericKind: TypeFoldable<GenericKind> = {
  visit_with: (self, visitor) => visit_with_GenericKind(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_GenericKind(self, folder),
  fold_with: (self, folder) => fold_with_GenericKind(self, folder),
};
function fold_VerifyIfEq(): TypeFoldable<VerifyIfEq> {
  return {
    visit_with: (self, visitor) => visit_with_VerifyIfEq(self, visitor),
    try_fold_with: (self, folder) => try_fold_with_VerifyIfEq(self, folder),
    fold_with: (self, folder) => fold_with_VerifyIfEq(self, folder),
  };
}
