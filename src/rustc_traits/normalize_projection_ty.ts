// Port of compiler/rustc_traits/src/normalize_projection_ty.rs (lane selcx-contract).
//
// PORT: `ParamEnvAnd { param_env, value: goal }` closure patterns destructure the key; the lazy `.map(..)` over
// `instantiate_own` that feeds `register_obligations` is a generator (registration interleaves with instantiation, as
// upstream). `err_ctxt()` is traits/mod.ts's `TypeErrCtxtView` (error reporting is wave 19).

import type { Canonical, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import {
  type CanonicalAliasGoal,
  fold_with_NormalizationResult,
  type NormalizationResult,
  try_fold_with_NormalizationResult,
  visit_with_NormalizationResult,
} from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, Const, ParamEnv, Predicate, Ty } from "../rustc_middle/ty/decls.ts";
import { GenericClauses } from "../rustc_middle/ty/generics.ts";
import { Term } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_ClauseKind } from "../rustc_middle/ty/predicate.ts";
import { fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { AliasConst } from "../rustc_type_ir/const_kind.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { AliasTerm, AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../rustc_type_ir/term_kind.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias, type AliasTerm as AliasTermT } from "../rustc_type_ir/ty/alias.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "../rustc_infer/traits/mod.ts";
import { type ScrubbedTraitError, TraitErrors } from "../rustc_infer/traits/engine.ts";
import type { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { err_ctxt, normalize_inherent_projection, normalize_projection_term, SelectionContext } from "../rustc_trait_selection/traits/mod.ts";
import { const_of_item_or_delayed_bug } from "../rustc_trait_selection/traits/project.ts";
import { fold_ParamEnvAnd } from "../rust_ts/fold_param_env_and.ts";

const d_AliasTerm: TypeFoldable<AliasTermT> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};
const d_NormalizationResult: TypeFoldable<NormalizationResult> = {
  visit_with: visit_with_NormalizationResult,
  try_fold_with: try_fold_with_NormalizationResult,
  fold_with: fold_with_NormalizationResult,
};

/** `NoSolution` (`rustc_next_trait_solver::solve::NO_SOLUTION`), read lazily (init order). */
function NO_SOLUTION(): NoSolution {
  return (require("../rustc_next_trait_solver/solve/mod.ts") as typeof import("../rustc_next_trait_solver/solve/mod.ts")).NO_SOLUTION;
}

// rustc: compiler/rustc_traits/src/normalize_projection_ty.rs:13 provide
export function provide(p: Providers): void {
  p.normalize_canonicalized_projection = normalize_canonicalized_projection;
  p.normalize_canonicalized_free_alias = normalize_canonicalized_free_alias;
  p.normalize_canonicalized_inherent_projection = normalize_canonicalized_inherent_projection;
}

/// If `normalized_term` is a const, returns a `ConstArgHasType` obligation
/// to verify that the const value's type matches the alias's declared type.
/// Returns `None` if the term is a type rather than a const.
// rustc: compiler/rustc_traits/src/normalize_projection_ty.rs:25 const_arg_has_type_obligation
function const_arg_has_type_obligation(tcx: TyCtxt, param_env: ParamEnv, normalized_term: Term, goal: AliasTermT): PredicateObligation | undefined {
  const ct = Term.as_const(normalized_term);
  if (ct === undefined) return undefined;
  const expected_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(AliasTerm.expect_ct(goal), tcx));
  return Obligation.new(tcx, ObligationCause.dummy(), param_env, { $: "ConstArgHasType", _0: ct, _1: expected_ty }, Predicate_upcast_from_ClauseKind as never);
}

