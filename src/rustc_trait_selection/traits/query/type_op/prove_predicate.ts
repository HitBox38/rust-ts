// Port of compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract): `impl QueryTypeOp for ProvePredicate` is `QueryTypeOp_ProvePredicate`
// (`QueryResponse = ()` is `null`); the pub fn is a signature-typed stub. Fill: replace the stub bodies, markers
// `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs:<line> <name>` directly above.
// Init order: top-level code here touches only other crates.

import type { ObligationCause } from "../../../../rustc_middle/traits/mod.ts";
import { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import { unported } from "../../../../std/panic.ts";
import type { ObligationCtxt } from "../../engine.ts";
import type { ScrubbedTraitError } from "../../../../rustc_infer/traits/engine.ts";
import type { QueryTypeOp } from "./mod.ts";

// `pub use rustc_middle::traits::query::type_op::ProvePredicate;`
export type ProvePredicate = middle_type_op.ProvePredicate;

/** `impl<'tcx> QueryTypeOp<'tcx> for ProvePredicate<'tcx>` (prove_predicate.rs:10). */
export const QueryTypeOp_ProvePredicate: QueryTypeOp<ProvePredicate, null> = {
  d_Self: {
    visit_with: middle_type_op.visit_with_ProvePredicate,
    try_fold_with: middle_type_op.try_fold_with_ProvePredicate,
    fold_with: middle_type_op.fold_with_ProvePredicate,
  },
  d_QueryResponse: {
    visit_with: (_self, v) => v.Result.output(),
    try_fold_with: (self) => ({ $: "Ok", _0: self }),
    fold_with: (self) => self,
  },
  // prove_predicate.rs:13 (stub)
  try_fast_path(_tcx, _key) {
    return unported("rustc_trait_selection::traits::query::type_op::prove_predicate::<ProvePredicate as QueryTypeOp>::try_fast_path");
  },
  // prove_predicate.rs:31 (stub)
  perform_query(_tcx, _canonicalized) {
    return unported("rustc_trait_selection::traits::query::type_op::prove_predicate::<ProvePredicate as QueryTypeOp>::perform_query");
  },
};

/// The core of the `type_op_prove_predicate` query: for diagnostics purposes in NLL HRTB errors,
/// this query can be re-run to better track the span of the obligation cause, and improve the error
/// message. Do not call directly unless you're in that very specific context.
// prove_predicate.rs:42 (stub)
export function type_op_prove_predicate_with_cause(_ocx: ObligationCtxt<ScrubbedTraitError>, _key: ParamEnvAnd<ProvePredicate>, _cause: ObligationCause): void {
  unported("rustc_trait_selection::traits::query::type_op::prove_predicate::type_op_prove_predicate_with_cause");
}
