// Test helper of ../suggestions_b.test.ts (lane errrep-sugg-b).
//
// Runs the ported driver up to expansion, then the tydump analysis prefix (src/rust_ts/tydump_dump.ts
// `run_required_analyses_prefix`: run_required_analyses up to type checking, wfcheck included). The E0277 reports go
// through the real `TypeErrCtxt::report_fulfillment_errors` (lane errrep-traits-a) and `note_obligation_cause`
// (lane errrep-traits-b). (Until merge-w19 this replaced `report_fulfillment_errors` by a TEST stand-in that printed a
// placeholder message and only the `note_obligation_cause_code` sub-diagnostics.)
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  await import("../../../lib.ts");
  const { run_required_analyses_prefix } = await import("../../../../rust_ts/tydump_dump.ts");

  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
