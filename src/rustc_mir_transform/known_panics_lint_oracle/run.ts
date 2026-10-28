// Test driver for known_panics_lint.oracle.test.ts (lane mt-kpl-ubchecks; not a port).
//   bun src/rustc_mir_transform/known_panics_lint_oracle/run.ts <rustc arguments...>
//
// `KnownPanicsLint` runs in `mir_drops_elaborated_and_const_checked`, after `mir_borrowck` and the analysis-to-runtime
// lowering (drop elaboration, ...), none of which is ported yet. So in `after_expansion` this runs tydump's
// `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts), then the `MIR_borrow_checking` loop of
// `run_required_analyses` as the mirdump probe does (`check_unsafety`, `has_ffi_unwind_calls`, `check_liveness`; no
// `mir_borrowck`), and where rustc calls `mir_drops_elaborated_and_const_checked` (`should_codegen()` or a const
// context) it runs `KnownPanicsLint` on the `mir_promoted` body instead. The test cases are chosen so that the
// skipped passes cannot change what the lint sees (`Copy` scalars and arrays: no drops, no coroutines, no borrowck
// errors). Then `analysis`'s abort on non-lint errors and `check_expectations(None)`.
//
// With `KPL_ORACLE_UB_PASSES=1` it also prints, for every fn of `mir_keys`, the `mir_promoted` body (`// before`) and
// the body after each of `CheckAlignment`, `CheckNull`, `CheckEnums` run on it in that order (`// after <pass>`), via
// `MirWriter::write_mir_fn`, to stdout. The test compares them with rustc's `-Zdump-mir` files for bodies whose
// `mir_promoted` text equals rustc's "before CheckAlignment" text (no runtime lowering pass changed them).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;
if (process.env.KPL_ORACLE_STACK === "1") Error.stackTraceLimit = 200;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { KnownPanicsLint } = await import("../known_panics_lint.ts");
  const { CheckAlignment } = await import("../check_alignment.ts");
  const { CheckNull } = await import("../check_null.ts");
  const { CheckEnums } = await import("../check_enums.ts");
  const { MirWriter } = await import("../../rustc_middle/mir/pretty.ts");
  const { clone_Body } = await import("../../rustc_middle/mir/mod.ts");
  const { DefKind } = await import("../../rustc_hir/def.ts");
  const { VecU8 } = await import("../../vendor/anstream/stream.ts");
  const std_result = await import("../../std/result.ts");
  const { debug_IoError } = await import("../../std/io.ts");

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      // As the mirdump probe: `-Zunpretty=mir`'s effect on `record_trimmed_def_paths` (the MIR printing uses trimmed
      // paths without emitting a diagnostic).
      if (process.env.KPL_ORACLE_UB_PASSES === "1") config.opts.unstable_opts.unpretty = "mir";
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
          // (`mir_borrowck` and `check_transmutes` are left out.)
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);

          // In place of `mir_drops_elaborated_and_const_checked`: the lint on the `mir_promoted` body.
          if (tcx.sess.opts.output_types.should_codegen() || tcx.hir_body_const_context(def_id) !== undefined) {
            const [body] = tcx.mir_promoted(def_id);
            new KnownPanicsLint().run_lint(tcx, body.borrow());
          }
        });
      });
      if (process.env.KPL_ORACLE_UB_PASSES === "1") {
        const write = (body: Parameters<typeof clone_Body>[0]): string => {
          const w = new VecU8();
          std_result.unwrap_result(MirWriter.new(tcx).write_mir_fn(body, w), debug_IoError);
          return new TextDecoder("utf-8", { fatal: true }).decode(w.bytes());
        };
        let out = "";
        for (const def_id of tcx.mir_keys(null)) {
          if (!DefKind.is_fn_like(tcx.def_kind(def_id)) || tcx.is_constructor(LocalDefId.to_def_id(def_id))) continue;
          const body = clone_Body(tcx.mir_promoted(def_id)[0].borrow());
          out += `// before\n${write(body)}`;
          for (const pass of [new CheckAlignment(), new CheckNull(), new CheckEnums()]) {
            pass.run_pass(tcx, body);
            out += `// after ${pass.name()}\n${write(body)}`;
          }
        }
        process.stdout.write(out);
      }
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
    if (process.env.KPL_ORACLE_STACK === "1") process.stderr.write(`${e.stack}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
