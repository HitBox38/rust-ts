// Test-only driver for src/rustc_monomorphize/partitioning.oracle.test.ts (lane mono-partition; not a port).
//   bun src/rustc_monomorphize/partitioning_oracle/run.ts <rustc arguments...>
//
// The ported driver, stopped after `tcx.ensure_ok().analysis(())` (the `after_analysis` callback, as
// rustc_interface/analysis_oracle/run.ts). It then forces `collect_and_partition_mono_items`, which is what `codegen_crate`
// does first, and which prints `-Zprint-mono-items`.
//
// `RUST_TS_PARTITION_CGUS=<file>` also writes to <file> the lines partitioning_oracle/probe/main.rs prints.
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
import { writeFileSync } from "node:fs";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { MonoItem as MonoItemT, MonoItemPartitions } from "../../rustc_middle/mono.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import { write_stderr, write_stdout } from "../../std/io.ts";
import { Panic, Unported } from "../../std/panic.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { CodegenUnitNameBuilder, display_MonoItem, MonoItem } = await import("../../rustc_middle/mono.ts");
  const { with_no_trimmed_paths } = await import("../../rustc_middle/ty/print/pretty.ts");
  const { LOCAL_CRATE } = await import("../../rustc_span/def_id.ts");
  const { Symbol } = await import("../../rustc_span/symbol.ts");

  /** What partitioning_oracle/probe/main.rs prints. */
  const cgu_lines = (tcx: TyCtxt): string => {
    const partitions = tcx.collect_and_partition_mono_items(null) as MonoItemPartitions;
    const item_str = (item: MonoItemT): string => with_no_trimmed_paths(() => display_MonoItem(item));
    const out: string[] = [];
    for (const cgu of partitions.codegen_units) {
      out.push(`CGU ${Symbol.as_str(cgu.name())} sym=${Symbol.as_str(cgu.symbol_name())} size=${cgu.size_estimate()} primary=${cgu.is_primary()} covdead=${cgu.is_code_coverage_dead_code_cgu()} n=${cgu.items().size}`);
      for (const [item, data] of cgu.items()) {
        out.push(`IT ${item_str(item)} ${data.linkage} ${data.visibility} inlined=${data.inlined} size=${data.size_estimate}`);
      }
      for (const [item] of cgu.items_in_deterministic_order(tcx)) {
        out.push(`DO ${MonoItem.symbol_name(item, tcx).name} ${item_str(item)}`);
      }
    }
    out.push(`ALL ${partitions.all_mono_items.size}`);
    return out.map((l) => `${l}\n`).join("");
  };

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
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
        write_stdout(lines.join(""));
      } else {
        tcx.collect_and_partition_mono_items(null);
        const cgus = process.env.RUST_TS_PARTITION_CGUS;
        if (cgus !== undefined) writeFileSync(cgus, cgu_lines(tcx));
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
    write_stderr(`rust-ts: reached unported code: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof Panic) {
    write_stderr(`rust-ts: internal compiler error: ${e.message}\n`);
    process.exitCode = 101;
  } else {
    throw e;
  }
}
