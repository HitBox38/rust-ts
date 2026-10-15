// Port of compiler/rustc_hir_typeck/src/_match.rs (lane typeck-impl).
//
// `impl<'a, 'tcx> FnCtxt<'a, 'tcx>` (_match.rs:17): every method is assigned onto `FnCtxt.prototype` (declared in
// ./decls.ts), in upstream order; the free fn `arms_contain_ref_bindings` is exported (decls.ts `Fns__match`).
// Init order: top-level code here touches only ./decls.ts and other crates; every other rustc_hir_typeck export is read
// inside function bodies only.
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { HirId_eq, type HirId } from "../rustc_hir_id/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { ty_to_string } from "../rustc_hir_pretty/lib.ts";
import type { MatchExpressionArmCause, ObligationCause, ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId as LocalDefIdC, type LocalDefId } from "../rustc_span/def_id.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import { E0308 } from "../rustc_errors/error_codes.gen.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span, type Span as SpanT } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { FnCtxt } from "./decls.ts";
import type { CoerceMany as CoerceManyDecl } from "./coercion.gen.ts";
import { CoerceMany } from "./coercion.ts";
import { RemoveSemiForCoerce_subdiagnostic } from "./diagnostics.ts";
import { Diverges } from "./diverges.ts";
import { Expectation } from "./expectation.ts";
import { FnCtxt_as_PpAnn } from "./fn_ctxt/mod.ts";
import { GatherLocalsVisitor } from "./gather_locals.ts";
import { Needs } from "./lib.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

