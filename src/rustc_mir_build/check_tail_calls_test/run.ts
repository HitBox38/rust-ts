// Test helper of src/rustc_mir_build/check_tail_calls.test.ts (lane mb-custom-tail).
//
// Runs the ported driver (parsing, expansion, resolution, AST lowering) and then the `check_tail_calls` query on every
// body owner that rustc builds MIR for, in `hir_body_owners` order (run_required_analyses' `par_hir_body_owners` loop,
// single-threaded order: `mir_borrowck` -> `mir_built` -> `build_mir` runs `check_tail_calls` first for each body).
// PORT (test): typeck is reached through `thir_body`; the rest of MIR building is not run: the test programs only have
// `check_tail_calls` errors, so the oracle's output is exactly what these calls emit.
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  await import("../../rustc_hir_analysis/lib.ts");
  await import("../../rustc_middle/lib.ts");
  await import("../lib.ts");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const def_id of tcx.hir_body_owners()) {
        // PORT (test): rustc skips `is_trivial_const` bodies here (the `trivial_const` provider is not ported); a const
        // body has no `become`, so `check_tail_calls` accepts it without a diagnostic either way.
        void tcx.check_tail_calls(def_id);
      }
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
