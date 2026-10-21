// Port of compiler/rustc_lint/src/unit_bindings.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (unit_bindings.lints.gen.ts).
import type * as hir from "../rustc_hir/hir.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import type { LateContext } from "./context.ts";
import { UnitBindingsDiag_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { UNIT_BINDINGS, UnitBindings } from "./unit_bindings.lints.gen.ts";

export * from "./unit_bindings.lints.gen.ts";

declare module "./unit_bindings.lints.gen.ts" {
  interface UnitBindings extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for UnitBindings
// rustc: compiler/rustc_lint/src/unit_bindings.rs:50 check_local
UnitBindings.prototype.check_local = function (this: UnitBindings, cx: LateContext, local: hir.LetStmt): void {
  // Suppress warning if user:
  // - explicitly ascribes a type to the pattern
  // - explicitly wrote `let pat = ();`
  // - explicitly wrote `let () = init;`.
  if (Span.from_expansion(local.span)) return;
  // PORT: `LateContext::typeck_results` is typed `unknown` in context.ts (lane lint-late-a types it).
  const tyck_results = cx.typeck_results as TypeckResults | undefined;
  if (tyck_results === undefined) return;
  const init = local.init;
  if (init === undefined) return;
  const init_ty = tyck_results.expr_ty(init);
  const local_ty = tyck_results.node_type(local.hir_id);
  if (
    init_ty === cx.tcx.types.unit &&
    local_ty === cx.tcx.types.unit &&
    local.ty === undefined &&
    !(init.kind.$ === "Tup" && init.kind._0.length === 0) &&
    !(local.pat.kind.$ === "Tuple" && local.pat.kind._0.length === 0)
  ) {
    cx.emit_span_lint(UNIT_BINDINGS, local.span, UnitBindingsDiag_diagnostic({ label: local.pat.span }));
  }
};
