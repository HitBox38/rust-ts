//! Building proof trees incrementally during trait solving.
//!
//! This code is *a bit* of a mess and can hopefully be
//! mostly ignored. For a general overview of how it works,
//! see the comment on [ProofTreeBuilder].
//
// Port of compiler/rustc_next_trait_solver/src/solve/inspect/build.rs (lane nts-canonical; the contract stub was lane
// evalctxt-contract's). Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `ProofTreeBuilder<D>` / `EvaluationStepBuilder<D>`: `D` is erased and so is `_infcx: PhantomData<D>`; their
// constructors take the remaining field. `ProofTreeBuilder::state: Option<Box<Option<inspect::Probe<I>>>>` is
// `MutRef<Probe | undefined> | undefined`: the `Box` is the mutable cell (`state.as_deref_mut()` is the cell itself).
// `EvaluationStepBuilder::state: Option<Box<WipEvaluationStep<I>>>` is `WipEvaluationStep | undefined`.
// PORT: `WipProbeStep::finalize` is on the companion (PORTING §8). The derived `PartialEq` of `WipEvaluationStep`,
// `WipProbe` and `WipProbeStep` is not ported (nothing compares them); their derived Debug is below.
import { debug_GenericArg, fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_GenericArgs, fold_GenericArgs, type GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Canonical } from "../../../rustc_type_ir/canonical.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "../../../rustc_type_ir/macros.ts";
import {
  type CanonicalState,
  debug_Probe,
  debug_ProbeKind,
  debug_State,
  type Probe,
  type ProbeKind,
  type ProbeStep,
} from "../../../rustc_type_ir/solve/inspect.ts";
import type { Certainty, Goal, GoalSource, QueryResult } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_Certainty, debug_Goal, debug_GoalSource, fold_with_Goal, try_fold_with_Goal, visit_with_Goal } from "../../../rustc_type_ir/solve/mod.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../../std/panic.ts";
import { make_canonical_state } from "../../canonical/mod.ts";
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

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:35 new
  static new(): ProofTreeBuilder {
    return new ProofTreeBuilder({ value: undefined });
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:39 new_noop
  static new_noop(): ProofTreeBuilder {
    return new ProofTreeBuilder(undefined);
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:43 is_noop
  is_noop(): boolean {
    return this.state === undefined;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:47 new_evaluation_step
  new_evaluation_step(var_values: GenericArgs): EvaluationStepBuilder {
    if (this.is_noop()) {
      return new EvaluationStepBuilder(undefined);
    } else {
      return new EvaluationStepBuilder(
        new WipEvaluationStep(
          [...var_values],
          0,
          new WipProbe(var_values.length, [], undefined, undefined),
        ),
      );
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:70 finish_evaluation_step
  finish_evaluation_step(goal_evaluation_step: EvaluationStepBuilder): void {
    const this_ = this.state;
    if (this_ !== undefined) {
      this_.value = unwrap(goal_evaluation_step.state).finalize();
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:79 unwrap
  unwrap(): Probe {
    return unwrap(unwrap(this.state).value);
  }
}

export class EvaluationStepBuilder {
  constructor(public state: WipEvaluationStep | undefined) {}

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:173 new_noop
  static new_noop(): EvaluationStepBuilder {
    return new EvaluationStepBuilder(undefined);
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:177 is_noop
  is_noop(): boolean {
    return this.state === undefined;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:181 as_mut
  as_mut(): WipEvaluationStep | undefined {
    return this.state;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:185 take_and_enter_probe
  take_and_enter_probe(): EvaluationStepBuilder {
    const state = this.state;
    this.state = undefined;
    const nested = new EvaluationStepBuilder(state);
    nested.enter_probe();
    return nested;
  }

  // PORT: `T: Into<I::GenericArg>`: every such `T` is already a `GenericArg` (`Ty | Region | Const`).
  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:191 add_var_value
  add_var_value(arg: GenericArg): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      this_.var_values.push(arg);
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:197 enter_probe
  enter_probe(): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const initial_num_var_values = this_.var_values.length;
      this_
        .current_evaluation_scope()
        .steps.push({ $: "NestedProbe", _0: new WipProbe(initial_num_var_values, [], undefined, undefined) });
      this_.probe_depth += 1;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:210 probe_kind
  probe_kind(probe_kind: ProbeKind): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const scope = this_.current_evaluation_scope();
      const prev = scope.kind;
      scope.kind = probe_kind;
      assert_eq(prev, undefined, (v) => debug_option(v, PLAIN, debug_ProbeKind));
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:217 probe_final_state
  probe_final_state(delegate: SolverDelegate, max_input_universe: UniverseIndex): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const final_state = make_canonical_state(delegate, this_.var_values, max_input_universe, null, fold_unit);
      const scope = this_.current_evaluation_scope();
      const prev = scope.final_state;
      scope.final_state = final_state;
      assert_eq(prev, undefined, (v) => debug_option(v, PLAIN, debug_CanonicalState_unit));
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:230 add_goal
  add_goal(delegate: SolverDelegate, max_input_universe: UniverseIndex, source: GoalSource, goal: Goal<Predicate>): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const goal_ = make_canonical_state(delegate, this_.var_values, max_input_universe, goal, fold_Goal_Predicate);
      this_.current_evaluation_scope().steps.push({ $: "AddGoal", _0: source, _1: goal_ });
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:248 record_impl_args
  record_impl_args(delegate: SolverDelegate, max_input_universe: UniverseIndex, impl_args: GenericArgs): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const impl_args_ = make_canonical_state(delegate, this_.var_values, max_input_universe, impl_args, fold_GenericArgs);
      this_.current_evaluation_scope().steps.push({ $: "RecordImplArgs", impl_args: impl_args_ });
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:265 make_canonical_response
  make_canonical_response(shallow_certainty: Certainty): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      this_.current_evaluation_scope().steps.push({ $: "MakeCanonicalResponse", shallow_certainty });
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:273 finish_probe
  finish_probe(): EvaluationStepBuilder {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      if (this_.probe_depth === 0) {
        panic(`assertion \`left != right\` failed\n  left: ${this_.probe_depth}\n right: 0`);
      }
      const num_var_values = this_.current_evaluation_scope().initial_num_var_values;
      if (num_var_values < this_.var_values.length) {
        this_.var_values.length = num_var_values;
      }
      this_.probe_depth -= 1;
    }

    return this;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:284 query_result
  query_result(result: QueryResult): void {
    const this_ = this.as_mut();
    if (this_ !== undefined) {
      const prev = this_.evaluation.kind;
      this_.evaluation.kind = { $: "Root", result };
      assert_eq(prev, undefined, (v) => debug_option(v, PLAIN, debug_ProbeKind));
    }
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

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:107 current_evaluation_scope
  current_evaluation_scope(): WipProbe {
    let current = this.evaluation;
    for (let i = 0; i < this.probe_depth; i++) {
      const last = current.steps.length > 0 ? current.steps[current.steps.length - 1] : undefined;
      if (last !== undefined && last.$ === "NestedProbe") {
        current = last._0;
      } else {
        panic();
      }
    }
    return current;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:118 finalize
  finalize(): Probe {
    const evaluation = this.evaluation.finalize();
    if (evaluation.kind.$ === "Root") {
      return evaluation;
    } else {
      return unreachable(`internal error: entered unreachable code: unexpected root evaluation: ${debug_Probe(evaluation, PLAIN)}`);
    }
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

  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:138 finalize
  finalize(): Probe {
    return {
      steps: this.steps.map((step) => WipProbeStep.finalize(step)),
      kind: unwrap(this.kind),
      final_state: unwrap(this.final_state),
    };
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
  // rustc: compiler/rustc_next_trait_solver/src/solve/inspect/build.rs:158 finalize
  finalize(self: WipProbeStep): ProbeStep {
    switch (self.$) {
      case "AddGoal":
        return { $: "AddGoal", _0: self._0, _1: self._1 };
      case "NestedProbe":
        return { $: "NestedProbe", _0: self._0.finalize() };
      case "RecordImplArgs":
        return { $: "RecordImplArgs", impl_args: self.impl_args };
      case "MakeCanonicalResponse":
        return { $: "MakeCanonicalResponse", shallow_certainty: self.shallow_certainty };
    }
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

// ---- D4 descriptors of the traversed types (fold.ts header) ---------------------------------------------------------

/** `()` (trivially traversable). */
const fold_unit: TypeFoldable<null> = {
  visit_with: visit_with_trivial,
  try_fold_with: try_fold_with_trivial,
  fold_with: fold_with_trivial,
};

/** `Goal<I, I::Predicate>` (derived traversal, rustc_type_ir solve/mod.gen.ts). */
const fold_Goal_Predicate: TypeFoldable<Goal<Predicate>> = {
  visit_with: (self, visitor) => visit_with_Goal(self, visitor, fold_Predicate.visit_with),
  try_fold_with: (self, folder) => try_fold_with_Goal(self, folder, fold_Predicate.try_fold_with),
  fold_with: (self, folder) => fold_with_Goal(self, folder, fold_Predicate.fold_with),
};
