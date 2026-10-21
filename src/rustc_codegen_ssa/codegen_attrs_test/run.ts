// Test helper of src/rustc_codegen_ssa/codegen_attrs.test.ts (lane codegen-fn-attrs).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), lowers the crate (`hir_crate_items`), then
// computes `codegen_fn_attrs` of every definition whose `DefKind::has_codegen_attrs` (in definition order), as
// rustc_hir_analysis check.rs's `check_item_type` does through `tcx.ensure_ok().codegen_fn_attrs(def_id)`. On a crate
// whose only errors come from `codegen_fn_attrs`, stderr equals the oracle rustc's. An `unported(..)` stop exits 70
// with `UNPORTED: <what>` on stderr.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Unported } from "../../std/panic.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { DefKind } = await import("../../rustc_hir/def.ts");
  type ModuleItems = import("../../rustc_middle/hir/mod.ts").ModuleItems;
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.hir_crate_items(null) as ModuleItems;
      for (const def_id of items.definitions()) {
        if (DefKind.has_codegen_attrs(tcx.def_kind(def_id))) tcx.ensure_ok().codegen_fn_attrs(def_id);
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
