// Port of compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs (lane old-query-typeops, wave 18c).
//
// PORT (D4, lane selcx-contract's contract):
// - `impl<T: Normalizable> QueryTypeOp for Normalize<T>` is `QueryTypeOp_Normalize(d_T)`.
// - `trait Normalizable<'tcx>` is the descriptor `Normalizable<T>` (its `TypeFoldable` + `type_op_method`); the impls are
//   `Normalizable_Ty`, `Normalizable_Clause`, `Normalizable_PolyFnSig`, `Normalizable_FnSig`,
//   `Normalizable_PolyTypeOutlivesClause` (normalize.rs:40/49/58/67/78).
// - Each `Normalizable_<T>` carries `T`'s `TypeFoldable` impl as forwarding closures (read at call time, init order).
// Init order: top-level code here touches only other crates.

import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../../../rustc_middle/infer/canonical.ts";
import type { type_op } from "../../../../rustc_middle/traits/query.ts";
import { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Clause, Ty } from "../../../../rustc_middle/ty/decls.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { PolyTypeOutlivesClause } from "../../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { fold_Binder } from "../../../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import { fold_with_OutlivesClause, type OutlivesClause, try_fold_with_OutlivesClause, visit_with_OutlivesClause } from "../../../../rustc_type_ir/predicate.gen.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { type FnSig, fold_with_FnSig, try_fold_with_FnSig, visit_with_FnSig } from "../../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../../rustc_type_ir/visit.ts";
import { unreachable } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";
import type { QueryTypeOp } from "./mod.ts";

// `pub use rustc_middle::traits::query::type_op::Normalize;`
export type Normalize<T> = type_op.Normalize<T>;

// rustc-trait: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:31 Normalizable
export interface Normalizable<T> extends TypeFoldable<T> {
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:34 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<T>>>): Result<CanonicalQueryResponse<T>, NoSolution>;
}

/** `impl<'tcx, T: Normalizable<'tcx>> QueryTypeOp<'tcx> for Normalize<'tcx, T>` (normalize.rs:9). */
export function QueryTypeOp_Normalize<T>(d_T: Normalizable<T>): QueryTypeOp<Normalize<T>, T> {
  return {
    /** `Normalize<T>: TypeFoldable` (derived, rustc_middle traits/query.rs, generic over `T`). */
    d_Self: {
      visit_with: (self, v) => middle_type_op.visit_with_Normalize(self, v, d_T.visit_with),
      try_fold_with: (self, f) => middle_type_op.try_fold_with_Normalize(self, f, d_T.try_fold_with),
      fold_with: (self, f) => middle_type_op.fold_with_Normalize(self, f, d_T.fold_with),
    },
    d_QueryResponse: d_T,
    // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:15 try_fast_path
    try_fast_path(_tcx: TyCtxt, key: ParamEnvAnd<Normalize<T>>): T | undefined {
      if (!TypeVisitableExt.has_aliases(Unnormalized.skip_normalization(key.value.value), d_T)) {
        return Unnormalized.skip_normalization(key.value.value);
      } else {
        return undefined;
      }
    },
    // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:23 perform_query
    perform_query(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<T>>>): Result<CanonicalQueryResponse<T>, NoSolution> {
      return d_T.type_op_method(tcx, canonicalized);
    },
  };
}

// ---- impl<'tcx> Normalizable<'tcx> for Ty<'tcx> (normalize.rs:40) ----
export const Normalizable_Ty: Normalizable<Ty> = {
  visit_with: (v, visitor) => fold_Ty.visit_with(v, visitor),
  try_fold_with: (v, folder) => fold_Ty.try_fold_with(v, folder),
  fold_with: (v, folder) => fold_Ty.fold_with(v, folder),
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:41 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<Ty>>>): Result<CanonicalQueryResponse<Ty>, NoSolution> {
    return tcx.type_op_normalize_ty(canonicalized) as Result<CanonicalQueryResponse<Ty>, NoSolution>;
  },
};