// rustc: compiler/rustc_traits/src/normalize_projection_ty.rs:41 normalize_canonicalized_projection
function normalize_canonicalized_projection(tcx: TyCtxt, goal: CanonicalAliasGoal): Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution> {
  // debug!("normalize_canonicalized_projection(goal={:#?})", goal);

  return tcx.infer_ctxt().enter_canonical_trait_query(
    goal,
    (ocx_, { param_env, value: goal }) => {
      const ocx = ocx_ as ObligationCtxt<ScrubbedTraitError>;
      // debug_assert!(!ocx.infcx.next_trait_solver());
      const selcx = SelectionContext.new(ocx.infcx);
      const cause = ObligationCause.dummy();
      const obligations: PredicateObligations = [];
      const normalized_term = normalize_projection_term(selcx, param_env, goal, cause, 0, obligations);
      ocx.register_obligations(obligations);
      // #112047: With projections and opaques, we are able to create opaques that
      // are recursive (given some generic parameters of the opaque's type variables).
      // In that case, we may only realize a cycle error when calling
      // `normalize_erasing_regions` in mono.
      const errors = ocx.try_evaluate_obligations();
      if (!TraitErrors.no_errors(errors)) {
        // Rustdoc may attempt to normalize type alias types which are not
        // well-formed. Rustdoc also normalizes types that are just not
        // well-formed, since we don't do as much HIR analysis (checking
        // that impl vars are constrained by the signature, for example).
        if (!tcx.sess.opts.actually_rustdoc) {
          for (const error of TraitErrors.into_iter_ref(errors)) {
            if (error.$ === "Cycle") {
              const cycle = error._0;
              err_ctxt(ocx.infcx).report_overflow_obligation_cycle(cycle);
            }
          }
        }
        return Err(NO_SOLUTION());
      }

      return Ok({ normalized_term });
    },
    fold_ParamEnvAnd(d_AliasTerm),
    d_NormalizationResult,
  );
}

// rustc: compiler/rustc_traits/src/normalize_projection_ty.rs:88 normalize_canonicalized_free_alias
function normalize_canonicalized_free_alias(tcx: TyCtxt, goal: CanonicalAliasGoal): Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution> {
  // debug!("normalize_canonicalized_free_alias(goal={:#?})", goal);

  return tcx.infer_ctxt().enter_canonical_trait_query(
    goal,
    (ocx_, { param_env, value: goal }) => {
      const ocx = ocx_ as ObligationCtxt<ScrubbedTraitError>;
      const def_id = AliasTerm.expect_free_def_id(goal);
      const instantiated = GenericClauses.instantiate_own(tcx.clauses_of(def_id) as GenericClauses, tcx, goal.args);
      const obligations = (function* (): Generator<PredicateObligation> {
        for (const [clause, span] of instantiated) {
          yield Obligation.new(tcx, ObligationCause.dummy_with_span(span), param_env, Unnormalized.skip_norm_wip(clause), Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: Interner) => Predicate);
        }
      })();
      ocx.register_obligations(obligations);
      let normalized_term: Term;
      if (AliasTermKind.is_type(goal.kind)) {
        normalized_term = Term.from_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, goal.args, fold_Ty)));
      } else {
        normalized_term = Term.from_Const(
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate(const_of_item_or_delayed_bug(tcx, def_id) as EarlyBinder<Const>, tcx, goal.args, fold_Const)),
        );
      }
      const o = const_arg_has_type_obligation(tcx, param_env, normalized_term, goal);
      ocx.register_obligations(o === undefined ? [] : [o]);
      return Ok({ normalized_term });
    },
    fold_ParamEnvAnd(d_AliasTerm),
    d_NormalizationResult,
  );
}

// rustc: compiler/rustc_traits/src/normalize_projection_ty.rs:127 normalize_canonicalized_inherent_projection
function normalize_canonicalized_inherent_projection(tcx: TyCtxt, goal: CanonicalAliasGoal): Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution> {
  // debug!("normalize_canonicalized_inherent_projection(goal={:#?})", goal);

  return tcx.infer_ctxt().enter_canonical_trait_query(
    goal,
    (ocx_, { param_env, value: goal }) => {
      const ocx = ocx_ as ObligationCtxt<ScrubbedTraitError>;
      const selcx = SelectionContext.new(ocx.infcx);
      const cause = ObligationCause.dummy();
      const obligations: PredicateObligations = [];
      const normalized_term = normalize_inherent_projection(selcx, param_env, goal, cause, 0, obligations);
      ocx.register_obligations(obligations);

      return Ok({ normalized_term });
    },
    fold_ParamEnvAnd(d_AliasTerm),
    d_NormalizationResult,
  );
}
