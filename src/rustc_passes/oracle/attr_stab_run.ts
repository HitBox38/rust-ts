// Test driver for src/rustc_passes/check_attr_stability.oracle.test.ts (lane passes-b; not a port).
//   bun src/rustc_passes/oracle/attr_stab_run.ts <rustc arguments...>
//
// Subject side of the comparison with the tydump probe (tools/probes/tydump; its prefix.rs runs
// `run_required_analyses` up to type checking): runs the ported driver with the probe's `config`
// (`trimmed_def_paths = true`) and, in `after_expansion`, the part of the probe's prefix this lane covers: AST lowering
// (`hir_crate_items`), then misc_checking_1's `check_mod_attrs` + `check_mod_unstable_api_usage` per module
// (`par_hir_for_each_module` runs serially with `-Zthreads=1`), then stops (`Compilation::Stop`). The test compares
// stderr and the exit code only, on cases where the rest of the probe's prefix (entry_fn, emit_delayed_lints,
// typeck, ...) emits nothing.
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

  const callbacks = {
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      tcx.ensure_done().hir_crate_items(null);
      tcx.hir_for_each_module((module) => {
        tcx.ensure_ok().check_mod_attrs(module);
        tcx.ensure_ok().check_mod_unstable_api_usage(module);
      });
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
