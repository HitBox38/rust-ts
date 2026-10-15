// Port of compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs (lanes errrep-sugg-a, errrep-sugg-b, errrep-sugg-c; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/suggestions.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// Ported here by lane errctxt-contract (small visitors other crates use: rustc_hir_analysis check reads `ReturnsVisitor`):
// the hand classes `SelfVisitor`, `ReturnsVisitor`, `AwaitsVisitor` (intravisit `Visitor`s) with their impls.
export * from "./suggestions.gen.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { debug_Ty as debug_hir_Ty } from "../../../rustc_hir/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { debug_Symbol, type Symbol } from "../../../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_vec } from "../../../std/fmt.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { assert, unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_traits_suggestions } from "../../decls.ts";
// ---- imports of lane errrep-sugg-b (suggestions.rs:2485..5017) ----
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { type Applicability, type Diag, E0631, E0746, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { UnstableFeatures } from "../../../rustc_feature/lib.ts";
import { DefKind, Res } from "../../../rustc_hir/def.ts";
import { HirId_eq } from "../../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import { pluralize } from "../../../rustc_lint_defs/lib.ts";
import { Level } from "../../../rustc_middle/middle/privacy.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { type DerivedCause, EvaluationResult, ObligationCauseCode, ObligationCauseCodeHandle } from "../../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv, Predicate } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../../../rustc_middle/ty/generics.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { Asyncness, Term, Ty, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { type PolyTraitClause, Predicate_upcast_from_PolyHostEffectClause, Predicate_upcast_from_PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, print_Ty, type PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_Predicate,
  display_TraitClausePrintModifiersAndPath,
  display_Ty,
  type PrettyPrinter,
  PolyTraitClause_print_modifiers_and_trait_path,
  PolyTraitRef_print_only_trait_path,
  print_Binder,
  print_TraitClausePrintModifiersAndPath,
  print_TraitRefPrintOnlyTraitPath,
  TraitClause_print_modifiers_and_trait_path,
  type TraitClausePrintModifiersAndPath,
  type TraitRefPrintOnlyTraitPath,
  with_forced_trimmed_paths,
  with_no_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { display_AssocKind } from "../../../rustc_middle/ty/assoc.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { UpvarArgs } from "../../../rustc_middle/ty/sty.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { DefId, DefId_eq, DefIdSet, LocalDefId } from "../../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { display_Ident, display_Symbol, type Ident, kw, type Symbol as Symbol_, sym } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable, TypeSuperFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import {
  display_BoundConstness,
  type HostEffectClause,
  PolyHostEffectClause,
  PolyTraitClause as PolyTraitClause_,
  ProjectionClause,
  TraitClause,
  TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import { fold_with_TraitClause, fold_with_TraitRef, try_fold_with_TraitClause, try_fold_with_TraitRef, visit_with_TraitClause, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { debug_TyKind, FnSig, fold_FnSig, PolyFnSigTys } from "../../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { type TypeSuperVisitable, TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../../../std/panic.ts";
import { is_whitespace } from "../../../std/char.ts";
import { Ok } from "../../../std/result.ts";
import { CoroutineData, type CoroutineInteriorOrUpvar } from "./suggestions.gen.ts";
// ---- end imports of lane errrep-sugg-b ----

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6875 SelfVisitor
// PORT: hand-written with its derived Debug (types.sets.json `skip`); `paths: Vec<&hir::Ty> = Vec::new()` (default field
// value) is the constructor's default.
export class SelfVisitor extends hir.intravisit.Visitor {
  constructor(
    public paths: hir.Ty[] = [],
    public name: Symbol | undefined,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for SelfVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6881 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    let path: hir.QPath, inner_ty: hir.Ty, segment: hir.PathSegment, inner_path_: hir.QPath, inner_path: hir.Path;
    if (
      ty.kind.$ === "Path" &&
      ((path = ty.kind._0), true) &&
      path.$ === "TypeRelative" &&
      ((inner_ty = path._0), (segment = path._1), true) &&
      (segment.ident.name === this.name || this.name === undefined) &&
      inner_ty.kind.$ === "Path" &&
      ((inner_path_ = inner_ty.kind._0), true) &&
      inner_path_.$ === "Resolved" &&
      inner_path_._0 === undefined &&
      ((inner_path = inner_path_._1), true) &&
      inner_path.res.$ === "SelfTyAlias"
    ) {
      this.paths.push(ty.as_unambig_ty());
    }
    hir.intravisit.walk_ty(this, ty);
    return undefined;
  }
}

/** `#[derive(Debug)]` on `SelfVisitor`. */
export const debug_SelfVisitor: Debug<SelfVisitor> = (v, f) =>
  debug_struct(f, "SelfVisitor", [
    ["paths", debug_vec(v.paths, f, (x, f) => debug_hir_Ty(x, f, (_x, _f) => "()"))],
    ["name", debug_option(v.name, f, debug_Symbol)],
  ]);

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6898 ReturnsVisitor
/// Collect all the returned expressions within the input expression.
/// Used to point at the return spans when we want to suggest some change to them.
// PORT: `#[derive(Default)]` is the constructor's defaults (`ReturnsVisitor.default()` = `new ReturnsVisitor()`).
export class ReturnsVisitor extends hir.intravisit.Visitor {
  constructor(
    public returns: hir.Expr[] = [],
    public in_block_tail: boolean = false,
  ) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): ReturnsVisitor {
    return new ReturnsVisitor();
  }

  // impl<'v> Visitor<'v> for ReturnsVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6904 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const kind = ex.kind;
    if (kind.$ === "Ret" && kind._0 !== undefined) {
      const ex = kind._0;
      this.returns.push(ex);
    } else if (kind.$ === "Block" && this.in_block_tail) {
      const block = kind._0;
      this.in_block_tail = false;
      for (const stmt of block.stmts) {
        hir.intravisit.walk_stmt(this, stmt);
      }
      this.in_block_tail = true;
      if (block.expr !== undefined) {
        const expr = block.expr;
        this.visit_expr(expr);
      }
    } else if (kind.$ === "If" && this.in_block_tail) {
      const then = kind._1;
      const else_opt = kind._2;
      this.visit_expr(then);
      if (else_opt !== undefined) {
        const el = else_opt;
        this.visit_expr(el);
      }
    } else if (kind.$ === "Match" && this.in_block_tail) {
      const arms = kind._1;
      for (const arm of arms) {
        this.visit_expr(arm.body);
      }
    } else if (!this.in_block_tail) {
      hir.intravisit.walk_expr(this, ex);
    } else {
      this.returns.push(ex);
    }
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6940 visit_body
  override visit_body(body: hir.Body): undefined {
    assert(!this.in_block_tail, "assertion failed: !self.in_block_tail");
    this.in_block_tail = true;
    hir.intravisit.walk_body(this, body);
    return undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6949 AwaitsVisitor
/// Collect all the awaited expressions within the input expression.
// PORT: `#[derive(Default)]` is the constructor's default.
export class AwaitsVisitor extends hir.intravisit.Visitor {
  constructor(public awaits: HirId[] = []) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): AwaitsVisitor {
    return new AwaitsVisitor();
  }

  // impl<'v> Visitor<'v> for AwaitsVisitor

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6954 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Yield" && ex.kind._1.$ === "Await" && ex.kind._1.expr !== undefined) {
      const id = ex.kind._1.expr;
      this.awaits.push(id);
    }
    return hir.intravisit.walk_expr(this, ex);
  }
}

/** PORT(hand type): suggestions.rs:6997, an intravisit `Visitor`: lane errrep-sugg-c. */
export type ReplaceImplTraitVisitor = unknown;

/** PORT(hand type): suggestions.rs:7068, a `TypeFolder`: lane errrep-sugg-c. */
export type ReplaceImplTraitFolder = unknown;

/** PORT(hand type): suggestions.rs:7304, an intravisit `Visitor`: lane errrep-sugg-c. */
export type FindTypeParam = unknown;

/** PORT(hand type): suggestions.rs:7348, a `TypeVisitor` with `can_suggest_bound`: lane errrep-sugg-c. */
export type ParamFinder = unknown;

// error_reporting/traits/suggestions.rs:113 (stub; lane errrep-sugg-a)
export const predicate_constraint = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::predicate_constraint")) as Fns_error_reporting_traits_suggestions["predicate_constraint"];
// error_reporting/traits/suggestions.rs:123 (stub; lane errrep-sugg-a)
export const suggest_restriction = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::suggest_restriction")) as Fns_error_reporting_traits_suggestions["suggest_restriction"];
// error_reporting/traits/suggestions.rs:6792 (stub; lane errrep-sugg-c)
export const hint_missing_borrow = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::hint_missing_borrow")) as Fns_error_reporting_traits_suggestions["hint_missing_borrow"];
// error_reporting/traits/suggestions.rs:7023 (stub; lane errrep-sugg-c)
export const get_explanation_based_on_obligation = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::get_explanation_based_on_obligation")) as Fns_error_reporting_traits_suggestions["get_explanation_based_on_obligation"];
// error_reporting/traits/suggestions.rs:7089 (stub; lane errrep-sugg-c)
export const suggest_desugaring_async_fn_to_impl_future_in_trait = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::suggest_desugaring_async_fn_to_impl_future_in_trait")) as Fns_error_reporting_traits_suggestions["suggest_desugaring_async_fn_to_impl_future_in_trait"];
// error_reporting/traits/suggestions.rs:7154 (stub; lane errrep-sugg-c)
export const point_at_assoc_type_restriction = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::point_at_assoc_type_restriction")) as Fns_error_reporting_traits_suggestions["point_at_assoc_type_restriction"];
// error_reporting/traits/suggestions.rs:7291 (stub; lane errrep-sugg-c)
export const get_deref_type_and_refs = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::get_deref_type_and_refs")) as Fns_error_reporting_traits_suggestions["get_deref_type_and_refs"];

// ==== lane errrep-sugg-a: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "note_field_shadowed_by_private_candidate_in_cause", "note_field_shadowed_by_private_candidate", "suggest_restricting_param_bound", "suggest_dereferences", "get_closure_name", "suggest_fn_call", "suggest_cast_to_fn_pointer", "check_for_binding_assigned_block_without_tail_expression", "suggest_add_clone_to_arg", "extract_callable_info", "where_clause_expr_matches_failed_self_ty", "suggest_add_reference_to_arg", "suggest_borrowing_for_object_cast", "peel_expr_refs", "suggest_remove_reference", "suggest_remove_ref_from_param", "suggest_remove_await",
]);

// ==== lane errrep-sugg-b: error_reporting/traits/suggestions.rs:2485..5017 ====
// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (continued)

/// Check if the trait bound is implemented for a different mutability and note it in the
/// final error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2488 suggest_change_mut
TypeErrCtxt.prototype.suggest_change_mut = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred_: PolyTraitClause): void {
  const points_at_arg = obligation.cause.code_().$ === "FunctionArg";

  const span = obligation.cause.span;
  const snippet_r = this.tcx.sess.source_map().span_to_snippet(span);
  if (snippet_r.$ === "Ok") {
    const snippet = snippet_r._0.toString();
    const non_ws = chars(snippet).filter((c) => !is_whitespace(c));
    let refs_number = 0;
    while (refs_number < non_ws.length && non_ws[refs_number] === C_AMP) refs_number++;
    if (non_ws[refs_number] === C_QUOTE) {
      // Do not suggest removal of borrow from type arguments.
      return;
    }
    const trait_pred = this.deeply_resolve_ignoring_regions(trait_pred_, d_PolyTraitClause());
    if (TypeVisitableExt.has_non_region_infer(trait_pred, d_PolyTraitClause())) {
      // Do not ICE while trying to find if a reborrow would succeed on a trait with
      // unresolved bindings.
      return;
    }

    // Skipping binder here, remapping below
    const self_ty_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
    if (self_ty_kind.$ === "Ref") {
      const region = self_ty_kind._0;
      const t_type = self_ty_kind._1;
      const mutability = self_ty_kind._2;
      let suggested_ty: Ty;
      switch (mutability) {
        case "Mut":
          suggested_ty = Ty.new_imm_ref(this.tcx, region, t_type);
          break;
        case "Not":
          suggested_ty = Ty.new_mut_ref(this.tcx, region, t_type);
          break;
      }

      // Remapping bound vars here
      const trait_pred_and_suggested_ty = Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, suggested_ty]);

      const new_obligation = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_suggested_ty);
      const suggested_ty_would_satisfy_obligation = EvaluationResult.must_apply_modulo_regions(this.evaluate_obligation_no_overflow(new_obligation));
      if (suggested_ty_would_satisfy_obligation) {
        const sp = this.tcx.sess.source_map().span_take_while(span, (c) => is_whitespace(c) || c === C_AMP);
        if (
          points_at_arg &&
          mutability === "Not" &&
          refs_number > 0 &&
          // The borrow can sit in a macro body, where rewriting it would edit the
          // macro definition and so every one of its call sites, or a crate the user
          // does not own. Fall through to the note in that case.
          Span.can_be_used_for_suggestions(span)
        ) {
          // If we have a call like foo(&mut buf), then don't suggest foo(&mut mut buf)
          if (trim_start_matches(snippet, (c) => is_whitespace(c) || c === C_AMP).startsWith("mut")) {
            return;
          }
          err.span_suggestion_verbose(sp, "consider changing this borrow's mutability", "&mut ", "MachineApplicable");
        } else {
          err.note(
            `\`${display_PolyTraitClausePrintModifiersAndPath(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\` is implemented for \`${display_Ty(suggested_ty)}\`, but not for \`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\``,
          );
        }
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2571 suggest_semicolon_removal
TypeErrCtxt.prototype.suggest_semicolon_removal = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  span: Span,
  trait_pred: PolyTraitClause,
): boolean {
  if (!Binder.skip_binder(PolyTraitClause_.self_ty(trait_pred)).is_unit()) {
    return false;
  }
  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  let candidate: [hir.Stmt, hir.Expr, Ty] | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    const sig = node._0.kind.sig;
    const body_id = node._0.kind.body;
    const body_kind = this.tcx.hir_body(body_id).value.kind;
    if (
      body_kind.$ === "Block" &&
      Span.overlaps(hir.FnRetTy.span(sig.decl.output), span) &&
      (candidate = this.removable_trailing_semicolon(body_kind._0, obligation, trait_pred)) !== undefined
    ) {
      // A function body has a single return type, so keeping the value can't break any
      // other use of it.
      this.emit_semicolon_removal_suggestion(err, trait_pred, candidate, "MachineApplicable");
      return true;
    }
  }
  return this.suggest_semicolon_removal_in_closure_arg(obligation, err, trait_pred);
};

