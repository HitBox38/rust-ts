// Port of compiler/rustc_borrowck/src/diagnostics/var_name.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { Body, Local } from "../../rustc_middle/mir/mod.ts";
import type { CapturedPlace } from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import { RegionInferenceContext } from "../region_infer/region_context.gen.ts";

export {};

declare module "../region_infer/region_context.gen.ts" {
  interface RegionInferenceContext {
    // var_name.rs:13 (lane bck-diag-c)
    get_var_name_and_span_for_region(tcx: TyCtxt, body: Body, local_names: readonly (Symbol | undefined)[], upvars: readonly CapturedPlace[], fr: RegionVid): [Symbol | undefined, Span] | undefined;
    // var_name.rs:47 (lane bck-diag-c)
    get_upvar_index_for_region(tcx: TyCtxt, fr: RegionVid): number | undefined;
    // var_name.rs:73 (lane bck-diag-c)
    get_upvar_name_and_span_for_region(tcx: TyCtxt, upvars: readonly CapturedPlace[], upvar_index: number): [Symbol, Span];
    // var_name.rs:96 (lane bck-diag-c)
    get_user_arg_index_for_region(tcx: TyCtxt, fr: RegionVid): number | undefined;
    // var_name.rs:120 (lane bck-diag-c)
    user_arg_index_to_local(body: Body, user_arg_index: number): Local;
    // var_name.rs:127 (lane bck-diag-c)
    get_argument_name_and_span_for_region(body: Body, local_names: readonly (Symbol | undefined)[], user_arg_index: number): [Symbol | undefined, Span];
  }
}

/// Find the name and span of the variable corresponding to the given region.
/// The returned var will also be ensured to actually be used in `body`.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:13 get_var_name_and_span_for_region (lane bck-diag-c)
RegionInferenceContext.prototype.get_var_name_and_span_for_region = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  body: Body,
  local_names: readonly (Symbol | undefined)[],
  upvars: readonly CapturedPlace[],
  fr: RegionVid,
): [Symbol | undefined, Span] | undefined {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::get_var_name_and_span_for_region");
};

/// Search the upvars (if any) to find one that references fr. Return its index.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:47 get_upvar_index_for_region (lane bck-diag-c)
RegionInferenceContext.prototype.get_upvar_index_for_region = function (this: RegionInferenceContext, tcx: TyCtxt, fr: RegionVid): number | undefined {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::get_upvar_index_for_region");
};

/// Given the index of an upvar, finds its name and the span from where it was
/// declared.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:73 get_upvar_name_and_span_for_region (lane bck-diag-c)
RegionInferenceContext.prototype.get_upvar_name_and_span_for_region = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  upvars: readonly CapturedPlace[],
  upvar_index: number,
): [Symbol, Span] {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::get_upvar_name_and_span_for_region");
};

/// Search the argument types for one that references fr (which should be a free region).
/// Returns Some(_) with the index of the input if one is found.
///
/// N.B., in the case of a closure, the index is indexing into the signature as seen by the
/// user - in particular, index 0 is not the implicit self parameter.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:96 get_user_arg_index_for_region (lane bck-diag-c)
RegionInferenceContext.prototype.get_user_arg_index_for_region = function (this: RegionInferenceContext, tcx: TyCtxt, fr: RegionVid): number | undefined {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::get_user_arg_index_for_region");
};

/// Given the index of an argument as seen from the user (i.e. excluding
/// implicit inputs), returns the corresponding MIR local.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:120 user_arg_index_to_local (lane bck-diag-c)
RegionInferenceContext.prototype.user_arg_index_to_local = function (this: RegionInferenceContext, body: Body, user_arg_index: number): Local {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::user_arg_index_to_local");
};

/// Given the index of an argument, finds its name (if any) and the span from where it was
/// declared.
// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:127 get_argument_name_and_span_for_region (lane bck-diag-c)
RegionInferenceContext.prototype.get_argument_name_and_span_for_region = function (
  this: RegionInferenceContext,
  body: Body,
  local_names: readonly (Symbol | undefined)[],
  user_arg_index: number,
): [Symbol | undefined, Span] {
  return unported("rustc_borrowck::diagnostics::var_name::RegionInferenceContext::get_argument_name_and_span_for_region");
};

// stub: compiler/rustc_borrowck/src/diagnostics/var_name.rs:146 body_uses_local (lane bck-diag-c)
function body_uses_local(body: Body, target: Local): boolean {
  return unported("rustc_borrowck::diagnostics::var_name::body_uses_local");
}
