// Lane nts-eval: unit tests of solve/eval_ctxt/{mod,fast_path,probe}.rs and solve/search_graph.rs with a fake
// `SolverDelegate` / `InferCtxtLike`. They check the upstream semantics of the root `EvalCtxt` (`enter_root` and its
// assertions), the `add_goal` -> `try_evaluate_added_goals` loop (fast paths, stalled goals, fixpoint overflow,
// tainting, rerun propagation) and probe nesting (nested goals, rollback, opaque-access merging, bailing).
//
// Real trait goals need canonicalization (nts-canonical) and the goal kinds (nts-assembly / nts-trait-goals /
// nts-normalizes): those cases are PENDING (docs/handoff/nts-eval.md).
//
// The proof-tree builder (solve/inspect/build.rs) is lane nts-canonical's and still a stub here: the tests install
// `EvaluationStepBuilder`'s *noop* behaviour (upstream `state: None`: every recording method does nothing,
// `take_and_enter_probe` returns another noop builder) for their duration and restore the stubs afterwards.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, GlobalCaches, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { ParamEnv } from "../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_PredicateKind } from "../rustc_middle/ty/predicate.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import type { TyVid } from "../rustc_type_ir/decls.ts";
import { PathKind } from "../rustc_type_ir/search_graph/mod.ts";
import {
  AccessedOpaques,
  Certainty,
  type ComputeGoalFastPathOutcome,
  type Goal,
  type GoalStalledOn,
  MaybeInfo,
  type NoSolutionOrRerunNonErased,
} from "../rustc_type_ir/solve/mod.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { EvalCtxt } from "./decls.ts";
import { type SolverDelegate, SolverDelegate_provided, type SolverDelegate_static } from "./delegate.ts";
import { EvaluationStepBuilder } from "./solve/inspect/build.ts";
import { FIXPOINT_STEP_LIMIT, type GoalEvaluation } from "./solve/mod.ts";
import { compute_goal_fast_path, inlined_rerunning_stalled_goal_may_make_progress } from "./solve/eval_ctxt/fast_path.ts";
import { should_rerun_after_erased_canonicalization, SolverDelegateEvalExt_for_D } from "./solve/eval_ctxt/mod.ts";

// ---- fixtures ----------------------------------------------------------------------------------------------------

