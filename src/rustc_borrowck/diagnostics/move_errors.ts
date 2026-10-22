// Port of compiler/rustc_borrowck/src/diagnostics/move_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-d, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `append_to_grouped_errors`'s destructuring parameter `MoveError { place: original_path, location, kind }` is the
// parameter `move_error` (the fill lane destructures it in the body).
// PORT: the fn-local `BindingFinder` of `add_move_error_suggestions` (move_errors.rs:1070) is a module-level hand class
// until the fill lane moves it inside.
import type { FieldIdx } from "../../rustc_abi/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import type { HirIdSet } from "../../rustc_hir_id/lib.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import type { Local, Location, Place } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Asyncness, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { ClosureKind as ty_ClosureKind } from "../../rustc_type_ir/lib.ts";
import { unported } from "../../std/panic.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import type { CloneSuggestion, UseSpans } from "./mod.gen.ts";
import { type GroupedMoveError, type IllegalMoveOriginKind, MoveError, type PatternBindingInfo } from "./move_errors.gen.ts";

export * from "./move_errors.gen.ts";

declare module "./move_errors.gen.ts" {
  namespace MoveError {
    // move_errors.rs:48 (lane bck-diag-d)
    function new_(place: Place, location: Location, kind: IllegalMoveOriginKind): MoveError;
    export { new_ as new };
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // move_errors.rs:105 (lane bck-diag-d)
    report_move_errors(): void;
    // move_errors.rs:112 (lane bck-diag-d)
    group_move_errors(): GroupedMoveError[];
    // move_errors.rs:121 (lane bck-diag-d)
    append_to_grouped_errors(grouped_errors: GroupedMoveError[], move_error: MoveError): void;
    // move_errors.rs:173 (lane bck-diag-d)
    append_binding_error(
      grouped_errors: GroupedMoveError[],
      kind: IllegalMoveOriginKind,
      original_path: Place,
      move_from: Place,
      bind_to: Local,
      match_place: Place | undefined,
      match_span: Span,
      statement_span: Span,
    ): void;
    // move_errors.rs:254 (lane bck-diag-d)
    report(error: GroupedMoveError): void;
    // move_errors.rs:304 (lane bck-diag-d)
    has_ambiguous_copy(ty: Ty): boolean;
    // move_errors.rs:312 (lane bck-diag-d)
    report_cannot_move_from_static(place: Place, span: Span): Diag;
    // move_errors.rs:328 (lane bck-diag-d)
    suggest_clone_of_captured_var_in_move_closure(err: Diag, upvar_name: string, use_spans: UseSpans | undefined): void;
    // move_errors.rs:435 (lane bck-diag-d)
    report_cannot_move_from_borrowed_content(move_place: Place, deref_target_place: Place, span: Span, use_spans: UseSpans | undefined): [Diag, CloneSuggestion];
    // move_errors.rs:567 (lane bck-diag-d)
    report_closure_move_error(span: Span, move_place: Place, def_id: DefId, closure_kind_ty: Ty, upvar_field: FieldIdx, asyncness: Asyncness): Diag;
    // move_errors.rs:633 (lane bck-diag-d)
    get_closure_bound_clause_span(def_id: DefId, asyncness: Asyncness): Span | undefined;
    // move_errors.rs:680 (lane bck-diag-d)
    closure_clause_kind(pred: Clause, def_id: DefId, asyncness: Asyncness): ty_ClosureKind | undefined;
    // move_errors.rs:702 (lane bck-diag-d)
    suggest_cloning_through_overloaded_deref(err: Diag, ty: Ty, span: Span): CloneSuggestion;
    // move_errors.rs:734 (lane bck-diag-d)
    add_move_hints(error: GroupedMoveError, err: Diag, span: Span, has_clone_suggestion: CloneSuggestion): void;
    // move_errors.rs:898 (lane bck-diag-d)
    add_borrow_suggestions(err: Diag, span: Span, is_destructuring_pattern_move: boolean): void;
    // move_errors.rs:972 (lane bck-diag-d)
    should_suggest_pattern_binding_instead(span: Span, binding_info: PatternBindingInfo): boolean;
    // move_errors.rs:1009 (lane bck-diag-d)
    should_suggest_borrow_instead(span: Span, binding_info: PatternBindingInfo | undefined): boolean;
    // move_errors.rs:1037 (lane bck-diag-d)
    pattern_binding_info(binds_to: readonly Local[]): PatternBindingInfo | undefined;
    // move_errors.rs:1063 (lane bck-diag-d)
    add_move_error_suggestions(err: Diag, binds_to: readonly Local[]): Span[] | undefined;
    // move_errors.rs:1218 (lane bck-diag-d)
    add_move_error_details(err: Diag, binds_to: readonly Local[], desugar_spans: readonly Span[]): void;
    // move_errors.rs:1265 (lane bck-diag-d)
    add_note_for_packed_struct_derive(err: Diag, local: Local): void;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:48 new (lane bck-diag-d)
(MoveError as unknown as { new: typeof MoveError.new }).new = function (place: Place, location: Location, kind: IllegalMoveOriginKind): MoveError {
  return unported("rustc_borrowck::diagnostics::move_errors::MoveError::new");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:105 report_move_errors (lane bck-diag-d)
MirBorrowckCtxt.prototype.report_move_errors = function (this: MirBorrowckCtxt): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::report_move_errors");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:112 group_move_errors (lane bck-diag-d)
MirBorrowckCtxt.prototype.group_move_errors = function (this: MirBorrowckCtxt): GroupedMoveError[] {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::group_move_errors");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:121 append_to_grouped_errors (lane bck-diag-d)
MirBorrowckCtxt.prototype.append_to_grouped_errors = function (this: MirBorrowckCtxt, grouped_errors: GroupedMoveError[], move_error: MoveError): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::append_to_grouped_errors");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:173 append_binding_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.append_binding_error = function (
  this: MirBorrowckCtxt,
  grouped_errors: GroupedMoveError[],
  kind: IllegalMoveOriginKind,
  original_path: Place,
  move_from: Place,
  bind_to: Local,
  match_place: Place | undefined,
  match_span: Span,
  statement_span: Span,
): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::append_binding_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:254 report (lane bck-diag-d)
MirBorrowckCtxt.prototype.report = function (this: MirBorrowckCtxt, error: GroupedMoveError): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::report");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:304 has_ambiguous_copy (lane bck-diag-d)
MirBorrowckCtxt.prototype.has_ambiguous_copy = function (this: MirBorrowckCtxt, ty: Ty): boolean {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::has_ambiguous_copy");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:312 report_cannot_move_from_static (lane bck-diag-d)
MirBorrowckCtxt.prototype.report_cannot_move_from_static = function (this: MirBorrowckCtxt, place: Place, span: Span): Diag {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::report_cannot_move_from_static");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:328 suggest_clone_of_captured_var_in_move_closure (lane bck-diag-d)
MirBorrowckCtxt.prototype.suggest_clone_of_captured_var_in_move_closure = function (
  this: MirBorrowckCtxt,
  err: Diag,
  upvar_name: string,
  use_spans: UseSpans | undefined,
): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::suggest_clone_of_captured_var_in_move_closure");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:435 report_cannot_move_from_borrowed_content (lane bck-diag-d)
MirBorrowckCtxt.prototype.report_cannot_move_from_borrowed_content = function (
  this: MirBorrowckCtxt,
  move_place: Place,
  deref_target_place: Place,
  span: Span,
  use_spans: UseSpans | undefined,
): [Diag, CloneSuggestion] {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::report_cannot_move_from_borrowed_content");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:567 report_closure_move_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.report_closure_move_error = function (
  this: MirBorrowckCtxt,
  span: Span,
  move_place: Place,
  def_id: DefId,
  closure_kind_ty: Ty,
  upvar_field: FieldIdx,
  asyncness: Asyncness,
): Diag {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::report_closure_move_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:633 get_closure_bound_clause_span (lane bck-diag-d)
MirBorrowckCtxt.prototype.get_closure_bound_clause_span = function (this: MirBorrowckCtxt, def_id: DefId, asyncness: Asyncness): Span | undefined {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::get_closure_bound_clause_span");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:680 closure_clause_kind (lane bck-diag-d)
MirBorrowckCtxt.prototype.closure_clause_kind = function (this: MirBorrowckCtxt, pred: Clause, def_id: DefId, asyncness: Asyncness): ty_ClosureKind | undefined {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::closure_clause_kind");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:702 suggest_cloning_through_overloaded_deref (lane bck-diag-d)
MirBorrowckCtxt.prototype.suggest_cloning_through_overloaded_deref = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, span: Span): CloneSuggestion {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::suggest_cloning_through_overloaded_deref");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:734 add_move_hints (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_move_hints = function (
  this: MirBorrowckCtxt,
  error: GroupedMoveError,
  err: Diag,
  span: Span,
  has_clone_suggestion: CloneSuggestion,
): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::add_move_hints");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:898 add_borrow_suggestions (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_borrow_suggestions = function (this: MirBorrowckCtxt, err: Diag, span: Span, is_destructuring_pattern_move: boolean): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::add_borrow_suggestions");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:972 should_suggest_pattern_binding_instead (lane bck-diag-d)
MirBorrowckCtxt.prototype.should_suggest_pattern_binding_instead = function (this: MirBorrowckCtxt, span: Span, binding_info: PatternBindingInfo): boolean {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::should_suggest_pattern_binding_instead");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1009 should_suggest_borrow_instead (lane bck-diag-d)
MirBorrowckCtxt.prototype.should_suggest_borrow_instead = function (this: MirBorrowckCtxt, span: Span, binding_info: PatternBindingInfo | undefined): boolean {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::should_suggest_borrow_instead");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1037 pattern_binding_info (lane bck-diag-d)
MirBorrowckCtxt.prototype.pattern_binding_info = function (this: MirBorrowckCtxt, binds_to: readonly Local[]): PatternBindingInfo | undefined {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::pattern_binding_info");
};

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1063 add_move_error_suggestions (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_move_error_suggestions = function (this: MirBorrowckCtxt, err: Diag, binds_to: readonly Local[]): Span[] | undefined {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::add_move_error_suggestions");
};

/// A HIR visitor to associate each binding with a `&` or `&mut` that could be removed to
/// make it bind by reference instead (if possible)
// rustc-type: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1070 BindingFinder
export class BindingFinder extends hir.intravisit.Visitor {
  // impl<'tcx> Visitor<'tcx> for BindingFinder<'tcx>
  // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public typeck_results: TypeckResults,
    public tcx: TyCtxt,
    /// Input: the span of the pattern we're finding bindings in
    public pat_span: Span,
    /// Input: the spans of the bindings we're providing suggestions for
    public binding_spans: Span[],
    /// Internal state: have we reached the pattern we're finding bindings in?
    public found_pat: boolean,
    /// Internal state: the innermost `&` or `&mut` "above" the visitor
    public ref_pat: hir.Pat | undefined,
    /// Internal state: could removing a `&` give bindings unexpected types?
    public has_adjustments: boolean,
    /// Output: for each input binding, the `&` or `&mut` to remove to make it by-ref
    public ref_pat_for_binding: [Span, hir.Pat | undefined][],
    /// Output: ref patterns that can't be removed straightforwardly
    public cannot_remove: HirIdSet,
    /// Output: binding spans from destructuring assignment desugaring
    public desugar_binding_spans: Span[],
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1093 maybe_tcx (lane bck-diag-d)
  override maybe_tcx(): HirTyCtxt {
    return unported("rustc_borrowck::diagnostics::move_errors::BindingFinder::maybe_tcx");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1097 visit_expr (lane bck-diag-d)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::move_errors::BindingFinder::visit_expr");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1104 visit_pat (lane bck-diag-d)
  override visit_pat(p: hir.Pat): undefined {
    return unported("rustc_borrowck::diagnostics::move_errors::BindingFinder::visit_pat");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1218 add_move_error_details (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_move_error_details = function (this: MirBorrowckCtxt, err: Diag, binds_to: readonly Local[], desugar_spans: readonly Span[]): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::add_move_error_details");
};

/// Adds an explanatory note if the move error occurs in a derive macro
/// expansion of a packed struct.
/// Such errors happen because derive macro expansions shy away from taking
/// references to the struct's fields since doing so would be undefined behaviour
// stub: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1265 add_note_for_packed_struct_derive (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_note_for_packed_struct_derive = function (this: MirBorrowckCtxt, err: Diag, local: Local): void {
  return unported("rustc_borrowck::diagnostics::move_errors::MirBorrowckCtxt::add_note_for_packed_struct_derive");
};
