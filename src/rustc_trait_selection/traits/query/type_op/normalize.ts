// Port of compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract). PORT (D4):
// - `impl<T: Normalizable> QueryTypeOp for Normalize<T>` is `QueryTypeOp_Normalize(d_T)`.
// - `trait Normalizable<'tcx>` is the descriptor `Normalizable<T>` (its `TypeFoldable` + `type_op_method`); the impls are
//   `Normalizable_Ty`, `Normalizable_Clause`, `Normalizable_PolyFnSig`, `Normalizable_FnSig`,
//   `Normalizable_PolyTypeOutlivesClause` (normalize.rs:40/49/58/67/78).
// Fill: replace the stub bodies, markers `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:<line> <name>`
// directly above. Init order: top-level code here touches only other crates.

import type { CanonicalQueryInput, CanonicalQueryResponse } from "../../../../rustc_middle/infer/canonical.ts";
import type { type_op } from "../../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";
import type { QueryTypeOp } from "./mod.ts";

// `pub use rustc_middle::traits::query::type_op::Normalize;`
export type Normalize<T> = type_op.Normalize<T>;

// rustc-trait: compiler/rustc_trait_selection/src/traits/query/type_op/normalize.rs:31 Normalizable
export interface Normalizable<T> extends TypeFoldable<T> {
  // (trait decl) normalize.rs:34 type_op_method
  type_op_method(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Normalize<T>>>): Result<CanonicalQueryResponse<T>, NoSolution>;
}

/** `impl<'tcx, T: Normalizable<'tcx>> QueryTypeOp<'tcx> for Normalize<'tcx, T>` (normalize.rs:9). */
export function QueryTypeOp_Normalize<T>(d_T: Normalizable<T>): QueryTypeOp<Normalize<T>, T> {
  return {
    get d_Self(): TypeFoldable<Normalize<T>> {
      return unported("rustc_trait_selection::traits::query::type_op::normalize: TypeFoldable for Normalize<T>");
    },
    d_QueryResponse: d_T,
    // normalize.rs:15 (stub)
    try_fast_path(_tcx, _key) {
      return unported("rustc_trait_selection::traits::query::type_op::normalize::<Normalize<T> as QueryTypeOp>::try_fast_path");
    },
    // normalize.rs:23 (stub)
    perform_query(_tcx, _canonicalized) {
      return unported("rustc_trait_selection::traits::query::type_op::normalize::<Normalize<T> as QueryTypeOp>::perform_query");
    },
  };
}

/** Stub `Normalizable` impl (the lane builds each from the type's `TypeFoldable` and its `type_op_method`). */
function normalizable_stub<T>(ty: string): Normalizable<T> {
  const no = (): never => unported(`rustc_trait_selection::traits::query::type_op::normalize::<${ty} as Normalizable>`);
  return { visit_with: no, try_fold_with: no, fold_with: no, type_op_method: no };
}

// normalize.rs:40/:41 (stub)
export const Normalizable_Ty: Normalizable<import("../../../../rustc_middle/ty/decls.ts").Ty> = normalizable_stub("Ty");
// normalize.rs:49/:50 (stub)
export const Normalizable_Clause: Normalizable<import("../../../../rustc_middle/ty/decls.ts").Clause> = normalizable_stub("Clause");
// normalize.rs:58/:59 (stub)
export const Normalizable_PolyFnSig: Normalizable<import("../../../../rustc_type_ir/decls.ts").PolyFnSig> = normalizable_stub("PolyFnSig");
// normalize.rs:67/:68 (stub)
export const Normalizable_FnSig: Normalizable<import("../../../../rustc_type_ir/ty_kind.ts").FnSig> = normalizable_stub("FnSig");
// normalize.rs:78/:79 (stub)
export const Normalizable_PolyTypeOutlivesClause: Normalizable<import("../../../../rustc_middle/ty/predicate.ts").PolyTypeOutlivesClause> =
  normalizable_stub("PolyTypeOutlivesClause");
