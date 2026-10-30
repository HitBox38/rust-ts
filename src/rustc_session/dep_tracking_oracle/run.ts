// Test driver for src/rustc_session/dep_tracking.oracle.test.ts (lane passes-reachable; not a port).
//   bun src/rustc_session/dep_tracking_oracle/run.ts <rustc arguments...>
//
// The port's side of the `optshash` probe (tools/probes/optshash): runs the ported driver with rustc's
// `TimePassesCallbacks::config` effect (`trimmed_def_paths = true`) and, after the crate root is parsed, prints
//   crate_hash <sess.opts.dep_tracking_hash(true), 16 hex digits>
//   incr_hash <sess.opts.dep_tracking_hash(false), 16 hex digits>
// then stops (`Compilation::Stop`).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Crate } from "../../rustc_ast/ast.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../session.ts");
  const { ErrorOutputType } = await import("../config.ts");

  const hex = (h: bigint): string => h.toString(16).padStart(16, "0");
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_crate_root_parsing(compiler: Compiler, _krate: Crate): "Stop" | "Continue" {
      const opts = compiler.sess.opts;
      process.stdout.write(`crate_hash ${hex(opts.dep_tracking_hash(true))}\n`);
      process.stdout.write(`incr_hash ${hex(opts.dep_tracking_hash(false))}\n`);
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
