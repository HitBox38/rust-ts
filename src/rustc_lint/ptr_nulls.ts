// Port of compiler/rustc_lint/src/ptr_nulls.rs. The lint statics and the `declare_lint_pass!` expansion are generated
// (ptr_nulls.lints.gen.ts).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type { Expr, QPath } from "../rustc_hir/hir.ts";
import { HasAttrs_DefId, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import { type InvalidNullArgumentsDiag, InvalidNullArgumentsDiag_diagnostic, type UselessPtrNullChecksDiag, UselessPtrNullChecksDiag_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { INVALID_NULL_ARGUMENTS, PtrNullChecks, USELESS_PTR_NULL_CHECKS } from "./ptr_nulls.lints.gen.ts";
import { peel_casts } from "./utils.ts";

export * from "./ptr_nulls.lints.gen.ts";

declare module "./ptr_nulls.lints.gen.ts" {
  interface PtrNullChecks extends LateLintPass {}
}

// PORT: `LateContext::typeck_results` / `qpath_res` / `typing_env` are typed `unknown` in context.ts (lane
// lint-late-a types them); these casts go away then.
const typeck_results = (cx: LateContext): TypeckResults => cx.typeck_results_() as TypeckResults;
const qpath_res = (cx: LateContext, qpath: QPath, id: Expr["hir_id"]): Res => cx.qpath_res(qpath, id) as Res;
/** `find_attr!(cx.tcx, def_id, RustcNeverReturnsNullPtr)` */
const never_returns_null_ptr = (cx: LateContext, def_id: DefId): boolean =>
  find_attr(HasAttrs_DefId.get_attrs(def_id, cx.tcx), (k) => (k.$ === "RustcNeverReturnsNullPtr" ? null : undefined)) !== undefined;

/// This function checks if the expression is from a series of consecutive casts,
/// i.e. `(my_fn as *const _ as *mut _).cast_mut()` and whether the original expression is either
/// a fn ptr, a reference, or a function call whose definition is
/// annotated with `#![rustc_never_returns_null_ptr]`.
/// If this situation is present, the function returns the appropriate diagnostic.
// rustc: compiler/rustc_lint/src/ptr_nulls.rs:67 useless_check
function useless_check(cx: LateContext, e: Expr): UselessPtrNullChecksDiag | undefined {
  let had_at_least_one_cast = false;
  for (;;) {
    e = e.peel_blocks();
    let def_id: DefId | undefined;
    let fn_name;
    if (
      e.kind.$ === "MethodCall" &&
      e.kind._2.length === 0 &&
      (def_id = typeck_results(cx).type_dependent_def_id(e.hir_id)) !== undefined &&
      never_returns_null_ptr(cx, def_id) &&
      (fn_name = cx.tcx.opt_item_ident(def_id)) !== undefined
    ) {
      return { $: "FnRet", fn_name };
    } else if (
      e.kind.$ === "Call" &&
      e.kind._0.kind.$ === "Path" &&
      (def_id = Res.opt_def_id(qpath_res(cx, e.kind._0.kind._0, e.kind._0.hir_id))) !== undefined &&
      never_returns_null_ptr(cx, def_id) &&
      (fn_name = cx.tcx.opt_item_ident(def_id)) !== undefined
    ) {
      return { $: "FnRet", fn_name };
    }
    let diag_name: Symbol | undefined;
    if (e.kind.$ === "Cast" && e.kind._1.kind.$ === "Ptr") {
      had_at_least_one_cast = true;
      e = e.kind._0;
    } else if (
      e.kind.$ === "MethodCall" &&
      e.kind._2.length === 0 &&
      (def_id = typeck_results(cx).type_dependent_def_id(e.hir_id)) !== undefined &&
      ((diag_name = cx.tcx.get_diagnostic_name(def_id)), diag_name === sym.ptr_cast || diag_name === sym.ptr_cast_mut)
    ) {
      had_at_least_one_cast = true;
      e = e.kind._1;
    } else if (had_at_least_one_cast) {
      const orig_ty = typeck_results(cx).expr_ty(e);
      return orig_ty.is_fn() ? { $: "FnPtr", orig_ty, label: e.span } : orig_ty.is_ref() ? { $: "Ref", orig_ty, label: e.span } : undefined;
    } else {
      return undefined;
    }
  }
}

/// Checks if the given expression is a null pointer (modulo casting)
// rustc: compiler/rustc_lint/src/ptr_nulls.rs:115 is_null_ptr
function is_null_ptr(cx: LateContext, expr_: Expr): Span | undefined {
  const expr = peel_casts(cx, expr_);

  let def_id: DefId | undefined;
  let diag_item: Symbol | undefined;
  if (
    expr.kind.$ === "Call" &&
    expr.kind._1.length === 0 &&
    expr.kind._0.kind.$ === "Path" &&
    (def_id = Res.opt_def_id(qpath_res(cx, expr.kind._0.kind._0, expr.kind._0.hir_id))) !== undefined &&
    (diag_item = cx.tcx.get_diagnostic_name(def_id)) !== undefined
  ) {
    return diag_item === sym.ptr_null || diag_item === sym.ptr_null_mut ? expr.span : undefined;
  } else if (expr.kind.$ === "Lit" && expr.kind._0.node.$ === "Int") {
    const v = expr.kind._0.node._0;
    return v === 0n ? expr.span : undefined;
  } else {
    return undefined;
  }
}

// impl<'tcx> LateLintPass<'tcx> for PtrNullChecks
// rustc: compiler/rustc_lint/src/ptr_nulls.rs:134 check_expr
PtrNullChecks.prototype.check_expr = function (this: PtrNullChecks, cx: LateContext, expr: Expr): void {
  const kind = expr.kind;
  let def_id: DefId | undefined;
  let diag_name: Symbol | undefined;
  let diag: UselessPtrNullChecksDiag | undefined;
  if (
    // Catching:
    // <*<const/mut> <ty>>::is_null(fn_ptr as *<const/mut> <ty>)
    kind.$ === "Call" &&
    kind._1.length === 1 &&
    kind._0.kind.$ === "Path" &&
    (def_id = Res.opt_def_id(qpath_res(cx, kind._0.kind._0, kind._0.hir_id))) !== undefined &&
    ((diag_name = cx.tcx.get_diagnostic_name(def_id)), diag_name === sym.ptr_const_is_null || diag_name === sym.ptr_is_null) &&
    (diag = useless_check(cx, kind._1[0]!)) !== undefined
  ) {
    cx.emit_span_lint(USELESS_PTR_NULL_CHECKS, expr.span, UselessPtrNullChecksDiag_diagnostic(diag));
  } else if (
    // Catching:
    // <path>(arg...) where `arg` is null-ptr and `path` is a fn that expect non-null-ptr
    kind.$ === "Call" &&
    kind._0.kind.$ === "Path" &&
    (def_id = Res.opt_def_id(qpath_res(cx, kind._0.kind._0, kind._0.hir_id))) !== undefined &&
    (diag_name = cx.tcx.get_diagnostic_name(def_id)) !== undefined
  ) {
    const args = kind._1;
    // `arg` positions where null would cause U.B and whenever ZST are allowed.
    //
    // We should probably have a `rustc` attribute, but checking them is costly,
    // maybe if we checked for null ptr first, it would be acceptable?
    let arg_indices: readonly number[];
    let are_zsts_allowed: boolean;
    switch (diag_name) {
      case sym.ptr_read:
      case sym.ptr_read_unaligned:
      case sym.ptr_replace:
      case sym.ptr_write:
      case sym.ptr_write_bytes:
      case sym.ptr_write_unaligned:
        [arg_indices, are_zsts_allowed] = [[0], true];
        break;
      case sym.slice_from_raw_parts:
      case sym.slice_from_raw_parts_mut:
        [arg_indices, are_zsts_allowed] = [[0], false];
        break;
      case sym.ptr_copy:
      case sym.ptr_copy_nonoverlapping:
      case sym.ptr_swap:
      case sym.ptr_swap_nonoverlapping:
        [arg_indices, are_zsts_allowed] = [[0, 1], true];
        break;
      default:
        return;
    }

    for (const arg_idx of arg_indices) {
      const arg = args[arg_idx];
      let null_span: Span | undefined;
      let ty;
      let k;
      if (
        arg !== undefined &&
        (null_span = is_null_ptr(cx, arg)) !== undefined &&
        (ty = typeck_results(cx).expr_ty_opt(arg)) !== undefined &&
        (k = ty.kind()).$ === "RawPtr"
      ) {
        const ty = k._0;
        // If ZST are fine, don't lint on them
        const typing_env = cx.typing_env() as TypingEnv;
        if (are_zsts_allowed) {
          const layout = cx.tcx.layout_of(typing_env.as_query_input(ty));
          if (layout.$ === "Ok" && layout._0.is_1zst()) {
            break;
          }
        }

        const diag: InvalidNullArgumentsDiag = Span.contains(arg.span, null_span) ? { $: "NullPtrInline", null_span } : { $: "NullPtrThroughBinding", null_span };

        cx.emit_span_lint(INVALID_NULL_ARGUMENTS, expr.span, InvalidNullArgumentsDiag_diagnostic(diag));
      }
    }
  } else if (
    // Catching:
    // (fn_ptr as *<const/mut> <ty>).is_null()
    kind.$ === "MethodCall" &&
    (def_id = typeck_results(cx).type_dependent_def_id(expr.hir_id)) !== undefined &&
    ((diag_name = cx.tcx.get_diagnostic_name(def_id)), diag_name === sym.ptr_const_is_null || diag_name === sym.ptr_is_null) &&
    (diag = useless_check(cx, kind._1)) !== undefined
  ) {
    cx.emit_span_lint(USELESS_PTR_NULL_CHECKS, expr.span, UselessPtrNullChecksDiag_diagnostic(diag));
  } else if (kind.$ === "Binary" && kind._0.node === "Eq") {
    const { _1: left, _2: right } = kind;
    let to_check: Expr;
    let diag: UselessPtrNullChecksDiag;
    let ddiag;
    if ((ddiag = useless_check(cx, left)) !== undefined) {
      to_check = right;
      diag = ddiag;
    } else if ((ddiag = useless_check(cx, right)) !== undefined) {
      to_check = left;
      diag = ddiag;
    } else {
      return;
    }

    const tk = to_check.kind;
    let diag_item: Symbol | undefined;
    if (
      // Catching:
      // (fn_ptr as *<const/mut> <ty>) == (0 as <ty>)
      tk.$ === "Cast" &&
      tk._0.kind.$ === "Lit" &&
      tk._0.kind._0.node.$ === "Int" &&
      tk._0.kind._0.node._0 === 0n
    ) {
      cx.emit_span_lint(USELESS_PTR_NULL_CHECKS, expr.span, UselessPtrNullChecksDiag_diagnostic(diag));
    } else if (
      // Catching:
      // (fn_ptr as *<const/mut> <ty>) == std::ptr::null()
      tk.$ === "Call" &&
      tk._1.length === 0 &&
      tk._0.kind.$ === "Path" &&
      (def_id = Res.opt_def_id(qpath_res(cx, tk._0.kind._0, tk._0.hir_id))) !== undefined &&
      (diag_item = cx.tcx.get_diagnostic_name(def_id)) !== undefined &&
      (diag_item === sym.ptr_null || diag_item === sym.ptr_null_mut)
    ) {
      cx.emit_span_lint(USELESS_PTR_NULL_CHECKS, expr.span, UselessPtrNullChecksDiag_diagnostic(diag));
    }
  }
};
