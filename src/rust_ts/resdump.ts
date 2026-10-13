// Subject side of the `resdump-nocore` suite: runs the compilation with the ported driver and, right
// after name resolution, prints what tools/probes/resdump/main.rs prints (its header documents the
// setup, the sections, their line formats and sort keys; this file mirrors it step by step).
//   bun src/rust_ts/resdump.ts <rustc arguments...>
//
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle probe itself, so the
// suite must score 100%), `stub` (everything unported, 0%).
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Config } from "../rustc_interface/interface.ts";
import { EarlyDiagCtxt } from "../rustc_session/session.ts";
import { ErrorOutputType } from "../rustc_session/config.ts";
import { Panic, Unported, unported } from "../std/panic.ts";

const EXIT_UNPORTED = 70;

/** The probe's `ResDump` callbacks. */
const callbacks = {
  // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
  config(config: Config): void {
    config.opts.trimmed_def_paths = true;
  },
  // PORT: `Callbacks::after_expansion` is not in the ported `Callbacks` interface yet: the driver stops
  // at `create_and_enter_global_ctxt` (unported) before it would call it. When the driver calls it,
  // this prints the probe's `dump(tcx)` to stdout and returns `Compilation::Stop`.
  after_expansion(_compiler: unknown, _tcx: unknown): "Stop" | "Continue" {
    return unported("rust_ts::resdump::dump (ResolverGlobalCtxt / ResolverAstLowering / definitions: rustc_middle::ty::TyCtxt and rustc_resolve are not ported)");
  },
};

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { probePath } = await import("../../scripts/probes.ts");
    const proc = Bun.spawn([probePath("resdump"), ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  // The probe's `main`: `EarlyDiagCtxt::new(ErrorOutputType::default())`,
  // `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())` (not ported, as in rustc_driver_impl/lib.ts),
  // `catch_with_exit_code(|| compiler_entrypoint(&raw_args(&early_dcx), &mut callbacks))`.
  // argv[0] is the program name; here the script path stands for it.
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx, [process.argv[1] ?? "resdump", ...args]), callbacks));
}

try {
  process.exitCode = await main(process.argv.slice(2));
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
