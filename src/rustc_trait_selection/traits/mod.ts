//! Trait Resolution. See the [rustc dev guide] for more information on how this works.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html
//
// Port of compiler/rustc_trait_selection/src/traits/mod.rs (lane trait-sel-traits-a). The types are generated
// (mod.gen.ts, set `rustc_trait_selection_traits_a`); `FulfillmentError`'s methods are on its prototype, the manual
// `Debug for FulfillmentErrorCode` is `debug_FulfillmentErrorCode` below.
//
// PORT: the module list. Of the `mod` declarations, this lane ports engine, misc, normalize, outlives_bounds,
// structural_normalize and util; the others belong to other lanes (trait-sel-traits-b/-c, trait-sel-solve, wave 20)
// and are re-exported here when they land (root, at merge). The `pub use self::<other lane's module>::{..}`
// re-exports are kept as comments for the same reason.
//
// PORT (fn-local items): `struct ConstNormalizer` (in `normalize_param_env_or_error`), `struct
// ReplaceParamAndInferWithPlaceholder` and `struct ReferencesOnlyParentGenerics` are module-level classes next to
// their fn.
//
// Init order: the extension modules (normalize.ts, structural_normalize.ts, ...) assign onto rustc_infer's classes at
// load; ../lib.ts loads rustc_infer first. Other modules of this crate are read inside function bodies only.

import * as dyn_compatibility from "./dyn_compatibility.ts";
import * as specialize from "./specialize/mod.ts";
import { FulfillmentError } from "./mod.gen.ts";

export * from "./mod.gen.ts";

// pub mod auto_trait;
export * as auto_trait from "./auto_trait.ts";
// pub(crate) mod coherence;
// pub mod const_evaluatable;
export * as const_evaluatable from "./const_evaluatable.ts";
// mod dyn_compatibility;
// pub mod effects;
export * as effects from "./effects.ts";
// mod engine;
// mod fulfill;
import "./fulfill.ts";
// pub mod implied_outlives_bounds;
export * as implied_outlives_bounds from "./implied_outlives_bounds.ts";
// pub mod misc;
export * as misc from "./misc.ts";
// pub mod normalize;
export * as normalize from "./normalize.ts";
// pub mod outlives_bounds;
export * as outlives_bounds from "./outlives_bounds.ts";
// pub mod outlives_for_liveness;
export * as outlives_for_liveness from "./outlives_for_liveness.ts";
// pub mod project;
export * as project from "./project.ts";
// pub mod query;
export * as query from "./query/mod.ts";
// pub mod select;
export * as select from "./select/mod.ts";
// pub mod specialize;
export * as specialize from "./specialize/mod.ts";
// mod structural_normalize;
import "./structural_normalize.ts";
// pub mod util;
export * as util from "./util.ts";
// pub mod vtable;
export * as vtable from "./vtable.ts";
// pub mod wf;
export * as wf from "./wf.ts";

// `pub use rustc_infer::traits::*;`
export * from "../../rustc_infer/traits/mod.ts";
// `pub use self::coherence::{..}`
export {
  InCrate,
  IsFirstInputType,
  type OrphanCheckErr,
  OrphanCheckMode,
  type OverlapResult,
  type UncoveredTyParams,
  add_placeholder_note,
  orphan_check_trait_ref,
  overlapping_inherent_impls,
  overlapping_trait_impls,
} from "./coherence.ts";
// `pub use self::dyn_compatibility::{..}` (`DynCompatibilityViolation` is rustc_middle's, re-exported through
// `rustc_infer::traits::*` above)
export {
  dyn_compatibility_violations_for_assoc_item,
  hir_ty_lowering_dyn_compatibility_violations,
  is_vtable_safe_method,
} from "./dyn_compatibility.ts";
// `pub use self::engine::{FulfillmentEngine, ObligationCtxt};`
export { FulfillmentEngine, ObligationCtxt } from "./engine.ts";
// `pub use self::fulfill::{FulfillmentContext, OldSolverError, PendingPredicateObligation};`
export { FulfillmentContext, OldSolverError, type PendingPredicateObligation } from "./fulfill.ts";
// `pub use self::normalize::NormalizeExt;` (the methods are on `At.prototype`, normalize.ts)
// `pub use self::project::{normalize_inherent_projection, normalize_projection_term};`
export { normalize_inherent_projection, normalize_projection_term } from "./project.ts";
// `pub use self::select::{EvaluationCache, EvaluationResult, IntercrateAmbiguityCause, OverflowError, SelectionCache,
// SelectionContext};`
export { type EvaluationCache, EvaluationResult, IntercrateAmbiguityCause, OverflowError, type SelectionCache, SelectionContext } from "./select/mod.ts";
// `pub use self::specialize::specialization_graph::{FutureCompatOverlapError, FutureCompatOverlapErrorKind};`
export { type FutureCompatOverlapError, FutureCompatOverlapErrorKind } from "./specialize/specialization_graph.ts";
// `pub use self::specialize::{OverlapError, specialization_graph, translate_args, translate_args_with_cause};`
export { type OverlapError, specialization_graph, translate_args, translate_args_with_cause } from "./specialize/mod.ts";
// `pub use self::structural_normalize::StructurallyNormalizeExt;` (methods on `At.prototype`)
// `pub use self::util::{..}`
export {
  BoundVarReplacer,
  elaborate,
  expand_trait_aliases,
  impl_item_is_final,
  PlaceholderReplacer,
  sizedness_fast_path,
  supertrait_def_ids,
  supertraits,
  transitive_bounds_that_define_assoc_item,
  upcast_choices,
  with_replaced_escaping_bound_vars,
} from "./util.ts";

