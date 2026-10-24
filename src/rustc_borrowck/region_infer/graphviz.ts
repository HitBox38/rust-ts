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
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import type { RawConstraints, SccConstraints } from "./graphviz.gen.ts";
import { RegionInferenceContext } from "./region_context.gen.ts";

export * from "./graphviz.gen.ts";

/** PORT: `rustc_graphviz::Id<'a>` (rustc_graphviz is not ported). */
export type dot_Id = unknown;
/** PORT: `rustc_graphviz::LabelText<'a>` (rustc_graphviz is not ported). */
export type dot_LabelText = unknown;

// stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:15 render_outlives_constraint (lane bck-regions-b)
function render_outlives_constraint(constraint: OutlivesConstraint): string {
  return unported("rustc_borrowck::region_infer::graphviz::render_outlives_constraint");
}

// stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:26 render_universe (lane bck-regions-b)
function render_universe(u: UniverseIndex): string {
  return unported("rustc_borrowck::region_infer::graphviz::render_universe");
}

// stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:34 render_region_vid (lane bck-regions-b)
function render_region_vid(tcx: TyCtxt, rvid: RegionVid, regioncx: RegionInferenceContext): string {
  return unported("rustc_borrowck::region_infer::graphviz::render_region_vid");
}
void render_outlives_constraint;
void render_universe;
void render_region_vid;

declare module "./region_context.gen.ts" {
  interface RegionInferenceContext {
    // graphviz.rs:69 (lane bck-regions-b)
    dump_graphviz_raw_constraints(tcx: TyCtxt, w: Write): IoResult<null>;
    // graphviz.rs:78 (lane bck-regions-b)
    dump_graphviz_scc_constraints(tcx: TyCtxt, w: Write): IoResult<null>;
  }
}

/// Write out the region constraint graph.
// stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:69 dump_graphviz_raw_constraints (lane bck-regions-b)
RegionInferenceContext.prototype.dump_graphviz_raw_constraints = function (this: RegionInferenceContext, tcx: TyCtxt, w: Write): IoResult<null> {
  return unported("rustc_borrowck::region_infer::graphviz::RegionInferenceContext::dump_graphviz_raw_constraints");
};

/// Write out the region constraint SCC graph.
// stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:78 dump_graphviz_scc_constraints (lane bck-regions-b)
RegionInferenceContext.prototype.dump_graphviz_scc_constraints = function (this: RegionInferenceContext, tcx: TyCtxt, w: Write): IoResult<null> {
  return unported("rustc_borrowck::region_infer::graphviz::RegionInferenceContext::dump_graphviz_scc_constraints");
};

// impl<'a, 'this, 'tcx> dot::Labeller<'this> for RawConstraints<'a, 'tcx> (type Node = RegionVid; type Edge = OutlivesConstraint)
export const Labeller_RawConstraints = {
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:104 graph_id (lane bck-regions-b)
  graph_id(self: RawConstraints): dot_Id {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::graph_id");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:107 node_id (lane bck-regions-b)
  node_id(self: RawConstraints, n: RegionVid): dot_Id {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::node_id");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:110 node_shape (lane bck-regions-b)
  node_shape(self: RawConstraints, _node: RegionVid): dot_LabelText | undefined {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::node_shape");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:113 node_label (lane bck-regions-b)
  node_label(self: RawConstraints, n: RegionVid): dot_LabelText {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::node_label");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:116 edge_label (lane bck-regions-b)
  edge_label(self: RawConstraints, e: OutlivesConstraint): dot_LabelText {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::edge_label");
  },
};

// impl<'a, 'this, 'tcx> dot::GraphWalk<'this> for RawConstraints<'a, 'tcx>
export const GraphWalk_RawConstraints = {
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:125 nodes (lane bck-regions-b)
  nodes(self: RawConstraints): readonly RegionVid[] {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::nodes");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:129 edges (lane bck-regions-b)
  edges(self: RawConstraints): readonly OutlivesConstraint[] {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::edges");
  },
  // Render `a: b` as `a -> b`, indicating the flow
  // of data during inference.
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:136 source (lane bck-regions-b)
  source(self: RawConstraints, edge: OutlivesConstraint): RegionVid {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::source");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:140 target (lane bck-regions-b)
  target(self: RawConstraints, edge: OutlivesConstraint): RegionVid {
    return unported("rustc_borrowck::region_infer::graphviz::RawConstraints::target");
  },
};

// impl<'a, 'this, 'tcx> dot::Labeller<'this> for SccConstraints<'a, 'tcx> (type Node = ConstraintSccIndex; type Edge = (ConstraintSccIndex, ConstraintSccIndex))
export const Labeller_SccConstraints = {
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:155 graph_id (lane bck-regions-b)
  graph_id(self: SccConstraints): dot_Id {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::graph_id");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:158 node_id (lane bck-regions-b)
  node_id(self: SccConstraints, n: ConstraintSccIndex): dot_Id {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::node_id");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:161 node_shape (lane bck-regions-b)
  node_shape(self: SccConstraints, _node: ConstraintSccIndex): dot_LabelText | undefined {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::node_shape");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:164 node_label (lane bck-regions-b)
  node_label(self: SccConstraints, n: ConstraintSccIndex): dot_LabelText {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::node_label");
  },
};

// impl<'a, 'this, 'tcx> dot::GraphWalk<'this> for SccConstraints<'a, 'tcx>
export const GraphWalk_SccConstraints = {
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:177 nodes (lane bck-regions-b)
  nodes(self: SccConstraints): readonly ConstraintSccIndex[] {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::nodes");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:181 edges (lane bck-regions-b)
  edges(self: SccConstraints): readonly [ConstraintSccIndex, ConstraintSccIndex][] {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::edges");
  },
  // Render `a: b` as `a -> b`, indicating the flow
  // of data during inference.
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:201 source (lane bck-regions-b)
  source(self: SccConstraints, edge: [ConstraintSccIndex, ConstraintSccIndex]): ConstraintSccIndex {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::source");
  },
  // stub: compiler/rustc_borrowck/src/region_infer/graphviz.rs:205 target (lane bck-regions-b)
  target(self: SccConstraints, edge: [ConstraintSccIndex, ConstraintSccIndex]): ConstraintSccIndex {
    return unported("rustc_borrowck::region_infer::graphviz::SccConstraints::target");
  },
};
