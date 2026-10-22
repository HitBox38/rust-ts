// Port of compiler/rustc_lint/src/utils.rs.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type { Expr } from "../rustc_hir/hir.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { sym } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";

/// Given an expression, peel all of casts (`<expr> as ...`, `<expr>.cast{,_mut,_const}()`,
/// `ptr::from_ref(<expr>)`, ...) and init expressions.
///
/// Returns the innermost expression.
// rustc: compiler/rustc_lint/src/utils.rs:11 peel_casts
export function peel_casts(cx: LateContext, e: Expr): Expr {
  for (;;) {
    e = e.peel_blocks();
    // <expr> as ...
    let def_id;
    let diag_name;
    if (e.kind.$ === "Cast") {
      e = e.kind._0;
      // <expr>.cast(), <expr>.cast_mut() or <expr>.cast_const()
    } else if (
      e.kind.$ === "MethodCall" &&
      e.kind._2.length === 0 &&
      // PORT: `LateContext::typeck_results` is typed `unknown` in context.ts (lane lint-late-a types it).
      (def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(e.hir_id)) !== undefined &&
      ((diag_name = cx.tcx.get_diagnostic_name(def_id)),
      diag_name === sym.ptr_cast || diag_name === sym.const_ptr_cast || diag_name === sym.ptr_cast_mut || diag_name === sym.ptr_cast_const)
    ) {
      e = e.kind._1;
      // ptr::from_ref(<expr>), UnsafeCell::raw_get(<expr>) or mem::transmute<_, _>(<expr>)
    } else if (
      e.kind.$ === "Call" &&
      e.kind._1.length === 1 &&
      e.kind._0.kind.$ === "Path" &&
      (def_id = Res.opt_def_id(cx.qpath_res(e.kind._0.kind._0, e.kind._0.hir_id) as Res)) !== undefined &&
      ((diag_name = cx.tcx.get_diagnostic_name(def_id)),
      diag_name === sym.ptr_from_ref || diag_name === sym.unsafe_cell_raw_get || diag_name === sym.transmute)
    ) {
      e = e.kind._1[0]!;
    } else {
      // PORT: `LateContext::expr_or_init` returns `unknown` in context.ts (lane lint-late-a types it).
      const init = cx.expr_or_init(e) as Expr;
      if (!HirId_eq(init.hir_id, e.hir_id)) {
        e = init;
      } else {
        break;
      }
    }
  }

  return e;
}

/// Crate to use for rustfix / diagnostic paths that exist in both `std` and `core`. Returns `None` for `#![no_core]`.
// rustc: compiler/rustc_lint/src/utils.rs:53 std_or_core
export function std_or_core(cx: LateContext): string | undefined {
  if (find_attr(cx.tcx.hir_krate_attrs(), (k) => (k.$ === "NoCore" ? null : undefined)) !== undefined) {
    return undefined;
  } else if (find_attr(cx.tcx.hir_krate_attrs(), (k) => (k.$ === "NoStd" ? null : undefined)) !== undefined) {
    return "core";
  } else {
    return "std";
  }
}
