// Port of compiler/rustc_hir_typeck/src/method/probe.rs (lane typeck-probe).
//
// - `ProbeContext`, `Candidate`, `Pick`, `PickConstraintsForShadowed` are generated classes (probe.gen.ts); their methods
//   are assigned onto the prototypes here, in upstream order (`impl Deref for ProbeContext` is the `fcx` field: the
//   forwarders are installed by ../lib.ts, decls.ts `register_deref`).
// - `AutorefOrPtrAdjustment::get_unsize` is a method on the companion const (PORTING §8 "Enum methods").
// - `PickDiagHints.unsatisfied_predicates: &'a mut UnsatisfiedPredicates` is the shared array itself.
// - `#[instrument]` / `debug!` are kept as comments (no tracing output is diffed).
// - PORT: `CandidateStep.self_ty` / `MethodAutoderefBadTy.ty` are `Canonical<unknown>` in rustc_middle's generated
//   query.gen.ts (`QueryResponse` is not mapped there): `step_self_ty` / `bad_ty_ty` below give them their upstream type
//   `Canonical<QueryResponse<Ty>>`.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./probe.gen.ts";
import * as gen from "./probe.gen.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import { Candidate, clone_Candidate, type IsSuggestion, Pick, PickConstraintsForShadowed, PickKind, ProbeContext, type CandidateKind, type Mode, type PickDiagHints, type PickResult, type ProbeResult, type ProbeScope, type UnsatisfiedPredicates } from "./probe.gen.ts";
import type { CandidateSource, MethodError, NoMatchData } from "./mod.gen.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../../rustc_errors/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { Autoderef, report_autoderef_recursion_limit_error } from "../../rustc_hir_analysis/autoderef.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { DefineOpaqueTypes } from "../../rustc_infer/infer/at.gen.ts";
import { fold_QueryResponse } from "../../rustc_infer/infer/canonical/query_response.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.gen.ts";
import { clone_Obligation, Obligation, type PredicateObligation, type Selection } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { debug_TraitErrors } from "../../rustc_infer/traits/engine.gen.ts";
import { METHOD_CALL_ON_DIVERGING_INFER_VAR, TYVAR_BEHIND_RAW_POINTER, UNSTABLE_NAME_COLLISIONS } from "../../rustc_lint_defs/builtin.gen.ts";
import { OriginalQueryValues, type Canonical } from "../../rustc_middle/infer/canonical.ts";
import { debug_QueryResponse, type QueryResponse } from "../../rustc_middle/infer/canonical.gen.ts";
import { debug_Canonical } from "../../rustc_type_ir/canonical.gen.ts";
import { clone_ObligationCause, ImplSource, ObligationCause, type ObligationCauseCode, type SelectionResult } from "../../rustc_middle/traits/mod.ts";
import { SelectionError } from "../../rustc_middle/traits/mod.gen.ts";
import { type CandidateStep, type CanonicalMethodAutoderefStepsGoal, type MethodAutoderefBadTy, type MethodAutoderefSteps, type MethodAutoderefStepsResult } from "../../rustc_middle/traits/query.ts";
import { AssocItem, AssocItems, type AssocKind } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type GenericClauses as GenericClausesT, type Generics } from "../../rustc_middle/ty/generics.ts";
import { fold_with_Ty, try_fold_with_Ty, visit_with_Ty, fold_with_ParamEnv, HasAttrs_DefId, try_fold_with_ParamEnv, visit_with_ParamEnv, ProvisionalHiddenType, Ty, Visibility, type ParamEnvAnd } from "../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_TraitRef, Predicate_upcast_from_PolyTraitRef, Predicate_upcast_from_TraitRef, type Predicate } from "../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Clause, fold_PredefinedOpaques, fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { EvalResult } from "../../rustc_middle/middle/stability.gen.ts";
import { CRATE_DEF_ID, DefId_eq, DefId_key, DefIdSet, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { edit_distance_with_substrings, find_best_match_for_name_with_substrings } from "../../rustc_span/edit_distance.ts";
import { DUMMY_SP, Span, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Symbol as Sym, type Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { expand_trait_aliases } from "../../rustc_trait_selection/traits/util.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { predicates_for_generics } from "../../rustc_trait_selection/traits/mod.ts";
import { debug_FulfillmentError, type FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyTraitRef, TraitRef as TraitRefT, Variance } from "../../rustc_type_ir/decls.ts";
import { supertrait_def_ids, supertraits } from "../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt, simplify_type, TreatParams } from "../../rustc_type_ir/fast_reject.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../../rustc_type_ir/fold.ts";
import { as_interner, TraitClause, type TraitClause as TraitClauseT, PolyExistentialTraitRef, PolyTraitClause, PolyTraitRef as PolyTraitRefC, TraitRef, visit_with_TraitRef, try_fold_with_TraitRef, fold_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { assert, assert_eq, assert_matches, panic, unported, unreachable } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import { all_traits } from "./suggest.ts";

// method/probe.rs:105 `impl Deref for ProbeContext { type Target = FnCtxt }` (`&self.fcx`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ProbeContext, "fcx", FnCtxt);

// ---- D4 descriptors (PORT) -------------------------------------------------------------------------------------------

/** PORT: `#[derive(TypeFoldable, TypeVisitable)] ParamEnvAnd<T>` (rustc_middle ty/mod.rs) has no generated descriptor. */
function fold_ParamEnvAnd<T>(d_T: TypeFoldable<T>): TypeFoldable<ParamEnvAnd<T>> {
  return {
    visit_with<R>(self: ParamEnvAnd<T>, visitor: TypeVisitor<R>): R {
      let r: R | undefined;
      if ((r = try_visit(visitor.Result, visit_with_ParamEnv(self.param_env, visitor))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, d_T.visit_with(self.value, visitor))) !== undefined) return r;
      return visitor.Result.output();
    },
    try_fold_with<E>(self: ParamEnvAnd<T>, folder: FallibleTypeFolder<E>): Result<ParamEnvAnd<T>, E> {
      const param_env = try_fold_with_ParamEnv(self.param_env, folder);
      if (param_env.$ === "Err") return param_env;
      const value = d_T.try_fold_with(self.value, folder);
      if (value.$ === "Err") return value;
      return Ok({ param_env: param_env._0, value: value._0 });
    },
    fold_with(self: ParamEnvAnd<T>, folder: TypeFolder): ParamEnvAnd<T> {
      return { param_env: fold_with_ParamEnv(self.param_env, folder), value: d_T.fold_with(self.value, folder) };
    },
  };
}

/**
 * PORT: `#[derive(TypeFoldable, TypeVisitable)] MethodAutoderefSteps` (rustc_middle traits/query.rs). The generated
 * query.gen.ts impls stop at `unported_type_fold` for `predefined_opaques_in_body` (its `PredefinedOpaques` comes from
 * traits/solve.gen.ts, not mapped to structural_impls' `fold_PredefinedOpaques`): codegen typemap follow-up for root.
 */
export const fold_MethodAutoderefSteps: TypeFoldable<MethodAutoderefSteps> = {
  visit_with<R>(self: MethodAutoderefSteps, visitor: TypeVisitor<R>): R {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, fold_PredefinedOpaques.visit_with(self.predefined_opaques_in_body, visitor))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, visit_with_Ty(self.self_ty, visitor))) !== undefined) return r;
    return visitor.Result.output();
  },
  try_fold_with<E>(self: MethodAutoderefSteps, folder: FallibleTypeFolder<E>): Result<MethodAutoderefSteps, E> {
    const predefined_opaques_in_body = fold_PredefinedOpaques.try_fold_with(self.predefined_opaques_in_body, folder);
    if (predefined_opaques_in_body.$ === "Err") return predefined_opaques_in_body;
    const self_ty = try_fold_with_Ty(self.self_ty, folder);
    if (self_ty.$ === "Err") return self_ty;
    return Ok({ predefined_opaques_in_body: predefined_opaques_in_body._0, self_ty: self_ty._0 });
  },
  fold_with(self: MethodAutoderefSteps, folder: TypeFolder): MethodAutoderefSteps {
    return {
      predefined_opaques_in_body: fold_PredefinedOpaques.fold_with(self.predefined_opaques_in_body, folder),
      self_ty: fold_with_Ty(self.self_ty, folder),
    };
  },
};

const fold_ParamEnvAnd_MethodAutoderefSteps = fold_ParamEnvAnd(fold_MethodAutoderefSteps);
const fold_QueryResponse_Ty = fold_QueryResponse(fold_Ty);
const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** PORT: `CandidateStep.self_ty` is `Canonical<'tcx, QueryResponse<'tcx, Ty<'tcx>>>` upstream (see the file header). */
function step_self_ty(step: CandidateStep): Canonical<QueryResponse<Ty>> {
  return step.self_ty as Canonical<QueryResponse<Ty>>;
}
/** PORT: `MethodAutoderefBadTy.ty` is `Canonical<'tcx, QueryResponse<'tcx, Ty<'tcx>>>` upstream (see the file header). */
function bad_ty_ty(bad_ty: MethodAutoderefBadTy): Canonical<QueryResponse<Ty>> {
  return bad_ty.ty as Canonical<QueryResponse<Ty>>;
}
/** `{:?}` of a `Canonical<QueryResponse<Ty>>` (for `span_bug!` messages). */
function debug_canonical_ty(c: Canonical<QueryResponse<Ty>>): string {
  return debug_Canonical(c, PLAIN, (x, f) => debug_QueryResponse(x, f, debug_Ty));
}
/** `Ident`'s `Eq`/`Hash` (name + `SyntaxContext`), the key of an `FxHashSet<Ident>`. */
function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}

// ---- impl AutorefOrPtrAdjustment -------------------------------------------------------------------------------------

export type AutorefOrPtrAdjustment = gen.AutorefOrPtrAdjustment;
export const AutorefOrPtrAdjustment = {
  ...gen.AutorefOrPtrAdjustment,

  // rustc: compiler/rustc_hir_typeck/src/method/probe.rs:163 get_unsize
  get_unsize(self: AutorefOrPtrAdjustment): boolean {
    switch (self.$) {
      case "Autoref":
        return self.unsize;
      case "ToConstPtr":
        return false;
      case "ReborrowPin":
        return false;
    }
  },
};

// ---- impl PickConstraintsForShadowed ---------------------------------------------------------------------------------

