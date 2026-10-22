// Test driver for check_unsafety.oracle.test.ts (lane mb-unsafety; not a port).
//   bun src/rustc_mir_build/check_unsafety_oracle/run.ts [--real-mir-built] <rustc arguments...>
//
// `analysis` (rustc_interface passes.rs) is not ported, so in `after_expansion` this runs tydump's
// `run_required_analyses_prefix` (run_required_analyses up to `definitions.freeze()`, including the typeck of every body;
// src/rust_ts/tydump_dump.ts), then the `check_unsafety` part of the `MIR_borrow_checking` loop of
// `run_required_analyses` (passes.rs: `par_hir_body_owners`, `check_unsafety` for every body owner that is not a typeck
// child), then `analysis`'s abort on non-lint errors, then `check_expectations(None)`, then it stops.
//
// `check_unsafety` runs `tcx.ensure_done().mir_built(def)` before the visitor. The `mir_built` provider is ported
// (rustc_mir_transform lib.ts) and MIR building runs (check_match with rustc_pattern_analysis included), but the
// provider still stops at unported code for every body: its pass list at `LintAndRemoveUninhabited` (lane
// mt-built-lints). So by default this driver overrides the `mir_built` provider
// with one that only runs `thir_body` (what `mir_built` reads first) and returns an empty `Steal`: `ensure_done`
// discards the value, and the test cases avoid everything MIR building would report (check_match, MIR lints).
// `--real-mir-built` keeps the real provider (check_unsafety.oracle.test.ts pins where it stops; drop the override
// when that lane lands). Borrowck, liveness, dead code and the late lints do not run: test cases must not trigger them (the oracle
// runs everything).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  // `--real-mir-built` is ours: take it out before `raw_args` reads `process.argv`.
  let real_mir_built = false;
  for (let i = process.argv.length - 1; i >= 2; i--) {
    if (process.argv[i] === "--real-mir-built") {
      real_mir_built = true;
      process.argv.splice(i, 1);
    }
  }
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { Steal } = await import("../../rustc_data_structures/steal.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      if (!real_mir_built) {
        config.override_queries = (_sess: unknown, providers: Providers): void => {
          providers.queries.mir_built = (tcx, def) => {
            tcx.thir_body(def);
            return Steal.new(undefined as unknown as import("../../rustc_middle/mir/mod.ts").Body, "mir::Body");
          };
        };
      }
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
