// Port of compiler/rustc_lint/src/types.rs. The lint statics and the `declare_lint_pass!` / `impl_lint_pass!` expansions
// are generated (types.lints.gen.ts).
//
// PORT (lint-late-b):
// - The passes are standalone `LateLintPass` objects (lib.ts builds them: `TypeLimits.new()`,
//   `new VariantSizeDifferences()`, `new InvalidAtomicOrdering()`): `TypeLimits` (it has state) is a class here, the two
//   `declare_lint_pass!` unit structs are the generated classes, their `LateLintPass` methods assigned onto the prototype.
// - `cx.typeck_results()` is `cx.typeck_results_()` (context.ts). `cx.layout_of(ty)` (the blanket `LayoutOf` over
//   `impl LayoutOfHelpers for LateContext`, context.rs:960) is `late_layout_of` below: `LateContext` has no `layout_of`.
// - `mod improper_ctypes` / `pub(crate) use improper_ctypes::ImproperCTypesLint`: lib.ts imports
//   ./types/improper_ctypes.ts itself (no re-export, which would make the two modules import each other).
// - `debug!` (tracing) calls are comments.
import { Scalar, type Variants } from "../rustc_abi/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { ast } from "../rustc_ast/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type { EnumDef, Expr, Item, Lit } from "../rustc_hir/hir.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { type LayoutError, SizeSkeleton, type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type FieldDef, HasAttrs_DefId, Ty, TypingEnv, type VariantDef } from "../rustc_middle/ty/mod.ts";
import type { Pattern } from "../rustc_middle/ty/pattern.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { Value } from "../rustc_middle/ty/consts/valtree.ts";
import { DefId_eq } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { assert, unreachable, unwrap } from "../std/panic.ts";
import { Err, type Result } from "../std/result.ts";
import type { LateContext } from "./context.ts";
import {
  AmbiguousWidePointerComparisons,
  AmbiguousWidePointerComparisons_diagnostic,
  type AmbiguousWidePointerComparisonsAddrMetadataSuggestion,
  AtomicOrderingFence_diagnostic,
  AtomicOrderingLoad_diagnostic,
  AtomicOrderingStore_diagnostic,
  InvalidAtomicOrderingDiag_diagnostic,
  type InvalidNanComparisons,
  InvalidNanComparisons as InvalidNanComparisonsC,
  InvalidNanComparisons_diagnostic,
  InvalidNanComparisonsSuggestion,
  UnpredictableFunctionPointerComparisons,
  UnpredictableFunctionPointerComparisons_diagnostic,
  type UnpredictableFunctionPointerComparisonsSuggestion,
  UnusedComparisons_diagnostic,
  VariantSizeDifferencesDiag_diagnostic,
} from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import {
  AMBIGUOUS_WIDE_POINTER_COMPARISONS,
  INVALID_ATOMIC_ORDERING,
  INVALID_NAN_COMPARISONS,
  InvalidAtomicOrdering,
  TypeLimits_impl_lint_pass,
  UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS,
  UNUSED_COMPARISONS,
  VARIANT_SIZE_DIFFERENCES,
  VariantSizeDifferences,
} from "./types.lints.gen.ts";
import { int_ty_range, lint_literal, uint_ty_range } from "./types/literal.ts";
import { std_or_core } from "./utils.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";

export * from "./types.lints.gen.ts";

/** `cx.layout_of(ty)`: `LayoutOf::spanned_layout_of(ty, DUMMY_SP)` (ty/layout.rs:773) with `LateContext`'s
 * `LayoutOfHelpers` (context.rs:960: `LayoutOfResult = Result<..>`, the default `layout_tcx_at_span`, and
 * `handle_layout_err` returning the error). */
function late_layout_of(cx: LateContext, ty: Ty): Result<TyAndLayout, LayoutError> {
  const span = DUMMY_SP;
  const tcx = cx.tcx.at(span);
  const r = tcx.layout_of(cx.typing_env().as_query_input(ty)) as Result<TyAndLayout, LayoutError>;
  return r.$ === "Err" ? Err(cx.handle_layout_err(r._0, span, ty) as LayoutError) : r;
}

// #[derive(Copy, Clone, Default)]
export class TypeLimits implements LintPass, LateLintPass {
  constructor(public last_visited_negation: NegationInfo | undefined) {}

  name(): string {
    return TypeLimits_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return TypeLimits_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return TypeLimits_impl_lint_pass.lint_vec();
  }

  // rustc: compiler/rustc_lint/src/types.rs:220 new
  static new(): TypeLimits {
    return new TypeLimits(undefined);
  }

  // impl<'tcx> LateLintPass<'tcx> for TypeLimits
  // rustc: compiler/rustc_lint/src/types.rs:570 check_lit
  check_lit(cx: LateContext, hir_id: HirId, lit: Lit, is_negated_pat: boolean): void {
    let surrounding_negation: Span | undefined;
    let negation_info: NegationInfo | undefined;
    if (is_negated_pat) {
      // In this case, lit.span refers to a `rustc_hir::hir::PatExprKind::Lit`,
      // which includes the minus sign in front.
      surrounding_negation = lit.span;
    } else if ((negation_info = this.last_visited_negation) !== undefined && HirId_eq(negation_info.negated_id, hir_id)) {
      surrounding_negation = negation_info.negation_span;
    } else {
      surrounding_negation = undefined;
    }
    lint_literal(cx, hir_id, lit.span, lit, surrounding_negation);
  }

