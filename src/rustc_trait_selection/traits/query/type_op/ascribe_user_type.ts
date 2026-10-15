// Port of compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs (lane old-query-typeops, wave 18c).
//
// PORT: `impl QueryTypeOp for AscribeUserType` is the descriptor `QueryTypeOp_AscribeUserType` (`QueryResponse = ()` is
// `null`). `Obligation::new(tcx, cause, param_env, clause)` takes the `Upcast` fn of the predicate last; `?` on
// `ocx.eq(..)` converts the `TypeError` with `impl From<TypeError> for NoSolution`.
// Init order: top-level code here touches only other crates.

import { ToTrace_Ty } from "../../../../rustc_infer/infer/at.ts";
import { Obligation } from "../../../../rustc_infer/traits/mod.ts";
import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../../../rustc_middle/infer/canonical.ts";
import { clone_ObligationCause, ObligationCause } from "../../../../rustc_middle/traits/mod.ts";
import type { type_op } from "../../../../rustc_middle/traits/query.ts";
import { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv, Predicate, Ty } from "../../../../rustc_middle/ty/decls.ts";
import { GenericArg, type UserArgs } from "../../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../../../rustc_middle/ty/generics.ts";
import { type ParamEnvAnd, Term } from "../../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_ClauseKind } from "../../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID, type DefId } from "../../../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../../../rustc_span/lib.ts";
import { EarlyBinder } from "../../../../rustc_type_ir/binder.ts";
import type { ClauseKind } from "../../../../rustc_type_ir/decls.ts";
import type { Interner } from "../../../../rustc_type_ir/interner.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../../../rustc_type_ir/unnormalized.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import type { ObligationCtxt } from "../../engine.ts";
import type { ScrubbedTraitError } from "../../../../rustc_infer/traits/engine.ts";
import type { QueryTypeOp } from "./mod.ts";

// `pub use rustc_middle::traits::query::type_op::AscribeUserType;`
export type AscribeUserType = type_op.AscribeUserType;

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

const upcast_Clause = Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate;
const upcast_ClauseKind = Predicate_upcast_from_ClauseKind as (from: ClauseKind, tcx: Interner) => Predicate;
/** `ty::ClauseKind::WellFormed(term)` */
function wf_clause(term: Term): ClauseKind {
  return { $: "WellFormed", _0: term };
}

/** `impl<'tcx> QueryTypeOp<'tcx> for AscribeUserType<'tcx>` (ascribe_user_type.rs:15). */
export const QueryTypeOp_AscribeUserType: QueryTypeOp<AscribeUserType, null> = {
  d_Self: {
    visit_with: middle_type_op.visit_with_AscribeUserType,
    try_fold_with: middle_type_op.try_fold_with_AscribeUserType,
    fold_with: middle_type_op.fold_with_AscribeUserType,
  },
  d_QueryResponse: {
    visit_with: (_self, v) => v.Result.output(),
    try_fold_with: (self) => ({ $: "Ok", _0: self }),
    fold_with: (self) => self,
  },
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:18 try_fast_path
  try_fast_path(_tcx: TyCtxt, _key: ParamEnvAnd<AscribeUserType>): null | undefined {
    return undefined;
  },
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:25 perform_query
  perform_query(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<AscribeUserType>>): Result<CanonicalQueryResponse<null>, NoSolution> {
    return tcx.type_op_ascribe_user_type(canonicalized) as Result<CanonicalQueryResponse<null>, NoSolution>;
  },
};

/// The core of the `type_op_ascribe_user_type` query: for diagnostics purposes in NLL HRTB errors,
/// this query can be re-run to better track the span of the obligation cause, and improve the error
/// message. Do not call directly unless you're in that very specific context.
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:36 type_op_ascribe_user_type_with_span
export function type_op_ascribe_user_type_with_span(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  key: ParamEnvAnd<AscribeUserType>,
  span: Span,
): Result<null, NoSolution> {
  const {
    param_env,
    value: { mir_ty, user_ty },
  } = key;
  // debug!("type_op_ascribe_user_type: mir_ty={:?} user_ty={:?}", mir_ty, user_ty);
  const kind = user_ty.kind;
  switch (kind.$) {
    case "Ty": {
      const r = relate_mir_and_user_ty(ocx, param_env, span, mir_ty, kind._0);
      if (r.$ === "Err") return r;
      break;
    }
    case "TypeOf": {
      const r = relate_mir_and_user_args(ocx, param_env, span, mir_ty, kind._0, kind._1);
      if (r.$ === "Err") return r;
      break;
    }
  }

  // Enforce any bounds that come from impl trait in bindings.
  ocx.register_obligations(
    user_ty.bounds.map((clause) => Obligation.new(ocx.infcx.tcx, ObligationCause.dummy_with_span(span), param_env, clause, upcast_Clause)),
  );

  return Ok(null);
}