/// If the value of `block` is discarded by a trailing semicolon and keeping it would satisfy
/// `trait_pred`, return that statement, its expression and the type of that expression.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2604 removable_trailing_semicolon
TypeErrCtxt.prototype.removable_trailing_semicolon = function (
  this: TypeErrCtxt,
  block: hir.Block,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClause,
): [hir.Stmt, hir.Expr, Ty] | undefined {
  if (block.expr === undefined && block.stmts.length > 0) {
    const stmt = block.stmts[block.stmts.length - 1]!;
    if (stmt.kind.$ === "Semi") {
      const expr = stmt.kind._0;
      if (
        !Span.from_expansion(stmt.span) &&
        expr.kind.$ !== "Err" &&
        // Only suggest this if the expression behind the semicolon implements the predicate
        this.typeck_results !== undefined
      ) {
        const typeck_results = this.typeck_results;
        const ty_ = typeck_results.expr_ty_opt(expr);
        const ty = ty_ === undefined ? undefined : this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
        if (
          ty !== undefined &&
          this.predicate_may_hold(
            this.mk_trait_obligation_with_new_self_ty(
              obligation.param_env,
              Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, ty]),
            ),
          )
        ) {
          return [stmt, expr, ty];
        }
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2629 emit_semicolon_removal_suggestion
TypeErrCtxt.prototype.emit_semicolon_removal_suggestion = function (
  this: TypeErrCtxt,
  err: Diag,
  trait_pred: PolyTraitClause,
  [stmt, expr, ty]: [hir.Stmt, hir.Expr, Ty],
  applicability: Applicability,
): void {
  err.span_label(
    expr.span,
    `this expression has type \`${display_Ty(ty)}\`, which implements \`${display_PolyTraitClausePrintModifiersAndPath(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\``,
  );
  err.span_suggestion(this.tcx.sess.source_map().end_point(stmt.span), "remove this semicolon", "", applicability);
};

/// Detect when a closure argument returns `()` because of a trailing semicolon and that makes
/// a trait bound on the function's generic param fail, and suggest removing the semicolon:
///
/// ```text
/// fn bar<R: Bar>(_: impl Fn() -> R) {}
/// bar(|| { 5u8; })
/// //          - help: remove this semicolon
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2660 suggest_semicolon_removal_in_closure_arg
TypeErrCtxt.prototype.suggest_semicolon_removal_in_closure_arg = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClause,
): boolean {
  const peeled = ObligationCauseCode.peel_derives(obligation.cause.code_());
  if (peeled.$ !== "WhereClauseInExpr") {
    return false;
  }
  const callee_def_id = peeled._0;
  const hir_id = peeled._2;
  const idx = peeled._3;
  // This cause code is used for the clauses of any item named in an expression, like an
  // associated const or a type alias, and `fn_sig` is only defined for functions.
  const callee_kind = this.tcx.def_kind(callee_def_id);
  if (!(callee_kind.$ === "Fn" || callee_kind.$ === "AssocFn")) {
    return false;
  }
  const node = this.tcx.hir_node(hir_id);
  if (node.$ !== "Expr") {
    return false;
  }
  const expr = node._0;
  const typeck_results_ = this.typeck_results;
  if (typeck_results_ === undefined) {
    return false;
  }
  const typeck_results: TypeckResults = typeck_results_;
  let args: hir.Expr[];
  if (expr.kind.$ === "MethodCall") {
    const receiver = expr.kind._1;
    args = [receiver, ...expr.kind._2];
  } else {
    // For a call like `bar(..)` the obligation is attached to the callee path expression,
    // so the arguments live in its parent.
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && HirId_eq(parent._0.kind._0.hir_id, expr.hir_id)) {
      args = [...parent._0.kind._1];
    } else {
      return false;
    }
  }
  // Work with the callee's own clauses and signature, where the failing bound is still
  // written in terms of the generic param it was declared on.
  const clauses = GenericClauses.instantiate_identity(this.tcx.clauses_of(callee_def_id) as GenericClauses, this.tcx);
  const failed_clause = clauses.clauses[idx];
  const failed_kind = failed_clause === undefined ? undefined : Binder.skip_binder(Unnormalized.skip_norm_wip(failed_clause).kind());
  if (failed_kind === undefined || failed_kind.$ !== "Trait") {
    return false;
  }
  const failed = failed_kind._0;
  const sig = Binder.skip_binder(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(callee_def_id) as EarlyBinder<PolyFnSig>)));
  // PORT: the lazy `filter_map` iterator; `candidates.next()` twice reads at most the first two candidates.
  const tcx = this.tcx;
  const self = this;
  function* candidates_iter(): Generator<[hir.Stmt, hir.Expr, Ty], void, undefined> {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const r = (() => {
        // The bound has to be on what the closure returns. A bound on an unrelated param that
        // also happened to be inferred as `()` would not be satisfied by removing a semicolon.
        const input = FnSig.inputs(sig)[i];
        if (input === undefined) return undefined;
        const declared = input.peel_refs();
        if (
          !clauses.clauses.some((clause) => {
            const k = Binder.skip_binder(Unnormalized.skip_norm_wip(clause).kind());
            if (k.$ !== "Projection") return false;
            const proj = k._0;
            return (
              tcx.is_lang_item(ProjectionClause.def_id(proj), LangItem.FnOnceOutput) &&
              AliasTerm.self_ty(proj.projection_term) === declared &&
              Term.as_type(proj.term) === TraitClause.self_ty(failed)
            );
          })
        ) {
          return undefined;
        }
        // The error can be reported while the closure argument is still being checked, before
        // its own type is recorded, so identify closures syntactically and only fall back to
        // the argument's type (e.g. for a closure bound to a variable and passed by path).
        let closure_def_id: LocalDefId;
        if (arg.kind.$ === "Closure") {
          closure_def_id = arg.kind._0.def_id;
        } else {
          const adj = typeck_results.expr_ty_adjusted_opt(arg);
          const k = adj === undefined ? undefined : self.deeply_resolve_ignoring_regions(adj, fold_Ty).peel_refs().kind();
          if (k !== undefined && k.$ === "Closure") {
            const local = k._0.as_local();
            if (local === undefined) return undefined;
            closure_def_id = local;
          } else {
            return undefined;
          }
        }
        const cnode = tcx.hir_node_by_def_id(closure_def_id);
        if (!(cnode.$ === "Expr" && cnode._0.kind.$ === "Closure")) {
          return undefined;
        }
        const closure = cnode._0.kind._0;
        const body_kind = tcx.hir_body(closure.body).value.kind;
        if (!(body_kind.$ === "Block" && body_kind._1 === undefined)) {
          return undefined;
        }
        return self.removable_trailing_semicolon(body_kind._0, obligation, trait_pred);
      })();
      if (r !== undefined) yield r;
    }
  }
  const candidates = candidates_iter();
  // Only emit the suggestion when a single closure argument matches, to avoid pointing at
  // an unrelated closure.
  const first = candidates.next();
  if (!first.done && candidates.next().done) {
    const candidate = first.value;
    // The same closure can be passed to somewhere else that expects it to return `()`,
    // where keeping the value would introduce a new error.
    this.emit_semicolon_removal_suggestion(err, trait_pred, candidate, "MaybeIncorrect");
    return true;
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2765 suggest_borrow_for_unsized_closure_return
TypeErrCtxt.prototype.suggest_borrow_for_unsized_closure_return = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate: Predicate,
): void {
  const pred = predicate.as_trait_clause();
  if (pred === undefined) {
    return;
  }
  if (!this.tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized)) {
    return;
  }

  const span = err.deref().span.primary_span();
  if (span === undefined) {
    return;
  }
  const body_id = hir.Node.body_id(this.tcx.hir_node_by_def_id(body_def_id));
  if (body_id === undefined) {
    return;
  }
  const body = this.tcx.hir_body(body_id);
  const expr_finder = traits_er_mod().FindExprBySpan.new(span, this.tcx);
  expr_finder.visit_expr(body.value);
  const expr = expr_finder.result;
  if (expr === undefined) {
    return;
  }

  const find_closure = (args: readonly hir.Expr[]): hir.Closure | undefined => {
    for (const arg of args) {
      if (arg.kind.$ === "Closure") return arg.kind._0;
    }
    return undefined;
  };
  let closure: hir.Closure | undefined;
  switch (expr.kind.$) {
    case "Call":
      closure = find_closure(expr.kind._1);
      break;
    case "MethodCall":
      closure = find_closure(expr.kind._2);
      break;
    default:
      closure = undefined;
  }
  if (closure === undefined) {
    return;
  }
  if (closure.fn_decl.output.$ !== "DefaultReturn") {
    return;
  }

  err.span_suggestion_verbose(Span.shrink_to_lo(this.tcx.hir_body(closure.body).value.span), "consider borrowing the value", "&", "MaybeIncorrect");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2819 return_type_span
TypeErrCtxt.prototype.return_type_span = function (this: TypeErrCtxt, obligation: PredicateObligation): Span | undefined {
  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  if (!(node.$ === "Item" && node._0.kind.$ === "Fn")) {
    return undefined;
  }
  const sig = node._0.kind.sig;

  if (sig.decl.output.$ === "Return") {
    return sig.decl.output._0.span;
  } else {
    return undefined;
  }
};

