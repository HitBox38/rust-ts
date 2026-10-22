// Port of compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs (lane mt-promote).
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { BasicBlock, BasicBlockData, Body, Location, Terminator } from "../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { HasAttrs_DefId } from "../../rustc_middle/ty/mod.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Checker } from "./check.ts";
import { ConstCx, rustc_allow_const_fn_unstable } from "./mod.ts";

/// Returns `true` if we should use the more precise live drop checker that runs after drop
/// elaboration.
// rustc: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:14 checking_enabled
export function checking_enabled(ccx: ConstCx): boolean {
  // Const-stable functions must always use the stable live drop checker...
  if (ccx.enforce_recursive_const_stability()) {
    // ...except if they have the feature flag set via `rustc_allow_const_fn_unstable`.
    return rustc_allow_const_fn_unstable(ccx.tcx, ccx.body.source.def_id().expect_local(), sym.const_precise_live_drops);
  }

  return ccx.tcx.features().const_precise_live_drops();
}

/// Look for live drops in a const context.
///
/// This is separate from the rest of the const checking logic because it must run after drop
/// elaboration.
// rustc: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:32 check_live_drops
export function check_live_drops(tcx: TyCtxt, body: Body): void {
  const ccx = ConstCx.new(tcx, body);
  if (ccx.const_kind === undefined) {
    return;
  }

  if (find_attr(HasAttrs_DefId.get_attrs(body.source.def_id(), tcx), (k) => (k.$ === "RustcDoNotConstCheck" ? true : undefined)) !== undefined) {
    return;
  }

  if (!checking_enabled(ccx)) {
    return;
  }

  // I know it's not great to be creating a new const checker, but I'd
  // rather use it so we can deduplicate the error emitting logic that
  // it contains.
  const visitor = new CheckLiveDrops(Checker.new(ccx));

  visitor.visit_body(body);
}

// rustc-type: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:54 CheckLiveDrops
class CheckLiveDrops extends Visitor {
  constructor(public checker: Checker) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for CheckLiveDrops<'_, 'tcx>

  // rustc: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:59 visit_basic_block_data
  override visit_basic_block_data(bb: BasicBlock, block: BasicBlockData): void {
    // trace!("visit_basic_block_data: bb={:?} is_cleanup={:?}", bb, block.is_cleanup);

    // Ignore drop terminators in cleanup blocks.
    if (block.is_cleanup) {
      return;
    }

    this.super_basic_block_data(bb, block);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/post_drop_elaboration.rs:70 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // trace!("visit_terminator: terminator={:?} location={:?}", terminator, location);

    const kind = terminator.kind;
    switch (kind.$) {
      case "Drop": {
        const dropped_place = kind.place;
        this.checker.check_drop_terminator(dropped_place, location, terminator.source_info.span);
        break;
      }

      case "UnwindTerminate":
      case "Call":
      case "TailCall":
      case "Assert":
      case "FalseEdge":
      case "FalseUnwind":
      case "CoroutineDrop":
      case "Goto":
      case "InlineAsm":
      case "UnwindResume":
      case "Return":
      case "SwitchInt":
      case "Unreachable":
      case "Yield":
        break;
    }
  }
}
