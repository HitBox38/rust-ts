// Port of compiler/rustc_next_trait_solver/src/solve/project_goals/mod.rs (lane nts-normalizes). The `EvalCtxt` methods
// are declared in ../../decls.ts (`// solve/project_goals/mod.rs:<line>`). Extension module
// (docs/handoff/evalctxt-contract.md "Init order"): `mod anon_const; mod free_alias; mod inherent; mod opaque_types;` are
// loaded by lib.ts.
import type { ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import type { Goal, QueryResultOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { Certainty, GoalSource } from "../../../rustc_type_ir/solve/mod.ts";
import { Predicate_upcast_from_NormalizesTo } from "../../../rustc_middle/ty/predicate.ts";
import { relate_Term } from "../../../rustc_type_ir/relate.ts";
import type { NormalizesTo } from "../../../rustc_type_ir/decls.ts";
import { EvalCtxt } from "../../decls.ts";
import { goal_with } from "../mod.ts";

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/mod.rs:21 compute_projection_goal
EvalCtxt.prototype.compute_projection_goal = function (
  this: EvalCtxt,
  goal: Goal<ProjectionClause>,
): QueryResultOrRerunNonErased {
  switch (goal.predicate.projection_term.kind.$) {
    case "ProjectionTy":
    case "ProjectionConst":
      return this.normalize_associated_term(goal);
    case "InherentTy":
    case "InherentConstSelf":
    case "InherentConstImpl":
      return this.normalize_inherent_associated_term(goal);
    case "OpaqueTy":
      return this.normalize_opaque_type(goal);
    case "FreeTy":
    case "FreeConst":
      return this.normalize_free_alias(goal);
    case "AnonConst":
      return this.normalize_anon_const(goal);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/mod.rs:44 normalize_associated_term
EvalCtxt.prototype.normalize_associated_term = function (
  this: EvalCtxt,
  goal: Goal<ProjectionClause>,
): QueryResultOrRerunNonErased {
  const { projection_term: alias, term } = goal.predicate;
  const unconstrained_term = this.next_term_infer_of_alias_kind(alias);
  const normalizes_to = goal_with(
    goal,
    this.cx(),
    { alias, term: unconstrained_term } satisfies NormalizesTo,
    Predicate_upcast_from_NormalizesTo,
  );

  // We don't want candidate selection when normalizing associated terms to be impacted by
  // the expected term. Normalization should behave like a function of just the alias being
  // normalized. Because of this, we use an internal `NormalizesTo` goal for which the
  // expected term is always fully unconstrained and then equate that to the actual expected
  // term afterwards.
  //
  // But this results in weaker type inference if there's a nested where-clause when
  // normalizing which we can actually make progress on based on the expected term. To avoid
  // this, we return ambiguous nested goals for `NormalizesTo` to this context and register
  // them as if they were this `Projection` goal's own nested goals. (See #122687)
  //
  // After registering those goals, we equate the original expected term to the normalization
  // result. Although equating them can add inference constraint to the alias term, we don't
  // reevaluate this special `NormalizesTo` goal. But that's fine because as those inference
  // constraints should cause the caller to reevaluate the current `Projection `goal, which
  // will then also reevaluate the `NormalizesTo` goal.
  const r = this.evaluate_goal_raw(GoalSource.Normalization, normalizes_to);
  if (r.$ === "Err") return r;
  const [{ _0: nested_goals }, { certainty }] = r._0;

  // trace!(?nested_goals);

  // Add a `make_canonical_response` probe step so that we treat this as
  // a candidate, even if `try_evaluate_added_goals` bails due to an error.
  // It's `Certainty::AMBIGUOUS` because this candidate is not "finished",
  // since equating the normalized terms will lead to additional constraints.
  this.inspect.make_canonical_response(Certainty.AMBIGUOUS);

  const r2 = this.eq(goal.param_env, term, unconstrained_term, relate_Term);
  if (r2.$ === "Err") return r2;

  // Add the nested goals from normalization to our own nested goals.
  for (const [s, g] of nested_goals) {
    const r3 = this.add_goal(s, g);
    if (r3.$ === "Err") return r3;
  }

  return this.evaluate_added_goals_and_make_canonical_response(certainty);
};
