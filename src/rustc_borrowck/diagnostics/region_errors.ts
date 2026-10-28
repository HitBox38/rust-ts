// Port of compiler/rustc_borrowck/src/diagnostics/region_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-e, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Error reporting machinery for lifetime errors.
// PORT: `RegionErrors::push(&mut self, val: impl Into<RegionErrorKind>)`: the only `Into` used is the identity, so `val` is a
// `RegionErrorKind`. `into_iter` returns an `Iterable`. `name_regions<T: TypeFoldable>` takes the fold impl `d_T` last.
// `Diag<'diag>` / `Diag<'_>` are rustc_errors `Diag` (the lifetimes are erased).
// PORT: `suggest_constrain_dyn_trait_in_impl`'s `found_dids: &FxIndexSet<DefId>` is a `DefIdSet` (insertion-ordered, the
// set `TraitObjectVisitor` fills). `category: &ConstraintCategory` of `maybe_suggest_constrain_dyn_trait_impl` is the value.
// Init order: universal_regions.ts / borrowck_errors.ts / bound_region_errors.ts / mod.ts are hand modules; they are
// required lazily (`universal_regions()`, ...; mod.ts for `LIMITATION_NOTE`), the rest of the runtime imports are `.gen.ts`
// modules and other crates.
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import type { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import { display_GenericKind, GenericKind } from "../../rustc_infer/infer/region_constraints/mod.ts";
import { fold_with_GenericKind, try_fold_with_GenericKind, visit_with_GenericKind } from "../../rustc_infer/infer/region_constraints/mod.gen.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { ConstraintCategory, ReturnConstraint } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/decls.ts";
import { Predicate_upcast_from_Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_GenericArg, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Ident, type Ident, kw, Symbol } from "../../rustc_span/symbol.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import {
  find_param_with_region,
} from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/util.ts";
import { find_anon_type } from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/find_anon_type.ts";
import { suggest_adding_lifetime_params } from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/different_lifetimes.ts";
import { NiceRegionError } from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/mod.ts";
import {
  HirTraitObjectVisitor,
  suggest_new_region_bound,
  TraitObjectVisitor,
} from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/static_impl_trait.ts";
import { Binder, BoundRegionKind, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { fold_regions } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { debug_RegionVid, type RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { FnSig, FnSigKind, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_list, type Debug, debug_tuple, format_debug, PLAIN } from "../../std/fmt.ts";
import { assert_eq, panic, unwrap } from "../../std/panic.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import type { ConstraintDescription } from "../nll.ts";
import { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import { OutlivesSuggestionBuilder } from "./outlives_suggestion.gen.ts";
import { debug_RegionErrorKind, type ErrorConstraintInfo, type RegionErrorKind, RegionErrors } from "./region_errors.gen.ts";
import { RegionName } from "./region_name.gen.ts";
import { debug_ErrorGuaranteed, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import {
  FnMutError_diagnostic,
  type FnMutReturnTypeErr,
  GenericDoesNotLiveLongEnough_diagnostic,
  LifetimeOutliveErr_diagnostic,
  type LifetimeReturnCategoryErr,
  LifetimeReturnCategoryErr_subdiagnostic,
  RequireStaticErr_subdiagnostic,
  VarHereDenote_subdiagnostic,
} from "../session_diagnostics.gen.ts";

export * from "./region_errors.gen.ts";

// PORT (init order, module header): lazily required hand modules.
function universal_regions(): typeof import("../universal_regions.ts") {
  return (universal_regions__m ??= require("../universal_regions.ts") as typeof import("../universal_regions.ts"));
}
var universal_regions__m: typeof import("../universal_regions.ts") | undefined;
function borrowck_errors(): typeof import("../borrowck_errors.ts") {
  return (borrowck_errors__m ??= require("../borrowck_errors.ts") as typeof import("../borrowck_errors.ts"));
}
var borrowck_errors__m: typeof import("../borrowck_errors.ts") | undefined;
function bound_region_errors(): typeof import("./bound_region_errors.ts") {
  return (bound_region_errors__m ??= require("./bound_region_errors.ts") as typeof import("./bound_region_errors.ts"));
}
var bound_region_errors__m: typeof import("./bound_region_errors.ts") | undefined;
function diagnostics_mod(): typeof import("./mod.ts") {
  return (diagnostics_mod__m ??= require("./mod.ts") as typeof import("./mod.ts"));
}
var diagnostics_mod__m: typeof import("./mod.ts") | undefined;

declare module "./region_errors.gen.ts" {
  interface RegionErrors {
    // region_errors.rs:82
    push(val: RegionErrorKind): void;
    // region_errors.rs:87
    is_empty(): boolean;
    // region_errors.rs:90
    into_iter(): Iterable<[RegionErrorKind, ErrorGuaranteed]>;
  }
  namespace RegionErrors {
    // region_errors.rs:78
    function new_(tcx: TyCtxt): RegionErrors;
    export { new_ as new };
  }
}

declare module "../region_infer/region_context.gen.ts" {
  interface RegionInferenceContext {
    // region_errors.rs:145
    to_error_region(r: RegionVid): Region | undefined;
    // region_errors.rs:151
    to_error_region_vid(r: RegionVid): RegionVid | undefined;
    // region_errors.rs:168
    name_regions<T>(tcx: TyCtxt, ty: T, d_T: TypeFoldable<T>): T;
    // region_errors.rs:179
    is_closure_fn_mut(fr: RegionVid): boolean;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // region_errors.rs:196
    suggest_static_lifetime_for_gat_from_hrtb(diag: Diag, lower_bound: RegionVid): void;
    // region_errors.rs:306
    report_region_errors(nll_errors: RegionErrors): void;
    // region_errors.rs:424
    explain_impl_static_obligation(diag: Diag, ty: Ty, outlived_fr: RegionVid): void;
    // region_errors.rs:556
    report_erroneous_rvid_reaches_placeholder(longer_fr: RegionVid, error_vid: RegionVid): void;
    // region_errors.rs:599
    report_region_error(fr: RegionVid, fr_origin: NllRegionVariableOrigin, outlived_fr: RegionVid, outlives_suggestion: OutlivesSuggestionBuilder): void;
    // region_errors.rs:762
    report_fnmut_error(errci: ErrorConstraintInfo, kind: ReturnConstraint): Diag;
    // region_errors.rs:835
    report_escaping_data_error(errci: ErrorConstraintInfo): Diag;
    // region_errors.rs:944
    report_general_error(errci: ErrorConstraintInfo): Diag;
    // region_errors.rs:1001
    add_static_impl_trait_suggestion(diag: Diag, fr: RegionVid, fr_name: RegionName, outlived_fr: RegionVid): void;
    // region_errors.rs:1091
    maybe_suggest_constrain_dyn_trait_impl(diag: Diag, f: Region, o: Region, category: ConstraintCategory): void;
    // region_errors.rs:1143
    suggest_constrain_dyn_trait_in_impl(err: Diag, found_dids: DefIdSet, ident: Ident, self_ty: hir.Ty): boolean;
    // region_errors.rs:1180
    suggest_adding_lifetime_params(diag: Diag, sub: RegionVid, sup: RegionVid): void;
    // region_errors.rs:1218
    suggest_deref_closure_return(diag: Diag): void;
    // region_errors.rs:1349
    suggest_move_on_borrowing_closure(diag: Diag): void;
  }
}

// impl<'tcx> ConstraintDescription for ConstraintCategory<'tcx>
export const ConstraintDescription_ConstraintCategory: ConstraintDescription<ConstraintCategory> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:42 description
  description(self: ConstraintCategory): string {
    // Must end with a space. Allows for empty names to be provided.
    switch (self.$) {
      case "Assignment":
        return "assignment ";
      case "Return":
        return "returning this value ";
      case "Yield":
        return "yielding this value ";
      case "UseAsConst":
        return "using this value as a constant ";
      case "UseAsStatic":
        return "using this value as a static ";
      case "Cast":
        return self.is_implicit_coercion ? "coercion " : "cast ";
      case "CallArgument":
        return "argument ";
      case "TypeAnnotation":
        return self._0 === "GenericArg" ? "generic argument " : "type annotation ";
      case "SizedBound":
        return "proving this value is `Sized` ";
      case "CopyBound":
        return "copying this value ";
      case "OpaqueType":
        return "opaque type ";
      case "ClosureUpvar":
        return "closure capture ";
      case "Usage":
        return "this usage ";
      case "SolverRegionConstraint":
      case "Predicate":
      case "Boring":
      case "BoringNoLocation":
      case "Internal":
      case "OutlivesUnnameablePlaceholder":
        return "";
    }
  },
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:78 new
(RegionErrors as unknown as { new: typeof RegionErrors.new }).new = function (tcx: TyCtxt): RegionErrors {
  return new RegionErrors([], tcx);
};

// #[track_caller]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:82 push
RegionErrors.prototype.push = function (this: RegionErrors, val: RegionErrorKind): void {
  const guar = this._1.sess.dcx().delayed_bug(format_debug(val, debug_RegionErrorKind, PLAIN));
  this._0.push([val, guar]);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:87 is_empty
RegionErrors.prototype.is_empty = function (this: RegionErrors): boolean {
  return this._0.length === 0;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:90 into_iter
RegionErrors.prototype.into_iter = function (this: RegionErrors): Iterable<[RegionErrorKind, ErrorGuaranteed]> {
  return this._0;
};

// impl std::fmt::Debug for RegionErrors<'_>
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:98 fmt
export const debug_RegionErrors: Debug<RegionErrors> = (v, f) =>
  debug_tuple(f, "RegionErrors", [
    debug_list(
      f,
      v._0.map(([kind, _guar]) => debug_tuple(f, "", [debug_RegionErrorKind(kind, f), debug_ErrorGuaranteed(_guar, f)])),
    ),
  ]);

/// Converts a region inference variable into a `ty::Region` that
/// we can use for error reporting. If `r` is universally bound,
/// then we use the name that we have on record for it. If `r` is
/// existentially bound, then we check its inferred value and try
/// to find a good name from that. Returns `None` if we can't find
/// one (e.g., this is just some random part of the CFG).
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:145 to_error_region
RegionInferenceContext.prototype.to_error_region = function (this: RegionInferenceContext, r: RegionVid): Region | undefined {
  const r_ = this.to_error_region_vid(r);
  return r_ !== undefined ? this.region_definition(r_).external_name : undefined;
};

/// Returns the `RegionVid` corresponding to the region returned by
/// `to_error_region`.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:151 to_error_region_vid
RegionInferenceContext.prototype.to_error_region_vid = function (this: RegionInferenceContext, r: RegionVid): RegionVid | undefined {
  if (this.universal_regions().is_universal_region(r)) {
    return r;
  } else {
    // We just want something nameable, even if it's not
    // actually an upper bound.
    const upper_bound = this.approx_universal_upper_bound(r);

    if (this.upper_bound_in_region_scc(r, upper_bound)) {
      return this.to_error_region_vid(upper_bound);
    } else {
      return undefined;
    }
  }
};

/// Map the regions in the type to named regions, where possible.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:168 name_regions
RegionInferenceContext.prototype.name_regions = function <T>(this: RegionInferenceContext, tcx: TyCtxt, ty: T, d_T: TypeFoldable<T>): T {
  return fold_regions(
    tcx,
    ty,
    (region, _) => {
      const k = region.kind();
      if (k.$ === "ReVar") {
        return this.to_error_region(k._0) ?? region;
      } else {
        return region;
      }
    },
    d_T,
  );
};

/// Returns `true` if a closure is inferred to be an `FnMut` closure.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:179 is_closure_fn_mut
RegionInferenceContext.prototype.is_closure_fn_mut = function (this: RegionInferenceContext, fr: RegionVid): boolean {
  const r = this.to_error_region(fr);
  if (r !== undefined) {
    const k = r.kind();
    const defining_ty = this.universal_regions().defining_ty;
    if (k.$ === "ReLateParam" && k._0.kind.$ === "ClosureEnv" && defining_ty.$ === "Closure") {
      const args = defining_ty._1;
      return ClosureArgs.kind(args.as_closure()) === "FnMut";
    }
  }

  return false;
};

// For generic associated types (GATs) which implied 'static requirement
// from higher-ranked trait bounds (HRTB). Try to locate span of the trait
// and the span which bounded to the trait for adding 'static lifetime suggestion
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:196 suggest_static_lifetime_for_gat_from_hrtb
MirBorrowckCtxt.prototype.suggest_static_lifetime_for_gat_from_hrtb = function (this: MirBorrowckCtxt, diag: Diag, lower_bound: RegionVid): void {
  const tcx = this.infcx.tcx;

  // find generic associated types in the given region 'lower_bound'
  const gat_id_and_generics: ([HirId, hir.Generics] | undefined)[] = [];
  for (const placeholder of this.regioncx.placeholders_contained_in(lower_bound)) {
    const id = BoundRegionKind.get_id(placeholder.bound.kind);
    const placeholder_id = id !== undefined ? id.as_local() : undefined;
    if (placeholder_id !== undefined) {
      const gat_hir_id = tcx.local_def_id_to_hir_id(placeholder_id);
      const generics_impl = hir.Node.generics(tcx.parent_hir_node(tcx.parent_hir_id(gat_hir_id)));
      if (generics_impl !== undefined) {
        gat_id_and_generics.push([gat_hir_id, generics_impl]);
        continue;
      }
    }
    gat_id_and_generics.push(undefined);
  }
  // debug!(?gat_id_and_generics);

  // Look for the where-bound which introduces the placeholder.
  // As we're using the HIR, we need to handle both `for<'a> T: Trait<'a>`
  // and `T: for<'a> Trait`<'a>.
  const hrtb_bounds: hir.GenericBound[] = [];
  for (const entry of gat_id_and_generics) {
    if (entry === undefined) continue;
    const [gat_hir_id, generics] = entry;
    // PORT: the `for_each` closure; its `return` ends the closure call for this entry.
    (() => {
      for (const pred of generics.predicates) {
        if (pred.kind.$ !== "BoundPredicate") {
          continue;
        }
        const { bound_generic_params, bounds } = pred.kind._0;
        if (find_last(bound_generic_params, (bgp) => HirId_eq(tcx.local_def_id_to_hir_id(bgp.def_id), gat_hir_id)) !== undefined) {
          for (const bound of bounds) {
            hrtb_bounds.push(bound);
          }
        } else {
          for (const bound of bounds) {
            if (bound.$ === "Trait") {
              const trait_bound = bound._0;
              if (find_last(trait_bound.bound_generic_params, (bgp) => HirId_eq(tcx.local_def_id_to_hir_id(bgp.def_id), gat_hir_id)) !== undefined) {
                hrtb_bounds.push(bound);
                return;
              }
            }
          }
        }
      }
    })();
  }
  // debug!(?hrtb_bounds);

  const suggestions: [Span, string][] = [];
  for (const bound of hrtb_bounds) {
    if (bound.$ !== "Trait") {
      continue;
    }
    const { trait_ref, span: trait_span } = bound._0;
    diag.span_note(trait_span, diagnostics_mod().LIMITATION_NOTE);
    const generics_fn = tcx.hir_get_generics(this.body.source.def_id().expect_local());
    if (generics_fn === undefined) {
      continue;
    }
    if (trait_ref.path.res.$ !== "Def") {
      continue;
    }
    const trait_res_defid = trait_ref.path.res._1;
    // debug!(?generics_fn);
    for (const predicate of generics_fn.predicates) {
      if (predicate.kind.$ !== "BoundPredicate") {
        continue;
      }
      const { bounded_ty, bounds } = predicate.kind._0;
      for (const bd of bounds) {
        if (bd.$ !== "Trait") continue;
        const tr_ref = bd._0.trait_ref;
        if (tr_ref.path.res.$ !== "Def") continue;
        const res_defid = tr_ref.path.res._1;
        if (!DefId_eq(res_defid, trait_res_defid)) continue; // trait id matches
        if (!(bounded_ty.kind.$ === "Path" && bounded_ty.kind._0.$ === "Resolved")) continue;
        const path = bounded_ty.kind._0._1;
        if (path.res.$ !== "Def") continue;
        const defid = path.res._1;
        if (find_last(generics_fn.params, (param) => DefId_eq(LocalDefId.to_def_id(param.def_id), defid)) !== undefined) {
          suggestions.push([Span.shrink_to_hi(predicate.span), " + 'static"]);
        }
      }
    }
  }
  if (suggestions.length > 0) {
    dedup_span_string(suggestions);
    diag.multipart_suggestion({ $: "Inline", _0: "consider restricting the type parameter to the `'static` lifetime" }, suggestions, "MaybeIncorrect");
  }
};

/// Produces nice borrowck error diagnostics for all the errors collected in `nll_errors`.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:306 report_region_errors
MirBorrowckCtxt.prototype.report_region_errors = function (this: MirBorrowckCtxt, nll_errors: RegionErrors): void {
  // Iterate through all the errors, producing a diagnostic for each one. The diagnostics are
  // buffered in the `MirBorrowckCtxt`.
  const outlives_suggestion = new OutlivesSuggestionBuilder(new Map());
  for (const [nll_error, _] of nll_errors.into_iter()) {
    switch (nll_error.$) {
      case "TypeTestError": {
        const type_test = nll_error.type_test;
        // Try to convert the lower-bound region into something named we can print for
        // the user.
        const lower_bound_region = this.regioncx.to_error_region(type_test.lower_bound);

        const type_test_span = type_test.span;

        if (lower_bound_region !== undefined) {
          const generic_ty = this.regioncx.name_regions(this.infcx.tcx, GenericKind.to_ty(type_test.generic_kind, this.infcx.tcx), fold_Ty);
          const origin: SubregionOrigin = { $: "RelateParamBound", _0: type_test_span, _1: generic_ty, _2: undefined };
          this.buffer_error(
            this.infcx
              .err_ctxt()
              .construct_generic_bound_failure(
                this.body.source.def_id().expect_local(),
                type_test_span,
                origin,
                this.regioncx.name_regions(this.infcx.tcx, type_test.generic_kind, fold_GenericKind),
                lower_bound_region,
              ),
          );
        } else {
          // FIXME. We should handle this case better. It
          // indicates that we have e.g., some region variable
          // whose value is like `'a+'b` where `'a` and `'b` are
          // distinct unrelated universal regions that are not
          // known to outlive one another. It'd be nice to have
          // some examples where this arises to decide how best
          // to report it; we could probably handle it by
          // iterating over the universal regions and reporting
          // an error that multiple bounds are required.
          const diag = this.dcx().create_err(
            GenericDoesNotLiveLongEnough_diagnostic({
              kind: display_GenericKind(type_test.generic_kind),
              span: type_test_span,
            }),
          );

          // Add notes and suggestions for the case of 'static lifetime
          // implied but not specified when a generic associated types
          // are from higher-ranked trait bounds
          this.suggest_static_lifetime_for_gat_from_hrtb(diag, type_test.lower_bound);

          this.buffer_error(diag);
        }
        break;
      }

      case "PlaceholderOutlivesIllegalRegion": {
        const { longer_fr, illegally_outlived_r } = nll_error;
        this.report_erroneous_rvid_reaches_placeholder(longer_fr, illegally_outlived_r);
        break;
      }

      case "RegionError": {
        const { fr_origin, longer_fr, shorter_fr, is_reported } = nll_error;
        if (is_reported) {
          this.report_region_error(longer_fr, fr_origin, shorter_fr, outlives_suggestion);
        } else {
          // We only report the first error, so as not to overwhelm the user. See
          // `RegRegionErrorKind` docs.
          //
          // FIXME: currently we do nothing with these, but perhaps we can do better?
          // FIXME: try collecting these constraints on the outlives suggestion
          // builder. Does it make the suggestions any better?
          // debug!("Unreported region error: can't prove that {:?}: {:?}", longer_fr, shorter_fr);
        }
        break;
      }
    }
  }

  // Emit one outlives suggestions for each MIR def we borrowck
  outlives_suggestion.add_suggestion(this);
};

/// Point at `'static` obligations from the item being called.
///
/// ```text
/// error[E0521]: borrowed data escapes outside of function
///   --> $DIR/static-impl-obligation.rs:163:9
///    |
/// LL |     fn bar<'a>(x: &'a &'a u32) {
///    |            --  - `x` is only valid in the function body
///    |            |
///    |            lifetime `'a` defined here
/// LL |         let y: &dyn Foo = x;
/// LL |         y.hello();
///    |         ^^^^^^^^^
///    |         |
///    |         `x` escapes the function body here
///    |         argument requires that `'a` must outlive `'static`
///    |
/// note: `'static` lifetime requirement from `<(dyn o::Foo + 'static)>::hello` introduced here
///   --> $DIR/static-impl-obligation.rs:158:20
///    |
/// LL |     impl dyn Foo + 'static where Self: 'static {
///    |                    ^^^^^^^             ^^^^^^^ lifetime requirement introduced here
///    |                    |
///    |                    lifetime requirement introduced here
/// LL |         fn hello(&'static self) where Self: 'static {}
///    |                  ^^^^^^^^^^^^^              ^^^^^^^ lifetime requirement introduced here
///    |                  |
///    |                  lifetime requirement introduced here
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:424 explain_impl_static_obligation
MirBorrowckCtxt.prototype.explain_impl_static_obligation = function (this: MirBorrowckCtxt, diag: Diag, ty: Ty, outlived_fr: RegionVid): void {
  const tcx = this.infcx.tcx;
  if (this.regioncx.to_error_region(outlived_fr) !== tcx.lifetimes.re_static) {
    return;
  }
  const tk = ty.kind();
  if (tk.$ !== "FnDef") {
    return;
  }
  const [def_id_, args] = [tk._0, tk._1];
  const typing_env = this.infcx.typing_env(this.infcx.param_env);
  const resolved = Instance.try_resolve(
    tcx,
    typing_env,
    def_id_,
    this.infcx.deeply_resolve_ignoring_regions(unwrap(Binder.no_bound_vars(args, fold_GenericArgs)), fold_GenericArgs),
  );
  if (!(resolved.$ === "Ok" && resolved._0 !== undefined)) {
    return;
  }
  const instance = resolved._0;
  const def_id = Instance.def_id(instance);
  const bounds: Span[] = [];
  for (const [c, sp] of GenericClauses.instantiate(tcx.clauses_of(def_id) as GenericClauses, tcx, instance.args)) {
    const pred = Unnormalized.skip_norm_wip(c).as_predicate();
    const pk = Binder.skip_binder(pred.kind());
    if (pk.$ === "Clause" && (pk._0.$ === "TypeOutlives" || pk._0.$ === "RegionOutlives") && pk._0._0._1.is_static()) {
      bounds.push(sp);
    }
  }

  const labels = new Map<Span, string>();

  const parent = tcx.parent(def_id);
  const rcvr = Binder.skip_binder(PolyFnSigC.inputs(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>))))[0];
  if (rcvr !== undefined) {
    // Look at the receiver for `&'static self`, which introduces a `'static` obligation.
    // ```
    // impl Foo {
    //     fn foo(&'static self) {}
    //            ^^^^^^^^^^^^^
    // ```
    const rk = rcvr.kind();
    if (rk.$ === "Ref" && rk._0 === tcx.lifetimes.re_static) {
      const assoc = tcx.opt_associated_item(def_id);
      if (assoc !== undefined && AssocItem.is_method(assoc)) {
        const def_span = tcx.def_span(def_id);
        // We have a `&'static self` receiver.
        const local = def_id.as_local();
        const decl = local !== undefined ? hir.OwnerNode.fn_decl(tcx.expect_hir_owner_node(local)) : undefined;
        const ty = decl !== undefined ? decl.inputs[0] : undefined;
        if (ty !== undefined) {
          // Point at the `&'static self` receiver.
          bounds.push(ty.span);
        } else if (!bounds.some((sp) => Span.overlaps(sp, def_span))) {
          // The method is not defined on the local crate, point at the signature instead of
          // just the receiver as an approximation. We don't add it if there are already
          // other spans with overlap with the def `Span`, as the other will be more specific.
          bounds.push(def_span);
        }
      }
    }

    if (tcx.def_kind(parent).$ === "Impl") {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(parent) as EarlyBinder<Ty>));
      const k = ty.kind();
      if (k.$ === "Dynamic" && k._1 === tcx.lifetimes.re_static) {
        // We have a call into a method of either `impl dyn Trait {}` or
        // `impl dyn Trait + 'static {}`.
        const parent_local = parent.as_local();
        const owner = parent_local !== undefined ? tcx.expect_hir_owner_node(parent_local) : undefined;
        if (
          owner !== undefined &&
          owner.$ === "Item" &&
          owner._0.kind.$ === "Impl" &&
          owner._0.kind._0.self_ty.kind.$ === "TraitObject"
        ) {
          const impl_ = owner._0.kind._0;
          const self_ty_kind = impl_.self_ty.kind as Extract<hir.TyKind, { $: "TraitObject" }>;
          const tagged_ref = self_ty_kind._1;
          if (tagged_ref.pointer().is_static()) {
            // impl dyn Trait + 'static {
            //                  ^^^^^^^ lifetime requirement introduced here
            bounds.push(tagged_ref.pointer().ident.span);
          } else if (tagged_ref.pointer().is_implicit()) {
            // impl dyn Trait {
            //      ^^^^^^^^^ `dyn Trait` introduces an...
            bounds.push(impl_.self_ty.span);
            labels.set(impl_.self_ty.span, "`dyn Trait` introduces an implicit `'static` lifetime requirement");
          }
        } else {
          // Non-local `impl`, we don't have a way to differentiate between `+ 'static`
          // and bare `dyn Trait`. We point at the whole def `Span` for now.
          const def_span = tcx.def_span(parent);
          if (!bounds.some((sp) => Span.overlaps(sp, def_span))) {
            bounds.push(def_span);
          }
        }
      }
    }
  }

  if (bounds.length !== 0) {
    const multispan = MultiSpan.from_spans([...bounds]);
    for (const span of bounds) {
      const label = labels.get(span) ?? "lifetime requirement introduced here";
      multispan.push_span_label(span, label);
    }
    multispan.push_span_context(Span.shrink_to_lo(tcx.def_span(def_id)));
    const pk = tcx.def_kind(parent);
    if (pk.$ === "Impl" || pk.$ === "Trait") {
      multispan.push_span_context(Span.shrink_to_lo(tcx.def_span(parent)));
    }
    diag.span_note(multispan, `\`'static\` lifetime requirement from \`${tcx.def_path_str(def_id)}\` introduced here`);
  }
};

/// Report that `longer_fr: error_vid`, which doesn't hold,
/// where `longer_fr` is a placeholder.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:556 report_erroneous_rvid_reaches_placeholder
MirBorrowckCtxt.prototype.report_erroneous_rvid_reaches_placeholder = function (this: MirBorrowckCtxt, longer_fr: RegionVid, error_vid: RegionVid): void {
  const origin_longer = this.regioncx.definitions[longer_fr]!.origin;

  if (origin_longer.$ !== "Placeholder") {
    return bug(`Expected ${format_debug(longer_fr, debug_RegionVid, PLAIN)} to come from placeholder!`);
  }
  const placeholder = origin_longer._0;

  // FIXME: Is throwing away the existential region really the best here?
  const error_origin = this.regioncx.definitions[error_vid]!.origin;
  const error_region = error_origin.$ === "Placeholder" ? error_origin._0 : undefined;

  // Find the code to blame for the fact that `longer_fr` outlives `error_fr`.
  const best_blame = this.regioncx.best_blame_constraint(longer_fr, origin_longer, error_vid);
  const cause = best_blame.to_obligation_cause();

  // FIXME these methods should have better names, and also probably not be this generic.
  // FIXME note that we *throw away* the error element here! We probably want to
  // thread it through the computation further down and use it, but there currently isn't
  // anything there to receive it.
  bound_region_errors().UniverseInfo.report_erroneous_element(this.regioncx.universe_info(placeholder.universe), this, placeholder, error_region, cause);
};

/// Report an error because the universal region `fr` was required to outlive
/// `outlived_fr` but it is not known to do so. For example:
///
/// ```compile_fail
/// fn foo<'a, 'b>(x: &'a u32) -> &'b u32 { x }
/// ```
///
/// Here we would be invoked with `fr = 'a` and `outlived_fr = 'b`.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:599 report_region_error
MirBorrowckCtxt.prototype.report_region_error = function (
  this: MirBorrowckCtxt,
  fr: RegionVid,
  fr_origin: NllRegionVariableOrigin,
  outlived_fr: RegionVid,
  outlives_suggestion: OutlivesSuggestionBuilder,
): void {
  // debug!("report_region_error(fr={:?}, outlived_fr={:?})", fr, outlived_fr);

  const best_blame = this.regioncx.best_blame_constraint(fr, fr_origin, outlived_fr);
  const { category, span, variance_info } = best_blame.constraint();
  const path = best_blame.path_();

  // debug!("report_region_error: category={:?} {:?} {:?}", category, span, variance_info);

  // Check if we can use one of the "nice region errors".
  const f = this.regioncx.to_error_region(fr);
  const o = this.regioncx.to_error_region(outlived_fr);
  if (f !== undefined && o !== undefined) {
    const infer_err = this.infcx.err_ctxt();
    const nice = NiceRegionError.new_from_span(infer_err, this.mir_def_id(), span, o, f);
    const diag = nice.try_report_from_nll();
    if (diag !== undefined) {
      this.buffer_error(diag);
      return;
    }
  }

  const [fr_is_local, outlived_fr_is_local]: [boolean, boolean] = [
    this.regioncx.universal_regions().is_local_free_region(fr),
    this.regioncx.universal_regions().is_local_free_region(outlived_fr),
  ];

  // debug!("report_region_error: fr_is_local={:?} outlived_fr_is_local={:?} category={:?}", fr_is_local, outlived_fr_is_local, category);

  const errci: ErrorConstraintInfo = { fr, outlived_fr, category, span };

  let diag: Diag;
  if (category.$ === "SolverRegionConstraint") {
    const span = category._0;
    diag = this.dcx().struct_span_err(span, "higher-ranked lifetime bound could not be satisfied");
  } else if (category.$ === "Return" && fr_is_local && !outlived_fr_is_local && this.regioncx.is_closure_fn_mut(fr)) {
    const kind = category._0;
    diag = this.report_fnmut_error(errci, kind);
  } else if ((category.$ === "Assignment" || category.$ === "CallArgument") && fr_is_local && !outlived_fr_is_local) {
    const db = this.report_escaping_data_error(errci);

    outlives_suggestion.intermediate_suggestion(this, errci, db);
    outlives_suggestion.collect_constraint(fr, outlived_fr);

    diag = db;
  } else {
    const db = this.report_general_error(errci);

    outlives_suggestion.intermediate_suggestion(this, errci, db);
    outlives_suggestion.collect_constraint(fr, outlived_fr);

    diag = db;
  }

  if (category.$ === "CallArgument" && category._0 !== undefined) {
    const ty = category._0;
    this.explain_impl_static_obligation(diag, ty, outlived_fr);
  }

  switch (variance_info.$) {
    case "None":
      break;
    case "Invariant": {
      const { ty, param_index } = variance_info;
      let desc: string;
      let note: string;
      const k = ty.kind();
      switch (k.$) {
        case "RawPtr": {
          const [ty_, mutbl] = [k._0, k._1];
          assert_eq(mutbl, "Mut", String);
          [desc, note] = [`a mutable pointer to \`${display_Ty(ty_)}\``, "mutable pointers are invariant over their type parameter"];
          break;
        }
        case "Ref": {
          const [inner_ty, mutbl] = [k._1, k._2];
          assert_eq(mutbl, "Mut", String);
          [desc, note] = [`a mutable reference to \`${display_Ty(inner_ty)}\``, "mutable references are invariant over their type parameter"];
          break;
        }
        case "Adt": {
          const [adt, args] = [k._0, k._1];
          const generic_arg = args[param_index]!;
          const identity_args = RawList.identity_for_item(this.infcx.tcx, adt.did());
          const base_ty = Ty.new_adt(this.infcx.tcx, adt, identity_args);
          const base_generic_arg = identity_args[param_index]!;
          const adt_desc = adt.descr();

          desc = `the type \`${display_Ty(ty)}\`, which makes the generic argument \`${display_GenericArg(generic_arg)}\` invariant`;
          note = `the ${adt_desc} \`${display_Ty(base_ty)}\` is invariant over the parameter \`${display_GenericArg(base_generic_arg)}\``;
          break;
        }
        case "FnDef": {
          const def_id = k._0;
          const name = this.infcx.tcx.item_name(def_id);
          const identity_args = RawList.identity_for_item(this.infcx.tcx, def_id);
          desc = `the function item type defined by \`${display_Symbol_(name)}\``;
          note = `the function \`${display_Symbol_(name)}\` is invariant over the parameter \`${display_GenericArg(identity_args[param_index]!)}\``;
          break;
        }
        default:
          return panic(`Unexpected type ${format_debug(ty, debug_Ty, PLAIN)}`);
      }
      diag.note(`requirement occurs because of ${desc}`);
      diag.note(note);
      diag.help("see <https://doc.rust-lang.org/nomicon/subtyping.html> for more information about variance");
      break;
    }
  }

  this.add_placeholder_from_predicate_note(diag, path);
  this.add_sized_or_copy_bound_info(diag, category, path);

  for (const constraint of path) {
    if (constraint.category.$ === "Cast" && constraint.category.is_raw_ptr_dyn_type_cast) {
      diag.span_note(constraint.span, `raw pointer casts of trait objects cannot extend lifetimes`);
      diag.note(`this was previously accepted by the compiler but was changed recently`);
      diag.help(`see <https://github.com/rust-lang/rust/issues/141402> for more information`);
    }
  }

  this.buffer_error(diag);
};

/// Report a specialized error when `FnMut` closures return a reference to a captured variable.
/// This function expects `fr` to be local and `outlived_fr` to not be local.
///
/// ```text
/// error: captured variable cannot escape `FnMut` closure body
///   --> $DIR/issue-53040.rs:15:8
///    |
/// LL |     || &mut v;
///    |     -- ^^^^^^ creates a reference to a captured variable which escapes the closure body
///    |     |
///    |     inferred to be a `FnMut` closure
///    |
///    = note: `FnMut` closures only have access to their captured variables while they are
///            executing...
///    = note: ...therefore, returned references to captured variables will escape the closure
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:762 report_fnmut_error
MirBorrowckCtxt.prototype.report_fnmut_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo, kind: ReturnConstraint): Diag {
  const { outlived_fr, span } = errci;

  let output_ty = this.regioncx.universal_regions().unnormalized_output_ty;
  const ok = output_ty.kind();
  if (ok.$ === "Alias" && ok._1.kind.$ === "Opaque") {
    const def_id = ok._1.kind.def_id;
    output_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.infcx.tcx.type_of(def_id) as EarlyBinder<Ty>));
  }

  // debug!("report_fnmut_error: output_ty={:?}", output_ty);

  const otk = output_ty.kind();
  let ty_err: FnMutReturnTypeErr;
  if (otk.$ === "Coroutine" && this.infcx.tcx.coroutine_is_async(otk._0)) {
    ty_err = { $: "ReturnAsyncBlock", span };
  } else if (output_ty.contains_closure()) {
    ty_err = { $: "ReturnClosure", span };
  } else {
    ty_err = { $: "ReturnRef", span };
  }
  const err = { span, ty_err };

  const diag = this.dcx().create_err(FnMutError_diagnostic(err));

  if (kind.$ === "ClosureUpvar") {
    const upvar_field = kind._0;
    const defining_ty = this.regioncx.universal_regions().defining_ty;
    let def_id: DefId;
    if (defining_ty.$ === "Closure") {
      def_id = defining_ty._0;
    } else {
      return bug(`unexpected DefiningTy ${format_debug(defining_ty, universal_regions().debug_DefiningTy, PLAIN)}`);
    }

    const captured_place = this.upvars[upvar_field]!.place;
    let defined_hir: HirId | undefined;
    switch (captured_place.base.$) {
      case "Local":
        defined_hir = captured_place.base._0;
        break;
      case "Upvar":
        defined_hir = captured_place.base._0.var_path.hir_id;
        break;
      default:
        defined_hir = undefined;
    }

    if (defined_hir !== undefined) {
      const def_hir = defined_hir;
      const upvars_map = unwrap(this.infcx.tcx.upvars_mentioned(def_id)) as Map<HirId, hir.Upvar>;
      const upvar_def_span = this.infcx.tcx.hir_span(def_hir);
      const upvar_span = unwrap(upvars_map.get(def_hir)).span;
      diag.subdiagnostic(VarHereDenote_subdiagnostic({ $: "Defined", span: upvar_def_span }));
      diag.subdiagnostic(VarHereDenote_subdiagnostic({ $: "Captured", span: upvar_span }));
    }
  }

  const fr_span = unwrap(this.give_region_a_name(outlived_fr)).span();
  if (fr_span !== undefined) {
    diag.subdiagnostic(VarHereDenote_subdiagnostic({ $: "FnMutInferred", span: fr_span }));
  }

  this.suggest_move_on_borrowing_closure(diag);

  return diag;
};