  // rustc: compiler/rustc_lint/src/types.rs:591 check_expr
  check_expr(cx: LateContext, e: Expr): void {
    const k = e.kind;
    let def_id: ReturnType<typeof Res.opt_def_id>;
    let diag_item: Symbol | undefined;
    let cmpop: ComparisonOp | undefined;
    if (k.$ === "Unary" && k._0 === "Neg") {
      const expr = k._1;
      this.last_visited_negation = { negation_span: e.span, negated_id: expr.hir_id };
    } else if (k.$ === "Binary") {
      const [binop, l, r] = [k._0, k._1, k._2];
      if (is_comparison(binop.node)) {
        if (!check_limits(cx, binop.node, l, r)) {
          cx.emit_span_lint(UNUSED_COMPARISONS, e.span, UnusedComparisons_diagnostic({}));
        } else {
          lint_nan(cx, e, binop.node, l, r);
          const cmpop: ComparisonOp = { $: "BinOp", _0: binop.node };
          lint_wide_pointer(cx, e, cmpop, l, r);
          lint_fn_pointer(cx, e, cmpop, l, r);
        }
      }
    } else if (
      k.$ === "Call" &&
      k._1.length === 2 &&
      k._0.kind.$ === "Path" &&
      (def_id = Res.opt_def_id(cx.qpath_res(k._0.kind._0, k._0.hir_id))) !== undefined &&
      (diag_item = cx.tcx.get_diagnostic_name(def_id)) !== undefined &&
      (cmpop = diag_item_cmpop(diag_item)) !== undefined
    ) {
      const [l, r] = [k._1[0]!, k._1[1]!];
      lint_wide_pointer(cx, e, cmpop, l, r);
      lint_fn_pointer(cx, e, cmpop, l, r);
    } else if (
      k.$ === "MethodCall" &&
      k._2.length === 1 &&
      (def_id = cx.typeck_results_().type_dependent_def_id(e.hir_id)) !== undefined &&
      (diag_item = cx.tcx.get_diagnostic_name(def_id)) !== undefined &&
      (cmpop = diag_item_cmpop(diag_item)) !== undefined
    ) {
      const [l, r] = [k._1, k._2[0]!];
      lint_wide_pointer(cx, e, cmpop, l, r);
      lint_fn_pointer(cx, e, cmpop, l, r);
    }
  }
}

// #[derive(Copy, Clone)]
interface NegationInfo {
  /// A negation expression (a `rustc_hir::ExprKind::Unary`)
  negation_span: Span;
  /// The operand of the negation expression.
  negated_id: HirId;
}

