// Port of compiler/rustc_hir_typeck/src/demand.rs (lane typeck-coerce: `demand_*` :171..289; lane typeck-demand-adjust
// (wave 19): the rest).
//
// Every fn of this file is declared in ../decls.ts under `// demand.rs:<line>` (methods of `FnCtxt`, assigned onto its
// prototype here in upstream order).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
//
// PORT notes (lane typeck-coerce):
// - `self.err_ctxt()` is rustc_trait_selection's `TypeErrCtxt` (errctxt-contract; its methods are placeholders until wave 19).
// - `#[instrument]` is tracing only and stays as a comment.
// PORT notes (lane typeck-demand-adjust):
// - `&mut &'tcx hir::Expr` / `&mut Option<&'tcx hir::Expr>` parameters are `MutRef` cells (PORTING §8).
// - The local visitor structs `FindExprs` (note_source_of_type_mismatch_constraint) and `FindBreaks`
//   (annotate_loop_expected_due_to_inference) are module-level classes extending intravisit's `Visitor`; the local enum
//   `CallableKind` (note_wrong_return_ty_due_to_generic_arg) is a string union.
// - `self.typeck_results.borrow()` is `this.typeck_results`.
export * from "./demand.gen.ts";
import { Applicability, listify, pluralize, type Diag } from "../rustc_errors/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { BindingMode, BindingMode_eq, type Label } from "../rustc_ast/lib.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type { PolyFnSig as PolyFnSigT } from "../rustc_type_ir/decls.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import { DefineOpaqueTypes } from "../rustc_infer/infer/at.gen.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { AllowTwoPhase } from "../rustc_middle/ty/adjustment.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { Const } from "../rustc_middle/ty/decls.ts";
import { BottomUpFolder } from "../rustc_middle/ty/fold.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, type Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DefId_eq } from "../rustc_span/def_id.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, type Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import { FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import type { TypeMismatchSource } from "./demand.gen.ts";
import { type Candidate, ProbeScope } from "./method/probe.gen.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

// rustc: compiler/rustc_hir_typeck/src/demand.rs:20 emit_type_mismatch_suggestions
FnCtxt.prototype.emit_type_mismatch_suggestions = function (
  this: FnCtxt,
  err: Diag,
  expr: hir.Expr,
  expr_ty: Ty,
  expected: Ty,
  expected_ty_expr: hir.Expr | undefined,
  error: TypeError | undefined,
): void {
  if (expr_ty === expected) {
    return;
  }
  this.annotate_alternative_method_deref_for_unop(err, expr, error);
  this.explain_self_literal(err, expr, expected, expr_ty);

  // Use `||` to give these suggestions a precedence
  const suggested =
    this.suggest_missing_parentheses(err, expr) ||
    this.suggest_missing_unwrap_expect(err, expr, expected, expr_ty) ||
    this.suggest_remove_last_method_call(err, expr, expected) ||
    this.suggest_associated_const(err, expr, expected) ||
    this.suggest_semicolon_in_repeat_expr(err, expr, expr_ty) ||
    this.suggest_deref_ref_or_into(err, expr, expected, expr_ty, expected_ty_expr) ||
    this.suggest_option_to_bool(err, expr, expr_ty, expected) ||
    this.suggest_collect(err, expr, expected, expr_ty) ||
    this.suggest_compatible_variants(err, expr, expected, expr_ty) ||
    this.suggest_non_zero_new_unwrap(err, expr, expected, expr_ty) ||
    this.suggest_calling_boxed_future_when_appropriate(err, expr, expected, expr_ty) ||
    this.suggest_closure_to_fn_ptr_coercion(err, expr, expected, expr_ty) ||
    this.suggest_boxing_when_appropriate(err, expr.peel_blocks().span, expr.hir_id, expected, expr_ty) ||
    this.suggest_block_to_brackets_peeling_refs(err, expr, expr_ty, expected) ||
    this.suggest_copied_cloned_or_as_ref(err, expr, expr_ty, expected) ||
    this.suggest_clone_for_ref(err, expr, expr_ty, expected) ||
    this.suggest_into(err, expr, expr_ty, expected) ||
    this.suggest_floating_point_literal(err, expr, expected) ||
    this.suggest_null_ptr_for_literal_zero_given_to_ptr_arg(err, expr, expected) ||
    this.suggest_coercing_result_via_try_operator(err, expr, expected, expr_ty) ||
    this.suggest_returning_value_after_loop(err, expr, expected);

  if (!suggested) {
    this.note_source_of_type_mismatch_constraint(err, expr, { $: "Ty", _0: expected });
  }
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:73 emit_coerce_suggestions
FnCtxt.prototype.emit_coerce_suggestions = function (
  this: FnCtxt,
  err: Diag,
  expr: hir.Expr,
  expr_ty: Ty,
  expected: Ty,
  expected_ty_expr: hir.Expr | undefined,
  error: TypeError | undefined,
): void {
  if (expr_ty === expected) {
    return;
  }

  this.annotate_expected_due_to_let_ty(err, expr, error);
  this.annotate_loop_expected_due_to_inference(err, expr, error);
  if (this.annotate_mut_binding_to_immutable_binding(err, expr, expr_ty, expected, error)) {
    return;
  }

  // FIXME(#73154): For now, we do leak check when coercing function
  // pointers in typeck, instead of only during borrowck. This can lead
  // to these `RegionsInsufficientlyPolymorphic` errors that aren't helpful.
  if (error !== undefined && error.$ === "RegionsInsufficientlyPolymorphic") {
    return;
  }

  if (this.is_destruct_assignment_desugaring(expr)) {
    return;
  }
  this.emit_type_mismatch_suggestions(err, expr, expr_ty, expected, expected_ty_expr, error);
  this.note_type_is_not_clone(err, expected, expr_ty, expr);
  this.note_internal_mutation_in_method(err, expr, expected, expr_ty);
  this.suggest_method_call_on_range_literal(err, expr, expr_ty, expected);
  this.suggest_return_binding_for_missing_tail_expr(err, expr, expr_ty, expected);
  this.note_wrong_return_ty_due_to_generic_arg(err, expr, expr_ty);
};

/// Really hacky heuristic to remap an `assert_eq!` error to the user
/// expressions provided to the macro.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:112 adjust_expr_for_assert_eq_macro
FnCtxt.prototype.adjust_expr_for_assert_eq_macro = function (this: FnCtxt, found_expr: MutRef<hir.Expr>, expected_expr_: MutRef<hir.Expr | undefined>): void {
  if (expected_expr_.value === undefined) {
    return;
  }
  const expected_expr = expected_expr_.value;

  if (!Span.eq_ctxt(found_expr.value.span, expected_expr.span)) {
    return;
  }

  const macro_def_id = SyntaxContext.outer_expn_data(Span.ctxt(found_expr.value.span)).macro_def_id;
  if (!(macro_def_id !== undefined && this.tcx.is_diagnostic_item(sym.assert_eq_macro, macro_def_id))) {
    return;
  }

  const fk = found_expr.value.kind;
  if (!(fk.$ === "Unary" && fk._0 === "Deref" && fk._1.kind.$ === "Path")) {
    return;
  }
  const found_path = fk._1.kind._0;
  const ek = expected_expr.kind;
  if (!(ek.$ === "Unary" && ek._0 === "Deref" && ek._1.kind.$ === "Path")) {
    return;
  }
  const expected_path = ek._1.kind._0;

  // PORT: `var: &mut &Expr` is a setter writing back into the `MutRef` it came from.
  const items: [hir.QPath, string, number, (e: hir.Expr) => void][] = [
    [expected_path, "left_val", 0, (e) => (expected_expr_.value = e)],
    [found_path, "right_val", 1, (e) => (found_expr.value = e)],
  ];
  for (const [path_, name, idx, var_] of items) {
    let path: hir.Path;
    let segment: hir.PathSegment;
    let hir_id: HirId;
    let parent: [HirId, hir.Node] | undefined;
    let match_expr: hir.Expr;
    let scrutinee: hir.Expr;
    let exprs: readonly hir.Expr[];
    if (
      path_.$ === "Resolved" &&
      ((path = path_._1), true) &&
      path.segments.length === 1 &&
      ((segment = path.segments[0]!), true) &&
      Symbol.as_str(segment.ident.name) === name &&
      path.res.$ === "Local" &&
      ((hir_id = path.res._0), true) &&
      (parent = nth(this.tcx.hir_parent_iter(hir_id), 2)) !== undefined &&
      parent[1].$ === "Expr" &&
      ((match_expr = parent[1]._0), true) &&
      match_expr.kind.$ === "Match" &&
      ((scrutinee = match_expr.kind._0), true) &&
      scrutinee.kind.$ === "Tup" &&
      ((exprs = scrutinee.kind._0), true) &&
      index(exprs, idx).kind.$ === "AddrOf"
    ) {
      const k = index(exprs, idx).kind as { readonly $: "AddrOf"; _2: hir.Expr };
      const macro_arg = k._2;
      var_(macro_arg);
    }
  }
};


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
  return Err(this.err_ctxt().report_mismatched_types(cause, this.param_env, expected, actual, e));
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
  return Err(this.err_ctxt().report_mismatched_types(cause, this.param_env, expected, actual, e));
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

  // PORT: `&mut expr` / `&mut expected_ty_expr` are `MutRef` cells (PORTING §8).
  const expr_ref: MutRef<hir.Expr> = { value: expr0 };
  const expected_ty_expr_ref: MutRef<hir.Expr | undefined> = { value: expected_ty_expr0 };
  this.adjust_expr_for_assert_eq_macro(expr_ref, expected_ty_expr_ref);
  const expected_ty_expr = expected_ty_expr_ref.value;

  this.set_tainted_by_errors(this.dcx().span_delayed_bug(expr_ref.value.span, "`TypeError` when attempting coercion but no error emitted"));
  const expr = expr_ref.value.peel_drop_temps();
  const cause = this.misc(expr.span);
  const expr_ty = this.deeply_resolve_ignoring_regions(checked_ty, fold_Ty);
  const err = this.err_ctxt().report_mismatched_types(cause, this.param_env, expected, expr_ty, e);

  this.emit_coerce_suggestions(err, expr, expr_ty, expected, expected_ty_expr, e);

  return Err(err);
};

/// Notes the point at which a variable is constrained to some type incompatible
/// with some expectation given by `source`.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:290 note_source_of_type_mismatch_constraint
FnCtxt.prototype.note_source_of_type_mismatch_constraint = function (this: FnCtxt, err: Diag, expr: hir.Expr, source: TypeMismatchSource): boolean {
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined)) {
    return false;
  }
  const p = expr.kind._0._1;
  if (!(p.segments.length === 1 && p.segments[0]!.args === undefined)) {
    return false;
  }
  const ident = p.segments[0]!.ident;
  if (p.res.$ !== "Local") {
    return false;
  }
  const local_hir_id = p.res._0;
  const pat_node = this.tcx.hir_node(local_hir_id);
  if (pat_node.$ !== "Pat") {
    return false;
  }
  const pat = pat_node._0;
  let init_ty_hir_id: HirId;
  let init: hir.Expr | undefined;
  const parent = this.tcx.parent_hir_node(pat.hir_id);
  if (parent.$ === "LetStmt" && parent._0.ty !== undefined) {
    const ty = parent._0.ty;
    [init_ty_hir_id, init] = [ty.hir_id, parent._0.init];
  } else if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
    const init_ = parent._0.init;
    [init_ty_hir_id, init] = [init_.hir_id, init_];
  } else {
    return false;
  }
  const init_ty = this.node_ty_opt(init_ty_hir_id);
  if (init_ty === undefined) {
    return false;
  }

  // Locate all the usages of the relevant binding.
  const expr_finder = new FindExprs(local_hir_id, init !== undefined ? [init] : []);
  const body = this.tcx.hir_body_owned_by(this.body_def_id);
  expr_finder.visit_expr(body.value);

  // Replaces all of the variables in the given type with a fresh inference variable.
  const fudger = new BottomUpFolder(
    this.tcx,
    (ty: Ty): Ty => {
      const k = ty.kind();
      if (k.$ === "Infer") {
        const infer = k._0;
        switch (infer.$) {
          case "TyVar":
            return this.next_ty_var(DUMMY_SP);
          case "IntVar":
            return this.next_int_var();
          case "FloatVar":
            return this.next_float_var(DUMMY_SP, undefined);
          case "FreshTy":
          case "FreshIntTy":
          case "FreshFloatTy":
            return bug("unexpected fresh ty outside of the trait solver");
        }
      } else {
        return ty;
      }
    },
    (_) => this.tcx.lifetimes.re_erased,
    (ct: Const): Const => {
      if (ct.kind().$ === "Infer") {
        return this.next_const_var(DUMMY_SP);
      } else {
        return ct;
      }
    },
  );

  let expected_ty: Ty;
  switch (source.$) {
    case "Ty":
      expected_ty = source._0;
      break;
    // Try to deduce what the possible value of `expr` would be if the
    // incompatible arg were compatible. For example, given `Vec<i32>`
    // and `vec.push(1u32)`, we ideally want to deduce that the type of
    // `vec` *should* have been `Vec<u32>`. This will allow us to then
    // run the subsequent code with this expectation, finding out exactly
    // when this type diverged from our expectation.
    case "Arg": {
      const [call_expr, idx] = [source.call_expr, source.incompatible_arg];
      if (call_expr.kind.$ !== "MethodCall") {
        return false;
      }
      const [segment, args] = [call_expr.kind._0, call_expr.kind._2];
      const arg_ty = this.node_ty_opt(index(args, idx).hir_id);
      if (arg_ty === undefined) {
        return false;
      }
      let possible_rcvr_ty: Ty | undefined;
      for (let i = expr_finder.uses.length - 1; i >= 0; i--) {
        const binding = expr_finder.uses[i]!;
        possible_rcvr_ty = ((): Ty | undefined => {
          const possible_rcvr_ty0 = this.node_ty_opt(binding.hir_id);
          if (possible_rcvr_ty0 === undefined) return undefined;
          if (possible_rcvr_ty0.is_ty_var()) {
            return undefined;
          }
          // Fudge the receiver, so we can do new inference on it.
          const possible_rcvr_ty = fold_Ty.fold_with(possible_rcvr_ty0, fudger);
          const method_r = this.lookup_method_for_diagnostic(possible_rcvr_ty, segment, DUMMY_SP, call_expr, binding);
          if (method_r.$ !== "Ok") return undefined;
          const method = method_r._0;
          // Make sure we select the same method that we started with...
          if (!opt_def_id_eq(method.def_id, this.typeck_results.type_dependent_def_id(call_expr.hir_id))) {
            return undefined;
          }
          // Unify the method signature with our incompatible arg, to
          // do inference in the *opposite* direction and to find out
          // what our ideal rcvr ty would look like.
          const input_arg = FnSig.inputs(method.sig)[idx + 1];
          if (input_arg === undefined) {
            if (FnSig.splatted(method.sig) !== undefined) {
              // FIXME(splat): when the arg is splatted, adjust its index, to handle the type mismatch properly
              return undefined;
            } else {
              return span_bug(
                this.tcx.def_span(method.def_id),
                `arg index ${idx + 1} out of bounds for method with ${FnSig.inputs(method.sig).length} inputs`,
              );
            }
          }
          if (this.at(ObligationCause.dummy(), this.param_env).eq(DefineOpaqueTypes.Yes, input_arg, arg_ty, ToTrace_Ty).$ !== "Ok") {
            return undefined;
          }
          this.select_obligations_where_possible((errs) => {
            // Yeet the errors, we're already reporting errors.
            errs.length = 0;
          });
          return this.deeply_resolve_ignoring_regions(possible_rcvr_ty, fold_Ty);
        })();
        if (possible_rcvr_ty !== undefined) break;
      }
      if (possible_rcvr_ty === undefined) {
        return false;
      }
      const rcvr_ty = possible_rcvr_ty;
      expected_ty = rcvr_ty;
      break;
    }
  }

  // If our expected_ty does not equal init_ty, then it *began* as incompatible.
  // No need to note in this case...
  if (!this.can_eq(this.param_env, expected_ty, fold_Ty.fold_with(init_ty, fudger), ToTrace_Ty)) {
    return false;
  }

  for (let w = 0; w + 2 <= expr_finder.uses.length; w++) {
    // Bindings always update their recorded type after the fact, so we
    // need to look at the *following* usage's type to see when the
    // binding became incompatible.
    const [binding, next_usage] = [expr_finder.uses[w]!, expr_finder.uses[w + 1]!];

    // Don't go past the binding (always gonna be a nonsense label if so)
    if (HirId_eq(binding.hir_id, expr.hir_id)) {
      break;
    }

    const next_use_ty = this.node_ty_opt(next_usage.hir_id);
    if (next_use_ty === undefined) {
      continue;
    }

    // If the type is not constrained in a way making it not possible to
    // equate with `expected_ty` by this point, skip.
    if (this.can_eq(this.param_env, expected_ty, fold_Ty.fold_with(next_use_ty, fudger), ToTrace_Ty)) {
      continue;
    }

    const parent = this.tcx.parent_hir_node(binding.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "MethodCall" && HirId_eq(parent._0.kind._1.hir_id, binding.hir_id)) {
      const parent_expr = parent._0;
      const [segment, rcvr, args] = [parent._0.kind._0, parent._0.kind._1, parent._0.kind._2];
      // If our binding became incompatible while it was a receiver
      // to a method call, we may be able to make a better guess to
      // the source of a type mismatch.
      const rcvr_ty0 = this.node_ty_opt(rcvr.hir_id);
      if (rcvr_ty0 === undefined) {
        continue;
      }
      const rcvr_ty = fold_Ty.fold_with(rcvr_ty0, fudger);
      const method_r = this.lookup_method_for_diagnostic(rcvr_ty, segment, DUMMY_SP, parent_expr, rcvr);
      if (method_r.$ !== "Ok") {
        continue;
      }
      const method = method_r._0;
      // Make sure we select the same method that we started with...
      if (!opt_def_id_eq(method.def_id, this.typeck_results.type_dependent_def_id(parent_expr.hir_id))) {
        continue;
      }

      const ideal_rcvr_ty = fold_Ty.fold_with(rcvr_ty, fudger);
      const ideal_method_r = this.lookup_method_for_diagnostic(ideal_rcvr_ty, segment, DUMMY_SP, parent_expr, rcvr);
      let ideal_method = ideal_method_r.$ === "Ok" ? ideal_method_r._0 : undefined;
      if (ideal_method !== undefined) {
        if (this.at(ObligationCause.dummy(), this.param_env).eq(DefineOpaqueTypes.Yes, ideal_rcvr_ty, expected_ty, ToTrace_Ty).$ !== "Ok") {
          ideal_method = undefined;
        }
      }

      // Find what argument caused our rcvr to become incompatible
      // with the expected ty.
      const inputs = FnSig.inputs(method.sig).slice(1);
      for (let idx = 0; idx < Math.min(inputs.length, args.length); idx++) {
        const [expected_arg_ty, arg_expr] = [inputs[idx]!, args[idx]!];
        const arg_ty0 = this.node_ty_opt(arg_expr.hir_id);
        if (arg_ty0 === undefined) {
          continue;
        }
        const arg_ty = fold_Ty.fold_with(arg_ty0, fudger);
        void this.coerce(arg_expr, arg_ty, expected_arg_ty, "No" satisfies AllowTwoPhase, undefined);
        this.select_obligations_where_possible((errs) => {
          // Yeet the errors, we're already reporting errors.
          errs.length = 0;
        });
        // If our rcvr, after inference due to unifying the signature
        // with the expected argument type, is still compatible with
        // the rcvr, then it must've not been the source of blame.
        if (this.can_eq(this.param_env, rcvr_ty, expected_ty, ToTrace_Ty)) {
          continue;
        }
        err.span_label(arg_expr.span, `this argument has type \`${display_Ty(arg_ty)}\`...`);
        err.span_label(binding.span, `... which causes \`${display_Ident(ident)}\` to have type \`${display_Ty(next_use_ty)}\``);
        // Using our "ideal" method signature, suggest a fix to this
        // blame arg, if possible. Don't do this if we're coming from
        // arg mismatch code, because we'll possibly suggest a mutually
        // incompatible fix at the original mismatch site.
        // HACK(compiler-errors): We don't actually consider the implications
        // of our inference guesses in `emit_type_mismatch_suggestions`, so
        // only suggest things when we know our type error is precisely due to
        // a type mismatch, and not via some projection or something. See #116155.
        let ideal_arg_ty: Ty;
        if (
          source.$ === "Ty" &&
          ideal_method !== undefined &&
          opt_def_id_eq(ideal_method.def_id, this.typeck_results.type_dependent_def_id(parent_expr.hir_id)) &&
          ((ideal_arg_ty = this.deeply_resolve_ignoring_regions(index(FnSig.inputs(ideal_method.sig), idx + 1), fold_Ty)), true) &&
          !TypeVisitableExt.has_non_region_infer(ideal_arg_ty, fold_Ty)
        ) {
          this.emit_type_mismatch_suggestions(err, arg_expr, arg_ty, ideal_arg_ty, undefined, undefined);
        }
        return true;
      }
    }
    err.span_label(binding.span, `here the type of \`${display_Ident(ident)}\` is inferred to be \`${display_Ty(next_use_ty)}\``);
    return true;
  }

  // We must've not found something that constrained the expr.
  return false;
};

