//! Logic for `-Zassumptions-on-binders` stuff
//
// Port of compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs (lane nts-eval; contract by
// lane evalctxt-contract). The `EvalCtxt` methods are declared in ../../decls.ts
// (`// solve/eval_ctxt/solver_region_constraints.rs:<line>`). The struct `RawAssumptions` is local to
// `region_assumptions_for_placeholders_in_universe` and ported inside it. Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
// PORT: `#[instrument]` / `debug!` (tracing) produce no output in the oracle: kept as comments.
// PORT: `#[cfg(feature = "nightly")]` selects rustc_data_structures' `TransitiveRelationBuilder` (the oracle is the
// nightly build).
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../../rustc_ast_ir/visit.ts";
import { TransitiveRelationBuilder } from "../../../rustc_data_structures/transitive_relation.ts";
import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import type { Clauses } from "../../../rustc_middle/ty/list.ts";
import { Term, Ty } from "../../../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_ClauseKind } from "../../../rustc_middle/ty/predicate.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { compute_alias_components_recursive, declared_bounds_from_definition, push_outlives_components } from "../../../rustc_type_ir/outlives.ts";
import type { Component } from "../../../rustc_type_ir/outlives.gen.ts";
import { as_interner } from "../../../rustc_type_ir/predicate.ts";
import type { ClauseKind } from "../../../rustc_type_ir/predicate_kind.ts";
import {
  And,
  Assumptions,
  eagerly_handle_placeholders_in_universe,
  type LeafRegionConstraint,
  Or,
  RegionConstraint,
} from "../../../rustc_type_ir/region_constraint.ts";
import { Certainty, Goal, type NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { type Region, visit_with_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type AliasTy, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { visit_with_AliasTyKind } from "../../../rustc_type_ir/ty_kind.ts";
import type { UpcastFrom } from "../../../rustc_type_ir/upcast.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided, visit_with_tuple2 } from "../../../rustc_type_ir/visit.ts";
import { assert, panic } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { EvalCtxt } from "../../decls.ts";
import { fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";

/** PORT: the value of the unit struct `NoSolution`. */
const NoSolution: NoSolution = Object.freeze({});

// ---- Logic for `-Zassumptions-on-binders` stuff (impl<'a, D, I> EvalCtxt<'a, D>) -------------------------------------

/// Computes the assumptions associated with a binder for use in eagerly handling placeholders when
/// exiting the binder. Though, right now we do not actually handle placeholders when exiting binders,
/// instead we handle placeholders when computing the final response for the goal being computed.
// #[instrument(level = "debug", skip(self), ret)]
// PORT (D4): `t: impl TypeVisitable<I>` takes its descriptor `d_T` last.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:31 region_assumptions_for_placeholders_in_universe
EvalCtxt.prototype.region_assumptions_for_placeholders_in_universe = function <T>(
  this: EvalCtxt,
  t: T,
  u: UniverseIndex,
  param_env: ParamEnv,
  d_T: TypeVisitable<T>,
): Assumptions | undefined {
  assert(this.cx().assumptions_on_binders(), "assertion failed: self.cx().assumptions_on_binders()");

  class RawAssumptions implements TypeVisitor<undefined> {
    /** `type Result = ();` */
    readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

    constructor(
      public ecx: EvalCtxt,
      public param_env: ParamEnv,
      public out: Goal<Predicate>[],
    ) {}

    // PORT: `unwrap_or(vec![Goal::new(..)])` evaluates its argument before the call, as upstream.
    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:52 visit_ty
    visit_ty(t: Ty): undefined {
      const goals = this.ecx.well_formed_goals(this.param_env, Term.from_Ty(t));
      const default_ = [
        Goal.new(as_interner(this.ecx.cx()), this.param_env, { $: "WellFormed", _0: Term.from_Ty(t) } as ClauseKind, upcast_ClauseKind),
      ];
      this.out.push(...(goals ?? default_));
    }

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:65 visit_const
    visit_const(c: Const): undefined {
      const goals = this.ecx.well_formed_goals(this.param_env, Term.from_Const(c));
      const default_ = [
        Goal.new(as_interner(this.ecx.cx()), this.param_env, { $: "WellFormed", _0: Term.from_Const(c) } as ClauseKind, upcast_ClauseKind),
      ];
      this.out.push(...(goals ?? default_));
    }

    // (provided) TypeVisitor methods this impl does not override.
    visit_binder<U>(t: Binder<U>, d: TypeVisitable<U>): undefined {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_region(r: Region): undefined {
      return TypeVisitor_provided.visit_region(this, r);
    }
    visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
      return TypeVisitor_provided.visit_predicate(this, p, d);
    }
    visit_clauses(c: Clauses): undefined {
      return TypeVisitor_provided.visit_clauses(this, c);
    }
    visit_error(guar: ErrorGuaranteed): undefined {
      return TypeVisitor_provided.visit_error(this, guar);
    }
  }

  const reqs_builder = new RawAssumptions(this, param_env, []);
  d_T.visit_with(t, reqs_builder);
  const reqs = reqs_builder.out;

  // If there are inference variables in type outlives then we may not be able
  // to elaborate to the full set of implied bounds right now. To avoid incorrectly
  // NoSolution'ing when lifting constraints to a lower universe due to no usable
  // assumptions, we just bail here.
  //
  // This is somewhat imprecise as if both the infer var and the outlived region are
  // in a lower universe than the binder we're computing assumptions for then it doesn't
  // really matter as we wouldn't use those outlives as assumptions anyway.
  if (
    reqs.some((goal) => {
      // We don't care about region infers as they can't be further destructured
      return TypeVisitableExt.has_non_region_infer(goal.predicate, fold_Predicate);
    })
  ) {
    return undefined;
  }

  // FIXME(-Zassumptions-on-binders): we need to normalize here/somewhere
  // as we assume the type outlives assumptions only have rigid types :>
  //
  // `Assumptions::new` elaborates, restricts the clauses to `u` and picks out the
  // outlives ones for us, so we just hand over everything the requirements gave us.
  const clauses = (function* () {
    for (const goal of reqs) {
      const c = goal.predicate.as_clause();
      if (c !== undefined) yield c;
    }
  })();

  return Assumptions.new(this.delegate.deref(), clauses, TransitiveRelationBuilder.default<Region>().freeze(), u);
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:114 eagerly_handle_placeholders
EvalCtxt.prototype.eagerly_handle_placeholders = function (this: EvalCtxt): Result<Certainty, NoSolution> {
  let constraint: RegionConstraint = this.delegate.deref().ir_get_solver_region_constraint();

  const smallest_universe = this.max_input_universe;
  const largest_universe = this.delegate.deref().universe();
  // debug!("smallest_universe={smallest_universe:#?}, largest_universe={largest_universe:#?}");

  // We rely on placeholder assumptions to evaluate region constraints with placeholders.
  // But we can fail to compute assumptions due to unresolved type variables. In that case,
  // we conservatively bail with ambiguity.
  // PORT: `smallest_universe + 1` is `newtype_index!`'s `Add<usize>` (`from_usize(index + 1)`).
  if (
    !this.delegate.deref().has_placeholder_assumptions({
      start: UniverseIndex.from_usize(UniverseIndex.index(smallest_universe) + 1),
      last: largest_universe,
    })
  ) {
    return Ok(Certainty.AMBIGUOUS);
  }

  // Walk around that `Step` trait is nightly only.
  // PORT: `(a..=b).map(UniverseIndex::from_usize).rev().fold(..)`.
  for (let i = UniverseIndex.index(largest_universe); i >= UniverseIndex.index(smallest_universe) + 1; i--) {
    const u = UniverseIndex.from_usize(i);
    constraint = eagerly_handle_placeholders_in_universe(this.delegate.deref(), constraint, u);
  }

  // debug!("final constraint={:?}", constraint);
  this.delegate.deref().ir_overwrite_solver_region_constraint(constraint, this.origin_span);

  if (RegionConstraint.is_false(constraint)) {
    return Err(NoSolution);
  } else if (RegionConstraint.is_ambig(constraint)) {
    return Ok(Certainty.AMBIGUOUS);
  } else {
    return Ok(Certainty.Yes);
  }
};

/// Convert a type outlives constraint into a set of region outlives constraints and
/// type outlives constraints between the "components" of the type. E.g. `Foo<T, 'a>: 'b`
/// will be turned into `T: 'b, 'a: 'b`
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:155 destructure_type_outlives
EvalCtxt.prototype.destructure_type_outlives = function (this: EvalCtxt, ty: Ty, r: Region): Or {
  const components: Component[] = [];
  push_outlives_components(this.cx(), ty, components);
  return this.destructure_components(components, r);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:161 destructure_components
EvalCtxt.prototype.destructure_components = function (this: EvalCtxt, components: readonly Component[], r: Region): Or {
  let acc: Or = Or.new_true();
  for (const c of components) {
    acc = Or.build_and(acc, this.destructure_component(c, r));
  }
  return acc;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:167 destructure_component
EvalCtxt.prototype.destructure_component = function (this: EvalCtxt, c: Component, r: Region): Or {
  switch (c.$) {
    case "Region":
      return Or.new_leaf<null>({ $: "RegionOutlives", _0: c._0, _1: r, _2: null });
    case "Placeholder":
      return Or.new_leaf<null>({ $: "PlaceholderTyOutlives", _0: Ty.new_placeholder(this.cx(), c._0), _1: r, _2: null });
    case "Alias":
      return this.destructure_alias_outlives(c._1, r);
    case "UnresolvedInferenceVariable":
      return panic("Shouldn't destructure type outlives when ty vars exist");
    case "Param":
      return panic("Params should have been canonicalized to placeholders");
    case "EscapingAlias":
      return this.destructure_components(c._0, r);
  }
};

/// Convert an alias outlives constraint into an OR constraint of any number of three
/// separate classes of candidates:
/// 1. component outlives. we turn `Alias<T, 'a>: 'b` into `T: 'b, 'a: 'b`.
/// 2. item bounds. we turn `Alias<T, 'a>: 'b` into `'c: 'b` if `Alias` is
///     defined as `type Alias<T, 'a>: 'c`
/// 3. env assumptions. we defer handling `Alias<T, 'a>: 'b` via where clauses until
///     when exiting the current binder. See [`LeafRegionConstraint::AliasTyOutlivesViaEnv`].
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs:192 destructure_alias_outlives
EvalCtxt.prototype.destructure_alias_outlives = function (this: EvalCtxt, alias: AliasTy, r: Region): Or {
  const bounds = declared_bounds_from_definition(this.cx(), alias);
  const item_bounds = (function* () {
    for (const bound of bounds) {
      yield And.new<null>([{ $: "RegionOutlives", _0: bound, _1: r, _2: null } satisfies LeafRegionConstraint]);
    }
  })();
  const item_bound_outlives = Or.new(item_bounds);

  const where_clause_outlives = Or.new_leaf<null>({
    $: "AliasTyOutlivesViaEnv",
    _0: Binder.dummy<[AliasTy, Region]>([alias, r], visit_AliasTy_Region),
    _1: null,
  });

  const components: Component[] = [];
  compute_alias_components_recursive(this.cx(), alias, components);
  const components_outlives = this.destructure_components(components, r);

  const assumption_outlives = Or.build_or(item_bound_outlives, where_clause_outlives);
  return Or.build_or(assumption_outlives, components_outlives);
};

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** PORT (D3): `Predicate`'s `UpcastFrom<ClauseKind>` (written over `TyCtxt`) as rustc_type_ir's `Goal::new` wants it. */
const upcast_ClauseKind = ((from: ClauseKind, tcx: TyCtxt): Predicate =>
  Predicate_upcast_from_ClauseKind(from, tcx)) as unknown as UpcastFrom<ClauseKind, Predicate>["upcast_from"];

/** `TypeVisitable` of `(AliasTy<I>, Region<I>)` (for `Binder::dummy`). */
const visit_AliasTy_Region: TypeVisitable<[AliasTy, Region]> = {
  visit_with: <R>(s: [AliasTy, Region], v: TypeVisitor<R>): R =>
    visit_with_tuple2(s, v, <R2>(a: AliasTy, v2: TypeVisitor<R2>): R2 => visit_with_Alias(a, v2, visit_with_AliasTyKind), visit_with_Region),
};
