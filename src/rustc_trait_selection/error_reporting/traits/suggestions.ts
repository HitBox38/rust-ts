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

// ==== lane errrep-sugg-b: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_change_mut", "suggest_semicolon_removal", "removable_trailing_semicolon", "emit_semicolon_removal_suggestion", "suggest_semicolon_removal_in_closure_arg", "suggest_borrow_for_unsized_closure_return", "return_type_span", "suggest_impl_trait", "report_closure_arg_mismatch", "note_conflicting_fn_args", "note_conflicting_closure_bounds", "suggest_fully_qualified_path", "maybe_note_obligation_cause_for_async_await", "note_obligation_cause_for_async_await", "note_closure_capture", "note_obligation_cause_code", "note_obligation_cause_code_inner",
]);

// ==== lane errrep-sugg-c: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_await_before_try", "suggest_floating_point_literal", "can_suggest_derive", "suggest_derive", "suggest_dereferencing_index", "note_function_argument_obligation", "suggest_option_method_if_applicable", "look_for_iterator_item_mistakes", "point_at_chain", "probe_assoc_types_at_expr", "point_at_chain_in_return_position", "suggest_convert_to_slice", "suggest_tuple_wrapping", "suggest_shadowed_inherent_method", "explain_hrtb_projection", "suggest_desugaring_async_fn_in_trait", "ty_kind_suggestion", "suggest_add_result_as_return_type", "suggest_unsized_bound_if_applicable", "suggest_indirection_for_unsized", "suggest_swapping_lhs_and_rhs", "is_truly_imperfect_derive",
]);
