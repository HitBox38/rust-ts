// Port of compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs (lane old-query-typeops, wave 18b).
//
// Contract (lane selcx-contract). PORT (D4):
// - `trait TypeOp<'tcx>` (implemented by `ParamEnvAnd<Q: QueryTypeOp>` and `CustomTypeOp<F>`) is the descriptor
//   `TypeOp<Op, Output, ErrorInfo>` over the value type `Op` (`fully_perform` takes `self` first).
// - `TypeOpOutput<'tcx, Op>` (codegen `hand`) is generic over `Op::Output` / `Op::ErrorInfo`.
// - `trait QueryTypeOp<'tcx>` is the descriptor `QueryTypeOp<Q, QR>` over `Self = Q` with `QueryResponse = QR`; the
//   impls are `QueryTypeOp_<Q>` objects in the files that hold them (ascribe_user_type.ts, normalize.ts (a function of
//   `T: Normalizable`), outlives.ts, prove_predicate.ts, ../../implied_outlives_bounds.ts). The provided
//   `fully_perform_into` is `QueryTypeOp_provided.fully_perform_into(d_Q, ..)`.
// - `impl TypeOp for ParamEnvAnd<Q>` is `TypeOp_ParamEnvAnd(d_Q)`.
// - `()` as a type argument is `null` (`QueryResponse = ()`).
// Fill: replace each stub body with the port and put `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:<line> <name>`
// directly above it (signatures unchanged).
// Init order: top-level code here touches only other crates.

import type { InferCtxt } from "../../../../rustc_infer/decls.ts";
import type { PredicateObligations } from "../../../../rustc_infer/traits/mod.ts";
import type { CanonicalQueryInput, CanonicalQueryResponse, Certainty, QueryRegionConstraints } from "../../../../rustc_middle/infer/canonical.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";

export * from "./mod.gen.ts";

// pub mod ascribe_user_type;
export * as ascribe_user_type from "./ascribe_user_type.ts";
// pub mod custom;
export * as custom from "./custom.ts";
// pub mod normalize;
export * as normalize from "./normalize.ts";
// pub mod outlives;
export * as outlives from "./outlives.ts";
// pub mod prove_predicate;
export * as prove_predicate from "./prove_predicate.ts";

// `pub use rustc_middle::traits::query::type_op::*;`
import type { type_op as middle_type_op } from "../../../../rustc_middle/traits/query.ts";
export type AscribeUserType = middle_type_op.AscribeUserType;
export type Eq = middle_type_op.Eq;
export type Subtype = middle_type_op.Subtype;
export type ProvePredicate = middle_type_op.ProvePredicate;
export type Normalize<T> = middle_type_op.Normalize<T>;
export type ImpliedOutlivesBounds = middle_type_op.ImpliedOutlivesBounds;
export type DropckOutlives = middle_type_op.DropckOutlives;

/// "Type ops" are used in NLL to perform some particular action and
/// extract out the resulting region constraints (or an error if it
/// cannot be completed).
// rustc-trait: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:30 TypeOp
export interface TypeOp<Op, Output, ErrorInfo> {
  /// Processes the operation and all resulting obligations,
  /// returning the final result along with any region constraints
  /// (they will be given over to the NLL region solver).
  // (trait decl) type_op/mod.rs:37 fully_perform
  fully_perform(self: Op, infcx: InferCtxt, root_def_id: LocalDefId, span: Span): Result<TypeOpOutput<Output, ErrorInfo>, ErrorGuaranteed>;
}

/// The output from performing a type op
// rustc-type: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:46 TypeOpOutput
export interface TypeOpOutput<Output, ErrorInfo> {
  /// The output from the type op.
  output: Output;
  /// Any region constraints from performing the type op.
  constraints: QueryRegionConstraints | undefined;
  /// Used for error reporting to be able to rerun the query
  error_info: ErrorInfo | undefined;
}

/// "Query type ops" are type ops that are implemented using a
/// [canonical query][c]. The `Self` type here contains the kernel of
/// information needed to do the operation -- `TypeOp` is actually
/// implemented for `ParamEnvAnd<Self>`, since we always need to bring
/// along a parameter environment as well. For query type-ops, we will
/// first canonicalize the key and then invoke the query on the tcx,
/// which produces the resulting query region constraints.
///
/// [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
// rustc-trait: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:64 QueryTypeOp
export interface QueryTypeOp<Q, QR> {
  /** `Self: TypeFoldable<TyCtxt>` */
  readonly d_Self: TypeFoldable<Q>;
  /** `type QueryResponse: TypeFoldable<TyCtxt>` */
  readonly d_QueryResponse: TypeFoldable<QR>;

  /// Give query the option for a simple fast path that never
  /// actually hits the tcx cache lookup etc. Return `Some(r)` with
  /// a final result or `None` to do the full path.
  // (trait decl) type_op/mod.rs:70 try_fast_path
  try_fast_path(tcx: TyCtxt, key: ParamEnvAnd<Q>): QR | undefined;

  /// Performs the actual query with the canonicalized key -- the
  /// real work happens here. This method is not given an `infcx`
  /// because it shouldn't need one -- and if it had access to one,
  /// it might do things like invoke `sub_regions`, which would be
  /// bad, because it would create subregion relationships that are
  /// not captured in the return value.
  // (trait decl) type_op/mod.rs:81 perform_query
  perform_query(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Q>>): Result<CanonicalQueryResponse<QR>, NoSolution>;
}

/** The provided methods of `QueryTypeOp` (`self` is the descriptor of `Self`). */
export const QueryTypeOp_provided = {
  // type_op/mod.rs:86 (stub)
  fully_perform_into<Q, QR>(
    _d_Q: QueryTypeOp<Q, QR>,
    _query_key: ParamEnvAnd<Q>,
    _infcx: InferCtxt,
    _output_query_region_constraints: QueryRegionConstraints,
    _span: Span,
  ): Result<[QR, CanonicalQueryInput<ParamEnvAnd<Q>> | undefined, PredicateObligations, Certainty], NoSolution> {
    return unported("rustc_trait_selection::traits::query::type_op::QueryTypeOp::fully_perform_into");
  },
};

/** `impl<'tcx, Q: QueryTypeOp<'tcx>> TypeOp<'tcx> for ParamEnvAnd<'tcx, Q>` (type_op/mod.rs:124). */
export function TypeOp_ParamEnvAnd<Q, QR>(_d_Q: QueryTypeOp<Q, QR>): TypeOp<ParamEnvAnd<Q>, QR, CanonicalQueryInput<ParamEnvAnd<Q>>> {
  return {
    // type_op/mod.rs:131 (stub)
    fully_perform(_self, _infcx, _root_def_id, _span) {
      return unported("rustc_trait_selection::traits::query::type_op::<ParamEnvAnd<Q> as TypeOp>::fully_perform");
    },
  };
}
