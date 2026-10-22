// Port of compiler/rustc_mir_dataflow/src/framework/results.rs (lane dataflow-contract).
// PORT (plan-m4 D5): `Results<'tcx, A>` is `Results<D, A>` (`D` = `A::Domain`); `IndexVec<BasicBlock, D>` is a `D[]`.
//! Dataflow analysis results.

import type { Body } from "../pending.ts";
import { ResultsCursor } from "./cursor.ts";
import type { Analysis } from "./mod.ts";

export type EntryStates<D> = D[];

/// The results of a dataflow analysis that has converged to fixpoint. It holds the domain values
/// (states) at the entry of each basic block. Domain values in other parts of the block are
/// recomputed on the fly by visitors (i.e. `ResultsCursor`, or `ResultsVisitor` impls). The
/// analysis is also present because it's often needed alongside the entry states.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/results.rs:14 Results
export class Results<D, A extends Analysis<D, unknown> = Analysis<D, unknown>> {
  constructor(
    public analysis: A,
    public entry_states: EntryStates<D>,
  ) {}

  /// Creates a `ResultsCursor` that takes ownership of `self`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/results.rs:27 into_results_cursor
  into_results_cursor(body: Body): ResultsCursor<D, A> {
    return ResultsCursor.new_owning(body, this);
  }
}
