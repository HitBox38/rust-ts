// Port of compiler/rustc_borrowck/src/diagnostics/region_name.rs (lane borrowck-contract: declarations; fill lane bck-diag-e, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// Init order: the generated session_diagnostics.gen.ts / explain_borrow.gen.ts / outlives_suggestion.gen.ts import this module
// at runtime (`RegionName_into_diag_arg`, `debug_RegionName`), so its own runtime imports are `.gen.ts` modules and other
// crates only.
// PORT: `impl Display for RegionName` is `display_RegionName(self)` (returns the text); `impl IntoDiagArg for RegionName`
// is `RegionName_into_diag_arg(self, path)` (the name the generated diagnostics call).
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type { GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { EarlyParamRegion } from "../../rustc_middle/ty/region.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import { RegionName, type RegionNameHighlight } from "./region_name.gen.ts";

export * from "./region_name.gen.ts";

declare module "./region_name.gen.ts" {
  interface RegionName {
    // region_name.rs:72 (lane bck-diag-e)
    was_named(): boolean;
    // region_name.rs:87 (lane bck-diag-e)
    span(): Span | undefined;
    // region_name.rs:107 (lane bck-diag-e)
    highlight_region_name(diag: Diag): void;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // region_name.rs:202 (lane bck-diag-e)
    mir_def_id(): LocalDefId;
    // region_name.rs:206 (lane bck-diag-e)
    mir_hir_id(): HirId;
    // region_name.rs:214 (lane bck-diag-e)
    synthesize_region_name(): Symbol;
    // region_name.rs:246 (lane bck-diag-e)
    give_region_a_name(fr: RegionVid): RegionName | undefined;
    // region_name.rs:284 (lane bck-diag-e)
    give_name_from_error_region(fr: RegionVid): RegionName | undefined;
    // region_name.rs:390 (lane bck-diag-e)
    give_name_if_we_can_match_upvar_args(fr: RegionVid, upvar_index: number): RegionName | undefined;
    // region_name.rs:501 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_arguments(fr: RegionVid): RegionName | undefined;
    // region_name.rs:533 (lane bck-diag-e)
    get_argument_hir_ty_for_highlighting(user_arg_index: number): hir.Ty | undefined;
    // region_name.rs:563 (lane bck-diag-e)
    highlight_if_we_cannot_match_hir_ty(needle_fr: RegionVid, ty: Ty, span: Span, counter: number): RegionNameHighlight;
    // region_name.rs:608 (lane bck-diag-e)
    highlight_if_we_can_match_hir_ty(needle_fr: RegionVid, ty: Ty, hir_ty: hir.Ty): RegionNameHighlight | undefined;
    // region_name.rs:693 (lane bck-diag-e)
    match_adt_and_segment(args: GenericArgsRef, needle_fr: RegionVid, last_segment: hir.PathSegment, search_stack: [Ty, hir.Ty][]): RegionNameHighlight | undefined;
    // region_name.rs:716 (lane bck-diag-e)
    try_match_adt_and_generic_args(args: GenericArgsRef, needle_fr: RegionVid, hir_args: hir.GenericArgs, search_stack: [Ty, hir.Ty][]): hir.Lifetime | undefined;
    // region_name.rs:766 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_upvars(fr: RegionVid): RegionName | undefined;
    // region_name.rs:793 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_output(fr: RegionVid): RegionName | undefined;
    // region_name.rs:954 (lane bck-diag-e)
    get_future_inner_return_ty(hir_ty: hir.Ty): hir.Ty;
    // region_name.rs:979 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_yield_ty(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1022 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_impl_signature(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1057 (lane bck-diag-e)
    give_name_if_anonymous_region_appears_in_arg_position_impl_trait(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1122 (lane bck-diag-e)
    any_param_clause_mentions(clauses: readonly Clause[], ty: Ty, region: EarlyParamRegion): boolean;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:72 was_named (lane bck-diag-e)
RegionName.prototype.was_named = function (this: RegionName): boolean {
  return unported("rustc_borrowck::diagnostics::region_name::RegionName::was_named");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:87 span (lane bck-diag-e)
RegionName.prototype.span = function (this: RegionName): Span | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::RegionName::span");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:107 highlight_region_name (lane bck-diag-e)
RegionName.prototype.highlight_region_name = function (this: RegionName, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::region_name::RegionName::highlight_region_name");
};

// impl Display for RegionName
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:190 fmt (lane bck-diag-e)
export function display_RegionName(self: RegionName): string {
  return unported("rustc_borrowck::diagnostics::region_name::RegionName::fmt");
}

// impl rustc_errors::IntoDiagArg for RegionName
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:196 into_diag_arg (lane bck-diag-e)
export function RegionName_into_diag_arg(self: RegionName, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_borrowck::diagnostics::region_name::RegionName::into_diag_arg");
}

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:202 mir_def_id (lane bck-diag-e)
MirBorrowckCtxt.prototype.mir_def_id = function (this: MirBorrowckCtxt): LocalDefId {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::mir_def_id");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:206 mir_hir_id (lane bck-diag-e)
MirBorrowckCtxt.prototype.mir_hir_id = function (this: MirBorrowckCtxt): HirId {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::mir_hir_id");
};

/// Generate a synthetic region named `'N`, where `N` is the next value of the counter. Then,
/// increment the counter.
///
/// This is _not_ idempotent. Call `give_region_a_name` when possible.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:214 synthesize_region_name (lane bck-diag-e)
MirBorrowckCtxt.prototype.synthesize_region_name = function (this: MirBorrowckCtxt): Symbol {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::synthesize_region_name");
};

/// Maps from an internal MIR region vid to something that we can
/// report to the user. In some cases, the region vids will map
/// directly to lifetimes that the user has a name for (e.g.,
/// `'static`). But frequently they will not, in which case we
/// have to find some way to identify the lifetime to the user. To
/// that end, this function takes a "diagnostic" so that it can
/// create auxiliary notes as needed.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:246 give_region_a_name (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_region_a_name = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_region_a_name");
};

/// Checks for the case where `fr` maps to something that the
/// *user* has a name for. In that case, we'll be able to map
/// `fr` to a `Region<'tcx>`, and that region will be one of
/// named variants.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:284 give_name_from_error_region (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_from_error_region = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_from_error_region");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:390 give_name_if_we_can_match_upvar_args (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_we_can_match_upvar_args = function (this: MirBorrowckCtxt, fr: RegionVid, upvar_index: number): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_we_can_match_upvar_args");
};

/// Finds an argument that contains `fr` and label it with a fully
/// elaborated type, returning something like `'1`. Result looks
/// like:
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:501 give_name_if_anonymous_region_appears_in_arguments (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_arguments = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_arguments");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:533 get_argument_hir_ty_for_highlighting (lane bck-diag-e)
MirBorrowckCtxt.prototype.get_argument_hir_ty_for_highlighting = function (this: MirBorrowckCtxt, user_arg_index: number): hir.Ty | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::get_argument_hir_ty_for_highlighting");
};

/// Attempts to highlight the specific part of a type in an argument
/// that has no type annotation.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:563 highlight_if_we_cannot_match_hir_ty (lane bck-diag-e)
MirBorrowckCtxt.prototype.highlight_if_we_cannot_match_hir_ty = function (this: MirBorrowckCtxt, needle_fr: RegionVid, ty: Ty, span: Span, counter: number): RegionNameHighlight {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::highlight_if_we_cannot_match_hir_ty");
};

/// Attempts to highlight the specific part of a type annotation
/// that contains the anonymous reference we want to give a name
/// to.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:608 highlight_if_we_can_match_hir_ty (lane bck-diag-e)
MirBorrowckCtxt.prototype.highlight_if_we_can_match_hir_ty = function (this: MirBorrowckCtxt, needle_fr: RegionVid, ty: Ty, hir_ty: hir.Ty): RegionNameHighlight | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::highlight_if_we_can_match_hir_ty");
};

/// We've found an enum/struct/union type with the generic args
/// `args`. If `needle_fr` is a reference to one of its region
/// parameters, ...
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:693 match_adt_and_segment (lane bck-diag-e)
MirBorrowckCtxt.prototype.match_adt_and_segment = function (this: MirBorrowckCtxt, args: GenericArgsRef, needle_fr: RegionVid, last_segment: hir.PathSegment, search_stack: [Ty, hir.Ty][]): RegionNameHighlight | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::match_adt_and_segment");
};

/// We've found an enum/struct/union type with the generic args
/// `args` and -- in the HIR -- a path with the generic
/// arguments `hir_args`. If `needle_fr` appears in the args, return
/// the `hir::Lifetime` that corresponds to it. If not, push onto
/// `search_stack` the types+hir to search through.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:716 try_match_adt_and_generic_args (lane bck-diag-e)
MirBorrowckCtxt.prototype.try_match_adt_and_generic_args = function (this: MirBorrowckCtxt, args: GenericArgsRef, needle_fr: RegionVid, hir_args: hir.GenericArgs, search_stack: [Ty, hir.Ty][]): hir.Lifetime | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::try_match_adt_and_generic_args");
};

/// Finds a closure upvar that contains `fr` and label it with a
/// fully elaborated type, returning something like `'1`.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:766 give_name_if_anonymous_region_appears_in_upvars (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_upvars = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_upvars");
};