/// If all conditions are met to identify a returned `dyn Trait`, suggest using `impl Trait` if
/// applicable and signal that the error has been expanded appropriately and needs to be
/// emitted.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2832 suggest_impl_trait
TypeErrCtxt.prototype.suggest_impl_trait = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean {
  if (obligation.cause.code_().$ !== "SizedReturnType") {
    return false;
  }
  if (Binder.skip_binder(PolyTraitClause_.self_ty(trait_pred)).kind().$ !== "Dynamic") {
    return false;
  }
  {
    const fn_sig = fn_sig_of_node(this.tcx.hir_node_by_def_id(obligation.cause.body_def_id));
    if (fn_sig !== undefined && fn_sig.decl.output.$ === "Return") {
      const ty = fn_sig.decl.output._0;
      if (ty.kind.$ === "Path") {
        const qpath = ty.kind._0;
        if (qpath.$ === "Resolved" && qpath._0 === undefined) {
          const path = qpath._1;
          if (path.res.$ === "Def" && path.res._0.$ === "TyAlias") {
            const def_id = path.res._1;
            // Do not suggest
            // type T = dyn Trait;
            // fn foo() -> impl T { .. }
            err.span_note(this.tcx.def_span(def_id), "this type alias is unsized");
            err.multipart_suggestion(
              "consider boxing the return type, and wrapping all of the returned values in `Box::new`",
              [
                [Span.shrink_to_lo(ty.span), "Box<"],
                [Span.shrink_to_hi(ty.span), ">"],
              ],
              "MaybeIncorrect",
            );
            return false;
          }
        }
      }
    }
  }

  err.code(E0746);
  err.primary_message("return type cannot be a trait object without pointer indirection");
  err.deref_mut().children.length = 0;

  let span = obligation.cause.span;
  let is_async_fn_return = false;
  if (this.tcx.def_kind(obligation.cause.body_def_id).$ === "Closure") {
    const parent = this.tcx.local_parent(obligation.cause.body_def_id);
    const parent_kind = this.tcx.def_kind(parent);
    if ((parent_kind.$ === "Fn" || parent_kind.$ === "AssocFn") && Asyncness.is_async(this.tcx.asyncness(parent) as Asyncness)) {
      const fn_sig = fn_sig_of_node(this.tcx.hir_node_by_def_id(parent));
      if (fn_sig !== undefined) {
        // Do not suggest (#147894)
        // async fn foo() -> dyn Display impl { .. }
        // and
        // async fn foo() -> dyn Display Box<dyn { .. }>
        span = hir.FnRetTy.span(fn_sig.decl.output);
        is_async_fn_return = true;
        err.span(span);
      }
    }
  }
  const body = this.tcx.hir_body_owned_by(obligation.cause.body_def_id);

  if (!is_async_fn_return) {
    const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
    if (node.$ === "Expr" && node._0.kind.$ === "Closure" && node._0.kind._0.fn_decl.output.$ === "DefaultReturn") {
      return true;
    }
  }

  const visitor = ReturnsVisitor.default();
  visitor.visit_body(body);

  let pre: string;
  let impl_span: Span;
  const snip = this.tcx.sess.source_map().span_to_snippet(span);
  if (snip.$ === "Ok" && snip._0.toString().startsWith("dyn ")) {
    pre = "";
    impl_span = Span.with_hi(span, BytePos(Span.lo(span) + 4));
  } else {
    pre = "dyn ";
    impl_span = Span.shrink_to_lo(span);
  }

  err.span_suggestion_verbose(impl_span, "consider returning an `impl Trait` instead of a `dyn Trait`", "impl ", "MaybeIncorrect");

  const sugg: [Span, string][] = [
    [Span.shrink_to_lo(span), `Box<${pre}`],
    [Span.shrink_to_hi(span), ">"],
  ];
  for (const expr of visitor.returns) {
    const span = Span.find_ancestor_in_same_ctxt(expr.span, obligation.cause.span) ?? expr.span;
    if (!Span.can_be_used_for_suggestions(span)) {
      // vec![]
    } else if (
      expr.kind.$ === "Call" &&
      expr.kind._0.kind.$ === "Path" &&
      expr.kind._0.kind._0.$ === "TypeRelative" &&
      expr.kind._0.kind._0._1.ident.name === sym.new &&
      expr.kind._0.kind._0._0.kind.$ === "Path" &&
      expr.kind._0.kind._0._0.kind._0.$ === "Resolved" &&
      is_some_and(Res.opt_def_id(expr.kind._0.kind._0._0.kind._0._1.res), (def_id) => this.tcx.is_lang_item(def_id, LangItem.OwnedBox))
    ) {
      // Don't box `Box::new`
      // vec![]
    } else {
      sugg.push([Span.shrink_to_lo(span), "Box::new("], [Span.shrink_to_hi(span), ")"]);
    }
  }

  err.multipart_suggestion("alternatively, box the return type, and wrap all of the returned values in `Box::new`", sugg, "MaybeIncorrect");

  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2963 report_closure_arg_mismatch
TypeErrCtxt.prototype.report_closure_arg_mismatch = function (
  this: TypeErrCtxt,
  span: Span,
  found_span_: Span | undefined,
  found_: TraitRef,
  expected_: TraitRef,
  cause: ObligationCauseCode,
  found_node: hir.Node | undefined,
  param_env: ParamEnv,
): Diag {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2973 build_fn_sig_ty
  function build_fn_sig_ty(infcx: InferCtxt, trait_ref: TraitRef): Ty {
    const inputs = trait_ref.args.type_at(1);
    const inputs_kind = inputs.kind();
    let sig: FnSig;
    if (inputs_kind.$ === "Tuple" && infcx.tcx.is_callable_trait(trait_ref.def_id)) {
      sig = infcx.tcx.mk_fn_sig_safe_rust_abi(inputs_kind._0, infcx.next_ty_var(DUMMY_SP));
    } else {
      sig = infcx.tcx.mk_fn_sig_safe_rust_abi([inputs], infcx.next_ty_var(DUMMY_SP));
    }

    return Ty.new_fn_ptr(infcx.tcx, Binder.dummy(sig, fold_FnSig));
  }

  const expected_self_kind = TraitRef.self_ty(expected_).kind();
  const argument_kind = expected_self_kind.$ === "Closure" ? "closure" : expected_self_kind.$ === "Coroutine" ? "coroutine" : "function";
  const err = struct_span_code_err(this.dcx(), span, E0631, `type mismatch in ${argument_kind} arguments`);

  err.span_label(span, "expected due to this");

  const found_span = found_span_ ?? span;
  err.span_label(found_span, "found signature defined here");

  const expected = build_fn_sig_ty(this.infcx, expected_);
  const found = build_fn_sig_ty(this.infcx, found_);

  const [expected_str, found_str] = this.cmp(expected, found);

  const signature_kind = `${argument_kind} signature`;
  err.note_expected_found(signature_kind, expected_str, signature_kind, found_str);

  this.note_conflicting_fn_args(err, cause, expected, found, param_env);
  this.note_conflicting_closure_bounds(cause, err);

  if (found_node !== undefined) {
    hint_missing_borrow(this.infcx, param_env, span, found, expected, found_node, err);
  }

  return err;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3023 note_conflicting_fn_args
TypeErrCtxt.prototype.note_conflicting_fn_args = function (
  this: TypeErrCtxt,
  err: Diag,
  cause: ObligationCauseCode,
  expected_: Ty,
  found_: Ty,
  param_env: ParamEnv,
): void {
  if (cause.$ !== "FunctionArg") {
    return;
  }
  const arg_hir_id = cause.arg_hir_id;
  const expected_kind = expected_.kind();
  if (expected_kind.$ !== "FnPtr") {
    return;
  }
  const expected = PolyFnSigTys.with(expected_kind._0, expected_kind._1);
  const found_kind = found_.kind();
  if (found_kind.$ !== "FnPtr") {
    return;
  }
  const found = PolyFnSigTys.with(found_kind._0, found_kind._1);
  const node = this.tcx.hir_node(arg_hir_id);
  if (node.$ !== "Expr") {
    return;
  }
  const arg = node._0;
  if (arg.kind.$ !== "Path") {
    return;
  }
  const path = arg.kind._0;
  const expected_inputs = FnSig.inputs(this.tcx.instantiate_bound_regions_with_erased(expected, fold_FnSig));
  const found_inputs = FnSig.inputs(this.tcx.instantiate_bound_regions_with_erased(found, fold_FnSig));
  // `expected_inputs.iter().copied().zip(found_inputs.iter().copied())`
  const both_tys = (): [Ty, Ty][] => {
    const out: [Ty, Ty][] = [];
    for (let i = 0; i < Math.min(expected_inputs.length, found_inputs.length); i++) out.push([expected_inputs[i]!, found_inputs[i]!]);
    return out;
  };

  const arg_expr = (infcx: InferCtxt, name: string, expected: Ty, found: Ty): string => {
    const [expected_ty, expected_refs] = get_deref_type_and_refs(expected);
    const [found_ty, found_refs] = get_deref_type_and_refs(found);

    if (infcx.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty)) {
      if (found_refs.length === expected_refs.length && slice_eq(found_refs, expected_refs)) {
        return name;
      } else if (found_refs.length > expected_refs.length) {
        const refs = found_refs.slice(0, found_refs.length - expected_refs.length);
        if (slice_eq(found_refs.slice(0, expected_refs.length), expected_refs)) {
          return `${refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`).join("")}${name}`;
        } else {
          // The refs have different mutability.
          return `${refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`).join("")}*${name}`;
        }
      } else if (expected_refs.length > found_refs.length) {
        return `${"*".repeat(expected_refs.length - found_refs.length)}${name}`;
      } else {
        return `${[...found_refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`), ...found_refs.map(() => "*")].join("")}${name}`;
      }
    } else {
      return `/* ${display_Ty(found)} */`;
    }
  };
  const args_have_same_underlying_type = both_tys().every(([expected, found]) => {
    const [expected_ty] = get_deref_type_and_refs(expected);
    const [found_ty] = get_deref_type_and_refs(found);
    return this.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty);
  });
  let closure_names_: string[];
  let call_names: string[];
  let fn_res: Res | undefined;
  if (
    args_have_same_underlying_type &&
    expected_inputs.length !== 0 &&
    expected_inputs.length === found_inputs.length &&
    this.typeck_results !== undefined &&
    (fn_res = this.typeck_results.qpath_res(path, arg_hir_id)).$ === "Def" &&
    DefKind.is_fn_like(fn_res._0)
  ) {
    const fn_def_id = fn_res._1;
    const closure: string[] = (this.tcx.fn_arg_idents(fn_def_id) as readonly (Ident | undefined)[]).map((ident, i) => {
      if (ident !== undefined && !(ident.name === kw.Underscore || ident.name === kw.SelfLower)) {
        return display_Ident(ident);
      } else {
        return `arg${i}`;
      }
    });
    const tys = both_tys();
    const args: string[] = [];
    for (let i = 0; i < Math.min(closure.length, tys.length); i++) {
      const name = closure[i]!;
      const [expected, found] = tys[i]!;
      args.push(arg_expr(this.infcx, name, expected, found));
    }
    closure_names_ = closure;
    call_names = args;
  } else {
    const closure_args = expected_inputs.map((_, i) => `arg${i}`);
    const call_args = both_tys().map(([expected, found], i) => arg_expr(this.infcx, `arg${i}`, expected, found));
    closure_names_ = closure_args;
    call_names = call_args;
  }
  const closure_names: string[] = [];
  for (let i = 0; i < Math.min(closure_names_.length, expected_inputs.length); i++) {
    const name = closure_names_[i]!;
    const ty = expected_inputs[i]!;
    closure_names.push(
      `${name}${
        TypeVisitableExt.has_infer_types(ty, fold_Ty) ? "" : TypeVisitableExt.references_error(ty, fold_Ty) ? ": /* type */" : `: ${display_Ty(ty)}`
      }`,
    );
  }
  err.multipart_suggestion(
    "consider wrapping the function in a closure",
    [
      [Span.shrink_to_lo(arg.span), `|${closure_names.join(", ")}| `],
      [Span.shrink_to_hi(arg.span), `(${call_names.join(", ")})`],
    ],
    "MaybeIncorrect",
  );
};

// Add a note if there are two `Fn`-family bounds that have conflicting argument
// requirements, which will always cause a closure to have a type error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3181 note_conflicting_closure_bounds
TypeErrCtxt.prototype.note_conflicting_closure_bounds = function (this: TypeErrCtxt, cause: ObligationCauseCode, err: Diag): void {
  // First, look for a `WhereClauseInExpr`, which means we can get
  // the uninstantiated predicate list of the called function. And check
  // that the predicate that we failed to satisfy is a `Fn`-like trait.
  if (cause.$ !== "WhereClauseInExpr") return;
  const def_id = cause._0;
  const idx = cause._3;
  const gen_clauses = GenericClauses.instantiate_identity(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx);
  const clause_ = gen_clauses.clauses[idx];
  if (clause_ === undefined) return;
  const clause = Unnormalized.skip_norm_wip(clause_);
  const kind = Binder.skip_binder(clause.kind());
  if (kind.$ !== "Trait") return;
  const trait_pred = kind._0;
  if (!this.tcx.is_fn_trait(TraitClause.def_id(trait_pred))) return;

  const expected_self = this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), TraitClause.self_ty(trait_pred)), fold_Ty);
  const expected_args = this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), trait_pred.trait_ref.args), fold_GenericArgs);

  // Find another clause whose self-type is equal to the expected self type,
  // but whose args don't match.
  let other_clause: [number, [Unnormalized<Clause>, Span]] | undefined;
  let other_idx = 0;
  for (const [clause_u, span] of gen_clauses) {
    const clause = Unnormalized.skip_norm_wip(clause_u);
    const k = Binder.skip_binder(clause.kind());
    if (
      k.$ === "Trait" &&
      this.tcx.is_fn_trait(TraitClause.def_id(k._0)) &&
      other_idx !== idx &&
      // Make sure that the self type matches
      // (i.e. constraining this closure)
      Binder_eq(expected_self, this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), TraitClause.self_ty(k._0)), fold_Ty)) &&
      // But the args don't match (i.e. incompatible args)
      !Binder_eq(expected_args, this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), k._0.trait_ref.args), fold_GenericArgs))
    ) {
      other_clause = [other_idx, [clause_u, span]];
      break;
    }
    other_idx++;
  }
  // If we found one, then it's very likely the cause of the error.
  if (other_clause !== undefined) {
    const other_clause_span = other_clause[1][1];
    err.span_note(other_clause_span, "closure inferred to have a different signature due to this bound");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3236 suggest_fully_qualified_path
TypeErrCtxt.prototype.suggest_fully_qualified_path = function (this: TypeErrCtxt, err: Diag, item_def_id: DefId, span: Span, trait_ref: DefId): void {
  const assoc_item = this.tcx.opt_associated_item(item_def_id);
  if (assoc_item !== undefined && (assoc_item.kind.$ === "Const" || assoc_item.kind.$ === "Type")) {
    err.note(
      `${this.tcx.def_kind_descr(AssocItem.as_def_kind(assoc_item), item_def_id)}s cannot be accessed directly on a \`trait\`, they can only be accessed through a specific \`impl\``,
    );

    if (!AssocItem.is_impl_trait_in_trait(assoc_item)) {
      err.span_suggestion_verbose(
        span,
        "use the fully qualified path to an implementation",
        `<Type as ${this.tcx.def_path_str(trait_ref)}>::${display_Symbol(AssocItem.name(assoc_item))}`,
        "HasPlaceholders",
      );
    }
  }
};

