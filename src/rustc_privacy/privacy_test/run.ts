// Test helper of src/rustc_privacy/privacy.test.ts (lane privacy-effvis).
//
// Runs the ported driver (real parsing, expansion, resolution, AST lowering and the ported rustc_hir_analysis
// collect queries) and then the part of `analysis` (rustc_interface passes.rs `misc_checking_3`) that the
// rustc_privacy providers own: `effective_visibilities(())` (whose `TestReachabilityVisitor` reports
// `#[rustc_effective_visibility]`), then `check_private_in_public(module)` for every module (`par_hir_for_each_module`).
// PORT (test): `par_hir_for_each_module` is `hir_for_each_module` (`par_for_each_in` is unported; single-threaded rustc
// visits the modules in the same order).
// `--effvis-only` runs only `effective_visibilities`. `--mod-privacy` also runs `check_mod_privacy(module)` (stops UNPORTED at `typeck` on any body).
//
// PORT (test): `run_required_analyses` (typeck, borrowck, ...) and the other `misc_checking_3` passes
// (`check_mod_deathness`, lint checking, ...) are not run: the test programs are well-formed and allow `dead_code`, so
// the oracle's output is exactly what these queries emit.
//
//   bun run.ts [--effvis-only | --mod-privacy] <rustc arguments...>
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";

async function main(argv: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { ModuleItems } = await import("../../rustc_middle/hir/mod.ts");
  // PORT (test): stand-in for the unported `rustc_data_structures::sync::try_par_for_each_in` (sync/parallel.rs) behind
  // `ModuleItems::par_items` / `par_foreign_items`: its serial path (single-threaded rustc) runs `for_each` on every
  // item in order and returns the first error (`fold(Ok(()), Result::and)`).
  type R = import("../../std/result.ts").Result<null, import("../../rustc_span/lib.ts").ErrorGuaranteed>;
  const serial = <T>(items: readonly T[], f: (i: T) => R): R => {
    let acc: R = { $: "Ok", _0: null };
    for (const i of items) {
      const r = f(i);
      if (acc.$ === "Ok") acc = r;
    }
    return acc;
  };
  ModuleItems.prototype.par_items = function (f) {
    return serial(this.free_items(), f);
  };
  ModuleItems.prototype.par_foreign_items = function (f) {
    return serial(this.foreign_items(), f);
  };
  const effvis_only = argv[0] === "--effvis-only";
  const mod_privacy = argv[0] === "--mod-privacy";
  const args = mod_privacy || effvis_only ? argv.slice(1) : argv;
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(c: Config): void {
      c.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      tcx.ensure_ok().effective_visibilities(null);
      if (!effvis_only) tcx.hir_for_each_module((module) => tcx.ensure_ok().check_private_in_public(module));
      if (mod_privacy) tcx.hir_for_each_module((module) => tcx.ensure_ok().check_mod_privacy(module));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

const { Unported } = await import("../../std/panic.ts");
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // Unported code exits 70 (UNPORTED), like the harness runners.
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    throw e;
  }
}
