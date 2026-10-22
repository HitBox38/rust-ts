// Port of compiler/rustc_borrowck/src/region_infer/dump_mir.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! As part of generating the regions, if you enable `-Zdump-mir=nll`,
//! we will generate an annotated copy of the MIR that includes the
//! state of region inference. This code handles emitting the region
//! context internal state.
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` and `io::Result<()>` src/std's `IoResult<null>` (mir-contract
// precedent, rustc_middle mir/pretty.ts); `&mut dyn FnMut(&str) -> io::Result<()>` is an arrow fn.
// PORT: the `{r:rw$?}` / `{c:cw$?}` / `{ui:4?}` widths have no effect: `RegionVid` / `UniverseIndex` (newtype_index
// `debug_format`, `write!`) and `RegionClassification` (derived, `write_str`) ignore the formatter's width (the oracle's
// dump shows `| '?0 | Global | ..`), so the values are written unpadded.
import { debug_Location } from "../../rustc_middle/mir/mod.ts";
import { debug_ConstraintCategory } from "../../rustc_middle/mir/query.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { debug_RegionVid, type RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { debug_RegionClassification } from "../universal_regions.gen.ts";
import { RegionInferenceContext } from "./region_context.gen.ts";

// Room for "'_#NNNNr" before things get misaligned.
// Easy enough to fix if this ever doesn't seem like
// enough.
const REGION_WIDTH: number = 8;
void REGION_WIDTH;

declare module "./region_context.gen.ts" {
  interface RegionInferenceContext {
    // dump_mir.rs:21 (lane bck-regions-b)
    dump_mir(tcx: TyCtxt, out: Write): IoResult<null>;
    // dump_mir.rs:65 (lane bck-regions-b)
    for_each_constraint(tcx: TyCtxt, with_msg: (a0: string) => IoResult<null>): IoResult<null>;
  }
}

/// Write out our state into the `.mir` files.
// rustc: compiler/rustc_borrowck/src/region_infer/dump_mir.rs:21 dump_mir
RegionInferenceContext.prototype.dump_mir = function (this: RegionInferenceContext, tcx: TyCtxt, out: Write): IoResult<null> {
  let r: IoResult<unknown>;
  if ((r = out.write_fmt(["| Free Region Mapping\n"])).$ === "Err") return r;

  for (const region of this.regions()) {
    if (this.definitions[region]!.origin.$ === "FreeRegion") {
      const classification = unwrap(this.universal_regions().region_classification(region));
      const outlived_by = this.universal_region_relations.regions_outlived_by(region);
      if (
        (r = out.write_fmt([
          `| ${debug_RegionVid(region, PLAIN)} | ${debug_RegionClassification(classification, PLAIN)} | ${debug_vec(outlived_by, PLAIN, debug_RegionVid)}\n`,
        ])).$ === "Err"
      )
        return r;
    }
  }

  if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;
  if ((r = out.write_fmt(["| Inferred Region Values\n"])).$ === "Err") return r;
  for (const region of this.regions()) {
    if (
      (r = out.write_fmt([
        `| ${debug_RegionVid(region, PLAIN)} | ${debug_UniverseIndex(this.max_nameable_universe(this.constraint_sccs.scc(region)), PLAIN)} | ${this.region_value_str(region)}\n`,
      ])).$ === "Err"
    )
      return r;
  }

  if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;
  if ((r = out.write_fmt(["| Inference Constraints\n"])).$ === "Err") return r;
  if ((r = this.for_each_constraint(tcx, (msg) => out.write_fmt([`| ${msg}\n`]) as IoResult<null>)).$ === "Err") return r;

  return Ok(null);
};

/// Debugging aid: Invokes the `with_msg` callback repeatedly with
/// our internal region constraints. These are dumped into the
/// -Zdump-mir file so that we can figure out why the region
/// inference resulted in the values that it did when debugging.
// rustc: compiler/rustc_borrowck/src/region_infer/dump_mir.rs:65 for_each_constraint
RegionInferenceContext.prototype.for_each_constraint = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  with_msg: (a0: string) => IoResult<null>,
): IoResult<null> {
  let r: IoResult<null>;
  for (let i = 0; i < this.definitions.length; i++) {
    const region = i as RegionVid;
    const value = this.liveness_constraints_().pretty_print_live_points(region);
    if (value !== "{}") {
      if ((r = with_msg(`${debug_RegionVid(region, PLAIN)} live at ${value}`)).$ === "Err") return r;
    }
  }

  const constraints: OutlivesConstraint[] = [...this.constraints.outlives_()];
  // `sort_by_key(|c| (c.sup, c.sub))` (stable)
  constraints.sort((a, b) => (a.sup !== b.sup ? a.sup - b.sup : a.sub - b.sub));
  for (const constraint of constraints) {
    const { sup, sub, locations, category, span } = constraint;
    let name: string;
    let arg: string;
    switch (locations.$) {
      case "All": {
        const span = locations._0;
        name = "All";
        arg = tcx.sess.source_map().span_to_diagnostic_string(span);
        break;
      }
      case "Single": {
        const loc = locations._0;
        name = "Single";
        arg = debug_Location(loc, PLAIN);
        break;
      }
    }
    if (
      (r = with_msg(
        `${debug_RegionVid(sup, PLAIN)}: ${debug_RegionVid(sub, PLAIN)} due to ${debug_ConstraintCategory(category, PLAIN)} at ${name}(${arg}) (${debug_Span(span, PLAIN)}`,
      )).$ === "Err"
    )
      return r;
  }

  return Ok(null);
};