import { type InferCtxt } from "../../rustc_infer/decls.ts";
import type { FixupError } from "../../rustc_infer/infer/mod.ts";
import { display_FixupError } from "../../rustc_infer/infer/mod.ts";
import {
  fold_with_Obligation,
  Obligation,
  type PredicateObligation,
  type PredicateObligations,
  try_fold_with_Obligation,
  visit_with_Obligation,
} from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import { clone_ObligationCause, ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, Predicate } from "../../rustc_middle/ty/decls.ts";
import { BottomUpFolder } from "../../rustc_middle/ty/fold.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { type ParamEnv, ParamEnv as ParamEnvC, ParamEnv_eq, fold_with_ParamEnv, try_fold_with_ParamEnv, visit_with_ParamEnv } from "../../rustc_middle/ty/mod.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { InstantiatedClauses } from "../../rustc_middle/ty/mod.ts";
import {
  Clause_upcast_from_Binder_ClauseKind,
  Clause_upcast_from_TraitRef,
  fold_with_Predicate,
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_TraitRef,
  try_fold_with_Predicate,
  visit_with_Predicate,
} from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { ControlFlow, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { Binder, EarlyBinder, PlaceholderConst, PlaceholderType } from "../../rustc_type_ir/binder.ts";
import { AliasConst, AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import type { AnonConstKind, BoundVar as BoundVarT } from "../../rustc_type_ir/decls.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { Elaboratable_Clause } from "../../rustc_type_ir/elaborate.ts";
import { elaborate } from "./util.ts";
import {
  fold_tuple2,
  fold_Vec,
  type FallibleTypeFolder,
  type PredicateProxy,
  type TypeFoldable,
  type TypeFolder,
  TypeFolder_provided,
  set_aliases_to_non_rigid,
  set_opaques_to_non_rigid,
  set_type_aliases_to_rigid,
} from "../../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import { BoundVar, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { BoundConst } from "../../rustc_type_ir/binder.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { debug_vec, type Fmt, PLAIN, type Debug } from "../../std/fmt.ts";
import { assert, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { ObligationCtxt } from "./engine.ts";
import { debug_Obligation } from "../../rustc_infer/traits/mod.ts";
import { debug_SelectionError, type ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import { debug_MismatchedProjectionTypes } from "../../rustc_infer/traits/project.ts";
import { debug_ExpectedFound, debug_TypeError } from "../../rustc_type_ir/error.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Predicate } from "../../rustc_middle/ty/predicate.ts";
import type { BoundTy, BoundTyKind } from "../../rustc_type_ir/decls.ts";

// PORT: the derives of `FulfillmentError` (`TypeVisitable`) and `FulfillmentErrorCode` (`TypeVisitable`) reach the
// aliases `PredicateObligation` / `PredicateObligations`; their impls are the `Obligation` / `ThinVec` impls applied to
// `Predicate`'s (type_fold.json names these fns).
export function visit_with_PredicateObligation<R>(self: PredicateObligation, visitor: TypeVisitor<R>): R {
  return visit_with_Obligation(self, visitor, visit_with_Predicate);
}
export function try_fold_with_PredicateObligation<E>(self: PredicateObligation, folder: FallibleTypeFolder<E>): Result<PredicateObligation, E> {
  return try_fold_with_Obligation(self, folder, try_fold_with_Predicate);
}
export function fold_with_PredicateObligation(self: PredicateObligation, folder: TypeFolder): PredicateObligation {
  return fold_with_Obligation(self, folder, fold_with_Predicate);
}
export function visit_with_PredicateObligations<R>(self: PredicateObligations, visitor: TypeVisitor<R>): R {
  return fold_Vec(d_PredicateObligation).visit_with(self, visitor);
}
export function try_fold_with_PredicateObligations<E>(self: PredicateObligations, folder: FallibleTypeFolder<E>): Result<PredicateObligations, E> {
  return fold_Vec(d_PredicateObligation).try_fold_with(self, folder) as Result<PredicateObligations, E>;
}
export function fold_with_PredicateObligations(self: PredicateObligations, folder: TypeFolder): PredicateObligations {
  return fold_Vec(d_PredicateObligation).fold_with(self, folder) as PredicateObligations;
}
const d_PredicateObligation: TypeFoldable<PredicateObligation> = {
  visit_with: visit_with_PredicateObligation,
  try_fold_with: try_fold_with_PredicateObligation,
  fold_with: fold_with_PredicateObligation,
};

declare module "./mod.gen.ts" {
  interface FulfillmentError {
    is_true_error(): boolean;
  }
  namespace FulfillmentError {
    function new_(obligation: PredicateObligation, code: FulfillmentErrorCode, root_obligation: PredicateObligation): FulfillmentError;
    export { new_ as new };
  }
}

// ---- impl FulfillmentError -------------------------------------------------------------------------------------------

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:90 new
(FulfillmentError as unknown as { new: typeof FulfillmentError.new }).new = function (
  obligation: PredicateObligation,
  code: import("./mod.gen.ts").FulfillmentErrorCode,
  root_obligation: PredicateObligation,
): FulfillmentError {
  return new FulfillmentError(obligation, code, root_obligation);
};

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:98 is_true_error
FulfillmentError.prototype.is_true_error = function (this: FulfillmentError): boolean {
  switch (this.code.$) {
    case "Select":
    case "Project":
    case "Outlives":
    case "Subtype":
    case "ConstEquate":
      return true;
    case "Cycle":
    case "Ambiguity":
      return false;
  }
};

// ---- impl Debug for FulfillmentErrorCode -----------------------------------------------------------------------------

// PORT: `write!(f, "{e:?}")` formats with fresh options (`PLAIN`), as rustc_infer structural_impls.ts.
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:132 fmt
export const debug_FulfillmentErrorCode: Debug<import("./mod.gen.ts").FulfillmentErrorCode> = (self, _f: Fmt): string => {
  switch (self.$) {
    case "Select":
      return debug_SelectionError(self._0, PLAIN);
    case "Project":
      return debug_MismatchedProjectionTypes(self._0, PLAIN);
    case "Outlives":
      return "CodeOutlivesError";
    case "Subtype":
      return `CodeSubtypeError(${debug_ExpectedFound(self._0, PLAIN, debug_Ty)}, ${debug_TypeError(self._1, PLAIN)})`;
    case "ConstEquate":
      return `CodeConstEquateError(${debug_ExpectedFound(self._0, PLAIN, debug_Const)}, ${debug_TypeError(self._1, PLAIN)})`;
    case "Ambiguity":
      if (self.overflow === undefined) {
        return "Ambiguity";
      } else {
        const suggest_increasing_limit = self.overflow;
        return `Overflow(${suggest_increasing_limit})`;
      }
    case "Cycle":
      return `Cycle(${debug_vec(self._0, PLAIN, (o, f) => debug_Obligation(o, f, debug_Predicate))})`;
  }
};

// ---- impl SkipLeakCheck ----------------------------------------------------------------------------------------------

// PORT: the method of the generated fieldless enum is on the companion `SkipLeakCheck_` (PORTING §8: enum methods live
// on the companion; the generated companion is a frozen `as const` object, so the methods are a sibling object).
export const SkipLeakCheck_ = {
  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:165 is_yes
  is_yes(self: import("./mod.gen.ts").SkipLeakCheck): boolean {
    return self === "Yes";
  },
};

/// Creates predicate obligations from the generic bounds.
// #[instrument(level = "debug", skip(cause, param_env, normalize_clause))]
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:185 predicates_for_generics
export function* predicates_for_generics(
  cause: (idx: number, span: Span) => ObligationCause,
  normalize_clause: (clause: Unnormalized<Clause>) => Clause,
  param_env: ParamEnv,
  generic_bounds: InstantiatedClauses,
): Generator<PredicateObligation> {
  let idx = 0;
  for (const [clause, span] of generic_bounds.into_iter()) {
    yield new Obligation(cause(idx, span), param_env, normalize_clause(clause).as_predicate(), 0);
    idx++;
  }
}

/// Determines whether the type `ty` is known to meet `bound` and
/// returns true if so. Returns false if `ty` either does not meet
/// `bound` or is not known to meet bound (note that this is
/// conservative towards *no impl*, which is the opposite of the
/// `evaluate` methods).
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:204 type_known_to_meet_bound_modulo_regions
export function type_known_to_meet_bound_modulo_regions(infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId): boolean {
  const trait_ref = TraitRef.new(as_interner(infcx.tcx), def_id, [GenericArg.from_Ty(ty)]);
  return pred_known_to_hold_modulo_regions(infcx, param_env, trait_ref, Predicate_upcast_from_TraitRef);
}

/// FIXME(@lcnr): this function doesn't seem right and shouldn't exist?
///
/// Ping me on zulip if you want to use this method and need help with finding
/// an appropriate replacement.
// #[instrument(level = "debug", skip(infcx, param_env, pred), ret)]
// PORT: `pred: impl Upcast<TyCtxt, ty::Predicate>` is the value plus `upcast_from_P` (rustc_infer decls.ts).
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:219 pred_known_to_hold_modulo_regions
function pred_known_to_hold_modulo_regions<P>(
  infcx: InferCtxt,
  param_env: ParamEnv,
  pred: P,
  upcast_from_P: (from: P, tcx: TyCtxt) => Predicate,
): boolean {
  const obligation = Obligation.new(infcx.tcx, ObligationCause.dummy(), param_env, pred, upcast_from_P as (from: P, tcx: Interner) => Predicate);

  const result = infcx.evaluate_obligation_no_overflow(obligation);
  // debug!(?result);

  if (EvaluationResult.must_apply_modulo_regions(result)) {
    return true;
  } else if (EvaluationResult.may_apply(result) && !infcx.next_trait_solver()) {
    // Sometimes obligations are ambiguous because the recursive evaluator
    // is not smart enough, so we fall back to fulfillment when we're not certain
    // that an obligation holds or not. Even still, we must make sure that
    // the we do no inference in the process of checking this obligation.
    const d_goal = fold_tuple2(fold_Predicate, d_ParamEnv);
    const goal = infcx.deeply_resolve_ignoring_regions<[Predicate, ParamEnv]>([obligation.predicate, obligation.param_env], d_goal);
    return infcx.probe((_) => {
      const ocx = ObligationCtxt.new(infcx);
      ocx.register_obligation(obligation);

      const errors = ocx.evaluate_obligations_error_on_ambiguity();
      switch (errors.$) {
        // Only known to hold if we did no inference.
        case "NoErrors": {
          const resolved = infcx.deeply_resolve_ignoring_regions(goal, d_goal);
          return resolved[0] === goal[0] && ParamEnv_eq(resolved[1], goal[1]);
        }

        case "HasErrors": {
          // debug!(?errors);
          return false;
        }
      }
    });
  } else {
    return false;
  }
}

/** The derived `TypeFoldable` of `ParamEnv` (rustc_middle ty/mod.ts) as a D4 descriptor. */
const d_ParamEnv: TypeFoldable<ParamEnv> = {
  visit_with: visit_with_ParamEnv,
  try_fold_with: try_fold_with_ParamEnv,
  fold_with: fold_with_ParamEnv,
};

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:258 set_projection_term_to_non_rigid
function* set_projection_term_to_non_rigid(tcx: TyCtxt, predicates: Iterable<Clause>): Generator<Clause> {
  for (const clause of predicates) {
    const kind = Binder.skip_binder(clause.kind());
    if (kind.$ === "Projection") {
      const projection_pred = kind._0;
      yield Clause_upcast_from_Binder_ClauseKind(
        Binder.rebind(clause.kind(), {
          $: "Projection",
          _0: {
            projection_term: projection_pred.projection_term,
            term: Unnormalized.skip_norm_wip(set_aliases_to_non_rigid(tcx, projection_pred.term, fold_Term())),
          },
        }),
        tcx,
      );
    } else {
      yield clause;
    }
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:282 replace_infer_and_non_rigid_alias_with_error
function replace_infer_and_non_rigid_alias_with_error<T>(
  infcx: InferCtxt,
  value: T,
  guar: ErrorGuaranteed,
  replace_regions: import("./mod.gen.ts").ReplaceRegions,
  d_T: TypeFoldable<T>,
): T {
  const tcx = infcx.tcx;
  return d_T.fold_with(
    value,
    new BottomUpFolder(
      tcx,
      (ty_) => {
        const ty = infcx.shallow_resolve(ty_);
        const k = ty.kind();
        if (k.$ === "Infer" && (k._0.$ === "TyVar" || k._0.$ === "IntVar" || k._0.$ === "FloatVar")) {
          return Ty.new_error(tcx, guar);
        } else if (k.$ === "Alias" && k._0 === "No" && tcx.next_trait_solver_globally()) {
          return Ty.new_error(tcx, guar);
        } else {
          return ty;
        }
      },
      (lt) => {
        // We can't resolve regions using lexical resolution here since
        // that's private. It probably doesn't matter since we already
        // got more severe error.
        if (replace_regions === "Yes") {
          const k = lt.kind();
          if (k.$ === "ReVar") {
            return Region.new_error(tcx, guar);
          } else {
            return lt;
          }
        } else {
          return lt;
        }
      },
      (ct_) => {
        const ct = infcx.shallow_resolve_const(ct_);
        const k = ct.kind();
        if (k.$ === "Infer" && k._0.$ === "Var") {
          return Const.new_error(tcx, guar);
        } else if (k.$ === "Alias" && k._0 === "No" && tcx.next_trait_solver_globally()) {
          return Const.new_error(tcx, guar);
        } else {
          return ct;
        }
      },
    ),
  );
}

// #[instrument(level = "debug", skip(tcx, elaborated_env))]
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:330 do_normalize_clauses
function do_normalize_clauses(tcx: TyCtxt, cause: ObligationCause, elaborated_env_: ParamEnv, clauses_: Clause[]): Clause[] {
  // FIXME. We should really... do something with these region
  // obligations. But this call just continues the older
  // behavior (i.e., doesn't cause any new bugs), and it would
  // take some further refactoring to actually solve them. In
  // particular, we would have to handle implied bounds
  // properly, and that code is currently largely confined to
  // regionck (though I made some efforts to extract it
  // out). -nmatsakis
  //
  // @arielby: In any case, these obligations are checked
  // by wfcheck anyway, so I'm not sure we have to check
  // them here too, and we will remove this function when
  // we move over to lazy normalization *anyway*.
  const infcx = tcx.infer_ctxt().ignoring_regions().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  // FIXME: `elaborated_env` is not really rigid. We do this to be
  // consistent with the old solver.
  let elaborated_env: ParamEnv;
  if (tcx.next_trait_solver_globally() && !tcx.disable_param_env_normalization_hack()) {
    const elaborated_env1 = set_type_aliases_to_rigid(tcx, elaborated_env_, d_ParamEnv);
    const elaborated_env2 = set_projection_term_to_non_rigid(tcx, elaborated_env1.caller_bounds());
    elaborated_env = ParamEnvC.new(tcx, elaborated_env2);
  } else {
    elaborated_env = elaborated_env_;
  }
  const d_clauses = fold_Vec(fold_Clause) as TypeFoldable<Clause[]>;
  let clauses = ocx.normalize(cause, elaborated_env, Unnormalized.new_wip(clauses_), d_clauses);
  if (tcx.next_trait_solver_globally()) {
    if (!tcx.disable_param_env_normalization_hack()) {
      const clauses1: Clause[] = [...set_projection_term_to_non_rigid(tcx, clauses)];
      // FIXME(type_alias_impl_trait): opaque types in param env might be
      // in defining scope but we're using non body analysis here.
      // So the rigidness marker is wrong.
      clauses = Unnormalized.skip_norm_wip(set_opaques_to_non_rigid(tcx, clauses1, d_clauses));
    } else {
      // Param env is used in different typing modes but itself
      // is normalized in `non_body_analysis`.
      // That not only makes the rigidness of opaques types wrong,
      // other aliases can be indirectly affected as well.
      // So we conservatively set everything to be non-rigid.
      clauses = Unnormalized.skip_norm_wip(set_aliases_to_non_rigid(tcx, clauses, d_clauses));
    }
  }

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    // debug!("do_normalize_clauses: failed to normalize clauses");
    const guar = err_ctxt(infcx).report_fulfillment_errors(errors._0);
    clauses = replace_infer_and_non_rigid_alias_with_error(infcx, clauses, guar, "No", d_clauses);
  }

  // debug!("do_normalize_clauses: normalized clauses = {:?}", clauses);

  // FIXME: It's very weird that we ignore region obligations but apparently
  // still need to use `resolve_regions` as we need the resolved regions in
  // the normalized clauses.
  //
  // FIXME(-Zhigher-ranked-assumptions): We're ignoring region errors for now.
  // There're placeholder constraints `leaking` out. This is a hack to work around
  // the fact that we don't support placeholder assumptions right now and is necessary
  // for `compare_method_clause_entailment`. We should remove this once we have proper
  // support for implied bounds on binders.
  //
  // This ignoring is required by trait-system-refactor-initiative#166. The new solver encounters
  // this more frequently as we entirely ignore outlives clauses with the old solver.
  //
  // FIXME: We should avoid interning clauses both here and at the
  // caller sites. We should also avoid cloning if possible.
  const normalized_env = ParamEnvC.new(tcx, clauses);
  const _errors = infcx.resolve_regions(cause.body_def_id, normalized_env, []);
  const r = infcx.deeply_resolve_via_region_graph([...clauses], d_clauses);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const fixup_err: FixupError = r._0;
    // The first folder only replaces infers from normalization failure. We might not have
    // normalization failure and have unconstrained ty/const vars from ill-formed impls.
    // See `tests/ui/traits/normalize/self-referential-param-env-normalization.rs`.
    //
    // We delay a bug here instead of immediately ICEing and let type checking report the
    // actual user-facing errors.
    const guar = tcx.dcx().span_delayed_bug(cause.span, `inference variables in normalized parameter environment: ${display_FixupError(fixup_err)}`);

    // This is slightly wrong as we replace opaques with errors.
    //
    // We still need to replace regions because `fully_resolve` eagerly returns `Err` if
    // it encounters unconstrained ty/const var. Thus region vars might not get replaced.
    return replace_infer_and_non_rigid_alias_with_error(infcx, clauses, guar, "Yes", d_clauses);
  }
}

// FIXME: this is gonna need to be removed ...
/// Normalizes the parameter environment, reporting errors if they occur.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:436 normalize_param_env_or_error
export function normalize_param_env_or_error(tcx: TyCtxt, unnormalized_env: ParamEnv, cause: ObligationCause): ParamEnv {
  // I'm not wild about reporting errors here; I'd prefer to
  // have the errors get reported at a defined place (e.g.,
  // during typeck). Instead I have all parameter
  // environments, in effect, going through this function
  // and hence potentially reporting errors. This ensures of
  // course that we never forget to normalize (the
  // alternative seemed like it would involve a lot of
  // manual invocations of this fn -- and then we'd have to
  // deal with the errors at each of those sites).
  //
  // In any case, in practice, typeck constructs all the
  // parameter environments once for every fn as it goes,
  // and errors will get reported then; so outside of type inference we
  // can be sure that no errors should occur.
  let clauses: Clause[] = [
    ...elaborate(
      tcx,
      (function* () {
        for (const clause of unnormalized_env.caller_bounds()) {
          if (tcx.features().generic_const_exprs() || tcx.next_trait_solver_globally()) {
            yield clause;
            continue;
          }

          // This whole normalization step is a hack to work around the fact that
          // `normalize_param_env_or_error` is fundamentally broken from using an
          // unnormalized param env with a trait solver that expects the param env
          // to be normalized.
          //
          // When normalizing the param env we can end up evaluating obligations
          // that have been normalized but can only be proven via a where clause
          // which is still in its unnormalized form. example:
          //
          // Attempting to prove `T: Trait<<u8 as Identity>::Assoc>` in a param env
          // with a `T: Trait<<u8 as Identity>::Assoc>` where clause will fail because
          // we first normalize obligations before proving them so we end up proving
          // `T: Trait<u8>`. Since lazy normalization is not implemented equating `u8`
          // with `<u8 as Identity>::Assoc` fails outright so we incorrectly believe that
          // we cannot prove `T: Trait<u8>`.
          //
          // The same thing is true for const generics- attempting to prove
          // `T: Trait<ConstKind::Alias(...)>` with the same thing as a where clauses
          // will fail. After normalization we may be attempting to prove `T: Trait<4>` with
          // the unnormalized where clause `T: Trait<ConstKind::Alias(...)>`. In order
          // for the obligation to hold `4` must be equal to `ConstKind::Alias(...)`
          // but as we do not have lazy norm implemented, equating the two consts fails outright.
          //
          // Ideally we would not normalize consts here at all but it is required for backwards
          // compatibility. Eventually when lazy norm is implemented this can just be removed.
          // We do not normalize types here as there is no backwards compatibility requirement
          // for us to do so.
          yield fold_Clause.fold_with(clause, new ConstNormalizer(tcx));
        }
      })(),
      Elaboratable_Clause,
    ),
  ];

  // debug!("normalize_param_env_or_error: elaborated-clauses={:?}", clauses);

  const elaborated_env = ParamEnvC.new(tcx, clauses);
  if (!TypeVisitableExt.has_aliases(elaborated_env, d_ParamEnv)) {
    return elaborated_env;
  }

  // HACK: we are trying to normalize the param-env inside *itself*. The problem is that
  // normalization expects its param-env to be already normalized, which means we have
  // a circularity.
  //
  // The way we handle this is by normalizing the param-env inside an unnormalized version
  // of the param-env, which means that if the param-env contains unnormalized projections,
  // we'll have some normalization failures. This is unfortunate.
  //
  // Lazy normalization would basically handle this by treating just the
  // normalizing-a-trait-ref-requires-itself cycles as evaluation failures.
  //
  // Inferred outlives bounds can create a lot of `TypeOutlives` predicates for associated
  // types, so to make the situation less bad, we normalize all the predicates *but*
  // the `TypeOutlives` predicates first inside the unnormalized parameter environment, and
  // then we normalize the `TypeOutlives` bounds inside the normalized parameter environment.
  //
  // This works fairly well because trait matching does not actually care about param-env
  // TypeOutlives clauses - these are normally used by regionck.
  // PORT: `Vec::extract_if(.., pred)`: the matching clauses move out in order, the rest stay in order.
  const outlives_clauses: Clause[] = [];
  {
    const kept: Clause[] = [];
    for (const clause of clauses) {
      if (Binder.skip_binder(clause.kind()).$ === "TypeOutlives") {
        outlives_clauses.push(clause);
      } else {
        kept.push(clause);
      }
    }
    clauses = kept;
  }

  // debug!(
  //     "normalize_param_env_or_error: clauses=(non-outlives={:?}, outlives={:?})",
  //     clauses, outlives_clauses
  // );
  const non_outlives_clauses = do_normalize_clauses(tcx, clone_ObligationCause(cause), elaborated_env, clauses);

  // debug!("normalize_param_env_or_error: non-outlives clauses={:?}", non_outlives_clauses);

  // Not sure whether it is better to include the unnormalized TypeOutlives clauses
  // here. I believe they should not matter, because we are ignoring TypeOutlives param-env
  // clauses here anyway. Keeping them here anyway because it seems safer.
  const outlives_env_ = [...non_outlives_clauses, ...outlives_clauses];
  const outlives_env = ParamEnvC.new(tcx, outlives_env_);
  const outlives_clauses_ = do_normalize_clauses(tcx, cause, outlives_env, outlives_clauses);
  // debug!("normalize_param_env_or_error: outlives clauses={:?}", outlives_clauses);

  const clauses_ = non_outlives_clauses;
  clauses_.push(...outlives_clauses_);
  // debug!("normalize_param_env_or_error: final clauses={:?}", clauses);
  return ParamEnvC.new(tcx, clauses_);
}

// PORT: the fn-local `struct ConstNormalizer<'tcx>(TyCtxt<'tcx>)` of `normalize_param_env_or_error`, with its
// `TypeFolder` impl.
class ConstNormalizer implements TypeFolder {
  constructor(readonly _0: TyCtxt) {}

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:465 cx
  cx(): TyCtxt {
    return this._0;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:469 fold_const
  fold_const(c: Const): Const {
    // FIXME(return_type_notation): track binders in this normalizer, as
    // `ty::Const::normalize` can only work with properly preserved binders.

    if (TypeVisitableExt.has_escaping_bound_vars(c, fold_Const)) {
      return Const.new_misc_error(this._0);
    }

    // While it is pretty sus to be evaluating things with an empty param env, it
    // should actually be okay since without `feature(generic_const_exprs)` the only
    // const arguments that have a non-empty param env are array repeat counts. These
    // do not appear in the type system though.
    const k = c.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Anon") {
      const infcx = this._0.infer_ctxt().build(TypingMode.non_body_analysis());
      const c_ = evaluate_const(infcx, c, ParamEnvC.empty());
      // We should never wind up with any `infcx` local state when normalizing anon consts
      // under min const generics.
      assert(!TypeVisitableExt.has_infer(c_, fold_Const) && !TypeVisitableExt.has_placeholders(c_, fold_Const), "assertion failed: !c.has_infer() && !c.has_placeholders()");
      return c_;
    }

    return c;
  }

  // The provided `TypeFolder` methods (fold.rs).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// FIXME(BoxyUwU): Private this once we `generic_const_exprs` isn't doing its own normalization routine
// FIXME(generic_const_exprs): Consider accepting a `ty::AliasConst` when we are not rolling our own
// normalization scheme
/// Evaluates a type system constant returning a `ConstKind::Error` in cases where CTFE failed and
/// returning the passed in constant if it was not fully concrete (i.e. depended on generic parameters
/// or inference variables)
///
/// You should not call this function unless you are implementing normalization itself. Prefer to use
/// `normalize_erasing_regions` or the `normalize` functions on `ObligationCtxt`/`FnCtxt`/`InferCtxt`.
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:606 evaluate_const
export function evaluate_const(infcx: InferCtxt, ct: Const, param_env: ParamEnv): Const {
  // PORT: `Ok::<_, !>(..)`: the error type is uninhabited (`never`).
  const r = try_evaluate_const<never>(infcx, ct, param_env, (v) => Ok(Unnormalized.skip_norm_wip(v)));
  if (r.$ === "Ok") {
    return r._0;
  }
  const e = r._0;
  switch (e.$) {
    case "EvaluationFailure":
    case "InvalidConstParamTy":
      return Const.new_error(infcx.tcx, e._0);
    case "HasGenericsOrInfers":
      return ct;
    // PORT: `FailedNormalization(!)` is uninhabited (no arm upstream).
    case "FailedNormalization":
      return e._0;
  }
}

// FIXME(BoxyUwU): Private this once we `generic_const_exprs` isn't doing its own normalization routine
// FIXME(generic_const_exprs): Consider accepting a `ty::AliasConst` when we are not rolling our own
// normalization scheme
/// Evaluates a type system constant making sure to not allow constants that depend on generic parameters
/// or inference variables to succeed in evaluating.
///
/// You should not call this function unless you are implementing normalization itself. Prefer to use
/// `normalize_erasing_regions` or the `normalize` functions on `ObligationCtxt`/`FnCtxt`/`InferCtxt`.
// #[instrument(level = "debug", skip(infcx, normalize_ty), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:629 try_evaluate_const
export function try_evaluate_const<E>(
  infcx: InferCtxt,
  ct_: Const,
  param_env: ParamEnv,
  normalize_ty: (ty: Unnormalized<Ty>) => Result<Ty, E>,
): Result<Const, import("./mod.gen.ts").EvaluateConstErr<E>> {
  const tcx = infcx.tcx;
  const ct = infcx.deeply_resolve_ignoring_regions(ct_, fold_Const);
  // debug!(?ct);

  const k = ct.kind();
  switch (k.$) {
    case "Value":
      return Ok(ct);
    case "Error":
      return Err({ $: "EvaluationFailure", _0: k._0 });
    case "Param":
    case "Infer":
    case "Bound":
    case "Placeholder":
    case "Expr":
      return Err({ $: "HasGenericsOrInfers" });
    case "Alias": {
      const alias_const = k._1;
      let opt_anon_const_kind: [DefId, AnonConstKind] | undefined;
      switch (alias_const.kind.$) {
        case "Anon": {
          const def_id = alias_const.kind.def_id;
          opt_anon_const_kind = [def_id, tcx.anon_const_kind(def_id) as AnonConstKind];
          break;
        }
        default:
          opt_anon_const_kind = undefined;
      }

      // Postpone evaluation of constants that depend on generic parameters or
      // inference variables.
      //
      // We use `TypingMode::PostAnalysis` here which is not *technically* correct
      // to be revealing opaque types here as borrowcheck has not run yet. However,
      // CTFE itself uses `TypingMode::PostAnalysis` unconditionally even during
      // typeck and not doing so has a lot of (undesirable) fallout (#101478, #119821).
      // As a result we always use a revealed env when resolving the instance to evaluate.
      //
      // FIXME: `const_eval_resolve_for_typeck` should probably just modify the env itself
      // instead of having this logic here
      let args: GenericArgs;
      let typing_env: TypingEnv;
      // We handle `generic_const_exprs` separately as reasonable ways of handling constants in the type system
      // completely fall apart under `generic_const_exprs` and makes this whole function Really hard to reason
      // about if you have to consider gce whatsoever.
      if (opt_anon_const_kind !== undefined && opt_anon_const_kind[1] === "GCE") {
        const def_id = opt_anon_const_kind[0];
        if (TypeVisitableExt.has_non_region_infer(alias_const, d_AliasConst()) || TypeVisitableExt.has_non_region_param(alias_const, d_AliasConst())) {
          // `feature(generic_const_exprs)` causes anon consts to inherit all parent generics. This can cause
          // inference variables and generic parameters to show up in `ty::Const` even though the anon const
          // does not actually make use of them. We handle this case specially and attempt to evaluate anyway.
          const r = tcx.thir_abstract_const(def_id) as Result<EarlyBinder<Const> | undefined, ErrorGuaranteed>;
          if (r.$ === "Ok" && r._0 !== undefined) {
            const ct_abs = r._0;
            const ct2 = tcx.expand_abstract_consts(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ct_abs, tcx, alias_const.args, fold_Const)), fold_Const);
            const er = TypeVisitableExt.error_reported(ct2, fold_Const);
            if (er.$ === "Err") {
              return Err({ $: "EvaluationFailure", _0: er._0 });
            } else if (TypeVisitableExt.has_non_region_infer(ct2, fold_Const) || TypeVisitableExt.has_non_region_param(ct2, fold_Const)) {
              // If the anon const *does* actually use generic parameters or inference variables from
              // the generic arguments provided for it, then we should *not* attempt to evaluate it.
              return Err({ $: "HasGenericsOrInfers" });
            } else {
              args = replace_param_and_infer_args_with_placeholder(tcx, alias_const.args);
              typing_env = infcx.typing_env(tcx.erase_and_anonymize_regions(param_env, d_ParamEnv)).with_post_analysis_normalized(tcx);
            }
          } else {
            args = RawList.identity_for_item(tcx, def_id);
            typing_env = TypingEnv.post_analysis(tcx, def_id);
          }
        } else {
          typing_env = infcx.typing_env(tcx.erase_and_anonymize_regions(param_env, d_ParamEnv)).with_post_analysis_normalized(tcx);
          args = alias_const.args;
        }
      } else if (opt_anon_const_kind !== undefined && opt_anon_const_kind[1] === "RepeatExprCount") {
        const def_id = opt_anon_const_kind[0];
        if (TypeVisitableExt.has_non_region_infer(alias_const, d_AliasConst())) {
          // Diagnostics will sometimes replace the identity args of anon consts in
          // array repeat expr counts with inference variables so we have to handle this
          // even though it is not something we should ever actually encounter.
          //
          // Array repeat expr counts are allowed to syntactically use generic parameters
          // but must not actually depend on them in order to evalaute successfully. This means
          // that it is actually fine to evalaute them in their own environment rather than with
          // the actually provided generic arguments.
          tcx.dcx().delayed_bug("AnonConst with infer args but no error reported");
        }

        // The generic args of repeat expr counts under `min_const_generics` are not supposed to
        // affect evaluation of the constant as this would make it a "truly" generic const arg.
        // To prevent this we discard all the generic arguments and evalaute with identity args
        // and in its own environment instead of the current environment we are normalizing in.
        args = RawList.identity_for_item(tcx, def_id);
        typing_env = TypingEnv.post_analysis(tcx, def_id);
      } else {
        // `Some((_, MCG | NonTypeSystemAnon | NonTypeSystemInline)) | None`
        // We are only dealing with "truly" generic/uninferred constants here:
        // - GCEConsts have been handled separately
        // - Repeat expr count back compat consts have also been handled separately
        // So we are free to simply defer evaluation here.
        //
        // FIXME: This assumes that `args` are normalized which is not necessarily true
        //
        // Const patterns are converted to type system constants before being
        // evaluated. However, we don't care about them here as pattern evaluation
        // logic does not go through type system normalization. If it did this would
        // be a backwards compatibility problem as we do not enforce "syntactic" non-
        // usage of generic parameters like we do here.
        if (
          TypeVisitableExt.has_non_region_param(alias_const.args, fold_GenericArgs) ||
          TypeVisitableExt.has_non_region_infer(alias_const.args, fold_GenericArgs) ||
          TypeVisitableExt.has_non_region_placeholders(alias_const.args, fold_GenericArgs)
        ) {
          return Err({ $: "HasGenericsOrInfers" });
        }

        // Since there is no generic parameter, we can just drop the environment
        // to prevent query cycle.
        typing_env = TypingEnv.fully_monomorphized();

        args = alias_const.args;
      }

      const alias_const2 = AliasConst.new(tcx, alias_const.kind, args);
      const erased_alias_const = tcx.erase_and_anonymize_regions(alias_const2, d_AliasConst());

      // use rustc_middle::mir::interpret::ErrorHandled;
      // FIXME: `def_span` will point at the definition of this const; ideally, we'd point at
      // where it gets used as a const generic.
      const span = AliasConstKind.def_span(alias_const2.kind, as_interner(tcx));
      // PORT: `TyCtxt::const_eval_resolve_for_typeck` (rustc_middle mir/interpret/queries.rs) and `ErrorHandled` are
      // const eval (M4, D1a); the match on its result is kept below in comments.
      void typing_env;
      void erased_alias_const;
      void span;
      void normalize_ty;
      return unported("rustc_middle::ty::TyCtxt::const_eval_resolve_for_typeck (mir interpret queries, const eval: M4)");
      // match tcx.const_eval_resolve_for_typeck(typing_env, erased_alias_const, span) {
      //     Ok(Ok(val)) => {
      //         let ty = normalize_ty(alias_const.type_of(tcx))
      //             .map_err(EvaluateConstErr::FailedNormalization)?;
      //         Ok(ty::Const::new_value(tcx, val, ty))
      //     }
      //     Ok(Err(_)) => {
      //         let e = tcx.dcx().delayed_bug(
      //             "Type system constant with non valtree'able type evaluated but no error emitted",
      //         );
      //         Err(EvaluateConstErr::InvalidConstParamTy(e))
      //     }
      //     Err(ErrorHandled::Reported(info, _)) => {
      //         Err(EvaluateConstErr::EvaluationFailure(info.into()))
      //     }
      //     Err(ErrorHandled::TooGeneric(_)) => Err(EvaluateConstErr::HasGenericsOrInfers),
      // }
    }
  }
}

/// Replaces args that reference param or infer variables with suitable
/// placeholders. This function is meant to remove these param and infer
/// args when they're not actually needed to evaluate a constant.
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:795 replace_param_and_infer_args_with_placeholder
function replace_param_and_infer_args_with_placeholder(tcx: TyCtxt, args: GenericArgs): GenericArgs {
  return fold_GenericArgs.fold_with(args, new ReplaceParamAndInferWithPlaceholder(tcx, BoundVar.ZERO));
}

// PORT: the fn-local `struct ReplaceParamAndInferWithPlaceholder<'tcx>` of
// `replace_param_and_infer_args_with_placeholder`, with its `TypeFolder` impl.
class ReplaceParamAndInferWithPlaceholder implements TypeFolder {
  constructor(
    readonly tcx: TyCtxt,
    public idx: BoundVarT,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:805 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:809 fold_ty
  fold_ty(t: Ty): Ty {
    if (t.kind().$ === "Infer") {
      const idx = this.idx;
      this.idx = BoundVar.from_usize(BoundVar.as_usize(this.idx) + 1);
      const bound_ty: BoundTy = { var: idx, kind: { $: "Anon" } as BoundTyKind };
      return Ty.new_placeholder(this.tcx, PlaceholderType.new(UniverseIndex.ROOT, bound_ty));
    } else {
      return fold_Ty.super_fold_with(t, this);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:825 fold_const
  fold_const(c: Const): Const {
    if (c.kind().$ === "Infer") {
      const idx = this.idx;
      this.idx = BoundVar.from_usize(BoundVar.as_usize(this.idx) + 1);
      return Const.new_placeholder(this.tcx, PlaceholderConst.new(UniverseIndex.ROOT, BoundConst.new(idx)));
    } else {
      return fold_Const.super_fold_with(c, this);
    }
  }

  // The provided `TypeFolder` methods (fold.rs).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// Normalizes the clauses and checks whether they hold in an empty environment. If this
/// returns true, then either normalize encountered an error or one of the clauses did not
/// hold. Used when creating vtables to check for unsatisfiable methods. This should not be
/// used during analysis.
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:846 impossible_clauses
export function impossible_clauses(tcx: TyCtxt, clauses_: Clause[]): boolean {
  // debug!("impossible_clauses(clauses={:?})", clauses);
  const [infcx, param_env] = tcx
    .infer_ctxt()
    .with_next_trait_solver(true)
    .enable_next_solver_overflow_fcw(false)
    .build_with_typing_env(TypingEnv.fully_monomorphized());

  const ocx = ObligationCtxt.new(infcx);
  const clauses = ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(clauses_), fold_Vec(fold_Clause) as TypeFoldable<Clause[]>);
  for (const clause of clauses) {
    const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, clause, Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate);
    ocx.register_obligation(obligation);
  }

  // Use `try_evaluate_obligations` to only return impossible for true errors,
  // and not ambiguities or overflows. Since the new trait solver forces
  // some currently undetected overlap between `dyn Trait: Trait` built-in
  // vs user-written impls to AMBIGUOUS, this may return ambiguity even
  // with no infer vars. There may also be ways to encounter ambiguity due
  // to post-mono overflow.
  return !TraitErrors.no_errors(ocx.try_evaluate_obligations());
}

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:871 instantiate_and_check_impossible_clauses
function instantiate_and_check_impossible_clauses(tcx: TyCtxt, key: [DefId, GenericArgs]): boolean {
  // debug!("instantiate_and_check_impossible_clauses(key={:?})", key);

  let clauses: Clause[] = GenericClauses.instantiate(tcx.clauses_of(key[0]) as GenericClauses, tcx, key[1]).clauses.map(Unnormalized.skip_norm_wip);

  // Specifically check trait fulfillment to avoid an error when trying to resolve
  // associated items.
  const trait_def_id = tcx.trait_of_assoc(key[0]);
  if (trait_def_id !== undefined) {
    const trait_ref = TraitRef.from_assoc(as_interner(tcx), trait_def_id, key[1]);
    clauses.push(Clause_upcast_from_TraitRef(trait_ref, tcx));
  }

  clauses = clauses.filter((clause) => !TypeVisitableExt.has_param(clause, fold_Clause));
  const result = impossible_clauses(tcx, clauses);

  // debug!("instantiate_and_check_impossible_clauses(key={:?}) = {:?}", key, result);
  return result;
}

/// Checks whether a trait's associated item is impossible to reference on a given impl.
///
/// This only considers predicates that reference the impl's generics, and not
/// those that reference the method's generics.
// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:903 is_impossible_associated_item
function is_impossible_associated_item(tcx: TyCtxt, [impl_def_id, trait_item_def_id]: [DefId, DefId]): boolean {
  const generics = tcx.generics_of(trait_item_def_id) as Generics;
  const gen_clauses = tcx.clauses_of(trait_item_def_id) as GenericClauses;

  // Be conservative in cases where we have `W<T: ?Sized>` and a method like `Self: Sized`,
  // since that method *may* have some substitutions where the predicates hold.
  //
  // This replicates the logic we use in coherence.
  const infcx = tcx.infer_ctxt().ignoring_regions().with_next_trait_solver(true).enable_next_solver_overflow_fcw(false).build(TypingMode.Coherence);
  const param_env = ParamEnvC.empty();
  const fresh_args = infcx.fresh_args_for_item(tcx.def_span(impl_def_id), impl_def_id);

  const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_def_id), tcx, fresh_args, d_TraitRef()));

  const visitor = new ReferencesOnlyParentGenerics(tcx, generics, trait_item_def_id);
  const predicates_for_trait = (function* (): Generator<PredicateObligation> {
    for (const [clause, span] of gen_clauses.clauses) {
      if (fold_Clause.visit_with(clause, visitor).$ === "Continue") {
        yield Obligation.new(
          tcx,
          ObligationCause.dummy_with_span(span),
          param_env,
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, clause, fold_Clause), tcx, impl_trait_ref.args, fold_Clause)),
          Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate,
        );
      }
    }
  })();

  const ocx = ObligationCtxt.new(infcx);
  ocx.register_obligations(predicates_for_trait);
  return !TraitErrors.no_errors(ocx.try_evaluate_obligations());
}