/// Adds an async-await specific note to the diagnostic when the future does not implement
/// an auto trait because of a captured type.
///
/// ```text
/// note: future does not implement `Qux` as this value is used across an await
///   --> $DIR/issue-64130-3-other.rs:17:5
///    |
/// LL |     let x = Foo;
///    |         - has type `Foo`
/// LL |     baz().await;
///    |     ^^^^^^^^^^^ await occurs here, with `x` maybe used later
/// LL | }
///    | - `x` is later dropped here
/// ```
///
/// When the diagnostic does not implement `Send` or `Sync` specifically, then the diagnostic
/// is "replaced" with a different message and a more specific error.
///
/// ```text
/// error: future cannot be sent between threads safely
///   --> $DIR/issue-64130-2-send.rs:21:5
///    |
/// LL | fn is_send<T: Send>(t: T) { }
///    |               ---- required by this bound in `is_send`
/// ...
/// LL |     is_send(bar());
///    |     ^^^^^^^ future returned by `bar` is not send
///    |
///    = help: within `impl std::future::Future`, the trait `std::marker::Send` is not
///            implemented for `Foo`
/// note: future is not send as this value is used across an await
///   --> $DIR/issue-64130-2-send.rs:15:5
///    |
/// LL |     let x = Foo;
///    |         - has type `Foo`
/// LL |     baz().await;
///    |     ^^^^^^^^^^^ await occurs here, with `x` maybe used later
/// LL | }
///    | - `x` is later dropped here
/// ```
///
/// Returns `true` if an async-await specific note was added to the diagnostic.
// #[instrument(level = "debug", skip_all, fields(?obligation.predicate, ?obligation.cause.span))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3310 maybe_note_obligation_cause_for_async_await
TypeErrCtxt.prototype.maybe_note_obligation_cause_for_async_await = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): boolean {
  // Attempt to detect an async-await error by looking at the obligation causes, looking
  // for a coroutine to be present.
  //
  // When a future does not implement a trait because of a captured type in one of the
  // coroutines somewhere in the call stack, then the result is a chain of obligations.
  //
  // Given an `async fn` A that calls an `async fn` B which captures a non-send type and that
  // future is passed as an argument to a function C which requires a `Send` type, then the
  // chain looks something like this:
  //
  // - `BuiltinDerivedObligation` with a coroutine witness (B)
  // - `BuiltinDerivedObligation` with a coroutine (B)
  // - `BuiltinDerivedObligation` with `impl std::future::Future` (B)
  // - `BuiltinDerivedObligation` with a coroutine witness (A)
  // - `BuiltinDerivedObligation` with a coroutine (A)
  // - `BuiltinDerivedObligation` with `impl std::future::Future` (A)
  // - `BindingObligation` with `impl_send` (Send requirement)
  //
  // The first obligation in the chain is the most useful and has the coroutine that captured
  // the type. The last coroutine (`outer_coroutine` below) has information about where the
  // bound was introduced. At least one coroutine should be present for this diagnostic to be
  // modified.
  let trait_ref: TraitClause | undefined;
  let target_ty: Ty | undefined;
  {
    const k = Binder.skip_binder(obligation.predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const p = k._0._0;
      trait_ref = p;
      target_ty = TraitClause.self_ty(p);
    } else {
      trait_ref = undefined;
      target_ty = undefined;
    }
  }
  let coroutine: DefId | undefined = undefined;
  let outer_coroutine: DefId | undefined = undefined;
  let next_code: ObligationCauseCode | undefined = obligation.cause.code_();

  let seen_upvar_tys_infer_tuple = false;

  loop: while (next_code !== undefined) {
    const code: ObligationCauseCode = next_code;
    // debug!(?code);
    switch (code.$) {
      case "FunctionArg": {
        next_code = ObligationCauseCodeHandle.deref(code.parent_code);
        break;
      }
      case "ImplDerived": {
        const cause = code._0;
        const ty = TraitClause.self_ty(Binder.skip_binder(cause.derived.parent_trait_pred));
        // debug!(parent_trait_ref = ?cause.derived.parent_trait_pred, self_ty.kind = ?ty.kind(), "ImplDerived");

        const k = ty.kind();
        if (k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
          const did = k._0;
          coroutine = coroutine ?? did;
          outer_coroutine = did;
        } else if (k.$ === "Tuple" && !seen_upvar_tys_infer_tuple) {
          // By introducing a tuple of upvar types into the chain of obligations
          // of a coroutine, the first non-coroutine item is now the tuple itself,
          // we shall ignore this.

          seen_upvar_tys_infer_tuple = true;
        } else if (coroutine === undefined) {
          trait_ref = Binder.skip_binder(cause.derived.parent_trait_pred);
          target_ty = ty;
        }

        next_code = ObligationCauseCodeHandle.deref(cause.derived.parent_code);
        break;
      }
      case "WellFormedDerived":
      case "BuiltinDerived": {
        const derived_obligation = code._0;
        const ty = TraitClause.self_ty(Binder.skip_binder(derived_obligation.parent_trait_pred));
        // debug!(parent_trait_ref = ?derived_obligation.parent_trait_pred, self_ty.kind = ?ty.kind());

        const k = ty.kind();
        if (k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
          const did = k._0;
          coroutine = coroutine ?? did;
          outer_coroutine = did;
        } else if (k.$ === "Tuple" && !seen_upvar_tys_infer_tuple) {
          // By introducing a tuple of upvar types into the chain of obligations
          // of a coroutine, the first non-coroutine item is now the tuple itself,
          // we shall ignore this.

          seen_upvar_tys_infer_tuple = true;
        } else if (coroutine === undefined) {
          trait_ref = Binder.skip_binder(derived_obligation.parent_trait_pred);
          target_ty = ty;
        }

        next_code = ObligationCauseCodeHandle.deref(derived_obligation.parent_code);
        break;
      }
      default:
        break loop;
    }
  }

  // Only continue if a coroutine was found.
  // debug!(?coroutine, ?trait_ref, ?target_ty);
  if (coroutine === undefined || trait_ref === undefined || target_ty === undefined) {
    return false;
  }
  const coroutine_did = coroutine;
  const trait_ref_ = trait_ref;
  const target_ty_ = target_ty;

  const span = this.tcx.def_span(coroutine_did);

  const coroutine_did_root = this.tcx.typeck_root_def_id(coroutine_did);
  // debug!(?coroutine_did, ?coroutine_did_root, typeck_results.hir_owner = ?self.typeck_results.as_ref().map(|t| t.hir_owner), ?span);

  const coroutine_did_local = coroutine_did.as_local();
  const coroutine_body = coroutine_did_local === undefined ? undefined : this.tcx.hir_maybe_body_owned_by(coroutine_did_local);
  const visitor = AwaitsVisitor.default();
  if (coroutine_body !== undefined) {
    const body = coroutine_body;
    visitor.visit_body(body);
  }
  // debug!(awaits = ?visitor.awaits);

  // Look for a type inside the coroutine interior that matches the target type to get
  // a span.
  const target_ty_erased = this.tcx.erase_and_anonymize_regions(target_ty_, fold_Ty);
  const ty_matches = (ty: Binder<Ty>): boolean => {
    // Careful: the regions for types that appear in the
    // coroutine interior are not generally known, so we
    // want to erase them when comparing (and anyway,
    // `Send` and other bounds are generally unaffected by
    // the choice of region). When erasing regions, we
    // also have to erase late-bound regions. This is
    // because the types that appear in the coroutine
    // interior generally contain "bound regions" to
    // represent regions that are part of the suspended
    // coroutine frame. Bound regions are preserved by
    // `erase_and_anonymize_regions` and so we must also call
    // `instantiate_bound_regions_with_erased`.
    const ty_erased_ = this.tcx.instantiate_bound_regions_with_erased(ty, fold_Ty);
    const ty_erased = this.tcx.erase_and_anonymize_regions(ty_erased_, fold_Ty);
    const eq = ty_erased === target_ty_erased;
    // debug!(?ty_erased, ?target_ty_erased, ?eq);
    return eq;
  };

  // Get the typeck results from the infcx if the coroutine is the function we are currently
  // type-checking; otherwise, get them by performing a query. This is needed to avoid
  // cycles. If we can't use resolved types because the coroutine comes from another crate,
  // we still provide a targeted error but without all the relevant spans.
  let coroutine_data: CoroutineData;
  const t = this.typeck_results;
  if (t !== undefined && DefId_eq(LocalDefId.to_def_id(t.hir_owner.def_id), coroutine_did_root)) {
    coroutine_data = new CoroutineData(t);
  } else if (coroutine_did.is_local()) {
    // PORT: the `typeck` query's value is typed `unknown` in queries.gen.ts; it is `&TypeckResults`.
    coroutine_data = new CoroutineData(this.tcx.typeck(coroutine_did.expect_local()) as TypeckResults);
  } else {
    return false;
  }

  const coroutine_within_in_progress_typeck =
    this.typeck_results !== undefined ? DefId_eq(LocalDefId.to_def_id(this.typeck_results.hir_owner.def_id), coroutine_did_root) : false;

  let interior_or_upvar_span: CoroutineInteriorOrUpvar | undefined = undefined;

  const from_awaited_ty = CoroutineData_get_from_await_ty(coroutine_data, visitor, this.tcx, ty_matches);
  // debug!(?from_awaited_ty);

  // Avoid disclosing internal information to downstream crates.
  if (
    coroutine_did.is_local() &&
    // Try to avoid cycles.
    !coroutine_within_in_progress_typeck
  ) {
    // PORT: the `mir_coroutine_witnesses` query's value is typed `unknown` in queries.gen.ts (MIR, M4); it is
    // `Option<&CoroutineLayout>`; `CoroutineLayoutView` is the view of the fields read here.
    const coroutine_info = this.tcx.mir_coroutine_witnesses(coroutine_did) as CoroutineLayoutView | undefined;
    if (coroutine_info !== undefined) {
      // debug!(?coroutine_info);
      find_source: for (let v = 0; v < Math.min(coroutine_info.variant_fields.length, coroutine_info.variant_source_info.length); v++) {
        const variant = coroutine_info.variant_fields[v]!;
        const source_info = coroutine_info.variant_source_info[v]!;
        // debug!(?variant);
        for (const local of variant) {
          const decl = coroutine_info.field_tys[local]!;
          // debug!(?decl);
          if (ty_matches(Binder.dummy(decl.ty, fold_Ty)) && !decl.ignore_for_traits) {
            interior_or_upvar_span = { $: "Interior", _0: decl.source_info.span, _1: [source_info.span, from_awaited_ty] };
            break find_source;
          }
        }
      }
    }
  }

  if (interior_or_upvar_span === undefined) {
    interior_or_upvar_span = CoroutineData_try_get_upvar_span(coroutine_data, this.infcx, coroutine_did, ty_matches);
  }

  if (interior_or_upvar_span === undefined && !coroutine_did.is_local()) {
    interior_or_upvar_span = { $: "Interior", _0: span, _1: undefined };
  }

  // debug!(?interior_or_upvar_span);
  if (interior_or_upvar_span !== undefined) {
    const is_async = this.tcx.coroutine_is_async(coroutine_did);
    this.note_obligation_cause_for_async_await(err, interior_or_upvar_span, is_async, outer_coroutine, trait_ref_, target_ty_, obligation, next_code);
    return true;
  } else {
    return false;
  }
};

