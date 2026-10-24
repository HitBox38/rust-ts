// Port of compiler/rustc_borrowck/src/polonius/constraints.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the crate trait `LocalizedConstraintGraphVisitor` is implemented by data-only structs (`LoanLivenessVisitor`
// in mod.rs, `MirDumpCollector` in dump.rs; generated interfaces), so it is an impl-table interface whose methods take
// the implementing value as `self`; both methods are provided (empty defaults) and live in
// `LocalizedConstraintGraphVisitor_provided` (PORTING §8). `&mut impl LivenessSource` / `&mut impl
// LocalizedConstraintGraphVisitor` parameters are the value plus its impl table, last (`S_`, `V_`).
// PORT: `outlives_constraints: impl Iterator<Item = OutlivesConstraint>` is `Iterable<OutlivesConstraint>`.
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import { LocalizedConstraintGraph, type LocalizedNode } from "./constraints.gen.ts";
export * from "./constraints.gen.ts";

declare module "./constraints.gen.ts" {
  interface LocalizedConstraintGraph {
    // constraints.rs:100 (lane bck-polonius)
    traverse<S, V>(
      body: Body,
      borrow_set: BorrowSet,
      location_map: DenseLocationMap,
      liveness_source: S,
      visitor: V,
      S_: LivenessSource<S>,
      V_: LocalizedConstraintGraphVisitor<V>,
    ): void;
  }
  namespace LocalizedConstraintGraph {
    // constraints.rs:65 (lane bck-polonius)
    function new_(location_map: DenseLocationMap, outlives_constraints: Iterable<OutlivesConstraint>): LocalizedConstraintGraph;
    export { new_ as new };
  }
}

/// The visitor interface when traversing a `LocalizedConstraintGraph`.
// rustc-trait: compiler/rustc_borrowck/src/polonius/constraints.rs:53 LocalizedConstraintGraphVisitor
export interface LocalizedConstraintGraphVisitor<V> {
  /// Callback called when traversing a given `loan` encounters a localized `node` it hasn't
  /// visited before, and whether its region is live at that point.
  // (provided) constraints.rs:56 on_node_traversed -> LocalizedConstraintGraphVisitor_provided.on_node_traversed
  on_node_traversed(self: V, _loan: BorrowIndex, _node: LocalizedNode, _is_live: boolean): void;

  /// Callback called when discovering a new `successor` node for the `current_node`.
  // (provided) constraints.rs:59 on_successor_discovered -> LocalizedConstraintGraphVisitor_provided.on_successor_discovered
  on_successor_discovered(self: V, _current_node: LocalizedNode, _successor: LocalizedNode): void;
}

/** PORT: the provided methods of `LocalizedConstraintGraphVisitor` (PORTING §8). */
export const LocalizedConstraintGraphVisitor_provided = {
  /// Callback called when traversing a given `loan` encounters a localized `node` it hasn't
  /// visited before, and whether its region is live at that point.
  // stub: compiler/rustc_borrowck/src/polonius/constraints.rs:56 on_node_traversed (lane bck-polonius)
  on_node_traversed<V>(self: V, _loan: BorrowIndex, _node: LocalizedNode, _is_live: boolean): void {
    return unported("rustc_borrowck::polonius::constraints::LocalizedConstraintGraphVisitor::on_node_traversed");
  },

  /// Callback called when discovering a new `successor` node for the `current_node`.
  // stub: compiler/rustc_borrowck/src/polonius/constraints.rs:59 on_successor_discovered (lane bck-polonius)
  on_successor_discovered<V>(self: V, _current_node: LocalizedNode, _successor: LocalizedNode): void {
    return unported("rustc_borrowck::polonius::constraints::LocalizedConstraintGraphVisitor::on_successor_discovered");
  },
};

/// Traverses the constraints and returns the indexed graph of edges per node.
// stub: compiler/rustc_borrowck/src/polonius/constraints.rs:65 new (lane bck-polonius)
(LocalizedConstraintGraph as unknown as { new: typeof LocalizedConstraintGraph.new }).new = function (
  location_map: DenseLocationMap,
  outlives_constraints: Iterable<OutlivesConstraint>,
): LocalizedConstraintGraph {
  return unported("rustc_borrowck::polonius::constraints::LocalizedConstraintGraph::new");
};

/// Traverses the localized constraint graph per-loan, and notifies the `visitor` of discovered
/// nodes and successors.
// stub: compiler/rustc_borrowck/src/polonius/constraints.rs:100 traverse (lane bck-polonius)
LocalizedConstraintGraph.prototype.traverse = function <S, V>(
  this: LocalizedConstraintGraph,
  body: Body,
  borrow_set: BorrowSet,
  location_map: DenseLocationMap,
  liveness_source: S,
  visitor: V,
  S_: LivenessSource<S>,
  V_: LocalizedConstraintGraphVisitor<V>,
): void {
  return unported("rustc_borrowck::polonius::constraints::LocalizedConstraintGraph::traverse");
};
