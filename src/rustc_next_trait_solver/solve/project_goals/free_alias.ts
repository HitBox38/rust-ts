//! Computes a projection goal for inherent associated types,
//! `#![feature(checked_type_aliases)]` and `#![feature(type_alias_impl_trait)]`.
//!
//! Since a free alias is never ambiguous, this just computes the `type_of` of
//! the alias and registers the where-clauses of the type alias.
//
// Port of compiler/rustc_next_trait_solver/src/solve/project_goals/free_alias.rs (lane nts-normalizes). The `EvalCtxt`
// method is declared in ../../decls.ts (`// solve/project_goals/free_alias.rs:<line>`). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
// PORT: `cx.type_of(..)` is reached through `as_interner(cx)`: the TyCtxt query value is typed `unknown` in
// queries.gen.ts, the `Interner` method is typed `EarlyBinder<Ty>` (rustc_type_ir predicate.ts precedent).
import type { Term } from "../../../rustc_middle/ty/decls.ts";
import { Term as MTerm } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause } from "../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { as_interner, type ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import { relate_Term } from "../../../rustc_type_ir/relate.ts";
import type { Goal, QueryResultOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { Certainty, GoalSource } from "../../../rustc_type_ir/solve/mod.ts";
import { fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import { EvalCtxt } from "../../decls.ts";
import { goal_with, iter_instantiated, map_iter } from "../mod.ts";

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/free_alias.rs:18 normalize_free_alias
EvalCtxt.prototype.normalize_free_alias = function (this: EvalCtxt, goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased {
  const cx = this.cx();
  const free_alias = goal.predicate.projection_term;

  // Check where clauses
  const r1 = this.add_goals(
    GoalSource.Misc,
    map_iter(
      map_iter(
        iter_instantiated(cx.ir_clauses_of(AliasTerm.expect_free_def_id(free_alias)), cx, free_alias.args, fold_Clause),
        Unnormalized.skip_norm_wip,
      ),
      (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
    ),
  );
  if (r1.$ === "Err") return r1;

  let actual: Term;
  const kind = free_alias.kind;
  let free_const;
  if (kind.$ === "FreeTy") {
    const def_id = kind.def_id;
    const free = EarlyBinder.instantiate(as_interner(cx).type_of(def_id), cx, free_alias.args, fold_Ty);
    const r = this.normalize(goal.param_env, free, fold_Ty);
    if (r.$ === "Err") return r;
    actual = MTerm.from_Ty(r._0);
  } else if (kind.$ === "FreeConst" && (free_const = cx.ir_const_of_item({ $: "Free", def_id: kind.def_id })) !== undefined) {
    const free = EarlyBinder.instantiate(free_const, cx, free_alias.args, fold_Const);
    const r = this.normalize(goal.param_env, free, fold_Const);
    if (r.$ === "Err") return r;

    actual = MTerm.from_Const(r._0);
  } else if (kind.$ === "FreeConst") {
    return this.evaluate_const_and_instantiate_projection_term(
      goal.param_env,
      free_alias,
      goal.predicate.term,
      AliasTerm.expect_ct(free_alias),
    );
  } else {
    return panic(`expected free alias, found ${debug_AliasTermKind(kind, PLAIN)}`);
  }

  const r2 = this.push_const_arg_has_type_goal(goal.param_env, goal.predicate.projection_term, actual);
  if (r2.$ === "Err") return r2;
  const r3 = this.eq(goal.param_env, goal.predicate.term, actual, relate_Term);
  if (r3.$ === "Err") return r3;
  return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
};
