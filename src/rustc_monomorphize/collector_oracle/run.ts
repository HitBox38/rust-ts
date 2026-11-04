// Test-only driver for src/rustc_monomorphize/collector.oracle.test.ts (lane mono-collector; not a port).
//   bun src/rustc_monomorphize/collector_oracle/run.ts <rustc arguments...>
//
// The ported driver, stopped after `tcx.ensure_ok().analysis(())` (the `after_analysis` callback, as
// rustc_interface/analysis_oracle/run.ts). The collector's providers are installed here through `override_queries`, not
// in `DEFAULT_QUERY_PROVIDERS`, so no production path reaches them. It then does what `collect_and_partition_mono_items`
// does up to `collect_crate_mono_items` (rustc_monomorphize/src/partitioning.rs:1169-1178) and prints one line per item,
// in the collector's order: `<fingerprint as 32 hex digits> <item, as -Zprint-mono-items prints it without its @@ part>`.
//
// The CGU part of the oracle's `MONO_ITEM` lines is compared by partitioning_oracle (`collect_and_partition_mono_items`).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { Panic, Unported } from "../../std/panic.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { provide } = await import("../lib.ts");
  const { collect_crate_mono_items } = await import("../collector.ts");
  const { display_MonoItem, MonoItem_to_stable_hash_key } = await import("../../rustc_middle/mono.ts");
  const { with_no_trimmed_paths } = await import("../../rustc_middle/ty/print/pretty.ts");
  const { Fingerprint } = await import("../../rustc_data_structures/fingerprint.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      const prev = config.override_queries;
      config.override_queries = (sess, providers) => {
        prev?.(sess, providers);
        provide(providers);
      };
    },
    after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      // rustc: partitioning.rs:1170: `if tcx.sess.link_dead_code() { Eager } else { Lazy }`
      const strategy = tcx.sess.link_dead_code() ? "Eager" : "Lazy";
      const [items, _usage_map] = collect_crate_mono_items(tcx, strategy);
      // rustc: partitioning.rs:1178: "Abort early if there are errors"
      tcx.dcx().abort_if_errors();
      const lines = tcx.with_stable_hashing_context((hcx) =>
        items.map((item) => {
          const fp = MonoItem_to_stable_hash_key(item, hcx);
          return `${fp.toString(16).padStart(32, "0")} ${with_no_trimmed_paths(() => display_MonoItem(item))}`;
        }),
      );
      process.stdout.write(lines.map((l) => `${l}\n`).join(""));
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
    console.error(`rust-ts: reached unported code: ${e.what}`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof Panic) {
    console.error(`rust-ts: internal compiler error: ${e.message}`);
    process.exitCode = 101;
  } else {
    throw e;
  }
}
