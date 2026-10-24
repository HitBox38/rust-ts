// Test driver for src/rustc_interface/analysis.oracle.test.ts (lane passes-analysis; not a port).
//   bun src/rustc_interface/analysis_oracle/run.ts <rustc arguments...>
//
// src/rust_ts/main.ts stopped right after `tcx.ensure_ok().analysis(())` (rustc_driver_impl/src/lib.rs, through the
// `after_analysis` callback returning `Compilation::Stop`), as tools/probes/ckdump/main.rs does: the ported driver runs
// `analysis` (rustc_interface passes.rs:1209: `run_required_analyses`, the abort on non-lint errors, misc_checking_3),
// with rustc's `TimePassesCallbacks::config` (`trimmed_def_paths = true`, minus time-passes). What `analysis` reaches
// that is not ported (`mir_borrowck`, CTFE) stops as UNPORTED.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../interface.ts";
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

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_analysis(_compiler: Compiler, _tcx: TyCtxt): "Stop" | "Continue" {
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
