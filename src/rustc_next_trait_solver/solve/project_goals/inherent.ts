//! Computes a projection goal for inherent associated types,
//! `#![feature(inherent_associated_type)]`. Since HIR ty lowering already determines
//! which impl the IAT is being projected from, we just:
//! 1. instantiate generic parameters,
//! 2. equate the self type, and
//! 3. instantiate and register where clauses.
//
// Port of compiler/rustc_next_trait_solver/src/solve/project_goals/inherent.rs (lane nts-normalizes). The `EvalCtxt`
// methods are declared in ../../decls.ts (`// solve/project_goals/inherent.rs:<line>`). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
// PORT: `cx.type_of(..)` is reached through `as_interner(cx)` (free_alias.ts header).
import type { GenericArgs, ParamEnv, Term } from "../../../rustc_middle/ty/decls.ts";
import { Term as MTerm } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause } from "../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { as_interner, type ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import { relate_Term, relate_Ty } from "../../../rustc_type_ir/relate.ts";
import type { Goal, QueryResultOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { Certainty, GoalSource, type NoSolutionOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { AliasTerm, type AliasTermKind, debug_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { panic, unreachable } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { EvalCtxt } from "../../decls.ts";
import { goal_with, iter_instantiated, map_iter } from "../mod.ts";

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/inherent.rs:19 normalize_inherent_associated_term
EvalCtxt.prototype.normalize_inherent_associated_term = function (
  this: EvalCtxt,
  goal: Goal<ProjectionClause>,
): QueryResultOrRerunNonErased {
  const cx = this.cx();
  const def_id = AliasTerm.expect_inherent_def_id(goal.predicate.projection_term);
  const conv = this.convert_inherent_self_to_impl(goal.param_env, goal.predicate.projection_term);
  if (conv.$ === "Err") return conv;
  const [inherent_kind, inherent_args] = conv._0;

  // Check both where clauses on the impl and IAT
  //
  // FIXME(-Znext-solver=coinductive): I think this should be split
  // and we tag the impl bounds with `GoalSource::ImplWhereBound`?
  // Right now this includes both the impl and the assoc item where bounds,
  // and I don't think the assoc item where-bounds are allowed to be coinductive.
  //
  // Projecting to the IAT also "steps out the impl constructor", so we would have
  // to be very careful when changing the impl where-clauses to be productive.
  const r1 = this.add_goals(
    GoalSource.Misc,
    map_iter(
      map_iter(iter_instantiated(cx.ir_clauses_of(def_id), cx, inherent_args, fold_Clause), Unnormalized.skip_norm_wip),
      (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
    ),
  );
  if (r1.$ === "Err") return r1;

  let normalized: Term;
  let inherent_const;
  if (inherent_kind.$ === "InherentTy") {
    const inherent = EarlyBinder.instantiate(as_interner(cx).type_of(inherent_kind.def_id), cx, inherent_args, fold_Ty);
    const r = this.normalize(goal.param_env, inherent, fold_Ty);
    if (r.$ === "Err") return r;
    normalized = MTerm.from_Ty(r._0);
  } else if (
    inherent_kind.$ === "InherentConstImpl" &&
    (inherent_const = cx.ir_const_of_item({ $: "InherentImpl", def_id: inherent_kind.def_id })) !== undefined
  ) {
    const inherent = EarlyBinder.instantiate(inherent_const, cx, inherent_args, fold_Const);
    const normalized_ct = this.normalize(goal.param_env, inherent, fold_Const);
    if (normalized_ct.$ === "Err") return normalized_ct;
    const normalized_ = MTerm.from_Const(normalized_ct._0);
    const term = AliasTerm.new_from_args(cx, inherent_kind, inherent_args);
    const r = this.push_const_arg_has_type_goal(goal.param_env, term, normalized_);
    if (r.$ === "Err") return r;
    normalized = normalized_;
  } else if (inherent_kind.$ === "InherentConstImpl") {
    const term = AliasTerm.new_from_args(cx, inherent_kind, inherent_args);
    // NOTE: we intentionally pass in the `InherentConstImpl` form as the term to
    // instantiate to upon too-generic CTFE failure, as we ought to consistently compare
    // identities via `InherentConstImpl` rather than `InherentConstSelf`.
    return this.evaluate_const_and_instantiate_projection_term(
      goal.param_env,
      term,
      goal.predicate.term,
      AliasTerm.expect_ct(term),
    );
  } else {
    return panic(`expected inherent alias, found ${debug_AliasTermKind(inherent_kind, PLAIN)}`);
  }

  const r2 = this.eq(goal.param_env, goal.predicate.term, normalized, relate_Term);
  if (r2.$ === "Err") return r2;
  return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/inherent.rs:81 convert_inherent_self_to_impl
EvalCtxt.prototype.convert_inherent_self_to_impl = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  term: AliasTermT,
): Result<[AliasTermKind, GenericArgs], NoSolutionOrRerunNonErased> {
  switch (term.kind.$) {
    case "InherentTy":
    case "InherentConstSelf": {
      const cx = this.cx();
      const def_id = AliasTerm.expect_inherent_def_id(term);
      const impl_def_id = cx.inherent_alias_term_parent(def_id);
      const impl_args = this.fresh_args_for_item(impl_def_id);

      // Equate impl header and add impl where clauses
      const r = this.eq(
        param_env,
        AliasTerm.self_ty(term),
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate(as_interner(cx).type_of(impl_def_id), cx, impl_args, fold_Ty)),
        relate_Ty,
      );
      if (r.$ === "Err") return r;

      // Equate IAT with the RHS of the project goal
      const inherent_args = AliasTerm.rebase_inherent_args_onto_impl(term, impl_args, cx);

      let kind: AliasTermKind;
      const k = term.kind;
      if (k.$ === "InherentTy") {
        kind = { $: "InherentTy", def_id: k.def_id };
      } else if (k.$ === "InherentConstSelf") {
        kind = { $: "InherentConstImpl", def_id: k.def_id };
      } else {
        return unreachable();
      }

      return Ok([kind, inherent_args]);
    }
    case "InherentConstImpl":
      return Ok([term.kind, term.args]);
    default:
      return panic(`expected inherent alias, found ${debug_AliasTermKind(term.kind, PLAIN)}`);
  }
};
