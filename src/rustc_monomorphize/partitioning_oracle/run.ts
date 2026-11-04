// Test-only driver for src/rustc_monomorphize/partitioning.oracle.test.ts (lane mono-partition; not a port).
//   bun src/rustc_monomorphize/partitioning_oracle/run.ts <rustc arguments...>
//
// The ported driver, stopped after `tcx.ensure_ok().analysis(())` (the `after_analysis` callback, as
// rustc_interface/analysis_oracle/run.ts). The partitioning providers are installed here through `override_queries`, not
// in `DEFAULT_QUERY_PROVIDERS`, so no production path reaches them. It then forces `collect_and_partition_mono_items`,
// which is what `codegen_crate` does first, and which prints `-Zprint-mono-items`.
//
//
// `RUST_TS_PARTITION_INCREMENTAL=1` stands for `-C incremental=<dir>`: rustc_incremental is out of scope (the session
// setup stops at `unported`), but partitioning only reads whether the option is set. The driver sets
// `sess.opts.incremental` in `after_expansion`, before any query that reads it (`cross_crate_inlinable`,
// `instantiation_mode`, `Session::codegen_units`) runs.
//
// `RUST_TS_PARTITION_ACYCLIC=1` stands for a target JSON with `static-initializer-must-be-acyclic`, because the port has no
// `--target <file>.json` (`TargetTuple::from_path` stops at `unported`) and no spec or ABI for nvptx64-nvidia-cuda.
//
// `RUST_TS_PARTITION_NAMES=1` prints `CodegenUnitNameBuilder`'s names instead, which needs no collector.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import { existsSync } from "node:fs";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { Panic, Unported } from "../../std/panic.ts";

const EXIT_UNPORTED = 70;

/** What lane mono-collector's `collector.ts` and `lib.ts` export; `undefined` until it merges. */
interface LibModule {
  provide: (providers: Providers) => void;
}

async function load_optional<M>(path: string): Promise<M | undefined> {
  // A variable path: tsc must not resolve it while the file is absent.
  if (!existsSync(new URL(path, import.meta.url))) return undefined;
  return (await import(path)) as M;
}

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const partitioning = await import("../partitioning.ts");
  const { CodegenUnitNameBuilder } = await import("../../rustc_middle/mono.ts");
  const { LOCAL_CRATE } = await import("../../rustc_span/def_id.ts");
  const { Symbol } = await import("../../rustc_span/symbol.ts");
  const lib_module = await load_optional<LibModule>("../lib.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      const prev = config.override_queries;
      config.override_queries = (sess, providers) => {
        prev?.(sess, providers);
        partitioning.provide(providers);
        // The collector's and `mono_checks`' providers. After the merge `lib.provide` calls `partitioning.provide` itself.
        lib_module?.provide(providers);
      };
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      if (process.env.RUST_TS_PARTITION_INCREMENTAL === "1") {
        // Lowering first: under the option it hashes the HIR for the dep graph, which is out of scope and unobservable.
        tcx.ensure_done().hir_crate_items(null);
        tcx.sess.opts.incremental = "rust-ts-stands-for-incremental";
      }
      if (process.env.RUST_TS_PARTITION_ACYCLIC === "1") {
        tcx.sess.target.options.static_initializer_must_be_acyclic = true;
      }
      return "Continue";
    },
    after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      if (process.env.RUST_TS_PARTITION_NAMES === "1") {
        // What needs a real `TyCtxt` but no collector: the name of a CGU of each crate.
        const builder = CodegenUnitNameBuilder.new(tcx);
        const lines = [LOCAL_CRATE, ...tcx.crates(null)].map((cnum) => {
          const no_mangle = builder.build_cgu_name_no_mangle(cnum, ["a", "b"], "suffix");
          const named = builder.build_cgu_name(cnum, ["a", "b"], undefined);
          return `CGU_NAME ${Symbol.as_str(no_mangle)} ${Symbol.as_str(named)}\n`;
        });
        process.stdout.write(lines.join(""));
      } else {
        tcx.collect_and_partition_mono_items(null);
      }
      // `TyCtxt::finish` would serialize the dep graph (rustc_incremental, out of scope).
      tcx.sess.opts.incremental = undefined;
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
    process.stderr.write(`rust-ts: reached unported code: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof Panic) {
    process.stderr.write(`rust-ts: internal compiler error: ${e.message}\n`);
    process.exitCode = 101;
  } else {
    throw e;
  }
}