// #[instrument(level = "debug", skip(ocx, param_env, span))]
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:59 relate_mir_and_user_ty
function relate_mir_and_user_ty(ocx: ObligationCtxt<ScrubbedTraitError>, param_env: ParamEnv, span: Span, mir_ty: Ty, user_ty_: Ty): Result<null, NoSolution> {
  const cause = ObligationCause.dummy_with_span(span);
  ocx.register_obligation(
    Obligation.new(ocx.infcx.tcx, clone_ObligationCause(cause), param_env, wf_clause(Term.from_Ty(user_ty_)), upcast_ClauseKind),
  );

  const user_ty = ocx.normalize(cause, param_env, Unnormalized.new_wip(user_ty_), fold_Ty);
  if (ocx.eq(cause, param_env, mir_ty, user_ty, ToTrace_Ty).$ === "Err") return Err(NO_SOLUTION);

  return Ok(null);
}

// #[instrument(level = "debug", skip(ocx, param_env, span))]
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/ascribe_user_type.rs:81 relate_mir_and_user_args
function relate_mir_and_user_args(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  param_env: ParamEnv,
  span: Span,
  mir_ty: Ty,
  def_id: DefId,
  user_args: UserArgs,
): Result<null, NoSolution> {
  const { user_self_ty, args } = user_args;
  const tcx = ocx.infcx.tcx;
  const cause = ObligationCause.dummy_with_span(span);

  const ty_ = EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty);
  const ty = ocx.normalize(cause, param_env, ty_, fold_Ty);
  // debug!("relate_type_and_user_type: ty of def-id is {:?}", ty);

  if (ocx.eq(cause, param_env, mir_ty, ty, ToTrace_Ty).$ === "Err") return Err(NO_SOLUTION);

  // Prove the clauses coming along with `def_id`.
  //
  // Also, normalize the `instantiated_clauses`
  // because otherwise we wind up with duplicate "type
  // outlives" error messages.
  const instantiated_clauses = GenericClauses.instantiate(tcx.clauses_of(def_id) as GenericClauses, tcx, args);

  // debug!(?instantiated_clauses);
  for (const [instantiated_clause_, clause_span] of instantiated_clauses.into_iter()) {
    const span_ = span === DUMMY_SP ? clause_span : span;
    const cause = ObligationCause.new(span_, CRATE_DEF_ID, { $: "AscribeUserTypeProvePredicate", _0: clause_span, _1: def_id });
    const instantiated_clause = ocx.normalize(cause, param_env, instantiated_clause_, fold_Clause);

    ocx.register_obligation(Obligation.new(tcx, cause, param_env, instantiated_clause, upcast_Clause));
  }

  // Now prove the well-formedness of `def_id` with `args`.
  // Note for some items, proving the WF of `ty` is not sufficient because the
  // well-formedness of an item may depend on the WF of gneneric args not present in the
  // item's type. Currently this is true for associated consts, e.g.:
  // ```rust
  // impl<T> MyTy<T> {
  //     const CONST: () = { /* arbitrary code that depends on T being WF */ };
  // }
  // ```
  for (const arg of args) {
    const term = GenericArg.as_term(arg);
    if (term === undefined) continue;
    ocx.register_obligation(Obligation.new(tcx, clone_ObligationCause(cause), param_env, wf_clause(term), upcast_ClauseKind));
  }

  if (user_self_ty !== undefined) {
    const { impl_def_id, self_ty: self_ty_ } = user_self_ty;
    ocx.register_obligation(
      Obligation.new(tcx, clone_ObligationCause(cause), param_env, wf_clause(Term.from_Ty(self_ty_)), upcast_ClauseKind),
    );

    const self_ty = ocx.normalize(cause, param_env, Unnormalized.new_wip(self_ty_), fold_Ty);
    const impl_self_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(impl_def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty));
    const impl_self_ty = ocx.normalize(cause, param_env, Unnormalized.new_wip(impl_self_ty_), fold_Ty);

    if (ocx.eq(cause, param_env, self_ty, impl_self_ty, ToTrace_Ty).$ === "Err") return Err(NO_SOLUTION);
  }

  return Ok(null);
}
