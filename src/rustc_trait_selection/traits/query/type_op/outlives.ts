// Port of compiler/rustc_trait_selection/src/traits/query/type_op/outlives.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract): `impl QueryTypeOp for DropckOutlives` is `QueryTypeOp_DropckOutlives`. Fill:
// replace the stub bodies, markers `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/outlives.rs:<line> <name>`
// directly above. Init order: top-level code here touches only other crates.

import { type DropckOutlivesResult, type_op as middle_type_op, fold_with_DropckOutlivesResult, try_fold_with_DropckOutlivesResult, visit_with_DropckOutlivesResult } from "../../../../rustc_middle/traits/query.ts";
import { unported } from "../../../../std/panic.ts";
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
  // outlives.rs:11 (stub)
  try_fast_path(_tcx, _key) {
    return unported("rustc_trait_selection::traits::query::type_op::outlives::<DropckOutlives as QueryTypeOp>::try_fast_path");
  },
  // outlives.rs:18 (stub)
  perform_query(_tcx, _canonicalized) {
    return unported("rustc_trait_selection::traits::query::type_op::outlives::<DropckOutlives as QueryTypeOp>::perform_query");
  },
};
