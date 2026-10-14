// Test driver for src/rustc_lint/levels_hir.oracle.test.ts (lane lint-levels-hir; not a port).
//   bun src/rustc_lint/levels_hir_oracle/run.ts <rustc arguments...>
//
// Runs the ported driver and, in `after_expansion`, does the part of `run_required_analyses` that the HIR lint
// level tests need and that is ported: for every item-like owner (`hir_crate_items().definitions()`, in order)
// whose `def_kind` is a fn, `generics_of` and `fn_sig`; for every struct/union, `generics_of` and `type_of` of each field
// (`generics_of` emits `invalid_type_param_default`) (HIR ty lowering emits
// `bare_trait_objects` there, through `TyCtxt::emit_node_span_lint` and `shallow_lint_levels_on`). Then, as
// `analysis` does after the lint passes, `check_expectations(None)` (unfulfilled `#[expect]`), after `analysis`'s abort on non-lint errors. Then it stops.
// rustc_hir_analysis::check_crate is not ported, so the test cases have at most one lint-emitting item each, and
// the oracle compiles them as libs with `--emit=metadata` (no other diagnostics).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { VariantData } = await import("../../rustc_hir/hir.ts");

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.hir_crate_items(null) as import("../../rustc_middle/hir/mod.ts").ModuleItems;
      for (const def_id of items.definitions()) {
        const kind = tcx.def_kind(LocalDefId.to_def_id(def_id));
        if (kind.$ === "Fn" || kind.$ === "AssocFn") {
          tcx.generics_of(LocalDefId.to_def_id(def_id));
          tcx.fn_sig(LocalDefId.to_def_id(def_id));
        } else if (kind.$ === "Struct" || kind.$ === "Union") {
          tcx.generics_of(LocalDefId.to_def_id(def_id));
          const item = tcx.hir_expect_item(def_id);
          if (item.kind.$ === "Struct" || item.kind.$ === "Union") {
            for (const field of VariantData.fields(item.kind._2)) tcx.type_of(LocalDefId.to_def_id(field.def_id));
          }
        }
      }
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();
      tcx.check_expectations(undefined);
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
