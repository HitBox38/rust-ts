// Port of compiler/rustc_borrowck/src/region_infer/dump_mir.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! As part of generating the regions, if you enable `-Zdump-mir=nll`,
//! we will generate an annotated copy of the MIR that includes the
//! state of region inference. This code handles emitting the region
//! context internal state.
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` and `io::Result<()>` src/std's `IoResult<null>` (mir-contract
// precedent, rustc_middle mir/pretty.ts); `&mut dyn FnMut(&str) -> io::Result<()>` is an arrow fn.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import { RegionInferenceContext } from "./region_context.gen.ts";

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
// stub: compiler/rustc_borrowck/src/region_infer/dump_mir.rs:21 dump_mir (lane bck-regions-b)
RegionInferenceContext.prototype.dump_mir = function (this: RegionInferenceContext, tcx: TyCtxt, out: Write): IoResult<null> {
  return unported("rustc_borrowck::region_infer::dump_mir::RegionInferenceContext::dump_mir");
};

/// Debugging aid: Invokes the `with_msg` callback repeatedly with
/// our internal region constraints. These are dumped into the
/// -Zdump-mir file so that we can figure out why the region
/// inference resulted in the values that it did when debugging.
// stub: compiler/rustc_borrowck/src/region_infer/dump_mir.rs:65 for_each_constraint (lane bck-regions-b)
RegionInferenceContext.prototype.for_each_constraint = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  with_msg: (a0: string) => IoResult<null>,
): IoResult<null> {
  return unported("rustc_borrowck::region_infer::dump_mir::RegionInferenceContext::for_each_constraint");
};
