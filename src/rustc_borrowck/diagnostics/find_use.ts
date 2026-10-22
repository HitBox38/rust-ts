// Port of compiler/rustc_borrowck/src/diagnostics/find_use.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { Body, Local, Location } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { Cause } from "../region_infer/mod.gen.ts";
import type { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import { type DefUseResult, UseFinder } from "./find_use.gen.ts";

export * from "./find_use.gen.ts";

declare module "./find_use.gen.ts" {
  interface UseFinder {
    // find_use.rs:32 (lane bck-diag-c)
    find(): Cause | undefined;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/find_use.rs:11 find (lane bck-diag-c)
export function find(body: Body, regioncx: RegionInferenceContext, tcx: TyCtxt, region_vid: RegionVid, start_point: Location): Cause | undefined {
  return unported("rustc_borrowck::diagnostics::find_use::find");
}

// stub: compiler/rustc_borrowck/src/diagnostics/find_use.rs:32 find (lane bck-diag-c)
UseFinder.prototype.find = function (this: UseFinder): Cause | undefined {
  return unported("rustc_borrowck::diagnostics::find_use::UseFinder::find");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/find_use.rs:97 DefUseVisitor
export class DefUseVisitor extends Visitor {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public region_vid: RegionVid,
    public def_use_result: DefUseResult | undefined,
  ) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for DefUseVisitor<'a, 'tcx>
  // stub: compiler/rustc_borrowck/src/diagnostics/find_use.rs:111 visit_local (lane bck-diag-c)
  override visit_local(local: Local, context: PlaceContext, _2: Location): void {
    return unported("rustc_borrowck::diagnostics::find_use::DefUseVisitor::visit_local");
  }
}
