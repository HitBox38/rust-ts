// Test driver for src/rustc_symbol_mangling/symbol_names.oracle.test.ts (lane symbol-mangling; not a port).
//   bun src/rustc_symbol_mangling/oracle/run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, the part of rustc_interface passes.rs that reaches
// `rustc_symbol_mangling::test::dump_symbol_names_and_def_paths`:
// - `run_required_analyses`: the tydump prefix (src/rust_ts/tydump_dump.ts `run_required_analyses_prefix`); the MIR
//   passes and the rest of `analysis` are skipped (the cases are borrowck- and lint-clean: `-A unused`).
// - `analysis`: the abort on non-lint errors.
// - `start_codegen` (passes.rs:1295): `dump_symbol_names_and_def_paths(tcx)` when `output_types.should_codegen()`,
//   then the abort on errors / delayed bugs (`has_errors_or_delayed_bugs` -> `raise_fatal`).
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
  const { test } = await import("../lib.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      // run_required_analyses
      run_required_analyses_prefix(tcx);

      // analysis
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();

      // start_codegen
      if (tcx.sess.opts.output_types.should_codegen()) {
        test.dump_symbol_names_and_def_paths(tcx);
      }
      const guar2 = tcx.sess.dcx().has_errors_or_delayed_bugs();
      if (guar2 !== undefined) guar2.raise_fatal();
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