/// Unconditionally adds the diagnostic note described in
/// `maybe_note_obligation_cause_for_async_await`'s documentation comment.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3542 note_obligation_cause_for_async_await
TypeErrCtxt.prototype.note_obligation_cause_for_async_await = function (
  this: TypeErrCtxt,
  err: Diag,
  interior_or_upvar_span: CoroutineInteriorOrUpvar,
  is_async: boolean,
  outer_coroutine: DefId | undefined,
  trait_pred: TraitClause,
  target_ty: Ty,
  obligation: PredicateObligation,
  next_code: ObligationCauseCode | undefined,
): void {
  const source_map = this.tcx.sess.source_map();

  const [await_or_yield, an_await_or_yield] = is_async ? ["await", "an await"] : ["yield", "a yield"];
  const future_or_coroutine = is_async ? "future" : "coroutine";

  // Special case the primary error message when send or sync is the trait that was
  // not implemented.
  let trait_explanation: string;
  const name = this.tcx.get_diagnostic_name(TraitClause.def_id(trait_pred));
  if (name !== undefined && (name === sym.Send || name === sym.Sync)) {
    const [trait_name, trait_verb] = name === sym.Send ? ["`Send`", "sent"] : ["`Sync`", "shared"];

    err.deref_mut().code = undefined;
    err.primary_message(`${future_or_coroutine} cannot be ${trait_verb} between threads safely`);

    const original_span = unwrap(err.deref().span.primary_span());
    const span = MultiSpan.from_span(original_span);

    // `self.tcx.parent(coroutine_did).as_local().map(..).and_then(|parent_hir_id| self.tcx.hir_opt_name(parent_hir_id))`
    const parent_name = (coroutine_did: DefId): Symbol | undefined => {
      const parent_did = this.tcx.parent(coroutine_did).as_local();
      if (parent_did === undefined) return undefined;
      const parent_hir_id = this.tcx.local_def_id_to_hir_id(parent_did);
      return this.tcx.hir_opt_name(parent_hir_id);
    };
    const message_ = (coroutine_did: DefId): string | undefined => {
      // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
      const kind = unwrap(this.tcx.coroutine_kind(coroutine_did) as hir.CoroutineKind | undefined);
      if (kind.$ === "Coroutine") {
        return `coroutine is not ${trait_name}`;
      }
      switch (kind._0) {
        case "Async":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `future returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `future created by async block is not ${trait_name}`;
            case "Closure":
              return `future created by async closure is not ${trait_name}`;
          }
          break;
        case "AsyncGen":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `async iterator returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `async iterator created by async gen block is not ${trait_name}`;
            case "Closure":
              return `async iterator created by async gen closure is not ${trait_name}`;
          }
          break;
        case "Gen":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `iterator returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `iterator created by gen block is not ${trait_name}`;
            case "Closure":
              return `iterator created by gen closure is not ${trait_name}`;
          }
          break;
      }
      return unreachable();
    };
    const message = (outer_coroutine === undefined ? undefined : message_(outer_coroutine)) ?? `${future_or_coroutine} is not ${trait_name}`;

    span.push_span_label(original_span, message);
    err.span(span);

    trait_explanation = `is not ${trait_name}`;
  } else {
    trait_explanation = `does not implement \`${display_TraitClausePrintModifiersAndPath(TraitClause_print_modifiers_and_trait_path(trait_pred))}\``;
  }

  const explain_yield = (interior_span: Span, yield_span: Span): void => {
    const span = MultiSpan.from_span(yield_span);
    const snippet_r = source_map.span_to_snippet(interior_span);
    let snippet: string;
    // #70935: If snippet contains newlines, display "the value" instead
    // so that we do not emit complex diagnostics.
    if (snippet_r.$ === "Ok" && !snippet_r._0.toString().includes("\n")) {
      snippet = `\`${snippet_r._0.toString()}\``;
    } else {
      snippet = "the value";
    }
    // note: future is not `Send` as this value is used across an await
    //   --> $DIR/issue-70935-complex-spans.rs:13:9
    //    |
    // LL |            baz(|| async {
    //    |  ______________-
    //    | |
    //    | |
    // LL | |              foo(tx.clone());
    // LL | |          }).await;
    //    | |          - ^^^^^^ await occurs here, with value maybe used later
    //    | |__________|
    //    |            has type `closure` which is not `Send`
    // note: value is later dropped here
    // LL | |          }).await;
    //    | |                  ^
    //
    span.push_span_label(yield_span, `${await_or_yield} occurs here, with ${snippet} maybe used later`);
    span.push_span_label(interior_span, `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}`);
    err.span_note(span, `${future_or_coroutine} ${trait_explanation} as this value is used across ${an_await_or_yield}`);
  };
  switch (interior_or_upvar_span.$) {
    case "Interior": {
      const interior_span = interior_or_upvar_span._0;
      const interior_extra_info = interior_or_upvar_span._1;
      if (interior_extra_info !== undefined) {
        const [yield_span, from_awaited_ty] = interior_extra_info;
        if (from_awaited_ty !== undefined) {
          const await_span = from_awaited_ty;
          // The type causing this obligation is one being awaited at await_span.
          const span = MultiSpan.from_span(await_span);
          span.push_span_label(await_span, `await occurs here on type \`${display_Ty(target_ty)}\`, which ${trait_explanation}`);
          err.span_note(span, `future ${trait_explanation} as it awaits another future which ${trait_explanation}`);
        } else {
          // Look at the last interior type to get a span for the `.await`.
          explain_yield(interior_span, yield_span);
        }
      }
      break;
    }
    case "Upvar": {
      const upvar_span = interior_or_upvar_span._0;
      // `Some((ref_ty, is_mut))` if `target_ty` is `&T` or `&mut T` and fails to impl `Send`
      let non_send: [Ty, boolean] | undefined;
      const k = target_ty.kind();
      if (k.$ === "Ref") {
        const ref_ty = k._1;
        const mutability = k._2;
        const eval_ = this.evaluate_obligation(obligation);
        if (eval_.$ === "Ok" && !EvaluationResult.may_apply(eval_._0)) {
          non_send = [ref_ty, mutability === "Mut"];
        } else {
          non_send = undefined;
        }
      } else {
        non_send = undefined;
      }

      let span_label: string;
      let span_note: string;
      if (non_send !== undefined) {
        // if `target_ty` is `&T` or `&mut T` and fails to impl `Send`,
        // include suggestions to make `T: Sync` so that `&T: Send`,
        // or to make `T: Send` so that `&mut T: Send`
        const [ref_ty, is_mut] = non_send;
        const ref_ty_trait = is_mut ? "Send" : "Sync";
        const ref_kind = is_mut ? "&mut" : "&";
        span_label = `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}, because \`${display_Ty(ref_ty)}\` is not \`${ref_ty_trait}\``;
        span_note = `captured value ${trait_explanation} because \`${ref_kind}\` references cannot be sent unless their referent is \`${ref_ty_trait}\``;
      } else {
        span_label = `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}`;
        span_note = `captured value ${trait_explanation}`;
      }

      const span = MultiSpan.from_span(upvar_span);
      span.push_span_label(upvar_span, span_label);
      err.span_note(span, span_note);
      break;
    }
  }

  // Add a note for the item obligation that remains - normally a note pointing to the
  // bound that introduced the obligation (e.g. `T: Send`).
  // debug!(?next_code);
  this.note_obligation_cause_code(
    obligation.cause.body_def_id,
    err,
    obligation.predicate,
    obligation.param_env,
    unwrap(next_code),
    [],
    new DefIdSet(),
    upcast_from_Predicate,
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3776 note_closure_capture
TypeErrCtxt.prototype.note_closure_capture = function (
  this: TypeErrCtxt,
  err: Diag,
  closure_def_id_: DefId,
  upvar_args: UpvarArgs,
  capture_ty_: Ty | undefined,
): boolean {
  const closure_def_id = closure_def_id_.as_local();
  if (closure_def_id === undefined) {
    return false;
  }
  if (capture_ty_ === undefined) {
    return false;
  }

  // This can run while `typeck` for the closure's root is still on the query stack, for
  // example when reporting an overflow from inside trait selection, so only the in-progress
  // results are safe to look at. Asking for the captures through `tcx.closure_captures`
  // would call `typeck` again and replace the error being reported with a cycle error.
  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) {
    return false;
  }
  const typeck_root = this.tcx.typeck_root_def_id(LocalDefId.to_def_id(closure_def_id));
  if (!DefId_eq(LocalDefId.to_def_id(typeck_results.hir_owner.def_id), typeck_root)) {
    return false;
  }

  // Error reporting can run before closure capture analysis has inferred the
  // tuple of upvar types. avoid accessing upvar types until they are available.
  let upvar_tys: readonly Ty[];
  const tupled = UpvarArgs.tupled_upvars_ty(upvar_args).kind();
  switch (tupled.$) {
    case "Tuple":
      upvar_tys = tupled._0;
      break;
    case "Error":
      upvar_tys = RawList.empty<Ty>();
      break;
    case "Infer":
      return false;
    default:
      return unreachable(`internal error: entered unreachable code: unexpected upvar types tuple: ${debug_TyKind(tupled, PLAIN)}`);
  }

  const captures = [...typeck_results.closure_min_captures_flattened(closure_def_id)];
  if (captures.length !== upvar_tys.length) {
    return false;
  }

  const capture_ty = this.tcx.erase_and_anonymize_regions(this.deeply_resolve_ignoring_regions(capture_ty_, fold_Ty), fold_Ty);
  let capture: (typeof captures)[number] | undefined;
  for (let i = 0; i < Math.min(captures.length, upvar_tys.length); i++) {
    const c = captures[i]!;
    const upvar_ty = this.tcx.erase_and_anonymize_regions(this.deeply_resolve_ignoring_regions(upvar_tys[i]!, fold_Ty), fold_Ty);
    if (upvar_ty === capture_ty) {
      capture = c;
      break;
    }
  }
  if (capture === undefined) {
    return false;
  }

  err.span_note(capture.get_path_span(this.tcx), `required because \`${capture.to_string(this.tcx)}\` is used within this closure`);
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3838 note_obligation_cause_code
TypeErrCtxt.prototype.note_obligation_cause_code = function <T>(
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  obligated_types: Ty[],
  seen_requirements: DefIdSet,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const predicate = upcast_from_T(predicate_, this.tcx as unknown as Interner);
  // Built-in closure obligations pass through a synthetic tuple of upvar types. Remember
  // the last constituent before that tuple so it can be matched to a captured place.
  const as_trait = predicate.as_trait_clause();
  const closure_capture_ty: MutRef<Ty | undefined> = {
    value: as_trait === undefined ? undefined : TraitClause.self_ty(Binder.skip_binder(as_trait)),
  };
  this.note_obligation_cause_code_inner(
    body_def_id,
    err,
    predicate,
    param_env,
    cause_code,
    obligated_types,
    seen_requirements,
    closure_capture_ty,
    upcast_from_Predicate,
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3867 note_obligation_cause_code_inner
TypeErrCtxt.prototype.note_obligation_cause_code_inner = function <T>(
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  obligated_types: Ty[],
  seen_requirements: DefIdSet,
  closure_capture_ty: MutRef<Ty | undefined>,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const tcx = this.tcx;
  const predicate = upcast_from_T(predicate_, tcx as unknown as Interner);
  const suggest_remove_deref = (err: Diag, expr: hir.Expr): void => {
    const pred = predicate.as_trait_clause();
    if (pred !== undefined && tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized) && expr.kind.$ === "Unary" && expr.kind._0 === "Deref") {
      const inner = expr.kind._1;
      err.span_suggestion_verbose(
        Span.until(expr.span, inner.span),
        "references are always `Sized`, even if they point to unsized data; consider not dereferencing the expression",
        "",
        "MaybeIncorrect",
      );
    }
  };
  switch (cause_code.$) {
    case "ExprAssignable":
    case "MatchExpressionArm":
    case "Pattern":
    case "IfExpression":
    case "IfExpressionWithNoElse":
    case "MainFunctionType":
    case "LangFunctionType":
    case "IntrinsicType":
    case "MethodReceiver":
    case "ReturnNoExpression":
    case "Misc":
    case "WellFormed":
    case "ReturnValue":
    case "BlockTailExpression":
    case "AwaitableExpr":
    case "ForLoopIterator":
    case "QuestionMark":
    case "CheckAssociatedTypeBounds":
    case "LetElse":
    case "UnOp":
    case "AscribeUserTypeProvePredicate":
    case "AlwaysApplicableImpl":
    case "ConstParam":
    case "ReferenceOutlivesReferent":
    case "ObjectTypeBound":
      break;
    case "BinOp": {
      const lhs_node = tcx.hir_node(cause_code.lhs_hir_id);
      const rhs_node = tcx.hir_node(cause_code.rhs_hir_id);
      if (
        lhs_node.$ === "Expr" &&
        rhs_node.$ === "Expr" &&
        tcx.sess.source_map().lookup_char_pos(Span.lo(lhs_node._0.span)).line !== tcx.sess.source_map().lookup_char_pos(Span.hi(rhs_node._0.span)).line
      ) {
        const lhs = lhs_node._0;
        const rhs = rhs_node._0;
        err.span_label(lhs.span, "");
        err.span_label(rhs.span, "");
      }
      break;
    }
    case "RustCall": {
      const pred = predicate.as_trait_clause();
      if (pred !== undefined && tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized)) {
        err.note('argument required to be sized due to `extern "rust-call"` ABI');
      }
      break;
    }
    case "SliceOrArrayElem": {
      err.note("slice and array elements must have `Sized` type");
      break;
    }
    case "ArrayLen": {
      const array_ty = cause_code._0;
      err.note(`the length of array \`${display_Ty(array_ty)}\` must be type \`usize\``);
      break;
    }
    case "TupleElem": {
      err.note("only the last element of a tuple may have a dynamically sized type");
      break;
    }
    case "DynCompatible": {
      const span = cause_code._0;
      err.multipart_suggestion("you might have meant to use `Self` to refer to the implementing type", [[span, "Self"]], "MachineApplicable");
      break;
    }
    case "WhereClause":
    case "WhereClauseInExpr":
    case "HostEffectInExpr": {
      const item_def_id = cause_code._0;
      const span = cause_code._1;
      if (Span.is_dummy(span)) {
        // ObligationCauseCode::WhereClause(..) | WhereClauseInExpr(..) | HostEffectInExpr(..):
        // We hold the `DefId` of the item introducing the obligation, but displaying it
        // doesn't add user usable information. It always point at an associated item.
        break;
      }
      if (cause_code.$ === "WhereClauseInExpr") {
        const hir_id = cause_code._2;
        const pos = cause_code._3;
        const parent = tcx.parent_hir_node(hir_id);
        let node: hir.Node;
        if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && parent._0.kind._1[pos] !== undefined) {
          const expr = parent._0.kind._1[pos]!;
          suggest_remove_deref(err, expr);
        } else if (
          (node = this.tcx.hir_node(hir_id)).$ === "Expr" &&
          node._0.kind.$ === "MethodCall" &&
          node._0.kind._2[pos] !== undefined
        ) {
          const expr = node._0.kind._2[pos]!;
          suggest_remove_deref(err, expr);
        }
      }
      const item_name = tcx.def_path_str(item_def_id);
      const short_item_name = with_forced_trimmed_paths(() => tcx.def_path_str(item_def_id));
      const multispan = MultiSpan.from_Span(span);
      const sm = tcx.sess.source_map();
      const item_kind = tcx.def_kind(item_def_id);
      if (item_kind.$ === "AssocConst" || item_kind.$ === "AssocFn" || item_kind.$ === "AssocTy") {
        const span = Span.shrink_to_lo(tcx.def_span(tcx.parent(item_def_id)));
        multispan.push_span_context(span);
      }
      const ident = tcx.opt_item_ident(item_def_id);
      if (ident !== undefined) {
        multispan.push_span_context(ident.span);
      }
      let a = "a";
      let this_ = "this bound";
      let note: string | undefined = undefined;
      let help: string | undefined = undefined;
      const pk = Binder.skip_binder(predicate.kind());
      if (pk.$ === "Clause") {
        const clause = pk._0;
        switch (clause.$) {
          case "Trait": {
            const trait_pred = clause._0;
            const def_id = TraitClause.def_id(trait_pred);
            let visible_item: boolean;
            const local = def_id.as_local();
            if (local !== undefined) {
              const ty = TraitClause.self_ty(trait_pred);
              // when `TraitA: TraitB` and `S` only impl TraitA,
              // we check if `TraitB` can be reachable from `S`
              // to determine whether to note `TraitA` is sealed trait.
              const ty_kind = ty.kind();
              if (ty_kind.$ === "Adt") {
                const adt = ty_kind._0;
                const visibilities = tcx.resolutions(null).effective_visibilities;
                const v = visibilities.effective_vis(local);
                visible_item = v === undefined || Visibility.is_accessible_from(v.at_level(Level.Reexported), adt.did(), tcx);
              } else {
                // FIXME(xizheyin): if the type is not ADT, we should not suggest it
                visible_item = true;
              }
            } else {
              // Check for foreign traits being reachable.
              visible_item = tcx.visible_parent_map(null).get(def_id) !== undefined;
            }
            if (tcx.is_lang_item(def_id, LangItem.Sized)) {
              // Check if this is an implicit bound, even in foreign crates.
              // PORT: the `generics_of` query's value is typed `unknown` in queries.gen.ts; it is `&Generics`.
              if ((tcx.generics_of(item_def_id) as Generics).own_params.some((param) => tcx.def_span(param.def_id) === span)) {
                a = "an implicit `Sized`";
                this_ = "the implicit `Sized` requirement on this type parameter";
              }
              const node = tcx.hir_get_if_local(item_def_id);
              if (
                node !== undefined &&
                node.$ === "TraitItem" &&
                node._0.kind.$ === "Type" &&
                node._0.kind._1 === undefined &&
                // Do not suggest relaxing if there is an explicit `Sized` obligation.
                !node._0.kind._0.some((bound) => {
                  const tr = hir.GenericBound.trait_ref(bound);
                  if (tr === undefined) return false;
                  return is_some_and(tr.trait_def_id(), (def_id) => tcx.is_lang_item(def_id, LangItem.Sized));
                })
              ) {
                const generics = node._0.generics;
                const bounds = node._0.kind._0;
                let span: Span;
                let separator: string;
                if (bounds.length >= 1) {
                  const last = bounds[bounds.length - 1]!;
                  span = Span.shrink_to_hi(hir.GenericBound.span(last));
                  separator = " +";
                } else {
                  span = Span.shrink_to_hi(generics.span);
                  separator = ":";
                }
                err.span_suggestion_verbose(span, "consider relaxing the implicit `Sized` restriction", `${separator} ?Sized`, "MachineApplicable");
              }
            }
            if (tcx.def_kind(item_def_id).$ === "Trait" && !visible_item) {
              note = `\`${short_item_name}\` is a "sealed trait", because to implement it you also need to implement \`${with_no_trimmed_paths(() => tcx.def_path_str(def_id))}\`, which is not accessible; this is usually done to force you to use one of the provided types that already implement it`;
              const types = [...tcx.all_impls(def_id)].map((t) =>
                with_no_trimmed_paths(
                  // PORT: the `type_of` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Ty>`.
                  () => `  ${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(t) as EarlyBinder<Ty>)))}`,
                ),
              );
              if (types.length !== 0) {
                const len = types.length;
                let post: string;
                if (len > 9) {
                  types.length = 8;
                  post = `\nand ${len - 8} others`;
                } else {
                  post = "";
                }
                help = `the following type${pluralize(len)} implement${len === 1 ? "s" : ""} the trait:\n${types.join("\n")}${post}`;
              }
            }
            break;
          }
          case "ConstArgHasType": {
            const descr = `required by a const generic parameter in \`${item_name}\``;
            if (Span.is_visible(span, sm)) {
              const msg = `required by this const generic parameter in \`${short_item_name}\``;
              multispan.push_span_label(span, msg);
              err.span_note(multispan, descr);
            } else {
              err.span_note(tcx.def_span(item_def_id), descr);
            }
            return;
          }
          default:
            break;
        }
      }

      // If this is from a format string literal desugaring,
      // we've already said "required by this formatting parameter"
      let is_in_fmt_lit: boolean;
      const s = err.deref().span.primary_span();
      if (s !== undefined) {
        const dk = Span.desugaring_kind(s);
        is_in_fmt_lit = dk !== undefined && dk.$ === "FormatLiteral";
      } else {
        is_in_fmt_lit = false;
      }
      if (!is_in_fmt_lit) {
        const descr = `required by ${a} bound in \`${item_name}\``;
        if (Span.is_visible(span, sm)) {
          const msg = `required by ${this_} in \`${short_item_name}\``;
          multispan.push_span_label(span, msg);
          err.span_note(multispan, descr);
        } else {
          err.span_note(tcx.def_span(item_def_id), descr);
        }
      }
      if (note !== undefined) {
        err.note(note);
      }
      if (help !== undefined) {
        err.help(help);
      }
      break;
    }
    case "OpaqueTypeBound": {
      const span = cause_code._0;
      const definition_def_id = cause_code._1;
      err.span_note(span, "required by a bound in an opaque type");
      if (
        definition_def_id !== undefined &&
        // If there are any stalled coroutine obligations, then this
        // error may be due to that, and not because the body has more
        // where-clauses.
        // PORT: the `typeck` query's value is typed `unknown` in queries.gen.ts; it is `&TypeckResults`.
        (this.tcx.typeck(definition_def_id) as TypeckResults).coroutine_stalled_predicates.size === 0
      ) {
        // FIXME(compiler-errors): We could probably point to something
        // specific here if we tried hard enough...
        err.span_note(tcx.def_span(LocalDefId.to_def_id(definition_def_id)), "this definition site has more where clauses than the opaque type");
      }
      break;
    }
    case "Coercion": {
      const source = tcx.short_string(this.deeply_resolve_ignoring_regions(cause_code.source, fold_Ty), err.long_ty_path(), print_Ty_);
      const target = tcx.short_string(this.deeply_resolve_ignoring_regions(cause_code.target, fold_Ty), err.long_ty_path(), print_Ty_);
      err.note(with_forced_trimmed_paths(() => `required for the cast from \`${source}\` to \`${target}\``));
      break;
    }
    case "RepeatElementCopy": {
      const is_constable = cause_code.is_constable;
      const elt_span = cause_code.elt_span;
      err.note("the `Copy` trait is required because this value will be copied for each element of the array");
      const sm = tcx.sess.source_map();
      if ((is_constable === "Fn" || is_constable === "Ctor") && sm.span_to_snippet(elt_span).$ === "Ok") {
        err.multipart_suggestion(
          "create an inline `const` block",
          [
            [Span.shrink_to_lo(elt_span), "const { "],
            [Span.shrink_to_hi(elt_span), " }"],
          ],
          "MachineApplicable",
        );
      } else {
        // FIXME: we may suggest array::repeat instead
        err.help("consider using `core::array::from_fn` to initialize the array");
        err.help("see https://doc.rust-lang.org/stable/std/array/fn.from_fn.html for more information");
      }
      break;
    }
    case "VariableType": {
      const hir_id = cause_code._0;
      if (this.typeck_results !== undefined) {
        const ty = this.typeck_results.node_type_opt(hir_id);
        if (ty !== undefined && ty.kind().$ === "Error") {
          err.note(`\`${display_Predicate(predicate)}\` isn't satisfied, but the type of this pattern is \`{type error}\``);
          err.downgrade_to_delayed_bug();
        }
      }
      let local = true;
      const parent = tcx.parent_hir_node(hir_id);
      if (parent.$ === "LetStmt" && parent._0.ty !== undefined) {
        const ty = parent._0.ty;
        err.span_suggestion_verbose(Span.shrink_to_lo(ty.span), "consider borrowing here", "&", "MachineApplicable");
      } else if (parent.$ === "LetStmt" && parent._0.init !== undefined && parent._0.init.kind.$ === "Index") {
        const span = parent._0.init.span;
        // When encountering an assignment of an unsized trait, like
        // `let x = ""[..];`, provide a suggestion to borrow the initializer in
        // order to use have a slice instead.
        err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider borrowing here", "&", "MachineApplicable");
      } else if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
        const expr = parent._0.init;
        // When encountering an assignment of an unsized trait, like `let x = *"";`,
        // we check if the RHS is a deref operation, to suggest removing it.
        suggest_remove_deref(err, expr);
      } else if (parent.$ === "Param") {
        const param = parent._0;
        err.span_suggestion_verbose(
          Span.shrink_to_lo(param.ty_span),
          "function arguments must have a statically known size, borrowed types always have a known size",
          "&",
          "MachineApplicable",
        );
        local = false;
      }
      if (local) {
        err.note("all local variables must have a statically known size");
      }
      break;
    }
    case "SizedArgumentType": {
      const hir_id = cause_code._0;
      let ty: hir.Ty | undefined = undefined;
      const borrowed_msg = "function arguments must have a statically known size, borrowed types always have a known size";
      let param_node: hir.Node | undefined;
      let decl: hir.FnDecl | undefined;
      let t: hir.Ty | undefined;
      let ty_node: hir.Node | undefined;
      if (
        hir_id !== undefined &&
        (param_node = this.tcx.hir_node(hir_id)).$ === "Param" &&
        (decl = hir.Node.fn_decl(this.tcx.parent_hir_node(hir_id))) !== undefined &&
        (t = decl.inputs.find((t) => Span.contains((param_node as { _0: hir.Param })._0.ty_span, t.span))) !== undefined
      ) {
        // We use `contains` because the type might be surrounded by parentheses,
        // which makes `ty_span` and `t.span` disagree with each other, but one
        // fully contains the other: `foo: (dyn Foo + Bar)`
        //                                 ^-------------^
        //                                 ||
        //                                 |t.span
        //                                 param._ty_span
        ty = t;
      } else if (hir_id !== undefined && (ty_node = this.tcx.hir_node(hir_id)).$ === "Ty") {
        ty = ty_node._0;
      }
      if (ty !== undefined) {
        switch (ty.kind.$) {
          case "TraitObject": {
            const traits = ty.kind._0;
            let span: Span;
            let kw_: string;
            if (traits.length >= 1 && Span.lo(traits[0]!.span) === Span.lo(ty.span)) {
              // Missing `dyn` in front of trait object.
              span = Span.shrink_to_lo(ty.span);
              kw_ = "dyn ";
            } else if (traits.length >= 1) {
              span = Span.until(ty.span, traits[0]!.span);
              kw_ = "";
            } else {
              return span_bug(ty.span, `trait object with no traits: ${hir.debug_Ty(ty, PLAIN, (_x, _f) => "()")}`);
            }
            const needs_parens = traits.length !== 1;
            // Don't recommend impl Trait as a closure argument
            if (hir_id !== undefined) {
              const parent = this.tcx.parent_hir_node(hir_id);
              if (parent.$ === "Item" && parent._0.kind.$ === "Fn") {
                err.span_suggestion_verbose(span, "you can use `impl Trait` as the argument type", "impl ", "MaybeIncorrect");
              }
            }
            let sugg: [Span, string][];
            if (!needs_parens) {
              sugg = [[Span.shrink_to_lo(span), `&${kw_}`]];
            } else {
              sugg = [
                [Span.shrink_to_lo(span), `&(${kw_}`],
                [Span.shrink_to_hi(ty.span), ")"],
              ];
            }
            err.multipart_suggestion(borrowed_msg, sugg, "MachineApplicable");
            break;
          }
          case "Slice": {
            err.span_suggestion_verbose(
              Span.shrink_to_lo(ty.span),
              "function arguments must have a statically known size, borrowed slices always have a known size",
              "&",
              "MachineApplicable",
            );
            break;
          }
          case "Path": {
            err.span_suggestion_verbose(Span.shrink_to_lo(ty.span), borrowed_msg, "&", "MachineApplicable");
            break;
          }
          default:
            break;
        }
      } else {
        err.note("all function arguments must have a statically known size");
      }
      if (UnstableFeatures.is_nightly_build(tcx.sess.opts.unstable_features) && !tcx.features().unsized_fn_params()) {
        err.help("unsized fn params are gated as an unstable feature");
      }
      break;
    }
    case "SizedReturnType":
    case "SizedCallReturnType": {
      err.note("the return type of a function must have a statically known size");
      break;
    }
    case "SizedYieldType": {
      err.note("the yield type of a coroutine must have a statically known size");
      break;
    }
    case "AssignmentLhsSized": {
      err.note("the left-hand-side of an assignment must have a statically known size");
      break;
    }
    case "TupleInitializerSized": {
      err.note("tuples must have a statically known size to be initialized");
      break;
    }
    case "StructInitializerSized": {
      err.note("structs must have a statically known size to be initialized");
      break;
    }
    case "FieldSized": {
      const item = cause_code.adt_kind;
      const last = cause_code.last;
      const span = cause_code.span;
      switch (item) {
        case "Struct": {
          if (last) {
            err.note("the last field of a packed struct may only have a dynamically sized type if it does not need drop to be run");
          } else {
            err.note("only the last field of a struct may have a dynamically sized type");
          }
          break;
        }
        case "Union": {
          err.note("no field of a union may have a dynamically sized type");
          break;
        }
        case "Enum": {
          err.note("no field of an enum variant may have a dynamically sized type");
          break;
        }
      }
      err.help("change the field's type to have a statically known size");
      err.span_suggestion_verbose(Span.shrink_to_lo(span), "borrowed types always have a statically known size", "&", "MachineApplicable");
      err.multipart_suggestion(
        "the `Box` type always has a statically known size and allocates its contents in the heap",
        [
          [Span.shrink_to_lo(span), "Box<"],
          [Span.shrink_to_hi(span), ">"],
        ],
        "MachineApplicable",
      );
      break;
    }
    case "SizedConstOrStatic": {
      err.note("statics and constants must have a statically known size");
      break;
    }
    case "InlineAsmSized": {
      err.note("all inline asm arguments must have a statically known size");
      break;
    }
    case "SizedClosureCapture": {
      const closure_def_id = cause_code._0;
      err.note("all values captured by value by a closure must have a statically known size");
      const kind = hir.Node.expect_expr(tcx.hir_node_by_def_id(closure_def_id)).kind;
      if (kind.$ !== "Closure") {
        return bug("expected closure in SizedClosureCapture obligation");
      }
      const closure = kind._0;
      if (closure.capture_clause.$ === "Value" && closure.fn_arg_span !== undefined) {
        const span = closure.fn_arg_span;
        err.span_label(span, "this closure captures all values by move");
      }
      break;
    }
    case "SizedCoroutineInterior": {
      const coroutine_def_id = cause_code._0;
      // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
      const ck = tcx.coroutine_kind(LocalDefId.to_def_id(coroutine_def_id)) as hir.CoroutineKind | undefined;
      let what: string;
      if (ck === undefined || ck.$ === "Coroutine" || (ck.$ === "Desugared" && ck._0 === "Gen")) {
        what = "yield";
      } else if (ck._0 === "Async") {
        what = "await";
      } else {
        // Some(hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::AsyncGen, _))
        what = "yield`/`await";
      }
      err.note(`all values live across \`${what}\` must have a statically known size`);
      break;
    }
    case "SharedStatic": {
      err.note("shared static variables must have a type that implements `Sync`");
      break;
    }
    case "MatchImpl": {
      const cause = cause_code._0;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        cause.code_(),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      break;
    }
    case "BuiltinDerived": {
      const data = cause_code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause());
      const ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
      if (TypeVisitableExt.references_error(parent_trait_ref, d_PolyTraitClause())) {
        // NOTE(eddyb) this was `.cancel()`, but `err`
        // is borrowed, so we can't fully defuse it.
        err.downgrade_to_delayed_bug();
        return;
      }

      // If the obligation for a tuple is set directly by a Coroutine or Closure,
      // then the tuple must be the one containing capture types.
      let is_upvar_tys_infer_tuple: boolean;
      const parent_code = ObligationCauseCodeHandle.deref(data.parent_code);
      if (ty.kind().$ !== "Tuple") {
        is_upvar_tys_infer_tuple = false;
      } else if (parent_code.$ === "BuiltinDerived") {
        const data = parent_code._0;
        const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause());
        const nested_ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
        const nk = nested_ty.kind().$;
        is_upvar_tys_infer_tuple = nk === "Coroutine" || nk === "Closure" || nk === "CoroutineClosure";
      } else {
        is_upvar_tys_infer_tuple = false;
      }

      const is_builtin_async_fn_trait = tcx.async_fn_trait_kind_from_def_id(PolyTraitClause_.def_id(data.parent_trait_pred)) !== undefined;

      if (!is_upvar_tys_infer_tuple && !is_builtin_async_fn_trait) {
        const msg = (): string => {
          const ty_str = tcx.short_string(ty, err.long_ty_path(), print_Ty_);
          return `required because it appears within the type \`${ty_str}\``;
        };
        const k = ty.kind();
        switch (k.$) {
          case "Adt": {
            const def = k._0;
            const args = k._1;
            const msg_ = msg();
            const ident = tcx.opt_item_ident(def.did());
            if (ident !== undefined) {
              const spans = MultiSpan.new();
              const pred = predicate.as_trait_clause();
              if (def.did().is_local() && pred !== undefined) {
                const field_ty = this.deeply_resolve_ignoring_regions(TraitClause.self_ty(Binder.skip_binder(pred)), fold_Ty);
                for (const field of def.all_fields()) {
                  if (Unnormalized.skip_norm_wip(field.ty(tcx, args)) === field_ty) {
                    const sp = tcx.def_span(field.did);
                    spans.push_primary_span(sp);
                    spans.push_span_label(sp, "required by this field");
                  }
                }
              }
              if (spans.has_primary_spans()) {
                spans.push_span_context(ident.span);
              } else {
                spans.push_primary_span(ident.span);
                spans.push_span_label(ident.span, "");
              }
              err.span_note(spans, msg_);
            } else {
              err.note(msg_);
            }
            break;
          }
          case "Alias": {
            if (k._1.kind.$ === "Opaque") {
              const def_id = k._1.kind.def_id;
              // If the previous type is async fn, this is the future generated by the body of an async function.
              // Avoid printing it twice (it was already printed in the `ty::Coroutine` arm below).
              const is_future = tcx.ty_is_opaque_future(ty);
              // debug!(?obligated_types, ?is_future, "note_obligation_cause_code: check for async fn");
              const last = obligated_types[obligated_types.length - 1];
              let last_is_async_coroutine = false;
              if (last !== undefined) {
                const lk = last.kind();
                last_is_async_coroutine = lk.$ === "Coroutine" ? tcx.coroutine_is_async(lk._0) : false;
              }
              if (is_future && last_is_async_coroutine) {
                // See comment above; skip printing twice.
              } else {
                const msg_ = msg();
                err.span_note(tcx.def_span(def_id), msg_);
              }
            } else {
              const msg_ = msg();
              err.note(msg_);
            }
            break;
          }
          case "Coroutine": {
            const def_id = k._0;
            const sp = tcx.def_span(def_id);

            // Special-case this to say "async block" instead of `[static coroutine]`.
            // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
            const kind = unwrap(tcx.coroutine_kind(def_id) as hir.CoroutineKind | undefined);
            err.span_note(sp, with_forced_trimmed_paths(() => `required because it's used within this ${hir.display_CoroutineKind(kind, true)}`));
            break;
          }
          case "CoroutineWitness": {
            // Skip printing coroutine-witnesses, since we'll drill into
            // the bad field in another derived obligation cause.
            break;
          }
          case "Closure": {
            const def_id = k._0;
            const args = k._1;
            if (!this.note_closure_capture(err, def_id, { $: "Closure", _0: args }, closure_capture_ty.value)) {
              err.span_note(tcx.def_span(def_id), "required because it's used within this closure");
            }
            break;
          }
          case "CoroutineClosure": {
            const def_id = k._0;
            const args = k._1;
            if (!this.note_closure_capture(err, def_id, { $: "CoroutineClosure", _0: args }, closure_capture_ty.value)) {
              err.span_note(tcx.def_span(def_id), "required because it's used within this closure");
            }
            break;
          }
          case "Str": {
            err.note("`str` is considered to contain a `[u8]` slice for auto trait purposes");
            break;
          }
          default: {
            const msg_ = msg();
            err.note(msg_);
            break;
          }
        }
      }

      if (!is_upvar_tys_infer_tuple) {
        closure_capture_ty.value = ty;
      }

      obligated_types.push(ty);

      const parent_predicate = parent_trait_ref;
      if (!this.is_recursive_obligation(obligated_types, parent_code)) {
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          parent_code,
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
      } else {
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          ObligationCauseCode.peel_derives(cause_code),
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
      }
      break;
    }
    case "ImplDerived": {
      const data_ = cause_code._0;
      let parent_trait_pred = this.deeply_resolve_ignoring_regions(data_.derived.parent_trait_pred, d_PolyTraitClause());
      const parent_def_id = PolyTraitClause_.def_id(parent_trait_pred);
      if (tcx.is_diagnostic_item(sym.FromResidual, parent_def_id) && !tcx.features().enabled(sym.try_trait_v2)) {
        // If `#![feature(try_trait_v2)]` is not enabled, then there's no point on
        // talking about `FromResidual<Result<A, B>>`, as the end user has nothing they
        // can do about it. As far as they are concerned, `?` is compiler magic.
        return;
      }
      if (tcx.is_diagnostic_item(sym.PinDerefMutHelper, parent_def_id)) {
        const parent_predicate = this.deeply_resolve_ignoring_regions(data_.derived.parent_trait_pred, d_PolyTraitClause());

        // Skip PinDerefMutHelper in suggestions, but still show downstream suggestions.

        closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred));
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          ObligationCauseCodeHandle.deref(data_.derived.parent_code),
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
        return;
      }
      const self_ty_str = tcx.short_string(TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)), err.long_ty_path(), print_Ty_);
      const trait_name = tcx.short_string(
        PolyTraitClause_print_modifiers_and_trait_path(parent_trait_pred),
        err.long_ty_path(),
        print_PolyTraitClausePrintModifiersAndPath,
      );
      const msg = `required for \`${self_ty_str}\` to implement \`${trait_name}\``;
      let is_auto_trait = false;
      const node = tcx.hir_get_if_local(data_.impl_or_alias_def_id);
      if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Trait") {
        const is_auto = node._0.kind.is_auto;
        const ident = node._0.kind.ident;
        // FIXME: we should do something else so that it works even on crate foreign
        // auto traits.
        is_auto_trait = is_auto === "Yes";
        err.span_note(ident.span, msg);
      } else if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Impl") {
        const { of_trait, self_ty, generics } = node._0.kind._0;
        const spans_: Span[] = [];
        if (of_trait !== undefined && !Span.in_derive_expansion(of_trait.trait_ref.path.span)) {
          spans_.push(of_trait.trait_ref.path.span);
        }
        spans_.push(self_ty.span);
        const spans: MultiSpan = MultiSpan.from_Vec(spans_);
        let derived = false;
        const self_ty_expn_kind = SyntaxContext.outer_expn_data(Span.ctxt(self_ty.span)).kind;
        const of_trait_expn_kind = of_trait === undefined ? undefined : SyntaxContext.outer_expn_data(Span.ctxt(of_trait.trait_ref.path.span)).kind;
        if (
          (self_ty_expn_kind.$ === "Macro" && self_ty_expn_kind._0 === "Derive") ||
          (of_trait_expn_kind !== undefined && of_trait_expn_kind.$ === "Macro" && of_trait_expn_kind._0 === "Derive")
        ) {
          derived = true;
          spans.push_span_label(
            data_.span,
            Span.in_derive_expansion(data_.span) ? `type parameter would need to implement \`${trait_name}\`` : "unsatisfied trait bound",
          );
        } else if (!Span.is_dummy(data_.span) && !Span.overlaps(data_.span, self_ty.span)) {
          // `Sized` may be an explicit or implicit trait bound. If it is
          // implicit, mention it as such.
          const pred = predicate.as_trait_clause();
          if (
            pred !== undefined &&
            this.tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized) &&
            // PORT: the `generics_of` query's value is typed `unknown` in queries.gen.ts; it is `&Generics`.
            (this.tcx.generics_of(data_.impl_or_alias_def_id) as Generics).own_params.some((param) => this.tcx.def_span(param.def_id) === data_.span)
          ) {
            spans.push_span_label(data_.span, "unsatisfied trait bound implicitly introduced here");
          } else {
            spans.push_span_label(data_.span, "unsatisfied trait bound introduced here");
          }
        }
        err.span_note(spans, msg);
        if (derived && this.is_truly_imperfect_derive(parent_trait_pred, predicate, param_env)) {
          err.help(`consider manually implementing \`${trait_name}\` to avoid undesired bounds caused by "imperfect derives"`);
          err.note("to learn more, visit <https://github.com/rust-lang/rust/issues/26925>");
        }
        point_at_assoc_type_restriction(tcx, err, self_ty_str, trait_name, predicate, generics, data_);
      } else {
        err.note(msg);
      }

      // PORT: `parent_predicate` is inferred as `ty::PolyTraitClause` (its initializer), so the `.upcast(tcx)`s below
      // are the reflexive upcast.
      let parent_predicate: PolyTraitClause = parent_trait_pred;
      let data: DerivedCause = data_.derived;
      let count = 0;
      set_insert(seen_requirements, parent_def_id);
      if (is_auto_trait) {
        // We don't want to point at the ADT saying "required because it appears within
        // the type `X`", like we would otherwise do in test `supertrait-auto-trait.rs`.
        let pc: ObligationCauseCode;
        while ((pc = ObligationCauseCodeHandle.deref(data.parent_code)).$ === "BuiltinDerived") {
          const derived = pc._0;
          const child_trait_ref = this.deeply_resolve_ignoring_regions(derived.parent_trait_pred, d_PolyTraitClause());
          const child_def_id = PolyTraitClause_.def_id(child_trait_ref);
          if (set_insert(seen_requirements, child_def_id)) {
            break;
          }
          data = derived;
          parent_predicate = child_trait_ref;
          parent_trait_pred = child_trait_ref;
        }
      }
      let pc: ObligationCauseCode;
      while ((pc = ObligationCauseCodeHandle.deref(data.parent_code)).$ === "ImplDerived") {
        const child = pc._0;
        // Skip redundant recursive obligation notes. See `ui/issue-20413.rs`.
        const child_trait_pred = this.deeply_resolve_ignoring_regions(child.derived.parent_trait_pred, d_PolyTraitClause());
        const child_def_id = PolyTraitClause_.def_id(child_trait_pred);
        if (set_insert(seen_requirements, child_def_id)) {
          break;
        }
        count += 1;
        data = child.derived;
        parent_predicate = child_trait_pred;
        parent_trait_pred = child_trait_pred;
      }
      if (count > 0) {
        err.note(`${count} redundant requirement${pluralize(count)} hidden`);
        const self_ty = tcx.short_string(TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)), err.long_ty_path(), print_Ty_);
        const trait_path = tcx.short_string(
          PolyTraitClause_print_modifiers_and_trait_path(parent_trait_pred),
          err.long_ty_path(),
          print_PolyTraitClausePrintModifiersAndPath,
        );
        err.note(`required for \`${self_ty}\` to implement \`${trait_path}\``);
      }
      closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred));
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        parent_predicate,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyTraitClause,
      );
      break;
    }
    case "ImplDerivedHost": {
      const data = cause_code._0;
      const self_ty = tcx.short_string(
        this.deeply_resolve_ignoring_regions(PolyHostEffectClause.self_ty(data.derived.parent_host_clause), d_Binder_Ty()),
        err.long_ty_path(),
        print_Binder_Ty,
      );
      const trait_path = tcx.short_string(
        PolyTraitRef_print_only_trait_path(Binder.map_bound(data.derived.parent_host_clause, (clause) => clause.trait_ref)),
        err.long_ty_path(),
        print_PolyTraitRefPrintOnlyTraitPath,
      );
      const msg = `required for \`${self_ty}\` to implement \`${display_BoundConstness(Binder.skip_binder(data.derived.parent_host_clause).constness)} ${trait_path}\``;
      const node = tcx.hir_get_if_local(data.impl_def_id);
      if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Impl") {
        const { of_trait, self_ty } = node._0.kind._0;
        const spans_: Span[] = [self_ty.span];
        if (of_trait !== undefined) spans_.push(of_trait.trait_ref.path.span);
        const spans: MultiSpan = MultiSpan.from_Vec(spans_);
        spans.push_span_label(data.span, "unsatisfied trait bound introduced here");
        err.span_note(spans, msg);
      } else {
        err.note(msg);
      }

      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        data.derived.parent_host_clause,
        param_env,
        ObligationCauseCodeHandle.deref(data.derived.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyHostEffectClause,
      );
      break;
    }
    case "BuiltinDerivedHost": {
      const data = cause_code._0;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        data.parent_host_clause,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyHostEffectClause,
      );
      break;
    }
    case "WellFormedDerived": {
      const data = cause_code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause());
      const parent_predicate = parent_trait_ref;

      closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        parent_predicate,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyTraitClause,
      );
      break;
    }
    case "TypeAlias": {
      const nested = ObligationCauseCodeHandle.deref(cause_code._0);
      const span = cause_code._1;
      const def_id = cause_code._2;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        nested,
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      const multispan = MultiSpan.from_Span(span);
      multispan.push_span_label(span, "required by this bound");
      err.span_note(multispan, `required by a bound on the type alias \`${display_Symbol(tcx.item_name(def_id))}\``);
      break;
    }
    case "FunctionArg": {
      const arg_hir_id = cause_code.arg_hir_id;
      const call_hir_id = cause_code.call_hir_id;
      const parent_code = ObligationCauseCodeHandle.deref(cause_code.parent_code);
      this.note_function_argument_obligation(body_def_id, err, arg_hir_id, parent_code, param_env, predicate, call_hir_id);

      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        parent_code,
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      break;
    }
    case "CompareImplItem": {
      const trait_item_def_id = cause_code.trait_item_def_id;
      // Suppress `compare_type_clause_entailment` errors for RPITITs, since they
      // should be implied by the parent method.
      if (tcx.is_impl_trait_in_trait(trait_item_def_id)) {
        break;
      }
      const kind = cause_code.kind;
      const item_name = tcx.item_name(trait_item_def_id);
      const msg = `the requirement \`${display_Predicate(predicate)}\` appears on the \`impl\`'s ${display_AssocKind(kind)} \`${display_Symbol(item_name)}\` but not on the corresponding trait's ${display_AssocKind(kind)}`;
      const sp = tcx.opt_item_ident(trait_item_def_id)?.span ?? tcx.def_span(trait_item_def_id);
      const assoc_span: MultiSpan = MultiSpan.from_Span(sp);
      assoc_span.push_span_label(sp, `this trait's ${display_AssocKind(kind)} doesn't have the requirement \`${display_Predicate(predicate)}\``);
      const item = tcx.opt_associated_item(trait_item_def_id);
      const ident = item === undefined ? undefined : tcx.opt_item_ident(AssocItem.container_id(item, tcx));
      if (ident !== undefined) {
        assoc_span.push_span_label(ident.span, "in this trait");
      }
      err.span_note(assoc_span, msg);
      break;
    }
    case "TrivialBound": {
      tcx.disabled_nightly_features(err, [["", sym.trivial_bounds]]);
      break;
    }
    case "OpaqueReturnType": {
      const expr_info = cause_code._0;
      // Point at the method call in the returned expression's chain where an
      // associated type diverged from what the signature's opaque type expects,
      // regardless of how the failed predicate was derived from that expectation.
      if (this.typeck_results !== undefined) {
        const typeck_results = this.typeck_results;
        let chain_expr: hir.Expr | undefined;
        if (expr_info !== undefined) {
          const [, hir_id] = expr_info;
          chain_expr = tcx.hir_expect_expr(hir_id);
        } else {
          const body_id = hir.Node.body_id(tcx.hir_node_by_def_id(body_def_id));
          if (body_id === undefined) {
            chain_expr = undefined;
          } else {
            const k = tcx.hir_body(body_id).value.kind;
            chain_expr = k.$ === "Block" ? k._0.expr : undefined;
          }
        }
        if (chain_expr !== undefined) {
          this.point_at_chain_in_return_position(body_def_id, chain_expr, typeck_results, param_env, err);
        }
      }
      let expr_ty: Ty;
      let expr: hir.Expr;
      if (expr_info !== undefined) {
        const [expr_ty_, hir_id] = expr_info;
        const expr_ = tcx.hir_expect_expr(hir_id);
        expr_ty = expr_ty_;
        expr = expr_;
      } else {
        const found = ((): [Ty, hir.Expr] | undefined => {
          const body_id = hir.Node.body_id(tcx.hir_node_by_def_id(body_def_id));
          if (body_id === undefined) return undefined;
          const body = tcx.hir_body(body_id);
          if (body.value.kind.$ !== "Block") return undefined;
          const block = body.value.kind._0;
          if (block.expr === undefined) return undefined;
          const expr = block.expr;
          const expr_ty = this.typeck_results === undefined ? undefined : this.typeck_results.node_type_opt(expr.hir_id);
          if (expr_ty === undefined) return undefined;
          const pred_ = predicate.as_clause();
          if (pred_ === undefined) return undefined;
          const pred = pred_.as_trait_clause();
          if (pred === undefined) return undefined;
          if (!this.infcx.enter_forall(pred, (pred) => this.can_eq(param_env, TraitClause.self_ty(pred), expr_ty, ToTrace_Ty), d_TraitClause)) {
            return undefined;
          }
          return [expr_ty, expr];
        })();
        if (found === undefined) {
          return;
        }
        [expr_ty, expr] = found;
      }
      const expr_ty_string = tcx.short_string(expr_ty, err.long_ty_path(), print_Ty_);
      if (expr_ty.is_never()) {
        const span = Span.source_callsite(expr.span);
        const snippet = tcx.sess.source_map().span_to_snippet(span);
        if (snippet.$ === "Ok" && span !== expr.span) {
          err.span_suggestion(
            span,
            "`!` can be coerced to any type; consider casting it to a concrete type that implements the trait",
            `${snippet._0.toString()} as /* Type */`,
            "HasPlaceholders",
          );
        }
      }
      err.span_label(expr.span, with_forced_trimmed_paths(() => `return type was inferred to be \`${expr_ty_string}\` here`));
      suggest_remove_deref(err, expr);
      break;
    }
    case "UnsizedNonPlaceExpr": {
      const span = cause_code._0;
      err.span_note(span, "unsized values must be place expressions and cannot be put in temporaries");
      break;
    }
    case "CompareEii": {
      return panic("trait bounds on EII not yet supported ");
    }
  }
};

