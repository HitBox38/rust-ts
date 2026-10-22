// Port of compiler/rustc_borrowck/src/constraints/mod.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `pub(crate) mod graph;` is loaded by the crate root (lib.ts), not imported here.
// PORT: init order: the generated type_check/mod.gen.ts and region_infer/mod.gen.ts import this module's
// `debug_OutlivesConstraint`, so this module's runtime imports are only `.gen.ts` modules and other crates (the
// `graph` / `reverse_graph` bodies read graph.ts lazily).
import type { Debug, Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { NormalConstraintGraph, ReverseConstraintGraph } from "./graph.gen.ts";
import { type OutlivesConstraint, type OutlivesConstraintIndex, OutlivesConstraintSet } from "./mod.gen.ts";

export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface OutlivesConstraintSet {
    // mod.rs:24 (lane bck-regions-b)
    push(constraint: OutlivesConstraint): void;
    // mod.rs:39 (lane bck-regions-b)
    graph(num_region_vars: number): NormalConstraintGraph;
    // mod.rs:45 (lane bck-regions-b)
    reverse_graph(num_region_vars: number): ReverseConstraintGraph;
    // mod.rs:49 (lane bck-regions-b); `outlives_`: the field `outlives` has the same name
    outlives_(): readonly OutlivesConstraint[];
    // mod.rs:59 (lane bck-regions-b): `impl Index<OutlivesConstraintIndex> for OutlivesConstraintSet`
    index(i: OutlivesConstraintIndex): OutlivesConstraint;
  }
}

// stub: compiler/rustc_borrowck/src/constraints/mod.rs:24 push (lane bck-regions-b)
OutlivesConstraintSet.prototype.push = function (this: OutlivesConstraintSet, constraint: OutlivesConstraint): void {
  return unported("rustc_borrowck::constraints::OutlivesConstraintSet::push");
};

/// Constructs a "normal" graph from the constraint set; the graph makes it
/// easy to find the constraints affecting a particular region.
///
/// N.B., this graph contains a "frozen" view of the current
/// constraints. Any new constraints added to the `OutlivesConstraintSet`
/// after the graph is built will not be present in the graph.
// stub: compiler/rustc_borrowck/src/constraints/mod.rs:39 graph (lane bck-regions-b)
OutlivesConstraintSet.prototype.graph = function (this: OutlivesConstraintSet, num_region_vars: number): NormalConstraintGraph {
  return unported("rustc_borrowck::constraints::OutlivesConstraintSet::graph");
};

/// Like `graph`, but constraints a reverse graph where `R1: R2`
/// represents an edge `R2 -> R1`.
// stub: compiler/rustc_borrowck/src/constraints/mod.rs:45 reverse_graph (lane bck-regions-b)
OutlivesConstraintSet.prototype.reverse_graph = function (this: OutlivesConstraintSet, num_region_vars: number): ReverseConstraintGraph {
  return unported("rustc_borrowck::constraints::OutlivesConstraintSet::reverse_graph");
};

// stub: compiler/rustc_borrowck/src/constraints/mod.rs:49 outlives (lane bck-regions-b)
OutlivesConstraintSet.prototype.outlives_ = function (this: OutlivesConstraintSet): readonly OutlivesConstraint[] {
  return unported("rustc_borrowck::constraints::OutlivesConstraintSet::outlives");
};

// impl<'tcx> Index<OutlivesConstraintIndex> for OutlivesConstraintSet<'tcx>
// stub: compiler/rustc_borrowck/src/constraints/mod.rs:59 index (lane bck-regions-b)
OutlivesConstraintSet.prototype.index = function (this: OutlivesConstraintSet, i: OutlivesConstraintIndex): OutlivesConstraint {
  return unported("rustc_borrowck::constraints::OutlivesConstraintSet::index");
};

// impl<'tcx> fmt::Debug for OutlivesConstraint<'tcx>
// stub: compiler/rustc_borrowck/src/constraints/mod.rs:96 fmt (lane bck-regions-b)
export const debug_OutlivesConstraint: Debug<OutlivesConstraint> = (v: OutlivesConstraint, f: Fmt): string => {
  return unported("rustc_borrowck::constraints::OutlivesConstraint::fmt");
};
