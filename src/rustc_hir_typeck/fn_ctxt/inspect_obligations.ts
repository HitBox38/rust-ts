// Port of compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs (lane typeck-checks-a).
//! A utility module to inspect currently ambiguous obligations in the current context.
//
// - `UseSubtyping` is generated (inspect_obligations.gen.ts).
// - The `FnCtxt` methods are assigned onto `FnCtxt.prototype` (declared in ../decls.ts).
// - `NestedObligationsForSelfTy` / `FindFromFloatForF32RootVids` are classes implementing rustc_trait_selection's
//   `ProofTreeVisitor<undefined>` (`type Result = ()` is `VisitorResult.unit`). Their `&'a mut` fields
//   (`obligations_for_self_ty`, `vids`) are the caller's array / set, mutated in place.
// - `UnordSet<ty::FloatVid>` is a `Set<FloatVid>` (decls.ts signature rule).
// - `#[instrument]` / `debug!` / `trace!` are tracing only and stay as comments.
// Init order: top-level code here touches only ../decls.ts, this file's .gen.ts and other crates.
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { Obligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, type ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import { fold_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { InspectConfig, InspectGoal, ProofTreeVisitor } from "../../rustc_trait_selection/solve/inspect/analyse.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import type { FloatVid, TyVid } from "../../rustc_type_ir/decls.ts";
import { ProjectionClause, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { type PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import { AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { FnCtxt } from "../decls.ts";
import type { UseSubtyping } from "./inspect_obligations.gen.ts";

export * from "./inspect_obligations.gen.ts";

/** `PredicateKind: TypeVisitable` (for `Binder::no_bound_vars`). */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };

/** `Predicate: Upcast<TyCtxt, Predicate>` (the identity). */
function Predicate_identity(p: Predicate, _tcx: unknown): Predicate {
  return p;
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx>

/// Returns a list of all obligations whose self type has been unified
/// with the unconstrained type `self_ty`.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:35 obligations_for_self_ty
FnCtxt.prototype.obligations_for_self_ty = function (this: FnCtxt, self_ty: TyVid, subtyping: UseSubtyping): PredicateObligations {
  if (this.next_trait_solver()) {
    return this.obligations_for_self_ty_next(self_ty, subtyping);
  } else {
    let obligations = this.fulfillment_cx.pending_obligations();
    // trace!("pending_obligations = {:#?}", obligations);
    obligations = obligations.filter((obligation) => this.predicate_has_self_ty(obligation.predicate, self_ty, subtyping));
    return obligations;
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:53 predicate_has_self_ty
FnCtxt.prototype.predicate_has_self_ty = function (this: FnCtxt, predicate: Predicate, expected_vid: TyVid, subtyping: UseSubtyping): boolean {
  const kind = Binder.skip_binder(predicate.kind());
  switch (kind.$) {
    case "Clause": {
      const clause = kind._0;
      switch (clause.$) {
        case "Trait": {
          const data = clause._0;
          return this.type_matches_expected_vid(TraitClause.self_ty(data), expected_vid, subtyping);
        }
        case "Projection": {
          const data = clause._0;
          if (AliasTermKind.is_trait_projection(data.projection_term.kind)) {
            return this.type_matches_expected_vid(ProjectionClause.self_ty(data), expected_vid, subtyping);
          } else {
            return false;
          }
        }
        case "ConstArgHasType":
        case "RegionOutlives":
        case "TypeOutlives":
        case "WellFormed":
        case "ConstEvaluatable":
        case "HostEffect":
        case "UnstableFeature":
          return false;
      }
      break;
    }
    case "Subtype":
    case "Coerce":
    case "DynCompatible":
    case "NormalizesTo":
    case "ConstEquate":
    case "Ambiguous":
      return false;
  }
  return kind satisfies never;
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:87 type_matches_expected_vid
FnCtxt.prototype.type_matches_expected_vid = function (this: FnCtxt, ty: Ty, expected_vid: TyVid, subtyping: UseSubtyping): boolean {
  ty = this.shallow_resolve(ty);
  // debug!(?ty);

  const kind = ty.kind();
  if (kind.$ === "Infer" && kind._0.$ === "TyVar") {
    const found_vid = kind._0._0;
    switch (subtyping) {
      case "No":
        return this.root_var(expected_vid) === this.root_var(found_vid);
      case "Yes":
        return this.sub_unification_table_root_var(expected_vid) === this.sub_unification_table_root_var(found_vid);
    }
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:108 obligations_for_self_ty_next
FnCtxt.prototype.obligations_for_self_ty_next = function (this: FnCtxt, self_ty: TyVid, subtyping: UseSubtyping): PredicateObligations {
  // We only look at obligations which may reference the self type.
  // This lookup uses the `sub_root` instead of the inference variable
  // itself as that's slightly nicer to implement. It shouldn't really
  // matter.
  //
  // This is really impactful when typechecking functions with a lot of
  // stalled obligations, e.g. in the `wg-grammar` benchmark.
  const sub_root_var = this.sub_unification_table_root_var(self_ty);
  const obligations = this.fulfillment_cx.pending_obligations_potentially_referencing_sub_root(this.infcx, sub_root_var);
  // debug!(?obligations);

  let obligations_for_self_ty: PredicateObligations = [];
  for (const obligation of obligations) {
    const visitor = new NestedObligationsForSelfTy(this, self_ty, obligation.cause, obligations_for_self_ty, subtyping);

    const goal = obligation.as_goal();
    this.visit_proof_tree(goal, visitor);
  }

  // PORT: `retain_mut`: the closure writes the resolved predicate back before deciding.
  obligations_for_self_ty = obligations_for_self_ty.filter((obligation) => {
    obligation.predicate = this.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);
    return !TypeVisitableExt.has_placeholders(obligation.predicate, fold_Predicate);
  });
  return obligations_for_self_ty;
};

/// Only needed for the `From<{float}>` for `f32` type fallback.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:150 from_float_for_f32_root_vids
FnCtxt.prototype.from_float_for_f32_root_vids = function (this: FnCtxt): Set<FloatVid> {
  if (this.next_trait_solver()) {
    return this.from_float_for_f32_root_vids_next();
  } else {
    const from_trait = this.tcx.lang_items().from_trait();
    if (from_trait === undefined) {
      return new Set();
    }
    const vids = new Set<FloatVid>();
    for (const obligation of this.fulfillment_cx.pending_obligations()) {
      const vid = this.predicate_from_float_for_f32_root_vid(from_trait, obligation.predicate);
      if (vid !== undefined) vids.add(vid);
    }
    return vids;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:168 predicate_from_float_for_f32_root_vid
FnCtxt.prototype.predicate_from_float_for_f32_root_vid = function (this: FnCtxt, from_trait: DefId, predicate: Predicate): FloatVid | undefined {
  // The predicates we are looking for look like
  // `TraitClause(<f32 as std::convert::From<{float}>>, polarity:Positive)`.
  // They will have no bound variables.
  const kind = Binder.no_bound_vars(predicate.kind(), d_PredicateKind);
  if (kind !== undefined && kind.$ === "Clause" && kind._0.$ === "Trait" && kind._0._0.polarity === "Positive") {
    const trait_ref = kind._0._0.trait_ref;
    if (DefId_eq(trait_ref.def_id, from_trait)) {
      const self_kind = this.shallow_resolve(TraitRef.self_ty(trait_ref)).kind();
      if (self_kind.$ === "Float" && self_kind._0 === "F32") {
        return this.root_float_vid(trait_ref.args.type_at(1));
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:190 from_float_for_f32_root_vids_next
FnCtxt.prototype.from_float_for_f32_root_vids_next = function (this: FnCtxt): Set<FloatVid> {
  const from_trait = this.tcx.lang_items().from_trait();
  if (from_trait === undefined) {
    return new Set();
  }
  const obligations = this.fulfillment_cx.pending_obligations_potentially_referencing_float_infer(this.infcx);
  // debug!(?obligations);
  const vids = new Set<FloatVid>();
  for (const obligation of obligations) {
    const visitor = new FindFromFloatForF32RootVids(this, from_trait, vids, obligation.cause.span);

    const goal = obligation.as_goal();
    this.visit_proof_tree(goal, visitor);
  }
  return vids;
};

/// Using an intentionally low depth to minimize the chance of future
/// breaking changes in case we adapt the approach later on. This also
/// avoids any hangs for exponentially growing proof trees.
const MAX_DEPTH_FOR_OBLIGATIONS_VISITORS = 5;

// rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:220 NestedObligationsForSelfTy
export class NestedObligationsForSelfTy implements ProofTreeVisitor<undefined> {
  /** `type Result = ();` (the trait's default). */
  readonly Result = VisitorResult.unit;

  constructor(
    public fcx: FnCtxt,
    public self_ty: TyVid,
    public root_cause: ObligationCause,
    public obligations_for_self_ty: PredicateObligations,
    public subtyping: UseSubtyping,
  ) {}

  // impl<'tcx> ProofTreeVisitor<'tcx> for NestedObligationsForSelfTy<'_, 'tcx>
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:229 span
  span(): Span {
    return this.root_cause.span;
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:233 config
  config(): InspectConfig {
    return { max_depth: MAX_DEPTH_FOR_OBLIGATIONS_VISITORS };
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:237 visit_goal
  visit_goal(inspect_goal: InspectGoal): undefined {
    // No need to walk into goal subtrees that certainly hold, since they
    // wouldn't then be stalled on an infer var.
    const result = inspect_goal.result();
    if (result.$ === "Ok" && result._0.$ === "Yes") {
      return undefined;
    }

    // We don't care about any pending goals which don't actually
    // use the self type.
    if (
      !inspect_goal
        .orig_values()
        .some((arg) => {
          const ty = GenericArg.as_type(arg);
          return ty !== undefined && this.fcx.type_matches_expected_vid(ty, this.self_ty, this.subtyping);
        })
    ) {
      // debug!(goal = ?inspect_goal.goal(), "goal does not mention self type");
      return undefined;
    }

    const tcx = this.fcx.tcx;
    const goal = inspect_goal.goal();
    if (this.fcx.predicate_has_self_ty(goal.predicate, this.self_ty, this.subtyping)) {
      this.obligations_for_self_ty.push(Obligation.new(tcx, clone_ObligationCause(this.root_cause), goal.param_env, goal.predicate, Predicate_identity));
    }

    // If there's a unique way to prove a given goal, recurse into
    // that candidate. This means that for `impl<F: FnOnce(u32)> Trait<F> for () {}`
    // and a `(): Trait<?0>` goal we recurse into the impl and look at
    // the nested `?0: FnOnce(u32)` goal.
    const candidate = inspect_goal.unique_applicable_candidate();
    if (candidate !== undefined) {
      candidate.visit_nested_no_probe(this);
    }
    return undefined;
  }

  /** (provided) `on_recursion_limit`: `Self::Result::output()`. */
  on_recursion_limit(): undefined {
    return this.Result.output();
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:277 FindFromFloatForF32RootVids
export class FindFromFloatForF32RootVids implements ProofTreeVisitor<undefined> {
  /** `type Result = ();` (the trait's default). */
  readonly Result = VisitorResult.unit;

  constructor(
    public fcx: FnCtxt,
    public from_trait: DefId,
    public vids: Set<FloatVid>,
    public span_: Span,
  ) {}

  // impl<'tcx> ProofTreeVisitor<'tcx> for FindFromFloatForF32RootVids<'_, 'tcx>
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:285 span
  span(): Span {
    return this.span_;
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:289 config
  config(): InspectConfig {
    return { max_depth: MAX_DEPTH_FOR_OBLIGATIONS_VISITORS };
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs:293 visit_goal
  visit_goal(inspect_goal: InspectGoal): undefined {
    // No need to walk into goal subtrees that certainly hold, since they
    // wouldn't then be stalled on an infer var.
    const result = inspect_goal.result();
    if (result.$ === "Ok" && result._0.$ === "Yes") {
      return undefined;
    }

    // We don't care about any pending goals which don't actually
    // use any float infer var.
    if (
      !inspect_goal
        .orig_values()
        .some((arg) => {
          const ty = GenericArg.as_type(arg);
          if (ty === undefined) return false;
          const k = this.fcx.shallow_resolve(ty).kind();
          return k.$ === "Infer" && k._0.$ === "FloatVar";
        })
    ) {
      // debug!(goal = ?inspect_goal.goal(), "goal does not mention float infer var");
      return undefined;
    }

    const vid = this.fcx.predicate_from_float_for_f32_root_vid(this.from_trait, inspect_goal.goal().predicate);
    if (vid !== undefined) {
      this.vids.add(vid);
    }

    const candidate = inspect_goal.unique_applicable_candidate();
    if (candidate !== undefined) {
      candidate.visit_nested_no_probe(this);
    }
    return undefined;
  }

  /** (provided) `on_recursion_limit`: `Self::Result::output()`. */
  on_recursion_limit(): undefined {
    return this.Result.output();
  }
}
