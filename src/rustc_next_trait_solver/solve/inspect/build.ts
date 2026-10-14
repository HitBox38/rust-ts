//! Building proof trees incrementally during trait solving.
//!
//! This code is *a bit* of a mess and can hopefully be
//! mostly ignored. For a general overview of how it works,
//! see the comment on [ProofTreeBuilder].
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/inspect/build.rs (lane evalctxt-contract; the file
// belongs to lane nts-eval). The types are final; their methods are stubs with final signatures: fill each in place and
// add the `// rustc:` marker. Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `ProofTreeBuilder<D>` / `EvaluationStepBuilder<D>`: `D` is erased and so is `_infcx: PhantomData<D>`; their
// constructors take the remaining field. `ProofTreeBuilder::state: Option<Box<Option<inspect::Probe<I>>>>` is
// `MutRef<Probe | undefined> | undefined`: the `Box` is the mutable cell (`state.as_deref_mut()` is the cell itself).
// `EvaluationStepBuilder::state: Option<Box<WipEvaluationStep<I>>>` is `WipEvaluationStep | undefined`.
// PORT: `WipProbeStep::finalize` is on the companion (PORTING §8). The derived `PartialEq` of `WipEvaluationStep`,
// `WipProbe` and `WipProbeStep` is not ported (nothing compares them); their derived Debug is below.
import { debug_GenericArg } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_GenericArgs, type GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Canonical } from "../../../rustc_type_ir/canonical.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/decls.ts";
import {
  type CanonicalState,
  debug_ProbeKind,
  debug_State,
  type Probe,
  type ProbeKind,
  type ProbeStep,
} from "../../../rustc_type_ir/solve/inspect.ts";
import type { Certainty, Goal, GoalSource, QueryResult } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_Certainty, debug_Goal, debug_GoalSource } from "../../../rustc_type_ir/solve/mod.gen.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { unported } from "../../../std/panic.ts";
import type { SolverDelegate } from "../../delegate.ts";

/// We need to know whether to build a prove tree while evaluating. We
/// pass a `ProofTreeBuilder` with `state: Some(None)` into the search
/// graph which then causes the initial `EvalCtxt::compute_goal` to actually
/// build a proof tree which then gets written into the `state`.
///
/// Building the proof tree for a single evaluation step happens via the
/// [EvaluationStepBuilder] which is updated by the `EvalCtxt` when
/// appropriate.
export class ProofTreeBuilder {
  constructor(public state: MutRef<Probe | undefined> | undefined) {}

  static new(): ProofTreeBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::new");
  }

  static new_noop(): ProofTreeBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::new_noop");
  }

  is_noop(): boolean {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::is_noop");
  }

  new_evaluation_step(_var_values: GenericArgs): EvaluationStepBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::new_evaluation_step");
  }

  finish_evaluation_step(_goal_evaluation_step: EvaluationStepBuilder): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::finish_evaluation_step");
  }

  unwrap(): Probe {
    return unported("rustc_next_trait_solver::solve::inspect::build::ProofTreeBuilder::unwrap");
  }
}

export class EvaluationStepBuilder {
  constructor(public state: WipEvaluationStep | undefined) {}

  static new_noop(): EvaluationStepBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::new_noop");
  }

  is_noop(): boolean {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::is_noop");
  }

  as_mut(): WipEvaluationStep | undefined {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::as_mut");
  }

  take_and_enter_probe(): EvaluationStepBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::take_and_enter_probe");
  }

  // PORT: `T: Into<I::GenericArg>`: every such `T` is already a `GenericArg` (`Ty | Region | Const`).
  add_var_value(_arg: GenericArg): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::add_var_value");
  }

  enter_probe(): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::enter_probe");
  }

  probe_kind(_probe_kind: ProbeKind): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::probe_kind");
  }

  probe_final_state(_delegate: SolverDelegate, _max_input_universe: UniverseIndex): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::probe_final_state");
  }

  add_goal(_delegate: SolverDelegate, _max_input_universe: UniverseIndex, _source: GoalSource, _goal: Goal<Predicate>): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::add_goal");
  }

  record_impl_args(_delegate: SolverDelegate, _max_input_universe: UniverseIndex, _impl_args: GenericArgs): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::record_impl_args");
  }

  make_canonical_response(_shallow_certainty: Certainty): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::make_canonical_response");
  }

  finish_probe(): EvaluationStepBuilder {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::finish_probe");
  }

  query_result(_result: QueryResult): void {
    return unported("rustc_next_trait_solver::solve::inspect::build::EvaluationStepBuilder::query_result");
  }
}