// #[instrument(skip(self), level = "debug", ret)]
// rustc: compiler/rustc_hir_typeck/src/_match.rs:19 check_expr_match
FnCtxt.prototype.check_expr_match = function (
  this: FnCtxt,
  expr: hir.Expr,
  scrut: hir.Expr,
  arms: readonly hir.Arm[],
  orig_expected: Expectation,
  match_src: hir.MatchSource,
): Ty {
  const tcx = this.tcx;

  const acrb = arms_contain_ref_bindings(arms);
  const scrutinee_ty = this.demand_scrutinee_type(scrut, acrb, arms.length === 0);
  // debug!(?scrutinee_ty);

  // If there are no arms, that is a diverging match; a special case.
  if (arms.length === 0) {
    this.diverges = Diverges.bitor(this.diverges, Diverges.always(expr.span));
    return tcx.types.never;
  }

  this.warn_arms_when_scrutinee_diverges(arms);

  // Otherwise, we have to union together the types that the arms produce and so forth.
  const scrut_diverges = this.diverges;
  this.diverges = Diverges.Maybe;

  // #55810: Type check patterns first so we get types for all bindings.
  const scrut_span = Span.find_ancestor_inside(scrut.span, expr.span) ?? scrut.span;
  for (const arm of arms) {
    GatherLocalsVisitor.gather_from_arm(this, arm);

    this.check_pat_top(arm.pat, scrutinee_ty, scrut_span, scrut, undefined);
  }

  // Now typecheck the blocks.
  //
  // The result of the match is the common supertype of all the
  // arms. Start out the value as bottom, since it's the, well,
  // bottom the type lattice, and we'll be moving up the lattice as
  // we process each arm. (Note that any match with 0 arms is matching
  // on any empty type and is therefore unreachable; should the flow
  // of execution reach it, we will panic, so bottom is an appropriate
  // type in that case)
  let all_arms_diverge: Diverges = Diverges.WarnedAlways;

  const expected = Expectation.try_structurally_resolve_and_adjust_for_branches(orig_expected, this);
  // debug!(?expected);

  let coercion: CoerceMany;
  {
    let coerce_first: Ty;
    // We don't coerce to `()` so that if the match expression is a
    // statement it's branches can have any consistent type. That allows
    // us to give better error messages (pointing to a usually better
    // arm for inconsistent arms or to the whole match when a `()` type
    // is required).
    if (expected.$ === "ExpectHasType" && expected._0 !== tcx.types.unit) {
      coerce_first = expected._0;
    } else {
      coerce_first = this.next_ty_var(expr.span);
    }
    coercion = CoerceMany.with_capacity(coerce_first, arms.length);
  }

  const prior_non_diverging_arms: SpanT[] = []; // Used only for diagnostics.
  let prior_arm: [HirId | undefined, Ty, SpanT] | undefined = undefined;
  for (const arm of arms) {
    this.diverges = Diverges.Maybe;

    if (arm.guard !== undefined) {
      const e = arm.guard;
      this.check_expr_has_type_or_error(e, tcx.types.bool, (_) => {});

      // FIXME: If this is the first arm and the pattern is irrefutable,
      // e.g. `_` or `x`, and the guard diverges, then the whole match
      // may also be considered to diverge. We should warn on all subsequent
      // arms, too, just like we do for diverging scrutinees above.
    }

    // N.B. We don't reset diverges here b/c we want to warn in the arm
    // if the guard diverges, like: `x if { loop {} } => f()`, and we
    // also want to consider the arm to diverge itself.

    const arm_ty = this.check_expr_with_expectation(arm.body, expected);
    all_arms_diverge = Diverges.bitand(all_arms_diverge, this.diverges);
    const tail_defines_return_position_impl_trait = this.return_position_impl_trait_from_match_expectation(orig_expected);

    let arm_block_id: HirId | undefined;
    let arm_span: SpanT;
    if (arm.body.kind.$ === "Block") {
      const blk = arm.body.kind._0;
      [arm_block_id, arm_span] = [blk.hir_id, this.find_block_span(blk)];
    } else {
      [arm_block_id, arm_span] = [undefined, arm.body.span];
    }

    let code: ObligationCauseCode;
    if (prior_arm === undefined) {
      // The reason for the first arm to fail is not that the match arms diverge,
      // but rather that there's a prior obligation that doesn't hold.
      code = { $: "BlockTailExpression", _0: arm.body.hir_id, _1: match_src };
    } else {
      const [prior_arm_block_id, prior_arm_ty, prior_arm_span] = prior_arm;
      const cause: MatchExpressionArmCause = {
        arm_block_id,
        arm_span,
        arm_ty,
        prior_arm_block_id,
        prior_arm_ty,
        prior_arm_span,
        scrut_span: scrut.span,
        expr_span: expr.span,
        source: match_src,
        prior_non_diverging_arms: prior_non_diverging_arms.slice(),
        tail_defines_return_position_impl_trait,
      };
      code = { $: "MatchExpressionArm", _0: cause };
    }
    const cause = this.cause(arm_span, code);

    // This is the moral equivalent of `coercion.coerce(self, cause, arm.body, arm_ty)`.
    // We use it this way to be able to expand on the potential error and detect when a
    // `match` tail statement could be a tail expression instead. If so, we suggest
    // removing the stray semicolon.
    const prior_arm_ = prior_arm;
    coercion.coerce_inner(
      this,
      cause,
      arm.body,
      arm_ty,
      (err) => {
        this.explain_never_type_coerced_to_unit(err, arm, arm_ty, prior_arm_, expr);
      },
      false,
    );

    if (!arm_ty.is_never()) {
      // When a match arm has type `!`, then it doesn't influence the expected type for
      // the following arm. If all of the prior arms are `!`, then the influence comes
      // from elsewhere and we shouldn't point to any previous arm.
      prior_arm = [arm_block_id, arm_ty, arm_span];

      prior_non_diverging_arms.push(arm_span);
      if (prior_non_diverging_arms.length > 5) {
        prior_non_diverging_arms.shift();
      }
    }
  }

  // If all of the arms in the `match` diverge,
  // and we're dealing with an actual `match` block
  // (as opposed to a `match` desugared from something else'),
  // we can emit a better note. Rather than pointing
  // at a diverging expression in an arbitrary arm,
  // we can point at the entire `match` expression
  if (all_arms_diverge.$ === "Always" && match_src.$ === "Normal") {
    all_arms_diverge = {
      $: "Always",
      span: expr.span,
      custom_note: "any code following this `match` expression is unreachable, as all arms diverge",
    };
  }

  // We won't diverge unless the scrutinee or all arms diverge.
  this.diverges = Diverges.bitor(scrut_diverges, all_arms_diverge);

  return coercion.complete(this);
};