// rustc-type: compiler/rustc_hir_typeck/src/demand.rs:318 FindExprs
class FindExprs extends hir.intravisit.Visitor {
  constructor(
    public hir_id: HirId,
    public uses: hir.Expr[],
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/demand.rs:323 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Path" && ex.kind._0.$ === "Resolved" && ex.kind._0._0 === undefined) {
      const path = ex.kind._0._1;
      if (path.res.$ === "Local" && HirId_eq(path.res._0, this.hir_id)) {
        this.uses.push(ex);
      }
    }
    hir.intravisit.walk_expr(this, ex);
    return undefined;
  }
}

// When encountering a type error on the value of a `break`, try to point at the reason for the
// expected type.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:577 annotate_loop_expected_due_to_inference
FnCtxt.prototype.annotate_loop_expected_due_to_inference = function (this: FnCtxt, err: Diag, expr: hir.Expr, error: TypeError | undefined): void {
  if (!(error !== undefined && error.$ === "Sorts")) {
    return;
  }
  const expected = error._0.expected;
  let parent_id = this.tcx.parent_hir_id(expr.hir_id);
  let parent: hir.Expr;
  outer: for (;;) {
    // Climb the HIR tree to see if the current `Expr` is part of a `break;` statement.
    const node = this.tcx.hir_node(parent_id);
    let p: hir.Expr;
    if (node.$ === "Stmt" && node._0.kind.$ === "Semi") {
      p = node._0.kind._0;
    } else if (node.$ === "Block" && node._0.expr !== undefined) {
      p = node._0.expr;
    } else if (node.$ === "Expr") {
      p = node._0;
    } else {
      break;
    }
    parent = p;
    parent_id = this.tcx.parent_hir_id(parent_id);
    if (parent.kind.$ !== "Break") {
      continue;
    }
    const destination = parent.kind._0;
    // PORT: the inner `let mut parent_id = parent_id;` shadows the outer one.
    let parent_id_ = parent_id;
    let direct = false;
    for (;;) {
      // Climb the HIR tree to find the (desugared) `loop` this `break` corresponds to.
      let parent_: hir.Expr;
      const n = this.tcx.hir_node(parent_id_);
      if (n.$ === "Expr") {
        const parent__ = n._0;
        parent_id_ = this.tcx.parent_hir_id(parent__.hir_id);
        parent_ = parent__;
      } else if (n.$ === "Stmt" && (n._0.kind.$ === "Semi" || n._0.kind.$ === "Expr")) {
        const hir_id = n._0.hir_id;
        parent_id_ = this.tcx.parent_hir_id(hir_id);
        parent_ = n._0.kind._0;
      } else if (n.$ === "Stmt" && n._0.kind.$ === "Let") {
        const hir_id = n._0.hir_id;
        parent_id_ = this.tcx.parent_hir_id(hir_id);
        // PORT: `parent` is the enclosing scope's binding (the `break` expression).
        parent_ = parent;
      } else if (n.$ === "LetStmt") {
        const hir_id = n._0.hir_id;
        parent_id_ = this.tcx.parent_hir_id(hir_id);
        parent_ = parent;
      } else if (n.$ === "Block") {
        parent_id_ = this.tcx.parent_hir_id(parent_id_);
        parent_ = parent;
      } else {
        break;
      }
      if (parent_.kind.$ === "Loop") {
        // When you have `'a: loop { break; }`, the `break` corresponds to the labeled
        // loop, so we need to account for that.
        direct = !direct;
      }
      if (parent_.kind.$ === "Loop" && (label_eq(destination.label, parent_.kind._1) || direct)) {
        const [block, label, span] = [parent_.kind._0, parent_.kind._1, parent_.kind._3];
        const reason = this.maybe_get_coercion_reason(parent_id_, parent_.span);
        if (reason !== undefined) {
          const [reason_span, message] = reason;
          err.span_label(reason_span, message);
          err.span_label(span, `this loop is expected to be of type \`${display_Ty(expected)}\``);
          break outer;
        } else {
          // Locate all other `break` statements within the same `loop` that might
          // have affected inference.
          const expr_finder = new FindBreaks(label, [], 0);
          expr_finder.visit_block(block);
          let exit = false;
          for (const ex of expr_finder.uses) {
            if (ex.kind.$ !== "Break") {
              continue;
            }
            const val = ex.kind._1;
            let ty: Ty;
            if (val !== undefined) {
              const t = this.typeck_results.expr_ty_adjusted_opt(val);
              if (t === undefined) continue;
              ty = t;
            } else {
              ty = this.tcx.types.unit;
            }
            if (this.can_eq(this.param_env, ty, expected, ToTrace_Ty)) {
              err.span_label(ex.span, "expected because of this `break`");
              exit = true;
            }
          }
          if (exit) {
            break outer;
          }
        }
      }
    }
  }
};