declare module "./probe.gen.ts" {
  interface PickConstraintsForShadowed {
    may_shadow_based_on_autoderefs(autoderefs: number): boolean;
    candidate_may_shadow(candidate: Candidate): boolean;
  }
  interface Candidate {
    to_unadjusted_pick(self_ty: Ty, unstable_candidates: [Candidate, Symbol][]): Pick;
  }
}

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:197 may_shadow_based_on_autoderefs
PickConstraintsForShadowed.prototype.may_shadow_based_on_autoderefs = function (this: PickConstraintsForShadowed, autoderefs: number): boolean {
  return autoderefs === this.autoderefs;
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:201 candidate_may_shadow
PickConstraintsForShadowed.prototype.candidate_may_shadow = function (this: PickConstraintsForShadowed, candidate: Candidate): boolean {
  // An item never shadows itself
  if (DefId_eq(candidate.item.def_id, this.def_id)) {
    return false;
  }
  // and we're only concerned about inherent impls doing the shadowing.
  // Shadowing can only occur if the impl being shadowed is further along
  // the Receiver dereferencing chain than the impl doing the shadowing.
  switch (candidate.kind.$) {
    case "InherentImplCandidate": {
      const receiver_steps = candidate.kind.receiver_steps;
      const shadowed_receiver_steps = this.receiver_steps;
      if (shadowed_receiver_steps !== undefined) {
        return receiver_steps > shadowed_receiver_steps;
      }
      return false;
    }
    default:
      return false;
  }
};

// ---- impl FnCtxt -----------------------------------------------------------------------------------------------------

/// This is used to offer suggestions to users. It returns methods
/// that could have been called which have the desired return
/// type. Some effort is made to rule out methods that, if called,
/// would result in an error (basically, the same criteria we
/// would use to decide if a method is a plausible fit for
/// ambiguity purposes).
// #[instrument(level = "debug", skip(self, candidate_filter))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:293 probe_for_return_type_for_diagnostic
FnCtxt.prototype.probe_for_return_type_for_diagnostic = function (
  this: FnCtxt,
  span: Span,
  mode: Mode,
  return_type: Ty,
  self_ty: Ty,
  scope_expr_id: HirId,
  candidate_filter: (_1: AssocItem) => boolean,
): AssocItem[] {
  const r = this.probe_op(span, mode, undefined, return_type, { _0: true }, self_ty, scope_expr_id, gen.ProbeScope.AllTraits, (probe_cx) =>
    Ok(probe_cx.candidate_method_names(candidate_filter)),
  );
  const method_names: Ident[] = r.$ === "Ok" ? r._0 : [];
  const out: AssocItem[] = [];
  for (const method_name of method_names) {
    const pick = this.probe_op(span, mode, method_name, return_type, { _0: true }, self_ty, scope_expr_id, gen.ProbeScope.AllTraits, (probe_cx) => probe_cx.pick());
    if (pick.$ === "Ok") {
      out.push(pick._0.item);
    }
  }
  return out;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:336 probe_for_name
FnCtxt.prototype.probe_for_name = function (
  this: FnCtxt,
  mode: Mode,
  item_name: Ident,
  return_type: Ty | undefined,
  is_suggestion: IsSuggestion,
  self_ty: Ty,
  scope_expr_id: HirId,
  scope: ProbeScope,
): PickResult {
  return this.probe_op(item_name.span, mode, item_name, return_type, is_suggestion, self_ty, scope_expr_id, scope, (probe_cx) => probe_cx.pick());
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:360 probe_for_name_many
FnCtxt.prototype.probe_for_name_many = function (
  this: FnCtxt,
  mode: Mode,
  item_name: Ident,
  return_type: Ty | undefined,
  is_suggestion: IsSuggestion,
  self_ty: Ty,
  scope_expr_id: HirId,
  scope: ProbeScope,
): Result<Candidate[], MethodError> {
  return this.probe_op(item_name.span, mode, item_name, return_type, is_suggestion, self_ty, scope_expr_id, scope, (probe_cx) =>
    Ok([...probe_cx.inherent_candidates, ...probe_cx.extension_candidates]),
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:389 probe_op
FnCtxt.prototype.probe_op = function <R>(
  this: FnCtxt,
  span: Span,
  mode: Mode,
  method_name: Ident | undefined,
  return_type: Ty | undefined,
  is_suggestion: IsSuggestion,
  self_ty: Ty,
  scope_expr_id: HirId,
  scope: ProbeScope,
  op: (_1: ProbeContext) => Result<R, MethodError>,
): Result<R, MethodError> {
  // #[derive(Diagnostic)]
  // #[diag("type annotations needed")]
  // struct MissingTypeAnnot;
  //
  // #[derive(Diagnostic)]
  // #[diag("method call on a diverging inference variable")]
  // #[help("consider providing a type annotation")]
  // struct MethodCallOnDivergingInferenceVariable;
  // PORT: these two `#[derive(Diagnostic)]` structs (local to `probe_op`) are not generated by tools/codegen: their
  // emission sites below stop at `unported(..)`.

  const orig_values = OriginalQueryValues.default_();
  const predefined_opaques_in_body = this.next_trait_solver()
    ? this.tcx.mk_predefined_opaques_in_body_from_iter(
        [...this.inner.opaque_types().deref().iter_opaque_types()].map(([k, v]): [typeof k, Ty] => [k, v.ty]),
      )
    : RawList.empty<never>();
  const value: MethodAutoderefSteps = { predefined_opaques_in_body, self_ty };
  const query_input = this.canonicalize_query({ param_env: this.param_env, value }, orig_values, fold_MethodAutoderefSteps);

  let steps: MethodAutoderefStepsResult;
  switch (mode) {
    case "MethodCall":
      steps = this.tcx.method_autoderef_steps(query_input);
      break;
    case "Path":
      steps = this.probe((_) => {
        // Mode::Path - the deref steps is "trivial". This turns
        // our CanonicalQuery into a "trivial" QueryResponse. This
        // is a bit inefficient, but I don't think that writing
        // special handling for this "trivial case" is a good idea.

        const infcx = this.infcx;
        const [{ param_env: _param_env, value: value_ }, var_values] = infcx.instantiate_canonical(span, query_input.canonical, fold_ParamEnvAnd_MethodAutoderefSteps);
        const { predefined_opaques_in_body: _predefined_opaques_in_body, self_ty } = value_;
        // debug!(?self_ty, ?query_input, "probe_op: Mode::Path");
        const prev_opaque_entries = this.inner.opaque_types().deref().num_entries();
        return {
          steps: [
            {
              self_ty: this.make_query_response_ignoring_pending_obligations(var_values, self_ty, prev_opaque_entries, fold_Ty),
              self_ty_is_opaque: false,
              autoderefs: 0,
              from_unsafe_deref: false,
              unsize: false,
              reachable_via_deref: true,
            },
          ],
          opt_bad_ty: undefined,
          reached_recursion_limit: false,
        };
      });
      break;
  }

  // If our autoderef loop had reached the recursion limit,
  // report an overflow error, but continue going on with
  // the truncated autoderef list.
  if (steps.reached_recursion_limit && !is_suggestion._0) {
    this.probe((_) => {
      const last = steps.steps[steps.steps.length - 1];
      const ty_ = last !== undefined ? step_self_ty(last) : span_bug(span, "reached the recursion limit in 0 steps?");
      const r = this.probe_instantiate_query_response(span, orig_values, ty_);
      const ty = r.$ === "Ok" ? r._0 : span_bug(span, `instantiating ${debug_canonical_ty(ty_)} failed?`);
      report_autoderef_recursion_limit_error(this.tcx, span, ty.value);
    });
  }

  // If we encountered an `_` type or an error type during autoderef, this is
  // ambiguous.
  const bad_ty = steps.opt_bad_ty;
  if (bad_ty !== undefined) {
    // We care about the opt_bad_ty given the inference state at the point of computing the auto deref chain,
    // so we don't call structurally_resolve_type as it processes obligations in our local FnCtxt,
    // potentially making inference progress.
    const ty__ = bad_ty_ty(bad_ty);
    const r = this.probe_instantiate_query_response(span, orig_values, ty__);
    const ty_ = r.$ === "Ok" ? r._0 : span_bug(span, `instantiating ${debug_canonical_ty(ty__)} failed?`);
    const ty = ty_.value;

    const k = ty.kind();
    // `else if let ty::Infer(ty::TyVar(ty_id)) = *ty.kind() && let ty_id = .. && self.diverging_type_vars..any(..)`
    // (evaluated only when the earlier branches did not match).
    const is_diverging_infer_var = (): boolean => {
      if (k.$ === "Infer" && k._0.$ === "TyVar") {
        const ty_id = this.sub_unification_table_root_var(k._0._0);
        return this.diverging_type_vars.some((candidate_id) => this.sub_unification_table_root_var(candidate_id) === ty_id);
      }
      return false;
    };

    if (is_suggestion._0) {
      // Ambiguity was encountered during a suggestion. There's really
      // not much use in suggesting methods in this case.
      const data: NoMatchData = {
        static_candidates: [],
        unsatisfied_predicates: [],
        out_of_scope_traits: [],
        similar_candidate: undefined,
        mode,
      };
      return Err({ $: "NoMatch", _0: data });
    } else if (bad_ty.reached_raw_pointer && !this.tcx.features().arbitrary_self_types_pointers() && !this.tcx.sess.at_least_rust_2018()) {
      // this case used to be allowed by the compiler,
      // so we do a future-compat lint here for the 2015 edition
      // (see https://github.com/rust-lang/rust/issues/46906)
      this.tcx.emit_node_span_lint(TYVAR_BEHIND_RAW_POINTER, scope_expr_id, span, unported("#[derive(Diagnostic)] rustc_hir_typeck::method::probe::probe_op::MissingTypeAnnot"));
      // If `ty` is an inference variable that was created by being adjusted from the never type,
      // We demand the type to be equal to the never type, so we can probe the never type for methods
      // (see https://github.com/rust-lang/rust/issues/143349)
    } else if (is_diverging_infer_var()) {
      this.tcx.emit_node_span_lint(
        METHOD_CALL_ON_DIVERGING_INFER_VAR,
        scope_expr_id,
        span,
        unported("#[derive(Diagnostic)] rustc_hir_typeck::method::probe::probe_op::MethodCallOnDivergingInferenceVariable"),
      );
      this.demand_eqtype(span, ty, this.tcx.types.never);
    } else {
      let guar: ErrorGuaranteed;
      const tainted = this.tainted_by_errors();
      if (tainted !== undefined) {
        guar = tainted;
      } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
        // We want to get the variable name that the method
        // is being called on. If it is a method call.
        const node = this.tcx.hir_node(scope_expr_id);
        const err_span = mode === "MethodCall" && node.$ === "Expr" && node._0.kind.$ === "MethodCall" ? node._0.kind._1.span : span;

        const raw_ptr_call = bad_ty.reached_raw_pointer && !this.tcx.features().arbitrary_self_types();

        const err_ctxt = this.err_ctxt();
        // PORT: `TypeErrCtxt::emit_inference_failure_err` / `TypeAnnotationNeeded` (rustc_trait_selection
        // error_reporting/infer/need_type_info.rs, wave 19) are not ported.
        void err_ctxt;
        void err_span;
        const err: Diag = unported("rustc_trait_selection::error_reporting::infer::need_type_info::emit_inference_failure_err");
        if (raw_ptr_call) {
          err.span_label(span, "cannot call a method on a raw pointer with an unknown pointee type");
        }
        guar = err.emit_err();
      } else if (k.$ === "Error") {
        guar = k._0;
      } else {
        bug("unexpected bad final type in method autoderef");
      }
      this.demand_eqtype(span, ty, Ty.new_error(this.tcx, guar));
      return Err({ $: "ErrorReported", _0: guar });
    }
  }

  // debug!("ProbeContext: steps for self_ty={:?} are {:?}", self_ty, steps);

  // this creates one big transaction so that all type variables etc
  // that we create during the probe process are removed later
  return this.probe((_) => {
    const probe_cx = ProbeContext.new(this, span, mode, method_name, return_type, orig_values, steps.steps, scope_expr_id, is_suggestion);

    switch (scope.$) {
      case "TraitsInScope":
        probe_cx.assemble_inherent_candidates();
        probe_cx.assemble_extension_candidates_for_traits_in_scope();
        break;
      case "AllTraits":
        probe_cx.assemble_inherent_candidates();
        probe_cx.assemble_extension_candidates_for_all_traits();
        break;
      case "Single": {
        const def_id = scope._0;
        const self_ty_override = scope._1;
        const item = this.tcx.associated_item(def_id) as AssocItem;
        assert_matches(
          item.container,
          item.container.$ === "Trait" || item.container.$ === "InherentImpl",
          "AssocContainer::Trait | AssocContainer::InherentImpl",
          (v) => v.$,
        );

        const trait_def_id = this.tcx.parent(def_id);
        const trait_span = this.tcx.def_span(trait_def_id);

        const trait_args = this.fresh_args_for_item(trait_span, trait_def_id);
        const trait_ref = TraitRef.new_from_args(as_interner(this.tcx), trait_def_id, trait_args);

        probe_cx.self_ty_override = self_ty_override;
        let kind: CandidateKind;
        switch (item.container.$) {
          case "Trait":
            kind = { $: "TraitCandidate", trait_ref: Binder.dummy(trait_ref, d_TraitRef), is_ambiguously_imported: false };
            break;
          case "InherentImpl":
            kind = { $: "InherentImplCandidate", impl_def_id: this.tcx.parent(def_id), receiver_steps: 0 };
            break;
          default:
            unreachable();
        }
        probe_cx.push_candidate(new Candidate(item, kind, []), false);
        break;
      }
    }
    return op(probe_cx);
  });
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:635 method_autoderef_steps
export function method_autoderef_steps(tcx: TyCtxt, goal_: CanonicalMethodAutoderefStepsGoal): MethodAutoderefStepsResult {
  // debug!("method_autoderef_steps({:?})", goal);

  const [infcx, goal, inference_vars] = tcx.infer_ctxt().build_with_canonical(DUMMY_SP, goal_, fold_ParamEnvAnd_MethodAutoderefSteps);
  const {
    param_env,
    value: { predefined_opaques_in_body, self_ty },
  } = goal;
  for (const [key, ty] of predefined_opaques_in_body) {
    const prev = infcx.register_hidden_type_in_storage(key, new ProvisionalHiddenType(DUMMY_SP, ty));
    // It may be possible that two entries in the opaque type storage end up
    // with the same key after resolving contained inference variables.
    //
    // We could put them in the duplicate list but don't have to. The opaques we
    // encounter here are already tracked in the caller, so there's no need to
    // also store them here. We'd take them out when computing the query response
    // and then discard them, as they're already present in the input.
    //
    // Ideally we'd drop duplicate opaque type definitions when computing
    // the canonical input. This is more annoying to implement and may cause a
    // perf regression, so we do it inside of the query for now.
    if (prev !== undefined) {
      // debug!(?key, ?ty, ?prev, "ignore duplicate in `opaque_types_storage`");
    }
  }
  const prev_opaque_entries = infcx.inner.opaque_types().deref().num_entries();

  // We accept not-yet-defined opaque types in the autoderef
  // chain to support recursive calls. We do error if the final
  // infer var is not an opaque.
  const self_ty_is_opaque = (ty: Ty): boolean => {
    const k = ty.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar") {
      return infcx.has_opaques_with_sub_unified_hidden_type(k._0._0);
    } else {
      return false;
    }
  };

  // If arbitrary self types is not enabled, we follow the chain of
  // `Deref<Target=T>`. If arbitrary self types is enabled, we instead
  // follow the chain of `Receiver<Target=T>`, but we also record whether
  // such types are reachable by following the (potentially shorter)
  // chain of `Deref<Target=T>`. We will use the first list when finding
  // potentially relevant function implementations (e.g. relevant impl blocks)
  // but the second list when determining types that the receiver may be
  // converted to, in order to find out which of those methods might actually
  // be callable.
  const autoderef_via_deref = Autoderef.new(infcx, param_env, CRATE_DEF_ID, DUMMY_SP, self_ty).include_raw_pointers().silence_errors();

  let reached_raw_pointer = false;
  const arbitrary_self_types_enabled = tcx.features().arbitrary_self_types() || tcx.features().arbitrary_self_types_pointers();
  let steps: CandidateStep[];
  let reached_recursion_limit: boolean;
  if (arbitrary_self_types_enabled) {
    // PORT: `autoderef_via_deref.by_ref().map(|_| true).chain(std::iter::repeat(false))`, zipped lazily after each step
    // of `autoderef_via_receiver` (`Zip::next` pulls the receiver chain first; `Chain` stops calling the deref chain
    // once it returned `None`).
    let deref_exhausted = false;
    const reachable_via_deref_next = (): boolean => {
      if (!deref_exhausted) {
        if (autoderef_via_deref.next() !== undefined) {
          return true;
        }
        deref_exhausted = true;
      }
      return false;
    };

    const autoderef_via_receiver = Autoderef.new(infcx, param_env, CRATE_DEF_ID, DUMMY_SP, self_ty).include_raw_pointers().use_receiver_trait().silence_errors();
    steps = [];
    for (let next = autoderef_via_receiver.next(); next !== undefined; next = autoderef_via_receiver.next()) {
      const [ty, d] = next;
      const reachable_via_deref = reachable_via_deref_next();
      const step: CandidateStep = {
        self_ty: infcx.make_query_response_ignoring_pending_obligations(inference_vars, ty, prev_opaque_entries, fold_Ty),
        self_ty_is_opaque: self_ty_is_opaque(ty),
        autoderefs: d,
        from_unsafe_deref: reached_raw_pointer,
        unsize: false,
        reachable_via_deref,
      };
      if (ty.is_raw_ptr()) {
        // all the subsequent steps will be from_unsafe_deref
        reached_raw_pointer = true;
      }
      steps.push(step);
    }
    reached_recursion_limit = autoderef_via_receiver.reached_recursion_limit();
  } else {
    steps = [];
    for (let next = autoderef_via_deref.next(); next !== undefined; next = autoderef_via_deref.next()) {
      const [ty, d] = next;
      const step: CandidateStep = {
        self_ty: infcx.make_query_response_ignoring_pending_obligations(inference_vars, ty, prev_opaque_entries, fold_Ty),
        self_ty_is_opaque: self_ty_is_opaque(ty),
        autoderefs: d,
        from_unsafe_deref: reached_raw_pointer,
        unsize: false,
        reachable_via_deref: true,
      };
      if (ty.is_raw_ptr()) {
        // all the subsequent steps will be from_unsafe_deref
        reached_raw_pointer = true;
      }
      steps.push(step);
    }
    reached_recursion_limit = autoderef_via_deref.reached_recursion_limit();
  }
  const final_ty = autoderef_via_deref.final_ty();
  let opt_bad_ty: MethodAutoderefBadTy | undefined;
  const fk = final_ty.kind();
  if (fk.$ === "Infer" && fk._0.$ === "TyVar" && !self_ty_is_opaque(final_ty)) {
    opt_bad_ty = {
      reached_raw_pointer,
      ty: infcx.make_query_response_ignoring_pending_obligations(inference_vars, final_ty, prev_opaque_entries, fold_Ty),
    };
  } else if (fk.$ === "Error") {
    opt_bad_ty = {
      reached_raw_pointer,
      ty: infcx.make_query_response_ignoring_pending_obligations(inference_vars, final_ty, prev_opaque_entries, fold_Ty),
    };
  } else if (fk.$ === "Array") {
    const elem_ty = fk._0;
    const autoderefs = steps.filter((s) => s.reachable_via_deref).length - 1;
    steps.push({
      self_ty: infcx.make_query_response_ignoring_pending_obligations(inference_vars, Ty.new_slice(infcx.tcx, elem_ty), prev_opaque_entries, fold_Ty),
      self_ty_is_opaque: false,
      autoderefs,
      // this could be from an unsafe deref if we had
      // a *mut/const [T; N]
      from_unsafe_deref: reached_raw_pointer,
      unsize: true,
      reachable_via_deref: true, // this is always the final type from
      // autoderef_via_deref
    });

    opt_bad_ty = undefined;
  } else {
    opt_bad_ty = undefined;
  }

  // debug!("method_autoderef_steps: steps={:?} opt_bad_ty={:?}", steps, opt_bad_ty);
  // Need to empty the opaque types storage before it gets dropped.
  void infcx.take_opaque_types();
  return {
    steps,
    opt_bad_ty,
    reached_recursion_limit,
  };
}

// ---- impl ProbeContext -----------------------------------------------------------------------------------------------

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:105 deref
ProbeContext.prototype.deref = function (this: ProbeContext): FnCtxt {
  return this.fcx;
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:804 new
(ProbeContext as unknown as { new: typeof ProbeContext.new }).new = function (
  fcx: FnCtxt,
  span: Span,
  mode: Mode,
  method_name: Ident | undefined,
  return_type: Ty | undefined,
  orig_steps_var_values: OriginalQueryValues,
  steps: readonly CandidateStep[],
  scope_expr_id: HirId,
  is_suggestion: IsSuggestion,
): ProbeContext {
  return new ProbeContext(
    fcx,
    span,
    mode,
    method_name,
    return_type,
    orig_steps_var_values,
    steps,
    [],
    [],
    new DefIdSet(),
    false,
    [],
    undefined,
    [],
    scope_expr_id,
    is_suggestion,
    undefined,
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:836 reset
ProbeContext.prototype.reset = function (this: ProbeContext): void {
  this.inherent_candidates.length = 0;
  this.extension_candidates.length = 0;
  this.impl_dups.clear();
  this.private_candidates.length = 0;
  this.private_candidate = undefined;
  this.static_candidates.length = 0;
};

/// When we're looking up a method by path (UFCS), we relate the receiver
/// types invariantly. When we are looking up a method by the `.` operator,
/// we relate them covariantly.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:848 variance
ProbeContext.prototype.variance = function (this: ProbeContext): Variance {
  switch (this.mode) {
    case "MethodCall":
      return "Covariant";
    case "Path":
      return "Invariant";
  }
};

///////////////////////////////////////////////////////////////////////////
// CANDIDATE ASSEMBLY

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:858 push_candidate
ProbeContext.prototype.push_candidate = function (this: ProbeContext, candidate: Candidate, is_inherent: boolean): void {
  let is_accessible: boolean;
  const name = this.method_name;
  if (name !== undefined) {
    const item = candidate.item;
    const container_id = AssocItem.container_id(item, this.tcx);
    const def_scope = this.tcx.adjust_ident_and_get_scope(name, container_id, this.mod_id)[1];
    is_accessible = Visibility.is_accessible_from(AssocItem.visibility(item, this.tcx), def_scope, this.tcx);
  } else {
    is_accessible = true;
  }
  if (is_accessible) {
    if (is_inherent) {
      this.inherent_candidates.push(candidate);
    } else {
      this.extension_candidates.push(candidate);
    }
  } else {
    this.private_candidates.push(candidate);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:878 assemble_inherent_candidates
ProbeContext.prototype.assemble_inherent_candidates = function (this: ProbeContext): void {
  for (const step of this.steps) {
    this.assemble_probe(step_self_ty(step), step.autoderefs);
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:885 assemble_probe
ProbeContext.prototype.assemble_probe = function (this: ProbeContext, self_ty: Canonical<QueryResponse<Ty>>, receiver_steps: number): void {
  const raw_self_ty = self_ty.value.value;
  const k = raw_self_ty.kind();
  switch (k.$) {
    case "Dynamic": {
      const p = k._0.principal();
      if (p !== undefined) {
        // Subtle: we can't use `instantiate_query_response` here: using it will
        // commit to all of the type equalities assumed by inference going through
        // autoderef (see the `method-probe-no-guessing` test).
        //
        // However, in this code, it is OK if we end up with an object type that is
        // "more general" than the object type that we are evaluating. For *every*
        // object type `MY_OBJECT`, a function call that goes through a trait-ref
        // of the form `<MY_OBJECT as SuperTraitOf(MY_OBJECT)>::func` is a valid
        // `ObjectCandidate`, and it should be discoverable "exactly" through one
        // of the iterations in the autoderef loop, so there is no problem with it
        // being discoverable in another one of these iterations.
        //
        // Using `instantiate_canonical` on our
        // `Canonical<QueryResponse<Ty<'tcx>>>` and then *throwing away* the
        // `CanonicalVarValues` will exactly give us such a generalization - it
        // will still match the original object type, but it won't pollute our
        // type variables in any form, so just do that!
        const [{ value: generalized_self_ty }, _ignored_var_values] = this.fcx.instantiate_canonical(this.span, self_ty, fold_QueryResponse_Ty);

        this.assemble_inherent_candidates_from_object(generalized_self_ty);
        this.assemble_inherent_impl_candidates_for_type(Binder.skip_binder(p).def_id, receiver_steps);
        this.assemble_inherent_candidates_for_incoherent_ty(raw_self_ty, receiver_steps);
      }
      break;
    }
    case "Adt": {
      const def_id = k._0.did();
      this.assemble_inherent_impl_candidates_for_type(def_id, receiver_steps);
      this.assemble_inherent_candidates_for_incoherent_ty(raw_self_ty, receiver_steps);
      break;
    }
    case "Foreign": {
      const did = k._0;
      this.assemble_inherent_impl_candidates_for_type(did, receiver_steps);
      this.assemble_inherent_candidates_for_incoherent_ty(raw_self_ty, receiver_steps);
      break;
    }
    case "Param":
      this.assemble_inherent_candidates_from_param(raw_self_ty);
      break;
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "Never":
    case "Tuple":
      this.assemble_inherent_candidates_for_incoherent_ty(raw_self_ty, receiver_steps);
      break;
    case "Alias":
    case "Bound":
    case "Closure":
    case "Coroutine":
    case "CoroutineClosure":
    case "CoroutineWitness":
    case "Error":
    case "FnDef":
    case "FnPtr":
    case "Infer":
    case "Pat":
    case "Placeholder":
    case "UnsafeBinder":
      break;
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:960 assemble_inherent_candidates_for_incoherent_ty
ProbeContext.prototype.assemble_inherent_candidates_for_incoherent_ty = function (this: ProbeContext, self_ty: Ty, receiver_steps: number): void {
  const simp = simplify_type(as_interner(this.tcx), self_ty, TreatParams.InstantiateWithInfer);
  if (simp === undefined) {
    bug(`unexpected incoherent type: ${debug_Ty(self_ty, PLAIN)}`);
  }
  for (const impl_def_id of this.tcx.incoherent_impls(simp)) {
    this.assemble_inherent_impl_probe(impl_def_id, receiver_steps);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:973 assemble_inherent_impl_candidates_for_type
ProbeContext.prototype.assemble_inherent_impl_candidates_for_type = function (this: ProbeContext, def_id: DefId, receiver_steps: number): void {
  const impl_def_ids = this.tcx.at(this.span).inherent_impls(def_id);
  for (const impl_def_id of impl_def_ids) {
    this.assemble_inherent_impl_probe(impl_def_id, receiver_steps);
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:981 assemble_inherent_impl_probe
ProbeContext.prototype.assemble_inherent_impl_probe = function (this: ProbeContext, impl_def_id: DefId, receiver_steps: number): void {
  if (this.impl_dups.has(impl_def_id)) {
    return; // already visited
  }
  this.impl_dups.add(impl_def_id);

  for (const item of this.impl_or_trait_item(impl_def_id)) {
    if (!this.has_applicable_self(item)) {
      // No receiver declared. Not a candidate.
      this.record_static_candidate({ $: "Impl", _0: impl_def_id });
      continue;
    }
    this.push_candidate(new Candidate(item, { $: "InherentImplCandidate", impl_def_id, receiver_steps }, []), true);
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1004 assemble_inherent_candidates_from_object
ProbeContext.prototype.assemble_inherent_candidates_from_object = function (this: ProbeContext, self_ty: Ty): void {
  const k = self_ty.kind();
  const principal = k.$ === "Dynamic" ? k._0.principal() : undefined;
  if (principal === undefined) {
    span_bug(this.span, `non-object ${debug_Ty(self_ty, PLAIN)} in assemble_inherent_candidates_from_object`);
  }

  // It is illegal to invoke a method on a trait instance that refers to
  // the `Self` type. An [`DynCompatibilityViolation::SupertraitSelf`] error
  // will be reported by `dyn_compatibility.rs` if the method refers to the
  // `Self` type anywhere other than the receiver. Here, we use a
  // instantiation that replaces `Self` with the object type itself. Hence,
  // a `&self` method will wind up with an argument type like `&dyn Trait`.
  const trait_ref = PolyExistentialTraitRef.with_self_ty(principal, as_interner(this.tcx), self_ty);
  this.assemble_candidates_for_bounds(supertraits(this.tcx, trait_ref), (this_, new_trait_ref, item) => {
    this_.push_candidate(new Candidate(item, { $: "ObjectCandidate", _0: new_trait_ref }, []), true);
  });
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1037 assemble_inherent_candidates_from_param
ProbeContext.prototype.assemble_inherent_candidates_from_param = function (this: ProbeContext, param_ty: Ty): void {
  // debug_assert_matches!(param_ty.kind(), ty::Param(_));

  const tcx = this.tcx;

  // We use `DeepRejectCtxt` here which may return false positive on where clauses
  // with alias self types. We need to later on reject these as inherent candidates
  // in `consider_probe`.
  const caller_bounds = this.param_env.caller_bounds();
  const bounds = (function* (): Generator<PolyTraitRef> {
    for (const clause of caller_bounds) {
      const bound_clause = clause.kind();
      const kind = Binder.skip_binder(bound_clause);
      switch (kind.$) {
        case "Trait": {
          const trait_predicate = kind._0;
          if (DeepRejectCtxt.relate_rigid_rigid(as_interner(tcx)).types_may_unify(param_ty, TraitRef.self_ty(trait_predicate.trait_ref))) {
            yield Binder.rebind(bound_clause, trait_predicate.trait_ref);
          }
          break;
        }
        case "RegionOutlives":
        case "TypeOutlives":
        case "Projection":
        case "ConstArgHasType":
        case "WellFormed":
        case "ConstEvaluatable":
        case "UnstableFeature":
        case "HostEffect":
          break;
      }
    }
  })();

  this.assemble_candidates_for_bounds(bounds, (this_, poly_trait_ref, item) => {
    this_.push_candidate(new Candidate(item, { $: "WhereClauseCandidate", _0: poly_trait_ref }, []), true);
  });
};

// Do a search through a list of bounds, using a callback to actually
// create the candidates.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1072 assemble_candidates_for_bounds
ProbeContext.prototype.assemble_candidates_for_bounds = function (
  this: ProbeContext,
  bounds: Iterable<PolyTraitRef>,
  mk_cand: (_1: ProbeContext, _2: PolyTraitRef, _3: AssocItem) => void,
): void {
  for (const bound_trait_ref of bounds) {
    // debug!("elaborate_bounds(bound_trait_ref={:?})", bound_trait_ref);
    for (const item of this.impl_or_trait_item(PolyTraitRefC.def_id(bound_trait_ref))) {
      if (!this.has_applicable_self(item)) {
        this.record_static_candidate({ $: "Trait", _0: PolyTraitRefC.def_id(bound_trait_ref) });
      } else {
        mk_cand(this, bound_trait_ref, item);
      }
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1092 assemble_extension_candidates_for_traits_in_scope
ProbeContext.prototype.assemble_extension_candidates_for_traits_in_scope = function (this: ProbeContext): void {
  const duplicates = new KeyedSet<[DefId, boolean]>(([did, b]) => `${DefId_key(did)}:${b}`);
  const opt_applicable_traits = this.tcx.in_scope_traits(this.scope_expr_id);
  if (opt_applicable_traits !== undefined) {
    const applicable_traits = opt_applicable_traits;
    for (const trait_candidate of applicable_traits) {
      const trait_did = trait_candidate.def_id;
      // If we have the same trait in scope but one of them is ambiguous and the other
      // is not, we should treat them differently and then handle them later on.
      const key: [DefId, boolean] = [trait_did, trait_candidate.lint_ambiguous];
      if (!duplicates.has(key)) {
        duplicates.add(key);
        this.assemble_extension_candidates_for_trait(trait_candidate.import_ids, trait_did, trait_candidate.lint_ambiguous);
      }
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1112 assemble_extension_candidates_for_all_traits
ProbeContext.prototype.assemble_extension_candidates_for_all_traits = function (this: ProbeContext): void {
  const duplicates = new DefIdSet();
  for (const trait_info of all_traits(this.tcx)) {
    if (!duplicates.has(trait_info.def_id)) {
      duplicates.add(trait_info.def_id);
      this.assemble_extension_candidates_for_trait([], trait_info.def_id, false);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1121 matches_return_type
ProbeContext.prototype.matches_return_type = function (this: ProbeContext, method: AssocItem, expected: Ty): boolean {
  switch (method.kind.$) {
    case "Fn":
      return this.probe((_) => {
        const args = this.fresh_args_for_item(this.span, method.def_id);
        const fty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.fn_sig(method.def_id) as EarlyBinder<Binder<FnSig>>, this.tcx, args, fold_Binder(fold_FnSig)));
        const fty = this.instantiate_binder_with_fresh_vars(this.span, BoundRegionConversionTime.FnCall, fty_, fold_FnSig);
        return this.can_eq(this.param_env, FnSig.output(fty), expected, ToTrace_Ty);
      });
    default:
      return false;
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1139 assemble_extension_candidates_for_trait
ProbeContext.prototype.assemble_extension_candidates_for_trait = function (
  this: ProbeContext,
  import_ids: readonly LocalDefId[],
  trait_def_id: DefId,
  is_ambiguously_imported: boolean,
): void {
  const trait_args = this.fresh_args_for_item(this.span, trait_def_id);
  const trait_ref = TraitRef.new_from_args(as_interner(this.tcx), trait_def_id, trait_args);

  if (this.tcx.is_trait_alias(trait_def_id)) {
    // For trait aliases, recursively assume all explicitly named traits are relevant
    for (const [bound_trait_pred, _] of expand_trait_aliases(this.tcx, [[Clause_upcast_from_TraitRef(trait_ref, this.tcx), this.span]])[0]) {
      assert_eq(PolyTraitClause.polarity(bound_trait_pred), "Positive", (v) => v);
      const bound_trait_ref = Binder.map_bound(bound_trait_pred, (pred) => pred.trait_ref);
      for (const item of this.impl_or_trait_item(PolyTraitRefC.def_id(bound_trait_ref))) {
        if (!this.has_applicable_self(item)) {
          this.record_static_candidate({ $: "Trait", _0: PolyTraitRefC.def_id(bound_trait_ref) });
        } else {
          this.push_candidate(new Candidate(item, { $: "TraitCandidate", trait_ref: bound_trait_ref, is_ambiguously_imported }, import_ids), false);
        }
      }
    }
  } else {
    // debug_assert!(self.tcx.is_trait(trait_def_id));
    if (this.tcx.trait_is_auto(trait_def_id)) {
      return;
    }
    for (const item of this.impl_or_trait_item(trait_def_id)) {
      // Check whether `trait_def_id` defines a method with suitable name.
      if (!this.has_applicable_self(item)) {
        // debug!("method has inapplicable self");
        this.record_static_candidate({ $: "Trait", _0: trait_def_id });
        continue;
      }
      this.push_candidate(
        new Candidate(item, { $: "TraitCandidate", trait_ref: Binder.dummy(trait_ref, d_TraitRef), is_ambiguously_imported }, import_ids),
        false,
      );
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1202 candidate_method_names
ProbeContext.prototype.candidate_method_names = function (this: ProbeContext, candidate_filter: (_1: AssocItem) => boolean): Ident[] {
  const set = new KeyedSet<Ident>(Ident_key);
  const names: Ident[] = [];
  for (const candidate of [...this.inherent_candidates, ...this.extension_candidates]) {
    if (!candidate_filter(candidate.item)) continue;
    const return_ty = this.return_type;
    if (return_ty !== undefined && !this.matches_return_type(candidate.item, return_ty)) continue;
    // ensure that we don't suggest unstable methods
    // note that `DUMMY_SP` is ok here because it is only used for
    // suggestions and macro stuff which isn't applicable here.
    const stab: EvalResult = this.tcx.eval_stability(candidate.item.def_id, undefined, DUMMY_SP, undefined);
    if (stab.$ === "Deny") continue;
    const name = AssocItem.ident(candidate.item, this.tcx);
    if (set.has(name)) continue;
    set.add(name);
    names.push(name);
  }

  // Sort them by the name so we have a stable result.
  names.sort((a, b) => str_cmp(a.as_str(), b.as_str()));
  return names;
};

///////////////////////////////////////////////////////////////////////////
// THE ACTUAL SEARCH

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1241 pick
ProbeContext.prototype.pick = function (this: ProbeContext): PickResult {
  assert(this.method_name !== undefined, "assertion failed: self.method_name.is_some()");

  const unsatisfied_predicates: UnsatisfiedPredicates = [];

  const r = this.pick_core(unsatisfied_predicates);
  if (r !== undefined) {
    return r;
  }

  // If it's a `lookup_probe_for_diagnostic`, then quit early. No need to
  // probe for other candidates.
  if (this.is_suggestion._0) {
    const data: NoMatchData = {
      static_candidates: [],
      unsatisfied_predicates: [],
      out_of_scope_traits: [],
      similar_candidate: undefined,
      mode: this.mode,
    };
    return Err({ $: "NoMatch", _0: data });
  }

  // debug!("pick: actual search failed, assemble diagnostics");

  const static_candidates = this.static_candidates;
  this.static_candidates = [];
  const private_candidate = this.private_candidate;
  this.private_candidate = undefined;

  // things failed, so lets look at all traits, for diagnostic purposes now:
  this.reset();

  this.assemble_extension_candidates_for_all_traits();

  let out_of_scope_traits: DefId[];
  const pc = this.pick_core([]);
  if (pc !== undefined && pc.$ === "Ok") {
    out_of_scope_traits = [AssocItem.container_id(pc._0.item, this.tcx)];
  } else if (pc !== undefined && pc.$ === "Err" && pc._0.$ === "Ambiguity") {
    out_of_scope_traits = pc._0._0.map((source) => {
      switch (source.$) {
        case "Trait":
          return source._0;
        case "Impl":
          return this.tcx.impl_trait_id(source._0);
      }
    });
  } else if (pc !== undefined && pc.$ === "Err" && pc._0.$ === "NoMatch") {
    const others = pc._0._0.out_of_scope_traits;
    assert(others.length === 0, "assertion failed: others.is_empty()");
    out_of_scope_traits = [];
  } else {
    out_of_scope_traits = [];
  }

  if (private_candidate !== undefined) {
    const [kind, def_id] = private_candidate;
    return Err({ $: "PrivateMatch", _0: kind, _1: def_id, _2: out_of_scope_traits });
  }
  const sc = this.probe_for_similar_candidate();
  if (sc.$ === "Err") return sc;
  const similar_candidate = sc._0;

  const data: NoMatchData = {
    static_candidates,
    unsatisfied_predicates,
    out_of_scope_traits,
    similar_candidate,
    mode: this.mode,
  };
  return Err({ $: "NoMatch", _0: data });
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1304 pick_core
ProbeContext.prototype.pick_core = function (this: ProbeContext, unsatisfied_predicates: UnsatisfiedPredicates): PickResult | undefined {
  // Pick stable methods only first, and consider unstable candidates if not found.
  const r = this.pick_all_method({
    // This first cycle, maintain a list of unstable candidates which
    // we encounter. This will end up in the Pick for diagnostics.
    unstable_candidates: [],
    // Contribute to the list of unsatisfied predicates which may
    // also be used for diagnostics.
    unsatisfied_predicates,
  });
  if (r !== undefined) return r;
  return this.pick_all_method({
    // On the second search, don't provide a special list of unstable
    // candidates. This indicates to the picking code that it should
    // in fact include such unstable candidates in the actual
    // search.
    unstable_candidates: undefined,
    // And there's no need to duplicate ourselves in the
    // unsatisifed predicates list. Provide a throwaway list.
    unsatisfied_predicates: [],
  });
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1331 pick_all_method
ProbeContext.prototype.pick_all_method = function (this: ProbeContext, pick_diag_hints: PickDiagHints): PickResult | undefined {
  const track_unstable_candidates = pick_diag_hints.unstable_candidates !== undefined;
  for (const step of this.steps) {
    // At this point we're considering the types to which the receiver can be converted,
    // so we want to follow the `Deref` chain not the `Receiver` chain. Filter out
    // steps which can only be reached by following the (longer) `Receiver` chain.
    if (!step.reachable_via_deref) continue;
    // debug!("pick_all_method: step={:?}", step);
    // skip types that are from a type error or that would require dereferencing
    // a raw pointer
    if (!(!TypeVisitableExt.references_error(step_self_ty(step).value, fold_QueryResponse_Ty) && !step.from_unsafe_deref)) continue;

    // `.find_map(|step| ..)`
    const r = ((): PickResult | undefined => {
      const ir = this.fcx.probe_instantiate_query_response(this.span, this.orig_steps_var_values, step_self_ty(step));
      const { value: self_ty, obligations: instantiate_self_ty_obligations } = ir.$ === "Ok" ? ir._0 : span_bug(this.span, `${debug_canonical_ty(step_self_ty(step))} was applicable but now isn't?`);

      const by_value_pick = this.pick_by_value_method(step, self_ty, instantiate_self_ty_obligations, pick_diag_hints);

      // Check for shadowing of a by-reference method by a by-value method (see comments on check_for_shadowing)
      if (by_value_pick !== undefined) {
        if (by_value_pick.$ === "Ok") {
          const by_value_pick_ = by_value_pick._0;
          if (by_value_pick_.kind.$ === "InherentImplPick") {
            for (const mutbl of ["Not", "Mut"] as const) {
              const e = this.check_for_shadowed_autorefd_method(by_value_pick_, step, self_ty, instantiate_self_ty_obligations, mutbl, track_unstable_candidates);
              if (e.$ === "Err") {
                return Err(e._0);
              }
            }
          }
        }
        return by_value_pick;
      }

      const autoref_pick = this.pick_autorefd_method(step, self_ty, instantiate_self_ty_obligations, "Not", pick_diag_hints, undefined);
      // Check for shadowing of a by-mut-ref method by a by-reference method (see comments on check_for_shadowing)
      if (autoref_pick !== undefined) {
        if (autoref_pick.$ === "Ok") {
          const autoref_pick_ = autoref_pick._0;
          // Check we're not shadowing others
          if (autoref_pick_.kind.$ === "InherentImplPick") {
            const e = this.check_for_shadowed_autorefd_method(autoref_pick_, step, self_ty, instantiate_self_ty_obligations, "Mut", track_unstable_candidates);
            if (e.$ === "Err") {
              return Err(e._0);
            }
          }
        }
        return autoref_pick;
      }

      // Note that no shadowing errors are produced from here on,
      // as we consider const ptr methods.
      // We allow new methods that take *mut T to shadow
      // methods which took *const T, so there is no entry in
      // this list for the results of `pick_const_ptr_method`.
      // The reason is that the standard pointer cast method
      // (on a mutable pointer) always already shadows the
      // cast method (on a const pointer). So, if we added
      // `pick_const_ptr_method` to this method, the anti-
      // shadowing algorithm would always complain about
      // the conflict between *const::cast and *mut::cast.
      // In practice therefore this does constrain us:
      // we cannot add new
      //   self: *mut Self
      // methods to types such as NonNull or anything else
      // which implements Receiver, because this might in future
      // shadow existing methods taking
      //   self: *const NonNull<Self>
      // in the pointee. In practice, methods taking raw pointers
      // are rare, and it seems that it should be easily possible
      // to avoid such compatibility breaks.
      // We also don't check for reborrowed pin methods which
      // may be shadowed; these also seem unlikely to occur.
      return (
        this.pick_autorefd_method(step, self_ty, instantiate_self_ty_obligations, "Mut", pick_diag_hints, undefined) ??
        this.pick_const_ptr_method(step, self_ty, instantiate_self_ty_obligations, pick_diag_hints) ??
        this.pick_reborrow_pin_method(step, self_ty, instantiate_self_ty_obligations, pick_diag_hints)
      );
    })();
    if (r !== undefined) return r;
  }
  return undefined;
};

/// Check for cases where arbitrary self types allows shadowing
/// of methods that might be a compatibility break. Specifically,
/// we have something like:
/// ```ignore (illustrative)
/// struct A;
/// impl A {
///   fn foo(self: &NonNull<A>) {}
///      // note this is by reference
/// }
/// ```
/// then we've come along and added this method to `NonNull`:
/// ```ignore (illustrative)
///   fn foo(self)  // note this is by value
/// ```
/// Report an error in this case.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1481 check_for_shadowed_autorefd_method
ProbeContext.prototype.check_for_shadowed_autorefd_method = function (
  this: ProbeContext,
  possible_shadower: Pick,
  step: CandidateStep,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  mutbl: Mutability,
  track_unstable_candidates: boolean,
): Result<undefined, MethodError> {
  // The errors emitted by this function are part of
  // the arbitrary self types work, and should not impact
  // other users.
  if (!this.tcx.features().arbitrary_self_types() && !this.tcx.features().arbitrary_self_types_pointers()) {
    return Ok(undefined);
  }

  // We don't want to remember any of the diagnostic hints from this
  // shadow search, but we do need to provide Some/None for the
  // unstable_candidates in order to reflect the behavior of the
  // main search.
  const pick_diag_hints: PickDiagHints = {
    unstable_candidates: track_unstable_candidates ? [] : undefined,
    unsatisfied_predicates: [],
  };
  // Set criteria for how we find methods possibly shadowed by 'possible_shadower'
  const pick_constraints = new PickConstraintsForShadowed(
    // It's the same `self` type...
    possible_shadower.autoderefs,
    // ... but the method was found in an impl block determined
    // by searching further along the Receiver chain than the other,
    // showing that it's a smart pointer type causing the problem...
    possible_shadower.receiver_steps,
    // ... and they don't end up pointing to the same item in the
    // first place (could happen with things like blanket impls for T)
    possible_shadower.item.def_id,
  );
  // A note on the autoderefs above. Within pick_by_value_method, an extra
  // autoderef may be applied in order to reborrow a reference with
  // a different lifetime. That seems as though it would break the
  // logic of these constraints, since the number of autoderefs could
  // no longer be used to identify the fundamental type of the receiver.
  // However, this extra autoderef is applied only to by-value calls
  // where the receiver is already a reference. So this situation would
  // only occur in cases where the shadowing looks like this:
  // ```
  // struct A;
  // impl A {
  //   fn foo(self: &&NonNull<A>) {}
  //      // note this is by DOUBLE reference
  // }
  // ```
  // then we've come along and added this method to `NonNull`:
  // ```
  //   fn foo(&self)  // note this is by single reference
  // ```
  // and the call is:
  // ```
  // let bar = NonNull<Foo>;
  // let bar = &foo;
  // bar.foo();
  // ```
  // In these circumstances, the logic is wrong, and we wouldn't spot
  // the shadowing, because the autoderef-based maths wouldn't line up.
  // This is a niche case and we can live without generating an error
  // in the case of such shadowing.
  const potentially_shadowed_pick = this.pick_autorefd_method(step, self_ty, instantiate_self_ty_obligations, mutbl, pick_diag_hints, pick_constraints);
  // Look for actual pairs of shadower/shadowed which are
  // the sort of shadowing case we want to avoid. Specifically...
  if (potentially_shadowed_pick !== undefined && potentially_shadowed_pick.$ === "Ok") {
    const possible_shadowed = potentially_shadowed_pick._0;
    const sources = [possible_shadower, possible_shadowed].map((p) => this.candidate_source_from_pick(p));
    return Err({ $: "Ambiguity", _0: sources });
  }
  return Ok(undefined);
};

/// For each type `T` in the step list, this attempts to find a method where
/// the (transformed) self type is exactly `T`. We do however do one
/// transformation on the adjustment: if we are passing a region pointer in,
/// we will potentially *reborrow* it to a shorter lifetime. This allows us
/// to transparently pass `&mut` pointers, in particular, without consuming
/// them for their entire lifetime.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1574 pick_by_value_method
ProbeContext.prototype.pick_by_value_method = function (
  this: ProbeContext,
  step: CandidateStep,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  pick_diag_hints: PickDiagHints,
): PickResult | undefined {
  if (step.unsize) {
    return undefined;
  }

  const r = this.pick_method(self_ty, instantiate_self_ty_obligations, pick_diag_hints, undefined);
  if (r === undefined || r.$ === "Err") return r;
  const pick = r._0;
  pick.autoderefs = step.autoderefs;

  const k = step_self_ty(step).value.value.kind();
  if (k.$ === "Ref") {
    // Insert a `&*` or `&mut *` if this is a reference type:
    const mutbl = k._2;
    pick.autoderefs += 1;
    pick.autoref_or_ptr_adjustment = {
      $: "Autoref",
      mutbl,
      unsize: pick.autoref_or_ptr_adjustment !== undefined && AutorefOrPtrAdjustment.get_unsize(pick.autoref_or_ptr_adjustment),
    };
  } else if (k.$ === "Adt" && this.tcx.features().pin_ergonomics() && this.tcx.is_lang_item(k._0.did(), LangItem.Pin)) {
    // make sure this is a pinned reference (and not a `Pin<Box>` or something)
    const ak = GenericArg.expect_ty(k._1[0]!).kind();
    if (ak.$ === "Ref") {
      pick.autoref_or_ptr_adjustment = { $: "ReborrowPin", _0: ak._2 };
    }
  }

  return Ok(pick);
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1618 pick_autorefd_method
ProbeContext.prototype.pick_autorefd_method = function (
  this: ProbeContext,
  step: CandidateStep,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  mutbl: Mutability,
  pick_diag_hints: PickDiagHints,
  pick_constraints: PickConstraintsForShadowed | undefined,
): PickResult | undefined {
  const tcx = this.tcx;

  if (pick_constraints !== undefined) {
    if (!pick_constraints.may_shadow_based_on_autoderefs(step.autoderefs)) {
      return undefined;
    }
  }

  // In general, during probing we erase regions.
  const region = tcx.lifetimes.re_erased;

  const autoref_ty = Ty.new_ref(tcx, region, self_ty, mutbl);
  const r = this.pick_method(autoref_ty, instantiate_self_ty_obligations, pick_diag_hints, pick_constraints);
  if (r === undefined || r.$ === "Err") return r;
  const pick = r._0;
  pick.autoderefs = step.autoderefs;
  pick.autoref_or_ptr_adjustment = { $: "Autoref", mutbl, unsize: step.unsize };
  return Ok(pick);
};

/// Looks for applicable methods if we reborrow a `Pin<&mut T>` as a `Pin<&T>`.
// #[instrument(level = "debug", skip(self, step, pick_diag_hints))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1657 pick_reborrow_pin_method
ProbeContext.prototype.pick_reborrow_pin_method = function (
  this: ProbeContext,
  step: CandidateStep,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  pick_diag_hints: PickDiagHints,
): PickResult | undefined {
  if (!this.tcx.features().pin_ergonomics()) {
    return undefined;
  }

  // make sure self is a Pin<&mut T>
  let inner_ty: Ty;
  const k = self_ty.kind();
  if (k.$ === "Adt" && this.tcx.is_lang_item(k._0.did(), LangItem.Pin)) {
    const ak = GenericArg.expect_ty(k._1[0]!).kind();
    if (ak.$ === "Ref" && ak._2 === "Mut") {
      inner_ty = ak._1;
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  const region = this.tcx.lifetimes.re_erased;
  const autopin_ty = Ty.new_pinned_ref(this.tcx, region, inner_ty, "Not");
  const r = this.pick_method(autopin_ty, instantiate_self_ty_obligations, pick_diag_hints, undefined);
  if (r === undefined || r.$ === "Err") return r;
  const pick = r._0;
  pick.autoderefs = step.autoderefs;
  pick.autoref_or_ptr_adjustment = { $: "ReborrowPin", _0: "Not" };
  return Ok(pick);
};

/// If `self_ty` is `*mut T` then this picks `*const T` methods. The reason why we have a
/// special case for this is because going from `*mut T` to `*const T` with autoderefs and
/// autorefs would require dereferencing the pointer, which is not safe.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1698 pick_const_ptr_method
ProbeContext.prototype.pick_const_ptr_method = function (
  this: ProbeContext,
  step: CandidateStep,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  pick_diag_hints: PickDiagHints,
): PickResult | undefined {
  // Don't convert an unsized reference to ptr
  if (step.unsize) {
    return undefined;
  }

  const k = self_ty.kind();
  if (!(k.$ === "RawPtr" && k._1 === "Mut")) {
    return undefined;
  }
  const ty = k._0;

  const const_ptr_ty = Ty.new_imm_ptr(this.tcx, ty);
  const r = this.pick_method(const_ptr_ty, instantiate_self_ty_obligations, pick_diag_hints, undefined);
  if (r === undefined || r.$ === "Err") return r;
  const pick = r._0;
  pick.autoderefs = step.autoderefs;
  pick.autoref_or_ptr_adjustment = AutorefOrPtrAdjustment.ToConstPtr;
  return Ok(pick);
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1726 pick_method
ProbeContext.prototype.pick_method = function (
  this: ProbeContext,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  pick_diag_hints: PickDiagHints,
  pick_constraints: PickConstraintsForShadowed | undefined,
): PickResult | undefined {
  // debug!("pick_method(self_ty={})", self.ty_to_string(self_ty));

  for (const [_kind, candidates] of [
    ["inherent", this.inherent_candidates],
    ["extension", this.extension_candidates],
  ] as const) {
    // debug!("searching {} candidates", kind);
    const res = this.consider_candidates(self_ty, instantiate_self_ty_obligations, candidates, pick_diag_hints, pick_constraints);
    if (res !== undefined) {
      return res;
    }
  }

  if (this.private_candidate === undefined) {
    const r = this.consider_candidates(
      self_ty,
      instantiate_self_ty_obligations,
      this.private_candidates,
      {
        unstable_candidates: undefined,
        unsatisfied_predicates: [],
      },
      undefined,
    );
    if (r !== undefined && r.$ === "Ok") {
      const pick = r._0;
      this.private_candidate = [AssocItem.as_def_kind(pick.item), pick.item.def_id];
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1768 consider_candidates
ProbeContext.prototype.consider_candidates = function (
  this: ProbeContext,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  candidates: readonly Candidate[],
  pick_diag_hints: PickDiagHints,
  pick_constraints: PickConstraintsForShadowed | undefined,
): PickResult | undefined {
  let applicable_candidates: [Candidate, ProbeResult][] = [];
  for (const candidate of candidates) {
    if (!(pick_constraints !== undefined ? pick_constraints.candidate_may_shadow(candidate) : true)) continue;
    const status = this.consider_probe(self_ty, instantiate_self_ty_obligations, candidate, pick_diag_hints.unsatisfied_predicates);
    if (status !== "NoMatch") {
      applicable_candidates.push([candidate, status]);
    }
  }

  // debug!("applicable_candidates: {:?}", applicable_candidates);

  if (applicable_candidates.length > 1) {
    const pick = this.collapse_candidates_to_trait_pick(self_ty, applicable_candidates);
    if (pick !== undefined) {
      return Ok(pick);
    }
  }

  const uc = pick_diag_hints.unstable_candidates;
  if (uc !== undefined) {
    applicable_candidates = applicable_candidates.filter(([candidate, _]) => {
      const stab: EvalResult = this.tcx.eval_stability(candidate.item.def_id, undefined, this.span, undefined);
      if (stab.$ === "Deny") {
        uc.push([clone_Candidate(candidate), stab.feature]);
        return false;
      }
      return true;
    });
  }

  if (applicable_candidates.length > 1) {
    // We collapse to a subtrait pick *after* filtering unstable candidates
    // to make sure we don't prefer a unstable subtrait method over a stable
    // supertrait method.
    if (this.tcx.features().supertrait_item_shadowing()) {
      const pick = this.collapse_candidates_to_subtrait_pick(self_ty, applicable_candidates);
      if (pick !== undefined) {
        return Ok(pick);
      }
    }

    const sources = applicable_candidates.map((p) => this.candidate_source(p[0], self_ty));
    return Err({ $: "Ambiguity", _0: sources });
  }

  const last = applicable_candidates.pop();
  if (last === undefined) return undefined;
  const [probe, status] = last;
  switch (status) {
    case "Match":
      return Ok(
        probe.to_unadjusted_pick(
          self_ty,
          pick_diag_hints.unstable_candidates !== undefined ? pick_diag_hints.unstable_candidates.map(([c, s]): [Candidate, Symbol] => [clone_Candidate(c), s]) : [],
        ),
      );
    case "NoMatch":
    case "BadReturnType":
      return Err(gen_MethodError_BadReturnType());
  }
};

/** `MethodError::BadReturnType` (method/mod.gen.ts's unit singleton, read inside a body: init order). */
function gen_MethodError_BadReturnType(): MethodError {
  return { $: "BadReturnType" };
}

// ---- impl Pick -------------------------------------------------------------------------------------------------------

/// In case there were unstable name collisions, emit them as a lint.
/// Checks whether two picks do not refer to the same trait item for the same `Self` type.
/// Only useful for comparisons of picks in order to improve diagnostics.
/// Do not use for type checking.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1851 differs_from
Pick.prototype.differs_from = function (this: Pick, other: Pick): boolean {
  const {
    item: { def_id },
    self_ty,
  } = this;
  return self_ty !== other.self_ty || !DefId_eq(def_id, other.item.def_id);
};

/// In case there were unstable name collisions, emit them as a lint.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1867 maybe_emit_unstable_name_collision_hint
Pick.prototype.maybe_emit_unstable_name_collision_hint = function (this: Pick, tcx: TyCtxt, span: Span, scope_expr_id: HirId): void {
  // struct ItemMaybeBeAddedToStd<'a, 'tcx> { this: &'a Pick<'tcx>, tcx: TyCtxt<'tcx>, span: Span }
  // impl<'a, 'b, 'tcx> Diagnostic<'a> for ItemMaybeBeAddedToStd<'b, 'tcx>
  const ItemMaybeBeAddedToStd = (self_: { this: Pick; tcx: TyCtxt; span: Span }): Diagnostic => ({
    // rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1880 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { this: this_, tcx, span } = self_;
      const def_kind = AssocItem.as_def_kind(this_.item);
      const lint = Diag.new(
        dcx,
        level,
        `${tcx.def_kind_descr_article(def_kind, this_.item.def_id)} ${tcx.def_kind_descr(def_kind, this_.item.def_id)} with this name may be added to the standard library in the future`,
      );

      const kind = this_.item.kind;
      if (kind.$ === "Fn") {
        // FIXME: This should be a `span_suggestion` instead of `help`
        // However `this.span` only
        // highlights the method name, so we can't use it. Also consider reusing
        // the code from `report_method_error()`.
        lint.help(`call with fully qualified syntax \`${tcx.def_path_str(this_.item.def_id)}(...)\` to keep using the current method`);
      } else if (kind.$ === "Const" && this_.item.container.$ === "Trait") {
        const name = kind.name;
        const def_id = AssocItem.container_id(this_.item, tcx);
        lint.span_suggestion(
          span,
          "use the fully qualified path to the associated const",
          `<${display_Ty(this_.self_ty)} as ${tcx.def_path_str(def_id)}>::${Sym.as_str(name)}`,
          Applicability.MachineApplicable,
        );
      }
      tcx.disabled_nightly_features(
        lint,
        this_.unstable_candidates.map(([candidate, feature]): [string, Symbol] => [` \`${tcx.def_path_str(candidate.item.def_id)}\``, feature]),
      );
      return lint;
    },
  });

  if (this.unstable_candidates.length === 0) {
    return;
  }
  tcx.emit_node_span_lint(UNSTABLE_NAME_COLLISIONS, scope_expr_id, span, ItemMaybeBeAddedToStd({ this: this, tcx, span }));
};

/**
 * PORT: `traits::SelectionContext::new(infcx).select(&obligation)`: the old solver's `SelectionContext`
 * (rustc_trait_selection traits/select/mod.rs, lane selcx-contract) is not ported yet.
 */
function SelectionContext_select(infcx: InferCtxt, obligation: Obligation<TraitClauseT>): SelectionResult<Selection> {
  void infcx;
  void obligation;
  return unported("rustc_trait_selection::traits::select::SelectionContext::select");
}

// ---- impl ProbeContext (2) -------------------------------------------------------------------------------------------

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1939 select_trait_candidate_for_diagnostics
ProbeContext.prototype.select_trait_candidate_for_diagnostics = function (this: ProbeContext, trait_ref: TraitRefT): SelectionResult<Selection> {
  const obligation = Obligation.new(this.tcx, this.misc(this.span), this.param_env, trait_ref, TraitClause.upcast_from_TraitRef);
  // PORT: `traits::SelectionContext::new(self).select(&obligation)`: the old solver's `SelectionContext`
  // (rustc_trait_selection traits/select, lane selcx-contract) is not ported yet.
  const candidate = SelectionContext_select(this.infcx, obligation);
  if (candidate.$ === "Ok" && candidate._0 !== undefined && candidate._0.$ === "UserDefined" && this.infcx.tcx.do_not_recommend_impl(candidate._0._0.impl_def_id)) {
    return Err(SelectionError.Unimplemented);
  }
  return candidate;
};

/// Used for ambiguous method call error reporting. Uses probing that throws away the result internally,
/// so do not use to make a decision that may lead to a successful compilation.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1956 candidate_source
ProbeContext.prototype.candidate_source = function (this: ProbeContext, candidate: Candidate, self_ty: Ty): CandidateSource {
  const kind = candidate.kind;
  switch (kind.$) {
    case "InherentImplCandidate":
      return { $: "Impl", _0: AssocItem.container_id(candidate.item, this.tcx) };
    case "ObjectCandidate":
    case "WhereClauseCandidate":
      return { $: "Trait", _0: AssocItem.container_id(candidate.item, this.tcx) };
    case "TraitCandidate": {
      const trait_ref_ = kind.trait_ref;
      return this.probe((_): CandidateSource => {
        const trait_ref = this.instantiate_binder_with_fresh_vars(this.span, BoundRegionConversionTime.FnCall, trait_ref_, d_TraitRef);
        const [xform_self_ty, _ret] = this.xform_self_ty(candidate.item, TraitRef.self_ty(trait_ref), trait_ref.args);
        // Guide the trait selection to show impls that have methods whose type matches
        // up with the `self` parameter of the method.
        void this.at(ObligationCause.dummy(), this.param_env).sup(DefineOpaqueTypes.Yes, xform_self_ty, self_ty, ToTrace_Ty);
        const sel = this.select_trait_candidate_for_diagnostics(trait_ref);
        if (sel.$ === "Ok" && sel._0 !== undefined && sel._0.$ === "UserDefined") {
          // If only a single impl matches, make the error message point
          // to that impl.
          return { $: "Impl", _0: sel._0._0.impl_def_id };
        }
        return { $: "Trait", _0: AssocItem.container_id(candidate.item, this.tcx) };
      });
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:1991 candidate_source_from_pick
ProbeContext.prototype.candidate_source_from_pick = function (this: ProbeContext, pick: Pick): CandidateSource {
  switch (pick.kind.$) {
    case "InherentImplPick":
      return { $: "Impl", _0: AssocItem.container_id(pick.item, this.tcx) };
    case "ObjectPick":
    case "WhereClausePick":
    case "TraitPick":
      return { $: "Trait", _0: AssocItem.container_id(pick.item, this.tcx) };
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2000 consider_probe
ProbeContext.prototype.consider_probe = function (
  this: ProbeContext,
  self_ty: Ty,
  instantiate_self_ty_obligations: readonly PredicateObligation[],
  probe: Candidate,
  possibly_unsatisfied_predicates: UnsatisfiedPredicates,
): ProbeResult {
  return this.probe((snapshot): ProbeResult => {
    const outer_universe = this.universe();

    let result: ProbeResult = "Match";
    const cause = this.misc(this.span);
    const ocx = ObligationCtxt.new_with_diagnostics(this.infcx);

    // Subtle: we're not *really* instantiating the current self type while
    // probing, but instead fully recompute the autoderef steps once we've got
    // a final `Pick`. We can't nicely handle these obligations outside of a probe.
    //
    // We simply handle them for each candidate here for now. That's kinda scuffed
    // and ideally we just put them into the `FnCtxt` right away. We need to consider
    // them to deal with defining uses in `method_autoderef_steps`.
    if (this.next_trait_solver()) {
      ocx.register_obligations(instantiate_self_ty_obligations.map((o) => clone_Obligation(o, (p) => p)));
      const errors = ocx.try_evaluate_obligations();
      if (!TraitErrors.no_errors(errors)) {
        unreachable(`internal error: entered unreachable code: unexpected autoderef error ${debug_TraitErrors(errors, PLAIN, debug_FulfillmentError)}`);
      }
    }

    let trait_predicate: Predicate | undefined = undefined;
    let xform_self_ty: Ty;
    let xform_ret_ty: Ty | undefined;

    const kind = probe.kind;
    switch (kind.$) {
      case "InherentImplCandidate": {
        const impl_def_id_ = kind.impl_def_id;
        const impl_args = this.fresh_args_for_item(this.span, impl_def_id_);
        const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(impl_def_id_) as EarlyBinder<Ty>, this.tcx, impl_args, fold_Ty));
        [xform_self_ty, xform_ret_ty] = this.xform_self_ty(probe.item, impl_ty, impl_args);
        xform_self_ty = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(xform_self_ty), fold_Ty);
        const rel = ocx.relate(cause, this.param_env, this.variance(), self_ty, xform_self_ty, ToTrace_Ty);
        if (rel.$ === "Err") {
          // debug!("--> cannot relate self-types {:?}", err);
          return "NoMatch";
        }
        // FIXME: Weirdly, we normalize the ret ty in this candidate, but no other candidates.
        // PORT: `xform_ret_ty: Option<Ty>` normalized as an `Option` (`None` folds to `None`).
        xform_ret_ty = xform_ret_ty === undefined ? undefined : ocx.normalize(cause, this.param_env, Unnormalized.new_wip(xform_ret_ty), fold_Ty);
        // Check whether the impl imposes obligations we have to worry about.
        const impl_def_id = AssocItem.container_id(probe.item, this.tcx);
        const impl_bounds = GenericClauses.instantiate(this.tcx.clauses_of(impl_def_id) as GenericClausesT, this.tcx, impl_args);
        // Convert the bounds into obligations.
        ocx.register_obligations(
          predicates_for_generics(
            (idx, span) => {
              const code: ObligationCauseCode = { $: "WhereClauseInExpr", _0: impl_def_id, _1: span, _2: this.scope_expr_id, _3: idx };
              return this.cause(this.span, code);
            },
            (clause) => ocx.normalize(cause, this.param_env, clause, fold_Clause),
            this.param_env,
            impl_bounds,
          ),
        );
        break;
      }
      case "TraitCandidate": {
        const poly_trait_ref = kind.trait_ref;
        // Some trait methods are excluded for arrays before 2021.
        // (`array.into_iter()` wants a slice iterator for compatibility.)
        const method_name = this.method_name;
        if (method_name !== undefined) {
          if (self_ty.is_array() && !Span.at_least_rust_2021(method_name.span)) {
            const trait_def = this.tcx.trait_def(PolyTraitRefC.def_id(poly_trait_ref)) as TraitDef;
            if (trait_def.skip_array_during_method_dispatch) {
              return "NoMatch";
            }
          }

          // Some trait methods are excluded for boxed slices before 2024.
          // (`boxed_slice.into_iter()` wants a slice iterator for compatibility.)
          const boxed = self_ty.boxed_ty();
          if (boxed !== undefined && boxed.is_slice() && !Span.at_least_rust_2024(method_name.span)) {
            const trait_def = this.tcx.trait_def(PolyTraitRefC.def_id(poly_trait_ref)) as TraitDef;
            if (trait_def.skip_boxed_slice_during_method_dispatch) {
              return "NoMatch";
            }
          }
        }

        const trait_ref_ = this.instantiate_binder_with_fresh_vars(this.span, BoundRegionConversionTime.FnCall, poly_trait_ref, d_TraitRef);
        const trait_ref = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(trait_ref_), d_TraitRef);
        [xform_self_ty, xform_ret_ty] = this.xform_self_ty(probe.item, TraitRef.self_ty(trait_ref), trait_ref.args);
        xform_self_ty = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(xform_self_ty), fold_Ty);
        const sk = self_ty.kind();
        // HACK: opaque types will match anything for which their bounds hold.
        // Thus we need to prevent them from trying to match the `&_` autoref
        // candidates that get created for `&self` trait methods.
        if (sk.$ === "Alias" && sk._1.kind.$ === "Opaque" && !this.next_trait_solver() && this.infcx.can_define_opaque_ty(sk._1.kind.def_id) && !xform_self_ty.is_ty_var()) {
          return "NoMatch";
        } else {
          const rel = ocx.relate(cause, this.param_env, this.variance(), self_ty, xform_self_ty, ToTrace_Ty);
          if (rel.$ === "Err") {
            // debug!("--> cannot relate self-types {:?}", err);
            return "NoMatch";
          }
        }
        const obligation = Obligation.new(this.tcx, clone_ObligationCause(cause), this.param_env, Binder.dummy(trait_ref, d_TraitRef), Predicate_upcast_from_PolyTraitRef as (from: PolyTraitRef, tcx: Interner) => Predicate);

        // We only need this hack to deal with fatal overflow in the old solver.
        if (this.infcx.next_trait_solver() || this.infcx.predicate_may_hold(obligation)) {
          ocx.register_obligation(obligation);
        } else {
          result = "NoMatch";
          const sel = this.select_trait_candidate_for_diagnostics(trait_ref);
          if (sel.$ === "Ok" && sel._0 !== undefined) {
            const candidate = sel._0;
            for (const nested_obligation of ImplSource.nested_obligations(candidate)) {
              if (!this.infcx.predicate_may_hold(nested_obligation)) {
                possibly_unsatisfied_predicates.push([
                  this.deeply_resolve_ignoring_regions(nested_obligation.predicate, fold_Predicate),
                  this.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate),
                  nested_obligation.cause,
                ]);
              }
            }
          }
        }

        trait_predicate = Predicate_upcast_from_TraitRef(trait_ref, this.tcx);
        break;
      }
      case "ObjectCandidate":
      case "WhereClauseCandidate": {
        const poly_trait_ref = kind._0;
        const trait_ref = this.instantiate_binder_with_fresh_vars(this.span, BoundRegionConversionTime.FnCall, poly_trait_ref, d_TraitRef);
        [xform_self_ty, xform_ret_ty] = this.xform_self_ty(probe.item, TraitRef.self_ty(trait_ref), trait_ref.args);

        if (probe.kind.$ === "WhereClauseCandidate") {
          // `WhereClauseCandidate` requires that the self type is a param,
          // because it has special behavior with candidate preference as an
          // inherent pick.
          const ty = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(TraitRef.self_ty(trait_ref)), fold_Ty);
          if (ty.kind().$ !== "Param") {
            // debug!("--> not a param ty: {xform_self_ty:?}");
            return "NoMatch";
          }
        }

        xform_self_ty = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(xform_self_ty), fold_Ty);
        const rel = ocx.relate(cause, this.param_env, this.variance(), self_ty, xform_self_ty, ToTrace_Ty);
        if (rel.$ === "Err") {
          // debug!("--> cannot relate self-types {:?}", err);
          return "NoMatch";
        }
        break;
      }
    }

    // Evaluate those obligations to see if they might possibly hold.
    for (const error of TraitErrors.into_iter_ref<FulfillmentError>(ocx.try_evaluate_obligations())) {
      result = "NoMatch";
      const nested_predicate = this.deeply_resolve_ignoring_regions(error.obligation.predicate, fold_Predicate);
      if (trait_predicate !== undefined && nested_predicate === this.deeply_resolve_ignoring_regions(trait_predicate, fold_Predicate)) {
        // Don't report possibly unsatisfied predicates if the root
        // trait obligation from a `TraitCandidate` is unsatisfied.
        // That just means the candidate doesn't hold.
      } else {
        const root_predicate = this.deeply_resolve_ignoring_regions(error.root_obligation.predicate, fold_Predicate);
        possibly_unsatisfied_predicates.push([nested_predicate, root_predicate !== nested_predicate ? root_predicate : undefined, error.obligation.cause]);
      }
    }

    const return_ty = this.return_type;
    if (result === "Match" && return_ty !== undefined && xform_ret_ty !== undefined) {
      let xform_ret_ty_ = xform_ret_ty;
      // `xform_ret_ty` has only been normalized for `InherentImplCandidate`.
      // We don't normalize the other candidates for perf/backwards-compat reasons...
      // but `self.return_type` is only set on the diagnostic-path, so we
      // should be okay doing it here.
      if (probe.kind.$ !== "InherentImplCandidate") {
        xform_ret_ty_ = ocx.normalize(cause, this.param_env, Unnormalized.new_wip(xform_ret_ty_), fold_Ty);
      }

      // debug!("comparing return_ty {:?} with xform ret ty {:?}", return_ty, xform_ret_ty);
      const rel = ocx.relate(cause, this.param_env, this.variance(), xform_ret_ty_, return_ty, ToTrace_Ty);
      if (rel.$ === "Err") {
        result = "BadReturnType";
      }

      // Evaluate those obligations to see if they might possibly hold.
      for (const error of TraitErrors.into_iter_ref<FulfillmentError>(ocx.try_evaluate_obligations())) {
        result = "NoMatch";
        possibly_unsatisfied_predicates.push([
          error.obligation.predicate,
          error.root_obligation.predicate !== error.obligation.predicate ? error.root_obligation.predicate : undefined,
          error.root_obligation.cause,
        ]);
      }
    }

    if (this.infcx.next_trait_solver()) {
      if (this.should_reject_candidate_due_to_opaque_treated_as_rigid(trait_predicate)) {
        result = "NoMatch";
      }
    }

    // Previously, method probe used `evaluate_predicate` to determine if a predicate
    // was impossible to satisfy. This did a leak check, so we must also do a leak
    // check here to prevent backwards-incompatible ambiguity being introduced. See
    // `tests/ui/methods/leak-check-disquality.rs` for a simple example of when this
    // may happen.
    if (this.leak_check(outer_universe, snapshot).$ === "Err") {
      result = "NoMatch";
    }

    return result;
  });
};

/// Trait candidates for not-yet-defined opaque types are a somewhat hacky.
///
/// We want to only accept trait methods if they were hold even if the
/// opaque types were rigid. To handle this, we both check that for trait
/// candidates the goal were to hold even when treating opaques as rigid,
/// see [OpaqueTypesJank](rustc_trait_selection::solve::OpaqueTypesJank).
///
/// We also check that all opaque types encountered as self types in the
/// autoderef chain don't get constrained when applying the candidate.
/// Importantly, this also handles calling methods taking `&self` on
/// `impl Trait` to reject the "by-self" candidate.
///
/// This needs to happen at the end of `consider_probe` as we need to take
/// all the constraints from that into account.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2295 should_reject_candidate_due_to_opaque_treated_as_rigid
ProbeContext.prototype.should_reject_candidate_due_to_opaque_treated_as_rigid = function (this: ProbeContext, trait_predicate: Predicate | undefined): boolean {
  // This function is what hacky and doesn't perfectly do what we want it to.
  // It's not soundness critical and we should be able to freely improve this
  // in the future.
  //
  // Some concrete edge cases include the fact that `goal_may_hold_opaque_types_jank`
  // also fails if there are any constraints opaques which are never used as a self
  // type. We also allow where-bounds which are currently ambiguous but end up
  // constraining an opaque later on.

  // Check whether the trait candidate would not be applicable if the
  // opaque type were rigid.
  if (trait_predicate !== undefined) {
    const predicate = trait_predicate;
    const goal = { param_env: this.param_env, predicate };
    if (!this.infcx.goal_may_hold_opaque_types_jank(goal)) {
      return true;
    }
  }

  // Check whether any opaque types in the autoderef chain have been
  // constrained.
  for (const step of this.steps) {
    if (step.self_ty_is_opaque) {
      // debug!(?step.autoderefs, ?step.self_ty, "self_type_is_opaque");
      const constrained_opaque = this.probe((_): boolean => {
        // If we fail to instantiate the self type of this
        // step, this part of the deref-chain is no longer
        // reachable. In this case we don't care about opaque
        // types there.
        const r = this.fcx.probe_instantiate_query_response(this.span, this.orig_steps_var_values, step_self_ty(step));
        if (r.$ !== "Ok") {
          // debug!("failed to instantiate self_ty");
          return false;
        }
        const ok = r._0;
        const ocx = ObligationCtxt.new(this.infcx);
        const self_ty = ocx.register_infer_ok_obligations(ok);
        if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
          // debug!("failed to prove instantiate self_ty obligations");
          return false;
        }

        return !this.deeply_resolve_ignoring_regions(self_ty, fold_Ty).is_ty_var();
      });
      if (constrained_opaque) {
        // debug!("opaque type has been constrained");
        return true;
      }
    }
  }

  return false;
};

/// Sometimes we get in a situation where we have multiple probes that are all impls of the
/// same trait, but we don't know which impl to use. In this case, since in all cases the
/// external interface of the method can be determined from the trait, it's ok not to decide.
/// We can basically just collapse all of the probes for various impls into one where-clause
/// probe. This will result in a pending obligation so when more type-info is available we can
/// make the final decision.
///
/// Example (`tests/ui/methods/method-two-trait-defer-resolution-1.rs`):
///
/// ```ignore (illustrative)
/// trait Foo { ... }
/// impl Foo for Vec<i32> { ... }
/// impl Foo for Vec<usize> { ... }
/// ```
///
/// Now imagine the receiver is `Vec<_>`. It doesn't really matter at this time which impl we
/// use, so it's ok to just commit to "using the method from the trait Foo".
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2371 collapse_candidates_to_trait_pick
ProbeContext.prototype.collapse_candidates_to_trait_pick = function (this: ProbeContext, self_ty: Ty, probes: readonly [Candidate, ProbeResult][]): Pick | undefined {
  // Do all probes correspond to the same trait?
  const container = AssocItem.trait_container(probes[0]![0].item, this.tcx);
  if (container === undefined) return undefined;
  for (const [p, _] of probes.slice(1)) {
    const p_container = AssocItem.trait_container(p.item, this.tcx);
    if (p_container === undefined) return undefined;
    if (!DefId_eq(p_container, container)) {
      return undefined;
    }
  }

  // We try and find the ambiguous candidate in order to report the pick as ambiguous.
  let ambiguous_candidate: Candidate | undefined = undefined;
  for (const [p, _] of probes) {
    if (p.kind.$ === "TraitCandidate" && p.kind.is_ambiguously_imported === true) {
      ambiguous_candidate = p;
      break;
    }
  }

  // If there isn't any, then we just use the first probe.
  const [is_ambiguously_imported, candidate]: [boolean, Candidate] = ambiguous_candidate !== undefined ? [true, ambiguous_candidate] : [false, probes[0]![0]];

  // FIXME: check the return type here somehow.
  // If so, just use this trait and call it a day.
  return new Pick(candidate.item, { $: "TraitPick", is_ambiguously_imported }, candidate.import_ids, 0, undefined, self_ty, [], undefined, []);
};

/// Much like `collapse_candidates_to_trait_pick`, this method allows us to collapse
/// multiple conflicting picks if there is one pick whose trait container is a subtrait
/// of the trait containers of all of the other picks.
///
/// This is the method-probe analogue of
/// `rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::collapse_candidates_to_subtrait_pick`;
/// keep both implementations in sync.
///
/// This implements RFC #3624.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2419 collapse_candidates_to_subtrait_pick
ProbeContext.prototype.collapse_candidates_to_subtrait_pick = function (this: ProbeContext, self_ty: Ty, probes: readonly [Candidate, ProbeResult][]): Pick | undefined {
  let child_candidate = probes[0]![0];
  const child_trait_ = AssocItem.trait_container(child_candidate.item, this.tcx);
  if (child_trait_ === undefined) return undefined;
  let child_trait = child_trait_;
  let supertraits_ = new DefIdSet(supertrait_def_ids(this.tcx, child_trait));

  let remaining_candidates: Candidate[] = probes.slice(1).map(([p, _]) => p);
  while (!(remaining_candidates.length === 0)) {
    let made_progress = false;
    const next_round: Candidate[] = [];

    for (const remaining_candidate of remaining_candidates) {
      const remaining_trait = AssocItem.trait_container(remaining_candidate.item, this.tcx);
      if (remaining_trait === undefined) return undefined;
      if (supertraits_.has(remaining_trait)) {
        made_progress = true;
        continue;
      }

      // This candidate is not a supertrait of the `child_trait`.
      // Check if it's a subtrait of the `child_trait`, instead.
      // If it is, then it must have been a subtrait of every
      // other pick we've eliminated at this point. It will
      // take over at this point.
      const remaining_trait_supertraits = new DefIdSet(supertrait_def_ids(this.tcx, remaining_trait));
      if (remaining_trait_supertraits.has(child_trait)) {
        child_candidate = remaining_candidate;
        child_trait = remaining_trait;
        supertraits_ = remaining_trait_supertraits;
        made_progress = true;
        continue;
      }

      // Neither `child_trait` or the current candidate are
      // supertraits of each other.
      // Don't bail here, since we may be comparing two supertraits
      // of a common subtrait. These two supertraits won't be related
      // at all, but we will pick them up next round when we find their
      // child as we continue iterating in this round.
      next_round.push(remaining_candidate);
    }

    if (made_progress) {
      // If we've made progress, iterate again.
      remaining_candidates = next_round;
    } else {
      // Otherwise, we must have at least two candidates which
      // are not related to each other at all.
      return undefined;
    }
  }

  const is_ambiguously_imported = child_candidate.kind.$ === "TraitCandidate" ? child_candidate.kind.is_ambiguously_imported : false;

  const child_def_id = child_candidate.item.def_id;
  return new Pick(
    child_candidate.item,
    { $: "TraitPick", is_ambiguously_imported },
    child_candidate.import_ids,
    0,
    undefined,
    self_ty,
    [],
    undefined,
    probes.map(([c, _]) => c.item).filter((item) => !DefId_eq(item.def_id, child_def_id)),
  );
};

/// Similarly to `probe_for_return_type`, this method attempts to find the best matching
/// candidate method where the method name may have been misspelled. Similarly to other
/// edit distance based suggestions, we provide at most one such suggestion.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2500 probe_for_similar_candidate
ProbeContext.prototype.probe_for_similar_candidate = function (this: ProbeContext): Result<AssocItem | undefined, MethodError> {
  // debug!("probing for method names similar to {:?}", self.method_name);

  return this.probe((_): Result<AssocItem | undefined, MethodError> => {
    const pcx = ProbeContext.new(
      this.fcx,
      this.span,
      this.mode,
      this.method_name,
      this.return_type,
      this.orig_steps_var_values,
      this.steps,
      this.scope_expr_id,
      { _0: true },
    );
    pcx.allow_similar_names = true;
    pcx.assemble_inherent_candidates();
    pcx.assemble_extension_candidates_for_all_traits();

    const method_names = pcx.candidate_method_names((_) => true);
    pcx.allow_similar_names = false;
    const applicable_close_candidates: AssocItem[] = [];
    for (const method_name of method_names) {
      pcx.reset();
      pcx.method_name = method_name;
      pcx.assemble_inherent_candidates();
      pcx.assemble_extension_candidates_for_all_traits();
      const pick = pcx.pick_core([]);
      if (pick !== undefined && pick.$ === "Ok") {
        applicable_close_candidates.push(pick._0.item);
      }
    }

    if (applicable_close_candidates.length === 0) {
      return Ok(undefined);
    } else {
      let best_name: Symbol | undefined;
      const by_alias = applicable_close_candidates.find((cand) => this.matches_by_doc_alias(cand.def_id));
      if (by_alias !== undefined) {
        best_name = AssocItem.name(by_alias);
      } else {
        const names = applicable_close_candidates.map((cand) => AssocItem.name(cand));
        best_name = find_best_match_for_name_with_substrings(names, this.method_name!.name, undefined);
      }
      return Ok(best_name === undefined ? undefined : applicable_close_candidates.find((method) => AssocItem.name(method) === best_name));
    }
  });
};

///////////////////////////////////////////////////////////////////////////
// MISCELLANY
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2563 has_applicable_self
ProbeContext.prototype.has_applicable_self = function (this: ProbeContext, item: AssocItem): boolean {
  // "Fast track" -- check for usage of sugar when in method call
  // mode.
  //
  // In Path mode (i.e., resolving a value like `T::next`), consider any
  // associated value (i.e., methods, constants) but not types.
  switch (this.mode) {
    case "MethodCall":
      return AssocItem.is_method(item);
    case "Path":
      switch (item.kind.$) {
        case "Type":
          return false;
        case "Fn":
        case "Const":
          return true;
      }
  }
  // FIXME -- check for types that deref to `Self`,
  // like `Rc<Self>` and so on.
  //
  // Note also that the current code will break if this type
  // includes any of the type parameters defined on the method
  // -- but this could be overcome.
};

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2584 record_static_candidate
ProbeContext.prototype.record_static_candidate = function (this: ProbeContext, source: CandidateSource): void {
  this.static_candidates.push(source);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2589 xform_self_ty
ProbeContext.prototype.xform_self_ty = function (this: ProbeContext, item: AssocItem, impl_ty: Ty, args: GenericArgs): [Ty, Ty | undefined] {
  if (AssocItem.is_fn(item) && this.mode === "MethodCall") {
    const sig = this.xform_method_sig(item.def_id, args);
    // `self.self_ty_override.unwrap_or(sig.inputs()[0])`: the index is evaluated (and bounds-checked) eagerly.
    const inputs = FnSig.inputs(sig);
    const input0 = inputs.length > 0 ? inputs[0]! : panic(`index out of bounds: the len is ${inputs.length} but the index is 0`);
    return [this.self_ty_override ?? input0, FnSig.output(sig)];
  } else {
    return [impl_ty, undefined];
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2604 xform_method_sig
ProbeContext.prototype.xform_method_sig = function (this: ProbeContext, method: DefId, args: GenericArgs): FnSig {
  const fn_sig = this.tcx.fn_sig(method) as EarlyBinder<Binder<FnSig>>;
  // debug!(?fn_sig);

  assert(!TypeVisitableExt.has_escaping_bound_vars(args, fold_GenericArgs), "assertion failed: !args.has_escaping_bound_vars()");

  // It is possible for type parameters or early-bound lifetimes
  // to appear in the signature of `self`. The generic parameters
  // we are given do not include type/lifetime parameters for the
  // method yet. So create fresh variables here for those too,
  // if there are any.
  const generics = this.tcx.generics_of(method) as Generics;
  assert_eq(args.length, generics.parent_count, (v) => `${v}`);

  let xform_fn_sig: Binder<FnSig>;
  if (generics.is_own_empty()) {
    xform_fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig, this.tcx, args, fold_Binder(fold_FnSig)));
  } else {
    const args_ = RawList.for_item(this.tcx, method, (param, _): GenericArg => {
      const i = param.index;
      if (i < args.length) {
        return args[i]!;
      } else {
        switch (param.kind.$) {
          case "Lifetime":
            // In general, during probe we erase regions.
            return this.tcx.lifetimes.re_erased;
          case "Type":
          case "Const":
            return this.var_for_def(this.span, param);
        }
      }
    });
    xform_fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig, this.tcx, args_, fold_Binder(fold_FnSig)));
  }

  return this.tcx.instantiate_bound_regions_with_erased(xform_fn_sig, fold_FnSig);
};

/// Determine if the given associated item type is relevant in the current context.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2644 is_relevant_kind_for_mode
ProbeContext.prototype.is_relevant_kind_for_mode = function (this: ProbeContext, kind: AssocKind): boolean {
  if (this.mode === "MethodCall" && kind.$ === "Fn") return true;
  if (this.mode === "Path" && (kind.$ === "Const" || kind.$ === "Fn")) return true;
  return false;
};

/// Determine if the associated item with the given DefId matches
/// the desired name via a doc alias or rustc_confusables
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2654 matches_by_doc_alias
ProbeContext.prototype.matches_by_doc_alias = function (this: ProbeContext, def_id: DefId): boolean {
  const method = this.method_name;
  if (method === undefined) {
    return false;
  }

  const d = find_attr(HasAttrs_DefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "Doc" ? k._0 : undefined));
  if (d !== undefined && d.aliases.has(method.name)) {
    return true;
  }

  const confusables = find_attr(HasAttrs_DefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "RustcConfusables" ? k.confusables : undefined));
  if (confusables !== undefined && confusables.includes(method.name)) {
    return true;
  }

  return false;
};

/// Finds the method with the appropriate name (or return type, as the case may be). If
/// `allow_similar_names` is set, find methods with close-matching names.
// The length of the returned iterator is nearly always 0 or 1 and this
// method is fairly hot.
// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2679 impl_or_trait_item
ProbeContext.prototype.impl_or_trait_item = function (this: ProbeContext, def_id: DefId): AssocItem[] {
  const name = this.method_name;
  if (name !== undefined) {
    if (this.allow_similar_names) {
      const max_dist = Math.floor(Math.max(utf8_len(name.as_str()), 3) / 3);
      return [...AssocItems.in_definition_order(this.tcx.associated_items(def_id) as AssocItems)].filter((x) => {
        if (!this.is_relevant_kind_for_mode(x.kind)) {
          return false;
        }
        const d = edit_distance_with_substrings(name.as_str(), Sym.as_str(AssocItem.name(x)), max_dist);
        if (d !== undefined) {
          return d > 0;
        }
        return this.matches_by_doc_alias(x.def_id);
      });
    } else {
      const x = this.fcx.associated_value(def_id, name);
      return x !== undefined && this.is_relevant_kind_for_mode(x.kind) ? [x] : [];
    }
  } else {
    return [...AssocItems.in_definition_order(this.tcx.associated_items(def_id) as AssocItems)].filter((x) => this.is_relevant_kind_for_mode(x.kind));
  }
};

// ---- impl Candidate --------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_hir_typeck/src/method/probe.rs:2719 to_unadjusted_pick
Candidate.prototype.to_unadjusted_pick = function (this: Candidate, self_ty: Ty, unstable_candidates: [Candidate, Symbol][]): Pick {
  let kind: PickKind;
  const ck = this.kind;
  switch (ck.$) {
    case "InherentImplCandidate":
      kind = PickKind.InherentImplPick;
      break;
    case "ObjectCandidate":
      kind = PickKind.ObjectPick;
      break;
    case "TraitCandidate":
      kind = { $: "TraitPick", is_ambiguously_imported: ck.is_ambiguously_imported };
      break;
    case "WhereClauseCandidate": {
      const trait_ref = ck._0;
      // Only trait derived from where-clauses should
      // appear here, so they should not contain any
      // inference variables or other artifacts. This
      // means they are safe to put into the
      // `WhereClausePick`.
      assert(
        !TypeVisitableExt.has_infer(Binder.skip_binder(trait_ref).args, fold_GenericArgs) &&
          !TypeVisitableExt.has_placeholders(Binder.skip_binder(trait_ref).args, fold_GenericArgs),
        "assertion failed: !trait_ref.skip_binder().args.has_infer() && !trait_ref.skip_binder().args.has_placeholders()",
      );

      kind = { $: "WhereClausePick", _0: trait_ref };
      break;
    }
  }
  return new Pick(
    this.item,
    kind,
    this.import_ids,
    0,
    undefined,
    self_ty,
    unstable_candidates,
    ck.$ === "InherentImplCandidate" ? ck.receiver_steps : undefined,
    [],
  );
};
