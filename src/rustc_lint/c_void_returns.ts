// Port of compiler/rustc_lint/src/c_void_returns.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (c_void_returns.lints.gen.ts).
//
// PORT: context.ts types `LateContext::qpath_res` as returning `unknown`; the result is cast to `Res`.
import type { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { FnRetTy } from "../rustc_hir/hir.ts";
import type { FnKind } from "../rustc_hir/intravisit.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { ch } from "../std/char.ts";
import { C_VOID_RETURNS, CVoidReturns } from "./c_void_returns.lints.gen.ts";
import type { LateContext } from "./context.ts";
import { CVoidReturn_diagnostic, ExternCVoidReturn_diagnostic } from "./diagnostics.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./c_void_returns.lints.gen.ts";

declare module "./c_void_returns.lints.gen.ts" {
  interface CVoidReturns extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for CVoidReturns
// rustc: compiler/rustc_lint/src/c_void_returns.rs:46 check_fn
CVoidReturns.prototype.check_fn = function (
  this: CVoidReturns,
  cx: LateContext,
  fn_kind: FnKind,
  decl: hir.FnDecl,
  _: hir.Body,
  __: Span,
  ___: LocalDefId,
): void {
  check_decl(cx, decl, !(fn_kind.$ === "ItemFn" && fn_kind._2.abi.$ === "Rust"));
};

// rustc: compiler/rustc_lint/src/c_void_returns.rs:62 check_foreign_item
CVoidReturns.prototype.check_foreign_item = function (this: CVoidReturns, cx: LateContext, item: hir.ForeignItem): void {
  if (item.kind.$ === "Fn") {
    const sig = item.kind._0;
    check_decl(cx, sig.decl, true);
  }
};

// rustc: compiler/rustc_lint/src/c_void_returns.rs:68 check_ty
CVoidReturns.prototype.check_ty = function (this: CVoidReturns, cx: LateContext, ty: hir.Ty<hir.AmbigArg>): void {
  if (ty.kind.$ === "FnPtr") {
    const fn_ptr_ty = ty.kind._0;
    check_decl(cx, fn_ptr_ty.decl, fn_ptr_ty.abi.$ !== "Rust");
  }
};

// rustc: compiler/rustc_lint/src/c_void_returns.rs:75 check_decl
function check_decl(cx: LateContext, decl: hir.FnDecl, is_extern: boolean): void {
  if (decl.output.$ !== "Return") return;
  const output_ty = decl.output._0;
  if (output_ty.kind.$ !== "Path") return;
  const qpath = output_ty.kind._0;
  const res = cx.qpath_res(qpath, output_ty.hir_id) as Res;
  if (res.$ === "Def" && cx.tcx.is_lang_item(res._1, "CVoid")) {
    const suggestion = cx.sess().source_map().span_extend_to_prev_char(FnRetTy.span(decl.output), ch(")"), true);

    if (is_extern) {
      cx.emit_span_lint(C_VOID_RETURNS, FnRetTy.span(decl.output), ExternCVoidReturn_diagnostic({ suggestion }));
    } else {
      cx.emit_span_lint(C_VOID_RETURNS, FnRetTy.span(decl.output), CVoidReturn_diagnostic({ suggestion }));
    }
  }
}
