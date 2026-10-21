//! Provider for the `implied_outlives_bounds` query.
//! Do not call this query directly. See
//! [`rustc_trait_selection::traits::implied_outlives_bounds`].
//
// Port of compiler/rustc_traits/src/implied_outlives_bounds.rs (lane selcx-contract).

import type { Canonical, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import {
  type CanonicalImpliedOutlivesBoundsGoal,
  fold_with_OutlivesBound,
  type OutlivesBound,
  try_fold_with_OutlivesBound,
  type_op,
  visit_with_OutlivesBound,
} from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_Vec, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import type { Result } from "../std/result.ts";
import { query_compute_implied_outlives_bounds } from "../rustc_trait_selection/traits/implied_outlives_bounds.ts";
import type { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import type { ScrubbedTraitError } from "../rustc_infer/traits/engine.ts";
import { fold_ParamEnvAnd } from "../rust_ts/fold_param_env_and.ts";

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

// rustc: compiler/rustc_traits/src/implied_outlives_bounds.rs:15 provide
export function provide(p: Providers): void {
  p.implied_outlives_bounds = implied_outlives_bounds;
}

// rustc: compiler/rustc_traits/src/implied_outlives_bounds.rs:19 implied_outlives_bounds
function implied_outlives_bounds(
  tcx: TyCtxt,
  [goal, disable_implied_bounds_hack]: [CanonicalImpliedOutlivesBoundsGoal, boolean],
): Result<Canonical<QueryResponse<OutlivesBound[]>>, NoSolution> {
  return tcx.infer_ctxt().enter_canonical_trait_query(
    goal,
    (ocx, key) => {
      const {
        param_env,
        value: { ty },
      } = key;
      return query_compute_implied_outlives_bounds(ocx as ObligationCtxt<ScrubbedTraitError>, param_env, ty, disable_implied_bounds_hack);
    },
    fold_ParamEnvAnd(d_ImpliedOutlivesBounds),
    fold_Vec(d_OutlivesBound) as TypeFoldable<OutlivesBound[]>,
  );
}