// rustc: compiler/rustc_hir_typeck/src/_match.rs:179 explain_never_type_coerced_to_unit
FnCtxt.prototype.explain_never_type_coerced_to_unit = function (
  this: FnCtxt,
  err: Diag,
  arm: hir.Arm,
  arm_ty: Ty,
  prior_arm: [HirId | undefined, Ty, SpanT] | undefined,
  expr: hir.Expr,
): void {
  if (arm.body.kind.$ === "Block" && arm.body.kind._0.expr !== undefined) {
    const tail = arm.body.kind._0.expr;
    const arm_tail_ty = this.node_ty(tail.hir_id);
    if (arm_tail_ty.is_never() && !arm_ty.is_never()) {
      err.span_label(tail.span, `this expression is of type \`!\`, but it is coerced to \`${display_Ty(arm_ty)}\` due to its surrounding expression`);
      this.suggest_mismatched_types_on_tail(err, tail, arm_ty, prior_arm === undefined ? arm_tail_ty : prior_arm[1], tail.hir_id);
    }
  }
  this.suggest_removing_semicolon_for_coerce(err, expr, arm_ty, prior_arm);
};

// rustc: compiler/rustc_hir_typeck/src/_match.rs:211 suggest_removing_semicolon_for_coerce
FnCtxt.prototype.suggest_removing_semicolon_for_coerce = function (
  this: FnCtxt,
  diag: Diag,
  expr: hir.Expr,
  arm_ty: Ty,
  prior_arm: [HirId | undefined, Ty, SpanT] | undefined,
): void {
  // First, check that we're actually in the tail of a function.
  const body = this.tcx.hir_maybe_body_owned_by(this.body_def_id);
  if (body === undefined) {
    return;
  }
  if (body.value.kind.$ !== "Block") {
    return;
  }
  const block = body.value.kind._0;
  const stmts = block.innermost_block().stmts;
  const last = stmts[stmts.length - 1];
  if (last === undefined || last.kind.$ !== "Semi") {
    return;
  }
  const last_expr = last.kind._0;
  const semi_span = last.span;
  if (!HirId_eq(last_expr.hir_id, expr.hir_id)) {
    return;
  }

  // Next, make sure that we have no type expectation.
  const decl = hir.Node.fn_decl(this.tcx.hir_node_by_def_id(this.body_def_id));
  if (decl === undefined) {
    return;
  }
  const ret = hir.FnRetTy.span(decl.output);

  let can_coerce_to_return_ty: boolean;
  const ret_coercion = this.ret_coercion;
  if (ret_coercion !== undefined) {
    const ret_ty_ = as_hand_CoerceMany(ret_coercion).expected_ty();
    const ret_ty = this.infcx.shallow_resolve(ret_ty_);
    const k = ret_ty.kind();
    can_coerce_to_return_ty =
      this.may_coerce(arm_ty, ret_ty) &&
      (prior_arm === undefined || this.may_coerce(prior_arm[1], ret_ty)) &&
      // The match arms need to unify for the case of `impl Trait`.
      !(k.$ === "Alias" && k._1.kind.$ === "Opaque");
  } else {
    can_coerce_to_return_ty = false;
  }
  if (!can_coerce_to_return_ty) {
    return;
  }

  const semi = Span.with_hi(Span.shrink_to_hi(expr.span), Span.hi(semi_span));
  const sugg = { expr: expr.span, ret, semi };
  diag.subdiagnostic(RemoveSemiForCoerce_subdiagnostic(sugg));
};

/// When the previously checked expression (the scrutinee) diverges,
/// warn the user about the match arms being unreachable.
// rustc: compiler/rustc_hir_typeck/src/_match.rs:263 warn_arms_when_scrutinee_diverges
FnCtxt.prototype.warn_arms_when_scrutinee_diverges = function (this: FnCtxt, arms: readonly hir.Arm[]): void {
  for (const arm of arms) {
    this.warn_if_unreachable(arm.body.hir_id, arm.body.span, "arm");
  }
};

/// Handle the fallback arm of a desugared if(-let) like a missing else.
///
/// Returns `true` if there was an error forcing the coercion to the `()` type.
// rustc: compiler/rustc_hir_typeck/src/_match.rs:272 if_fallback_coercion
FnCtxt.prototype.if_fallback_coercion = function (this: FnCtxt, if_span: SpanT, cond_expr: hir.Expr, then_expr: hir.Expr, coercion: CoerceManyDecl): boolean {
  // If this `if` expr is the parent's function return expr,
  // the cause of the type coercion is the return type, point at it. (#25228)
  const hir_id = this.tcx.parent_hir_id(this.tcx.parent_hir_id(then_expr.hir_id));
  const ret_reason = this.maybe_get_coercion_reason(hir_id, if_span);
  const cause = this.cause(if_span, { $: "IfExpressionWithNoElse" });
  const error: MutRef<boolean> = { value: false };
  as_hand_CoerceMany(coercion).coerce_forced_unit(this, cause, (err) => explain_if_expr(this, err, ret_reason, if_span, cond_expr, then_expr, error), false);
  return error.value;
};