/** A `TyCtxt` over a fresh `CtxtInterners` (rustc_type_ir tyir_misc_infer.test.ts), with the two `-Z` flags the
 * solver reads off. */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  let caches: GlobalCaches | undefined;
  const gcx = {
    interners,
    sess: { opts: { unstable_opts: { renormalize_rigid_aliases: false, assumptions_on_binders: false } } },
    get caches() {
      return (caches ??= GlobalCaches.default_());
    },
    dep_graph: DepGraph.new_disabled(),
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const tcx = mk_tcx();
const param_env = ParamEnv.empty();
/** `PredicateKind::Ambiguous`: interned for real; it has no aliases, so `normalize` returns it unchanged. */
const ambiguous: Predicate = Predicate_upcast_from_PredicateKind({ $: "Ambiguous" }, tcx);
const goal: Goal<Predicate> = { param_env, predicate: ambiguous };
const vid = (n: number) => n as TyVid;

interface FakeState {
  /** Inference "state" a probe must roll back. */
  vars: number;
  /** Results of `compute_goal_fast_path`, consumed front to back (`NoFastPath` when empty). */
  fast_paths: ComputeGoalFastPathOutcome[];
  fast_path_calls: number;
  /** Stalled vars that changed since the goal stalled. */
  changed: Set<number>;
  probes: number;
  /** The canonical inputs `D::build_with_canonical` was called with (the search graph's `enter_canonical`). */
  canonical_inputs: unknown[];
}

function stalled_on_var(n: number): GoalStalledOn {
  return { stalled_vars: [{ $: "Ty", _0: vid(n) }], sub_roots: [], stalled_maybe_info: MaybeInfo.AMBIGUOUS, opaques: { $: "No" } };
}

function mk_delegate(): { delegate: SolverDelegate; state: FakeState } {
  const state: FakeState = { vars: 0, fast_paths: [], fast_path_calls: 0, changed: new Set(), probes: 0, canonical_inputs: [] };
  const infcx = {
    cx: () => tcx,
    disable_trait_solver_fast_paths: () => false,
    enable_next_solver_overflow_fcw: () => false,
    typing_mode_raw: () => ({ $: "PostAnalysis" }),
    ty_or_const_infer_var_changed: (v: { _0: number }) => state.changed.has(v._0),
    is_sub_unification_table_root_var: () => true,
    deeply_resolve_ignoring_regions: <T>(v: T) => v,
    deeply_resolve_via_unification_table: <T>(v: T) => v,
    clone_opaque_types_lookup_table: () => [],
    probe<T>(f: () => T): T {
      state.probes++;
      const snapshot = state.vars;
      try {
        return f();
      } finally {
        state.vars = snapshot;
      }
    },
  } as unknown as InferCtxtLike;
  const Self: SolverDelegate_static = {
    build_with_canonical: (_cx: unknown, canonical: unknown) => {
      state.canonical_inputs.push(canonical);
      throw new Error("build_with_canonical: the test stops here");
    },
    OpaqueTypeStorageEntries_default: () => ({ needs_reevaluation: () => false }),
  };
  const delegate = {
    deref: () => infcx,
    Self,
    cx: () => tcx,
    obtain_canonicalizer_state: () => SolverDelegate_provided.obtain_canonicalizer_state(delegate),
    release_canonicalizer_state: (st: never) => SolverDelegate_provided.release_canonicalizer_state(delegate, st),
    compute_goal_fast_path(): ComputeGoalFastPathOutcome {
      state.fast_path_calls++;
      return state.fast_paths.shift() ?? { $: "NoFastPath" };
    },
  } as unknown as SolverDelegate;
  return { delegate, state };
}

// ---- noop proof-tree builder (see header) ------------------------------------------------------------------------

const NOOP_NAMES = ["is_noop", "take_and_enter_probe", "add_var_value", "probe_final_state", "add_goal", "make_canonical_response", "probe_kind", "finish_probe"] as const;
const saved = new Map<string, unknown>();
let saved_new_noop: unknown;
beforeAll(() => {
  const proto = EvaluationStepBuilder.prototype as unknown as Record<string, unknown>;
  for (const n of NOOP_NAMES) saved.set(n, proto[n]);
  saved_new_noop = EvaluationStepBuilder.new_noop;
  EvaluationStepBuilder.new_noop = () => new EvaluationStepBuilder(undefined);
  proto.is_noop = function (this: EvaluationStepBuilder) {
    return this.state === undefined;
  };
  proto.take_and_enter_probe = function (this: EvaluationStepBuilder) {
    if (this.state !== undefined) throw new Error("only the noop builder is faked");
    return new EvaluationStepBuilder(undefined);
  };
  proto.finish_probe = function (this: EvaluationStepBuilder) {
    return this;
  };
  for (const n of ["add_var_value", "probe_final_state", "add_goal", "make_canonical_response", "probe_kind"]) {
    proto[n] = function (this: EvaluationStepBuilder) {
      if (this.state !== undefined) throw new Error("only the noop builder is faked");
    };
  }
});
afterAll(() => {
  const proto = EvaluationStepBuilder.prototype as unknown as Record<string, unknown>;
  for (const [n, f] of saved) proto[n] = f;
  EvaluationStepBuilder.new_noop = saved_new_noop as typeof EvaluationStepBuilder.new_noop;
});

function is_rerun<T>(r: Result<T, NoSolutionOrRerunNonErased>): boolean {
  return r.$ === "Err" && r._0.$ === "RerunNonErased";
}

// ---- tests -------------------------------------------------------------------------------------------------------

describe("EvalCtxt::enter_root", () => {
  test("an empty goal list evaluates to Certainty::Yes; the root context is Misc in the root universe", () => {
    const { delegate } = mk_delegate();
    const r = EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      expect(ecx.current_goal_kind).toBe("Misc");
      expect(ecx.max_input_universe as number).toBe(0);
      expect(ecx.var_values.length).toBe(0);
      expect(ecx.step_kind_to_nested("Misc")).toBe(PathKind.ForcedAmbiguity);
      expect(ecx.search_graph.is_empty()).toBe(true);
      return ecx.try_evaluate_added_goals();
    });
    expect(r).toEqual(Ok(Certainty.Yes));
  });

  test("asserts that no goals are left behind (upstream message)", () => {
    const { delegate, state } = mk_delegate();
    state.fast_paths = [{ $: "TriviallyStalled", stalled_on: stalled_on_var(0) }];
    expect(() => EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => ecx.add_goal("Misc", goal))).toThrow(
      new Panic("root `EvalCtxt` should not have any goals added to it"),
    );
  });

  test("asserts that no opaque access may rerun", () => {
    const { delegate } = mk_delegate();
    expect(() =>
      EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) =>
        AccessedOpaques.rerun_if_any_opaque_has_infer_as_hidden_type(ecx.opaque_accesses, "SelfTyInfer"),
      ),
    ).toThrow(new Panic("assertion failed: !ecx.opaque_accesses.might_rerun()"));
  });
});

