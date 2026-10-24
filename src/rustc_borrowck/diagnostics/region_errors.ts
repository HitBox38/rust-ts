// Port of compiler/rustc_borrowck/src/diagnostics/region_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-e, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Error reporting machinery for lifetime errors.
// PORT: `RegionErrors::push(&mut self, val: impl Into<RegionErrorKind>)`: the only `Into` used is the identity, so `val` is a
// `RegionErrorKind`. `into_iter` returns an `Iterable`. `name_regions<T: TypeFoldable>` takes the fold impl `d_T` last.
// `Diag<'diag>` / `Diag<'_>` are rustc_errors `Diag` (the lifetimes are erased).
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import type { ConstraintCategory, ReturnConstraint } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import type { ConstraintDescription } from "../nll.ts";
import { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import type { OutlivesSuggestionBuilder } from "./outlives_suggestion.gen.ts";
import { type ErrorConstraintInfo, type RegionErrorKind, RegionErrors } from "./region_errors.gen.ts";
import type { RegionName } from "./region_name.gen.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";

export * from "./region_errors.gen.ts";

declare module "./region_errors.gen.ts" {
  interface RegionErrors {
    // region_errors.rs:82 (lane bck-diag-e)
    push(val: RegionErrorKind): void;
    // region_errors.rs:87 (lane bck-diag-e)
    is_empty(): boolean;
    // region_errors.rs:90 (lane bck-diag-e)
    into_iter(): Iterable<[RegionErrorKind, ErrorGuaranteed]>;
  }
  namespace RegionErrors {
    // region_errors.rs:78 (lane bck-diag-e)
    function new_(tcx: TyCtxt): RegionErrors;
    export { new_ as new };
  }
}

declare module "../region_infer/region_context.gen.ts" {
  interface RegionInferenceContext {
    // region_errors.rs:145 (lane bck-diag-e)
    to_error_region(r: RegionVid): Region | undefined;
    // region_errors.rs:151 (lane bck-diag-e)
    to_error_region_vid(r: RegionVid): RegionVid | undefined;
    // region_errors.rs:168 (lane bck-diag-e)
    name_regions<T>(tcx: TyCtxt, ty: T, d_T: TypeFoldable<T>): T;
    // region_errors.rs:179 (lane bck-diag-e)
    is_closure_fn_mut(fr: RegionVid): boolean;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // region_errors.rs:196 (lane bck-diag-e)
    suggest_static_lifetime_for_gat_from_hrtb(diag: Diag, lower_bound: RegionVid): void;
    // region_errors.rs:306 (lane bck-diag-e)
    report_region_errors(nll_errors: RegionErrors): void;
    // region_errors.rs:424 (lane bck-diag-e)
    explain_impl_static_obligation(diag: Diag, ty: Ty, outlived_fr: RegionVid): void;
    // region_errors.rs:556 (lane bck-diag-e)
    report_erroneous_rvid_reaches_placeholder(longer_fr: RegionVid, error_vid: RegionVid): void;
    // region_errors.rs:599 (lane bck-diag-e)
    report_region_error(fr: RegionVid, fr_origin: NllRegionVariableOrigin, outlived_fr: RegionVid, outlives_suggestion: OutlivesSuggestionBuilder): void;
    // region_errors.rs:762 (lane bck-diag-e)
    report_fnmut_error(errci: ErrorConstraintInfo, kind: ReturnConstraint): Diag;
    // region_errors.rs:835 (lane bck-diag-e)
    report_escaping_data_error(errci: ErrorConstraintInfo): Diag;
    // region_errors.rs:944 (lane bck-diag-e)
    report_general_error(errci: ErrorConstraintInfo): Diag;
    // region_errors.rs:1001 (lane bck-diag-e)
    add_static_impl_trait_suggestion(diag: Diag, fr: RegionVid, fr_name: RegionName, outlived_fr: RegionVid): void;
    // region_errors.rs:1091 (lane bck-diag-e)
    maybe_suggest_constrain_dyn_trait_impl(diag: Diag, f: Region, o: Region, category: ConstraintCategory): void;
    // region_errors.rs:1143 (lane bck-diag-e)
    suggest_constrain_dyn_trait_in_impl(err: Diag, found_dids: Set<DefId>, ident: Ident, self_ty: hir.Ty): boolean;
    // region_errors.rs:1180 (lane bck-diag-e)
    suggest_adding_lifetime_params(diag: Diag, sub: RegionVid, sup: RegionVid): void;
    // region_errors.rs:1218 (lane bck-diag-e)
    suggest_deref_closure_return(diag: Diag): void;
    // region_errors.rs:1349 (lane bck-diag-e)
    suggest_move_on_borrowing_closure(diag: Diag): void;
  }
}

// impl<'tcx> ConstraintDescription for ConstraintCategory<'tcx>
export const ConstraintDescription_ConstraintCategory: ConstraintDescription<ConstraintCategory> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:42 description (lane bck-diag-e)
  description(self: ConstraintCategory): string {
    return unported("rustc_borrowck::diagnostics::region_errors::ConstraintCategory::description");
  },
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:78 new (lane bck-diag-e)
(RegionErrors as unknown as { new: typeof RegionErrors.new }).new = function (tcx: TyCtxt): RegionErrors {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionErrors::new");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:82 push (lane bck-diag-e)
RegionErrors.prototype.push = function (this: RegionErrors, val: RegionErrorKind): void {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionErrors::push");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:87 is_empty (lane bck-diag-e)
RegionErrors.prototype.is_empty = function (this: RegionErrors): boolean {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionErrors::is_empty");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:90 into_iter (lane bck-diag-e)
RegionErrors.prototype.into_iter = function (this: RegionErrors): Iterable<[RegionErrorKind, ErrorGuaranteed]> {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionErrors::into_iter");
};

// impl std::fmt::Debug for RegionErrors<'_>
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:98 fmt (lane bck-diag-e)
export const debug_RegionErrors: Debug<RegionErrors> = (v, f) => unported("rustc_borrowck::diagnostics::region_errors::RegionErrors::fmt");

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:145 to_error_region (lane bck-diag-e)
RegionInferenceContext.prototype.to_error_region = function (this: RegionInferenceContext, r: RegionVid): Region | undefined {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionInferenceContext::to_error_region");
};

/// Returns the `RegionVid` corresponding to the region returned by
/// `to_error_region`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:151 to_error_region_vid (lane bck-diag-e)
RegionInferenceContext.prototype.to_error_region_vid = function (this: RegionInferenceContext, r: RegionVid): RegionVid | undefined {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionInferenceContext::to_error_region_vid");
};

/// Map the regions in the type to named regions, where possible.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:168 name_regions (lane bck-diag-e)
RegionInferenceContext.prototype.name_regions = function <T>(this: RegionInferenceContext, tcx: TyCtxt, ty: T, d_T: TypeFoldable<T>): T {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionInferenceContext::name_regions");
};

/// Returns `true` if a closure is inferred to be an `FnMut` closure.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:179 is_closure_fn_mut (lane bck-diag-e)
RegionInferenceContext.prototype.is_closure_fn_mut = function (this: RegionInferenceContext, fr: RegionVid): boolean {
  return unported("rustc_borrowck::diagnostics::region_errors::RegionInferenceContext::is_closure_fn_mut");
};

// For generic associated types (GATs) which implied 'static requirement
// from higher-ranked trait bounds (HRTB). Try to locate span of the trait
// and the span which bounded to the trait for adding 'static lifetime suggestion
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:196 suggest_static_lifetime_for_gat_from_hrtb (lane bck-diag-e)
MirBorrowckCtxt.prototype.suggest_static_lifetime_for_gat_from_hrtb = function (this: MirBorrowckCtxt, diag: Diag, lower_bound: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::suggest_static_lifetime_for_gat_from_hrtb");
};

/// Produces nice borrowck error diagnostics for all the errors collected in `nll_errors`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:306 report_region_errors (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_region_errors = function (this: MirBorrowckCtxt, nll_errors: RegionErrors): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_region_errors");
};

/// Report that `longer_fr: error_vid`, which doesn't hold,
/// where `longer_fr` is a placeholder from `placeholder`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:424 explain_impl_static_obligation (lane bck-diag-e)
MirBorrowckCtxt.prototype.explain_impl_static_obligation = function (this: MirBorrowckCtxt, diag: Diag, ty: Ty, outlived_fr: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::explain_impl_static_obligation");
};

/// Report that `longer_fr: error_vid`, which doesn't hold,
/// where `longer_fr` is a placeholder.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:556 report_erroneous_rvid_reaches_placeholder (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_erroneous_rvid_reaches_placeholder = function (this: MirBorrowckCtxt, longer_fr: RegionVid, error_vid: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_erroneous_rvid_reaches_placeholder");
};

/// Report an error because the universal region `fr` was required to outlive
/// `outlived_fr` but it is not known to do so. For example:
///
/// ```compile_fail
/// fn foo<'a, 'b>(x: &'a u32) -> &'b u32 { x }
/// ```
///
/// Here we would be invoked with `fr = 'a` and `outlived_fr = 'b`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:599 report_region_error (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_region_error = function (this: MirBorrowckCtxt, fr: RegionVid, fr_origin: NllRegionVariableOrigin, outlived_fr: RegionVid, outlives_suggestion: OutlivesSuggestionBuilder): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_region_error");
};

/// Report a specialized error when `FnMut` closures return a reference to a captured variable.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:762 report_fnmut_error (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_fnmut_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo, kind: ReturnConstraint): Diag {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_fnmut_error");
};

