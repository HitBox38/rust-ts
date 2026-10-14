// Test helper of src/rustc_ast_lowering/lib.oracle.test.ts (lane lower-lib-a): runs the ported driver on a case of
// this directory up to expansion + name resolution (`after_expansion` -> `Stop`), then runs the ported `index_ast`
// query (lib.rs:587) and prints one line per HIR owner it indexes, in `LocalDefId` order:
// `{def_id:?} => {AstOwner variant}`. Then, for each `<fn name>=<first ItemLocalId>` given in `LOWER_TYS`, it makes a
// `LoweringContext` for that fn's owner (`LoweringContext::new`, lib.rs:350), sets the `ItemLocalId` counter to the
// oracle's id of the fn's first parameter type and lowers the parameter and return types with `lower_ty` (lib.rs:1534),
// printing each `hir::Ty` as `{:#?}`. The test compares the owner set and the `Ty` blocks with the oracle's
// `-Zunpretty=hir-tree`.
//
//   LOWER_TYS=f=14,ext=1 bun src/rustc_ast_lowering/lib_oracle/run.ts <rustc arguments...>
import { LanguageItems } from "../../rustc_attr_ir/lang_items.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const { ImplTraitContext, index_ast, LoweringContext } = await import("../lib.ts");
  const { debug_Ty } = await import("../../rustc_hir/lib.ts");
  const callbacks = {
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      // Test scaffolding: `index_ast` only `ensure_done`s these two queries (their values are not read); their
      // providers (rustc_passes lang_items.rs / debugger_visualizer.rs) are not ported yet.
      config.override_queries = (_sess, providers) => {
        providers.queries.get_lang_items = () => LanguageItems.new();
        providers.queries.debugger_visualizers = () => [];
      };
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const index = index_ast(tcx, null);
      let out = "";
      index.forEach((entry, i) => {
        if (entry === undefined) return;
        const [, owner] = entry.borrow();
        out += `${format_debug(LocalDefId.new(i), debug_LocalDefId, PLAIN)} => ${owner.$}\n`;
      });
      for (const spec of (process.env.LOWER_TYS ?? "").split(",").filter((x) => x !== "")) {
        const [name, first] = spec.split("=") as [string, string];
        for (const entry of index) {
          if (entry === undefined) continue;
          const [resolver, owner] = entry.borrow();
          if (owner.$ !== "Item" && owner.$ !== "ForeignItem") continue;
          const kind = owner._0.kind;
          if (kind.$ !== "Fn" || kind._0.ident.as_str() !== name) continue;
          const lctx = LoweringContext.new(tcx, resolver, owner._0.id);
          lctx.curr_owner.item_local_id_counter = ItemLocalId.from_u32(Number(first));
          const decl = kind._0.sig.decl;
          const tys = decl.inputs.map((p) => p.ty);
          if (decl.output.$ === "Ty") tys.push(decl.output._0);
          out += `--- ${name}\n`;
          for (const ty of tys) out += `${format_debug(lctx.lower_ty(ty, ImplTraitContext.Universal), (v, f) => debug_Ty(v, f, () => "()"), PRETTY)}\n`;
        }
      }
      std_print(out);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
