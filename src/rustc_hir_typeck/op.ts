// Port of compiler/rustc_hir_typeck/src/op.rs (lane typeck-expr-a).
//
//! Code related to processing overloaded binary and unary operators.
//
// - The `FnCtxt` methods are declared in ../decls.ts (`// op.rs:<line>`) and assigned onto its prototype here.
// - `enum BinOpCategory` / `enum Op` are generated (op.gen.ts). Their impls live on the companion consts (PORTING §8):
//   `impl From<BinOpKind> for BinOpCategory` / `impl From<AssignOpKind> for BinOpCategory` are
//   `BinOpCategory.from_BinOpKind(op)` / `BinOpCategory.from_AssignOpKind(op)` (`BinOpCategory::from(op.node)`);
//   `impl Op { span, as_str, is_by_value }` are `Op.span(op)`, ... . `#[derive(PartialEq)]` on `Op` is unused.
// - `ThinVec<FulfillmentError>` is `FulfillmentError[]`.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import type * as ast from "../rustc_ast/lib.ts";
import { AssignOpKind, BinOpKind, UnOp } from "../rustc_ast/lib.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import { type Diag, E0067, E0368, E0369, E0600, struct_span_code_err } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import { ObligationCause, type ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import { clone_ObligationCause } from "../rustc_middle/traits/mod.gen.ts";
import { AutoBorrowMutability, type Adjustment } from "../rustc_middle/ty/adjustment.ts";
import { AssocItem, type AssocItem as AssocItemT } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { IsSuggestable } from "../rustc_middle/ty/diagnostics.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { print_Ty } from "../rustc_middle/ty/print/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DefId_eq } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { display_Ident, type Symbol, sym } from "../rustc_span/symbol.ts";
import { FnSig } from "../rustc_type_ir/ty_kind.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import type { Expectation } from "./expectation.gen.ts";
import type { MethodCallee } from "./method/mod.gen.ts";
import * as gen from "./op.gen.ts";
import type { BinOpCategory as BinOpCategoryT, Op as OpT } from "./op.gen.ts";

// Read inside function bodies only (Init order).
import { maybe_emit_plus_equals_diagnostic, ExprParenthesesNeeded_surrounding } from "./diagnostics.ts";
import { ExprParenthesesNeeded_subdiagnostic } from "./diagnostics.gen.ts";
import { Expectation as ExpectationC } from "./expectation.ts";

export * from "./op.gen.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

/// Checks a `a <op>= b`
// rustc: compiler/rustc_hir_typeck/src/op.rs:29 check_expr_assign_op
FnCtxt.prototype.check_expr_assign_op = function (this: FnCtxt, expr: hir.Expr, op: ast.AssignOp, lhs: hir.Expr, rhs: hir.Expr, expected: Expectation): Ty {
  const [lhs_ty, rhs_ty, _return_ty] = this.check_overloaded_binop(expr, lhs, rhs, { $: "AssignOp", _0: op }, expected);

  const category = BinOpCategory.from_AssignOpKind(op.node);
  if (!lhs_ty.is_ty_var() && !rhs_ty.is_ty_var() && is_builtin_binop(lhs_ty, rhs_ty, category)) {
    this.enforce_builtin_binop_types(lhs.span, lhs_ty, rhs.span, rhs_ty, category);
  }

  this.check_lhs_assignable(lhs, E0067, op.span, (err) => {
    const lhs_deref_ty = this.deref_once_mutably_for_diagnostic(lhs_ty);
    if (lhs_deref_ty !== undefined) {
      if (this.lookup_op_method([lhs, lhs_deref_ty], [rhs, rhs_ty], lang_item_for_binop(this.tcx, { $: "AssignOp", _0: op }), op.span, expected).$ === "Ok") {
        // If LHS += RHS is an error, but *LHS += RHS is successful, then we will have
        // emitted a better suggestion during error handling in check_overloaded_binop.
        if (this.lookup_op_method([lhs, lhs_ty], [rhs, rhs_ty], lang_item_for_binop(this.tcx, { $: "AssignOp", _0: op }), op.span, expected).$ === "Err") {
          err.downgrade_to_delayed_bug();
        } else {
          // Otherwise, it's valid to suggest dereferencing the LHS here.
          err.span_suggestion_verbose(Span.shrink_to_lo(lhs.span), "consider dereferencing the left-hand side of this operation", "*", "MaybeIncorrect");
        }
      }
    }
  });

  return this.tcx.types.unit;
};

