// Test driver for liveness.oracle.test.ts (lane mt-liveness, switched to rendered stderr by merge-w22b; not a port).
//   bun src/rustc_mir_transform/liveness_oracle/run.ts <rustc arguments...>
//
// `analysis` (rustc_interface passes.rs) is not ported, so in `after_expansion` this runs tydump's
// `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts), then the part of the `MIR_borrow_checking` loop of
// `run_required_analyses` that reaches liveness, in rustc's order per body owner: `check_unsafety` (typeck roots; it
// runs `mir_built` with its pass list), and for non-trivial consts `has_ffi_unwind_calls` and `check_liveness` (which
// reads the real `mir_promoted`). `mir_borrowck` / `check_transmutes` (not ported) do not run: the test runs the oracle
// with `-A unused_mut` and its cases have no borrowck errors. Dead code and the late lints do not run either: the
// cases must not trigger them. Then `analysis`'s abort on non-lint errors and `check_expectations(None)`.
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
          const not_typeck_child = !tcx.is_typeck_child(LocalDefId.to_def_id(def_id));
          if (not_typeck_child) {
            // Child unsafety and borrowck happens together with the parent
            tcx.ensure_ok().check_unsafety(def_id);
          }
          if (tcx.is_trivial_const(def_id)) {
            return;
          }
          // (`mir_borrowck` / `check_transmutes` left out, see the header.)
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);
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
