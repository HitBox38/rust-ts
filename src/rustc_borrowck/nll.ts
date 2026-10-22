// Port of compiler/rustc_borrowck/src/nll.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! The entry point of the NLL borrow checker.
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` and `io::Result<T>` src/std's `IoResult<T>` (mir-contract,
// rustc_middle mir/pretty.ts). `Rc<DenseLocationMap>` / `Frozen<UniversalRegionRelations>` are the values.
// PORT: `polonius_facts: Option<AllFacts<RustcFacts>>` is `PoloniusFacts | undefined` (`PoloniusFacts` is `unknown`
// until vendor polonius-engine is ported, plan-m4 D7).
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { PassWhere } from "../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap } from "../rustc_mir_dataflow/points.ts";
import type { IoResult } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import type { Write } from "../vendor/anstream/stream.ts";
import type { BorrowSet } from "./borrow_set.gen.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "./lib.gen.ts";
import type { NllOutput } from "./nll.gen.ts";
import type { PoloniusFacts } from "./polonius/legacy/facts.gen.ts";
import type { PoloniusLocationTable } from "./polonius/legacy/location.gen.ts";
import type { PoloniusContext } from "./polonius/mod.gen.ts";
import type { RegionInferenceContext } from "./region_infer/region_context.gen.ts";
import type { BorrowCheckRootCtxt } from "./root_cx.gen.ts";
import type { UniversalRegionRelations } from "./type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "./type_check/mod.gen.ts";
import type { UniversalRegions } from "./universal_regions.gen.ts";

export * from "./nll.gen.ts";

/// Rewrites the regions in the MIR to use NLL variables, also scraping out the set of universal
/// regions (e.g., region parameters) declared on the function. That set will need to be given to
/// `compute_regions`.
// stub: compiler/rustc_borrowck/src/nll.rs:56 replace_regions_in_mir (lane bck-nll)
export function replace_regions_in_mir(infcx: BorrowckInferCtxt, body: Body, promoted: Body[]): UniversalRegions {
  return unported("rustc_borrowck::nll::replace_regions_in_mir");
}

/// Computes the closure requirements given the current inference state.
///
/// This is intended to be used by before [BorrowCheckRootCtxt::handle_opaque_type_uses]
/// because applying member constraints may rely on closure requirements.
/// This is frequently the case of async functions where pretty much everything
/// happens inside of the inner async block but the opaque only gets constrained
/// in the parent function.
// stub: compiler/rustc_borrowck/src/nll.rs:85 compute_closure_requirements_modulo_opaques (lane bck-nll)
export function compute_closure_requirements_modulo_opaques(
  infcx: BorrowckInferCtxt,
  body: Body,
  location_map: DenseLocationMap,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
): ClosureRegionRequirements | undefined {
  return unported("rustc_borrowck::nll::compute_closure_requirements_modulo_opaques");
}

/// Computes the (non-lexical) regions from the input MIR.
///
/// This may result in errors being reported.
// stub: compiler/rustc_borrowck/src/nll.rs:114 compute_regions (lane bck-nll)
export function compute_regions(
  root_cx: BorrowCheckRootCtxt,
  infcx: BorrowckInferCtxt,
  body: Body,
  location_table: PoloniusLocationTable,
  move_data: MoveData,
  borrow_set: BorrowSet,
  location_map: DenseLocationMap,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
  polonius_facts: PoloniusFacts | undefined,
  polonius_context: PoloniusContext | undefined,
): NllOutput {
  return unported("rustc_borrowck::nll::compute_regions");
}

/// `-Zdump-mir=nll` dumps MIR annotated with NLL specific information:
/// - free regions
/// - inferred region values
/// - region liveness
/// - inference constraints and their causes
///
/// As well as graphviz `.dot` visualizations of:
/// - the region constraints graph
/// - the region SCC graph
// stub: compiler/rustc_borrowck/src/nll.rs:215 dump_nll_mir (lane bck-nll)
export function dump_nll_mir(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
): void {
  return unported("rustc_borrowck::nll::dump_nll_mir");
}

/// Produces the actual NLL MIR sections to emit during the dumping process.
// stub: compiler/rustc_borrowck/src/nll.rs:257 emit_nll_mir (lane bck-nll)
export function emit_nll_mir(
  tcx: TyCtxt,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  pass_where: PassWhere,
  out: Write,
): IoResult<void> {
  return unported("rustc_borrowck::nll::emit_nll_mir");
}

// stub: compiler/rustc_borrowck/src/nll.rs:301 dump_annotation (lane bck-nll)
export function dump_annotation(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
): void {
  return unported("rustc_borrowck::nll::dump_annotation");
}

// stub: compiler/rustc_borrowck/src/nll.rs:350 for_each_region_constraint (lane bck-nll)
export function for_each_region_constraint(
  tcx: TyCtxt,
  closure_region_requirements: ClosureRegionRequirements,
  with_msg: (a0: string) => IoResult<void>,
): IoResult<void> {
  return unported("rustc_borrowck::nll::for_each_region_constraint");
}

/// `pub(crate) trait ConstraintDescription`: implemented by `ConstraintCategory` (diagnostics/region_errors.rs, the impl
/// table `ConstraintDescription_ConstraintCategory`).
export interface ConstraintDescription<T> {
  // rustc: compiler/rustc_borrowck/src/nll.rs:371 description
  description(self: T): string;
}
