// Port of compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract): `impl QueryTypeOp for AscribeUserType` is `QueryTypeOp_AscribeUserType`
// (`QueryResponse = ()` is `null`); the pub fn is a signature-typed stub. Private fns to port as module-local functions:
//   ascribe_user_type.rs:59 relate_mir_and_user_ty(ocx, param_env, span, mir_ty, user_ty) -> Result<(), NoSolution>
//   ascribe_user_type.rs:81 relate_mir_and_user_args(ocx, param_env, span, mir_ty, def_id, user_args) -> Result<(), NoSolution>
// Fill: replace the stub bodies, markers `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:<line> <name>`
// directly above. Init order: top-level code here touches only other crates.

import type { type_op } from "../../../../rustc_middle/traits/query.ts";
import { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { Span } from "../../../../rustc_span/lib.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";
import type { ObligationCtxt } from "../../engine.ts";
import type { ScrubbedTraitError } from "../../../../rustc_infer/traits/engine.ts";
import type { QueryTypeOp } from "./mod.ts";

// `pub use rustc_middle::traits::query::type_op::AscribeUserType;`
export type AscribeUserType = type_op.AscribeUserType;

/** `impl<'tcx> QueryTypeOp<'tcx> for AscribeUserType<'tcx>` (ascribe_user_type.rs:15). */
export const QueryTypeOp_AscribeUserType: QueryTypeOp<AscribeUserType, null> = {
  d_Self: {
    visit_with: middle_type_op.visit_with_AscribeUserType,
    try_fold_with: middle_type_op.try_fold_with_AscribeUserType,
    fold_with: middle_type_op.fold_with_AscribeUserType,
  },
  d_QueryResponse: {
    visit_with: (_self, v) => v.Result.output(),
    try_fold_with: (self) => ({ $: "Ok", _0: self }),
    fold_with: (self) => self,
  },
  // ascribe_user_type.rs:18 (stub)
  try_fast_path(_tcx, _key) {
    return unported("rustc_trait_selection::traits::query::type_op::ascribe_user_type::<AscribeUserType as QueryTypeOp>::try_fast_path");
  },
  // ascribe_user_type.rs:25 (stub)
  perform_query(_tcx, _canonicalized) {
    return unported("rustc_trait_selection::traits::query::type_op::ascribe_user_type::<AscribeUserType as QueryTypeOp>::perform_query");
  },
};

// ascribe_user_type.rs:36 (stub)
export function type_op_ascribe_user_type_with_span(
  _ocx: ObligationCtxt<ScrubbedTraitError>,
  _key: ParamEnvAnd<AscribeUserType>,
  _span: Span,
): Result<null, NoSolution> {
  return unported("rustc_trait_selection::traits::query::type_op::ascribe_user_type::type_op_ascribe_user_type_with_span");
}
