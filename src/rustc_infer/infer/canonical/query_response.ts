// Port of compiler/rustc_infer/src/infer/canonical/query_response.rs (lane infer-canonical-outlives).
//
//! This module contains the code to instantiate a "query result", and
//! in particular to extract out the resulting region obligations and
//! encode them therein.
//!
//! For an overview of what canonicalization is and how it fits into
//! rustc, check out the [chapter in the rustc dev guide][c].
//!
//! [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
//
// PORT: generic fns take the D4 descriptor of `T` / `R` last (`T: Debug` is not needed: the `debug!` lines are dropped).
// `self.tcx.arena.alloc(x)` is `x`. `PredicateObligations::new()` is `[]`, `extend` is `push(...)`. The `?` on an
// `InferResult` returns the `Err` unchanged.
// PORT: `QueryResponse` has no generated `TypeFoldable` (infcx-contract "For root" 3a): `fold_QueryResponse(d_R)` below is
// the derive written out over the generated field impls. `QueryRegionConstraint`'s generated impls stop UNPORTED
// (its `ty::RegionConstraint` / `ConstraintCategory` fields are not mapped by codegen); this file folds a bare
// `ty::RegionConstraint` with rustc_type_ir's generated impls (`fold_RegionConstraint_` below).
import { try_visit } from "../../../rustc_ast_ir/visit.ts";
import {
  type Canonical,
  type CanonicalVarKind,
  type CanonicalVarValues,
  type Certainty,
  fold_with_QueryRegionConstraint,
  fold_with_QueryRegionConstraints,
  type OriginalQueryValues,
  type QueryRegionConstraint,
  QueryRegionConstraints,
  QueryResponse,
  try_fold_with_QueryRegionConstraint,
  try_fold_with_QueryRegionConstraints,
  visit_with_QueryRegionConstraint,
  visit_with_QueryRegionConstraints,
} from "../../../rustc_middle/infer/canonical.ts";
import type { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import type { ArgOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import { fold_GenericArgs, fold_with_GenericArg, GenericArg, try_fold_with_GenericArg, visit_with_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { fold_with_Ty, Ty, try_fold_with_Ty, visit_with_Ty } from "../../../rustc_middle/ty/mod.ts";
import { debug_GenericArg } from "../../../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { CanonicalVarKind as CanonicalVarKindC, CanonicalVarValues as CanonicalVarValuesC } from "../../../rustc_type_ir/canonical.ts";
import { type FallibleTypeFolder, fold_with_tuple2, fold_with_Vec, type TypeFoldable, type TypeFolder, try_fold_with_tuple2, try_fold_with_Vec } from "../../../rustc_type_ir/fold.ts";
import { BoundVar, UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { fold_with_OpaqueTypeKey, type OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import {
  as_interner,
  fold_with_OutlivesClause,
  fold_with_RegionConstraint,
  RegionConstraint,
  try_fold_with_OutlivesClause,
  try_fold_with_RegionConstraint,
  visit_with_OutlivesClause,
  visit_with_RegionConstraint,
} from "../../../rustc_type_ir/predicate.ts";
import type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { type TypeVisitor, visit_with_tuple2, visit_with_Vec } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { InferCtxt } from "../../decls.ts";
import type { TraitEngine } from "../../traits/engine.ts";
import type { ScrubbedTraitError } from "../../traits/engine.gen.ts";
import type { PredicateObligations } from "../../traits/mod.gen.ts";
import type { InferOk, InferResult, TypeOutlivesConstraint } from "../mod.gen.ts";
import * as at_mod from "../at.ts";
import * as infer_mod from "../mod.ts";
import * as engine_mod from "../../traits/engine.ts";
import type { OpaqueTypeStorageEntries } from "../opaque_types/table.ts";
import type { RegionConstraintData } from "../region_constraints/mod.gen.ts";
import { Canonical_instantiate_projected, instantiate_value } from "./instantiate.ts";

/// This method is meant to be invoked as the final step of a canonical query
/// implementation. It is given:
///
/// - the instantiated variables `inference_vars` created from the query key
/// - the result `answer` of the query
/// - a fulfillment context `fulfill_cx` that may contain various obligations which
///   have yet to be proven.
///
/// Given this, the function will process the obligations pending
/// in `fulfill_cx`:
///
/// - If all the obligations can be proven successfully, it will
///   package up any resulting region obligations (extracted from
///   `infcx`) along with the fully resolved value `answer` into a
///   query result (which is then itself canonicalized).
/// - If some obligations can be neither proven nor disproven, then
///   the same thing happens, but the resulting query is marked as ambiguous.
/// - Finally, if any of the obligations result in a hard error,
///   then `Err(NoSolution)` is returned.
// #[instrument(skip(self, inference_vars, answer, fulfill_cx), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:56 make_canonicalized_query_response
InferCtxt.prototype.make_canonicalized_query_response = function <T>(
  this: InferCtxt,
  inference_vars: CanonicalVarValues,
  answer: T,
  fulfill_cx: TraitEngine<ScrubbedTraitError>,
  d_T: TypeFoldable<T>,
): Result<Canonical<QueryResponse<T>>, NoSolution> {
  const r = this.make_query_response(inference_vars, answer, fulfill_cx, d_T);
  if (r.$ === "Err") return r;
  const query_response = r._0;
  // debug!("query_response = {:#?}", query_response);
  const canonical_result = this.canonicalize_response(query_response, fold_QueryResponse(d_T));
  // debug!("canonical_result = {:#?}", canonical_result);

  return Ok(canonical_result);
};

/// A version of `make_canonicalized_query_response` that does
/// not pack in obligations, for contexts that want to drop
/// pending obligations instead of treating them as an ambiguity (e.g.
/// typeck "probing" contexts).
///
/// If you DO want to keep track of pending obligations (which
/// include all region obligations, so this includes all cases
/// that care about regions) with this function, you have to
/// do it yourself, by e.g., having them be a part of the answer.
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:83 make_query_response_ignoring_pending_obligations
InferCtxt.prototype.make_query_response_ignoring_pending_obligations = function <T>(
  this: InferCtxt,
  inference_vars: CanonicalVarValues,
  answer: T,
  prev_entries: OpaqueTypeStorageEntries,
  d_T: TypeFoldable<T>,
): Canonical<QueryResponse<T>> {
  // While we ignore region constraints and pending obligations,
  // we do return constrained opaque types to avoid unconstrained
  // inference variables in the response. This is important as we want
  // to check that opaques in deref steps stay unconstrained.
  //
  // This doesn't handle the more general case for non-opaques as
  // ambiguous `Projection` obligations have same the issue.
  let opaque_types: [OpaqueTypeKey, Ty][];
  if (this.next_trait_solver()) {
    opaque_types = [];
    for (const [k, v] of this.inner.opaque_type_storage.opaque_types_added_since(prev_entries)) {
      opaque_types.push([k, v.ty]);
    }
  } else {
    opaque_types = [];
  }

  return this.canonicalize_response(
    new QueryResponse<T>(
      inference_vars.var_values,
      QueryRegionConstraints_default(),
      "Proven", // Ambiguities are OK!
      opaque_types,
      answer,
    ),
    fold_QueryResponse(d_T),
  );
};

/// Helper for `make_canonicalized_query_response` that does
/// everything up until the final canonicalization.
// #[instrument(skip(self, fulfill_cx), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:122 make_query_response
InferCtxt.prototype.make_query_response = function <T>(
  this: InferCtxt,
  inference_vars: CanonicalVarValues,
  answer: T,
  fulfill_cx: TraitEngine<ScrubbedTraitError>,
  _d_T: TypeFoldable<T>,
): Result<QueryResponse<T>, NoSolution> {
  // Select everything, returning errors.
  const errors = fulfill_cx.evaluate_obligations_error_on_ambiguity(this);

  let certainty: Certainty;
  switch (errors.$) {
    case "HasErrors": {
      if (errors._0.some((e) => ScrubbedTraitError_is_true_error(e))) {
        // True error!
        return Err(NO_SOLUTION);
      } else {
        certainty = "Ambiguous";
      }
      break;
    }
    case "NoErrors":
      certainty = "Proven";
      break;
  }

  const region_obligations = this.take_registered_region_obligations();
  const region_assumptions = this.take_registered_region_assumptions();
  // debug!(?region_obligations);
  const region_constraints = this.with_region_constraints((region_constraints) =>
    make_query_region_constraints(region_obligations, region_constraints, region_assumptions),
  );
  // debug!(?region_constraints);

  const opaque_types: [OpaqueTypeKey, Ty][] = [];
  for (const [k, v] of this.inner.opaque_type_storage.take_opaque_types()) {
    opaque_types.push([k, v.ty]);
  }

  return Ok(new QueryResponse<T>(inference_vars.var_values, region_constraints, certainty, opaque_types, answer));
};

/// Given the (canonicalized) result to a canonical query,
/// instantiates the result so it can be used, plugging in the
/// values from the canonical query. (Note that the result may
/// have been ambiguous; you should check the certainty level of
/// the query before applying this function.)
///
/// To get a good understanding of what is happening here, check
/// out the [chapter in the rustc dev guide][c].
///
/// [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html#processing-the-canonicalized-query-result
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:185 instantiate_query_response_and_region_obligations
InferCtxt.prototype.instantiate_query_response_and_region_obligations = function <R>(
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  original_values: OriginalQueryValues,
  query_response: Canonical<QueryResponse<R>>,
  d_R: TypeFoldable<R>,
): InferResult<R> {
  const r = this.query_response_instantiation(cause, param_env, original_values, query_response, d_R);
  if (r.$ === "Err") return r;
  const { value: result_args, obligations } = r._0;

  for (const { constraint, visible_for_leak_check: vis } of query_response.value.region_constraints.constraints) {
    const constraint_ = instantiate_value(this.tcx, result_args, constraint as RegionConstraint, fold_RegionConstraint_);
    switch (constraint_.$) {
      case "Outlives": {
        const clause = constraint_._0;
        this.register_outlives_constraint(clause, vis, cause);
        break;
      }
      case "Eq": {
        const clause = constraint_._0;
        this.register_region_eq_constraint(clause, vis, cause);
        break;
      }
    }
  }

  for (const assumption of query_response.value.region_constraints.assumptions) {
    const assumption_ = instantiate_value(this.tcx, result_args, assumption, fold_ArgOutlivesClause);
    this.register_region_assumption(assumption_);
  }

  const user_result: R = Canonical_instantiate_projected(query_response, this.tcx, result_args, (q_r) => q_r.value, d_R);

  return Ok(InferOk_(user_result, obligations));
};

/// An alternative to
/// `instantiate_query_response_and_region_obligations` that is more
/// efficient for NLL. NLL is a bit more advanced in the
/// "transition to chalk" than the rest of the compiler. During
/// the NLL type check, all of the "processing" of types and
/// things happens in queries -- the NLL checker itself is only
/// interested in the region obligations (`'a: 'b` or `T: 'b`)
/// that come out of these queries, which it wants to convert into
/// MIR-based constraints and solve. Therefore, it is most
/// convenient for the NLL Type Checker to **directly consume**
/// the `QueryOutlivesConstraint` values that arise from doing a
/// query. This is contrast to other parts of the compiler, which
/// would prefer for those `QueryOutlivesConstraint` to be converted
/// into the older infcx-style constraints (e.g., calls to
/// `sub_regions` or `register_region_obligation`).
///
/// Therefore, `instantiate_nll_query_response_and_region_obligations` performs the same
/// basic operations as `instantiate_query_response_and_region_obligations` but
/// it returns its result differently:
///
/// - It creates an instantiation `S` that maps from the original
///   query variables to the values computed in the query
///   result. If any errors arise, they are propagated back as an
///   `Err` result.
/// - In the case of a successful instantiation, we will append
///   `QueryOutlivesConstraint` values onto the
///   `output_query_region_constraints` vector for the solver to
///   use (if an error arises, some values may also be pushed, but
///   they should be ignored).
/// - It **can happen** (though it rarely does currently) that
///   equating types and things will give rise to subobligations
///   that must be processed. In this case, those subobligations
///   are propagated back in the return value.
/// - Finally, the query result (of type `R`) is propagated back,
///   after applying the instantiation `S`.
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:258 instantiate_nll_query_response_and_region_obligations
InferCtxt.prototype.instantiate_nll_query_response_and_region_obligations = function <R>(
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  original_values: OriginalQueryValues,
  query_response: Canonical<QueryResponse<R>>,
  output_query_region_constraints: QueryRegionConstraints,
  d_R: TypeFoldable<R>,
): InferResult<R> {
  const r = this.query_response_instantiation_guess(cause, param_env, original_values, query_response, d_R);
  if (r.$ === "Err") return r;
  const { value: result_args, obligations } = r._0;

  // Compute `QueryOutlivesConstraint` values that unify each of
  // the original values `v_o` that was canonicalized into a
  // variable...

  const constraint_category = cause.to_constraint_category();

  for (let index = 0; index < original_values.var_values.length; index++) {
    const original_value = original_values.var_values[index]!;
    // ...with the value `v_r` of that variable from the query.
    const result_value = Canonical_instantiate_projected(query_response, this.tcx, result_args, (v) => v.var_values[index]!, fold_GenericArg_);
    const ok = GenericArg.kind(original_value);
    const rk = GenericArg.kind(result_value);
    if (ok.$ === "Lifetime" && rk.$ === "Lifetime" && ok._0.is_erased() && rk._0.is_erased()) {
      // No action needed.
    } else if (ok.$ === "Lifetime" && rk.$ === "Lifetime") {
      const v_o = ok._0;
      const v_r = rk._0;
      if (v_o !== v_r) {
        const constraint: QueryRegionConstraint = {
          constraint: RegionConstraint.from_RegionEqPredicate({ _0: v_o, _1: v_r }),
          category: constraint_category,
          visible_for_leak_check: "Yes",
        };
        output_query_region_constraints.constraints.push(constraint);
      }
    } else if (ok.$ === "Type" && rk.$ === "Type") {
      const e = this.at(cause, param_env).eq("Yes", ok._0, rk._0, ToTrace_Ty_());
      if (e.$ === "Err") return e;
      obligations.push(...e._0.into_obligations());
    } else if (ok.$ === "Const" && rk.$ === "Const") {
      const e = this.at(cause, param_env).eq("Yes", ok._0, rk._0, ToTrace_Const_());
      if (e.$ === "Err") return e;
      obligations.push(...e._0.into_obligations());
    } else {
      bug(`kind mismatch, cannot unify ${debug_GenericArg(original_value, PLAIN)} and ${debug_GenericArg(result_value, PLAIN)}`);
    }
  }

  // ...also include the other query region constraints from the query.
  for (const r_c0 of query_response.value.region_constraints.constraints) {
    const r_c = instantiate_value(this.tcx, result_args, r_c0, fold_QueryRegionConstraint_);

    // Screen out `'a: 'a` or `'a == 'a` cases.
    if (!RegionConstraint.is_trivial(r_c.constraint as RegionConstraint)) {
      output_query_region_constraints.constraints.push(r_c);
    }
  }

  // FIXME(higher_ranked_auto): Optimize this to instantiate all assumptions
  // at once, rather than calling `instantiate_value` repeatedly which may
  // create more universes.
  for (const r_c of query_response.value.region_constraints.assumptions) {
    output_query_region_constraints.assumptions.push(instantiate_value(this.tcx, result_args, r_c, fold_ArgOutlivesClause));
  }

  const user_result: R = Canonical_instantiate_projected(query_response, this.tcx, result_args, (q_r) => q_r.value, d_R);

  return Ok(InferOk_(user_result, obligations));
};

/// Given the original values and the (canonicalized) result from
/// computing a query, returns an instantiation that can be applied
/// to the query result to convert the result back into the
/// original namespace.
///
/// The instantiation also comes accompanied with subobligations
/// that arose from unification; these might occur if (for
/// example) we are doing lazy normalization and the value
/// assigned to a type variable is unified with an unnormalized
/// projection.
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:365 query_response_instantiation
InferCtxt.prototype.query_response_instantiation = function <R>(
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  original_values: OriginalQueryValues,
  query_response: Canonical<QueryResponse<R>>,
  d_R: TypeFoldable<R>,
): InferResult<CanonicalVarValues> {
  // debug!("query_response_instantiation(original_values={:#?}, query_response={:#?})", original_values, query_response);

  const r = this.query_response_instantiation_guess(cause, param_env, original_values, query_response, d_R);
  if (r.$ === "Err") return r;
  const value = r._0;

  const u = this.unify_query_response_instantiation_guess(cause, param_env, original_values, value.value, query_response, d_R);
  if (u.$ === "Err") return u;
  value.obligations.push(...u._0.into_obligations());

  return Ok(value);
};

/// Given the original values and the (canonicalized) result from
/// computing a query, returns a **guess** at an instantiation that
/// can be applied to the query result to convert the result back
/// into the original namespace. This is called a **guess**
/// because it uses a quick heuristic to find the values for each
/// canonical variable; if that quick heuristic fails, then we
/// will instantiate fresh inference variables for each canonical
/// variable instead. Therefore, the result of this method must be
/// properly unified
// #[instrument(level = "debug", skip(self, param_env))]
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:411 query_response_instantiation_guess
InferCtxt.prototype.query_response_instantiation_guess = function <R>(
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  original_values: OriginalQueryValues,
  query_response: Canonical<QueryResponse<R>>,
  _d_R: TypeFoldable<R>,
): InferResult<CanonicalVarValues> {
  // For each new universe created in the query result that did
  // not appear in the original query, create a local
  // superuniverse.
  const universe_map = [...original_values.universe_map];
  const num_universes_in_query = original_values.universe_map.length;
  const num_universes_in_response = UniverseIndex.as_usize(query_response.max_universe) + 1;
  for (let i = num_universes_in_query; i < num_universes_in_response; i++) {
    universe_map.push(this.create_next_universe());
  }
  assert(universe_map.length !== 0, "assertion failed: !universe_map.is_empty()"); // always have the root universe
  assert_eq(universe_map[UniverseIndex.as_usize(UniverseIndex.ROOT)]!, UniverseIndex.ROOT, (u) => UniverseIndex.debug(u, PLAIN));

  // Every canonical query result includes values for each of
  // the inputs to the query. Therefore, we begin by unifying
  // these values with the original inputs that were
  // canonicalized.
  const result_values = query_response.value.var_values;
  assert_eq(original_values.var_values.length, result_values.length, String);

  // Quickly try to find initial values for the canonical
  // variables in the result in terms of the query. We do this
  // by iterating down the values that the query gave to each of
  // the canonical inputs. If we find that one of those values
  // is directly equal to one of the canonical variables in the
  // result, then we can type the corresponding value from the
  // input. See the example above.
  const opt_values: (GenericArg | undefined)[] = new Array<GenericArg | undefined>(query_response.var_kinds.length).fill(undefined);

  // PORT: `iter::zip` stops at the shorter side; the lengths are equal (asserted above).
  for (let i = 0; i < original_values.var_values.length && i < result_values.length; i++) {
    const original_value = original_values.var_values[i]!;
    const result_value = result_values[i]!;
    const rk = GenericArg.kind(result_value);
    switch (rk.$) {
      case "Type": {
        const result_value = rk._0;
        // We disable the instantiation guess for inference variables
        // and only use it for placeholders. We need to handle the
        // `sub_root` of type inference variables which would make this
        // more involved. They are also a lot rarer than region variables.
        const tk = result_value.kind();
        if (tk.$ === "Bound" && index_slice(query_response.var_kinds, BoundVar.as_usize(tk._1.var)).$ !== "Ty") {
          const index_kind = tk._0;
          const b = tk._1;
          // We only allow a `Canonical` index in generic parameters.
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, BoundVar.as_usize(b.var), original_value);
        }
        break;
      }
      case "Lifetime": {
        const result_value = rk._0;
        const k = result_value.kind();
        if (k.$ === "ReBound") {
          const index_kind = k._0;
          const b = k._1;
          // We only allow a `Canonical` index in generic parameters.
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, BoundVar.as_usize(b.var), original_value);
        }
        break;
      }
      case "Const": {
        const result_value = rk._0;
        const k = result_value.kind();
        if (k.$ === "Bound") {
          const index_kind = k._0;
          const b = k._1;
          // We only allow a `Canonical` index in generic parameters.
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, BoundVar.as_usize(b.var), original_value);
        }
        break;
      }
    }
  }

  // Create result arguments: if we found a value for a
  // given variable in the loop above, use that. Otherwise, use
  // a fresh inference variable.
  const tcx = this.tcx;
  const var_kinds = query_response.var_kinds;
  const universe_at = (u: UniverseIndex): UniverseIndex => index_slice(universe_map, UniverseIndex.as_usize(u));
  const var_values = CanonicalVarValuesC.instantiate(as_interner(tcx), var_kinds, (var_values, kind: CanonicalVarKind) => {
    if (CanonicalVarKindC.universe(kind) !== UniverseIndex.ROOT) {
      // A variable from inside a binder of the query. While ideally these shouldn't
      // exist at all, we have to deal with them for now.
      return this.instantiate_canonical_var(cause.span, kind, var_values, universe_at);
    } else if (CanonicalVarKindC.is_existential(kind)) {
      const k = index_slice(opt_values, BoundVar.as_usize(BoundVar.new(var_values.length)));
      if (k !== undefined) {
        return k;
      } else {
        return this.instantiate_canonical_var(cause.span, kind, var_values, universe_at);
      }
    } else {
      // For placeholders which were already part of the input, we simply map this
      // universal bound variable back the placeholder of the input.
      return unwrap(index_slice(opt_values, BoundVar.as_usize(BoundVar.new(var_values.length))), "expected placeholder to be unified with itself during response");
    }
  });

  const obligations: PredicateObligations = [];

  // Carry all newly resolved opaque types to the caller's scope
  for (const [a0, b0] of query_response.value.opaque_types) {
    const a = instantiate_value(this.tcx, var_values, a0, fold_OpaqueTypeKey_);
    const b = instantiate_value(this.tcx, var_values, b0, fold_Ty_);
    // debug!(?a, ?b, "constrain opaque type");
    // We use equate here instead of, for example, just registering the
    // opaque type's hidden value directly, because the hidden type may have been an inference
    // variable that got constrained to the opaque type itself. In that case we want to equate
    // the generic args of the opaque with the generic params of its hidden type version.
    const e = this.at(cause, param_env).eq("Yes", Ty.new_opaque(this.tcx, "No", LocalDefId.to_def_id(a.def_id), a.args), b, ToTrace_Ty_());
    if (e.$ === "Err") return e;
    obligations.push(...e._0.obligations);
  }

  return Ok(InferOk_(var_values, obligations));
};

/// Given a "guess" at the values for the canonical variables in
/// the input, try to unify with the *actual* values found in the
/// query result. Often, but not always, this is a no-op, because
/// we already found the mapping in the "guessing" step.
///
/// See also: [`Self::query_response_instantiation_guess`]
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:544 unify_query_response_instantiation_guess
InferCtxt.prototype.unify_query_response_instantiation_guess = function <R>(
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  original_values: OriginalQueryValues,
  result_args: CanonicalVarValues,
  query_response: Canonical<QueryResponse<R>>,
  _d_R: TypeFoldable<R>,
): InferResult<null> {
  // A closure that yields the result value for the given
  // canonical variable; this is taken from
  // `query_response.var_values` after applying the instantiation
  // by `result_args`.
  const instantiated_query_response = (index: number): GenericArg =>
    Canonical_instantiate_projected(query_response, this.tcx, result_args, (v) => v.var_values[index]!, fold_GenericArg_);

  // Unify the original value for each variable with the value
  // taken from `query_response` (after applying `result_args`).
  return this.unify_canonical_vars(cause, param_env, original_values, instantiated_query_response);
};

/// Given two sets of values for the same set of canonical variables, unify them.
/// The second set is produced lazily by supplying indices from the first set.
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:570 unify_canonical_vars
InferCtxt.prototype.unify_canonical_vars = function (
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  variables1: OriginalQueryValues,
  variables2: (_1: number) => GenericArg,
): InferResult<null> {
  const obligations: PredicateObligations = [];
  for (let index = 0; index < variables1.var_values.length; index++) {
    const value1 = variables1.var_values[index]!;
    const value2 = variables2(index);

    const k1 = GenericArg.kind(value1);
    const k2 = GenericArg.kind(value2);
    if (k1.$ === "Type" && k2.$ === "Type") {
      const e = this.at(cause, param_env).eq("Yes", k1._0, k2._0, ToTrace_Ty_());
      if (e.$ === "Err") return e;
      obligations.push(...e._0.into_obligations());
    } else if (k1.$ === "Lifetime" && k2.$ === "Lifetime" && k1._0.is_erased() && k2._0.is_erased()) {
      // no action needed
    } else if (k1.$ === "Lifetime" && k2.$ === "Lifetime") {
      this.inner.unwrap_region_constraints().make_eqregion({ $: "RelateRegionParamBound", _0: cause.span, _1: undefined }, k1._0, k2._0, "Yes");
    } else if (k1.$ === "Const" && k2.$ === "Const") {
      const ok = this.at(cause, param_env).eq("Yes", k1._0, k2._0, ToTrace_Const_());
      if (ok.$ === "Err") return ok;
      obligations.push(...ok._0.into_obligations());
    } else {
      bug(`kind mismatch, cannot unify ${debug_GenericArg(value1, PLAIN)} and ${debug_GenericArg(value2, PLAIN)}`);
    }
  }
  return Ok(InferOk_(null, obligations));
};

/// Given the region obligations and constraints scraped from the infcx,
/// creates query region constraints.
// rustc: compiler/rustc_infer/src/infer/canonical/query_response.rs:617 make_query_region_constraints
export function make_query_region_constraints(
  outlives_obligations: TypeOutlivesConstraint[],
  region_constraints: RegionConstraintData,
  assumptions: ArgOutlivesClause[],
): QueryRegionConstraints {
  const { constraints, verifys } = region_constraints;

  assert(verifys.length === 0, "assertion failed: verifys.is_empty()");

  // debug!(?constraints);

  const constraints_: QueryRegionConstraint[] = [];
  for (const [c, origin] of constraints) {
    switch (c.kind) {
      case "VarSubVar":
      case "RegSubVar":
      case "VarSubReg":
      case "RegSubReg": {
        // Swap regions because we are going from sub (<=) to outlives (>=).
        const constraint = RegionConstraint.from_OutlivesClause({ _0: c.sup, _1: c.sub });
        constraints_.push({
          constraint,
          category: SubregionOrigin_().to_constraint_category(origin),
          visible_for_leak_check: c.visible_for_leak_check,
        });
        break;
      }

      case "VarEqVar":
      case "VarEqReg":
      case "RegEqReg": {
        const constraint = RegionConstraint.from_RegionEqPredicate({ _0: c.sup, _1: c.sub });
        constraints_.push({
          constraint,
          category: SubregionOrigin_().to_constraint_category(origin),
          visible_for_leak_check: c.visible_for_leak_check,
        });
        break;
      }
    }
  }
  for (const { sub_region, sup_type, origin } of outlives_obligations) {
    constraints_.push({
      constraint: RegionConstraint.from_OutlivesClause({ _0: sup_type, _1: sub_region }),
      category: SubregionOrigin_().to_constraint_category(origin),
      // We don't do leak checks for type outlives
      visible_for_leak_check: "Unreachable",
    });
  }

  return new QueryRegionConstraints(constraints_, assumptions);
}

// ---- helpers --------------------------------------------------------------------------------------------------------

/** `QueryRegionConstraints::default()` (`#[derive(Default)]`). */
function QueryRegionConstraints_default(): QueryRegionConstraints {
  return new QueryRegionConstraints([], []);
}

/** `slice[i]` (core's bounds-check panic). */
function index_slice<T>(slice: readonly T[], i: number): T {
  if (i >= slice.length) {
    return panic_oob(slice.length, i);
  }
  return slice[i]!;
}

/** `slice[i] = v` (core's bounds-check panic). */
function index_set<T>(slice: T[], i: number, v: T): void {
  if (i >= slice.length) {
    panic_oob(slice.length, i);
  }
  slice[i] = v;
}

function panic_oob(len: number, i: number): never {
  return panic(`index out of bounds: the len is ${len} but the index is ${i}`);
}

// Module-local accessors of other rustc_infer modules, read inside function bodies only (init order, infcx-contract
// "How to fill a stub" 6).
const SubregionOrigin_ = () => infer_mod.SubregionOrigin;
const ToTrace_Ty_ = () => at_mod.ToTrace_Ty;
const ToTrace_Const_ = () => at_mod.ToTrace_Const;
function ScrubbedTraitError_is_true_error(e: ScrubbedTraitError): boolean {
  return engine_mod.ScrubbedTraitError.is_true_error(e);
}
/** `InferOk { value, obligations }` */
function InferOk_<T>(value: T, obligations: PredicateObligations): InferOk<T> {
  return new infer_mod.InferOk(value, obligations);
}

/** `NoSolution` (a unit struct). */
const NO_SOLUTION: NoSolution = Object.freeze({});

// ---- D4 descriptors -------------------------------------------------------------------------------------------------

/** `ty::RegionConstraint` (rustc_type_ir predicate.rs, generated impls). */
const fold_RegionConstraint_: TypeFoldable<RegionConstraint> = {
  visit_with: visit_with_RegionConstraint,
  try_fold_with: try_fold_with_RegionConstraint,
  fold_with: fold_with_RegionConstraint,
};

/** `ty::ArgOutlivesClause` (`OutlivesClause<GenericArg>`). */
const fold_ArgOutlivesClause: TypeFoldable<ArgOutlivesClause> = {
  visit_with: <R>(s: ArgOutlivesClause, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, visit_with_GenericArg),
  try_fold_with: <E>(s: ArgOutlivesClause, f: FallibleTypeFolder<E>): Result<ArgOutlivesClause, E> => try_fold_with_OutlivesClause(s, f, try_fold_with_GenericArg),
  fold_with: (s: ArgOutlivesClause, f: TypeFolder): ArgOutlivesClause => fold_with_OutlivesClause(s, f, fold_with_GenericArg),
};

/** `QueryRegionConstraint` (rustc_middle infer/canonical.rs, generated impls). */
const fold_QueryRegionConstraint_: TypeFoldable<QueryRegionConstraint> = {
  visit_with: visit_with_QueryRegionConstraint,
  try_fold_with: try_fold_with_QueryRegionConstraint,
  fold_with: fold_with_QueryRegionConstraint,
};

const fold_GenericArg_: TypeFoldable<GenericArg> = {
  visit_with: visit_with_GenericArg,
  try_fold_with: try_fold_with_GenericArg,
  fold_with: fold_with_GenericArg,
};

const fold_Ty_: TypeFoldable<Ty> = { visit_with: visit_with_Ty, try_fold_with: try_fold_with_Ty, fold_with: fold_with_Ty };

const fold_OpaqueTypeKey_: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};

/**
 * `#[derive(TypeFoldable, TypeVisitable)]` of `QueryResponse<R>` (rustc_middle infer/canonical.rs:71), fields in
 * declaration order: `var_values`, `region_constraints`, `certainty` (trivial), `opaque_types`, `value`.
 */
export function fold_QueryResponse<R>(d_R: TypeFoldable<R>): TypeFoldable<QueryResponse<R>> {
  const visit_opaque = <V>(x: readonly [OpaqueTypeKey, Ty], v: TypeVisitor<V>): V => visit_with_tuple2(x, v, visit_with_OpaqueTypeKey, visit_with_Ty);
  return {
    visit_with<V>(self: QueryResponse<R>, visitor: TypeVisitor<V>): V {
      let r: V | undefined;
      if ((r = try_visit(visitor.Result, fold_GenericArgs.visit_with(self.var_values, visitor))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visit_with_QueryRegionConstraints(self.region_constraints, visitor))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visit_with_Vec(self.opaque_types, visitor, visit_opaque))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, d_R.visit_with(self.value, visitor))) !== undefined) return r;
      return visitor.Result.output();
    },
    try_fold_with<E>(self: QueryResponse<R>, folder: FallibleTypeFolder<E>): Result<QueryResponse<R>, E> {
      const var_values = fold_GenericArgs.try_fold_with(self.var_values, folder);
      if (var_values.$ === "Err") return var_values;
      const region_constraints = try_fold_with_QueryRegionConstraints(self.region_constraints, folder);
      if (region_constraints.$ === "Err") return region_constraints;
      const opaque_types = try_fold_with_Vec(self.opaque_types, folder, <E2>(x: [OpaqueTypeKey, Ty], f: FallibleTypeFolder<E2>) =>
        try_fold_with_tuple2(x, f, try_fold_with_OpaqueTypeKey, try_fold_with_Ty),
      );
      if (opaque_types.$ === "Err") return opaque_types;
      const value = d_R.try_fold_with(self.value, folder);
      if (value.$ === "Err") return value;
      return Ok(new QueryResponse<R>(var_values._0, region_constraints._0, self.certainty, opaque_types._0, value._0));
    },
    fold_with(self: QueryResponse<R>, folder: TypeFolder): QueryResponse<R> {
      return new QueryResponse<R>(
        fold_GenericArgs.fold_with(self.var_values, folder),
        fold_with_QueryRegionConstraints(self.region_constraints, folder),
        self.certainty,
        fold_with_Vec(self.opaque_types, folder, (x: [OpaqueTypeKey, Ty], f: TypeFolder) => fold_with_tuple2(x, f, fold_with_OpaqueTypeKey, fold_with_Ty)),
        d_R.fold_with(self.value, folder),
      );
    },
  };
}