// rustc: compiler/rustc_lint/src/types.rs:225 lint_nan
function lint_nan(cx: LateContext, e: Expr, binop: ast.BinOpKind, l: Expr, r: Expr): void {
  // rustc: compiler/rustc_lint/src/types.rs:232 is_nan
  function is_nan(cx: LateContext, expr: Expr): boolean {
    expr = expr.peel_blocks().peel_borrows();
    const k = expr.kind;
    if (k.$ === "Path") {
      const qpath = k._0;
      const def_id = Res.opt_def_id(cx.typeck_results_().qpath_res(qpath, expr.hir_id));
      if (def_id === undefined) {
        return false;
      }

      const name = cx.tcx.get_diagnostic_name(def_id);
      return name === sym.f16_nan || name === sym.f32_nan || name === sym.f64_nan || name === sym.f128_nan;
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_lint/src/types.rs:250 eq_ne
  function eq_ne(e: Expr, l: Expr, r: Expr, f: (l_span: Span, r_span: Span) => InvalidNanComparisonsSuggestion): InvalidNanComparisons {
    let suggestion: InvalidNanComparisonsSuggestion;
    let l_span: Span | undefined;
    let r_span: Span | undefined;
    if ((l_span = Span.find_ancestor_inside(l.span, e.span)) !== undefined && (r_span = Span.find_ancestor_inside(r.span, e.span)) !== undefined) {
      suggestion = f(l_span, r_span);
    } else {
      suggestion = InvalidNanComparisonsSuggestion.Spanless;
    }

    return { $: "EqNe", suggestion };
  }

  let lint: InvalidNanComparisons;
  if ((binop === "Eq" || binop === "Ne") && is_nan(cx, l)) {
    lint = eq_ne(e, l, r, (l_span, r_span) => ({
      $: "Spanful",
      nan_plus_binop: Span.until(l_span, r_span),
      float: Span.shrink_to_hi(r_span),
      neg: binop === "Ne" ? Span.shrink_to_lo(r_span) : undefined,
    }));
  } else if ((binop === "Eq" || binop === "Ne") && is_nan(cx, r)) {
    lint = eq_ne(e, l, r, (l_span, r_span) => ({
      $: "Spanful",
      nan_plus_binop: Span.to(Span.shrink_to_hi(l_span), r_span),
      float: Span.shrink_to_hi(l_span),
      neg: binop === "Ne" ? Span.shrink_to_lo(l_span) : undefined,
    }));
  } else if ((binop === "Lt" || binop === "Le" || binop === "Gt" || binop === "Ge") && (is_nan(cx, l) || is_nan(cx, r))) {
    lint = InvalidNanComparisonsC.LtLeGtGe;
  } else {
    return;
  }

  cx.emit_span_lint(INVALID_NAN_COMPARISONS, e.span, InvalidNanComparisons_diagnostic(lint));
}

// #[derive(Debug, PartialEq, Copy, Clone)]
type ComparisonOp = { readonly $: "BinOp"; readonly _0: ast.BinOpKind } | { readonly $: "Other" };

/** `cmpop == ComparisonOp::BinOp(op)` */
function cmpop_is(cmpop: ComparisonOp, op: ast.BinOpKind): boolean {
  return cmpop.$ === "BinOp" && cmpop._0 === op;
}

// rustc: compiler/rustc_lint/src/types.rs:299 lint_wide_pointer
function lint_wide_pointer(cx: LateContext, e: Expr, cmpop: ComparisonOp, l: Expr, r: Expr): void {
  const ptr_unsized = (ty: Ty): [/* number of refs */ number, /* modifiers */ string, /* is dyn */ boolean] | undefined => {
    let refs = 0;
    // here we remove any "implicit" references and count the number
    // of them to correctly suggest the right number of deref
    for (let k = ty.kind(); k.$ === "Ref"; k = ty.kind()) {
      ty = k._1;
      refs += 1;
    }

    // get the inner type of a pointer (or akin)
    let modifiers = "";
    const k = ty.kind();
    if (k.$ === "RawPtr") {
      ty = k._0;
    } else if (k.$ === "Adt" && cx.tcx.is_lang_item(k._0.did(), LangItem.NonNull)) {
      modifiers += ".as_ptr()";
      ty = k._1.type_at(0);
    } else {
      return undefined;
    }

    return !ty.is_sized(cx.tcx, cx.typing_env()) ? [refs, modifiers, ty.kind().$ === "Dynamic"] : undefined;
  };

  // the left and right operands can have references, remove any explicit references
  l = l.peel_borrows();
  r = r.peel_borrows();

  const l_ty = cx.typeck_results_().expr_ty_opt(l);
  if (l_ty === undefined) {
    return;
  }
  const r_ty = cx.typeck_results_().expr_ty_opt(r);
  if (r_ty === undefined) {
    return;
  }

  const l_res = ptr_unsized(l_ty);
  if (l_res === undefined) {
    return;
  }
  const [l_ty_refs, l_modifiers, l_inner_ty_is_dyn] = l_res;
  const r_res = ptr_unsized(r_ty);
  if (r_res === undefined) {
    return;
  }
  const [r_ty_refs, r_modifiers, r_inner_ty_is_dyn] = r_res;

  const krate = std_or_core(cx);
  if (krate === undefined) {
    return cx.emit_span_lint(AMBIGUOUS_WIDE_POINTER_COMPARISONS, e.span, AmbiguousWidePointerComparisons_diagnostic(AmbiguousWidePointerComparisons.Warn));
  }

  const l_span = Span.find_ancestor_inside(l.span, e.span);
  const r_span = Span.find_ancestor_inside(r.span, e.span);
  if (l_span === undefined || r_span === undefined) {
    return cx.emit_span_lint(AMBIGUOUS_WIDE_POINTER_COMPARISONS, e.span, AmbiguousWidePointerComparisons_diagnostic({ $: "Spanless", krate }));
  }

  const ne = cmpop_is(cmpop, "Ne") ? "!" : "";
  const is_eq_ne = cmpop.$ === "BinOp" && (cmpop._0 === "Eq" || cmpop._0 === "Ne");
  const is_dyn_comparison = l_inner_ty_is_dyn && r_inner_ty_is_dyn;
  const via_method_call = e.kind.$ === "MethodCall" || e.kind.$ === "Call";

  const left = Span.until(Span.shrink_to_lo(e.span), Span.shrink_to_lo(l_span));
  const middle = Span.until(Span.shrink_to_hi(l_span), Span.shrink_to_lo(r_span));
  const right = Span.until(Span.shrink_to_hi(r_span), Span.shrink_to_hi(e.span));

  const deref_left = "*".repeat(l_ty_refs);
  const deref_right = "*".repeat(r_ty_refs);

  cx.emit_span_lint(
    AMBIGUOUS_WIDE_POINTER_COMPARISONS,
    e.span,
    AmbiguousWidePointerComparisons_diagnostic(
      is_eq_ne
        ? {
            $: "SpanfulEq",
            addr_metadata_suggestion: !is_dyn_comparison
              ? ({
                  krate,
                  ne,
                  deref_left,
                  deref_right,
                  l_modifiers,
                  r_modifiers,
                  left,
                  middle,
                  right,
                } satisfies AmbiguousWidePointerComparisonsAddrMetadataSuggestion)
              : undefined,
            addr_suggestion: {
              krate,
              ne,
              deref_left,
              deref_right,
              l_modifiers,
              r_modifiers,
              left,
              middle,
              right,
            },
          }
        : {
            $: "SpanfulCmp",
            cast_suggestion: {
              deref_left,
              deref_right,
              l_modifiers,
              r_modifiers,
              paren_left: l_ty_refs !== 0 ? ")" : "",
              paren_right: r_ty_refs !== 0 ? ")" : "",
              left_before: l_ty_refs !== 0 ? Span.shrink_to_lo(l_span) : undefined,
              left_after: Span.shrink_to_hi(l_span),
              right_before: r_ty_refs !== 0 ? Span.shrink_to_lo(r_span) : undefined,
              right_after: Span.shrink_to_hi(r_span),
            },
            expect_suggestion: {
              paren_left: via_method_call ? "" : "(",
              paren_right: via_method_call ? "" : ")",
              before: Span.shrink_to_lo(e.span),
              after: Span.shrink_to_hi(e.span),
            },
          },
    ),
  );
}

// rustc: compiler/rustc_lint/src/types.rs:440 lint_fn_pointer
function lint_fn_pointer(cx: LateContext, e: Expr, cmpop: ComparisonOp, l: Expr, r: Expr): void {
  const peel_refs = (ty: Ty): [Ty, number] => {
    let refs = 0;

    for (let k = ty.kind(); k.$ === "Ref"; k = ty.kind()) {
      ty = k._1;
      refs += 1;
    }

    return [ty, refs];
  };

  // Left and right operands can have borrows, remove them
  l = l.peel_borrows();
  r = r.peel_borrows();

  const l_ty0 = cx.typeck_results_().expr_ty_opt(l);
  if (l_ty0 === undefined) return;
  const r_ty0 = cx.typeck_results_().expr_ty_opt(r);
  if (r_ty0 === undefined) return;

  // Remove any references as `==` will deref through them (and count the
  // number of references removed, for latter).
  const [l_ty, l_ty_refs] = peel_refs(l_ty0);
  const [r_ty, r_ty_refs] = peel_refs(r_ty0);

  const lk = l_ty.kind();
  const rk = r_ty.kind();
  let l_some_arg;
  let r_some_arg;
  if (l_ty.is_fn() && r_ty.is_fn()) {
    // both operands are function pointers, fallthrough
  } else if (
    lk.$ === "Adt" &&
    rk.$ === "Adt" &&
    cx.tcx.is_lang_item(lk._0.did(), LangItem.Option) &&
    cx.tcx.is_lang_item(rk._0.did(), LangItem.Option) &&
    (l_some_arg = lk._1[0]) !== undefined &&
    (r_some_arg = rk._1[0]) !== undefined &&
    GenericArg.expect_ty(l_some_arg).is_fn() &&
    GenericArg.expect_ty(r_some_arg).is_fn()
  ) {
    // both operands are `Option<{function ptr}>`
    return cx.emit_span_lint(
      UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS,
      e.span,
      UnpredictableFunctionPointerComparisons_diagnostic(UnpredictableFunctionPointerComparisons.Warn),
    );
  } else {
    // types are not function pointers, nothing to do
    return;
  }

  // Let's try to suggest `ptr::fn_addr_eq` if/when possible.

  const is_eq_ne = cmpop.$ === "BinOp" && (cmpop._0 === "Eq" || cmpop._0 === "Ne");

  if (!is_eq_ne) {
    // Neither `==` nor `!=`, we can't suggest `ptr::fn_addr_eq`, just show the warning.
    return cx.emit_span_lint(
      UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS,
      e.span,
      UnpredictableFunctionPointerComparisons_diagnostic(UnpredictableFunctionPointerComparisons.Warn),
    );
  }

  const l_span = Span.find_ancestor_inside(l.span, e.span);
  const r_span = Span.find_ancestor_inside(r.span, e.span);
  if (l_span === undefined || r_span === undefined) {
    // No appropriate spans for the left and right operands, just show the warning.
    return cx.emit_span_lint(
      UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS,
      e.span,
      UnpredictableFunctionPointerComparisons_diagnostic(UnpredictableFunctionPointerComparisons.Warn),
    );
  }

  const ne = cmpop_is(cmpop, "Ne") ? "!" : "";

  // `ptr::fn_addr_eq` only works with raw pointer, deref any references.
  const deref_left = "*".repeat(l_ty_refs);
  const deref_right = "*".repeat(r_ty_refs);

  const left = Span.until(Span.shrink_to_lo(e.span), Span.shrink_to_lo(l_span));
  const middle = Span.until(Span.shrink_to_hi(l_span), Span.shrink_to_lo(r_span));
  const right = Span.until(Span.shrink_to_hi(r_span), Span.shrink_to_hi(e.span));

  const krate = std_or_core(cx);
  if (krate === undefined) {
    return cx.emit_span_lint(
      UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS,
      e.span,
      UnpredictableFunctionPointerComparisons_diagnostic(UnpredictableFunctionPointerComparisons.Warn),
    );
  }

  let sugg: UnpredictableFunctionPointerComparisonsSuggestion;
  // We only check for a right cast as `FnDef` == `FnPtr` is not possible,
  // only `FnPtr == FnDef` is possible.
  if (!r_ty.is_fn_ptr()) {
    const fn_sig = r_ty.fn_sig(cx.tcx);

    sugg = {
      $: "FnAddrEqWithCast",
      krate,
      ne,
      fn_sig,
      deref_left,
      deref_right,
      left,
      middle,
      right,
    };
  } else {
    sugg = {
      $: "FnAddrEq",
      krate,
      ne,
      deref_left,
      deref_right,
      left,
      middle,
      right,
    };
  }

  cx.emit_span_lint(UNPREDICTABLE_FUNCTION_POINTER_COMPARISONS, e.span, UnpredictableFunctionPointerComparisons_diagnostic({ $: "Suggestion", sugg }));
}

// (fn-local helpers of `<TypeLimits as LateLintPass>::check_expr`)

// rustc: compiler/rustc_lint/src/types.rs:629 is_valid
function is_valid(binop: ast.BinOpKind, v: bigint, min: bigint, max: bigint): boolean {
  switch (binop) {
    case "Lt":
      return v > min && v <= max;
    case "Le":
      return v >= min && v < max;
    case "Gt":
      return v >= min && v < max;
    case "Ge":
      return v > min && v <= max;
    case "Eq":
    case "Ne":
      return v >= min && v <= max;
    default:
      return bug("");
  }
}

// rustc: compiler/rustc_lint/src/types.rs:640 rev_binop
function rev_binop(binop: ast.BinOpKind): ast.BinOpKind {
  switch (binop) {
    case "Lt":
      return "Gt";
    case "Le":
      return "Ge";
    case "Gt":
      return "Lt";
    case "Ge":
      return "Le";
    default:
      return binop;
  }
}

// rustc: compiler/rustc_lint/src/types.rs:650 check_limits
function check_limits(cx: LateContext, binop: ast.BinOpKind, l: Expr, r: Expr): boolean {
  let lit: Expr;
  let expr: Expr;
  let swap: boolean;
  if (l.kind.$ === "Lit") {
    [lit, expr, swap] = [l, r, true];
  } else if (r.kind.$ === "Lit") {
    [lit, expr, swap] = [r, l, false];
  } else {
    return true;
  }
  // Normalize the binop so that the literal is always on the RHS in
  // the comparison
  const norm_binop = swap ? rev_binop(binop) : binop;
  const k = cx.typeck_results_().node_type(expr.hir_id).kind();
  if (k.$ === "Int") {
    const [min, max] = int_ty_range(k._0);
    let lit_val: bigint;
    if (lit.kind.$ === "Lit") {
      const li = lit.kind._0;
      if (li.node.$ === "Int" && (li.node._1.$ === "Signed" || li.node._1.$ === "Unsuffixed")) {
        // `v.get() as i128`
        lit_val = BigInt.asIntN(128, li.node._0);
      } else {
        return true;
      }
    } else {
      return bug("");
    }
    return is_valid(norm_binop, lit_val, min, max);
  } else if (k.$ === "Uint") {
    const [min, max] = uint_ty_range(k._0);
    let lit_val: bigint;
    if (lit.kind.$ === "Lit") {
      const li = lit.kind._0;
      if (li.node.$ === "Int") {
        lit_val = li.node._0;
      } else {
        return true;
      }
    } else {
      return bug("");
    }
    return is_valid(norm_binop, lit_val, min, max);
  } else {
    return true;
  }
}

// rustc: compiler/rustc_lint/src/types.rs:694 is_comparison
function is_comparison(binop: ast.BinOpKind): boolean {
  return binop === "Eq" || binop === "Lt" || binop === "Le" || binop === "Ne" || binop === "Ge" || binop === "Gt";
}

// rustc: compiler/rustc_lint/src/types.rs:706 diag_item_cmpop
function diag_item_cmpop(diag_item: Symbol): ComparisonOp | undefined {
  switch (diag_item) {
    case sym.cmp_ord_max:
      return { $: "Other" };
    case sym.cmp_ord_min:
      return { $: "Other" };
    case sym.ord_cmp_method:
      return { $: "Other" };
    case sym.cmp_partialeq_eq:
      return { $: "BinOp", _0: "Eq" };
    case sym.cmp_partialeq_ne:
      return { $: "BinOp", _0: "Ne" };
    case sym.cmp_partialord_cmp:
      return { $: "Other" };
    case sym.cmp_partialord_ge:
      return { $: "BinOp", _0: "Ge" };
    case sym.cmp_partialord_gt:
      return { $: "BinOp", _0: "Gt" };
    case sym.cmp_partialord_le:
      return { $: "BinOp", _0: "Le" };
    case sym.cmp_partialord_lt:
      return { $: "BinOp", _0: "Lt" };
    default:
      return undefined;
  }
}

// rustc: compiler/rustc_lint/src/types.rs:724 nonnull_optimization_guaranteed
export function nonnull_optimization_guaranteed(tcx: TyCtxt, def: AdtDef): boolean {
  return find_attr(HasAttrs_DefId.get_attrs(def.did(), tcx), (k) => (k.$ === "RustcNonnullOptimizationGuaranteed" ? null : undefined)) !== undefined;
}

/// `repr(transparent)` structs can have a single non-1-ZST field, this function returns that
/// field.
// rustc: compiler/rustc_lint/src/types.rs:733 transparent_newtype_field
export function transparent_newtype_field(tcx: TyCtxt, variant: VariantDef): FieldDef | undefined {
  const typing_env = TypingEnv.non_body_analysis(tcx, variant.def_id);
  return variant.fields.find((field) => {
    const field_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>));
    const layout = tcx.layout_of(typing_env.as_query_input(field_ty)) as Result<TyAndLayout, LayoutError>;
    const is_1zst = layout.$ === "Ok" && layout._0.is_1zst();
    return !is_1zst;
  });
}

