// Test helper of src/rustc_hir_analysis/check/compare_eii.test.ts (lane small-gaps-17).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), lowers the crate (`hir_crate_items`), then for
// every free fn / static (in `hir_crate_items` order) does what wfcheck.rs `check_eiis_fn` / `check_eiis_static`
// (:1154 / :1179, lane check-wf-b) do: find its `EiiImpl` attribute, resolve the declaration (`Macro(m)` -> the
// `EiiDeclaration` of `m` and `item_name(m)`; `Known(d)` -> `d` and `item_name(d)`; `Error` -> skip) and call
// `compare_eii_function_types` / `compare_eii_statics`. On a crate whose only error is an EII mismatch, stderr equals the
// oracle rustc's. An `unported(..)` stop exits 70 with `UNPORTED: <what>` on stderr.
//
//   bun run.ts <rustc arguments...>
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import type { Compiler } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, type Ty } from "../../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { Symbol } from "../../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { Unported } from "../../../std/panic.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  await import("../../lib.ts");
  const { compare_eii_function_types, compare_eii_statics } = await import("../compare_eii.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
        const def_id = id.owner_id.def_id;
        const kind = tcx.def_kind(def_id).$;
        if (kind !== "Fn" && kind !== "Static") continue;
        const eii = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "EiiImpl" ? k._0 : undefined));
        if (eii === undefined) continue;
        let foreign_item: DefId;
        let name: Symbol;
        const res = eii.resolution;
        if (res.$ === "Macro") {
          const t = find_attr(HasAttrs_DefId.get_attrs(res._0, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0.foreign_item : undefined));
          if (t === undefined) {
            tcx.dcx().span_delayed_bug(eii.span, "resolved to something that's not an EII");
            continue;
          }
          [foreign_item, name] = [t, tcx.item_name(res._0)];
        } else if (res.$ === "Known") {
          [foreign_item, name] = [res._0, tcx.item_name(res._0)];
        } else {
          continue;
        }
        if (kind === "Fn") {
          compare_eii_function_types(tcx, def_id, foreign_item, name, eii.span);
        } else {
          const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
          compare_eii_statics(tcx, def_id, ty, foreign_item, name, eii.span);
        }
      }
      return "Stop" as const;
    },
  };
  try {
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
  } catch (e) {
    if (e instanceof Unported) {
      process.stderr.write(`UNPORTED: ${e.what}\n`);
      return 70;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
