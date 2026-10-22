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
import { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { panic } from "../../std/panic.ts";
import type { OutlivesConstraint, OutlivesConstraintIndex, OutlivesConstraintSet } from "./mod.gen.ts";
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
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:36 start_region
  start_region(sup: RegionVid, _sub: RegionVid): RegionVid {
    return sup;
  },

  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:40 end_region
  end_region(_sup: RegionVid, sub: RegionVid): RegionVid {
    return sub;
  },

  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:44 is_normal
  is_normal(): boolean {
    return true;
  },
};

// impl ConstraintGraphDirection for Reverse
export const ConstraintGraphDirection_Reverse: ConstraintGraphDirection & Reverse = {
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:57 start_region
  start_region(_sup: RegionVid, sub: RegionVid): RegionVid {
    return sub;
  },

  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:61 end_region
  end_region(sup: RegionVid, _sub: RegionVid): RegionVid {
    return sup;
  },

  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:65 is_normal
  is_normal(): boolean {
    return false;
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
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:75 new
(ConstraintGraph as unknown as { new: typeof ConstraintGraph.new }).new = function <D>(
  direction: D,
  set: OutlivesConstraintSet,
  num_region_vars: number,
): ConstraintGraph<D> {
  const D = direction as unknown as ConstraintGraphDirection;
  const first_constraints: (OutlivesConstraintIndex | undefined)[] = new Array(num_region_vars).fill(undefined);
  const next_constraints: (OutlivesConstraintIndex | undefined)[] = new Array(set.outlives.length).fill(undefined);

  for (let i = set.outlives.length - 1; i >= 0; i--) {
    const idx = i as OutlivesConstraintIndex;
    const constraint = set.outlives[i]!;
    const head_idx = D.start_region(constraint.sup, constraint.sub);
    if (head_idx >= first_constraints.length) {
      panic(`index out of bounds: the len is ${first_constraints.length} but the index is ${head_idx}`);
    }
    // debug_assert!(next.is_none());
    next_constraints[idx] = first_constraints[head_idx];
    first_constraints[head_idx] = idx;
  }

  return new ConstraintGraph(direction, first_constraints, next_constraints);
};

/// Given the constraint set from which this graph was built
/// creates a region graph so that you can iterate over *regions*
/// and not constraints.
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:97 region_graph
ConstraintGraph.prototype.region_graph = function <D>(this: ConstraintGraph<D>, set: OutlivesConstraintSet, static_region: RegionVid): RegionGraph<D> {
  return RegionGraph.new(set, this, static_region);
};

// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:105 is_normal
ConstraintGraph.prototype.is_normal = function <D>(this: ConstraintGraph<D>): boolean {
  return direction_of(this).is_normal();
};

/// Given a region `R`, iterate over all constraints `R: R1`.
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:110 outgoing_edges_from_graph
ConstraintGraph.prototype.outgoing_edges_from_graph = function <D>(
  this: ConstraintGraph<D>,
  region_sup: RegionVid,
  constraints: OutlivesConstraintSet,
): EdgesFromGraph<D> {
  if (region_sup >= this.first_constraints.length) {
    panic(`index out of bounds: the len is ${this.first_constraints.length} but the index is ${region_sup}`);
  }
  return { graph: this, constraints, pointer: this.first_constraints[region_sup] };
};

/// Returns all regions (#53178).
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:119 outgoing_edges_from_static
ConstraintGraph.prototype.outgoing_edges_from_static = function <D>(this: ConstraintGraph<D>): EdgesFromStatic {
  return { next_static_idx: 0, end_static_idx: this.first_constraints.length };
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> Iterator for EdgesFromGraph<'a, 'tcx, D>
export const Iterator_EdgesFromGraph = {
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:133 next
  next<D>(self: EdgesFromGraph<D>): IteratorResult<OutlivesConstraint> {
    const p = self.pointer;
    if (p !== undefined) {
      self.pointer = self.graph.next_constraints[p];
      return { done: false, value: self.constraints.index(p) };
    } else {
      return { done: true, value: undefined };
    }
  },
};

// impl Iterator for EdgesFromStatic
export const Iterator_EdgesFromStatic = {
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:151 next
  next(self: EdgesFromStatic): IteratorResult<RegionVid> {
    if (self.next_static_idx < self.end_static_idx) {
      const ret = RegionVid.from_usize(self.next_static_idx);
      self.next_static_idx += 1;
      return { done: false, value: ret };
    } else {
      return { done: true, value: undefined };
    }
  },
};

/// Creates a "dependency graph" where each region constraint `R1:
/// R2` is treated as an edge `R1 -> R2`. We use this graph to
/// construct SCCs for region inference but also for error
/// reporting.
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:176 new
(RegionGraph as unknown as { new: typeof RegionGraph.new }).new = function <D>(
  set: OutlivesConstraintSet,
  constraint_graph: ConstraintGraph<D>,
  static_region: RegionVid,
): RegionGraph<D> {
  return new RegionGraph(set, constraint_graph, static_region);
};

/// Given a region `R`, iterate over all regions `R1` such that
/// there exists a constraint `R: R1`.
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:186 outgoing_regions
RegionGraph.prototype.outgoing_regions = function <D>(this: RegionGraph<D>, region_sup: RegionVid): Successors<D> {
  // If this is the `'static` region and the graph's direction is normal,
  // then setup the Edges iterator to return all regions (#53178).
  if (region_sup === this.static_region && direction_of(this.constraint_graph).is_normal()) {
    return { $: "FromStatic", _0: this.constraint_graph.outgoing_edges_from_static() };
  } else {
    // Otherwise, just setup the iterator as normal.
    return {
      $: "FromGraph",
      _0: this.constraint_graph.outgoing_edges_from_graph(region_sup, this.set),
    };
  }
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> Iterator for Successors<'a, 'tcx, D>
export const Iterator_Successors = {
  // rustc: compiler/rustc_borrowck/src/constraints/graph.rs:208 next
  next<D>(self: Successors<D>): IteratorResult<RegionVid> {
    switch (self.$) {
      case "FromStatic": {
        const edges = self._0;
        // No `D::end_region` call needed here: static successors are only possible when
        // the direction is `Normal`, so we can directly use what would be the `sub` value.
        return Iterator_EdgesFromStatic.next(edges);
      }
      case "FromGraph": {
        const edges = self._0;
        const r = Iterator_EdgesFromGraph.next(edges);
        if (r.done) return { done: true, value: undefined };
        const constraint = r.value;
        return { done: false, value: direction_of(edges.graph).end_region(constraint.sup, constraint.sub) };
      }
    }
  },
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> graph::DirectedGraph for RegionGraph<'a, 'tcx, D>
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:225 num_nodes
RegionGraph.prototype.num_nodes = function <D>(this: RegionGraph<D>): number {
  return this.constraint_graph.first_constraints.length;
};

// impl<'a, 'tcx, D: ConstraintGraphDirection> graph::Successors for RegionGraph<'a, 'tcx, D>
// rustc: compiler/rustc_borrowck/src/constraints/graph.rs:231 successors
RegionGraph.prototype.successors = function <D>(this: RegionGraph<D>, node: RegionVid): Iterable<RegionVid> {
  const successors = this.outgoing_regions(node);
  // PORT: `impl Iterator` -> a JS iterable over `Iterator_Successors.next`.
  return { [Symbol.iterator]: (): Iterator<RegionVid> => ({ next: () => Iterator_Successors.next(successors) }) };
};

/** `D` of a `ConstraintGraph<D>`: the stored `_direction` is the direction's impl table (header). */
function direction_of<D>(graph: ConstraintGraph<D>): ConstraintGraphDirection {
  return graph._direction as unknown as ConstraintGraphDirection;
}