/// Reports an error specifically for when data is escaping a closure.
///
/// ```text
/// error: borrowed data escapes outside of function
///   --> $DIR/lifetime-bound-will-change-warning.rs:44:5
///    |
/// LL | fn test2<'a>(x: &'a Box<Fn()+'a>) {
///    |              - `x` is only valid in the function body
/// LL |     // but ref_obj will not, so warn.
/// LL |     ref_obj(x)
///    |     ^^^^^^^^^^ `x` escapes the function body here
/// ```
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:835 report_escaping_data_error
MirBorrowckCtxt.prototype.report_escaping_data_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo): Diag {
  const { span, category } = errci;

  const fr_name_and_span = this.regioncx.get_var_name_and_span_for_region(this.infcx.tcx, this.body, this.local_names_(), this.upvars, errci.fr);
  const outlived_fr_name_and_span = this.regioncx.get_var_name_and_span_for_region(
    this.infcx.tcx,
    this.body,
    this.local_names_(),
    this.upvars,
    errci.outlived_fr,
  );

  const { DefiningTy } = universal_regions();
  const escapes_from = this.infcx.tcx.def_descr(DefiningTy.def_id(this.regioncx.universal_regions().defining_ty));

  // Revert to the normal error in these cases.
  // Assignments aren't "escapes" in function items.
  if (
    (fr_name_and_span === undefined && outlived_fr_name_and_span === undefined) ||
    (category.$ === "Assignment" && DefiningTy.is_fn_def(this.regioncx.universal_regions().defining_ty)) ||
    DefiningTy.is_const(this.regioncx.universal_regions().defining_ty) ||
    (fr_name_and_span === undefined && DefiningTy.is_fn_def(this.regioncx.universal_regions().defining_ty))
  ) {
    return this.report_general_error(errci);
  }

  const diag = borrowck_errors().borrowed_data_escapes_closure(this.dcx(), span, escapes_from);

  if (outlived_fr_name_and_span !== undefined && outlived_fr_name_and_span[0] !== undefined) {
    const [outlived_fr_name, outlived_fr_span] = [outlived_fr_name_and_span[0], outlived_fr_name_and_span[1]];
    diag.span_label(outlived_fr_span, `\`${display_Symbol_(outlived_fr_name)}\` declared here, outside of the ${escapes_from} body`);
  }

  if (fr_name_and_span !== undefined && fr_name_and_span[0] !== undefined) {
    const [fr_name, fr_span] = [fr_name_and_span[0], fr_name_and_span[1]];
    diag.span_label(fr_span, `\`${display_Symbol_(fr_name)}\` is only valid in the ${escapes_from} body`);

    diag.span_label(span, `\`${display_Symbol_(fr_name)}\` escapes the ${escapes_from} body here`);
  } else {
    diag.span_label(span, `a temporary borrow escapes the ${escapes_from} body here`);
    if (outlived_fr_name_and_span !== undefined && outlived_fr_name_and_span[0] !== undefined) {
      const outlived_name = outlived_fr_name_and_span[0];
      diag.help(
        `\`${display_Symbol_(outlived_name)}\` is declared outside the ${escapes_from}, so any data borrowed inside the ${escapes_from} cannot be stored into it`,
      );
    }
  }

  // Only show an extra note if we can find an 'error region' for both of the region
  // variables. This avoids showing a noisy note that just mentions 'synthetic' regions
  // that don't help the user understand the error.
  const f = this.regioncx.to_error_region(errci.fr);
  const o = this.regioncx.to_error_region(errci.outlived_fr);
  if (f !== undefined && o !== undefined) {
    this.maybe_suggest_constrain_dyn_trait_impl(diag, f, o, category);

    const fr_region_name = unwrap(this.give_region_a_name(errci.fr));
    fr_region_name.highlight_region_name(diag);
    const outlived_fr_region_name = unwrap(this.give_region_a_name(errci.outlived_fr));
    outlived_fr_region_name.highlight_region_name(diag);

    diag.span_label(
      span,
      `${ConstraintDescription_ConstraintCategory.description(category)}requires that \`${display_Symbol_(fr_region_name.name)}\` must outlive \`${display_Symbol_(outlived_fr_region_name.name)}\``,
    );
  }

  return diag;
};

