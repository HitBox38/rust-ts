// Subject side of the `tydump-*` suites: runs the compilation with the ported driver, stops it after
// type checking and prints what tools/probes/tydump/main.rs prints (its header documents the setup, the
// D1/D1a stop point, the sections, their line formats and sort keys; tools/probes/tydump/prefix.rs is the
// analysis prefix both probes run). This file and tydump_dump.ts mirror the probe step by step.
//   bun src/rust_ts/tydump.ts <rustc arguments...>
//
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle probe itself, so the
// suite must score 100%), `stub` (everything unported, 0%).
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../rustc_interface/interface.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { Panic, Unported } from "../std/panic.ts";
import { ensure_stack } from "./stack.ts";

const EXIT_UNPORTED = 70;

/**
 * The probe's `TyDump` callbacks; `prefix` and `dump` are tydump_dump.ts's `run_required_analyses_prefix` and `dump`
 * (loaded with the driver).
 */
function make_callbacks(prefix: (tcx: TyCtxt) => number, dump: (tcx: TyCtxt, n: number) => string, print: (s: string) => void) {
  return {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    // The probe runs `prefix::run_required_analyses_prefix(tcx)` (run_required_analyses up to
    // `definitions.freeze()`, check_crate without its const-eval arm), then prints `dump(tcx)` to stdout
    // and returns `Compilation::Stop`.
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const num_definitions_after_lowering = prefix(tcx);
      const out = dump(tcx, num_definitions_after_lowering);
      print(out);
      return "Stop";
    },
  };
}

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { probePath } = await import("../../scripts/probes.ts");
    const proc = Bun.spawn([probePath("tydump"), ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  // The compiler's stack (rustc's thread stack size): see stack.ts. Re-execs this process once.
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint, init_rustc_env_logger } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../rustc_session/config.ts");
  const { run_required_analyses_prefix, dump } = await import("./tydump_dump.ts");
  // The probe's `main`: `EarlyDiagCtxt::new(ErrorOutputType::default())`, `init_rustc_env_logger(&early_dcx)`,
  // `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())` (not ported, as in rustc_driver_impl/lib.ts),
  // `catch_with_exit_code(|| compiler_entrypoint(&raw_args(&early_dcx), &mut callbacks))`.
  // `raw_args` reads `env::args_os()` (= process.argv[1..]: this script's path stands for argv[0]).
  // `after_expansion` writes the dump with `stdout.write_all` (`std_print`, as `print!`).
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  // As rustc_driver_impl::main: tracing's default filter (`RUSTC_LOG` unset) prints WARN and ERROR events.
  init_rustc_env_logger(early_dcx);
  const callbacks = make_callbacks(run_required_analyses_prefix, dump, std_print);
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

/** A JS stack overflow (rustc: a fault on the thread's guard page). As src/rust_ts/main.ts. */
function is_stack_overflow(e: unknown): boolean {
  return e instanceof RangeError && e.message.startsWith("Maximum call stack size exceeded");
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (is_stack_overflow(e)) {
    const { on_stack_overflow } = await import("../rustc_driver_impl/signal_handler.ts");
    on_stack_overflow();
  }
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof FatalErrorMarker) {
    // `FatalError.raise()` before `catch_with_exit_code` (`init_rustc_env_logger`'s `early_fatal` on a bad
    // `RUSTC_LOG_*` value): `resume_unwind` skips the panic hook, so rustc exits 101 printing nothing more.
    process.exitCode = 101;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
