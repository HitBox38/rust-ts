// Port of compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Print diagnostics to explain why values are borrowed.
// PORT: the fn-local `struct FindLetExpr` + `impl Visitor for FindLetExpr` of `add_explanation_to_diagnostic` are module
// level until the fill lane moves them (lib.ts header); `result: Option<(Span, &Pat, &Expr)>` is `[Span, Pat, Expr] | undefined`.
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import type { ConstraintCategory, Location, Place } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import { MirBorrowckCtxt, type WriteKind } from "../lib.gen.ts";
import * as gen from "./explain_borrow.gen.ts";
import type { LaterUseKind } from "./explain_borrow.gen.ts";
import type { UseSpans } from "./mod.gen.ts";
import type { RegionName } from "./region_name.gen.ts";

export * from "./explain_borrow.gen.ts";

// impl<'tcx> BorrowExplanation<'tcx>
export interface BorrowExplanation_methods {
  // explain_borrow.rs:55 (lane bck-diag-f)
  is_explained(self: BorrowExplanation): boolean;
  // explain_borrow.rs:58 (lane bck-diag-f)
  add_explanation_to_diagnostic(
    self: BorrowExplanation,
    cx: MirBorrowckCtxt,
    err: Diag,
    borrow_desc: string,
    borrow_span: Span | undefined,
    multiple_borrow_span: [Span, Span] | undefined,
  ): void;
  // explain_borrow.rs:440 (lane bck-diag-f)
  add_object_lifetime_default_note(self: BorrowExplanation, tcx: TyCtxt, err: Diag, unsize_ty: Ty): void;
  // explain_borrow.rs:497 (lane bck-diag-f)
  add_lifetime_bound_suggestion_to_diagnostic(self: BorrowExplanation, err: Diag, category: ConstraintCategory, span: Span, region_name: RegionName): void;
}
export type BorrowExplanation = gen.BorrowExplanation;
export const BorrowExplanation = gen.BorrowExplanation as typeof gen.BorrowExplanation & BorrowExplanation_methods;

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // explain_borrow.rs:588 (lane bck-diag-f)
    explain_why_borrow_contains_point(location: Location, borrow: BorrowData, kind_place: [WriteKind, Place] | undefined): BorrowExplanation;
    // explain_borrow.rs:719 (lane bck-diag-f)
    later_use_kind(borrow: BorrowData, use_spans: UseSpans, location: Location): [LaterUseKind, Span, Span | undefined];
    // explain_borrow.rs:821 (lane bck-diag-f)
    was_captured_by_trait_object(borrow: BorrowData): boolean;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:55 is_explained (lane bck-diag-f)
BorrowExplanation.is_explained = function (self: BorrowExplanation): boolean {
  return unported("rustc_borrowck::diagnostics::explain_borrow::BorrowExplanation::is_explained");
};

// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:58 add_explanation_to_diagnostic (lane bck-diag-f)
BorrowExplanation.add_explanation_to_diagnostic = function (
  self: BorrowExplanation,
  cx: MirBorrowckCtxt,
  err: Diag,
  borrow_desc: string,
  borrow_span: Span | undefined,
  multiple_borrow_span: [Span, Span] | undefined,
): void {
  return unported("rustc_borrowck::diagnostics::explain_borrow::BorrowExplanation::add_explanation_to_diagnostic");
};

// struct FindLetExpr<'hir> (fn-local in `add_explanation_to_diagnostic`, explain_borrow.rs:246)
export class FindLetExpr extends hir.intravisit.Visitor {
  // impl<'hir> rustc_hir::intravisit::Visitor<'hir> for FindLetExpr<'hir>
  // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public span: Span,
    public result: [Span, hir.Pat, hir.Expr] | undefined,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:254 maybe_tcx (lane bck-diag-f)
  override maybe_tcx(): HirTyCtxt {
    return unported("rustc_borrowck::diagnostics::explain_borrow::add_explanation_to_diagnostic::FindLetExpr::maybe_tcx");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:257 visit_expr (lane bck-diag-f)
  override visit_expr(expr: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::explain_borrow::add_explanation_to_diagnostic::FindLetExpr::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:440 add_object_lifetime_default_note (lane bck-diag-f)
BorrowExplanation.add_object_lifetime_default_note = function (self: BorrowExplanation, tcx: TyCtxt, err: Diag, unsize_ty: Ty): void {
  return unported("rustc_borrowck::diagnostics::explain_borrow::BorrowExplanation::add_object_lifetime_default_note");
};

// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:497 add_lifetime_bound_suggestion_to_diagnostic (lane bck-diag-f)
BorrowExplanation.add_lifetime_bound_suggestion_to_diagnostic = function (
  self: BorrowExplanation,
  err: Diag,
  category: ConstraintCategory,
  span: Span,
  region_name: RegionName,
): void {
  return unported("rustc_borrowck::diagnostics::explain_borrow::BorrowExplanation::add_lifetime_bound_suggestion_to_diagnostic");
};

// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:526 suggest_rewrite_if_let (lane bck-diag-f)
export function suggest_rewrite_if_let(
  tcx: TyCtxt,
  expr: hir.Expr,
  pat: string,
  init: hir.Expr,
  conseq: hir.Expr,
  alt: hir.Expr | undefined,
  err: Diag,
): void {
  return unported("rustc_borrowck::diagnostics::explain_borrow::suggest_rewrite_if_let");
}

/// Returns structured explanation for *why* the borrow contains the
/// point from `location`. This is key for the "3-point errors"
/// [described in the NLL RFC][d].
///
/// # Parameters
///
/// - `borrow`: the borrow in question
/// - `location`: where the borrow occurs
/// - `kind_place`: if Some, this describes the statement that triggered the error.
///   - first half is the kind of write, if any, being performed
///   - second half is the place being accessed
///
/// [d]: https://rust-lang.github.io/rfcs/2094-nll.html#leveraging-intuition-framing-errors-in-terms-of-points
// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:588 explain_why_borrow_contains_point (lane bck-diag-f)
MirBorrowckCtxt.prototype.explain_why_borrow_contains_point = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  kind_place: [WriteKind, Place] | undefined,
): BorrowExplanation {
  return unported("rustc_borrowck::diagnostics::explain_borrow::MirBorrowckCtxt::explain_why_borrow_contains_point");
};

/// Determine how the borrow was later used.
/// First span returned points to the location of the conflicting use
/// Second span if `Some` is returned in the case of closures and points
/// to the use of the path
// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:719 later_use_kind (lane bck-diag-f)
MirBorrowckCtxt.prototype.later_use_kind = function (
  this: MirBorrowckCtxt,
  borrow: BorrowData,
  use_spans: UseSpans,
  location: Location,
): [LaterUseKind, Span, Span | undefined] {
  return unported("rustc_borrowck::diagnostics::explain_borrow::MirBorrowckCtxt::later_use_kind");
};

/// Checks if a borrowed value was captured by a trait object. We do this by
/// looking forward in the MIR from the reserve location and checking if we see
/// an unsized cast to a trait object on our data.
// stub: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:821 was_captured_by_trait_object (lane bck-diag-f)
MirBorrowckCtxt.prototype.was_captured_by_trait_object = function (this: MirBorrowckCtxt, borrow: BorrowData): boolean {
  return unported("rustc_borrowck::diagnostics::explain_borrow::MirBorrowckCtxt::was_captured_by_trait_object");
};
