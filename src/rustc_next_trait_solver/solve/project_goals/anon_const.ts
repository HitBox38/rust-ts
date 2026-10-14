// Port of compiler/rustc_next_trait_solver/src/solve/project_goals/anon_const.rs (lane nts-normalizes). The `EvalCtxt`
// method is declared in ../../decls.ts (`// solve/project_goals/anon_const.rs:<line>`). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
import type { ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import type { Goal, QueryResultOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { EvalCtxt } from "../../decls.ts";

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/anon_const.rs:14 normalize_anon_const
EvalCtxt.prototype.normalize_anon_const = function (this: EvalCtxt, goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased {
  const alias_const = AliasTerm.expect_ct(goal.predicate.projection_term);
  return this.evaluate_const_and_instantiate_projection_term(
    goal.param_env,
    goal.predicate.projection_term,
    goal.predicate.term,
    alias_const,
  );
};
