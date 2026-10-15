// Test helper of src/rustc_hir_analysis/check/check_region_intrinsic.test.ts (lane check-region-intrinsic).
//
//   bun run.ts drops <rustc arguments...>
//
// Runs the ported driver up to expansion, then for every free struct / enum / union item, in `hir_crate_items` order,
// runs check/mod.rs:127 `adt_destructor`'s first step, `tcx.calculate_dtor(def_id, always_applicable::check_drop_impl)`
// (`adt_destructor` itself is lane check-check's). On a crate whose only errors come from `check_drop_impl`, stderr
// equals the oracle rustc's. Stdout gets one line per ADT: `<name>: dtor` / `<name>: none`.
//
// Test-only stand-ins: `orphan_check_impl` (coherence/orphan.rs) and `coherent_trait` (coherence/mod.rs), which
// `calculate_dtor` checks first for `Drop`, have no provider in this lane's base (lane coherence), so both are
// overridden with `Ok(())`. In the fixture crates every `Drop` impl is on a local ADT and the oracle reports no
// coherence or orphan error (coherence/builtin.rs `visit_implementation_of_drop` does not run `check_drop_impl`), so
// this is the value the real queries return for them.
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Ok } from "../../../std/result.ts";

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  const always_applicable = await import("../always_applicable.ts");
  if (mode === "drops") {
    const callbacks = {
      config(config: Config): void {
        config.override_queries = (_sess, providers) => {
          providers.queries.orphan_check_impl = () => Ok(null);
          providers.queries.coherent_trait = () => Ok(null);
        };
      },
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        const lines: string[] = [];
        for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
          const def_id = id.owner_id.def_id;
          const k = tcx.def_kind(def_id).$;
          if (k !== "Struct" && k !== "Enum" && k !== "Union") continue;
          // check/mod.rs:128
          const dtor = tcx.calculate_dtor(def_id, always_applicable.check_drop_impl);
          lines.push(`${Symbol.as_str(tcx.item_name(def_id))}: ${dtor === undefined ? "none" : "dtor"}`);
        }
        std_print(lines.map((l) => l + "\n").join(""));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
