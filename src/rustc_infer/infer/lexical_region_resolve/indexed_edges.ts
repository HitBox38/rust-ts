// Port of compiler/rustc_infer/src/infer/lexical_region_resolve/indexed_edges.rs (lane infer-regions).
//
// `EdgeDirection`, `ConstraintPair` and `IndexedConstraintEdges` are generated into indexed_edges.gen.ts; the methods
// are assigned here (`build_index` as a static).
//
// Init order: top-level code here may touch only ../../decls.ts, this file's .gen.ts and other crates; every other
// rustc_infer export is read inside function bodies only.

import { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { assert, unreachable } from "../../../std/panic.ts";
import type { RegionConstraintData } from "../region_constraints/mod.ts";
import { type ConstraintPair, type EdgeDirection, IndexedConstraintEdges } from "./indexed_edges.gen.ts";

export * from "./indexed_edges.gen.ts";

declare module "./indexed_edges.gen.ts" {
  interface IndexedConstraintEdges {
    // indexed_edges.rs:78
    adjacent_edges(region_vid: RegionVid, dir: EdgeDirection): readonly ConstraintPair[];
  }
  namespace IndexedConstraintEdges {
    // indexed_edges.rs:26
    export let build_index: (num_vars: number, data: RegionConstraintData) => IndexedConstraintEdges;
  }
}

/** `IndexVec` indexing (panics out of bounds). */
function at<T>(v: readonly T[], i: number): T {
  assert(i < v.length, `index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// PORT: `ConstraintPair<'data>` borrows the origin (`&'data SubregionOrigin`): the pairs share the data's origin objects.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/indexed_edges.rs:26 build_index
IndexedConstraintEdges.build_index = function (num_vars: number, data: RegionConstraintData): IndexedConstraintEdges {
  const out_edges: ConstraintPair[][] = [];
  for (let i = 0; i < num_vars; i++) out_edges.push([]);
  const in_edges: ConstraintPair[][] = [];
  for (let i = 0; i < num_vars; i++) in_edges.push([]);

  for (const [c0, origin] of data.constraints) {
    for (const c of c0.iter_outlives()) {
      const pair: ConstraintPair = [c, origin];
      // Only push a var out-edge for `VarSub...` constraints.
      switch (c.kind) {
        case "VarSubVar":
        case "VarSubReg":
          at(out_edges, RegionVid.as_usize(c.sub.as_var())).push(pair);
          break;

        case "RegSubVar":
        case "RegSubReg":
          break;

        case "VarEqVar":
        case "VarEqReg":
        case "RegEqReg":
          unreachable();
      }
    }
  }

  // FIXME: We should merge this loop with the above one eventually.
  // Index in-edges in reverse order, to match what current tests expect.
  // (It's unclear whether this is important or not.)

  for (let k = data.constraints.length - 1; k >= 0; k--) {
    const [c0, origin] = data.constraints[k]!;
    for (const c of c0.iter_outlives()) {
      const pair: ConstraintPair = [c, origin];
      // Only push a var in-edge for `...SubVar` constraints.
      switch (c.kind) {
        case "VarSubVar":
        case "RegSubVar":
          at(in_edges, RegionVid.as_usize(c.sup.as_var())).push(pair);
          break;

        case "VarSubReg":
        case "RegSubReg":
          break;

        case "VarEqVar":
        case "VarEqReg":
        case "RegEqReg":
          unreachable();
      }
    }
  }

  return new IndexedConstraintEdges(out_edges, in_edges);
};

/// Returns either the out-edges or in-edges of the specified region var,
/// as selected by `dir`.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/indexed_edges.rs:78 adjacent_edges
IndexedConstraintEdges.prototype.adjacent_edges = function (this: IndexedConstraintEdges, region_vid: RegionVid, dir: EdgeDirection): readonly ConstraintPair[] {
  let edges: ConstraintPair[][];
  switch (dir) {
    case "Out":
      edges = this.out_edges;
      break;
    case "In":
      edges = this.in_edges;
      break;
  }
  return at(edges, RegionVid.as_usize(region_vid));
};