describe("add_goal -> try_evaluate_added_goals", () => {
  test("a goal that trivially holds is never added", () => {
    const { delegate, state } = mk_delegate();
    state.fast_paths = [{ $: "TriviallyHolds" }];
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      expect(ecx.add_goal("Misc", goal)).toEqual(Ok(undefined));
      expect(ecx.nested_goals.length).toBe(0);
      expect(ecx.try_evaluate_added_goals()).toEqual(Ok(Certainty.Yes));
    });
    expect(state.fast_path_calls).toBe(1);
  });

  test("a trivially stalled goal stays stalled until its variable changes", () => {
    const { delegate, state } = mk_delegate();
    const stalled_on = stalled_on_var(3);
    state.fast_paths = [{ $: "TriviallyStalled", stalled_on }];
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      expect(ecx.add_goal("ImplWhereBound", goal)).toEqual(Ok(undefined));
      expect(ecx.nested_goals).toEqual([["ImplWhereBound", goal, stalled_on]]);

      // Nothing changed: the step reports the goal's certainty (no progress) after one pass and keeps the goal.
      expect(ecx.try_evaluate_added_goals()).toEqual(Ok(Certainty.AMBIGUOUS));
      expect(ecx.nested_goals).toEqual([["ImplWhereBound", goal, stalled_on]]);
      expect(state.fast_path_calls).toBe(1);

      // The stalled var changed: the goal reruns, through the (cold) fast path, which now holds.
      state.changed.add(3);
      state.fast_paths = [{ $: "TriviallyHolds" }];
      expect(ecx.try_evaluate_added_goals()).toEqual(Ok(Certainty.Yes));
      expect(ecx.nested_goals.length).toBe(0);
      expect(state.fast_path_calls).toBe(2);
    });
  });

  test("goals that keep changing the inference state hit FIXPOINT_STEP_LIMIT and return overflow", () => {
    const { delegate } = mk_delegate();
    let calls = 0;
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      ecx.nested_goals.push(["Misc", goal, undefined]);
      ecx.evaluate_goal = (_source, g, _stalled): Result<GoalEvaluation, NoSolutionOrRerunNonErased> => {
        calls++;
        return Ok({ goal: g, certainty: Certainty.AMBIGUOUS, has_changed: "Yes", stalled_on: undefined });
      };
      expect(FIXPOINT_STEP_LIMIT).toBe(8);
      expect(ecx.try_evaluate_added_goals()).toEqual(Ok(Certainty.overflow(false)));
      expect(calls).toBe(FIXPOINT_STEP_LIMIT);
      ecx.nested_goals = [];
    });
  });

  test("NoSolution drops the remaining goals and taints the context; a canonical response then ICEs", () => {
    const { delegate } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      ecx.nested_goals.push(["Misc", goal, undefined], ["Misc", goal, undefined]);
      let calls = 0;
      ecx.evaluate_goal = (): Result<GoalEvaluation, NoSolutionOrRerunNonErased> => {
        calls++;
        return Err({ $: "NoSolution", _0: {} });
      };
      expect(ecx.try_evaluate_added_goals()).toEqual(Err({ $: "NoSolution", _0: {} }));
      expect(calls).toBe(1);
      expect(ecx.tainted).toEqual(Err({}));
      expect(ecx.nested_goals.length).toBe(0);
      expect(() => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes)).toThrow(
        new Panic(
          "assertion `left == right` failed: EvalCtxt is tainted -- nested goals may have been dropped in a previous call to `try_evaluate_added_goals!`\n  left: Err(NoSolution)\n right: Ok(())",
        ),
      );
    });
  });

  test("RerunNonErased propagates without tainting", () => {
    const { delegate } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
      ecx.nested_goals.push(["Misc", goal, undefined]);
      ecx.evaluate_goal = (): Result<GoalEvaluation, NoSolutionOrRerunNonErased> => Err({ $: "RerunNonErased", _0: { _0: null } });
      expect(ecx.try_evaluate_added_goals()).toEqual(Err({ $: "RerunNonErased", _0: { _0: null } }));
      expect(ecx.tainted).toEqual(Ok(undefined));
    });
  });

  test("a goal without a fast path is canonicalized and evaluated in the search graph (up to D::build_with_canonical)", () => {
    const { delegate, state } = mk_delegate();
    expect(() =>
      EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (ecx) => {
        ecx.add_goal("Misc", goal);
        return ecx.try_evaluate_added_goals();
      }),
    ).toThrow("build_with_canonical: the test stops here");
    // The canonical input of the goal: no variables, the empty param env kept, the predicate unchanged.
    expect(state.canonical_inputs.length).toBe(1);
    const c = state.canonical_inputs[0] as { canonical: { max_universe: number; var_kinds: readonly unknown[]; value: { goal: Goal<Predicate> } } };
    expect(c.canonical.max_universe).toBe(0);
    expect(c.canonical.var_kinds.length).toBe(0);
    expect(c.canonical.value.goal.predicate).toBe(ambiguous);
    expect(c.canonical.value.goal.param_env.caller_bounds_).toBe(param_env.caller_bounds_);
  });
});

