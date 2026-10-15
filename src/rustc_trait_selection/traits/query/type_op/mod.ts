// Port of compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs (lane old-query-typeops, wave 18c).
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
// - `TypeOpOutput.constraints: Option<&'tcx QueryRegionConstraints>` is the value itself (`tcx.arena.alloc(x)` is `x`).
// Init order: top-level code here touches only other crates.

import type { InferCtxt } from "../../../../rustc_infer/decls.ts";
import type { PredicateObligations } from "../../../../rustc_infer/traits/mod.ts";
import type { CanonicalQueryInput, CanonicalQueryResponse, Certainty } from "../../../../rustc_middle/infer/canonical.ts";
import { clone_QueryRegionConstraint, OriginalQueryValues, QueryRegionConstraints } from "../../../../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { ParamEnvAnd } from "../../../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { scrape_region_constraints } from "./custom.ts";

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
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:37 fully_perform
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
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:70 try_fast_path
  try_fast_path(tcx: TyCtxt, key: ParamEnvAnd<Q>): QR | undefined;

  /// Performs the actual query with the canonicalized key -- the
  /// real work happens here. This method is not given an `infcx`
  /// because it shouldn't need one -- and if it had access to one,
  /// it might do things like invoke `sub_regions`, which would be
  /// bad, because it would create subregion relationships that are
  /// not captured in the return value.
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:81 perform_query
  perform_query(tcx: TyCtxt, canonicalized: CanonicalQueryInput<ParamEnvAnd<Q>>): Result<CanonicalQueryResponse<QR>, NoSolution>;
}

/** The `Ok` value of `fully_perform_into`. */
type FullyPerformIntoOutput<Q, QR> = [QR, CanonicalQueryInput<ParamEnvAnd<Q>> | undefined, PredicateObligations, Certainty];

/** The provided methods of `QueryTypeOp` (`self` is the descriptor of `Self`). */
export const QueryTypeOp_provided = {
  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:86 fully_perform_into
  fully_perform_into<Q, QR>(
    d_Q: QueryTypeOp<Q, QR>,
    query_key: ParamEnvAnd<Q>,
    infcx: InferCtxt,
    output_query_region_constraints: QueryRegionConstraints,
    span: Span,
  ): Result<FullyPerformIntoOutput<Q, QR>, NoSolution> {
    if (!infcx.disable_trait_solver_fast_paths()) {
      const result = d_Q.try_fast_path(infcx.tcx, query_key);
      if (result !== undefined) {
        const out: FullyPerformIntoOutput<Q, QR> = [result, undefined, [], "Proven"];
        return Ok(out);
      }
    }

    const canonical_var_values = OriginalQueryValues.default_();
    const old_param_env = query_key.param_env;
    const canonical_self = infcx.canonicalize_query(query_key, canonical_var_values, d_Q.d_Self);
    const r = d_Q.perform_query(infcx.tcx, canonical_self);
    if (r.$ === "Err") return r;
    const canonical_result = r._0;

    const ok = infcx.instantiate_nll_query_response_and_region_obligations(
      ObligationCause.dummy_with_span(span),
      old_param_env,
      canonical_var_values,
      canonical_result,
      output_query_region_constraints,
      d_Q.d_QueryResponse,
    );
    // PORT: `?` converts the `TypeError` with `impl From<TypeError> for NoSolution`.
    if (ok.$ === "Err") return Err(NO_SOLUTION);
    const { value, obligations } = ok._0;

    const out: FullyPerformIntoOutput<Q, QR> = [value, canonical_self, obligations, canonical_result.value.certainty];
    return Ok(out);
  },
};

/** `impl<'tcx, Q: QueryTypeOp<'tcx>> TypeOp<'tcx> for ParamEnvAnd<'tcx, Q>` (type_op/mod.rs:124). */
export function TypeOp_ParamEnvAnd<Q, QR>(d_Q: QueryTypeOp<Q, QR>): TypeOp<ParamEnvAnd<Q>, QR, CanonicalQueryInput<ParamEnvAnd<Q>>> {
  return {
    // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/mod.rs:131 fully_perform
    fully_perform(self, infcx, root_def_id, span) {
      let error_info: CanonicalQueryInput<ParamEnvAnd<Q>> | undefined = undefined;
      const region_constraints = new QueryRegionConstraints([], []);

      // HACK(type_alias_impl_trait): When moving an opaque type to hidden type mapping from the query to the current inferctxt,
      // we sometimes end up with `Opaque<'a> = Opaque<'b>` instead of an actual hidden type. In that case we don't register a
      // hidden type but just equate the lifetimes. Thus we need to scrape the region constraints even though we're also manually
      // collecting region constraints via `region_constraints`.
      const r = scrape_region_constraints<QR, CanonicalQueryInput<ParamEnvAnd<Q>>>(
        infcx,
        root_def_id,
        "fully_perform",
        span,
        (ocx) => {
          const rr = QueryTypeOp_provided.fully_perform_into(d_Q, self, infcx, region_constraints, span);
          if (rr.$ === "Err") return rr;
          const [output, ei, obligations] = rr._0;
          error_info = ei;

          ocx.register_obligations(obligations);
          return Ok(output);
        },
        d_Q.d_QueryResponse,
      );
      if (r.$ === "Err") return r;
      const [output] = r._0;
      output.error_info = error_info;
      if (output.constraints !== undefined) {
        const { constraints, assumptions } = output.constraints;
        region_constraints.constraints.push(...constraints.map(clone_QueryRegionConstraint));
        region_constraints.assumptions.push(...assumptions);
      }
      // PORT: `infcx.tcx.arena.alloc(x)` is `x`.
      output.constraints = region_constraints.is_empty() ? undefined : region_constraints;
      return Ok(output);
    },
  };
}

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;
