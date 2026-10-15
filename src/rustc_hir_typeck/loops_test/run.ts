// Test helper of src/rustc_hir_typeck/loops.test.ts (lane typeck-lib-wb).
//
// Runs the ported driver (parsing, expansion, resolution, AST lowering) and then `rustc_hir_typeck::loops::check` on
// every body owner that is a typeck root, in `hir_body_owners` order, as `typeck_with_inspect` does first thing for
// each body (check_crate's `par_hir_body_owners` loop, single-threaded order).
// PORT (test): the rest of typeck is not run: the test programs only have `loops::check` errors, so the oracle's
// output is exactly what these calls emit.
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  await import("../lib.ts");
  const loops = await import("../loops.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const def_id of tcx.hir_body_owners()) {
        if (tcx.is_typeck_child(LocalDefId.to_def_id(def_id))) continue;
        loops.check(tcx, def_id, tcx.hir_body_owned_by(def_id));
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
