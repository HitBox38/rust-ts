// Test helper of src/rustc_hir_analysis/check/wfcheck_a.test.ts (lane check-wf-a).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as variance_outlives_test/run.ts), then walks the
// crate's items in `check_type_wf`'s order (wfcheck.rs:2614: free items, impl items, trait items, foreign items) and,
// for each owner, makes the calls into wfcheck.rs:1-1139 that `check_well_formed` (wfcheck.rs:221) makes through
// `check::check::check_item_type` (check.rs, lane check-check, not in this lane's base), then `check_param_wf` for every
// own generic param. Not a port: `check_item_type`'s other checks are not made.
// - `wf`: per `DefKind`, as check.rs's `check_item_type`: Struct `check_type_defn(.., false)`, Union / Enum
//   `check_type_defn(.., true)`, Trait `check_trait` + `check_gat_where_clauses`, TraitAlias `check_trait`, Impl / Fn
//   `check_item`, associated items `check_associated_item` (+ `check_trait_item` in a trait), foreign items
//   `check_foreign_item`.
// - `lint`: only the calls that do not build an `ObligationCtxt`: `check_gat_where_clauses` for traits, `check_item` for
//   impls, `check_trait_item` for trait items. On a crate whose only wfcheck diagnostics come from these, stderr equals
//   the oracle rustc's.
//
//   bun run.ts wf|lint <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import type { LocalDefId } from "../../../rustc_span/def_id.ts";

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  if (mode !== "wf" && mode !== "lint") {
    console.error(`ERROR: unknown mode ${mode}`);
    return 2;
  }
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const wfcheck = await import("../wfcheck.ts");

  function params(tcx: TyCtxt, def_id: LocalDefId): void {
    for (const param of (tcx.generics_of(def_id) as Generics).own_params) wfcheck.check_param_wf(tcx, param);
  }

  function assoc(tcx: TyCtxt, def_id: LocalDefId): void {
    const in_trait = (tcx.associated_item(def_id) as AssocItem).container.$ === "Trait";
    if (mode === "wf") wfcheck.check_associated_item(tcx, def_id);
    if (in_trait) wfcheck.check_trait_item(tcx, def_id);
    params(tcx, def_id);
  }

  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.hir_crate_items(null) as ModuleItems;
      for (const id of items.free_items()) {
        const def_id = id.owner_id.def_id;
        const item = tcx.hir_item(id);
        const k = tcx.def_kind(def_id);
        if (mode === "wf") {
          if (k.$ === "Struct") wfcheck.check_type_defn(tcx, def_id, false);
          else if (k.$ === "Union" || k.$ === "Enum") wfcheck.check_type_defn(tcx, def_id, true);
          else if (k.$ === "Trait") {
            wfcheck.check_trait(tcx, def_id);
            wfcheck.check_gat_where_clauses(tcx, def_id);
          } else if (k.$ === "TraitAlias") wfcheck.check_trait(tcx, def_id);
          else if (k.$ === "Impl" || k.$ === "Fn") wfcheck.check_item(tcx, item);
        } else {
          if (k.$ === "Trait") wfcheck.check_gat_where_clauses(tcx, def_id);
          else if (k.$ === "Impl") wfcheck.check_item(tcx, item);
        }
        params(tcx, def_id);
      }
      for (const id of items.impl_items()) assoc(tcx, id.owner_id.def_id);
      for (const id of items.trait_items()) assoc(tcx, id.owner_id.def_id);
      for (const id of items.foreign_items()) {
        if (mode === "wf") wfcheck.check_foreign_item(tcx, tcx.hir_foreign_item(id));
        params(tcx, id.owner_id.def_id);
      }
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
