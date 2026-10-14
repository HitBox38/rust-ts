// Port of compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs (lane nts-eval; contract by lane
// evalctxt-contract). The `EvalCtxt` methods of the file are declared in ../../decls.ts
// (`// solve/eval_ctxt/probe.rs:<line>`). Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `ProbeCtxt<'me, 'a, D, I, F, T>` keeps `T`; `F: FnOnce(&Result<T, NoSolution>) -> inspect::ProbeKind<I>` is
// the closure type of the `probe_kind` field; `_result: PhantomData<T>` is erased. `TraitProbeCtxt<'me, 'a, D, I, F>`
// is `ProbeCtxt<CanonicalResponse>` plus its `source`. The `impl FnOnce(..)` return types of
// `probe_builtin_trait_candidate` / `probe_trait_candidate` are that same closure type.
// PORT: `self` taken by value (`enter*(self, ..)`) consumes the context; the TS object is simply not reused.
import { CandidateHeadUsages } from "../../../rustc_type_ir/search_graph/mod.ts";
import type { ProbeKind } from "../../../rustc_type_ir/solve/inspect.ts";
import {
  AccessedOpaques,
  type BuiltinImplSource,
  type CandidateSource,
  type CanonicalResponse,
  debug_RerunNonErased,
  type Goal,
  type GoalSource,
  type GoalStalledOn,
  type NoSolution,
  NoSolutionOrRerunNonErased,
  type QueryResult,
  RerunResultExt_for_Result,
} from "../../../rustc_type_ir/solve/mod.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { EvalCtxt } from "../../decls.ts";
import type { Candidate } from "../assembly/mod.ts";

export class ProbeCtxt<T> {
  constructor(
    public ecx: EvalCtxt,
    public probe_kind: (result: Result<T, NoSolution>) => ProbeKind,
  ) {}

  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:33 enter_single_candidate
  enter_single_candidate(
    f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
  ): [Result<T, NoSolutionOrRerunNonErased>, CandidateHeadUsages] {
    let candidate_usages = CandidateHeadUsages.default_();

    const bail = AccessedOpaques.should_bail(this.ecx.opaque_accesses);
    if (bail.$ === "Err") {
      return [Err(NoSolutionOrRerunNonErased.from_RerunNonErased(bail._0)), candidate_usages];
    }

    this.ecx.search_graph.enter_single_candidate();
    const result = this.enter((ecx) => {
      const result = f(ecx);
      candidate_usages = ecx.search_graph.finish_single_candidate();
      return result;
    });
    return [result, candidate_usages];
  }

  // PORT: `self.ecx.nested_goals.clone()`: a new array; its tuples are never mutated in place.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:52 enter
  enter(f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>): Result<T, NoSolutionOrRerunNonErased> {
    const nested_goals = [...this.ecx.nested_goals];
    return this.enter_inner(f, nested_goals);
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:60 enter_without_propagated_nested_goals
  enter_without_propagated_nested_goals(
    f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
  ): Result<T, NoSolutionOrRerunNonErased> {
    return this.enter_inner(f, []);
  }

  // PORT: the nested `EvalCtxt { .. }` literal's fields are computed in upstream order, then passed to the
  // constructor in declaration order. `search_graph` is shared (upstream reborrows `&mut`); the `Copy` fields are
  // immutable values.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:67 enter_inner
  enter_inner(
    f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
    propagated_nested_goals: [GoalSource, Goal<Predicate>, GoalStalledOn | undefined][],
  ): Result<T, NoSolutionOrRerunNonErased> {
    const outer = this.ecx;
    const probe_kind = this.probe_kind;

    const bail = AccessedOpaques.should_bail(outer.opaque_accesses);
    if (bail.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(bail._0));

    const delegate = outer.delegate;
    const max_input_universe = outer.max_input_universe;
    const var_kinds = outer.var_kinds;
    const var_values = outer.var_values;
    const current_goal_kind = outer.current_goal_kind;
    const initial_opaque_types_storage_num_entries = outer.initial_opaque_types_storage_num_entries;
    const search_graph = outer.search_graph;
    const origin_span = outer.origin_span;
    const tainted = outer.tainted;
    const inspect = outer.inspect.take_and_enter_probe();
    const nested = new EvalCtxt(
      delegate,
      var_kinds,
      current_goal_kind,
      var_values,
      max_input_universe,
      initial_opaque_types_storage_num_entries,
      search_graph,
      propagated_nested_goals,
      origin_span,
      tainted,
      AccessedOpaques.default_(),
      inspect,
    );
    const r0 = nested.delegate.deref().probe(() => {
      const r = f(nested);
      nested.inspect.probe_final_state(delegate, max_input_universe);
      return r;
    });

    const u = AccessedOpaques.update(outer.opaque_accesses, nested.opaque_accesses);
    if (u.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(u._0));

    // Unwrap is unreachable, we would have returned on the line above.
    const r = unwrap_result(RerunResultExt_for_Result.map_err_to_rerun(r0), debug_RerunNonErased);

    if (!nested.inspect.is_noop()) {
      const probe_kind_ = probe_kind(r);
      nested.inspect.probe_kind(probe_kind_);
      outer.inspect = nested.inspect.finish_probe();
    }

    if (r.$ === "Ok") return r;
    return Err(NoSolutionOrRerunNonErased.from_NoSolution(r._0));
  }
}

export class TraitProbeCtxt {
  constructor(
    public cx: ProbeCtxt<CanonicalResponse>,
    public source: CandidateSource,
  ) {}

  // #[instrument(level = "debug", skip_all, fields(source = ?self.source))]
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:130 enter
  enter(f: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const [result, head_usages] = this.cx.enter_single_candidate(f);
    if (result.$ === "Err") return result;
    return Ok({ source: this.source, result: result._0, head_usages });
  }
}

// ---- impl<'a, D, I> EvalCtxt<'a, D, I> (probe.rs:139) ------------------------------------------------------------------

/// `probe_kind` is only called when proof tree building is enabled so it can be
/// as expensive as necessary to output the desired information.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:146 probe
EvalCtxt.prototype.probe = function <T>(this: EvalCtxt, probe_kind: (result: Result<T, NoSolution>) => ProbeKind): ProbeCtxt<T> {
  return new ProbeCtxt<T>(this, probe_kind);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:153 probe_builtin_trait_candidate
EvalCtxt.prototype.probe_builtin_trait_candidate = function (this: EvalCtxt, source: BuiltinImplSource): TraitProbeCtxt {
  return this.probe_trait_candidate({ $: "BuiltinImpl", _0: source });
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs:160 probe_trait_candidate
EvalCtxt.prototype.probe_trait_candidate = function (this: EvalCtxt, source: CandidateSource): TraitProbeCtxt {
  return new TraitProbeCtxt(
    new ProbeCtxt<CanonicalResponse>(this, (result: QueryResult): ProbeKind => ({ $: "TraitCandidate", source, result })),
    source,
  );
};
