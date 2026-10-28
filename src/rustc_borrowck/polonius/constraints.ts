// Port of compiler/rustc_borrowck/src/polonius/constraints.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the crate trait `LocalizedConstraintGraphVisitor` is implemented by data-only structs (`LoanLivenessVisitor`
// in mod.rs, `MirDumpCollector` in dump.rs; generated interfaces), so it is an impl-table interface whose methods take
// the implementing value as `self`; both methods are provided (empty defaults) and live in
// `LocalizedConstraintGraphVisitor_provided` (PORTING §8). `&mut impl LivenessSource` / `&mut impl
// LocalizedConstraintGraphVisitor` parameters are the value plus its impl table, last (`S_`, `V_`).
// PORT: `outlives_constraints: impl Iterator<Item = OutlivesConstraint>` is `Iterable<OutlivesConstraint>`.
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { IndexVec } from "../../rustc_index/vec.ts";
import { BasicBlock, type Body, Location } from "../../rustc_middle/mir/mod.ts";
import { type DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import { LocalizedConstraintGraph, type LocalizedNode } from "./constraints.gen.ts";
export * from "./constraints.gen.ts";

declare module "./constraints.gen.ts" {
  interface LocalizedConstraintGraph {
    // constraints.rs:100
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
    // constraints.rs:65
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
  // rustc: compiler/rustc_borrowck/src/polonius/constraints.rs:56 on_node_traversed
  on_node_traversed<V>(self: V, _loan: BorrowIndex, _node: LocalizedNode, _is_live: boolean): void {},

  /// Callback called when discovering a new `successor` node for the `current_node`.
  // rustc: compiler/rustc_borrowck/src/polonius/constraints.rs:59 on_successor_discovered
  on_successor_discovered<V>(self: V, _current_node: LocalizedNode, _successor: LocalizedNode): void {},
};

/**
 * PORT: the derived `Hash` + `Eq` of `LocalizedNode` as a `KeyedMap` / `KeyedSet` key (both fields are `u32` indices; a
 * string, since `region * 2^32 + point` would not stay exact for every `RegionVid`).
 */
export function LocalizedNode_key(n: LocalizedNode): string {
  return `${n.region}:${n.point}`;
}

/// Traverses the constraints and returns the indexed graph of edges per node.
// rustc: compiler/rustc_borrowck/src/polonius/constraints.rs:65 new
(LocalizedConstraintGraph as unknown as { new: typeof LocalizedConstraintGraph.new }).new = function (
  location_map: DenseLocationMap,
  outlives_constraints: Iterable<OutlivesConstraint>,
): LocalizedConstraintGraph {
  // PORT: `FxHashMap<LocalizedNode, SmallVec<[RegionVid; 4]>>` is keyed by value (`LocalizedNode_key`); it is only
  // looked up, never iterated.
  const edges = new KeyedMap<LocalizedNode, RegionVid[]>(LocalizedNode_key);
  const logical_edges: RegionVid[][] = IndexVec.new();

  for (const outlives_constraint of outlives_constraints) {
    const locations = outlives_constraint.locations;
    switch (locations.$) {
      case "All": {
        const succs = IndexVec.ensure_contains_elem(logical_edges, outlives_constraint.sup, (): RegionVid[] => []);
        if (!succs.includes(outlives_constraint.sub)) {
          succs.push(outlives_constraint.sub);
        }
        break;
      }

      case "Single": {
        const location = locations._0;
        const node: LocalizedNode = {
          region: outlives_constraint.sup,
          point: location_map.point_from_location(location),
        };
        // `edges.entry(node).or_default()`
        let succs = edges.get(node);
        if (succs === undefined) {
          succs = [];
          edges.set(node, succs);
        }
        if (!succs.includes(outlives_constraint.sub)) {
          succs.push(outlives_constraint.sub);
        }
        break;
      }
    }
  }

  return new LocalizedConstraintGraph(edges, logical_edges);
};

/// Traverses the localized constraint graph per-loan, and notifies the `visitor` of discovered
/// nodes and successors.
// rustc: compiler/rustc_borrowck/src/polonius/constraints.rs:100 traverse
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
  // PORT: `FxHashSet<LocalizedNode>` by value (`LocalizedNode_key`); membership only.
  const visited = new KeyedSet<LocalizedNode>(LocalizedNode_key);
  const stack: LocalizedNode[] = [];

  // Compute reachability per loan by traversing each loan's subgraph starting from where it
  // is introduced.
  for (const [loan_idx, loan] of borrow_set.iter_enumerated()) {
    visited.clear();
    stack.length = 0;

    const start_node: LocalizedNode = {
      region: loan.region,
      point: location_map.point_from_location(loan.reserve_location),
    };
    visited.add(start_node);
    stack.push(start_node);

    let node: LocalizedNode | undefined;
    while ((node = stack.pop()) !== undefined) {
      const current = node;
      const liveness = S_.liveness_for_region(liveness_source, current.region);
      // We've reached a node we haven't visited before.
      const location = location_map.to_location(current.point);
      V_.on_node_traversed(visitor, loan_idx, current, liveness.is_live_at(current.point));

      // When we find a _new_ successor, we'd like to
      // - visit it eventually,
      // - and let the generic visitor know about it.
      const successor_found = (succ: LocalizedNode): void => {
        // `visited.insert(succ)`
        if (!visited.has(succ)) {
          visited.add(succ);
          stack.push(succ);
          V_.on_successor_discovered(visitor, current, succ);
        }
      };

      // Then, we propagate the loan along the localized constraint graph. The outgoing
      // edges are computed lazily, from:
      // - the various physical edges present at this node,
      // - the materialized logical edges that exist virtually at all points for this
      //   node's region, localized at this point.

      // The physical edges present at this node are:
      //
      // 1. the typeck edges that flow from region to region *at this point*.
      for (const succ_ of this.edges.get(current) ?? []) {
        const succ: LocalizedNode = { region: succ_, point: current.point };
        successor_found(succ);
      }

      // 2a. the liveness edges that flow *forward*, from this node's point to its
      // successors in the CFG.
      //
      // - for covariant cases: loans flow in the regular direction, from the current point
      // to the next point.
      // - for invariant cases, loans can flow in both directions, but here we're only
      // interested in the forward path of the bidirectional edge.
      //
      // We still need to check liveness for each next point though.
      if (liveness.direction === "Forward" || liveness.direction === "Bidirectional") {
        if (location.statement_index < body.index(location.block).statements.length) {
          // Intra-block edges, straight line constraints from each point to its successor
          // within the same block.
          // PORT: `node.point + 1` is the `newtype_index!` `Add<usize>` (`from_usize`, asserting the bound).
          const next_point = PointIndex.from_usize(current.point + 1);
          if (liveness.is_live_at(next_point)) {
            successor_found({
              region: current.region,
              point: next_point,
            });
          }
        } else {
          // Inter-block edges, from the block's terminator to each successor block's
          // entry point.
          for (const successor_block of body.index(location.block).terminator_().successors()) {
            const next_location = BasicBlock.start_location(successor_block);
            const next_point = location_map.point_from_location(next_location);
            if (liveness.is_live_at(next_point)) {
              successor_found({
                region: current.region,
                point: next_point,
              });
            }
          }
        }
      }

      // 2b. the liveness edges that flow *backward*, from this node's point to its
      // predecessors in the CFG.
      //
      // - for contravariant cases: loans flow in the inverse direction, from the current
      // point to the previous point.
      // - for invariant cases, loans can flow in both directions, but here we only
      // want the backward path of the bidirectional edge.
      //
      // Liveness flows into the regions live at the next point. So, in a backwards view, we'll link
      // the region from the current point, if it's live there, to the previous point.
      if ((liveness.direction === "Backward" || liveness.direction === "Bidirectional") && liveness.is_live_at(current.point)) {
        if (location.statement_index > 0) {
          // Backward edges to the predecessor point in the same block.
          const previous_point = PointIndex.from_usize(PointIndex.as_usize(current.point) - 1);
          successor_found({
            region: current.region,
            point: previous_point,
          });
        } else {
          // Backward edges from the block entry point to the terminator of the
          // predecessor blocks.
          const predecessors = body.basic_blocks.predecessors();
          for (const pred_block of predecessors[location.block]!) {
            const previous_location = new Location(pred_block, body.index(pred_block).statements.length);
            const previous_point = location_map.point_from_location(previous_location);
            successor_found({
              region: current.region,
              point: previous_point,
            });
          }
        }
      }

      // And finally, we have the logical edges, materialized at this point.
      const logical_succs = this.logical_edges[current.region];
      for (const logical_succ of logical_succs ?? []) {
        const succ: LocalizedNode = { region: logical_succ, point: current.point };
        successor_found(succ);
      }
    }
  }
};
