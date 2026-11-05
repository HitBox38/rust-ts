// The alias checker around the real driver (lane mir-alias; test helper, not a port).
//   RUST_TS_ALIAS_OUT=<file> bun src/rustc_mir_transform/alias_check_oracle/driver.ts <rustc arguments>
//
// Behaves as src/rust_ts/main.ts (same argv, stdout, stderr and exit code, so `-Zunpretty=mir` output can be compared with
// the oracle's in the same run), with hooks.ts installed. Hits go to the file, one JSON object per line, then one final
// `{"kind":"CHECKED",..}` line. A file with no CHECKED line means the process stopped early (unported, ICE, fatal).
//
// With RUST_TS_ALIAS_MONO=1 it stops after `analysis` and runs `collect_crate_mono_items` (eager), as
// rustc_monomorphize/collector_oracle/run.ts does: that asks for every reachable `instance_mir`, so the shims run their
// pass lists too. Nothing is printed on stdout; there is no oracle output to compare.
import { appendFileSync } from "node:fs";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { write_stderr } from "../../std/io.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { install_alias_hooks } from "./hooks.ts";

const EXIT_UNPORTED = 70;
const OUT = process.env.RUST_TS_ALIAS_OUT;

function line(o: unknown): void {
  if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(o)}\n`);
  else write_stderr(`${JSON.stringify(o)}\n`);
}

async function main(): Promise<number> {
  ensure_stack();
  const stats = await install_alias_hooks(line);
  let code: number;
  if (process.env.RUST_TS_ALIAS_MONO === "1") {
    const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
    const { raw_args } = await import("../../rustc_driver_impl/args.ts");
    const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
    const { ErrorOutputType } = await import("../../rustc_session/config.ts");
    const { provide } = await import("../../rustc_monomorphize/lib.ts");
    const { collect_crate_mono_items } = await import("../../rustc_monomorphize/collector.ts");
    const callbacks = {
      config(config: Config): void {
        const prev = config.override_queries;
        config.override_queries = (sess, providers) => {
          prev?.(sess, providers);
          provide(providers);
        };
      },
      after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        collect_crate_mono_items(tcx, "Eager");
        tcx.dcx().abort_if_errors();
        return "Stop";
      },
    };
    const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
    code = catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
  } else {
    const { main: rustc_driver_main } = await import("../../rustc_driver_impl/lib.ts");
    code = rustc_driver_main();
  }
  line({ kind: "CHECKED", walks: stats.walks, passes: [...stats.passes] });
  return code;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    write_stderr(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof FatalErrorMarker) {
    process.exitCode = 101;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    write_stderr(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
