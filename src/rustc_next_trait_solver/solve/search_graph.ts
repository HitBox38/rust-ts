// Port of compiler/rustc_next_trait_solver/src/solve/search_graph.rs (lane nts-eval; contract by lane
// evalctxt-contract). Extension module (docs/handoff/evalctxt-contract.md "Init order"): this crate's other modules are
// read inside fn bodies only.
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
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type CanonicalInput, CanonicalInput_deref } from "../../rustc_middle/traits/solve.ts";
import { Cx_for_Interner, type Interner, type InternerCx } from "../../rustc_type_ir/interner.ts";
import { type Delegate, type DelegateTypes, PathKind, type SearchGraph as search_graph_SearchGraph } from "../../rustc_type_ir/search_graph/mod.ts";
import {
  AccessedOpaques,
  Certainty,
  NoSolutionOrRerunNonErased,
  type QueryResult,
  RerunResultExt_for_Result,
} from "../../rustc_type_ir/solve/mod.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { response_no_constraints_raw } from "../canonical/mod.ts";
import { EvalCtxt } from "../decls.ts";
import type { SolverDelegate_static } from "../delegate.ts";
import type { ProofTreeBuilder } from "./inspect/build.ts";
import { FIXPOINT_STEP_LIMIT, has_no_inference_or_external_constraints } from "./mod.ts";

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

// PORT (D3): the table's `cx: I` is `Interner` (`InternerCx`); the solver's own fns take `TyCtxt` (header).
function tcx_of(cx: Interner): TyCtxt {
  return cx as unknown as TyCtxt;
}

function SearchGraphDelegate_impl(D: SolverDelegate_static): Delegate<SearchGraphDelegateTypes> {
  return {
    Cx: Cx_for_Interner,

    ENABLE_PROVISIONAL_CACHE: true,
    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:29 enter_validation_scope
    enter_validation_scope(_cx: Interner, _input: CanonicalInput): never | undefined {
      return undefined;
    },

    FIXPOINT_STEP_LIMIT: FIXPOINT_STEP_LIMIT,

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:39 inspect_is_noop
    inspect_is_noop(inspect: ProofTreeBuilder): boolean {
      return inspect.is_noop();
    },

    DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW: 4,

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:45 initial_provisional_result
    initial_provisional_result(cx: Interner, kind: PathKind, input: CanonicalInput): [QueryResult, AccessedOpaques] {
      switch (kind) {
        case "Coinductive":
          return response_no_constraints(cx, input, Certainty.Yes);
        case "Unknown":
        case "ForcedAmbiguity":
          return response_no_constraints(cx, input, Certainty.overflow(false));
        // Even though we know some cycles to be unproductive, we still treat them
        // as unknown for now. This is both as we are not 100% confident in the
        // implementation yet and any incorrect errors would be unsound there.
        //
        // The affected cases are also fairly artificial and not necessarily desirable
        // so keeping this as ambiguity is fine for now.
        //
        // See `tests/ui/traits/next-solver/cycles/unproductive-in-coherence.rs` and
        // `tests/ui/traits/next-solver/overflow/recursive-self-normalization-simple.rs`
        // for examples where this would matter.
        //
        // FIXME(-Znext-solver=coinductive): Long term, we probably do want to
        // return `NoSolution` here. This should happen separately from the
        // stabilization of the new solver.
        case "Inductive":
          return unreachable();
      }
    },

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:73 is_initial_provisional_result
    is_initial_provisional_result(result: [QueryResult, AccessedOpaques]): PathKind | undefined {
      const r = result[0];
      if (r.$ === "Ok") {
        const response = r._0;
        if (has_no_inference_or_external_constraints(response)) {
          if (certainty_eq(response.value.certainty, Certainty.Yes)) {
            return PathKind.Coinductive;
          } else if (certainty_eq(response.value.certainty, Certainty.overflow(false))) {
            return PathKind.Unknown;
          }
        }

        return undefined;
      } else {
        return PathKind.Inductive;
      }
    },

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:92 stack_overflow_result
    stack_overflow_result(cx: Interner, input: CanonicalInput): [QueryResult, AccessedOpaques] {
      return response_no_constraints(cx, input, Certainty.overflow(true));
    },

    FIXPOINT_OVERFLOW_AMBIGUITY_KIND: Certainty.overflow(false),
    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:100 fixpoint_overflow_result
    fixpoint_overflow_result(cx: Interner, input: CanonicalInput): [QueryResult, AccessedOpaques] {
      return response_no_constraints(cx, input, Certainty.overflow(false));
    },

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:107 is_ambiguous_result
    is_ambiguous_result(result: [QueryResult, AccessedOpaques]): Certainty | undefined {
      const r = result[0];
      if (r.$ !== "Ok") return undefined;
      const response = r._0;
      if (has_no_inference_or_external_constraints(response) && response.value.certainty.$ === "Maybe") {
        return response.value.certainty;
      } else {
        return undefined;
      }
    },

    // rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:119 compute_goal
    compute_goal(
      search_graph: SearchGraph,
      cx: Interner,
      input: CanonicalInput,
      inspect: ProofTreeBuilder,
    ): [QueryResult, AccessedOpaques] {
      return EvalCtxt.enter_canonical(D, tcx_of(cx), search_graph, input, inspect, (ecx, goal) => {
        // if we're in `RerunNonErased`, don't even bother with inspect, and immediately return
        const r = RerunResultExt_for_Result.map_err_to_rerun(ecx.compute_goal(goal));
        if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
        const result = r._0;

        ecx.inspect.query_result(result);
        if (result.$ === "Ok") return result;
        return Err(NoSolutionOrRerunNonErased.from_NoSolution(result._0));
      });
    },
  };
}

/** PORT: the derived `PartialEq` of `Certainty` (plain data: compared by intern key, contract rule 4). */
function certainty_eq(a: Certainty, b: Certainty): boolean {
  return intern_key(a) === intern_key(b);
}

// PORT: `input.canonical` reads through `CanonicalInput`'s `Deref` (`CanonicalInput_deref`).
// rustc: compiler/rustc_next_trait_solver/src/solve/search_graph.rs:135 response_no_constraints
export function response_no_constraints(cx: Interner, input: CanonicalInput, certainty: Certainty): [QueryResult, AccessedOpaques] {
  const canonical = CanonicalInput_deref(input).canonical;
  return [Ok(response_no_constraints_raw(tcx_of(cx), canonical.max_universe, canonical.var_kinds, certainty)), AccessedOpaques.default_()];
}