// rustc-type: compiler/rustc_hir_typeck/src/demand.rs:653 FindBreaks
class FindBreaks extends hir.intravisit.Visitor {
  constructor(
    public label: Label | undefined,
    public uses: hir.Expr[],
    public nest_depth: number,
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/demand.rs:658 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const nest_depth = this.nest_depth;
    if (ex.kind.$ === "Loop") {
      const label = ex.kind._1;
      if (label_eq(label, this.label)) {
        // Account for `'a: loop { 'a: loop {...} }`.
        return undefined;
      }
      this.nest_depth += 1;
    }
    if (
      ex.kind.$ === "Break" &&
      (label_eq(this.label, ex.kind._0.label) ||
        // Account for `loop { 'a: loop { loop { break; } } }`.
        (ex.kind._0.label === undefined && this.nest_depth === 0))
    ) {
      this.uses.push(ex);
    }
    hir.intravisit.walk_expr(this, ex);
    this.nest_depth = nest_depth;
    return undefined;
  }
}

// rustc: compiler/rustc_hir_typeck/src/demand.rs:708 annotate_expected_due_to_let_ty
FnCtxt.prototype.annotate_expected_due_to_let_ty = function (this: FnCtxt, err: Diag, expr: hir.Expr, error: TypeError | undefined): void {
  // Skip nested block to find the correct parent node to point at.
  let current_hir_id = expr.hir_id;
  let parent_: hir.Node | undefined;
  for (const [parent_hir_id, parent] of this.tcx.hir_parent_iter(expr.hir_id)) {
    if (parent.$ === "Block" && parent._0.expr !== undefined && HirId_eq(parent._0.expr.hir_id, current_hir_id)) {
      current_hir_id = parent_hir_id;
      continue;
    }
    if (parent.$ === "Expr" && parent._0.kind.$ === "Block" && HirId_eq(parent._0.kind._0.hir_id, current_hir_id)) {
      current_hir_id = parent_hir_id;
      continue;
    }
    parent_ = parent;
    break;
  }
  const parent = parent_ ?? bug("an expression must have a non-block ancestor");

  let lk;
  if (
    parent.$ === "LetStmt" &&
    parent._0.ty !== undefined &&
    parent._0.init !== undefined &&
    HirId_eq(parent._0.init.hir_id, current_hir_id) &&
    !lo_hi_eq(parent._0.ty.span, parent._0.init.span)
  ) {
    const ty = parent._0.ty;
    // Point at `let` assignment type.
    err.span_label(ty.span, "expected due to this");
  } else if (
    parent.$ === "Expr" &&
    parent._0.kind.$ === "Assign" &&
    error !== undefined &&
    error.$ === "Sorts" &&
    HirId_eq(parent._0.kind._1.hir_id, expr.hir_id) &&
    !error._0.expected.is_closure()
  ) {
    const lhs = parent._0.kind._0;
    // We ignore closures explicitly because we already point at them elsewhere.
    // Point at the assigned-to binding.
    let primary_span = lhs.span;
    let secondary_span = lhs.span;
    let post_message = "";
    if (
      lhs.kind.$ === "Path" &&
      lhs.kind._0.$ === "Resolved" &&
      lhs.kind._0._0 === undefined &&
      lhs.kind._0._1.res.$ === "Def" &&
      (lhs.kind._0._1.res._0.$ === "Static" || lhs.kind._0._1.res._0.$ === "Const")
    ) {
      const def_id = lhs.kind._0._1.res._1;
      const node = this.tcx.hir_get_if_local(def_id);
      if (node !== undefined && node.$ === "Item" && (node._0.kind.$ === "Static" || node._0.kind.$ === "Const")) {
        const ik = node._0.kind;
        const [ident, ty] = ik.$ === "Static" ? [ik._1, ik._2] : [ik._0, ik._2];
        primary_span = ty.span;
        secondary_span = ident.span;
        post_message = " type";
      }
    } else if (lhs.kind.$ === "Path" && lhs.kind._0.$ === "Resolved" && lhs.kind._0._0 === undefined && lhs.kind._0._1.res.$ === "Local") {
      const hir_id = lhs.kind._0._1.res._0;
      const pn = this.tcx.hir_node(hir_id);
      if (pn.$ === "Pat") {
        const pat = pn._0;
        primary_span = pat.span;
        secondary_span = pat.span;
        const pp = this.tcx.parent_hir_node(pat.hir_id);
        if (pp.$ === "LetStmt" && pp._0.ty !== undefined) {
          const ty = pp._0.ty;
          primary_span = ty.span;
          post_message = " type";
        } else if (pp.$ === "LetStmt" && pp._0.init !== undefined) {
          const init = pp._0.init;
          primary_span = init.span;
          post_message = " value";
        } else if (pp.$ === "Param") {
          const ty_span = pp._0.ty_span;
          primary_span = ty_span;
          post_message = " parameter type";
        }
      }
    }

    if (primary_span !== secondary_span && this.tcx.sess.source_map().is_multiline(Span.until(Span.shrink_to_hi(secondary_span), primary_span))) {
      // We are pointing at the binding's type or initializer value, but it's pattern
      // is in a different line, so we point at both.
      err.span_label(secondary_span, "expected due to the type of this binding");
      err.span_label(primary_span, `expected due to this${post_message}`);
    } else if (post_message === "") {
      // We are pointing at either the assignment lhs or the binding def pattern.
      err.span_label(primary_span, "expected due to the type of this binding");
    } else {
      // We are pointing at the binding's type or initializer value.
      err.span_label(primary_span, `expected due to this${post_message}`);
    }

    if (!lhs.is_syntactic_place_expr()) {
      // We already emitted E0070 "invalid left-hand side of assignment", so we
      // silence this.
      err.downgrade_to_delayed_bug();
    }
  } else if (
    parent.$ === "Expr" &&
    (lk = parent._0.kind).$ === "Binary" &&
    error !== undefined &&
    error.$ === "Sorts" &&
    HirId_eq(lk._2.hir_id, expr.hir_id) &&
    this.typeck_results.expr_ty_adjusted_opt(lk._1) === error._0.expected &&
    // let expressions being marked as `bool` is confusing (see issue #147665)
    !(lk._1.kind.$ === "Let")
  ) {
    const lhs = lk._1;
    const expected = error._0.expected;
    err.span_label(lhs.span, `expected because this is \`${display_Ty(expected)}\``);
  }
};

