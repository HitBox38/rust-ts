// Port of compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs (lane typeck-method: the lint fns :156 and :273,
// on the success path of every method / fully-qualified call; wave 19: the rest, error reporting).
//
// Every fn of this file is declared in ../decls.ts under `// method/prelude_edition_lints.rs:<line>`. The wave-19 methods
// (`trait_path_or_bare_name`, `trait_path`, `adjust_expr`) and the three `impl Diagnostic` (`AmbiguousTraitMethodCall`
// :28, `AmbiguousTraitMethod` :95, `AmbiguousTraitAssocFunc` :293) stay `unported` (see `diag_pending` below): a lint
// only builds its diagnostic when it is not allowed at the node (rustc_middle lint.ts `emit_lint_base`).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./prelude_edition_lints.gen.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { ARRAY_INTO_ITER, BOXED_SLICE_INTO_ITER } from "../../rustc_lint/lib.ts";
import type { Lint } from "../../rustc_lint_defs/lib.ts";
import { RUST_2021_PRELUDE_COLLISIONS, RUST_2024_PRELUDE_COLLISIONS } from "../../rustc_lint_defs/builtin.gen.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { Span } from "../../rustc_span/lib.ts";
import { type Ident, STDLIB_STABLE_CRATES, type Symbol, sym } from "../../rustc_span/symbol.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt } from "../decls.ts";
import type { AmbiguousTraitMethod, AmbiguousTraitMethodCall } from "./prelude_edition_lints.gen.ts";
import type { Pick } from "./probe.gen.ts";

/**
 * PORT: the wave-19 `impl Diagnostic for <lint struct>` as a `Diagnostic` trait object whose `into_diag` stops
 * `unported` (only reached when the lint is not allowed at the node).
 */
