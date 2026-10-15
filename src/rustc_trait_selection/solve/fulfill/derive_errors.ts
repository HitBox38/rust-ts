// Port of compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs (lane trait-sel-solve).
//
// `FulfillmentError` / `FulfillmentErrorCode` (traits/mod.rs:80 / :113) are the generated types of traits/mod.gen.ts;
// the struct literal `FulfillmentError { obligation, code, root_obligation }` is `new FulfillmentError(..)`.
// PORT: `BestObligation`'s `type Result = ControlFlow<PredicateObligation>`; `?` on a `ControlFlow` returns the `Break`.

import { ControlFlow, type ControlFlow as ControlFlowT, VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { MismatchedProjectionTypes } from "../../../rustc_infer/traits/project.ts";
import { Obligation, type PredicateObligation, type PredicateObligations, try_fold_with_Obligation, fold_with_Obligation, visit_with_Obligation } from "../../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, fold_with_ObligationCause, ObligationCause, try_fold_with_ObligationCause, visit_with_ObligationCause, type ObligationCauseCode, type SelectionError } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { ConstConditions, GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { Predicate_upcast_from_PolyTraitRef, Predicate_upcast_from_ProjectionClause, Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Predicate, fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { ParamConst } from "../../../rustc_middle/ty/sty.ts";
import { solve } from "../../../rustc_next_trait_solver/lib.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { span_bug, bug } from "../../../rustc_span/macros.ts";
import { Binder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../../rustc_type_ir/const_kind.ts";
import { ExpectedFound, TypeError } from "../../../rustc_type_ir/error.ts";
import { fold_tuple2, type FallibleTypeFolder, type TypeFoldable, type TypeFolder } from "../../../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, type HostEffectClause, PolyTraitClause, type ProjectionClause, TraitClause, type TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import type { ProbeKind } from "../../../rustc_type_ir/solve/inspect.ts";
import { AliasTerm, AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { Unnormalized, UnnormalizedPolyTraitRef } from "../../../rustc_type_ir/unnormalized.ts";
import type { TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { debug_ConstKind } from "../../../rustc_type_ir/const_kind.ts";
import type { ConstKind } from "../../../rustc_type_ir/const_kind.gen.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/structural_impls.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { FulfillmentError, type FulfillmentErrorCode } from "../../traits/mod.gen.ts";
import { unnormalized_obligations as wf_unnormalized_obligations } from "../../traits/wf.ts";
import { SolverDelegate } from "../delegate.ts";
import { clone_PredicateObligation } from "../fulfill.ts";
import { type InspectCandidate, type InspectConfig, type InspectGoal, type ProofTreeVisitor, ProofTreeVisitor_provided } from "../inspect/analyse.ts";
import { deeply_normalize_for_diagnostics } from "../normalize.ts";
import type { Term } from "../../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../../rustc_span/def_id.ts";

// ---- derive_errors.rs ---------------------------------------------------------------------------------------------

// rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:22 fulfillment_error_for_no_solution
export function fulfillment_error_for_no_solution(infcx: InferCtxt, root_obligation: PredicateObligation): FulfillmentError {
  const obligation = find_best_leaf_obligation(infcx, root_obligation, false);

  let code: FulfillmentErrorCode;
  const kind = Binder.skip_binder(obligation.predicate.kind());
  if (kind.$ === "Clause" && kind._0.$ === "Projection") {
    code = {
      $: "Project",
      // FIXME: This could be a `Sorts` if the term is a type
      _0: { err: TypeError.Mismatch },
    };
  } else if (kind.$ === "Clause" && kind._0.$ === "ConstArgHasType") {
    const ct = kind._0._0;
    const expected_ty = kind._0._1;
    let ct_ty: Ty;
    const k = ct.kind();
    switch (k.$) {
      case "Alias":
        ct_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(k._1, infcx.tcx));
        break;
      case "Param":
        ct_ty = ParamConst.find_const_ty_from_env(k._0, obligation.param_env);
        break;
      case "Value":
        ct_ty = k._0.ty;
        break;
      default:
        return span_bug(obligation.cause.span, `ConstArgHasWrongType failed but we don't know how to compute type for ${debug_ConstKind_(k)}`);
    }
    code = { $: "Select", _0: { $: "ConstArgHasWrongType", ct, ct_ty, expected_ty } };
  } else if (kind.$ === "Subtype") {
    const pred = kind._0;
    const [a, b] = infcx.enter_forall_and_leak_universe(Binder.rebind(obligation.predicate.kind(), [pred.a, pred.b] as [Ty, Ty]), fold_Ty_Ty());
    const expected_found = ExpectedFound.new(a, b);
    code = { $: "Subtype", _0: expected_found, _1: { $: "Sorts", _0: expected_found } };
  } else if (kind.$ === "Coerce") {
    const pred = kind._0;
    const [a, b] = infcx.enter_forall_and_leak_universe(Binder.rebind(obligation.predicate.kind(), [pred.a, pred.b] as [Ty, Ty]), fold_Ty_Ty());
    const expected_found = ExpectedFound.new(b, a);
    code = { $: "Subtype", _0: expected_found, _1: { $: "Sorts", _0: expected_found } };
  } else if (kind.$ === "Clause" && (kind._0.$ === "RegionOutlives" || kind._0.$ === "TypeOutlives") && infcx.tcx.assumptions_on_binders()) {
    code = { $: "Outlives" };
  } else if (kind.$ === "Clause" || kind.$ === "DynCompatible" || kind.$ === "Ambiguous") {
    code = { $: "Select", _0: { $: "Unimplemented" } };
  } else {
    // `ty::PredicateKind::ConstEquate(..) | ty::PredicateKind::NormalizesTo(..)`
    return bug(`unexpected goal: ${debug_PredicateObligation(obligation)}`);
  }

  return new FulfillmentError(obligation, code, root_obligation);
}

// rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:85 fulfillment_error_for_stalled
export function fulfillment_error_for_stalled(infcx: InferCtxt, root_obligation: PredicateObligation): FulfillmentError {
  const [code, refine_obligation] = infcx.probe((_): [FulfillmentErrorCode, boolean] => {
    const r = solve.SolverDelegateEvalExt_for_D.evaluate_root_goal(SolverDelegate.from(infcx), root_obligation.as_goal(), root_obligation.cause.span, undefined);
    if (r.$ === "Ok") {
      const certainty = r._0.certainty;
      if (certainty.$ === "Maybe" && certainty._0.cause.$ === "Ambiguity") {
        return [{ $: "Ambiguity", overflow: undefined }, true];
      } else if (certainty.$ === "Maybe" && certainty._0.cause.$ === "Overflow") {
        const { suggest_increasing_limit } = certainty._0.cause;
        return [
          { $: "Ambiguity", overflow: suggest_increasing_limit },
          // Don't look into overflows because we treat overflows weirdly anyways.
          // We discard the inference constraints from overflowing goals, so
          // recomputing the goal again during `find_best_leaf_obligation` may apply
          // inference guidance that makes other goals go from ambig -> pass, for example.
          //
          // FIXME: We should probably just look into overflows here.
          false,
        ];
      } else {
        // `Certainty::Yes`
        // FIXME: We should ICE here. See the following links for details
        // - <https://rust-lang.zulipchat.com/#narrow/channel/144729-t-types/topic/resolving.20equal.20regions/near/623484902>
        // - <https://github.com/rust-lang/rust/issues/161669>
        return [{ $: "Ambiguity", overflow: undefined }, false];
      }
    } else {
      return span_bug(
        root_obligation.cause.span,
        `did not expect selection error when collecting ambiguity errors for \`${debug_Predicate(infcx.deeply_resolve_ignoring_regions(root_obligation.predicate, fold_Predicate), PLAIN)}\``,
      );
    }
  });

  return new FulfillmentError(
    refine_obligation ? find_best_leaf_obligation(infcx, root_obligation, true) : clone_PredicateObligation(root_obligation),
    code,
    root_obligation,
  );
}

// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:151 find_best_leaf_obligation
function find_best_leaf_obligation(infcx: InferCtxt, obligation0: PredicateObligation, consider_ambiguities: boolean): PredicateObligation {
  let obligation = infcx.deeply_resolve_ignoring_regions(clone_PredicateObligation(obligation0), fold_PredicateObligation());
  // FIXME: we use a probe here as the `BestObligation` visitor does not
  // check whether it uses candidates which get shadowed by where-bounds.
  //
  // We should probably fix the visitor to not do so instead, as this also
  // means the leaf obligation may be incorrect.
  const r = infcx.fudge_inference_if_ok((): Result<[ObligationCause, PredicateObligation], null> => {
    const v = infcx.visit_proof_tree(obligation.as_goal(), new BestObligation(clone_PredicateObligation(obligation), consider_ambiguities));
    // `.break_value().ok_or(())`
    if (v.$ !== "Break") return { $: "Err", _0: null };
    const o = v._0;
    // walk around the fact that the cause in `Obligation` is ignored by folders so that
    // we can properly fudge the infer vars in cause code.
    return { $: "Ok", _0: [clone_ObligationCause(o.cause), o] };
  }, fold_Cause_and_PredicateObligation());
  if (r.$ === "Ok") {
    const [cause, o] = r._0;
    obligation = new Obligation(cause, o.param_env, o.predicate, o.recursion_depth);
  }
  return deeply_normalize_for_diagnostics(infcx, obligation.param_env, obligation, fold_PredicateObligation());
}

class BestObligation implements ProofTreeVisitor<ControlFlowT<PredicateObligation>> {
  /** `type Result = ControlFlow<PredicateObligation<'tcx>>;` */
  readonly Result = VisitorResult.ControlFlow<PredicateObligation>();

  constructor(
    public obligation: PredicateObligation,
    public consider_ambiguities: boolean,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:186 with_derived_obligation
  with_derived_obligation(
    derived_obligation: PredicateObligation,
    and_then: (this_: BestObligation) => ControlFlowT<PredicateObligation>,
  ): ControlFlowT<PredicateObligation> {
    const old_obligation = this.obligation;
    this.obligation = derived_obligation;
    const res = and_then(this);
    this.obligation = old_obligation;
    return res;
  }

  /// Filter out the candidates that aren't interesting to visit for the
  /// purposes of reporting errors. For ambiguities, we only consider
  /// candidates that may hold. For errors, we only consider candidates that
  /// *don't* hold and which have impl-where clauses that also don't hold.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:201 non_trivial_candidates
  non_trivial_candidates(goal: InspectGoal): InspectCandidate[] {
    let candidates = goal.candidates();
    switch (this.consider_ambiguities) {
      case true:
        // If we have an ambiguous obligation, we must consider *all* candidates
        // that hold, or else we may guide inference causing other goals to go
        // from ambig -> pass/fail.
        candidates = candidates.filter((candidate) => candidate.result().$ === "Ok");
        break;
      case false:
        // We always handle rigid alias candidates separately as we may not add them for
        // aliases whose trait bound doesn't hold.
        candidates = candidates.filter((c) => c.kind().$ !== "RigidAlias");
        // If there are multiple candidates, we can still recurse into a single one if all
        // others fail due to boring reasons. Currently that's if we fail to normalize
        // while considering the candidate.
        if (candidates.length > 1) {
          candidates = candidates.filter((candidate) =>
            goal
              .infcx()
              .probe(
                (_) =>
                  !candidate
                    .instantiate_nested_goals(this.span())
                    .some((nested_goal) => nested_goal.source() === "Normalization" && nested_goal.result().$ === "Err"),
              ),
          );
        }
        break;
    }

    return candidates;
  }

  /// HACK: We walk the nested obligations for a well-formed arg manually,
  /// since there's nontrivial logic in `wf.rs` to set up an obligation cause.
  /// Ideally we'd be able to track this better.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:241 visit_well_formed_goal
  visit_well_formed_goal(candidate: InspectCandidate, term: Term): ControlFlowT<PredicateObligation> {
    const infcx = candidate.goal().infcx();
    const param_env = candidate.goal().goal().param_env;
    const body_def_id = this.obligation.cause.body_def_id;

    for (const obligation of wf_unnormalized_obligations(infcx, param_env, term, this.span(), body_def_id) ?? []) {
      const nested_goal = candidate.instantiate_proof_tree_for_nested_goal("Misc", obligation.as_goal(), this.span());
      // Skip nested goals that aren't the *reason* for our goal's failure.
      const res = nested_goal.result();
      if (
        (this.consider_ambiguities && res.$ === "Ok" && res._0.$ === "Maybe" && res._0._0.cause.$ === "Ambiguity") ||
        (!this.consider_ambiguities && res.$ === "Err")
      ) {
        // fall through
      } else {
        continue;
      }

      const r = this.with_derived_obligation(obligation, (this_) => nested_goal.visit_with(this_));
      if (r.$ === "Break") return r;
    }

    return ControlFlow.Break(clone_PredicateObligation(this.obligation));
  }

  /// If a normalization of an associated item or a trait goal fails without trying any
  /// candidates it's likely that normalizing its self type failed. We manually detect
  /// such cases here.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:282 detect_error_in_self_ty_normalization
  detect_error_in_self_ty_normalization(goal: InspectGoal, self_ty: Ty): ControlFlowT<PredicateObligation> {
    assert(!this.consider_ambiguities, "assertion failed: !self.consider_ambiguities");
    const tcx = goal.infcx().tcx;
    const k = self_ty.kind();
    if (k.$ === "Alias") {
      const alias = k._1;
      const infer_term = goal.infcx().next_ty_var(this.obligation.cause.span);
      const pred: ProjectionClause = { projection_term: AliasTerm.from_AliasTy(alias), term: infer_term };
      const obligation = Obligation.new(tcx, clone_ObligationCause(this.obligation.cause), goal.goal().param_env, pred, solve.upcast_fn(Predicate_upcast_from_ProjectionClause));
      return this.with_derived_obligation(obligation, (this_) =>
        goal.infcx().visit_proof_tree_at_depth(Goal.with(goal.goal(), as_interner(tcx), pred, solve.upcast_fn(Predicate_upcast_from_ProjectionClause)), goal.depth() + 1, this_),
      );
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  /// When a higher-ranked projection goal fails, check that the corresponding
  /// higher-ranked trait goal holds or not. This is because the process of
  /// instantiating and then re-canonicalizing the binder of the projection goal
  /// forces us to be unable to see that the leak check failed in the nested
  /// `NormalizesTo` goal, so we don't fall back to the rigid projection check
  /// that should catch when a projection goal fails due to an unsatisfied trait
  /// goal.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:314 detect_trait_error_in_higher_ranked_projection
  detect_trait_error_in_higher_ranked_projection(goal: InspectGoal): ControlFlowT<PredicateObligation> {
    const tcx = goal.infcx().tcx;
    const projection_clause = goal.goal().predicate.as_projection_clause();
    if (projection_clause !== undefined && Binder.bound_vars(projection_clause).length !== 0) {
      const pred = Binder.map_bound(projection_clause, (proj) => AliasTerm.trait_ref(proj.projection_term, as_interner(tcx)));
      const obligation = Obligation.new(
        tcx,
        clone_ObligationCause(this.obligation.cause),
        goal.goal().param_env,
        deeply_normalize_for_diagnostics(goal.infcx(), goal.goal().param_env, pred, fold_PolyTraitRef()),
        solve.upcast_fn(Predicate_upcast_from_PolyTraitRef),
      );
      return this.with_derived_obligation(obligation, (this_) =>
        goal.infcx().visit_proof_tree_at_depth(Goal.with(goal.goal(), as_interner(tcx), pred, solve.upcast_fn(Predicate_upcast_from_PolyTraitRef)), goal.depth() + 1, this_),
      );
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  /// It is likely that `NormalizesTo` failed without any applicable candidates
  /// because the alias is not well-formed.
  ///
  /// As we only enter `RigidAlias` candidates if the trait bound of the associated type
  /// holds, we discard these candidates in `non_trivial_candidates` and always manually
  /// check this here.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:347 detect_non_well_formed_assoc_item
  detect_non_well_formed_assoc_item(goal: InspectGoal, alias: AliasTermT): ControlFlowT<PredicateObligation> {
    const tcx = goal.infcx().tcx;
    const obligation = Obligation.new(
      tcx,
      clone_ObligationCause(this.obligation.cause),
      goal.goal().param_env,
      AliasTerm.trait_ref(alias, as_interner(tcx)),
      solve.upcast_fn(Predicate_upcast_from_TraitRef),
    );
    return this.with_derived_obligation(obligation, (this_) =>
      goal
        .infcx()
        .visit_proof_tree_at_depth(
          Goal.with(goal.goal(), as_interner(tcx), AliasTerm.trait_ref(alias, as_interner(tcx)), solve.upcast_fn(Predicate_upcast_from_TraitRef)),
          goal.depth() + 1,
          this_,
        ),
    );
  }

  /// If we have no candidates, then it's likely that there is a
  /// non-well-formed alias in the goal.
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:370 detect_error_from_empty_candidates
  detect_error_from_empty_candidates(goal: InspectGoal): ControlFlowT<PredicateObligation> {
    const pred_kind = goal.goal().predicate.kind();

    const k = Binder.no_bound_vars(pred_kind, fold_PredicateKind_());
    if (k !== undefined && k.$ === "Clause" && k._0.$ === "Trait") {
      const pred = k._0._0;
      const r = this.detect_error_in_self_ty_normalization(goal, TraitClause.self_ty(pred));
      if (r.$ === "Break") return r;
    } else if (k !== undefined && k.$ === "Clause" && k._0.$ === "Projection" && AliasTermKind.is_trait_projection(k._0._0.projection_term.kind)) {
      const pred = k._0._0;
      let r = this.detect_error_in_self_ty_normalization(goal, AliasTerm.self_ty(pred.projection_term));
      if (r.$ === "Break") return r;
      r = this.detect_non_well_formed_assoc_item(goal, pred.projection_term);
      if (r.$ === "Break") return r;
    } else {
      // `Some(_) | None => {}`
    }

    return ControlFlow.Break(clone_PredicateObligation(this.obligation));
  }

  // ---- impl<'tcx> ProofTreeVisitor<'tcx> for BestObligation<'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:396 span
  span(): Span {
    return this.obligation.cause.span;
  }

  // #[instrument(level = "trace", skip(self, goal), fields(goal = ?goal.goal()))]
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:401 visit_goal
  visit_goal(goal: InspectGoal): ControlFlowT<PredicateObligation> {
    const tcx = goal.infcx().tcx;
    // Skip goals that aren't the *reason* for our goal's failure.
    const res = goal.result();
    if (
      (this.consider_ambiguities && res.$ === "Ok" && res._0.$ === "Maybe" && res._0._0.cause.$ === "Ambiguity") ||
      (!this.consider_ambiguities && res.$ === "Err")
    ) {
      // fall through
    } else {
      return ControlFlow.CONTINUE;
    }

    const pred = goal.goal().predicate;

    const candidates = this.non_trivial_candidates(goal);
    let candidate: InspectCandidate;
    if (candidates.length === 1) {
      candidate = candidates[0]!;
    } else if (candidates.length === 0) {
      return this.detect_error_from_empty_candidates(goal);
    } else {
      return ControlFlow.Break(clone_PredicateObligation(this.obligation));
    }

    // Don't walk into impls that have `do_not_recommend`.
    const ck = candidate.kind();
    if (ck.$ === "TraitCandidate" && ck.source.$ === "Impl" && tcx.do_not_recommend_impl(ck.source._0)) {
      // trace!("#[diagnostic::do_not_recommend] -> exit");
      return ControlFlow.Break(clone_PredicateObligation(this.obligation));
    }

    // FIXME: Also, what about considering >1 layer up the stack? May be necessary
    // for normalizes-to.
    let child_mode: ChildMode;
    const pk = Binder.skip_binder(pred.kind());
    if (pk.$ === "Clause" && pk._0.$ === "Trait") {
      child_mode = { $: "Trait", _0: Binder.rebind(pred.kind(), pk._0._0) };
    } else if (pk.$ === "Clause" && pk._0.$ === "HostEffect") {
      child_mode = { $: "Host", _0: Binder.rebind(pred.kind(), pk._0._0) };
    } else if (pk.$ === "Clause" && pk._0.$ === "Projection" && AliasTermKind.is_trait_projection(pk._0._0.projection_term.kind)) {
      const projection = pk._0._0;
      child_mode = {
        $: "Trait",
        _0: Binder.rebind(pred.kind(), {
          trait_ref: AliasTerm.trait_ref(projection.projection_term, as_interner(tcx)),
          polarity: "Positive",
        } satisfies TraitClause),
      };
    } else if (pk.$ === "Clause" && pk._0.$ === "WellFormed") {
      return this.visit_well_formed_goal(candidate, pk._0._0);
    } else {
      child_mode = ChildMode.PassThrough;
    }

    const nested_goals = candidate.instantiate_nested_goals(this.span());

    // If the candidate requires some `T: FnPtr` bound which does not hold should not be treated as
    // an actual candidate, instead we should treat them as if the impl was never considered to
    // have potentially applied. As if `impl<A, R> Trait for for<..> fn(..A) -> R` was written
    // instead of `impl<T: FnPtr> Trait for T`.
    //
    // We do this as a separate loop so that we do not choose to tell the user about some nested
    // goal before we encounter a `T: FnPtr` nested goal.
    for (const nested_goal of nested_goals) {
      const poly_trait_pred = nested_goal.goal().predicate.as_trait_clause();
      if (poly_trait_pred !== undefined && tcx.is_lang_item(PolyTraitClause.def_id(poly_trait_pred), "FnPtrTrait") && nested_goal.result().$ === "Err") {
        return ControlFlow.Break(clone_PredicateObligation(this.obligation));
      }
    }

    let impl_where_bound_count = 0;
    for (const nested_goal of nested_goals) {
      // trace!(nested_goal = ?(nested_goal.goal(), nested_goal.source(), nested_goal.result()));

      const nested_pred = nested_goal.goal().predicate;

      const make_obligation = (cause: ObligationCause): PredicateObligation =>
        new Obligation(cause, nested_goal.goal().param_env, nested_pred, this.obligation.recursion_depth + 1);

      let obligation: PredicateObligation;
      const source = nested_goal.source();
      if ((child_mode.$ === "Trait" || child_mode.$ === "Host") && (source === "Misc" || source === "Normalization")) {
        continue;
      } else if (child_mode.$ === "Trait" && source === "ImplWhereBound") {
        const parent_trait_pred = child_mode._0;
        obligation = make_obligation(derive_cause(tcx, candidate.kind(), clone_ObligationCause(this.obligation.cause), impl_where_bound_count, parent_trait_pred));
        impl_where_bound_count += 1;
      } else if (child_mode.$ === "Host" && (source === "ImplWhereBound" || source === "AliasBoundConstCondition")) {
        const parent_host_clause = child_mode._0;
        obligation = make_obligation(derive_host_cause(tcx, candidate.kind(), clone_ObligationCause(this.obligation.cause), impl_where_bound_count, parent_host_clause));
        impl_where_bound_count += 1;
      } else {
        // `(ChildMode::PassThrough, _) | (_, GoalSource::AliasWellFormed | GoalSource::AliasBoundConstCondition)`
        obligation = make_obligation(clone_ObligationCause(this.obligation.cause));
      }

      const r = this.with_derived_obligation(obligation, (this_) => nested_goal.visit_with(this_));
      if (r.$ === "Break") return r;
    }

    const r = this.detect_trait_error_in_higher_ranked_projection(goal);
    if (r.$ === "Break") return r;

    return ControlFlow.Break(clone_PredicateObligation(this.obligation));
  }

  // (provided) ProofTreeVisitor methods this impl does not override.
  config(): InspectConfig {
    return ProofTreeVisitor_provided.config(this);
  }
  on_recursion_limit(): ControlFlowT<PredicateObligation> {
    return ProofTreeVisitor_provided.on_recursion_limit(this);
  }
}

// #[derive(Debug, Copy, Clone)]
type ChildMode =
  // Try to derive an `ObligationCause::{ImplDerived,BuiltinDerived}`,
  // and skip all `GoalSource::Misc`, which represent useless obligations
  // such as alias-eq which may not hold.
  | { readonly $: "Trait"; _0: Binder<TraitClause> }
  // Try to derive an `ObligationCause::{ImplDerived,BuiltinDerived}`,
  // and skip all `GoalSource::Misc`, which represent useless obligations
  // such as alias-eq which may not hold.
  | { readonly $: "Host"; _0: Binder<HostEffectClause> }
  // Skip trying to derive an `ObligationCause` from this obligation, and
  // report *all* sub-obligations as if they came directly from the parent
  // obligation.
  | { readonly $: "PassThrough" };
const ChildMode = {
  PassThrough: Object.freeze({ $: "PassThrough" as const }),
};

// rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:553 derive_cause
function derive_cause(tcx: TyCtxt, candidate_kind: ProbeKind, cause: ObligationCause, idx: number, parent_trait_pred: Binder<TraitClause>): ObligationCause {
  if (candidate_kind.$ === "TraitCandidate" && candidate_kind.source.$ === "Impl") {
    const impl_def_id = candidate_kind.source._0;
    const nth = nth_of(GenericClauses.instantiate_identity(tcx.clauses_of(impl_def_id) as GenericClauses, tcx).iter(), idx);
    if (nth !== undefined) {
      const [, span] = nth;
      cause = cause.derived_cause(parent_trait_pred, (derived): ObligationCauseCode => ({
        $: "ImplDerived",
        _0: {
          derived,
          impl_or_alias_def_id: impl_def_id,
          impl_def_clause_index: idx,
          span,
        },
      }));
    }
  } else if (candidate_kind.$ === "TraitCandidate" && candidate_kind.source.$ === "BuiltinImpl") {
    cause = cause.derived_cause(parent_trait_pred, (d): ObligationCauseCode => ({ $: "BuiltinDerived", _0: d }));
  }
  return cause;
}

// rustc: compiler/rustc_trait_selection/src/solve/fulfill/derive_errors.rs:589 derive_host_cause
function derive_host_cause(
  tcx: TyCtxt,
  candidate_kind: ProbeKind,
  cause: ObligationCause,
  idx: number,
  parent_host_clause: Binder<HostEffectClause>,
): ObligationCause {
  if (candidate_kind.$ === "TraitCandidate" && candidate_kind.source.$ === "Impl") {
    const impl_def_id = candidate_kind.source._0;
    function* chained(): Generator<[unknown, Span]> {
      yield* GenericClauses.instantiate_identity(tcx.clauses_of(impl_def_id) as GenericClauses, tcx).into_iter();
      for (const [trait_ref, span] of ConstConditions.instantiate_identity(tcx.const_conditions(impl_def_id) as ConstConditions, tcx)) {
        yield [UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, tcx, Binder.skip_binder(parent_host_clause).constness), span];
      }
    }
    const nth = nth_of(chained(), idx);
    if (nth !== undefined) {
      const [, span] = nth;
      cause = cause.derived_host_cause(parent_host_clause, (derived): ObligationCauseCode => ({
        $: "ImplDerivedHost",
        _0: { derived, impl_def_id, span },
      }));
    }
  } else if (candidate_kind.$ === "TraitCandidate" && candidate_kind.source.$ === "BuiltinImpl") {
    cause = cause.derived_host_cause(parent_host_clause, (d): ObligationCauseCode => ({ $: "BuiltinDerivedHost", _0: d }));
  }
  return cause;
}

// ---- helpers ----------------------------------------------------------------------------------------------------------


/** `Iterator::nth`. */
function nth_of<T>(it: Iterable<T>, n: number): T | undefined {
  let i = 0;
  for (const x of it) {
    if (i === n) return x;
    i++;
  }
  return undefined;
}

function debug_PredicateObligation(o: PredicateObligation): string {
  return debug_Obligation(o, PLAIN, debug_Predicate);
}

function debug_ConstKind_(k: ConstKind): string {
  return debug_ConstKind(k, PLAIN);
}

// PORT (D4): the descriptors this file folds with; built on call (the generated fns are read lazily).
function descriptor<T>(
  visit_with: <R>(s: T, v: TypeVisitor<R>) => R,
  try_fold_with: <E>(s: T, f: FallibleTypeFolder<E>) => Result<T, E>,
  fold_with: (s: T, f: TypeFolder) => T,
): TypeFoldable<T> {
  return { visit_with, try_fold_with, fold_with };
}
/** `(Ty<'tcx>, Ty<'tcx>)` */
function fold_Ty_Ty(): TypeFoldable<[Ty, Ty]> {
  return fold_tuple2(fold_Ty, fold_Ty);
}
/** `PredicateObligation<'tcx>` */
export function fold_PredicateObligation(): TypeFoldable<PredicateObligation> {
  return descriptor<PredicateObligation>(
    (s, v) => visit_with_Obligation(s, v, fold_Predicate.visit_with),
    (s, f) => try_fold_with_Obligation(s, f, fold_Predicate.try_fold_with),
    (s, f) => fold_with_Obligation(s, f, fold_Predicate.fold_with),
  );
}
/** `ObligationCause<'tcx>` */
function fold_ObligationCause(): TypeFoldable<ObligationCause> {
  return descriptor<ObligationCause>(
    (s, v) => visit_with_ObligationCause(s, v),
    (s, f) => try_fold_with_ObligationCause(s, f),
    (s, f) => fold_with_ObligationCause(s, f),
  );
}
/** `(ObligationCause<'tcx>, PredicateObligation<'tcx>)` */
function fold_Cause_and_PredicateObligation(): TypeFoldable<[ObligationCause, PredicateObligation]> {
  return fold_tuple2(fold_ObligationCause(), fold_PredicateObligation());
}
/** `ty::PolyTraitRef<'tcx>` */
function fold_PolyTraitRef(): TypeFoldable<Binder<TraitRef>> {
  return fold_Binder(
    descriptor<TraitRef>(
      (s, v) => visit_with_TraitRef(s, v),
      (s, f) => try_fold_with_TraitRef(s, f),
      (s, f) => fold_with_TraitRef(s, f),
    ),
  );
}
/** `ty::PredicateKind<'tcx>` */
function fold_PredicateKind_(): TypeFoldable<PredicateKind> {
  return descriptor<PredicateKind>(
    (s, v) => visit_with_PredicateKind(s, v),
    (s, f) => try_fold_with_PredicateKind(s, f),
    (s, f) => fold_with_PredicateKind(s, f),
  );
}
