// Contract stub for compiler/rustc_next_trait_solver/src/solve/eval_ctxt/probe.rs (lane evalctxt-contract; the file
// belongs to lane nts-eval). `ProbeCtxt` / `TraitProbeCtxt` are final classes whose methods are stubs: fill each in
// place and add the `// rustc:` marker. The `EvalCtxt` methods of the file are declared in ../../decls.ts
// (`// solve/eval_ctxt/probe.rs:<line>`); the call at the end installs `unported(..)` placeholders: assign
// `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the marker and delete the name from the list.
// Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `ProbeCtxt<'me, 'a, D, I, F, T>` keeps `T`; `F: FnOnce(&Result<T, NoSolution>) -> inspect::ProbeKind<I>` is
// the closure type of the `probe_kind` field; `_result: PhantomData<T>` is erased. `TraitProbeCtxt<'me, 'a, D, I, F>`
// is `ProbeCtxt<CanonicalResponse>` plus its `source`. The `impl FnOnce(..)` return types of
// `probe_builtin_trait_candidate` / `probe_trait_candidate` are that same closure type.
// PORT: `self` taken by value (`enter*(self, ..)`) consumes the context; the TS object is simply not reused.
import type { CandidateHeadUsages } from "../../../rustc_type_ir/search_graph/mod.ts";
import type { ProbeKind } from "../../../rustc_type_ir/solve/inspect.ts";
import type {
  CandidateSource,
  CanonicalResponse,
  Goal,
  GoalSource,
  GoalStalledOn,
  NoSolution,
  NoSolutionOrRerunNonErased,
} from "../../../rustc_type_ir/solve/mod.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";
import type { Candidate } from "../assembly/mod.ts";

export class ProbeCtxt<T> {
  constructor(
    public ecx: EvalCtxt,
    public probe_kind: (result: Result<T, NoSolution>) => ProbeKind,
  ) {}

  enter_single_candidate(
    _f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
  ): [Result<T, NoSolutionOrRerunNonErased>, CandidateHeadUsages] {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::probe::ProbeCtxt::enter_single_candidate");
  }

  enter(_f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>): Result<T, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::probe::ProbeCtxt::enter");
  }

  enter_without_propagated_nested_goals(
    _f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
  ): Result<T, NoSolutionOrRerunNonErased> {
    return unported(
      "rustc_next_trait_solver::solve::eval_ctxt::probe::ProbeCtxt::enter_without_propagated_nested_goals",
    );
  }

  enter_inner(
    _f: (ecx: EvalCtxt) => Result<T, NoSolutionOrRerunNonErased>,
    _propagated_nested_goals: [GoalSource, Goal<Predicate>, GoalStalledOn | undefined][],
  ): Result<T, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::probe::ProbeCtxt::enter_inner");
  }
}

export class TraitProbeCtxt {
  constructor(
    public cx: ProbeCtxt<CanonicalResponse>,
    public source: CandidateSource,
  ) {}

  enter(_f: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::probe::TraitProbeCtxt::enter");
  }
}

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::eval_ctxt::probe::EvalCtxt", [
  "probe",
  "probe_builtin_trait_candidate",
  "probe_trait_candidate",
]);
