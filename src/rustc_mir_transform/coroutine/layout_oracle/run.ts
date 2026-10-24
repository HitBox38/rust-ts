// Test driver for layout.oracle.test.ts (lane mt-coroutine-b; not a port).
//   bun src/rustc_mir_transform/coroutine/layout_oracle/run.ts <rustc arguments...>
//
// As liveness_oracle/run.ts: `analysis` (rustc_interface passes.rs) is not ported, so in `after_expansion` this runs
// tydump's `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts), then the part of the `MIR_borrow_checking` loop
// of `run_required_analyses` that the cases need, in rustc's order per body owner: `check_unsafety` (typeck roots),
// then for non-trivial consts `has_ffi_unwind_calls`, `check_liveness`, and for coroutines `mir_coroutine_witnesses`
// (upstream reaches it from that loop through the coroutine's eager `layout_of` -> `optimized_mir` ->
// `mir_drops_elaborated_and_const_checked`, which forces `mir_coroutine_witnesses` before anything else; `mir_borrowck`,
// `check_transmutes` and the rest of that chain are not ported and do not run: the cases have no borrowck errors and
// nothing else that chain reports). Then `analysis`'s abort on non-lint errors and `check_expectations(None)`.
//
// With RUST_TS_DUMP_WITNESSES=1 every computed layout is printed to stdout as `== <def_path_str>`, then mir/pretty.rs's
// `write_coroutine_layout` (no extra comments) and one `coroutine debug <name> => _sN;` line per named field. The
// `storage_conflicts = ..` line is rendered here with upstream's `impl Debug for BitMatrix<R, C>` (bit_set.rs:1466:
// `(r, c)` through `R` / `C`'s Debug, i.e. `_sN`), because rustc_index's `debug_BitMatrix` prints raw numbers (a known
// issue, docs/handoff/mt-coroutine-b.md). layout.oracle.test.ts compares this with the oracle's `-Zdump-mir` header of
// `coroutine_resume` for cases where StateTransform's layout equals the witnesses' (no drops, no fake borrows).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../../rustc_span/def_id.ts");
  const { write_coroutine_layout } = await import("../../../rustc_middle/mir/pretty.ts");
  const { PrettyPrintMirOptions } = await import("../../../rustc_middle/mir/pretty.gen.ts");
  const { CoroutineSavedLocal } = await import("../../../rustc_middle/mir/query.ts");
  const { display_Symbol } = await import("../../../rustc_span/symbol.ts");
  const { VecU8 } = await import("../../../vendor/anstream/stream.ts");
  const { PLAIN } = await import("../../../std/fmt.ts");
  const dump = process.env.RUST_TS_DUMP_WITNESSES === "1";
  type CoroutineLayout = import("../../../rustc_middle/mir/query.ts").CoroutineLayout;
  const render = (tcx: TyCtxt, layout: CoroutineLayout): string => {
    const w = new VecU8();
    const r = write_coroutine_layout(tcx, layout, w, new PrettyPrintMirOptions(false));
    if (r.$ === "Err") throw new Error("write_coroutine_layout failed");
    const sc = layout.storage_conflicts;
    const items: string[] = [];
    for (let row = 0; row < sc.num_rows; row++) {
      for (const col of sc.iter(row as never)) {
        items.push(`(${CoroutineSavedLocal.debug(row as never, PLAIN)}, ${CoroutineSavedLocal.debug(col as never, PLAIN)})`);
      }
    }
    const conflicts = `storage_conflicts = BitMatrix(${sc.num_rows}x${sc.num_columns}) {${items.join(", ")}}`;
    let out = new TextDecoder().decode(w.bytes()).replace(/storage_conflicts = .*/, conflicts);
    layout.field_tys.forEach((f, i) => {
      if (f.debuginfo_name !== undefined) out += `coroutine debug ${display_Symbol(f.debuginfo_name)} => _s${i};\n`;
    });
    return out;
  };

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      // The dump prints types with trimmed paths: as the mirdump probe, `-Zunpretty=mir`'s one effect on the session
      // (`record_trimmed_def_paths` does not arm its "no diagnostics emitted" ICE). Only in dump mode.
      if (dump) config.opts.unstable_opts.unpretty = "mir";
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.sess.time("MIR_borrow_checking", () => {
        tcx.par_hir_body_owners((def_id) => {
          const not_typeck_child = !tcx.is_typeck_child(LocalDefId.to_def_id(def_id));
          if (not_typeck_child) {
            // Child unsafety and borrowck happens together with the parent
            tcx.ensure_ok().check_unsafety(def_id);
          }
          if (tcx.is_trivial_const(def_id)) {
            return;
          }
          // (`mir_borrowck` / `check_transmutes` left out, see the header.)
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);
          if (tcx.is_coroutine(LocalDefId.to_def_id(def_id))) {
            const layout = tcx.mir_coroutine_witnesses(def_id);
            if (dump) {
              process.stdout.write(`== ${tcx.def_path_str(LocalDefId.to_def_id(def_id))}\n`);
              process.stdout.write(layout === undefined ? "None\n" : render(tcx, layout));
            }
          }
        });
      });
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      tcx.check_expectations(undefined);
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
    if (process.env.RUST_TS_UNPORTED_STACK === "1") process.stderr.write(`${e.stack}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
