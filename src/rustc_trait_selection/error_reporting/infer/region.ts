// Port of compiler/rustc_trait_selection/src/error_reporting/infer/region.rs (lane errrep-region).
//
// Init order: top-level code here touches only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other crates;
// other rustc_trait_selection modules are read inside function bodies (lazy `require`, as traits/overflow.ts).
export * from "./region.gen.ts";
import { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import { Applicability, type Diag, E0309, E0310, E0311, E0803, msg, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import { Namespace } from "../../../rustc_hir/def.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import type { BoundRegionConversionTime, RegionVariableOrigin as RegionVariableOriginT } from "../../../rustc_infer/infer/mod.gen.ts";
import type { RegionResolutionError } from "../../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import { RegionVariableOrigin, SubregionOrigin } from "../../../rustc_infer/infer/mod.ts";
import {
  display_GenericKind,
  type GenericKind,
} from "../../../rustc_infer/infer/region_constraints/mod.ts";
import {
  fold_with_GenericKind,
  try_fold_with_GenericKind,
  visit_with_GenericKind,
} from "../../../rustc_infer/infer/region_constraints/mod.gen.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { DiagStyledString } from "../../../rustc_errors/lib.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { Clause_upcast_from_Binder_ClauseKind } from "../../../rustc_middle/ty/predicate.ts";
import type { ClauseKind } from "../../../rustc_type_ir/predicate_kind.gen.ts";
import type { OpaqueTypeKey } from "../../../rustc_type_ir/decls.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, Region, Ty } from "../../../rustc_middle/ty/decls.ts";
import { IsSuggestable } from "../../../rustc_middle/ty/diagnostics.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { EarlyParamRegion, LateParamRegionKind } from "../../../rustc_middle/ty/region.ts";
import { ParamEnv, Ty as TyC } from "../../../rustc_middle/ty/mod.ts";
import { display_Clause, RegionHighlightMode } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { BytePos, type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { display_Symbol, kw, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, BoundRegionKind, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { fold_tuple2 } from "../../../rustc_type_ir/fold.ts";
import { display_Region } from "../../../rustc_type_ir/ir_print.ts";
import { debug_Region, fold_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { as_interner, TraitRef } from "../../../rustc_type_ir/predicate.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { Unnormalized, UnnormalizedClause } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { assert, unreachable, unwrap } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { WhereClauseSuggestions } from "../../diagnostics.gen.ts";
import { type LifetimeSuggestion } from "./region.gen.ts";

// PORT: other rustc_trait_selection modules are read inside function bodies (init order, errctxt-contract handoff).
function diagnostics(): typeof import("../../diagnostics.ts") {
  return require("../../diagnostics.ts");
}
function note_and_explain(): typeof import("../../diagnostics/note_and_explain.ts") {
  return require("../../diagnostics/note_and_explain.ts");
}
function find_anon_type_mod(): typeof import("./nice_region_error/find_anon_type.ts") {
  return require("./nice_region_error/find_anon_type.ts");
}
function placeholder_error(): typeof import("./nice_region_error/placeholder_error.ts") {
  return require("./nice_region_error/placeholder_error.ts");
}

/** PORT: `GenericKind`'s derived `TypeFoldable` / `TypeVisitable` (region_constraints/mod.gen.ts) as a descriptor. */
const fold_GenericKind: TypeFoldable<GenericKind> = {
  visit_with: (self, visitor) => visit_with_GenericKind(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_GenericKind(self, folder),
  fold_with: (self, folder) => fold_with_GenericKind(self, folder),
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:36 report_region_errors
TypeErrCtxt.prototype.report_region_errors = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  errors_: readonly RegionResolutionError[],
): ErrorGuaranteed {
  assert(!(errors_.length === 0), "assertion failed: !errors.is_empty()");

  const guaranteed = this.infcx.tainted_by_errors();
  if (guaranteed !== undefined) {
    return guaranteed;
  }

  // debug!("report_region_errors(): {} errors to start", errors.len());

  // try to pre-process the errors, which will group some of them
  // together into a `ProcessedErrors` group:
  const errors = this.process_errors(errors_);

  // debug!("report_region_errors: {} errors after preprocessing", errors.len());

  let guar: ErrorGuaranteed | undefined = undefined;
  for (const error of errors) {
    // debug!("report_region_errors: error = {:?}", error);

    let e: ErrorGuaranteed;
    const nice = this.try_report_nice_region_error(generic_param_scope, error);
    if (nice !== undefined) {
      e = nice;
    } else {
      // PORT: `error.clone()`: the variants' payloads are never mutated in place.
      switch (error.$) {
        // These errors could indicate all manner of different
        // problems with many different solutions. Rather
        // than generate a "one size fits all" error, what we
        // attempt to do is go through a number of specific
        // scenarios and try to find the best way to present
        // the error. If all of these fails, we fall back to a rather
        // general bit of code that displays the error information
        case "ConcreteFailure": {
          const [origin, sub, sup] = [error._0, error._1, error._2];
          if (sub.is_placeholder() || sup.is_placeholder()) {
            e = this.report_placeholder_failure(generic_param_scope, origin, sub, sup).emit_err();
          } else {
            e = this.report_concrete_failure(generic_param_scope, origin, sub, sup).emit_err();
          }
          break;
        }

        case "GenericBoundFailure": {
          const [origin, param_ty, sub] = [error._0, error._1, error._2];
          e = this.report_generic_bound_failure(generic_param_scope, SubregionOrigin.span(origin), origin, param_ty, sub);
          break;
        }

        case "SubSupConflict": {
          const [var_origin, sub_origin, sub_r, sup_origin, sup_r] = [error._1, error._2, error._3, error._4, error._5];
          if (sub_r.is_placeholder()) {
            e = this.report_placeholder_failure(generic_param_scope, sub_origin, sub_r, sup_r).emit_err();
          } else if (sup_r.is_placeholder()) {
            e = this.report_placeholder_failure(generic_param_scope, sup_origin, sub_r, sup_r).emit_err();
          } else {
            e = this.report_sub_sup_conflict(generic_param_scope, var_origin, sub_origin, sub_r, sup_origin, sup_r);
          }
          break;
        }

        case "UpperBoundUniverseConflict": {
          const [sup_origin, sup_r] = [error._3, error._4];
          assert(sup_r.is_placeholder(), "assertion failed: sup_r.is_placeholder()");

          // Make a dummy value for the "sub region" --
          // this is the initial value of the
          // placeholder. In practice, we expect more
          // tailored errors that don't really use this
          // value.
          const sub_r = this.tcx.lifetimes.re_erased;

          e = this.report_placeholder_failure(generic_param_scope, sup_origin, sub_r, sup_r).emit_err();
          break;
        }

        case "CannotNormalize": {
          const [clause_, origin] = [error._0, error._1];
          const clause: Clause = Clause_upcast_from_Binder_ClauseKind(
            Binder.map_bound(clause_, (c): ClauseKind => ({ $: "TypeOutlives", _0: c })),
            this.tcx,
          );
          e = this.tcx.dcx().struct_span_err(SubregionOrigin.span(origin), `cannot normalize \`${display_Clause(clause)}\``).emit_err();
          break;
        }
      }
    }

    guar = e;
  }

  return unwrap(guar);
};

// This method goes through all the errors and try to group certain types
// of error together, for the purpose of suggesting explicit lifetime
// parameters to the user. This is done so that we can have a more
// complete view of what lifetimes should be the same.
// If the return value is an empty vector, it means that processing
// failed (so the return value of this method should not be used).
//
// The method also attempts to weed out messages that seem like
// duplicates that will be unhelpful to the end-user. But
// obviously it never weeds out ALL errors.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:180 process_errors
TypeErrCtxt.prototype.process_errors = function (this: TypeErrCtxt, errors_: readonly RegionResolutionError[]): RegionResolutionError[] {
  // debug!("process_errors()");

  // We want to avoid reporting generic-bound failures if we can
  // avoid it: these have a very high rate of being unhelpful in
  // practice. This is because they are basically secondary
  // checks that test the state of the region graph after the
  // rest of inference is done, and the other kinds of errors
  // indicate that the region constraint graph is internally
  // inconsistent, so these test results are likely to be
  // meaningless.
  //
  // Therefore, we filter them out of the list unless they are
  // the only thing in the list.

  const is_bound_failure = (e: RegionResolutionError): boolean => {
    switch (e.$) {
      case "GenericBoundFailure":
        return true;
      case "ConcreteFailure":
      case "SubSupConflict":
      case "UpperBoundUniverseConflict":
      case "CannotNormalize":
        return false;
    }
  };

  const errors = errors_.every((e) => is_bound_failure(e)) ? [...errors_] : errors_.filter((e) => !is_bound_failure(e));

  // sort the errors by span, for better error message stability.
  const key = (u: RegionResolutionError): [BytePos, BytePos] => {
    let sp: Span;
    switch (u.$) {
      case "ConcreteFailure":
        sp = SubregionOrigin.span(u._0);
        break;
      case "GenericBoundFailure":
        sp = SubregionOrigin.span(u._0);
        break;
      case "SubSupConflict":
        sp = RegionVariableOrigin.span(u._1);
        break;
      case "UpperBoundUniverseConflict":
        sp = RegionVariableOrigin.span(u._1);
        break;
      case "CannotNormalize":
        sp = SubregionOrigin.span(u._1);
        break;
    }
    return Span.lo_hi(sp);
  };
  // PORT: `sort_by_key` is stable, like `Array.prototype.sort`; the key is computed per comparison as upstream.
  errors.sort((a, b) => {
    const [a_lo, a_hi] = key(a);
    const [b_lo, b_hi] = key(b);
    return a_lo !== b_lo ? a_lo - b_lo : a_hi - b_hi;
  });
  return errors;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:228 note_region_origin
TypeErrCtxt.prototype.note_region_origin = function (this: TypeErrCtxt, err: Diag, origin: SubregionOrigin): void {
  const { RegionOriginNote_add_to_diag } = diagnostics();
  switch (origin.$) {
    case "Subtype": {
      const trace = origin._0;
      RegionOriginNote_add_to_diag(
        {
          $: "WithRequirement",
          span: trace.cause.span,
          requirement: { _0: trace.cause },
          expected_found: this.values_str(trace.values, trace.cause, err.long_ty_path()),
        },
        err,
      );
      break;
    }
    case "Reborrow": {
      const span = origin._0;
      RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...so that reference does not outlive borrowed content") }, err);
      break;
    }
    case "RelateObjectBound": {
      const span = origin._0;
      RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...so that it can be closed over into an object") }, err);
      break;
    }
    case "ReferenceOutlivesReferent": {
      const [ty, span] = [origin._0, origin._1];
      RegionOriginNote_add_to_diag(
        {
          $: "WithName",
          span,
          msg: msg("...so that the reference type `{$name}` does not outlive the data it points at"),
          name: this.ty_to_string(ty),
          continues: false,
        },
        err,
      );
      break;
    }
    case "RelateParamBound": {
      const [span, ty, opt_span] = [origin._0, origin._1, origin._2];
      RegionOriginNote_add_to_diag(
        {
          $: "WithName",
          span,
          msg: msg(
            `...so that the type \`{$name}\` will meet its required lifetime bounds{$continues ->
                            [true] ...
                            *[false] {""}
                        }`,
          ),
          name: this.ty_to_string(ty),
          continues: opt_span !== undefined,
        },
        err,
      );
      if (opt_span !== undefined) {
        const span = opt_span;
        RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...that is required by this bound") }, err);
      }
      break;
    }
    case "RelateRegionParamBound": {
      const span = origin._0;
      RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...so that the declared lifetime parameter bounds are satisfied") }, err);
      break;
    }
    case "CompareImplItemObligation": {
      const span = origin.span;
      RegionOriginNote_add_to_diag(
        { $: "Plain", span, msg: msg("...so that the definition in impl matches the definition from the trait") },
        err,
      );
      break;
    }
    case "CheckAssociatedTypeBounds": {
      const parent = origin.parent;
      this.note_region_origin(err, parent);
      break;
    }
    case "AscribeUserTypeProvePredicate": {
      const span = origin._0;
      RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...so that the where clause holds") }, err);
      break;
    }
    case "SolverRegionConstraint": {
      const span = origin._0;
      RegionOriginNote_add_to_diag({ $: "Plain", span, msg: msg("...so that a higher-ranked lifetime bound can be satisfied") }, err);
      break;
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:311 report_concrete_failure
TypeErrCtxt.prototype.report_concrete_failure = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  origin: SubregionOrigin,
  sub: Region,
  sup: Region,
): Diag {
  const D = diagnostics();
  const { RegionExplanation, PrefixKind, SuffixKind } = note_and_explain();
  // `reference_valid.into_iter().chain(content_valid).collect()`
  const chain = <T>(a: T | undefined, b: T | undefined): T[] => [...(a !== undefined ? [a] : []), ...(b !== undefined ? [b] : [])];
  let err: Diag;
  switch (origin.$) {
    case "Subtype": {
      const trace = origin._0;
      const terr: TypeError = { $: "RegionsDoesNotOutlive", _0: sup, _1: sub };
      const err_ = this.report_and_explain_type_error(trace, this.tcx.param_env(generic_param_scope) as ParamEnv, terr);
      const sub_k = sub.kind().$;
      const sup_k = sup.kind().$;
      if (sub_k === "RePlaceholder" && sup_k === "RePlaceholder") {
        // nothing
      } else if (sub_k === "RePlaceholder") {
        note_and_explain_region(this.tcx, err_, generic_param_scope, "", sup, " doesn't meet the lifetime requirements", undefined);
      } else if (sup_k === "RePlaceholder") {
        note_and_explain_region(this.tcx, err_, generic_param_scope, "the required lifetime does not necessarily outlive ", sub, "", undefined);
      } else {
        note_and_explain_region(this.tcx, err_, generic_param_scope, "", sup, "...", undefined);
        note_and_explain_region(this.tcx, err_, generic_param_scope, "...does not necessarily outlive ", sub, "", undefined);
      }
      err = err_;
      break;
    }
    case "Reborrow": {
      const span = origin._0;
      const reference_valid = RegionExplanation.new(this.tcx, generic_param_scope, sub, undefined, PrefixKind.RefValidFor, SuffixKind.Continues);
      const content_valid = RegionExplanation.new(this.tcx, generic_param_scope, sup, undefined, PrefixKind.ContentValidFor, SuffixKind.Empty);
      err = this.dcx().create_err(D.OutlivesContent_diagnostic({ span, notes: chain(reference_valid, content_valid) }));
      break;
    }
    case "RelateObjectBound": {
      const span = origin._0;
      const object_valid = RegionExplanation.new(this.tcx, generic_param_scope, sub, undefined, PrefixKind.TypeObjValidFor, SuffixKind.Empty);
      const pointer_valid = RegionExplanation.new(this.tcx, generic_param_scope, sup, undefined, PrefixKind.SourcePointerValidFor, SuffixKind.Empty);
      err = this.dcx().create_err(D.OutlivesBound_diagnostic({ span, notes: chain(object_valid, pointer_valid) }));
      break;
    }
    case "RelateParamBound": {
      const [span, ty, opt_span] = [origin._0, origin._1, origin._2];
      const prefix = sub.kind().$ === "ReStatic" ? PrefixKind.TypeSatisfy : PrefixKind.TypeOutlive;
      const suffix = opt_span !== undefined ? SuffixKind.ReqByBinding : SuffixKind.Empty;
      const note = RegionExplanation.new(this.tcx, generic_param_scope, sub, opt_span, prefix, suffix);
      err = this.dcx().create_err(D.FulfillReqLifetime_diagnostic({ span, ty: this.deeply_resolve_ignoring_regions(ty, fold_Ty), note }));
      break;
    }
    case "RelateRegionParamBound": {
      const [span, ty_] = [origin._0, origin._1];
      const param_instantiated = RegionExplanation.new(
        this.tcx,
        generic_param_scope,
        sup,
        undefined,
        PrefixKind.LfParamInstantiatedWith,
        SuffixKind.Empty,
      );
      let alt_span: Span | undefined = undefined;
      let k;
      let def_id: DefId | undefined;
      if (
        ty_ !== undefined &&
        sub.is_static() &&
        (k = ty_.kind()).$ === "Dynamic" &&
        (def_id = k._0.principal_def_id()) !== undefined
      ) {
        for (const [clause, span] of GenericClauses.instantiate_identity(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx).into_iter()) {
          const ck = Unnormalized.skip_binder(UnnormalizedClause.kind(clause));
          let a;
          if (
            ck.$ === "TypeOutlives" &&
            (a = ck._0._0.kind()).$ === "Param" &&
            a._0.name === kw.SelfUpper &&
            ck._0._1.is_static()
          ) {
            // Point at explicit `'static` bound on the trait (`trait T: 'static`).
            alt_span = span;
          }
        }
      }
      const param_must_outlive = RegionExplanation.new(
        this.tcx,
        generic_param_scope,
        sub,
        alt_span,
        PrefixKind.LfParamMustOutlive,
        SuffixKind.Empty,
      );
      err = this.dcx().create_err(D.LfBoundNotSatisfied_diagnostic({ span, notes: chain(param_instantiated, param_must_outlive) }));
      break;
    }
    case "ReferenceOutlivesReferent": {
      const [ty, span] = [origin._0, origin._1];
      const pointer_valid = RegionExplanation.new(this.tcx, generic_param_scope, sub, undefined, PrefixKind.PointerValidFor, SuffixKind.Empty);
      const data_valid = RegionExplanation.new(this.tcx, generic_param_scope, sup, undefined, PrefixKind.DataValidFor, SuffixKind.Empty);
      err = this.dcx().create_err(
        D.RefLongerThanData_diagnostic({ span, ty: this.deeply_resolve_ignoring_regions(ty, fold_Ty), notes: chain(pointer_valid, data_valid) }),
      );
      break;
    }
    case "CompareImplItemObligation": {
      const { span, impl_item_def_id, trait_item_def_id } = origin;
      const err_ = this.report_extra_impl_obligation(span, impl_item_def_id, trait_item_def_id, `\`${display_Region(sup)}: ${display_Region(sub)}\``);
      // We should only suggest rewriting the `where` clause if the predicate is within that `where` clause
      const generics = this.tcx.hir_get_generics(impl_item_def_id);
      if (generics !== undefined && Span.contains(generics.where_clause_span, span)) {
        this.suggest_copy_trait_method_bounds(trait_item_def_id, impl_item_def_id, err_);
      }
      err = err_;
      break;
    }
    case "CheckAssociatedTypeBounds": {
      const { impl_item_def_id, trait_item_def_id, parent } = origin;
      const err_ = this.report_concrete_failure(generic_param_scope, parent, sub, sup);

      // Don't mention the item name if it's an RPITIT, since that'll just confuse
      // folks.
      if (!this.tcx.is_impl_trait_in_trait(LocalDefId.to_def_id(impl_item_def_id))) {
        const trait_item_span = this.tcx.def_span(trait_item_def_id);
        const item_name = this.tcx.item_name(LocalDefId.to_def_id(impl_item_def_id));
        err_.span_label(trait_item_span, `definition of \`${display_Symbol(item_name)}\` from trait`);
      }

      this.suggest_copy_trait_method_bounds(trait_item_def_id, impl_item_def_id, err_);
      err = err_;
      break;
    }
    case "AscribeUserTypeProvePredicate": {
      const span = origin._0;
      const instantiated = RegionExplanation.new(this.tcx, generic_param_scope, sup, undefined, PrefixKind.LfInstantiatedWith, SuffixKind.Empty);
      const must_outlive = RegionExplanation.new(this.tcx, generic_param_scope, sub, undefined, PrefixKind.LfMustOutlive, SuffixKind.Empty);
      err = this.dcx().create_err(D.LfBoundNotSatisfied_diagnostic({ span, notes: chain(instantiated, must_outlive) }));
      break;
    }
    case "SolverRegionConstraint": {
      const span = origin._0;
      err = this.dcx().struct_span_err(span, "higher-ranked lifetime bound could not be satisfied");
      break;
    }
  }
  if (sub.is_error() || sup.is_error()) {
    err.downgrade_to_delayed_bug();
  }
  return err;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:586 suggest_copy_trait_method_bounds
TypeErrCtxt.prototype.suggest_copy_trait_method_bounds = function (
  this: TypeErrCtxt,
  trait_item_def_id: DefId,
  impl_item_def_id: LocalDefId,
  err: Diag,
): void {
  // FIXME(compiler-errors): Right now this is only being used for region
  // predicate mismatches. Ideally, we'd use it for *all* predicate mismatches,
  // but right now it's not really very smart when it comes to implicit `Sized`
  // predicates and bounds on the trait itself.

  const impl_def_id = this.tcx.trait_impl_of_assoc(LocalDefId.to_def_id(impl_item_def_id));
  if (impl_def_id === undefined) {
    return;
  }
  const trait_ref = this.tcx.impl_trait_ref(impl_def_id);
  const trait_args = TraitRef.with_replaced_self_ty(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(trait_ref)),
    as_interner(this.tcx),
    // Replace the explicit self type with `Self` for better suggestion rendering
    TyC.new_param(this.tcx, 0, kw.SelfUpper),
  ).args;
  const trait_item_args: GenericArgs = RawList.identity_for_item(this.tcx, LocalDefId.to_def_id(impl_item_def_id)).rebase_onto(this.tcx, impl_def_id, trait_args);

  const trait_predicates: string[] = [];
  for (const [clause_, _] of GenericClauses.instantiate_own(this.tcx.explicit_clauses_of(trait_item_def_id) as GenericClauses, this.tcx, trait_item_args)) {
    const clause = Unnormalized.skip_norm_wip(clause_);
    if (IsSuggestable.is_suggestable(clause, this.tcx, false, fold_Clause)) {
      trait_predicates.push(display_Clause(clause));
    } else {
      return;
    }
  }

  const generics = this.tcx.hir_get_generics(impl_item_def_id);
  if (generics === undefined) {
    return;
  }

  let suggestion: WhereClauseSuggestions;
  if (trait_predicates.length === 0) {
    suggestion = { $: "Remove", span: generics.where_clause_span };
  } else {
    const space = Span.is_empty(generics.where_clause_span) ? " " : "";
    suggestion = {
      $: "CopyPredicates",
      span: generics.where_clause_span,
      space,
      trait_predicates: trait_predicates.join(", "),
    };
  }
  err.subdiagnostic(diagnostics().WhereClauseSuggestions_subdiagnostic(suggestion));
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:644 report_placeholder_failure
TypeErrCtxt.prototype.report_placeholder_failure = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  placeholder_origin: SubregionOrigin,
  sub: Region,
  sup: Region,
): Diag {
  // I can't think how to do better than this right now. -nikomatsakis
  // debug!(?placeholder_origin, ?sub, ?sup, "report_placeholder_failure");
  const is_where_clause = (c: ObligationCauseCode): boolean => c.$ === "WhereClause" || c.$ === "WhereClauseInExpr";
  if (placeholder_origin.$ === "Subtype" && is_where_clause(ObligationCauseCode.peel_derives(placeholder_origin._0.cause.code_()))) {
    const trace = placeholder_origin._0;
    // Hack to get around the borrow checker because trace.cause has an `Rc`.
    const code = ObligationCauseCode.peel_derives(trace.cause.code_());
    if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
      const span = code._1;
      let err = this.report_concrete_failure(generic_param_scope, placeholder_origin, sub, sup);
      if (!Span.is_dummy(span)) {
        err = err.with_span_note(span, "the lifetime requirement is introduced here");
      }
      return err;
    } else {
      return unreachable("control flow ensures we have a `BindingObligation` or `WhereClauseInExpr` here...");
    }
  } else if (placeholder_origin.$ === "Subtype") {
    const trace = placeholder_origin._0;
    const terr: TypeError = { $: "RegionsPlaceholderMismatch" };
    return this.report_and_explain_type_error(trace, this.tcx.param_env(generic_param_scope) as ParamEnv, terr);
  } else {
    return this.report_concrete_failure(generic_param_scope, placeholder_origin, sub, sup);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:703 report_generic_bound_failure
TypeErrCtxt.prototype.report_generic_bound_failure = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  span: Span,
  origin: SubregionOrigin | undefined,
  bound_kind: GenericKind,
  sub: Region,
): ErrorGuaranteed {
  return this.construct_generic_bound_failure(generic_param_scope, span, origin, bound_kind, sub).emit_err();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:715 construct_generic_bound_failure
TypeErrCtxt.prototype.construct_generic_bound_failure = function (
  this: TypeErrCtxt,
  generic_param_scope_: LocalDefId,
  span: Span,
  origin: SubregionOrigin | undefined,
  bound_kind: GenericKind,
  sub: Region,
): Diag {
  if (origin !== undefined && origin.$ === "CompareImplItemObligation") {
    const { span, impl_item_def_id, trait_item_def_id } = origin;
    return this.report_extra_impl_obligation(
      span,
      impl_item_def_id,
      trait_item_def_id,
      `\`${display_GenericKind(bound_kind)}: ${display_Region(sub)}\``,
    );
  }

  let labeled_user_string: string;
  switch (bound_kind.$) {
    case "Param":
      labeled_user_string = `the parameter type \`${display_GenericKind(bound_kind)}\``;
      break;
    case "Placeholder":
      labeled_user_string = `the placeholder type \`${display_GenericKind(bound_kind)}\``;
      break;
    case "Alias": {
      const p = bound_kind._0;
      switch (p.kind.$) {
        case "Projection":
        case "Inherent":
          labeled_user_string = `the associated type \`${display_GenericKind(bound_kind)}\``;
          break;
        case "Free":
          labeled_user_string = `the type alias \`${display_GenericKind(bound_kind)}\``;
          break;
        case "Opaque":
          labeled_user_string = `the opaque type \`${display_GenericKind(bound_kind)}\``;
          break;
      }
      break;
    }
  }

  const err = this.tcx.dcx().struct_span_err(span, `${labeled_user_string} may not live long enough`);
  const sk = sub.kind().$;
  err.code((sk === "ReEarlyParam" || sk === "ReLateParam") && sub.is_named(this.tcx) ? E0309 : sk === "ReStatic" ? E0310 : E0311);

  /* '_explain: */ {
    let description: string;
    let span_: Span | undefined;
    switch (sub.kind().$) {
      case "ReEarlyParam":
      case "ReLateParam":
      case "ReStatic":
        [description, span_] = msg_span_from_named_region(this.tcx, generic_param_scope_, sub, span);
        break;
      default:
        [description, span_] = [`lifetime \`${display_Region(sub)}\``, span];
        break;
    }
    const prefix = `${labeled_user_string} must be valid for `;
    label_msg_span(err, prefix, description, span_, "...");
    if (origin !== undefined) {
      this.note_region_origin(err, origin);
    }
  }

  suggestion: {
    const msg_ = "consider adding an explicit lifetime bound";

    const d_pair = fold_tuple2(fold_GenericKind, fold_Region);
    if (
      TypeVisitableExt.has_infer_regions([bound_kind, sub], d_pair) ||
      TypeVisitableExt.has_placeholders([bound_kind, sub], d_pair) ||
      !IsSuggestable.is_suggestable(bound_kind, this.tcx, false, fold_GenericKind)
    ) {
      const lt_name = display_Symbol(sub.get_name_or_anon(this.tcx));
      err.help(`${msg_} \`${display_GenericKind(bound_kind)}: ${lt_name}\`...`);
      break suggestion;
    }

    let generic_param_scope = generic_param_scope_;
    while (this.tcx.def_kind(generic_param_scope).$ === "OpaqueTy") {
      generic_param_scope = this.tcx.local_parent(generic_param_scope);
    }

    // type_param_sugg_span is (span, has_bounds, needs_parentheses)
    let type_scope: LocalDefId;
    let type_param_sugg_span: [Span, LifetimeSuggestion] | undefined;
    if (bound_kind.$ === "Param") {
      const param = bound_kind._0;
      const generics = this.tcx.generics_of(generic_param_scope) as Generics;
      const type_param = generics.type_param(param, this.tcx);
      const def_id = type_param.def_id.expect_local();
      const scope = this.tcx.local_def_id_to_hir_id(def_id).owner.def_id;
      // Get the `hir::Param` to verify whether it already has any bounds.
      // We do this to avoid suggesting code that ends up as `T: 'a'b`,
      // instead we suggest `T: 'a + 'b` in that case.
      const hir_generics = unwrap(this.tcx.hir_get_generics(scope));
      let sugg_span: [Span, LifetimeSuggestion] | undefined;
      const b = hir_generics.bounds_span_for_suggestions(def_id);
      if (b !== undefined) {
        const [span, open_paren_sp] = b;
        sugg_span = [span, { $: "NeedsPlus", _0: open_paren_sp }];
      } else if (generics.has_self && param.index === 0) {
        // If `param` corresponds to `Self`, no usable suggestion span.
        sugg_span = undefined;
      } else {
        let colon_flag = false;
        let span: Span;
        const hparam = hir_generics.params.find((param) => param.def_id === def_id);
        if (hparam !== undefined && hparam.name.$ === "Plain") {
          const ident = hparam.name._0;
          if (hparam.colon_span !== undefined) {
            const sp = hparam.colon_span;
            colon_flag = true;
            span = Span.shrink_to_hi(sp);
          } else {
            span = Span.shrink_to_hi(ident.span);
          }
        } else {
          const span_ = this.tcx.def_span(def_id);
          span = Span.shrink_to_hi(span_);
        }
        sugg_span = colon_flag ? [span, { $: "HasColon" }] : [span, { $: "NeedsColon" }];
      }
      [type_scope, type_param_sugg_span] = [scope, sugg_span];
    } else {
      [type_scope, type_param_sugg_span] = [generic_param_scope, undefined];
    }
    let suggestion_scope: LocalDefId;
    {
      let lifetime_scope: LocalDefId;
      if (sub.kind().$ === "ReStatic") {
        lifetime_scope = CRATE_DEF_ID;
      } else {
        const info = this.tcx.is_suitable_region(generic_param_scope, sub);
        lifetime_scope = info !== undefined ? info.scope : generic_param_scope;
      }
      suggestion_scope = this.tcx.is_descendant_of(type_scope, lifetime_scope) ? type_scope : lifetime_scope;
    }

    const suggs: [Span, string][] = [];
    const lt_name = this.suggest_name_region(generic_param_scope, sub, suggs);

    let p;
    let rpitit;
    if (type_param_sugg_span !== undefined && suggestion_scope === type_scope) {
      const [sp, suggestion_type] = type_param_sugg_span;
      switch (suggestion_type.$) {
        case "NeedsPlus": {
          const open_paren_sp = suggestion_type._0;
          const suggestion = ` + ${lt_name}`;
          if (open_paren_sp !== undefined) {
            suggs.push([open_paren_sp, "("]);
            suggs.push([sp, `)${suggestion}`]);
          } else {
            suggs.push([sp, suggestion]);
          }
          break;
        }
        case "NeedsColon":
          suggs.push([sp, `: ${lt_name}`]);
          break;
        case "HasColon":
          suggs.push([sp, ` ${lt_name}`]);
          break;
      }
    } else if (
      bound_kind.$ === "Alias" &&
      (p = bound_kind._0).kind.$ === "Projection" &&
      this.tcx.def_kind(p.kind.def_id).$ === "AssocTy" &&
      (rpitit = this.tcx.opt_rpitit_info(p.kind.def_id)) !== undefined &&
      rpitit.$ === "Trait"
    ) {
      // The lifetime found in the `impl` is longer than the one on the RPITIT.
      // Do not suggest `<Type as Trait>::{opaque}: 'static`.
    } else {
      const generics = this.tcx.hir_get_generics(suggestion_scope);
      if (generics !== undefined) {
        const pred = `${display_GenericKind(bound_kind)}: ${lt_name}`;
        const suggestion = `${generics.add_where_or_trailing_comma()} ${pred}`;
        suggs.push([generics.tail_span_for_predicate_suggestion(), suggestion]);
      } else {
        const consider = `${msg_} \`${display_GenericKind(bound_kind)}: ${display_Region(sub)}\`...`;
        err.help(consider);
      }
    }

    if (!(suggs.length === 0)) {
      err.multipart_suggestion(
        msg_,
        suggs,
        Applicability.MaybeIncorrect, // Issue #41966
      );
    }
  }

  const generic_param_scope = generic_param_scope_;
  const ty = sub.kind().$ === "ReStatic" ? boxed_dyn_trait_with_implicit_static(this.tcx, generic_param_scope, span) : undefined;
  if (ty !== undefined) {
    // Explicitly look for `-> Box<dyn Trait>` to point at it as the *likely* source of
    // the `'static` lifetime requirement.
    err.span_label(ty.span, "this `dyn Trait` has an implicit `'static` lifetime bound");
  }

  return err;
};

/** PORT: the `let`-chain condition of construct_generic_bound_failure (region.rs:892..918) after `sub.kind() == ReStatic`;
 *  returns the `ty` it binds (the `dyn Trait` argument of `Box`) when every pattern matches. */
function boxed_dyn_trait_with_implicit_static(tcx: TyCtxt, generic_param_scope: LocalDefId, span: Span): hir.Ty | undefined {
  const node = tcx.hir_get_if_local(LocalDefId.to_def_id(generic_param_scope));
  if (node === undefined) return undefined;
  let sig: hir.FnSig;
  let body: hir.BodyId;
  if (node.$ === "Item" && node._0.kind.$ === "Fn" && node._0.kind.has_body) {
    [sig, body] = [node._0.kind.sig, node._0.kind.body];
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Provided") {
    [sig, body] = [node._0.kind._0, node._0.kind._1._0];
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    [sig, body] = [node._0.kind._0, node._0.kind._1];
  } else {
    return undefined;
  }
  const expr_node = tcx.hir_node(body.hir_id);
  if (expr_node.$ !== "Expr") return undefined;
  const expr = expr_node._0;
  if (expr.kind.$ !== "Block") return undefined;
  const block = expr.kind._0;
  const tail = block.expr;
  if (tail === undefined) return undefined;
  if (tail.span !== span) return undefined;
  if (sig.decl.output.$ !== "Return") return undefined;
  const ty = sig.decl.output._0;
  if (ty.kind.$ !== "Path") return undefined;
  const path_ = ty.kind._0;
  if (path_.$ !== "Resolved" || path_._0 !== undefined) return undefined;
  const path = path_._1;
  if (path.res.$ !== "Def") return undefined;
  const def_id = path.res._1;
  const owned_box = tcx.lang_items().owned_box();
  if (owned_box === undefined || !DefId_eq(def_id, owned_box)) return undefined;
  if (path.segments.length !== 1) return undefined;
  const segment = path.segments[0]!;
  const args = segment.args;
  if (args === undefined) return undefined;
  if (args.args.length !== 1) return undefined;
  const arg = args.args[0]!;
  if (arg.$ !== "Type") return undefined;
  const ty2 = arg._0;
  if (ty2.kind.$ !== "TraitObject") return undefined;
  const tagged_ref = ty2.kind._1;
  if (tagged_ref.pointer().kind.$ !== "ImplicitObjectLifetimeDefault") return undefined;
  return ty2;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:937 LifetimeReplaceVisitor
// PORT: the struct and its `Visitor` impl are local to `suggest_name_region` upstream.
class LifetimeReplaceVisitor extends hir.intravisit.Visitor {
  constructor(
    public needle: hir.LifetimeKind,
    public new_lt: string,
    public add_lt_suggs: [Span, string][],
  ) {
    super();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:944 visit_lifetime
  override visit_lifetime(lt: hir.Lifetime): undefined {
    if (lt.kind.$ === this.needle.$ && (lt.kind.$ !== "Param" || (this.needle.$ === "Param" && lt.kind._0 === this.needle._0))) {
      this.add_lt_suggs.push(lt.suggestion(this.new_lt));
    }
    return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:931 suggest_name_region
TypeErrCtxt.prototype.suggest_name_region = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  lifetime: Region,
  add_lt_suggs: [Span, string][],
): string {
  let lifetime_def_id: LocalDefId;
  let lifetime_scope: LocalDefId;
  const info = this.tcx.is_suitable_region(generic_param_scope, lifetime);
  if (info !== undefined && !lifetime.is_named(this.tcx)) {
    [lifetime_def_id, lifetime_scope] = [info.region_def_id.expect_local(), info.scope];
  } else {
    return display_Symbol(lifetime.get_name_or_anon(this.tcx));
  }

  let new_lt: string;
  {
    const generics = this.tcx.generics_of(lifetime_scope) as Generics;
    const used_names: Symbol[] = [];
    for (let g: Generics | undefined = generics; g !== undefined; g = g.parent !== undefined ? (this.tcx.generics_of(g.parent) as Generics) : undefined) {
      for (const p of g.own_params) {
        if (p.kind.$ === "Lifetime") used_names.push(p.name);
      }
    }
    const hir_id = this.tcx.local_def_id_to_hir_id(lifetime_scope);
    // consider late-bound lifetimes ...
    for (const p of this.tcx.late_bound_vars(hir_id)) {
      if (p.$ === "Region") {
        const name = BoundRegionKind.get_name(p._0, this.tcx);
        if (name !== undefined) used_names.push(name);
      }
    }
    let found: string | undefined = undefined;
    for (let c = 0x61; c <= 0x7a; c++) {
      const candidate = `'${String.fromCharCode(c)}`;
      if (!used_names.some((e) => Symbol.as_str(e) === candidate)) {
        found = candidate;
        break;
      }
    }
    new_lt = found ?? "'lt";
  }

  const visitor = new LifetimeReplaceVisitor({ $: "Param", _0: lifetime_def_id }, new_lt, add_lt_suggs);
  const owner = this.tcx.expect_hir_owner_node(lifetime_scope);
  switch (owner.$) {
    case "Item":
      visitor.visit_item(owner._0);
      break;
    case "ForeignItem":
      visitor.visit_foreign_item(owner._0);
      break;
    case "ImplItem":
      visitor.visit_impl_item(owner._0);
      break;
    case "TraitItem":
      visitor.visit_trait_item(owner._0);
      break;
    case "Crate":
      return bug("OwnerNode::Crate doesn't not have generics");
    case "Synthetic":
      return unreachable();
  }

  const ast_generics = unwrap(this.tcx.hir_get_generics(lifetime_scope));
  const span = ast_generics.span_for_lifetime_suggestion();
  const sugg: [Span, string] = span !== undefined ? [span, `${new_lt}, `] : [ast_generics.span, `<${new_lt}>`];
  add_lt_suggs.push(sugg);

  return new_lt;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1005 report_sub_sup_conflict
TypeErrCtxt.prototype.report_sub_sup_conflict = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  var_origin: RegionVariableOriginT,
  sub_origin: SubregionOrigin,
  sub_region: Region,
  sup_origin: SubregionOrigin,
  sup_region: Region,
): ErrorGuaranteed {
  const err = this.report_inference_failure(var_origin);

  note_and_explain_region(this.tcx, err, generic_param_scope, "first, the lifetime cannot outlive ", sup_region, "...", undefined);

  // debug!("report_sub_sup_conflict: var_origin={:?}", var_origin);
  // debug!("report_sub_sup_conflict: sub_region={:?}", sub_region);
  // debug!("report_sub_sup_conflict: sub_origin={:?}", sub_origin);
  // debug!("report_sub_sup_conflict: sup_region={:?}", sup_region);
  // debug!("report_sub_sup_conflict: sup_origin={:?}", sup_origin);

  if (sup_origin.$ === "Subtype" && sub_origin.$ === "Subtype") {
    const sup_trace = sup_origin._0;
    const sub_trace = sub_origin._0;
    const sup_vs = this.values_str(sup_trace.values, sup_trace.cause, err.long_ty_path());
    const sub_vs = sup_vs !== undefined ? this.values_str(sub_trace.values, sub_trace.cause, err.long_ty_path()) : undefined;
    if (sup_vs !== undefined && sub_vs !== undefined) {
      const [sup_expected, sup_found] = sup_vs;
      const [sub_expected, sub_found] = sub_vs;
      if (DiagStyledString_eq(sub_expected, sup_expected) && DiagStyledString_eq(sub_found, sup_found)) {
        note_and_explain_region(this.tcx, err, generic_param_scope, "...but the lifetime must also be valid for ", sub_region, "...", undefined);
        err.span_note(sup_trace.cause.span, `...so that the ${sup_trace.cause.as_requirement_str()}`);

        err.note_expected_found("", sup_expected, "", sup_found);
        return sub_region.is_error() || sup_region.is_error() ? err.delay_as_bug() : err.emit_err();
      }
    }
  }

  this.note_region_origin(err, sup_origin);

  note_and_explain_region(this.tcx, err, generic_param_scope, "but, the lifetime must be valid for ", sub_region, "...", undefined);

  this.note_region_origin(err, sub_origin);
  if (sub_region.is_error() || sup_region.is_error()) {
    return err.delay_as_bug();
  } else {
    return err.emit_err();
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1083 report_inference_failure
TypeErrCtxt.prototype.report_inference_failure = function (this: TypeErrCtxt, var_origin: RegionVariableOriginT): Diag {
  const br_string = (br: BoundRegionKind): string => {
    let s = br.$ === "Named" ? display_Symbol(this.tcx.item_name(br._0)) : "";
    if (!(s === "")) {
      s += " ";
    }
    return s;
  };
  let var_description: string;
  switch (var_origin.$) {
    case "Misc":
      var_description = "";
      break;
    case "PatternRegion":
      var_description = " for pattern";
      break;
    case "BorrowRegion":
      var_description = " for borrow expression";
      break;
    case "Autoref":
      var_description = " for autoref";
      break;
    case "Coercion":
      var_description = " for automatic coercion";
      break;
    case "BoundRegion": {
      const [br, time] = [var_origin._1, var_origin._2 as BoundRegionConversionTime];
      switch (time.$) {
        case "FnCall":
          var_description = ` for lifetime parameter ${br_string(br)}in function call`;
          break;
        case "HigherRankedType":
          var_description = ` for lifetime parameter ${br_string(br)}in generic type`;
          break;
        case "AssocTypeProjection": {
          const def_id = time._0;
          var_description = ` for lifetime parameter ${br_string(br)}in trait containing associated type \`${display_Symbol(
            AssocItem.name(this.tcx.associated_item(def_id) as AssocItem),
          )}\``;
          break;
        }
      }
      break;
    }
    case "RegionParameterDefinition": {
      const name = var_origin._1;
      var_description = ` for lifetime parameter \`${display_Symbol(name)}\``;
      break;
    }
    case "UpvarRegion": {
      const upvar_id = var_origin._0;
      const var_name = this.tcx.hir_name(upvar_id.var_path.hir_id);
      var_description = ` for capture of \`${display_Symbol(var_name)}\` by closure`;
      break;
    }
    case "Nll":
      return bug("NLL variable found in lexical phase");
  }

  return struct_span_code_err(
    this.dcx(),
    RegionVariableOrigin.span(var_origin),
    E0803,
    `cannot infer an appropriate lifetime${var_description} due to conflicting requirements`,
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1145 note_and_explain_region
export function note_and_explain_region(
  tcx: TyCtxt,
  err: Diag,
  generic_param_scope: LocalDefId,
  prefix: string,
  region: Region,
  suffix: string,
  alt_span: Span | undefined,
): void {
  let description: string;
  let span: Span | undefined;
  switch (region.kind().$) {
    case "ReEarlyParam":
    case "ReLateParam":
    case "RePlaceholder":
    case "ReStatic":
      [description, span] = msg_span_from_named_region(tcx, generic_param_scope, region, alt_span);
      break;

    case "ReError":
      return;

    // FIXME(#125431): `ReVar` shouldn't reach here.
    case "ReVar":
      [description, span] = [`lifetime \`${display_Region(region)}\``, alt_span];
      break;

    case "ReBound":
    case "ReErased":
      return bug(`unexpected region for note_and_explain_region: ${debug_Region(region, PLAIN)}`);
  }

  emit_msg_span(err, prefix, description, span, suffix);
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1172 explain_free_region
export function explain_free_region(tcx: TyCtxt, err: Diag, generic_param_scope: LocalDefId, prefix: string, region: Region, suffix: string): void {
  const [description, span] = msg_span_from_named_region(tcx, generic_param_scope, region, undefined);

  label_msg_span(err, prefix, description, span, suffix);
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1185 msg_span_from_named_region
export function msg_span_from_named_region(
  tcx: TyCtxt,
  generic_param_scope: LocalDefId,
  region: Region,
  alt_span: Span | undefined,
): [string, Span | undefined] {
  const k = region.kind();
  switch (k.$) {
    case "ReEarlyParam": {
      const br = k._0;
      const param_def_id = (tcx.generics_of(generic_param_scope) as Generics).region_param(br, tcx).def_id;
      const span = tcx.def_span(param_def_id);
      const text = EarlyParamRegion.is_named(br) ? `the lifetime \`${display_Symbol(br.name)}\` as defined here` : "the anonymous lifetime as defined here";
      return [text, span];
    }
    case "ReLateParam": {
      const fr = k._0;
      let found;
      if (!LateParamRegionKind.is_named(fr.kind, tcx) && (found = find_anon_type_mod().find_anon_type(tcx, generic_param_scope, region)) !== undefined) {
        const [ty, _] = found;
        return ["the anonymous lifetime defined here", ty.span];
      } else {
        switch (fr.kind.$) {
          case "Named": {
            const param_def_id = fr.kind._0;
            const name = tcx.item_name(param_def_id);
            const span = tcx.def_span(param_def_id);
            const text = name === kw.UnderscoreLifetime ? "the anonymous lifetime as defined here" : `the lifetime \`${display_Symbol(name)}\` as defined here`;
            return [text, span];
          }
          case "Anon":
            return ["the anonymous lifetime as defined here", tcx.def_span(generic_param_scope)];
          default:
            return [`the lifetime \`${display_Region(region)}\` as defined here`, tcx.def_span(generic_param_scope)];
        }
      }
    }
    case "ReStatic":
      return ["the static lifetime", alt_span];
    case "RePlaceholder": {
      const bound_kind = k._0.bound.kind;
      if (bound_kind.$ === "Named") {
        const def_id = bound_kind._0;
        return [`the lifetime \`${display_Symbol(tcx.item_name(def_id))}\` as defined here`, tcx.def_span(def_id)];
      } else if (bound_kind.$ === "Anon") {
        return ["an anonymous lifetime", undefined];
      }
      return bug(debug_Region(region, PLAIN));
    }
    default:
      return bug(debug_Region(region, PLAIN));
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1246 emit_msg_span
export function emit_msg_span(err: Diag, prefix: string, description: string, span: Span | undefined, suffix: string): void {
  const message = `${prefix}${description}${suffix}`;

  if (span !== undefined) {
    err.span_note(span, message);
  } else {
    err.note(message);
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1262 label_msg_span
export function label_msg_span(err: Diag, prefix: string, description: string, span: Span | undefined, suffix: string): void {
  const message = `${prefix}${description}${suffix}`;

  if (span !== undefined) {
    err.span_label(span, message);
  } else {
    err.note(message);
  }
}

// #[instrument(level = "trace", skip(infcx))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1279 unexpected_hidden_region_diagnostic
export function unexpected_hidden_region_diagnostic(
  infcx: InferCtxt,
  generic_param_scope: LocalDefId,
  span: Span,
  hidden_ty_: Ty,
  hidden_region: Region,
  opaque_ty_key: OpaqueTypeKey,
): Diag {
  const tcx = infcx.tcx;
  const err = infcx.dcx().create_err(
    diagnostics().OpaqueCapturesLifetime_diagnostic({
      span,
      opaque_ty: TyC.new_opaque(tcx, "No", LocalDefId.to_def_id(opaque_ty_key.def_id), opaque_ty_key.args),
      opaque_ty_span: tcx.def_span(opaque_ty_key.def_id),
    }),
  );
  const highlight = RegionHighlightMode.default();
  highlight.keep_regions = true;
  const { Highlighted, Highlighted_into_diag_arg } = placeholder_error();
  const hidden_ty = new Highlighted(tcx, highlight, hidden_ty_, Namespace.TypeNS);
  // PORT: `format!("{hidden_ty}")` is `Highlighted`'s `Display` (placeholder_error.rs:50, lane errrep-nice-region); its
  // `IntoDiagArg` (placeholder_error.rs:35) is `DiagArgValue::Str(self.to_string())`, so the string is read from it.
  const display_hidden_ty = (): string => {
    const v = Highlighted_into_diag_arg(hidden_ty, { value: undefined });
    return v.$ === "Str" ? v._0 : unreachable();
  };

  // Explain the region we are capturing.
  switch (hidden_region.kind().$) {
    case "ReEarlyParam":
    case "ReLateParam":
    case "ReStatic":
      // Assuming regionck succeeded (*), we ought to always be
      // capturing *some* region from the fn header, and hence it
      // ought to be free. So under normal circumstances, we will go
      // down this path which gives a decent human readable
      // explanation.
      //
      // (*) if not, the `tainted_by_errors` field would be set to
      // `Some(ErrorGuaranteed)` in any case, so we wouldn't be here at all.
      explain_free_region(tcx, err, generic_param_scope, `hidden type \`${display_hidden_ty()}\` captures `, hidden_region, "");
      if (tcx.is_suitable_region(generic_param_scope, hidden_region) !== undefined) {
        suggest_precise_capturing(tcx, opaque_ty_key.def_id, hidden_region, err);
      }
      break;
    case "RePlaceholder":
      explain_free_region(tcx, err, generic_param_scope, `hidden type \`${display_hidden_ty()}\` captures `, hidden_region, "");
      break;
    case "ReError":
      err.downgrade_to_delayed_bug();
      break;
    default:
      // Ugh. This is a painful case: the hidden region is not one
      // that we can easily summarize or explain. This can happen
      // in a case like
      // `tests/ui/multiple-lifetimes/ordinary-bounds-unsuited.rs`:
      //
      // ```
      // fn upper_bounds<'a, 'b>(a: Ordinary<'a>, b: Ordinary<'b>) -> impl Trait<'a, 'b> {
      //   if condition() { a } else { b }
      // }
      // ```
      //
      // Here the captured lifetime is the intersection of `'a` and
      // `'b`, which we can't quite express.

      // We can at least report a really cryptic error for now.
      note_and_explain_region(tcx, err, generic_param_scope, `hidden type \`${display_hidden_ty()}\` captures `, hidden_region, "", undefined);
      break;
  }

  return err;
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:1369 suggest_precise_capturing
export function suggest_precise_capturing(tcx: TyCtxt, opaque_def_id: LocalDefId, captured_lifetime: Region, diag: Diag): void {
  const { bounds, origin } = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(opaque_def_id));

  if (origin.$ !== "FnReturn") {
    return;
  }
  const fn_def_id = origin.parent;

  const new_lifetime = Symbol.intern(display_Region(captured_lifetime));

  let use_bound: [readonly hir.PreciseCapturingArg[], Span] | undefined = undefined;
  for (const bound of bounds) {
    if (bound.$ === "Use") {
      use_bound = [bound._0, bound._1];
      break;
    }
  }
  const D = diagnostics();
  if (use_bound !== undefined) {
    const [args, span_] = use_bound;
    // '_ is an elision marker, not a lifetime name, so it cannot appear twice in a
    // capture list. the branch for opaques with no use<..> yet already skips captured
    // lifetimes; do the same here to avoid suggesting use<'_, '_>.
    if (args.some((arg) => arg.$ === "Lifetime" && arg._0.ident.name === new_lifetime)) {
      return;
    }

    let last_lifetime_span: Span | undefined = undefined;
    for (let i = args.length - 1; i >= 0; i--) {
      const arg = args[i]!;
      if (arg.$ === "Lifetime") {
        last_lifetime_span = arg._0.ident.span;
        break;
      }
    }

    let first_param_span: Span | undefined = undefined;
    for (const arg of args) {
      if (arg.$ === "Param") {
        first_param_span = arg._0.ident.span;
        break;
      }
    }

    let span: Span;
    let pre: string;
    let post: string;
    if (last_lifetime_span !== undefined) {
      [span, pre, post] = [Span.shrink_to_hi(last_lifetime_span), ", ", ""];
    } else if (first_param_span !== undefined) {
      [span, pre, post] = [Span.shrink_to_lo(first_param_span), "", ", "];
    } else {
      // If we have no args, then have `use<>` and need to fall back to using
      // span math. This sucks, but should be reliable due to the construction
      // of the `use<>` span.
      [span, pre, post] = [Span.shrink_to_hi(Span.with_hi(span_, BytePos.sub(Span.hi(span_), BytePos.from_u32(1)))), "", ""];
    }

    diag.subdiagnostic(
      D.AddPreciseCapturing_subdiagnostic({
        $: "Existing",
        span,
        new_lifetime,
        pre,
        post,
      }),
    );
  } else {
    const captured_lifetimes = new Set<Symbol>();
    const captured_non_lifetimes = new Set<Symbol>();

    const variances = tcx.variances_of(LocalDefId.to_def_id(opaque_def_id));
    let generics = tcx.generics_of(opaque_def_id) as Generics;
    const synthetics: [Span, Symbol][] = [];
    for (;;) {
      for (const param of generics.own_params) {
        if (variances[param.index] === "Bivariant") {
          continue;
        }

        switch (param.kind.$) {
          case "Lifetime":
            captured_lifetimes.add(param.name);
            break;
          case "Type":
            if (param.kind.synthetic) {
              synthetics.push([tcx.def_span(param.def_id), param.name]);
              break;
            }
            captured_non_lifetimes.add(param.name);
            break;
          case "Const":
            captured_non_lifetimes.add(param.name);
            break;
        }
      }

      if (generics.parent !== undefined) {
        const parent = generics.parent;
        generics = tcx.generics_of(parent) as Generics;
      } else {
        break;
      }
    }

    // `!captured_lifetimes.insert(new_lifetime)`
    if (captured_lifetimes.has(new_lifetime)) {
      // Uh, strange. This lifetime appears to already be captured...
      return;
    }
    captured_lifetimes.add(new_lifetime);

    if (synthetics.length === 0) {
      const concatenated_bounds = [...captured_lifetimes, ...captured_non_lifetimes].map((sym) => display_Symbol(sym)).join(", ");

      diag.subdiagnostic(
        D.AddPreciseCapturing_subdiagnostic({
          $: "New",
          span: Span.shrink_to_hi(tcx.def_span(opaque_def_id)),
          new_lifetime,
          concatenated_bounds,
        }),
      );
    } else {
      const next_fresh_param = (): Symbol => {
        for (const c of ["T", "U", "V", "W", "X", "Y", "A", "B", "C"]) {
          const s = sym.character(c.charCodeAt(0));
          if (!captured_non_lifetimes.has(s)) {
            captured_non_lifetimes.add(s);
            return s;
          }
        }
        for (let i = 0; ; i++) {
          const s = Symbol.intern(`T${i}`);
          if (!captured_non_lifetimes.has(s)) {
            captured_non_lifetimes.add(s);
            return s;
          }
        }
      };

      let new_params = "";
      const suggs: [Span, string][] = [];
      const apit_spans: Span[] = [];

      for (let i = 0; i < synthetics.length; i++) {
        const [span, name] = synthetics[i]!;
        apit_spans.push(span);

        const fresh_param = next_fresh_param();

        // Suggest renaming.
        suggs.push([span, display_Symbol(fresh_param)]);

        // Super jank. Turn `impl Trait` into `T: Trait`.
        //
        // This currently involves stripping the `impl` from the name of
        // the parameter, since APITs are always named after how they are
        // rendered in the AST. This sucks! But to recreate the bound list
        // from the APIT itself would be miserable, so we're stuck with
        // this for now!
        if (i > 0) {
          new_params += ", ";
        }
        let name_as_bounds = Symbol.as_str(name);
        while (name_as_bounds.startsWith("impl")) name_as_bounds = name_as_bounds.slice("impl".length);
        name_as_bounds = trim_start(name_as_bounds);
        new_params += Symbol.as_str(fresh_param);
        new_params += ": ";
        new_params += name_as_bounds;
      }

      const generics = tcx.hir_get_generics(fn_def_id);
      if (generics === undefined) {
        // This shouldn't happen, but don't ICE.
        return;
      }

      // Add generics or concatenate to the end of the list.
      const params_span = generics.span_for_param_suggestion();
      suggs.push(params_span !== undefined ? [params_span, `, ${new_params}`] : [generics.span, `<${new_params}>`]);

      const concatenated_bounds = [...captured_lifetimes, ...captured_non_lifetimes].map((sym) => display_Symbol(sym)).join(", ");

      suggs.push([Span.shrink_to_hi(tcx.def_span(opaque_def_id)), ` + use<${concatenated_bounds}>`]);

      diag.subdiagnostic(
        D.AddPreciseCapturingAndParams_subdiagnostic({
          suggs,
          new_lifetime,
          apit_spans,
        }),
      );
    }
  }
}

/** `#[derive(PartialEq)]` of `DiagStyledString` / `StringPart` (rustc_errors diagnostic.rs:96, :166). */
function DiagStyledString_eq(a: DiagStyledString, b: DiagStyledString): boolean {
  return a._0.length === b._0.length && a._0.every((p, i) => p.content === b._0[i]!.content && p.style === b._0[i]!.style);
}

/** `str::trim_start` (Unicode `White_Space`). */
function trim_start(s: string): string {
  // PORT: JS `trimStart` strips `White_Space` plus U+FEFF; Rust's does not strip U+FEFF.
  let i = 0;
  while (i < s.length && s.charCodeAt(i) !== 0xfeff && /\s/u.test(s[i]!)) i++;
  return s.slice(i);
}
