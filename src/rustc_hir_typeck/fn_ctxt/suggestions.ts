// Port of compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub". Ported so far (lane typeck-gaps, success-path blockers): `fn_sig` (every fn body's return check),
// `is_field_suggestable` (struct patterns).
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/suggestions.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../../rust_ts/stubs.ts";
import { type FieldDef, Visibility } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { unwrap } from "../../std/panic.ts";
import { FnCtxt } from "../decls.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
// ---- lane typeck-fnsugg-b (suggestions.rs:2026..3956) ----
import { BinOpKind, LitKind } from "../../rustc_ast/lib.ts";
import { ExprPrecedence_discriminant } from "../../rustc_ast/util/parser.gen.ts";
import { FloatTy, IntTy, Mutability, Mutability_cmp, UintTy } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { type Applicability, type Diag, listify } from "../../rustc_errors/lib.ts";
import type { CtorKind } from "../../rustc_hir/def.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { expr_needs_parens, is_range_literal } from "../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, type AssocItem as AssocItemT } from "../../rustc_middle/ty/assoc.ts";
import { suggest_constraining_type_params } from "../../rustc_middle/ty/diagnostics.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { display_Predicate, display_Ty, with_no_trimmed_paths, with_types_for_suggestion } from "../../rustc_middle/ty/print/pretty.ts";
import { Article_TyKind } from "../../rustc_middle/ty/sty.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { BytePos } from "../../rustc_span/lib.ts";
import { display_Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { FnSig as FnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { ch, is_whitespace } from "../../std/char.ts";
import { unreachable } from "../../std/panic.ts";
import { utf8_len } from "../../std/str.ts";
import { ProbeScope } from "../method/probe.gen.ts";
import { ReplaceCommaWithSemicolon_subdiagnostic } from "../diagnostics.gen.ts";

const C_LPAREN = ch("(");
// ---- end lane typeck-fnsugg-b imports ----

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::suggestions::FnCtxt", ["suggest_semicolon_at_end", "suggest_mismatched_types_on_tail", "suggest_fn_call", "extract_callable_info", "suggest_two_fn_call", "suggest_collect", "suggest_remove_last_method_call", "suggest_deref_ref_or_into", "deconstruct_option_or_result", "suggest_boxing_when_appropriate", "suggest_closure_to_fn_ptr_coercion", "suggest_impl_fn_for_fn_ptr_ret", "suggest_calling_boxed_future_when_appropriate", "suggest_missing_semicolon", "is_next_stmt_expr_continuation", "suggest_missing_return_type", "can_add_return_type", "try_note_caller_chooses_ty_for_ty_param", "try_suggest_return_impl_trait", "suggest_missing_break_or_return_expr", "suggest_missing_parentheses", "suggest_block_to_brackets_peeling_refs", "suggest_clone_for_ref", "suggest_copied_cloned_or_as_ref", "suggest_into", "suggest_option_to_bool", "suggest_deref_unwrap_or", "suggest_block_to_brackets", "suggest_floating_point_literal", "suggest_null_ptr_for_literal_zero_given_to_ptr_arg", "suggest_associated_const"]);

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:43 fn_sig
FnCtxt.prototype.fn_sig = function (this: FnCtxt): FnSig | undefined {
  return this.typeck_results.liberated_fn_sigs().get(this.tcx.local_def_id_to_hir_id(this.body_def_id));
};

// ==== lane typeck-fnsugg-b: suggestions.rs:2026..3956 ====

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2027 is_loop
FnCtxt.prototype.is_loop = function (this: FnCtxt, id: HirId): boolean {
  const node = this.tcx.hir_node(id);
  return node.$ === "Expr" && node._0.kind.$ === "Loop";
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2032 is_local_statement
FnCtxt.prototype.is_local_statement = function (this: FnCtxt, id: HirId): boolean {
  const node = this.tcx.hir_node(id);
  return node.$ === "Stmt" && node._0.kind.$ === "Let";
};

/// Suggest that `&T` was cloned instead of `T` because `T` does not implement `Clone`,
/// which is a side-effect of autoref.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2039 note_type_is_not_clone
FnCtxt.prototype.note_type_is_not_clone = function (this: FnCtxt, diag: Diag, expected_ty: Ty, found_ty: Ty, expr_: hir.Expr): void {
  // When `expr` is `x` in something like `let x = foo.clone(); x`, need to recurse up to get
  // `foo` and `clone`.
  const expr = this.note_type_is_not_clone_inner_expr(expr_);

  // If we've recursed to an `expr` of `foo.clone()`, get `foo` and `clone`.
  if (!(expr.kind.$ === "MethodCall" && expr.kind._2.length === 0)) {
    return;
  }
  const [segment, callee_expr] = [expr.kind._0, expr.kind._1];

  const clone_trait_did = this.tcx.lang_items().clone_trait();
  if (clone_trait_did === undefined) {
    return;
  }
  const found_kind = found_ty.kind();
  if (found_kind.$ !== "Ref") {
    return;
  }
  const pointee_ty = found_kind._1;
  const results = this.typeck_results;
  // First, look for a `Clone::clone` call
  if (
    segment.ident.name === sym.clone &&
    is_some_and(results.type_dependent_def_id(expr.hir_id), (did) => {
      // PORT: the `associated_item` query's value is typed `unknown` in queries.gen.ts (callee.ts precedent).
      const assoc_item = this.tcx.associated_item(did) as AssocItemT;
      return assoc_item.container.$ === "Trait" && DefId_eq(AssocItem.container_id(assoc_item, this.tcx), clone_trait_did);
    }) &&
    // If that clone call hasn't already dereferenced the self type (i.e. don't give this
    // diagnostic in cases where we have `(&&T).clone()` and we expect `T`).
    !results.expr_adjustments(callee_expr).some((adj) => adj.kind.$ === "Deref") &&
    // Check that we're in fact trying to clone into the expected type
    this.may_coerce(pointee_ty, expected_ty)
  ) {
    const trait_ref = TraitRef.new(as_interner(this.tcx), clone_trait_did, [expected_ty]);
    // And the expected type doesn't implement `Clone`
    if (
      !this.predicate_must_hold_considering_regions(
        Obligation.new(
          this.tcx,
          ObligationCause.dummy(),
          this.param_env,
          trait_ref,
          Predicate_upcast_from_TraitRef as (from: TraitRef, tcx: Interner) => Predicate,
        ),
      )
    ) {
      diag.span_note(callee_expr.span, `\`${display_Ty(expected_ty)}\` does not implement \`Clone\`, so \`${display_Ty(found_ty)}\` was cloned instead`);
      const owner = this.tcx.hir_enclosing_body_owner(expr.hir_id);
      const expected_kind = expected_ty.kind();
      const generics = expected_kind.$ === "Param" ? this.tcx.hir_get_generics(owner) : undefined;
      if (expected_kind.$ === "Param" && generics !== undefined) {
        const param = expected_kind._0;
        suggest_constraining_type_params(this.tcx, generics, diag, [[Symbol.as_str(param.name), "Clone", clone_trait_did]], undefined);
      } else {
        let suggest_derive = true;
        const errors = this.type_implements_trait_shallow(clone_trait_did, expected_ty, this.param_env);
        if (errors !== undefined) {
          const manually_impl = "consider manually implementing `Clone` to avoid the implicit type parameter bounds";
          const errors_slice = TraitErrors.as_slice(errors);
          if (errors_slice.length === 0) {
            // nothing
          } else if (errors_slice.length === 1) {
            const error = errors_slice[0]!;
            const msg = "`Clone` is not implemented because a trait bound is not satisfied";
            const code = error.obligation.cause.code_();
            if (code.$ === "ImplDerived") {
              const data = code._0;
              const span: MultiSpan = MultiSpan.from_Span(data.span);
              if (this.tcx.is_automatically_derived(data.impl_or_alias_def_id)) {
                span.push_span_label(data.span, `derive introduces an implicit \`${display_Predicate(error.obligation.predicate)}\` bound`);
              }
              diag.span_help(span, msg);
              if (this.tcx.is_automatically_derived(data.impl_or_alias_def_id) && data.impl_or_alias_def_id.is_local()) {
                diag.help(manually_impl);
                suggest_derive = false;
              }
            } else {
              diag.help(msg);
            }
          } else {
            const unsatisfied_bounds: [Span, string][] = [];
            for (const error of errors_slice) {
              const code = error.obligation.cause.code_();
              if (code.$ === "ImplDerived") {
                const data = code._0;
                const pre = this.tcx.is_automatically_derived(data.impl_or_alias_def_id) ? "derive introduces an implicit " : "";
                unsatisfied_bounds.push([data.span, `${pre}unsatisfied trait bound \`${display_Predicate(error.obligation.predicate)}\``]);
              }
            }
            const msg = "`Clone` is not implemented because the some trait bounds could not be satisfied";
            if (TraitErrors.len(errors) === unsatisfied_bounds.length) {
              const unsatisfied_bounds_spans: MultiSpan = MultiSpan.from_Vec(unsatisfied_bounds.map(([span, _]) => span));
              for (const [span, label] of unsatisfied_bounds) {
                unsatisfied_bounds_spans.push_span_label(span, label);
              }
              diag.span_help(unsatisfied_bounds_spans, msg);
              if (
                errors_slice.every((error) => {
                  const code = error.obligation.cause.code_();
                  if (code.$ === "ImplDerived") {
                    const data = code._0;
                    return this.tcx.is_automatically_derived(data.impl_or_alias_def_id) && data.impl_or_alias_def_id.is_local();
                  } else {
                    return false;
                  }
                })
              ) {
                diag.help(manually_impl);
                suggest_derive = false;
              }
            } else {
              diag.help(`${msg}: ${unwrap(listify(errors_slice, (e) => `\`${display_Predicate(e.obligation.predicate)}\``))}`);
            }
          }
          for (const error of TraitErrors.into_iter(errors)) {
            if (error.code.$ === "Select" && error.code._0.$ === "Unimplemented") {
              const kind = Binder.skip_binder(error.obligation.predicate.kind());
              if (kind.$ === "Clause" && kind._0.$ === "Trait") {
                const pred = kind._0._0;
                this.infcx.err_ctxt().suggest_derive(error.obligation, diag, Binder.rebind(error.obligation.predicate.kind(), pred));
              }
            }
          }
        }
        if (suggest_derive) {
          this.suggest_derive(diag, [[Predicate_upcast_from_TraitRef(trait_ref, this.tcx), undefined, undefined]]);
        }
      }
    }
  }
};

/// Given a type mismatch error caused by `&T` being cloned instead of `T`, and
/// the `expr` as the source of this type mismatch, try to find the method call
/// as the source of this error and return that instead. Otherwise, return the
/// original expression.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2222 note_type_is_not_clone_inner_expr
FnCtxt.prototype.note_type_is_not_clone_inner_expr = function (this: FnCtxt, expr: hir.Expr): hir.Expr {
  const kind = expr.peel_blocks().kind;
  if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._0._1.segments.length === 1 && kind._0._1.res.$ === "Local") {
    const binding = kind._0._1.res._0;
    const binding_node = this.tcx.hir_node(binding);
    if (binding_node.$ !== "Pat") {
      return expr;
    }
    const hir_id = binding_node._0.hir_id;

    const parent = this.tcx.parent_hir_node(hir_id);
    if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
      // foo.clone()
      return this.note_type_is_not_clone_inner_expr(parent._0.init);
    } else if (parent.$ === "Pat" && parent._0.kind.$ === "Tuple") {
      // When `expr` is more complex like a tuple
      const pat_hir_id = parent._0.hir_id;
      const pats = parent._0.kind._0;
      const let_node = this.tcx.parent_hir_node(pat_hir_id);
      if (!(let_node.$ === "LetStmt" && let_node._0.init !== undefined)) {
        return expr;
      }
      const init = let_node._0.init;

      const init_kind = init.peel_blocks().kind;
      if (init_kind.$ === "Tup") {
        const init_tup = init_kind._0;
        let found: hir.Expr | undefined;
        for (let i = 0; i < pats.length; i++) {
          if (HirId_eq(pats[i]!.hir_id, hir_id) && i < init_tup.length) {
            found = init_tup[i]!;
            break;
          }
        }
        if (found !== undefined) {
          return this.note_type_is_not_clone_inner_expr(found);
        } else {
          return expr;
        }
      } else {
        return expr;
      }
    } else {
      return expr;
    }
  } else if (kind.$ === "Call") {
    // If we're calling into a closure that may not be typed recurse into that call. no need
    // to worry if it's a call to a typed function or closure as this would ne handled
    // previously.
    const call_expr_kind = kind._0.kind;
    if (call_expr_kind.$ === "Path" && call_expr_kind._0.$ === "Resolved" && call_expr_kind._0._0 === undefined) {
      const call_expr_path = call_expr_kind._0._1;
      if (call_expr_path.segments.length === 1 && call_expr_path.res.$ === "Local") {
        const binding = call_expr_path.res._0;
        const pat_node = this.tcx.hir_node(binding);
        if (pat_node.$ === "Pat") {
          const let_node = this.tcx.parent_hir_node(pat_node._0.hir_id);
          if (let_node.$ === "LetStmt" && let_node._0.init !== undefined && let_node._0.init.kind.$ === "Closure") {
            const body_id = let_node._0.init.kind._0.body;
            const body_expr = this.tcx.hir_body(body_id).value;
            return this.note_type_is_not_clone_inner_expr(body_expr);
          }
        }
      }
    }
    return expr;
  } else {
    return expr;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2297 is_field_suggestable
FnCtxt.prototype.is_field_suggestable = function (this: FnCtxt, field: FieldDef, span: Span): boolean {
  // The field must be visible in the containing module.
  return (
    Visibility.is_accessible_from(field.vis, this.mod_id, this.tcx) &&
    // The field must not be unstable.
    !(this.tcx.eval_stability(field.did, undefined, DUMMY_SP, undefined).$ === "Deny") &&
    // If the field is from an external crate it must not be `doc(hidden)`.
    (field.did.is_local() || !this.tcx.is_doc_hidden(field.did)) &&
    // If the field is hygienic it must come from the same syntax context.
    Span.eq_ctxt(Span.normalize_to_macros_2_0(unwrap(this.tcx.def_ident_span(field.did))), span)
  );
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2311 suggest_missing_unwrap_expect
FnCtxt.prototype.suggest_missing_unwrap_expect = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  // don't suggest missing `.expect()` or `?` in destructuring assignments LHS.
  // If the immediate parent is an Assign Expr, and the LHS and the RHS of that Expr
  // overlap with each other, it's guaranteed that the expression came from desugaring
  // a destructuring assignment.
  const parent_node = this.tcx.parent_hir_node(expr.hir_id);
  if (parent_node.$ === "Expr" && parent_node._0.kind.$ === "Assign") {
    const [lhs, rhs] = [parent_node._0.kind._0, parent_node._0.kind._1];
    if (HirId_eq(rhs.hir_id, expr.hir_id) && Span.overlaps(lhs.span, rhs.span)) {
      return false;
    }
  }

  const found_kind = found.kind();
  if (found_kind.$ !== "Adt") {
    return false;
  }
  const [adt, args] = [found_kind._0, found_kind._1];
  const ret_ty_matches = (diagnostic_item: Symbol): boolean => {
    const sig = this.fn_sig();
    if (sig === undefined) {
      return false;
    }
    const k = FnSigC.output(sig).kind();
    if (k.$ !== "Adt") {
      return false;
    }
    const kind = k._0;
    return this.tcx.is_diagnostic_item(diagnostic_item, kind.did());
  };

  // don't suggest anything like `Ok(ok_val).unwrap()` , `Some(some_val).unwrap()`,
  // `None.unwrap()` etc.
  const is_ctor_path = (k: hir.ExprKind): boolean =>
    k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined && k._0._1.res.$ === "Def" && k._0._1.res._0.$ === "Ctor";
  const is_ctor = (expr.kind.$ === "Call" && is_ctor_path(expr.kind._0.kind)) || is_ctor_path(expr.kind);

  let article: string, kind: string, variant: string, sugg_operator: boolean;
  if (
    this.tcx.is_diagnostic_item(sym.Result, adt.did()) &&
    // Do not suggest `.expect()` in const context where it's not available. rust-lang/rust#149316
    !this.tcx.hir_is_inside_const_context(expr.hir_id)
  ) {
    [article, kind, variant, sugg_operator] = ["a", "Result", "Err", ret_ty_matches(sym.Result)];
  } else if (this.tcx.is_diagnostic_item(sym.Option, adt.did())) {
    [article, kind, variant, sugg_operator] = ["an", "Option", "None", ret_ty_matches(sym.Option)];
  } else {
    return false;
  }
  const inner_ty = args.type_at(0);

  // For `Option<!>` where `Option<u32>` is expected, extracting `!` cannot produce
  // an `Option<u32>`. Never-to-any coercion alone must not justify `.expect()` or `?`.
  if (is_ctor || !this.may_coerce_except_never(inner_ty, expected)) {
    return false;
  }

  let msg: string, sugg_: string;
  if (sugg_operator) {
    [msg, sugg_] = [
      `use the \`?\` operator to extract the \`${display_Ty(found)}\` value, propagating ${article} \`${kind}::${variant}\` value to the caller`,
      "?",
    ];
  } else {
    [msg, sugg_] = [
      `consider using \`${kind}::expect\` to unwrap the \`${display_Ty(found)}\` value, panicking if the value is ${article} \`${kind}::${variant}\``,
      '.expect("REASON")',
    ];
  }

  let sugg: string;
  const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
  if (shorthand !== undefined && Span.from_expansion(expr.span)) {
    return false;
  } else if (shorthand !== undefined) {
    const ident = shorthand;
    sugg = `: ${Symbol.as_str(ident)}${sugg_}`;
  } else {
    sugg = sugg_;
  }

  const span = Span.find_ancestor_not_from_extern_macro(expr.span, this.tcx.sess.source_map()) ?? expr.span;
  err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, sugg, "HasPlaceholders");
  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2413 suggest_coercing_result_via_try_operator
FnCtxt.prototype.suggest_coercing_result_via_try_operator = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  const returned = (parent.$ === "Expr" && parent._0.kind.$ === "Ret") || this.tcx.hir_get_fn_id_for_return_block(expr.hir_id) !== undefined;
  if (returned) {
    const ek = expected.kind();
    const fk = found.kind();
    if (ek.$ === "Adt" && fk.$ === "Adt") {
      const [e, args_e] = [ek._0, ek._1];
      const [f, args_f] = [fk._0, fk._1];
      if (DefId_eq(e.did(), f.did()) && ((d) => d !== undefined && DefId_eq(e.did(), d))(this.tcx.get_diagnostic_item(sym.Result))) {
        const e_ok = args_e.type_at(0);
        const f_ok = args_f.type_at(0);
        if (this.infcx.can_eq(this.param_env, f_ok, e_ok, ToTrace_Ty)) {
          const e_err = args_e.type_at(1);
          const f_err = args_f.type_at(1);
          if (
            EvaluationResult.must_apply_modulo_regions(
              this.infcx.type_implements_trait(unwrap(this.tcx.get_diagnostic_item(sym.Into)), [f_err, e_err], this.param_env),
            )
          ) {
            err.multipart_suggestion(
              "use `?` to coerce and return an appropriate `Err`, and wrap the resulting value in `Ok` so the expression remains of type `Result`",
              [
                [Span.shrink_to_lo(expr.span), "Ok("],
                [Span.shrink_to_hi(expr.span), "?)"],
              ],
              "MaybeIncorrect",
            );
            return true;
          }
        }
      }
    }
  }
  return false;
};

// If the expr is a while or for loop and is the tail expr of its
// enclosing body suggest returning a value right after it
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2459 suggest_returning_value_after_loop
FnCtxt.prototype.suggest_returning_value_after_loop = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty): boolean {
  const tcx = this.tcx;
  const scope_id = tcx.hir_get_enclosing_scope(expr.hir_id);
  const enclosing_scope = scope_id === undefined ? undefined : tcx.hir_node(scope_id);

  // Get tail expr of the enclosing block or body
  let tail_expr: hir.Expr | undefined;
  if (enclosing_scope !== undefined && enclosing_scope.$ === "Block" && enclosing_scope._0.expr !== undefined) {
    tail_expr = enclosing_scope._0.expr;
  } else {
    const body_def_id = tcx.hir_enclosing_body_owner(expr.hir_id);
    const body = tcx.hir_body_owned_by(body_def_id);

    // Get tail expr of the body
    const k = body.value.kind;
    switch (k.$) {
      // Regular function body etc.
      case "Block":
        tail_expr = k._0.expr;
        break;
      // Anon const body (there's no block in this case)
      case "DropTemps":
        tail_expr = k._0;
        break;
      default:
        tail_expr = undefined;
    }
  }

  if (tail_expr === undefined) {
    return false; // Body doesn't have a tail expr we can compare with
  }

  // Get the loop expr within the tail expr
  let loop_expr_in_tail: hir.Expr;
  if (expr.kind.$ === "Loop" && expr.kind._2 === "While") {
    loop_expr_in_tail = tail_expr;
  } else if (expr.kind.$ === "Loop" && expr.kind._2 === "ForLoop") {
    const peeled = tail_expr.peel_drop_temps();
    if (peeled.kind.$ === "Match" && peeled.kind._1.length === 1) {
      loop_expr_in_tail = peeled.kind._1[0]!.body;
    } else {
      return false; // Not really a for loop
    }
  } else {
    return false; // Not a while or a for loop
  }

  // If the expr is the loop expr in the tail
  // then make the suggestion
  if (HirId_eq(expr.hir_id, loop_expr_in_tail.hir_id)) {
    const span = expr.span;

    let msg: string, suggestion: string;
    if (expected.is_never()) {
      [msg, suggestion] = ["consider adding a diverging expression here", '`loop {}` or `panic!("...")`'];
    } else {
      [msg, suggestion] = ["consider returning a value here", `\`${display_Ty(expected)}\` value`];
    }

    const src_map = tcx.sess.source_map();
    let suggestion_: string;
    if (src_map.is_multiline(expr.span)) {
      const indentation = src_map.indentation_before(span)?.toString() ?? "";
      suggestion_ = `\n${indentation}/* ${suggestion} */`;
    } else {
      // If the entire expr is on a single line
      // put the suggestion also on the same line
      suggestion_ = ` /* ${suggestion} */`;
    }

    err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, suggestion_, "MaybeIncorrect");

    return true;
  } else {
    return false;
  }
};

/// Suggest replacing comma with semicolon in incorrect repeat expressions
/// like `["_", 10]` or `vec![String::new(), 10]`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2543 suggest_semicolon_in_repeat_expr
FnCtxt.prototype.suggest_semicolon_in_repeat_expr = function (this: FnCtxt, err: Diag, expr: hir.Expr, expr_ty: Ty): boolean {
  // Check if `expr` is contained in array of two elements
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (parent.$ === "Expr" && parent._0.kind.$ === "Array" && parent._0.kind._0.length === 2 && HirId_eq(parent._0.kind._0[1]!.hir_id, expr.hir_id)) {
    const array_expr = parent._0;
    const [first, second] = [parent._0.kind._0[0]!, parent._0.kind._0[1]!];
    // Span between the two elements of the array
    const comma_span = Span.between(first.span, second.span);

    // Check if `expr` is a constant value of type `usize`.
    // This can only detect const variable declarations and
    // calls to const functions.

    // Checking this here instead of rustc_hir::hir because
    // this check needs access to `self.tcx` but rustc_hir
    // has no access to `TyCtxt`.
    const expr_is_const_usize =
      expr_ty.is_usize() &&
      ((): boolean => {
        const k = expr.kind;
        if (k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined && k._0._1.res.$ === "Def" && k._0._1.res._0.$ === "Const") {
          return true;
        } else if (k.$ === "Call") {
          const ck = k._0.kind;
          if (ck.$ === "Path" && ck._0.$ === "Resolved" && ck._0._0 === undefined && ck._0._1.res.$ === "Def" && ck._0._1.res._0.$ === "Fn") {
            const fn_def_id = ck._0._1.res._1;
            return this.tcx.is_const_fn(fn_def_id);
          }
          return false;
        } else {
          return false;
        }
      })();

    // Type of the first element is guaranteed to be checked
    // when execution reaches here because `mismatched types`
    // error occurs only when type of second element of array
    // is not the same as type of first element.
    const first_ty = this.typeck_results.expr_ty(first);

    // `array_expr` is from a macro `vec!["a", 10]` if
    // 1. array expression's span is imported from a macro
    // 2. first element of array implements `Clone` trait
    // 3. second element is an integer literal or is an expression of `usize` like type
    if (
      this.tcx.sess.source_map().is_imported(array_expr.span) &&
      this.type_is_clone_modulo_regions(this.param_env, first_ty) &&
      (expr.is_size_lit() || expr_ty.is_usize_like())
    ) {
      err.subdiagnostic(ReplaceCommaWithSemicolon_subdiagnostic({ comma_span, descr: "a vector" }));
      return true;
    }

    // `array_expr` is from an array `["a", 10]` if
    // 1. first element of array implements `Copy` trait
    // 2. second element is an integer literal or is a const value of type `usize`
    if (this.type_is_copy_modulo_regions(this.param_env, first_ty) && (expr.is_size_lit() || expr_is_const_usize)) {
      err.subdiagnostic(ReplaceCommaWithSemicolon_subdiagnostic({ comma_span, descr: "an array" }));
      return true;
    }
  }
  return false;
};

/// If the expected type is an enum (Issue #55250) with any variants whose
/// sole field is of the found type, suggest such variants. (Issue #42764)
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2624 suggest_compatible_variants
FnCtxt.prototype.suggest_compatible_variants = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean {
  if (Span.in_external_macro(expr.span, this.tcx.sess.source_map())) {
    return false;
  }
  const expected_kind = expected.kind();
  if (expected_kind.$ === "Adt") {
    const [expected_adt, args] = [expected_kind._0, expected_kind._1];
    if (expr.kind.$ === "Field") {
      const [base, ident] = [expr.kind._0, expr.kind._1];
      const base_ty = this.typeck_results.expr_ty(base);
      if (this.can_eq(this.param_env, base_ty, expected, ToTrace_Ty)) {
        const base_span = Span.find_ancestor_inside(base.span, expr.span);
        if (base_span !== undefined) {
          err.span_suggestion_verbose(
            Span.with_lo(expr.span, Span.hi(base_span)),
            `consider removing the tuple struct field \`${display_Ident(ident)}\``,
            "",
            "MaybeIncorrect",
          );
          return true;
        }
      }
    }

    // If the expression is of type () and it's the return expression of a block,
    // we suggest adding a separate return expression instead.
    // (To avoid things like suggesting `Ok(while .. { .. })`.)
    if (expr_ty.is_unit()) {
      let id = expr.hir_id;
      let parent: HirId;

      // Unroll desugaring, to make sure this works for `for` loops etc.
      for (;;) {
        parent = this.tcx.parent_hir_id(id);
        const parent_span = this.tcx.hir_span(parent);
        if (Span.find_ancestor_inside(parent_span, expr.span) !== undefined) {
          // The parent node is part of the same span, so is the result of the
          // same expansion/desugaring and not the 'real' parent node.
          id = parent;
          continue;
        }
        break;
      }

      const parent_node = this.tcx.hir_node(parent);
      if (parent_node.$ === "Block" && parent_node._0.expr !== undefined) {
        const [block_span, e] = [parent_node._0.span, parent_node._0.expr];
        if (HirId_eq(e.hir_id, id)) {
          const span = Span.find_ancestor_inside(expr.span, block_span);
          if (span !== undefined) {
            let return_suggestions: string[];
            if (this.tcx.is_diagnostic_item(sym.Result, expected_adt.did())) {
              return_suggestions = ["Ok(())"];
            } else if (this.tcx.is_diagnostic_item(sym.Option, expected_adt.did())) {
              return_suggestions = ["None", "Some(())"];
            } else {
              return false;
            }
            const indent = this.tcx.sess.source_map().indentation_before(Span.shrink_to_lo(span));
            if (indent !== undefined) {
              // Add a semicolon, except after `}`.
              const snippet = this.tcx.sess.source_map().span_to_snippet(span);
              const semicolon = snippet.$ === "Ok" && snippet._0.toString().endsWith("}") ? "" : ";";
              err.span_suggestions(
                Span.shrink_to_hi(span),
                "try adding an expression at the end of the block",
                return_suggestions.map((r) => `${semicolon}\n${indent.toString()}${r}`),
                "MaybeIncorrect",
              );
            }
            return true;
          }
        }
      }
    }

    const compatible_variants: [string, CtorKind | undefined, Symbol, string | undefined][] = [];
    for (const variant of expected_adt.variants()) {
      if (!(variant.fields.length === 1)) {
        continue;
      }
      const sole_field = variant.single_field();

      // When expected_ty and expr_ty are the same ADT, we prefer to compare their internal generic params,
      // When the current variant has a sole field whose type is still an unresolved inference variable,
      // suggestions would be often wrong. So suppress the suggestion. See #145294.
      const [ek, ak] = [expected.kind(), expr_ty.kind()];
      if (ek.$ === "Adt" && ak.$ === "Adt" && DefId_eq(ek._0.did(), ak._0.did()) && Unnormalized.skip_norm_wip(sole_field.ty(this.tcx, args)).is_ty_var()) {
        continue;
      }

      const field_is_local = sole_field.did.is_local();
      const field_is_accessible =
        Visibility.is_accessible_from(sole_field.vis, expr.hir_id.owner.def_id, this.tcx) &&
        // Skip suggestions for unstable public fields (for example `Pin::__pointer`)
        ((): boolean => {
          const r = this.tcx.eval_stability(sole_field.did, undefined, expr.span, undefined);
          return r.$ === "Allow" || r.$ === "Unmarked";
        })();

      if (!field_is_local && !field_is_accessible) {
        continue;
      }

      const note_about_variant_field_privacy =
        field_is_local && !field_is_accessible ? " (its field is private, but it's local to this crate and its privacy can be changed)" : undefined;

      const sole_field_ty = Unnormalized.skip_norm_wip(sole_field.ty(this.tcx, args));
      if (this.may_coerce(expr_ty, sole_field_ty)) {
        const variant_path = with_types_for_suggestion(() => with_no_trimmed_paths(() => this.tcx.def_path_str(variant.def_id)));
        // FIXME #56861: DRYer prelude filtering
        if (variant_path.startsWith("std::prelude::")) {
          const path = variant_path.slice("std::prelude::".length);
          const idx = path.indexOf("::");
          if (idx !== -1) {
            const path_ = path.slice(idx + 2);
            compatible_variants.push([path_, variant.ctor_kind(), sole_field.name, note_about_variant_field_privacy]);
            continue;
          }
        }
        compatible_variants.push([variant_path, variant.ctor_kind(), sole_field.name, note_about_variant_field_privacy]);
      }
    }

    const suggestions_for = (variant: string, ctor_kind: CtorKind | undefined, field_name: Symbol): [Span, string][] => {
      const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

      let open: string, close: string;
      if (ctor_kind === "Fn") {
        [open, close] = ["(", ")"];
      } else if (ctor_kind === undefined) {
        [open, close] = [` { ${Symbol.as_str(field_name)}: `, " }"];
      } else {
        return unreachable("unit variants don't have fields");
      }

      // Suggest constructor as deep into the block tree as possible,
      // but don't cross macro contexts. This fixes #101065 while
      // keeping suggestions out of macro definitions (#142359).
      let expr_ = expr;
      while (expr_.kind.$ === "Block" && expr_.kind._0.expr !== undefined && Span.eq_ctxt(expr_.kind._0.expr.span, expr_.span)) {
        expr_ = expr_.kind._0.expr;
      }

      return [
        [Span.shrink_to_lo(expr_.span), `${prefix}${variant}${open}`],
        [Span.shrink_to_hi(expr_.span), close],
      ];
    };

    if (compatible_variants.length === 0) {
      /* No variants to format */
    } else if (compatible_variants.length === 1) {
      const [variant, ctor_kind, field_name, note] = compatible_variants[0]!;
      // Just a single matching variant.
      err.multipart_suggestion(
        `try wrapping the expression in \`${variant}\`${note ?? ""}`,
        suggestions_for(variant, ctor_kind, field_name),
        "MaybeIncorrect",
      );
      return true;
    } else {
      // More than one matching variant.
      err.multipart_suggestions(
        `try wrapping the expression in a variant of \`${this.tcx.def_path_str(expected_adt.did())}\``,
        compatible_variants.map(([variant, ctor_kind, field_name, _]) => suggestions_for(variant, ctor_kind, field_name)),
        "MaybeIncorrect",
      );
      return true;
    }
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2824 suggest_non_zero_new_unwrap
FnCtxt.prototype.suggest_non_zero_new_unwrap = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean {
  const tcx = this.tcx;
  const ek = expected.kind();
  let adt: AdtDef, args: GenericArgs, unwrap_: string;
  if (ek.$ === "Adt" && tcx.is_diagnostic_item(sym.Option, ek._0.did())) {
    // In case `Option<NonZero<T>>` is wanted, but `T` is provided, suggest calling `new`.
    const nonzero_type = ek._1.type_at(0); // Unwrap option type.
    const nk = nonzero_type.kind();
    if (nk.$ !== "Adt") {
      return false;
    }
    [adt, args, unwrap_] = [nk._0, nk._1, ""];
  } else if (ek.$ === "Adt") {
    // In case `NonZero<T>` is wanted but `T` is provided, also add `.unwrap()` to satisfy types.
    [adt, args, unwrap_] = [ek._0, ek._1, ".unwrap()"];
  } else {
    return false;
  }

  if (!this.tcx.is_diagnostic_item(sym.NonZero, adt.did())) {
    return false;
  }

  const int_type = args.type_at(0);
  if (!this.may_coerce(expr_ty, int_type)) {
    return false;
  }

  err.multipart_suggestion(
    `consider calling \`${Symbol.as_str(sym.NonZero)}::new\``,
    [
      [Span.shrink_to_lo(expr.span), `${Symbol.as_str(sym.NonZero)}::new(`],
      [Span.shrink_to_hi(expr.span), `)${unwrap_}`],
    ],
    "MaybeIncorrect",
  );

  return true;
};

/// Identify some cases where `as_ref()` or `as_mut()` would be appropriate and suggest it.
///
/// Given the following code:
/// ```compile_fail,E0308
/// struct Foo;
/// fn takes_ref(_: &Foo) {}
/// let ref opt = Some(Foo);
///
/// opt.map(|param| takes_ref(param));
/// ```
/// Suggest using `opt.as_ref().map(|param| takes_ref(param));` instead.
///
/// It only checks for `Option` and `Result` and won't work with
/// ```ignore (illustrative)
/// opt.map(|param| { takes_ref(param) });
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2883 can_use_as_ref_or_mut
FnCtxt.prototype.can_use_as_ref_or_mut = function (this: FnCtxt, expr: hir.Expr, mutability: Mutability): [[Span, string][], string] | undefined {
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved")) {
    return undefined;
  }
  const path = expr.kind._0._1;

  if (path.res.$ !== "Local") {
    return undefined;
  }
  const local_id = path.res._0;

  const param_node = this.tcx.parent_hir_node(local_id);
  if (param_node.$ !== "Param") {
    return undefined;
  }
  const param_hir_id = param_node._0.hir_id;

  const closure_node = this.tcx.parent_hir_node(param_hir_id);
  if (!(closure_node.$ === "Expr" && closure_node._0.kind.$ === "Closure")) {
    return undefined;
  }
  const expr_hir_id = closure_node._0.hir_id;
  const closure_fn_decl = closure_node._0.kind._0.fn_decl;

  const hir_ = this.tcx.parent_hir_node(expr_hir_id);
  const closure_params_len = closure_fn_decl.inputs.length;
  if (!(hir_.$ === "Expr" && hir_._0.kind.$ === "MethodCall" && closure_params_len === 1)) {
    return undefined;
  }
  const [method_path, receiver] = [hir_._0.kind._0, hir_._0.kind._1];

  let self_ty = this.typeck_results.expr_ty_opt(receiver);
  if (self_ty === undefined) {
    return undefined;
  }
  for (let k = self_ty.kind(); k.$ === "Ref"; k = self_ty.kind()) {
    const [inner, ref_mutability] = [k._1, k._2];
    // `as_mut()` cannot borrow through a shared reference,
    // also we cannot suggest `as_ref()` either when the reference is shared
    if (Mutability.is_mut(mutability) && Mutability.is_not(ref_mutability)) {
      return undefined;
    }
    self_ty = inner;
  }
  const name = method_path.ident.name;
  const sk = self_ty.kind();
  let can_borrow: boolean;
  if (sk.$ === "Adt") {
    const def = sk._0;
    can_borrow =
      (this.tcx.is_diagnostic_item(sym.Option, def.did()) || this.tcx.is_diagnostic_item(sym.Result, def.did())) &&
      (name === sym.map || name === sym.and_then);
  } else {
    can_borrow = false;
  }
  if (can_borrow) {
    let suggestion: string, message: string;
    switch (mutability) {
      case "Not":
        [suggestion, message] = ["as_ref().", "consider using `as_ref` instead"];
        break;
      case "Mut":
        [suggestion, message] = ["as_mut().", "consider using `as_mut` instead"];
        break;
    }
    return [[[Span.shrink_to_lo(method_path.ident.span), suggestion]], message];
  } else {
    return undefined;
  }
};

/// This function is used to determine potential "simple" improvements or users' errors and
/// provide them useful help. For example:
///
/// ```compile_fail,E0308
/// fn some_fn(s: &str) {}
///
/// let x = "hey!".to_owned();
/// some_fn(x); // error
/// ```
///
/// No need to find every potential function which could make a coercion to transform a
/// `String` into a `&str` since a `&` would do the trick!
///
/// In addition of this check, it also checks between references mutability state. If the
/// expected is mutable but the provided isn't, maybe we could just say "Hey, try with
/// `&mut`!".
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2969 suggest_deref_or_ref
FnCtxt.prototype.suggest_deref_or_ref = function (
  this: FnCtxt,
  expr_: hir.Expr,
  checked_ty: Ty,
  expected: Ty,
): [[Span, string][], string, Applicability, boolean /* suggest `&` or `&mut` type annotation */] | undefined {
  const sess = this.sess();
  const sp = expr_.range_span() ?? expr_.span;
  const sm = sess.source_map();

  // If the span is from an external macro, there's no suggestion we can make.
  if (Span.in_external_macro(sp, sm)) {
    return undefined;
  }

  const replace_prefix = (s: string, old: string, new_: string): string | undefined => (s.startsWith(old) ? new_ + s.slice(old.length) : undefined);

  // `ExprKind::DropTemps` is semantically irrelevant for these suggestions.
  const expr = expr_.peel_drop_temps();
  const ek = expected.kind();
  const ck = checked_ty.kind();
  // Handle call arguments that need another shared or mutable reference, such as
  // `&T` to `&&T` or `&T` to `&mut &T`.
  // Keep ordinary `T` to `&T` cases on later path so its more
  // specific suggestions, such as `Option::as_ref()`, are preserved.
  if (
    ek.$ === "Ref" &&
    ek._1.is_ref() &&
    ((): boolean => {
      const parent = this.tcx.parent_hir_node(expr.hir_id);
      if (parent.$ !== "Expr") {
        return false;
      }
      const pk = parent._0.kind;
      const args = pk.$ === "Call" ? pk._1 : pk.$ === "MethodCall" ? pk._2 : undefined;
      return args !== undefined && args.some((arg) => HirId_eq(arg.hir_id, expr.hir_id));
    })() &&
    this.can_eq(this.param_env, ek._1, checked_ty, ToTrace_Ty)
  ) {
    const mutability = ek._2;
    const borrow = Mutability.ref_prefix_str(mutability);
    let sugg: [Span, string][];
    if (expr_needs_parens(expr)) {
      sugg = [
        [Span.shrink_to_lo(sp), `${borrow}(`],
        [Span.shrink_to_hi(sp), ")"],
      ];
    } else {
      sugg = [[Span.shrink_to_lo(sp), borrow]];
    }
    return [sugg, `consider ${Mutability.mutably_str(mutability)}borrowing here`, "MachineApplicable", false];
  } else if (ek.$ === "Ref" && ck.$ === "Ref") {
    const [exp, check] = [ek._1, ck._1];
    const [xk, kk] = [exp.kind(), check.kind()];
    if (xk.$ === "Str" && (kk.$ === "Array" || kk.$ === "Slice") && kk._0 === this.tcx.types.u8) {
      if (expr.kind.$ === "Lit") {
        const src = sm.span_to_snippet(sp);
        if (src.$ === "Ok" && replace_prefix(src._0.toString(), 'b"', '"') !== undefined) {
          const pos = BytePos(Span.lo(sp) + 1);
          return [[[Span.with_hi(sp, pos), ""]], "consider removing the leading `b`", "MachineApplicable", false];
        }
      }
    } else if ((xk.$ === "Array" || xk.$ === "Slice") && kk.$ === "Str" && xk._0 === this.tcx.types.u8) {
      if (expr.kind.$ === "Lit") {
        const src = sm.span_to_snippet(sp);
        if (src.$ === "Ok" && replace_prefix(src._0.toString(), '"', 'b"') !== undefined) {
          return [[[Span.shrink_to_lo(sp), "b"]], "consider adding a leading `b`", "MachineApplicable", false];
        }
      }
    }
  } else if (ek.$ === "Ref") {
    const mutability = ek._2;
    // Check if it can work when put into a ref. For example:
    //
    // ```
    // fn bar(x: &mut i32) {}
    //
    // let x = 0u32;
    // bar(&x); // error, expected &mut
    // ```
    let ref_ty: Ty;
    switch (mutability) {
      case "Mut":
        ref_ty = Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_static, checked_ty);
        break;
      case "Not":
        ref_ty = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_static, checked_ty);
        break;
    }
    if (this.may_coerce(ref_ty, expected)) {
      let sugg_sp = sp;
      if (expr.kind.$ === "MethodCall") {
        const [segment, receiver, args] = [expr.kind._0, expr.kind._1, expr.kind._2];
        const clone_trait = this.tcx.require_lang_item(LangItem.Clone, segment.ident.span);
        if (
          args.length === 0 &&
          is_some_and(this.typeck_results.type_dependent_def_id(expr.hir_id), (did) => {
            const ai = this.tcx.associated_item(did) as AssocItemT;
            const tc = AssocItem.trait_container(ai, this.tcx);
            return tc !== undefined && DefId_eq(tc, clone_trait);
          }) &&
          segment.ident.name === sym.clone
        ) {
          // If this expression had a clone call when suggesting borrowing
          // we want to suggest removing it because it'd now be unnecessary.
          sugg_sp = receiver.span;
        }
      }

      if (expr.kind.$ === "Unary" && expr.kind._0 === "Deref") {
        const inner = expr.kind._1;
        if (this.deref_steps_for_suggestion(expected, checked_ty) === 1 && this.typeck_results.expr_ty(inner).is_ref()) {
          // We have `*&T`, check if what was expected was `&T`.
          // If so, we may want to suggest removing a `*`.
          sugg_sp = Span.with_hi(sugg_sp, Span.lo(inner.span));
          return [[[sugg_sp, ""]], "consider removing deref here", "MachineApplicable", false];
        }
      }

      // Don't try to suggest ref/deref on an `if` expression, because:
      // - The `if` could be part of a desugared `if else` statement,
      //   which would create impossible suggestions such as `if ... { ... } else &if { ... } else { ... }`.
      // - In general the suggestions it creates such as `&if ... { ... } else { ... }` are not very helpful.
      // We try to generate a suggestion such as `if ... { &... } else { &... }` instead.
      if (expr.kind.$ === "If") {
        const [_c, then_, els] = [expr.kind._0, expr.kind._1, expr.kind._2];
        // The `then` of a `Expr::If` always contains a block, and that block may have a final expression that we can borrow
        // If the block does not have a final expression, it will return () and we do not make a suggestion to borrow that.
        if (then_.kind.$ !== "Block") {
          return undefined;
        }
        const then = then_.kind._0.expr;
        if (then === undefined) {
          return undefined;
        }
        const r = this.suggest_deref_or_ref(then, checked_ty, expected);
        if (r === undefined) {
          return undefined;
        }
        const [suggs, help, app, mutref] = r;

        // If there is no `else`, the return type of this `if` will be (), so suggesting to change the `then` block is useless
        if (els === undefined) {
          return undefined;
        }
        let els_expr: hir.Expr;
        if (els.kind.$ === "Block") {
          if (els.kind._0.expr === undefined) {
            return undefined;
          }
          els_expr = els.kind._0.expr;
        } else {
          els_expr = els;
        }
        const r2 = this.suggest_deref_or_ref(els_expr, checked_ty, expected);
        if (r2 === undefined) {
          return undefined;
        }
        const [else_suggs] = r2;
        suggs.push(...else_suggs);

        return [suggs, help, app, mutref];
      }

      const as_ref = this.can_use_as_ref_or_mut(expr, mutability);
      if (as_ref !== undefined) {
        const [sugg, msg] = as_ref;
        return [sugg, msg, "MachineApplicable", false];
      }

      const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

      const assign_parent = this.tcx.parent_hir_node(expr.hir_id);
      if (assign_parent.$ === "Expr" && assign_parent._0.kind.$ === "Assign") {
        if (Mutability.is_mut(mutability)) {
          // Suppressing this diagnostic, we'll properly print it in `check_expr_assign`
          return undefined;
        }
      }

      const make_sugg = (expr: hir.Expr, span: Span, sugg: string): [Span, string][] => {
        if (expr_needs_parens(expr)) {
          return [
            [Span.shrink_to_lo(span), `${prefix}${sugg}(`],
            [Span.shrink_to_hi(span), ")"],
          ];
        } else {
          return [[Span.shrink_to_lo(span), `${prefix}${sugg}`]];
        }
      };

      // Suggest dereferencing the lhs for expressions such as `&T <= T`
      const bin_parent = this.tcx.parent_hir_node(expr.hir_id);
      if (bin_parent.$ === "Expr" && bin_parent._0.kind.$ === "Binary") {
        const lhs = bin_parent._0.kind._1;
        if (this.check_expr(lhs).kind().$ === "Ref") {
          const sugg = make_sugg(lhs, lhs.span, "*");

          return [sugg, "consider dereferencing the borrow", "MachineApplicable", false];
        }
      }

      const sugg_str = Mutability.ref_prefix_str(mutability);
      const sugg = make_sugg(expr, sp, sugg_str);
      return [sugg, `consider ${Mutability.mutably_str(mutability)}borrowing here`, "MachineApplicable", false];
    }
  } else if (
    expr.kind.$ === "AddrOf" &&
    expr.kind._0 === "Ref" &&
    ck.$ === "Ref" &&
    this.can_eq(this.param_env, ck._1, expected, ToTrace_Ty)
  ) {
    const inner_expr = expr.kind._2;
    const make_sugg = (start: Span, end: BytePos): [[Span, string][], string, Applicability, boolean] | undefined => {
      // skip `(` for tuples such as `(c) = (&123)`.
      // make sure we won't suggest like `(c) = 123)` which is incorrect.
      const extended = sm.span_extend_while(Span.shrink_to_lo(start), (c) => c === C_LPAREN || is_whitespace(c));
      const sp = extended.$ === "Ok" ? Span.shrink_to_hi(extended._0) : start;
      return [[[Span.with_hi(sp, end), ""]], "consider removing the borrow", "MachineApplicable", true];
    };

    // We have `&T`, check if what was expected was `T`. If so,
    // we may want to suggest removing a `&`.
    if (sm.is_imported(inner_expr.span)) {
      // Go through the spans from which this span was expanded,
      // and find the one that's pointing inside `sp`.
      //
      // E.g. for `&format!("")`, where we want the span to the
      // `format!()` invocation instead of its expansion.
      let call_span: Span | undefined;
      for (let s: Span | undefined = inner_expr.span; s !== undefined; s = Span.parent_callsite(s)) {
        if (Span.contains(sp, s)) {
          call_span = s;
          break;
        }
      }
      if (call_span !== undefined && sm.is_span_accessible(call_span)) {
        return make_sugg(sp, Span.lo(call_span));
      }
      return undefined;
    }
    if (Span.contains(sp, inner_expr.span) && sm.is_span_accessible(inner_expr.span)) {
      return make_sugg(sp, Span.lo(inner_expr.span));
    }
  } else if (ek.$ === "RawPtr" && ck.$ === "Ref") {
    const [ty_b, mutbl_b] = [ek._0, ek._1];
    const [ty_a, mutbl_a] = [ck._1, ck._2];
    const steps = this.deref_steps_for_suggestion(ty_a, ty_b);
    if (
      steps !== undefined &&
      // Only suggest valid if dereferencing needed.
      steps > 0
    ) {
      // The pointer type implements `Copy` trait so the suggestion is always valid.
      const src = sm.span_to_snippet(sp);
      if (src.$ === "Ok") {
        const derefs = "*".repeat(steps);
        const old_prefix = Mutability.ref_prefix_str(mutbl_a);
        const new_prefix = Mutability.ref_prefix_str(mutbl_b) + derefs;

        let suggestion: [Span, string, Applicability] | undefined;
        if (replace_prefix(src._0.toString(), old_prefix, new_prefix) !== undefined) {
          // skip `&` or `&mut ` if both mutabilities are mutable
          const lo = BytePos(Span.lo(sp) + Math.min(utf8_len(old_prefix), utf8_len(Mutability.ref_prefix_str(mutbl_b))));
          // skip `&` or `&mut `
          const hi = BytePos(Span.lo(sp) + utf8_len(old_prefix));
          const sp_ = Span.with_hi(Span.with_lo(sp, lo), hi);

          suggestion = [
            sp_,
            `${mutbl_a !== mutbl_b ? Mutability.prefix_str(mutbl_b) : ""}${derefs}`,
            Mutability_cmp(mutbl_b, mutbl_a) <= 0 ? "MachineApplicable" : "MaybeIncorrect",
          ];
        }

        if (suggestion !== undefined) {
          const [span, src_, applicability] = suggestion;
          return [[[span, src_]], "consider dereferencing", applicability, false];
        }
      }
    }
  } else if (sp === expr.span) {
    let steps = this.deref_steps_for_suggestion(checked_ty, expected);
    if (steps !== undefined) {
      let expr_ = expr.peel_blocks();
      let prefix_span = Span.shrink_to_lo(expr_.span);
      let remove = "";

      // Try peeling off any existing `&` and `&mut` to reach our target type
      while (steps > 0) {
        if (expr_.kind.$ === "AddrOf") {
          const [mutbl, inner] = [expr_.kind._1, expr_.kind._2];
          // If the expression has `&`, removing it would fix the error
          prefix_span = Span.with_hi(prefix_span, Span.lo(inner.span));
          expr_ = inner;
          remove += Mutability.ref_prefix_str(mutbl);
          steps -= 1;
        } else {
          break;
        }
      }
      // If we've reached our target type with just removing `&`, then just print now.
      if (steps === 0 && remove.trim().length !== 0) {
        return [
          [[prefix_span, ""]],
          `consider removing the \`${remove.trim()}\``,
          // Do not remove `&&` to get to bool, because it might be something like
          // { a } && b, which we have a separate fixup suggestion that is more
          // likely correct...
          remove.trim() === "&&" && expected === this.tcx.types.bool ? "MaybeIncorrect" : "MachineApplicable",
          false,
        ];
      }

      // For this suggestion to make sense, the type would need to be `Copy`,
      // or we have to be moving out of a `Box<T>`
      if (
        this.type_is_copy_modulo_regions(this.param_env, expected) ||
        // FIXME(compiler-errors): We can actually do this if the checked_ty is
        // `steps` layers of boxes, not just one, but this is easier and most likely.
        (checked_ty.is_box() && steps === 1) ||
        // We can always deref a binop that takes its arguments by ref.
        ((): boolean => {
          const parent = this.tcx.parent_hir_node(expr_.hir_id);
          return parent.$ === "Expr" && parent._0.kind.$ === "Binary" && !BinOpKind.is_by_value(parent._0.kind._0.node);
        })()
      ) {
        let deref_kind: string;
        if (checked_ty.is_box()) {
          // detect Box::new(..)
          if (expr_.kind.$ === "Call" && expr_.kind._1.length === 1) {
            const box_new = expr_.kind._0;
            if (box_new.kind.$ === "Path") {
              const qpath = box_new.kind._0;
              const res = this.typeck_results.qpath_res(qpath, box_new.hir_id);
              if (res.$ === "Def" && res._0.$ === "AssocFn" && this.tcx.is_diagnostic_item(sym.box_new, res._1)) {
                const l_paren = this.tcx.sess.source_map().next_point(box_new.span);
                const r_paren = this.tcx.sess.source_map().end_point(expr_.span);
                return [
                  [
                    [Span.to(box_new.span, l_paren), ""],
                    [r_paren, ""],
                  ],
                  "consider removing the Box",
                  "MachineApplicable",
                  false,
                ];
              }
            }
          }
          deref_kind = "unboxing the value";
        } else if (checked_ty.is_ref()) {
          deref_kind = "dereferencing the borrow";
        } else {
          deref_kind = "dereferencing the type";
        }

        // Suggest removing `&` if we have removed any, otherwise suggest just
        // dereferencing the remaining number of steps.
        const message = remove.length === 0 ? `consider ${deref_kind}` : `consider removing the \`${remove.trim()}\` and ${deref_kind} instead`;

        const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr_);
        const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

        let span: Span, suggestion: string;
        if (this.is_else_if_block(expr_)) {
          // Don't suggest nonsense like `else *if`
          return undefined;
        } else {
          const block_expr = this.maybe_get_block_expr(expr_);
          if (block_expr !== undefined) {
            // prefix should be empty here..
            [span, suggestion] = [Span.shrink_to_lo(block_expr.span), "*"];
          } else {
            [span, suggestion] = [prefix_span, `${prefix}${"*".repeat(steps)}`];
          }
        }
        if (suggestion.trim().length === 0) {
          return undefined;
        }

        if (expr_needs_parens(expr_)) {
          return [
            [
              [span, `${suggestion}(`],
              [Span.shrink_to_hi(expr_.span), ")"],
            ],
            message,
            "MachineApplicable",
            false,
          ];
        }

        return [[[span, suggestion]], message, "MachineApplicable", false];
      }
    }
  }
  return undefined;
};

