// Port of compiler/rustc_borrowck/src/constraints/mod.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `pub(crate) mod graph;` is loaded by the crate root (lib.ts), not imported here.
// PORT: init order: the generated type_check/mod.gen.ts and region_infer/mod.gen.ts import this module's
// `debug_OutlivesConstraint`, so this module's runtime imports are only `.gen.ts` modules and other crates (the
// `graph` / `reverse_graph` bodies read graph.ts lazily).
import { debug_ConstraintCategory } from "../../rustc_middle/mir/query.gen.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { debug_VarianceDiagInfo } from "../../rustc_type_ir/relate.gen.ts";
import { type Debug, type Fmt, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { debug_Locations } from "../type_check/mod.gen.ts";
import type { NormalConstraintGraph, ReverseConstraintGraph } from "./graph.gen.ts";
import { type OutlivesConstraint, type OutlivesConstraintIndex, OutlivesConstraintSet } from "./mod.gen.ts";

export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface OutlivesConstraintSet {
    // mod.rs:24
    push(constraint: OutlivesConstraint): void;
    // mod.rs:39
    graph(num_region_vars: number): NormalConstraintGraph;
    // mod.rs:45
    reverse_graph(num_region_vars: number): ReverseConstraintGraph;
    // mod.rs:49; `outlives_`: the field `outlives` has the same name
    outlives_(): readonly OutlivesConstraint[];
    // mod.rs:59: `impl Index<OutlivesConstraintIndex> for OutlivesConstraintSet`
    index(i: OutlivesConstraintIndex): OutlivesConstraint;
  }
}

// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:24 push
OutlivesConstraintSet.prototype.push = function (this: OutlivesConstraintSet, constraint: OutlivesConstraint): void {
  // debug!("OutlivesConstraintSet::push({:?})", constraint);
  if (constraint.sup === constraint.sub) {
    // 'a: 'a is pretty uninteresting
    return;
  }
  this.outlives.push(constraint);
};

/// Constructs a "normal" graph from the constraint set; the graph makes it
/// easy to find the constraints affecting a particular region.
///
/// N.B., this graph contains a "frozen" view of the current
/// constraints. Any new constraints added to the `OutlivesConstraintSet`
/// after the graph is built will not be present in the graph.
// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:39 graph
OutlivesConstraintSet.prototype.graph = function (this: OutlivesConstraintSet, num_region_vars: number): NormalConstraintGraph {
  const graph = graph_m();
  return graph.ConstraintGraph.new(graph.ConstraintGraphDirection_Normal, this, num_region_vars);
};

/// Like `graph`, but constraints a reverse graph where `R1: R2`
/// represents an edge `R2 -> R1`.
// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:45 reverse_graph
OutlivesConstraintSet.prototype.reverse_graph = function (this: OutlivesConstraintSet, num_region_vars: number): ReverseConstraintGraph {
  const graph = graph_m();
  return graph.ConstraintGraph.new(graph.ConstraintGraphDirection_Reverse, this, num_region_vars);
};

// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:49 outlives
OutlivesConstraintSet.prototype.outlives_ = function (this: OutlivesConstraintSet): readonly OutlivesConstraint[] {
  return this.outlives;
};

// impl<'tcx> Index<OutlivesConstraintIndex> for OutlivesConstraintSet<'tcx>
// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:59 index
OutlivesConstraintSet.prototype.index = function (this: OutlivesConstraintSet, i: OutlivesConstraintIndex): OutlivesConstraint {
  const c = this.outlives[i];
  if (c === undefined) panic(`index out of bounds: the len is ${this.outlives.length} but the index is ${i}`);
  return c;
};

// impl<'tcx> fmt::Debug for OutlivesConstraint<'tcx>
// PORT: `write!(formatter, ..)` formats each argument with a fresh (non-alternate) spec: `PLAIN`.
// rustc: compiler/rustc_borrowck/src/constraints/mod.rs:96 fmt
export const debug_OutlivesConstraint: Debug<OutlivesConstraint> = (v: OutlivesConstraint, _f: Fmt): string => {
  return `(${debug_RegionVid(v.sup, PLAIN)}: ${debug_RegionVid(v.sub, PLAIN)}) due to ${debug_Locations(v.locations, PLAIN)} (${debug_VarianceDiagInfo(v.variance_info, PLAIN)}) (${debug_ConstraintCategory(v.category, PLAIN)}) (span: ${debug_Span(v.span, PLAIN)})`;
};

// PORT: init order (header): graph.ts is read lazily.
let graph__m: typeof import("./graph.ts") | undefined;
function graph_m(): typeof import("./graph.ts") {
  return (graph__m ??= require("./graph.ts") as typeof import("./graph.ts"));
}
