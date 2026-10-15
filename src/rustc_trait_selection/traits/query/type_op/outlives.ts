// Port of compiler/rustc_trait_selection/src/traits/query/type_op/outlives.rs (lane old-query-typeops, wave 18c).
//
// PORT: `impl QueryTypeOp for DropckOutlives` is the descriptor `QueryTypeOp_DropckOutlives` (lane selcx-contract's contract).
// Init order: top-level code here touches only other crates (../dropck_outlives.ts is read at call time).

import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../../../rustc_middle/infer/canonical.ts";
import { DropckOutlivesResult, type_op as middle_type_op, fold_with_DropckOutlivesResult, try_fold_with_DropckOutlivesResult, visit_with_DropckOutlivesResult } from "../../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import type { Result } from "../../../../std/result.ts";
import { trivial_dropck_outlives } from "../dropck_outlives.ts";
import type { QueryTypeOp } from "./mod.ts";

/** `impl<'tcx> QueryTypeOp<'tcx> for DropckOutlives<'tcx>` (outlives.rs:8). */
export const QueryTypeOp_DropckOutlives: QueryTypeOp<middle_type_op.DropckOutlives, DropckOutlivesResult> = {
  d_Self: {
    visit_with: middle_type_op.visit_with_DropckOutlives,
    try_fold_with: middle_type_op.try_fold_with_DropckOutlives,
    fold_with: middle_type_op.fold_with_DropckOutlives,
  },
  d_QueryResponse: {
    visit_with: visit_with_DropckOutlivesResult,
    try_fold_with: try_fold_with_DropckOutlivesResult,
    fold_with: fold_with_DropckOutlivesResult,
  },
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/outlives.rs:11 try_fast_path
  try_fast_path(tcx: TyCtxt, key: ParamEnvAnd<middle_type_op.DropckOutlives>): DropckOutlivesResult | undefined {
    // PORT: `DropckOutlivesResult::default` (derived `Default`).
    return trivial_dropck_outlives(tcx, key.value.dropped_ty) ? new DropckOutlivesResult([], []) : undefined;
  },
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/outlives.rs:18 perform_query
  perform_query(
    tcx: TyCtxt,
    canonicalized: CanonicalQueryInput<ParamEnvAnd<middle_type_op.DropckOutlives>>,
  ): Result<CanonicalQueryResponse<DropckOutlivesResult>, NoSolution> {
    return tcx.dropck_outlives(canonicalized) as Result<CanonicalQueryResponse<DropckOutlivesResult>, NoSolution>;
  },
};
