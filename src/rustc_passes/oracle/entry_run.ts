// Test driver for src/rustc_passes/entry.oracle.test.ts (not a port).
//   bun src/rustc_passes/oracle/entry_run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, runs the misc_checking_1 queries of this lane in the order of
// `run_required_analyses` (rustc_interface/src/passes.rs): `entry_fn`, then (with RUST_TS_PASSES_QUERIES=all)
// `check_externally_implementable_items`, `exportable_items`, `stable_order_of_exportable_impls`. Then it aborts if
// there were errors, prints the values to stdout and stops (`Compilation::Stop`). rustc's own stderr (diagnostics,
// `aborting due to ..`) is what the test compares with the oracle rustc.
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
  const { ErrorOutputType, std_print } = await import("../../rustc_session/config.ts");
  const { debug_EntryFnType } = await import("../entry.ts");
  const { LOCAL_CRATE } = await import("../../rustc_span/def_id.ts");
  const { PLAIN } = await import("../../std/fmt.ts");
  const all = process.env.RUST_TS_PASSES_QUERIES === "all";

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const entry = tcx.entry_fn(null) as [import("../../rustc_span/def_id.ts").DefId, import("../entry.ts").EntryFnType] | undefined;
      let out = "";
      out += entry === undefined ? "entry_fn: None\n" : `entry_fn: ${tcx.def_path_str(entry[0])} ${debug_EntryFnType(entry[1], PLAIN)}\n`;
      if (all) {
        tcx.check_externally_implementable_items(null);
        out += `exportable_items: [${tcx.exportable_items(LOCAL_CRATE).map((d) => tcx.def_path_str(d)).join(", ")}]\n`;
        out += `stable_order_of_exportable_impls: [${[...tcx.stable_order_of_exportable_impls(LOCAL_CRATE)].map(([d, i]) => `${tcx.def_path_str(d)}: ${i}`).join(", ")}]\n`;
      }
      tcx.dcx().abort_if_errors();
      std_print(out);
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
