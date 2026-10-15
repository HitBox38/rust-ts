// Port of compiler/rustc_traits/src/type_op.rs (lane selcx-contract).
//
// PORT: `T: fmt::Debug + TypeFoldable` of `type_op_normalize` is the D4 descriptor `d_T`; the provider fns pass the
// descriptors of their key / response types to `enter_canonical_trait_query`. `()` is `null`.

import type { Canonical, CanonicalQueryInput, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { type_op as middle_type_op } from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, Ty } from "../rustc_middle/ty/decls.ts";
import type { ParamEnvAnd } from "../rustc_middle/ty/mod.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { type FnSig, fold_with_FnSig, try_fold_with_FnSig, visit_with_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { Ok, type Result } from "../std/result.ts";
import type { ScrubbedTraitError } from "../rustc_infer/traits/engine.ts";
import type { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { type_op_ascribe_user_type_with_span } from "../rustc_trait_selection/traits/query/type_op/ascribe_user_type.ts";
import { type_op_prove_predicate_with_cause } from "../rustc_trait_selection/traits/query/type_op/prove_predicate.ts";
import { fold_ParamEnvAnd } from "../rust_ts/fold_param_env_and.ts";

type AscribeUserType = middle_type_op.AscribeUserType;
type ProvePredicate = middle_type_op.ProvePredicate;
type Normalize<T> = middle_type_op.Normalize<T>;

const d_AscribeUserType: TypeFoldable<AscribeUserType> = {
  visit_with: middle_type_op.visit_with_AscribeUserType,
  try_fold_with: middle_type_op.try_fold_with_AscribeUserType,
  fold_with: middle_type_op.fold_with_AscribeUserType,
};
const d_ProvePredicate: TypeFoldable<ProvePredicate> = {
  visit_with: middle_type_op.visit_with_ProvePredicate,
  try_fold_with: middle_type_op.try_fold_with_ProvePredicate,
  fold_with: middle_type_op.fold_with_ProvePredicate,
};
/** `Normalize<T>: TypeFoldable` (derived, generic over `T`). */
function d_Normalize<T>(d_T: TypeFoldable<T>): TypeFoldable<Normalize<T>> {
  return {
    visit_with: (self, v) => middle_type_op.visit_with_Normalize(self, v, d_T.visit_with),
    try_fold_with: (self, f) => middle_type_op.try_fold_with_Normalize(self, f, d_T.try_fold_with),
    fold_with: (self, f) => middle_type_op.fold_with_Normalize(self, f, d_T.fold_with),
  };
}
/** `(): TypeFoldable` */
const d_unit: TypeFoldable<null> = {
  visit_with: (_self, v) => v.Result.output(),
  try_fold_with: (self) => Ok(self),
  fold_with: (self) => self,
};
const d_FnSig: TypeFoldable<FnSig> = { visit_with: visit_with_FnSig, try_fold_with: try_fold_with_FnSig, fold_with: fold_with_FnSig };

// rustc: compiler/rustc_traits/src/type_op.rs:20 provide
export function provide(p: Providers): void {
  p.type_op_ascribe_user_type = type_op_ascribe_user_type;
  p.type_op_prove_predicate = type_op_prove_predicate;
  p.type_op_normalize_ty = type_op_normalize_ty;
  p.type_op_normalize_clause = type_op_normalize_clause as Providers["type_op_normalize_clause"];
  p.type_op_normalize_fn_sig = type_op_normalize_fn_sig as Providers["type_op_normalize_fn_sig"];
  p.type_op_normalize_poly_fn_sig = type_op_normalize_poly_fn_sig as Providers["type_op_normalize_poly_fn_sig"];
}

// rustc: compiler/rustc_traits/src/type_op.rs:32 type_op_ascribe_user_type
function type_op_ascribe_user_type(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<AscribeUserType>>): Result<Canonical<QueryResponse<null>>, NoSolution> {
  return tcx
    .infer_ctxt()
    .enter_canonical_trait_query(
      canonicalized,
      (ocx, key) => type_op_ascribe_user_type_with_span(ocx as ObligationCtxt<ScrubbedTraitError>, key, DUMMY_SP),
      fold_ParamEnvAnd(d_AscribeUserType),
      d_unit,
    );
}

// rustc: compiler/rustc_traits/src/type_op.rs:41 type_op_normalize
function type_op_normalize<T>(ocx: ObligationCtxt<ScrubbedTraitError>, key: ParamEnvAnd<Normalize<T>>, d_T: TypeFoldable<T>): Result<T, NoSolution> {
  const {
    param_env,
    value: { value },
  } = key;
  const r = ocx.infcx.at(ObligationCause.dummy(), param_env).query_normalize(Unnormalized.skip_normalization(value), d_T);
  if (r.$ === "Err") return r;
  const { value: value_, obligations } = r._0;
  ocx.register_obligations(obligations);
  return Ok(value_);
}

/** The instance of `type_op_normalize` for `T` (the `enter_canonical_trait_query` operation). */
function enter_type_op_normalize<T>(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<T>>>, d_T: TypeFoldable<T>): Result<Canonical<QueryResponse<T>>, NoSolution> {
  return tcx
    .infer_ctxt()
    .enter_canonical_trait_query(canonicalized, (ocx, key) => type_op_normalize(ocx as ObligationCtxt<ScrubbedTraitError>, key, d_T), fold_ParamEnvAnd(d_Normalize(d_T)), d_T);
}

// rustc: compiler/rustc_traits/src/type_op.rs:57 type_op_normalize_ty
function type_op_normalize_ty(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<Ty>>>): Result<Canonical<QueryResponse<Ty>>, NoSolution> {
  return enter_type_op_normalize(tcx, canonicalized, fold_Ty);
}

// rustc: compiler/rustc_traits/src/type_op.rs:64 type_op_normalize_clause
function type_op_normalize_clause(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<Clause>>>): Result<Canonical<QueryResponse<Clause>>, NoSolution> {
  return enter_type_op_normalize(tcx, canonicalized, fold_Clause);
}

// rustc: compiler/rustc_traits/src/type_op.rs:71 type_op_normalize_fn_sig
function type_op_normalize_fn_sig(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<FnSig>>>): Result<Canonical<QueryResponse<FnSig>>, NoSolution> {
  return enter_type_op_normalize(tcx, canonicalized, d_FnSig);
}

// rustc: compiler/rustc_traits/src/type_op.rs:78 type_op_normalize_poly_fn_sig
function type_op_normalize_poly_fn_sig(
  tcx: TyCtxt,
  canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<PolyFnSig>>>,
): Result<Canonical<QueryResponse<PolyFnSig>>, NoSolution> {
  return enter_type_op_normalize(tcx, canonicalized, fold_Binder(d_FnSig));
}

// rustc: compiler/rustc_traits/src/type_op.rs:85 type_op_prove_predicate
function type_op_prove_predicate(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<ProvePredicate>>): Result<Canonical<QueryResponse<null>>, NoSolution> {
  return tcx.infer_ctxt().enter_canonical_trait_query(
    canonicalized,
    (ocx, key) => {
      type_op_prove_predicate_with_cause(ocx as ObligationCtxt<ScrubbedTraitError>, key, ObligationCause.dummy());
      return Ok(null);
    },
    fold_ParamEnvAnd(d_ProvePredicate),
    d_unit,
  );
}
