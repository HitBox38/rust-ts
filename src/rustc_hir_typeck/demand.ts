// Port of compiler/rustc_hir_typeck/src/demand.rs (lane typeck-coerce: `demand_*` :171..289; the rest is a STUB for
// wave 19, see docs/handoff/fnctxt-contract.md "How to fill a stub").
//
// Every fn of this file is declared in ../decls.ts under `// demand.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/demand.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
//
// PORT notes (lane typeck-coerce):
// - `TypeErrCtxt` (error reporting, wave 19) is `Pending`: `report_mismatched_types` is called through the local view
//   `TypeErrCtxtView` (`FnCtxt::err_ctxt` itself stops as UNPORTED today).
// - `#[instrument]` is tracing only and stays as a comment.
export * from "./demand.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import type { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { AllowTwoPhase } from "../rustc_middle/ty/adjustment.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";

// PORT(decls): pending root. decls.ts declares `adjust_expr_for_assert_eq_macro(found_expr: hir.Expr, expected_expr:
// hir.Expr | undefined): void`, but upstream (demand.rs:112) takes `&mut &hir::Expr` / `&mut Option<&hir::Expr>`
// out-parameters, which `demand_coerce_diag` reads back. The `MutRef` overload below is the signature it needs.
declare module "./decls.ts" {
  interface FnCtxt {
    adjust_expr_for_assert_eq_macro(found_expr: MutRef<hir.Expr>, expected_expr: MutRef<hir.Expr | undefined>): void;
  }
}

/** PORT(stub): `error_reporting::TypeErrCtxt` (wave 19): the method called in this file. */
interface TypeErrCtxtView {
  report_mismatched_types(cause: ObligationCause, param_env: ParamEnv, expected: Ty, actual: Ty, err: TypeError): Diag;
}