/// Reports an error specifically for when data is escaping a closure.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:835 report_escaping_data_error (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_escaping_data_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo): Diag {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_escaping_data_error");
};

/// Reports a region inference error for the general case with named/synthesized lifetimes to
/// explain what is happening.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:944 report_general_error (lane bck-diag-e)
MirBorrowckCtxt.prototype.report_general_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo): Diag {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::report_general_error");
};

/// Adds a suggestion to errors where an `impl Trait` is returned.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1001 add_static_impl_trait_suggestion (lane bck-diag-e)
MirBorrowckCtxt.prototype.add_static_impl_trait_suggestion = function (this: MirBorrowckCtxt, diag: Diag, fr: RegionVid, fr_name: RegionName, outlived_fr: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::add_static_impl_trait_suggestion");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1091 maybe_suggest_constrain_dyn_trait_impl (lane bck-diag-e)
MirBorrowckCtxt.prototype.maybe_suggest_constrain_dyn_trait_impl = function (this: MirBorrowckCtxt, diag: Diag, f: Region, o: Region, category: ConstraintCategory): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::maybe_suggest_constrain_dyn_trait_impl");
};

/// When there is an error with a `dyn` trait object in an `impl`, suggest constraining it.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1143 suggest_constrain_dyn_trait_in_impl (lane bck-diag-e)
MirBorrowckCtxt.prototype.suggest_constrain_dyn_trait_in_impl = function (this: MirBorrowckCtxt, err: Diag, found_dids: Set<DefId>, ident: Ident, self_ty: hir.Ty): boolean {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::suggest_constrain_dyn_trait_in_impl");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1180 suggest_adding_lifetime_params (lane bck-diag-e)
MirBorrowckCtxt.prototype.suggest_adding_lifetime_params = function (this: MirBorrowckCtxt, diag: Diag, sub: RegionVid, sup: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::suggest_adding_lifetime_params");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1218 suggest_deref_closure_return (lane bck-diag-e)
MirBorrowckCtxt.prototype.suggest_deref_closure_return = function (this: MirBorrowckCtxt, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::suggest_deref_closure_return");
};

/// When a closure captures a variable by reference and returns a reference
/// to that variable, suggest using `move`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1349 suggest_move_on_borrowing_closure (lane bck-diag-e)
MirBorrowckCtxt.prototype.suggest_move_on_borrowing_closure = function (this: MirBorrowckCtxt, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::region_errors::MirBorrowckCtxt::suggest_move_on_borrowing_closure");
};
