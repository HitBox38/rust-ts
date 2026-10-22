// Test helper of src/rustc_hir_typeck/intrinsicck.test.ts (merge-layout; not a port).
//
// Runs the ported driver (parsing, expansion, resolution, AST lowering) and then the `check_transmutes` query on every
// body owner that is not a typeck child, in `hir_body_owners` order, as rustc_interface passes.rs `run_required_analyses`
// does (`MIR_borrow_checking`, single-threaded order). The query runs `typeck` of the body first.
// PORT (test): the rest of the analysis is not run: the test programs only have `check_transmute` errors, so the
// oracle's output is exactly what these calls emit.
//
//   bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  await import("../lib.ts");
  await import("../../rustc_hir_analysis/lib.ts");
  await import("../../rustc_ty_utils/lib.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const def_id of tcx.hir_body_owners()) {
        if (tcx.is_typeck_child(LocalDefId.to_def_id(def_id))) continue;
        tcx.ensure_ok().check_transmutes(def_id);
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