describe("probes", () => {
  test("nested probes see a copy of the outer goals, roll back inference and merge opaque accesses", () => {
    const { delegate, state } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (outer) => {
      outer.nested_goals.push(["Misc", goal, undefined]);
      const kinds: unknown[] = [];
      const r = outer
        .probe<number>((res) => {
          kinds.push(res);
          return { $: "ShadowedEnvProbing" };
        })
        .enter((ecx) => {
          expect(ecx).not.toBe(outer);
          expect(ecx.search_graph).toBe(outer.search_graph);
          expect(ecx.nested_goals).toEqual(outer.nested_goals);
          expect(ecx.nested_goals).not.toBe(outer.nested_goals);
          ecx.nested_goals.push(["Normalization", goal, undefined]);
          state.vars = 1;
          const inner = ecx
            .probe<number>(() => ({ $: "ShadowedEnvProbing" }))
            .enter_without_propagated_nested_goals((ecx2) => {
              expect(ecx2.nested_goals).toEqual([]);
              state.vars = 2;
              return Ok(20);
            });
          expect(inner).toEqual(Ok(20));
          expect(state.vars).toBe(1);
          // Accesses recorded in the probe are merged into the outer context.
          expect(AccessedOpaques.rerun_if_any_opaque_has_infer_as_hidden_type(ecx.opaque_accesses, "SelfTyInfer")).toEqual(Ok(null));
          return Ok(10);
        });
      expect(r).toEqual(Ok(10));
      expect(state.vars).toBe(0);
      expect(state.probes).toBe(2);
      // `probe_kind` is only called when building proof trees.
      expect(kinds).toEqual([]);
      expect(outer.nested_goals).toEqual([["Misc", goal, undefined]]);
      expect(outer.opaque_accesses.rerun).toEqual({ $: "AnyOpaqueHasInferAsHidden" });
      outer.nested_goals = [];
      outer.opaque_accesses = AccessedOpaques.default_();
    });
  });

  test("NoSolution inside a probe does not taint the outer context", () => {
    const { delegate } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (outer) => {
      const r = outer.probe<number>(() => ({ $: "ShadowedEnvProbing" })).enter((ecx) => {
        ecx.tainted = Err({});
        return Err({ $: "NoSolution", _0: {} });
      });
      expect(r).toEqual(Err({ $: "NoSolution", _0: {} }));
      expect(outer.tainted).toEqual(Ok(undefined));
    });
  });

  test("a probe that must rerun in the original typing mode bails out of the outer context", () => {
    const { delegate } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (outer) => {
      const r = outer.probe<number>(() => ({ $: "ShadowedEnvProbing" })).enter((ecx) => {
        const a = AccessedOpaques.rerun_always(ecx.opaque_accesses, "EvaluateConst");
        return a.$ === "Err" ? Err({ $: "RerunNonErased", _0: a._0 }) : Ok(0);
      });
      expect(is_rerun(r)).toBe(true);
      expect(outer.opaque_accesses.rerun).toEqual({ $: "Always" });
      // Once bailed, further probes and candidates bail immediately, without touching the search graph.
      expect(is_rerun(outer.probe<number>(() => ({ $: "ShadowedEnvProbing" })).enter(() => Ok(1)))).toBe(true);
      const [res, usages] = outer.probe_builtin_trait_candidate({ $: "Misc" }).cx.enter_single_candidate(() => {
        throw new Error("not reached");
      });
      expect(is_rerun(res)).toBe(true);
      expect(usages.usages).toBeUndefined();
      outer.opaque_accesses = AccessedOpaques.default_();
    });
  });

  test("trait probes record their candidate source", () => {
    const { delegate } = mk_delegate();
    EvalCtxt.enter_root(delegate, 128, DUMMY_SP, (outer) => {
      const t = outer.probe_trait_candidate({ $: "Impl", _0: undefined as never });
      expect(t.source.$).toBe("Impl");
      expect(t.cx.probe_kind(Err({}))).toEqual({ $: "TraitCandidate", source: t.source, result: Err({}) });
      const b = outer.probe_builtin_trait_candidate({ $: "Misc" });
      expect(b.source).toEqual({ $: "BuiltinImpl", _0: { $: "Misc" } });
    });
  });
});

