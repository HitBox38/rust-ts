// Port of compiler/rustc_lint/src/autorefs.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (autorefs.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it
// `unknown`, so the call sites cast it to `TypeckResults`.
import { Mutability } from "../rustc_ast_ir/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Expr } from "../rustc_hir/hir.ts";
import { Mutability_from_AutoBorrowMutability } from "../rustc_middle/ty/adjustment.ts";
import type { Adjustment } from "../rustc_middle/ty/adjustment.gen.ts";
import { HasAttrs_DefId } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { DANGEROUS_IMPLICIT_AUTOREFS, ImplicitAutorefs } from "./autorefs.lints.gen.ts";
import type { LateContext } from "./context.ts";
import { ImplicitUnsafeAutorefsDiag_diagnostic, ImplicitUnsafeAutorefsOrigin } from "./diagnostics.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./autorefs.lints.gen.ts";

declare module "./autorefs.lints.gen.ts" {
  interface ImplicitAutorefs extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for ImplicitAutorefs
// rustc: compiler/rustc_lint/src/autorefs.rs:64 check_expr
ImplicitAutorefs.prototype.check_expr = function (this: ImplicitAutorefs, cx: LateContext, expr: Expr): void {
  // This logic has mostly been taken from
  // <https://github.com/rust-lang/rust/pull/103735#issuecomment-1370420305>

  // 5. Either of the following:
  //   a. A deref followed by any non-deref place projection (that intermediate
  //      deref will typically be auto-inserted).
  //   b. A method call annotated with `#[rustc_no_implicit_refs]`.
  //   c. A deref followed by a `&raw const` or `&raw mut`.
  let is_coming_from_deref = false;
  let inner: Expr;
  switch (expr.kind.$) {
    case "AddrOf": {
      if (expr.kind._0 !== "Raw") return;
      const inner_ = expr.kind._2;
      if (inner_.kind.$ === "Unary" && inner_.kind._0 === "Deref") {
        is_coming_from_deref = true;
        inner = inner_.kind._1;
      } else {
        return;
      }
      break;
    }
    case "Index":
      inner = expr.kind._0;
      break;
    case "MethodCall":
      // PERF: Checking of `#[rustc_no_implicit_refs]` is deferred below
      // because checking for attribute is a bit costly.
      inner = expr.kind._1;
      break;
    case "Field":
      inner = expr.kind._0;
      break;
    default:
      return;
  }

  const typeck = cx.typeck_results_() as TypeckResults;
  const adjustments_table = typeck.adjustments();

  const adjustments_ = adjustments_table.get(inner.hir_id);
  if (adjustments_ === undefined) return;
  // 4. Any number of automatically inserted deref/derefmut calls.
  const adjustments = peel_derefs_adjustments(adjustments_);
  // 3. An automatically inserted reference (might come from a deref).
  if (adjustments.length !== 1) return;
  const adjustment = adjustments[0]!;
  const borrow = has_implicit_borrow(adjustment);
  if (borrow === undefined) return;
  const [borrow_mutbl, through_overloaded_deref] = borrow;
  // 2. Any number of place projections.
  const peeled = peel_place_mappers(inner).kind;
  if (!(peeled.$ === "Unary" && peeled._0 === "Deref")) return;
  const dereferenced = peeled._1;
  // 1. Deref of a raw pointer.
  if (!typeck.expr_ty(dereferenced).is_raw_ptr()) return;
  let method_did: DefId | undefined;
  switch (expr.kind.$) {
    // PERF: 5. b. A method call annotated with `#[rustc_no_implicit_refs]`
    case "MethodCall":
      method_did = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
      break;
    default:
      method_did = undefined;
  }
  if (
    !(method_did !== undefined
      ? find_attr(HasAttrs_DefId.get_attrs(method_did, cx.tcx), (k) => (k.$ === "RustcNoImplicitAutorefs" ? null : undefined)) !== undefined
      : true)
  ) {
    return;
  }

  cx.emit_span_lint(
    DANGEROUS_IMPLICIT_AUTOREFS,
    Span.source_callsite(expr.span),
    ImplicitUnsafeAutorefsDiag_diagnostic({
      raw_ptr_span: dereferenced.span,
      raw_ptr_ty: typeck.expr_ty(dereferenced),
      origin: through_overloaded_deref
        ? ImplicitUnsafeAutorefsOrigin.OverloadedDeref
        : { $: "Autoref", autoref_span: inner.span, autoref_ty: typeck.expr_ty_adjusted(inner) },
      method:
        method_did !== undefined
          ? {
              def_span: cx.tcx.def_span(method_did),
              method_name: cx.tcx.item_name(method_did),
            }
          : undefined,
      suggestion: {
        mutbl: Mutability.ref_prefix_str(borrow_mutbl),
        deref: is_coming_from_deref ? "*" : "",
        start_span: Span.shrink_to_lo(inner.span),
        end_span: Span.shrink_to_hi(inner.span),
      },
    }),
  );
};

/// Peels expressions from `expr` that can map a place.
// rustc: compiler/rustc_lint/src/autorefs.rs:144 peel_place_mappers
function peel_place_mappers(expr: Expr): Expr {
  for (;;) {
    switch (expr.kind.$) {
      case "Index":
        expr = expr.kind._0;
        break;
      case "Field":
        expr = expr.kind._0;
        break;
      default:
        return expr;
    }
  }
}

/// Peel derefs adjustments until the last last element.
// rustc: compiler/rustc_lint/src/autorefs.rs:155 peel_derefs_adjustments
function peel_derefs_adjustments(adjs: readonly Adjustment[]): readonly Adjustment[] {
  while (adjs.length >= 1 && adjs[0]!.kind.$ === "Deref" && adjs.length - 1 !== 0) {
    adjs = adjs.slice(1);
  }
  return adjs;
}

/// Test if some adjustment has some implicit borrow.
///
/// Returns `Some((mutability, was_an_overloaded_deref))` if the argument adjustment is
/// an implicit borrow (or has an implicit borrow via an overloaded deref).
// rustc: compiler/rustc_lint/src/autorefs.rs:168 has_implicit_borrow
function has_implicit_borrow({ kind }: Adjustment): [Mutability, boolean] | undefined {
  if (kind.$ === "Deref" && kind._0.$ === "Overloaded") {
    const { mutbl } = kind._0._0;
    return [mutbl, true];
  } else if (kind.$ === "Borrow" && kind._0.$ === "Ref") {
    return [Mutability_from_AutoBorrowMutability(kind._0._0), false];
  } else {
    // Adjust::NeverToAny | Adjust::Pointer(..) | Adjust::Deref(DerefAdjustKind::Builtin | DerefAdjustKind::Pin)
    // | Adjust::GenericReborrow(..) | Adjust::Borrow(AutoBorrow::RawPtr(..) | AutoBorrow::Pin(..))
    return undefined;
  }
}
