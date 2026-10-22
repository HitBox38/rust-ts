// Port of compiler/rustc_borrowck/src/type_check/free_region_relations.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `UniversalRegionRelations::outlives(fr1, fr2)` is `outlives_()` (field `outlives`, mir-contract decision).
// PORT: the builder's `constraints: &mut Vec<&QueryRegionConstraints>` (`compute_implied_bounds`) is the array, pushed
// in place; `I: IntoIterator<Item = OutlivesBound>` is `Iterable<OutlivesBound>`; `impl Iterator` returns `Iterable`.
// PORT: `Frozen<T>` is `T` (`Frozen::freeze(x)` is `x`); `RegionBoundPairs::default()` is a `KeyedSet` on `intern_key`
// (rustc_infer outlives/env.ts); `OriginalQueryValues { var_values, ..Default::default() }` spreads `default_()`.
// `#[instrument]` / `debug!` stay comments (tracing is off in the oracle).
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { type TransitiveRelation, TransitiveRelationBuilder } from "../../rustc_data_structures/transitive_relation.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import { explicit_outlives_bounds } from "../../rustc_infer/infer/outlives/mod.ts";
import type { GenericKind } from "../../rustc_infer/infer/region_constraints/mod.ts";
import { type Canonical, OriginalQueryValues, QueryRegionConstraints, type QueryResponse } from "../../rustc_middle/infer/canonical.ts";
import { ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import {
  fold_with_MirBorrowckImpliedOutlivesBounds,
  fold_with_OutlivesBound,
  type MirBorrowckImpliedOutlivesBounds,
  type OutlivesBound,
  try_fold_with_MirBorrowckImpliedOutlivesBounds,
  try_fold_with_OutlivesBound,
  visit_with_MirBorrowckImpliedOutlivesBounds,
  visit_with_OutlivesBound,
} from "../../rustc_middle/traits/query.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_LocalDefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { QueryTypeOp_ImpliedOutlivesBounds } from "../../rustc_trait_selection/traits/implied_outlives_bounds.ts";
import type { TypeOpOutput } from "../../rustc_trait_selection/traits/query/type_op/mod.ts";
import { Normalizable_Ty, QueryTypeOp_Normalize } from "../../rustc_trait_selection/traits/query/type_op/normalize.ts";
import { QueryTypeOp_ProvePredicate } from "../../rustc_trait_selection/traits/query/type_op/prove_predicate.ts";
import { debug_TypeError } from "../../rustc_type_ir/error.gen.ts";
import { set_aliases_to_non_rigid, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { OutlivesClause } from "../../rustc_type_ir/predicate.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { type Result, unwrap_result } from "../../std/result.ts";
import { implied_bounds_query_var_values } from "../implied_bounds.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import { DefiningTy } from "../universal_regions.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { ConstraintConversion } from "./constraint_conversion.gen.ts";
import { type CreateResult, UniversalRegionRelations, UniversalRegionRelationsBuilder } from "./free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "./mod.gen.ts";

export * from "./free_region_relations.gen.ts";

/** PORT: `OutlivesBound`'s derived `TypeFoldable` / `TypeVisitable` (rustc_middle traits/query.gen.ts) as a descriptor. */
const d_OutlivesBound: TypeFoldable<OutlivesBound> = {
  visit_with: visit_with_OutlivesBound,
  try_fold_with: try_fold_with_OutlivesBound,
  fold_with: fold_with_OutlivesBound,
};

/** PORT: `MirBorrowckImpliedOutlivesBounds`'s derived `TypeFoldable` / `TypeVisitable` as a descriptor. */
const d_MirBorrowckImpliedOutlivesBounds: TypeFoldable<MirBorrowckImpliedOutlivesBounds> = {
  visit_with: visit_with_MirBorrowckImpliedOutlivesBounds,
  try_fold_with: try_fold_with_MirBorrowckImpliedOutlivesBounds,
  fold_with: fold_with_MirBorrowckImpliedOutlivesBounds,
};

declare module "./free_region_relations.gen.ts" {
  interface UniversalRegionRelations {
    // free_region_relations.rs:78
    postdom_upper_bound(fr1: RegionVid, fr2: RegionVid): RegionVid;
    // free_region_relations.rs:91
    non_local_upper_bounds(fr: RegionVid): RegionVid[];
    // free_region_relations.rs:103
    non_local_lower_bounds(fr: RegionVid): RegionVid[];
    // free_region_relations.rs:111
    non_local_bounds(relation: TransitiveRelation<RegionVid>, fr0: RegionVid): RegionVid[];
    // free_region_relations.rs:143
    outlives_(fr1: RegionVid, fr2: RegionVid): boolean;
    // free_region_relations.rs:150
    equal(fr1: RegionVid, fr2: RegionVid): boolean;
    // free_region_relations.rs:156
    regions_outlived_by(fr1: RegionVid): RegionVid[];
    // free_region_relations.rs:161
    known_outlives(): Iterable<[RegionVid, RegionVid]>;
  }
  interface UniversalRegionRelationsBuilder {
    // free_region_relations.rs:180
    relate_universal_regions(fr_a: RegionVid, fr_b: RegionVid): void;
    // free_region_relations.rs:188
    create_old(): CreateResult;
    // free_region_relations.rs:344
    create(): CreateResult;
    // free_region_relations.rs:462
    compute_implied_bounds(body_def_id: LocalDefId, span: Span, unnormalized_inputs_and_output: Ty[], constraints: QueryRegionConstraints[]): Ty[];
    // free_region_relations.rs:545
    add_implied_bounds(ty: Ty, span: Span): QueryRegionConstraints | undefined;
    // free_region_relations.rs:566
    add_outlives_bounds(outlives_bounds: Iterable<OutlivesBound>): void;
  }
}

// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:56 create
export function create(infcx: BorrowckInferCtxt, universal_regions: UniversalRegions, constraints: MirTypeckRegionConstraints): CreateResult {
  return new UniversalRegionRelationsBuilder(
    infcx,
    universal_regions,
    constraints,
    TransitiveRelationBuilder.default<RegionVid>(),
    TransitiveRelationBuilder.default<RegionVid>(),
    new KeyedSet<OutlivesClause<GenericKind>>(intern_key),
  ).create();
}

// ---- impl UniversalRegionRelations<'_> ----

/// Given two universal regions, returns the postdominating
/// upper-bound (effectively the least upper bound).
///
/// (See `TransitiveRelation::postdom_upper_bound` for details on
/// the postdominating upper bound in general.)
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:78 postdom_upper_bound
UniversalRegionRelations.prototype.postdom_upper_bound = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): RegionVid {
  assert(this.universal_regions.is_universal_region(fr1), "assertion failed: self.universal_regions.is_universal_region(fr1)");
  assert(this.universal_regions.is_universal_region(fr2), "assertion failed: self.universal_regions.is_universal_region(fr2)");
  return this.inverse_outlives.postdom_upper_bound(fr1, fr2) ?? this.universal_regions.fr_static;
};

/// Finds an "upper bound" for `fr` that is not local. In other
/// words, returns the smallest (*) known region `fr1` that (a)
/// outlives `fr` and (b) is not local.
///
/// (*) If there are multiple competing choices, we return all of them.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:91 non_local_upper_bounds
UniversalRegionRelations.prototype.non_local_upper_bounds = function (this: UniversalRegionRelations, fr: RegionVid): RegionVid[] {
  // debug!("non_local_upper_bound(fr={:?})", fr);
  const res = this.non_local_bounds(this.inverse_outlives, fr);
  assert(!(res.length === 0), "can't find an upper bound!?");
  return res;
};

/// Finds a "lower bound" for `fr` that is not local. In other
/// words, returns the largest (*) known region `fr1` that (a) is
/// outlived by `fr` and (b) is not local.
///
/// (*) If there are multiple competing choices, we return all of them.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:103 non_local_lower_bounds
UniversalRegionRelations.prototype.non_local_lower_bounds = function (this: UniversalRegionRelations, fr: RegionVid): RegionVid[] {
  // debug!("non_local_lower_bound(fr={:?})", fr);
  return this.non_local_bounds(this.outlives, fr);
};

/// Helper for `non_local_upper_bounds` and `non_local_lower_bounds`.
/// Repeatedly invokes `postdom_parent` until we find something that is not
/// local. Returns `None` if we never do so.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:111 non_local_bounds
UniversalRegionRelations.prototype.non_local_bounds = function (this: UniversalRegionRelations, relation: TransitiveRelation<RegionVid>, fr0: RegionVid): RegionVid[] {
  // This method assumes that `fr0` is one of the universally
  // quantified region variables.
  assert(this.universal_regions.is_universal_region(fr0), "assertion failed: self.universal_regions.is_universal_region(fr0)");

  const external_parents: RegionVid[] = [];

  const queue: RegionVid[] = [relation.minimal_scc_representative(fr0)];

  // Keep expanding `fr` into its parents until we reach
  // non-local regions.
  for (;;) {
    const fr = queue.pop();
    if (fr === undefined) break;
    if (!this.universal_regions.is_local_free_region(fr)) {
      external_parents.push(fr);
      continue;
    }

    queue.push(...relation.parents(fr));
  }

  // debug!("non_local_bound: external_parents={:?}", external_parents);

  return external_parents;
};

/// Returns `true` if fr1 is known to outlive fr2.
///
/// This will only ever be true for universally quantified regions.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:143 outlives
UniversalRegionRelations.prototype.outlives_ = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): boolean {
  return this.outlives.contains(fr1, fr2);
};

