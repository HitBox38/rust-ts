// Test driver for elaborate_drops.oracle.test.ts (lane mt-drops; not a port).
//   bun src/rustc_mir_transform/elaborate_drops_oracle/run.ts <rustc arguments...>
//
// `analysis` and `mir_borrowck` are not ported, so `mir_drops_elaborated_and_const_checked` is not reachable through the
// queries. In `after_expansion` this runs tydump's `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts) and the
// part of the `MIR_borrow_checking` loop that the ported driver reaches (`check_unsafety`, `has_ffi_unwind_calls`,
// `check_liveness`, as liveness_oracle/run.ts), aborts on errors as `analysis` does, and then, for every fn / assoc fn
// / closure body of `mir_keys`, takes a copy of the real `mir_promoted` body and runs:
// 1. lib.ts's `run_analysis_cleanup_passes` (the real `ImpossibleClauses`, `CleanupPostBorrowck`,
//    `RemoveNoopLandingPads`, `SimplifyCfg::PostAnalysis`, `Derefer`; phase `Analysis(PostCleanup)`).
// 2. `run_passes([CriticalCallEdges, PostAnalysisNormalize, Subtyper, ElaborateDrops], Runtime(Initial))`: the head of
//    `run_runtime_lowering_passes` up to and including `ElaborateDrops` (all real passes), so that the pass manager's
//    `-Zdump-mir` hooks write `<crate>.<item>.ElaborateDrops.{before,after}.mir` as rustc does; the `before` dumps check
//    the input those passes give `ElaborateDrops`.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { clone_Body } = await import("../../rustc_middle/mir/mod.ts");
  const pm = await import("../pass_manager.ts");
  const { run_analysis_cleanup_passes } = await import("../lib.ts");
  const { AddCallGuards } = await import("../add_call_guards.ts");
  const { PostAnalysisNormalize } = await import("../post_analysis_normalize.ts");
  const { Subtyper } = await import("../add_subtyping_projections.ts");
  const { ElaborateDrops } = await import("../elaborate_drops.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.sess.time("MIR_borrow_checking", () => {
        tcx.par_hir_body_owners((def_id) => {
          const not_typeck_child = !tcx.is_typeck_child(LocalDefId.to_def_id(def_id));
          if (not_typeck_child) {
            // Child unsafety and borrowck happens together with the parent
            tcx.ensure_ok().check_unsafety(def_id);
          }
          if (tcx.is_trivial_const(def_id)) {
            return;
          }
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);
        });
      });
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();

      for (const def_id of tcx.mir_keys(null)) {
        const did = LocalDefId.to_def_id(def_id);
        if (tcx.trivial_const(def_id) !== undefined || tcx.is_constructor(did)) continue;
        const kind = tcx.def_kind(did);
        if (!(kind.$ === "Fn" || kind.$ === "AssocFn" || kind.$ === "Closure")) continue;
        const body = clone_Body(tcx.mir_promoted(def_id)[0].borrow());
        run_analysis_cleanup_passes(tcx, body);
        pm.run_passes(
          tcx,
          body,
          [AddCallGuards.CriticalCallEdges, new PostAnalysisNormalize(), new Subtyper(), new ElaborateDrops()],
          { $: "Runtime", _0: "Initial" },
        );
      }
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
