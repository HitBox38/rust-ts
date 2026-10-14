// Contract stub for compiler/rustc_next_trait_solver/src/solve/search_graph.rs (lane evalctxt-contract; the file
// belongs to lane nts-eval). The types and consts are final; the fns of `impl search_graph::Delegate for
// SearchGraphDelegate<D>` and `response_no_constraints` are stubs with final signatures: fill each in place and add the
// `// rustc:` marker. Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT (tyir-solve decision 1): `impl<D: SolverDelegate> search_graph::Delegate for SearchGraphDelegate<D>` is a
// `Delegate<SearchGraphDelegateTypes>` fn table. Its associated types: `Cx = D::Interner` (`InternerCx`, impl
// `Cx_for_Interner`), `ValidationScope = Infallible` (`never`), `ProofTreeBuilder = inspect::ProofTreeBuilder<D>`.
// `compute_goal` is the only fn that needs `D` itself (`EvalCtxt::enter_canonical` calls `D::build_with_canonical`), so
// the table is built per `D` by `SearchGraphDelegate(D)` (memoized: one table per `SolverDelegate_static`, so
// `SearchGraph<D>` keeps a stable `_marker`). `SearchGraph::<D>::new(depth)` is
// `search_graph.SearchGraph.new(SearchGraphDelegate(D), depth)`.
// PORT (D3): `cx: I` in the table is the search graph's `X::Self`, `Interner` (interner.ts `InternerCx`); the solver
// itself types `cx` as `TyCtxt` (decls.ts header), which does not satisfy `Interner` in TS yet (ty-contract handoff:
// `generics_of` is typed `unknown`), so `compute_goal` converts with `as_interner` / a cast until root closes that gap.
import type { CanonicalInput } from "../../rustc_middle/ty/decls.ts";
import { Cx_for_Interner, type Interner, type InternerCx } from "../../rustc_type_ir/interner.ts";
import type { Delegate, DelegateTypes, PathKind, SearchGraph as search_graph_SearchGraph } from "../../rustc_type_ir/search_graph/mod.ts";
import { type AccessedOpaques, Certainty, type QueryResult } from "../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../std/panic.ts";
import type { SolverDelegate_static } from "../delegate.ts";
import type { ProofTreeBuilder } from "./inspect/build.ts";
import { FIXPOINT_STEP_LIMIT } from "./mod.ts";

/** The associated types of `SearchGraphDelegate<D>`'s `search_graph::Delegate` impl (header). */
export interface SearchGraphDelegateTypes extends DelegateTypes {
  Cx: InternerCx;
  ValidationScope: never;
  ProofTreeBuilder: ProofTreeBuilder;
}

/// This type is never constructed. We only use it to implement `search_graph::Delegate`
/// for all types which impl `SolverDelegate` and doing it directly fails in coherence.
export type SearchGraph = search_graph_SearchGraph<SearchGraphDelegateTypes>;

const TABLES = new Map<SolverDelegate_static, Delegate<SearchGraphDelegateTypes>>();

/** `SearchGraphDelegate<D>`'s `search_graph::Delegate` impl for the `SolverDelegate` `D` (header). */
export function SearchGraphDelegate(D: SolverDelegate_static): Delegate<SearchGraphDelegateTypes> {
  let table = TABLES.get(D);
  if (table === undefined) {
    table = SearchGraphDelegate_impl(D);
    TABLES.set(D, table);
  }
  return table;
}

function SearchGraphDelegate_impl(_D: SolverDelegate_static): Delegate<SearchGraphDelegateTypes> {
  return {
    Cx: Cx_for_Interner,

    ENABLE_PROVISIONAL_CACHE: true,
    enter_validation_scope(_cx: Interner, _input: CanonicalInput): never | undefined {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::enter_validation_scope");
    },

    FIXPOINT_STEP_LIMIT: FIXPOINT_STEP_LIMIT,

    inspect_is_noop(_inspect: ProofTreeBuilder): boolean {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::inspect_is_noop");
    },

    DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW: 4,

    initial_provisional_result(_cx: Interner, _kind: PathKind, _input: CanonicalInput): [QueryResult, AccessedOpaques] {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::initial_provisional_result");
    },

    is_initial_provisional_result(_result: [QueryResult, AccessedOpaques]): PathKind | undefined {
      return unported(
        "rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::is_initial_provisional_result",
      );
    },

    stack_overflow_result(_cx: Interner, _input: CanonicalInput): [QueryResult, AccessedOpaques] {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::stack_overflow_result");
    },

    FIXPOINT_OVERFLOW_AMBIGUITY_KIND: Certainty.overflow(false),
    fixpoint_overflow_result(_cx: Interner, _input: CanonicalInput): [QueryResult, AccessedOpaques] {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::fixpoint_overflow_result");
    },

    is_ambiguous_result(_result: [QueryResult, AccessedOpaques]): Certainty | undefined {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::is_ambiguous_result");
    },

    compute_goal(
      _search_graph: SearchGraph,
      _cx: Interner,
      _input: CanonicalInput,
      _inspect: ProofTreeBuilder,
    ): [QueryResult, AccessedOpaques] {
      return unported("rustc_next_trait_solver::solve::search_graph::SearchGraphDelegate::compute_goal");
    },
  };
}

export function response_no_constraints(
  _cx: Interner,
  _input: CanonicalInput,
  _certainty: Certainty,
): [QueryResult, AccessedOpaques] {
  return unported("rustc_next_trait_solver::solve::search_graph::response_no_constraints");
}