// ---- impl<'tcx> Normalizable<'tcx> for ty::Clause<'tcx> (normalize.rs:49) ----
export const Normalizable_Clause: Normalizable<Clause> = {
  visit_with: (v, visitor) => fold_Clause.visit_with(v, visitor),
  try_fold_with: (v, folder) => fold_Clause.try_fold_with(v, folder),
  fold_with: (v, folder) => fold_Clause.fold_with(v, folder),
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:50 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<Clause>>>): Result<CanonicalQueryResponse<Clause>, NoSolution> {
    return tcx.type_op_normalize_clause(canonicalized) as Result<CanonicalQueryResponse<Clause>, NoSolution>;
  },
};

// ---- impl<'tcx> Normalizable<'tcx> for ty::PolyFnSig<'tcx> (normalize.rs:58) ----
export const Normalizable_PolyFnSig: Normalizable<PolyFnSig> = {
  visit_with: (v, visitor) => fold_Binder(d_FnSig).visit_with(v, visitor),
  try_fold_with: (v, folder) => fold_Binder(d_FnSig).try_fold_with(v, folder),
  fold_with: (v, folder) => fold_Binder(d_FnSig).fold_with(v, folder),
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:59 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<PolyFnSig>>>): Result<CanonicalQueryResponse<PolyFnSig>, NoSolution> {
    return tcx.type_op_normalize_poly_fn_sig(canonicalized) as Result<CanonicalQueryResponse<PolyFnSig>, NoSolution>;
  },
};

// ---- impl<'tcx> Normalizable<'tcx> for ty::FnSig<'tcx> (normalize.rs:67) ----
export const Normalizable_FnSig: Normalizable<FnSig> = {
  visit_with: visit_with_FnSig,
  try_fold_with: try_fold_with_FnSig,
  fold_with: fold_with_FnSig,
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:68 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<FnSig>>>): Result<CanonicalQueryResponse<FnSig>, NoSolution> {
    return tcx.type_op_normalize_fn_sig(canonicalized) as Result<CanonicalQueryResponse<FnSig>, NoSolution>;
  },
};

/// This impl is not needed, since we never normalize type outlives clauses
/// in the old solver, but is required by trait bounds to be happy.
// ---- impl<'tcx> Normalizable<'tcx> for ty::PolyTypeOutlivesClause<'tcx> (normalize.rs:78) ----
export const Normalizable_PolyTypeOutlivesClause: Normalizable<PolyTypeOutlivesClause> = {
  visit_with: (v, visitor) => fold_Binder(d_TypeOutlivesClause).visit_with(v, visitor),
  try_fold_with: (v, folder) => fold_Binder(d_TypeOutlivesClause).try_fold_with(v, folder),
  fold_with: (v, folder) => fold_Binder(d_TypeOutlivesClause).fold_with(v, folder),
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:79 type_op_method
  type_op_method(
    _tcx: TyCtxt,
    _canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<PolyTypeOutlivesClause>>>,
  ): Result<CanonicalQueryResponse<PolyTypeOutlivesClause>, NoSolution> {
    return unreachable("internal error: entered unreachable code: we never normalize PolyTypeOutlivesClause");
  },
};

// ---- PORT: descriptors -------------------------------------------------------------------------------------------------

/** The derived `TypeFoldable` of `FnSig` (rustc_type_ir ty_kind.rs). */
const d_FnSig: TypeFoldable<FnSig> = { visit_with: visit_with_FnSig, try_fold_with: try_fold_with_FnSig, fold_with: fold_with_FnSig };
/** The derived `TypeFoldable` of `OutlivesClause<Ty>` (rustc_type_ir predicate.rs), read through `fold_Ty` at call time. */
const d_TypeOutlivesClause: TypeFoldable<OutlivesClause<Ty>> = {
  visit_with: (v, visitor) => visit_with_OutlivesClause(v, visitor, fold_Ty.visit_with),
  try_fold_with: (v, folder) => try_fold_with_OutlivesClause(v, folder, fold_Ty.try_fold_with),
  fold_with: (v, folder) => fold_with_OutlivesClause(v, folder, fold_Ty.fold_with),
};
