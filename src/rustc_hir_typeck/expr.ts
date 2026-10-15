// Port of compiler/rustc_hir_typeck/src/expr.rs (lane typeck-expr-a: lines 1..1854; lane typeck-expr-b: 1855..3957).
//
//! Type checking expressions.
//!
//! See [`rustc_hir_analysis::check`] for more context on type checking in general.
//
// Every fn of this file is declared in ../decls.ts under `// expr.rs:<line>` (methods of `FnCtxt`, assigned onto its
// prototype here in upstream order).
// - `use crate::Expectation::{self, ExpectCastableToType, ExpectHasType, NoExpectation}`: the variants are written
//   `{ $: "ExpectHasType", _0: ty }` / `Expectation.NoExpectation`.
// - `self.diverges.get()` / `.set(x)` / `.replace(x)` (a `Cell`) is the plain field `this.diverges`; `a | b` / `a & b`
//   on `Diverges` are `Diverges.bitor(a, b)` / `Diverges.bitand(a, b)`.
// - `self.typeck_results.borrow()` / `self.deferred_*.borrow_mut()` are the fields themselves (PORTING §5).
// - `self.err_ctxt()` (`TypeErrCtxt`, wave 19) is `Pending` in rustc_trait_selection decls.ts: its methods used here are
//   reached through `err_ctxt_methods` (PORT(decls): pending root), after `err_ctxt()`'s own `unported` stop.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { type ExprPrecedence, ExprPrecedence as ExprPrecedenceC } from "../rustc_ast/util/parser.ts";
import type * as ast from "../rustc_ast/lib.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import { Attribute } from "../rustc_attr_ir/attr.ts";
import type { Diag, ErrCode } from "../rustc_errors/lib.ts";
import { E0070, E0533 } from "../rustc_errors/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { is_range_literal } from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import type { ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { Const } from "../rustc_middle/ty/decls.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { ParamEnv } from "../rustc_middle/ty/mod.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { Span, type ErrorGuaranteed } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import { fold_Const } from "../rustc_type_ir/sty/mod.ts";
import { FnSig, PolyFnSig, UnsafeBinderInner } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable, visit_with_tuple2 } from "../rustc_type_ir/visit.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { assert, panic, unwrap } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { Expectation as ExpectationT } from "./expectation.gen.ts";
import type { BreakableCtxt } from "./lib.gen.ts";

// expr.rs needs these at call time only (Init order): `Diverges`, `Expectation`, `Needs`, `TupleArgumentsFlag`,
// `CoerceMany`, `CastCheck`, `GatherLocalsVisitor`, `Declaration_from_LetExpr`, `contains_let_in_chain`,
// `fatally_break_rust`, the diagnostics.
import { Diverges } from "./diverges.ts";
import { Expectation } from "./expectation.ts";
import { Needs, TupleArgumentsFlag, fatally_break_rust } from "./lib.ts";
import { CoerceMany } from "./coercion.ts";
import type { CoerceMany as CoerceManyGen } from "./coercion.gen.ts";
import { CastCheck } from "./cast.ts";
import { Declaration_from_LetExpr, GatherLocalsVisitor } from "./gather_locals.ts";
import { contains_let_in_chain } from "./op.ts";
import {
  AddressOfTemporaryTaken_diagnostic,
  CantDereference_diagnostic,
  ExprParenthesesNeeded_subdiagnostic,
  type ReturnLikeStatementKind,
  type ReturnStmtOutsideOfFnBody,
  ReturnStmtOutsideOfFnBody_diagnostic,
  StructExprNonExhaustive_diagnostic,
} from "./diagnostics.gen.ts";
import { ExprParenthesesNeeded_surrounding } from "./diagnostics.ts";

/**
 * PORT(decls): pending root. `TypeErrCtxt` is `Pending` (rustc_trait_selection decls.ts, wave 19): the methods of it
 * that expr.rs / op.rs call, with their upstream signatures (error_reporting/traits/suggestions.rs:
 * `suggest_restricting_param_bound`, `note_field_shadowed_by_private_candidate`; error_reporting/infer/mod.rs
 * (`TypeErrCtxtExt`): `ty_kind_suggestion`). Reached only after `FnCtxt::err_ctxt`'s `unported` stop.
 */
export interface TypeErrCtxtMethods {
  ty_kind_suggestion(param_env: ParamEnv, ty: Ty): string | undefined;
  note_field_shadowed_by_private_candidate(err: Diag, hir_id: HirId, param_env: ParamEnv): void;
  suggest_restricting_param_bound(err: Diag, trait_pred: unknown, associated_ty: [string, Ty] | undefined, body_id: unknown): void;
}
/** `self.err_ctxt()` with the methods of `TypeErrCtxtMethods` (see above). */
export function err_ctxt_methods(fcx: FnCtxt): TypeErrCtxtMethods {
  return fcx.err_ctxt() as unknown as TypeErrCtxtMethods;
}

/** `impl TypeVisitable for (Ty, Ty)` (`(a, b).error_reported()`). */
export const d_Ty_Ty_visitable: TypeVisitable<[Ty, Ty]> = {
  visit_with: (self, visitor) => visit_with_tuple2(self, visitor, fold_Ty.visit_with, fold_Ty.visit_with),
};

/**
 * PORT(decls): pending root. decls.ts types `FnCtxt.ret_coercion` (and `if_fallback_coercion`'s `coercion`) with the
 * generated `CoerceMany` of coercion.gen.ts, but the class instantiated at runtime, which carries the methods, is
 * coercion.ts's hand class (`CoerceMany.new`): the same object seen with the right type.
 */
export function ret_coercion_of(fcx: FnCtxt): CoerceMany | undefined {
  return fcx.ret_coercion as unknown as CoerceMany | undefined;
}
/** The converse of `ret_coercion_of` (PORT(decls): pending root). */
export function as_gen_CoerceMany(c: CoerceMany): CoerceManyGen {
  return c as unknown as CoerceManyGen;
}

// ==== lane typeck-expr-a: expr.rs:1..1854 ====

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

// rustc: compiler/rustc_hir_typeck/src/expr.rs:59 precedence
FnCtxt.prototype.precedence = function (this: FnCtxt, expr: hir.Expr): ExprPrecedence {
  const has_attr = (id: HirId): boolean => {
    return this.tcx.hir_attrs(id).some(Attribute.is_prefix_attr_for_suggestions);
  };

  // Special case: range expressions are desugared to struct literals in HIR,
  // so they would normally return `Unambiguous` precedence in expr.precedence.
  // we should return `Range` precedence for correct parenthesization in suggestions.
  if (is_range_literal(expr)) {
    return ExprPrecedenceC.Range;
  }

  return expr.precedence(has_attr);
};

/// Check an expr with an expectation type, and also demand that the expr's
/// evaluated type is a subtype of the expectation at the end. This is a
/// *hard* requirement.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:80 check_expr_has_type_or_error
FnCtxt.prototype.check_expr_has_type_or_error = function (this: FnCtxt, expr: hir.Expr, expected_ty: Ty, extend_err: (_1: Diag) => void): Ty {
  let ty = this.check_expr_with_expectation(expr, { $: "ExpectHasType", _0: expected_ty });

  // While we don't allow *arbitrary* coercions here, we *do* allow
  // coercions from ! to `expected`.
  if (this.deeply_resolve_ignoring_regions_with_obligations(ty, fold_Ty).is_never() && this.tcx.expr_guaranteed_to_constitute_read_for_never(expr)) {
    const adjustments = this.typeck_results.adjustments().get(expr.hir_id);
    if (adjustments !== undefined) {
      const reported = this.dcx().span_delayed_bug(expr.span, "expression with never type wound up being adjusted");

      if (adjustments.length === 1 && adjustments[0]!.kind.$ === "NeverToAny") {
        return adjustments[0]!.target;
      } else {
        return Ty.new_error(this.tcx, reported);
      }
    }

    const adj_ty = this.next_ty_var(expr.span);
    this.apply_adjustments(expr, [{ kind: { $: "NeverToAny" }, target: adj_ty }]);
    ty = adj_ty;
  }

  const r = this.demand_suptype_diag(expr.span, expected_ty, ty);
  if (r.$ === "Err") {
    const err = r._0;
    this.emit_type_mismatch_suggestions(err, expr.peel_drop_temps(), ty, expected_ty, undefined, undefined);
    extend_err(err);
    err.emit();
  }
  return ty;
};

/// Check an expr with an expectation type, and also demand that the expr's
/// evaluated type is a coercible to the expectation at the end. This is a
/// *hard* requirement.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:132 check_expr_coercible_to_type
FnCtxt.prototype.check_expr_coercible_to_type = function (this: FnCtxt, expr: hir.Expr, expected: Ty, expected_ty_expr: hir.Expr | undefined): Ty {
  return this.check_expr_coercible_to_type_or_error(expr, expected, expected_ty_expr, (_, _2) => {});
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:141 check_expr_coercible_to_type_or_error
FnCtxt.prototype.check_expr_coercible_to_type_or_error = function (this: FnCtxt, expr: hir.Expr, expected: Ty, expected_ty_expr: hir.Expr | undefined, extend_err: (_1: Diag, _2: Ty) => void): Ty {
  const ty = this.check_expr_with_hint(expr, expected);
  // checks don't need two phase
  const r = this.demand_coerce_diag(expr, ty, expected, expected_ty_expr, "No");
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const err = r._0;
    extend_err(err, ty);
    err.emit();
    // Return the original type instead of an error type here, otherwise the type of `x` in
    // `let x: u32 = ();` will be a type error, causing all subsequent usages of `x` to not
    // report errors, even though `x` is definitely `u32`.
    return expected;
  }
};