// PORT: the fn-local `struct ReferencesOnlyParentGenerics<'tcx>` of `is_impossible_associated_item`, with its
// `TypeVisitor` impl (`type Result = ControlFlow<()>`).
class ReferencesOnlyParentGenerics implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    readonly tcx: TyCtxt,
    readonly generics: Generics,
    readonly trait_item_def_id: DefId,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:914 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    // If this is a parameter from the trait item's own generics, then bail
    const k = t.kind();
    if (k.$ === "Param") {
      const param = k._0;
      const param_def_id = this.generics.type_param(param, this.tcx).def_id;
      if (DefId_eq(this.tcx.parent(param_def_id), this.trait_item_def_id)) {
        return ControlFlow.Break(null);
      }
    }
    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:924 visit_region
  visit_region(r: Region): ControlFlow<null> {
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const param = k._0;
      const param_def_id = this.generics.region_param(param, this.tcx).def_id;
      if (DefId_eq(this.tcx.parent(param_def_id), this.trait_item_def_id)) {
        return ControlFlow.Break(null);
      }
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/mod.rs:933 visit_const
  visit_const(ct: Const): ControlFlow<null> {
    const k = ct.kind();
    if (k.$ === "Param") {
      const param = k._0;
      const param_def_id = this.generics.const_param(param, this.tcx).def_id;
      if (DefId_eq(this.tcx.parent(param_def_id), this.trait_item_def_id)) {
        return ControlFlow.Break(null);
      }
    }
    return fold_Const.super_visit_with(ct, this);
  }

  // (provided) the methods `ReferencesOnlyParentGenerics` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/mod.rs:982 provide
export function provide(providers: Providers): void {
  dyn_compatibility.provide(providers);
  // PORT: `vtable::provide(providers)`: traits/vtable.rs is not ported yet (no lane); its queries keep the driver's
  // `unported` placeholder providers.
  // vtable::provide(providers);
  providers.specialization_graph_of = specialize.specialization_graph_provider;
  providers.specializes = specialize.specializes;
  providers.specialization_enabled_in = specialize.specialization_enabled_in;
  providers.instantiate_and_check_impossible_clauses = (tcx, key) => instantiate_and_check_impossible_clauses(tcx, key as [DefId, GenericArgs]);
  providers.is_impossible_associated_item = is_impossible_associated_item;
  // PORT: traits/outlives_for_liveness.rs is not ported yet (no lane); these two keep the placeholder providers.
  // live_args_for_alias_from_outlives_bounds:
  //     outlives_for_liveness::live_args_for_alias_from_outlives_bounds,
  // args_known_to_outlive_alias_params:
  //     outlives_for_liveness::args_known_to_outlive_alias_params,
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

/**
 * PORT(wave 19): `error_reporting::TypeErrCtxt` (error_reporting/mod.rs, wave 19 errctxt-contract) is a `Pending` type in
 * ../decls.ts; these are the methods this lane's files call on it (`infcx.err_ctxt().<method>(..)`). Root drops the view
 * when the contract lands.
 */
export interface TypeErrCtxtView {
  // error_reporting/traits/fulfillment_errors.rs `report_fulfillment_errors`
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
  // error_reporting/infer/region.rs `report_region_errors`
  report_region_errors(generic_param_scope: import("../../rustc_span/def_id.ts").LocalDefId, errors: import("../../rustc_infer/infer/lexical_region_resolve/mod.ts").RegionResolutionError[]): ErrorGuaranteed;
  // error_reporting/traits/overflow.rs `report_overflow_error` (`-> !`)
  report_overflow_error(
    cause: { $: "DeeplyNormalize"; _0: import("../../rustc_type_ir/ty/alias.ts").AliasTerm },
    span: Span,
    suggest_increasing_limit: boolean,
    mutate: (err: { note(msg: string): unknown }) => void,
  ): never;
  // error_reporting/traits/overflow.rs `report_overflow_obligation` (`T: Upcast<TyCtxt, Predicate> + Clone`, `-> !`;
  // lane selcx-contract: the old solver's fulfill.rs / select)
  report_overflow_obligation<T>(obligation: import("../../rustc_infer/traits/mod.ts").Obligation<T>, suggest_increasing_limit: boolean): never;
}

/** `crate::error_reporting::InferCtxtErrorExt::err_ctxt` (wave 19): the methods this crate calls on `TypeErrCtxt`. */
export function err_ctxt(infcx: InferCtxt): TypeErrCtxtView {
  return infcx.err_ctxt() as unknown as TypeErrCtxtView;
}

/** The `TypeFoldable` impl of `Term` (rustc_middle ty/mod.ts), read lazily (init order). */
function fold_Term(): TypeFoldable<import("../../rustc_middle/ty/decls.ts").Term> {
  return middle_ty_mod().fold_Term;
}
function middle_ty_mod(): typeof import("../../rustc_middle/ty/mod.ts") {
  return require("../../rustc_middle/ty/mod.ts") as typeof import("../../rustc_middle/ty/mod.ts");
}
/** The derived `TypeFoldable` of `AliasConst` (= `Alias<AliasConstKind>`, rustc_type_ir ty/alias.rs), as a D4 descriptor. */
function d_AliasConst(): TypeFoldable<import("../../rustc_type_ir/decls.ts").AliasConst> {
  return {
    visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasConstKind),
    try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasConstKind),
    fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasConstKind),
  };
}
/** The derived `TypeFoldable` of `TraitRef` (rustc_type_ir predicate.rs), as a D4 descriptor. */
function d_TraitRef(): TypeFoldable<TraitRef> {
  return { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
}
