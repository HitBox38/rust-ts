// Test helper of src/rustc_ty_utils/assoc.test.ts (lane assoc-opaque).
//
// Runs the ported driver up to expansion, then prints, for every trait and impl of the crate (HIR owner order),
// the results of the `associated_item_def_ids`, `associated_types_for_impl_traits_in_trait_or_impl` and
// `associated_item` providers of rustc_ty_utils/assoc.ts. Def ids print as their item names (the `DefId` Debug
// carries the crate hash).
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";

function report(tcx: TyCtxt): string {
  const name = (d: DefId): string => Symbol.as_str(tcx.item_name(d));
  const lines: string[] = [];
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
    const item = tcx.hir_expect_item(id.owner_id.def_id);
    if (item.kind.$ !== "Trait" && item.kind.$ !== "Impl") continue;
    const what = item.kind.$ === "Trait" ? `trait ${Symbol.as_str(item.kind.ident.name)}` : `impl${item.kind._0.of_trait === undefined ? "" : " (trait)"}`;
    const ids = tcx.associated_item_def_ids(id.owner_id);
    lines.push(`${what}: associated_item_def_ids = [${ids.map(name).join(", ")}]`);
    const rpitit = tcx.associated_types_for_impl_traits_in_trait_or_impl(id.owner_id);
    lines.push(`  rpitit = {${[...rpitit].map(([k, v]) => `${name(k)}: [${v.length}]`).join(", ")}}`);
    for (const did of ids) {
      const a = tcx.associated_item(did) as AssocItem;
      const kind =
        a.kind.$ === "Fn"
          ? `Fn { name: ${Symbol.as_str(a.kind.name)}, has_self: ${a.kind.has_self} }`
          : a.kind.$ === "Const"
            ? `Const { name: ${Symbol.as_str(a.kind.name)} }`
            : `Type { data: ${a.kind.data.$}${a.kind.data.$ === "Normal" ? `(${Symbol.as_str(a.kind.data._0)})` : ""} }`;
      const c = a.container;
      const container = c.$ === "TraitImpl" ? `TraitImpl(${c._0.$ === "Ok" ? `Ok(${name(c._0._0)})` : "Err"})` : c.$;
      lines.push(`  ${name(a.def_id)}: ${kind}, ${container}, def_id matches: ${a.def_id.index === did.index}`);
    }
  }
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(report(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
