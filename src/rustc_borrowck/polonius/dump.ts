// Port of compiler/rustc_borrowck/src/polonius/dump.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` (the `std::io::Write` port) and `io::Result<T>` src/std's
// `IoResult<T>` (mir-contract, rustc_middle mir/pretty.ts header).
// PORT: `CachedLivenessSource` / `MirDumpCollector` are data-only structs (generated interfaces); their trait impls are
// the impl tables `LivenessSource_CachedLivenessSource` / `LocalizedConstraintGraphVisitor_MirDumpCollector`.
// PORT: `const TEMPLATE: &str = include_str!("./dump/polonius-mir-dump.template.html")` (dump.rs:26) is not declared
// yet: the fill lane brings the template's text (compiler/rustc_borrowck/src/polonius/dump/polonius-mir-dump.template.html
// at the pin) into this module as a string constant, byte for byte.
import type { Body, Location } from "../../rustc_middle/mir/mod.ts";
import type { PassWhere } from "../../rustc_middle/mir/pretty.gen.ts";
import type { MirDumper } from "../../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "../lib.gen.ts";
import type { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { LocalizedNode } from "./constraints.gen.ts";
import { type LocalizedConstraintGraphVisitor, LocalizedConstraintGraphVisitor_provided } from "./constraints.ts";
import type { CachedLivenessSource, LocalizedOutlivesConstraint, MirDumpCollector } from "./dump.gen.ts";
import type { RegionLiveness } from "./liveness.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import type { PoloniusContext } from "./mod.gen.ts";
export * from "./dump.gen.ts";

// impl<'a, 'tcx> LivenessSource for CachedLivenessSource<'a, 'tcx>
export const LivenessSource_CachedLivenessSource: LivenessSource<CachedLivenessSource> = {
  // stub: compiler/rustc_borrowck/src/polonius/dump.rs:36 liveness_for_region (lane bck-polonius)
  liveness_for_region(self: CachedLivenessSource, region: RegionVid): RegionLiveness {
    return unported("rustc_borrowck::polonius::dump::CachedLivenessSource::liveness_for_region");
  },
};

/// `-Zdump-mir=polonius` dumps MIR annotated with NLL and polonius specific information.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:47 dump_polonius_mir (lane bck-polonius)
export function dump_polonius_mir(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  polonius_context: PoloniusContext | undefined,
): void {
  return unported("rustc_borrowck::polonius::dump::dump_polonius_mir");
}

// impl LocalizedConstraintGraphVisitor for MirDumpCollector
export const LocalizedConstraintGraphVisitor_MirDumpCollector: LocalizedConstraintGraphVisitor<MirDumpCollector> = {
  ...LocalizedConstraintGraphVisitor_provided,
  // stub: compiler/rustc_borrowck/src/polonius/dump.rs:123 on_node_traversed (lane bck-polonius)
  on_node_traversed(self: MirDumpCollector, loan: BorrowIndex, node: LocalizedNode, _is_live: boolean): void {
    return unported("rustc_borrowck::polonius::dump::MirDumpCollector::on_node_traversed");
  },

  // stub: compiler/rustc_borrowck/src/polonius/dump.rs:127 on_successor_discovered (lane bck-polonius)
  on_successor_discovered(self: MirDumpCollector, current_node: LocalizedNode, successor: LocalizedNode): void {
    return unported("rustc_borrowck::polonius::dump::MirDumpCollector::on_successor_discovered");
  },
};

/// The polonius dump consists of:
/// - the NLL MIR
/// - the list of polonius localized constraints
/// - a mermaid graph of the CFG
/// - a mermaid graph of the NLL regions and the constraints between them
/// - a mermaid graph of the NLL SCCs and the constraints between them
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:143 emit_polonius_dump (lane bck-polonius)
function emit_polonius_dump(
  dumper: MirDumper,
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
  collector: MirDumpCollector,
  out: Write,
): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_polonius_dump");
}

/// Emits the polonius MIR, as escaped HTML.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:224 emit_html_mir (lane bck-polonius)
function emit_html_mir(dumper: MirDumper, body: Body, out: Write): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_html_mir");
}

/// Produces the actual NLL + Polonius MIR sections to emit during the dumping process.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:256 emit_polonius_mir (lane bck-polonius)
function emit_polonius_mir(
  tcx: TyCtxt,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  localized_outlives_constraints: readonly LocalizedOutlivesConstraint[],
  pass_where: PassWhere,
  out: Write,
): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_polonius_mir");
}

/// Emits a mermaid flowchart of the CFG blocks and edges, similar to the graphviz version.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:299 emit_mermaid_cfg (lane bck-polonius)
function emit_mermaid_cfg(body: Body, out: Write): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_mermaid_cfg");
}

/// Emits a region's label: index, universe, external name.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:351 render_region (lane bck-polonius)
function render_region(tcx: TyCtxt, region: RegionVid, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::render_region");
}

/// Emits a mermaid flowchart of the NLL regions and the outlives constraints between them, similar
/// to the graphviz version.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:372 emit_mermaid_nll_regions (lane bck-polonius)
function emit_mermaid_nll_regions(tcx: TyCtxt, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_mermaid_nll_regions");
}

/// Emits a mermaid flowchart of the NLL SCCs and the outlives constraints between them, similar
/// to the graphviz version.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:424 emit_mermaid_nll_sccs (lane bck-polonius)
function emit_mermaid_nll_sccs(tcx: TyCtxt, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_mermaid_nll_sccs");
}

/// Emits a mermaid flowchart of the polonius localized outlives constraints, with subgraphs per
/// region, and loan introductions.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:464 emit_mermaid_constraint_graph (lane bck-polonius)
function emit_mermaid_constraint_graph(
  borrow_set: BorrowSet,
  location_map: DenseLocationMap,
  localized_outlives_constraints: readonly LocalizedOutlivesConstraint[],
  out: Write,
): IoResult<number> {
  return unported("rustc_borrowck::polonius::dump::emit_mermaid_constraint_graph");
}

/// Emits the reachability of loans: a list of all nodes reached while traversing the polonius
/// constraint graph.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:531 emit_loan_reachability (lane bck-polonius)
function emit_loan_reachability(
  borrow_set: BorrowSet,
  liveness: LivenessValues,
  reachability: Map<BorrowIndex, LocalizedNode[]>,
  out: Write,
): IoResult<void> {
  return unported("rustc_borrowck::polonius::dump::emit_loan_reachability");
}

// stub: compiler/rustc_borrowck/src/polonius/dump.rs:587 region_name (lane bck-polonius)
function region_name(region: RegionVid): string {
  return unported("rustc_borrowck::polonius::dump::region_name");
}

/// A MIR location looks like `bb5[2]`. As that is not a syntactically valid mermaid node id,
/// transform it into `BB5_2`.
// stub: compiler/rustc_borrowck/src/polonius/dump.rs:592 location_name (lane bck-polonius)
function location_name(location: Location): string {
  return unported("rustc_borrowck::polonius::dump::location_name");
}

// stub: compiler/rustc_borrowck/src/polonius/dump.rs:595 node_name (lane bck-polonius)
function node_name(region: RegionVid, location: Location): string {
  return unported("rustc_borrowck::polonius::dump::node_name");
}
