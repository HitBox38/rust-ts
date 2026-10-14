// Port of compiler/rustc_infer/src/infer/relate/type_relating.rs (lane infer-relate).
//
// - `TypeRelating` is a codegen `hand` class (fields here, in declaration order); the field `param_env` is
//   `param_env_` (`PredicateEmittingRelation::param_env`). Its methods are declared by the interface merged below
//   (`new` / `into_obligations` also in ../../decls.ts) and assigned onto the prototype in upstream order.
// - `cache: DelayedSet<(Variance, Ty, Ty)>` keys on `intern_key` (rustc_type_ir solver_relating.ts precedent).
// - `Obligation::new(.., pred)` takes the predicate's upcast fn (`impl Upcast<TyCtxt, Predicate>`, decls.ts).
// - `#[instrument]` / `debug!` are dropped (tracing is off in the oracle); `debug_assert!`s stay comments.
// Init order: top-level code here touches only ../../decls.ts, this file's .gen.ts and other crates; the other
// rustc_infer modules are read inside function bodies only.
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { clone_ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { ParamEnv, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { DelayedSet } from "../../../rustc_type_ir/data_structures/mod.ts";
import { DelayedSet as DelayedSetC } from "../../../rustc_type_ir/data_structures/mod.ts";
import { Variance } from "../../../rustc_type_ir/lib.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import type { PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { interner, type Relate, relate_args_invariantly, type RelateResult, TypeRelation_provided, type VarianceDiagInfo } from "../../../rustc_type_ir/relate.ts";
import {
  combine_ty_args,
  d_PredicateKind,
  type PredicateEmittingRelation,
  super_combine_consts,
  super_combine_tys,
  type Upcast,
  upcast_Binder_PredicateKind_Predicate,
} from "../../../rustc_type_ir/relate/combine.ts";
import type { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import { VisibleForLeakCheck } from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { assert, unreachable } from "../../../std/panic.ts";
import { Ok } from "../../../std/result.ts";
import type { InferCtxt } from "../../decls.ts";
import { Obligation } from "../../traits/mod.ts";
import type { PredicateObligations } from "../../traits/mod.gen.ts";
import { DefineOpaqueTypes } from "../at.ts";
import { BoundRegionConversionTime, clone_TypeTrace, type SubregionOrigin, type TypeTrace } from "../mod.ts";

export * from "./type_relating.gen.ts";

/// Enforce that `a` is equal to or a subtype of `b`.
// rustc-type: compiler/rustc_infer/src/infer/relate/type_relating.rs:15 TypeRelating
// PORT: hand class (codegen `hand`): the field `param_env` is `param_env_` (`PredicateEmittingRelation::param_env`).
export class TypeRelating implements PredicateEmittingRelation {
  constructor(
    public infcx: InferCtxt,

    // Immutable fields
    public trace: TypeTrace,
    public param_env_: ParamEnv,
    public define_opaque_types: DefineOpaqueTypes,

    // Mutable fields.
    public ambient_variance: Variance,
    public obligations: PredicateObligations,
    /// The cache only tracks the `ambient_variance` as it's the
    /// only field which is mutable and which meaningfully changes
    /// the result when relating types.
    ///
    /// The cache does not track whether the state of the
    /// `InferCtxt` has been changed or whether we've added any
    /// obligations to `self.goals`. Whether a goal is added
    /// once or multiple times is not really meaningful.
    ///
    /// Changes in the inference state may delay some type inference to
    /// the next fulfillment loop. Given that this loop is already
    /// necessary, this is also not a meaningful change. Consider
    /// the following three relations:
    /// ```text
    /// Vec<?0> sub Vec<?1>
    /// ?0 eq u32
    /// Vec<?0> sub Vec<?1>
    /// ```
    /// Without a cache, the second `Vec<?0> sub Vec<?1>` would eagerly
    /// constrain `?1` to `u32`. When using the cache entry from the
    /// first time we've related these types, this only happens when
    /// later proving the `Subtype(?0, ?1)` goal from the first relation.
    // PORT: `DelayedSet<(Variance, Ty, Ty)>`: tuple keys are keyed by `intern_key` (rust_ts/keyed.ts).
    public cache: DelayedSet<[Variance, Ty, Ty]>,
  ) {}
}

export interface TypeRelating {
  // `impl TypeRelation<TyCtxt> for TypeRelating`
  cx(): TyCtxt;
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
  relate_ty_args(a_ty: Ty, b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _4: (args: GenericArgs) => Ty): RelateResult<Ty>;
  relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
  tys(a: Ty, b: Ty): RelateResult<Ty>;
  regions(a: Region, b: Region): RelateResult<Region>;
  consts(a: Const, b: Const): RelateResult<Const>;
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
  // `impl PredicateEmittingRelation<InferCtxt> for TypeRelating`
  span(): Span;
  param_env(): ParamEnv;
  register_predicates<T>(preds: Iterable<T>, upcast: Upcast<T, Predicate>): void;
  register_goals(goals: Iterable<Goal<Predicate>>): void;
}

/** PORT: `impl Upcast<TyCtxt, Predicate>` fns are typed over `TyCtxt` in rustc_type_ir relate (combine.ts) and over
 *  `Interner` in `Obligation::new` (decls.ts); `I = TyCtxt` on both sides. */
function as_obligation_upcast<T>(upcast: Upcast<T, Predicate>): (from: T, tcx: Interner) => Predicate {
  return upcast as unknown as (from: T, tcx: Interner) => Predicate;
}

/** The `def_id` of `ty::Alias(_, ty::AliasTy { kind: ty::Opaque { def_id }, .. })`, if `t` is one. */
function opaque_def_id(t: Ty): DefId | undefined {
  const k = t.kind();
  return k.$ === "Alias" && k._1.kind.$ === "Opaque" ? k._1.kind.def_id : undefined;
}

// impl<'infcx, 'tcx> TypeRelating<'infcx, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:52 new
(TypeRelating as unknown as { new: (infcx: InferCtxt, trace: TypeTrace, param_env: ParamEnv, define_opaque_types: DefineOpaqueTypes, ambient_variance: Variance) => TypeRelating }).new = function (
  infcx: InferCtxt,
  trace: TypeTrace,
  param_env: ParamEnv,
  define_opaque_types: DefineOpaqueTypes,
  ambient_variance: Variance,
): TypeRelating {
  assert(!infcx.next_trait_solver_, "assertion failed: !infcx.next_trait_solver");
  return new TypeRelating(infcx, trace, param_env, define_opaque_types, ambient_variance, [], DelayedSetC.default_<[Variance, Ty, Ty]>(intern_key));
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:71 into_obligations
TypeRelating.prototype.into_obligations = function (this: TypeRelating): PredicateObligations {
  return this.obligations;
};

// impl<'tcx> TypeRelation<TyCtxt<'tcx>> for TypeRelating<'_, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:77 cx
TypeRelating.prototype.cx = function (this: TypeRelating): TyCtxt {
  return this.infcx.tcx;
};

/** (provided) `TypeRelation::relate` */
TypeRelating.prototype.relate = function <T>(this: TypeRelating, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:81 relate_ty_args
TypeRelating.prototype.relate_ty_args = function (
  this: TypeRelating,
  a_ty: Ty,
  b_ty: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  _4: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  if (this.ambient_variance === Variance.Invariant) {
    // Avoid fetching the variance if we are in an invariant
    // context; no need, and it can induce dependency cycles
    // (e.g., #41849).
    const r = relate_args_invariantly(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  } else {
    const variances = interner(this.cx()).variances_of(def_id);
    return combine_ty_args(this.infcx, this, a_ty, b_ty, variances, a_args, b_args, (_) => a_ty);
  }
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:102 relate_with_variance
TypeRelating.prototype.relate_with_variance = function <T>(this: TypeRelating, variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
  const old_ambient_variance = this.ambient_variance;
  this.ambient_variance = Variance.xform(this.ambient_variance, variance);
  // debug!(?self.ambient_variance, "new ambient variance");

  const r: RelateResult<T> = this.ambient_variance === Variance.Bivariant ? Ok(a) : this.relate(a, b, d);

  this.ambient_variance = old_ambient_variance;
  return r;
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:120 tys
TypeRelating.prototype.tys = function (this: TypeRelating, a: Ty, b: Ty): RelateResult<Ty> {
  // We don't use the rigid marker in the old solver.
  // debug_assert!(!a.has_rigid_aliases());
  // debug_assert!(!b.has_rigid_aliases());

  if (a === b) {
    return Ok(a);
  }

  const infcx = this.infcx;
  a = infcx.shallow_resolve(a);
  b = infcx.shallow_resolve(b);

  if (this.cache.contains([this.ambient_variance, a, b])) {
    return Ok(a);
  }

  const ak = a.kind();
  const bk = b.kind();
  const a_opaque = opaque_def_id(a);
  const b_opaque = opaque_def_id(b);
  // `if self.define_opaque_types == DefineOpaqueTypes::Yes && def_id.is_local()`, the guard of either alternative.
  const defines = (def_id: DefId | undefined): boolean => def_id !== undefined && this.define_opaque_types === DefineOpaqueTypes.Yes && def_id.is_local();
  if (ak.$ === "Infer" && ak._0.$ === "TyVar" && bk.$ === "Infer" && bk._0.$ === "TyVar") {
    const [a_id, b_id] = [ak._0._0, bk._0._0];
    switch (this.ambient_variance) {
      case "Covariant":
        // can't make progress on `A <: B` if both A and B are
        // type variables, so record an obligation.
        this.obligations.push(
          Obligation.new(
            this.cx(),
            clone_ObligationCause(this.trace.cause),
            this.param_env_,
            Binder.dummy<PredicateKind>({ $: "Subtype", _0: { a_is_expected: true, a, b } }, d_PredicateKind),
            as_obligation_upcast(upcast_Binder_PredicateKind_Predicate),
          ),
        );
        break;
      case "Contravariant":
        // can't make progress on `B <: A` if both A and B are
        // type variables, so record an obligation.
        this.obligations.push(
          Obligation.new(
            this.cx(),
            clone_ObligationCause(this.trace.cause),
            this.param_env_,
            Binder.dummy<PredicateKind>({ $: "Subtype", _0: { a_is_expected: false, a: b, b: a } }, d_PredicateKind),
            as_obligation_upcast(upcast_Binder_PredicateKind_Predicate),
          ),
        );
        break;
      case "Invariant":
        infcx.inner.type_variables().equate(a_id, b_id);
        break;
      case "Bivariant":
        return unreachable("internal error: entered unreachable code: Expected bivariance to be handled in relate_with_variance");
    }
  } else if (ak.$ === "Infer" && ak._0.$ === "TyVar") {
    const r = infcx.instantiate_ty_var(this, true, ak._0._0, this.ambient_variance, b);
    if (r.$ === "Err") return r;
  } else if (bk.$ === "Infer" && bk._0.$ === "TyVar") {
    const r = infcx.instantiate_ty_var(this, false, bk._0._0, Variance.xform(this.ambient_variance, Variance.Contravariant), a);
    if (r.$ === "Err") return r;
  } else if (a_opaque !== undefined && b_opaque !== undefined && DefId_eq(a_opaque, b_opaque)) {
    const r = super_combine_tys(infcx, this, a, b);
    if (r.$ === "Err") return r;
  } else if (defines(a_opaque) || defines(b_opaque)) {
    const goals = infcx.handle_opaque_type(a, b, this.trace.cause.span, this.param_env());
    if (goals.$ === "Err") return goals;
    this.register_goals(goals._0);
  } else {
    const r = super_combine_tys(infcx, this, a, b);
    if (r.$ === "Err") return r;
  }

  assert(this.cache.insert([this.ambient_variance, a, b]), "assertion failed: self.cache.insert((self.ambient_variance, a, b))");

  return Ok(a);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:220 regions
TypeRelating.prototype.regions = function (this: TypeRelating, a: Region, b: Region): RelateResult<Region> {
  const origin: SubregionOrigin = { $: "Subtype", _0: clone_TypeTrace(this.trace) };

  switch (this.ambient_variance) {
    // Subtype(&'a u8, &'b u8) => Outlives('a: 'b) => SubRegion('b, 'a)
    case "Covariant":
      this.infcx.inner.unwrap_region_constraints().make_subregion(origin, b, a, VisibleForLeakCheck.Yes);
      break;
    // Suptype(&'a u8, &'b u8) => Outlives('b: 'a) => SubRegion('a, 'b)
    case "Contravariant":
      this.infcx.inner.unwrap_region_constraints().make_subregion(origin, a, b, VisibleForLeakCheck.Yes);
      break;
    case "Invariant":
      this.infcx.inner.unwrap_region_constraints().make_eqregion(origin, a, b, VisibleForLeakCheck.Yes);
      break;
    case "Bivariant":
      return unreachable("internal error: entered unreachable code: Expected bivariance to be handled in relate_with_variance");
  }

  return Ok(a);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:263 consts
TypeRelating.prototype.consts = function (this: TypeRelating, a: Const, b: Const): RelateResult<Const> {
  // We don't use the rigid marker in the old solver.
  // debug_assert!(!a.has_rigid_aliases());
  // debug_assert!(!b.has_rigid_aliases());

  return super_combine_consts(this.infcx, this, a, b);
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:275 binders
TypeRelating.prototype.binders = function <T>(this: TypeRelating, a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  // PORT: derived `PartialEq` of `Binder`: the value by `T`'s `eq`, the interned `bound_vars` by pointer.
  if (d.eq(a.value, b.value) && a.bound_vars === b.bound_vars) {
    // Do nothing
  } else {
    const a_inner = Binder.no_bound_vars(a, d);
    const b_inner = a_inner !== undefined ? Binder.no_bound_vars(b, d) : undefined;
    if (a_inner !== undefined && b_inner !== undefined) {
      const r = this.relate(a_inner, b_inner, d);
      if (r.$ === "Err") return r;
    } else {
      const span = this.trace.cause.span;
      const infcx = this.infcx;

      switch (this.ambient_variance) {
        // Checks whether `for<..> sub <: for<..> sup` holds.
        //
        // For this to hold, **all** instantiations of the super type
        // have to be a super type of **at least one** instantiation of
        // the subtype.
        //
        // This is implemented by first entering a new universe.
        // We then replace all bound variables in `sup` with placeholders,
        // and all bound variables in `sub` with inference vars.
        // We can then just relate the two resulting types as normal.
        //
        // Note: this is a subtle algorithm. For a full explanation, please see
        // the [rustc dev guide][rd]
        //
        // [rd]: https://rustc-dev-guide.rust-lang.org/borrow_check/region_inference/placeholders_and_universes.html
        case "Covariant": {
          const r = infcx.enter_forall(
            b,
            (b) => {
              const a_ = infcx.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.HigherRankedType, a, d);
              return this.relate(a_, b, d);
            },
            d,
          );
          if (r.$ === "Err") return r;
          break;
        }
        case "Contravariant": {
          const r = infcx.enter_forall(
            a,
            (a) => {
              const b_ = infcx.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.HigherRankedType, b, d);
              return this.relate(a, b_, d);
            },
            d,
          );
          if (r.$ === "Err") return r;
          break;
        }

        // When **equating** binders, we check that there is a 1-to-1
        // correspondence between the bound vars in both types.
        //
        // We do so by separately instantiating one of the binders with
        // placeholders and the other with inference variables and then
        // equating the instantiated types.
        //
        // We want `for<..> A == for<..> B` -- therefore we want
        // `exists<..> A == for<..> B` and `exists<..> B == for<..> A`.
        // Check if `exists<..> A == for<..> B`
        case "Invariant": {
          const r1 = infcx.enter_forall(
            b,
            (b) => {
              const a_ = infcx.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.HigherRankedType, a, d);
              return this.relate(a_, b, d);
            },
            d,
          );
          if (r1.$ === "Err") return r1;

          // Check if `exists<..> B == for<..> A`.
          const r2 = infcx.enter_forall(
            a,
            (a) => {
              const b_ = infcx.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.HigherRankedType, b, d);
              return this.relate(a, b_, d);
            },
            d,
          );
          if (r2.$ === "Err") return r2;
          break;
        }
        case "Bivariant":
          return unreachable("internal error: entered unreachable code: Expected bivariance to be handled in relate_with_variance");
      }
    }
  }

  return Ok(a);
};

// impl<'tcx> PredicateEmittingRelation<InferCtxt<'tcx>> for TypeRelating<'_, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:355 span
TypeRelating.prototype.span = function (this: TypeRelating): Span {
  return this.trace.span();
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:359 param_env
TypeRelating.prototype.param_env = function (this: TypeRelating): ParamEnv {
  return this.param_env_;
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:363 register_predicates
TypeRelating.prototype.register_predicates = function <T>(this: TypeRelating, preds: Iterable<T>, upcast: Upcast<T, Predicate>): void {
  for (const pred of preds) {
    this.obligations.push(Obligation.new(this.infcx.tcx, clone_ObligationCause(this.trace.cause), this.param_env_, pred, as_obligation_upcast(upcast)));
  }
};

// rustc: compiler/rustc_infer/src/infer/relate/type_relating.rs:372 register_goals
TypeRelating.prototype.register_goals = function (this: TypeRelating, goals: Iterable<Goal<Predicate>>): void {
  for (const goal of goals) {
    this.obligations.push(Obligation.new(this.infcx.tcx, clone_ObligationCause(this.trace.cause), goal.param_env, goal.predicate, upcast_from_self<Predicate>));
  }
};