describe("fast paths and root goals", () => {
  test("compute_goal_fast_path maps the delegate's outcome", () => {
    const { delegate, state } = mk_delegate();
    expect(compute_goal_fast_path(delegate, goal, DUMMY_SP)).toBeUndefined();
    state.fast_paths = [{ $: "TriviallyHolds" }, { $: "TriviallyStalled", stalled_on: stalled_on_var(1) }];
    expect(compute_goal_fast_path(delegate, goal, DUMMY_SP)).toEqual({ goal, certainty: Certainty.Yes, has_changed: "No", stalled_on: undefined });
    expect(compute_goal_fast_path(delegate, goal, DUMMY_SP)).toEqual({
      goal,
      certainty: Certainty.AMBIGUOUS,
      has_changed: "No",
      stalled_on: stalled_on_var(1),
    });
  });

  test("stalled goals: goal_remains_stalled and evaluate_root_goal's early return", () => {
    const { delegate, state } = mk_delegate();
    const stalled_on = stalled_on_var(5);
    expect(inlined_rerunning_stalled_goal_may_make_progress(delegate, undefined)).toEqual({ $: "MayMakeProgress" });
    expect(SolverDelegateEvalExt_for_D.goal_remains_stalled(delegate, stalled_on)).toBe(true);
    expect(SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, goal, DUMMY_SP, stalled_on)).toEqual(
      Ok({ goal, certainty: { $: "Maybe", _0: MaybeInfo.AMBIGUOUS }, has_changed: "No", stalled_on }),
    );
    state.changed.add(5);
    expect(SolverDelegateEvalExt_for_D.goal_remains_stalled(delegate, stalled_on)).toBe(false);
    // The rerun takes the (cold) fast path before building an `EvalCtxt`.
    state.fast_paths = [{ $: "TriviallyHolds" }];
    expect(SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, goal, DUMMY_SP, stalled_on)).toEqual(
      Ok({ goal, certainty: Certainty.Yes, has_changed: "No", stalled_on: undefined }),
    );
  });

  test("should_rerun_after_erased_canonicalization", () => {
    const never = AccessedOpaques.default_();
    const always: AccessedOpaques = { reason: "EvaluateConst", rerun: { $: "Always" } };
    const infer: AccessedOpaques = { reason: "SelfTyInfer", rerun: { $: "AnyOpaqueHasInferAsHidden" } };
    expect(should_rerun_after_erased_canonicalization(never, { $: "Coherence" }, [])).toBe("No");
    expect(should_rerun_after_erased_canonicalization(always, { $: "ErasedNotCoherence", _0: {} }, [])).toBe("EagerlyPropagateToParent");
    expect(() => should_rerun_after_erased_canonicalization(always, { $: "Coherence" }, [])).toThrow(Panic);
    expect(should_rerun_after_erased_canonicalization(always, { $: "PostAnalysis" }, [])).toBe("Yes");
    expect(should_rerun_after_erased_canonicalization(infer, { $: "PostAnalysis" }, [])).toBe("No");
  });
});