/// Check if the span comes from an assert-like macro expansion.
// rustc: compiler/rustc_hir_typeck/src/_match.rs:295 is_from_assert_macro
FnCtxt.prototype.is_from_assert_macro = function (this: FnCtxt, span: SpanT): boolean {
  const macro_def_id = SyntaxContext.outer_expn_data(Span.ctxt(span)).macro_def_id;
  if (macro_def_id === undefined) return false;
  const name = this.tcx.get_diagnostic_name(macro_def_id);
  return (
    name !== undefined &&
    (name === sym.assert_macro ||
      name === sym.debug_assert_macro ||
      name === sym.assert_eq_macro ||
      name === sym.assert_ne_macro ||
      name === sym.debug_assert_eq_macro ||
      name === sym.debug_assert_ne_macro)
  );
};

/// Explain why `if` expressions without `else` evaluate to `()` and detect likely irrefutable
/// `if let PAT = EXPR {}` expressions that could be turned into `let PAT = EXPR;`.
// PORT(decls): pending root. decls.ts declares the out-parameter `error: &mut bool` as `error: boolean`; PORTING §8 makes
// it a `MutRef<boolean>` cell. The method is assigned with that parameter (cast below) and called through the typed
// helper `explain_if_expr`; the declaration should become `error: MutRef<boolean>`.
// rustc: compiler/rustc_hir_typeck/src/_match.rs:313 explain_if_expr
FnCtxt.prototype.explain_if_expr = function (
  this: FnCtxt,
  err: Diag,
  ret_reason: [SpanT, string] | undefined,
  if_span: SpanT,
  cond_expr: hir.Expr,
  then_expr: hir.Expr,
  error: MutRef<boolean>,
): void {
  const is_assert_macro = this.is_from_assert_macro(if_span);

  if (ret_reason !== undefined) {
    const [if_span, msg] = ret_reason;
    err.span_label(if_span, msg);
  } else if (then_expr.kind.$ === "Block" && then_expr.kind._0.expr !== undefined) {
    const expr = then_expr.kind._0.expr;
    err.span_label(expr.span, "found here");
  }

  if (is_assert_macro) {
    err.code(E0308);
    err.primary_message("mismatched types");
  } else {
    err.note("`if` expressions without `else` evaluate to `()`");
    err.help("consider adding an `else` block that evaluates to the expected type");
  }
  error.value = true;
  if (cond_expr.kind.$ === "Let" && then_expr.kind.$ === "Block") {
    const { span, pat, init } = cond_expr.kind._0;
    const block = then_expr.kind._0;
    // Refutability checks occur on the MIR, so we approximate it here by checking
    // if we have an enum with a single variant or a struct in the pattern.
    const pk = pat.kind;
    if ((pk.$ === "TupleStruct" || pk.$ === "Struct") && pk._0.$ === "Resolved") {
      const path = pk._0._1;
      const res = path.res;
      if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Struct") {
        // Structs are always irrefutable. Their fields might not be, but we
        // don't check for that here, it's only an approximation.
      } else if (
        res.$ === "Def" &&
        res._0.$ === "Ctor" &&
        res._0._0 === "Variant" &&
        (this.tcx.adt_def(this.tcx.parent(this.tcx.parent(res._1))) as AdtDef).variants().length === 1
      ) {
        // There's only a single variant in the `enum`, so we can suggest the
        // irrefutable `let` instead of `if let`.
      } else {
        return;
      }

      const sugg: [SpanT, string][] = [
        // Remove the `if`
        [Span.until(if_span, span), ""],
      ];
      const first = block.stmts[0];
      const expr = block.expr;
      if (first !== undefined && expr !== undefined) {
        const padding = this.tcx.sess.source_map().indentation_before(first.span) ?? "";
        sugg.push(
          [Span.between(init.span, first.span), `;\n${padding}`],
          [Span.with_hi(Span.shrink_to_hi(expr.span), Span.hi(block.span)), ""],
        );
      } else if (block.stmts.length === 0 && expr !== undefined) {
        const padding = this.tcx.sess.source_map().indentation_before(expr.span) ?? "";
        sugg.push(
          [Span.between(init.span, expr.span), `;\n${padding}`],
          [Span.with_hi(Span.shrink_to_hi(expr.span), Span.hi(block.span)), ""],
        );
      } else {
        // If there's no value in the body, then the `if` expression would already
        // be of type `()`, so checking for those cases is unnecessary.
        return;
      }
      err.multipart_suggestion("consider using an irrefutable `let` binding instead", sugg, "MaybeIncorrect");
    }
  }
} as unknown as FnCtxt["explain_if_expr"];

