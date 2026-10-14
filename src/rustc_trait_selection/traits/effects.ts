// Port of compiler/rustc_trait_selection/src/traits/effects.rs (lane trait-sel-traits-c).
//
// PORT notes (file-wide):
// - `ThinVec` is an array; `thin_vec![]` is `[]`.
// - The old solver's `SelectionContext` (traits/select/mod.rs, wave 20 selcx-contract) is not ported: the members this
//   file uses are a local interface (`PORT(merge)`), which the real class will satisfy. `normalize_with_depth_to`
//   (traits/normalize.rs, lane trait-sel-traits-a) is a local stand-in that stops as UNPORTED.
// - `infcx.probe(|_| ..)` / `commit_if_ok(|_| ..)` take a closure that ignores the snapshot argument.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.

import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Constness } from "../../rustc_hir/lib.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { ToTrace_TraitRef } from "../../rustc_infer/infer/at.ts";
import { clone_Obligation, Obligation, type PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, ObligationCause, type ImplSource, type ObligationCauseCode, type SelectionError } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/decls.ts";
import { ConstConditions, type ConstConditions as ConstConditionsT } from "../../rustc_middle/ty/generics.ts";
import { debug_Ty, type ImplTraitHeader, Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Elaboratable_Clause, elaborate } from "../../rustc_type_ir/elaborate.ts";
import { fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import {
  as_interner,
  BoundConstness,
  fold_with_HostEffectClause,
  fold_with_TraitRef,
  HostEffectClause,
  PolyTraitRef,
  TraitClause,
  TraitRef,
  try_fold_with_HostEffectClause,
  try_fold_with_TraitRef,
  visit_with_HostEffectClause,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_HostEffectClause: TypeFoldable<HostEffectClause> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
};

// rustc-type: compiler/rustc_trait_selection/src/traits/effects.rs:18 HostEffectObligation
export type HostEffectObligation = Obligation<HostEffectClause>;

// rustc-type: compiler/rustc_trait_selection/src/traits/effects.rs:20 EvaluationFailure
export type EvaluationFailure = "Ambiguous" | "NoSolution";
export const EvaluationFailure = { Ambiguous: "Ambiguous", NoSolution: "NoSolution" } as const;

/** `Obligation<HostEffectClause>: TypeFoldable` (the derive of `Obligation`, mod.gen.ts) as a D4 descriptor. */
function d_HostEffectObligation(): TypeFoldable<HostEffectObligation> {
  const m = require("../../rustc_infer/traits/mod.gen.ts") as typeof import("../../rustc_infer/traits/mod.gen.ts");
  return {
    visit_with: (self, v) => m.visit_with_Obligation(self, v, d_HostEffectClause.visit_with),
    try_fold_with: (self, f) => m.try_fold_with_Obligation(self, f, d_HostEffectClause.try_fold_with),
    fold_with: (self, f) => m.fold_with_Obligation(self, f, d_HostEffectClause.fold_with),
  };
}

/** `impl UpcastFrom<TyCtxt, Clause> for Predicate` at `Obligation::with`'s `Interner` type. */
const upcast_Clause: (from: Clause, tcx: Interner) => Predicate = Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: Interner) => Predicate;

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:25 evaluate_host_effect_obligation
export function evaluate_host_effect_obligation(selcx: SelectionContext, obligation_: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  if (TypingMode.is_coherence(selcx.typing_mode())) {
    return span_bug(obligation_.cause.span, "should not select host obligation in old solver in intercrate mode");
  }

  const obligation = selcx.infcx.deeply_resolve_ignoring_regions(clone_Obligation(obligation_, (p) => p), d_HostEffectObligation());

  // Force ambiguity for infer self ty.
  if (HostEffectClause.self_ty(obligation.predicate).is_ty_var()) {
    return Err(EvaluationFailure.Ambiguous);
  }

  let r = evaluate_host_effect_from_bounds(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);
  // Err(EvaluationFailure::NoSolution) => {}

  r = evaluate_host_effect_from_conditionally_const_item_bounds(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);

  r = evaluate_host_effect_from_item_bounds(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);

  r = evaluate_host_effect_from_builtin_impls(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);

  r = evaluate_host_effect_from_selection_candidate(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);

  r = evaluate_host_effect_from_trait_alias(selcx, obligation);
  if (r.$ === "Ok") return Ok(r._0);
  else if (r._0 === "Ambiguous") return Err(EvaluationFailure.Ambiguous);

  return Err(EvaluationFailure.NoSolution);
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:82 match_candidate
function match_candidate(
  selcx: SelectionContext,
  obligation: HostEffectObligation,
  candidate_: Binder<HostEffectClause>,
  candidate_is_unnormalized: boolean,
  more_nested: (selcx: SelectionContext, nested: PredicateObligation[]) => void,
): Result<PredicateObligation[], NoSolution> {
  if (!BoundConstness.satisfies(Binder.skip_binder(candidate_).constness, obligation.predicate.constness)) {
    return Err(NO_SOLUTION);
  }

  let candidate = selcx.infcx.instantiate_binder_with_fresh_vars(obligation.cause.span, { $: "HigherRankedType" }, candidate_, d_HostEffectClause);

  const nested: PredicateObligation[] = [];

  // Unlike param-env bounds, item bounds may not be normalized.
  if (candidate_is_unnormalized) {
    candidate = normalize_with_depth_to(
      selcx,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth,
      Unnormalized.new_wip(candidate),
      nested,
      d_HostEffectClause,
    );
  }

  const eq = selcx.infcx.at(obligation.cause, obligation.param_env).eq("Yes", obligation.predicate.trait_ref, candidate.trait_ref, ToTrace_TraitRef);
  // PORT: `?` converts the `TypeError` into `NoSolution` (`impl From<TypeError> for NoSolution`).
  if (eq.$ === "Err") return Err(NO_SOLUTION);
  nested.push(...eq._0.into_obligations());

  more_nested(selcx, nested);

  return Ok(nested);
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:126 evaluate_host_effect_from_bounds
function evaluate_host_effect_from_bounds(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const infcx = selcx.infcx;
  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(selcx.tcx()));
  let candidate: Binder<HostEffectClause> | undefined = undefined;

  for (const clause of obligation.param_env.caller_bounds()) {
    const bound_clause = clause.kind();
    const k = Binder.skip_binder(bound_clause);
    if (k.$ !== "HostEffect") {
      continue;
    }
    const data = Binder.rebind(bound_clause, k._0);
    if (!DefId_eq_(Binder.skip_binder(data).trait_ref.def_id, obligation.predicate.trait_ref.def_id)) {
      continue;
    }

    if (!drcx.args_may_unify(obligation.predicate.trait_ref.args, Binder.skip_binder(data).trait_ref.args)) {
      continue;
    }

    const is_match = infcx.probe((_) => match_candidate(selcx, obligation, data, false, () => {}).$ === "Ok");

    if (is_match) {
      if (candidate !== undefined) {
        return Err(EvaluationFailure.Ambiguous);
      } else {
        candidate = data;
      }
    }
  }

  if (candidate !== undefined) {
    const data = candidate;
    return Ok(expect(match_candidate(selcx, obligation, data, false, () => {}), "candidate matched before, so it should match again"));
  } else {
    return Err(EvaluationFailure.NoSolution);
  }
}

/// Assembles constness bounds from `~const` item bounds on alias types, which only
/// hold if the `~const` where bounds also hold and the parent trait is `~const`.
// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:172 evaluate_host_effect_from_conditionally_const_item_bounds
function evaluate_host_effect_from_conditionally_const_item_bounds(
  selcx: SelectionContext,
  obligation: HostEffectObligation,
): Result<PredicateObligation[], EvaluationFailure> {
  const infcx = selcx.infcx;
  const tcx = infcx.tcx;
  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(selcx.tcx()));
  let candidate: [Binder<HostEffectClause>, AliasTy, DefId] | undefined = undefined;

  let consider_ty = HostEffectClause.self_ty(obligation.predicate);
  for (;;) {
    const ck = consider_ty.kind();
    if (!(ck.$ === "Alias" && (ck._1.kind.$ === "Projection" || ck._1.kind.$ === "Opaque"))) break;
    const alias_ty = ck._1;
    const kind = alias_ty.kind;
    const def_id = kind.def_id;

    if (tcx.is_conditionally_const(def_id)) {
      // PORT: the `explicit_implied_const_bounds` query value is typed `unknown` in queries.gen.ts.
      const bounds = [
        ...EarlyBinder.iter_instantiated_copied(tcx.explicit_implied_const_bounds(def_id) as EarlyBinder<readonly [Binder<TraitRef>, Span][]>, tcx, alias_ty.args, d_PolyTraitRef_Span()),
      ]
        .map((x) => Unnormalized.skip_norm_wip(x))
        .map(([trait_ref, _]) => PolyTraitRef.to_host_effect_clause(trait_ref, tcx, obligation.predicate.constness));
      for (const clause of elaborate(tcx, bounds, Elaboratable_Clause)) {
        const bound_clause = clause.kind();
        const k = Binder.skip_binder(bound_clause);
        if (k.$ !== "HostEffect") {
          return unreachable_("should not elaborate non-HostEffect from HostEffect");
        }
        const data = Binder.rebind(bound_clause, k._0);
        if (!DefId_eq_(Binder.skip_binder(data).trait_ref.def_id, obligation.predicate.trait_ref.def_id)) {
          continue;
        }

        if (!drcx.args_may_unify(obligation.predicate.trait_ref.args, Binder.skip_binder(data).trait_ref.args)) {
          continue;
        }

        const is_match = infcx.probe((_) => match_candidate(selcx, obligation, data, true, () => {}).$ === "Ok");

        if (is_match) {
          if (candidate !== undefined) {
            return Err(EvaluationFailure.Ambiguous);
          } else {
            candidate = [data, alias_ty, def_id];
          }
        }
      }
    }

    if (kind.$ !== "Projection") {
      break;
    }

    consider_ty = AliasTy_self_ty(alias_ty);
  }

  if (candidate !== undefined) {
    const [data, alias_ty, def_id] = candidate;
    return Ok(
      expect(
        match_candidate(selcx, obligation, data, true, (selcx, nested) => {
          // An alias bound only holds if we also check the const conditions
          // of the alias, so we need to register those, too.
          // PORT: the `const_conditions` query value is typed `unknown` in queries.gen.ts.
          const const_conditions_ = ConstConditions.instantiate(tcx.const_conditions(def_id) as ConstConditionsT, tcx, alias_ty.args);
          const const_conditions: [Binder<TraitRef>, Span][] = const_conditions_.map(([trait_ref_, span]) => {
            const trait_ref = normalize_with_depth_to(
              selcx,
              obligation.param_env,
              clone_ObligationCause(obligation.cause),
              obligation.recursion_depth,
              trait_ref_,
              nested,
              fold_Binder(d_TraitRef),
            );
            return [trait_ref, span];
          });
          nested.push(
            ...const_conditions.map(([trait_ref, _]) => obligation.with(tcx, PolyTraitRef.to_host_effect_clause(trait_ref, tcx, obligation.predicate.constness), upcast_Clause)),
          );
        }),
        "candidate matched before, so it should match again",
      ),
    );
  } else {
    return Err(EvaluationFailure.NoSolution);
  }
}