/// Check an expr with an expectation type. Don't actually enforce that expectation
/// is related to the expr's evaluated type via subtyping or coercion. This is
/// usually called because we want to do that subtype/coerce call manually for better
/// diagnostics.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:167 check_expr_with_hint
FnCtxt.prototype.check_expr_with_hint = function (this: FnCtxt, expr: hir.Expr, expected: Ty): Ty {
  return this.check_expr_with_expectation(expr, { $: "ExpectHasType", _0: expected });
};

/// Check an expr with an expectation type, and also [`Needs`] which will
/// prompt typeck to convert any implicit immutable derefs to mutable derefs.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:177 check_expr_with_expectation_and_needs
FnCtxt.prototype.check_expr_with_expectation_and_needs = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT, needs: Needs): Ty {
  const ty = this.check_expr_with_expectation(expr, expected);

  // If the expression is used in a place whether mutable place is required
  // e.g. LHS of assignment, perform the conversion.
  if (needs === "MutPlace") {
    this.convert_place_derefs_to_mutable(expr);
  }

  return ty;
};

/// Check an expr with no expectations.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:195 check_expr
FnCtxt.prototype.check_expr = function (this: FnCtxt, expr: hir.Expr): Ty {
  return this.check_expr_with_expectation(expr, Expectation.NoExpectation);
};

/// Check an expr with no expectations, but with [`Needs`] which will
/// prompt typeck to convert any implicit immutable derefs to mutable derefs.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:201 check_expr_with_needs
FnCtxt.prototype.check_expr_with_needs = function (this: FnCtxt, expr: hir.Expr, needs: Needs): Ty {
  return this.check_expr_with_expectation_and_needs(expr, Expectation.NoExpectation, needs);
};

/// Check an expr with an expectation type which may be used to eagerly
/// guide inference when evaluating that expr.
// #[instrument(skip(self, expr), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/expr.rs:212 check_expr_with_expectation
FnCtxt.prototype.check_expr_with_expectation = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT): Ty {
  return this.check_expr_with_expectation_and_args(expr, expected, undefined);
};

/// Same as [`Self::check_expr_with_expectation`], but allows us to pass in
/// the arguments of a [`ExprKind::Call`] when evaluating its callee that
/// is an [`ExprKind::Path`]. We use this to refine the spans for certain
/// well-formedness guarantees for the path expr.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:224 check_expr_with_expectation_and_args
FnCtxt.prototype.check_expr_with_expectation_and_args = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT, call_expr_and_args: [hir.Expr, readonly hir.Expr[]] | undefined): Ty {
  if (this.tcx.sess.verbose_internals()) {
    // make this code only run with -Zverbose-internals because it is probably slow
    const lint_str = this.tcx.sess.source_map().span_to_snippet(expr.span);
    if (lint_str.$ === "Ok") {
      // PORT: the snippet only feeds `debug!("expr text: ..")` (tracing, not ported).
    }
  }

  // True if `expr` is a `Try::from_ok(())` that is a result of desugaring a try block
  // without the final expr (e.g. `try { return; }`). We don't want to generate an
  // unreachable_code lint for it since warnings for autogenerated code are confusing.
  let is_try_block_generated_unit_expr: boolean;
  if (expr.kind.$ === "Call" && expr.kind._1.length === 1) {
    const arg = expr.kind._1[0]!;
    is_try_block_generated_unit_expr = Span.is_desugaring(expr.span, DesugaringKind.TryBlock) && Span.is_desugaring(arg.span, DesugaringKind.TryBlock);
  } else {
    is_try_block_generated_unit_expr = false;
  }

  // Warn for expressions after diverging siblings.
  if (!is_try_block_generated_unit_expr) {
    this.warn_if_unreachable(expr.hir_id, expr.span, "expression");
  }

  // Whether a past expression diverges doesn't affect typechecking of this expression, so we
  // reset `diverges` while checking `expr`.
  const old_diverges = this.diverges;
  this.diverges = Diverges.Maybe;

  const is_whole_body = this.is_whole_body;
  this.is_whole_body = false;
  if (is_whole_body) {
    // If this expression is the whole body and the function diverges because of its
    // arguments, we check this here to ensure the body is considered to diverge.
    this.diverges = this.function_diverges_because_of_empty_arguments;
  }

  let ty_: Ty;
  const k = expr.kind;
  // Intercept the callee path expr and give it better spans.
  if (k.$ === "Path" && (k._0.$ === "Resolved" || k._0.$ === "TypeRelative")) {
    const qpath = k._0;
    ty_ = this.check_expr_path(qpath, expr, call_expr_and_args);
  } else {
    ty_ = this.check_expr_kind(expr, expected);
  }
  const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);

  // Warn for non-block expressions with diverging children.
  switch (k.$) {
    case "Block":
    case "If":
    case "Let":
    case "Loop":
    case "Match":
      break;
    // Do not warn on `as` casts from never to any,
    // they are sometimes required to appeal typeck.
    case "Cast":
      break;
    case "Call":
      // If `expr` is a result of desugaring the try block and is an ok-wrapped
      // diverging expression (e.g. it arose from desugaring of `try { return }`),
      // we skip issuing a warning because it is autogenerated code.
      if (Span.is_desugaring(expr.span, DesugaringKind.TryBlock)) break;
      // Likewise, do not lint unreachable code injected via contracts desugaring.
      if (Span.is_desugaring(expr.span, DesugaringKind.Contract)) break;
      this.warn_if_unreachable(expr.hir_id, k._0.span, "call");
      break;
    case "MethodCall":
      this.warn_if_unreachable(expr.hir_id, k._0.ident.span, "call");
      break;
    default:
      this.warn_if_unreachable(expr.hir_id, expr.span, "expression");
  }

  // Any expression that produces a value of type `!` must have diverged,
  // unless it's a place expression that isn't being read from, in which case
  // diverging would be unsound since we may never actually read the `!`.
  // e.g. `let _ = *never_ptr;` with `never_ptr: *const !`.
  if (this.deeply_resolve_ignoring_regions_with_obligations(ty, fold_Ty).is_never() && this.tcx.expr_guaranteed_to_constitute_read_for_never(expr)) {
    this.diverges = Diverges.bitor(this.diverges, Diverges.always(expr.span));
  }

  // Record the type, which applies it effects.
  // We need to do this after the warning above, so that
  // we don't warn for the diverging expression itself.
  this.write_ty(expr.hir_id, ty);

  // Combine the diverging and has_error flags.
  this.diverges = Diverges.bitor(this.diverges, old_diverges);

  // debug!("type of {} is...", self.tcx.hir_id_to_string(expr.hir_id));
  // debug!("... {:?}, expected is {:?}", ty, expected);

  return ty;
};

