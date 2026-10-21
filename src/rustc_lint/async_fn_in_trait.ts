// Port of compiler/rustc_lint/src/async_fn_in_trait.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (async_fn_in_trait.lints.gen.ts).
import type * as hir from "../rustc_hir/hir.ts";
import { suggest_desugaring_async_fn_to_impl_future_in_trait } from "../rustc_trait_selection/error_reporting/traits/suggestions.ts";
import { ASYNC_FN_IN_TRAIT, AsyncFnInTrait } from "./async_fn_in_trait.lints.gen.ts";
import type { LateContext } from "./context.ts";
import { AsyncFnInTraitDiag_diagnostic } from "./diagnostics.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./async_fn_in_trait.lints.gen.ts";

declare module "./async_fn_in_trait.lints.gen.ts" {
  interface AsyncFnInTrait extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for AsyncFnInTrait
// rustc: compiler/rustc_lint/src/async_fn_in_trait.rs:93 check_trait_item
AsyncFnInTrait.prototype.check_trait_item = function (this: AsyncFnInTrait, cx: LateContext, item: hir.TraitItem): void {
  if (item.kind.$ === "Fn" && item.kind._0.header.asyncness.$ === "Async") {
    const sig = item.kind._0;
    const body = item.kind._1;
    const async_span = item.kind._0.header.asyncness._0;
    // RTN can be used to bound `async fn` in traits in a better way than "always"
    if (cx.tcx.features().return_type_notation()) {
      return;
    }

    // Only need to think about library implications of reachable traits
    if (!cx.tcx.effective_visibilities(null).is_reachable(item.owner_id.def_id)) {
      return;
    }

    if (!(sig.decl.output.$ === "Return" && sig.decl.output._0.kind.$ === "OpaqueDef")) {
      // This should never happen, but let's not ICE.
      return;
    }
    const opaq_def = sig.decl.output._0.kind._0;
    const sugg = suggest_desugaring_async_fn_to_impl_future_in_trait(cx.tcx, sig, body, opaq_def.def_id, " + Send");
    cx.tcx.emit_node_span_lint(ASYNC_FN_IN_TRAIT, item.hir_id(), async_span, AsyncFnInTraitDiag_diagnostic({ sugg }));
  }
};
