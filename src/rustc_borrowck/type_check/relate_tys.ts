// Port of compiler/rustc_borrowck/src/type_check/relate_tys.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `NllTypeRelating` (generated class) implements rustc_type_ir's `TypeRelation` / `PredicateEmittingRelation`
// interfaces by prototype methods (precedent rustc_infer infer/relate/type_relating.ts): `T: Relate` parameters are the
// descriptor `d: Relate<T>` last; the provided `relate` forwards to `TypeRelation_provided.relate`; `impl
// IntoIterator<Item: Upcast<TyCtxt, Predicate>>` takes the items' upcast fn. `f: impl FnOnce(&mut Self, T) -> U` of
// `enter_forall` takes the relation as its first parameter (`this_`); `T: TypeFoldable` adds `d_T`.
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import type { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import { Obligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import type { ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArgs, ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { FnMutDelegate } from "../../rustc_middle/ty/fold.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { bug, type ErrorGuaranteed, type Span, span_bug } from "../../rustc_span/lib.ts";
import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, type BoundConst, type BoundRegion, BoundRegionKind, type BoundTy, PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import { fold_regions, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { UniverseIndex, Variance } from "../../rustc_type_ir/lib.ts";
import {
  interner,
  type Relate,
  relate_args_invariantly,
  relate_GenericArgs,
  relate_Ty,
  type RelateResult,
  TypeRelation_provided,
  VarianceDiagInfo,
} from "../../rustc_type_ir/relate.ts";
import { combine_ty_args, super_combine_consts, super_combine_tys, type Upcast } from "../../rustc_type_ir/relate/combine.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Goal, type UpcastFn } from "../../rustc_type_ir/solve/mod.ts";
import { type Const, debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { IsRigid } from "../../rustc_type_ir/ty_kind.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { ToUniverseInfo_InstantiateOpaqueType, UniverseInfo } from "../diagnostics/bound_region_errors.ts";
import { clone_UniverseInfo } from "../diagnostics/bound_region_errors.gen.ts";
import { Locations, TypeChecker, TypeOp_InstantiateOpaqueType } from "./mod.ts";
import { NllTypeRelating } from "./relate_tys.gen.ts";

export * from "./relate_tys.gen.ts";

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

/** Whether `t` is `ty::Alias(_, ty::AliasTy { kind: ty::Opaque { .. }, .. })`. */
function is_opaque(t: Ty): boolean {
  return opaque_def_id(t) !== undefined;
}

/** The `def_id` of `ty::Alias(_, ty::AliasTy { kind: ty::Opaque { def_id }, .. })`, if `t` is one. */
function opaque_def_id(t: Ty): DefId | undefined {
  const k = t.kind();
  return k.$ === "Alias" && k._1.kind.$ === "Opaque" ? k._1.kind.def_id : undefined;
}

declare module "./mod.ts" {
  interface TypeChecker {
    // relate_tys.rs:32
    relate_types(a: Ty, v: Variance, b: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution>;
    // relate_tys.rs:46
    eq_args(a: GenericArgs, b: GenericArgs, locations: Locations, category: ConstraintCategory): Result<null, NoSolution>;
  }
}

declare module "./relate_tys.gen.ts" {
  interface NllTypeRelating {
    // relate_tys.rs:101
    ambient_covariance(): boolean;
    // relate_tys.rs:108
    ambient_contravariance(): boolean;
    // relate_tys.rs:115
    relate_opaques(a: Ty, b: Ty): RelateResult<null>;
    // relate_tys.rs:188
    enter_forall<T, U>(binder: Binder<T>, f: (this_: NllTypeRelating, t: T) => U, d_T: TypeFoldable<T>): U;
    // relate_tys.rs:235
    instantiate_binder_with_existentials<T>(binder: Binder<T>, d_T: TypeFoldable<T>): T;
    // relate_tys.rs:272
    create_next_universe(): UniverseIndex;
    // relate_tys.rs:279
    next_existential_region_var(name: Symbol | undefined): Region;
    // relate_tys.rs:285
    next_placeholder_region(placeholder: PlaceholderRegion): Region;
    // relate_tys.rs:311
    push_outlives(sup: Region, sub: Region, info: VarianceDiagInfo): void;

    // `impl TypeRelation<TyCtxt> for NllTypeRelating` (relate_tys.rs:331)
    // relate_tys.rs:332
    cx(): TyCtxt;
    /** The provided `TypeRelation::relate` (`TypeRelation_provided.relate`). */
    relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
    // relate_tys.rs:336
    relate_ty_args(a_ty: Ty, b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _6: (args: GenericArgs) => Ty): RelateResult<Ty>;
    // relate_tys.rs:366
    relate_with_variance<T>(variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
    // relate_tys.rs:387
    tys(a: Ty, b: Ty): RelateResult<Ty>;
    // relate_tys.rs:457
    regions(a: Region, b: Region): RelateResult<Region>;
    // relate_tys.rs:477
    consts(a: Const, b: Const): RelateResult<Const>;
    // relate_tys.rs:490
    binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;

    // `impl PredicateEmittingRelation<InferCtxt> for NllTypeRelating` (relate_tys.rs:584)
    // relate_tys.rs:585
    span(): Span;
    // relate_tys.rs:589
    param_env(): ParamEnv;
    // relate_tys.rs:593
    register_predicates<T>(obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void;
    // relate_tys.rs:604
    register_goals(obligations: Iterable<Goal<Predicate>>): void;
  }
  namespace NllTypeRelating {
    // relate_tys.rs:84
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
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:32 relate_types
TypeChecker.prototype.relate_types = function (this: TypeChecker, a: Ty, v: Variance, b: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
  const r = NllTypeRelating.new(this, locations, category, UniverseInfo.relate(a, b), v).relate(a, b, relate_Ty);
  if (r.$ === "Err") return Err(NO_SOLUTION);
  return Ok(null);
};

/// Add sufficient constraints to ensure `a == b`. See also [Self::relate_types].
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:46 eq_args
TypeChecker.prototype.eq_args = function (this: TypeChecker, a: GenericArgs, b: GenericArgs, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
  const r = NllTypeRelating.new(this, locations, category, UniverseInfo.other(), Variance.Invariant).relate(a, b, relate_GenericArgs);
  if (r.$ === "Err") return Err(NO_SOLUTION);
  return Ok(null);
};

// ---- impl<'a, 'b, 'tcx> NllTypeRelating<'a, 'b, 'tcx> ----

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:84 new
(NllTypeRelating as unknown as { new: typeof NllTypeRelating.new }).new = function (
  type_checker: TypeChecker,
  locations: Locations,
  category: ConstraintCategory,
  universe_info: UniverseInfo,
  ambient_variance: Variance,
): NllTypeRelating {
  return new NllTypeRelating(type_checker, locations, category, universe_info, ambient_variance, VarianceDiagInfo.None);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:101 ambient_covariance
NllTypeRelating.prototype.ambient_covariance = function (this: NllTypeRelating): boolean {
  switch (this.ambient_variance) {
    case "Covariant":
    case "Invariant":
      return true;
    case "Contravariant":
    case "Bivariant":
      return false;
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:108 ambient_contravariance
NllTypeRelating.prototype.ambient_contravariance = function (this: NllTypeRelating): boolean {
  switch (this.ambient_variance) {
    case "Contravariant":
    case "Invariant":
      return true;
    case "Covariant":
    case "Bivariant":
      return false;
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:115 relate_opaques
NllTypeRelating.prototype.relate_opaques = function (this: NllTypeRelating, a: Ty, b: Ty): RelateResult<null> {
  const infcx = this.type_checker.infcx;
  // debug_assert!(!infcx.next_trait_solver());
  // `handle_opaque_type` cannot handle subtyping, so to support subtyping
  // we instead eagerly generalize here. This is a bit of a mess but will go
  // away once we're using the new solver.
  //
  // Given `opaque rel B`, we create a new infer var `ty_vid` constrain it
  // by using `ty_vid rel B` and then finally and end by equating `ty_vid` to
  // the opaque.
  const enable_subtyping = (ty: Ty, opaque_is_expected: boolean): RelateResult<Ty> => {
    // We create the fresh inference variable in the highest universe.
    // In theory we could limit it to the highest universe in the args of
    // the opaque but that isn't really worth the effort.
    //
    // We'll make sure that the opaque type can actually name everything
    // in its hidden type later on.
    const ty_vid = infcx.next_ty_vid(this.span());
    const variance = opaque_is_expected ? this.ambient_variance : Variance.xform(this.ambient_variance, Variance.Contravariant);

    const r = this.type_checker.infcx.instantiate_ty_var(this, opaque_is_expected, ty_vid, variance, ty);
    if (r.$ === "Err") return r;
    const new_var = infcx.deeply_resolve_ignoring_regions(Ty.new_infer(infcx.tcx, { $: "TyVar", _0: ty_vid }), fold_Ty);

    // Any regions in this new type must be live everywhere, so we mark them as such.
    // (It may be that it only needs to be live where the opaque type itself is - which
    // includes defining use sites, but we'll be conservative and mark all points as live).
    // This is needed for Polonius, which doesn't propagate constraints
    // through dead regions. See issue #160669.
    //
    // We only do this in the root universe. Inside a binder these regions live in a higher
    // universe and their values contain placeholders; marking them live at every point
    // leaks those placeholders, turning the higher-ranked check into an error which then
    // suppresses the deferred opaque type diagnostics.
    if (infcx.universe() === UniverseIndex.ROOT) {
      const tcx = infcx.tcx;
      const liveness = this.type_checker.constraints.liveness_constraints;
      fold_regions(
        tcx,
        new_var,
        (r, _) => {
          const rk = r.kind();
          if (rk.$ === "ReVar") {
            const vid = rk._0;
            liveness.add_all_points(vid);
          }
          return r;
        },
        fold_Ty,
      );
    }

    return Ok(new_var);
  };

  let a_: Ty;
  let b_: Ty;
  if (is_opaque(a)) {
    const r = enable_subtyping(b, true);
    if (r.$ === "Err") return r;
    [a_, b_] = [a, r._0];
  } else if (is_opaque(b)) {
    const r = enable_subtyping(a, false);
    if (r.$ === "Err") return r;
    [a_, b_] = [r._0, b];
  } else {
    return unreachable(`internal error: entered unreachable code: expected at least one opaque type in \`relate_opaques\`, got ${display_Ty(a)} and ${display_Ty(b)}.`);
  }
  const goals = infcx.handle_opaque_type(a_, b_, this.span(), this.param_env());
  if (goals.$ === "Err") return goals;
  this.register_goals(goals._0);
  return Ok(null);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:188 enter_forall
NllTypeRelating.prototype.enter_forall = function <T, U>(this: NllTypeRelating, binder: Binder<T>, f: (this_: NllTypeRelating, t: T) => U, d_T: TypeFoldable<T>): U {
  let value: T;
  const inner = Binder.no_bound_vars(binder, d_T);
  if (inner !== undefined) {
    value = inner;
  } else {
    const infcx = this.type_checker.infcx;
    let lazy_universe: UniverseIndex | undefined = undefined;
    const delegate = new FnMutDelegate(
      (br: BoundRegion): Region => {
        // The first time this closure is called, create a
        // new universe for the placeholders we will make
        // from here out.
        let universe: UniverseIndex;
        if (lazy_universe !== undefined) {
          universe = lazy_universe;
        } else {
          universe = this.create_next_universe();
          lazy_universe = universe;
        }

        const placeholder = PlaceholderRegion.new(universe, br);
        // debug!(?placeholder);
        const placeholder_reg = this.next_placeholder_region(placeholder);
        // debug!(?placeholder_reg);

        return placeholder_reg;
      },
      (_bound_ty: BoundTy): Ty => {
        return unreachable("internal error: entered unreachable code: we only replace regions in nll_relate, not types");
      },
      (_bound_const: BoundConst): Const => {
        return unreachable("internal error: entered unreachable code: we only replace regions in nll_relate, not consts");
      },
    );

    value = infcx.tcx.replace_bound_vars_uncached(binder, delegate, d_T);
  }

  // debug!(?value);
  return f(this, value);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:235 instantiate_binder_with_existentials
NllTypeRelating.prototype.instantiate_binder_with_existentials = function <T>(this: NllTypeRelating, binder: Binder<T>, d_T: TypeFoldable<T>): T {
  const inner = Binder.no_bound_vars(binder, d_T);
  if (inner !== undefined) {
    return inner;
  }

  const infcx = this.type_checker.infcx;
  // PORT: `FxHashMap<ty::BoundRegion, ty::Region>` keys on the struct (`KeyedMap` by `intern_key`).
  const reg_map = new KeyedMap<BoundRegion, Region>(intern_key);
  const delegate = new FnMutDelegate(
    (br: BoundRegion): Region => {
      const ex_reg_var0 = reg_map.get(br);
      if (ex_reg_var0 !== undefined) {
        return ex_reg_var0;
      } else {
        const ex_reg_var = this.next_existential_region_var(BoundRegionKind.get_name(br.kind, infcx.infcx.tcx));
        // debug!(?ex_reg_var);
        reg_map.set(br, ex_reg_var);

        return ex_reg_var;
      }
    },
    (_bound_ty: BoundTy): Ty => {
      return unreachable("internal error: entered unreachable code: we only replace regions in nll_relate, not types");
    },
    (_bound_const: BoundConst): Const => {
      return unreachable("internal error: entered unreachable code: we only replace regions in nll_relate, not consts");
    },
  );

  const replaced = infcx.tcx.replace_bound_vars_uncached(binder, delegate, d_T);
  // debug!(?replaced);

  return replaced;
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:272 create_next_universe
NllTypeRelating.prototype.create_next_universe = function (this: NllTypeRelating): UniverseIndex {
  const universe = this.type_checker.infcx.create_next_universe();
  this.type_checker.constraints.universe_causes.set(universe, clone_UniverseInfo(this.universe_info));
  return universe;
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:279 next_existential_region_var
NllTypeRelating.prototype.next_existential_region_var = function (this: NllTypeRelating, name: Symbol | undefined): Region {
  const origin: NllRegionVariableOrigin = { $: "Existential", name };
  return this.type_checker.infcx.next_nll_region_var(origin, () => ({ $: "Existential", _0: name }));
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:285 next_placeholder_region
NllTypeRelating.prototype.next_placeholder_region = function (this: NllTypeRelating, placeholder: PlaceholderRegion): Region {
  const reg = this.type_checker.constraints.placeholder_region(this.type_checker.infcx.infcx, placeholder);

  let _reg_info: Symbol;
  const kind = placeholder.bound.kind;
  switch (kind.$) {
    case "Anon":
      _reg_info = sym.anon;
      break;
    case "Named":
      _reg_info = this.type_checker.tcx().item_name(kind._0);
      break;
    case "ClosureEnv":
      _reg_info = sym.env;
      break;
    case "NamedForPrinting":
      return bug("only used for pretty printing");
  }

  // PORT: the `if cfg!(debug_assertions) { .. reg_var_to_origin.insert(reg.as_var(), RegionCtxt::Placeholder(reg_info)) .. }`
  // block is compiled out (rustc ships without debug assertions; lib.ts's `next_region_var` precedent).

  return reg;
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:311 push_outlives
NllTypeRelating.prototype.push_outlives = function (this: NllTypeRelating, sup: Region, sub: Region, info: VarianceDiagInfo): void {
  const sub_ = this.type_checker.universal_regions.to_region_vid(sub);
  const sup_ = this.type_checker.universal_regions.to_region_vid(sup);
  this.type_checker.constraints.outlives_constraints.push({
    sup: sup_,
    sub: sub_,
    locations: this.locations,
    span: Locations.span(this.locations, this.type_checker.body),
    category: this.category,
    variance_info: info,
    from_closure: false,
  });
};

// ---- impl<'b, 'tcx> TypeRelation<TyCtxt<'tcx>> for NllTypeRelating<'_, 'b, 'tcx> ----

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:332 cx
NllTypeRelating.prototype.cx = function (this: NllTypeRelating): TyCtxt {
  return this.type_checker.infcx.tcx;
};

// (provided) `TypeRelation::relate`
NllTypeRelating.prototype.relate = function <T>(this: NllTypeRelating, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:336 relate_ty_args
NllTypeRelating.prototype.relate_ty_args = function (
  this: NllTypeRelating,
  a_ty: Ty,
  b_ty: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  _6: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  if (this.ambient_variance === Variance.Invariant) {
    // Avoid fetching the variance if we are in an invariant context,
    // slightly improves perf.
    const r = relate_args_invariantly(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  } else {
    const variances = interner(this.cx()).variances_of(def_id);
    return combine_ty_args(this.type_checker.infcx.infcx, this, a_ty, b_ty, variances, a_args, b_args, (_) => a_ty);
  }
};

// #[instrument(skip(self, info), level = "trace", ret)]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:366 relate_with_variance
NllTypeRelating.prototype.relate_with_variance = function <T>(this: NllTypeRelating, variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
  const old_ambient_variance = this.ambient_variance;
  this.ambient_variance = Variance.xform(this.ambient_variance, variance);
  this.ambient_variance_info = VarianceDiagInfo.xform(this.ambient_variance_info, info);

  // debug!(?self.ambient_variance);
  // In a bivariant context this always succeeds.
  const r: RelateResult<T> = this.ambient_variance === Variance.Bivariant ? Ok(a) : this.relate(a, b, d);

  this.ambient_variance = old_ambient_variance;

  return r;
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:387 tys
NllTypeRelating.prototype.tys = function (this: NllTypeRelating, a: Ty, b: Ty): RelateResult<Ty> {
  const infcx = this.type_checker.infcx;

  a = infcx.shallow_resolve(a);
  if (TypeVisitableExt.has_non_region_infer(b, fold_Ty)) panic(`unexpected inference var ${debug_Ty(b, PLAIN)}`);

  if (a === b) {
    return Ok(a);
  }

  const ak = a.kind();
  const bk = b.kind();
  const a_opaque = opaque_def_id(a);
  const b_opaque = opaque_def_id(b);
  if (bk.$ === "Infer" && bk._0.$ === "TyVar") {
    return span_bug(this.span(), "should not be relating type variables on the right in MIR typeck");
  } else if (((ak.$ === "Alias" && ak._0 === IsRigid.No) || (bk.$ === "Alias" && bk._0 === IsRigid.No)) && infcx.next_trait_solver()) {
    // NOTE(khyperia): If this turns out to be possible, either the caller should
    // normalize the alias, or we should normalize the alias here. See the PR that
    // introduced this comment for how to do so, which normalizes aliases in other
    // relations.
    return span_bug(this.span(), "it should not be possible to encounter unnormalized aliases in borrowck");
  } else if (ak.$ === "Infer" && ak._0.$ === "TyVar") {
    const a_vid = ak._0._0;
    const r = infcx.instantiate_ty_var(this, true, a_vid, this.ambient_variance, b);
    if (r.$ === "Err") return r;
  } else if (a_opaque !== undefined && b_opaque !== undefined && (DefId_eq(a_opaque, b_opaque) || infcx.next_trait_solver())) {
    const a_def_id = a_opaque;
    const r0 = super_combine_tys(infcx.infcx, this, a, b);
    let r: RelateResult<null> = r0.$ === "Err" ? r0 : Ok(null);
    if (r.$ === "Err") {
      const err = r._0;
      // This behavior is only there for the old solver, the new solver
      // shouldn't ever fail. Instead, it unconditionally emits an
      // alias-relate goal.
      assert(!this.type_checker.infcx.next_trait_solver(), "assertion failed: !self.type_checker.infcx.next_trait_solver()");
      this.cx().dcx().span_delayed_bug(this.span(), "failure to relate an opaque to itself should result in an error later on");
      r = a_def_id.is_local() ? this.relate_opaques(a, b) : Err(err);
    }
    if (r.$ === "Err") return r;
  } else if (
    // PORT: an or-pattern with a guard tries the guard for each alternative that matches.
    (a_opaque !== undefined && a_opaque.is_local() && !this.type_checker.infcx.next_trait_solver()) ||
    (b_opaque !== undefined && b_opaque.is_local() && !this.type_checker.infcx.next_trait_solver())
  ) {
    const r = this.relate_opaques(a, b);
    if (r.$ === "Err") return r;
  } else {
    // debug!(?a, ?b, ?self.ambient_variance);

    // Will also handle unification of `IntVar` and `FloatVar`.
    const r = super_combine_tys(this.type_checker.infcx.infcx, this, a, b);
    if (r.$ === "Err") return r;
  }

  return Ok(a);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:457 regions
NllTypeRelating.prototype.regions = function (this: NllTypeRelating, a: Region, b: Region): RelateResult<Region> {
  // debug!(?self.ambient_variance);

  if (this.ambient_covariance()) {
    // Covariant: &'a u8 <: &'b u8. Hence, `'a: 'b`.
    this.push_outlives(a, b, this.ambient_variance_info);
  }

  if (this.ambient_contravariance()) {
    // Contravariant: &'b u8 <: &'a u8. Hence, `'b: 'a`.
    this.push_outlives(b, a, this.ambient_variance_info);
  }

  return Ok(a);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:477 consts
NllTypeRelating.prototype.consts = function (this: NllTypeRelating, a: Const, b: Const): RelateResult<Const> {
  a = this.type_checker.infcx.shallow_resolve_const(a);
  if (TypeVisitableExt.has_non_region_infer(a, fold_Const)) panic(`unexpected inference var ${debug_Const(a, PLAIN)}`);
  if (TypeVisitableExt.has_non_region_infer(b, fold_Const)) panic(`unexpected inference var ${debug_Const(b, PLAIN)}`);

  return super_combine_consts(this.type_checker.infcx.infcx, this, a, b);
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:490 binders
NllTypeRelating.prototype.binders = function <T>(this: NllTypeRelating, a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  // We want that
  //
  // ```
  // for<'a> fn(&'a u32) -> &'a u32 <:
  //   fn(&'b u32) -> &'b u32
  // ```
  //
  // but not
  //
  // ```
  // fn(&'a u32) -> &'a u32 <:
  //   for<'b> fn(&'b u32) -> &'b u32
  // ```
  //
  // We therefore proceed as follows:
  //
  // - Instantiate binders on `b` universally, yielding a universe U1.
  // - Instantiate binders on `a` existentially in U1.

  // debug!(?self.ambient_variance);

  const a_inner = Binder.no_bound_vars(a, d);
  const b_inner = Binder.no_bound_vars(b, d);
  if (a_inner !== undefined && b_inner !== undefined) {
    // Fast path for the common case.
    const r = this.relate(a_inner, b_inner, d);
    if (r.$ === "Err") return r;
    return Ok(Binder.dummy(a_inner, d));
  }

  switch (this.ambient_variance) {
    case "Covariant": {
      // Covariance, so we want `for<..> A <: for<..> B` --
      // therefore we compare any instantiation of A (i.e., A
      // instantiated with existentials) against every
      // instantiation of B (i.e., B instantiated with
      // universals).

      // Note: the order here is important. Create the placeholders first, otherwise
      // we assign the wrong universe to the existential!
      const r = this.enter_forall(
        b,
        (this_, b) => {
          const a_ = this_.instantiate_binder_with_existentials(a, d);
          return this_.relate(a_, b, d);
        },
        d,
      );
      if (r.$ === "Err") return r;
      break;
    }

    case "Contravariant": {
      // Contravariance, so we want `for<..> A :> for<..> B` --
      // therefore we compare every instantiation of A (i.e., A
      // instantiated with universals) against any
      // instantiation of B (i.e., B instantiated with
      // existentials). Opposite of above.

      // Note: the order here is important. Create the placeholders first, otherwise
      // we assign the wrong universe to the existential!
      const r = this.enter_forall(
        a,
        (this_, a) => {
          const b_ = this_.instantiate_binder_with_existentials(b, d);
          return this_.relate(a, b_, d);
        },
        d,
      );
      if (r.$ === "Err") return r;
      break;
    }

    case "Invariant": {
      // Invariant, so we want `for<..> A == for<..> B` --
      // therefore we want `exists<..> A == for<..> B` and
      // `exists<..> B == for<..> A`.
      //
      // See the comment in `fn Equate::binders` for more details.

      // Note: the order here is important. Create the placeholders first, otherwise
      // we assign the wrong universe to the existential!
      const r1 = this.enter_forall(
        b,
        (this_, b) => {
          const a_ = this_.instantiate_binder_with_existentials(a, d);
          return this_.relate(a_, b, d);
        },
        d,
      );
      if (r1.$ === "Err") return r1;
      // Note: the order here is important. Create the placeholders first, otherwise
      // we assign the wrong universe to the existential!
      const r2 = this.enter_forall(
        a,
        (this_, a) => {
          const b_ = this_.instantiate_binder_with_existentials(b, d);
          return this_.relate(a, b_, d);
        },
        d,
      );
      if (r2.$ === "Err") return r2;
      break;
    }

    case "Bivariant":
      break;
  }

  return Ok(a);
};

// ---- impl<'b, 'tcx> PredicateEmittingRelation<InferCtxt<'tcx>> for NllTypeRelating<'_, 'b, 'tcx> ----

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:585 span
NllTypeRelating.prototype.span = function (this: NllTypeRelating): Span {
  return Locations.span(this.locations, this.type_checker.body);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:589 param_env
NllTypeRelating.prototype.param_env = function (this: NllTypeRelating): ParamEnv {
  return this.type_checker.infcx.param_env;
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:593 register_predicates
NllTypeRelating.prototype.register_predicates = function <T>(this: NllTypeRelating, obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void {
  const tcx = this.cx();
  const param_env = this.param_env();
  const goals: Goal<Predicate>[] = [];
  for (const to_pred of obligations) goals.push(Goal.new(interner(tcx), param_env, to_pred, upcast as unknown as UpcastFn<T, Predicate>));
  this.register_goals(goals);
};

// rustc: compiler/rustc_borrowck/src/type_check/relate_tys.rs:604 register_goals
NllTypeRelating.prototype.register_goals = function (this: NllTypeRelating, obligations: Iterable<Goal<Predicate>>): void {
  const obligations_: PredicateObligations = [];
  for (const goal of obligations) {
    obligations_.push(Obligation.new(this.cx(), ObligationCause.dummy_with_span(this.span()), goal.param_env, goal.predicate, upcast_from_self<Predicate>));
  }
  const _: Result<null, ErrorGuaranteed> = this.type_checker.fully_perform_op(
    this.locations,
    this.category,
    {
      obligations: obligations_,
      // These fields are filled in during execution of the operation
      base_universe: undefined,
      region_constraints: undefined,
    },
    TypeOp_InstantiateOpaqueType,
    ToUniverseInfo_InstantiateOpaqueType,
  );
};