/// Reports a region inference error for the general case with named/synthesized lifetimes to
/// explain what is happening.
///
/// ```text
/// error: unsatisfied lifetime constraints
///   --> $DIR/regions-creating-enums3.rs:17:5
///    |
/// LL | fn mk_add_bad1<'a,'b>(x: &'a ast<'a>, y: &'b ast<'b>) -> ast<'a> {
///    |                -- -- lifetime `'b` defined here
///    |                |
///    |                lifetime `'a` defined here
/// LL |     ast::add(x, y)
///    |     ^^^^^^^^^^^^^^ function was supposed to return data with lifetime `'a` but it
///    |                    is returning data with lifetime `'b`
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:944 report_general_error
MirBorrowckCtxt.prototype.report_general_error = function (this: MirBorrowckCtxt, errci: ErrorConstraintInfo): Diag {
  const { fr, outlived_fr, span, category } = errci;

  const mir_def_name = this.infcx.tcx.def_descr(LocalDefId.to_def_id(this.mir_def_id()));

  const err = { span };
  const diag = this.dcx().create_err(LifetimeOutliveErr_diagnostic(err));

  // In certain scenarios, such as the one described in issue #118021,
  // we might encounter a lifetime that cannot be named.
  // These situations are bound to result in errors.
  // To prevent an immediate ICE, we opt to create a dummy name instead.
  const fr_name = this.give_region_a_name(fr) ?? new RegionName(kw.UnderscoreLifetime, { $: "Static" });
  fr_name.highlight_region_name(diag);
  const outlived_fr_name = unwrap(this.give_region_a_name(outlived_fr));
  outlived_fr_name.highlight_region_name(diag);

  let err_category: LifetimeReturnCategoryErr;
  if (category.$ === "Return" && this.regioncx.universal_regions().is_local_free_region(outlived_fr)) {
    err_category = {
      $: "WrongReturn",
      span,
      mir_def_name,
      outlived_fr_name,
      fr_name,
    };
  } else {
    err_category = {
      $: "ShortReturn",
      span,
      category_desc: ConstraintDescription_ConstraintCategory.description(category),
      free_region_name: fr_name,
      outlived_fr_name,
    };
  }

  diag.subdiagnostic(LifetimeReturnCategoryErr_subdiagnostic(err_category));

  this.add_static_impl_trait_suggestion(diag, fr, fr_name, outlived_fr);
  this.suggest_adding_lifetime_params(diag, fr, outlived_fr);
  this.suggest_move_on_borrowing_closure(diag);
  this.suggest_deref_closure_return(diag);

  return diag;
};