// PORT: `#[derive_where(PartialEq, Eq, Debug; I: Interner)]` (header).
export class WipEvaluationStep {
  constructor(
    /// Unlike `EvalCtxt::var_values`, we append a new
    /// generic arg here whenever we create a new inference
    /// variable.
    ///
    /// This is necessary as we otherwise don't unify these
    /// vars when instantiating multiple `CanonicalState`.
    public var_values: GenericArg[],
    public probe_depth: number,
    public evaluation: WipProbe,
  ) {}

  current_evaluation_scope(): WipProbe {
    return unported("rustc_next_trait_solver::solve::inspect::build::WipEvaluationStep::current_evaluation_scope");
  }

  finalize(): Probe {
    return unported("rustc_next_trait_solver::solve::inspect::build::WipEvaluationStep::finalize");
  }
}
export const debug_WipEvaluationStep: Debug<WipEvaluationStep> = (v, f) =>
  debug_struct(f, "WipEvaluationStep", [
    ["var_values", debug_vec(v.var_values, f, debug_GenericArg)],
    ["probe_depth", debug_int(v.probe_depth, f)],
    ["evaluation", debug_WipProbe(v.evaluation, f)],
  ]);

// PORT: `#[derive_where(PartialEq, Debug; I: Interner)]` (+ `impl Eq`) (header).
export class WipProbe {
  constructor(
    public initial_num_var_values: number,
    public steps: WipProbeStep[],
    public kind: ProbeKind | undefined,
    public final_state: CanonicalState<null> | undefined,
  ) {}

  finalize(): Probe {
    return unported("rustc_next_trait_solver::solve::inspect::build::WipProbe::finalize");
  }
}
export function debug_WipProbe(v: WipProbe, f: Fmt): string {
  return debug_struct(f, "WipProbe", [
    ["initial_num_var_values", debug_int(v.initial_num_var_values, f)],
    ["steps", debug_vec(v.steps, f, debug_WipProbeStep)],
    ["kind", debug_option(v.kind, f, debug_ProbeKind)],
    ["final_state", debug_option(v.final_state, f, debug_CanonicalState_unit)],
  ]);
}

// PORT: `#[derive_where(PartialEq, Debug; I: Interner)]` (+ `impl Eq`) (header).
export type WipProbeStep =
  | { readonly $: "AddGoal"; readonly _0: GoalSource; readonly _1: CanonicalState<Goal<Predicate>> }
  | { readonly $: "NestedProbe"; readonly _0: WipProbe }
  | { readonly $: "MakeCanonicalResponse"; readonly shallow_certainty: Certainty }
  | { readonly $: "RecordImplArgs"; readonly impl_args: CanonicalState<GenericArgs> };
export const WipProbeStep = {
  finalize(_self: WipProbeStep): ProbeStep {
    return unported("rustc_next_trait_solver::solve::inspect::build::WipProbeStep::finalize");
  },
} as const;
export function debug_WipProbeStep(v: WipProbeStep, f: Fmt): string {
  switch (v.$) {
    case "AddGoal":
      return debug_tuple(f, "AddGoal", [
        debug_GoalSource(v._0, f),
        debug_Canonical(v._1, f, (s, f2) => debug_State(s, f2, (g, f3) => debug_Goal(g, f3, debug_Predicate))),
      ]);
    case "NestedProbe":
      return debug_tuple(f, "NestedProbe", [debug_WipProbe(v._0, f)]);
    case "MakeCanonicalResponse":
      return debug_struct(f, "MakeCanonicalResponse", [["shallow_certainty", debug_Certainty(v.shallow_certainty, f)]]);
    case "RecordImplArgs":
      return debug_struct(f, "RecordImplArgs", [
        ["impl_args", debug_Canonical(v.impl_args, f, (s, f2) => debug_State(s, f2, debug_GenericArgs))],
      ]);
  }
}

/** `{:?}` of `inspect::CanonicalState<I, ()>` (`()` prints `()`). */
function debug_CanonicalState_unit(v: CanonicalState<null>, f: Fmt): string {
  return debug_Canonical(v, f, (s, f2) => debug_State(s, f2, () => "()"));
}
