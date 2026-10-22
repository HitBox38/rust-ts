// Port of compiler/rustc_mir_transform/src/post_drop_elaboration.rs (lane mt-promote).
import { check_consts } from "../rustc_const_eval/lib.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/post_drop_elaboration.rs:7 CheckLiveDrops
export class CheckLiveDrops extends MirLint {
  readonly type_name = "rustc_mir_transform::post_drop_elaboration::CheckLiveDrops";

  // impl<'tcx> MirLint<'tcx> for CheckLiveDrops
  // rustc: compiler/rustc_mir_transform/src/post_drop_elaboration.rs:10 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    check_consts.post_drop_elaboration.check_live_drops(tcx, body);
  }
}
