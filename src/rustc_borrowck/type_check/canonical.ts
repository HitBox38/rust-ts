// Port of compiler/rustc_borrowck/src/type_check/canonical.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: trait-bound parameters are impl tables / descriptors after the upstream parameters: `Op: TypeOp<Output = R>` is
// `TypeOp_Op: TypeOp<Op, R, E>` (`E` = `Op::ErrorInfo`) and `Op::ErrorInfo: ToUniverseInfo` is
// `ToUniverseInfo_E: ToUniverseInfo<E>`; `T: TypeFoldable` is `d_T`; `T: Normalizable + fmt::Display` is
// `d_T: Normalizable<T>` + `display_T`; `location: impl NormalizeLocation` is `location: L` +
// `NormalizeLocation_L: NormalizeLocation<L>`; `impl Upcast<TyCtxt, ty::Clause>` items take their upcast fn
// (`upcast_C`). `R: fmt::Debug` / `+ fmt::Debug` bounds serve only `debug!` and are dropped.
// PORT: `&BorrowckInferCtxt` passed where upstream auto-derefs to `&InferCtxt` (`op.fully_perform(infcx, ..)`) is
// `infcx.infcx`; `#[instrument]` / `debug!` stay comments (tracing is off in the oracle).
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import type { Canonical } from "../../rustc_middle/infer/canonical.ts";
import { type Body, ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { debug_NoSolution } from "../../rustc_middle/traits/query.ts";
import type { Clause, Ty } from "../../rustc_middle/ty/decls.ts";
import type { InstantiatedClauses } from "../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_ClauseKind, Predicate_upcast_from_Clause, type PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import { display_Clause, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { UserType } from "../../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { bug, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { fold_unit } from "../../rustc_trait_selection/solve/inspect/analyse.ts";
import { type AscribeUserType, QueryTypeOp_AscribeUserType } from "../../rustc_trait_selection/traits/query/type_op/ascribe_user_type.ts";
import { CustomTypeOp, TypeOp_CustomTypeOp } from "../../rustc_trait_selection/traits/query/type_op/custom.ts";
import { type TypeOp, TypeOp_ParamEnvAnd } from "../../rustc_trait_selection/traits/query/type_op/mod.ts";
import { type Normalizable, Normalizable_Clause, Normalizable_Ty, type Normalize, QueryTypeOp_Normalize } from "../../rustc_trait_selection/traits/query/type_op/normalize.ts";
import { type ProvePredicate, QueryTypeOp_ProvePredicate } from "../../rustc_trait_selection/traits/query/type_op/prove_predicate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { ClausePolarity, type TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import type { Upcast } from "../../rustc_type_ir/relate/combine.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import {
  type ToUniverseInfo,
  ToUniverseInfo_CanonicalTypeOpAscribeUserTypeGoal,
  ToUniverseInfo_CanonicalTypeOpNormalizeGoal,
  ToUniverseInfo_CanonicalTypeOpProvePredicateGoal,
  ToUniverseInfo_never,
} from "../diagnostics/bound_region_errors.ts";
import { clone_UniverseInfo } from "../diagnostics/bound_region_errors.gen.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { ConstraintConversion } from "./constraint_conversion.gen.ts";
import type { MirTypeckRegionConstraints } from "./mod.gen.ts";
import { Locations, type NormalizeLocation, NormalizeLocation_Locations, TypeChecker } from "./mod.ts";

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

declare module "./mod.ts" {
  interface TypeChecker {
    // canonical.rs:90
    fully_perform_op<R, Op, E>(locations: Locations, category: ConstraintCategory, op: Op, TypeOp_Op: TypeOp<Op, R, E>, ToUniverseInfo_E: ToUniverseInfo<E>): Result<R, ErrorGuaranteed>;
    // canonical.rs:113
    instantiate_canonical<T>(span: Span, canonical: Canonical<T>, d_T: TypeFoldable<T>): T;
    // canonical.rs:126
    prove_trait_ref(trait_ref: TraitRef, locations: Locations, category: ConstraintCategory): void;
    // canonical.rs:143
    normalize_and_prove_instantiated_clauses(def_id: DefId, instantiated_clauses: InstantiatedClauses, locations: Locations): void;
    // canonical.rs:157
    prove_clauses<C>(clauses: Iterable<C>, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void;
    // canonical.rs:169
    prove_clause<C>(clause: C, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void;
    // canonical.rs:185
    normalize<T, L>(value: Unnormalized<T>, location: L, d_T: Normalizable<T>, display_T: (v: T) => string, NormalizeLocation_L: NormalizeLocation<L>): T;
    // canonical.rs:196
    deeply_normalize<T, L>(value: Unnormalized<T>, location: L, d_T: Normalizable<T>, display_T: (v: T) => string, NormalizeLocation_L: NormalizeLocation<L>): Result<T, ErrorGuaranteed>;
    // canonical.rs:212
    normalize_with_category<T, L>(
      value: Unnormalized<T>,
      location: L,
      category: ConstraintCategory,
      d_T: Normalizable<T>,
      display_T: (v: T) => string,
      NormalizeLocation_L: NormalizeLocation<L>,
    ): T;
    // canonical.rs:231
    struct_tail<L>(ty: Ty, location: L, NormalizeLocation_L: NormalizeLocation<L>): Ty;
    // canonical.rs:249
    ascribe_user_type(mir_ty: Ty, user_ty: UserType, span: Span): void;
    // canonical.rs:268
    ascribe_user_type_skip_wf(mir_ty: Ty, user_ty: UserType, span: Span): void;
  }
}

// #[instrument(skip(infcx, constraints, op), level = "trace")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:21 fully_perform_op_raw
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
  const old_universe = infcx.universe();

  const r = TypeOp_Op.fully_perform(op, infcx.infcx, infcx.root_def_id, Locations.span(locations, body));
  if (r.$ === "Err") return r;
  const { output, constraints: query_constraints, error_info } = r._0;
  // PORT: the `if cfg!(debug_assertions) { .. take_and_reset_region_constraints .. panic!("leftover region
  // constraints") }` block is compiled out (rustc ships without debug assertions).

  // debug!(?output, ?query_constraints);

  if (query_constraints !== undefined) {
    const data = query_constraints;
    ConstraintConversion.new(
      infcx,
      universal_regions,
      region_bound_pairs,
      known_type_outlives_obligations,
      locations,
      Locations.span(locations, body),
      category,
      constraints,
    ).convert_all(data);
  }

  // If the query has created new universes and errors are going to be emitted, register the
  // cause of these new universes for improved diagnostics.
  const universe = infcx.universe();
  if (old_universe !== universe && error_info !== undefined) {
    const universe_info = ToUniverseInfo_E.to_universe_info(error_info, old_universe);
    for (let u = UniverseIndex.as_u32(old_universe) + 1; u <= UniverseIndex.as_u32(universe); u++) {
      constraints.universe_causes.set(UniverseIndex.from_u32(u), clone_UniverseInfo(universe_info));
    }
  }

  return Ok(output);
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
// #[instrument(skip(self, op), level = "trace")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:90 fully_perform_op
TypeChecker.prototype.fully_perform_op = function <R, Op, E>(
  this: TypeChecker,
  locations: Locations,
  category: ConstraintCategory,
  op: Op,
  TypeOp_Op: TypeOp<Op, R, E>,
  ToUniverseInfo_E: ToUniverseInfo<E>,
): Result<R, ErrorGuaranteed> {
  return fully_perform_op_raw(
    this.infcx,
    this.body,
    this.universal_regions,
    this.region_bound_pairs,
    this.known_type_outlives_obligations,
    this.constraints,
    locations,
    category,
    op,
    TypeOp_Op,
    ToUniverseInfo_E,
  );
};

// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:113 instantiate_canonical
TypeChecker.prototype.instantiate_canonical = function <T>(this: TypeChecker, span: Span, canonical: Canonical<T>, d_T: TypeFoldable<T>): T {
  const [instantiated, _] = this.infcx.instantiate_canonical(span, canonical, d_T);
  return instantiated;
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:126 prove_trait_ref
TypeChecker.prototype.prove_trait_ref = function (this: TypeChecker, trait_ref: TraitRef, locations: Locations, category: ConstraintCategory): void {
  this.prove_clause<ClauseKind>(
    { $: "Trait", _0: { trait_ref, polarity: ClausePolarity.Positive } },
    locations,
    category,
    Clause_upcast_from_ClauseKind,
  );
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:143 normalize_and_prove_instantiated_clauses
TypeChecker.prototype.normalize_and_prove_instantiated_clauses = function (
  this: TypeChecker,
  def_id: DefId,
  instantiated_clauses: InstantiatedClauses,
  locations: Locations,
): void {
  for (const [clause0, span] of instantiated_clauses.into_iter()) {
    // debug!(?span, ?clause);
    const category: ConstraintCategory = { $: "Predicate", _0: span, _1: def_id };
    const clause = this.normalize_with_category(clause0, locations, category, Normalizable_Clause, display_Clause, NormalizeLocation_Locations);
    this.prove_clause(clause, locations, category, upcast_from_self as Upcast<Clause, Clause>);
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:157 prove_clauses
TypeChecker.prototype.prove_clauses = function <C>(this: TypeChecker, clauses: Iterable<C>, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void {
  for (const clause of clauses) {
    this.prove_clause(clause, locations, category, upcast_C);
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:169 prove_clause
TypeChecker.prototype.prove_clause = function <C>(this: TypeChecker, clause: C, locations: Locations, category: ConstraintCategory, upcast_C: Upcast<C, Clause>): void {
  const param_env = this.infcx.param_env;
  // Upcast to a `Clause`, then to a `Predicate`.
  const predicate = Predicate_upcast_from_Clause(upcast_C(clause, this.tcx()), this.tcx());
  const _: Result<null, ErrorGuaranteed> = this.fully_perform_op(
    locations,
    category,
    param_env.and<ProvePredicate>({ predicate }),
    TypeOp_ParamEnvAnd(QueryTypeOp_ProvePredicate),
    ToUniverseInfo_CanonicalTypeOpProvePredicateGoal,
  );
};

// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:185 normalize
TypeChecker.prototype.normalize = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): T {
  return this.normalize_with_category(value, location, ConstraintCategory.Boring, d_T, display_T, NormalizeLocation_L);
};

// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:196 deeply_normalize
TypeChecker.prototype.deeply_normalize = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): Result<T, ErrorGuaranteed> {
  return this.fully_perform_op(
    NormalizeLocation_L.to_locations(location),
    ConstraintCategory.Boring,
    this.infcx.param_env.and<Normalize<T>>({ value }),
    TypeOp_ParamEnvAnd(QueryTypeOp_Normalize(d_T)),
    ToUniverseInfo_CanonicalTypeOpNormalizeGoal(display_T, d_T),
  );
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:212 normalize_with_category
TypeChecker.prototype.normalize_with_category = function <T, L>(
  this: TypeChecker,
  value: Unnormalized<T>,
  location: L,
  category: ConstraintCategory,
  d_T: Normalizable<T>,
  display_T: (v: T) => string,
  NormalizeLocation_L: NormalizeLocation<L>,
): T {
  const param_env = this.infcx.param_env;
  const result: Result<T, ErrorGuaranteed> = this.fully_perform_op(
    NormalizeLocation_L.to_locations(location),
    category,
    param_env.and<Normalize<T>>({ value }),
    TypeOp_ParamEnvAnd(QueryTypeOp_Normalize(d_T)),
    ToUniverseInfo_CanonicalTypeOpNormalizeGoal(display_T, d_T),
  );
  // PORT: `unwrap_or(value.skip_norm_wip())` evaluates its argument eagerly (a plain field read).
  const or = Unnormalized.skip_norm_wip(value);
  return result.$ === "Ok" ? result._0 : or;
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:231 struct_tail
TypeChecker.prototype.struct_tail = function <L>(this: TypeChecker, ty: Ty, location: L, NormalizeLocation_L: NormalizeLocation<L>): Ty {
  const tcx = this.tcx();
  const body = this.body;

  const cause = ObligationCause.misc(Locations.span(NormalizeLocation_L.to_locations(location), body), body.source.def_id().expect_local());

  const normalize = (ty: Unnormalized<Ty>): Ty => this.normalize(ty, location, Normalizable_Ty, display_Ty, NormalizeLocation_L);
  return tcx.struct_tail_raw(ty, cause, normalize, () => {});
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:249 ascribe_user_type
TypeChecker.prototype.ascribe_user_type = function (this: TypeChecker, mir_ty: Ty, user_ty: UserType, span: Span): void {
  const _: Result<null, ErrorGuaranteed> = this.fully_perform_op(
    { $: "All", _0: span },
    ConstraintCategory.Boring,
    this.infcx.param_env.and<AscribeUserType>({ mir_ty, user_ty }),
    TypeOp_ParamEnvAnd(QueryTypeOp_AscribeUserType),
    ToUniverseInfo_CanonicalTypeOpAscribeUserTypeGoal,
  );
};

/// *Incorrectly* skips the WF checks we normally do in `ascribe_user_type`.
///
/// FIXME(#104478, #104477): This is a hack for backward-compatibility.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/canonical.rs:268 ascribe_user_type_skip_wf
TypeChecker.prototype.ascribe_user_type_skip_wf = function (this: TypeChecker, mir_ty: Ty, user_ty0: UserType, span: Span): void {
  if (user_ty0.kind.$ !== "Ty") return bug();
  const user_ty = user_ty0.kind._0;

  // A fast path for a common case with closure input/output types.
  if (user_ty.kind().$ === "Infer") {
    unwrap_result(this.eq_types(user_ty, mir_ty, { $: "All", _0: span }, ConstraintCategory.Boring), debug_NoSolution);
    return;
  }

  // This is a hack. `body.local_decls` are not necessarily normalized in the old
  // solver due to not deeply normalizing in writeback. So we must re-normalize here.
  //
  // I am not sure of a test case where this actually matters. There is a similar
  // hack in `equate_inputs_and_outputs` which does have associated test cases.
  if (!this.infcx.next_trait_solver()) {
    mir_ty = this.normalize(Unnormalized.new_wip(mir_ty), { $: "All", _0: span } as Locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
  }

  const cause = ObligationCause.dummy_with_span(span);
  const param_env = this.infcx.param_env;
  const _: Result<null, ErrorGuaranteed> = this.fully_perform_op(
    { $: "All", _0: span },
    ConstraintCategory.Boring,
    CustomTypeOp.new<null>((ocx) => {
      // The `AscribeUserType` query would normally emit a wf
      // obligation for the unnormalized user_ty here. This is
      // where the "incorrectly skips the WF checks we normally do"
      // happens
      const user_ty_ = ocx.normalize(cause, param_env, Unnormalized.new_wip(user_ty), fold_Ty);
      const r = ocx.eq(cause, param_env, user_ty_, mir_ty, ToTrace_Ty);
      // PORT: `?` converts the `TypeError` with `impl From<TypeError> for NoSolution`.
      if (r.$ === "Err") return Err(NO_SOLUTION);
      return Ok(null);
    }, "ascribe_user_type_skip_wf"),
    TypeOp_CustomTypeOp(fold_unit),
    ToUniverseInfo_never,
  );
};
