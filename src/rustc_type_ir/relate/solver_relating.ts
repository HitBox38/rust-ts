// Port of compiler/rustc_type_ir/src/relate/solver_relating.rs (lane tyir-relate).
//
// PORT (D3/D4): see ../relate.ts and ./combine.ts. `trait RelateExt: InferCtxtLike` is the interface `RelateExt`; its
// blanket impl for every `Infcx` is the object `RelateExt_for_Infcx` (call `RelateExt_for_Infcx.relate(infcx, ..)`).
// `SolverRelating` is a class; its fields `param_env` / `span` are `param_env_` / `span_`, because the
// `PredicateEmittingRelation` methods `param_env()` / `span()` need the names (ty-contract decision 1 precedent).
// `pub use crate::relate::*;` is not re-exported (ESM cycle with ../relate.ts; import it from there).
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Term, type Ty } from "../../rustc_middle/ty/mod.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { assert, unreachable } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { Binder } from "../binder.ts";
import { DelayedSet } from "../data_structures/delayed_map.ts";
import type { TypeError } from "../error.ts";
import { Variance } from "../lib.ts";
import type { ProjectionClause } from "../predicate.ts";
import type { PredicateKind } from "../predicate_kind.ts";
import {
  interner,
  type Relate,
  relate_args_invariantly,
  type RelateResult,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../relate.ts";
import type { Goal } from "../solve/mod.ts";
import { VisibleForLeakCheck } from "../solve/mod.ts";
import type { Const } from "../sty/consts.ts";
import type { Region } from "../sty/mod.ts";
import { AliasTerm } from "../term_kind.ts";
import {
  d_PredicateKind,
  combine_ty_args,
  Goal_new,
  type InferCtxtLike,
  type PredicateEmittingRelation,
  super_combine_consts,
  super_combine_tys,
  type Upcast,
  upcast_Binder_PredicateKind_Predicate,
  upcast_ProjectionClause_Predicate,
} from "./combine.ts";

// ---- PORT stand-ins for fns of other files that are not ported yet -------------------------------------------------

// ---- solver_relating.rs -------------------------------------------------------------------------------------------

// rustc-trait: compiler/rustc_type_ir/src/relate/solver_relating.rs:10 RelateExt
export interface RelateExt {
  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:11 relate
  relate<T>(param_env: ParamEnv, lhs: T, variance: Variance, rhs: T, span: Span, d: Relate<T>): Result<Goal<Predicate>[], TypeError>;
}

/** `impl<Infcx: InferCtxtLike> RelateExt for Infcx` (the blanket impl; `self` first). */
export const RelateExt_for_Infcx = {
  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:25 relate
  relate<T>(self: InferCtxtLike, param_env: ParamEnv, lhs: T, variance: Variance, rhs: T, span: Span, d: Relate<T>): Result<Goal<Predicate>[], TypeError> {
    const relate = SolverRelating.new(self, variance, param_env, span);
    const r = relate.relate(lhs, rhs, d);
    if (r.$ === "Err") return r;
    return Ok(relate.goals);
  },
};

/// Enforce that `a` is equal to or a subtype of `b`.
export class SolverRelating implements PredicateEmittingRelation {
  constructor(
    public infcx: InferCtxtLike,
    // Immutable fields.
    public param_env_: ParamEnv,
    public span_: Span,
    // Mutable fields.
    public ambient_variance: Variance,
    public goals: Goal<Predicate>[],
    /// The cache only tracks the `ambient_variance` as it's the
    /// only field which is mutable and which meaningfully changes
    /// the result when relating types.
    ///
    /// The cache does not track whether the state of the
    /// `Infcx` has been changed or whether we've added any
    /// goals to `self.goals`. Whether a goal is added once or multiple
    /// times is not really meaningful.
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
    public cache: DelayedSet<[Variance, Ty, Ty]>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:81 new
  static new(infcx: InferCtxtLike, ambient_variance: Variance, param_env: ParamEnv, span: Span): SolverRelating {
    // debug_assert!(infcx.next_trait_solver());
    return new SolverRelating(infcx, param_env, span, ambient_variance, [], DelayedSet.default_<[Variance, Ty, Ty]>(intern_key));
  }

  // ---- impl TypeRelation for SolverRelating ----

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:104 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  /** (provided) `TypeRelation::relate` */
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:108 relate_ty_args
  relate_ty_args(a_ty: Ty, b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _: (args: GenericArgs) => Ty): RelateResult<Ty> {
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
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:129 relate_with_variance
  relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    const old_ambient_variance = this.ambient_variance;
    this.ambient_variance = Variance.xform(this.ambient_variance, variance);
    // debug!(?self.ambient_variance, "new ambient variance");

    const r: RelateResult<T> = this.ambient_variance === Variance.Bivariant ? Ok(a) : this.relate(a, b, d);

    this.ambient_variance = old_ambient_variance;
    return r;
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:147 tys
  tys(a: Ty, b: Ty): RelateResult<Ty> {
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
    if (ak.$ === "Infer" && ak._0.$ === "TyVar" && bk.$ === "Infer" && bk._0.$ === "TyVar") {
      const [a_id, b_id] = [ak._0._0, bk._0._0];
      switch (this.ambient_variance) {
        case "Covariant":
          // can't make progress on `A <: B` if both A and B are
          // type variables, so record an obligation.
          this.goals.push(
            Goal_new(
              this.cx(),
              this.param_env_,
              Binder.dummy<PredicateKind>({ $: "Subtype", _0: { a_is_expected: true, a, b } }, d_PredicateKind),
              upcast_Binder_PredicateKind_Predicate,
            ),
          );
          break;
        case "Contravariant":
          // can't make progress on `B <: A` if both A and B are
          // type variables, so record an obligation.
          this.goals.push(
            Goal_new(
              this.cx(),
              this.param_env_,
              Binder.dummy<PredicateKind>({ $: "Subtype", _0: { a_is_expected: false, a: b, b: a } }, d_PredicateKind),
              upcast_Binder_PredicateKind_Predicate,
            ),
          );
          break;
        case "Invariant":
          infcx.equate_ty_vids_raw(a_id, b_id);
          break;
        case "Bivariant":
          return unreachable("internal error: entered unreachable code: Expected bivariance to be handled in relate_with_variance");
      }
    } else if (ak.$ === "Alias" && ak._0 === "No" && infcx.next_trait_solver()) {
      const alias = ak._1;
      const new_var = infcx.next_ty_infer();
      const clause: ProjectionClause = { projection_term: AliasTerm.from_AliasTy(alias), term: Term.from_Ty(new_var) };
      this.goals.push(Goal_new(this.cx(), this.param_env_, clause, upcast_ProjectionClause_Predicate));
      const r = this.tys(new_var, b);
      if (r.$ === "Err") return r;
    } else if (bk.$ === "Alias" && bk._0 === "No" && infcx.next_trait_solver()) {
      const alias = bk._1;
      const new_var = infcx.next_ty_infer();
      const clause: ProjectionClause = { projection_term: AliasTerm.from_AliasTy(alias), term: Term.from_Ty(new_var) };
      this.goals.push(Goal_new(this.cx(), this.param_env_, clause, upcast_ProjectionClause_Predicate));
      const r = this.tys(a, new_var);
      if (r.$ === "Err") return r;
    } else if (ak.$ === "Infer" && ak._0.$ === "TyVar") {
      const r = infcx.instantiate_ty_var(this, true, ak._0._0, this.ambient_variance, b);
      if (r.$ === "Err") return r;
    } else if (bk.$ === "Infer" && bk._0.$ === "TyVar") {
      const r = infcx.instantiate_ty_var(this, false, bk._0._0, Variance.xform(this.ambient_variance, Variance.Contravariant), a);
      if (r.$ === "Err") return r;
    } else {
      const r = super_combine_tys(this.infcx, this, a, b);
      if (r.$ === "Err") return r;
    }

    assert(this.cache.insert([this.ambient_variance, a, b]), "assertion failed: self.cache.insert((self.ambient_variance, a, b))");

    return Ok(a);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:241 regions
  regions(a: Region, b: Region): RelateResult<Region> {
    switch (this.ambient_variance) {
      // Subtype(&'a u8, &'b u8) => Outlives('a: 'b) => SubRegion('b, 'a)
      case "Covariant":
        this.infcx.sub_regions(b, a, VisibleForLeakCheck.Yes, this.span_);
        break;
      // Suptype(&'a u8, &'b u8) => Outlives('b: 'a) => SubRegion('a, 'b)
      case "Contravariant":
        this.infcx.sub_regions(a, b, VisibleForLeakCheck.Yes, this.span_);
        break;
      case "Invariant":
        this.infcx.equate_regions(a, b, VisibleForLeakCheck.Yes, this.span_);
        break;
      case "Bivariant":
        return unreachable("internal error: entered unreachable code: Expected bivariance to be handled in relate_with_variance");
    }

    return Ok(a);
  }

  // #[instrument(skip(self), level = "trace")]
  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:257 consts
  consts(a: Const, b: Const): RelateResult<Const> {
    return super_combine_consts(this.infcx, this, a, b);
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:261 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    // If they're equal, then short-circuit.
    // PORT: derived `PartialEq` of `Binder`: the value by `T`'s `eq`, the interned `bound_vars` by pointer.
    if (d.eq(a.value, b.value) && a.bound_vars === b.bound_vars) {
      return Ok(a);
    }

    // If they have no bound vars, relate normally.
    const a_inner = Binder.no_bound_vars(a, d);
    if (a_inner !== undefined) {
      const b_inner = Binder.no_bound_vars(b, d);
      if (b_inner !== undefined) {
        const r = this.relate(a_inner, b_inner, d);
        if (r.$ === "Err") return r;
        return Ok(a);
      }
    }

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
        const r = this.infcx.enter_forall_with_empty_assumptions(
          b,
          (b) => {
            const a_ = this.infcx.instantiate_binder_with_infer(a, d);
            return this.relate(a_, b, d);
          },
          d,
        );
        if (r.$ === "Err") return r;
        break;
      }
      case "Contravariant": {
        const r = this.infcx.enter_forall_with_empty_assumptions(
          a,
          (a) => {
            const b_ = this.infcx.instantiate_binder_with_infer(b, d);
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
        const r1 = this.infcx.enter_forall_with_empty_assumptions(
          b,
          (b) => {
            const a_ = this.infcx.instantiate_binder_with_infer(a, d);
            return this.relate(a_, b, d);
          },
          d,
        );
        if (r1.$ === "Err") return r1;

        // Check if `exists<..> B == for<..> A`.
        const r2 = this.infcx.enter_forall_with_empty_assumptions(
          a,
          (a) => {
            const b_ = this.infcx.instantiate_binder_with_infer(b, d);
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
    return Ok(a);
  }

  // ---- impl PredicateEmittingRelation for SolverRelating ----

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:346 span
  span(): Span {
    // PORT: `<Span as inherent::Span>::dummy()` is `DUMMY_SP` (rustc_middle ty/context.rs:131).
    return DUMMY_SP;
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:350 param_env
  param_env(): ParamEnv {
    return this.param_env_;
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:354 register_predicates
  register_predicates<T>(obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void {
    for (const pred of obligations) {
      this.goals.push(Goal_new(this.infcx.cx(), this.param_env_, pred, upcast));
    }
  }

  // rustc: compiler/rustc_type_ir/src/relate/solver_relating.rs:363 register_goals
  register_goals(obligations: Iterable<Goal<Predicate>>): void {
    this.goals.push(...obligations);
  }
}