/// Returns `true` if fr1 is known to equal fr2.
///
/// This will only ever be true for universally quantified regions.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:150 equal
UniversalRegionRelations.prototype.equal = function (this: UniversalRegionRelations, fr1: RegionVid, fr2: RegionVid): boolean {
  return this.outlives.contains(fr1, fr2) && this.outlives.contains(fr2, fr1);
};

/// Returns a vector of free regions `x` such that `fr1: x` is
/// known to hold.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:156 regions_outlived_by
UniversalRegionRelations.prototype.regions_outlived_by = function (this: UniversalRegionRelations, fr1: RegionVid): RegionVid[] {
  return this.outlives.reachable_from(fr1);
};

/// Returns the _non-transitive_ set of known `outlives` constraints between free regions.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:161 known_outlives
UniversalRegionRelations.prototype.known_outlives = function (this: UniversalRegionRelations): Iterable<[RegionVid, RegionVid]> {
  return this.outlives.base_edges();
};

// ---- impl<'tcx> UniversalRegionRelationsBuilder<'_, 'tcx> ----

/// Records in the `outlives_relation` (and
/// `inverse_outlives_relation`) that `fr_a: fr_b`.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:180 relate_universal_regions
UniversalRegionRelationsBuilder.prototype.relate_universal_regions = function (this: UniversalRegionRelationsBuilder, fr_a: RegionVid, fr_b: RegionVid): void {
  // debug!("relate_universal_regions: fr_a={:?} outlives fr_b={:?}", fr_a, fr_b);
  this.outlives.add(fr_a, fr_b);
  this.inverse_outlives.add(fr_b, fr_a);
};