function err_ctxt_view(fcx: FnCtxt): TypeErrCtxtView {
  return fcx.err_ctxt() as unknown as TypeErrCtxtView;
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

/// Requires that the two types unify, and prints an error message if
/// they don't.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:171 demand_suptype
FnCtxt.prototype.demand_suptype = function (this: FnCtxt, sp: Span, expected: Ty, actual: Ty): void {
  const r = this.demand_suptype_diag(sp, expected, actual);
  if (r.$ === "Err") {
    const e = r._0;
    e.emit();
  }
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:177 demand_suptype_diag
FnCtxt.prototype.demand_suptype_diag = function (this: FnCtxt, sp: Span, expected: Ty, actual: Ty): Result<undefined, Diag> {
  return this.demand_suptype_with_origin(this.misc(sp), expected, actual);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/demand.rs:187 demand_suptype_with_origin
FnCtxt.prototype.demand_suptype_with_origin = function (this: FnCtxt, cause: ObligationCause, expected: Ty, actual: Ty): Result<undefined, Diag> {
  const r = this.at(cause, this.param_env).sup("Yes", expected, actual, ToTrace_Ty);
  if (r.$ === "Ok") {
    this.register_infer_ok_obligations(r._0);
    return Ok(undefined);
  }
  const e = r._0;
  return Err(err_ctxt_view(this).report_mismatched_types(cause, this.param_env, expected, actual, e));
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:201 demand_eqtype
FnCtxt.prototype.demand_eqtype = function (this: FnCtxt, sp: Span, expected: Ty, actual: Ty): void {
  const r = this.demand_eqtype_diag(sp, expected, actual);
  if (r.$ === "Err") {
    const err = r._0;
    err.emit();
  }
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:207 demand_eqtype_diag
FnCtxt.prototype.demand_eqtype_diag = function (this: FnCtxt, sp: Span, expected: Ty, actual: Ty): Result<undefined, Diag> {
  return this.demand_eqtype_with_origin(this.misc(sp), expected, actual);
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:216 demand_eqtype_with_origin
FnCtxt.prototype.demand_eqtype_with_origin = function (this: FnCtxt, cause: ObligationCause, expected: Ty, actual: Ty): Result<undefined, Diag> {
  const r = this.at(cause, this.param_env).eq("Yes", expected, actual, ToTrace_Ty);
  if (r.$ === "Ok") {
    this.register_infer_ok_obligations(r._0);
    return Ok(undefined);
  }
  const e = r._0;
  return Err(err_ctxt_view(this).report_mismatched_types(cause, this.param_env, expected, actual, e));
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:230 demand_coerce
FnCtxt.prototype.demand_coerce = function (
  this: FnCtxt,
  expr: hir.Expr,
  checked_ty: Ty,
  expected: Ty,
  expected_ty_expr: hir.Expr | undefined,
  allow_two_phase: AllowTwoPhase,
): Ty {
  const r = this.demand_coerce_diag(expr, checked_ty, expected, expected_ty_expr, allow_two_phase);
  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err": {
      const err = r._0;
      err.emit();
      // Return the original type instead of an error type here, otherwise the type of `x` in
      // `let x: u32 = ();` will be a type error, causing all subsequent usages of `x` to not
      // report errors, even though `x` is definitely `u32`.
      return expected;
    }
  }
};

/// Checks that the type of `expr` can be coerced to `expected`.
///
/// N.B., this code relies on `self.diverges` to be accurate. In particular, assignments to `!`
/// will be permitted if the diverges flag is currently "always".
// #[instrument(level = "debug", skip(self, expr, expected_ty_expr, allow_two_phase))]
// rustc: compiler/rustc_hir_typeck/src/demand.rs:256 demand_coerce_diag
FnCtxt.prototype.demand_coerce_diag = function (
  this: FnCtxt,
  expr0: hir.Expr,
  checked_ty: Ty,
  expected0: Ty,
  expected_ty_expr0: hir.Expr | undefined,
  allow_two_phase: AllowTwoPhase,
): Result<Ty, Diag> {
  const expected = this.deeply_resolve_ignoring_regions_with_obligations(expected0, fold_Ty);

  const c = this.coerce(expr0, checked_ty, expected, allow_two_phase, undefined);
  if (c.$ === "Ok") {
    return Ok(c._0);
  }
  const e = c._0;

  // PORT: `&mut expr` / `&mut expected_ty_expr` (see the `PORT(decls)` note above).
  const expr_ref: MutRef<hir.Expr> = { value: expr0 };
  const expected_ty_expr_ref: MutRef<hir.Expr | undefined> = { value: expected_ty_expr0 };
  this.adjust_expr_for_assert_eq_macro(expr_ref, expected_ty_expr_ref);
  const expected_ty_expr = expected_ty_expr_ref.value;

  this.set_tainted_by_errors(this.dcx().span_delayed_bug(expr_ref.value.span, "`TypeError` when attempting coercion but no error emitted"));
  const expr = expr_ref.value.peel_drop_temps();
  const cause = this.misc(expr.span);
  const expr_ty = this.deeply_resolve_ignoring_regions(checked_ty, fold_Ty);
  const err = err_ctxt_view(this).report_mismatched_types(cause, this.param_env, expected, expr_ty, e);

  this.emit_coerce_suggestions(err, expr, expr_ty, expected, expected_ty_expr, e);

  return Err(err);
};

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::demand::FnCtxt", ["emit_type_mismatch_suggestions", "emit_coerce_suggestions", "adjust_expr_for_assert_eq_macro", "note_source_of_type_mismatch_constraint", "annotate_loop_expected_due_to_inference", "annotate_expected_due_to_let_ty", "annotate_mut_binding_to_immutable_binding", "annotate_alternative_method_deref_for_unop", "annotate_alternative_method_deref", "get_conversion_methods_for_diagnostic", "has_only_self_parameter", "maybe_get_block_expr", "is_destruct_assignment_desugaring", "explain_self_literal", "note_wrong_return_ty_due_to_generic_arg"]);
