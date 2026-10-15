// Subject side of the `thirdump-*` suites: runs the compilation with the ported driver, stops it after
// type checking and prints the THIR of every body as tools/probes/thirdump/main.rs does (its header
// documents the setup, the steps and the output; tools/probes/tydump/prefix.rs is the analysis prefix
// both probes run, D1/D1a). This file mirrors the probe step by step; the prefix is
// tydump_dump.ts's. `THIRDUMP_FORMAT=tree` selects the
// probe's `thir_tree` output instead of `thir_flat` (the suites use the default). Both are the ported
// `rustc_mir_build::thir::print::{thir_flat, thir_tree}` (src/rustc_mir_build/thir/print.ts).
//   bun src/rust_ts/thirdump.ts <rustc arguments...>
//
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle probe itself, so the
// suite must score 100%), `stub` (everything unported, 0%).
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../rustc_interface/interface.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { Panic, Unported } from "../std/panic.ts";
import { ensure_stack } from "./stack.ts";

const EXIT_UNPORTED = 70;

/** `rustc_mir_build::thir::print::{thir_tree, thir_flat}`'s signature. */
type ThirPrintFn = (tcx: TyCtxt, owner_def: LocalDefId) => string;

/**
 * The probe's `ThirDump` callbacks; `prefix` is tydump_dump.ts's `run_required_analyses_prefix`, `debug_did` the
 * `{:?}` of a LocalDefId and `thir_tree` / `thir_flat` rustc_mir_build's printers (all loaded with the driver).
 */
function make_callbacks(
  tree: boolean,
  prefix: (tcx: TyCtxt) => number,
  debug_did: (did: LocalDefId) => string,
  print: (s: string) => void,
  thir_tree: ThirPrintFn,
  thir_flat: ThirPrintFn,
) {
  return {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    // The probe runs `prefix::run_required_analyses_prefix(tcx)` (run_required_analyses up to
    // `definitions.freeze()`, check_crate without its const-eval arm), `tcx.dcx().abort_if_errors()`,
    // then prints `"{did:?}:\n{thir_flat(tcx, did)}\n"` for every `hir_body_owners()` to stdout and
    // returns `Compilation::Stop`.
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      prefix(tcx);
      tcx.dcx().abort_if_errors();
      let out = "";
      for (const did of tcx.hir_body_owners()) {
        const text = tree ? thir_tree(tcx, did) : thir_flat(tcx, did);
        out += `${debug_did(did)}:\n${text}\n\n`;
      }
      print(out);
      return "Stop";
    },
  };
}

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { probePath } = await import("../../scripts/probes.ts");
    const proc = Bun.spawn([probePath("thirdump"), ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  // The compiler's stack (rustc's thread stack size): see stack.ts. Re-execs this process once.
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("./tydump_dump.ts");
  const { debug_LocalDefId } = await import("../rustc_span/def_id.ts");
  const { PLAIN } = await import("../std/fmt.ts");
  const { thir } = await import("../rustc_mir_build/lib.ts");
  // The probe's `main`: `EarlyDiagCtxt::new(ErrorOutputType::default())`,
  // `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())` (not ported, as in rustc_driver_impl/lib.ts),
  // `catch_with_exit_code(|| compiler_entrypoint(&raw_args(&early_dcx), &mut callbacks))`.
  // `raw_args` reads `env::args_os()` (= process.argv[1..]: this script's path stands for argv[0]).
  // `THIRDUMP_FORMAT=tree` selects `thir_tree`. `after_expansion` writes with `stdout.write_all` (`std_print`).
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  const tree = process.env.THIRDUMP_FORMAT === "tree";
  const callbacks = make_callbacks(
    tree,
    run_required_analyses_prefix,
    (did) => debug_LocalDefId(did, PLAIN),
    std_print,
    thir.print.thir_tree,
    thir.print.thir_flat,
  );
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