// FIXME(#160491): Remove this once the new implied bounds impl is through FCP.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:188 create_old
UniversalRegionRelationsBuilder.prototype.create_old = function (this: UniversalRegionRelationsBuilder): CreateResult {
  const tcx = this.infcx.tcx;
  const defining_ty_def_id = DefiningTy.def_id(this.universal_regions.defining_ty).expect_local();
  const span = tcx.def_span(defining_ty_def_id);

  // Insert the `'a: 'b` we know from the predicates.
  // This does not consider the type-outlives.
  const param_env = this.infcx.param_env;
  this.add_outlives_bounds(explicit_outlives_bounds(param_env));

  // - outlives is reflexive, so `'r: 'r` for every region `'r`
  // - `'static: 'r` for every region `'r`
  // - `'r: 'fn_body` for every (other) universally quantified
  //   region `'r`, all of which are provided by our caller
  const fr_static = this.universal_regions.fr_static;
  const fr_fn_body = this.universal_regions.fr_fn_body;
  for (const fr of this.universal_regions.universal_regions_iter()) {
    // debug!("build: relating free region {:?} to itself and to 'static", fr);
    this.relate_universal_regions(fr, fr);
    this.relate_universal_regions(fr_static, fr);
    this.relate_universal_regions(fr, fr_fn_body);
  }

  // Normalize the assumptions we use to borrowck the program.
  const constraints: QueryRegionConstraints[] = [];
  const known_type_outlives_obligations: PolyTypeOutlivesClause[] = [];
  for (const bound of param_env.caller_bounds()) {
    const outlives = bound.as_type_outlives_clause();
    if (outlives !== undefined) {
      known_type_outlives_obligations.push(outlives);
    }
  }

  const unnormalized_input_output_tys: Ty[] = [...this.universal_regions.unnormalized_input_tys, this.universal_regions.unnormalized_output_ty];

  // For each of the input/output types:
  // - Normalize the type. This will create some region
  //   constraints, which we buffer up because we are
  //   not ready to process them yet.
  // - Then compute the implied bounds. This will adjust
  //   the `region_bound_pairs` and so forth.
  // - After this is done, we'll register the constraints in
  //   the `BorrowckInferCtxt`. Checking these constraints is
  //   handled later by actual borrow checking.
  const normalized_inputs_and_output: Ty[] = [];
  for (const ty of unnormalized_input_output_tys) {
    // debug!("build: input_or_output={:?}", ty);
    // We add implied bounds from both the unnormalized and normalized ty.
    // See issue #87748
    const constraints_unnorm = this.add_implied_bounds(ty, span);
    if (constraints_unnorm !== undefined) {
      constraints.push(constraints_unnorm);
    }
    const r = this.infcx.fully_perform({ value: Unnormalized.new_wip(ty) }, span, QueryTypeOp_Normalize(Normalizable_Ty));
    const { output: norm_ty, constraints: constraints_normalize } = r.$ === "Ok" ? r._0 : normalize_error_output(this.infcx, r._0);
    if (constraints_normalize !== undefined) {
      constraints.push(constraints_normalize);
    }

    // Currently `implied_outlives_bounds` will normalize the provided
    // `Ty`, despite this it's still important to normalize the ty ourselves
    // as normalization may introduce new region variables (#136547).
    //
    // If we do not add implied bounds for the type involving these new
    // region variables then we'll wind up with the normalized form of
    // the signature having not-wf types due to unsatisfied region
    // constraints.
    //
    // Note: we need this in examples like
    // ```
    // trait Foo {
    //   type Bar;
    //   fn foo(&self) -> &Self::Bar;
    // }
    // impl Foo for () {
    //   type Bar = ();
    //   fn foo(&self) -> &() {}
    // }
    // ```
    // Both &Self::Bar and &() are WF
    if (ty !== norm_ty) {
      const constraints_norm = this.add_implied_bounds(norm_ty, span);
      if (constraints_norm !== undefined) {
        constraints.push(constraints_norm);
      }
    }

    normalized_inputs_and_output.push(norm_ty);
  }

  // Add implied bounds from impl header.
  //
  // We don't use `assumed_wf_types` to source the entire set of implied bounds for
  // a few reasons:
  // - `DefiningTy` for closure has the `&'env Self` type while `assumed_wf_types` doesn't
  // - We compute implied bounds from the unnormalized types in the `DefiningTy` but do not
  //   do so for types in impl headers
  // - We must compute the normalized signature and then compute implied bounds from that
  //   in order to connect any unconstrained region vars created during normalization to
  //   the types of the locals corresponding to the inputs and outputs of the item. (#136547)
  const dk = tcx.def_kind(defining_ty_def_id);
  if (dk.$ === "AssocFn" || dk.$ === "AssocConst") {
    for (const [ty] of tcx.assumed_wf_types(tcx.local_parent(defining_ty_def_id))) {
      const result: Result<TypeOpOutput<Ty, unknown>, ErrorGuaranteed> = this.infcx.fully_perform(
        { value: Unnormalized.new_wip(ty) },
        span,
        QueryTypeOp_Normalize(Normalizable_Ty),
      );
      if (result.$ !== "Ok") {
        continue;
      }
      const { output: norm_ty, constraints: c } = result._0;

      if (c !== undefined) constraints.push(c);

      // We currently add implied bounds from the normalized ty only.
      // This is more conservative and matches wfcheck behavior.
      const c2 = this.add_implied_bounds(norm_ty, span);
      if (c2 !== undefined) constraints.push(c2);
    }
  }

  for (const c of constraints) {
    ConstraintConversion.new(
      this.infcx,
      this.universal_regions,
      this.region_bound_pairs,
      known_type_outlives_obligations,
      { $: "All", _0: span },
      span,
      ConstraintCategory.Internal,
      this.constraints,
    ).convert_all(c);
  }

  return {
    universal_region_relations: new UniversalRegionRelations(this.universal_regions, this.outlives.freeze(), this.inverse_outlives.freeze()),
    known_type_outlives_obligations,
    region_bound_pairs: this.region_bound_pairs,
    normalized_inputs_and_output,
  };
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:344 create
UniversalRegionRelationsBuilder.prototype.create = function (this: UniversalRegionRelationsBuilder): CreateResult {
  if (!this.infcx.next_trait_solver()) {
    return this.create_old();
  }

  const tcx = this.infcx.tcx;
  const body_def_id = DefiningTy.def_id(this.universal_regions.defining_ty).expect_local();
  const span = tcx.def_span(body_def_id);

  // Insert the `'a: 'b` we know from the predicates.
  // This does not consider the type-outlives.
  const param_env = this.infcx.param_env;
  this.add_outlives_bounds(explicit_outlives_bounds(param_env));

  // - outlives is reflexive, so `'r: 'r` for every region `'r`
  // - `'static: 'r` for every region `'r`
  // - `'r: 'fn_body` for every (other) universally quantified
  //   region `'r`, all of which are provided by our caller
  const fr_static = this.universal_regions.fr_static;
  const fr_fn_body = this.universal_regions.fr_fn_body;
  for (const fr of this.universal_regions.universal_regions_iter()) {
    // debug!("build: relating free region {:?} to itself and to 'static", fr);
    this.relate_universal_regions(fr, fr);
    this.relate_universal_regions(fr_static, fr);
    this.relate_universal_regions(fr, fr_fn_body);
  }

  // Normalize the assumptions we use to borrowck the program.
  const constraints: QueryRegionConstraints[] = [];
  const known_type_outlives_obligations: PolyTypeOutlivesClause[] = [];
  for (const bound of param_env.caller_bounds()) {
    const outlives = bound.as_type_outlives_clause();
    if (outlives !== undefined) {
      known_type_outlives_obligations.push(outlives);
    }
  }

  const unnormalized_input_output_tys: Ty[] = [...this.universal_regions.unnormalized_input_tys, this.universal_regions.unnormalized_output_ty];

  // Compute the implied bounds of the current function based on its signature.
  const query_normalized_inputs_and_output = this.compute_implied_bounds(body_def_id, span, unnormalized_input_output_tys, constraints);

  // We need to renormalize the signature returned by the implied bounds query. This
  // query normalizes the signature in a context which does not define any opaque types
  // while this current function does actually reveal opaque types.
  //
  // We will later equate this signature with the type of the arguments and return local
  // of this MIR body, so we need to normalize again.
  //
  // This does assume that `unnormalized_input_output_tys` would normalize to the same
  // thing as `query_normalized_inputs_and_output`.
  const normalized_inputs_and_output: Ty[] = [];
  for (const ty0 of query_normalized_inputs_and_output) {
    const ty = set_aliases_to_non_rigid(tcx, ty0, fold_Ty);
    const r = this.infcx.fully_perform({ value: ty }, span, QueryTypeOp_Normalize(Normalizable_Ty));
    const { output: norm_ty, constraints: constraints_normalize } = r.$ === "Ok" ? r._0 : normalize_error_output(this.infcx, r._0);
    if (constraints_normalize !== undefined) {
      constraints.push(constraints_normalize);
    }

    normalized_inputs_and_output.push(norm_ty);
  }

  for (const c of constraints) {
    ConstraintConversion.new(
      this.infcx,
      this.universal_regions,
      this.region_bound_pairs,
      known_type_outlives_obligations,
      { $: "All", _0: span },
      span,
      ConstraintCategory.Internal,
      this.constraints,
    ).convert_all(c);
  }

  return {
    universal_region_relations: new UniversalRegionRelations(this.universal_regions, this.outlives.freeze(), this.inverse_outlives.freeze()),
    known_type_outlives_obligations,
    region_bound_pairs: this.region_bound_pairs,
    normalized_inputs_and_output,
  };
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
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:462 compute_implied_bounds
UniversalRegionRelationsBuilder.prototype.compute_implied_bounds = function (
  this: UniversalRegionRelationsBuilder,
  body_def_id: LocalDefId,
  span: Span,
  unnormalized_inputs_and_output: Ty[],
  constraints: QueryRegionConstraints[],
): Ty[] {
  const infcx = this.infcx;
  const tcx = infcx.tcx;
  const var_values = implied_bounds_query_var_values(tcx, unnormalized_inputs_and_output, (region) => this.universal_regions.is_external_free_region(region.as_var()));
  const original_query_values: OriginalQueryValues = { ...OriginalQueryValues.default_(), var_values };
  // PORT: queries.gen.ts types this query's value `Result<unknown, unknown>` (the value type is not ported there).
  const q = tcx.mir_borrowck_implied_outlives_bounds(body_def_id) as Result<Canonical<QueryResponse<MirBorrowckImpliedOutlivesBounds>>, NoSolution>;
  switch (q.$) {
    case "Ok": {
      const canonical_result = q._0;
      // `instantiate_nll_query_response_and_region_obligations` should never fail
      // here as all our `var_values` are unique generic parameters.
      const query_constraints = new QueryRegionConstraints([], []);
      const { value, obligations } = unwrap_result(
        this.infcx.instantiate_nll_query_response_and_region_obligations(
          ObligationCause.dummy_with_span(span),
          infcx.param_env,
          original_query_values,
          canonical_result,
          query_constraints,
          d_MirBorrowckImpliedOutlivesBounds,
        ),
        debug_TypeError,
      );
      if (!query_constraints.is_empty()) {
        // PORT: `infcx.tcx.arena.alloc(x)` is `x`.
        constraints.push(query_constraints);
      }

      // `mir_borrowck_implied_outlives_bounds` for nested bodies can result in
      // defining uses of opaques.
      for (const obligation of obligations) {
        const predicate = obligation.predicate;
        const r = infcx.fully_perform({ predicate }, span, QueryTypeOp_ProvePredicate);
        switch (r.$) {
          case "Ok": {
            const obligation_constraints = r._0.constraints;
            if (obligation_constraints !== undefined) {
              constraints.push(obligation_constraints);
            }
            break;
          }
          case "Err":
            this.infcx.set_tainted_by_errors(r._0);
            break;
        }
      }

      const { outlives_bounds, normalized_inputs_and_output } = value;

      // Because of #109628, we may have unexpected placeholders. Ignore them!
      // FIXME(#109628): panic in this case once the issue is fixed.
      const bounds = outlives_bounds.filter((bound) => !TypeVisitableExt.has_placeholders(bound, d_OutlivesBound));

      // We intentionally do not renormalize `bounds` while in the defining scope.
      // While we must not look into opaque types for implied bounds, we must also not
      // treat an `impl Sized + static: 'static` implied bound as a way to prove that
      // the underlying hidden type is `'static`. Doing so would be unsound. This is
      // not an ideal way as it results in assumptions which are unusable as aliases
      // are incorrectly marked as rigid, but it's the easiest way to get the desired
      // behavior.
      //
      // See tests/ui/traits/next-solver/opaques/implied-bounds-cyclic-reasoning.rs.
      this.add_outlives_bounds(bounds);

      return normalized_inputs_and_output;
    }
    case "Err": {
      this.infcx.dcx().span_delayed_bug(span, `error computing implied bounds ${debug_LocalDefId(body_def_id, PLAIN)}`);
      return unnormalized_inputs_and_output;
    }
  }
};

// FIXME(#160491): Remove this once the new implied bounds impl is through FCP.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:545 add_implied_bounds
UniversalRegionRelationsBuilder.prototype.add_implied_bounds = function (this: UniversalRegionRelationsBuilder, ty: Ty, span: Span): QueryRegionConstraints | undefined {
  const r = this.infcx.fully_perform({ ty }, span, QueryTypeOp_ImpliedOutlivesBounds);
  // `.map_err(|_: ErrorGuaranteed| debug!("failed to compute implied bounds {:?}", ty)).ok()?`
  if (r.$ === "Err") return undefined;
  const { output: bounds0, constraints } = r._0;
  // debug!(?bounds, ?constraints);
  // Because of #109628, we may have unexpected placeholders. Ignore them!
  // FIXME(#109628): panic in this case once the issue is fixed.
  const bounds = bounds0.filter((bound) => !TypeVisitableExt.has_placeholders(bound, d_OutlivesBound));
  this.add_outlives_bounds(bounds);
  return constraints;
};

/// Registers the `OutlivesBound` items from `outlives_bounds` in
/// the outlives relation as well as the region-bound pairs
/// listing.
// rustc: compiler/rustc_borrowck/src/type_check/free_region_relations.rs:566 add_outlives_bounds
UniversalRegionRelationsBuilder.prototype.add_outlives_bounds = function (this: UniversalRegionRelationsBuilder, outlives_bounds: Iterable<OutlivesBound>): void {
  for (const outlives_bound of outlives_bounds) {
    // debug!("add_outlives_bounds(bound={:?})", outlives_bound);

    switch (outlives_bound.$) {
      case "RegionSubRegion": {
        // The bound says that `r1 <= r2`; we store `r2: r1`.
        const r1 = this.universal_regions.to_region_vid(outlives_bound._0);
        const r2 = this.universal_regions.to_region_vid(outlives_bound._1);
        this.relate_universal_regions(r2, r1);
        break;
      }

      case "RegionSubParam": {
        const [r_a, param_b] = [outlives_bound._0, outlives_bound._1];
        this.region_bound_pairs.add({ _0: { $: "Param", _0: param_b }, _1: r_a });
        break;
      }

      case "RegionSubAlias": {
        const [r_a, alias_b] = [outlives_bound._0, outlives_bound._1];
        this.region_bound_pairs.add({ _0: { $: "Alias", _0: alias_b }, _1: r_a });
        break;
      }
    }
  }
};

/** The `unwrap_or_else(|guar| TypeOpOutput { output: Ty::new_error(self.infcx.tcx, guar), constraints: None, error_info: None })`
 *  fallback of `create_old` / `create`. */
function normalize_error_output(infcx: BorrowckInferCtxt, guar: ErrorGuaranteed): TypeOpOutput<Ty, unknown> {
  return { output: Ty.new_error(infcx.tcx, guar), constraints: undefined, error_info: undefined };
}
