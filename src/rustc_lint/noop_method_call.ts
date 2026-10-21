// Port of compiler/rustc_lint/src/noop_method_call.rs. The lint statics and the `declare_lint_pass!` expansion are
// generated (noop_method_call.lints.gen.ts).
import type { Expr } from "../rustc_hir/hir.ts";
import { fold_GenericArgs, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { NoopMethodCallDiag_diagnostic, SuspiciousDoubleRefCloneDiag_diagnostic, SuspiciousDoubleRefDerefDiag_diagnostic } from "./diagnostics.gen.ts";
import { NOOP_METHOD_CALL, NoopMethodCall, SUSPICIOUS_DOUBLE_REF_OP } from "./noop_method_call.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./noop_method_call.lints.gen.ts";

declare module "./noop_method_call.lints.gen.ts" {
  interface NoopMethodCall extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for NoopMethodCall
// rustc: compiler/rustc_lint/src/noop_method_call.rs:70 check_expr
NoopMethodCall.prototype.check_expr = function (this: NoopMethodCall, cx: LateContext, expr: Expr): void {
  // We only care about method calls.
  if (expr.kind.$ !== "MethodCall") {
    return;
  }
  const { _0: call, _1: receiver, _3: call_span } = expr.kind;

  if (Span.from_expansion(call_span)) {
    return;
  }

  // We only care about method calls corresponding to the `Clone`, `Deref` and `Borrow`
  // traits and ignore any other method call.

  // PORT: `LateContext::typeck_results` / `typing_env` are typed `unknown` in context.ts (lane lint-late-a types them).
  const typeck_results = (): TypeckResults => cx.typeck_results_() as TypeckResults;
  const d = typeck_results().type_dependent_def(expr.hir_id);
  if (d === undefined || d[0].$ !== "AssocFn") {
    return;
  }
  const did = d[1];

  const trait_id = cx.tcx.trait_of_assoc(did);
  if (trait_id === undefined) return;

  const trait_ = cx.tcx.get_diagnostic_name(trait_id);
  if (trait_ === undefined) return;

  if (!(trait_ === sym.Borrow || trait_ === sym.Clone || trait_ === sym.Deref)) {
    return;
  }

  const args = cx.tcx.normalize_erasing_regions(cx.typing_env() as TypingEnv, Unnormalized.new_wip(typeck_results().node_args(expr.hir_id)), fold_GenericArgs) as GenericArgs;
  // Resolve the trait method instance.
  const r = Instance.try_resolve(cx.tcx, cx.typing_env() as TypingEnv, did, args);
  if (r.$ !== "Ok" || r._0 === undefined) {
    return;
  }
  const i = r._0;
  // (Re)check that it implements the noop diagnostic.
  const name = cx.tcx.get_diagnostic_name(Instance.def_id(i));
  if (name === undefined) return;
  if (!(name === sym.noop_method_borrow || name === sym.noop_method_clone || name === sym.noop_method_deref)) {
    return;
  }

  const receiver_ty = typeck_results().expr_ty(receiver);
  const expr_ty = typeck_results().expr_ty_adjusted(expr);
  const arg_adjustments = typeck_results().expr_adjustments(receiver);

  // If there is any user defined auto-deref step, then we don't want to warn.
  // https://github.com/rust-lang/rust-clippy/issues/9272
  if (arg_adjustments.some((adj) => adj.kind.$ === "Deref" && adj.kind._0.$ === "Overloaded")) {
    return;
  }

  const expr_span = expr.span;
  const span = Span.with_lo(expr_span, Span.hi(receiver.span));

  const orig_ty = expr_ty.peel_refs();

  if (receiver_ty === expr_ty) {
    const k = orig_ty.kind();
    const suggest_derive = k.$ === "Adt" ? Span.shrink_to_lo(cx.tcx.def_span(k._0.did())) : undefined;
    cx.emit_span_lint(
      NOOP_METHOD_CALL,
      span,
      NoopMethodCallDiag_diagnostic({
        method: call.ident,
        orig_ty,
        trait_,
        label: span,
        suggest_derive,
      }),
    );
  } else {
    // Report the method call's return type before adjustments required by its parent.
    const unadjusted_expr_ty = typeck_results().expr_ty(expr);
    switch (name) {
      // If `type_of(x) == T` and `x.borrow()` is used to get `&T`,
      // then that should be allowed
      case sym.noop_method_borrow:
        return;
      case sym.noop_method_clone:
        cx.emit_span_lint(SUSPICIOUS_DOUBLE_REF_OP, span, SuspiciousDoubleRefCloneDiag_diagnostic({ ty: unadjusted_expr_ty }));
        break;
      case sym.noop_method_deref:
        cx.emit_span_lint(SUSPICIOUS_DOUBLE_REF_OP, span, SuspiciousDoubleRefDerefDiag_diagnostic({ ty: unadjusted_expr_ty }));
        break;
      default:
        return;
    }
  }
};
