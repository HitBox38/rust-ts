// Port of compiler/rustc_infer/src/infer/outlives/test_type_match.rs (lane infer-canonical-outlives).
//
// PORT: `MatchAgainstHigherRankedOutlives` is the generated class (test_type_match.gen.ts); its `TypeRelation` impl and
// inherent methods are assigned onto the prototype, `new` is a static (`function new_ ..; export { new_ as new }`).
// Its `map` (`FxHashMap<BoundRegion, Region>`) is keyed by a plain struct: a `KeyedMap` on `intern_key` (PORTING §5). It
// is never iterated. Derived `PartialEq` of the interned `Ty` / `Region` / `Const` is `===`.
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import { Binder, type BoundRegion, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { TypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import { TypeError } from "../../../rustc_type_ir/error.ts";
import type { FallibleTypeFolder, TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { DebruijnIndex, INNERMOST } from "../../../rustc_type_ir/lib.ts";
import { fold_with_OutlivesClause, type OutlivesClause, try_fold_with_OutlivesClause, visit_with_OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import {
  interner,
  type Relate,
  relate_args_with_variances,
  relate_Ty,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../../../rustc_type_ir/relate.ts";
import type { Variance } from "../../../rustc_type_ir/decls.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { assert } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { VerifyIfEq } from "../region_constraints/mod.ts";
import * as region_constraints from "../region_constraints/mod.ts";
import { MatchAgainstHigherRankedOutlives } from "./test_type_match.gen.ts";

export * from "./test_type_match.gen.ts";

declare module "./test_type_match.gen.ts" {
  interface MatchAgainstHigherRankedOutlives extends TypeRelation {
    no_match<T>(): RelateResult<T>;
    bind(br: BoundRegion, value: Region): RelateResult<Region>;
  }
  namespace MatchAgainstHigherRankedOutlives {
    function new_(tcx: TyCtxt): MatchAgainstHigherRankedOutlives;
    export { new_ as new };
  }
}

/// Given a "verify-if-eq" type test like:
///
/// ```rust,ignore (pseudo-Rust)
/// exists<'a...> {
///     verify_if_eq(some_type, bound_region)
/// }
/// ```
///
/// and the type `test_ty` that the type test is being tested against,
/// returns:
///
/// * `None` if `some_type` cannot be made equal to `test_ty`,
///   no matter the values of the variables in `exists`.
/// * `Some(r)` with a suitable bound (typically the value of `bound_region`, modulo
///   any bound existential variables, which will be instantiated) for the
///   type under test.
///
/// NB: This function uses a simplistic, syntactic version of type equality.
/// In other words, it may spuriously return `None` even if the type-under-test
/// is in fact equal to `some_type`. In practice, though, this is used on types
/// that are either projections like `T::Item` or `T` and it works fine, but it
/// could have trouble when complex types with higher-ranked binders and the
/// like are used. This is a particular challenge since this function is invoked
/// very late in inference and hence cannot make use of the normal inference
/// machinery.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:39 extract_verify_if_eq
export function extract_verify_if_eq(tcx: TyCtxt, verify_if_eq_b: Binder<VerifyIfEq>, test_ty: Ty): Region | undefined {
  assert(!TypeVisitableExt.has_escaping_bound_vars(verify_if_eq_b, fold_Binder(fold_VerifyIfEq())), "assertion failed: !verify_if_eq_b.has_escaping_bound_vars()");
  const m = MatchAgainstHigherRankedOutlives.new(tcx);
  const verify_if_eq = Binder.skip_binder(verify_if_eq_b);
  // debug_assert!(
  //     !tcx.next_trait_solver_globally() || !(verify_if_eq.ty, test_ty).has_non_rigid_aliases()
  // );
  if (m.relate(verify_if_eq.ty, test_ty, relate_Ty).$ === "Err") {
    return undefined;
  }

  const bk = verify_if_eq.bound.kind();
  if (bk.$ === "ReBound") {
    const index_kind = bk._0;
    const br = bk._1;
    assert(index_kind.$ === "Bound" && index_kind._0 === INNERMOST, "assertion failed: matches!(index_kind, ty::BoundVarIndexKind::Bound(ty::INNERMOST))");
    const r = m.map.get(br);
    if (r !== undefined) {
      return r;
    } else {
      // If there is no mapping, then this region is unconstrained.
      // In that case, we escalate to `'static`.
      return tcx.lifetimes.re_static;
    }
  } else {
    // The region does not contain any bound variables, so we don't need
    // to do any instantiation.
    //
    // Example:
    //
    // for<'a> <T as Foo<'a>>::Item: 'b
    //
    // In this case, we've now matched and found a value for
    // `'a`, but it doesn't affect the bound `'b`.
    return verify_if_eq.bound;
  }
}

/// True if a (potentially higher-ranked) outlives
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:78 can_match_erased_ty
export function can_match_erased_ty(tcx: TyCtxt, outlives_clause: Binder<TypeOutlivesClause>, erased_ty: Ty): boolean {
  const d = fold_Binder(fold_TypeOutlivesClause);
  assert(!TypeVisitableExt.has_escaping_bound_vars(outlives_clause, d), "assertion failed: !outlives_clause.has_escaping_bound_vars()");
  const erased_outlives_clause = tcx.erase_and_anonymize_regions(outlives_clause, d);
  const outlives_ty = Binder.skip_binder(erased_outlives_clause)._0;
  if (outlives_ty === erased_ty) {
    // pointless micro-optimization
    return true;
  } else {
    return MatchAgainstHigherRankedOutlives.new(tcx).relate(outlives_ty, erased_ty, relate_Ty).$ === "Ok";
  }
}

// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:101 new
(MatchAgainstHigherRankedOutlives as unknown as { new: typeof MatchAgainstHigherRankedOutlives.new }).new = function (
  tcx: TyCtxt,
): MatchAgainstHigherRankedOutlives {
  return new MatchAgainstHigherRankedOutlives(tcx, INNERMOST, new KeyedMap<BoundRegion, Region>(intern_key));
};

/// Creates the "Error" variant that signals "no match".
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:112 no_match
MatchAgainstHigherRankedOutlives.prototype.no_match = function <T>(this: MatchAgainstHigherRankedOutlives): RelateResult<T> {
  return Err(TypeError.Mismatch);
};

/// Binds the pattern variable `br` to `value`; returns an `Err` if the pattern
/// is already bound to a different value.
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:119 bind
MatchAgainstHigherRankedOutlives.prototype.bind = function (this: MatchAgainstHigherRankedOutlives, br: BoundRegion, value: Region): RelateResult<Region> {
  const entry = this.map.get(br);
  if (entry !== undefined) {
    // Entry::Occupied
    if (entry === value) {
      return Ok(value);
    } else {
      return this.no_match();
    }
  } else {
    // Entry::Vacant
    this.map.set(br, value);
    return Ok(value);
  }
};

// ---- impl TypeRelation<TyCtxt> for MatchAgainstHigherRankedOutlives ----

// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:141 cx
MatchAgainstHigherRankedOutlives.prototype.cx = function (this: MatchAgainstHigherRankedOutlives): TyCtxt {
  return this.tcx;
};

// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:145 relate_ty_args
MatchAgainstHigherRankedOutlives.prototype.relate_ty_args = function (
  this: MatchAgainstHigherRankedOutlives,
  a_ty: Ty,
  _b_ty: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  _mk: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  const variances = interner(this.cx()).variances_of(def_id);
  const r = relate_args_with_variances(this, variances, a_args, b_args);
  if (r.$ === "Err") return r;
  return Ok(a_ty);
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:160 relate_with_variance
MatchAgainstHigherRankedOutlives.prototype.relate_with_variance = function <T>(
  this: MatchAgainstHigherRankedOutlives,
  variance: Variance,
  _info: VarianceDiagInfo,
  a: T,
  b: T,
  d: Relate<T>,
): RelateResult<T> {
  // FIXME(@lcnr): This is weird. We are ignoring the ambient variance
  // here, effectively treating everything as being in either a covariant
  // or contravariant context.
  //
  // Opaque types args have lifetime parameters.
  // We must not check them to be equal, as we never insert anything to make them so.
  if (variance !== "Bivariant") {
    return this.relate(a, b, d);
  } else {
    return Ok(a);
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:177 regions
MatchAgainstHigherRankedOutlives.prototype.regions = function (this: MatchAgainstHigherRankedOutlives, pattern: Region, value: Region): RelateResult<Region> {
  const pk = pattern.kind();
  if (pk.$ === "ReBound" && pk._0.$ === "Bound" && pk._0._0 === this.pattern_depth) {
    const br = pk._1;
    return this.bind(br, value);
  } else if (pattern === value) {
    return Ok(pattern);
  } else {
    return this.no_match();
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:194 tys
MatchAgainstHigherRankedOutlives.prototype.tys = function (this: MatchAgainstHigherRankedOutlives, pattern: Ty, value: Ty): RelateResult<Ty> {
  // FIXME(non_lifetime_binders): What to do here?
  const pk = pattern.kind();
  if (pk.$ === "Error" || pk.$ === "Bound") {
    // Unlike normal `TypeRelation` rules, `ty::Error` does not equal any type.
    return this.no_match();
  } else if (pattern === value) {
    return Ok(pattern);
  } else {
    return structurally_relate_tys(this, pattern, value);
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:207 consts
MatchAgainstHigherRankedOutlives.prototype.consts = function (this: MatchAgainstHigherRankedOutlives, pattern: Const, value: Const): RelateResult<Const> {
  if (pattern === value) {
    return Ok(pattern);
  } else {
    return structurally_relate_consts(this, pattern, value);
  }
};

// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_infer/src/infer/outlives/test_type_match.rs:220 binders
MatchAgainstHigherRankedOutlives.prototype.binders = function <T>(
  this: MatchAgainstHigherRankedOutlives,
  pattern: Binder<T>,
  value: Binder<T>,
  d: Relate<T>,
): RelateResult<Binder<T>> {
  DebruijnIndex.shift_in(field_mut(this, "pattern_depth"), 1);
  // PORT: the `?` returns before `shift_out` (as upstream).
  const r = this.relate(Binder.skip_binder(pattern), Binder.skip_binder(value), d);
  if (r.$ === "Err") return r;
  const result = Ok(Binder.rebind(pattern, r._0));
  DebruijnIndex.shift_out(field_mut(this, "pattern_depth"), 1);
  return result;
};

// (provided) `TypeRelation::relate`.
MatchAgainstHigherRankedOutlives.prototype.relate = function <T>(this: MatchAgainstHigherRankedOutlives, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// ---- D4 descriptors (generated impls) ----

/** `VerifyIfEq` (region_constraints/mod.rs, generated impls; built on use: init order). */
function fold_VerifyIfEq(): TypeFoldable<VerifyIfEq> {
  return {
    visit_with: region_constraints.visit_with_VerifyIfEq,
    try_fold_with: region_constraints.try_fold_with_VerifyIfEq,
    fold_with: region_constraints.fold_with_VerifyIfEq,
  };
}

const fold_TypeOutlivesClause: TypeFoldable<OutlivesClause<Ty>> = {
  visit_with: (s, v) => visit_with_OutlivesClause(s, v, fold_Ty.visit_with),
  try_fold_with: <E>(s: OutlivesClause<Ty>, f: FallibleTypeFolder<E>): Result<OutlivesClause<Ty>, E> =>
    try_fold_with_OutlivesClause(s, f, fold_Ty.try_fold_with),
  fold_with: (s, f) => fold_with_OutlivesClause(s, f, fold_Ty.fold_with),
};
