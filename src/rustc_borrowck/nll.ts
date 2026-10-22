// Port of compiler/rustc_borrowck/src/nll.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! The entry point of the NLL borrow checker.
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` and `io::Result<T>` src/std's `IoResult<T>` (mir-contract,
// rustc_middle mir/pretty.ts). `Rc<DenseLocationMap>` / `Frozen<UniversalRegionRelations>` are the values.
// PORT: `polonius_facts: Option<AllFacts<RustcFacts>>` is `PoloniusFacts | undefined` (`PoloniusFacts` is `unknown`
// until vendor polonius-engine is ported, plan-m4 D7); `Output::compute` stops `unported` (only `-Zpolonius=legacy` or
// a consumer asking for polonius output reach it, and they already stop at `PoloniusFacts::default()`).
// PORT: the `BufWriter<File>` of `MirDumper::create_dump_file` is rustc_middle mir/pretty.ts's unexported `DumpFile`:
// its `drop()` (flush + close, the end of the `try` block's scope) is reached through a structural cast.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import { debug_Location } from "../rustc_middle/mir/mod.ts";
import { MirDumper, type PassWhere, PrettyPrintMirOptions } from "../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId } from "../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import type { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap } from "../rustc_mir_dataflow/points.ts";
// PORT: rustc_session is entered through its lib.ts (config.ts is not a fresh entry point; lib.ts of this crate).
import "../rustc_session/lib.ts";
import { Polonius } from "../rustc_session/config.ts";
import { debug_RegionVid } from "../rustc_type_ir/region_kind.gen.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { debug_IoError, type IoResult } from "../std/io.ts";
import { path_join } from "../std/path.ts";
import { unported } from "../std/panic.ts";
import { Ok, unwrap_result } from "../std/result.ts";
import type { Write } from "../vendor/anstream/stream.ts";
import type { BorrowSet } from "./borrow_set.gen.ts";
import { debug_BorrowIndex } from "./dataflow.gen.ts";
import { compute_sccs_applying_placeholder_outlives_constraints } from "./handle_placeholders.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "./lib.gen.ts";
import type { NllOutput } from "./nll.gen.ts";
import { PoloniusFactsExt } from "./polonius/legacy/facts.ts";
import type { PoloniusFacts, PoloniusOutput } from "./polonius/legacy/facts.gen.ts";
import type { PoloniusLocationTable } from "./polonius/legacy/location.gen.ts";
import * as polonius_legacy from "./polonius/legacy/mod.ts";
import type { PoloniusContext } from "./polonius/mod.gen.ts";
import { RegionInferenceContext } from "./region_infer/region_context.gen.ts";
import * as renumber from "./renumber.ts";
import type { BorrowCheckRootCtxt } from "./root_cx.gen.ts";
import { clone_UniversalRegionRelations, type UniversalRegionRelations } from "./type_check/free_region_relations.gen.ts";
import { clone_MirTypeckRegionConstraints, type MirTypeckRegionConstraints } from "./type_check/mod.gen.ts";
import { UniversalRegions } from "./universal_regions.gen.ts";

export * from "./nll.gen.ts";

/// Rewrites the regions in the MIR to use NLL variables, also scraping out the set of universal
/// regions (e.g., region parameters) declared on the function. That set will need to be given to
/// `compute_regions`.
// #[instrument(skip(infcx, body, promoted), level = "debug")]
// rustc: compiler/rustc_borrowck/src/nll.rs:56 replace_regions_in_mir
export function replace_regions_in_mir(infcx: BorrowckInferCtxt, body: Body, promoted: Body[]): UniversalRegions {
  const def = body.source.def_id().expect_local();

  // debug!(?def);

  // Compute named region information. This also renumbers the inputs/outputs.
  const universal_regions = UniversalRegions.new(infcx, def);

  // Replace all remaining regions with fresh inference variables.
  renumber.renumber_mir(infcx, body, promoted);

  const dumper = MirDumper.new(infcx.tcx, "renumber", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }

  return universal_regions;
}

/// Computes the closure requirements given the current inference state.
///
/// This is intended to be used by before [BorrowCheckRootCtxt::handle_opaque_type_uses]
/// because applying member constraints may rely on closure requirements.
/// This is frequently the case of async functions where pretty much everything
/// happens inside of the inner async block but the opaque only gets constrained
/// in the parent function.
// rustc: compiler/rustc_borrowck/src/nll.rs:85 compute_closure_requirements_modulo_opaques
export function compute_closure_requirements_modulo_opaques(
  infcx: BorrowckInferCtxt,
  body: Body,
  location_map: DenseLocationMap,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
): ClosureRegionRequirements | undefined {
  // FIXME(#146079): we shouldn't have to clone all this stuff here.
  // Computing the region graph should take at least some of it by reference/`Rc`.
  const lowered_constraints = compute_sccs_applying_placeholder_outlives_constraints(
    clone_MirTypeckRegionConstraints(constraints),
    universal_region_relations,
    infcx,
  );
  const [, closure_region_requirements, _nll_errors] = RegionInferenceContext.solve(
    infcx,
    lowered_constraints,
    clone_UniversalRegionRelations(universal_region_relations),
    location_map,
    body,
    undefined,
  );

  return closure_region_requirements;
}

/// Computes the (non-lexical) regions from the input MIR.
///
/// This may result in errors being reported.
// rustc: compiler/rustc_borrowck/src/nll.rs:114 compute_regions
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
  const polonius_output_wanted =
    (root_cx.consumer !== undefined ? root_cx.consumer.polonius_output() : false) ||
    Polonius.is_legacy_enabled(infcx.tcx.sess.opts.unstable_opts.polonius);

  const lowered_constraints = compute_sccs_applying_placeholder_outlives_constraints(constraints, universal_region_relations, infcx);

  // If requested, emit legacy polonius facts.
  polonius_legacy.emit_facts(
    polonius_facts,
    infcx.tcx,
    location_table,
    body,
    borrow_set,
    move_data,
    universal_region_relations,
    lowered_constraints,
  );

  // If requested for `-Zpolonius=next`, compute loan liveness information.
  // This is done prior to `RegionInferenceContext::new`, because we may add
  // additional liveness constraints.
  if (polonius_context !== undefined) {
    // PORT: `tcx.prof.generic_activity(..)` timer dropped (driver-m2 decision 8).
    polonius_context.compute_loan_liveness(
      infcx,
      lowered_constraints.liveness_constraints,
      lowered_constraints.outlives_constraints.outlives_(),
      universal_region_relations.universal_regions,
      body,
      move_data,
      location_map,
      borrow_set,
    );
  }

  // If requested: dump NLL facts, and run legacy polonius analysis.
  let polonius_output: PoloniusOutput | undefined;
  if (polonius_facts !== undefined) {
    if (infcx.tcx.sess.opts.unstable_opts.nll_facts) {
      const def_id = body.source.def_id();
      const def_path = infcx.tcx.def_path(def_id);
      const dir_path = path_join(infcx.tcx.sess.opts.unstable_opts.nll_facts_dir, def_path.to_filename_friendly_no_crate());
      unwrap_result(PoloniusFactsExt.write_to_dir(polonius_facts, dir_path, location_table), debug_IoError);
    }

    if (polonius_output_wanted) {
      const algorithm_ = infcx.tcx.env_var("POLONIUS_ALGORITHM");
      const _algorithm = algorithm_.$ === "Ok" ? algorithm_._0 : "Hybrid";
      // let algorithm = Algorithm::from_str(algorithm).unwrap();
      // debug!("compute_regions: using polonius algorithm {:?}", algorithm);
      // Some(Box::new(Output::compute(polonius_facts, algorithm, false)))
      polonius_output = unported("polonius_engine::Output::compute (vendor polonius-engine, plan-m4 D7, wave 26)");
    } else {
      polonius_output = undefined;
    }
  } else {
    polonius_output = undefined;
  }

  // Solve the region constraints.
  const [regioncx, closure_region_requirements, nll_errors] = RegionInferenceContext.solve(
    infcx,
    lowered_constraints,
    universal_region_relations,
    location_map,
    body,
    polonius_output,
  );

  return {
    regioncx,
    polonius_input: polonius_facts,
    polonius_output,
    opt_closure_req: closure_region_requirements,
    nll_errors,
    polonius_context,
  };
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
// rustc: compiler/rustc_borrowck/src/nll.rs:215 dump_nll_mir
export function dump_nll_mir(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
): void {
  const tcx = infcx.tcx;
  const dumper_ = MirDumper.new(tcx, "nll", body);
  if (dumper_ === undefined) return;

  // We want the NLL extra comments printed by default in NLL MIR dumps (they were removed in
  // #112346). Specifying `-Z mir-include-spans` on the CLI still has priority: for example,
  // they're always disabled in mir-opt tests to make working with blessed dumps easier.
  const mir_include_spans = infcx.tcx.sess.opts.unstable_opts.mir_include_spans;
  const options = new PrettyPrintMirOptions(mir_include_spans === "On" || mir_include_spans === "Nll");

  const extra_data = (pass_where: PassWhere, out: Write): IoResult<void> => {
    return emit_nll_mir(tcx, regioncx, closure_region_requirements, borrow_set, pass_where, out);
  };

  const dumper = dumper_.set_extra_data(extra_data).set_options(options);

  dumper.dump_mir(body);

  // Also dump the region constraint graph as a graphviz file.
  // let _ = try { .. };
  {
    const file = dumper.create_dump_file("regioncx.all.dot", body);
    if (file.$ === "Ok") {
      try {
        regioncx.dump_graphviz_raw_constraints(tcx, file._0);
      } finally {
        (file._0 as Write & { drop(): void }).drop();
      }
    }
  }

  // Also dump the region constraint SCC graph as a graphviz file.
  // let _ = try { .. };
  {
    const file = dumper.create_dump_file("regioncx.scc.dot", body);
    if (file.$ === "Ok") {
      try {
        regioncx.dump_graphviz_scc_constraints(tcx, file._0);
      } finally {
        (file._0 as Write & { drop(): void }).drop();
      }
    }
  }
}

/// Produces the actual NLL MIR sections to emit during the dumping process.
// rustc: compiler/rustc_borrowck/src/nll.rs:257 emit_nll_mir
export function emit_nll_mir(
  tcx: TyCtxt,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  pass_where: PassWhere,
  out: Write,
): IoResult<void> {
  let r: IoResult<unknown>;
  switch (pass_where.$) {
    // Before the CFG, dump out the values for each region variable.
    case "BeforeCFG": {
      if ((r = regioncx.dump_mir(tcx, out)).$ === "Err") return r;
      if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;

      if (closure_region_requirements !== undefined) {
        if ((r = out.write_fmt(["| Free Region Constraints\n"])).$ === "Err") return r;
        if ((r = for_each_region_constraint(tcx, closure_region_requirements, (msg) => out.write_fmt([`| ${msg}\n`]))).$ === "Err") return r;
        if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;
      }

      if (borrow_set.len() > 0) {
        if ((r = out.write_fmt(["| Borrows\n"])).$ === "Err") return r;
        for (const [borrow_idx, borrow_data] of borrow_set.iter_enumerated()) {
          if (
            (r = out.write_fmt([
              `| ${format_debug(borrow_idx, debug_BorrowIndex, PLAIN)}: issued at ${format_debug(borrow_data.reserve_location, debug_Location, PLAIN)} in ${format_debug(borrow_data.region, debug_RegionVid, PLAIN)}\n`,
            ])).$ === "Err"
          )
            return r;
        }
        if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;
      }
      break;
    }

    case "BeforeLocation":
      break;

    case "AfterTerminator":
      break;

    case "BeforeBlock":
    case "AfterLocation":
    case "AfterCFG":
      break;
  }
  return Ok(undefined);
}

// rustc: compiler/rustc_borrowck/src/nll.rs:301 dump_annotation
export function dump_annotation(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
): void {
  const tcx = infcx.tcx;
  const base_def_id = tcx.typeck_root_def_id(body.source.def_id());
  if (find_attr(HasAttrs_DefId.get_attrs(base_def_id, tcx), (a) => (a.$ === "RustcRegions" ? null : undefined)) === undefined) {
    return;
  }

  // When the enclosing function is tagged with `#[rustc_regions]`,
  // we dump out various bits of state as warnings. This is useful
  // for verifying that the compiler is behaving as expected. These
  // warnings focus on the closure region requirements -- for
  // viewing the intraprocedural state, the -Zdump-mir output is
  // better.

  const def_span = tcx.def_span(body.source.def_id());
  let err: Diag;
  if (closure_region_requirements !== undefined) {
    err = infcx.dcx().struct_span_note(def_span, "external requirements");

    regioncx.annotate(tcx, err);

    err.note(`number of external vids: ${closure_region_requirements.num_external_vids}`);

    // Dump the region constraints we are imposing *between* those
    // newly created variables.
    unwrap_result(
      for_each_region_constraint(tcx, closure_region_requirements, (msg) => {
        err.note(msg);
        return Ok(undefined);
      }),
      debug_IoError,
    );
  } else {
    err = infcx.dcx().struct_span_note(def_span, "no external requirements");
    regioncx.annotate(tcx, err);
  }

  // FIXME(@lcnr): We currently don't dump the inferred hidden types here.
  err.emit();
}

// rustc: compiler/rustc_borrowck/src/nll.rs:350 for_each_region_constraint
export function for_each_region_constraint(
  tcx: TyCtxt,
  closure_region_requirements: ClosureRegionRequirements,
  with_msg: (a0: string) => IoResult<void>,
): IoResult<void> {
  for (const req of closure_region_requirements.outlives_requirements) {
    let subject: string;
    const s = req.subject;
    switch (s.$) {
      case "Region":
        subject = format_debug(s._0, debug_RegionVid, PLAIN);
        break;
      case "Ty": {
        const ty = s._0;
        subject = with_no_trimmed_paths(() => display_Ty(ty.instantiate(tcx, (vid) => Region.new_var(tcx, vid))));
        break;
      }
    }
    const r = with_msg(`where ${subject}: ${format_debug(req.outlived_free_region, debug_RegionVid, PLAIN)}`);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

/// `pub(crate) trait ConstraintDescription`: implemented by `ConstraintCategory` (diagnostics/region_errors.rs, the impl
/// table `ConstraintDescription_ConstraintCategory`).
export interface ConstraintDescription<T> {
  // rustc: compiler/rustc_borrowck/src/nll.rs:371 description
  description(self: T): string;
}
