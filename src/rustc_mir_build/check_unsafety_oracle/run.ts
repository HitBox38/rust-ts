// Test driver for check_unsafety.oracle.test.ts (lane mb-unsafety; not a port).
//   bun src/rustc_mir_build/check_unsafety_oracle/run.ts <rustc arguments...>
//
// `analysis` (rustc_interface passes.rs) is not ported, so in `after_expansion` this runs tydump's
// `run_required_analyses_prefix` (run_required_analyses up to `definitions.freeze()`, including the typeck of every body;
// src/rust_ts/tydump_dump.ts), then the `check_unsafety` part of the `MIR_borrow_checking` loop of
// `run_required_analyses` (passes.rs: `par_hir_body_owners`, `check_unsafety` for every body owner that is not a typeck
// child), then `analysis`'s abort on non-lint errors, then `check_expectations(None)`, then it stops.
//
// `check_unsafety` runs `tcx.ensure_done().mir_built(def)` before the visitor: the real provider (MIR building with
// check_match, then `mir_built`'s pass list: `LintAndRemoveUninhabited`, the MIR lints, `SimplifyCfg::Initial`,
// `SanityCheck`). Borrowck, liveness, dead code and the late lints do not run: test cases must not trigger them (the
// oracle runs everything).
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
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.sess.time("MIR_borrow_checking", () => {
        tcx.par_hir_body_owners((def_id) => {
          if (!tcx.is_typeck_child(LocalDefId.to_def_id(def_id))) {
            // Child unsafety and borrowck happens together with the parent
            tcx.ensure_ok().check_unsafety(def_id);
          }
        });
      });
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
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
