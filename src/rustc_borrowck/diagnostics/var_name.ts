// Port of compiler/rustc_borrowck/src/diagnostics/var_name.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { Body, Local, Place } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, VisitPlacesWith } from "../../rustc_middle/mir/visit.ts";
import type { CapturedPlace } from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { assert, panic } from "../../std/panic.ts";
import { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import { DefiningTy } from "../universal_regions.ts";

export {};

declare module "../region_infer/region_context.gen.ts" {
  interface RegionInferenceContext {
    // var_name.rs:13
    get_var_name_and_span_for_region(tcx: TyCtxt, body: Body, local_names: readonly (Symbol | undefined)[], upvars: readonly CapturedPlace[], fr: RegionVid): [Symbol | undefined, Span] | undefined;
    // var_name.rs:47
    get_upvar_index_for_region(tcx: TyCtxt, fr: RegionVid): number | undefined;
    // var_name.rs:73
    get_upvar_name_and_span_for_region(tcx: TyCtxt, upvars: readonly CapturedPlace[], upvar_index: number): [Symbol, Span];
    // var_name.rs:96
    get_user_arg_index_for_region(tcx: TyCtxt, fr: RegionVid): number | undefined;
    // var_name.rs:120
    user_arg_index_to_local(body: Body, user_arg_index: number): Local;
    // var_name.rs:127
    get_argument_name_and_span_for_region(body: Body, local_names: readonly (Symbol | undefined)[], user_arg_index: number): [Symbol | undefined, Span];
  }
}

/// Find the name and span of the variable corresponding to the given region.
/// The returned var will also be ensured to actually be used in `body`.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:13 get_var_name_and_span_for_region
RegionInferenceContext.prototype.get_var_name_and_span_for_region = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  body: Body,
  local_names: readonly (Symbol | undefined)[],
  upvars: readonly CapturedPlace[],
  fr: RegionVid,
): [Symbol | undefined, Span] | undefined {
  // debug!("get_var_name_and_span_for_region(fr={fr:?})");
  assert(this.universal_regions().is_universal_region(fr), "assertion failed: self.universal_regions().is_universal_region(fr)");

  // debug!("get_var_name_and_span_for_region: attempting upvar");
  const upvar_index = this.get_upvar_index_for_region(tcx, fr);
  if (upvar_index !== undefined) {
    // FIXME(project-rfc-2229#8): Use place span for diagnostics
    // We know our upvars are used thanks to `fn compute_min_captures()` in `upvar.rs`.
    const [name, span] = this.get_upvar_name_and_span_for_region(tcx, upvars, upvar_index);
    return [name, span];
  }
  // debug!("get_var_name_and_span_for_region: attempting argument");
  const index = this.get_user_arg_index_for_region(tcx, fr);
  if (index === undefined) return undefined;
  const local = this.user_arg_index_to_local(body, index);
  if (body_uses_local(body, local)) {
    return this.get_argument_name_and_span_for_region(body, local_names, index);
  } else {
    // debug!("get_var_name_and_span_for_region: skipping unused local {local:?}");
    return undefined;
  }
};

/// Search the upvars (if any) to find one that references fr. Return its index.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:47 get_upvar_index_for_region
RegionInferenceContext.prototype.get_upvar_index_for_region = function (this: RegionInferenceContext, tcx: TyCtxt, fr: RegionVid): number | undefined {
  const upvar_index = DefiningTy.upvar_tys(this.universal_regions().defining_ty).findIndex((upvar_ty) => {
    // debug!("get_upvar_index_for_region: upvar_ty={upvar_ty:?}");
    return tcx.any_free_region_meets(
      upvar_ty,
      (r) => {
        const r_ = r.as_var();
        // debug!("get_upvar_index_for_region: r={r:?} fr={fr:?}");
        return r_ === fr;
      },
      fold_Ty,
    );
  });
  if (upvar_index === -1) return undefined;

  // PORT: `upvar_ty` is only read by the `debug!` below.
  // let upvar_ty = self.universal_regions().defining_ty.upvar_tys().get(upvar_index);

  // debug!("get_upvar_index_for_region: found {fr:?} in upvar {upvar_index} which has type {upvar_ty:?}");

  return upvar_index;
};