// ---- helpers (lane errrep-sugg-b) ----------------------------------------------------------------------------------

/** The reflexive `impl<I, T> UpcastFrom<I, T> for T` (rustc_type_ir upcast.rs) at `Predicate`. */
const upcast_from_Predicate: (from: Predicate, tcx: Interner) => Predicate = upcast_from_self;

/** `impl<'tcx> rustc_type_ir::visit::TypeVisitable/TypeFoldable for TraitClause` (generated fns) as a descriptor. */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** `ty::PolyTraitClause`'s `TypeFoldable` (`Binder<TraitClause>`). */
function d_PolyTraitClause(): TypeSuperFoldable<PolyTraitClause> & TypeSuperVisitable<PolyTraitClause> {
  return fold_Binder(d_TraitClause);
}

/** `ty::Binder<Ty>`'s `TypeFoldable`. */
function d_Binder_Ty(): TypeSuperFoldable<Binder<Ty>> & TypeSuperVisitable<Binder<Ty>> {
  return fold_Binder(fold_Ty);
}

/**
 * pretty.rs:3057 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitClausePrintModifiersAndPath(ty::TraitClause)`.
 * PORT: codegen pending (no generated folds for the print wrappers; precedent hir_ty_lowering/errors.ts): the derive of a
 * one-field tuple struct visits / folds its field.
 */
