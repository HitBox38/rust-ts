// Port of compiler/rustc_lint/src/map_unit_fn.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (map_unit_fn.lints.gen.ts).
import type { Expr, Stmt } from "../rustc_hir/hir.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT } from "../rustc_type_ir/decls.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { LateContext } from "./context.ts";
import { MappingToUnit_diagnostic } from "./diagnostics.gen.ts";
import { MAP_UNIT_FN, MapUnitFn } from "./map_unit_fn.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./map_unit_fn.lints.gen.ts";

declare module "./map_unit_fn.lints.gen.ts" {
  interface MapUnitFn extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for MapUnitFn
// rustc: compiler/rustc_lint/src/map_unit_fn.rs:42 check_stmt
MapUnitFn.prototype.check_stmt = function (this: MapUnitFn, cx: LateContext, stmt: Stmt): void {
  if (stmt.kind.$ !== "Semi") {
    return;
  }
  const expr = stmt.kind._0;
  if (expr.kind.$ !== "MethodCall" || expr.kind._2.length !== 1) {
    return;
  }
  const { _0: path, _1: receiver, _3: span } = expr.kind;
  const arg = expr.kind._2[0]!;
  // PORT: `LateContext::typeck_results` is typed `unknown` in context.ts (lane lint-late-a types it).
  const typeck_results = (): TypeckResults => cx.typeck_results_() as TypeckResults;
  if (
    path.ident.name !== sym.map ||
    Span.from_expansion(stmt.span) ||
    Span.from_expansion(receiver.span) ||
    Span.from_expansion(arg.span) ||
    !is_impl_slice(cx, receiver) ||
    !((id) => id !== undefined && cx.tcx.is_diagnostic_item(sym.IteratorMap, id))(typeck_results().type_dependent_def_id(expr.hir_id))
  ) {
    return;
  }
  let id: DefId;
  let sig: PolyFnSigT;
  const k = typeck_results().expr_ty(arg).kind();
  switch (k.$) {
    case "Closure":
      [id, sig] = [k._0, ClosureArgs.sig(k._1.as_closure())];
      break;
    case "FnDef":
      [id, sig] = [k._0, EarlyBinder.skip_binder(cx.tcx.fn_sig(k._0) as EarlyBinder<PolyFnSigT>)];
      break;
    default:
      return;
  }
  const ret_ty = Binder.skip_binder(PolyFnSig.output(sig));
  if (!(ret_ty.is_unit() || ret_ty.is_never())) {
    return;
  }
  const function_label_ = cx.tcx.span_of_impl(id);
  cx.emit_span_lint(
    MAP_UNIT_FN,
    span,
    MappingToUnit_diagnostic({
      function_label: function_label_.$ === "Ok" ? function_label_._0 : arg.span,
      argument_label: arg.span,
      map_label: span,
      suggestion: path.ident.span,
    }),
  );
};

// rustc: compiler/rustc_lint/src/map_unit_fn.rs:83 is_impl_slice
function is_impl_slice(cx: LateContext, expr: Expr): boolean {
  const method_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
  let impl_id;
  if (method_id !== undefined && (impl_id = cx.tcx.impl_of_assoc(method_id)) !== undefined) {
    return EarlyBinder.skip_binder(cx.tcx.type_of(impl_id) as EarlyBinder<Ty>).is_slice();
  }
  return false;
}