/// Detect the following case
///
/// ```text
/// fn change_object(mut b: &Ty) {
///     let a = Ty::new();
///     b = a;
/// }
/// ```
///
/// where the user likely meant to modify the value behind there reference, use `b` as an out
/// parameter, instead of mutating the local binding. When encountering this we suggest:
///
/// ```text
/// fn change_object(b: &'_ mut Ty) {
///     let a = Ty::new();
///     *b = a;
/// }
/// ```
// rustc: compiler/rustc_hir_typeck/src/demand.rs:856 annotate_mut_binding_to_immutable_binding
FnCtxt.prototype.annotate_mut_binding_to_immutable_binding = function (
  this: FnCtxt,
  err: Diag,
  expr: hir.Expr,
  expr_ty: Ty,
  expected: Ty,
  error: TypeError | undefined,
): boolean {
  let ek;
  let parent;
  let lhs: hir.Expr;
  let hir_id: HirId;
  let pat_node;
  let pat: hir.Pat;
  let param_node;
  let ty_span: Span;
  let fn_decl: hir.FnDecl | undefined;
  let ident: Ident;
  let ty_ref: [hir.Lifetime, hir.Ty, Mutability] | undefined;
  if (
    error !== undefined &&
    error.$ === "Sorts" &&
    (ek = expected.kind()).$ === "Ref" &&
    ek._2 === "Not" &&
    // The difference between the expected and found values is one level of borrowing.
    this.can_eq(this.param_env, ek._1, expr_ty, ToTrace_Ty) &&
    // We have an `ident = expr;` assignment.
    (parent = this.tcx.parent_hir_node(expr.hir_id)).$ === "Expr" &&
    parent._0.kind.$ === "Assign" &&
    ((lhs = parent._0.kind._0), true) &&
    HirId_eq(parent._0.kind._1.hir_id, expr.hir_id) &&
    // We are assigning to some binding.
    lhs.kind.$ === "Path" &&
    lhs.kind._0.$ === "Resolved" &&
    lhs.kind._0._0 === undefined &&
    lhs.kind._0._1.res.$ === "Local" &&
    ((hir_id = lhs.kind._0._1.res._0), true) &&
    (pat_node = this.tcx.hir_node(hir_id)).$ === "Pat" &&
    ((pat = pat_node._0), true) &&
    // The pattern we have is an fn argument.
    (param_node = this.tcx.parent_hir_node(pat.hir_id)).$ === "Param" &&
    ((ty_span = param_node._0.ty_span), true) &&
    ((fn_decl = hir.OwnerNode.fn_decl(this.tcx.hir_owner_node(this.tcx.hir_get_parent_item(pat.hir_id)))), true) &&
    fn_decl !== undefined &&
    // We have a mutable binding in the argument.
    pat.kind.$ === "Binding" &&
    BindingMode_eq(pat.kind._0, BindingMode.MUT) &&
    ((ident = pat.kind._2), true) &&
    // Look for the type corresponding to the argument pattern we have in the argument list.
    (ty_ref = first_ref_input(fn_decl, ty_span)) !== undefined
  ) {
    const sugg: [Span, string][] = ty_ref[2] === "Mut"
      ? // Leave `&'name mut Ty` and `&mut Ty` as they are (#136028).
        []
      : // `&'name Ty` -> `&'name mut Ty` or `&Ty` -> `&mut Ty`
        [[Span.shrink_to_lo(ty_ref[1].span), `${Span.is_empty(ty_ref[0].ident.span) ? "" : " "}mut `]];
    sugg.push([Span.until(pat.span, ident.span), ""], [Span.shrink_to_lo(lhs.span), "*"]);
    // We suggest changing the argument from `mut ident: &Ty` to `ident: &'_ mut Ty` and the
    // assignment from `ident = val;` to `*ident = val;`.
    err.multipart_suggestion(
      "you might have meant to mutate the pointed at value being passed in, instead of changing the reference in the local binding",
      sugg,
      Applicability.MaybeIncorrect,
    );
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:929 annotate_alternative_method_deref_for_unop
FnCtxt.prototype.annotate_alternative_method_deref_for_unop = function (this: FnCtxt, err: Diag, expr: hir.Expr, error: TypeError | undefined): void {
  if (!(error !== undefined && error.$ === "Sorts")) {
    return;
  }
  const expected = error._0.expected;
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (!(parent.$ === "Expr" && parent._0.kind.$ === "Assign")) {
    return;
  }
  const [lhs, rhs] = [parent._0.kind._0, parent._0.kind._1];
  if (!HirId_eq(rhs.hir_id, expr.hir_id) || expected.is_closure()) {
    return;
  }
  if (!(lhs.kind.$ === "Unary" && lhs.kind._0 === "Deref")) {
    return;
  }
  const deref = lhs.kind._1;
  this.annotate_alternative_method_deref(err, deref, expected);
};

// #[tracing::instrument(skip(self, err), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/demand.rs:953 annotate_alternative_method_deref
FnCtxt.prototype.annotate_alternative_method_deref = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty | undefined): void {
  if (expr.kind.$ !== "MethodCall") {
    return;
  }
  const [path, base, args] = [expr.kind._0, expr.kind._1, expr.kind._2];
  const self_ty = this.typeck_results.expr_ty_adjusted_opt(base);
  if (self_ty === undefined) {
    return;
  }

  const pick_r = this.lookup_probe_for_diagnostic(path.ident, self_ty, expr, ProbeScope.TraitsInScope, undefined);
  if (pick_r.$ !== "Ok") {
    return;
  }
  const pick = pick_r._0;

  const in_scope_methods_r = this.probe_for_name_many("MethodCall", path.ident, expected, { _0: true }, self_ty, expr.hir_id, ProbeScope.TraitsInScope);
  if (in_scope_methods_r.$ !== "Ok") {
    return;
  }
  const in_scope_methods = in_scope_methods_r._0;

  const other_methods_in_scope: Candidate[] = in_scope_methods.filter((c) => !DefId_eq(c.item.def_id, pick.item.def_id));

  const all_methods_r = this.probe_for_name_many("MethodCall", path.ident, expected, { _0: true }, self_ty, expr.hir_id, ProbeScope.AllTraits);
  if (all_methods_r.$ !== "Ok") {
    return;
  }
  const all_methods = all_methods_r._0;

  const suggestions: [Span, string][][] = [];
  for (const c of all_methods) {
    const s = ((): [Span, string][] | undefined => {
      if (DefId_eq(c.item.def_id, pick.item.def_id)) {
        return undefined;
      }
      const m = c.item;
      const generic_args = RawList.for_item(this.tcx, m.def_id, (param, _) => this.var_for_def(expr.span, param));
      const fn_sig = this.tcx.fn_sig(m.def_id) as EarlyBinder<PolyFnSigT>;
      if (Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(fn_sig))).length !== args.length + 1) {
        return undefined;
      }
      const rcvr_ty = Binder.skip_binder(PolyFnSig.input(EarlyBinder.skip_binder(fn_sig), 0));
      const rk = rcvr_ty.kind();
      let mutability: string;
      let ty: Ty;
      if (rk.$ === "Ref" && rk._2 === "Mut") {
        [mutability, ty] = ["&mut ", rk._1];
      } else if (rk.$ === "Ref") {
        [mutability, ty] = ["&", rk._1];
      } else {
        [mutability, ty] = ["", rcvr_ty];
      }
      let path_: string;
      const ap = this.tcx.assoc_parent(m.def_id);
      if (ap !== undefined && ap[1].$ === "Impl" && ap[1].of_trait) {
        // We have `impl Trait for T {}`, suggest `<T as Trait>::method`.
        path_ = this.tcx.def_path_str_with_args(m.def_id, generic_args);
      } else if (ap !== undefined && ap[1].$ === "Impl" && !ap[1].of_trait) {
        const tk = ty.kind();
        if (tk.$ === "Adt") {
          const def = tk._0;
          // We have `impl T {}`, suggest `T::method`.
          path_ = `${this.tcx.def_path_str(def.did())}::${display_Ident(path.ident)}`;
        } else {
          // This should be unreachable, as `impl &'a T {}` is invalid.
          path_ = `${display_Ty(ty)}::${display_Ident(path.ident)}`;
        }
      } else {
        // Fallback for arbitrary self types.
        path_ = with_no_trimmed_paths(() => this.tcx.def_path_str_with_args(m.def_id, generic_args));
      }
      return [
        [Span.until(expr.span, base.span), `${path_}(${mutability}`],
        args.length === 0
          ? [Span.with_hi(Span.shrink_to_hi(base.span), Span.hi(expr.span)), ")"]
          : [Span.between(base.span, args[0]!.span), ", "],
      ];
    })();
    if (s !== undefined) suggestions.push(s);
  }
  if (suggestions.length === 0) {
    return;
  }
  const path_span: MultiSpan = MultiSpan.from_span(path.ident.span);
  path_span.push_span_label(
    path.ident.span,
    with_no_trimmed_paths(() => `refers to \`${this.tcx.def_path_str(pick.item.def_id)}\``),
  );
  const container_id = AssocItem.container_id(pick.item, this.tcx);
  const container = with_no_trimmed_paths(() => this.tcx.def_path_str(container_id));
  for (const def_id of pick.import_ids) {
    const hir_id = this.tcx.local_def_id_to_hir_id(def_id);
    path_span.push_span_label(this.tcx.hir_span(hir_id), `\`${container}\` imported here`);
  }
  const tail = with_no_trimmed_paths((): string | undefined => {
    if (other_methods_in_scope.length === 0) {
      return undefined; // `[] => return`
    } else if (other_methods_in_scope.length === 1) {
      const candidate = other_methods_in_scope[0]!;
      return `the method of the same name on ${candidate.kind.$ === "InherentImplCandidate" ? "the inherent impl for" : "trait"} \`${this.tcx.def_path_str(
        AssocItem.container_id(candidate.item, this.tcx),
      )}\``;
    } else if (other_methods_in_scope.length < 5) {
      return `the methods of the same name on ${
        listify(other_methods_in_scope.slice(0, other_methods_in_scope.length - 1), (c) => `\`${this.tcx.def_path_str(AssocItem.container_id(c.item, this.tcx))}\``) ?? ""
      }`;
    } else {
      return `the methods of the same name on ${other_methods_in_scope.length} other traits`;
    }
  });
  if (tail === undefined) {
    return;
  }
  err.span_note(path_span, `the \`${display_Ident(path.ident)}\` call is resolved to the method in \`${container}\`, shadowing ${tail}`);
  if (suggestions.length > other_methods_in_scope.length) {
    const n = suggestions.length - other_methods_in_scope.length;
    err.note(`additionally, there ${pluralize("is", n)} ${n} other available method${pluralize(n)} that ${pluralize("is", n)}n't in scope`);
  }
  err.multipart_suggestions(
    `you might have meant to call ${suggestions.length === 1 ? "the other method" : "one of the other methods"}; you can use the fully-qualified path to call ${
      suggestions.length === 1 ? "it" : "one of them"
    } explicitly`,
    suggestions,
    Applicability.MaybeIncorrect,
  );
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:1126 get_conversion_methods_for_diagnostic
FnCtxt.prototype.get_conversion_methods_for_diagnostic = function (this: FnCtxt, span: Span, expected: Ty, checked_ty: Ty, hir_id: HirId): AssocItem[] {
  const methods = this.probe_for_return_type_for_diagnostic(span, "MethodCall", expected, checked_ty, hir_id, (m) => {
    return (
      this.has_only_self_parameter(m) &&
      // This special internal attribute is used to permit
      // "identity-like" conversion methods to be suggested here.
      //
      // FIXME (#46459 and #46460): ideally
      // `std::convert::Into::into` and `std::borrow:ToOwned` would
      // also be `#[rustc_conversion_suggestion]`, if not for
      // method-probing false-positives and -negatives (respectively).
      //
      // FIXME? Other potential candidate methods: `as_ref` and
      // `as_mut`?
      find_attr(HasAttrs_DefId.get_attrs(m.def_id, this.tcx), (k) => (k.$ === "RustcConversionSuggestion" ? null : undefined)) !== undefined
    );
  });

  return methods;
};