function diag_pending<T>(_self: T, name: string): Diagnostic {
  return { into_diag: () => unported(`rustc_hir_typeck::method::prelude_edition_lints::<${name} as Diagnostic>::into_diag (wave 19)`) };
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:156 lint_edition_dependent_dot_call
FnCtxt.prototype.lint_edition_dependent_dot_call = function (this: FnCtxt, self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr, pick: Pick, args: readonly hir.Expr[]): void {
  // debug!(
  //     "lookup(method_name={}, self_ty={:?}, call_expr={:?}, self_expr={:?})",
  //     segment.ident, self_ty, call_expr, self_expr
  // );

  let prelude_or_array_lint: Lint;
  let edition: string;
  const name = segment.ident.name;
  let k;
  if (
    // `try_into` was added to the prelude in Rust 2021.
    name === sym.try_into &&
    !Span.at_least_rust_2021(span)
  ) {
    [prelude_or_array_lint, edition] = [RUST_2021_PRELUDE_COLLISIONS, "2021"];
  } else if (
    // `Future::poll` was added to the prelude in Rust 2024.
    name === sym.poll &&
    // We check that the self type is `Pin<&mut _>` to avoid false positives for this common name.
    !Span.at_least_rust_2024(span) &&
    (k = self_ty.kind()).$ === "Adt" &&
    this.tcx.is_lang_item(k._0.did(), "Pin") &&
    (() => {
      const ak = unwrap(GenericArg.as_type(k._1[0]!)).kind();
      return ak.$ === "Ref" && ak._2 === "Mut";
    })()
  ) {
    [prelude_or_array_lint, edition] = [RUST_2024_PRELUDE_COLLISIONS, "2024"];
  } else if (
    // `IntoFuture::into_future` was added to the prelude in Rust 2024.
    name === sym.into_future &&
    !Span.at_least_rust_2024(span)
  ) {
    [prelude_or_array_lint, edition] = [RUST_2024_PRELUDE_COLLISIONS, "2024"];
  } else if (name === sym.into_iter) {
    // `into_iter` wasn't added to the prelude,
    // but `[T; N].into_iter()` doesn't resolve to IntoIterator::into_iter
    // before Rust 2021, which results in the same problem.
    // It is only a problem for arrays.
    const boxed = self_ty.boxed_ty();
    if (self_ty.kind().$ === "Array" && !Span.at_least_rust_2021(span)) {
      // In this case, it wasn't really a prelude addition that was the problem.
      // Instead, the problem is that the array-into_iter hack will no longer
      // apply in Rust 2021.
      [prelude_or_array_lint, edition] = [ARRAY_INTO_ITER, "2021"];
    } else if (boxed !== undefined && boxed.is_slice() && !Span.at_least_rust_2024(span)) {
      // In this case, it wasn't really a prelude addition that was the problem.
      // Instead, the problem is that the boxed-slice-into_iter hack will no
      // longer apply in Rust 2024.
      [prelude_or_array_lint, edition] = [BOXED_SLICE_INTO_ITER, "2024"];
    } else {
      return;
    }
  } else {
    return;
  }

  // No need to lint if method came from std/core, as that will now be in the prelude
  if (STDLIB_STABLE_CRATES.includes(this.tcx.crate_name(pick.item.def_id.krate))) {
    return;
  }

  if (pick.kind.$ === "InherentImplPick" || pick.kind.$ === "ObjectPick") {
    // avoid repeatedly adding unneeded `&*`s
    if (pick.autoderefs === 1 && pick.autoref_or_ptr_adjustment?.$ === "Autoref" && self_ty.kind().$ === "Ref") {
      return;
    }

    // if it's an inherent `self` method (not `&self` or `&mut self`), it will take
    // precedence over the `TryInto` impl, and thus won't break in 2021 edition
    if (pick.autoderefs === 0 && pick.autoref_or_ptr_adjustment === undefined) {
      return;
    }

    // Inherent impls only require not relying on autoref and autoderef in order to
    // ensure that the trait implementation won't be used
    const lint: AmbiguousTraitMethodCall = {
      segment_name: segment.ident.name,
      self_expr_span: self_expr.span,
      pick,
      tcx: this.tcx,
      edition,
    };
    this.tcx.emit_node_span_lint(prelude_or_array_lint, self_expr.hir_id, self_expr.span, diag_pending(lint, "AmbiguousTraitMethodCall"));
  } else {
    // trait implementations require full disambiguation to not clash with the new prelude
    // additions (i.e. convert from dot-call to fully-qualified call)
    const lint: AmbiguousTraitMethod = {
      segment,
      call_expr,
      self_expr,
      pick,
      args,
      edition,
      span,
      this: this,
    };
    this.tcx.emit_node_span_lint(prelude_or_array_lint, call_expr.hir_id, call_expr.span, diag_pending(lint, "AmbiguousTraitMethod"));
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs:273 lint_fully_qualified_call_from_2018
FnCtxt.prototype.lint_fully_qualified_call_from_2018 = function (this: FnCtxt, span: Span, method_name: Ident, self_ty: Ty, self_ty_span: Span, expr_id: HirId, pick: Pick): void {
  // struct AmbiguousTraitAssocFunc<'a, 'fnctx, 'tcx> {
  //     method_name: Symbol, this: &'a FnCtxt<'fnctx, 'tcx>, pick: &'a Pick<'tcx>, span: Span, expr_id: hir::HirId,
  //     self_ty_span: Span, self_ty: Ty<'tcx>,
  // }
  interface AmbiguousTraitAssocFunc {
    method_name: Symbol;
    this: FnCtxt;
    pick: Pick;
    span: Span;
    expr_id: HirId;
    self_ty_span: Span;
    self_ty: Ty;
  }
  // impl Diagnostic for AmbiguousTraitAssocFunc (prelude_edition_lints.rs:293, wave 19): `diag_pending`.

  // Rust 2021 and later is already using the new prelude
  if (Span.at_least_rust_2021(span)) {
    return;
  }

  // These are the fully qualified methods added to prelude in Rust 2021
  if (!(method_name.name === sym.try_into || method_name.name === sym.try_from || method_name.name === sym.from_iter)) {
    return;
  }

  // No need to lint if method came from std/core, as that will now be in the prelude
  if (STDLIB_STABLE_CRATES.includes(this.tcx.crate_name(pick.item.def_id.krate))) {
    return;
  }

  // For from_iter, check if the type actually implements FromIterator.
  // If we know it does not, we don't need to warn.
  if (method_name.name === sym.from_iter) {
    const trait_def_id = this.tcx.get_diagnostic_item(sym.FromIterator);
    if (trait_def_id !== undefined) {
      const any_type = this.infcx.next_ty_var(span);
      if (!EvaluationResult.may_apply(this.infcx.type_implements_trait(trait_def_id, [self_ty, any_type], this.param_env))) {
        return;
      }
    }
  }

  // No need to lint if this is an inherent method called on a specific type, like `Vec::foo(...)`,
  // since such methods take precedence over trait methods.
  if (pick.kind.$ === "InherentImplPick") {
    return;
  }

  const lint: AmbiguousTraitAssocFunc = {
    method_name: method_name.name,
    this: this,
    pick,
    span,
    expr_id,
    self_ty_span,
    self_ty,
  };
  this.tcx.emit_node_span_lint(RUST_2021_PRELUDE_COLLISIONS, expr_id, span, diag_pending(lint, "AmbiguousTraitAssocFunc"));
};
// }

// ==== wave 19 (error reporting) ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::prelude_edition_lints::FnCtxt", ["trait_path_or_bare_name", "trait_path", "adjust_expr"]);
