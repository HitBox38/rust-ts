//! Canonicalization is used to separate some goal from its context,
//! throwing away unnecessary information in the process.
//!
//! This is necessary to cache goals containing inference variables
//! and placeholders without restricting them to the current `InferCtxt`.
//!
//! Canonicalization is fairly involved, for more details see the relevant
//! section of the [rustc-dev-guide][c].
//!
//! [c]: https://rustc-dev-guide.rust-lang.org/solve/canonicalization.html
//
// Contract stub for compiler/rustc_next_trait_solver/src/canonical/mod.rs (lane evalctxt-contract; the file belongs to
// lane nts-canonical). The `ResponseT` trait is final (marker in the interface); its two impls, the free fns and
// `ResponseRelating`'s methods are stubs with final signatures: fill each in place and add the `// rustc:` marker.
// Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `trait ResponseT<I>` is a descriptor over the response type `T` (D4 style): `T: ResponseT<I>` takes `d_T`
// last. Its impls are `ResponseT_Response` and `ResponseT_State` (`impl<I, T> ResponseT<I> for inspect::State<I, T>`,
// one object for every `T`).
// PORT: `ResponseRelating<'infcx, Infcx, I>`: `Infcx: InferCtxtLike` is the `InferCtxtLike` interface. Its
// `TypeRelation::relate` (provided upstream, not overridden) forwards to `TypeRelation_provided`.
// PORT: `orig_values: &mut ThinVec<I::GenericArg>` is pushed to in place.
import type { Span } from "../../rustc_span/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { CanonicalInput, CanonicalVarKinds, GenericArg, GenericArgs, Predicate, Ty } from "../../rustc_middle/ty/decls.ts";
import type { Canonical, CanonicalVarValues } from "../../rustc_type_ir/canonical.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Binder, OpaqueTypeKey, UniverseIndex, Variance } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { InferCtxtLike, TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { type Relate, type RelateResult, type TypeRelation, TypeRelation_provided, type VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import type { CanonicalState, State } from "../../rustc_type_ir/solve/inspect.ts";
import type {
  CanonicalResponse,
  Certainty,
  Goal,
  NestedNormalizationGoals,
  Response,
  VisibleForLeakCheck,
} from "../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { SolverDelegate } from "../delegate.ts";

export * as canonicalizer from "./canonicalizer.ts";

// rustc-trait: compiler/rustc_next_trait_solver/src/canonical/mod.rs:35 ResponseT
export interface ResponseT<T> {
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:36 var_values
  var_values(self: T): GenericArgs;
}

/** `impl<I: Interner> ResponseT<I> for Response<I>` */
export const ResponseT_Response: ResponseT<Response> = {
  var_values(_self: Response): GenericArgs {
    return unported("rustc_next_trait_solver::canonical::ResponseT for Response::var_values");
  },
};

/** `impl<I: Interner, T> ResponseT<I> for inspect::State<I, T>` */
export const ResponseT_State: ResponseT<State<unknown>> = {
  var_values(_self: State<unknown>): GenericArgs {
    return unported("rustc_next_trait_solver::canonical::ResponseT for inspect::State::var_values");
  },
};

/// Canonicalizes the goal remembering the original values
/// for each bound variable.
///
/// This expects `goal` and `opaque_types` to be eager resolved.
export function canonicalize_goal(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _opaque_types: readonly [OpaqueTypeKey, Ty][],
  _typing_mode: TypingMode,
): [GenericArg[], CanonicalInput] {
  return unported("rustc_next_trait_solver::canonical::canonicalize_goal");
}

export function canonicalize_response<T>(
  _delegate: SolverDelegate,
  _max_input_universe: UniverseIndex,
  _value: T,
  _d_T: TypeFoldable<T>,
): Canonical<T> {
  return unported("rustc_next_trait_solver::canonical::canonicalize_response");
}

/// After calling a canonical query, we apply the constraints returned
/// by the query using this function.
///
/// This happens in three steps:
/// - we instantiate the bound variables of the query response
/// - we unify the `var_values` of the response with the `original_values`
/// - we apply the `external_constraints` returned by the query, returning
///   the `normalization_nested_goals`
export function instantiate_and_apply_query_response(
  _delegate: SolverDelegate,
  _original_values: readonly GenericArg[],
  _response: CanonicalResponse,
  _span: Span,
): [NestedNormalizationGoals, Certainty] {
  return unported("rustc_next_trait_solver::canonical::instantiate_and_apply_query_response");
}

