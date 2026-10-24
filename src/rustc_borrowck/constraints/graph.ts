// Port of compiler/rustc_borrowck/src/constraints/graph.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `trait ConstraintGraphDirection` (only associated fns, no `self`) is the interface `ConstraintGraphDirection`;
// the unit structs `Normal` / `Reverse` that implement it are, as values, their impl tables
// `ConstraintGraphDirection_Normal` / `ConstraintGraphDirection_Reverse` (typed `Normal` / `Reverse` too). The `D` value
// the graph stores (`ConstraintGraph._direction`, set by `ConstraintGraph::new(graph::Normal, ..)`) is that table, so
// `D::start_region(..)` / `D::end_region(..)` / `D::is_normal()` are `graph._direction.start_region(..)` & co. (reached
// through `self` in every fn that uses them; no extra `D_` parameter).
// PORT: `EdgesFromGraph` / `EdgesFromStatic` (interfaces) and `Successors` (an enum) implement `Iterator`: impl tables
// `Iterator_EdgesFromGraph` / `Iterator_EdgesFromStatic` / `Iterator_Successors` whose `next(self)` returns a JS
// `IteratorResult` (mir-contract: Iterator impls are JS iterators).
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { OutlivesConstraint, OutlivesConstraintSet } from "./mod.gen.ts";
import {
  ConstraintGraph,
  type EdgesFromGraph,
  type EdgesFromStatic,
  type Normal,
  RegionGraph,
  type Reverse,
  type Successors,
} from "./graph.gen.ts";

export * from "./graph.gen.ts";

/// Marker trait that controls whether a `R1: R2` constraint
/// represents an edge `R1 -> R2` or `R2 -> R1`.
// rustc-trait: compiler/rustc_borrowck/src/constraints/graph.rs:22 ConstraintGraphDirection
export interface ConstraintGraphDirection {
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:23 start_region
  start_region(sup: RegionVid, sub: RegionVid): RegionVid;
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:24 end_region
  end_region(sup: RegionVid, sub: RegionVid): RegionVid;
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:25 is_normal
  is_normal(): boolean;
}

// impl ConstraintGraphDirection for Normal
export const ConstraintGraphDirection_Normal: ConstraintGraphDirection & Normal = {
  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:36 start_region (lane bck-regions-b)
  start_region(sup: RegionVid, _sub: RegionVid): RegionVid {
    return unported("rustc_borrowck::constraints::graph::Normal::start_region");
  },

  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:40 end_region (lane bck-regions-b)
  end_region(_sup: RegionVid, sub: RegionVid): RegionVid {
    return unported("rustc_borrowck::constraints::graph::Normal::end_region");
  },

  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:44 is_normal (lane bck-regions-b)
  is_normal(): boolean {
    return unported("rustc_borrowck::constraints::graph::Normal::is_normal");
  },
};

// impl ConstraintGraphDirection for Reverse
export const ConstraintGraphDirection_Reverse: ConstraintGraphDirection & Reverse = {
  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:57 start_region (lane bck-regions-b)
  start_region(_sup: RegionVid, sub: RegionVid): RegionVid {
    return unported("rustc_borrowck::constraints::graph::Reverse::start_region");
  },

  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:61 end_region (lane bck-regions-b)
  end_region(sup: RegionVid, _sub: RegionVid): RegionVid {
    return unported("rustc_borrowck::constraints::graph::Reverse::end_region");
  },

  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:65 is_normal (lane bck-regions-b)
  is_normal(): boolean {
    return unported("rustc_borrowck::constraints::graph::Reverse::is_normal");
  },
};

declare module "./graph.gen.ts" {
  interface ConstraintGraph<D> {
    // graph.rs:97 (lane bck-regions-b)
    region_graph(set: OutlivesConstraintSet, static_region: RegionVid): RegionGraph<D>;
    // graph.rs:105 (lane bck-regions-b)
    is_normal(): boolean;
    // graph.rs:110 (lane bck-regions-b)
    outgoing_edges_from_graph(region_sup: RegionVid, constraints: OutlivesConstraintSet): EdgesFromGraph<D>;
    // graph.rs:119 (lane bck-regions-b)
    outgoing_edges_from_static(): EdgesFromStatic;
  }
  namespace ConstraintGraph {
    // graph.rs:75 (lane bck-regions-b)
    function new_<D>(direction: D, set: OutlivesConstraintSet, num_region_vars: number): ConstraintGraph<D>;
    export { new_ as new };
  }
  interface RegionGraph<D> {
    // graph.rs:186 (lane bck-regions-b)
    outgoing_regions(region_sup: RegionVid): Successors<D>;
    // graph.rs:225 (lane bck-regions-b): `impl graph::DirectedGraph for RegionGraph` (`type Node = RegionVid`)
    num_nodes(): number;
    // graph.rs:231 (lane bck-regions-b): `impl graph::Successors for RegionGraph`
    successors(node: RegionVid): Iterable<RegionVid>;
  }
  namespace RegionGraph {
    // graph.rs:176 (lane bck-regions-b)
    function new_<D>(set: OutlivesConstraintSet, constraint_graph: ConstraintGraph<D>, static_region: RegionVid): RegionGraph<D>;
    export { new_ as new };
  }
}