/// Assembles constness bounds "normal" item bounds on aliases, which may include
/// unconditionally `const` bounds that are *not* conditional and thus always hold.
// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:268 evaluate_host_effect_from_item_bounds
function evaluate_host_effect_from_item_bounds(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const infcx = selcx.infcx;
  const tcx = infcx.tcx;
  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(selcx.tcx()));
  let candidate: Binder<HostEffectClause> | undefined = undefined;

  let consider_ty = HostEffectClause.self_ty(obligation.predicate);
  for (;;) {
    const ck = consider_ty.kind();
    if (!(ck.$ === "Alias" && (ck._1.kind.$ === "Projection" || ck._1.kind.$ === "Opaque"))) break;
    const alias_ty = ck._1;
    const kind = alias_ty.kind;
    const def_id = kind.def_id;

    // PORT: the `item_bounds` query value is typed `unknown` in queries.gen.ts.
    for (const c of EarlyBinder.iter_instantiated(tcx.item_bounds(def_id) as EarlyBinder<readonly Clause[]>, tcx, alias_ty.args, fold_Clause)) {
      const clause = Unnormalized.skip_norm_wip(c);
      const bound_clause = clause.kind();
      const k = Binder.skip_binder(bound_clause);
      if (k.$ !== "HostEffect") {
        continue;
      }
      const data = Binder.rebind(bound_clause, k._0);
      if (!DefId_eq_(Binder.skip_binder(data).trait_ref.def_id, obligation.predicate.trait_ref.def_id)) {
        continue;
      }

      if (!drcx.args_may_unify(obligation.predicate.trait_ref.args, Binder.skip_binder(data).trait_ref.args)) {
        continue;
      }

      const is_match = infcx.probe((_) => match_candidate(selcx, obligation, data, true, () => {}).$ === "Ok");

      if (is_match) {
        if (candidate !== undefined) {
          return Err(EvaluationFailure.Ambiguous);
        } else {
          candidate = data;
        }
      }
    }

    if (kind.$ !== "Projection") {
      break;
    }

    consider_ty = AliasTy_self_ty(alias_ty);
  }

  if (candidate !== undefined) {
    const data = candidate;
    return Ok(expect(match_candidate(selcx, obligation, data, true, () => {}), "candidate matched before, so it should match again"));
  } else {
    return Err(EvaluationFailure.NoSolution);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:334 evaluate_host_effect_from_builtin_impls
function evaluate_host_effect_from_builtin_impls(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const li = selcx.tcx().as_lang_item(HostEffectClause.def_id(obligation.predicate));
  if (li === LangItem.Copy || li === LangItem.Clone) {
    return evaluate_host_effect_for_copy_clone_goal(selcx, obligation);
  } else if (li === LangItem.Destruct) {
    return evaluate_host_effect_for_destruct_goal(selcx, obligation);
  } else if (li === LangItem.Fn || li === LangItem.FnMut || li === LangItem.FnOnce) {
    return evaluate_host_effect_for_fn_goal(selcx, obligation);
  } else {
    return Err(EvaluationFailure.NoSolution);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:350 evaluate_host_effect_for_copy_clone_goal
function evaluate_host_effect_for_copy_clone_goal(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const tcx = selcx.tcx();
  const self_ty = HostEffectClause.self_ty(obligation.predicate);
  const k = self_ty.kind();
  let r: Result<Binder<Ty[]>, EvaluationFailure>;
  switch (k.$) {
    // impl Copy/Clone for FnDef, FnPtr
    case "FnDef":
    case "FnPtr":
    case "Error":
      r = Ok(Binder.dummy<Ty[]>([], d_Vec_Ty));
      break;

    // Implementations are provided in core
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      r = Err(EvaluationFailure.NoSolution);
      break;
    case "Ref":
      if (k._2 === "Not") {
        r = Err(EvaluationFailure.NoSolution);
      } else {
        r = Err(EvaluationFailure.NoSolution);
      }
      break;

    // Cannot implement in core, as we can't be generic over patterns yet,
    // so we'd have to list all patterns and type combinations.
    case "Pat": {
      const ty = k._0;
      r = Ok(Binder.dummy([ty], d_Vec_Ty));
      break;
    }

    case "Dynamic":
    case "Str":
    case "Slice":
    case "Foreign":
    case "Adt":
    case "Alias":
    case "Param":
    case "Placeholder":
      r = Err(EvaluationFailure.NoSolution);
      break;

    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        // Implementations are provided in core
        r = Err(EvaluationFailure.NoSolution);
        break;
      }
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);

    // impl Copy/Clone for (T1, T2, .., Tn) where T1: Copy/Clone, T2: Copy/Clone, .. Tn: Copy/Clone
    case "Tuple": {
      const tys = k._0;
      r = Ok(Binder.dummy([...tys], d_Vec_Ty));
      break;
    }

    // impl Copy/Clone for Closure where Self::TupledUpvars: Copy/Clone
    case "Closure": {
      const args = k._1;
      r = Ok(Binder.dummy([ClosureArgs.tupled_upvars_ty(args.as_closure())], d_Vec_Ty));
      break;
    }

    // impl Copy/Clone for CoroutineClosure where Self::TupledUpvars: Copy/Clone
    case "CoroutineClosure": {
      const args = k._1;
      r = Ok(Binder.dummy([CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure())], d_Vec_Ty));
      break;
    }

    // only when `coroutine_clone` is enabled and the coroutine is movable
    // impl Copy/Clone for Coroutine where T: Copy/Clone forall T in (upvars, witnesses)
    case "Coroutine": {
      const def_id = k._0;
      const args = k._1;
      if (selcx.should_stall_coroutine(def_id)) {
        return Err(EvaluationFailure.Ambiguous);
      }
      switch (tcx.coroutine_movability(def_id)) {
        case "Static":
          r = Err(EvaluationFailure.NoSolution);
          break;
        case "Movable":
          if (tcx.features().coroutine_clone()) {
            r = Ok(Binder.dummy([CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), Ty.new_coroutine_witness_for_coroutine(tcx, def_id, args)], d_Vec_Ty));
          } else {
            r = Err(EvaluationFailure.NoSolution);
          }
          break;
      }
      break;
    }

    case "UnsafeBinder":
      r = Err(EvaluationFailure.NoSolution);
      break;

    // impl Copy/Clone for CoroutineWitness where T: Copy/Clone forall T in coroutine_hidden_types
    case "CoroutineWitness": {
      const def_id = k._0;
      const args = k._1;
      r = Ok(
        Binder.map_bound(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(
              tcx.coroutine_hidden_types(def_id) as EarlyBinder<Binder<CoroutineWitnessTypes>>,
              tcx,
              args,
              d_CoroutineWitnessTypes(),
            ),
          ),
          (bound) => [...bound.types],
        ),
      );
      break;
    }
  }
  if (r.$ === "Err") return r;
  const constituent_tys = r._0;

  return Ok(
    [...Binder.iter<Ty>(constituent_tys)].map((ty) =>
      obligation.with(
        tcx,
        PolyTraitRef.to_host_effect_clause(
          Binder.map_bound(ty, (ty: Ty) => TraitRef.new(as_interner(tcx), HostEffectClause.def_id(obligation.predicate), [ty])),
          tcx,
          obligation.predicate.constness,
        ),
        upcast_Clause,
      ),
    ),
  );
}

