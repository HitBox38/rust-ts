// Port of compiler/rustc_mir_transform/src/sanity_check.rs (lane mt-skeleton).
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { sanity_check } from "../rustc_mir_dataflow/rustc_peek.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/sanity_check.rs:5 SanityCheck
export class SanityCheck extends MirLint {
  readonly type_name = "rustc_mir_transform::sanity_check::SanityCheck";

  // impl<'tcx> crate::MirLint<'tcx> for SanityCheck
  // rustc: compiler/rustc_mir_transform/src/sanity_check.rs:8 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    sanity_check(tcx, body);
  }
}
