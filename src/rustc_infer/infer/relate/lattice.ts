// Port of compiler/rustc_infer/src/infer/relate/lattice.rs (lane infer-relate).
//
//! # Lattice variables
//!
//! Generic code for operating on [lattices] of inference variables
//! that are characterized by an upper- and lower-bound.
//!
//! The code is defined quite generically so that it can be
//! applied both to type variables, which represent types being inferred,
//! and fn variables, which represent function types being inferred.
//! (It may eventually be applied to their types as well.)
//! In some cases, the functions are also generic with respect to the
//! operation on the lattice (GLB vs LUB).
//!
//! ## Note
//!
//! Although all the functions are generic, for simplicity, comments in the source code
//! generally refer to type variables and the LUB operation.
//!
//! [lattices]: https://en.wikipedia.org/wiki/Lattice_(order)
//
// - `LatticeOpKind::invert` is on the companion (PORTING §8).
// - `LatticeOp` is a codegen `hand` class (fields here, in declaration order); the field `param_env` is `param_env_`
//   (`PredicateEmittingRelation::param_env`). Its methods are declared by the interface merged below (`new` /
//   `into_obligations` also in ../../decls.ts) and assigned onto the prototype in upstream order.
// - `#[instrument]` / `debug!` are dropped (tracing is off in the oracle).
// Init order: top-level code here touches only ../../decls.ts, this file's .gen.ts and other crates; the other
// rustc_infer modules are read inside function bodies only.
import { clone_ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { ParamEnv, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { Variance } from "../../../rustc_type_ir/lib.ts";
import { interner, type Relate, relate_Binder, type RelateResult, TypeRelation_provided, VarianceDiagInfo } from "../../../rustc_type_ir/relate.ts";
import { combine_ty_args, type PredicateEmittingRelation, super_combine_consts, super_combine_tys, type Upcast } from "../../../rustc_type_ir/relate/combine.ts";
import type { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { Ok } from "../../../std/result.ts";
import type { InferCtxt } from "../../decls.ts";
import { Obligation } from "../../traits/mod.ts";
import type { PredicateObligations } from "../../traits/mod.gen.ts";
import { DefineOpaqueTypes, ToTrace_Ty } from "../at.ts";
import { clone_TypeTrace, type SubregionOrigin, type TypeTrace } from "../mod.ts";
import * as gen from "./lattice.gen.ts";

export * from "./lattice.gen.ts";

export type LatticeOpKind = gen.LatticeOpKind;
export const LatticeOpKind = {
  ...gen.LatticeOpKind,

  // rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:39 invert
  invert(self: LatticeOpKind): LatticeOpKind {
    switch (self) {
      case "Glb":
        return LatticeOpKind.Lub;
      case "Lub":
        return LatticeOpKind.Glb;
    }
  },
};

/// A greatest lower bound" (common subtype) or least upper bound (common supertype).
// rustc-type: compiler/rustc_infer/src/infer/relate/lattice.rs:48 LatticeOp
// PORT: hand class (codegen `hand`): the field `param_env` is `param_env_` (`PredicateEmittingRelation::param_env`).
export class LatticeOp implements PredicateEmittingRelation {
  constructor(
    public infcx: InferCtxt,
    // Immutable fields
    public trace: TypeTrace,
    public param_env_: ParamEnv,
    // Mutable fields
    public kind: LatticeOpKind,
    public obligations: PredicateObligations,
  ) {}
}

export interface LatticeOp {
  // `impl TypeRelation<TyCtxt> for LatticeOp`
  cx(): TyCtxt;
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
  relate_ty_args(a_ty: Ty, b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, mk: (args: GenericArgs) => Ty): RelateResult<Ty>;
  relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
  tys(a: Ty, b: Ty): RelateResult<Ty>;
  regions(a: Region, b: Region): RelateResult<Region>;
  consts(a: Const, b: Const): RelateResult<Const>;
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
  // `impl LatticeOp` (lattice.rs:250)
  relate_bound(v: Ty, a: Ty, b: Ty): RelateResult<null>;
  // `impl PredicateEmittingRelation<InferCtxt> for LatticeOp`
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

// impl<'infcx, 'tcx> LatticeOp<'infcx, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:59 new
(LatticeOp as unknown as { new: (infcx: InferCtxt, trace: TypeTrace, param_env: ParamEnv, kind: LatticeOpKind) => LatticeOp }).new = function (
  infcx: InferCtxt,
  trace: TypeTrace,
  param_env: ParamEnv,
  kind: LatticeOpKind,
): LatticeOp {
  return new LatticeOp(infcx, trace, param_env, kind, []);
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:68 into_obligations
LatticeOp.prototype.into_obligations = function (this: LatticeOp): PredicateObligations {
  return this.obligations;
};

// impl<'tcx> TypeRelation<TyCtxt<'tcx>> for LatticeOp<'_, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:74 cx
LatticeOp.prototype.cx = function (this: LatticeOp): TyCtxt {
  return this.infcx.tcx;
};

/** (provided) `TypeRelation::relate` */
LatticeOp.prototype.relate = function <T>(this: LatticeOp, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:78 relate_ty_args
LatticeOp.prototype.relate_ty_args = function (
  this: LatticeOp,
  a_ty: Ty,
  b_ty: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  mk: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  const variances = interner(this.cx()).variances_of(def_id);
  return combine_ty_args(this.infcx, this, a_ty, b_ty, variances, a_args, b_args, (args) => mk(args));
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:91 relate_with_variance
LatticeOp.prototype.relate_with_variance = function <T>(this: LatticeOp, variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
  switch (variance) {
    case "Invariant": {
      const r = this.infcx.at(this.trace.cause, this.param_env_).eq_trace(DefineOpaqueTypes.Yes, clone_TypeTrace(this.trace), a, b, d);
      if (r.$ === "Err") return r;
      this.obligations.push(...r._0.into_obligations());
      return Ok(a);
    }
    case "Covariant":
      return this.relate(a, b, d);
    // FIXME(#41044) -- not correct, need test
    case "Bivariant":
      return Ok(a);
    case "Contravariant": {
      this.kind = LatticeOpKind.invert(this.kind);
      const res = this.relate(a, b, d);
      this.kind = LatticeOpKind.invert(this.kind);
      return res;
    }
  }
};

/// Relates two types using a given lattice.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:122 tys
LatticeOp.prototype.tys = function (this: LatticeOp, a: Ty, b: Ty): RelateResult<Ty> {
  if (a === b) {
    return Ok(a);
  }

  const infcx = this.infcx;

  a = infcx.shallow_resolve(a);
  b = infcx.shallow_resolve(b);

  const ak = a.kind();
  const bk = b.kind();
  const a_opaque = opaque_def_id(a);
  const b_opaque = opaque_def_id(b);
  // `if def_id.is_local() && !infcx.next_trait_solver()`, the guard of either alternative.
  const local_opaque = (def_id: DefId | undefined): boolean => def_id !== undefined && def_id.is_local() && !infcx.next_trait_solver();
  // If one side is known to be a variable and one is not,
  // create a variable (`v`) to represent the LUB. Make sure to
  // relate `v` to the non-type-variable first (by passing it
  // first to `relate_bound`). Otherwise, we would produce a
  // subtype obligation that must then be processed.
  //
  // Example: if the LHS is a type variable, and RHS is
  // `Box<i32>`, then we current compare `v` to the RHS first,
  // which will instantiate `v` with `Box<i32>`. Then when `v`
  // is compared to the LHS, we instantiate LHS with `Box<i32>`.
  // But if we did in reverse order, we would create a `v <:
  // LHS` (or vice versa) constraint and then instantiate
  // `v`. This would require further processing to achieve same
  // end-result; in particular, this screws up some of the logic
  // in coercion, which expects LUB to figure out that the LHS
  // is (e.g.) `Box<i32>`. A more obvious solution might be to
  // iterate on the subtype obligations that are returned, but I
  // think this suffices. -nmatsakis
  if (ak.$ === "Infer" && ak._0.$ === "TyVar") {
    const v = infcx.next_ty_var(this.trace.cause.span);
    const r = this.relate_bound(v, b, a);
    if (r.$ === "Err") return r;
    return Ok(v);
  } else if (bk.$ === "Infer" && bk._0.$ === "TyVar") {
    const v = infcx.next_ty_var(this.trace.cause.span);
    const r = this.relate_bound(v, a, b);
    if (r.$ === "Err") return r;
    return Ok(v);
  } else if (((ak.$ === "Alias" && ak._0 === "No") || (bk.$ === "Alias" && bk._0 === "No")) && infcx.next_trait_solver()) {
    // NOTE(khyperia): If this turns out to be possible, either the caller should
    // normalize the alias, or we should normalize the alias here. See the PR that
    // introduced this comment for how to do so, which normalizes aliases in other
    // relations.
    return span_bug(this.span(), "it should not be possible to encounter unnormalized aliases in lattice relation");
  } else if (a_opaque !== undefined && b_opaque !== undefined && DefId_eq(a_opaque, b_opaque)) {
    return super_combine_tys(infcx, this, a, b);
  } else if (local_opaque(a_opaque) || local_opaque(b_opaque)) {
    const goals = infcx.handle_opaque_type(a, b, this.span(), this.param_env());
    if (goals.$ === "Err") return goals;
    this.register_goals(goals._0);
    return Ok(a);
  } else {
    return super_combine_tys(infcx, this, a, b);
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:198 regions
LatticeOp.prototype.regions = function (this: LatticeOp, a: Region, b: Region): RelateResult<Region> {
  const origin: SubregionOrigin = { $: "Subtype", _0: clone_TypeTrace(this.trace) };
  const inner = this.infcx.inner;
  const constraints = inner.unwrap_region_constraints();
  switch (this.kind) {
    // GLB(&'static u8, &'a u8) == &RegionLUB('static, 'a) u8 == &'static u8
    case "Glb":
      return Ok(constraints.lub_regions(this.cx(), origin, a, b));

    // LUB(&'static u8, &'a u8) == &RegionGLB('static, 'a) u8 == &'a u8
    case "Lub":
      return Ok(constraints.glb_regions(this.cx(), origin, a, b));
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:216 consts
LatticeOp.prototype.consts = function (this: LatticeOp, a: Const, b: Const): RelateResult<Const> {
  return super_combine_consts(this.infcx, this, a, b);
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:224 binders
LatticeOp.prototype.binders = function <T>(this: LatticeOp, a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  // GLB/LUB of a binder and itself is just itself
  // PORT: derived `PartialEq` of `Binder`: the value by `T`'s `eq`, the interned `bound_vars` by pointer.
  if (d.eq(a.value, b.value) && a.bound_vars === b.bound_vars) {
    return Ok(a);
  }

  // debug!("binders(a={:?}, b={:?})", a, b);
  if (TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(a), d) || TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(b), d)) {
    // When higher-ranked types are involved, computing the GLB/LUB is
    // very challenging, switch to invariance. This is obviously
    // overly conservative but works ok in practice.
    const r = this.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, a, b, relate_Binder(d));
    if (r.$ === "Err") return r;
    return Ok(a);
  } else {
    const r = this.relate(Binder.skip_binder(a), Binder.skip_binder(b), d);
    if (r.$ === "Err") return r;
    return Ok(Binder.dummy(r._0, d));
  }
};

// impl<'infcx, 'tcx> LatticeOp<'infcx, 'tcx>

// Relates the type `v` to `a` and `b` such that `v` represents
// the LUB/GLB of `a` and `b` as appropriate.
//
// Subtle hack: ordering *may* be significant here. This method
// relates `v` to `a` first, which may help us to avoid unnecessary
// type variable obligations. See caller for details.
// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:257 relate_bound
LatticeOp.prototype.relate_bound = function (this: LatticeOp, v: Ty, a: Ty, b: Ty): RelateResult<null> {
  const at = this.infcx.at(this.trace.cause, this.param_env_);
  switch (this.kind) {
    case "Glb": {
      const r1 = at.sub(DefineOpaqueTypes.Yes, v, a, ToTrace_Ty);
      if (r1.$ === "Err") return r1;
      this.obligations.push(...r1._0.into_obligations());
      const r2 = at.sub(DefineOpaqueTypes.Yes, v, b, ToTrace_Ty);
      if (r2.$ === "Err") return r2;
      this.obligations.push(...r2._0.into_obligations());
      break;
    }
    case "Lub": {
      const r1 = at.sub(DefineOpaqueTypes.Yes, a, v, ToTrace_Ty);
      if (r1.$ === "Err") return r1;
      this.obligations.push(...r1._0.into_obligations());
      const r2 = at.sub(DefineOpaqueTypes.Yes, b, v, ToTrace_Ty);
      if (r2.$ === "Err") return r2;
      this.obligations.push(...r2._0.into_obligations());
      break;
    }
  }
  return Ok(null);
};

// impl<'tcx> PredicateEmittingRelation<InferCtxt<'tcx>> for LatticeOp<'_, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:274 span
LatticeOp.prototype.span = function (this: LatticeOp): Span {
  return this.trace.span();
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:278 param_env
LatticeOp.prototype.param_env = function (this: LatticeOp): ParamEnv {
  return this.param_env_;
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:282 register_predicates
LatticeOp.prototype.register_predicates = function <T>(this: LatticeOp, preds: Iterable<T>, upcast: Upcast<T, Predicate>): void {
  for (const pred of preds) {
    this.obligations.push(Obligation.new(this.infcx.tcx, clone_ObligationCause(this.trace.cause), this.param_env_, pred, as_obligation_upcast(upcast)));
  }
};

// rustc: compiler/rustc_infer/src/infer/relate/lattice.rs:291 register_goals
LatticeOp.prototype.register_goals = function (this: LatticeOp, goals: Iterable<Goal<Predicate>>): void {
  for (const goal of goals) {
    this.obligations.push(Obligation.new(this.infcx.tcx, clone_ObligationCause(this.trace.cause), goal.param_env, goal.predicate, upcast_from_self<Predicate>));
  }
};
