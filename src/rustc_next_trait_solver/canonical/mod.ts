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
import type { DefId } from "../../rustc_span/def_id.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { CanonicalInput, CanonicalVarKinds } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import { fold_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import { ExternalConstraints_deref } from "../../rustc_middle/traits/solve.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { type Canonical, CanonicalVarKind, CanonicalVarValues } from "../../rustc_type_ir/canonical.ts";
import type { OpaqueTypeKey, Variance } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { InferCtxtLike, TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { BoundVar, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { InferTy } from "../../rustc_type_ir/ty_kind.ts";
import { as_interner, type RegionConstraint } from "../../rustc_type_ir/predicate.ts";
import { Assumptions } from "../../rustc_type_ir/region_constraint.ts";
import {
  type Relate,
  relate_args_invariantly,
  relate_GenericArg,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../../rustc_type_ir/relate.ts";
import { type CanonicalState, fold_with_State, type State, try_fold_with_State, visit_with_State } from "../../rustc_type_ir/solve/inspect.ts";
import {
  type CanonicalResponse,
  type Certainty,
  ExternalConstraintsData,
  fold_with_Response,
  type Goal,
  type NestedNormalizationGoals,
  type Response,
  try_fold_with_Response,
  VisibleForLeakCheck,
  visit_with_Response,
} from "../../rustc_type_ir/solve/mod.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { debug_TypeError } from "../../rustc_type_ir/error.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import { slice_from } from "../../std/slice.ts";
import { Ok, unwrap_result } from "../../std/result.ts";
import { debug_GenericArg } from "../../rustc_middle/ty/structural_impls.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { SolverDelegate } from "../delegate.ts";
import { Canonicalizer } from "./canonicalizer.ts";

export * as canonicalizer from "./canonicalizer.ts";

// rustc-trait: compiler/rustc_next_trait_solver/src/canonical/mod.rs:35 ResponseT
export interface ResponseT<T> {
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:36 var_values
  var_values(self: T): GenericArgs;
}

/** `impl<I: Interner> ResponseT<I> for Response<I>` */
export const ResponseT_Response: ResponseT<Response> = {
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:40 var_values
  var_values(self: Response): GenericArgs {
    return self.var_values;
  },
};

/** `impl<I: Interner, T> ResponseT<I> for inspect::State<I, T>` */
export const ResponseT_State: ResponseT<State<unknown>> = {
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:46 var_values
  var_values(self: State<unknown>): GenericArgs {
    return self.var_values;
  },
};

/// Canonicalizes the goal remembering the original values
/// for each bound variable.
///
/// This expects `goal` and `opaque_types` to be eager resolved.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:55 canonicalize_goal
export function canonicalize_goal(
  delegate: SolverDelegate,
  goal: Goal<Predicate>,
  opaque_types: readonly [OpaqueTypeKey, Ty][],
  typing_mode: TypingMode,
): [GenericArg[], CanonicalInput] {
  const [orig_values, canonical] = Canonicalizer.canonicalize_input(
    delegate,
    {
      goal,
      predefined_opaques_in_body: delegate.cx().mk_predefined_opaques_in_body(opaque_types),
    },
    fold_Predicate,
  );

  const query_input = delegate.cx().mk_canonical_input({
    canonical,
    typing_mode: { _0: typing_mode },
  });
  return [orig_values, query_input];
}

// PORT: D4 descriptor `d_T`.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:80 canonicalize_response
export function canonicalize_response<T>(
  delegate: SolverDelegate,
  max_input_universe: UniverseIndex,
  value: T,
  d_T: TypeFoldable<T>,
): Canonical<T> {
  return Canonicalizer.canonicalize_response(delegate, max_input_universe, value, d_T);
}

/// After calling a canonical query, we apply the constraints returned
/// by the query using this function.
///
/// This happens in three steps:
/// - we instantiate the bound variables of the query response
/// - we unify the `var_values` of the response with the `original_values`
/// - we apply the `external_constraints` returned by the query, returning
///   the `normalization_nested_goals`
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:101 instantiate_and_apply_query_response
export function instantiate_and_apply_query_response(
  delegate: SolverDelegate,
  original_values: readonly GenericArg[],
  response: CanonicalResponse,
  span: Span,
): [NestedNormalizationGoals, Certainty] {
  const instantiation = compute_query_response_instantiation_values(delegate, original_values, response, span, ResponseT_Response);

  const { var_values, external_constraints, certainty } = delegate.instantiate_canonical(response, instantiation, fold_Response);

  unify_query_var_values(delegate, original_values, var_values, span);

  const { region_constraints, opaque_types, normalization_nested_goals } = ExternalConstraints_deref(external_constraints);

  switch (region_constraints.$) {
    case "Old":
      register_region_constraints(
        delegate,
        region_constraints._0.map(([c, vis]): [RegionConstraint, VisibleForLeakCheck] => {
          // FIXME: We should revisit and consider removing this after *assumptions on
          // binders* is available, like once we had done in the stabilization of
          // `-Znext-solver=coherence`(#121848).
          // We ignore constraints from the nested goals in leak check. This is to match with
          // the old solver's behavior, which has separated evaluation and fulfillment, and
          // the former doesn't consider outlives obligations from the later.
          return [c, VisibleForLeakCheck.and(vis, "No")];
        }),
        span,
      );
      break;
    case "NextGen":
      // PORT: `r.clone()`: region constraints are immutable values here.
      // PORT(merge): ir_register_solver_region_constraint after infcx-contract
      delegate.deref().register_solver_region_constraint(region_constraints._0, span);
      break;
  }
  register_new_opaque_types(delegate, opaque_types, span);

  return [{ _0: [...normalization_nested_goals._0] }, certainty];
}

/// This returns the canonical variable values to instantiate the bound variables of
/// the canonical response. This depends on the `original_values` for the
/// bound variables.
// PORT: `T: ResponseT<I>` descriptor `d_T`.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:148 compute_query_response_instantiation_values
export function compute_query_response_instantiation_values<T>(
  delegate: SolverDelegate,
  original_values: readonly GenericArg[],
  response: Canonical<T>,
  span: Span,
  d_T: ResponseT<T>,
): CanonicalVarValues {
  // FIXME: Longterm canonical queries should deal with all placeholders
  // created inside of the query directly instead of returning them to the
  // caller.
  const prev_universe = delegate.deref().universe();
  const universes_created_in_query = UniverseIndex.index(response.max_universe);
  for (let i = 0; i < universes_created_in_query; i++) {
    const new_universe = delegate.deref().create_next_universe();
    if (delegate.cx().assumptions_on_binders()) {
      // FIXME(-Zassumptions-on-binders): Remove this temporary workaround once
      // opaque types no longer escape query responses with query-created placeholders.
      // Region constraints involving query-created placeholders were handled inside
      // the query. However, the placeholders can still escape in other response
      // fields, such as opaque type constraints. To avoid triggering
      // assertions, we explicitly insert empty assumptions for the
      // recreated universes here.
      delegate.deref().insert_placeholder_assumptions(new_universe, Assumptions.empty());
    }
  }

  return compute_query_response_instantiation_values_in_universe(delegate, original_values, response, span, prev_universe, d_T);
}

// PORT: `T: ResponseT<I>` descriptor `d_T`.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:190 compute_query_response_instantiation_values_in_universe
export function compute_query_response_instantiation_values_in_universe<T>(
  delegate: SolverDelegate,
  original_values: readonly GenericArg[],
  response: Canonical<T>,
  span: Span,
  prev_universe: UniverseIndex,
  d_T: ResponseT<T>,
): CanonicalVarValues {
  const var_values = d_T.var_values(response.value);
  assert_eq(original_values.length, var_values.length, (n) => `${n}`);

  // If the query did not make progress with constraining inference variables,
  // we would normally create a new inference variables for bound existential variables
  // only then unify this new inference variable with the inference variable from
  // the input.
  //
  // We therefore instantiate the existential variable in the canonical response with the
  // inference variable of the input right away, which is more performant.
  const opt_values: (GenericArg | undefined)[] = new Array<GenericArg | undefined>(response.var_kinds.length).fill(undefined);
  for (let i = 0; i < Math.min(original_values.length, var_values.length); i++) {
    const original_value = original_values[i]!;
    const result_value = var_values[i]!;
    const k = GenericArg.kind(result_value);
    switch (k.$) {
      case "Type": {
        const t = k._0;
        // We disable the instantiation guess for inference variables
        // and only use it for placeholders. We need to handle the
        // `sub_root` of type inference variables which would make this
        // more involved. They are also a lot rarer than region variables.
        const tk = t.kind();
        if (tk.$ === "Bound" && unwrap(response.var_kinds[BoundVar.as_usize(tk._1.var)]).$ !== "Ty") {
          const index_kind = tk._0;
          const b = tk._1;
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, b.var, original_value);
        }
        break;
      }
      case "Lifetime": {
        const rk = k._0.kind();
        if (rk.$ === "ReBound") {
          const index_kind = rk._0;
          const br = rk._1;
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, br.var, original_value);
        }
        break;
      }
      case "Const": {
        const ck = k._0.kind();
        if (ck.$ === "Bound") {
          const index_kind = ck._0;
          const bc = ck._1;
          assert(index_kind.$ === "Canonical", "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Canonical)");
          index_set(opt_values, bc.var, original_value);
        }
        break;
      }
    }
  }
  return CanonicalVarValues.instantiate(as_interner(delegate.cx()), response.var_kinds, (var_values, kind) => {
    if (CanonicalVarKind.universe(kind) !== UniverseIndex.ROOT) {
      // A variable from inside a binder of the query. While ideally these shouldn't
      // exist at all (see the FIXME at the start of this method), we have to deal with
      // them for now.
      return delegate.instantiate_canonical_var(kind, span, var_values, (idx) =>
        UniverseIndex.from_usize(UniverseIndex.index(prev_universe) + UniverseIndex.index(idx)),
      );
    } else if (CanonicalVarKind.is_existential(kind)) {
      // As an optimization we sometimes avoid creating a new inference variable here.
      //
      // All new inference variables we create start out in the current universe of the caller.
      // This is conceptually wrong as these inference variables would be able to name
      // more placeholders then they should be able to. However the inference variables have
      // to "come from somewhere", so by equating them with the original values of the caller
      // later on, we pull them down into their correct universe again.
      const v = index_get(opt_values, BoundVar.from_usize(var_values.length));
      if (v !== undefined) {
        return v;
      } else {
        return delegate.instantiate_canonical_var(kind, span, var_values, (_) => prev_universe);
      }
    } else {
      // For placeholders which were already part of the input, we simply map this
      // universal bound variable back the placeholder of the input.
      //
      // For `CanonicalVarKind::PlaceholderRegion`, this differs slightly: we
      // canonicalize all free regions from the input into placeholders. This is
      // unlike types or consts, where only input placeholders remain placeholders
      // in the canonical form.
      //
      // We can still map these back to the original input regions, as we
      // just instantiate the canonical variable with its corresponding
      // `original_value`.
      //
      // For more information on why we canonicalize all input regions as
      // placeholders, see the comment in `Canonicalizer::fold_region`.
      return index_get(original_values, CanonicalVarKind.expect_placeholder_index(kind))!;
    }
  });
}

/** `ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_)` */
function is_fresh(i: InferTy | undefined): boolean {
  return i !== undefined && (i.$ === "FreshTy" || i.$ === "FreshIntTy" || i.$ === "FreshFloatTy");
}

/** PORT: `slice[idx]` with core's bounds-check panic. */
function index_get<T>(v: readonly T[], idx: number): T {
  if (idx >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${idx}`);
  return v[idx]!;
}

/** PORT: `slice[idx] = value` with core's bounds-check panic. */
function index_set<T>(v: T[], idx: number, value: T): void {
  if (idx >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${idx}`);
  v[idx] = value;
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

  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:305 new
  static new(infcx: InferCtxtLike, span: Span): ResponseRelating {
    return new ResponseRelating(infcx, span);
  }

  // ---- impl TypeRelation for ResponseRelating ----
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:315 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:319 relate_ty_args
  relate_ty_args(
    a_ty: Ty,
    _b_ty: Ty,
    _def_id: DefId,
    a_args: GenericArgs,
    b_args: GenericArgs,
    _: (args: GenericArgs) => Ty,
  ): RelateResult<Ty> {
    const r = relate_args_invariantly(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:332 relate_with_variance
  relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    return this.relate(a, b, d);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:343 tys
  tys(a: Ty, b: Ty): RelateResult<Ty> {
    if (a === b) {
      return Ok(a);
    }

    const infcx = this.infcx;
    a = infcx.shallow_resolve(a);
    b = infcx.shallow_resolve(b);

    const ak = a.kind();
    const bk = b.kind();
    const a_infer = ak.$ === "Infer" ? ak._0 : undefined;
    const b_infer = bk.$ === "Infer" ? bk._0 : undefined;
    if (a_infer?.$ === "TyVar" && b_infer?.$ === "TyVar") {
      infcx.equate_ty_vids_raw(a_infer._0, b_infer._0);
    } else if (a_infer?.$ === "TyVar") {
      infcx.instantiate_ty_var_raw(a_infer._0, b);
    } else if (b_infer?.$ === "TyVar") {
      infcx.instantiate_ty_var_raw(b_infer._0, a);
    } else if (ak.$ === "Error" || bk.$ === "Error") {
      const e = ak.$ === "Error" ? ak._0 : bk.$ === "Error" ? bk._0 : unreachable();
      infcx.set_tainted_by_errors(e);
      return Ok(Ty.new_error(infcx.cx(), e));
    }
    // FIXME: Share the arms below with `super_combine_tys`.
    // We can't use `super_combine_tys` here because we want to support
    // values with escaping bound vars so that we can avoid
    // instantiating binders when relating them.
    //
    // Relate integral variables to other types
    else if (a_infer?.$ === "IntVar" && b_infer?.$ === "IntVar") {
      infcx.equate_int_vids_raw(a_infer._0, b_infer._0);
    } else if (a_infer?.$ === "IntVar" && bk.$ === "Int") {
      infcx.instantiate_int_var_raw(a_infer._0, { $: "IntType", _0: bk._0 });
    } else if (ak.$ === "Int" && b_infer?.$ === "IntVar") {
      infcx.instantiate_int_var_raw(b_infer._0, { $: "IntType", _0: ak._0 });
    } else if (a_infer?.$ === "IntVar" && bk.$ === "Uint") {
      infcx.instantiate_int_var_raw(a_infer._0, { $: "UintType", _0: bk._0 });
    } else if (ak.$ === "Uint" && b_infer?.$ === "IntVar") {
      infcx.instantiate_int_var_raw(b_infer._0, { $: "UintType", _0: ak._0 });
    }
    // Relate floating-point variables to other types
    else if (a_infer?.$ === "FloatVar" && b_infer?.$ === "FloatVar") {
      infcx.equate_float_vids_raw(a_infer._0, b_infer._0);
    } else if (a_infer?.$ === "FloatVar" && bk.$ === "Float") {
      infcx.instantiate_float_var_raw(a_infer._0, { $: "Known", _0: bk._0 });
    } else if (ak.$ === "Float" && b_infer?.$ === "FloatVar") {
      infcx.instantiate_float_var_raw(b_infer._0, { $: "Known", _0: ak._0 });
    } else if (is_fresh(b_infer) || is_fresh(a_infer)) {
      return panic("We do not expect to encounter `Fresh` variables in the new solver");
    } else {
      const r = structurally_relate_tys(this, a, b);
      if (r.$ === "Err") return r;
    }

    return Ok(a);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:417 regions
  regions(a: Region, b: Region): RelateResult<Region> {
    // PORT(merge): ir_equate_regions after infcx-contract
    this.infcx.equate_regions(a, b, "Yes", this.span);

    return Ok(a);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:424 consts
  consts(a: Const, b: Const): RelateResult<Const> {
    if (a === b) {
      return Ok(a);
    }

    const infcx = this.infcx;
    // Proof tree evaluation can unify inference variables in the original
    // values without eagerly resolving them.
    a = infcx.shallow_resolve_const(a);
    b = infcx.shallow_resolve_const(b);
    const ak = a.kind();
    const bk = b.kind();
    const a_vid = ak.$ === "Infer" && ak._0.$ === "Var" ? ak._0._0 : undefined;
    const b_vid = bk.$ === "Infer" && bk._0.$ === "Var" ? bk._0._0 : undefined;
    if (a_vid !== undefined && b_vid !== undefined) {
      infcx.equate_const_vids_raw(a_vid, b_vid);
    } else if (a_vid !== undefined) {
      infcx.instantiate_const_var_raw(a_vid, b);
    } else if (b_vid !== undefined) {
      infcx.instantiate_const_var_raw(b_vid, a);
    } else {
      const r = structurally_relate_consts(this, a, b);
      if (r.$ === "Err") return r;
    }

    return Ok(a);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:458 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    // PORT: derived `PartialEq` of `Binder<I, T>` (a plain value): the intern key.
    if (intern_key(a) === intern_key(b)) {
      return Ok(a);
    }

    // debug_assert_eq!(a.bound_vars(), b.bound_vars());
    const r = this.relate(Binder.skip_binder(a), Binder.skip_binder(b), d);
    if (r.$ === "Err") return r;

    return Ok(a);
  }

  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }
}

/// Unify the `original_values` with the `var_values` returned by the canonical query..
///
/// This assumes that this unification will always succeed. This is the case when
/// applying a query response right away. However, calling a canonical query, doing any
/// other kind of trait solving, and only then instantiating the result of the query
/// can cause the instantiation to fail. This is not supported and we ICE in this case.
///
/// We always structurally instantiate aliases. Relating aliases needs to be different
/// depending on whether the alias is *rigid* or not. We're only really able to tell
/// whether an alias is rigid by using the trait solver. When instantiating a response
/// from the solver we assume that the solver correctly handled aliases and therefore
/// always relate them structurally here.
// #[instrument(level = "trace", skip(delegate))]
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:490 unify_query_var_values
export function unify_query_var_values(
  delegate: SolverDelegate,
  original_values: readonly GenericArg[],
  var_values: GenericArgs,
  span: Span,
): void {
  assert_eq(original_values.length, var_values.length, (n) => `${n}`);

  for (let i = 0; i < Math.min(original_values.length, var_values.length); i++) {
    const orig = original_values[i]!;
    const response = var_values[i]!;
    const must_eq = ResponseRelating.new(delegate.deref(), span);
    unwrap_result(must_eq.relate(orig, response, relate_GenericArg), debug_TypeError);
  }
}

// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:507 register_region_constraints
export function register_region_constraints(
  delegate: SolverDelegate,
  constraints: Iterable<[RegionConstraint, VisibleForLeakCheck]>,
  span: Span,
): void {
  for (const [constraint, vis] of constraints) {
    switch (constraint.$) {
      case "Outlives": {
        const lhs = constraint._0._0;
        const rhs = constraint._0._1;
        const lk = GenericArg.kind(lhs);
        switch (lk.$) {
          case "Lifetime":
            // PORT(merge): ir_sub_regions after infcx-contract
            delegate.deref().sub_regions(rhs, lk._0, vis, span);
            break;
          case "Type":
            delegate.deref().register_ty_outlives(lk._0, rhs, span);
            break;
          case "Const":
            return panic(`const outlives: ${debug_GenericArg(lhs, PLAIN)}: ${debug_Region(rhs, PLAIN)}`);
        }
        break;
      }
      case "Eq": {
        const lhs = constraint._0._0;
        const rhs = constraint._0._1;
        // PORT(merge): ir_equate_regions after infcx-contract
        delegate.deref().equate_regions(lhs, rhs, vis, span);
        break;
      }
    }
  }
}

// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:529 register_new_opaque_types
export function register_new_opaque_types(
  delegate: SolverDelegate,
  opaque_types: readonly [OpaqueTypeKey, Ty][],
  span: Span,
): void {
  for (const [key, ty] of opaque_types) {
    // PORT(merge): ir_register_hidden_type_in_storage after infcx-contract
    const prev = delegate.deref().register_hidden_type_in_storage(key, ty, span);
    // We eagerly resolve inference variables when computing the query response.
    // This can cause previously distinct opaque type keys to now be structurally equal.
    //
    // To handle this, we store any duplicate entries in a separate list to check them
    // at the end of typeck/borrowck. We could alternatively eagerly equate the hidden
    // types here. However, doing so is difficult as it may result in nested goals and
    // any errors may make it harder to track the control flow for diagnostics.
    if (prev !== undefined) {
      delegate.deref().add_duplicate_opaque_type(key, prev, span);
    }
  }
}

/// Used by proof trees to be able to recompute intermediate actions while
/// evaluating a goal. The `var_values` not only include the bound variables
/// of the query input, but also contain all unconstrained inference vars
/// created while evaluating this goal.
// PORT: D4 descriptor `d_T`.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:556 make_canonical_state
export function make_canonical_state<T>(
  delegate: SolverDelegate,
  var_values: readonly GenericArg[],
  max_input_universe: UniverseIndex,
  data: T,
  d_T: TypeFoldable<T>,
): CanonicalState<T> {
  const var_values_ = delegate.cx().mk_args(var_values);
  let state: State<T> = { var_values: var_values_, data };
  state = delegate.deref().deeply_resolve_via_unification_table(state, fold_State(d_T));
  return Canonicalizer.canonicalize_response(delegate, max_input_universe, state, fold_State(d_T));
}

// FIXME: needs to be pub to be accessed by downstream
// `rustc_trait_selection::solve::inspect::analyse`.
// PORT: D4 descriptor `d_T`.
// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:575 instantiate_canonical_state
export function instantiate_canonical_state<T>(
  delegate: SolverDelegate,
  span: Span,
  prev_universe: UniverseIndex,
  orig_values: GenericArg[],
  state: CanonicalState<T>,
  d_T: TypeFoldable<T>,
): T {
  // In case any fresh inference variables have been created between `state`
  // and the previous instantiation, extend `orig_values` for it.
  const max_universe = UniverseIndex.from_usize(UniverseIndex.index(prev_universe) + UniverseIndex.index(state.max_universe));
  while (delegate.deref().universe() < max_universe) {
    delegate.deref().create_next_universe();
  }
  const fresh = slice_from(state.value.var_values.as_slice(), orig_values.length);
  for (const arg of fresh) {
    orig_values.push(delegate.fresh_var_for_kind(arg, span, max_universe));
  }

  const instantiation = compute_query_response_instantiation_values_in_universe(
    delegate,
    orig_values,
    state,
    span,
    prev_universe,
    ResponseT_State as ResponseT<State<T>>,
  );

  const { var_values, data } = delegate.instantiate_canonical(state, instantiation, fold_State(d_T));

  unify_query_var_values(delegate, orig_values, var_values, span);
  return data;
}

// rustc: compiler/rustc_next_trait_solver/src/canonical/mod.rs:613 response_no_constraints_raw
export function response_no_constraints_raw(
  cx: TyCtxt,
  max_universe: UniverseIndex,
  var_kinds: CanonicalVarKinds,
  certainty: Certainty,
): CanonicalResponse {
  // Given a list of canonical variables, construct a set of values which are
  // the identity response.
  const var_values = cx.mk_args_from_iter(
    var_kinds.map((kind, i): GenericArg => {
      switch (kind.$) {
        case "Ty":
        case "Int":
        case "Float":
        case "PlaceholderTy":
          return Ty.new_canonical_bound(cx, BoundVar.from_usize(i));
        case "Region":
        case "PlaceholderRegion":
          return Region.new_canonical_bound(cx, BoundVar.from_usize(i));
        case "Const":
        case "PlaceholderConst":
          return Const.new_canonical_bound(cx, BoundVar.from_usize(i));
      }
    }),
  );

  return {
    max_universe,
    var_kinds,
    value: {
      var_values,
      // FIXME: maybe we should store the "no response" version in cx, like
      // we do for cx.types and stuff.
      external_constraints: cx.mk_external_constraints(ExternalConstraintsData.new(as_interner(cx))),
      certainty,
    },
  };
}

// ---- D4 descriptors of the traversed types (fold.ts header) ---------------------------------------------------------

/** `Response<I>` (`#[derive(TypeVisitable_Generic, TypeFoldable_Generic)]`, rustc_type_ir solve/mod.gen.ts). */
const fold_Response: TypeFoldable<Response> = {
  visit_with: visit_with_Response,
  try_fold_with: try_fold_with_Response,
  fold_with: fold_with_Response,
};

/** `inspect::State<I, T>` (`#[derive(TypeVisitable_Generic, TypeFoldable_Generic)]`, rustc_type_ir solve/inspect.gen.ts). */
function fold_State<T>(d_T: TypeFoldable<T>): TypeFoldable<State<T>> {
  return {
    visit_with: (self, visitor) => visit_with_State(self, visitor, d_T.visit_with),
    try_fold_with: (self, folder) => try_fold_with_State(self, folder, d_T.try_fold_with),
    fold_with: (self, folder) => fold_with_State(self, folder, d_T.fold_with),
  };
}
