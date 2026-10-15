// Port of compiler/rustc_trait_selection/src/regions.rs (lane trait-sel-traits-a; the contract stub was lane
// infcx-contract's). `#[extension(pub trait OutlivesEnvironmentBuildExt)] impl OutlivesEnvironment` adds the statics
// `OutlivesEnvironment.new` / `new_with_implied_bounds_compat`; `#[extension(pub trait InferCtxtRegionExt)] impl
// InferCtxt` adds `resolve_regions` (rustc_trait_selection decls.ts).
//
// PORT: `FxIndexSet<Ty>` is a `Set<Ty>` (interned keys, insertion-ordered). `add_constraints: impl FnOnce(&InferCtxt) ->
// Result<(), ()>` returns `Result<null, null>`.
//
// Init order: top-level code here may touch only rustc_infer (loaded first by ./lib.ts) and other crates.

import { InferCtxt } from "../rustc_infer/decls.ts";
import type { RegionResolutionError } from "../rustc_infer/infer/lexical_region_resolve/mod.ts";
import type { SubregionOrigin } from "../rustc_infer/infer/mod.ts";
import { OutlivesEnvironment } from "../rustc_infer/infer/outlives/env.ts";
import type { ScrubbedTraitError } from "../rustc_infer/traits/engine.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { type Binder } from "../rustc_type_ir/binder.ts";
import { elaborate_outlives_assumptions } from "../rustc_type_ir/elaborate.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { TypeOutlivesClause } from "../rustc_middle/ty/predicate.gen.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { FromSolverError_ScrubbedTraitError } from "./solve/fulfill.ts";
import { deeply_normalize } from "./solve/normalize.ts";

// ---- #[extension(pub trait OutlivesEnvironmentBuildExt<'tcx>)] impl<'tcx> OutlivesEnvironment<'tcx> ------------------

// rustc: compiler/rustc_trait_selection/src/regions.rs:17 new
(OutlivesEnvironment as unknown as { new: typeof OutlivesEnvironment.new }).new = function (
  infcx: InferCtxt,
  body_def_id: LocalDefId,
  param_env: ParamEnv,
  assumed_wf_tys: Iterable<Ty>,
): OutlivesEnvironment {
  return OutlivesEnvironment.new_with_implied_bounds_compat(infcx, body_def_id, param_env, assumed_wf_tys, false);
};

// rustc: compiler/rustc_trait_selection/src/regions.rs:26 new_with_implied_bounds_compat
OutlivesEnvironment.new_with_implied_bounds_compat = function (
  infcx: InferCtxt,
  body_def_id: LocalDefId,
  param_env: ParamEnv,
  assumed_wf_tys: Iterable<Ty>,
  disable_implied_bounds_hack: boolean,
): OutlivesEnvironment {
  const bounds: Binder<TypeOutlivesClause>[] = [];

  for (const bound of param_env.caller_bounds()) {
    const type_outlives = bound.as_type_outlives_clause();
    if (type_outlives !== undefined) {
      // debug_assert!(!infcx.next_trait_solver() || !type_outlives.has_non_rigid_aliases());
      bounds.push(type_outlives);
    }
  }

  // FIXME(-Znext-trait-solver): Normalize these.
  const higher_ranked_assumptions_ = infcx.take_registered_region_assumptions();
  const higher_ranked_assumptions = elaborate_outlives_assumptions(infcx.tcx, higher_ranked_assumptions_);

  // FIXME: This needs to be modified so that we normalize the known type
  // outlives obligations then elaborate them into their region/type components.
  // Otherwise, `<W<'a> as Mirror>::Assoc: 'b` will not imply `'a: 'b` even
  // if we can normalize `'a`.
  return OutlivesEnvironment.from_normalized_bounds(
    param_env,
    bounds,
    infcx.implied_bounds_tys(body_def_id, param_env, assumed_wf_tys, disable_implied_bounds_hack),
    higher_ranked_assumptions,
  );
};

