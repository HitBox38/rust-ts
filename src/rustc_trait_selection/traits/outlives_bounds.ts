// Port of compiler/rustc_trait_selection/src/traits/outlives_bounds.rs (lane trait-sel-traits-a; the contract stub was
// lane infcx-contract's, whose decls.ts names lane trait-sel-traits-b: this lane's assignment, wave 17, includes the
// file). `#[extension(pub trait InferCtxtExt)] impl InferCtxt` puts `implied_bounds_tys` on `InferCtxt.prototype`.
//
// PORT: `impl Iterator<Item = OutlivesBound>` (a lazy `flat_map`) is a generator: each type's bounds are computed when
// the consumer reaches it, as upstream.
//
// Init order: top-level code here touches only rustc_infer (loaded first by ../lib.ts) and other crates.

import { InferCtxt } from "../../rustc_infer/decls.ts";
import { InferOk } from "../../rustc_infer/infer/mod.ts";
import { OriginalQueryValues } from "../../rustc_middle/infer/canonical.ts";
import { default_QueryRegionConstraints, type QueryResponse } from "../../rustc_middle/infer/canonical.gen.ts";
import type { Canonical } from "../../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { fold_with_OutlivesBound, type OutlivesBound, try_fold_with_OutlivesBound, type_op, visit_with_OutlivesBound } from "../../rustc_middle/traits/query.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { assert, assert_eq } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";

// `pub use rustc_middle::traits::query::OutlivesBound;`
export type { OutlivesBound } from "../../rustc_middle/traits/query.ts";

/** The derived `TypeFoldable` impls (rustc_middle traits/query.rs) as D4 descriptors. */
const d_ImpliedOutlivesBounds: TypeFoldable<type_op.ImpliedOutlivesBounds> = {
  visit_with: type_op.visit_with_ImpliedOutlivesBounds,
  try_fold_with: type_op.try_fold_with_ImpliedOutlivesBounds,
  fold_with: type_op.fold_with_ImpliedOutlivesBounds,
};
const d_OutlivesBound: TypeFoldable<OutlivesBound> = {
  visit_with: visit_with_OutlivesBound,
  try_fold_with: try_fold_with_OutlivesBound,
  fold_with: fold_with_OutlivesBound,
};

/// Implied bounds are region relationships that we deduce
/// automatically. The idea is that (e.g.) a caller must check that a
/// function's argument types are well-formed immediately before
/// calling that fn, and hence the *callee* can assume that its
/// argument types are well-formed. This may imply certain relationships
/// between generic parameters. For example:
/// ```
/// fn foo<T>(x: &T) {}
/// ```
/// can only be called with a `'a` and `T` such that `&'a T` is WF.
/// For `&'a T` to be WF, `T: 'a` must hold. So we can assume `T: 'a`.
///
/// # Parameters
///
/// - `param_env`, the where-clauses in scope
/// - `body_def_id`, the body_def_id to use when normalizing assoc types.
///   Note that this may cause outlives obligations to be injected
///   into the inference context with this body-id.
/// - `ty`, the type that we are supposed to assume is WF.
// #[instrument(level = "debug", skip(infcx, param_env, body_def_id), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_bounds.rs:34 implied_outlives_bounds
function implied_outlives_bounds(infcx: InferCtxt, param_env: ParamEnv, body_def_id: LocalDefId, ty_: Ty, disable_implied_bounds_hack: boolean): OutlivesBound[] {
  const ty = infcx.deeply_resolve_via_unification_table(ty_, fold_Ty);

  // We do not expect existential variables in implied bounds.
  // We may however encounter unconstrained lifetime variables
  // in very rare cases.
  //
  // See `ui/implied-bounds/implied-bounds-unconstrained-2.rs` for
  // an example.
  assert(!TypeVisitableExt.has_non_region_infer(ty, fold_Ty), "assertion failed: !ty.has_non_region_infer()");

  const canonical_var_values = OriginalQueryValues.default_();
  const input: type_op.ImpliedOutlivesBounds = { ty };
  const canonical = infcx.canonicalize_query(param_env.and(input), canonical_var_values, d_ImpliedOutlivesBounds);
  // PORT: the query's value type is `unknown` in queries.gen.ts (`QueryResponse` is not mapped yet, infcx-contract
  // "For root" 4): it is `Result<&Canonical<QueryResponse<Vec<OutlivesBound>>>, NoSolution>`.
  const implied_bounds_result = infcx.tcx.implied_outlives_bounds([canonical, disable_implied_bounds_hack]) as Result<Canonical<QueryResponse<OutlivesBound[]>>, unknown>;
  if (implied_bounds_result.$ !== "Ok") {
    return [];
  }
  const canonical_result = implied_bounds_result._0;

  const constraints = default_QueryRegionConstraints();
  const span = infcx.tcx.def_span(body_def_id);
  const r = infcx.instantiate_nll_query_response_and_region_obligations(
    ObligationCause.dummy_with_span(span),
    param_env,
    canonical_var_values,
    canonical_result,
    constraints,
    fold_Vec(d_OutlivesBound) as TypeFoldable<OutlivesBound[]>,
  );
  if (r.$ !== "Ok") {
    return [];
  }
  const { value: bounds_, obligations }: InferOk<OutlivesBound[]> = r._0;
  assert_eq(obligations.length, 0, String);

  // Because of #109628, we may have unexpected placeholders. Ignore them!
  // FIXME(#109628): panic in this case once the issue is fixed.
  const bounds = bounds_.filter((bound) => !TypeVisitableExt.has_placeholders(bound, d_OutlivesBound));

  if (!constraints.is_empty()) {
    // FIXME(higher_ranked_auto): Should we register assumptions here?
    // We otherwise would get spurious errors if normalizing an implied
    // outlives bound required proving some higher-ranked coroutine obl.
    const { constraints: constraints_ } = constraints;
    const cause = ObligationCause.misc(span, body_def_id);
    for (const { constraint, visible_for_leak_check: vis } of constraints_) {
      switch (constraint.$) {
        case "Outlives": {
          const predicate = constraint._0;
          infcx.register_outlives_constraint(predicate, vis, cause);
          break;
        }
        case "Eq": {
          const predicate = constraint._0;
          infcx.register_region_eq_constraint(predicate, vis, cause);
          break;
        }
      }
    }
  }

  return bounds;
}

// ---- #[extension(pub trait InferCtxtExt<'tcx>)] impl<'tcx> InferCtxt<'tcx> -------------------------------------------

/// Do *NOT* call this directly. You probably want to construct a `OutlivesEnvironment`
/// instead if you're interested in the implied bounds for a given signature.
// rustc: compiler/rustc_trait_selection/src/traits/outlives_bounds.rs:104 implied_bounds_tys
InferCtxt.prototype.implied_bounds_tys = function* (
  this: InferCtxt,
  body_def_id: LocalDefId,
  param_env: ParamEnv,
  tys: Iterable<Ty>,
  disable_implied_bounds_hack: boolean,
): Generator<OutlivesBound> {
  for (const ty of tys) {
    yield* implied_outlives_bounds(this, param_env, body_def_id, ty, disable_implied_bounds_hack);
  }
};