/// This returns the canonical variable values to instantiate the bound variables of
/// the canonical response. This depends on the `original_values` for the
/// bound variables.
export function compute_query_response_instantiation_values<T>(
  _delegate: SolverDelegate,
  _original_values: readonly GenericArg[],
  _response: Canonical<T>,
  _span: Span,
  _d_T: ResponseT<T>,
): CanonicalVarValues {
  return unported("rustc_next_trait_solver::canonical::compute_query_response_instantiation_values");
}

export function compute_query_response_instantiation_values_in_universe<T>(
  _delegate: SolverDelegate,
  _original_values: readonly GenericArg[],
  _response: Canonical<T>,
  _span: Span,
  _prev_universe: UniverseIndex,
  _d_T: ResponseT<T>,
): CanonicalVarValues {
  return unported("rustc_next_trait_solver::canonical::compute_query_response_instantiation_values_in_universe");
}

/// Enforce that `a` is equal to `b`.
///
/// In normal type relating, we don't structurally relate non-rigid aliases
/// as they can be normalized to any type. So we emit projection obligations to
/// defer the checks. E.g. in `infcx.eq` or `infcx.relate`.
/// But when unifying query response with original vars, we want to directly
/// set the original vars to values in response.
///
/// Therefore this type relation is created to **always** structurally relate
/// aliases, or more specifically, structurally eq everything.
export class ResponseRelating implements TypeRelation {
  constructor(
    public infcx: InferCtxtLike,
    public span: Span,
  ) {}

  static new(_infcx: InferCtxtLike, _span: Span): ResponseRelating {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::new");
  }

  // ---- impl TypeRelation for ResponseRelating ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::cx");
  }

  relate_ty_args(
    _a_ty: Ty,
    _b_ty: Ty,
    _def_id: DefId,
    _a_args: GenericArgs,
    _b_args: GenericArgs,
    _: (args: GenericArgs) => Ty,
  ): RelateResult<Ty> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::relate_ty_args");
  }

  relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo, _a: T, _b: T, _d: Relate<T>): RelateResult<T> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::relate_with_variance");
  }

  tys(_a: Ty, _b: Ty): RelateResult<Ty> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::tys");
  }

  regions(_a: Region, _b: Region): RelateResult<Region> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::regions");
  }

  consts(_a: Const, _b: Const): RelateResult<Const> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::consts");
  }

  binders<T>(_a: Binder<T>, _b: Binder<T>, _d: Relate<T>): RelateResult<Binder<T>> {
    return unported("rustc_next_trait_solver::canonical::ResponseRelating::binders");
  }

  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }
}

export function unify_query_var_values(
  _delegate: SolverDelegate,
  _original_values: readonly GenericArg[],
  _var_values: GenericArgs,
  _span: Span,
): void {
  return unported("rustc_next_trait_solver::canonical::unify_query_var_values");
}

export function register_region_constraints(
  _delegate: SolverDelegate,
  _constraints: Iterable<[RegionConstraint, VisibleForLeakCheck]>,
  _span: Span,
): void {
  return unported("rustc_next_trait_solver::canonical::register_region_constraints");
}

export function register_new_opaque_types(
  _delegate: SolverDelegate,
  _opaque_types: readonly [OpaqueTypeKey, Ty][],
  _span: Span,
): void {
  return unported("rustc_next_trait_solver::canonical::register_new_opaque_types");
}

/// Used by proof trees to be able to recompute intermediate actions while
/// evaluating a goal. The `var_values` not only include the bound variables
/// of the query input, but also contain all unconstrained inference vars
/// created while evaluating this goal.
export function make_canonical_state<T>(
  _delegate: SolverDelegate,
  _var_values: readonly GenericArg[],
  _max_input_universe: UniverseIndex,
  _data: T,
  _d_T: TypeFoldable<T>,
): CanonicalState<T> {
  return unported("rustc_next_trait_solver::canonical::make_canonical_state");
}

// FIXME: needs to be pub to be accessed by downstream
// `rustc_trait_selection::solve::inspect::analyse`.
export function instantiate_canonical_state<T>(
  _delegate: SolverDelegate,
  _span: Span,
  _prev_universe: UniverseIndex,
  _orig_values: GenericArg[],
  _state: CanonicalState<T>,
  _d_T: TypeFoldable<T>,
): T {
  return unported("rustc_next_trait_solver::canonical::instantiate_canonical_state");
}

export function response_no_constraints_raw(
  _cx: TyCtxt,
  _max_universe: UniverseIndex,
  _var_kinds: CanonicalVarKinds,
  _certainty: Certainty,
): CanonicalResponse {
  return unported("rustc_next_trait_solver::canonical::response_no_constraints_raw");
}