// NOTE: Keep this in sync with `const_conditions_for_destruct` in the new solver.
// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:446 evaluate_host_effect_for_destruct_goal
function evaluate_host_effect_for_destruct_goal(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const tcx = selcx.tcx();
  const destruct_def_id = tcx.require_lang_item(LangItem.Destruct, obligation.cause.span);
  const self_ty = HostEffectClause.self_ty(obligation.predicate);

  const k = self_ty.kind();
  let const_conditions: TraitRef[];
  switch (k.$) {
    case "Adt": {
      const adt_def = k._0;
      const args = k._1;
      // `ManuallyDrop` is trivially `[const] Destruct` as we do not run any drop glue on it.
      if (adt_def.is_manually_drop()) {
        const_conditions = [];
        break;
      }

      // An ADT is `[const] Destruct` only if all of the fields are,
      // *and* if there is a `Drop` impl, that `Drop` impl is also `[const]`.
      const cc: TraitRef[] = [...adt_def.all_fields()].map((field) => TraitRef.new(as_interner(tcx), destruct_def_id, [Unnormalized.skip_norm_wip(field.ty(tcx, args))]));
      const dtor = adt_def.destructor(tcx);
      // PORT: the `constness` query value is typed `unknown` in queries.gen.ts.
      const c = dtor === undefined ? undefined : (tcx.constness(dtor.did) as Constness);
      if (c !== undefined && c.$ === "Const" && c.always) {
        return panic("not implemented: FIXME(comptime)");
      } else if (c !== undefined && c.$ === "NotConst") {
        // `Drop` impl exists, but it's not const. Type cannot be `[const] Destruct`.
        return Err(EvaluationFailure.NoSolution);
      } else if (c !== undefined && c.$ === "Const" && !c.always) {
        // `Drop` impl exists, and it's const. Require `Ty: [const] Drop` to hold.
        const drop_def_id = tcx.require_lang_item(LangItem.Drop, obligation.cause.span);
        const drop_trait_ref = TraitRef.new(as_interner(tcx), drop_def_id, [self_ty]);
        cc.push(drop_trait_ref);
      } else {
        // No `Drop` impl, no need to require anything else.
      }
      const_conditions = cc;
      break;
    }

    case "Array":
    case "Pat":
    case "Slice": {
      const ty = k._0;
      const_conditions = [TraitRef.new(as_interner(tcx), destruct_def_id, [ty])];
      break;
    }

    case "Tuple": {
      const tys = k._0;
      const_conditions = [...tys].map((field_ty) => TraitRef.new(as_interner(tcx), destruct_def_id, [field_ty]));
      break;
    }

    // Trivially implement `[const] Destruct`
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Never":
    case "Error":
      const_conditions = [];
      break;

    // Closures are [const] Destruct when all of their upvars (captures) are [const] Destruct.
    case "Closure": {
      const args = k._1;
      const closure_args = args.as_closure();
      const_conditions = [TraitRef.new(as_interner(tcx), destruct_def_id, [ClosureArgs.tupled_upvars_ty(closure_args)])];
      break;
    }

    // Coroutines could implement `[const] Drop`,
    // but they don't really need to right now.
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
      return Err(EvaluationFailure.NoSolution);

    // FIXME(unsafe_binders): Unsafe binders could implement `[const] Drop`
    // if their inner type implements it.
    case "UnsafeBinder":
      return Err(EvaluationFailure.NoSolution);

    case "Dynamic":
    case "Param":
    case "Alias":
    case "Placeholder":
    case "Foreign":
      return Err(EvaluationFailure.NoSolution);

    case "Infer":
      if (k._0.$ === "FloatVar" || k._0.$ === "IntVar") {
        // Trivially implement `[const] Destruct`
        const_conditions = [];
        break;
      }
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
  }

  return Ok(
    const_conditions.map((trait_ref) =>
      obligation.with(tcx, PolyTraitRef.to_host_effect_clause(Binder.dummy(trait_ref, d_TraitRef), tcx, obligation.predicate.constness), upcast_Clause),
    ),
  );
}

