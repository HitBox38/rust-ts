// Test driver for the late lint oracle tests (lane lint-late-a; not a port; shared by lanes lint-late-b..e2).
//   bun src/rustc_lint/late_oracle/run.ts [--late-pass=<file>:<Pass>]... <rustc arguments...>
//
// `analysis` (rustc_interface passes.rs) is not ported, so this does the part of it the late lints need: in
// `after_expansion`, tydump's `run_required_analyses_prefix` (run_required_analyses up to `definitions.freeze()`,
// including `rustc_hir_analysis::check_crate`'s typeck of every body; src/rust_ts/tydump_dump.ts), then `analysis`'s
// abort on non-lint errors ("we exclude lint errors from this"), then the late lints, then
// `check_expectations(None)` (unfulfilled `#[expect]`), then it stops.
//
// The late lints:
// - without `--late-pass`: the real `rustc_lint::check_crate` (late.rs:462): `late_lint_crate` and, per module, the
//   `lint_mod` query (`BuiltinCombinedLateLintModPass`). Every pass must be ported for this to get through.
// - with `--late-pass=<file>:<Pass>` (repeatable; `<file>` relative to src/rustc_lint, `<Pass>` an export of it): for
//   every module (`hir_for_each_module`, in order) `late_lint_mod(tcx, module, pass)`, where `pass` is a combined
//   pass (`declare_combined_late_lint_pass!`) of the listed passes in the given order (list them in lib.rs order to
//   get rustc's diagnostic order). A pass is constructed as lib.ts does: `Pass.default()` if it has `default`,
//   else `Pass.new()` if it has `new`, else `new Pass()`.
// MIR borrowck, liveness, dead code and the other misc checks do not run: test cases must not trigger them (the
// oracle runs everything).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LateLintPass } from "../passes.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  // `--late-pass=..` arguments are ours: take them out before `raw_args` reads `process.argv`.
  const pass_specs: string[] = [];
  for (let i = process.argv.length - 1; i >= 2; i--) {
    const a = process.argv[i]!;
    if (a.startsWith("--late-pass=")) {
      pass_specs.unshift(a.slice("--late-pass=".length));
      process.argv.splice(i, 1);
    }
  }
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const rustc_lint = await import("../lib.ts");
  const { declare_combined_late_lint_pass } = await import("../passes.ts");

  type PassClass = { new (): LateLintPass; default?: () => LateLintPass; new?: () => LateLintPass; lint_vec(): import("../../rustc_lint_defs/lib.ts").LintVec };
  const entries: Record<string, { ty: { lint_vec(): import("../../rustc_lint_defs/lib.ts").LintVec }; constructor_: () => LateLintPass }> = {};
  for (const spec of pass_specs) {
    const [file, name] = spec.split(":") as [string, string];
    const mod = (await import(`../${file}`)) as Record<string, unknown>;
    const cls = mod[name] as PassClass | undefined;
    if (cls === undefined) throw new Error(`late-pass: ${file} has no export ${name}`);
    const ctor = typeof cls.default === "function" ? () => cls.default!() : typeof cls.new === "function" ? () => cls.new!() : () => new cls();
    entries[name] = { ty: cls, constructor_: ctor };
  }
  const combined = pass_specs.length > 0 ? declare_combined_late_lint_pass("LateOracleTestPass", entries) : undefined;

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      if (combined === undefined) {
        rustc_lint.check_crate(tcx);
      } else {
        tcx.hir_for_each_module((module) => rustc_lint.late_lint_mod(tcx, module, combined.new()));
      }
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
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
