// Test helper of src/rustc_hir_typeck/demand_adjust.test.ts (lane typeck-demand-adjust).
//
// Runs the ported driver through the tydump probe's analysis prefix (src/rust_ts/tydump_dump.ts
// `run_required_analyses_prefix`: everything up to and including type checking of every body), reporting through the
// real error-reporting code (wave 19).
//
// (Until merge-w19 this replaced `TypeErrCtxt::report_fulfillment_errors` / `report_mismatched_types` and the
// fn_ctxt/suggestions.rs predicates by test stand-ins selected with `RUST_TS_TEST_MODE`, and reproduced the
// suggestions.rs:5459 receiver-to-method-name span move; the ported `note_function_argument_obligation` does it now.)
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  await import("../lib.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...argv], callbacks));
}

const { Unported } = await import("../../std/panic.ts");
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // Unported code exits 70 (UNPORTED), like the harness runners.
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    throw e;
  }
}