/// Is type known to be non-null?
// rustc: compiler/rustc_lint/src/types.rs:747 ty_is_known_nonnull
function ty_is_known_nonnull(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
  const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
  ty = n.$ === "Ok" ? n._0 : ty;

  const k = ty.kind();
  if (k.$ === "FnPtr") {
    return true;
  } else if (k.$ === "Ref") {
    return true;
  } else if (k.$ === "Adt" && k._0.is_box()) {
    return true;
  } else if (k.$ === "Adt" && k._0.repr().transparent() && !k._0.is_union()) {
    const [def, args] = [k._0, k._1];
    const marked_non_null = nonnull_optimization_guaranteed(tcx, def);

    if (marked_non_null) {
      return true;
    }

    // `UnsafeCell` and `UnsafePinned` have their niche hidden.
    if (def.is_unsafe_cell() || def.is_unsafe_pinned()) {
      return false;
    }

    for (const variant of def.variants()) {
      const field = transparent_newtype_field(tcx, variant);
      if (field === undefined) continue;
      if (ty_is_known_nonnull(tcx, typing_env, Unnormalized.skip_norm_wip(field.ty(tcx, args)))) return true;
    }
    return false;
  } else if (k.$ === "Pat") {
    return ty_is_known_nonnull(tcx, typing_env, k._0) || pat_ty_is_known_nonnull(tcx, typing_env, k._1);
  } else {
    return false;
  }
}