/// This function checks whether the method is not static and does not accept other parameters than `self`.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:1159 has_only_self_parameter
FnCtxt.prototype.has_only_self_parameter = function (this: FnCtxt, method: AssocItem): boolean {
  return (
    AssocItem.is_method(method) &&
    Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(this.tcx.fn_sig(method.def_id) as EarlyBinder<PolyFnSigT>))).length === 1
  );
};

/// If the given `HirId` corresponds to a block with a trailing expression, return that expression
// rustc: compiler/rustc_hir_typeck/src/demand.rs:1165 maybe_get_block_expr
FnCtxt.prototype.maybe_get_block_expr = function (this: FnCtxt, expr: hir.Expr): hir.Expr | undefined {
  if (expr.kind.$ === "Block") {
    const block = expr.kind._0;
    return block.expr;
  }
  return undefined;
};

/// Returns whether the given expression is a destruct assignment desugaring.
/// For example, `(a, b) = (1, &2);`
/// Here we try to find the pattern binding of the expression,
/// `default_binding_modes` is false only for destruct assignment desugaring.
// rustc: compiler/rustc_hir_typeck/src/demand.rs:1179 is_destruct_assignment_desugaring
FnCtxt.prototype.is_destruct_assignment_desugaring = function (this: FnCtxt, expr: hir.Expr): boolean {
  let bind;
  let parent;
  if (
    expr.kind.$ === "Path" &&
    expr.kind._0.$ === "Resolved" &&
    expr.kind._0._1.res.$ === "Local" &&
    ((bind = this.tcx.hir_node(expr.kind._0._1.res._0)), true) &&
    ((parent = this.tcx.parent_hir_node(expr.kind._0._1.res._0)), true) &&
    bind.$ === "Pat" &&
    bind._0.kind.$ === "Binding" &&
    parent.$ === "Pat" &&
    parent._0.default_binding_modes === false
  ) {
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:1197 explain_self_literal
FnCtxt.prototype.explain_self_literal = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): void {
  const kind = expr.peel_drop_temps().kind;
  let path: hir.Path | undefined;
  if (kind.$ === "Struct" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._0._1.res.$ === "SelfTyAlias") {
    path = kind._0._1;
  } else if (
    kind.$ === "Call" &&
    kind._0.kind.$ === "Path" &&
    kind._0.kind._0.$ === "Resolved" &&
    kind._0.kind._0._0 === undefined &&
    kind._0.kind._0._1.res.$ === "SelfTyAlias"
  ) {
    path = kind._0.kind._0._1;
  }
  if (path !== undefined && path.res.$ === "SelfTyAlias") {
    const [alias_to, span] = [path.res.alias_to, path.span];
    const node = this.tcx.hir_get_if_local(alias_to);
    if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Impl") {
      const self_ty = node._0.kind._0.self_ty;
      err.span_label(self_ty.span, "this is the type of the `Self` literal");
    }
    const ek = expected.kind();
    const fk = found.kind();
    if (ek.$ === "Adt" && fk.$ === "Adt" && ek._0 === fk._0) {
      const [e_def, e_args] = [ek._0, ek._1];
      err.span_suggestion_verbose(span, "use the type name directly", this.tcx.value_path_str_with_args(e_def.did(), e_args), Applicability.MaybeIncorrect);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/demand.rs:1250 note_wrong_return_ty_due_to_generic_arg
FnCtxt.prototype.note_wrong_return_ty_due_to_generic_arg = function (this: FnCtxt, err: Diag, expr: hir.Expr, checked_ty: Ty): void {
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (parent.$ !== "Expr") {
    return;
  }
  const parent_expr = parent._0;
  if (Span.desugaring_kind(parent_expr.span) !== undefined) {
    return;
  }
  type CallableKind = "Function" | "Method" | "Constructor";
  const maybe_emit_help = (def_id: DefId, callable: Ident, args: readonly hir.Expr[], kind: CallableKind): void => {
    const arg_idx = unwrap(position(args, (a) => HirId_eq(a.hir_id, expr.hir_id)));
    const fn_ty = EarlyBinder.skip_binder(this.tcx.type_of(def_id) as EarlyBinder<Ty>);
    if (!fn_ty.is_fn()) {
      return;
    }
    const fn_sig = Binder.skip_binder(fn_ty.fn_sig(this.tcx));
    const arg = FnSig.inputs(fn_sig)[arg_idx + (kind === "Method" ? 1 : 0)];
    if (arg === undefined) {
      return;
    }
    if (arg.kind().$ === "Param" && FnSig.output(fn_sig).contains(arg) && this.node_ty(args[arg_idx]!.hir_id) === checked_ty) {
      const multi_span: MultiSpan = MultiSpan.from_span(parent_expr.span);
      multi_span.push_span_label(
        args[arg_idx]!.span,
        `this argument influences the ${kind === "Constructor" ? "type" : "return type"} of \`${display_Ident(callable)}\``,
      );
      let what: string;
      switch (kind) {
        case "Function":
          what = "return type of this call is";
          break;
        case "Method":
          what = "return type of this call is";
          break;
        case "Constructor":
          what = "type constructed contains";
          break;
      }
      err.span_help(multi_span, `the ${what} \`${display_Ty(checked_ty)}\` due to the type of the argument passed`);
    }
  };
  const pk = parent_expr.kind;
  switch (pk.$) {
    case "Call": {
      const [fun, args] = [pk._0, pk._1];
      if (!(fun.kind.$ === "Path" && fun.kind._0.$ === "Resolved")) {
        return;
      }
      const path = fun.kind._0._1;
      if (path.res.$ !== "Def") {
        return;
      }
      const [kind, def_id] = [path.res._0, path.res._1];
      const callable_kind: CallableKind = kind.$ === "Ctor" ? "Constructor" : "Function";
      maybe_emit_help(def_id, unwrap(path.segments[path.segments.length - 1]).ident, args, callable_kind);
      break;
    }
    case "MethodCall": {
      const [method, args] = [pk._0, pk._2];
      const def_id = this.typeck_results.type_dependent_def_id(parent_expr.hir_id);
      if (def_id === undefined) {
        return;
      }
      maybe_emit_help(def_id, method.ident, args, "Method");
      break;
    }
    default:
      return;
  }
};

// }

// ---- helpers ------------------------------------------------------------------------------------------------------

/** `Some(a) == b` / `Some(a) != b` on `Option<DefId>`. */
function opt_def_id_eq(a: DefId, b: DefId | undefined): boolean {
  return b !== undefined && DefId_eq(a, b);
}

/** `Option<Label> == Option<Label>` (`Label { ident }`, `Ident`'s `PartialEq`). */
function label_eq(a: Label | undefined, b: Label | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.ident.eq(b.ident);
}

/** `a.lo_hi() == b.lo_hi()` */
function lo_hi_eq(a: Span, b: Span): boolean {
  const [alo, ahi] = Span.lo_hi(a);
  const [blo, bhi] = Span.lo_hi(b);
  return alo === blo && ahi === bhi;
}

/** `Iterator::nth` */
function nth<T>(it: Iterable<T>, n: number): T | undefined {
  let i = 0;
  for (const x of it) {
    if (i === n) return x;
    i++;
  }
  return undefined;
}

/** `slice[idx]` (panics when out of bounds, as Rust's indexing). */
function index<T>(xs: readonly T[], idx: number): T {
  if (idx >= xs.length) return panic(`index out of bounds: the len is ${xs.length} but the index is ${idx}`);
  return xs[idx]!;
}

/** `Iterator::position` */
function position<T>(xs: readonly T[], p: (x: T) => boolean): number | undefined {
  const i = xs.findIndex(p);
  return i === -1 ? undefined : i;
}

/** annotate_mut_binding_to_immutable_binding: `fn_decl.inputs.iter().filter_map(|ty| match ty.kind { Ref(lt, inner_ty, mutbl) if ty.span == *ty_span => Some((lt, inner_ty, mutbl)), _ => None }).next()` */
function first_ref_input(fn_decl: hir.FnDecl, ty_span: Span): [hir.Lifetime, hir.Ty, Mutability] | undefined {
  for (const ty of fn_decl.inputs) {
    if (ty.kind.$ === "Ref" && ty.span === ty_span) {
      const [lt, inner_ty, mutbl] = [ty.kind._0, ty.kind._1, ty.kind._2];
      return [lt, inner_ty, mutbl];
    }
  }
  return undefined;
}