const d_TraitClausePrintModifiersAndPath: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Err" ? r : Ok({ _0: r._0 });
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};

/**
 * pretty.rs:2981 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitRefPrintOnlyTraitPath(ty::TraitRef)`.
 * PORT: codegen pending, as `d_TraitClausePrintModifiersAndPath`.
 */
const d_TraitRefPrintOnlyTraitPath: TypeFoldable<TraitRefPrintOnlyTraitPath> = {
  visit_with: (v, visitor) => visit_with_TraitRef(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitRef(v._0, folder);
    return r.$ === "Err" ? r : Ok({ _0: r._0 });
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitRef(v._0, folder) }),
};

/** `Print for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (pretty.rs:2960). */
function print_PolyTraitClausePrintModifiersAndPath(self: Binder<TraitClausePrintModifiersAndPath>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath);
}

/** `Display for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (rustc_type_ir ir_print.rs through `IrPrint` for `TyCtxt`). */
function display_PolyTraitClausePrintModifiersAndPath(self: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(self, PLAIN, print_PolyTraitClausePrintModifiersAndPath);
}

/** `Print for ty::Binder<'tcx, TraitRefPrintOnlyTraitPath>` (pretty.rs:2960). */
function print_PolyTraitRefPrintOnlyTraitPath(self: Binder<TraitRefPrintOnlyTraitPath>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_TraitRefPrintOnlyTraitPath, d_TraitRefPrintOnlyTraitPath);
}

