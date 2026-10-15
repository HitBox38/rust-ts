// Port of compiler/rustc_trait_selection/src/solve/select.rs (lane trait-sel-solve).
//
// Extension module (docs/handoff/infcx-contract.md "Init order"): `#[extension(pub trait InferCtxtSelectExt)]` is assigned
// onto `InferCtxt.prototype` (its declaration is in ../decls.ts); other modules of this crate are read inside fn bodies.

import { ControlFlow, type ControlFlow as ControlFlowT, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { InferCtxt } from "../../rustc_infer/decls.ts";
import { Obligation, type PolyTraitObligation, type PredicateObligation, type Selection } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause, type ImplSource, type SelectionResult } from "../../rustc_middle/traits/mod.ts";
import { type Predicate, Predicate_upcast_from_PolyTraitClause } from "../../rustc_middle/ty/predicate.ts";
import { solve } from "../../rustc_next_trait_solver/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import type { Certainty, NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { debug_ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import { Goal } from "../../rustc_type_ir/solve/mod.ts";
import { format_debug, PRETTY } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { Err, expect_result, Ok, type Result } from "../../std/result.ts";
import { type InspectCandidate, type InspectConfig, type InspectGoal, type ProofTreeVisitor, ProofTreeVisitor_provided } from "./inspect/analyse.ts";

// ---- #[extension(pub trait InferCtxtSelectExt<'tcx>)] impl InferCtxt ----

/// Do not use this directly. This is called from [`crate::traits::SelectionContext::poly_select`].
// rustc: compiler/rustc_trait_selection/src/solve/select.rs:19 select_in_new_trait_solver
InferCtxt.prototype.select_in_new_trait_solver = function (this: InferCtxt, obligation: PolyTraitObligation): SelectionResult<Selection> {
  assert(this.next_trait_solver(), "assertion failed: self.next_trait_solver()");

  const r = this.visit_proof_tree(
    Goal.new(as_interner(this.tcx), obligation.param_env, obligation.predicate, solve.upcast_fn(Predicate_upcast_from_PolyTraitClause)),
    new Select(obligation.cause.span),
  ) as ControlFlowT<SelectionResult<Selection>>;
  // `.break_value().unwrap()`
  return unwrap(r.$ === "Break" ? r._0 : undefined);
};

class Select implements ProofTreeVisitor<ControlFlowT<SelectionResult<Selection>>> {
  /** `type Result = ControlFlow<SelectionResult<'tcx, Selection<'tcx>>>;` */
  readonly Result = VisitorResult.ControlFlow<SelectionResult<Selection>>();

  constructor(public span_: Span) {}