// rustc: compiler/rustc_lint/src/types.rs:782 pat_ty_is_known_nonnull
function pat_ty_is_known_nonnull(tcx: TyCtxt, typing_env: TypingEnv, pat: Pattern): boolean {
  // `try { .. }.unwrap_or_default()`: a `None` from `?` is `false`.
  const try_block = (): boolean | undefined => {
    const p = pat.kind();
    switch (p.$) {
      case "Range": {
        const start_v = p.start.try_to_value();
        if (start_v === undefined) return undefined;
        const start = Value.try_to_bits(start_v, tcx, typing_env);
        if (start === undefined) return undefined;
        const end_v = p.end.try_to_value();
        if (end_v === undefined) return undefined;
        const end = Value.try_to_bits(end_v, tcx, typing_env);
        if (end === undefined) return undefined;

        // This also works for negative numbers, as we just need
        // to ensure we aren't wrapping over zero.
        return start > 0n && end >= start;
      }
      case "NotNull":
        return true;
      case "Or":
        return p._0.every((pat) => pat_ty_is_known_nonnull(tcx, typing_env, pat));
    }
  };
  return try_block() ?? false;
}

/// Given a non-null scalar (or transparent) type `ty`, return the nullable version of that type.
/// If the type passed in was not scalar, returns None.
// rustc: compiler/rustc_lint/src/types.rs:808 get_nullable_type
function get_nullable_type(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): Ty | undefined {
  const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
  ty = n.$ === "Ok" ? n._0 : ty;

  const k = ty.kind();
  switch (k.$) {
    case "Adt": {
      const [field_def, field_args] = [k._0, k._1];
      let inner_field_ty: Ty;
      {
        const first_non_zst_ty: FieldDef[] = [];
        for (const v of field_def.variants()) {
          const f = transparent_newtype_field(tcx, v);
          if (f !== undefined) first_non_zst_ty.push(f);
        }
        // debug_assert_eq!(first_non_zst_ty.clone().count(), 1, "Wrong number of fields for transparent type");
        inner_field_ty = Unnormalized.skip_norm_wip(
          unwrap(first_non_zst_ty[first_non_zst_ty.length - 1], "No non-zst fields in transparent type.").ty(tcx, field_args),
        );
      }
      return get_nullable_type(tcx, typing_env, inner_field_ty);
    }
    case "Pat":
      return get_nullable_type(tcx, typing_env, k._0);
    case "Int":
    case "Uint":
    case "Char":
    case "RawPtr":
      return ty;
    // As these types are always non-null, the nullable equivalent of
    // `Option<T>` of these types are their raw pointer counterparts.
    case "Ref":
      return Ty.new_ptr(tcx, k._1, k._2);
    // There is no nullable equivalent for Rust's function pointers,
    // you must use an `Option<fn(..) -> _>` to represent it.
    case "FnPtr":
      return ty;
    // We should only ever reach this case if `ty_is_known_nonnull` is
    // extended to other types.
    default:
      // debug!("get_nullable_type: Unhandled scalar kind: {:?} while checking {:?}", unhandled, ty);
      return undefined;
  }
}

