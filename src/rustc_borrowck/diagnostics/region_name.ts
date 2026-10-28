// Port of compiler/rustc_borrowck/src/diagnostics/region_name.rs (lane borrowck-contract: declarations; fill lane bck-diag-e, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// Init order: the generated session_diagnostics.gen.ts / explain_borrow.gen.ts / outlives_suggestion.gen.ts import this module
// at runtime (`RegionName_into_diag_arg`, `debug_RegionName`), so its own runtime imports are `.gen.ts` modules and other
// crates only; the hand module universal_regions.ts (`DefiningTy` methods) is required lazily (`universal_regions()`).
// PORT: `impl Display for RegionName` is `display_RegionName(self)` (returns the text); `impl IntoDiagArg for RegionName`
// is `RegionName_into_diag_arg(self, path)` (the name the generated diagnostics call).
// PORT: `RegionName` is `Copy` and never mutated: the memoized value in `region_names` is returned as is (no copy).
// `self.next_region_name` (`RefCell<usize>`) is the field itself; `try_borrow().unwrap()` reads it.
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import { String_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { HirId_eq, type HirId } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../../rustc_middle/ty/generics.ts";
import { Asyncness, type Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { RegionHighlightMode } from "../../rustc_middle/ty/print/pretty.ts";
import { EarlyParamRegion, LateParamRegionKind } from "../../rustc_middle/ty/region.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { TraitClause } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import * as hir_gen from "../../rustc_hir/hir.gen.ts";
import { debug_GenericArg } from "../../rustc_middle/ty/structural_impls.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import { RegionName, type RegionNameHighlight, type RegionNameSource } from "./region_name.gen.ts";

export * from "./region_name.gen.ts";

// PORT (init order, module header): universal_regions.ts is a hand module that assigns prototype methods at load.
function universal_regions(): typeof import("../universal_regions.ts") {
  return (universal_regions__m ??= require("../universal_regions.ts") as typeof import("../universal_regions.ts"));
}
var universal_regions__m: typeof import("../universal_regions.ts") | undefined;

declare module "./region_name.gen.ts" {
  interface RegionName {
    // region_name.rs:72
    was_named(): boolean;
    // region_name.rs:87
    span(): Span | undefined;
    // region_name.rs:107
    highlight_region_name(diag: Diag): void;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // region_name.rs:202
    mir_def_id(): LocalDefId;
    // region_name.rs:206
    mir_hir_id(): HirId;
    // region_name.rs:214
    synthesize_region_name(): Symbol;
    // region_name.rs:246
    give_region_a_name(fr: RegionVid): RegionName | undefined;
    // region_name.rs:284
    give_name_from_error_region(fr: RegionVid): RegionName | undefined;
    // region_name.rs:390
    give_name_if_we_can_match_upvar_args(fr: RegionVid, upvar_index: number): RegionName | undefined;
    // region_name.rs:501
    give_name_if_anonymous_region_appears_in_arguments(fr: RegionVid): RegionName | undefined;
    // region_name.rs:533
    get_argument_hir_ty_for_highlighting(user_arg_index: number): hir.Ty | undefined;
    // region_name.rs:563
    highlight_if_we_cannot_match_hir_ty(needle_fr: RegionVid, ty: Ty, span: Span, counter: number): RegionNameHighlight;
    // region_name.rs:608
    highlight_if_we_can_match_hir_ty(needle_fr: RegionVid, ty: Ty, hir_ty: hir.Ty): RegionNameHighlight | undefined;
    // region_name.rs:693
    match_adt_and_segment(args: GenericArgsRef, needle_fr: RegionVid, last_segment: hir.PathSegment, search_stack: [Ty, hir.Ty][]): RegionNameHighlight | undefined;
    // region_name.rs:716
    try_match_adt_and_generic_args(args: GenericArgsRef, needle_fr: RegionVid, hir_args: hir.GenericArgs, search_stack: [Ty, hir.Ty][]): hir.Lifetime | undefined;
    // region_name.rs:766
    give_name_if_anonymous_region_appears_in_upvars(fr: RegionVid): RegionName | undefined;
    // region_name.rs:793
    give_name_if_anonymous_region_appears_in_output(fr: RegionVid): RegionName | undefined;
    // region_name.rs:954
    get_future_inner_return_ty(hir_ty: hir.Ty): hir.Ty;
    // region_name.rs:979
    give_name_if_anonymous_region_appears_in_yield_ty(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1022
    give_name_if_anonymous_region_appears_in_impl_signature(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1057
    give_name_if_anonymous_region_appears_in_arg_position_impl_trait(fr: RegionVid): RegionName | undefined;
    // region_name.rs:1122
    any_param_clause_mentions(clauses: readonly Clause[], ty: Ty, region: EarlyParamRegion): boolean;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:72 was_named
RegionName.prototype.was_named = function (this: RegionName): boolean {
  switch (this.source.$) {
    case "NamedEarlyParamRegion":
    case "NamedLateParamRegion":
    case "Static":
      return true;
    case "SynthesizedFreeEnvRegion":
    case "AnonRegionFromArgument":
    case "AnonRegionFromUpvar":
    case "AnonRegionFromOutput":
    case "AnonRegionFromYieldTy":
    case "AnonRegionFromAsyncFn":
    case "AnonRegionFromImplSignature":
      return false;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:87 span
RegionName.prototype.span = function (this: RegionName): Span | undefined {
  const source = this.source;
  switch (source.$) {
    case "Static":
      return undefined;
    case "NamedEarlyParamRegion":
    case "NamedLateParamRegion":
    case "SynthesizedFreeEnvRegion":
    case "AnonRegionFromUpvar":
    case "AnonRegionFromYieldTy":
    case "AnonRegionFromAsyncFn":
    case "AnonRegionFromImplSignature":
      return source._0;
    case "AnonRegionFromArgument":
    case "AnonRegionFromOutput": {
      const highlight = source._0;
      switch (highlight.$) {
        case "MatchedHirTy":
        case "MatchedAdtAndSegment":
        case "CannotMatchHirTy":
        case "Occluded":
          return highlight._0;
      }
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:107 highlight_region_name
RegionName.prototype.highlight_region_name = function (this: RegionName, diag: Diag): void {
  const self = display_RegionName(this);
  const source: RegionNameSource = this.source;
  if (source.$ === "NamedLateParamRegion" || source.$ === "NamedEarlyParamRegion") {
    const span = source._0;
    diag.span_label(span, `lifetime \`${self}\` defined here`);
  } else if (source.$ === "SynthesizedFreeEnvRegion") {
    const [span, closure_trait] = [source._0, source._1];
    diag.span_label(span, `lifetime \`${self}\` represents this closure's body`);
    diag.note(`closure implements \`${closure_trait}\`, so references to captured variables can't escape the closure`);
  } else if (source.$ === "AnonRegionFromArgument" && source._0.$ === "CannotMatchHirTy") {
    const [span, type_name] = [source._0._0, source._0._1];
    diag.span_label(span, `has type \`${Symbol.as_str(type_name)}\``);
  } else if (
    (source.$ === "AnonRegionFromArgument" && source._0.$ === "MatchedHirTy") ||
    (source.$ === "AnonRegionFromOutput" && source._0.$ === "MatchedHirTy") ||
    source.$ === "AnonRegionFromAsyncFn"
  ) {
    const span = source.$ === "AnonRegionFromAsyncFn" ? source._0 : source._0._0;
    diag.span_label(span, `let's call the lifetime of this reference \`${self}\``);
  } else if (
    (source.$ === "AnonRegionFromArgument" && source._0.$ === "MatchedAdtAndSegment") ||
    (source.$ === "AnonRegionFromOutput" && source._0.$ === "MatchedAdtAndSegment")
  ) {
    const span = source._0._0;
    diag.span_label(span, `let's call this \`${self}\``);
  } else if (source.$ === "AnonRegionFromArgument" && source._0.$ === "Occluded") {
    const [span, type_name] = [source._0._0, source._0._1];
    diag.span_label(span, `lifetime \`${self}\` appears in the type \`${Symbol.as_str(type_name)}\``);
  } else if (source.$ === "AnonRegionFromOutput" && source._0.$ === "Occluded") {
    const [span, type_name, mir_description] = [source._0._0, source._0._1, source._1];
    diag.span_label(span, `return type${mir_description} \`${Symbol.as_str(type_name)}\` contains a lifetime \`${self}\``);
  } else if (source.$ === "AnonRegionFromUpvar") {
    const [span, upvar_name] = [source._0, source._1];
    diag.span_label(span, `lifetime \`${self}\` appears in the type of \`${Symbol.as_str(upvar_name)}\``);
  } else if (source.$ === "AnonRegionFromOutput" && source._0.$ === "CannotMatchHirTy") {
    const [span, type_name, mir_description] = [source._0._0, source._0._1, source._1];
    diag.span_label(span, `return type${mir_description} is ${Symbol.as_str(type_name)}`);
  } else if (source.$ === "AnonRegionFromYieldTy") {
    const [span, type_name] = [source._0, source._1];
    diag.span_label(span, `yield type is ${Symbol.as_str(type_name)}`);
  } else if (source.$ === "AnonRegionFromImplSignature") {
    const [span, location] = [source._0, source._1];
    diag.span_label(span, `lifetime \`${self}\` appears in the \`impl\`'s ${location}`);
  } else if (source.$ === "Static") {
    // {}
  }
};

// impl Display for RegionName
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:190 fmt
export function display_RegionName(self: RegionName): string {
  return Symbol.as_str(self.name);
}

// impl rustc_errors::IntoDiagArg for RegionName
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:196 into_diag_arg
export function RegionName_into_diag_arg(self: RegionName, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_RegionName(self), path);
}

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:202 mir_def_id
MirBorrowckCtxt.prototype.mir_def_id = function (this: MirBorrowckCtxt): LocalDefId {
  return this.body.source.def_id().expect_local();
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:206 mir_hir_id
MirBorrowckCtxt.prototype.mir_hir_id = function (this: MirBorrowckCtxt): HirId {
  return this.infcx.tcx.local_def_id_to_hir_id(this.mir_def_id());
};

/// Generate a synthetic region named `'N`, where `N` is the next value of the counter. Then,
/// increment the counter.
///
/// This is _not_ idempotent. Call `give_region_a_name` when possible.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:214 synthesize_region_name
MirBorrowckCtxt.prototype.synthesize_region_name = function (this: MirBorrowckCtxt): Symbol {
  const c = this.next_region_name;
  this.next_region_name = c + 1;
  return Symbol.intern(`'${c}`);
};

/// Maps from an internal MIR region vid to something that we can
/// report to the user. In some cases, the region vids will map
/// directly to lifetimes that the user has a name for (e.g.,
/// `'static`). But frequently they will not, in which case we
/// have to find some way to identify the lifetime to the user. To
/// that end, this function takes a "diagnostic" so that it can
/// create auxiliary notes as needed.
///
/// The names are memoized, so this is both cheap to recompute and idempotent.
///
/// Example (function arguments):
///
/// Suppose we are trying to give a name to the lifetime of the
/// reference `x`:
///
/// ```ignore (pseudo-rust)
/// fn foo(x: &u32) { .. }
/// ```
///
/// This function would create a label like this:
///
/// ```text
///  | fn foo(x: &u32) { .. }
///           ------- fully elaborated type of `x` is `&'1 u32`
/// ```
///
/// and then return the name `'1` for us to use.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:246 give_region_a_name
MirBorrowckCtxt.prototype.give_region_a_name = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  // debug!("give_region_a_name(fr={:?}, counter={:?})", fr, self.next_region_name.try_borrow().unwrap());

  assert(this.regioncx.universal_regions().is_universal_region(fr), "assertion failed: self.regioncx.universal_regions().is_universal_region(fr)");

  const precomputed_name = this.region_names.get(fr);
  if (precomputed_name !== undefined) {
    return precomputed_name;
  } else {
    const new_name =
      this.give_name_from_error_region(fr) ??
      this.give_name_if_anonymous_region_appears_in_arguments(fr) ??
      this.give_name_if_anonymous_region_appears_in_upvars(fr) ??
      this.give_name_if_anonymous_region_appears_in_output(fr) ??
      this.give_name_if_anonymous_region_appears_in_yield_ty(fr) ??
      this.give_name_if_anonymous_region_appears_in_impl_signature(fr) ??
      this.give_name_if_anonymous_region_appears_in_arg_position_impl_trait(fr);

    if (new_name !== undefined) {
      this.region_names.set(fr, new_name);
    }
    // debug!("give_region_a_name: gave name {:?}", new_name);

    return new_name;
  }
};

/// Checks for the case where `fr` maps to something that the
/// *user* has a name for. In that case, we'll be able to map
/// `fr` to a `Region<'tcx>`, and that region will be one of
/// named variants.
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:284 give_name_from_error_region
MirBorrowckCtxt.prototype.give_name_from_error_region = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  const error_region = this.regioncx.to_error_region(fr);
  if (error_region === undefined) return undefined;

  const tcx = this.infcx.tcx;

  // debug!("give_region_a_name: error_region = {:?}", error_region);
  const k = error_region.kind();
  switch (k.$) {
    case "ReEarlyParam": {
      const ebr = k._0;
      if (!EarlyParamRegion.is_named(ebr)) return undefined;
      const def_id = (tcx.generics_of(this.mir_def_id()) as Generics).region_param(ebr, tcx).def_id;
      const span = tcx.hir_span_if_local(def_id) ?? DUMMY_SP;
      return new RegionName(ebr.name, { $: "NamedEarlyParamRegion", _0: span });
    }

    case "ReStatic":
      return new RegionName(kw.StaticLifetime, { $: "Static" });

    case "ReLateParam": {
      const late_param = k._0;
      switch (late_param.kind.$) {
        case "Named": {
          const region_def_id = late_param.kind._0;
          // Get the span to point to, even if we don't use the name.
          const span = tcx.hir_span_if_local(region_def_id) ?? DUMMY_SP;

          const name = LateParamRegionKind.get_name(late_param.kind, tcx);
          if (name !== undefined) {
            // A named region that is actually named.
            return new RegionName(name, { $: "NamedLateParamRegion", _0: span });
          } else if (Asyncness.is_async(tcx.asyncness(this.mir_hir_id().owner) as Asyncness)) {
            // If we spuriously thought that the region is named, we should let the
            // system generate a true name for error messages. Currently this can
            // happen if we have an elided name in an async fn for example: the
            // compiler will generate a region named `'_`, but reporting such a name is
            // not actually useful, so we synthesize a name for it instead.
            const name = this.synthesize_region_name();
            return new RegionName(name, { $: "AnonRegionFromAsyncFn", _0: span });
          } else {
            return undefined;
          }
        }

        case "ClosureEnv": {
          const def_ty = this.regioncx.universal_regions().defining_ty;

          let is_lending_coroutine_closure: boolean;
          let closure_kind: ClosureKind;
          switch (def_ty.$) {
            case "Closure": {
              const args = def_ty._1;
              [is_lending_coroutine_closure, closure_kind] = [false, ClosureArgs.kind(args.as_closure())];
              break;
            }
            case "CoroutineClosure": {
              const args = def_ty._1.as_coroutine_closure();
              [is_lending_coroutine_closure, closure_kind] = [
                !CoroutineClosureArgs.tupled_upvars_ty(args).is_ty_var() && CoroutineClosureArgs.has_self_borrows(args),
                CoroutineClosureArgs.kind(args),
              ];
              break;
            }
            default: {
              // Can't have BrEnv in functions, constants or coroutines.
              return bug("BrEnv outside of closure.");
            }
          }
          const expr_kind = tcx.hir_expect_expr(this.mir_hir_id()).kind;
          if (expr_kind.$ !== "Closure") {
            return bug("Closure is not defined by a closure expr");
          }
          const { fn_decl_span } = expr_kind._0;
          const region_name = this.synthesize_region_name();
          let closure_trait: string;
          if (!is_lending_coroutine_closure) {
            closure_trait = ClosureKind.as_str(closure_kind);
          } else if (closure_kind === "Fn") {
            closure_trait = "AsyncFn";
          } else if (closure_kind === "FnMut") {
            closure_trait = "AsyncFnMut";
          } else {
            closure_trait = "AsyncFnOnce";
          }

          return new RegionName(region_name, { $: "SynthesizedFreeEnvRegion", _0: fn_decl_span, _1: closure_trait });
        }

        case "Anon":
          return undefined;
        case "NamedAnon":
          return bug("only used for pretty printing");
      }
      break;
    }

    case "ReBound":
    case "ReVar":
    case "RePlaceholder":
    case "ReErased":
    case "ReError":
      return undefined;
  }
};

/// For closure/coroutine upvar regions, attempts to find a named lifetime
/// from the parent function's signature that corresponds to the anonymous
/// region `fr`. This handles cases where a parent function's named lifetime
/// (like `'a`) appears in a captured variable's type but gets assigned a
/// separate `RegionVid` without an `external_name` during region renumbering.
///
/// Works by getting the parent function's parameter type (with real named
/// lifetimes via `liberate_late_bound_regions`), then structurally walking
/// both the parent's parameter type and the closure's upvar type to find
/// where `fr` appears and what named lifetime is at the same position.
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:390 give_name_if_we_can_match_upvar_args
MirBorrowckCtxt.prototype.give_name_if_we_can_match_upvar_args = function (this: MirBorrowckCtxt, fr: RegionVid, upvar_index: number): RegionName | undefined {
  const tcx = this.infcx.tcx;
  const defining_ty = this.regioncx.universal_regions().defining_ty;

  let closure_def_id;
  switch (defining_ty.$) {
    case "Closure":
    case "Coroutine":
    case "CoroutineClosure":
      closure_def_id = defining_ty._0;
      break;
    default:
      return undefined;
  }

  const parent_def_id = tcx.parent(closure_def_id);

  // Only works if the parent is a function with a fn_sig.
  const parent_kind = tcx.def_kind(parent_def_id);
  if (!(parent_kind.$ === "Fn" || parent_kind.$ === "AssocFn")) {
    return undefined;
  }

  // Find which parameter index this upvar corresponds to by matching
  // the captured variable's HirId against the parent's parameter patterns.
  // This only matches simple bindings (not destructuring patterns) and
  // only when the upvar is a direct parameter (not a local variable).
  const captured_place = this.upvars[upvar_index];
  if (captured_place === undefined) return undefined;
  const upvar_hir_id = captured_place.get_root_variable();
  const parent_local_def_id = parent_def_id.as_local();
  if (parent_local_def_id === undefined) return undefined;
  const parent_body = tcx.hir_body_owned_by(parent_local_def_id);
  const param_index = parent_body.params.findIndex((param) => HirId_eq(param.pat.hir_id, upvar_hir_id));
  if (param_index === -1) return undefined;

  // Get the parent fn's signature with liberated late-bound regions,
  // so we have `ReLateParam` instead of `ReBound`.
  const parent_fn_sig: PolyFnSig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(parent_def_id) as EarlyBinder<PolyFnSig>));
  const liberated_sig = tcx.liberate_late_bound_regions(parent_def_id, parent_fn_sig, fold_FnSig);
  const parent_param_ty = FnSig.inputs(liberated_sig)[param_index];
  if (parent_param_ty === undefined) return undefined;

  // Get the upvar's NLL type (with ReVar regions from renumbering).
  const upvar_nll_ty = universal_regions().DefiningTy.upvar_tys(defining_ty)[upvar_index];
  if (upvar_nll_ty === undefined) return undefined;

  // debug!("give_name_if_we_can_match_upvar_args: parent_param_ty={:?}, upvar_nll_ty={:?}", parent_param_ty, upvar_nll_ty);

  // Collect free regions from both types in structural order.
  // This only works when both types have the same structure, i.e.
  // the upvar captures the whole variable, not a partial place like
  // `x.field`. Bail out if the region counts differ, since that means
  // the types diverged and positional correspondence is unreliable.
  const parent_regions: Region[] = [];
  tcx.for_each_free_region(parent_param_ty, (r) => parent_regions.push(r), fold_Ty);

  const nll_regions: Region[] = [];
  tcx.for_each_free_region(upvar_nll_ty, (r) => nll_regions.push(r), fold_Ty);

  if (parent_regions.length !== nll_regions.length) {
    // debug!("give_name_if_we_can_match_upvar_args: region count mismatch ({} vs {})", ...);
    return undefined;
  }

  for (let i = 0; i < parent_regions.length; i++) {
    const parent_r = parent_regions[i]!;
    const nll_r = nll_regions[i]!;
    if (nll_r.as_var() === fr) {
      const k = parent_r.kind();
      switch (k.$) {
        case "ReLateParam": {
          const late_param = k._0;
          const name = LateParamRegionKind.get_name(late_param.kind, tcx);
          if (name !== undefined) {
            const id = LateParamRegionKind.get_id(late_param.kind);
            const span = (id !== undefined ? tcx.hir_span_if_local(id) : undefined) ?? DUMMY_SP;
            return new RegionName(name, { $: "NamedLateParamRegion", _0: span });
          }
          break;
        }
        case "ReEarlyParam": {
          const ebr = k._0;
          if (EarlyParamRegion.is_named(ebr)) {
            const def_id = (tcx.generics_of(parent_def_id) as Generics).region_param(ebr, tcx).def_id;
            const span = tcx.hir_span_if_local(def_id) ?? DUMMY_SP;
            return new RegionName(ebr.name, { $: "NamedEarlyParamRegion", _0: span });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return undefined;
};

/// Finds an argument that contains `fr` and label it with a fully
/// elaborated type, returning something like `'1`. Result looks
/// like:
///
/// ```text
///  | fn foo(x: &u32) { .. }
///           ------- fully elaborated type of `x` is `&'1 u32`
/// ```
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:501 give_name_if_anonymous_region_appears_in_arguments
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_arguments = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  const implicit_inputs = universal_regions().DefiningTy.implicit_inputs(this.regioncx.universal_regions().defining_ty);
  const user_arg_index = this.regioncx.get_user_arg_index_for_region(this.infcx.tcx, fr);
  if (user_arg_index === undefined) return undefined;

  const arg_ty = this.regioncx.universal_regions().unnormalized_input_tys[implicit_inputs + user_arg_index]!;
  const [, span] = this.regioncx.get_argument_name_and_span_for_region(this.body, this.local_names_(), user_arg_index);

  const arg_hir_ty = this.get_argument_hir_ty_for_highlighting(user_arg_index);
  const highlight =
    (arg_hir_ty !== undefined ? this.highlight_if_we_can_match_hir_ty(fr, arg_ty, arg_hir_ty) : undefined) ??
    (() => {
      // `highlight_if_we_cannot_match_hir_ty` needs to know the number we will give to
      // the anonymous region. If it succeeds, the `synthesize_region_name` call below
      // will increment the counter, "reserving" the number we just used.
      const counter = this.next_region_name;
      return this.highlight_if_we_cannot_match_hir_ty(fr, arg_ty, span, counter);
    })();

  return new RegionName(this.synthesize_region_name(), { $: "AnonRegionFromArgument", _0: highlight });
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:533 get_argument_hir_ty_for_highlighting
MirBorrowckCtxt.prototype.get_argument_hir_ty_for_highlighting = function (this: MirBorrowckCtxt, user_arg_index: number): hir.Ty | undefined {
  const fn_decl = this.infcx.tcx.hir_fn_decl_by_hir_id(this.mir_hir_id());
  if (fn_decl === undefined) return undefined;
  // Closures don't have implicit self arguments in HIR, so use `user_arg_index` directly.
  const argument_hir_ty: hir.Ty | undefined = fn_decl.inputs[user_arg_index];
  if (argument_hir_ty === undefined) return undefined;
  switch (argument_hir_ty.kind.$) {
    // This indicates a variable with no type annotation, like
    // `|x|`... in that case, we can't highlight the type but
    // must highlight the variable.
    // NOTE(eddyb) this is handled in/by the sole caller
    // (`give_name_if_anonymous_region_appears_in_arguments`).
    case "Infer":
      return undefined;

    default:
      return argument_hir_ty;
  }
};

/// Attempts to highlight the specific part of a type in an argument
/// that has no type annotation.
/// For example, we might produce an annotation like this:
///
/// ```text
///  |     foo(|a, b| b)
///  |          -  -
///  |          |  |
///  |          |  has type `&'1 u32`
///  |          has type `&'2 u32`
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:563 highlight_if_we_cannot_match_hir_ty
MirBorrowckCtxt.prototype.highlight_if_we_cannot_match_hir_ty = function (
  this: MirBorrowckCtxt,
  needle_fr: RegionVid,
  ty: Ty,
  span: Span,
  counter: number,
): RegionNameHighlight {
  const highlight = RegionHighlightMode.default();
  highlight.highlighting_region_vid(this.infcx.tcx, needle_fr, counter);
  const type_name = this.infcx.err_ctxt().extract_inference_diagnostics_data(ty, highlight).name;

  // debug!("highlight_if_we_cannot_match_hir_ty: type_name={:?} needle_fr={:?}", type_name, needle_fr);
  if (type_name.includes(`'${counter}`)) {
    // Only add a label if we can confirm that a region was labelled.
    return { $: "CannotMatchHirTy", _0: span, _1: Symbol.intern(type_name) };
  } else {
    return { $: "Occluded", _0: span, _1: Symbol.intern(type_name) };
  }
};

/// Attempts to highlight the specific part of a type annotation
/// that contains the anonymous reference we want to give a name
/// to. For example, we might produce an annotation like this:
///
/// ```text
///  | fn a<T>(items: &[T]) -> Box<dyn Iterator<Item = &T>> {
///  |                - let's call the lifetime of this reference `'1`
/// ```
///
/// the way this works is that we match up `ty`, which is
/// a `Ty<'tcx>` (the internal form of the type) with
/// `hir_ty`, a `hir::Ty` (the syntax of the type
/// annotation). We are descending through the types stepwise,
/// looking in to find the region `needle_fr` in the internal
/// type. Once we find that, we can use the span of the `hir::Ty`
/// to add the highlight.
///
/// This is a somewhat imperfect process, so along the way we also
/// keep track of the **closest** type we've found. If we fail to
/// find the exact `&` or `'_` to highlight, then we may fall back
/// to highlighting that closest type instead.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:608 highlight_if_we_can_match_hir_ty
MirBorrowckCtxt.prototype.highlight_if_we_can_match_hir_ty = function (
  this: MirBorrowckCtxt,
  needle_fr: RegionVid,
  ty: Ty,
  hir_ty: hir.Ty,
): RegionNameHighlight | undefined {
  const search_stack: [Ty, hir.Ty][] = [[ty, hir_ty]];

  for (let top = search_stack.pop(); top !== undefined; top = search_stack.pop()) {
    const [ty, hir_ty] = top;
    const tk = ty.kind();
    const hk = hir_ty.kind;
    // Check if the `ty` is `&'X ..` where `'X`
    // is the region we are looking for -- if so, and we have a `&T`
    // on the RHS, then we want to highlight the `&` like so:
    //
    //     &
    //     - let's call the lifetime of this reference `'1`
    if (tk.$ === "Ref" && hk.$ === "Ref") {
      const [region, referent_ty] = [tk._0, tk._1];
      const referent_hir_ty = hk._1;
      if (region.as_var() === needle_fr) {
        // Just grab the first character, the `&`.
        const source_map = this.infcx.tcx.sess.source_map();
        const ampersand_span = source_map.start_point(hir_ty.span);

        return { $: "MatchedHirTy", _0: ampersand_span };
      }

      // Otherwise, let's descend into the referent types.
      search_stack.push([referent_ty, referent_hir_ty]);
    }

    // Match up something like `Foo<'1>`
    else if (tk.$ === "Adt" && hk.$ === "Path" && hk._0.$ === "Resolved" && hk._0._0 === undefined) {
      const args = tk._1;
      const path = hk._0._1;
      if (path.res.$ === "Def" && path.res._0.$ === "TyAlias") {
        // Type parameters of the type alias have no reason to
        // be the same as those of the ADT.
        // FIXME: We should be able to do something similar to
        // match_adt_and_segment in this case.
      } else {
        const last_segment = path.segments[path.segments.length - 1];
        if (last_segment !== undefined) {
          const highlight = this.match_adt_and_segment(args, needle_fr, last_segment, search_stack);
          if (highlight !== undefined) {
            return highlight;
          }
        }
      }
    }

    // The following cases don't have lifetimes, so we
    // just worry about trying to match up the rustc type
    // with the HIR types:
    else if (tk.$ === "Tuple" && hk.$ === "Tup") {
      const elem_tys = tk._0;
      const elem_hir_tys = hk._0;
      for (let i = 0; i < Math.min(elem_tys.length, elem_hir_tys.length); i++) {
        search_stack.push([elem_tys[i]!, elem_hir_tys[i]!]);
      }
    } else if ((tk.$ === "Slice" && hk.$ === "Slice") || (tk.$ === "Array" && hk.$ === "Array")) {
      search_stack.push([tk._0, hk._0]);
    } else if (tk.$ === "RawPtr" && hk.$ === "Ptr") {
      search_stack.push([tk._0, hk._0]);
    } else {
      // FIXME there are other cases that we could trace
    }
  }

  return undefined;
};

/// We've found an enum/struct/union type with the generic args
/// `args` and -- in the HIR -- a path type with the final
/// segment `last_segment`. Try to find a `'_` to highlight in
/// the generic args (or, if not, to produce new zipped pairs of
/// types+hir to search through).
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:693 match_adt_and_segment
MirBorrowckCtxt.prototype.match_adt_and_segment = function (
  this: MirBorrowckCtxt,
  args: GenericArgsRef,
  needle_fr: RegionVid,
  last_segment: hir.PathSegment,
  search_stack: [Ty, hir.Ty][],
): RegionNameHighlight | undefined {
  // Did the user give explicit arguments? (e.g., `Foo<..>`)
  const explicit_args = last_segment.args;
  if (explicit_args === undefined) return undefined;
  const lifetime = this.try_match_adt_and_generic_args(args, needle_fr, explicit_args, search_stack);
  if (lifetime === undefined) return undefined;
  if (lifetime.is_anonymous()) {
    return undefined;
  } else {
    return { $: "MatchedAdtAndSegment", _0: lifetime.ident.span };
  }
};

/// We've found an enum/struct/union type with the generic args
/// `args` and -- in the HIR -- a path with the generic
/// arguments `hir_args`. If `needle_fr` appears in the args, return
/// the `hir::Lifetime` that corresponds to it. If not, push onto
/// `search_stack` the types+hir to search through.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:716 try_match_adt_and_generic_args
MirBorrowckCtxt.prototype.try_match_adt_and_generic_args = function (
  this: MirBorrowckCtxt,
  args: GenericArgsRef,
  needle_fr: RegionVid,
  hir_args: hir.GenericArgs,
  search_stack: [Ty, hir.Ty][],
): hir.Lifetime | undefined {
  for (let i = 0; i < Math.min(args.length, hir_args.args.length); i++) {
    const arg = args[i]!;
    const hir_arg = hir_args.args[i]!;
    const ak = GenericArg.kind(arg);
    if (ak.$ === "Lifetime" && hir_arg.$ === "Lifetime") {
      const r = ak._0;
      if (r.as_var() === needle_fr) {
        return hir_arg._0;
      }
    } else if (ak.$ === "Type" && hir_arg.$ === "Type") {
      search_stack.push([ak._0, hir_arg._0.as_unambig_ty()]);
    } else if (ak.$ === "Const" && hir_arg.$ === "Const") {
      // Lifetimes cannot be found in consts, so we don't need
      // to search anything here.
    } else {
      this.dcx().span_delayed_bug(
        hir.GenericArg.span(hir_arg),
        `unmatched arg and hir arg: found ${format_debug_GenericArg(arg)} vs ${format_debug_hir_GenericArg(hir_arg)}`,
      );
    }
  }

  return undefined;
};

/// Finds a closure upvar that contains `fr` and label it with a
/// fully elaborated type, returning something like `'1`. Result
/// looks like:
///
/// ```text
///  | let x = Some(&22);
///        - fully elaborated type of `x` is `Option<&'1 u32>`
/// ```
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:766 give_name_if_anonymous_region_appears_in_upvars
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_upvars = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  const upvar_index = this.regioncx.get_upvar_index_for_region(this.infcx.tcx, fr);
  if (upvar_index === undefined) return undefined;

  // Before synthesizing an anonymous name like `'1`, try to find a
  // named lifetime from the parent function's signature that matches.
  const region_name_ = this.give_name_if_we_can_match_upvar_args(fr, upvar_index);
  if (region_name_ !== undefined) {
    return region_name_;
  }

  const [upvar_name, upvar_span] = this.regioncx.get_upvar_name_and_span_for_region(this.infcx.tcx, this.upvars, upvar_index);
  const region_name = this.synthesize_region_name();

  return new RegionName(region_name, { $: "AnonRegionFromUpvar", _0: upvar_span, _1: upvar_name });
};

/// Checks for arguments appearing in the (closure) return type. It
/// must be a closure since, in a free fn, such an argument would
/// have to either also appear in an argument (if using elision)
/// or be early bound (named, not in argument).
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:793 give_name_if_anonymous_region_appears_in_output
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_output = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  const tcx = this.infcx.tcx;

  let return_ty = this.regioncx.universal_regions().unnormalized_output_ty;
  // debug!("give_name_if_anonymous_region_appears_in_output: return_ty = {:?}", return_ty);
  if (!tcx.any_free_region_meets(return_ty, (r) => r.as_var() === fr, fold_Ty)) {
    return undefined;
  }

  const rk = return_ty.kind();
  if (rk.$ === "Coroutine") {
    // When the return type is identified to be `{async closure body}`, we instead care
    // about the actual return type of that coroutine.
    return_ty = CoroutineArgs.return_ty(rk._1.as_coroutine());
  }

  const mir_hir_id = this.mir_hir_id();

  let return_span: Span;
  let mir_description: string;
  let hir_ty: hir.Ty | undefined;
  const node = tcx.hir_node(mir_hir_id);
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const { fn_decl, kind, fn_decl_span } = node._0.kind._0;
    let span: Span;
    switch (fn_decl.output.$) {
      case "DefaultReturn":
        [span, hir_ty] = [tcx.sess.source_map().end_point(fn_decl_span), undefined];
        break;
      case "Return":
        [span, hir_ty] = [hir.FnRetTy.span(fn_decl.output), fn_decl.output._0];
        break;
    }
    const parent_fn_output = (what: string): hir.FnRetTy => {
      const parent_item = tcx.hir_node_by_def_id(tcx.hir_get_parent_item(mir_hir_id).def_id);
      return unwrap(hir.Node.fn_decl(parent_item), `coroutine lowered from ${what} should be in fn`).output;
    };
    if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Async" && kind._0._1 === "Block") {
      mir_description = " of async block";
    } else if (
      (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Async" && kind._0._1 === "Closure") ||
      (kind.$ === "CoroutineClosure" && kind._0 === "Async")
    ) {
      mir_description = " of async closure";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Async" && kind._0._1 === "Fn") {
      const output = parent_fn_output("async fn");
      span = hir.FnRetTy.span(output);
      if (output.$ === "Return") {
        hir_ty = this.get_future_inner_return_ty(output._0);
      }
      mir_description = " of async function";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Gen" && kind._0._1 === "Block") {
      mir_description = " of gen block";
    } else if (
      (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Gen" && kind._0._1 === "Closure") ||
      (kind.$ === "CoroutineClosure" && kind._0 === "Gen")
    ) {
      mir_description = " of gen closure";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Gen" && kind._0._1 === "Fn") {
      const output = parent_fn_output("gen fn");
      span = hir.FnRetTy.span(output);
      mir_description = " of gen function";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "AsyncGen" && kind._0._1 === "Block") {
      mir_description = " of async gen block";
    } else if (
      (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "AsyncGen" && kind._0._1 === "Closure") ||
      (kind.$ === "CoroutineClosure" && kind._0 === "AsyncGen")
    ) {
      mir_description = " of async gen closure";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "AsyncGen" && kind._0._1 === "Fn") {
      const output = parent_fn_output("async gen fn");
      span = hir.FnRetTy.span(output);
      mir_description = " of async gen function";
    } else if (kind.$ === "Coroutine" && kind._0.$ === "Coroutine") {
      mir_description = " of coroutine";
    } else {
      // hir::ClosureKind::Closure
      mir_description = " of closure";
    }
    [return_span, hir_ty] = [span, hir_ty];
  } else {
    const fn_decl = hir.Node.fn_decl(node);
    if (fn_decl !== undefined) {
      const hir_ty_ = fn_decl.output.$ === "Return" ? fn_decl.output._0 : undefined;
      [return_span, mir_description, hir_ty] = [hir.FnRetTy.span(fn_decl.output), "", hir_ty_];
    } else {
      [return_span, mir_description, hir_ty] = [this.body.span, "", undefined];
    }
  }

  const return_ty_ = return_ty;
  const highlight =
    (hir_ty !== undefined ? this.highlight_if_we_can_match_hir_ty(fr, return_ty_, hir_ty) : undefined) ??
    (() => {
      // `highlight_if_we_cannot_match_hir_ty` needs to know the number we will give to
      // the anonymous region. If it succeeds, the `synthesize_region_name` call below
      // will increment the counter, "reserving" the number we just used.
      const counter = this.next_region_name;
      return this.highlight_if_we_cannot_match_hir_ty(fr, return_ty_, return_span, counter);
    })();

  return new RegionName(this.synthesize_region_name(), { $: "AnonRegionFromOutput", _0: highlight, _1: mir_description });
};

/// From the [`hir::Ty`] of an async function's lowered return type,
/// retrieve the `hir::Ty` representing the type the user originally wrote.
///
/// e.g. given the function:
///
/// ```
/// async fn foo() -> i32 { 2 }
/// ```
///
/// this function, given the lowered return type of `foo`, an [`OpaqueDef`] that implements
/// `Future<Output=i32>`, returns the `i32`.
///
/// [`OpaqueDef`]: hir::TyKind::OpaqueDef
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:954 get_future_inner_return_ty
MirBorrowckCtxt.prototype.get_future_inner_return_ty = function (this: MirBorrowckCtxt, hir_ty: hir.Ty): hir.Ty {
  if (hir_ty.kind.$ !== "OpaqueDef") {
    return span_bug(hir_ty.span, `lowered return type of async fn is not OpaqueDef: ${format_debug_hir_Ty(hir_ty)}`);
  }
  const opaque_ty = hir_ty.kind._0;
  if (opaque_ty.bounds.length === 1 && opaque_ty.bounds[0]!.$ === "Trait") {
    const trait_ref = opaque_ty.bounds[0]!._0;
    const segments = trait_ref.trait_ref.path.segments;
    const segment = segments[segments.length - 1];
    const args = segment?.args;
    if (args !== undefined && args.constraints.length === 1) {
      const constraint = args.constraints[0]!;
      if (constraint.ident.name === sym.Output) {
        const ty = constraint.ty();
        if (ty !== undefined) {
          return ty;
        }
      }
    }
  }
  return span_bug(hir_ty.span, `bounds from lowered return type of async fn did not match expected format: ${format_debug_hir_OpaqueTy(opaque_ty)}`);
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:979 give_name_if_anonymous_region_appears_in_yield_ty
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_yield_ty = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  // Note: coroutines from `async fn` yield `()`, so we don't have to
  // worry about them here.
  const yield_ty = this.regioncx.universal_regions().yield_ty;
  if (yield_ty === undefined) return undefined;
  // debug!("give_name_if_anonymous_region_appears_in_yield_ty: yield_ty = {:?}", yield_ty);

  const tcx = this.infcx.tcx;

  if (!tcx.any_free_region_meets(yield_ty, (r) => r.as_var() === fr, fold_Ty)) {
    return undefined;
  }

  const highlight = RegionHighlightMode.default();
  highlight.highlighting_region_vid(tcx, fr, this.next_region_name);
  const type_name = this.infcx.err_ctxt().extract_inference_diagnostics_data(yield_ty, highlight).name;

  const node = tcx.hir_node(this.mir_hir_id());
  let yield_span: Span;
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const { fn_decl_span } = node._0.kind._0;
    yield_span = tcx.sess.source_map().end_point(fn_decl_span);
  } else {
    yield_span = this.body.span;
  }

  // debug!("give_name_if_anonymous_region_appears_in_yield_ty: type_name = {:?}, yield_span = {:?}", yield_span, type_name);

  return new RegionName(this.synthesize_region_name(), { $: "AnonRegionFromYieldTy", _0: yield_span, _1: Symbol.intern(type_name) });
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1022 give_name_if_anonymous_region_appears_in_impl_signature
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_impl_signature = function (this: MirBorrowckCtxt, fr: RegionVid): RegionName | undefined {
  const error_region = this.regioncx.to_error_region(fr);
  if (error_region === undefined) return undefined;
  const ek = error_region.kind();
  if (ek.$ !== "ReEarlyParam") {
    return undefined;
  }
  const region = ek._0;
  if (EarlyParamRegion.is_named(region)) {
    return undefined;
  }

  const tcx = this.infcx.tcx;
  const region_def = (tcx.generics_of(this.mir_def_id()) as Generics).region_param(region, tcx).def_id;
  const region_parent = tcx.parent(region_def);
  if (tcx.def_kind(region_parent).$ !== "Impl") {
    return undefined;
  }

  const found = tcx.any_free_region_meets(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(region_parent) as EarlyBinder<Ty>)),
    (r) => is_re_early_param(r, region),
    fold_Ty,
  );

  return new RegionName(this.synthesize_region_name(), {
    $: "AnonRegionFromImplSignature",
    _0: tcx.def_span(region_def),
    // FIXME(compiler-errors): Does this ever actually show up
    // anywhere other than the self type? I couldn't create an
    // example of a `'_` in the impl's trait being referenceable.
    _1: found ? "self type" : "header",
  });
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1057 give_name_if_anonymous_region_appears_in_arg_position_impl_trait
MirBorrowckCtxt.prototype.give_name_if_anonymous_region_appears_in_arg_position_impl_trait = function (
  this: MirBorrowckCtxt,
  fr: RegionVid,
): RegionName | undefined {
  const error_region = this.regioncx.to_error_region(fr);
  if (error_region === undefined) return undefined;
  const ek = error_region.kind();
  if (ek.$ !== "ReEarlyParam") {
    return undefined;
  }
  const region = ek._0;
  if (EarlyParamRegion.is_named(region)) {
    return undefined;
  }

  const clauses: Clause[] = GenericClauses.instantiate_identity(this.infcx.tcx.clauses_of(this.body.source.def_id()) as GenericClauses, this.infcx.tcx).clauses.map(
    (c) => Unnormalized.skip_norm_wip(c),
  );

  const upvar_index = universal_regions()
    .DefiningTy.upvar_tys(this.regioncx.universal_regions().defining_ty)
    .findIndex((ty) => this.any_param_clause_mentions(clauses, ty, region));
  if (upvar_index !== -1) {
    const [upvar_name, upvar_span] = this.regioncx.get_upvar_name_and_span_for_region(this.infcx.tcx, this.upvars, upvar_index);
    const region_name = this.synthesize_region_name();

    return new RegionName(region_name, { $: "AnonRegionFromUpvar", _0: upvar_span, _1: upvar_name });
  }
  const arg_index = this.regioncx.universal_regions().unnormalized_input_tys.findIndex((ty) => this.any_param_clause_mentions(clauses, ty, region));
  if (arg_index !== -1) {
    const [arg_name, arg_span] = this.regioncx.get_argument_name_and_span_for_region(this.body, this.local_names_(), arg_index);
    const region_name = this.synthesize_region_name();

    if (arg_name === undefined) return undefined;
    return new RegionName(region_name, { $: "AnonRegionFromArgument", _0: { $: "CannotMatchHirTy", _0: arg_span, _1: arg_name } });
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_name.rs:1122 any_param_clause_mentions
MirBorrowckCtxt.prototype.any_param_clause_mentions = function (this: MirBorrowckCtxt, clauses: readonly Clause[], ty: Ty, region: EarlyParamRegion): boolean {
  const tcx = this.infcx.tcx;
  for (const arg of ty.walk()) {
    const ak = GenericArg.kind(arg);
    if (ak.$ === "Type" && ak._0.kind().$ === "Param") {
      const ty = ak._0;
      const found = clauses.some((pred) => {
        const pk = Binder.skip_binder(pred.kind());
        if (pk.$ === "Trait" && TraitClause.self_ty(pk._0) === ty) {
          // {}
        } else if (pk.$ === "Projection" && AliasTerm.self_ty(pk._0.projection_term) === ty) {
          // {}
        } else {
          return false;
        }
        return tcx.any_free_region_meets(pred, (r) => is_re_early_param(r, region), fold_Clause);
      });
      if (found) return true;
    }
  }
  return false;
};

/** PORT: `r.kind() == ty::ReEarlyParam(region)` (the derived `PartialEq` of `EarlyParamRegion`: `index`, then `name`). */
function is_re_early_param(r: Region, region: EarlyParamRegion): boolean {
  const k = r.kind();
  return k.$ === "ReEarlyParam" && k._0.index === region.index && k._0.name === region.name;
}

/** PORT: `{:?}` of a `GenericArg` / `hir::GenericArg` / `hir::Ty` / `hir::OpaqueTy` (only in `span_delayed_bug` / `span_bug` texts). */
function format_debug_GenericArg(arg: GenericArg): string {
  return format_debug(arg, debug_GenericArg, PLAIN);
}
function format_debug_hir_GenericArg(arg: hir.GenericArg): string {
  return format_debug(arg, hir_gen.debug_GenericArg, PLAIN);
}
function format_debug_hir_Ty(ty: hir.Ty): string {
  return format_debug(ty, (x, f) => hir_gen.debug_Ty(x, f, () => "()"), PLAIN);
}
function format_debug_hir_OpaqueTy(ty: hir.OpaqueTy): string {
  return format_debug(ty, hir_gen.debug_OpaqueTy, PLAIN);
}
