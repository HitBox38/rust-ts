// Test helper of src/rustc_hir_analysis/check/wfcheck_b.test.ts (lane check-wf-b).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as variance_outlives_test/run.ts), then
// - `variances <rustc arguments...>`: calls `wfcheck::check_variances_for_type_defn` for every enum / struct / union
//   among the free items, in `hir_crate_items` order, as check/check.rs:828 / :923 do from `check_well_formed`. On a
//   crate whose only errors are E0392, stderr equals the oracle rustc's;
// - `wf <rustc arguments...>`: calls the wfcheck entry points of this lane on every free item, as check/check.rs and
//   wfcheck.rs `check_item` do: `check_static_item` (statics), `check_item_fn` (fns), `check_impl` (impls), then
//   `check_associated_item` on every impl item (their owners come after the free items in `check_type_wf`). They stop
//   at the stand-ins of other lanes today; the test checks the stop text.
//
//   bun run.ts variances|wf <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  await import("../../lib.ts");
  const wfcheck = await import("../wfcheck.ts");
  if (mode === "variances") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
          const def_id = id.owner_id.def_id;
          const k = tcx.def_kind(def_id).$;
          if (k === "Enum" || k === "Struct" || k === "Union") {
            wfcheck.check_variances_for_type_defn(tcx, def_id);
          }
        }
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  if (mode === "wf") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
          const def_id = id.owner_id.def_id;
          const item = tcx.hir_item(id);
          switch (item.kind.$) {
            case "Static": {
              // check/check.rs:812
              const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
              wfcheck.check_static_item(tcx, def_id, ty, true);
              break;
            }
            case "Fn":
              // wfcheck.rs:319
              wfcheck.check_item_fn(tcx, def_id, item.kind.sig.decl);
              break;
            case "Impl":
              // wfcheck.rs:315
              wfcheck.check_impl(tcx, item, item.kind._0);
              break;
            default:
              break;
          }
        }
        // the impl items' owners after the free items, as `check_type_wf`'s owner loop (wfcheck.rs:2614) reaches them:
        // `check_well_formed` -> `check_item_type` -> `check_associated_item` (wfcheck.rs; e.g. the method receiver
        // check, E0307). Lane typeck-gaps: reachable since `ConstraintCategory` is ported.
        for (const id of (tcx.hir_crate_items(null) as ModuleItems).impl_items()) {
          wfcheck.check_associated_item(tcx, id.owner_id.def_id);
        }
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