// NOTE: Keep this in sync with `extract_fn_def_from_const_callable` in the new solver.
// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:545 evaluate_host_effect_for_fn_goal
function evaluate_host_effect_for_fn_goal(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const tcx = selcx.tcx();
  const self_ty = HostEffectClause.self_ty(obligation.predicate);

  const k = self_ty.kind();
  let def: DefId;
  let args: Binder<import("../../rustc_middle/ty/generic_args.ts").GenericArgs>;
  switch (k.$) {
    case "FnDef":
      def = k._0;
      args = k._1;
      break;

    // We may support function pointers at some point in the future
    case "FnPtr":
      return Err(EvaluationFailure.NoSolution);

    // Coroutines could implement `[const] Fn`,
    // but they don't really need to right now.
    case "CoroutineClosure":
      return Err(EvaluationFailure.NoSolution);

    case "Closure":
      def = k._0;
      args = Binder.dummy(k._1, fold_GenericArgs());
      break;

    // Everything else needs explicit impls or cannot have an impl
    default:
      return Err(EvaluationFailure.NoSolution);
  }

  // PORT: the `constness` query value is typed `unknown` in queries.gen.ts.
  const constness = tcx.constness(def) as Constness;
  if (constness.$ === "Const" && constness.always) {
    // FIXME(comptime)
    return Err(EvaluationFailure.NoSolution);
  } else if (constness.$ === "Const" && !constness.always) {
    // PORT: the `const_conditions` query value is typed `unknown` in queries.gen.ts.
    return Ok(
      ConstConditions.instantiate(tcx.const_conditions(def) as ConstConditionsT, tcx, unwrap_(Binder.no_bound_vars(args, fold_GenericArgs()))).map(([c, span]) => {
        const code: ObligationCauseCode = { $: "WhereClause", _0: def, _1: span };
        const cause = ObligationCause.new(obligation.cause.span, obligation.cause.body_def_id, code);
        return Obligation.new(
          tcx,
          cause,
          obligation.param_env,
          Unnormalized.skip_norm_wip(Unnormalized.map(c, (c) => PolyTraitRef.to_host_effect_clause(c, tcx, obligation.predicate.constness))),
          upcast_Clause,
        );
      }),
    );
  } else {
    return Err(EvaluationFailure.NoSolution);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:591 evaluate_host_effect_from_selection_candidate
function evaluate_host_effect_from_selection_candidate(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const tcx = selcx.tcx();
  return selcx.infcx.commit_if_ok<PredicateObligation[], EvaluationFailure>((_) => {
    const s = selcx.select(obligation.with(tcx, obligation.predicate.trait_ref, TraitClause.upcast_from_TraitRef));
    if (s.$ === "Ok" && s._0 === undefined) {
      return Err(EvaluationFailure.Ambiguous);
    } else if (s.$ === "Err") {
      return Err(EvaluationFailure.NoSolution);
    } else {
      const source = s._0!;
      if (source.$ === "UserDefined") {
        const impl_ = source._0;
        // PORT: the `impl_trait_header` query value is typed `unknown` in queries.gen.ts.
        const constness = (tcx.impl_trait_header(impl_.impl_def_id) as ImplTraitHeader).constness;
        if (constness.$ === "Const") {
          const always = constness.always;
          if (always) {
            // FIXME(comptime): just bailing for now to avoid an ICE in a test.
            return Err(EvaluationFailure.NoSolution);
          }
        } else {
          return Err(EvaluationFailure.NoSolution);
        }

        const nested = impl_.nested;
        nested.push(
          ...ConstConditions.instantiate(tcx.const_conditions(impl_.impl_def_id) as ConstConditionsT, tcx, impl_.args).map(([trait_ref, span]) =>
            Obligation.new(
              tcx,
              clone_ObligationCause(obligation.cause).derived_host_cause(Binder.dummy(obligation.predicate, d_HostEffectClause), (derived) => ({
                $: "ImplDerivedHost",
                _0: {
                  derived,
                  impl_def_id: impl_.impl_def_id,
                  span,
                },
              })),
              obligation.param_env,
              Unnormalized.skip_norm_wip(Unnormalized.map(trait_ref, (trait_ref) => PolyTraitRef.to_host_effect_clause(trait_ref, tcx, obligation.predicate.constness))),
              upcast_Clause,
            ),
          ),
        );

        return Ok(nested);
      } else {
        return Err(EvaluationFailure.NoSolution);
      }
    }
  });
}

// rustc: compiler/rustc_trait_selection/src/traits/effects.rs:650 evaluate_host_effect_from_trait_alias
function evaluate_host_effect_from_trait_alias(selcx: SelectionContext, obligation: HostEffectObligation): Result<PredicateObligation[], EvaluationFailure> {
  const tcx = selcx.tcx();
  const def_id = HostEffectClause.def_id(obligation.predicate);
  if (!tcx.trait_is_alias(def_id)) {
    return Err(EvaluationFailure.NoSolution);
  }

  return Ok(
    ConstConditions.instantiate(tcx.const_conditions(def_id) as ConstConditionsT, tcx, obligation.predicate.trait_ref.args).map(([trait_ref, span]) =>
      Obligation.new(
        tcx,
        clone_ObligationCause(obligation.cause).derived_host_cause(Binder.dummy(obligation.predicate, d_HostEffectClause), (derived) => ({
          $: "ImplDerivedHost",
          _0: {
            derived,
            impl_def_id: def_id,
            span,
          },
        })),
        obligation.param_env,
        Unnormalized.skip_norm_wip(Unnormalized.map(trait_ref, (trait_ref) => PolyTraitRef.to_host_effect_clause(trait_ref, tcx, obligation.predicate.constness))),
        upcast_Clause,
      ),
    ),
  );
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

type Span = import("../../rustc_span/lib.ts").Span;
type AliasTy = import("../../rustc_type_ir/ty/alias.ts").AliasTy;
type CoroutineWitnessTypes = import("../../rustc_type_ir/ty_kind.gen.ts").CoroutineWitnessTypes;

/** The unit struct `NoSolution`. */
const NO_SOLUTION: NoSolution = Object.freeze({});

/** `Vec<Ty>: TypeFoldable` (`Binder::dummy(vec![..])`). */
const d_Vec_Ty = fold_Vec(fold_Ty) as TypeFoldable<Ty[]>;

function DefId_eq_(a: DefId, b: DefId): boolean {
  return (require("../../rustc_span/def_id.ts") as typeof import("../../rustc_span/def_id.ts")).DefId_eq(a, b);
}

/** `AliasTy::self_ty` (rustc_type_ir ty/alias.rs). */
function AliasTy_self_ty(alias_ty: AliasTy): Ty {
  const { AliasTy } = require("../../rustc_type_ir/ty_kind.ts") as typeof import("../../rustc_type_ir/ty_kind.ts");
  return AliasTy.self_ty(alias_ty);
}

/** `(PolyTraitRef, Span): TypeFoldable` (`Span` is trivially traversable). */
function d_PolyTraitRef_Span(): TypeFoldable<readonly [Binder<TraitRef>, Span]> {
  const { fold_tuple2 } = require("../../rustc_type_ir/fold.ts") as typeof import("../../rustc_type_ir/fold.ts");
  const { fold_Span } = require("../../rustc_middle/ty/structural_impls.ts") as typeof import("../../rustc_middle/ty/structural_impls.ts");
  return fold_tuple2(fold_Binder(d_TraitRef), fold_Span) as unknown as TypeFoldable<readonly [Binder<TraitRef>, Span]>;
}

function fold_GenericArgs(): TypeFoldable<import("../../rustc_middle/ty/generic_args.ts").GenericArgs> {
  return (require("../../rustc_middle/ty/generic_args.ts") as typeof import("../../rustc_middle/ty/generic_args.ts")).fold_GenericArgs;
}

/** `Binder<CoroutineWitnessTypes>: TypeFoldable` (the `coroutine_hidden_types` query value). */
function d_CoroutineWitnessTypes(): TypeFoldable<Binder<CoroutineWitnessTypes>> {
  const m = require("../../rustc_type_ir/ty_kind.gen.ts") as typeof import("../../rustc_type_ir/ty_kind.gen.ts");
  return fold_Binder<CoroutineWitnessTypes>({
    visit_with: m.visit_with_CoroutineWitnessTypes,
    try_fold_with: m.try_fold_with_CoroutineWitnessTypes,
    fold_with: m.fold_with_CoroutineWitnessTypes,
  });
}

/** `Result::expect` on an `Err(NoSolution)`. */
function expect<T>(r: Result<T, NoSolution>, msg: string): T {
  if (r.$ === "Ok") return r._0;
  return panic(`${msg}: NoSolution`);
}

/** `Option::unwrap`. */
function unwrap_<T>(v: T | undefined): T {
  if (v === undefined) return panic("called `Option::unwrap()` on a `None` value");
  return v;
}

/** `unreachable!(msg)`. */
function unreachable_(msg: string): never {
  return panic(`internal error: entered unreachable code: ${msg}`);
}

// ---- PORT(merge) stand-ins for items of other files / lanes that are not ported yet ---------------------------------

/** PORT(merge): the `SelectionContext` members used here (traits/select/mod.rs, wave 20 selcx-contract). */
export interface SelectionContext {
  infcx: InferCtxt;
  typing_mode(): TypingMode;
  tcx(): TyCtxt;
  should_stall_coroutine(def_id: DefId): boolean;
  select(obligation: Obligation<TraitClause>): Result<ImplSource<PredicateObligation> | undefined, SelectionError>;
}

/** PORT(merge): stand-in for `traits::normalize::normalize_with_depth_to` (traits/normalize.rs, lane trait-sel-traits-a). */
function normalize_with_depth_to<T>(
  _selcx: SelectionContext,
  _param_env: import("../../rustc_middle/ty/mod.ts").ParamEnv,
  _cause: ObligationCause,
  _depth: number,
  _value: Unnormalized<T>,
  _obligations: PredicateObligation[],
  _d_T: TypeFoldable<T>,
): T {
  return unported("rustc_trait_selection::traits::normalize::normalize_with_depth_to");
}