// ---- #[extension(pub trait InferCtxtRegionExt<'tcx>)] impl<'tcx> InferCtxt<'tcx> -------------------------------------

/// Resolve regions lexically.
///
/// This function assumes that all infer variables are already constrained.
///
/// FIXME(#155345): this can probably be moved back to `rustc_infer` now that normalization is
/// no longer required. These two extension traits won't be needed then.
// rustc: compiler/rustc_trait_selection/src/regions.rs:73 resolve_regions
InferCtxt.prototype.resolve_regions = function (
  this: InferCtxt,
  body_def_id: LocalDefId,
  param_env: ParamEnv,
  assumed_wf_tys: Iterable<Ty>,
): RegionResolutionError[] {
  return this.resolve_regions_with_outlives_env(OutlivesEnvironment.new(this, body_def_id, param_env, assumed_wf_tys));
};

/// Given a known `param_env` and a set of well formed types, can we prove that
/// `ty` outlives `region`.
// rustc: compiler/rustc_trait_selection/src/regions.rs:90 ty_known_to_outlive
export function ty_known_to_outlive(
  tcx: TyCtxt,
  id: LocalDefId,
  param_env: ParamEnv,
  wf_tys: Set<Ty>,
  ty_: Unnormalized<Ty>,
  region: Region,
): boolean {
  return test_region_obligations(tcx, id, param_env, wf_tys, (infcx) => {
    // Types in region obligations should be normalized.
    let ty: Ty;
    if (infcx.next_trait_solver()) {
      const r = deeply_normalize<Ty, ScrubbedTraitError>(infcx.at(ObligationCause.dummy_with_span(DUMMY_SP), param_env), ty_, FromSolverError_ScrubbedTraitError, fold_Ty);
      if (r.$ !== "Ok") {
        return Err(null);
      }
      ty = r._0;
    } else {
      ty = Unnormalized.skip_norm_wip(ty_);
    }

    const origin: SubregionOrigin = { $: "RelateParamBound", _0: DUMMY_SP, _1: ty, _2: undefined };
    infcx.register_type_outlives_constraint_inner({
      sub_region: region,
      sup_type: ty,
      origin,
    });

    return Ok(null);
  });
}

/// Given a known `param_env` and a set of well formed types, can we prove that
/// `region_a` outlives `region_b`
// rustc: compiler/rustc_trait_selection/src/regions.rs:124 region_known_to_outlive
export function region_known_to_outlive(
  tcx: TyCtxt,
  id: LocalDefId,
  param_env: ParamEnv,
  wf_tys: Set<Ty>,
  region_a: Region,
  region_b: Region,
): boolean {
  return test_region_obligations(tcx, id, param_env, wf_tys, (infcx) => {
    infcx.sub_regions({ $: "RelateRegionParamBound", _0: DUMMY_SP, _1: undefined }, region_b, region_a, "Unreachable");
    return Ok(null);
  });
}

/// Given a known `param_env` and a set of well formed types, set up an
/// `InferCtxt`, call the passed function (to e.g. set up region constraints
/// to be tested), then resolve region and return errors
// rustc: compiler/rustc_trait_selection/src/regions.rs:146 test_region_obligations
export function test_region_obligations(
  tcx: TyCtxt,
  id: LocalDefId,
  param_env: ParamEnv,
  wf_tys: Set<Ty>,
  add_constraints: (infcx: InferCtxt) => Result<null, null>,
): boolean {
  // Unfortunately, we have to use a new `InferCtxt` each call, because
  // region constraints get added and solved there and we need to test each
  // call individually.
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());

  if (add_constraints(infcx).$ === "Err") {
    return false;
  }

  const errors = infcx.resolve_regions(id, param_env, wf_tys);
  // tracing::debug!(?errors, "errors");

  // If we were able to prove that the type outlives the region without
  // an error, it must be because of the implied or explicit bounds...
  return errors.length === 0;
}
