// Port of compiler/rustc_traits/src/evaluate_obligation.rs (lane selcx-contract).

import { SelectionContext, sizedness_fast_path } from "../rustc_trait_selection/traits/mod.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { CanonicalPredicateGoal } from "../rustc_middle/traits/query.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { EvaluationResult, OverflowError } from "../rustc_middle/traits/select.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Predicate } from "../rustc_middle/ty/decls.ts";
import { fold_Predicate } from "../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { assert } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { fold_ParamEnvAnd } from "../rust_ts/fold_param_env_and.ts";

// rustc: compiler/rustc_traits/src/evaluate_obligation.rs:12 provide
export function provide(p: Providers): void {
  p.evaluate_obligation = evaluate_obligation;
}

// rustc: compiler/rustc_traits/src/evaluate_obligation.rs:16 evaluate_obligation
function evaluate_obligation(tcx: TyCtxt, canonical_goal: CanonicalPredicateGoal): Result<EvaluationResult, OverflowError> {
  assert(!tcx.next_trait_solver_globally(), "assertion failed: !tcx.next_trait_solver_globally()");
  // debug!("evaluate_obligation(canonical_goal={:#?})", canonical_goal);
  const [infcx, goal, _var_values] = tcx.infer_ctxt().build_with_canonical(DUMMY_SP, canonical_goal, fold_ParamEnvAnd(fold_Predicate));
  // debug!("evaluate_obligation: goal={:#?}", goal);
  const { param_env, value: predicate } = goal;

  if (!tcx.disable_trait_solver_fast_paths() && sizedness_fast_path(tcx, predicate, param_env)) {
    return Ok<EvaluationResult>("EvaluatedToOk");
  }

  const selcx = SelectionContext.with_query_mode(infcx, "Canonical");
  const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, predicate, (p: Predicate) => p);

  return selcx.evaluate_root_obligation(obligation);
}