/// Checks a potentially overloaded binary operator.
// rustc: compiler/rustc_hir_typeck/src/op.rs:88 check_expr_binop
FnCtxt.prototype.check_expr_binop = function (this: FnCtxt, expr: hir.Expr, op: ast.BinOp, lhs_expr: hir.Expr, rhs_expr: hir.Expr, expected: Expectation): Ty {
  const tcx = this.tcx;

  // debug!(
  //     "check_binop(expr.hir_id={}, expr={:?}, op={:?}, lhs_expr={:?}, rhs_expr={:?})",
  //     expr.hir_id, expr, op, lhs_expr, rhs_expr
  // );

  switch (BinOpCategory.from_BinOpKind(op.node)) {
    case "Shortcircuit": {
      // && and || are a simple case.
      this.check_expr_coercible_to_type(lhs_expr, tcx.types.bool, undefined);
      const lhs_diverges = this.diverges;
      this.check_expr_coercible_to_type(rhs_expr, tcx.types.bool, undefined);

      // Depending on the LHS' value, the RHS can never execute.
      this.diverges = lhs_diverges;

      return tcx.types.bool;
    }
    default: {
      // Otherwise, we always treat operators as if they are
      // overloaded. This is the way to be most flexible w/r/t
      // types that get inferred.
      const [lhs_ty, rhs_ty, return_ty] = this.check_overloaded_binop(expr, lhs_expr, rhs_expr, { $: "BinOp", _0: op }, expected);

      // Supply type inference hints if relevant. Probably these
      // hints should be enforced during select as part of the
      // `consider_unification_despite_ambiguity` routine, but this
      // more convenient for now.
      //
      // The basic idea is to help type inference by taking
      // advantage of things we know about how the impls for
      // scalar types are arranged. This is important in a
      // scenario like `1_u32 << 2`, because it lets us quickly
      // deduce that the result type should be `u32`, even
      // though we don't know yet what type 2 has and hence
      // can't pin this down to a specific impl.
      const category = BinOpCategory.from_BinOpKind(op.node);
      if (!lhs_ty.is_ty_var() && !rhs_ty.is_ty_var() && is_builtin_binop(lhs_ty, rhs_ty, category)) {
        const builtin_return_ty = this.enforce_builtin_binop_types(lhs_expr.span, lhs_ty, rhs_expr.span, rhs_ty, category);
        this.demand_eqtype(expr.span, builtin_return_ty, return_ty);
        return builtin_return_ty;
      } else {
        return return_ty;
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:155 enforce_builtin_binop_types
FnCtxt.prototype.enforce_builtin_binop_types = function (this: FnCtxt, lhs_span: Span, lhs_ty_: Ty, rhs_span: Span, rhs_ty_: Ty, category: BinOpCategoryT): Ty {
  // debug_assert!(is_builtin_binop(lhs_ty, rhs_ty, category));

  // Special-case a single layer of referencing, so that things like `5.0 + &6.0f32` work.
  // (See https://github.com/rust-lang/rust/issues/57447.)
  const [lhs_ty, rhs_ty] = [deref_ty_if_possible(lhs_ty_), deref_ty_if_possible(rhs_ty_)];

  const tcx = this.tcx;
  switch (category) {
    case "Shortcircuit":
      this.demand_suptype(lhs_span, tcx.types.bool, lhs_ty);
      this.demand_suptype(rhs_span, tcx.types.bool, rhs_ty);
      return tcx.types.bool;

    // result type is same as LHS always
    case "Shift":
      return lhs_ty;

    case "Math":
    case "Bitwise":
      // both LHS and RHS and result will have the same type
      this.demand_suptype(rhs_span, lhs_ty, rhs_ty);
      return lhs_ty;

    case "Comparison":
      // both LHS and RHS and result will have the same type
      this.demand_suptype(rhs_span, lhs_ty, rhs_ty);
      return tcx.types.bool;
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:194 check_overloaded_binop
FnCtxt.prototype.check_overloaded_binop = function (this: FnCtxt, expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation): [Ty, Ty, Ty] {
  // debug!("check_overloaded_binop(expr.hir_id={}, op={:?})", expr.hir_id, op);

  let lhs_ty_: Ty;
  switch (op.$) {
    case "BinOp": {
      // Find a suitable supertype of the LHS expression's type, by coercing to
      // a type variable, to pass as the `Self` to the trait, avoiding invariant
      // trait matching creating lifetime constraints that are too strict.
      // e.g., adding `&'a T` and `&'b T`, given `&'x T: Add<&'x T>`, will result
      // in `&'a T <: &'x T` and `&'b T <: &'x T`, instead of `'a = 'b = 'x`.
      const lhs_ty = this.check_expr(lhs_expr);
      const fresh_var = this.next_ty_var(lhs_expr.span);
      lhs_ty_ = this.demand_coerce(lhs_expr, lhs_ty, fresh_var, rhs_expr, "No");
      break;
    }
    case "AssignOp":
      // rust-lang/rust#52126: We have to use strict
      // equivalence on the LHS of an assign-op like `+=`;
      // overwritten or mutably-borrowed places cannot be
      // coerced to a supertype.
      lhs_ty_ = this.check_expr(lhs_expr);
      break;
  }
  const lhs_ty = this.deeply_resolve_ignoring_regions_with_obligations(lhs_ty_, fold_Ty);

  // N.B., as we have not yet type-checked the RHS, we don't have the
  // type at hand. Make a variable to represent it. The whole reason
  // for this indirection is so that, below, we can check the expr
  // using this variable as the expected type, which sometimes lets
  // us do better coercions than we would be able to do otherwise,
  // particularly for things like `String + &String`.
  const rhs_ty_var = this.next_ty_var(rhs_expr.span);
  const result = this.lookup_op_method([lhs_expr, lhs_ty], [rhs_expr, rhs_ty_var], lang_item_for_binop(this.tcx, op), Op.span(op), expected);

  // see `NB` above
  const rhs_ty_ = this.check_expr_coercible_to_type_or_error(rhs_expr, rhs_ty_var, lhs_expr, (err, ty) => {
    this.err_ctxt().note_field_shadowed_by_private_candidate(err, rhs_expr.hir_id, this.param_env);
    if (op.$ === "BinOp" && op._0.node === "Eq") {
      this.suggest_swapping_lhs_and_rhs(err, ty, lhs_ty, rhs_expr, lhs_expr);
    }
  });
  const rhs_ty = this.deeply_resolve_ignoring_regions_with_obligations(rhs_ty_, fold_Ty);

  const return_ty = this.overloaded_binop_ret_ty(expr, lhs_expr, rhs_expr, op, expected, lhs_ty, result, rhs_ty);

  return [lhs_ty, rhs_ty, return_ty];
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:267 overloaded_binop_ret_ty
FnCtxt.prototype.overloaded_binop_ret_ty = function (this: FnCtxt, expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation, lhs_ty: Ty, result: Result<MethodCallee, FulfillmentError[]>, rhs_ty: Ty): Ty {
  if (result.$ === "Ok") {
    const method = result._0;
    const by_ref_binop = !Op.is_by_value(op);

    if (op.$ === "AssignOp" || by_ref_binop) {
      const inputs = FnSig.inputs(method.sig);
      const k0 = inputs[0]!.kind();
      if (k0.$ === "Ref") {
        const mutbl = AutoBorrowMutability.new(k0._2, "Yes");
        const autoref: Adjustment = {
          kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } },
          target: inputs[0]!,
        };
        this.apply_adjustments(lhs_expr, [autoref]);
      }

      if (by_ref_binop) {
        const k1 = inputs[1]!.kind();
        if (k1.$ === "Ref") {
          // Allow two-phase borrows for binops in initial deployment
          // since they desugar to methods
          const mutbl = AutoBorrowMutability.new(k1._2, "Yes");
          const autoref: Adjustment = {
            kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } },
            target: inputs[1]!,
          };
          // HACK(eddyb) Bypass checks due to reborrows being in
          // some cases applied on the RHS, on top of which we need
          // to autoref, which is not allowed by apply_adjustments.
          // self.apply_adjustments(rhs_expr, vec![autoref]);
          this.typeck_results
            .adjustments_mut()
            .entry(rhs_expr.hir_id)
            .or_default(() => [])
            .value.push(autoref);
        }
      }
    }

    this.write_method_call_and_enforce_effects(expr.hir_id, expr.span, method);

    return FnSig.output(method.sig);
  }
  // error types are considered "builtin"
  if (TypeVisitableExt.references_error(lhs_ty, fold_Ty) || TypeVisitableExt.references_error(rhs_ty, fold_Ty)) {
    return Ty.new_misc_error(this.tcx);
  }
  const errors = result._0;
  return this.report_binop_fulfillment_errors(expr, lhs_expr, rhs_expr, op, expected, lhs_ty, rhs_ty, errors);
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:329 report_binop_fulfillment_errors
FnCtxt.prototype.report_binop_fulfillment_errors = function (this: FnCtxt, expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation, lhs_ty: Ty, rhs_ty: Ty, errors: FulfillmentError[]): Ty {
  const [, trait_def_id] = lang_item_for_binop(this.tcx, op);

  const path: MutRef<string | undefined> = { value: undefined };
  const lhs_ty_str = this.tcx.short_string(lhs_ty, path, print_Ty);
  const rhs_ty_str = this.tcx.short_string(rhs_ty, path, print_Ty);

  let err: Diag;
  let output_def_id: DefId | undefined;
  switch (op.$) {
    // Try and detect when `+=` was incorrectly
    // used instead of `==` in a let-chain
    case "AssignOp": {
      const assign_op = op._0;
      const r = maybe_emit_plus_equals_diagnostic(this, assign_op, lhs_expr);
      if (r.$ === "Err") {
        [err, output_def_id] = [r._0, undefined];
      } else {
        const s = AssignOpKind.as_str(assign_op.node);
        const err_ = struct_span_code_err(this.dcx(), expr.span, E0368, `binary assignment operation \`${s}\` cannot be applied to type \`${lhs_ty_str}\``);
        err_.span_label(lhs_expr.span, `cannot use \`${s}\` on type \`${lhs_ty_str}\``);
        const err_ctxt = this.err_ctxt();
        err_ctxt.note_field_shadowed_by_private_candidate(err_, lhs_expr.hir_id, this.param_env);
        err_ctxt.note_field_shadowed_by_private_candidate(err_, rhs_expr.hir_id, this.param_env);
        this.note_unmet_impls_on_type(err_, errors, false);
        [err, output_def_id] = [err_, undefined];
      }
      break;
    }
    case "BinOp": {
      const bin_op = op._0;
      let message: string;
      switch (bin_op.node) {
        case "Add":
          message = `cannot add \`${rhs_ty_str}\` to \`${lhs_ty_str}\``;
          break;
        case "Sub":
          message = `cannot subtract \`${rhs_ty_str}\` from \`${lhs_ty_str}\``;
          break;
        case "Mul":
          message = `cannot multiply \`${lhs_ty_str}\` by \`${rhs_ty_str}\``;
          break;
        case "Div":
          message = `cannot divide \`${lhs_ty_str}\` by \`${rhs_ty_str}\``;
          break;
        case "Rem":
          message = `cannot calculate the remainder of \`${lhs_ty_str}\` divided by \`${rhs_ty_str}\``;
          break;
        case "BitAnd":
        case "BitXor":
        case "BitOr":
        case "Shl":
        case "Shr":
          message = `no implementation for \`${lhs_ty_str} ${BinOpKind.as_str(bin_op.node)} ${rhs_ty_str}\``;
          break;
        default:
          message = `binary operation \`${BinOpKind.as_str(bin_op.node)}\` cannot be applied to type \`${lhs_ty_str}\``;
      }

      const output_def_id_ =
        trait_def_id === undefined
          ? undefined
          : this.tcx.associated_item_def_ids(trait_def_id).find((item_def_id) => {
              return AssocItem.name(this.tcx.associated_item(item_def_id) as AssocItemT) === sym.Output;
            });
      const err_ = struct_span_code_err(this.dcx(), bin_op.span, E0369, message);
      if (!(lhs_expr.span === rhs_expr.span)) {
        err_.span_label(lhs_expr.span, lhs_ty_str);
        err_.span_label(rhs_expr.span, rhs_ty_str);
      }
      const err_ctxt = this.err_ctxt();
      err_ctxt.note_field_shadowed_by_private_candidate(err_, lhs_expr.hir_id, this.param_env);
      err_ctxt.note_field_shadowed_by_private_candidate(err_, rhs_expr.hir_id, this.param_env);
      const suggest_derive = this.infcx.can_eq(this.param_env, lhs_ty, rhs_ty, ToTrace_Ty);
      this.note_unmet_impls_on_type(err_, errors, suggest_derive);
      [err, output_def_id] = [err_, output_def_id_];
      break;
    }
  }
  err.long_ty_path().value = path.value;

  // Try to suggest a semicolon if it's `A \n *B` where `B` is a place expr
  const maybe_missing_semi = this.check_for_missing_semi(expr, err);

  // We defer to the later error produced by `check_lhs_assignable`.
  // We only downgrade this if it's the LHS, though, and if this is a
  // valid assignment statement.
  if (maybe_missing_semi && this.is_lhs_of_assign_stmt(expr)) {
    err.downgrade_to_delayed_bug();
  }

  const is_compatible_after_call = (lhs_ty: Ty, rhs_ty: Ty): boolean => {
    const op_ok = this.lookup_op_method([lhs_expr, lhs_ty], [rhs_expr, rhs_ty], lang_item_for_binop(this.tcx, op), Op.span(op), expected).$ === "Ok";

    return op_ok || this.infcx.can_eq(this.param_env, lhs_ty, rhs_ty, ToTrace_Ty);
  };

  // We should suggest `a + b` => `*a + b` if `a` is copy, and suggest
  // `a += b` => `*a += b` if a is a mut ref.
  this.suggest_deref_or_call_for_binop_error(lhs_expr, rhs_expr, op, expected, lhs_ty, rhs_ty, err, is_compatible_after_call);

  const missing_trait = trait_def_id === undefined ? undefined : with_no_trimmed_paths(() => this.tcx.def_path_str(trait_def_id));
  if (missing_trait !== undefined) {
    if (((op.$ === "BinOp" && op._0.node === "Add") || (op.$ === "AssignOp" && op._0.node === "AddAssign")) && this.check_str_addition(lhs_expr, rhs_expr, lhs_ty, rhs_ty, err, op)) {
      // This has nothing here because it means we did string
      // concatenation (e.g., "Hello " + "World!"). This means
      // we don't want the note in the else clause to be emitted
    } else if (TypeVisitableExt.has_non_region_param(lhs_ty, fold_Ty)) {
      if (errors.length !== 0) {
        for (const error of errors) {
          const trait_pred = error.obligation.predicate.as_trait_clause();
          if (trait_pred !== undefined) {
            const code: ObligationCauseCode = error.obligation.cause.code_();
            let output_associated_item: [string, Ty] | undefined;
            if (code.$ === "BinOp" && code.output_ty !== undefined) {
              const output_ty = code.output_ty;
              if (output_def_id !== undefined && trait_def_id !== undefined && DefId_eq(this.tcx.parent(output_def_id), trait_def_id)) {
                const s = IsSuggestable.make_suggestable(output_ty, this.tcx, false, undefined, fold_Ty);
                output_associated_item = s === undefined ? undefined : ["Output", s];
              } else {
                output_associated_item = undefined;
              }
            } else {
              output_associated_item = undefined;
            }

            this.err_ctxt().suggest_restricting_param_bound(err, trait_pred, output_associated_item, this.body_def_id);
          }
        }
      } else {
        // When we know that a missing bound is responsible, we don't show
        // this note as it is redundant.
        err.note(`the trait \`${missing_trait}\` is not implemented for \`${lhs_ty_str}\``);
      }
    }
  }

  // Suggest using `add`, `offset` or `offset_from` for pointer - {integer},
  // pointer + {integer} or pointer - pointer.
  this.suggest_raw_ptr_binop_arithmetic(lhs_expr, rhs_expr, op, lhs_ty, rhs_ty, err);

  let lhs_name_str: string;
  if (lhs_expr.kind.$ === "Path" && lhs_expr.kind._0.$ === "Resolved") {
    const path = lhs_expr.kind._0._1;
    const last = path.segments[path.segments.length - 1];
    lhs_name_str = last === undefined ? "_" : display_Ident(last.ident);
  } else {
    const snippet = this.tcx.sess.source_map().span_to_snippet(lhs_expr.span);
    lhs_name_str = snippet.$ === "Ok" ? snippet._0.toString() : "_";
  }

  this.suggest_raw_ptr_assign_arithmetic(lhs_expr, rhs_expr, op, lhs_ty, rhs_ty, lhs_name_str, err);

  return Ty.new_error(this.tcx, err.emit_err());
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:563 suggest_deref_or_call_for_binop_error
FnCtxt.prototype.suggest_deref_or_call_for_binop_error = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation, lhs_ty: Ty, rhs_ty: Ty, err: Diag, is_compatible_after_call: (_1: Ty, _2: Ty) => boolean): void {
  // Suppress suggestions when lhs and rhs are not in the same span as the error
  if (!Span.can_be_used_for_suggestions(Op.span(op))) {
    return;
  }

  const lhs_deref_ty = this.deref_once_mutably_for_diagnostic(lhs_ty);
  const lk = lhs_ty.kind();
  if (lhs_deref_ty !== undefined && op.$ === "AssignOp") {
    this.suggest_deref_binop(lhs_expr, rhs_expr, op, expected, rhs_ty, err, lhs_deref_ty);
  } else if (lk.$ === "Ref" && op.$ === "BinOp") {
    const [region, lhs_deref_ty, mutbl] = [lk._0, lk._1, lk._2];
    if (this.type_is_copy_modulo_regions(this.param_env, lhs_deref_ty)) {
      this.suggest_deref_binop(lhs_expr, rhs_expr, op, expected, rhs_ty, err, lhs_deref_ty);
    } else {
      const lhs_inv_mutbl = Mutability.invert(mutbl);
      const lhs_inv_mutbl_ty = Ty.new_ref(this.tcx, region, lhs_deref_ty, lhs_inv_mutbl);

      this.suggest_different_borrow(lhs_expr, rhs_expr, op, expected, err, lhs_inv_mutbl_ty, lhs_inv_mutbl, rhs_ty, undefined);

      const rk = rhs_ty.kind();
      if (rk.$ === "Ref") {
        const [region, rhs_deref_ty, mutbl] = [rk._0, rk._1, rk._2];
        const rhs_inv_mutbl = Mutability.invert(mutbl);
        const rhs_inv_mutbl_ty = Ty.new_ref(this.tcx, region, rhs_deref_ty, rhs_inv_mutbl);

        this.suggest_different_borrow(lhs_expr, rhs_expr, op, expected, err, lhs_ty, undefined, rhs_inv_mutbl_ty, rhs_inv_mutbl);
        this.suggest_different_borrow(lhs_expr, rhs_expr, op, expected, err, lhs_inv_mutbl_ty, lhs_inv_mutbl, rhs_inv_mutbl_ty, rhs_inv_mutbl);
      }
    }
  } else {
    const suggested =
      this.suggest_fn_call(err, lhs_expr, lhs_ty, (lhs_ty) => is_compatible_after_call(lhs_ty, rhs_ty)) ||
      this.suggest_fn_call(err, rhs_expr, rhs_ty, (rhs_ty) => is_compatible_after_call(lhs_ty, rhs_ty));

    if (!suggested) {
      this.suggest_two_fn_call(err, rhs_expr, rhs_ty, lhs_expr, lhs_ty, is_compatible_after_call);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:661 suggest_raw_ptr_binop_arithmetic
FnCtxt.prototype.suggest_raw_ptr_binop_arithmetic = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, lhs_ty: Ty, rhs_ty: Ty, err: Diag): void {
  if (!Span.can_be_used_for_suggestions(Op.span(op))) {
    return;
  }

  if (op.$ === "BinOp" && op._0.node === "Add" && lhs_ty.is_raw_ptr() && rhs_ty.is_integral()) {
    err.multipart_suggestion(
      "consider using `wrapping_add` or `add` for pointer + {integer}",
      [
        [Span.between(lhs_expr.span, rhs_expr.span), ".wrapping_add("],
        [Span.shrink_to_hi(rhs_expr.span), ")"],
      ],
      "MaybeIncorrect",
    );
  } else if (op.$ === "BinOp" && op._0.node === "Sub") {
    if (lhs_ty.is_raw_ptr() && rhs_ty.is_integral()) {
      err.multipart_suggestion(
        "consider using `wrapping_sub` or `sub` for pointer - {integer}",
        [
          [Span.between(lhs_expr.span, rhs_expr.span), ".wrapping_sub("],
          [Span.shrink_to_hi(rhs_expr.span), ")"],
        ],
        "MaybeIncorrect",
      );
    }
    if (lhs_ty.is_raw_ptr() && rhs_ty.is_raw_ptr()) {
      err.multipart_suggestion(
        "consider using `offset_from` for pointer - pointer if the pointers point to the same allocation",
        [
          [Span.shrink_to_lo(lhs_expr.span), "unsafe { "],
          [Span.between(lhs_expr.span, rhs_expr.span), ".offset_from("],
          [Span.shrink_to_hi(rhs_expr.span), ") }"],
        ],
        "MaybeIncorrect",
      );
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:715 suggest_raw_ptr_assign_arithmetic
FnCtxt.prototype.suggest_raw_ptr_assign_arithmetic = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, lhs_ty: Ty, rhs_ty: Ty, lhs_name_str: string, err: Diag): void {
  if (!Span.can_be_used_for_suggestions(Op.span(op)) || !(op.$ === "AssignOp") || !lhs_ty.is_raw_ptr() || !rhs_ty.is_integral()) {
    return;
  }

  let msg: string;
  let method: string;
  if (op.$ === "AssignOp" && op._0.node === "AddAssign") {
    [msg, method] = ["consider using `add` or `wrapping_add` to do pointer arithmetic", "wrapping_add"];
  } else if (op.$ === "AssignOp" && op._0.node === "SubAssign") {
    [msg, method] = ["consider using `sub` or `wrapping_sub` to do pointer arithmetic", "wrapping_sub"];
  } else {
    return;
  }

  err.multipart_suggestion(
    msg,
    [
      [Span.shrink_to_lo(lhs_expr.span), `${lhs_name_str} = `],
      [Span.between(lhs_expr.span, rhs_expr.span), `.${method}(`],
      [Span.shrink_to_hi(rhs_expr.span), ")"],
    ],
    "MaybeIncorrect",
  );
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:754 suggest_different_borrow
FnCtxt.prototype.suggest_different_borrow = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation, err: Diag, lhs_adjusted_ty: Ty, lhs_new_mutbl: Mutability | undefined, rhs_adjusted_ty: Ty, rhs_new_mutbl: Mutability | undefined): void {
  if (this.lookup_op_method([lhs_expr, lhs_adjusted_ty], [rhs_expr, rhs_adjusted_ty], lang_item_for_binop(this.tcx, op), Op.span(op), expected).$ === "Ok") {
    const lhs = this.tcx.short_string(lhs_adjusted_ty, err.long_ty_path(), print_Ty);
    const rhs = this.tcx.short_string(rhs_adjusted_ty, err.long_ty_path(), print_Ty);
    const op_ = Op.as_str(op);
    err.note(`an implementation for \`${lhs} ${op_} ${rhs}\` exists`);

    if (lhs_new_mutbl !== undefined && lhs_new_mutbl === "Not" && rhs_new_mutbl !== undefined && rhs_new_mutbl === "Not") {
      err.multipart_suggestion(
        "consider reborrowing both sides",
        [
          [Span.shrink_to_lo(lhs_expr.span), "&*"],
          [Span.shrink_to_lo(rhs_expr.span), "&*"],
        ],
        "MachineApplicable",
      );
    } else {
      const suggest_new_borrow = (new_mutbl: Mutability, sp: Span): void => {
        // Can reborrow (&mut -> &)
        if (new_mutbl === "Not") {
          err.span_suggestion_verbose(Span.shrink_to_lo(sp), "consider reborrowing this side", "&*", "MachineApplicable");
          // Works on &mut but have &
        } else {
          err.span_help(sp, "consider making this expression a mutable borrow");
        }
      };

      if (lhs_new_mutbl !== undefined) {
        suggest_new_borrow(lhs_new_mutbl, lhs_expr.span);
      }
      if (rhs_new_mutbl !== undefined) {
        suggest_new_borrow(rhs_new_mutbl, rhs_expr.span);
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:818 is_lhs_of_assign_stmt
FnCtxt.prototype.is_lhs_of_assign_stmt = function (this: FnCtxt, expr: hir.Expr): boolean {
  const pnode = this.tcx.parent_hir_node(expr.hir_id);
  if (pnode.$ !== "Expr") return false;
  const parent = pnode._0;
  if (parent.kind.$ !== "Assign") return false;
  const lhs = parent.kind._0;
  const snode = this.tcx.parent_hir_node(parent.hir_id);
  if (snode.$ !== "Stmt") return false;
  const stmt = snode._0;
  return (stmt.kind.$ === "Expr" || stmt.kind.$ === "Semi") && HirId_eq(lhs.hir_id, expr.hir_id);
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:826 suggest_deref_binop
FnCtxt.prototype.suggest_deref_binop = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: OpT, expected: Expectation, rhs_ty: Ty, err: Diag, lhs_deref_ty: Ty): void {
  if (this.lookup_op_method([lhs_expr, lhs_deref_ty], [rhs_expr, rhs_ty], lang_item_for_binop(this.tcx, op), Op.span(op), expected).$ === "Ok") {
    const msg = `\`${Op.as_str(op)}\` can be used on \`${this.tcx.short_string(lhs_deref_ty, err.long_ty_path(), print_Ty)}\` if you dereference the left-hand side`;
    err.span_suggestion_verbose(Span.shrink_to_lo(lhs_expr.span), msg, "*", "MachineApplicable");
  }
};

/// Provide actionable suggestions when trying to add two strings with incorrect types,
/// like `&str + &str`, `String + String` and `&str + &String`.
///
/// If this function returns `true` it means a note was printed, so we don't need
/// to print the normal "implementation of `std::ops::Add` might be missing" note
// rustc: compiler/rustc_hir_typeck/src/op.rs:865 check_str_addition
FnCtxt.prototype.check_str_addition = function (this: FnCtxt, lhs_expr: hir.Expr, rhs_expr: hir.Expr, lhs_ty: Ty, rhs_ty: Ty, err: Diag, op: OpT): boolean {
  const str_concat_note = "string concatenation requires an owned `String` on the left";
  const rm_borrow_msg = "remove the borrow to obtain an owned `String`";
  const to_owned_msg = "create an owned `String` from a string reference";

  const string_type = this.tcx.lang_items().string();
  const is_std_string = (ty: Ty): boolean => {
    const def = ty.ty_adt_def();
    return def !== undefined && string_type !== undefined && DefId_eq(def.did(), string_type);
  };
  const is_str_like = (ty: Ty): boolean => ty.kind().$ === "Str" || is_std_string(ty);

  // Returns (suggestion_span, Some(replacement)) or (span, None) if lhs is a borrow to remove.
  const lhs_owned_sugg = (lhs_expr: hir.Expr): [Span, string | undefined] => {
    if (lhs_expr.kind.$ === "AddrOf") {
      const inner = lhs_expr.kind._2;
      return [Span.until(lhs_expr.span, inner.span), undefined];
    } else {
      return [Span.shrink_to_hi(lhs_expr.span), ".to_owned()"];
    }
  };

  const lk = lhs_ty.kind();
  const rhs_kind = rhs_ty.kind();
  if (lk.$ !== "Ref") {
    return false;
  }
  const l_ty = lk._1;
  if (!is_str_like(l_ty)) {
    return false;
  }

  // &str or &String + &str, &String, or &&str
  if (
    rhs_kind.$ === "Ref" &&
    (is_str_like(rhs_kind._1) ||
      (() => {
        const rk2 = rhs_kind._1.kind();
        return rk2.$ === "Ref" && rk2._1.kind().$ === "Str";
      })())
  ) {
    // Do not supply this message if `&str += &str`
    if (op.$ === "BinOp") {
      err.span_label(Op.span(op), "`+` cannot be used to concatenate two `&str` strings");
      err.note(str_concat_note);
      const [span, replacement] = lhs_owned_sugg(lhs_expr);
      const [msg, replacement_] = replacement === undefined ? [rm_borrow_msg, ""] : [to_owned_msg, replacement];
      err.span_suggestion_verbose(span, msg, replacement_, "MachineApplicable");
    }
    return true;
  } else if (rhs_kind.$ === "Adt" && is_std_string(rhs_ty)) {
    // &str or &String + String
    err.span_label(Op.span(op), "`+` cannot be used to concatenate a `&str` with a `String`");
    if (op.$ === "BinOp") {
      const [lhs_span, lhs_replacement] = lhs_owned_sugg(lhs_expr);
      const [sugg_msg, lhs_replacement_] =
        lhs_replacement === undefined
          ? ["remove the borrow on the left and add one on the right", ""]
          : ["create an owned `String` on the left and add a borrow on the right", lhs_replacement];
      err.multipart_suggestion(
        sugg_msg,
        [
          [lhs_span, lhs_replacement_],
          [Span.shrink_to_lo(rhs_expr.span), "&"],
        ],
        "MachineApplicable",
      );
    } else if (op.$ === "AssignOp") {
      err.note(str_concat_note);
    }
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:961 check_user_unop
FnCtxt.prototype.check_user_unop = function (this: FnCtxt, ex: hir.Expr, operand_ty: Ty, op: ast.UnOp, expected: Expectation): Ty {
  assert(UnOp.is_by_value(op), "assertion failed: op.is_by_value()");
  const r = this.lookup_op_method([ex, operand_ty], undefined, lang_item_for_unop(this.tcx, op), ex.span, expected);
  if (r.$ === "Ok") {
    const method = r._0;
    this.write_method_call_and_enforce_effects(ex.hir_id, ex.span, method);
    return FnSig.output(method.sig);
  } else {
    const errors = r._0;
    const actual = this.deeply_resolve_ignoring_regions(operand_ty, fold_Ty);
    const er = TypeVisitableExt.error_reported(actual, fold_Ty);
    const guar =
      er.$ === "Err"
        ? er._0
        : (() => {
            const file: MutRef<string | undefined> = { value: undefined };
            const ty_str = this.tcx.short_string(actual, file, print_Ty);
            const err = struct_span_code_err(this.dcx(), ex.span, E0600, `cannot apply unary operator \`${UnOp.as_str(op)}\` to type \`${ty_str}\``);
            err.long_ty_path().value = file.value;
            err.span_label(ex.span, `cannot apply unary operator \`${UnOp.as_str(op)}\``);

            if (TypeVisitableExt.has_non_region_param(operand_ty, fold_Ty)) {
              const predicates = errors.map((error) => error.obligation.predicate.as_trait_clause()).filter((p) => p !== undefined);
              for (const pred of predicates) {
                this.err_ctxt().suggest_restricting_param_bound(err, pred, undefined, this.body_def_id);
              }
            }

            const sp = Span.with_parent(this.tcx.sess.source_map().start_point(ex.span), undefined);
            const sp2 = this.tcx.sess.psess.complete_stmt_exprs_before_bin_op_lookalike.get(sp);
            if (sp2 !== undefined) {
              // If the previous expression was a block expression, suggest parentheses
              // (turning this into a binary subtraction operation instead.)
              // for example, `{2} - 2` -> `({2}) - 2` (see src\test\ui\parser\expr-as-stmt.rs)
              err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(sp2)));
            } else {
              const ak = actual.kind();
              if (ak.$ === "Uint" && op === "Neg") {
                err.note("unsigned values cannot be negated");

                const k = ex.kind;
                if (k.$ === "Unary" && k._1.kind.$ === "Lit" && k._1.kind._0.node.$ === "Int" && k._1.kind._0.node._0 === 1n) {
                  const pnode = this.tcx.parent_hir_node(ex.hir_id);
                  // `-1 as usize` -> `usize::MAX`
                  const span = pnode.$ === "Expr" && pnode._0.kind.$ === "Cast" ? pnode._0.span : ex.span;
                  err.span_suggestion_verbose(span, `you may have meant the maximum value of \`${display_Ty(actual)}\``, `${display_Ty(actual)}::MAX`, "MaybeIncorrect");
                }
              } else if (ak.$ === "Str" || ak.$ === "Never" || ak.$ === "Char" || ak.$ === "Tuple" || ak.$ === "Array") {
                // nothing
              } else if (ak.$ === "Ref" && ak._1.kind().$ === "Str") {
                // nothing
              } else {
                this.note_unmet_impls_on_type(err, errors, true);
              }
            }
            return err.emit_err();
          })();
    return Ty.new_error(this.tcx, guar);
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:1075 lookup_op_method
FnCtxt.prototype.lookup_op_method = function (this: FnCtxt, [lhs_expr, lhs_ty]: [hir.Expr, Ty], opt_rhs: [hir.Expr, Ty] | undefined, [opname, trait_did_]: [Symbol, DefId | undefined], span: Span, expected: Expectation): Result<MethodCallee, FulfillmentError[]> {
  if (trait_did_ === undefined) {
    // Bail if the operator trait is not defined.
    return Err<FulfillmentError[]>([]);
  }
  const trait_did = trait_did_;

  // debug!(
  //     "lookup_op_method(lhs_ty={:?}, opname={:?}, trait_did={:?})",
  //     lhs_ty, opname, trait_did
  // );

  const [opt_rhs_expr, opt_rhs_ty] = opt_rhs === undefined ? [undefined, undefined] : opt_rhs;
  const cause = this.cause(
    span,
    opt_rhs_expr !== undefined
      ? {
          $: "BinOp",
          lhs_hir_id: lhs_expr.hir_id,
          rhs_hir_id: opt_rhs_expr.hir_id,
          rhs_span: opt_rhs_expr.span,
          rhs_is_lit: opt_rhs_expr.kind.$ === "Lit",
          output_ty: ExpectationC.only_has_type(expected, this),
        }
      : { $: "UnOp", hir_id: lhs_expr.hir_id },
  );

  // We don't consider any other candidates if this lookup fails
  // so we can freely treat opaque types as inference variables here
  // to allow more code to compile.
  const treat_opaques = "AsInfer";
  const method = this.lookup_method_for_operator(clone_ObligationCause(cause), opname, trait_did, lhs_ty, opt_rhs_ty, treat_opaques);
  if (method !== undefined) {
    const ok = method;
    const method_ = this.register_infer_ok_obligations(ok);
    this.select_obligations_where_possible((_) => {});
    return Ok(method_);
  } else {
    // This path may do some inference, so make sure we've really
    // doomed compilation so as to not accidentally stabilize new
    // inference or something here...
    this.dcx().span_delayed_bug(span, "this path really should be doomed...");
    // Guide inference for the RHS expression if it's provided --
    // this will allow us to better error reporting, at the expense
    // of making some error messages a bit more specific.
    if (opt_rhs !== undefined && opt_rhs[1].is_ty_var()) {
      const [rhs_expr, rhs_ty] = opt_rhs;
      this.check_expr_coercible_to_type(rhs_expr, rhs_ty, undefined);
    }

    // Construct an obligation `self_ty : Trait<input_tys>`
    const args: GenericArgs = RawList.for_item(this.tcx, trait_did, (param, _) => {
      switch (param.kind.$) {
        case "Lifetime":
        case "Const":
          return unreachable("did not expect operand trait to have lifetime/const args");
        case "Type":
          if (param.index === 0) {
            return GenericArg.from_Ty(lhs_ty);
          } else {
            return GenericArg.from_Ty(unwrap(opt_rhs_ty, "expected RHS for binop"));
          }
      }
    });
    const obligation = Obligation.new(this.tcx, cause, this.param_env, TraitRef.new_from_args(as_interner(this.tcx), trait_did, args), (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx));
    const ocx = ObligationCtxt.new_with_diagnostics(this.infcx);
    ocx.register_obligation(obligation);
    return Err(TraitErrors.into_thin_vec(ocx.evaluate_obligations_error_on_ambiguity()));
  }
};

// rustc: compiler/rustc_hir_typeck/src/op.rs:1169 lang_item_for_binop
export function lang_item_for_binop(tcx: TyCtxt, op: OpT): [Symbol, DefId | undefined] {
  const lang = tcx.lang_items();
  if (op.$ === "AssignOp") {
    switch (op._0.node) {
      case "AddAssign":
        return [sym.add_assign, lang.add_assign_trait()];
      case "SubAssign":
        return [sym.sub_assign, lang.sub_assign_trait()];
      case "MulAssign":
        return [sym.mul_assign, lang.mul_assign_trait()];
      case "DivAssign":
        return [sym.div_assign, lang.div_assign_trait()];
      case "RemAssign":
        return [sym.rem_assign, lang.rem_assign_trait()];
      case "BitXorAssign":
        return [sym.bitxor_assign, lang.bitxor_assign_trait()];
      case "BitAndAssign":
        return [sym.bitand_assign, lang.bitand_assign_trait()];
      case "BitOrAssign":
        return [sym.bitor_assign, lang.bitor_assign_trait()];
      case "ShlAssign":
        return [sym.shl_assign, lang.shl_assign_trait()];
      case "ShrAssign":
        return [sym.shr_assign, lang.shr_assign_trait()];
    }
  } else {
    switch (op._0.node) {
      case "Add":
        return [sym.add, lang.add_trait()];
      case "Sub":
        return [sym.sub, lang.sub_trait()];
      case "Mul":
        return [sym.mul, lang.mul_trait()];
      case "Div":
        return [sym.div, lang.div_trait()];
      case "Rem":
        return [sym.rem, lang.rem_trait()];
      case "BitXor":
        return [sym.bitxor, lang.bitxor_trait()];
      case "BitAnd":
        return [sym.bitand, lang.bitand_trait()];
      case "BitOr":
        return [sym.bitor, lang.bitor_trait()];
      case "Shl":
        return [sym.shl, lang.shl_trait()];
      case "Shr":
        return [sym.shr, lang.shr_trait()];
      case "Lt":
        return [sym.lt, lang.partial_ord_trait()];
      case "Le":
        return [sym.le, lang.partial_ord_trait()];
      case "Ge":
        return [sym.ge, lang.partial_ord_trait()];
      case "Gt":
        return [sym.gt, lang.partial_ord_trait()];
      case "Eq":
        return [sym.eq, lang.eq_trait()];
      case "Ne":
        return [sym.ne, lang.eq_trait()];
      case "And":
      case "Or":
        return bug("&& and || are not overloadable");
    }
  }
}

// rustc: compiler/rustc_hir_typeck/src/op.rs:1208 lang_item_for_unop
export function lang_item_for_unop(tcx: TyCtxt, op: ast.UnOp): [Symbol, DefId | undefined] {
  const lang = tcx.lang_items();
  switch (op) {
    case "Not":
      return [sym.not, lang.not_trait()];
    case "Neg":
      return [sym.neg, lang.neg_trait()];
    case "Deref":
      return bug("Deref is not overloadable");
  }
}

/// Check if `expr` contains a `let` or `&&`, indicating presence of a let-chain
// rustc: compiler/rustc_hir_typeck/src/op.rs:1218 contains_let_in_chain
export function contains_let_in_chain(expr: hir.Expr): boolean {
  const k = expr.kind;
  switch (k.$) {
    case "Let":
      return true;
    case "Binary":
      if (k._0.node === "And") {
        const [left, right] = [k._1, k._2];
        return contains_let_in_chain(left) || contains_let_in_chain(right);
      }
      return false;
    default:
      return false;
  }
}

// Binary operator categories. These categories summarize the behavior
// with respect to the builtin operations supported.
// (`enum BinOpCategory`: op.gen.ts)
export type BinOpCategory = BinOpCategoryT;
export const BinOpCategory = {
  ...gen.BinOpCategory,

  // impl From<BinOpKind> for BinOpCategory
  // rustc: compiler/rustc_hir_typeck/src/op.rs:1253 from
  from_BinOpKind(op: ast.BinOpKind): BinOpCategoryT {
    // use hir::BinOpKind::*;
    switch (op) {
      case "Shl":
      case "Shr":
        return "Shift";
      case "Add":
      case "Sub":
      case "Mul":
      case "Div":
      case "Rem":
        return "Math";
      case "BitXor":
      case "BitAnd":
      case "BitOr":
        return "Bitwise";
      case "Eq":
      case "Ne":
      case "Lt":
      case "Le":
      case "Ge":
      case "Gt":
        return "Comparison";
      case "And":
      case "Or":
        return "Shortcircuit";
    }
  },

  // impl From<AssignOpKind> for BinOpCategory
  // rustc: compiler/rustc_hir_typeck/src/op.rs:1266 from
  from_AssignOpKind(op: ast.AssignOpKind): BinOpCategoryT {
    // use hir::AssignOpKind::*;
    switch (op) {
      case "ShlAssign":
      case "ShrAssign":
        return "Shift";
      case "AddAssign":
      case "SubAssign":
      case "MulAssign":
      case "DivAssign":
      case "RemAssign":
        return "Math";
      case "BitXorAssign":
      case "BitAndAssign":
      case "BitOrAssign":
        return "Bitwise";
    }
  },
};

/// An assignment op (e.g. `a += b`), or a binary op (e.g. `a + b`).
// (`enum Op`: op.gen.ts)
export type Op = OpT;
export const Op = {
  // impl Op {
  // rustc: compiler/rustc_hir_typeck/src/op.rs:1284 span
  span(self: OpT): Span {
    switch (self.$) {
      case "BinOp":
        return self._0.span;
      case "AssignOp":
        return self._0.span;
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/op.rs:1291 as_str
  as_str(self: OpT): string {
    switch (self.$) {
      case "BinOp":
        return BinOpKind.as_str(self._0.node);
      case "AssignOp":
        return AssignOpKind.as_str(self._0.node);
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/op.rs:1298 is_by_value
  is_by_value(self: OpT): boolean {
    switch (self.$) {
      case "BinOp":
        return BinOpKind.is_by_value(self._0.node);
      case "AssignOp":
        return AssignOpKind.is_by_value(self._0.node);
    }
  },
};

/// Dereferences a single level of immutable referencing.
// rustc: compiler/rustc_hir_typeck/src/op.rs:1307 deref_ty_if_possible
export function deref_ty_if_possible(ty: Ty): Ty {
  const k = ty.kind();
  if (k.$ === "Ref" && k._2 === "Not") {
    return k._1;
  }
  return ty;
}

/// Returns `true` if this is a built-in arithmetic operation (e.g.,
/// u32 + u32) and false if these types would have to be
/// overloaded to be legal. The reason that we distinguish
/// builtin operations from overloaded ones (vs trying to drive
/// everything uniformly through the trait system and intrinsics or
/// something like that) is that builtin operations can trivially
/// be evaluated in constants on stable, but the traits and their
/// impls for these primitive types.
///
/// FIXME(const_trait_impls): once the traits and their impls are const stable
/// remove this function and the builtin-specific checks.
// rustc: compiler/rustc_hir_typeck/src/op.rs:1325 is_builtin_binop
export function is_builtin_binop(lhs_: Ty, rhs_: Ty, category: BinOpCategoryT): boolean {
  // Special-case a single layer of referencing, so that things like `5.0 + &6.0f32` work.
  // (See https://github.com/rust-lang/rust/issues/57447.)
  const [lhs, rhs] = [deref_ty_if_possible(lhs_), deref_ty_if_possible(rhs_)];

  switch (category) {
    case "Shortcircuit":
      return true;
    case "Shift":
      return TypeVisitableExt.references_error(lhs, fold_Ty) || TypeVisitableExt.references_error(rhs, fold_Ty) || (lhs.is_integral() && rhs.is_integral());
    case "Math":
      return (
        TypeVisitableExt.references_error(lhs, fold_Ty) ||
        TypeVisitableExt.references_error(rhs, fold_Ty) ||
        (lhs.is_integral() && rhs.is_integral()) ||
        (lhs.is_floating_point() && rhs.is_floating_point())
      );
    case "Bitwise":
      return (
        TypeVisitableExt.references_error(lhs, fold_Ty) ||
        TypeVisitableExt.references_error(rhs, fold_Ty) ||
        (lhs.is_integral() && rhs.is_integral()) ||
        (lhs.is_floating_point() && rhs.is_floating_point()) ||
        (lhs.is_bool() && rhs.is_bool())
      );
    case "Comparison":
      return TypeVisitableExt.references_error(lhs, fold_Ty) || TypeVisitableExt.references_error(rhs, fold_Ty) || (lhs.is_scalar() && rhs.is_scalar());
  }
}