/// Returns whether the given expression is an `else if`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3413 is_else_if_block
FnCtxt.prototype.is_else_if_block = function (this: FnCtxt, expr: hir.Expr): boolean {
  if (expr.kind.$ === "If") {
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "If" && parent._0.kind._2 !== undefined) {
      const else_expr = parent._0.kind._2;
      return HirId_eq(else_expr.hir_id, expr.hir_id);
    }
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3423 suggest_cast
FnCtxt.prototype.suggest_cast = function (this: FnCtxt, err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty, expected_ty_expr: hir.Expr | undefined): boolean {
  if (this.tcx.sess.source_map().is_imported(expr.span)) {
    // Ignore if span is from within a macro.
    return false;
  }

  const span = expr.kind.$ === "Lit" ? expr.kind._0.span : expr.span;
  const src_r = this.tcx.sess.source_map().span_to_snippet(span);
  if (src_r.$ !== "Ok") {
    return false;
  }
  const src = src_r._0.toString();

  // If casting this expression to a given numeric type would be appropriate in case of a type
  // mismatch.
  //
  // We want to minimize the amount of casting operations that are suggested, as it can be a
  // lossy operation with potentially bad side effects, so we only suggest when encountering
  // an expression that indicates that the original type couldn't be directly changed.
  //
  // For now, don't suggest casting with `as`.
  const can_cast = false;

  const sugg: [Span, string][] = [];

  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (parent.$ === "ExprField") {
    const field = parent._0;
    // `expr` is a literal field for a struct, only suggest if appropriate
    if (field.is_shorthand) {
      // This is a field literal
      sugg.push([Span.shrink_to_lo(field.ident.span), `${display_Ident(field.ident)}: `]);
    } else {
      // Likely a field was meant, but this field wasn't found. Do not suggest anything.
      return false;
    }
  }

  if (expr.kind.$ === "Call") {
    const [path, args] = [expr.kind._0, expr.kind._1];
    if (path.kind.$ === "Path" && path.kind._0.$ === "TypeRelative" && args.length === 1) {
      const [base_ty, path_segment] = [path.kind._0._0, path.kind._0._1];
      // `expr` is a conversion like `u32::from(val)`, do not suggest anything (#63697).
      if (base_ty.kind.$ === "Path" && base_ty.kind._0.$ === "Resolved" && base_ty.kind._0._0 === undefined && path_segment.ident.name === sym.from) {
        const base_ty_path = base_ty.kind._0._1;
        const first = base_ty_path.segments[0];
        if (first !== undefined) {
          const ident = first.ident;
          switch (ident.name) {
            case sym.i128:
            case sym.i64:
            case sym.i32:
            case sym.i16:
            case sym.i8:
            case sym.u128:
            case sym.u64:
            case sym.u32:
            case sym.u16:
            case sym.u8:
            case sym.isize:
            case sym.usize:
              if (base_ty_path.segments.length === 1) {
                return false;
              }
              break;
            default:
              break;
          }
        }
      }
    }
  }

  const msg = `you can convert ${Article_TyKind.article(checked_ty.kind())} \`${display_Ty(checked_ty)}\` to ${Article_TyKind.article(expected_ty.kind())} \`${display_Ty(expected_ty)}\``;
  const cast_msg = `you can cast ${Article_TyKind.article(checked_ty.kind())} \`${display_Ty(checked_ty)}\` to ${Article_TyKind.article(expected_ty.kind())} \`${display_Ty(expected_ty)}\``;
  const lit_msg = `change the type of the numeric literal from \`${display_Ty(checked_ty)}\` to \`${display_Ty(expected_ty)}\``;

  let close_paren: string;
  if (ExprPrecedence_discriminant[this.precedence(expr)] < ExprPrecedence_discriminant["Unambiguous"]) {
    sugg.push([Span.shrink_to_lo(expr.span), "("]);
    close_paren = ")";
  } else {
    close_paren = "";
  }

  const cast_suggestion: [Span, string][] = [...sugg];
  cast_suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren} as ${display_Ty(expected_ty)}`]);
  const into_suggestion: [Span, string][] = [...sugg];
  into_suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren}.into()`]);
  const suffix_suggestion: [Span, string][] = [...sugg];
  {
    const [ek, ck] = [expected_ty.kind(), checked_ty.kind()];
    let suffix_span: Span;
    if ((ek.$ === "Int" || ek.$ === "Uint") && ck.$ === "Float") {
      // Remove fractional part from literal, for example `42.0f32` into `42`
      const src_ = trim_end_matches(src, display_Ty(checked_ty));
      const len = utf8_len(src_.split(".")[0]!);
      suffix_span = Span.with_lo(span, BytePos(Span.lo(span) + len));
    } else {
      const len = utf8_len(trim_end_matches(src, display_Ty(checked_ty)));
      suffix_span = Span.with_lo(span, BytePos(Span.lo(span) + len));
    }
    suffix_suggestion.push([
      suffix_span,
      ExprPrecedence_discriminant[this.precedence(expr)] < ExprPrecedence_discriminant["Unambiguous"]
        ? // Readd `)`
          `${display_Ty(expected_ty)})`
        : display_Ty(expected_ty),
    ]);
  }
  const literal_is_ty_suffixed = (expr: hir.Expr): boolean => {
    if (expr.kind.$ === "Lit") {
      return LitKind.is_suffixed(expr.kind._0.node);
    } else {
      return false;
    }
  };
  const is_negative_int = (expr: hir.Expr): boolean => expr.kind.$ === "Unary" && expr.kind._0 === "Neg";
  const is_uint = (ty: Ty): boolean => ty.kind().$ === "Uint";

  const in_const_context = this.tcx.hir_is_inside_const_context(expr.hir_id);

  const suggest_fallible_into_or_lhs_from = (err: Diag, exp_to_found_is_fallible: boolean): void => {
    // If we know the expression the expected type is derived from, we might be able
    // to suggest a widening conversion rather than a narrowing one (which may
    // panic). For example, given x: u8 and y: u32, if we know the span of "x",
    //   x > y
    // can be given the suggestion "u32::from(x) > y" rather than
    // "x > y.try_into().unwrap()".
    let lhs_expr_and_src: [hir.Expr, string] | undefined;
    if (expected_ty_expr !== undefined) {
      const s = this.tcx.sess.source_map().span_to_snippet(expected_ty_expr.span);
      lhs_expr_and_src = s.$ === "Ok" ? [expected_ty_expr, s._0.toString()] : undefined;
    }
    let msg_: string, suggestion: [Span, string][];
    if (lhs_expr_and_src !== undefined && !exp_to_found_is_fallible) {
      const [lhs_expr, lhs_src] = lhs_expr_and_src;
      msg_ = `you can convert \`${lhs_src}\` from \`${display_Ty(expected_ty)}\` to \`${display_Ty(checked_ty)}\`, matching the type of \`${src}\``;
      suggestion = [
        [Span.shrink_to_lo(lhs_expr.span), `${display_Ty(checked_ty)}::from(`],
        [Span.shrink_to_hi(lhs_expr.span), ")"],
      ];
    } else {
      msg_ = `${msg} and panic if the converted value doesn't fit`;
      suggestion = [...sugg];
      suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren}.try_into().unwrap()`]);
    }
    err.multipart_suggestion(msg_, suggestion, "MachineApplicable");
  };

  const suggest_to_change_suffix_or_into = (err: Diag, found_to_exp_is_fallible: boolean, exp_to_found_is_fallible: boolean): void => {
    const exp_is_lhs = expected_ty_expr !== undefined && this.tcx.hir_is_lhs(expected_ty_expr.hir_id);

    if (exp_is_lhs) {
      return;
    }

    const always_fallible = found_to_exp_is_fallible && (exp_to_found_is_fallible || expected_ty_expr === undefined);
    let msg_: string;
    if (literal_is_ty_suffixed(expr)) {
      msg_ = lit_msg;
    } else if (always_fallible && is_negative_int(expr) && is_uint(expected_ty)) {
      // We now know that converting either the lhs or rhs is fallible. Before we
      // suggest a fallible conversion, check if the value can never fit in the
      // expected type.
      const msg = `\`${src}\` cannot fit into type \`${display_Ty(expected_ty)}\``;
      err.note(msg);
      return;
    } else if (in_const_context) {
      // Do not recommend `into` or `try_into` in const contexts.
      return;
    } else if (found_to_exp_is_fallible) {
      return suggest_fallible_into_or_lhs_from(err, exp_to_found_is_fallible);
    } else {
      msg_ = msg;
    }
    const suggestion = literal_is_ty_suffixed(expr) ? [...suffix_suggestion] : [...into_suggestion];
    err.multipart_suggestion(msg_, suggestion, "MachineApplicable");
  };

  const ek = expected_ty.kind();
  const ck = checked_ty.kind();
  if (ek.$ === "Int" && ck.$ === "Int") {
    const [exp, found] = [IntTy.bit_width(ek._0), IntTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && exp < found) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp !== undefined && found !== undefined && exp > found) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && (found === 8 || found === 16)) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if ((exp === 8 || exp === 16) && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === undefined || found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [false, false];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Uint" && ck.$ === "Uint") {
    const [exp, found] = [UintTy.bit_width(ek._0), UintTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && exp < found) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp !== undefined && found !== undefined && exp > found) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && (found === 8 || found === 16)) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if ((exp === 8 || exp === 16) && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === undefined || found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [false, false];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Int" && ck.$ === "Uint") {
    const [exp, found] = [IntTy.bit_width(ek._0), UintTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && found < exp) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && found === 8) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Uint" && ck.$ === "Int") {
    const [exp, found] = [UintTy.bit_width(ek._0), IntTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && found > exp) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === 8 && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Float") {
    const [exp, found] = [ek._0, ck._0];
    if (FloatTy.bit_width(found) < FloatTy.bit_width(exp)) {
      suggest_to_change_suffix_or_into(err, false, true);
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else if (can_cast) {
      // Missing try_into implementation for `f64` to `f32`
      err.multipart_suggestion(
        `${cast_msg}, producing the closest possible value`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if ((ek.$ === "Uint" || ek.$ === "Int") && ck.$ === "Float") {
    if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else if (can_cast) {
      // Missing try_into implementation for `{float}` to `{integer}`
      err.multipart_suggestion(
        `${msg}, rounding the float towards zero`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Uint") {
    const [exp, found] = [ek._0, ck._0];
    // if `found` is `None` (meaning found is `usize`), don't suggest `.into()`
    if (FloatTy.bit_width(exp) > (UintTy.bit_width(found) ?? 256)) {
      err.multipart_suggestion(`${msg}, producing the floating point representation of the integer`, into_suggestion, "MachineApplicable");
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else {
      // Missing try_into implementation for `{integer}` to `{float}`
      err.multipart_suggestion(
        `${cast_msg}, producing the floating point representation of the integer, rounded if necessary`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Int") {
    const [exp, found] = [ek._0, ck._0];
    // if `found` is `None` (meaning found is `isize`), don't suggest `.into()`
    if (FloatTy.bit_width(exp) > (IntTy.bit_width(found) ?? 256)) {
      err.multipart_suggestion(`${msg}, producing the floating point representation of the integer`, into_suggestion, "MachineApplicable");
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else {
      // Missing try_into implementation for `{integer}` to `{float}`
      err.multipart_suggestion(
        `${msg}, producing the floating point representation of the integer, rounded if necessary`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (
    ((ek.$ === "Uint" && (ek._0 === "U32" || ek._0 === "U64" || ek._0 === "U128")) || (ek.$ === "Int" && (ek._0 === "I32" || ek._0 === "I64" || ek._0 === "I128"))) &&
    ck.$ === "Char"
  ) {
    err.multipart_suggestion(`${cast_msg}, since a \`char\` always occupies 4 bytes`, cast_suggestion, "MachineApplicable");
    return true;
  } else {
    return false;
  }
};

/// Identify when the user has written `foo..bar()` instead of `foo.bar()`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3788 suggest_method_call_on_range_literal
FnCtxt.prototype.suggest_method_call_on_range_literal = function (this: FnCtxt, err: Diag, expr_: hir.Expr, checked_ty: Ty, expected_ty: Ty): void {
  if (!is_range_literal(expr_)) {
    return;
  }
  if (!(expr_.kind.$ === "Struct" && expr_.kind._1.length === 2)) {
    return;
  }
  const qpath = expr_.kind._0;
  const [start, end] = [expr_.kind._1[0]!, expr_.kind._1[1]!];
  if (!this.tcx.qpath_is_lang_item(qpath, LangItem.Range)) {
    return;
  }
  if (this.tcx.parent_hir_node(expr_.hir_id).$ === "ExprField") {
    // Ignore `Foo { field: a..Default::default() }`
    return;
  }
  let expr = end.expr;
  let expectation: Ty | undefined = expected_ty;
  while (expr.kind.$ === "MethodCall") {
    const rcvr = expr.kind._1;
    // Getting to the root receiver and asserting it is a fn call let's us ignore cases in
    // `tests/ui/methods/issues/issue-90315.stderr`.
    expr = rcvr;
    // If we have more than one layer of calls, then the expected ty
    // cannot guide the method probe.
    expectation = undefined;
  }
  if (expr.kind.$ !== "Call") {
    return;
  }
  const method_name = expr.kind._0;
  const ck = checked_ty.kind();
  if (ck.$ !== "Adt") {
    return;
  }
  const adt = ck._0;
  const range_struct = this.tcx.lang_items().range_struct();
  if (range_struct === undefined || !DefId_eq(range_struct, adt.did())) {
    return;
  }
  const ek = expected_ty.kind();
  if (ek.$ === "Adt" && this.tcx.is_lang_item(ek._0.did(), LangItem.Range)) {
    return;
  }
  // Check if start has method named end.
  if (!(method_name.kind.$ === "Path" && method_name.kind._0.$ === "Resolved" && method_name.kind._0._0 === undefined)) {
    return;
  }
  const p = method_name.kind._0._1;
  if (p.segments.length !== 1) {
    return;
  }
  const ident = p.segments[0]!.ident;
  const self_ty = this.typeck_results.expr_ty(start.expr);
  const pick = this.lookup_probe_for_diagnostic(ident, self_ty, expr, ProbeScope.AllTraits, expectation);
  if (pick.$ !== "Ok") {
    return;
  }
  let sugg = ".";
  let span = Span.between(start.expr.span, end.expr.span);
  if (Span.lo(span) + 2 === Span.hi(span)) {
    // There's no space between the start, the range op and the end, suggest removal which
    // will be more noticeable than the replacement of `..` with `.`.
    span = Span.with_lo(span, BytePos(Span.lo(span) + 1));
    sugg = "";
  }
  err.span_suggestion_verbose(span, "you likely meant to write a method call instead of a range", sugg, "MachineApplicable");
};

/// Identify when the type error is because `()` is found in a binding that was assigned a
/// block without a tail expression.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3867 suggest_return_binding_for_missing_tail_expr
FnCtxt.prototype.suggest_return_binding_for_missing_tail_expr = function (this: FnCtxt, err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty): void {
  if (!checked_ty.is_unit()) {
    return;
  }
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined)) {
    return;
  }
  const path = expr.kind._0._1;
  if (path.res.$ !== "Local") {
    return;
  }
  const hir_id = path.res._0;
  const pat_node = this.tcx.hir_node(hir_id);
  if (pat_node.$ !== "Pat") {
    return;
  }
  const pat = pat_node._0;
  const let_node = this.tcx.parent_hir_node(pat.hir_id);
  if (!(let_node.$ === "LetStmt" && let_node._0.ty === undefined && let_node._0.init !== undefined)) {
    return;
  }
  const init = let_node._0.init;
  if (!(init.kind.$ === "Block" && init.kind._1 === undefined)) {
    return;
  }
  const block = init.kind._0;
  if (block.expr !== undefined) {
    return;
  }
  if (block.stmts.length === 0) {
    err.span_label(block.span, "this empty block is missing a tail expression");
    return;
  }
  const stmt = block.stmts[block.stmts.length - 1]!;
  if (stmt.kind.$ !== "Semi") {
    return;
  }
  const tail_expr = stmt.kind._0;
  const ty = this.node_ty_opt(tail_expr.hir_id);
  if (ty === undefined) {
    return;
  }
  if (
    this.can_eq(this.param_env, expected_ty, ty, ToTrace_Ty) &&
    // FIXME: this happens with macro calls. Need to figure out why the stmt
    // `println!();` doesn't include the `;` in its `Span`. (#133845)
    // We filter these out to avoid ICEs with debug assertions on caused by
    // empty suggestions.
    Span.hi(stmt.span) !== Span.hi(tail_expr.span)
  ) {
    err.span_suggestion_short(Span.with_lo(stmt.span, Span.hi(tail_expr.span)), "remove this semicolon", "", "MachineApplicable");
  } else {
    err.span_label(block.span, "this block is missing a tail expression");
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3925 suggest_swapping_lhs_and_rhs
FnCtxt.prototype.suggest_swapping_lhs_and_rhs = function (this: FnCtxt, err: Diag, rhs_ty: Ty, lhs_ty: Ty, rhs_expr: hir.Expr, lhs_expr: hir.Expr): void {
  const partial_eq_def_id = this.infcx.tcx.lang_items().eq_trait();
  if (
    partial_eq_def_id !== undefined &&
    EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(partial_eq_def_id, [rhs_ty, lhs_ty], this.param_env))
  ) {
    const sm = this.tcx.sess.source_map();
    // If the span of rhs_expr or lhs_expr is in an external macro,
    // we just suppress the suggestion. See issue #139050
    if (!Span.in_external_macro(rhs_expr.span, sm) && !Span.in_external_macro(lhs_expr.span, sm)) {
      const rhs_snippet = sm.span_to_snippet(rhs_expr.span);
      if (rhs_snippet.$ === "Ok") {
        const lhs_snippet = sm.span_to_snippet(lhs_expr.span);
        if (lhs_snippet.$ === "Ok") {
          err.note(`\`${display_Ty(rhs_ty)}\` implements \`PartialEq<${display_Ty(lhs_ty)}>\``);
          err.multipart_suggestion(
            "consider swapping the equality",
            [
              [lhs_expr.span, rhs_snippet._0.toString()],
              [rhs_expr.span, lhs_snippet._0.toString()],
            ],
            "MaybeIncorrect",
          );
        }
      }
    }
  }
};

// PORT: `str::trim_end_matches(&str)`: strips repeated occurrences of `pat` from the end.
function trim_end_matches(s: string, pat: string): string {
  if (pat.length === 0) {
    return s;
  }
  while (s.endsWith(pat)) {
    s = s.slice(0, s.length - pat.length);
  }
  return s;
}

// PORT: `Option::is_some_and`.
function is_some_and<T>(v: T | undefined, f: (v: T) => boolean): boolean {
  return v !== undefined && f(v);
}

// ==== end lane typeck-fnsugg-b ====