/// Creates a "dependency graph" where each region constraint `R1:
/// R2` is treated as an edge `R1 -> R2`. We use this graph to
/// construct SCCs for region inference but also for error
/// reporting.
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:75 new (lane bck-regions-b)
(ConstraintGraph as unknown as { new: typeof ConstraintGraph.new }).new = function <D>(
  direction: D,
  set: OutlivesConstraintSet,
  num_region_vars: number,
): ConstraintGraph<D> {
  return unported("rustc_borrowck::constraints::graph::ConstraintGraph::new");
};

/// Given the constraint set from which this graph was built
/// creates a region graph so that you can iterate over *regions*
/// and not constraints.
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:97 region_graph (lane bck-regions-b)
ConstraintGraph.prototype.region_graph = function <D>(this: ConstraintGraph<D>, set: OutlivesConstraintSet, static_region: RegionVid): RegionGraph<D> {
  return unported("rustc_borrowck::constraints::graph::ConstraintGraph::region_graph");
};

// stub: compiler/rustc_borrowck/src/constraints/graph.rs:105 is_normal (lane bck-regions-b)
ConstraintGraph.prototype.is_normal = function <D>(this: ConstraintGraph<D>): boolean {
  return unported("rustc_borrowck::constraints::graph::ConstraintGraph::is_normal");
};

/// Given a region `R`, iterate over all constraints `R: R1`.
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:110 outgoing_edges_from_graph (lane bck-regions-b)
ConstraintGraph.prototype.outgoing_edges_from_graph = function <D>(
  this: ConstraintGraph<D>,
  region_sup: RegionVid,
  constraints: OutlivesConstraintSet,
): EdgesFromGraph<D> {
  return unported("rustc_borrowck::constraints::graph::ConstraintGraph::outgoing_edges_from_graph");
};

/// Returns all regions (#53178).
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:119 outgoing_edges_from_static (lane bck-regions-b)
ConstraintGraph.prototype.outgoing_edges_from_static = function <D>(this: ConstraintGraph<D>): EdgesFromStatic {
  return unported("rustc_borrowck::constraints::graph::ConstraintGraph::outgoing_edges_from_static");
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> Iterator for EdgesFromGraph<'a, 'tcx, D>
export const Iterator_EdgesFromGraph = {
  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:133 next (lane bck-regions-b)
  next<D>(self: EdgesFromGraph<D>): IteratorResult<OutlivesConstraint> {
    return unported("rustc_borrowck::constraints::graph::EdgesFromGraph::next");
  },
};

// impl Iterator for EdgesFromStatic
export const Iterator_EdgesFromStatic = {
  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:151 next (lane bck-regions-b)
  next(self: EdgesFromStatic): IteratorResult<RegionVid> {
    return unported("rustc_borrowck::constraints::graph::EdgesFromStatic::next");
  },
};

/// Creates a "dependency graph" where each region constraint `R1:
/// R2` is treated as an edge `R1 -> R2`. We use this graph to
/// construct SCCs for region inference but also for error
/// reporting.
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:176 new (lane bck-regions-b)
(RegionGraph as unknown as { new: typeof RegionGraph.new }).new = function <D>(
  set: OutlivesConstraintSet,
  constraint_graph: ConstraintGraph<D>,
  static_region: RegionVid,
): RegionGraph<D> {
  return unported("rustc_borrowck::constraints::graph::RegionGraph::new");
};

/// Given a region `R`, iterate over all regions `R1` such that
/// there exists a constraint `R: R1`.
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:186 outgoing_regions (lane bck-regions-b)
RegionGraph.prototype.outgoing_regions = function <D>(this: RegionGraph<D>, region_sup: RegionVid): Successors<D> {
  return unported("rustc_borrowck::constraints::graph::RegionGraph::outgoing_regions");
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> Iterator for Successors<'a, 'tcx, D>
export const Iterator_Successors = {
  // stub: compiler/rustc_borrowck/src/constraints/graph.rs:208 next (lane bck-regions-b)
  next<D>(self: Successors<D>): IteratorResult<RegionVid> {
    return unported("rustc_borrowck::constraints::graph::Successors::next");
  },
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> graph::DirectedGraph for RegionGraph<'a, 'tcx, D>
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:225 num_nodes (lane bck-regions-b)
RegionGraph.prototype.num_nodes = function <D>(this: RegionGraph<D>): number {
  return unported("rustc_borrowck::constraints::graph::RegionGraph::num_nodes");
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> graph::Successors for RegionGraph<'a, 'tcx, D>
// stub: compiler/rustc_borrowck/src/constraints/graph.rs:231 successors (lane bck-regions-b)
RegionGraph.prototype.successors = function <D>(this: RegionGraph<D>, node: RegionVid): Iterable<RegionVid> {
  return unported("rustc_borrowck::constraints::graph::RegionGraph::successors");
};
