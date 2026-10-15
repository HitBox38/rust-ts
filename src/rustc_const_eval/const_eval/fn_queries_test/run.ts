// Test helper of src/rustc_const_eval/const_eval/fn_queries.test.ts (lane small-gaps-17).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`, as rustc_hir_analysis/collect_test/run.ts), lowers
// the crate (`hir_crate_items`), then prints, for every local DefId in DefIndex order whose kind is `Fn`, `AssocFn`,
// `Ctor(_, Fn)`, `Closure` or `Impl`, the line `<LocalDefId:?> <DefKind:?> <tcx.constness(def_id):?> promotable=<tcx.is_promotable_const_fn(def_id)>` (under
// `with_no_trimmed_paths!`). The expected files were checked against the pinned rustc_driver with the same loop (see
// docs/handoff/small-gaps-17.md, "Oracle check"). Diagnostics the provider emits go to stderr as usual.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import { def } from "../../../rustc_hir/lib.ts";
import { debug_Constness, type Constness } from "../../../rustc_hir/hir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_LocalDefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { PLAIN } from "../../../std/fmt.ts";

function report(tcx: TyCtxt): void {
  tcx.hir_crate_items(null);
  const n = tcx.definitions_untracked().num_definitions();
  for (let i = 0; i < n; i++) {
    const id = i as LocalDefId;
    const k = tcx.def_kind(id);
    const ask = k.$ === "Fn" || k.$ === "AssocFn" || (k.$ === "Ctor" && k._1 === "Fn") || k.$ === "Closure" || k.$ === "Impl";
    if (ask) {
      const c = tcx.constness(id) as Constness;
      process.stdout.write(with_no_trimmed_paths(() => `${debug_LocalDefId(id, PLAIN)} ${def.debug_DefKind(k, PLAIN)} ${debug_Constness(c, PLAIN)} promotable=${tcx.is_promotable_const_fn(LocalDefId.to_def_id(id))}\n`));
    }
  }
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      report(tcx);
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
