// Port of compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs (lane old-query-typeops, wave 18c).
//
// PORT: `impl QueryTypeOp for ProvePredicate` is the descriptor `QueryTypeOp_ProvePredicate` (`QueryResponse = ()` is
// `null`; lane selcx-contract's contract). `Obligation::new(.., predicate)` with `predicate: Predicate` upcasts by identity.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.

import { Obligation } from "../../../../rustc_infer/traits/mod.ts";
import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../../../rustc_middle/infer/canonical.ts";
import type { ObligationCause } from "../../../../rustc_middle/traits/mod.ts";
import { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Predicate } from "../../../../rustc_middle/ty/decls.ts";
import { type ParamEnvAnd, Term } from "../../../../rustc_middle/ty/mod.ts";
import { Binder } from "../../../../rustc_type_ir/binder.ts";
import type { Interner } from "../../../../rustc_type_ir/interner.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import type { Result } from "../../../../std/result.ts";
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
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs:13 try_fast_path
  try_fast_path(tcx: TyCtxt, key: ParamEnvAnd<ProvePredicate>): null | undefined {
    if (traits_util().sizedness_fast_path(tcx, key.value.predicate, key.param_env)) {
      return null;
    }

    const kind = Binder.skip_binder(key.value.predicate.kind());
    if (kind.$ === "Clause" && kind._0.$ === "WellFormed" && Term.is_trivially_wf(kind._0._0, tcx)) {
      return null;
    }

    return undefined;
  },
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs:31 perform_query
  perform_query(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<ProvePredicate>>): Result<CanonicalQueryResponse<null>, NoSolution> {
    return tcx.type_op_prove_predicate(canonicalized) as Result<CanonicalQueryResponse<null>, NoSolution>;
  },
};

/// The core of the `type_op_prove_predicate` query: for diagnostics purposes in NLL HRTB errors,
/// this query can be re-run to better track the span of the obligation cause, and improve the error
/// message. Do not call directly unless you're in that very specific context.
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/prove_predicate.rs:42 type_op_prove_predicate_with_cause
export function type_op_prove_predicate_with_cause(ocx: ObligationCtxt<ScrubbedTraitError>, key: ParamEnvAnd<ProvePredicate>, cause: ObligationCause): void {
  const {
    param_env,
    value: { predicate },
  } = key;
  ocx.register_obligation(Obligation.new(ocx.infcx.tcx, cause, param_env, predicate, (p: Predicate, _tcx: Interner) => p));
}

/** `crate::traits::util` (this crate), read lazily (init order). */
function traits_util(): typeof import("../../util.ts") {
  return require("../../util.ts") as typeof import("../../util.ts");
}