/** `Print for ty::Binder<'tcx, Ty>` (pretty.rs:2960). */
function print_Binder_Ty(self: Binder<Ty>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_Ty, fold_Ty);
}

/** `Print for Ty` as the printer-generic fn `TyCtxt::short_string` takes. */
function print_Ty_(self: Ty, p: PrettyPrinter): PrintResult {
  return print_Ty(self, p);
}

/** `impl UpcastFrom<TyCtxt, PolyTraitClause> for Predicate` (rustc_middle ty/predicate.rs). */
function upcast_from_PolyTraitClause(from: PolyTraitClause, tcx: Interner): Predicate {
  return Predicate_upcast_from_PolyTraitClause(from, tcx as unknown as TyCtxt);
}

/** `impl UpcastFrom<TyCtxt, ty::Binder<HostEffectClause>> for Predicate` (rustc_middle ty/predicate.rs). */
function upcast_from_PolyHostEffectClause(from: Binder<HostEffectClause>, tcx: Interner): Predicate {
  return Predicate_upcast_from_PolyHostEffectClause(from, tcx as unknown as TyCtxt);
}

/** `#[derive(PartialEq)]` of `ty::Binder<T>` for interned `T` (`value` and `bound_vars` are interned). */
function Binder_eq<T>(a: Binder<T>, b: Binder<T>): boolean {
  return Binder.skip_binder(a) === Binder.skip_binder(b) && Binder.bound_vars(a) === Binder.bound_vars(b);
}

/**
 * The or-pattern `Node::Item(hir::Item { kind: hir::ItemKind::Fn { sig: fn_sig, .. }, .. })
 * | Node::ImplItem(hir::ImplItem { kind: hir::ImplItemKind::Fn(fn_sig, _), .. })
 * | Node::TraitItem(hir::TraitItem { kind: hir::TraitItemKind::Fn(fn_sig, _), .. })` binding `fn_sig`.
 */
function fn_sig_of_node(node: hir.Node): hir.FnSig | undefined {
  if (node.$ === "Item" && node._0.kind.$ === "Fn") return node._0.kind.sig;
  if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") return node._0.kind._0;
  if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") return node._0.kind._0;
  return undefined;
}

/**
 * `mir::CoroutineLayout` (rustc_middle mir/query.rs): the fields `maybe_note_obligation_cause_for_async_await` reads.
 * PORT: the `mir_coroutine_witnesses` query's value is `unknown` until MIR lands (M4; precedent rustc_traits
 * coroutine_witnesses.ts `CoroutineLayoutFieldTys`).
 */
interface CoroutineLayoutView {
  /// The type of every local stored inside the coroutine.
  field_tys: readonly { ty: Ty; source_info: { span: Span }; ignore_for_traits: boolean }[];
  /// Which of the above fields are in each variant. Note that one field may
  /// be stored in multiple variants.
  variant_fields: readonly (readonly number[])[];
  /// The source that led to each variant being created (usually, a yield or
  /// await).
  variant_source_info: readonly { span: Span }[];
}

/**
 * `CoroutineData::get_from_await_ty` (suggestions.rs:95, lane errrep-sugg-a; its TS form is that lane's choice):
 * read from `CoroutineData.prototype` when installed, `unported` otherwise.
 */
function CoroutineData_get_from_await_ty(self: CoroutineData, visitor: AwaitsVisitor, tcx: TyCtxt, ty_matches: (_0: Binder<Ty>) => boolean): Span | undefined {
  const m = (self as unknown as { get_from_await_ty?: (visitor: AwaitsVisitor, tcx: TyCtxt, ty_matches: (_0: Binder<Ty>) => boolean) => Span | undefined })
    .get_from_await_ty;
  if (typeof m !== "function") return unported("rustc_trait_selection::error_reporting::traits::suggestions::CoroutineData::get_from_await_ty");
  return m.call(self, visitor, tcx, ty_matches);
}

/**
 * `CoroutineData::try_get_upvar_span` (suggestions.rs:73, lane errrep-sugg-a; its TS form is that lane's choice):
 * read from `CoroutineData.prototype` when installed, `unported` otherwise.
 */
function CoroutineData_try_get_upvar_span(
  self: CoroutineData,
  infer_context: InferCtxt,
  coroutine_did: DefId,
  ty_matches: (_0: Binder<Ty>) => boolean,
): CoroutineInteriorOrUpvar | undefined {
  const m = (
    self as unknown as {
      try_get_upvar_span?: (infer_context: InferCtxt, coroutine_did: DefId, ty_matches: (_0: Binder<Ty>) => boolean) => CoroutineInteriorOrUpvar | undefined;
    }
  ).try_get_upvar_span;
  if (typeof m !== "function") return unported("rustc_trait_selection::error_reporting::traits::suggestions::CoroutineData::try_get_upvar_span");
  return m.call(self, infer_context, coroutine_did, ty_matches);
}

/** `FxHashSet::insert`: `true` if the value was not present. */
function set_insert(set: DefIdSet, v: DefId): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** `str::chars()` as Unicode scalar values. */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const c of s) out.push(c.codePointAt(0)!);
  return out;
}

/** `str::trim_start_matches(pred)` */
function trim_start_matches(s: string, pred: (c: number) => boolean): string {
  let i = 0;
  for (const c of s) {
    if (!pred(c.codePointAt(0)!)) break;
    i += c.length;
  }
  return s.slice(i);
}

/** `slice == slice` / `iter().eq(iter())` for `===`-comparable elements. */
function slice_eq<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `Option::is_some_and` */
function is_some_and<T>(v: T | undefined, f: (v: T) => boolean): boolean {
  return v !== undefined && f(v);
}

const C_AMP = 0x26; // '&'
const C_QUOTE = 0x27; // '\''

/** The crate's error_reporting/traits/mod.ts (read inside function bodies: init order). */
function traits_er_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
// ==== end lane errrep-sugg-b ====

// ==== lane errrep-sugg-c: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_await_before_try", "suggest_floating_point_literal", "can_suggest_derive", "suggest_derive", "suggest_dereferencing_index", "note_function_argument_obligation", "suggest_option_method_if_applicable", "look_for_iterator_item_mistakes", "point_at_chain", "probe_assoc_types_at_expr", "point_at_chain_in_return_position", "suggest_convert_to_slice", "suggest_tuple_wrapping", "suggest_shadowed_inherent_method", "explain_hrtb_projection", "suggest_desugaring_async_fn_in_trait", "ty_kind_suggestion", "suggest_add_result_as_return_type", "suggest_unsized_bound_if_applicable", "suggest_indirection_for_unsized", "suggest_swapping_lhs_and_rhs", "is_truly_imperfect_derive",
]);
