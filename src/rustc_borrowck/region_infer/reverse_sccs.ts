// Port of compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Range<usize>` (the values of `scc_regions`) is `{ start, end }` (generated); `impl Iterator<Item = RegionVid>`
// is an `Iterable<RegionVid>`.
import type { ConstraintSccIndex } from "../constraints/mod.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { depth_first_search } from "../../rustc_data_structures/graph/mod.ts";
import type { ConstraintSccs } from "./mod.gen.ts";
import { ReverseSccGraph } from "./reverse_sccs.gen.ts";

export * from "./reverse_sccs.gen.ts";

declare module "./reverse_sccs.gen.ts" {
  interface ReverseSccGraph {
    // reverse_sccs.rs:47
    upper_bounds(scc0: ConstraintSccIndex): Iterable<RegionVid>;
  }
  namespace ReverseSccGraph {
    // reverse_sccs.rs:23
    function compute(constraint_sccs: ConstraintSccs, universal_regions: UniversalRegions): ReverseSccGraph;
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs:23 compute
(ReverseSccGraph as unknown as { compute: typeof ReverseSccGraph.compute }).compute = function (
  constraint_sccs: ConstraintSccs,
  universal_regions: UniversalRegions,
): ReverseSccGraph {
  const graph = constraint_sccs.reverse();
  const paired_scc_regions: [ConstraintSccIndex, RegionVid][] = [];
  for (const region of universal_regions.universal_regions_iter()) {
    paired_scc_regions.push([constraint_sccs.scc(region), region]);
  }
  paired_scc_regions.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const universal_regions_ = paired_scc_regions.map(([_, region]) => region);

  const scc_regions = new Map<ConstraintSccIndex, { start: number; end: number }>();
  let start = 0;
  // PORT: `chunk_by(|&(scc1, _), &(scc2, _)| scc1 == scc2)` walked by index.
  let i = 0;
  while (i < paired_scc_regions.length) {
    let j = i + 1;
    while (j < paired_scc_regions.length && paired_scc_regions[j - 1]![0] === paired_scc_regions[j]![0]) j++;
    const chunk_len = j - i;
    const [scc, _] = paired_scc_regions[i]!;

    scc_regions.set(scc, { start, end: start + chunk_len });
    start += chunk_len;
    i = j;
  }
  return new ReverseSccGraph(graph, scc_regions, universal_regions_);
};

/// Find all universal regions that are required to outlive the given SCC.
// rustc: compiler/rustc_borrowck/src/region_infer/reverse_sccs.rs:47 upper_bounds
ReverseSccGraph.prototype.upper_bounds = function (this: ReverseSccGraph, scc0: ConstraintSccIndex): Iterable<RegionVid> {
  // PORT: the lazy `flat_map(..).copied().filter(..)` chain is a generator.
  const self = this;
  return (function* (): Generator<RegionVid> {
    const duplicates = new Set<RegionVid>();
    for (const scc1 of depth_first_search(self.graph, scc0)) {
      const range = self.scc_regions.get(scc1);
      if (range === undefined) continue;
      for (let k = range.start; k < range.end; k++) {
        const r = self.universal_regions[k]!;
        if (!duplicates.has(r)) {
          duplicates.add(r);
          yield r;
        }
      }
    }
  })();
};
