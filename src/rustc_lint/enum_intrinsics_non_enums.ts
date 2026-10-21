// Port of compiler/rustc_lint/src/enum_intrinsics_non_enums.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (enum_intrinsics_non_enums.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it and
// `qpath_res` as `unknown`, so the call sites cast them (`TypeckResults`, `Res`).
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { LateContext } from "./context.ts";
import { EnumIntrinsicsMemDiscriminate_diagnostic, EnumIntrinsicsMemVariant_diagnostic } from "./diagnostics.ts";
import { ENUM_INTRINSICS_NON_ENUMS, EnumIntrinsicsNonEnums } from "./enum_intrinsics_non_enums.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./enum_intrinsics_non_enums.lints.gen.ts";

declare module "./enum_intrinsics_non_enums.lints.gen.ts" {
  interface EnumIntrinsicsNonEnums extends LateLintPass {}
}

/// Returns `true` if we know for sure that the given type is not an enum. Note that for cases where
/// the type is generic, we can't be certain if it will be an enum so we have to assume that it is.
// rustc: compiler/rustc_lint/src/enum_intrinsics_non_enums.rs:44 is_non_enum
function is_non_enum(t: Ty): boolean {
  return !t.is_enum() && !TypeVisitableExt.has_param(t, fold_Ty);
}

// rustc: compiler/rustc_lint/src/enum_intrinsics_non_enums.rs:48 enforce_mem_discriminant
function enforce_mem_discriminant(cx: LateContext, func_expr: hir.Expr, expr_span: Span, args_span: Span): void {
  const ty_param = (cx.typeck_results_() as TypeckResults).node_args(func_expr.hir_id).type_at(0);
  if (is_non_enum(ty_param)) {
    cx.emit_span_lint(ENUM_INTRINSICS_NON_ENUMS, expr_span, EnumIntrinsicsMemDiscriminate_diagnostic({ ty_param, note: args_span }));
  }
}

// rustc: compiler/rustc_lint/src/enum_intrinsics_non_enums.rs:64 enforce_mem_variant_count
function enforce_mem_variant_count(cx: LateContext, func_expr: hir.Expr, span: Span): void {
  const ty_param = (cx.typeck_results_() as TypeckResults).node_args(func_expr.hir_id).type_at(0);
  if (is_non_enum(ty_param)) {
    cx.emit_span_lint(ENUM_INTRINSICS_NON_ENUMS, span, EnumIntrinsicsMemVariant_diagnostic({ ty_param }));
  }
}

// impl<'tcx> LateLintPass<'tcx> for EnumIntrinsicsNonEnums
// rustc: compiler/rustc_lint/src/enum_intrinsics_non_enums.rs:72 check_expr
EnumIntrinsicsNonEnums.prototype.check_expr = function (this: EnumIntrinsicsNonEnums, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "Call") return;
  const func = expr.kind._0;
  const args = expr.kind._1;
  if (func.kind.$ !== "Path") return;
  const qpath = func.kind._0;
  const def_id = Res.opt_def_id(cx.qpath_res(qpath, func.hir_id) as Res);
  if (def_id === undefined) return;
  const name = cx.tcx.get_diagnostic_name(def_id);
  if (name === undefined) return;
  switch (name) {
    case sym.mem_discriminant:
      enforce_mem_discriminant(cx, func, expr.span, args[0]!.span);
      break;
    case sym.mem_variant_count:
      enforce_mem_variant_count(cx, func, expr.span);
      break;
    default:
      break;
  }
};
