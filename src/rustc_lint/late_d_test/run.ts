// Test helper of src/rustc_lint/late_d.oracle.test.ts (lane lint-late-d). Not an upstream mirror.
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), then the analysis prefix of the tydump probe
// (src/rust_ts/tydump_dump.ts `run_required_analyses_prefix`: `run_required_analyses` up to type checking), then the
// late lint passes named in `RUST_TS_LATE_D_PASSES` (comma-separated pass names) over every module, as
// `late_lint_mod` does for the module passes (`BuiltinCombinedLateLintModPass` / `InternalCombinedLateLintModPass`).
//
// PORT: lane lint-late-a ports late.rs (the real traversal) and context.rs's `LateContext` methods in parallel. Until
// they land, this helper carries a test-only copy of `LateContextAndPass` (late.rs:36-325, reduced to the callbacks
// and the context bookkeeping) and `TestLateContext`, which fills the `LateContext` methods that are still `unported`
// in context.ts (`typing_mode`, `typing_env`, `type_is_copy_modulo_regions`, `qpath_res`, `expr_or_init`,
// `expr_or_init_with_outside_body`, `layout_of`) with the upstream bodies (context.rs:628-937). Replace both with the
// real `late_lint_mod` once it is ported.
//
//   RUST_TS_LATE_D_PASSES=DropForgetUseless bun run.ts <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Unported } from "../../std/panic.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { run_late_passes } = await import("./walker.ts");
  const names = (process.env.RUST_TS_LATE_D_PASSES ?? "").split(",").filter((s) => s !== "");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      run_late_passes(tcx, names);
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
