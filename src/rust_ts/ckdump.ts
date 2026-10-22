// Subject side of the `borrowck-ui*` suites (plan-m4 D2, M4b): src/rust_ts/main.ts with the stop of
// tools/probes/ckdump/main.rs (its header documents the setup and what the stop leaves out): the ported
// `compiler_entrypoint` runs as rustc's, with `TimePassesCallbacks::config`'s `trimmed_def_paths = true` (minus
// time-passes), and `after_analysis` returns `Compilation::Stop`, right after `tcx.ensure_ok().analysis(())`.
//   bun src/rust_ts/ckdump.ts <rustc arguments...>
//
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle probe itself, so the suite must score
// 100%), `stub` (everything unported, 0%).
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
//
// This is our own code (not a port). The `analysis` query is the ported driver's: where it is not ported
// (src/rustc_interface/passes.ts installs `analysis` as `unported("rustc_interface::passes::analysis (M3+)")` until
// `run_required_analyses` / `analysis` of passes.rs:1100/1209 are ported), every case that gets that far stops UNPORTED
// there.
import type { Compiler, Config } from "../rustc_interface/interface.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../std/panic.ts";
import { ensure_stack } from "./stack.ts";

const EXIT_UNPORTED = 70;

/** The probe's `CkDump` callbacks. */
function make_callbacks() {
  return {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_analysis(_compiler: Compiler, _tcx: TyCtxt): "Stop" | "Continue" {
      return "Stop";
    },
  };
}

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { probePath } = await import("../../scripts/probes.ts");
    const proc = Bun.spawn([probePath("ckdump"), ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  // The compiler's stack (rustc's thread stack size): see stack.ts. Re-execs this process once.
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint, init_rustc_env_logger, install_ice_hook, DEFAULT_BUG_REPORT_URL } =
    await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../rustc_session/config.ts");
  // The probe's `main`: `EarlyDiagCtxt::new(ErrorOutputType::default())`, `init_rustc_env_logger`,
  // `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())`,
  // `catch_with_exit_code(|| compiler_entrypoint(&raw_args(&early_dcx), &mut callbacks))`.
  // `raw_args` reads `env::args_os()` (= process.argv[1..]: this script's path stands for argv[0]).
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  init_rustc_env_logger(early_dcx);
  install_ice_hook(DEFAULT_BUG_REPORT_URL, () => {});
  const callbacks = make_callbacks();
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
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