/// Checks for arguments appearing in the (closure) return type. It
/// must be a closure since, in a free fn, such an argument would
/// have to either also appear in an argument (if using elision)
/// or be early bound (named, not in argument).
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:793 give_name_if_anonymous_region_appears_in_output (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_output = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_output");
};

/// From the [`hir::Ty`] of an async function's lowered return type,
/// retrieve the `hir::Ty` representing the type the user originally wrote.
// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:954 get_future_inner_return_ty (lane bck-diag-e)
MirBorrowckCtxt.prototype.get_future_inner_return_ty = function (this: MirBorrowckCtxt, hir_ty: hir.Ty): hir.Ty {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::get_future_inner_return_ty");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:979 give_name_if_anonymous_region_appears_in_yield_ty (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_yield_ty = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_yield_ty");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1022 give_name_if_anonymous_region_appears_in_impl_signature (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_impl_signature = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_impl_signature");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1057 give_name_if_anonymous_region_appears_in_arg_position_impl_trait (lane bck-diag-e)
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_arg_position_impl_trait = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::give_name_if_anonymous_region_appears_in_arg_position_impl_trait");
};

// stub: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1122 any_param_clause_mentions (lane bck-diag-e)
MirBorrowckCtxt.prototype.any_param_clause_mentions = function (this: MirBorrowckCtxt, clauses: readonly Clause[], ty: Ty, region: EarlyParamRegion): boolean {
  return unported("rustc_borrowck::diagnostics::region_name::MirBorrowckCtxt::any_param_clause_mentions");
};
