// Test driver for src/rustc_lint/late_e2.oracle.test.ts (lane lint-late-e2; not a port).
//   LATE_E2_PASSES=MapUnitFn,UnitBindings bun src/rustc_lint/late_e2_oracle/run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, the typeck prefix of `run_required_analyses` (tydump's
// `run_required_analyses_prefix`), `analysis`'s abort on non-lint errors, then the module lint passes the way
// late.rs `late_lint_mod` runs them, for each module (`par_hir_for_each_module`), with only the late lint passes
// named in `LATE_E2_PASSES` (in that order), then `check_expectations(None)`. Then it stops.
//
// The late pass driver (late.rs `LateContextAndPass`) and the `LateContext` methods that need the HIR and
// `rustc_middle::ty` are lane lint-late-a's (wave 21), written in parallel; this file has a minimal copy of both
// (`TestLateContext`, `LateWalker`): the hooks the lane's passes use, with upstream's context switching
// (`with_lint_attrs`, `with_param_env`, `visit_nested_body`, `visit_fn`). Replace it with `late_lint_mod` once that
// lands.
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
  const { run_late_passes } = await import("./walker.ts");

  const names = (process.env.LATE_E2_PASSES ?? "").split(",").filter((s) => s !== "");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes (as tydump.ts).
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      run_late_passes(tcx, names);
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
