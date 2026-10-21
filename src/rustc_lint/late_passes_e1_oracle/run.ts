// Test driver for src/rustc_lint/late_passes_e1.oracle.test.ts (lane lint-late-e1; not a port).
//   bun src/rustc_lint/late_passes_e1_oracle/run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, the ported prefix of `run_required_analyses`
// (src/rust_ts/tydump_dump.ts `run_required_analyses_prefix`: type collection, wfcheck, typeck of every body), then
// `analysis`'s abort on non-lint errors, then the lane's late lint passes over the whole crate, then stops.
// The late pass driver (late.rs `late_lint_mod` / `late_lint_crate`) is lane lint-late-a's and was not merged when
// this lane ran, so `LateWalker` below stands in for late.rs's `LateContextAndPass`: the same `with_lint_attrs` /
// `with_param_env` / typeck-results bookkeeping and the same callback order, for the callbacks the lane's passes
// implement. Once late.rs is ported, this driver should call `late_lint_crate`-style code from late.ts instead.
// The oracle compiles the same file as a lib with `--emit=metadata`; each test case only has diagnostics from
// these passes, so stderr and the exit code must be identical.
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
  const { run_passes } = await import("./walker.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      run_passes(tcx);
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