// rustc: compiler/rustc_hir_typeck/src/_match.rs:407 maybe_get_coercion_reason
FnCtxt.prototype.maybe_get_coercion_reason = function (this: FnCtxt, hir_id: HirId, sp: SpanT): [SpanT, string] | undefined {
  const node = this.tcx.hir_node(hir_id);
  if (node.$ === "Block") {
    const block = node._0;
    // check that the body's parent is an fn
    const parent = this.tcx.parent_hir_node(this.tcx.parent_hir_id(block.hir_id));
    if (block.expr !== undefined && parent.$ === "Item" && parent._0.kind.$ === "Fn") {
      const expr = block.expr;
      // check that the `if` expr without `else` is the fn body's expr
      if (expr.span === sp) {
        const r = this.get_fn_decl(hir_id);
        if (r === undefined) return undefined;
        const fn_decl = r[1];
        let ty: string;
        let span: SpanT;
        switch (fn_decl.output.$) {
          case "DefaultReturn":
            [ty, span] = ["()", fn_decl.output._0];
            break;
          case "Return":
            [ty, span] = [ty_to_string(FnCtxt_as_PpAnn(this), fn_decl.output._0), fn_decl.output._0.span];
            break;
        }
        return [span, `expected \`${ty}\` because of this return type`];
      }
    }
  }
  if (node.$ === "LetStmt" && node._0.ty !== undefined) {
    return [node._0.pat.span, "expected because of this assignment"];
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/_match.rs:437 if_cause
FnCtxt.prototype.if_cause = function (this: FnCtxt, expr_id: HirId, else_expr: hir.Expr, tail_defines_return_position_impl_trait: LocalDefId | undefined): ObligationCause {
  const error_sp = this.find_block_span_from_hir_id(else_expr.hir_id);

  // Finally construct the cause:
  return this.cause(error_sp, { $: "IfExpression", expr_id, tail_defines_return_position_impl_trait });
};

// rustc: compiler/rustc_hir_typeck/src/_match.rs:452 demand_scrutinee_type
FnCtxt.prototype.demand_scrutinee_type = function (this: FnCtxt, scrut: hir.Expr, contains_ref_bindings: Mutability | undefined, no_arms: boolean): Ty {
  // Not entirely obvious: if matches may create ref bindings, we want to
  // use the *precise* type of the scrutinee, *not* some supertype, as
  // the "scrutinee type" (issue #23116).
  //
  // arielb1 [writes here in this comment thread][c] that there
  // is certainly *some* potential danger, e.g., for an example
  // like:
  //
  // [c]: https://github.com/rust-lang/rust/pull/43399#discussion_r130223956
  //
  // ```
  // let Foo(x) = f()[0];
  // ```
  //
  // Then if the pattern matches by reference, we want to match
  // `f()[0]` as a lexpr, so we can't allow it to be
  // coerced. But if the pattern matches by value, `f()[0]` is
  // still syntactically a lexpr, but we *do* want to allow
  // coercions.
  //
  // However, *likely* we are ok with allowing coercions to
  // happen if there are no explicit ref mut patterns - all
  // implicit ref mut patterns must occur behind a reference, so
  // they will have the "correct" variance and lifetime.
  //
  // This does mean that the following pattern would be legal:
  //
  // ```
  // struct Foo(Bar);
  // struct Bar(u32);
  // impl Deref for Foo {
  //     type Target = Bar;
  //     fn deref(&self) -> &Bar { &self.0 }
  // }
  // impl DerefMut for Foo {
  //     fn deref_mut(&mut self) -> &mut Bar { &mut self.0 }
  // }
  // fn foo(x: &mut Foo) {
  //     {
  //         let Bar(z): &mut Bar = x;
  //         *z = 42;
  //     }
  //     assert_eq!(foo.0.0, 42);
  // }
  // ```
  //
  // FIXME(tschottdorf): don't call contains_explicit_ref_binding, which
  // is problematic as the HIR is being scraped, but ref bindings may be
  // implicit after #42640. We need to make sure that pat_adjustments
  // (once introduced) is populated by the time we get here.
  //
  // See #44848.
  if (contains_ref_bindings !== undefined) {
    const m = contains_ref_bindings;
    return this.check_expr_with_needs(scrut, Needs.maybe_mut_place(m));
  } else if (no_arms) {
    return this.check_expr(scrut);
  } else {
    // ...but otherwise we want to use any supertype of the
    // scrutinee. This is sort of a workaround, see note (*) in
    // `check_pat` for some details.
    const scrut_ty = this.next_ty_var(scrut.span);
    this.check_expr_has_type_or_error(scrut, scrut_ty, (_) => {});
    return scrut_ty;
  }
};

// Does the expectation of the match define an RPIT?
// (e.g. we're in the tail of a function body)
//
// Returns the `LocalDefId` of the RPIT, which is always identity-substituted.
// rustc: compiler/rustc_hir_typeck/src/_match.rs:528 return_position_impl_trait_from_match_expectation
FnCtxt.prototype.return_position_impl_trait_from_match_expectation = function (this: FnCtxt, expectation: Expectation): LocalDefId | undefined {
  const expected_ty = Expectation.to_option(expectation, this);
  if (expected_ty === undefined) return undefined;
  let def_id: LocalDefId;
  let args: GenericArgs;
  const k = expected_ty.kind();
  if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
    // FIXME: Could also check that the RPIT is not defined
    const local = k._1.kind.def_id.as_local();
    if (local === undefined) return undefined;
    [def_id, args] = [local, k._1.args];
  } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
    // FIXME(-Znext-solver=no): Remove this branch once `replace_opaque_types_with_infer` is gone.
    let found: [LocalDefId, GenericArgs] | undefined = undefined;
    for (const [key, v] of this.inner.opaque_types().deref().iter_opaque_types()) {
      if (v.ty === expected_ty) {
        found = [key.def_id, key.args];
        break;
      }
    }
    if (found === undefined) return undefined;
    [def_id, args] = found;
  } else {
    return undefined;
  }
  const origin = this.tcx.local_opaque_ty_origin(def_id);
  if (origin.$ !== "FnReturn") {
    return undefined;
  }
  const parent_def_id = origin.parent;
  const count = (this.tcx.generics_of(parent_def_id) as Generics).count();
  const identity = RawList.identity_for_item(this.tcx, LocalDefIdC.to_def_id(parent_def_id));
  const prefix = args.slice(0, count);
  if (prefix.length !== identity.length || prefix.some((a, i) => a !== identity[i])) {
    return undefined;
  }
  return def_id;
};