/// Given the index of an upvar, finds its name and the span from where it was
/// declared.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:73 get_upvar_name_and_span_for_region
RegionInferenceContext.prototype.get_upvar_name_and_span_for_region = function (
  this: RegionInferenceContext,
  tcx: TyCtxt,
  upvars: readonly CapturedPlace[],
  upvar_index: number,
): [Symbol, Span] {
  const upvar = upvars[upvar_index];
  if (upvar === undefined) {
    return panic(`index out of bounds: the len is ${upvars.length} but the index is ${upvar_index}`);
  }
  const upvar_hir_id = upvar.get_root_variable();
  // debug!("get_upvar_name_and_span_for_region: upvar_hir_id={upvar_hir_id:?}");

  const upvar_name = tcx.hir_name(upvar_hir_id);
  const upvar_span = tcx.hir_span(upvar_hir_id);
  // debug!("get_upvar_name_and_span_for_region: upvar_name={upvar_name:?} upvar_span={upvar_span:?}");

  return [upvar_name, upvar_span];
};

/// Search the argument types for one that references fr (which should be a free region).
/// Returns Some(_) with the index of the input if one is found.
///
/// N.B., in the case of a closure, the index is indexing into the signature as seen by the
/// user - in particular, index 0 is not the implicit self parameter.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:96 get_user_arg_index_for_region
RegionInferenceContext.prototype.get_user_arg_index_for_region = function (this: RegionInferenceContext, tcx: TyCtxt, fr: RegionVid): number | undefined {
  const implicit_inputs = DefiningTy.implicit_inputs(this.universal_regions().defining_ty);
  const user_arg_index = this.universal_regions()
    .unnormalized_input_tys.slice(implicit_inputs)
    .findIndex((arg_ty) => {
      // debug!("get_user_arg_index_for_region: arg_ty = {arg_ty:?}");
      return tcx.any_free_region_meets(arg_ty, (r) => r.as_var() === fr, fold_Ty);
    });
  if (user_arg_index === -1) return undefined;

  // debug!("get_user_arg_index_for_region: found {fr:?} in argument {user_arg_index} which has type {:?}", ...);

  return user_arg_index;
};

/// Given the index of an argument as seen from the user (i.e. excluding
/// implicit inputs), returns the corresponding MIR local.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:120 user_arg_index_to_local
RegionInferenceContext.prototype.user_arg_index_to_local = function (this: RegionInferenceContext, body: Body, user_arg_index: number): Local {
  const implicit_inputs = DefiningTy.implicit_inputs(this.universal_regions().defining_ty);
  const local = body.args_iter()[implicit_inputs + user_arg_index];
  if (local === undefined) return panic("called `Option::unwrap()` on a `None` value");
  return local;
};

/// Given the index of an argument, finds its name (if any) and the span from where it was
/// declared.
// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:127 get_argument_name_and_span_for_region
RegionInferenceContext.prototype.get_argument_name_and_span_for_region = function (
  this: RegionInferenceContext,
  body: Body,
  local_names: readonly (Symbol | undefined)[],
  user_arg_index: number,
): [Symbol | undefined, Span] {
  const argument_local = this.user_arg_index_to_local(body, user_arg_index);
  // debug!("get_argument_name_and_span_for_region: argument_local={argument_local:?}");

  const argument_name = local_names[argument_local];
  const argument_span = body.local_decls[argument_local]!.source_info.span;
  // debug!("get_argument_name_and_span_for_region: argument_name={argument_name:?} argument_span={argument_span:?}");

  return [argument_name, argument_span];
};

// rustc: compiler/rustc_borrowck/src/diagnostics/var_name.rs:146 body_uses_local
function body_uses_local(body: Body, target: Local): boolean {
  let used = false;
  new VisitPlacesWith((place: Place, context: PlaceContext) => {
    if (!(context.$ === "NonUse") && place.local === target) {
      used = true;
    }
  }).visit_body(body);
  return used;
}