/// A type is niche-optimization candidate iff:
/// - Is a zero-sized type with alignment 1 (a “1-ZST”).
/// - Is either a struct/tuple with no fields, or an enum with no variants.
/// - Does not have the `#[non_exhaustive]` attribute.
// rustc: compiler/rustc_lint/src/types.rs:857 is_niche_optimization_candidate
function is_niche_optimization_candidate(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
  const layout = tcx.layout_of(typing_env.as_query_input(ty)) as Result<TyAndLayout, LayoutError>;
  if (layout.$ === "Ok" && !layout._0.is_1zst()) {
    return false;
  }

  const k = ty.kind();
  if (k.$ === "Adt") {
    const ty_def = k._0;
    const non_exhaustive = ty_def.is_variant_list_non_exhaustive();
    const empty = (ty_def.is_struct() && ty_def.non_enum_variant().fields.length === 0) || (ty_def.is_enum() && ty_def.variants().length === 0);

    return !non_exhaustive && empty;
  } else if (k.$ === "Tuple") {
    return k._0.length === 0;
  } else {
    return false;
  }
}

/// Check if this enum can be safely exported based on the "nullable pointer optimization". If it
/// can, return the type that `ty` can be safely converted to, otherwise return `None`.
/// Currently restricted to function pointers, boxes, references, `core::num::NonZero`,
/// `core::ptr::NonNull`, and `#[repr(transparent)]` newtypes.
// rustc: compiler/rustc_lint/src/types.rs:883 repr_nullable_ptr
export function repr_nullable_ptr(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): Ty | undefined {
  // debug!("is_repr_nullable_ptr(tcx, ty = {:?})", ty);
  const k = ty.kind();
  if (k.$ === "Adt") {
    const [ty_def, args] = [k._0, k._1];
    let field_ty: Ty;
    const variants = ty_def.variants();
    if (variants.length === 2) {
      const [var_one, var_two] = [variants[0]!, variants[1]!];
      const [f1, f2] = [var_one.fields, var_two.fields];
      if (f1.length === 0 && f2.length === 1) {
        field_ty = Unnormalized.skip_norm_wip(f2[0]!.ty(tcx, args));
      } else if (f1.length === 1 && f2.length === 0) {
        field_ty = Unnormalized.skip_norm_wip(f1[0]!.ty(tcx, args));
      } else if (f1.length === 1 && f2.length === 1) {
        const ty1 = Unnormalized.skip_norm_wip(f1[0]!.ty(tcx, args));
        const ty2 = Unnormalized.skip_norm_wip(f2[0]!.ty(tcx, args));

        if (is_niche_optimization_candidate(tcx, typing_env, ty1)) {
          field_ty = ty2;
        } else if (is_niche_optimization_candidate(tcx, typing_env, ty2)) {
          field_ty = ty1;
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    if (!ty_is_known_nonnull(tcx, typing_env, field_ty)) {
      return undefined;
    }

    // At this point, the field's type is known to be nonnull and the parent enum is Option-like.
    // If the computed size for the field and the enum are different, the nonnull optimization isn't
    // being applied (and we've got a problem somewhere).
    const compute_size_skeleton = (t: Ty): SizeSkeleton | undefined => {
      const r = SizeSkeleton.compute(t, tcx, typing_env, DUMMY_SP);
      return r.$ === "Ok" ? r._0 : undefined;
    };
    const sk_ty = compute_size_skeleton(ty);
    if (sk_ty === undefined) return undefined;
    const sk_field = compute_size_skeleton(field_ty);
    if (sk_field === undefined) return undefined;
    if (!SizeSkeleton.same_size(sk_ty, sk_field)) {
      bug("improper_ctypes: Option nonnull optimization not applied?");
    }

    // Return the nullable type this Option-like enum can be safely represented with.
    const field_ty_layout = tcx.layout_of(typing_env.as_query_input(field_ty)) as Result<TyAndLayout, LayoutError>;
    if (field_ty_layout.$ === "Err" && !TypeVisitableExt.has_non_region_param(field_ty, fold_Ty)) {
      bug("should be able to compute the layout of non-polymorphic type");
    }

    if (field_ty_layout.$ === "Err") return undefined;
    const field_ty_abi = field_ty_layout._0.backend_repr;
    if (field_ty_abi.$ === "Scalar") {
      const field_ty_scalar = field_ty_abi._0;
      const { start, end } = Scalar.valid_range(field_ty_scalar, tcx);
      if (start === 0n && end === Scalar.size(field_ty_scalar, tcx).unsigned_int_max() - 1n) {
        return unwrap(get_nullable_type(tcx, typing_env, field_ty), "known non-null scalar type should have a nullable representation");
      } else if (start === 1n) {
        return unwrap(get_nullable_type(tcx, typing_env, field_ty), "known non-null scalar type should have a nullable representation");
      } else {
        unreachable(`Unhandled start and end range: (${start}, ${end})`);
      }
    }
    return undefined;
  } else if (k.$ === "Pat") {
    return get_nullable_type_from_pat(tcx, typing_env, k._0, k._1);
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_lint/src/types.rs:957 get_nullable_type_from_pat
function get_nullable_type_from_pat(tcx: TyCtxt, typing_env: TypingEnv, base: Ty, pat: Pattern): Ty | undefined {
  const p = pat.kind();
  switch (p.$) {
    case "NotNull":
    case "Range":
      return get_nullable_type(tcx, typing_env, base);
    case "Or": {
      const patterns = p._0;
      const first = get_nullable_type_from_pat(tcx, typing_env, base, patterns[0]!);
      if (first === undefined) return undefined;
      for (const pat of patterns.slice(1)) {
        const other = get_nullable_type_from_pat(tcx, typing_env, base, pat);
        if (other === undefined) return undefined;
        assert(first === other, "assertion `left == right` failed");
      }
      return first;
    }
  }
}

declare module "./types.lints.gen.ts" {
  interface VariantSizeDifferences extends LateLintPass {}
  interface InvalidAtomicOrdering extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for VariantSizeDifferences
// rustc: compiler/rustc_lint/src/types.rs:980 check_item
VariantSizeDifferences.prototype.check_item = function (this: VariantSizeDifferences, cx: LateContext, it: Item): void {
  if (it.kind.$ === "Enum") {
    const enum_definition: EnumDef = it.kind._2;
    const t = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(it.owner_id) as EarlyBinder<Ty>));
    const ty = cx.tcx.erase_and_anonymize_regions(t, fold_Ty);
    const layout_r = late_layout_of(cx, ty);
    if (layout_r.$ === "Err") return;
    const layout = layout_r._0;
    const lv: Variants = layout.variants;
    if (!(lv.$ === "Multiple" && lv.tag_encoding.$ === "Direct")) {
      return;
    }
    const [tag, variants] = [lv.tag, lv.variants];

    const tag_size = Scalar.size(tag, cx.tcx).bytes();

    // debug!("enum `{}` is {} bytes large with layout:\n{:#?}", t, layout.size.bytes(), layout);

    // `iter::zip(enum_definition.variants, variants).map(..).enumerate().fold((0, 0, 0), ..)`
    let [largest, slargest, largest_index] = [0, 0, 0];
    const n = Math.min(enum_definition.variants.length, variants.length);
    for (let idx = 0; idx < n; idx++) {
      const variant_layout = variants[idx]!;
      // Subtract the size of the enum tag.
      const bytes = Math.max(variant_layout.size.bytes() - tag_size, 0);

      // debug!("- variant `{}` is {} bytes large", variant.ident, bytes);
      const size = bytes;
      if (size > largest) {
        [largest, slargest, largest_index] = [size, largest, idx];
      } else if (size > slargest) {
        slargest = size;
      }
    }

    // We only warn if the largest variant is at least thrice as large as
    // the second-largest.
    if (largest > slargest * 3 && slargest > 0) {
      cx.emit_span_lint(VARIANT_SIZE_DIFFERENCES, enum_definition.variants[largest_index]!.span, VariantSizeDifferencesDiag_diagnostic({ largest }));
    }
  }
};

// impl InvalidAtomicOrdering

// rustc: compiler/rustc_lint/src/types.rs:1078 inherent_atomic_method_call
function inherent_atomic_method_call(
  cx: LateContext,
  expr: Expr,
  recognized_names: readonly Symbol[], // used for fast path calculation
): [Symbol, readonly Expr[]] | undefined {
  const k = expr.kind;
  let m_def_id;
  let impl_did;
  let adt;
  if (
    k.$ === "MethodCall" &&
    recognized_names.includes(k._0.ident.name) &&
    (m_def_id = cx.typeck_results_().type_dependent_def_id(expr.hir_id)) !== undefined &&
    // skip extension traits, only lint functions from the standard library
    (impl_did = cx.tcx.inherent_impl_of_assoc(m_def_id)) !== undefined &&
    (adt = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(impl_did) as EarlyBinder<Ty>)).ty_adt_def()) !== undefined &&
    cx.tcx.is_diagnostic_item(sym.Atomic, adt.did())
  ) {
    return [k._0.ident.name, k._2];
  }
  return undefined;
}

// rustc: compiler/rustc_lint/src/types.rs:1096 match_ordering
function match_ordering(cx: LateContext, ord_arg: Expr): Symbol | undefined {
  if (ord_arg.kind.$ !== "Path") return undefined;
  const ord_qpath = ord_arg.kind._0;
  const did = Res.opt_def_id(cx.qpath_res(ord_qpath, ord_arg.hir_id));
  if (did === undefined) return undefined;
  const tcx = cx.tcx;
  const atomic_ordering = tcx.get_diagnostic_item(sym.Ordering);
  const name = tcx.item_name(did);
  const parent = tcx.parent(did);
  const opt_eq = (a: typeof atomic_ordering, b: typeof atomic_ordering): boolean => (a === undefined ? b === undefined : b !== undefined && DefId_eq(a, b));
  return [sym.Relaxed, sym.Release, sym.Acquire, sym.AcqRel, sym.SeqCst].find(
    (ordering) =>
      name === ordering &&
      (opt_eq(parent, atomic_ordering) ||
        // needed in case this is a ctor, not a variant
        opt_eq(tcx.opt_parent(parent), atomic_ordering)),
  );
}

// rustc: compiler/rustc_lint/src/types.rs:1113 check_atomic_load_store
function check_atomic_load_store(cx: LateContext, expr: Expr): void {
  const m = inherent_atomic_method_call(cx, expr, [sym.load, sym.store]);
  if (m === undefined) return;
  const [method, args] = m;
  let ordering_arg: Expr;
  let invalid_ordering: Symbol;
  if (method === sym.load) {
    [ordering_arg, invalid_ordering] = [args[0]!, sym.Release];
  } else if (method === sym.store) {
    [ordering_arg, invalid_ordering] = [args[1]!, sym.Acquire];
  } else {
    return;
  }
  const ordering = match_ordering(cx, ordering_arg);
  if (ordering !== undefined && (ordering === invalid_ordering || ordering === sym.AcqRel)) {
    if (method === sym.load) {
      cx.emit_span_lint(INVALID_ATOMIC_ORDERING, ordering_arg.span, AtomicOrderingLoad_diagnostic({}));
    } else {
      cx.emit_span_lint(INVALID_ATOMIC_ORDERING, ordering_arg.span, AtomicOrderingStore_diagnostic({}));
    }
  }
}

// rustc: compiler/rustc_lint/src/types.rs:1132 check_memory_fence
function check_memory_fence(cx: LateContext, expr: Expr): void {
  const k = expr.kind;
  let def_id;
  let name;
  if (
    k.$ === "Call" &&
    k._0.kind.$ === "Path" &&
    (def_id = Res.opt_def_id(cx.qpath_res(k._0.kind._0, k._0.hir_id))) !== undefined &&
    ((name = cx.tcx.get_diagnostic_name(def_id)) === sym.fence || name === sym.compiler_fence) &&
    match_ordering(cx, k._1[0]!) === sym.Relaxed
  ) {
    cx.emit_span_lint(INVALID_ATOMIC_ORDERING, k._1[0]!.span, AtomicOrderingFence_diagnostic({}));
  }
}

// rustc: compiler/rustc_lint/src/types.rs:1143 check_atomic_compare_exchange
function check_atomic_compare_exchange(cx: LateContext, expr: Expr): void {
  const m = inherent_atomic_method_call(cx, expr, [sym.update, sym.try_update, sym.fetch_update, sym.compare_exchange, sym.compare_exchange_weak]);
  if (m === undefined) {
    return;
  }
  const [method, args] = m;

  let fail_order_arg: Expr;
  if (method === sym.update || method === sym.try_update || method === sym.fetch_update) {
    fail_order_arg = args[1]!;
  } else if (method === sym.compare_exchange || method === sym.compare_exchange_weak) {
    fail_order_arg = args[3]!;
  } else {
    return;
  }

  const fail_ordering = match_ordering(cx, fail_order_arg);
  if (fail_ordering === undefined) return;

  if (fail_ordering === sym.Release || fail_ordering === sym.AcqRel) {
    cx.emit_span_lint(
      INVALID_ATOMIC_ORDERING,
      fail_order_arg.span,
      InvalidAtomicOrderingDiag_diagnostic({ method, fail_order_arg_span: fail_order_arg.span }),
    );
  }
}

// impl<'tcx> LateLintPass<'tcx> for InvalidAtomicOrdering
// rustc: compiler/rustc_lint/src/types.rs:1177 check_expr
InvalidAtomicOrdering.prototype.check_expr = function (this: InvalidAtomicOrdering, cx: LateContext, expr: Expr): void {
  check_atomic_load_store(cx, expr);
  check_memory_fence(cx, expr);
  check_atomic_compare_exchange(cx, expr);
};