// rustc: compiler/rustc_hir_typeck/src/_match.rs:562 arms_contain_ref_bindings
export function arms_contain_ref_bindings(arms: readonly hir.Arm[]): Mutability | undefined {
  // PORT: `Iterator::max` over `hir::Mutability` (derived `Ord`: `Not < Mut`).
  let max: Mutability | undefined = undefined;
  for (const a of arms) {
    const m = a.pat.contains_explicit_ref_binding();
    if (m === undefined) continue;
    if (max === undefined || m === "Mut") max = m;
  }
  return max;
}

/** The typed call of `explain_if_expr` (see the PORT(decls) note on its assignment). */
function explain_if_expr(
  fcx: FnCtxt,
  err: Diag,
  ret_reason: [SpanT, string] | undefined,
  if_span: SpanT,
  cond_expr: hir.Expr,
  then_expr: hir.Expr,
  error: MutRef<boolean>,
): void {
  (fcx.explain_if_expr as unknown as (err: Diag, ret_reason: [SpanT, string] | undefined, if_span: SpanT, cond_expr: hir.Expr, then_expr: hir.Expr, error: MutRef<boolean>) => void).call(
    fcx,
    err,
    ret_reason,
    if_span,
    cond_expr,
    then_expr,
    error,
  );
}

/**
 * PORT(decls): pending root. decls.ts types `FnCtxt::ret_coercion` and the `coercion` parameter of
 * `if_fallback_coercion` with the generated `CoerceMany` of coercion.gen.ts (field `expected_ty`), while the contract
 * class is the hand-written one of coercion.ts (field `expected_ty_`, the methods). Both are the same runtime class
 * once lane typeck-coerce lands; this converts the declared type to the hand class.
 */
function as_hand_CoerceMany(c: CoerceManyDecl): CoerceMany {
  return c as unknown as CoerceMany;
}
