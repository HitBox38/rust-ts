// Port of compiler/rustc_borrowck/src/region_infer/graphviz.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! This module provides linkage between RegionInferenceContext and
//! `rustc_graphviz` traits, specialized to attaching borrowck analysis
//! data to rendered labels.
// PORT: rustc_graphviz is not ported (as for rustc_mir_dataflow framework/graphviz.ts): `dot::Id`, `dot::LabelText` are
// the `unknown` placeholders `dot_Id` / `dot_LabelText` below until it is; `dot::Nodes<N>` / `dot::Edges<E>` (`Cow<[T]>`)
// are `readonly T[]`. `RawConstraints` / `SccConstraints` are generated interfaces, so their `dot::Labeller` /
// `dot::GraphWalk` impls are impl tables (`Labeller_RawConstraints`, ...). `&mut dyn io::Write` is vendor/anstream's
// `Write` and `io::Result<()>` `IoResult<null>` (rustc_middle mir/pretty.ts precedent).
import type { ConstraintSccIndex, OutlivesConstraint } from "../constraints/mod.gen.ts";
import { debug_Location } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_UniverseIndex, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { debug_RegionVid, type RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import type { RawConstraints, SccConstraints } from "./graphviz.gen.ts";
import { RegionInferenceContext } from "./region_context.gen.ts";

export * from "./graphviz.gen.ts";

// PORT (lane bck-regions-b): as rustc_data_structures obligation_forest/mod.ts: `dot::Id<'_>` is its validated name (a
// string; `dot::Id::new` stops as UNPORTED), `dot::LabelText` is `{ $: "LabelStr", _0: string }` (only `LabelStr` is
// built here) and `dot::render` stops as UNPORTED. Only `-Zdump-mir=nll` (nll.rs `dump_nll_mir`) reaches them.
/** PORT: `rustc_graphviz::Id<'a>` (rustc_graphviz is not ported). */
export type dot_Id = string;
/** PORT: `rustc_graphviz::LabelText<'a>` (rustc_graphviz is not ported; only `LabelStr` is built here). */
export type dot_LabelText = { readonly $: "LabelStr"; readonly _0: string };

/** `dot::Id::new(name).unwrap()` (rustc_graphviz, not ported). */
function dot_Id_new(_name: string): dot_Id {
  return unported("rustc_graphviz::Id::new");
}

/** `dot::render(g, w)` (rustc_graphviz, not ported). */
function dot_render<N, E>(_g: RawConstraints | SccConstraints, _w: Write): IoResult<null> {
  return unported("rustc_graphviz::render");
}

// rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:15 render_outlives_constraint
function render_outlives_constraint(constraint: OutlivesConstraint): string {
  if (constraint.category.$ === "OutlivesUnnameablePlaceholder") {
    const unnameable = constraint.category._0;
    return `${debug_RegionVid(unnameable, PLAIN)} unnameable`;
  } else {
    switch (constraint.locations.$) {
      case "All":
        return "All(...)";
      case "Single": {
        const loc = constraint.locations._0;
        return debug_Location(loc, PLAIN);
      }
    }
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:26 render_universe
function render_universe(u: UniverseIndex): string {
  if (UniverseIndex.is_root(u)) {
    return "";
  }

  return `/${debug_UniverseIndex(u, PLAIN)}`;
}

// rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:34 render_region_vid
function render_region_vid(tcx: TyCtxt, rvid: RegionVid, regioncx: RegionInferenceContext): string {
  const universe_str = render_universe(regioncx.region_definition(rvid).universe);

  const e = regioncx.region_definition(rvid).external_name;
  const external_name = e === undefined ? undefined : e.get_name(tcx);
  const external_name_str = external_name !== undefined ? ` (${Symbol.as_str(external_name)})` : "";

  let extra_info: string;
  const origin = regioncx.region_definition(rvid).origin;
  switch (origin.$) {
    case "FreeRegion":
      extra_info = "";
      break;
    case "Placeholder": {
      const p = origin._0;
      switch (p.bound.kind.$) {
        case "Named": {
          const def_id = p.bound.kind._0;
          extra_info = ` (for<${Symbol.as_str(tcx.item_name(def_id))}>)`;
          break;
        }
        case "ClosureEnv":
        case "Anon":
          extra_info = " (for<'_>)";
          break;
        case "NamedForPrinting":
          return bug("only used for pretty printing");
      }
      break;
    }
    case "Existential":
      if (origin.name !== undefined) {
        const name = origin.name;
        extra_info = ` (ex<${Symbol.as_str(name)}>)`;
      } else {
        extra_info = ` (ex<'_>)`;
      }
      break;
  }

  return `${debug_RegionVid(rvid, PLAIN)}${universe_str}${external_name_str}${extra_info}`;
}

declare module "./region_context.gen.ts" {
  interface RegionInferenceContext {
    // graphviz.rs:69
    dump_graphviz_raw_constraints(tcx: TyCtxt, w: Write): IoResult<null>;
    // graphviz.rs:78
    dump_graphviz_scc_constraints(tcx: TyCtxt, w: Write): IoResult<null>;
  }
}

/// Write out the region constraint graph.
// rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:69 dump_graphviz_raw_constraints
RegionInferenceContext.prototype.dump_graphviz_raw_constraints = function (this: RegionInferenceContext, tcx: TyCtxt, w: Write): IoResult<null> {
  return dot_render<RegionVid, OutlivesConstraint>({ tcx, regioncx: this }, w);
};

/// Write out the region constraint SCC graph.
// rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:78 dump_graphviz_scc_constraints
RegionInferenceContext.prototype.dump_graphviz_scc_constraints = function (this: RegionInferenceContext, tcx: TyCtxt, w: Write): IoResult<null> {
  const nodes_per_scc: RegionVid[][] = this.constraint_sccs.all_sccs().map((_) => []);

  for (let i = 0; i < this.definitions.length; i++) {
    const region = i as RegionVid;
    const scc = this.constraint_sccs.scc(region);
    nodes_per_scc[scc]!.push(region);
  }

  return dot_render<ConstraintSccIndex, [ConstraintSccIndex, ConstraintSccIndex]>({ tcx, regioncx: this, nodes_per_scc }, w);
};

// impl<'a, 'this, 'tcx> dot::Labeller<'this> for RawConstraints<'a, 'tcx> (type Node = RegionVid; type Edge = OutlivesConstraint)
export const Labeller_RawConstraints = {
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:104 graph_id
  graph_id(self: RawConstraints): dot_Id {
    return dot_Id_new("RegionInferenceContext");
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:107 node_id
  node_id(self: RawConstraints, n: RegionVid): dot_Id {
    return dot_Id_new(`r${n}`);
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:110 node_shape
  node_shape(self: RawConstraints, _node: RegionVid): dot_LabelText | undefined {
    return { $: "LabelStr", _0: "box" };
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:113 node_label
  node_label(self: RawConstraints, n: RegionVid): dot_LabelText {
    return { $: "LabelStr", _0: render_region_vid(self.tcx, n, self.regioncx) };
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:116 edge_label
  edge_label(self: RawConstraints, e: OutlivesConstraint): dot_LabelText {
    return { $: "LabelStr", _0: render_outlives_constraint(e) };
  },
};

// impl<'a, 'this, 'tcx> dot::GraphWalk<'this> for RawConstraints<'a, 'tcx>
export const GraphWalk_RawConstraints = {
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:125 nodes
  nodes(self: RawConstraints): readonly RegionVid[] {
    const vids: RegionVid[] = Array.from({ length: self.regioncx.definitions.length }, (_, i) => i as RegionVid);
    return vids;
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:129 edges
  edges(self: RawConstraints): readonly OutlivesConstraint[] {
    return self.regioncx.constraints.outlives_();
  },
  // Render `a: b` as `a -> b`, indicating the flow
  // of data during inference.
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:136 source
  source(self: RawConstraints, edge: OutlivesConstraint): RegionVid {
    return edge.sup;
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:140 target
  target(self: RawConstraints, edge: OutlivesConstraint): RegionVid {
    return edge.sub;
  },
};

// impl<'a, 'this, 'tcx> dot::Labeller<'this> for SccConstraints<'a, 'tcx> (type Node = ConstraintSccIndex; type Edge = (ConstraintSccIndex, ConstraintSccIndex))
export const Labeller_SccConstraints = {
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:155 graph_id
  graph_id(self: SccConstraints): dot_Id {
    return dot_Id_new("RegionInferenceContext");
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:158 node_id
  node_id(self: SccConstraints, n: ConstraintSccIndex): dot_Id {
    return dot_Id_new(`r${n}`);
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:161 node_shape
  node_shape(self: SccConstraints, _node: ConstraintSccIndex): dot_LabelText | undefined {
    return { $: "LabelStr", _0: "box" };
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:164 node_label
  node_label(self: SccConstraints, n: ConstraintSccIndex): dot_LabelText {
    const nodes_str = self.nodes_per_scc[n]!.map((n) => render_region_vid(self.tcx, n, self.regioncx)).join(", ");
    return { $: "LabelStr", _0: `SCC(${n}) = {${nodes_str}}` };
  },
};

// impl<'a, 'this, 'tcx> dot::GraphWalk<'this> for SccConstraints<'a, 'tcx>
export const GraphWalk_SccConstraints = {
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:177 nodes
  nodes(self: SccConstraints): readonly ConstraintSccIndex[] {
    const vids: ConstraintSccIndex[] = self.regioncx.constraint_sccs.all_sccs();
    return vids;
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:181 edges
  edges(self: SccConstraints): readonly [ConstraintSccIndex, ConstraintSccIndex][] {
    const edges: [ConstraintSccIndex, ConstraintSccIndex][] = [];
    for (const scc_a of self.regioncx.constraint_sccs.all_sccs()) {
      for (const scc_b of self.regioncx.constraint_sccs.successors(scc_a)) {
        edges.push([scc_a, scc_b]);
      }
    }

    return edges;
  },
  // Render `a: b` as `a -> b`, indicating the flow
  // of data during inference.
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:201 source
  source(self: SccConstraints, edge: [ConstraintSccIndex, ConstraintSccIndex]): ConstraintSccIndex {
    return edge[0];
  },
  // rustc: compiler/rustc_borrowck/src/region_infer/graphviz.rs:205 target
  target(self: SccConstraints, edge: [ConstraintSccIndex, ConstraintSccIndex]): ConstraintSccIndex {
    return edge[1];
  },
};
