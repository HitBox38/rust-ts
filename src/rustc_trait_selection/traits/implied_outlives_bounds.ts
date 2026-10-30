// Port of compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs (lane selcx-contract).
//
// PORT:
// - `impl QueryTypeOp for ImpliedOutlivesBounds` is the descriptor `QueryTypeOp_ImpliedOutlivesBounds`
//   (query/type_op/mod.ts).
// - `ContainsBevyParamSet` (generated interface, ./implied_outlives_bounds.gen.ts) is visited by the local class
//   `ContainsBevyParamSetVisitor` that carries its field (`TypeVisitor` needs the `Result` impl and methods).
// - `SmallVec<[Component; 4]>` is an array; the `FxHashSet<Term>` of checked args is a `Set` (interned `Term`s).
// - `ty.visit_with(self)?` returns the `Break` at once.
// Init order: top-level code here touches only ./implied_outlives_bounds.gen.ts and other crates; this crate's modules
// are read inside function bodies only.

import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { TypeOutlivesConstraint } from "../../rustc_infer/infer/mod.ts";
import type { ScrubbedTraitError } from "../../rustc_infer/traits/engine.ts";
import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import {
  fold_with_OutlivesBound,
  type OutlivesBound,
  try_fold_with_OutlivesBound,
  type_op,
  visit_with_OutlivesBound,
} from "../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses, ParamEnv, Region, Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_Term, Term, type ParamEnvAnd } from "../../rustc_middle/ty/mod.ts";
import { fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { fold_Vec, type PredicateProxy, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { type Component, push_outlives_components } from "../../rustc_type_ir/outlives.ts";
import { fold_with_PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { ObligationCtxt } from "./engine.ts";
import type { QueryTypeOp } from "./query/type_op/mod.ts";

export * from "./implied_outlives_bounds.gen.ts";

/** The derived `TypeFoldable` impls (rustc_middle traits/query.rs) as D4 descriptors. */
const d_ImpliedOutlivesBounds: TypeFoldable<type_op.ImpliedOutlivesBounds> = {
  visit_with: type_op.visit_with_ImpliedOutlivesBounds,
  try_fold_with: type_op.try_fold_with_ImpliedOutlivesBounds,
  fold_with: type_op.fold_with_ImpliedOutlivesBounds,
};
const d_OutlivesBound: TypeFoldable<OutlivesBound> = {
  visit_with: visit_with_OutlivesBound,
  try_fold_with: try_fold_with_OutlivesBound,
  fold_with: fold_with_OutlivesBound,
};
/** `TypeVisitable` of `PredicateKind` (generated impls). */
const d_PredicateKind = { visit_with: visit_with_PredicateKind, try_fold_with: try_fold_with_PredicateKind, fold_with: fold_with_PredicateKind };

/** `NoSolution` (`rustc_next_trait_solver::solve::NO_SOLUTION`), read lazily (init order). */
function NO_SOLUTION(): NoSolution {
  return (require("../../rustc_next_trait_solver/solve/mod.ts") as typeof import("../../rustc_next_trait_solver/solve/mod.ts")).NO_SOLUTION;
}

// FIXME(#160491): Remove this once the new implied bounds impl is through FCP.
// ---- impl<'tcx> QueryTypeOp<'tcx> for ImpliedOutlivesBounds<'tcx> (implied_outlives_bounds.rs:19) ----------------------

export const QueryTypeOp_ImpliedOutlivesBounds: QueryTypeOp<type_op.ImpliedOutlivesBounds, OutlivesBound[]> = {
  d_Self: d_ImpliedOutlivesBounds,
  d_QueryResponse: fold_Vec(d_OutlivesBound) as TypeFoldable<OutlivesBound[]>,

  // rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:22 try_fast_path
  try_fast_path(_tcx: TyCtxt, key: ParamEnvAnd<type_op.ImpliedOutlivesBounds>): OutlivesBound[] | undefined {
    // Don't go into the query for things that can't possibly have lifetimes.
    const k = key.value.ty.kind();
    switch (k.$) {
      case "Tuple":
        if (k._0.length === 0) {
          return [];
        }
        return undefined;
      case "Never":
      case "Str":
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
        return [];
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:36 perform_query
  perform_query(
    tcx: TyCtxt,
    canonicalized: CanonicalQueryInput<ParamEnvAnd<type_op.ImpliedOutlivesBounds>>,
  ): Result<CanonicalQueryResponse<OutlivesBound[]>, NoSolution> {
    return tcx.implied_outlives_bounds([canonicalized, false]) as Result<CanonicalQueryResponse<OutlivesBound[]>, NoSolution>;
  },
};

// rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:44 compute_implied_outlives_bounds_inner
export function compute_implied_outlives_bounds_inner(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  param_env: ParamEnv,
  ty: Ty,
  normalized_ty: Ty,
  span: Span,
): Result<OutlivesBound[], NoSolution> {
  const wf = (wf__m ??= require("./wf.ts") as typeof import("./wf.ts"));
  const tcx = ocx.infcx.tcx;
  // Sometimes when we ask what it takes for T: WF, we get back that
  // U: WF is required; in that case, we push U onto this stack and
  // process it next. Because the resulting predicates aren't always
  // guaranteed to be a subset of the original type, so we need to store the
  // WF args we've computed in a set.
  const checked_wf_args = new Set<Term>();
  const wf_args: Term[] = [Term.from_Ty(ty), Term.from_Ty(normalized_ty)];

  const outlives_bounds: OutlivesBound[] = [];

  for (let arg_ = wf_args.pop(); arg_ !== undefined; arg_ = wf_args.pop()) {
    if (checked_wf_args.has(arg_)) {
      continue;
    }
    checked_wf_args.add(arg_);

    const arg = ocx.infcx.deeply_resolve_ignoring_regions(arg_, fold_Term);
    // From the full set of obligations, just filter down to the region relationships.
    for (const obligation of wf.unnormalized_obligations(ocx.infcx, param_env, arg, DUMMY_SP, CRATE_DEF_ID) ?? []) {
      const pred_r = ocx.deeply_normalize(ObligationCause.dummy_with_span(span), param_env, Unnormalized.new_wip(obligation.predicate), fold_Predicate);
      if (pred_r.$ === "Err") return Err(NO_SOLUTION());
      const pred_ = pred_r._0;
      const pred = Binder.no_bound_vars(pred_.kind(), d_PredicateKind);
      if (pred === undefined) {
        continue;
      }
      if (pred.$ === "Clause") {
        const c = pred._0;
        switch (c.$) {
          // FIXME(generic_const_parameter_types): Make sure that `<'a, 'b, const N: &'a &'b u32>`
          // is sound if we ever support that
          case "Trait":
          case "HostEffect":
          case "ConstArgHasType":
          case "Projection":
          case "ConstEvaluatable":
          case "UnstableFeature":
            break;

          // We need to search through *all* WellFormed predicates
          case "WellFormed": {
            const term = c._0;
            wf_args.push(term);
            break;
          }

          // We need to register region relationships
          case "RegionOutlives": {
            const { _0: r_a, _1: r_b } = c._0;
            outlives_bounds.push({ $: "RegionSubRegion", _0: r_b, _1: r_a });
            break;
          }

          case "TypeOutlives": {
            const { _0: ty_a, _1: r_b } = c._0;
            const components: Component[] = [];
            push_outlives_components(tcx, ty_a, components);
            outlives_bounds.push(...implied_bounds_from_components(tcx, r_b, components));
            break;
          }
        }
      } else {
        switch (pred.$) {
          case "Subtype":
          case "Coerce":
          case "DynCompatible":
          case "ConstEquate":
          case "Ambiguous":
          case "NormalizesTo":
            break;
        }
      }
    }
  }

  return Ok(outlives_bounds);
}

/// If we're at a callsite which should apply the bevy implied bounds hack and
/// `-Zno-implied-bounds-compat` has not been set, then use the registered outlives
/// obligations as implied bounds if we detect `bevy_ecs::*::ParamSet` in the arg.
///
/// cc #119956
// rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:130 consider_implied_bounds_hack_for_ty
export function consider_implied_bounds_hack_for_ty(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  ty: Ty,
  region_constraints: () => TypeOutlivesConstraint[],
): OutlivesBound[] {
  const tcx = ocx.infcx.tcx;
  if (!ocx.infcx.tcx.sess.opts.unstable_opts.no_implied_bounds_compat && fold_Ty.visit_with(ty, new ContainsBevyParamSetVisitor(tcx)).$ === "Break") {
    const outlives_bounds: OutlivesBound[] = [];
    for (const { sup_type, sub_region } of region_constraints()) {
      const components: Component[] = [];
      push_outlives_components(tcx, sup_type, components);
      outlives_bounds.push(...implied_bounds_from_components(tcx, sub_region, components));
    }
    return outlives_bounds;
  } else {
    return [];
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:151 query_compute_implied_outlives_bounds
export function query_compute_implied_outlives_bounds(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  param_env: ParamEnv,
  ty: Ty,
  disable_implied_bounds_hack: boolean,
): Result<OutlivesBound[], NoSolution> {
  // When computing implied bounds by looking at types in the signature,
  // we must be careful to never reveal the hidden types of opaques which
  // the caller can not. That would be unsound as it may give us implied
  // bounds which the caller never actually proves.
  //
  // FIXME(impl_trait_in_assoc_type): We currently do this incorrectly in
  // `fn check_opaque_meets_bounds`, see trait-system-refactor-initiative#159.
  /* if cfg!(debug_assertions) {
      match ocx.infcx.typing_mode_raw() {
          TypingMode::Typeck { defining_opaque_types_and_generators: opaque_types }
          | TypingMode::PostTypeckUntilBorrowck { defining_opaque_types: opaque_types }
          | TypingMode::PostBorrowck { defined_opaque_types: opaque_types } => {
              assert!(opaque_types.is_empty())
          }

          TypingMode::Coherence
          | TypingMode::Reflection
          | TypingMode::PostAnalysis
          | TypingMode::Codegen
          | TypingMode::ErasedNotCoherence(_) => unreachable!(),
      }
  } */

  // FIXME: This doesn't seem right. All call sites already normalize `ty`.
  // We have to normalize in the caller as computing implied bounds from unnormalized
  // types would be unsound. See #100989
  //
  // We must normalize the type so we can compute the right outlives components.
  // for example, if we have some constrained param type like `T: Trait<Out = U>`,
  // and we know that `&'a T::Out` is WF, then we want to imply `U: 'a`.
  const normalized_r = ocx.deeply_normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(ty), fold_Ty);
  if (normalized_r.$ === "Err") return Err(NO_SOLUTION());
  const normalized_ty = normalized_r._0;

  const r = compute_implied_outlives_bounds_inner(ocx, param_env, ty, normalized_ty, DUMMY_SP);
  if (r.$ === "Err") return r;
  const outlives_bounds = r._0;

  if (!disable_implied_bounds_hack) {
    outlives_bounds.push(...consider_implied_bounds_hack_for_ty(ocx, ty, () => ocx.infcx.clone_registered_region_obligations()));
  }

  return Ok(outlives_bounds);
}

// rustc-type: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:203 ContainsBevyParamSet
class ContainsBevyParamSetVisitor implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(public tcx: TyCtxt) {}

  // rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:210 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    // We only care to match `ParamSet<T>` or `&ParamSet<T>`.
    const k = t.kind();
    switch (k.$) {
      case "Adt": {
        const def = k._0;
        if (this.tcx.item_name(def.did()) === sym.ParamSet && this.tcx.crate_name(def.did().krate) === sym.bevy_ecs) {
          return ControlFlow.Break(null);
        }
        break;
      }
      case "Ref": {
        const ty = k._1;
        const r = fold_Ty.visit_with(ty, this);
        if (r.$ === "Break") return r;
        break;
      }
      default:
        break;
    }

    return ControlFlow.CONTINUE;
  }

  // (provided) TypeVisitor methods this impl does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
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

/// When we have an implied bound that `T: 'a`, we can further break
/// this down to determine what relationships would have to hold for
/// `T: 'a` to hold. We get to assume that the caller has validated
/// those relationships.
// rustc: compiler/rustc_trait_selection/src/traits/implied_outlives_bounds.rs:232 implied_bounds_from_components
function implied_bounds_from_components(_tcx: TyCtxt, sub_region: Region, sup_components: Component[]): OutlivesBound[] {
  const out: OutlivesBound[] = [];
  for (const component of sup_components) {
    switch (component.$) {
      case "Region":
        out.push({ $: "RegionSubRegion", _0: sub_region, _1: component._0 });
        break;
      case "Param":
        out.push({ $: "RegionSubParam", _0: sub_region, _1: component._0 });
        break;
      case "Alias":
        // We expect them to be already deeply normalized.
        // debug_assert_eq!(is_rigid, ty::IsRigid::yes_if_next_solver(tcx));
        out.push({ $: "RegionSubAlias", _0: sub_region, _1: component._1 });
        break;
      case "Placeholder":
        // FIXME(non_lifetime_binders): Placeholders don't currently
        // imply anything for outlives, though they could easily.
        break;
      case "EscapingAlias":
        // If the projection has escaping regions, don't
        // try to infer any implied bounds even for its
        // free components. This is conservative, because
        // the caller will still have to prove that those
        // free components outlive `sub_region`. But the
        // idea is that the WAY that the caller proves
        // that may change in the future and we want to
        // give ourselves room to get smarter here.
        break;
      case "UnresolvedInferenceVariable":
        break;
    }
  }
  return out;
}

var wf__m: typeof import("./wf.ts") | undefined; // PORT: (perf) lazy-require memo (precedent: perf-intern)
