// Port of compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Range<usize>` (the values of `scc_regions`) is `{ start, end }` (generated); `impl Iterator<Item = RegionVid>`
// is an `Iterable<RegionVid>`.
import type { ConstraintSccIndex } from "../constraints/mod.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { ConstraintSccs } from "./mod.gen.ts";
import { ReverseSccGraph } from "./reverse_sccs.gen.ts";

export * from "./reverse_sccs.gen.ts";

declare module "./reverse_sccs.gen.ts" {
  interface ReverseSccGraph {
    // reverse_sccs.rs:47 (lane bck-regions-b)
    upper_bounds(scc0: ConstraintSccIndex): Iterable<RegionVid>;
  }
  namespace ReverseSccGraph {
    // reverse_sccs.rs:23 (lane bck-regions-b)
    function compute(constraint_sccs: ConstraintSccs, universal_regions: UniversalRegions): ReverseSccGraph;
  }
}

// stub: compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs:23 compute (lane bck-regions-b)
(ReverseSccGraph as unknown as { compute: typeof ReverseSccGraph.compute }).compute = function (
  constraint_sccs: ConstraintSccs,
  universal_regions: UniversalRegions,
): ReverseSccGraph {
  return unported("rustc_borrowck::region_infer::reverse_sccs::ReverseSccGraph::compute");
};

/// Find all universal regions that are required to outlive the given SCC.
// stub: compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs:47 upper_bounds (lane bck-regions-b)
ReverseSccGraph.prototype.upper_bounds = function (this: ReverseSccGraph, scc0: ConstraintSccIndex): Iterable<RegionVid> {
  return unported("rustc_borrowck::region_infer::reverse_sccs::ReverseSccGraph::upper_bounds");
};