// #[instrument(skip(self, expr), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/expr.rs:329 check_expr_kind
FnCtxt.prototype.check_expr_kind = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT): Ty {
  // trace!("expr={:#?}", expr);

  const tcx = this.tcx;
  const k = expr.kind;
  switch (k.$) {
    case "Lit":
      return this.check_expr_lit(k._0, expr.hir_id, expected);
    case "Binary":
      return this.check_expr_binop(expr, k._0, k._1, k._2, expected);
    case "Assign":
      return this.check_expr_assign(expr, expected, k._0, k._1, k._2);
    case "AssignOp":
      return this.check_expr_assign_op(expr, k._0, k._1, k._2, expected);
    case "Unary":
      return this.check_expr_unop(k._0, k._1, expected, expr);
    case "AddrOf":
      return this.check_expr_addr_of(k._0, k._1, k._2, expected, expr);
    case "Path":
      return this.check_expr_path(k._0, expr, undefined);
    case "InlineAsm": {
      const asm = k._0;
      // We defer some asm checks as we may not have resolved the input and output types yet (they may still be infer vars).
      this.deferred_asm_checks.push([asm, expr.hir_id]);
      return this.check_expr_asm(asm, expr.span);
    }
    case "OffsetOf":
      return this.check_expr_offset_of(k._0, k._1, expr);
    case "Break":
      return this.check_expr_break(k._0, k._1, expr);
    case "Continue":
      return this.check_expr_continue(k._0, expr);
    case "Ret":
      return this.check_expr_return(k._0, expr);
    case "Become":
      return this.check_expr_become(k._0, expr);
    case "Let":
      return this.check_expr_let(k._0, expr.hir_id);
    case "Loop":
      return this.check_expr_loop(k._0, k._2, expected, expr);
    case "Match":
      return this.check_expr_match(expr, k._0, k._1, expected, k._2);
    case "Closure":
      return this.check_expr_closure(k._0, expr.span, expected);
    case "Block":
      return this.check_expr_block(k._0, expected);
    case "Call":
      return this.check_expr_call(expr, k._0, k._1, expected);
    case "Use":
      return this.check_expr_use(k._0, expected);
    case "MethodCall":
      return this.check_expr_method_call(expr, k._0, k._1, k._2, expected);
    case "Cast":
      return this.check_expr_cast(k._0, k._1, expr);
    case "Type": {
      const [e, t] = [k._0, k._1];
      const ascribed_ty = this.lower_ty_saving_user_provided_ty(t);
      const ty = this.check_expr_with_hint(e, ascribed_ty);
      this.demand_eqtype(e.span, ascribed_ty, ty);
      return ascribed_ty;
    }
    case "If":
      return this.check_expr_if(expr.hir_id, k._0, k._1, k._2, expr.span, expected);
    case "DropTemps":
      return this.check_expr_with_expectation(k._0, expected);
    case "Array":
      return this.check_expr_array(k._0, expected, expr);
    case "ConstBlock":
      return this.check_expr_const_block(k._0, expected);
    case "Repeat":
      return this.check_expr_repeat(k._0, k._1, expected, expr);
    case "Tup":
      return this.check_expr_tuple(k._0, expected, expr);
    case "Struct":
      return this.check_expr_struct(expr, expected, k._0, k._1, k._2);
    case "Field":
      return this.check_expr_field(expr, k._0, k._1, expected);
    case "Index":
      return this.check_expr_index(k._0, k._1, expr, k._2);
    case "Yield":
      return this.check_expr_yield(k._0, expr);
    case "UnsafeBinderCast":
      return this.check_expr_unsafe_binder_cast(expr.span, k._0, k._1, k._2, expected);
    case "Err":
      return Ty.new_error(tcx, k._0);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:411 check_expr_unop
FnCtxt.prototype.check_expr_unop = function (this: FnCtxt, unop: ast.UnOp, oprnd: hir.Expr, expected: ExpectationT, expr: hir.Expr): Ty {
  const tcx = this.tcx;
  let expected_inner: ExpectationT;
  switch (unop) {
    case "Not":
    case "Neg":
      expected_inner = expected;
      break;
    case "Deref":
      expected_inner = Expectation.NoExpectation;
      break;
  }
  const oprnd_t_ = this.check_expr_with_expectation(oprnd, expected_inner);

  const er = TypeVisitableExt.error_reported(oprnd_t_, fold_Ty);
  if (er.$ === "Err") {
    return Ty.new_error(tcx, er._0);
  }

  const oprnd_t = this.structurally_resolve_type(expr.span, oprnd_t_);
  switch (unop) {
    case "Deref":
      return (
        this.lookup_derefing(expr, oprnd, oprnd_t) ??
        (() => {
          const err = this.dcx().create_err(CantDereference_diagnostic({ span: expr.span, ty: oprnd_t }));
          const sp = Span.with_parent(tcx.sess.source_map().start_point(expr.span), undefined);
          const sp2 = tcx.sess.psess.complete_stmt_exprs_before_bin_op_lookalike.get(sp);
          if (sp2 !== undefined) {
            err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(sp2)));
          }
          // The operand may be an uncalled function, in which case it is its return type
          // the user meant to dereference. Only suggest the call when that return type is
          // itself dereferenceable, mirroring the checks `lookup_derefing` just failed.
          this.suggest_fn_call(err, oprnd, oprnd_t, (output) => {
            if (output.builtin_deref(true) !== undefined) return true;
            const deref_trait = this.tcx.lang_items().deref_trait();
            return deref_trait !== undefined && EvaluationResult.may_apply(this.infcx.type_implements_trait(deref_trait, [output], this.param_env));
          });
          return Ty.new_error(tcx, err.emit_err());
        })()
      );
    case "Not": {
      const result = this.check_user_unop(expr, oprnd_t, unop, expected_inner);
      // If it's builtin, we can reuse the type, this helps inference.
      if (oprnd_t.is_integral() || oprnd_t.kind().$ === "Bool") {
        return oprnd_t;
      } else {
        return result;
      }
    }
    case "Neg": {
      const result = this.check_user_unop(expr, oprnd_t, unop, expected_inner);
      // If it's builtin, we can reuse the type, this helps inference.
      if (oprnd_t.is_numeric()) {
        return oprnd_t;
      } else {
        return result;
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:465 check_expr_addr_of
FnCtxt.prototype.check_expr_addr_of = function (this: FnCtxt, kind: ast.BorrowKind, mutbl: Mutability, oprnd: hir.Expr, expected: ExpectationT, expr: hir.Expr): Ty {
  const only = Expectation.only_has_type(expected, this);
  let hint: ExpectationT;
  if (only === undefined) {
    hint = Expectation.NoExpectation;
  } else {
    const k = this.deeply_resolve_ignoring_regions_with_obligations(only, fold_Ty).kind();
    if (k.$ === "Ref" || k.$ === "RawPtr") {
      const ty = k.$ === "Ref" ? k._1 : k._0;
      if (oprnd.is_syntactic_place_expr()) {
        // Places may legitimately have unsized types.
        // For example, dereferences of a wide pointer and
        // the last field of a struct can be unsized.
        hint = { $: "ExpectHasType", _0: ty };
      } else {
        hint = Expectation.rvalue_hint(this, ty);
      }
    } else {
      hint = Expectation.NoExpectation;
    }
  }
  const ty = this.check_expr_with_expectation_and_needs(oprnd, hint, Needs.maybe_mut_place(mutbl));
  const er = TypeVisitableExt.error_reported(ty, fold_Ty);
  if (er.$ === "Err") {
    return Ty.new_error(this.tcx, er._0);
  }

  switch (kind) {
    case "Raw":
      this.check_named_place_expr(oprnd);
      return Ty.new_ptr(this.tcx, ty, mutbl);
    case "Ref":
    case "Pin": {
      // Note: at this point, we cannot say what the best lifetime
      // is to use for resulting pointer. We want to use the
      // shortest lifetime possible so as to avoid spurious borrowck
      // errors. Moreover, the longest lifetime will depend on the
      // precise details of the value whose address is being taken
      // (and how long it is valid), which we don't know yet until
      // type inference is complete.
      //
      // Therefore, here we simply generate a region variable. The
      // region inferencer will then select a suitable value.
      // Finally, borrowck will infer the value of the region again,
      // this time with enough precision to check that the value
      // whose address was taken can actually be made to live as long
      // as it needs to live.
      const region = this.next_region_var({ $: "BorrowRegion", _0: expr.span });
      switch (kind) {
        case "Ref":
          return Ty.new_ref(this.tcx, region, ty, mutbl);
        case "Pin":
          return Ty.new_pinned_ref(this.tcx, region, ty, mutbl);
      }
    }
  }
};

/// Does this expression refer to a place that either:
/// * Is based on a local or static.
/// * Contains a dereference
/// Note that the adjustments for the children of `expr` should already
/// have been resolved.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:529 check_named_place_expr
FnCtxt.prototype.check_named_place_expr = function (this: FnCtxt, oprnd: hir.Expr): void {
  const is_named = oprnd.is_place_expr((base) => {
    // Allow raw borrows if there are any deref adjustments.
    //
    // const VAL: (i32,) = (0,);
    // const REF: &(i32,) = &(0,);
    //
    // &raw const VAL.0;            // ERROR
    // &raw const REF.0;            // OK, same as &raw const (*REF).0;
    //
    // This is maybe too permissive, since it allows
    // `let u = &raw const Box::new((1,)).0`, which creates an
    // immediately dangling raw pointer.
    const x = this.typeck_results.adjustments().get(base.hir_id);
    return x !== undefined && x.some((adj) => adj.kind.$ === "Deref");
  });
  if (!is_named) {
    this.dcx().emit_err(AddressOfTemporaryTaken_diagnostic({ span: oprnd.span }));
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:553 check_expr_path
FnCtxt.prototype.check_expr_path = function (this: FnCtxt, qpath: hir.QPath, expr: hir.Expr, call_expr_and_args: [hir.Expr, readonly hir.Expr[]] | undefined): Ty {
  const tcx = this.tcx;

  if (call_expr_and_args !== undefined && call_expr_and_args[1].length === 1 && qpath.$ === "Resolved" && qpath._1.res.$ === "Def") {
    const arg = call_expr_and_args[1][0]!;
    const def_id = qpath._1.res._1;
    const lang_item = tcx.lang_items().from_def_id(def_id);
    if (lang_item !== undefined) {
      let code: ObligationCauseCode | undefined;
      if (lang_item === "IntoFutureIntoFuture" && Span.is_desugaring(expr.span, DesugaringKind.Await)) {
        code = { $: "AwaitableExpr", _0: arg.hir_id };
      } else if ((lang_item === "IntoIterIntoIter" || lang_item === "IteratorNext") && Span.is_desugaring(expr.span, DesugaringKind.ForLoop)) {
        code = { $: "ForLoopIterator", _0: arg.hir_id };
      } else if (lang_item === "TryTraitFromOutput" && Span.is_desugaring(expr.span, DesugaringKind.TryBlock)) {
        // FIXME it's a try block, not a question mark
        code = { $: "QuestionMark" };
      } else if ((lang_item === "TryTraitBranch" || lang_item === "TryTraitFromResidual") && Span.is_desugaring(expr.span, DesugaringKind.QuestionMark)) {
        code = { $: "QuestionMark" };
      } else {
        code = undefined;
      }
      if (code !== undefined) {
        const code_ = code;
        const args = this.fresh_args_for_item(expr.span, def_id);
        this.add_required_obligations_with_code(expr.span, def_id, args, (_, _2) => code_);
        return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty));
      }
    }
  }

  const [res, opt_ty, segs] = this.resolve_ty_and_res_fully_qualified_call(qpath, expr.hir_id, expr.span);
  let ty: Ty;
  if (res.$ === "Err") {
    this.suggest_assoc_method_call(segs);
    const e = this.dcx().span_delayed_bug(hir.QPath.span(qpath), "`Res::Err` but no error emitted");
    ty = Ty.new_error(tcx, e);
  } else if (res.$ === "Def" && res._0.$ === "Variant") {
    const e = this.report_unexpected_variant_res(res, expr, [], qpath, expr.span, E0533, "value");
    ty = Ty.new_error(tcx, e);
  } else {
    ty = this.instantiate_value_path(segs, opt_ty, res, call_expr_and_args === undefined ? expr.span : call_expr_and_args[0].span, expr.span, expr.hir_id, call_expr_and_args !== undefined)[0];
  }

  const tk = ty.kind();
  if (tk.$ === "FnDef") {
    const [did, args] = [tk._0, tk._1];
    const fn_sig = ty.fn_sig(tcx);

    if (tcx.is_intrinsic(did, sym.transmute)) {
      const from = Binder.skip_binder(PolyFnSig.inputs(fn_sig))[0];
      if (from === undefined) {
        span_bug(tcx.def_span(did), "intrinsic fn `transmute` defined with no parameters");
      }
      const to = Binder.skip_binder(PolyFnSig.output(fn_sig));
      // We defer the transmute to the end of typeck, once all inference vars have
      // been resolved or we errored. This is important as we can only check transmute
      // on concrete types, but the output type may not be known yet (it would only
      // be known if explicitly specified via turbofish).
      this.deferred_transmute_checks.push([from, to, expr.hir_id]);
    }
    if (tcx.sess.opts.unstable_opts.offload.length !== 0 && tcx.is_intrinsic(did, sym.offload)) {
      const args_ = Binder.skip_binder(args);
      const f = args_.type_at(0);
      const t = args_.type_at(1);
      const r = args_.type_at(2);
      // Defer offload checks to check generics later once types are fully inferred.
      this.deferred_offload_checks.push([f, t, r, expr.hir_id]);
    }
    if (!tcx.features().unsized_fn_params()) {
      // We want to remove some Sized bounds from std functions,
      // but don't want to expose the removal to stable Rust.
      // i.e., we don't want to allow
      //
      // ```rust
      // drop as fn(str);
      // ```
      //
      // to work in stable even if the Sized bound on `drop` is relaxed.
      const n = Binder.skip_binder(PolyFnSig.inputs(fn_sig)).length;
      for (let i = 0; i < n; i++) {
        // We just want to check sizedness, so instead of introducing
        // placeholder lifetimes with probing, we just replace higher lifetimes
        // with fresh vars.
        const arg = call_expr_and_args === undefined ? undefined : call_expr_and_args[1][i];
        const span = arg === undefined ? expr.span : arg.span;
        const input = this.instantiate_binder_with_fresh_vars(span, { $: "FnCall" }, PolyFnSig.input(fn_sig, i), fold_Ty);
        this.require_type_is_sized_deferred(input, span, { $: "SizedArgumentType", _0: undefined });
      }
    }
    // Here we want to prevent struct constructors from returning unsized types,
    // which can happen with fn pointer coercion on stable.
    // Also, as we just want to check sizedness, instead of introducing
    // placeholder lifetimes with probing, we just replace higher lifetimes
    // with fresh vars.
    const output = this.instantiate_binder_with_fresh_vars(expr.span, { $: "FnCall" }, PolyFnSig.output(fn_sig), fold_Ty);
    this.require_type_is_sized_deferred(output, call_expr_and_args === undefined ? expr.span : call_expr_and_args[0].span, { $: "SizedCallReturnType", _0: expr.hir_id });
  }

  // We always require that the type provided as the value for
  // a type parameter outlives the moment of instantiation.
  const args = this.typeck_results.node_args(expr.hir_id);
  this.add_wf_bounds(args, expr.span, expr.hir_id);

  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:715 check_expr_break
FnCtxt.prototype.check_expr_break = function (this: FnCtxt, destination: hir.Destination, expr_opt: hir.Expr | undefined, expr: hir.Expr): Ty {
  const tcx = this.tcx;
  if (destination.target_id.$ === "Ok") {
    const target_id = destination.target_id._0;
    let e_ty: Ty;
    let cause;
    if (expr_opt !== undefined) {
      const e = expr_opt;
      // If this is a break with a value, we need to type-check
      // the expression. Get an expected type from the loop context.
      let opt_coerce_to: Ty | undefined;
      {
        // We should release `enclosing_breakables` before the `check_expr_with_hint`
        // below, so can't move this block of code to the enclosing scope and share
        // `ctxt` with the second `enclosing_breakables` borrow below.
        const enclosing_breakables = this.enclosing_breakables;
        const ctxt = enclosing_breakables.opt_find_breakable(target_id);
        if (ctxt !== undefined) {
          opt_coerce_to = ctxt.coerce === undefined ? undefined : ctxt.coerce.expected_ty();
        } else {
          // Avoid ICE when `break` is inside a closure (#65383).
          return Ty.new_error_with_message(tcx, MultiSpan.from_span(expr.span), "break was outside loop, but no error was emitted");
        }
      }

      // If the loop context is not a `loop { }`, then break with
      // a value is illegal, and `opt_coerce_to` will be `None`.
      // Set expectation to error in that case and set tainted
      // by error (#114529)
      const coerce_to =
        opt_coerce_to ??
        (() => {
          const guar = this.dcx().span_delayed_bug(expr.span, "illegal break with value found but no error reported");
          this.set_tainted_by_errors(guar);
          return Ty.new_error(tcx, guar);
        })();

      // Recurse without `enclosing_breakables` borrowed.
      e_ty = this.check_expr_with_hint(e, coerce_to);
      cause = this.misc(e.span);
    } else {
      // Otherwise, this is a break *without* a value. That's
      // always legal, and is equivalent to `break ()`.
      e_ty = tcx.types.unit;
      cause = this.misc(expr.span);
    }

    // Now that we have type-checked `expr_opt`, borrow
    // the `enclosing_loops` field and let's coerce the
    // type of `expr_opt` into what is expected.
    const enclosing_breakables = this.enclosing_breakables;
    const ctxt: BreakableCtxt | undefined = enclosing_breakables.opt_find_breakable(target_id);
    if (ctxt === undefined) {
      // Avoid ICE when `break` is inside a closure (#65383).
      return Ty.new_error_with_message(tcx, MultiSpan.from_span(expr.span), "break was outside loop, but no error was emitted");
    }

    if (ctxt.coerce !== undefined) {
      const coerce = ctxt.coerce;
      if (expr_opt !== undefined) {
        const e = expr_opt;
        coerce.coerce(this, cause, e, e_ty);
      } else {
        assert(e_ty.is_unit(), "assertion failed: e_ty.is_unit()");
        const ty = coerce.expected_ty();
        coerce.coerce_forced_unit(
          this,
          cause,
          (err) => {
            this.suggest_missing_semicolon(err, expr, e_ty, false, false);
            this.suggest_mismatched_types_on_tail(err, expr, ty, e_ty, target_id);
            const error: TypeError | undefined = { $: "Sorts", _0: { expected: ty, found: e_ty } } as TypeError;
            this.annotate_loop_expected_due_to_inference(err, expr, error);
            const val = err_ctxt_methods(this).ty_kind_suggestion(this.param_env, ty);
            if (val !== undefined) {
              err.span_suggestion_verbose(Span.shrink_to_hi(expr.span), "give the `break` a value of the expected type", ` ${val}`, "HasPlaceholders");
            }
          },
          false,
        );
      }
    } else {
      // If `ctxt.coerce` is `None`, we can just ignore
      // the type of the expression. This is because
      // either this was a break *without* a value, in
      // which case it is always a legal type (`()`), or
      // else an error would have been flagged by the
      // `loops` pass for using break with an expression
      // where you are not supposed to.
      assert(expr_opt === undefined || this.tainted_by_errors() !== undefined, "assertion failed: expr_opt.is_none() || self.tainted_by_errors().is_some()");
    }

    // If we encountered a `break`, then (no surprise) it may be possible to break from the
    // loop... unless the value being returned from the loop diverges itself, e.g.
    // `break return 5` or `break loop {}`.
    ctxt.may_break = ctxt.may_break || !Diverges.is_always(this.diverges);

    // the type of a `break` is always `!`, since it diverges
    return tcx.types.never;
  } else {
    // Otherwise, we failed to find the enclosing loop;
    // this can only happen if the `break` was not
    // inside a loop at all, which is caught by the
    // loop-checking pass.
    const err = Ty.new_error_with_message(this.tcx, MultiSpan.from_span(expr.span), "break was outside loop, but no error was emitted");

    // We still need to assign a type to the inner expression to
    // prevent the ICE in #43162.
    if (expr_opt !== undefined) {
      const e = expr_opt;
      this.check_expr_with_hint(e, err);

      // ... except when we try to 'break rust;'.
      // ICE this expression in particular (see #43162).
      if (e.kind.$ === "Path" && e.kind._0.$ === "Resolved") {
        const path = e.kind._0._1;
        if (path.segments.length === 1 && path.segments[0]!.ident.name === sym.rust) {
          fatally_break_rust(this.tcx, expr.span);
        }
      }
    }

    // There was an error; make type-check fail.
    return err;
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:862 check_expr_continue
FnCtxt.prototype.check_expr_continue = function (this: FnCtxt, destination: hir.Destination, expr: hir.Expr): Ty {
  if (destination.target_id.$ === "Ok") {
    const target_id = destination.target_id._0;
    const node = this.tcx.hir_node(target_id);
    if (node.$ === "Expr" && node._0.kind.$ === "Loop") {
      return this.tcx.types.never;
    } else {
      // Liveness linting assumes `continue`s all point to loops. We'll report an error
      // in `check_mod_loops`, but make sure we don't run liveness (#113379, #121623).
      const guar = this.dcx().span_delayed_bug(expr.span, "found `continue` not pointing to loop, but no error reported");
      return Ty.new_error(this.tcx, guar);
    }
  } else {
    // There was an error; make type-check fail.
    return Ty.new_misc_error(this.tcx);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:887 check_expr_return
FnCtxt.prototype.check_expr_return = function (this: FnCtxt, expr_opt: hir.Expr | undefined, expr: hir.Expr): Ty {
  if (ret_coercion_of(this) === undefined) {
    this.emit_return_outside_of_fn_body(expr, "Return");

    if (expr_opt !== undefined) {
      const e = expr_opt;
      // We still have to type-check `e` (issue #86188), but calling
      // `check_return_expr` only works inside fn bodies.
      this.check_expr(e);
    }
  } else if (expr_opt !== undefined) {
    const e = expr_opt;
    if (this.ret_coercion_span === undefined) {
      this.ret_coercion_span = e.span;
    }
    this.check_return_or_body_tail(e, true);
  } else {
    const coercion = unwrap(ret_coercion_of(this));
    if (this.ret_coercion_span === undefined) {
      this.ret_coercion_span = expr.span;
    }
    const cause = this.cause(expr.span, { $: "ReturnNoExpression" });
    const r = this.get_fn_decl(expr.hir_id);
    if (r !== undefined) {
      const [, fn_decl] = r;
      coercion.coerce_forced_unit(
        this,
        cause,
        (db) => {
          const span = hir.FnRetTy.span(fn_decl.output);
          const snippet = this.tcx.sess.source_map().span_to_snippet(span);
          if (snippet.$ === "Ok") {
            db.span_label(span, `expected \`${snippet._0.toString()}\` because of this return type`);
          }
        },
        true,
      );
    } else {
      coercion.coerce_forced_unit(this, cause, (_) => {}, true);
    }
  }
  return this.tcx.types.never;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:933 check_expr_become
FnCtxt.prototype.check_expr_become = function (this: FnCtxt, call: hir.Expr, expr: hir.Expr): Ty {
  const ret_coercion = ret_coercion_of(this);
  if (ret_coercion !== undefined) {
    const ret_ty = ret_coercion.expected_ty();
    const call_expr_ty = this.check_expr_with_hint(call, ret_ty);

    // N.B. don't coerce here, as tail calls can't support most/all coercions
    // FIXME(explicit_tail_calls): add a diagnostic note that `become` doesn't allow coercions
    this.demand_suptype(expr.span, ret_ty, call_expr_ty);
  } else {
    this.emit_return_outside_of_fn_body(expr, "Become");

    // Fallback to simply type checking `call` without hint/demanding the right types.
    // Best effort to highlight more errors.
    this.check_expr(call);
  }

  return this.tcx.types.never;
};

/// Check an expression that _is being returned_.
/// For example, this is called with `return_expr: $expr` when `return $expr`
/// is encountered.
///
/// Note that this function must only be called in function bodies.
///
/// `explicit_return` is `true` if we're checking an explicit `return expr`,
/// and `false` if we're checking a trailing expression.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:967 check_return_or_body_tail
FnCtxt.prototype.check_return_or_body_tail = function (this: FnCtxt, return_expr: hir.Expr, explicit_return: boolean): void {
  const ret_coercion = ret_coercion_of(this) ?? span_bug(return_expr.span, "check_return_expr called outside fn body");

  const ret_ty = ret_coercion.expected_ty();
  const return_expr_ty = this.check_expr_with_hint(return_expr, ret_ty);
  let span = return_expr.span;
  let hir_id = return_expr.hir_id;
  // Use the span of the trailing expression for our cause,
  // not the span of the entire function
  if (!explicit_return && return_expr.kind.$ === "Block" && return_expr.kind._0.expr !== undefined) {
    const last_expr = return_expr.kind._0.expr;
    span = last_expr.span;
    hir_id = last_expr.hir_id;
  }
  ret_coercion.coerce(this, this.cause(span, { $: "ReturnValue", _0: return_expr.hir_id }), return_expr, return_expr_ty);

  const fn_sig = this.fn_sig();
  if (fn_sig !== undefined && TypeVisitableExt.has_opaque_types(FnSig.output(fn_sig), fold_Ty)) {
    // Point any obligations that were registered due to opaque type
    // inference at the return expression.
    this.select_obligations_where_possible((errors) => {
      this.point_at_return_for_opaque_ty_error(errors, hir_id, span, return_expr_ty, return_expr.span);
    });
  }
};

/// Emit an error because `return` or `become` is used outside of a function body.
///
/// `expr` is the `return` (`become`) "statement", `kind` is the kind of the statement
/// either `Return` or `Become`.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1017 emit_return_outside_of_fn_body
FnCtxt.prototype.emit_return_outside_of_fn_body = function (this: FnCtxt, expr: hir.Expr, kind: ReturnLikeStatementKind): void {
  const err: ReturnStmtOutsideOfFnBody = {
    span: expr.span,
    encl_body_span: undefined,
    encl_fn_span: undefined,
    statement_kind: kind,
  };

  const encl_item_id = this.tcx.hir_get_parent_item(expr.hir_id);

  const node = this.tcx.hir_node_by_def_id(encl_item_id.def_id);
  let encl_fn_span: Span | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    encl_fn_span = node._0.span;
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Provided") {
    encl_fn_span = node._0.span;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    encl_fn_span = node._0.span;
  }
  if (encl_fn_span !== undefined) {
    // We are inside a function body, so reporting "return statement
    // outside of function body" needs an explanation.

    const encl_body_owner_id = this.tcx.hir_enclosing_body_owner(expr.hir_id);

    // If this didn't hold, we would not have to report an error in
    // the first place.
    assert(encl_item_id.def_id !== encl_body_owner_id, "assertion `left != right` failed");

    const encl_body = this.tcx.hir_body_owned_by(encl_body_owner_id);

    err.encl_body_span = encl_body.value.span;
    err.encl_fn_span = encl_fn_span;
  }

  this.dcx().emit_err(ReturnStmtOutsideOfFnBody_diagnostic(err));
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1061 point_at_return_for_opaque_ty_error
FnCtxt.prototype.point_at_return_for_opaque_ty_error = function (this: FnCtxt, errors: FulfillmentError[], hir_id: HirId, span: Span, return_expr_ty: Ty, return_span: Span): void {
  // Don't point at the whole block if it's empty
  if (span === return_span) {
    return;
  }
  for (const err of errors) {
    const cause = err.obligation.cause;
    const code = cause.code_();
    if (code.$ === "OpaqueReturnType" && code._0 === undefined) {
      const new_cause = this.cause(cause.span, { $: "OpaqueReturnType", _0: [return_expr_ty, hir_id] });
      err.obligation.cause = new_cause;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1085 check_lhs_assignable
FnCtxt.prototype.check_lhs_assignable = function (this: FnCtxt, lhs: hir.Expr, code: ErrCode, op_span: Span, adjust_err: (_1: Diag) => void): void {
  if (lhs.is_syntactic_place_expr()) {
    return;
  }

  // Skip suggestion if LHS contains a let-chain at this would likely be spurious
  // cc: https://github.com/rust-lang/rust/issues/147664
  if (contains_let_in_chain(lhs)) {
    return;
  }

  const err = this.dcx().struct_span_err(op_span, "invalid left-hand side of assignment");
  err.code(code);
  err.span_label(lhs.span, "cannot assign to this expression");

  this.comes_from_while_condition(lhs.hir_id, (expr) => {
    err.span_suggestion_verbose(Span.shrink_to_lo(expr.span), "you might have meant to use pattern destructuring", "let ", "MachineApplicable");
  });
  this.check_for_missing_semi(lhs, err);

  adjust_err(err);

  err.emit();
};

/// Check if the expression that could not be assigned to was a typoed expression that
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1122 check_for_missing_semi
FnCtxt.prototype.check_for_missing_semi = function (this: FnCtxt, expr: hir.Expr, err: Diag): boolean {
  const k = expr.kind;
  if (k.$ === "Binary" && k._0.node === "Mul" && this.tcx.sess.source_map().is_multiline(Span.between(k._1.span, k._2.span)) && k._2.is_syntactic_place_expr()) {
    const lhs = k._1;
    //      v missing semicolon here
    // foo()
    // *bar = baz;
    // (#80446).
    err.span_suggestion_verbose(Span.shrink_to_hi(lhs.span), "you might have meant to write a semicolon here", ";", "MachineApplicable");
    return true;
  }
  return false;
};

// Check if an expression `original_expr_id` comes from the condition of a while loop,
/// as opposed from the body of a while loop, which we can naively check by iterating
/// parents until we find a loop...
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1150 comes_from_while_condition
FnCtxt.prototype.comes_from_while_condition = function (this: FnCtxt, original_expr_id: HirId, then: (_1: hir.Expr) => void): void {
  let parent = this.tcx.parent_hir_id(original_expr_id);
  for (;;) {
    const node = this.tcx.hir_node(parent);
    let cond: hir.Expr | undefined;
    if (node.$ === "Expr" && node._0.kind.$ === "Loop" && node._0.kind._2 === "While") {
      const block_expr = node._0.kind._0.expr;
      if (block_expr !== undefined && (block_expr.kind.$ === "Match" || block_expr.kind.$ === "If")) {
        cond = block_expr.kind._0;
      }
    }
    if (cond !== undefined) {
      const expr = cond;
      // Check if our original expression is a child of the condition of a while loop.
      // If it is, then we have a situation like `while Some(0) = value.get(0) {`,
      // where `while let` was more likely intended.
      let found = false;
      for (const id of this.tcx.hir_parent_id_iter(original_expr_id)) {
        if (HirId_eq(id, expr.hir_id)) {
          found = true;
          break;
        }
      }
      if (found) {
        then(expr);
      }
      break;
    } else if (node.$ === "Item" || node.$ === "ImplItem" || node.$ === "TraitItem" || node.$ === "Crate") {
      break;
    } else {
      parent = this.tcx.parent_hir_id(parent);
    }
  }
};

// A generic function for checking the 'then' and 'else' clauses in an 'if'
// or 'if-else' expression.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1198 check_expr_if
FnCtxt.prototype.check_expr_if = function (this: FnCtxt, expr_id: HirId, cond_expr: hir.Expr, then_expr: hir.Expr, opt_else_expr: hir.Expr | undefined, sp: Span, orig_expected: ExpectationT): Ty {
  const cond_ty = this.check_expr_has_type_or_error(cond_expr, this.tcx.types.bool, (_) => {});

  this.warn_if_unreachable(cond_expr.hir_id, then_expr.span, "block in `if` or `while` expression");

  const cond_diverges = this.diverges;
  this.diverges = Diverges.Maybe;

  const expected = Expectation.try_structurally_resolve_and_adjust_for_branches(orig_expected, this);
  const then_ty = this.check_expr_with_expectation(then_expr, expected);
  const then_diverges = this.diverges;
  this.diverges = Diverges.Maybe;

  // We've already taken the expected type's preferences
  // into account when typing the `then` branch. To figure
  // out the initial shot at a LUB, we thus only consider
  // `expected` if it represents a *hard* constraint
  // (`only_has_type`); otherwise, we just go with a
  // fresh type variable.
  const coerce_to_ty = Expectation.coercion_target_type(expected, this, sp);
  const coerce = CoerceMany.with_capacity(coerce_to_ty, 2);

  coerce.coerce(this, this.misc(sp), then_expr, then_ty);

  if (opt_else_expr !== undefined) {
    const else_expr = opt_else_expr;
    const else_ty = this.check_expr_with_expectation(else_expr, expected);
    const else_diverges = this.diverges;

    const tail_defines_return_position_impl_trait = this.return_position_impl_trait_from_match_expectation(orig_expected);
    const if_cause = this.if_cause(expr_id, else_expr, tail_defines_return_position_impl_trait);

    coerce.coerce(this, if_cause, else_expr, else_ty);

    // We won't diverge unless both branches do (or the condition does).
    this.diverges = Diverges.bitor(cond_diverges, Diverges.bitand(then_diverges, else_diverges));
  } else {
    this.if_fallback_coercion(sp, cond_expr, then_expr, as_gen_CoerceMany(coerce));

    // If the condition is false we can't diverge.
    this.diverges = cond_diverges;
  }

  const result_ty = coerce.complete(this);
  const er = TypeVisitableExt.error_reported(cond_ty, fold_Ty);
  if (er.$ === "Err") {
    return Ty.new_error(this.tcx, er._0);
  } else {
    return result_ty;
  }
};

/// Type check assignment expression `expr` of form `lhs = rhs`.
/// The expected type is `()` and is passed to the function for the purposes of diagnostics.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1264 check_expr_assign
FnCtxt.prototype.check_expr_assign = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT, lhs: hir.Expr, rhs: hir.Expr, span: Span): Ty {
  const expected_ty = Expectation.only_has_type(expected, this);
  if (expected_ty === this.tcx.types.bool) {
    const guar = this.expr_assign_expected_bool_error(expr, lhs, rhs, span);
    return Ty.new_error(this.tcx, guar);
  }

  const lhs_ty = this.check_expr_with_needs(lhs, "MutPlace");

  const suggest_deref_binop = (err: Diag, rhs_ty: Ty): void => {
    const lhs_deref_ty = this.deref_once_mutably_for_diagnostic(lhs_ty);
    if (lhs_deref_ty !== undefined) {
      // Can only assign if the type is sized, so if `DerefMut` yields a type that is
      // unsized, do not suggest dereferencing it.
      const lhs_deref_ty_is_sized = EvaluationResult.may_apply(this.infcx.type_implements_trait(this.tcx.require_lang_item("Sized", span), [lhs_deref_ty], this.param_env));
      if (lhs_deref_ty_is_sized && this.may_coerce(rhs_ty, lhs_deref_ty)) {
        err.span_suggestion_verbose(Span.shrink_to_lo(lhs.span), "consider dereferencing here to assign to the mutably borrowed value", "*", "MachineApplicable");
      }
    }
  };

  // This is (basically) inlined `check_expr_coercible_to_type`, but we want
  // to suggest an additional fixup here in `suggest_deref_binop`.
  const rhs_ty = this.check_expr_with_hint(rhs, lhs_ty);
  const r = this.demand_coerce_diag(rhs, rhs_ty, lhs_ty, lhs, "No");
  if (r.$ === "Err") {
    const diag = r._0;
    suggest_deref_binop(diag, rhs_ty);
    diag.emit();
  }

  this.check_lhs_assignable(lhs, E0070, span, (err) => {
    const rhs_ty = this.typeck_results.expr_ty_opt(rhs);
    if (rhs_ty !== undefined) {
      suggest_deref_binop(err, rhs_ty);
    }
  });

  this.require_type_is_sized(lhs_ty, lhs.span, { $: "AssignmentLhsSized" });

  const er = TypeVisitableExt.error_reported<[Ty, Ty]>([lhs_ty, rhs_ty], d_Ty_Ty_visitable);
  if (er.$ === "Err") {
    return Ty.new_error(this.tcx, er._0);
  } else {
    return this.tcx.types.unit;
  }
};

/// The expected type is `bool` but this will result in `()` so we can reasonably
/// say that the user intended to write `lhs == rhs` instead of `lhs = rhs`.
/// The likely cause of this is `if foo = bar { .. }`.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1331 expr_assign_expected_bool_error
FnCtxt.prototype.expr_assign_expected_bool_error = function (this: FnCtxt, expr: hir.Expr, lhs: hir.Expr, rhs: hir.Expr, span: Span): ErrorGuaranteed {
  const actual_ty = this.tcx.types.unit;
  const expected_ty = this.tcx.types.bool;
  const sr = this.demand_suptype_diag(expr.span, expected_ty, actual_ty);
  if (sr.$ === "Ok") return panic("called `Result::unwrap_err()` on an `Ok` value: ()");
  const err = sr._0;
  const lhs_ty = this.check_expr(lhs);
  const rhs_ty = this.check_expr(rhs);
  const refs_can_coerce = (lhs: Ty, rhs: Ty): boolean => {
    const lhs_ = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, lhs.peel_refs());
    const rhs_ = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, rhs.peel_refs());
    return this.may_coerce(rhs_, lhs_);
  };
  // Never-to-any coercions do not imply that the operands can be compared, e.g. `String == !`.
  let applicability: "MachineApplicable" | "MaybeIncorrect";
  let eq: boolean;
  const lk = lhs.kind;
  const rk = rhs.kind;
  if (this.may_coerce_except_never(rhs_ty, lhs_ty)) {
    [applicability, eq] = ["MachineApplicable", true];
  } else if (refs_can_coerce(rhs_ty, lhs_ty)) {
    // The lhs and rhs are likely missing some references in either side. Subsequent
    // suggestions will show up.
    [applicability, eq] = ["MaybeIncorrect", true];
  } else if (lk.$ === "Binary" && (lk._0.node === "And" || lk._0.node === "Or")) {
    const rhs_expr = lk._2;
    // if x == 1 && y == 2 { .. }
    //                 +
    const actual_lhs = this.check_expr(rhs_expr);
    const may_eq = this.may_coerce_except_never(rhs_ty, actual_lhs) || refs_can_coerce(rhs_ty, actual_lhs);
    [applicability, eq] = ["MaybeIncorrect", may_eq];
  } else if (rk.$ === "Binary" && (rk._0.node === "And" || rk._0.node === "Or")) {
    const lhs_expr = rk._1;
    // if x == 1 && y == 2 { .. }
    //       +
    const actual_rhs = this.check_expr(lhs_expr);
    const may_eq = this.may_coerce_except_never(actual_rhs, lhs_ty) || refs_can_coerce(actual_rhs, lhs_ty);
    [applicability, eq] = ["MaybeIncorrect", may_eq];
  } else {
    [applicability, eq] = ["MaybeIncorrect", false];
  }

  if (!lhs.is_syntactic_place_expr() && lhs.is_approximately_pattern() && !(lhs.kind.$ === "Lit")) {
    // Do not suggest `if let x = y` as `==` is way more likely to be the intention.
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "If") {
      err.span_suggestion_verbose(Span.shrink_to_lo(expr.span), "you might have meant to use pattern matching", "let ", applicability);
    }
  }
  if (eq) {
    err.span_suggestion_verbose(Span.shrink_to_hi(span), "you might have meant to compare for equality", "=", applicability);
  }

  // If the assignment expression itself is ill-formed, don't
  // bother emitting another error
  return err.emit_err_unless_delay(TypeVisitableExt.references_error(lhs_ty, fold_Ty) || TypeVisitableExt.references_error(rhs_ty, fold_Ty));
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1413 check_expr_let
FnCtxt.prototype.check_expr_let = function (this: FnCtxt, let_expr: hir.LetExpr, hir_id: HirId): Ty {
  GatherLocalsVisitor.gather_from_let_expr(this, let_expr, hir_id);

  // for let statements, this is done in check_stmt
  const init = let_expr.init;
  this.warn_if_unreachable(init.hir_id, init.span, "block in `let` expression");

  // otherwise check exactly as a let statement
  this.check_decl(Declaration_from_LetExpr([let_expr, hir_id]));

  // but return a bool, for this is a boolean expression
  if (let_expr.recovered.$ === "Yes") {
    const error_guaranteed = let_expr.recovered._0;
    this.set_tainted_by_errors(error_guaranteed);
    return Ty.new_error(this.tcx, error_guaranteed);
  } else {
    return this.tcx.types.bool;
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1436 check_expr_loop
FnCtxt.prototype.check_expr_loop = function (this: FnCtxt, body: hir.Block, source: hir.LoopSource, expected: ExpectationT, expr: hir.Expr): Ty {
  let coerce: CoerceMany | undefined;
  switch (source) {
    // you can only use break with a value from a normal `loop { }`
    case "Loop": {
      const coerce_to = Expectation.coercion_target_type(expected, this, body.span);
      coerce = CoerceMany.new(coerce_to);
      break;
    }

    case "While":
    case "ForLoop":
      coerce = undefined;
      break;
  }

  const ctxt_: BreakableCtxt = {
    coerce,
    may_break: false, // Will get updated if/when we find a `break`.
  };

  const [ctxt] = this.with_breakable_ctxt(expr.hir_id, ctxt_, () => {
    this.check_block_no_value(body);
  });

  if (ctxt.may_break) {
    // No way to know whether it's diverging because
    // of a `break` or an outer `break` or `return`.
    this.diverges = Diverges.Maybe;
  } else {
    this.diverges = Diverges.bitor(this.diverges, Diverges.always(expr.span));
  }

  // If we permit break with a value, then result type is
  // the LUB of the breaks (possibly ! if none); else, it
  // is nil. This makes sense because infinite loops
  // (which would have type !) are only possible iff we
  // permit break with a value.
  if (ctxt.coerce === undefined && !ctxt.may_break) {
    this.dcx().span_bug(body.span, "no coercion, but loop may not break");
  }
  return ctxt.coerce !== undefined ? ctxt.coerce.complete(this) : this.tcx.types.unit;
};

/// Checks a method call.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1482 check_expr_method_call
FnCtxt.prototype.check_expr_method_call = function (this: FnCtxt, expr: hir.Expr, segment: hir.PathSegment, rcvr: hir.Expr, args: readonly hir.Expr[], expected: ExpectationT): Ty {
  const rcvr_t_ = this.check_expr(rcvr);
  const rcvr_t = this.deeply_resolve_ignoring_regions_with_obligations(rcvr_t_, fold_Ty);

  const r = this.lookup_method(rcvr_t, segment, segment.ident.span, expr, rcvr, args);
  if (r.$ === "Ok") {
    const method = r._0;
    this.write_method_call_and_enforce_effects(expr.hir_id, expr.span, method);

    // Handle splatted method arguments
    // self is already handled as `rcvr`, so it's never splatted here
    const method_inputs = FnSig.inputs(method.sig).slice(1);
    const method_tuple_args_flag = TupleArgumentsFlag.with_fn_sig_kind(method.sig.fn_sig_kind, true);

    this.check_argument_types(
      segment.ident.span,
      expr,
      method_inputs,
      FnSig.output(method.sig),
      expected,
      args,
      FnSig.c_variadic(method.sig),
      method_tuple_args_flag,
      { $: "FnDef", _0: method.def_id },
      method.args,
    );

    this.check_call_abi(FnSig.abi(method.sig), expr.span);

    return FnSig.output(method.sig);
  } else {
    const error = r._0;
    const guar = this.report_method_error(expr.hir_id, rcvr_t, error, expected, false);

    const err_inputs = this.err_args(args.length, guar);
    const err_ty = Ty.new_error(this.tcx, guar);

    this.check_argument_types(segment.ident.span, expr, err_inputs, err_ty, Expectation.NoExpectation, args, false, TupleArgumentsFlag.DontTupleArguments, { $: "Error", _0: guar }, RawList.empty<GenericArg>());

    return err_ty;
  }
};

/// Checks use `x.use`.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:1545 check_expr_use
FnCtxt.prototype.check_expr_use = function (this: FnCtxt, used_expr: hir.Expr, expected: ExpectationT): Ty {
  return this.check_expr_with_expectation(used_expr, expected);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1553 check_expr_cast
FnCtxt.prototype.check_expr_cast = function (this: FnCtxt, e: hir.Expr, t: hir.Ty, expr: hir.Expr): Ty {
  // Find the type of `e`. Supply hints based on the type we are casting to,
  // if appropriate.
  const t_cast_ = this.lower_ty_saving_user_provided_ty(t);
  const t_cast = this.deeply_resolve_ignoring_regions(t_cast_, fold_Ty);
  const t_expr_ = this.check_expr_with_expectation(e, { $: "ExpectCastableToType", _0: t_cast });
  const t_expr = this.deeply_resolve_ignoring_regions(t_expr_, fold_Ty);

  // Eagerly check for some obvious errors.
  const er = TypeVisitableExt.error_reported<[Ty, Ty]>([t_expr, t_cast], d_Ty_Ty_visitable);
  if (er.$ === "Err") {
    return Ty.new_error(this.tcx, er._0);
  } else {
    // Defer other checks until we're done type checking.
    const deferred_cast_checks = this.deferred_cast_checks;
    const r = CastCheck.new(this, e, t_expr, t_cast, t.span, expr.span);
    if (r.$ === "Ok") {
      const cast_check = r._0;
      // debug!(
      //     "check_expr_cast: deferring cast from {:?} to {:?}: {:?}",
      //     t_cast, t_expr, cast_check,
      // );
      deferred_cast_checks.push(cast_check);
      return t_cast;
    } else {
      return Ty.new_error(this.tcx, r._0);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1586 check_expr_unsafe_binder_cast
FnCtxt.prototype.check_expr_unsafe_binder_cast = function (this: FnCtxt, span: Span, kind: ast.UnsafeBinderCastKind, inner_expr: hir.Expr, hir_ty: hir.Ty | undefined, expected: ExpectationT): Ty {
  switch (kind) {
    case "Wrap": {
      const ascribed_ty = hir_ty === undefined ? undefined : this.lower_ty_saving_user_provided_ty(hir_ty);
      const expected_ty = Expectation.only_has_type(expected, this);
      let binder_ty_: Ty;
      if (ascribed_ty !== undefined && expected_ty !== undefined) {
        this.demand_eqtype(inner_expr.span, expected_ty, ascribed_ty);
        binder_ty_ = expected_ty;
      } else if (ascribed_ty !== undefined) {
        binder_ty_ = ascribed_ty;
      } else if (expected_ty !== undefined) {
        binder_ty_ = expected_ty;
      } else {
        // This will always cause a structural resolve error, but we do it
        // so we don't need to manually report an E0282 both on this codepath
        // and in the others; it all happens in `structurally_resolve_type`.
        binder_ty_ = this.next_ty_var(inner_expr.span);
      }

      const binder_ty = this.structurally_resolve_type(inner_expr.span, binder_ty_);
      const bk = binder_ty.kind();
      let hint_ty: Ty;
      if (bk.$ === "UnsafeBinder") {
        hint_ty = this.instantiate_binder_with_fresh_vars(inner_expr.span, { $: "HigherRankedType" }, UnsafeBinderInner.into_Binder(bk._0), fold_Ty);
      } else if (bk.$ === "Error") {
        hint_ty = Ty.new_error(this.tcx, bk._0);
      } else {
        const guar = this.dcx()
          .struct_span_err(hir_ty === undefined ? span : hir_ty.span, `\`wrap_binder!()\` can only wrap into unsafe binder, not ${binder_ty.sort_string(this.tcx)}`)
          .with_note("unsafe binders are the only valid output of wrap")
          .emit_err();
        hint_ty = Ty.new_error(this.tcx, guar);
      }

      this.check_expr_has_type_or_error(inner_expr, hint_ty, (_) => {});

      return binder_ty;
    }
    case "Unwrap": {
      const ascribed_ty = hir_ty === undefined ? undefined : this.lower_ty_saving_user_provided_ty(hir_ty);
      const hint_ty = ascribed_ty ?? this.next_ty_var(inner_expr.span);
      // FIXME(unsafe_binders): coerce here if needed?
      const binder_ty_ = this.check_expr_has_type_or_error(inner_expr, hint_ty, (_) => {});

      // Unwrap the binder. This will be ambiguous if it's an infer var, and will error
      // if it's not an unsafe binder.
      const binder_ty = this.structurally_resolve_type(inner_expr.span, binder_ty_);
      const bk = binder_ty.kind();
      if (bk.$ === "UnsafeBinder") {
        return this.instantiate_binder_with_fresh_vars(inner_expr.span, { $: "HigherRankedType" }, UnsafeBinderInner.into_Binder(bk._0), fold_Ty);
      } else if (bk.$ === "Error") {
        return Ty.new_error(this.tcx, bk._0);
      } else {
        const guar = this.dcx()
          .struct_span_err(hir_ty === undefined ? inner_expr.span : hir_ty.span, `expected unsafe binder, found ${binder_ty.sort_string(this.tcx)} as input of \`unwrap_binder!()\``)
          .with_note("only an unsafe binder type can be unwrapped")
          .emit_err();
        return Ty.new_error(this.tcx, guar);
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1676 check_expr_array
FnCtxt.prototype.check_expr_array = function (this: FnCtxt, args: readonly hir.Expr[], expected: ExpectationT, expr: hir.Expr): Ty {
  let element_ty: Ty;
  if (args.length !== 0) {
    const uty = Expectation.to_option(expected, this);
    let coerce_to_: Ty | undefined;
    if (uty !== undefined) {
      const t = this.deeply_resolve_ignoring_regions_with_obligations(uty, fold_Ty).builtin_index();
      // Avoid using the original type variable as the coerce_to type, as it may resolve
      // during the first coercion instead of being the LUB type.
      coerce_to_ = t !== undefined && !this.deeply_resolve_ignoring_regions_with_obligations(t, fold_Ty).is_ty_var() ? t : undefined;
    }
    const coerce_to = coerce_to_ ?? this.next_ty_var(expr.span);
    const coerce = CoerceMany.with_capacity(coerce_to, args.length);

    for (const e of args) {
      // FIXME: the element expectation should use
      // `try_structurally_resolve_and_adjust_for_branches` just like in `if` and `match`.
      // While that fixes nested coercion, it will break [some
      // code like this](https://github.com/rust-lang/rust/pull/140283#issuecomment-2958776528).
      // If we find a way to support recursive tuple coercion, this break can be avoided.
      const e_ty = this.check_expr_with_hint(e, coerce_to);
      const cause = this.misc(e.span);
      coerce.coerce(this, cause, e, e_ty);
    }
    element_ty = coerce.complete(this);
  } else {
    element_ty = this.next_ty_var(expr.span);
  }
  const array_len = args.length;
  return Ty.new_array(this.tcx, element_ty, array_len);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1715 check_expr_const_block
FnCtxt.prototype.check_expr_const_block = function (this: FnCtxt, block: hir.ConstBlock, expected: ExpectationT): Ty {
  const body = this.tcx.hir_body(block.body);

  // Create a new function context.
  const def_id = block.def_id;
  const fcx = FnCtxt.new(this.root_ctxt, this.param_env, def_id);

  const ty = fcx.check_expr_with_expectation(body.value, expected);
  fcx.require_type_is_sized(ty, body.value.span, { $: "SizedConstOrStatic" });
  fcx.write_ty(block.hir_id, ty);
  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1732 check_expr_repeat
FnCtxt.prototype.check_expr_repeat = function (this: FnCtxt, element: hir.Expr, count_: hir.ConstArg, expected: ExpectationT, expr: hir.Expr): Ty {
  const tcx = this.tcx;
  const count_span = count_.span;
  const count: Const = this.try_structurally_resolve_const(count_span, this.normalize(count_span, Unnormalized.new_wip(this.lower_const_arg(count_, tcx.types.usize)), fold_Const));

  const uty = expected.$ === "ExpectHasType" ? expected._0.builtin_index() : undefined;

  let element_ty: Ty;
  let t: Ty;
  if (uty !== undefined) {
    this.check_expr_coercible_to_type(element, uty, undefined);
    [element_ty, t] = [uty, uty];
  } else {
    const ty = this.next_ty_var(element.span);
    const element_ty_ = this.check_expr_has_type_or_error(element, ty, (_) => {});
    [element_ty, t] = [element_ty_, ty];
  }

  const er = TypeVisitableExt.error_reported(element_ty, fold_Ty);
  if (er.$ === "Err") {
    return Ty.new_error(tcx, er._0);
  }

  // We defer checking whether the element type is `Copy` as it is possible to have
  // an inference variable as a repeat count and it seems unlikely that `Copy` would
  // have inference side effects required for type checking to succeed.
  this.deferred_repeat_expr_checks.push([element, element_ty, count]);

  const ty = Ty.new_array_with_const_len(tcx, t, count);
  this.register_wf_obligation(ty, expr.span, { $: "WellFormed", _0: { $: "HirId", _0: expr.hir_id } });
  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1784 check_expr_tuple
FnCtxt.prototype.check_expr_tuple = function (this: FnCtxt, elements: readonly hir.Expr[], expected: ExpectationT, expr: hir.Expr): Ty {
  const only = Expectation.only_has_type(expected, this);
  const fields = only === undefined ? undefined : this.deeply_resolve_ignoring_regions_with_obligations(only, fold_Ty).opt_tuple_fields();
  const expectations = (fields ?? [])[globalThis.Symbol.iterator]();

  const elements_ = elements.map((e) => {
    const n = expectations.next();
    const ty = n.done === true ? this.next_ty_var(e.span) : n.value;
    this.check_expr_coercible_to_type(e, ty, undefined);
    return ty;
  });

  const tuple = Ty.new_tup_from_iter(this.tcx, elements_);

  const er = TypeVisitableExt.error_reported(tuple, fold_Ty);
  if (er.$ === "Err") {
    return Ty.new_error(this.tcx, er._0);
  } else {
    this.require_type_is_sized(tuple, expr.span, { $: "TupleInitializerSized" });
    return tuple;
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1818 check_expr_struct
FnCtxt.prototype.check_expr_struct = function (this: FnCtxt, expr: hir.Expr, expected: ExpectationT, qpath: hir.QPath, fields: readonly hir.ExprField[], base_expr: hir.StructTailExpr): Ty {
  // Find the relevant variant
  const r = this.check_struct_path(qpath, expr.hir_id);
  if (r.$ === "Err") {
    const guar = r._0;
    this.check_struct_fields_on_error(fields, base_expr);
    return Ty.new_error(this.tcx, guar);
  }
  const [variant, adt_ty] = r._0;

  // Prohibit struct expressions when non-exhaustive flag is set.
  const adt = unwrap(adt_ty.ty_adt_def(), "`check_struct_path` returned non-ADT type");
  if (variant.field_list_has_applicable_non_exhaustive()) {
    this.dcx().emit_err(StructExprNonExhaustive_diagnostic({ span: expr.span, what: adt.variant_descr() }));
  }

  this.check_expr_struct_fields(adt_ty, expected, expr, hir.QPath.span(qpath), variant, fields, base_expr);

  this.require_type_is_sized(adt_ty, expr.span, { $: "StructInitializerSized" });
  return adt_ty;
};

// ==== lane typeck-expr-b: expr.rs:1855..3957 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::expr::FnCtxt", ["check_expr_struct_fields", "check_struct_fields_on_error", "report_missing_fields", "suggest_fru_from_range_and_emit", "report_private_fields", "report_unknown_field", "available_field_names", "name_series_display", "find_adt_field", "check_expr_field", "suggest_await_on_field_access", "ban_nonexisting_field", "ban_private_field_access", "ban_take_value_of_method", "point_at_param_definition", "maybe_suggest_array_indexing", "suggest_first_deref_field", "no_such_field_err", "private_field_err", "get_field_candidates_considering_privacy_for_diag", "check_for_nested_field_satisfying_condition_for_diag", "check_expr_index", "find_and_report_unsatisfied_index_impl", "point_at_index", "check_expr_yield", "check_expr_asm_operand", "check_expr_asm", "check_expr_offset_of"]);