  // rustc: compiler/rustc_trait_selection/src/solve/select.rs:41 span
  span(): Span {
    return this.span_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/select.rs:45 visit_goal
  visit_goal(goal: InspectGoal): ControlFlowT<SelectionResult<Selection>> {
    let candidates = goal.candidates();
    candidates = candidates.filter((cand) => cand.result().$ === "Ok");

    // No candidates -- not implemented.
    if (candidates.length === 0) {
      return ControlFlow.Break(Err({ $: "Unimplemented" }));
    }

    // One candidate, no need to winnow.
    if (candidates.length === 1) {
      return ControlFlow.Break(Ok(to_selection(this.span_, candidates[0]!)));
    }

    // Don't winnow until `Certainty::Yes` -- we don't need to winnow until
    // codegen, and only on the good path.
    if (unwrap_certainty(goal.result()).$ === "Maybe") {
      return ControlFlow.Break(Ok(undefined));
    }

    // We need to winnow. See comments on `candidate_should_be_dropped_in_favor_of`.
    let i = 0;
    while (i < candidates.length) {
      let should_drop_i = false;
      for (let j = 0; j < candidates.length; j++) {
        if (i !== j && candidate_should_be_dropped_in_favor_of(candidates[i]!, candidates[j]!)) {
          should_drop_i = true;
          break;
        }
      }
      if (should_drop_i) {
        // `candidates.swap_remove(i)`
        const last = candidates.pop()!;
        if (i < candidates.length) candidates[i] = last;
      } else {
        i += 1;
        if (i > 1) {
          return ControlFlow.Break(Ok(undefined));
        }
      }
    }

    return ControlFlow.Break(Ok(to_selection(this.span_, unwrap(candidates[0]))));
  }

  // (provided) ProofTreeVisitor methods this impl does not override.
  config(): InspectConfig {
    return ProofTreeVisitor_provided.config(this);
  }
  on_recursion_limit(): ControlFlowT<SelectionResult<Selection>> {
    return ProofTreeVisitor_provided.on_recursion_limit(this);
  }
}

/// This is a lot more limited than the old solver's equivalent method. This may lead to more `Ok(None)`
/// results when selecting traits in polymorphic contexts, but we should never rely on the lack of ambiguity,
/// and should always just gracefully fail here. We shouldn't rely on this incompleteness.
// rustc: compiler/rustc_trait_selection/src/solve/select.rs:91 candidate_should_be_dropped_in_favor_of
function candidate_should_be_dropped_in_favor_of(victim: InspectCandidate, other: InspectCandidate): boolean {
  // Don't winnow until `Certainty::Yes` -- we don't need to winnow until constant evaluation or
  // codegen.
  if (unwrap_certainty(other.result()).$ === "Maybe") {
    return false;
  }

  const vk = victim.kind();
  if (vk.$ !== "TraitCandidate") {
    return false;
  }
  const victim_source = vk.source;
  const ok = other.kind();
  if (ok.$ !== "TraitCandidate") {
    return false;
  }
  const other_source = ok.source;

  if (other_source.$ === "CoherenceUnknowable" || victim_source.$ === "CoherenceUnknowable") {
    return bug("should not have assembled a CoherenceUnknowable candidate");
  }

  // In the old trait solver, we arbitrarily choose lower vtable candidates
  // over higher ones.
  if (victim_source.$ === "BuiltinImpl" && victim_source._0.$ === "Object" && other_source.$ === "BuiltinImpl" && other_source._0.$ === "Object") {
    return victim_source._0._0 >= other_source._0._0;
  }
  if (
    victim_source.$ === "BuiltinImpl" &&
    victim_source._0.$ === "TraitUpcasting" &&
    other_source.$ === "BuiltinImpl" &&
    other_source._0.$ === "TraitUpcasting"
  ) {
    return victim_source._0._0 >= other_source._0._0;
  }
  // Prefer dyn candidates over non-dyn candidates. This is necessary to
  // handle the unsoundness between `impl<T: ?Sized> Any for T` and `dyn Any: Any`.
  if (
    (victim_source.$ === "Impl" || victim_source.$ === "ParamEnv" || victim_source.$ === "AliasBound") &&
    other_source.$ === "BuiltinImpl" &&
    other_source._0.$ === "Object"
  ) {
    return true;
  }

  // Prefer specializing candidates over specialized candidates.
  if (victim_source.$ === "Impl" && other_source.$ === "Impl") {
    return victim.goal().infcx().tcx.specializes([other_source._0, victim_source._0]);
  }

  // Prefer impl candidates over global where clause candidates. Unless `generic_const_args`
  // is enabled, we currently don't use an empty environment when resolving and evaluating
  // constants to lower them to patterns. If we don't drop where clause candidates here, we
  // can fail to select impl candidates (#162331).
  if (victim_source.$ === "ParamEnv" && victim_source._0 === "Global" && (other_source.$ === "Impl" || other_source.$ === "BuiltinImpl")) {
    return true;
  }

  return false;
}

// rustc: compiler/rustc_trait_selection/src/solve/select.rs:152 to_selection
function to_selection(span: Span, cand: InspectCandidate): Selection | undefined {
  if (cand.shallow_certainty().$ === "Maybe") {
    return undefined;
  }

  let nested: PredicateObligation[];
  const certainty: Certainty = expect_result(cand.result(), "expected positive result", () => "NoSolution");
  switch (certainty.$) {
    case "Yes":
      nested = [];
      break;
    case "Maybe":
      nested = cand
        .instantiate_nested_goals(span)
        .map((nested) =>
          Obligation.new(nested.infcx().tcx, ObligationCause.dummy_with_span(span), nested.goal().param_env, nested.goal().predicate, solve.upcast_fn(Predicate_identity)),
        );
      break;
  }

  const kind = cand.kind();
  switch (kind.$) {
    case "TraitCandidate": {
      const source = kind.source;
      switch (source.$) {
        case "Impl": {
          const impl_def_id = source._0;
          // FIXME: Remove this in favor of storing this in the tree
          // For impl candidates, we do the rematch manually to compute the args.
          return { $: "UserDefined", _0: { impl_def_id, args: cand.instantiate_impl_args(span), nested } } satisfies ImplSource<PredicateObligation>;
        }
        case "BuiltinImpl":
          return { $: "Builtin", _0: source._0, _1: nested };
        case "ParamEnv":
        case "AliasBound":
          return { $: "Param", _0: nested };
        case "CoherenceUnknowable":
          return span_bug(span, "didn't expect to select an unknowable candidate");
      }
    }
    // falls through (unreachable: every arm above returns)
    case "NormalizedSelfTyAssembly":
    case "UnsizeAssembly":
    case "ProjectionCompatibility":
    case "OpaqueTypeStorageLookup":
    case "Root":
    case "ShadowedEnvProbing":
    case "RigidAlias":
      return span_bug(span, `didn't expect to assemble trait candidate from ${format_debug(kind, debug_ProbeKind, PRETTY)}`);
  }
}

/** `Result::unwrap` on `Result<Certainty, NoSolution>` (`NoSolution`'s Debug is `NoSolution`). */
function unwrap_certainty(r: Result<Certainty, NoSolution>): Certainty {
  return expect_result(r, "called `Result::unwrap()` on an `Err` value", () => "NoSolution");
}

/** `impl Upcast<I, Predicate> for Predicate` (the reflexive `UpcastFrom` impl). */
function Predicate_identity(p: Predicate, _tcx: TyCtxt): Predicate {
  return p;
}
