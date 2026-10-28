// Test driver for alias_check.test.ts (lane fix-ubchecks-alias; not a port).
//   bun src/rustc_mir_transform/alias_check_oracle/run.ts <rustc arguments>
//
// Runs the real driver up to `after_expansion`, then tydump's `run_required_analyses_prefix`
// (src/rust_ts/tydump_dump.ts) and the `MIR_borrow_checking` loop of `run_required_analyses` (`check_unsafety`,
// `has_ffi_unwind_calls`, `check_liveness`, `mir_borrowck`), aborts on errors as `analysis` does, and then asks for the
// bodies `--emit=mir` renders (`optimized_mir`, plus `mir_for_ctfe` for const fns) of every `mir_keys` entry that is
// not a trivial const. A body whose pipeline reaches unported code prints `STOP <def> <what>` and the next body runs.
//
// `MirDumper::new` and `MirDumper::dump_mir` are replaced: whenever the pass manager would dump a body under
// `-Zdump-mir=all` (before / after every pass, and at phase changes; no file is written), the body is walked with alias_check.ts's `find_shared_mir_nodes`, and every MIR node reachable from two
// positions prints one `ALIAS <pass>.<disambiguator> <def> <what> <path> == <path>` line (the first pass where it
// appears). At the end, the bodies that were completed are walked together (no MIR node may be shared between two
// bodies either), and one `CHECKED <dumps> <passes...>` line lists how many dumps were checked and which passes ran.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code outside a body, 101 = ICE.
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
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { MirDumper, MirWriter } = await import("../../rustc_middle/mir/pretty.ts");
  const { find_shared_mir_nodes } = await import("./alias_check.ts");

  let dumps = 0;
  const passes = new Set<string>();
  const reported = new Set<string>();
  // Every `MirDumper::new` (as with `-Zdump-mir=all`) returns a dumper, except the borrowck / dataflow ones (they write
  // graphviz and extra files, not through `dump_mir`); `dump_mir` checks the body and writes nothing.
  const NOT_DUMPED = new Set(["renumber", "nll", "polonius", "dataflow"]);
  MirDumper.new = function (tcx, pass_name, _body) {
    return NOT_DUMPED.has(pass_name) ? undefined : new MirDumper(false, pass_name, "0", MirWriter.new(tcx));
  };
  MirDumper.prototype.dump_mir = function (this: InstanceType<typeof MirDumper>, body) {
    dumps += 1;
    passes.add(this.pass_name);
    for (const s of find_shared_mir_nodes(body, "body", 10)) {
      const def = this.tcx().def_path_str(body.source.def_id());
      const key = `${def}|${s.what}|${s.first}|${s.second}`;
      if (reported.has(key)) continue;
      reported.add(key);
      process.stdout.write(`ALIAS ${this.pass_name}.${this.disambiguator} ${def} ${s.what} ${s.first} == ${s.second}\n`);
    }
  };

  const callbacks = {
    // No `trimmed_def_paths` (as `TimePassesCallbacks::config` sets): the def paths printed here are not diagnostics.
    config(_config: Config): void {},
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
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);
          if (not_typeck_child) {
            tcx.ensure_ok().mir_borrowck(def_id);
          }
        });
      });
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();

      const finals: object[] = [];
      for (const ldef of tcx.mir_keys(null)) {
        const def = LocalDefId.to_def_id(ldef);
        try {
          if (tcx.is_const_fn(def)) {
            finals.push(tcx.optimized_mir(def));
            finals.push(tcx.mir_for_ctfe(def));
          } else if (tcx.trivial_const(ldef) === undefined) {
            finals.push(tcx.optimized_mir(def));
          }
        } catch (e) {
          if (!(e instanceof Unported)) throw e;
          process.stdout.write(`STOP ${tcx.def_path_str(def)} ${e.what}\n`);
        }
      }
      for (const s of find_shared_mir_nodes([...new Set(finals)], "bodies", 10)) {
        process.stdout.write(`ALIAS final-bodies ${s.what} ${s.first} == ${s.second}\n`);
      }
      process.stdout.write(`CHECKED ${dumps} ${[...passes].join(" ")}\n`);
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
