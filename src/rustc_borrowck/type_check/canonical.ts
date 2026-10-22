// Port of compiler/rustc_borrowck/src/type_check/canonical.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: trait-bound parameters are impl tables / descriptors after the upstream parameters: `Op: TypeOp<Output = R>` is
// `TypeOp_Op: TypeOp<Op, R, E>` (`E` = `Op::ErrorInfo`) and `Op::ErrorInfo: ToUniverseInfo` is
// `ToUniverseInfo_E: ToUniverseInfo<E>`; `T: TypeFoldable` is `d_T`; `T: Normalizable + fmt::Display` is
// `d_T: Normalizable<T>` + `display_T`; `location: impl NormalizeLocation` is `location: L` +
// `NormalizeLocation_L: NormalizeLocation<L>`; `impl Upcast<TyCtxt, ty::Clause>` items take their upcast fn
// (`upcast_C`). `R: fmt::Debug` / `+ fmt::Debug` bounds serve only `debug!` and are dropped.
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import type { Canonical } from "../../rustc_middle/infer/canonical.ts";
import type { Body, ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import type { Clause, Ty } from "../../rustc_middle/ty/decls.ts";
import type { InstantiatedClauses } from "../../rustc_middle/ty/mod.ts";
import type { PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import type { UserType } from "../../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { TypeOp } from "../../rustc_trait_selection/traits/query/type_op/mod.ts";
import type { Normalizable } from "../../rustc_trait_selection/traits/query/type_op/normalize.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { Upcast } from "../../rustc_type_ir/relate/combine.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { ToUniverseInfo } from "../diagnostics/bound_region_errors.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { Locations, MirTypeckRegionConstraints } from "./mod.gen.ts";
import { type NormalizeLocation, TypeChecker } from "./mod.ts";

declare module "./mod.ts" {
  interface TypeChecker {
    // canonical.rs:90 (lane bck-tc-b)
    fully_perform_op<R, Op, E>(locations: Locations, category: ConstraintCategory, op: Op, TypeOp_Op: TypeOp<Op, R, E>, ToUniverseInfo_E: ToUniverseInfo<E>): Result<R, ErrorGuaranteed>;
    // canonical.rs:113 (lane bck-tc-b)
    instantiate_canonical<T>(span: Span, canonical: Canonical<T>, d_T: TypeFoldable<T>): T;
    // canonical.rs:126 (lane bck-tc-b)
    prove_trait_ref(trait_ref: TraitRef, locations: Locations, category: ConstraintCategory): void;
    // canonical.rs:143 (lane bck-tc-b)
    normalize_and_prove_instantiated_clauses(def_id: DefId, instantiated_clauses: InstantiatedClauses, locations: Locations): void;
    // canonical.rs:157 (lane bck-tc-b)
    prove_clauses<C>(clauses: Iterable<C>, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void;
    // canonical.rs:169 (lane bck-tc-b)
    prove_clause<C>(clause: C, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void;
    // canonical.rs:185 (lane bck-tc-b)
    normalize<T, L>(value: Unnormalized<T>, location: L, d_T: Normalizable<T>, display_T: (v: T) => string, NormalizeLocation_L: NormalizeLocation<L>): T;
    // canonical.rs:196 (lane bck-tc-b)
    deeply_normalize<T, L>(value: Unnormalized<T>, location: L, d_T: Normalizable<T>, display_T: (v: T) => string, NormalizeLocation_L: NormalizeLocation<L>): Result<T, ErrorGuaranteed>;
    // canonical.rs:212 (lane bck-tc-b)
    normalize_with_category<T, L>(
      value: Unnormalized<T>,
      location: L,
      category: ConstraintCategory,
      d_T: Normalizable<T>,
      display_T: (v: T) => string,
      NormalizeLocation_L: NormalizeLocation<L>,
    ): T;
    // canonical.rs:231 (lane bck-tc-b)
    struct_tail<L>(ty: Ty, location: L, NormalizeLocation_L: NormalizeLocation<L>): Ty;
    // canonical.rs:249 (lane bck-tc-b)
    ascribe_user_type(mir_ty: Ty, user_ty: UserType, span: Span): void;
    // canonical.rs:268 (lane bck-tc-b)
    ascribe_user_type_skip_wf(mir_ty: Ty, user_ty: UserType, span: Span): void;
  }
}

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:21 fully_perform_op_raw (lane bck-tc-b)
export function fully_perform_op_raw<R, Op, E>(
  infcx: BorrowckInferCtxt,
  body: Body,
  universal_regions: UniversalRegions,
  region_bound_pairs: RegionBoundPairs,
  known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
  constraints: MirTypeckRegionConstraints,
  locations: Locations,
  category: ConstraintCategory,
  op: Op,
  TypeOp_Op: TypeOp<Op, R, E>,
  ToUniverseInfo_E: ToUniverseInfo<E>,
): Result<R, ErrorGuaranteed> {
  return unported("rustc_borrowck::type_check::canonical::fully_perform_op_raw");
}

// ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> ----

/// Given some operation `op` that manipulates types, proves
/// predicates, or otherwise uses the inference context, executes
/// `op` and then executes all the further obligations that `op`
/// returns. This will yield a set of outlives constraints amongst
/// regions which are extracted and stored as having occurred at
/// `locations`.
///
/// **Any `rustc_infer::infer` operations that might generate region
/// constraints should occur within this method so that those
/// constraints can be properly localized!**
// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:90 fully_perform_op (lane bck-tc-b)
TypeChecker.prototype.fully_perform_op = function <R, Op, E>(
  this: TypeChecker,
  locations: Locations,
  category: ConstraintCategory,
  op: Op,
  TypeOp_Op: TypeOp<Op, R, E>,
  ToUniverseInfo_E: ToUniverseInfo<E>,
): Result<R, ErrorGuaranteed> {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::fully_perform_op");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:113 instantiate_canonical (lane bck-tc-b)
TypeChecker.prototype.instantiate_canonical = function <T>(this: TypeChecker, span: Span, canonical: Canonical<T>, d_T: TypeFoldable<T>): T {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::instantiate_canonical");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:126 prove_trait_ref (lane bck-tc-b)
TypeChecker.prototype.prove_trait_ref = function (this: TypeChecker, trait_ref: TraitRef, locations: Locations, category: ConstraintCategory): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::prove_trait_ref");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:143 normalize_and_prove_instantiated_clauses (lane bck-tc-b)
TypeChecker.prototype.normalize_and_prove_instantiated_clauses = function (
  this: TypeChecker,
  def_id: DefId,
  instantiated_clauses: InstantiatedClauses,
  locations: Locations,
): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::normalize_and_prove_instantiated_clauses");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:157 prove_clauses (lane bck-tc-b)
TypeChecker.prototype.prove_clauses = function <C>(this: TypeChecker, clauses: Iterable<C>, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::prove_clauses");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:169 prove_clause (lane bck-tc-b)
TypeChecker.prototype.prove_clause = function <C>(this: TypeChecker, clause: C, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::prove_clause");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:185 normalize (lane bck-tc-b)
TypeChecker.prototype.normalize = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): T {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::normalize");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:196 deeply_normalize (lane bck-tc-b)
TypeChecker.prototype.deeply_normalize = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): Result<T, ErrorGuaranteed> {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::deeply_normalize");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:212 normalize_with_category (lane bck-tc-b)
TypeChecker.prototype.normalize_with_category = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  category: ConstraintCategory,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): T {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::normalize_with_category");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:231 struct_tail (lane bck-tc-b)
TypeChecker.prototype.struct_tail = function <L>(this: TypeChecker, ty: Ty, location: L, NormalizeLocation_L: NormalizeLocation<L>): Ty {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::struct_tail");
};

// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:249 ascribe_user_type (lane bck-tc-b)
TypeChecker.prototype.ascribe_user_type = function (this: TypeChecker, mir_ty: Ty, user_ty: UserType, span: Span): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::ascribe_user_type");
};

/// *Incorrectly* skips the WF checks we normally do in `ascribe_user_type`.
///
/// FIXME(#104478, #104477): This is a hack for backward-compatibility.
// stub: compiler/rustc_borrowck/src/type_check/canonical.rs:268 ascribe_user_type_skip_wf (lane bck-tc-b)
TypeChecker.prototype.ascribe_user_type_skip_wf = function (this: TypeChecker, mir_ty: Ty, user_ty: UserType, span: Span): void {
  return unported("rustc_borrowck::type_check::canonical::TypeChecker::ascribe_user_type_skip_wf");
};
