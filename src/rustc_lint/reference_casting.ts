// Port of compiler/rustc_lint/src/reference_casting.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (reference_casting.lints.gen.ts).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()`; `LateContext::qpath_res` returns `unknown` and
// `LateContext` has no `LayoutOf` impl yet (context.rs:960, `impl LayoutOfHelpers for LateContext`) until context.rs's
// `LateContext` is ported: `cx.layout_of(ty)` goes through the `LateLayoutOf` view below and the results are cast.
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { LayoutError, LayoutOf, TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { Result } from "../std/result.ts";
import type { LateContext } from "./context.ts";
import { InvalidReferenceCastingDiag_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { INVALID_REFERENCE_CASTING, InvalidReferenceCasting } from "./reference_casting.lints.gen.ts";
import { peel_casts } from "./utils.ts";

export * from "./reference_casting.lints.gen.ts";

declare module "./reference_casting.lints.gen.ts" {
  interface InvalidReferenceCasting extends LateLintPass {}
}

/** `<LateContext as LayoutOf>` (`type LayoutOfResult = Result<TyAndLayout, LayoutError>`). */
type LateLayoutOf = LayoutOf<Result<TyAndLayout, LayoutError>, LayoutError>;

// impl<'tcx> LateLintPass<'tcx> for InvalidReferenceCasting
// rustc: compiler/rustc_lint/src/reference_casting.rs:43 check_expr
InvalidReferenceCasting.prototype.check_expr = function (this: InvalidReferenceCasting, cx: LateContext, expr: hir.Expr): void {
  const r = borrow_or_assign(cx, expr);
  if (r !== undefined) {
    const [e, pat] = r;
    const init = cx.expr_or_init(e) as hir.Expr;
    const orig_cast = init.span !== e.span ? init.span : undefined;

    // small cache to avoid recomputing needlessly computing peel_casts of init
    let peel_casts_cache: hir.Expr | undefined = undefined;
    const peel_casts_ = (): hir.Expr => (peel_casts_cache ??= peel_casts(cx, init));

    if (((pat.$ === "Borrow" && pat.mutbl === "Mut") || pat.$ === "Assign") && is_invalid_cast_from_ref_to_mut_ptr(cx, init, peel_casts_)) {
      cx.emit_span_lint(
        INVALID_REFERENCE_CASTING,
        expr.span,
        InvalidReferenceCastingDiag_diagnostic(pat.$ === "Assign" ? { $: "AssignToRef", orig_cast } : { $: "BorrowAsMut", orig_cast }),
      );
    }

    const b = is_cast_to_bigger_memory_layout(cx, init, peel_casts_);
    if (b !== undefined) {
      const [from_ty_layout, to_ty_layout, e_alloc] = b;
      cx.emit_span_lint(
        INVALID_REFERENCE_CASTING,
        expr.span,
        InvalidReferenceCastingDiag_diagnostic({
          $: "BiggerLayout",
          orig_cast,
          alloc: e_alloc.span,
          from_ty: from_ty_layout.ty,
          from_size: from_ty_layout.layout.size().bytes(),
          to_ty: to_ty_layout.ty,
          to_size: to_ty_layout.layout.size().bytes(),
        }),
      );
    }
  }
};

// #[derive(Debug, Clone, Copy, PartialEq, Eq)]
type PatternKind = { readonly $: "Borrow"; readonly mutbl: Mutability } | { readonly $: "Assign" };

// rustc: compiler/rustc_lint/src/reference_casting.rs:94 borrow_or_assign
function borrow_or_assign(cx: LateContext, e: hir.Expr): [hir.Expr, PatternKind] | undefined {
  // rustc: compiler/rustc_lint/src/reference_casting.rs:98 deref_assign_or_addr_of
  function deref_assign_or_addr_of(expr: hir.Expr): [hir.Expr, PatternKind] | undefined {
    // &(mut) <expr>
    let inner: hir.Expr;
    let pat: PatternKind;
    if (expr.kind.$ === "AddrOf") {
      [inner, pat] = [expr.kind._2, { $: "Borrow", mutbl: expr.kind._1 }];
      // <expr> = ...
    } else if (expr.kind.$ === "Assign") {
      [inner, pat] = [expr.kind._0, { $: "Assign" }];
      // <expr> += ...
    } else if (expr.kind.$ === "AssignOp") {
      [inner, pat] = [expr.kind._1, { $: "Assign" }];
    } else {
      return undefined;
    }

    // *<inner>
    if (!(inner.kind.$ === "Unary" && inner.kind._0 === "Deref")) {
      return undefined;
    }
    const e = inner.kind._1;
    return [e, pat];
  }

  // rustc: compiler/rustc_lint/src/reference_casting.rs:121 ptr_write
  function ptr_write(cx: LateContext, e: hir.Expr): [hir.Expr, PatternKind] | undefined {
    let def_id;
    let name;
    if (
      e.kind.$ === "Call" &&
      e.kind._1.length === 2 &&
      e.kind._0.kind.$ === "Path" &&
      (def_id = Res.opt_def_id(cx.qpath_res(e.kind._0.kind._0, e.kind._0.hir_id) as Res)) !== undefined &&
      ((name = cx.tcx.get_diagnostic_name(def_id)) === sym.ptr_write || name === sym.ptr_write_volatile || name === sym.ptr_write_unaligned)
    ) {
      const arg_ptr = e.kind._1[0]!;
      return [arg_ptr, { $: "Assign" }];
    } else {
      return undefined;
    }
  }

  return deref_assign_or_addr_of(e) ?? ptr_write(cx, e);
}

// rustc: compiler/rustc_lint/src/reference_casting.rs:142 is_invalid_cast_from_ref_to_mut_ptr
function is_invalid_cast_from_ref_to_mut_ptr(cx: LateContext, orig_expr: hir.Expr, peel_casts: () => hir.Expr): boolean {
  const end_ty = (cx.typeck_results_() as TypeckResults).node_type(orig_expr.hir_id);

  // Bail out early if the end type is **not** a mutable pointer.
  const ek = end_ty.kind();
  if (!(ek.$ === "RawPtr" && ek._1 === "Mut")) {
    return false;
  }

  const e = peel_casts();
  const start_ty = (cx.typeck_results_() as TypeckResults).node_type(e.hir_id);

  const sk = start_ty.kind();
  if (sk.$ === "Ref" && sk._2 === "Not") {
    const inner_ty = sk._1;
    // We need to additionally check the inner type for the presence of `UnsafeCell`
    // as those would "punches a hole" in the immutability requirement of `&`.
    //
    // The `UnsafeCell`s must recursively covered all the fields (modulo ZSTs).
    //
    // Not checking it would lead us to incorrectly lint on valid casts
    // (see https://github.com/rust-lang/unsafe-code-guidelines/issues/281).
    //
    // For optimization purpose we first check that the type has no generics
    // (as it's impossible to make it safe).
    const inner_ty_has_interior_mutability = inner_ty.has_concrete_skeleton() && is_ty_fully_unsafe_celled(cx, inner_ty);

    return !inner_ty_has_interior_mutability;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_lint/src/reference_casting.rs:177 is_cast_to_bigger_memory_layout
function is_cast_to_bigger_memory_layout(
  cx: LateContext,
  orig_expr: hir.Expr,
  peel_casts: () => hir.Expr,
): [TyAndLayout, TyAndLayout, hir.Expr] | undefined {
  const end_ty = (cx.typeck_results_() as TypeckResults).node_type(orig_expr.hir_id);

  const ek = end_ty.kind();
  if (ek.$ !== "RawPtr") {
    return undefined;
  }
  const inner_end_ty = ek._0;

  const e = peel_casts();
  const start_ty = (cx.typeck_results_() as TypeckResults).node_type(e.hir_id);

  const sk = start_ty.kind();
  if (sk.$ !== "Ref") {
    return undefined;
  }
  const inner_start_ty = sk._1;

  // try to find the underlying allocation
  let e_alloc = cx.expr_or_init(e) as hir.Expr;
  e_alloc = e_alloc.kind.$ === "AddrOf" ? e_alloc.kind._2 : e_alloc;

  // if the current expr looks like this `&mut expr[index]` then just looking
  // at `expr[index]` won't give us the underlying allocation, so we just skip it
  // the same logic applies field access `&mut expr.field` and reborrows `&mut *expr`.
  if (e_alloc.kind.$ === "Index" || e_alloc.kind.$ === "Field" || (e_alloc.kind.$ === "Unary" && e_alloc.kind._0 === "Deref")) {
    return undefined;
  }

  const alloc_ty = (cx.typeck_results_() as TypeckResults).node_type(e_alloc.hir_id);

  // if we do not find it we bail out, as this may not be UB
  // see https://github.com/rust-lang/unsafe-code-guidelines/issues/256
  if (alloc_ty.is_any_ptr()) {
    return undefined;
  }

  const from_layout_r = (cx as unknown as LateLayoutOf).layout_of(inner_start_ty);
  if (from_layout_r.$ !== "Ok") return undefined;
  const from_layout = from_layout_r._0;

  // if the type isn't sized, we bail out, instead of potentially giving
  // the user a meaningless warning.
  if (from_layout.is_unsized()) {
    return undefined;
  }

  const alloc_layout_r = (cx as unknown as LateLayoutOf).layout_of(alloc_ty);
  if (alloc_layout_r.$ !== "Ok") return undefined;
  const alloc_layout = alloc_layout_r._0;
  const to_layout_r = (cx as unknown as LateLayoutOf).layout_of(inner_end_ty);
  if (to_layout_r.$ !== "Ok") return undefined;
  const to_layout = to_layout_r._0;

  if (
    to_layout.layout.size().bytes() > from_layout.layout.size().bytes() &&
    to_layout.layout.size().bytes() > alloc_layout.layout.size().bytes()
  ) {
    return [from_layout, to_layout, e_alloc];
  } else {
    return undefined;
  }
}

/// Checks that a `Ty` fully covered by one or more `UnsafeCell`.
///
/// This checks excludes ZST and `PhantomData`.
///
/// This check is an approximation and can return `false` for spurious reasons,
/// but `true` is dependable.
// Ideally we would check the layout for this information, but alas it doesn't have such information.
// rustc: compiler/rustc_lint/src/reference_casting.rs:244 is_ty_fully_unsafe_celled
function is_ty_fully_unsafe_celled(cx: LateContext, ty: Ty): boolean {
  // rustc: compiler/rustc_lint/src/reference_casting.rs:245 inner
  function inner(cx: LateContext, ty: Ty, depth: number): boolean {
    // Did we reach the recursion limit? Yes, bail-out.
    if (depth >= cx.tcx.recursion_limit()._0) {
      return false;
    }

    // Is this an `UnsafeCell` or `PhantomData`?
    if (ty.is_unsafe_cell() || ty.is_phantom_data()) {
      return true;
    }

    // Is this an ZSTs? Yes, consider them covered.
    const layout = (cx as unknown as LateLayoutOf).layout_of(ty);
    if (layout.$ === "Ok") {
      if (layout._0.is_zst()) {
        return true;
      }
    }

    // Check that the inner fields/types are them-selves covered by an `UnsafeCell`.
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const [def, args] = [k._0, k._1];
        // Is this an enum? Yes, bail-out.
        if (def.is_enum()) {
          return false;
        }

        const variant = def.non_enum_variant();

        // Empty struct and union are trivially covered
        if (variant.fields.length === 0) {
          return true;
        }

        return variant.fields.every((field) => {
          const field_ty = Unnormalized.skip_norm_wip(field.ty(cx.tcx, args));
          return inner(cx, field_ty, depth + 1);
        });
      }

      case "Tuple":
        return k._0.every((field_ty) => inner(cx, field_ty, depth + 1));

      case "Array":
      case "Slice":
      case "Pat":
        return inner(cx, k._0, depth + 1);

      // Primitive, slices, references, pointers and closures are not
      // covered by an `UnsafeCell`
      case "Char":
      case "Bool":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Never":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
        return false;

      case "Foreign":
      case "Dynamic":
      case "Alias":
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Infer":
      case "Error":
        return false;

      // FIXME: How to handle unsafe binders?
      case "UnsafeBinder":
        return false;
    }
  }

  return inner(cx, ty, 0);
}

