// Port of compiler/rustc_borrowck/src/type_check/relate_tys.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `NllTypeRelating` (generated class) implements rustc_type_ir's `TypeRelation` / `PredicateEmittingRelation`
// interfaces by prototype methods (precedent rustc_infer infer/relate/type_relating.ts): `T: Relate` parameters are the
// descriptor `d: Relate<T>` last; the provided `relate` forwards to `TypeRelation_provided.relate`; `impl
// IntoIterator<Item: Upcast<TyCtxt, Predicate>>` takes the items' upcast fn. `f: impl FnOnce(&mut Self, T) -> U` of
// `enter_forall` takes the relation as its first parameter (`this_`); `T: TypeFoldable` adds `d_T`.
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, GenericArgs, ParamEnv, Predicate, Region, Ty } from "../../rustc_middle/ty/decls.ts";
import type { Binder, PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { UniverseIndex, Variance } from "../../rustc_type_ir/lib.ts";
import { type Relate, type RelateResult, TypeRelation_provided, type VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import type { Upcast } from "../../rustc_type_ir/relate/combine.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { Goal } from "../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { UniverseInfo } from "../diagnostics/bound_region_errors.gen.ts";
import type { Locations } from "./mod.gen.ts";
import { TypeChecker } from "./mod.ts";
import { NllTypeRelating } from "./relate_tys.gen.ts";

export * from "./relate_tys.gen.ts";

declare module "./mod.ts" {
  interface TypeChecker {
    // relate_tys.rs:32 (lane bck-tc-b)
    relate_types(a: Ty, v: Variance, b: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution>;
    // relate_tys.rs:46 (lane bck-tc-b)
    eq_args(a: GenericArgs, b: GenericArgs, locations: Locations, category: ConstraintCategory): Result<null, NoSolution>;
  }
}

declare module "./relate_tys.gen.ts" {
  interface NllTypeRelating {
    // relate_tys.rs:101 (lane bck-tc-b)
    ambient_covariance(): boolean;
    // relate_tys.rs:108 (lane bck-tc-b)
    ambient_contravariance(): boolean;
    // relate_tys.rs:115 (lane bck-tc-b)
    relate_opaques(a: Ty, b: Ty): RelateResult<null>;
    // relate_tys.rs:188 (lane bck-tc-b)
    enter_forall<T, U>(binder: Binder<T>, f: (this_: NllTypeRelating, t: T) => U, d_T: TypeFoldable<T>): U;
    // relate_tys.rs:235 (lane bck-tc-b)
    instantiate_binder_with_existentials<T>(binder: Binder<T>, d_T: TypeFoldable<T>): T;
    // relate_tys.rs:272 (lane bck-tc-b)
    create_next_universe(): UniverseIndex;
    // relate_tys.rs:279 (lane bck-tc-b)
    next_existential_region_var(name: Symbol | undefined): Region;
    // relate_tys.rs:285 (lane bck-tc-b)
    next_placeholder_region(placeholder: PlaceholderRegion): Region;
    // relate_tys.rs:311 (lane bck-tc-b)
    push_outlives(sup: Region, sub: Region, info: VarianceDiagInfo): void;

    // `impl TypeRelation<TyCtxt> for NllTypeRelating` (relate_tys.rs:331)
    // relate_tys.rs:332 (lane bck-tc-b)
    cx(): TyCtxt;
    /** The provided `TypeRelation::relate` (`TypeRelation_provided.relate`). */
    relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
    // relate_tys.rs:336 (lane bck-tc-b)
    relate_ty_args(a_ty: Ty, b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _6: (args: GenericArgs) => Ty): RelateResult<Ty>;
    // relate_tys.rs:366 (lane bck-tc-b)
    relate_with_variance<T>(variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
    // relate_tys.rs:387 (lane bck-tc-b)
    tys(a: Ty, b: Ty): RelateResult<Ty>;
    // relate_tys.rs:457 (lane bck-tc-b)
    regions(a: Region, b: Region): RelateResult<Region>;
    // relate_tys.rs:477 (lane bck-tc-b)
    consts(a: Const, b: Const): RelateResult<Const>;
    // relate_tys.rs:490 (lane bck-tc-b)
    binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;

    // `impl PredicateEmittingRelation<InferCtxt> for NllTypeRelating` (relate_tys.rs:584)
    // relate_tys.rs:585 (lane bck-tc-b)
    span(): Span;
    // relate_tys.rs:589 (lane bck-tc-b)
    param_env(): ParamEnv;
    // relate_tys.rs:593 (lane bck-tc-b)
    register_predicates<T>(obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void;
    // relate_tys.rs:604 (lane bck-tc-b)
    register_goals(obligations: Iterable<Goal<Predicate>>): void;
  }
  namespace NllTypeRelating {
    // relate_tys.rs:84 (lane bck-tc-b)
    function new_(type_checker: TypeChecker, locations: Locations, category: ConstraintCategory, universe_info: UniverseInfo, ambient_variance: Variance): NllTypeRelating;
    export { new_ as new };
  }
}

// ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> ----

/// Adds sufficient constraints to ensure that `a R b` where `R` depends on `v`:
///
/// - "Covariant" `a <: b`
/// - "Invariant" `a == b`
/// - "Contravariant" `a :> b`
///
/// N.B., the type `a` is permitted to have unresolved inference
/// variables, but not the type `b`.
// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:32 relate_types (lane bck-tc-b)
TypeChecker.prototype.relate_types = function (this: TypeChecker, a: Ty, v: Variance, b: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
  return unported("rustc_borrowck::type_check::relate_tys::TypeChecker::relate_types");
};

/// Add sufficient constraints to ensure `a == b`. See also [Self::relate_types].
// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:46 eq_args (lane bck-tc-b)
TypeChecker.prototype.eq_args = function (this: TypeChecker, a: GenericArgs, b: GenericArgs, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
  return unported("rustc_borrowck::type_check::relate_tys::TypeChecker::eq_args");
};

// ---- impl<'a, 'b, 'tcx> NllTypeRelating<'a, 'b, 'tcx> ----

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:84 new (lane bck-tc-b)
(NllTypeRelating as unknown as { new: typeof NllTypeRelating.new }).new = function (
  type_checker: TypeChecker,
  locations: Locations,
  category: ConstraintCategory,
  universe_info: UniverseInfo,
  ambient_variance: Variance,
): NllTypeRelating {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::new");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:101 ambient_covariance (lane bck-tc-b)
NllTypeRelating.prototype.ambient_covariance = function (this: NllTypeRelating): boolean {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::ambient_covariance");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:108 ambient_contravariance (lane bck-tc-b)
NllTypeRelating.prototype.ambient_contravariance = function (this: NllTypeRelating): boolean {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::ambient_contravariance");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:115 relate_opaques (lane bck-tc-b)
NllTypeRelating.prototype.relate_opaques = function (this: NllTypeRelating, a: Ty, b: Ty): RelateResult<null> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::relate_opaques");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:188 enter_forall (lane bck-tc-b)
NllTypeRelating.prototype.enter_forall = function <T, U>(this: NllTypeRelating, binder: Binder<T>, f: (this_: NllTypeRelating, t: T) => U, d_T: TypeFoldable<T>): U {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::enter_forall");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:235 instantiate_binder_with_existentials (lane bck-tc-b)
NllTypeRelating.prototype.instantiate_binder_with_existentials = function <T>(this: NllTypeRelating, binder: Binder<T>, d_T: TypeFoldable<T>): T {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::instantiate_binder_with_existentials");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:272 create_next_universe (lane bck-tc-b)
NllTypeRelating.prototype.create_next_universe = function (this: NllTypeRelating): UniverseIndex {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::create_next_universe");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:279 next_existential_region_var (lane bck-tc-b)
NllTypeRelating.prototype.next_existential_region_var = function (this: NllTypeRelating, name: Symbol | undefined): Region {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::next_existential_region_var");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:285 next_placeholder_region (lane bck-tc-b)
NllTypeRelating.prototype.next_placeholder_region = function (this: NllTypeRelating, placeholder: PlaceholderRegion): Region {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::next_placeholder_region");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:311 push_outlives (lane bck-tc-b)
NllTypeRelating.prototype.push_outlives = function (this: NllTypeRelating, sup: Region, sub: Region, info: VarianceDiagInfo): void {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::push_outlives");
};

// ---- impl<'b, 'tcx> TypeRelation<TyCtxt<'tcx>> for NllTypeRelating<'_, 'b, 'tcx> ----

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:332 cx (lane bck-tc-b)
NllTypeRelating.prototype.cx = function (this: NllTypeRelating): TyCtxt {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::cx");
};

// (provided) `TypeRelation::relate`
NllTypeRelating.prototype.relate = function <T>(this: NllTypeRelating, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:336 relate_ty_args (lane bck-tc-b)
NllTypeRelating.prototype.relate_ty_args = function (
  this: NllTypeRelating,
  a_ty: Ty,
  b_ty: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  _6: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::relate_ty_args");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:366 relate_with_variance (lane bck-tc-b)
NllTypeRelating.prototype.relate_with_variance = function <T>(this: NllTypeRelating, variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::relate_with_variance");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:387 tys (lane bck-tc-b)
NllTypeRelating.prototype.tys = function (this: NllTypeRelating, a: Ty, b: Ty): RelateResult<Ty> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::tys");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:457 regions (lane bck-tc-b)
NllTypeRelating.prototype.regions = function (this: NllTypeRelating, a: Region, b: Region): RelateResult<Region> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::regions");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:477 consts (lane bck-tc-b)
NllTypeRelating.prototype.consts = function (this: NllTypeRelating, a: Const, b: Const): RelateResult<Const> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::consts");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:490 binders (lane bck-tc-b)
NllTypeRelating.prototype.binders = function <T>(this: NllTypeRelating, a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::binders");
};

// ---- impl<'b, 'tcx> PredicateEmittingRelation<InferCtxt<'tcx>> for NllTypeRelating<'_, 'b, 'tcx> ----

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:585 span (lane bck-tc-b)
NllTypeRelating.prototype.span = function (this: NllTypeRelating): Span {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::span");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:589 param_env (lane bck-tc-b)
NllTypeRelating.prototype.param_env = function (this: NllTypeRelating): ParamEnv {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::param_env");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:593 register_predicates (lane bck-tc-b)
NllTypeRelating.prototype.register_predicates = function <T>(this: NllTypeRelating, obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::register_predicates");
};

// stub: compiler/rustc_borrowck/src/type_check/relate_tys.rs:604 register_goals (lane bck-tc-b)
NllTypeRelating.prototype.register_goals = function (this: NllTypeRelating, obligations: Iterable<Goal<Predicate>>): void {
  return unported("rustc_borrowck::type_check::relate_tys::NllTypeRelating::register_goals");
};
