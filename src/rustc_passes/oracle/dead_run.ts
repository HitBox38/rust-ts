// Test driver for src/rustc_passes/dead.oracle.test.ts (lane passes-dead; not a port).
//   bun src/rustc_passes/oracle/dead_run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, the part of rustc_interface passes.rs `run_required_analyses` +
// `analysis` that this lane's files take part in, in upstream order:
// - `run_required_analyses`: the tydump prefix (src/rust_ts/tydump_dump.ts `run_required_analyses_prefix`: up to
//   `definitions.freeze()`, `rustc_hir_analysis::check_crate` without its const-eval arm); `MIR_borrowck` is skipped
//   (not ported; the cases are borrowck- and liveness-clean); then `layout_testing` (layout_test.rs `test_layout`)
//   and `abi_testing` (abi_test.rs `test_abi`).
// - `analysis`: the abort on non-lint errors; then `misc_checking_3` with `par_fns` serial:
//   `effective_visibilities`, `check_private_in_public(module)` and `check_mod_deathness(module)` for every module
//   (`par_hir_for_each_module` is `hir_for_each_module`, single-threaded rustc's order), `lint_checking` skipped
//   (`rustc_lint::check_crate`, being ported in parallel; the cases trigger no late lint), then
//   `check_mod_privacy(module)`, `check_expectations(None)`, `all_diagnostic_items` and `all_canonical_symbols`.
// Then it stops (`Compilation::Stop`). rustc's own stderr is what the test compares with the oracle rustc.
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
  const { test_layout } = await import("../layout_test.ts");
  const { test_abi } = await import("../abi_test.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      // run_required_analyses
      run_required_analyses_prefix(tcx);
      test_layout(tcx);
      test_abi(tcx);

      // analysis
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();

      tcx.ensure_ok().effective_visibilities(null);
      tcx.hir_for_each_module((module) => tcx.ensure_ok().check_private_in_public(module));
      tcx.hir_for_each_module((module) => tcx.ensure_ok().check_mod_deathness(module));
      tcx.hir_for_each_module((module) => tcx.ensure_ok().check_mod_privacy(module));
      tcx.check_expectations(undefined);
      tcx.all_diagnostic_items(null);
      tcx.all_canonical_symbols(null);
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