/// Adds a suggestion to errors where an `impl Trait` is returned.
///
/// ```text
/// help: to allow this `impl Trait` to capture borrowed data with lifetime `'1`, add `'_` as
///       a constraint
///    |
/// LL |     fn iter_values_anon(&self) -> impl Iterator<Item=u32> + 'a {
///    |                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1001 add_static_impl_trait_suggestion
MirBorrowckCtxt.prototype.add_static_impl_trait_suggestion = function (
  this: MirBorrowckCtxt,
  diag: Diag,
  fr: RegionVid,
  // We need to pass `fr_name` - computing it again will label it twice.
  fr_name: RegionName,
  outlived_fr: RegionVid,
): void {
  const f = this.regioncx.to_error_region(fr);
  const outlived_f = this.regioncx.to_error_region(outlived_fr);
  if (f !== undefined && outlived_f !== undefined) {
    if (outlived_f.kind().$ !== "ReStatic") {
      return;
    }
    const suitable_region = this.infcx.tcx.is_suitable_region(this.mir_def_id(), f);
    if (suitable_region === undefined) {
      return;
    }

    const fn_returns = this.infcx.tcx.return_type_impl_or_dyn_traits(suitable_region.scope);

    const param = find_param_with_region(this.infcx.tcx, this.mir_def_id(), f, outlived_f);
    if (param === undefined) {
      return;
    }

    const lifetime = f.is_named(this.infcx.tcx) ? fr_name.name : kw.UnderscoreLifetime;

    const simple_ident = param.param.pat.simple_ident();
    const arg = simple_ident !== undefined ? `argument \`${display_Ident(simple_ident)}\`` : "the argument";
    const captures = `captures data from ${arg}`;

    if (fn_returns.length !== 0) {
      suggest_new_region_bound(
        this.infcx.tcx,
        diag,
        fn_returns,
        display_Symbol_(lifetime),
        arg,
        captures,
        [param.param_ty_span, display_Ty(param.param_ty)],
        suitable_region.scope,
      );
      return;
    }

    const with_alias = this.infcx.tcx.return_type_impl_or_dyn_traits_with_type_alias(suitable_region.scope);
    if (with_alias === undefined) {
      return;
    }
    const [alias_tys, alias_span, lt_addition_span] = with_alias;

    // in case the return type of the method is a type alias
    const spans_suggs: [Span, string][] = [];
    for (const alias_ty of alias_tys) {
      if (Span.desugaring_kind(alias_ty.span) !== undefined) {
        // Skip `async` desugaring `impl Future`.
        continue;
      }
      if (alias_ty.kind.$ === "TraitObject") {
        const lt = alias_ty.kind._1.pointer();
        if (lt.kind.$ === "ImplicitObjectLifetimeDefault") {
          spans_suggs.push([Span.shrink_to_hi(lt.ident.span), " + 'a"]);
        } else {
          spans_suggs.push([lt.ident.span, "'a"]);
        }
      }
    }

    if (lt_addition_span !== undefined) {
      spans_suggs.push([lt_addition_span, "'a, "]);
    } else {
      spans_suggs.push([Span.shrink_to_hi(alias_span), "<'a>"]);
    }

    diag.multipart_suggestion(
      `to declare that the trait object ${captures}, you can add a lifetime parameter \`'a\` in the type alias`,
      spans_suggs,
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1091 maybe_suggest_constrain_dyn_trait_impl
MirBorrowckCtxt.prototype.maybe_suggest_constrain_dyn_trait_impl = function (this: MirBorrowckCtxt, diag: Diag, f: Region, o: Region, category: ConstraintCategory): void {
  if (!o.is_static()) {
    return;
  }

  const tcx = this.infcx.tcx;

  if (!(category.$ === "CallArgument" && category._0 !== undefined)) return;
  const func_ty = category._0;
  const fk = func_ty.kind();
  if (fk.$ !== "FnDef") return;
  const [fn_did, args] = [fk._0, fk._1];
  // debug!(?fn_did, ?args);

  // Only suggest this on function calls, not closures
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(fn_did) as EarlyBinder<Ty>));
  // debug!("ty: {:?}, ty.kind: {:?}", ty, ty.kind());
  if (ty.kind().$ === "Closure") {
    return;
  }
  const resolved = Instance.try_resolve(
    tcx,
    this.infcx.typing_env(this.infcx.param_env),
    fn_did,
    this.infcx.deeply_resolve_ignoring_regions(unwrap(Binder.no_bound_vars(args, fold_GenericArgs)), fold_GenericArgs),
  );
  if (!(resolved.$ === "Ok" && resolved._0 !== undefined)) {
    return;
  }
  const instance = resolved._0;

  const param = find_param_with_region(tcx, this.mir_def_id(), f, o);
  if (param === undefined) {
    return;
  }
  // debug!(?param);

  const visitor = new TraitObjectVisitor(new DefIdSet());
  visitor.visit_ty(param.param_ty);

  const found = NiceRegionError.get_impl_ident_and_self_ty_from_trait(tcx, Instance.def_id(instance), visitor._0);
  if (found === undefined) {
    return;
  }
  const [ident, self_ty] = found;

  this.suggest_constrain_dyn_trait_in_impl(diag, visitor._0, ident, self_ty);
};

// #[instrument(skip(self, err), level = "debug")]
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1143 suggest_constrain_dyn_trait_in_impl
MirBorrowckCtxt.prototype.suggest_constrain_dyn_trait_in_impl = function (this: MirBorrowckCtxt, err: Diag, found_dids: DefIdSet, ident: Ident, self_ty: hir.Ty): boolean {
  // debug!("err: {:#?}", err);
  let suggested = false;
  for (const found_did of found_dids) {
    const traits: Span[] = [];
    const hir_v = new HirTraitObjectVisitor(traits, found_did);
    hir_v.visit_ty_unambig(self_ty);
    // debug!("trait spans found: {:?}", traits);
    for (const span of traits) {
      const multi_span = MultiSpan.from_spans([span]);
      multi_span.push_span_label(span, { $: "Inline", _0: "this has an implicit `'static` lifetime requirement" });
      multi_span.push_span_label(ident.span, { $: "Inline", _0: "calling this method introduces the `impl`'s `'static` requirement" });
      err.subdiagnostic(RequireStaticErr_subdiagnostic({ $: "UsedImpl", multi_span }));
      err.span_suggestion_verbose(Span.shrink_to_hi(span), { $: "Inline", _0: "consider relaxing the implicit `'static` requirement" }, " + '_", "MaybeIncorrect");
      suggested = true;
    }
  }
  return suggested;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1180 suggest_adding_lifetime_params
MirBorrowckCtxt.prototype.suggest_adding_lifetime_params = function (this: MirBorrowckCtxt, diag: Diag, sub_: RegionVid, sup_: RegionVid): void {
  const sub = this.regioncx.to_error_region(sub_);
  const sup = this.regioncx.to_error_region(sup_);
  if (sub === undefined || sup === undefined) {
    return;
  }

  const sub_anon =
    this.infcx.tcx.is_suitable_region(this.mir_def_id(), sub) !== undefined ? find_anon_type(this.infcx.tcx, this.mir_def_id(), sub) : undefined;
  if (sub_anon === undefined) {
    return;
  }
  const [ty_sub] = sub_anon;

  const sup_anon =
    this.infcx.tcx.is_suitable_region(this.mir_def_id(), sup) !== undefined ? find_anon_type(this.infcx.tcx, this.mir_def_id(), sup) : undefined;
  if (sup_anon === undefined) {
    return;
  }
  const [ty_sup] = sup_anon;

  suggest_adding_lifetime_params(this.infcx.tcx, diag, this.mir_def_id(), sub, ty_sup, ty_sub);
};

/// When encountering a lifetime error caused by the return type of a closure, check the
/// corresponding trait bound and see if dereferencing the closure return value would satisfy
/// them. If so, we produce a structured suggestion.
// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1218 suggest_deref_closure_return
MirBorrowckCtxt.prototype.suggest_deref_closure_return = function (this: MirBorrowckCtxt, diag: Diag): void {
  const tcx = this.infcx.tcx;

  // Get the closure return value and type.
  const closure_def_id = this.mir_def_id();
  const closure_node = tcx.hir_node_by_def_id(closure_def_id);
  if (!(closure_node.$ === "Expr" && closure_node._0.kind.$ === "Closure")) {
    return;
  }
  const closure_expr = closure_node._0;
  const { body } = closure_node._0.kind._0;
  const ctk = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(closure_def_id)) as EarlyBinder<Ty>)).kind();
  if (ctk.$ !== "Closure") {
    return;
  }
  const args = ctk._1.as_closure();

  // Make sure that the parent expression is a method call.
  const parent_expr_id = tcx.parent_hir_id(this.mir_hir_id());
  const parent_node = tcx.hir_node(parent_expr_id);
  if (!(parent_node.$ === "Expr" && parent_node._0.kind.$ === "MethodCall")) {
    return;
  }
  const parent_expr = parent_node._0;
  const [, rcvr, call_args] = [parent_node._0.kind._0, parent_node._0.kind._1, parent_node._0.kind._2];
  const typeck_results = tcx.typeck(this.mir_def_id()) as TypeckResults;

  // We don't use `ty.peel_refs()` to get the number of `*`s needed to get the root type.
  const liberated_sig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(closure_def_id), ClosureArgs.sig(args), fold_FnSig);
  let peeled_ty = FnSig.output(liberated_sig);
  let count = 0;
  for (let k = peeled_ty.kind(); k.$ === "Ref"; k = peeled_ty.kind()) {
    peeled_ty = k._1;
    count += 1;
  }
  if (!this.infcx.type_is_copy_modulo_regions(this.infcx.param_env, peeled_ty)) {
    return;
  }

  // Build a new closure where the return type is an owned value, instead of a ref.
  // The new closure is safe, but otherwise has the same ABI, splat, and c-variadic.
  const fn_sig_kind = FnSigKind.set_safety(liberated_sig.fn_sig_kind, "Safe");
  const closure_sig_as_fn_ptr_ty = Ty.new_fn_ptr(tcx, Binder.dummy(tcx.mk_fn_sig([...FnSig.inputs(liberated_sig)], peeled_ty, fn_sig_kind), fold_FnSig));
  const closure_ty = Ty.new_closure(
    tcx,
    LocalDefId.to_def_id(closure_def_id),
    ClosureArgs.new(tcx, {
      parent_args: ClosureArgs.parent_args(args),
      closure_kind_ty: ClosureArgs.kind_ty(args),
      tupled_upvars_ty: ClosureArgs.tupled_upvars_ty(args),
      closure_sig_as_fn_ptr_ty,
    }).args,
  );

  const closure_arg_pos = call_args.findIndex((arg) => HirId_eq(arg.hir_id, closure_expr.hir_id));
  if (closure_arg_pos === -1) {
    return;
  }
  // Get the type for the parameter corresponding to the argument the closure with the
  // lifetime error we had.
  const method_def_id = typeck_results.type_dependent_def_id(parent_expr.hir_id);
  if (method_def_id === undefined) {
    return;
  }
  const input_arg = Binder.skip_binder(PolyFnSigC.inputs(EarlyBinder.skip_binder(tcx.fn_sig(method_def_id) as EarlyBinder<PolyFnSig>)))[
    // Methods have a `self` arg, so `pos` is actually `+ 1` to match the method call arg.
    closure_arg_pos + 1
  ];
  if (input_arg === undefined) {
    return;
  }
  // If this isn't a param, then we can't substitute a new closure.
  const iak = input_arg.kind();
  if (iak.$ !== "Param") return;
  const closure_param = iak._0;

  // Get the arguments for the found method, only specifying that `Self` is the receiver type.
  const possible_rcvr_ty = typeck_results.node_type_opt(rcvr.hir_id);
  if (possible_rcvr_ty === undefined) return;
  const args_ = RawList.for_item(tcx, method_def_id, (param: GenericParamDef, _) => {
    if (param.kind.$ === "Lifetime") {
      return GenericArg.from_Region(tcx.lifetimes.re_erased);
    } else if (param.index === 0 && param.name === kw.SelfUpper) {
      return GenericArg.from_Ty(possible_rcvr_ty);
    } else if (param.index === closure_param.index) {
      return GenericArg.from_Ty(closure_ty);
    } else {
      return this.infcx.var_for_def(parent_expr.span, param);
    }
  });

  const clauses = GenericClauses.instantiate(tcx.clauses_of(method_def_id) as GenericClauses, tcx, args_);

  const ocx = ObligationCtxt.new(this.infcx.infcx);
  ocx.register_obligations(
    [...clauses.iter()].map(([clause, span]) => {
      // trace!(?clause);
      return Obligation.misc(
        tcx,
        span,
        this.mir_def_id(),
        this.infcx.param_env,
        Unnormalized.skip_norm_wip(clause),
        Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate,
      );
    }),
  );

  if (TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity()) && count > 0) {
    diag.span_suggestion_verbose(
      Span.shrink_to_lo(tcx.hir_body(body).value.peel_blocks().span),
      { $: "Inline", _0: "dereference the return value" },
      "*".repeat(count),
      "MachineApplicable",
    );
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/region_errors.rs:1349 suggest_move_on_borrowing_closure
MirBorrowckCtxt.prototype.suggest_move_on_borrowing_closure = function (this: MirBorrowckCtxt, diag: Diag): void {
  const body = this.infcx.tcx.hir_body_owned_by(this.mir_def_id());
  const expr = body.value.peel_blocks();
  let closure_span: Span | undefined = undefined;
  const ek = expr.kind;
  if (ek.$ === "MethodCall") {
    const args = ek._2;
    for (const arg of args) {
      if (arg.kind.$ === "Closure" && arg.kind._0.capture_clause.$ === "Ref") {
        closure_span = Span.shrink_to_lo(arg.span);
        break;
      }
    }
  } else if (ek.$ === "Closure" && ek._0.capture_clause.$ === "Ref") {
    const kind = ek._0.kind;
    if (!(kind.$ === "Coroutine" && kind._0.$ === "Desugared" && kind._0._0 === "Async")) {
      closure_span = Span.shrink_to_lo(expr.span);
    }
  } else {
    // {}
  }
  if (closure_span !== undefined) {
    diag.span_suggestion_verbose(closure_span, { $: "Inline", _0: "consider adding 'move' keyword before the nested closure" }, "move ", "MaybeIncorrect");
  }
};

// ---- PORT helpers ---------------------------------------------------------------------------------------------------

/** PORT: the derived `TypeFoldable` of `GenericKind` (region_constraints/mod.gen.ts) as a descriptor. */
const fold_GenericKind: TypeFoldable<GenericKind> = {
  visit_with: (self, visitor) => visit_with_GenericKind(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_GenericKind(self, folder),
  fold_with: (self, folder) => fold_with_GenericKind(self, folder),
};

/** PORT: `{}` of a `Symbol`. */
function display_Symbol_(s: Symbol): string {
  return Symbol.as_str(s);
}

/** PORT: `iter().rfind(pred)` (the last match). */
function find_last<T>(xs: readonly T[], pred: (x: T) => boolean): T | undefined {
  for (let i = xs.length - 1; i >= 0; i--) {
    if (pred(xs[i]!)) return xs[i];
  }
  return undefined;
}

/** PORT: `Vec<(Span, String)>::dedup` (consecutive equal elements). */
function dedup_span_string(v: [Span, string][]): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w > 0 && v[w - 1]![0] === v[r]![0] && v[w - 1]![1] === v[r]![1]) continue;
    v[w++] = v[r]!;
  }
  v.length = w;
}
