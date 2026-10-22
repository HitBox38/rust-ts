// Test driver for rustc_peek.oracle.test.ts (lane dataflow-impls; not a port).
//   bun src/rustc_mir_dataflow/rustc_peek_oracle/run.ts <rustc arguments...>
//
// As src/rustc_mir_build/check_unsafety_oracle/run.ts: in `after_expansion` this runs tydump's
// `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts), then the `check_unsafety` part of the
// `MIR_borrow_checking` loop of `run_required_analyses` (rustc_interface passes.rs), which is where the oracle builds
// MIR first (`check_unsafety` runs `tcx.ensure_done().mir_built(def)`), then `analysis`'s abort on non-lint errors.
//
// `mir_built` is the real provider (rustc_mir_transform lib.ts): MIR building, then its pass list, whose last pass
// `Lint(SanityCheck)` runs rustc_mir_dataflow's `rustc_peek` `sanity_check`. Borrowck, liveness and the late lints do
// not run: the cases end in `#[rustc_mir(stop_after_dataflow)]` (a fatal error in `mir_built` of the first body owner).
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

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.sess.time("MIR_borrow_checking", () => {
        tcx.par_hir_body_owners((def_id) => {
          if (!tcx.is_typeck_child(LocalDefId.to_def_id(def_id))) {
            tcx.ensure_ok().check_unsafety(def_id);
          }
        });
      });
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      tcx.check_expectations(undefined);
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
