// Test helper of src/rustc_hir_analysis/autoderef.test.ts (lane small-gaps-17).
//
// Runs the ported driver up to expansion (`after_expansion` -> `Stop`), lowers the crate (`hir_crate_items`), then for
// every local `fn` whose name starts with `ad_` (DefIndex order) and every input type of its `fn_sig` (identity args,
// bound regions left in place), builds `Autoderef::new(&infcx, ParamEnv::empty(), def_id, def_span, ty)` on a
// `non_body_analysis` InferCtxt, configured from the fn's name (`raw` -> `include_raw_pointers()`, `recv` ->
// `use_receiver_trait()`, `silent` -> `silence_errors()`), drives it to the end and prints
//   `<name>: (<ty>, <n>) ... | final=<final_ty()> steps=<steps():?> limit=<reached_recursion_limit()>`
// (`Ty` by Display, the steps by `{:?}`, under `with_no_trimmed_paths!`). The expected files were checked against the
// pinned rustc_driver running the same loop with rustc_hir_analysis's own `Autoderef` (docs/handoff/small-gaps-17.md,
// "Oracle check"). An `unported(..)` stop exits 70 with `UNPORTED: <what>` on stderr.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ParamEnv, type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type LocalDefId, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_list, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";

let Autoderef: typeof import("../autoderef.ts").Autoderef;

function report(tcx: TyCtxt): void {
  tcx.hir_crate_items(null);
  const n = tcx.definitions_untracked().num_definitions();
  for (let i = 0; i < n; i++) {
    const id = i as LocalDefId;
    if (tcx.def_kind(id).$ !== "Fn") continue;
    const name = Symbol.as_str(tcx.item_name(LocalDefIdC.to_def_id(id)));
    if (!name.startsWith("ad_")) continue;
    const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(id) as EarlyBinder<PolyFnSig>));
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    for (const ty of FnSig.inputs(Binder.skip_binder(sig))) {
      let ad = Autoderef.new(infcx, ParamEnv.empty(), id, tcx.def_span(id), ty);
      if (name.includes("raw")) ad = ad.include_raw_pointers();
      if (name.includes("recv")) ad = ad.use_receiver_trait();
      if (name.includes("silent")) ad = ad.silence_errors();
      let out = "";
      for (const [t, k] of ad) out += with_no_trimmed_paths(() => ` (${display_Ty(t)}, ${k})`);
      const steps = with_no_trimmed_paths(() => debug_list(PLAIN, ad.steps().map(([t, k]: [Ty, string]) => debug_tuple(PLAIN, "", [debug_Ty(t, PLAIN), k]))));
      const final_ = with_no_trimmed_paths(() => display_Ty(ad.final_ty()));
      process.stdout.write(`${name}:${out} | final=${final_} steps=${steps} limit=${ad.reached_recursion_limit()}\n`);
    }
  }
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  Autoderef = (await import("../lib.ts")).autoderef.Autoderef;
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      report(tcx);
      return "Stop" as const;
    },
  };
  try {
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
  } catch (e) {
    // As the port's main (src/rust_ts): an `unported(..)` stop is exit 70 with its text on stderr.
    if (e instanceof Unported) {
      process.stderr.write(`UNPORTED: ${e.what}\n`);
      return 70;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
