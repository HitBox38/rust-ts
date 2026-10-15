// Test helper of src/rustc_hir_analysis/check/entry.test.ts (lane small-gaps-17).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), lowers the crate (`hir_crate_items`), then calls
// `check_for_entry_fn(tcx)` as wfcheck.rs `check_type_wf` does. On a crate whose only error is a `main` signature error,
// stderr equals the oracle rustc's. An `unported(..)` stop exits 70 with `UNPORTED: <what>` on stderr.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Unported } from "../../../std/panic.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  await import("../../lib.ts");
  const { check_for_entry_fn } = await import("../entry.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      tcx.hir_crate_items(null);
      check_for_entry_fn(tcx);
      return "Stop" as const;
    },
  };
  try {
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
  } catch (e) {
    if (e instanceof Unported) {
      process.stderr.write(`UNPORTED: ${e.what}\n`);
      return 70;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
