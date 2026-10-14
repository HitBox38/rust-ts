// Port of compiler/rustc_infer/src/infer/outlives/obligations.rs (lane infer-canonical-outlives; the trait
// `TypeOutlivesDelegate` is lane infcx-contract's).
//
//! Code that handles "type-outlives" constraints like `T: 'a`. This
//! is based on the `push_outlives_components` function defined in rustc_infer,
//! but it adds a bit of heuristics on top, in particular to deal with
//! associated types and projections.
//!
//! When we process a given `T: 'a` obligation, we may produce two
//! kinds of constraints for the region inferencer:
//!
//! - Relationships between inference variables and other regions.
//!   For example, if we have `&'?0 u32: 'a`, then we would produce
//!   a constraint that `'a <= '?0`.
//! - "Verifys" that must be checked after inferencing is done.
//!   For example, if we know that, for some type parameter `T`,
//!   `T: 'a + 'b`, and we have a requirement that `T: '?1`,
//!   then we add a "verify" that checks that `'?1 <= 'a || '?1 <= 'b`.
//!   - Note the difference with the previous case: here, the region
//!     variable must be less than something else, so this doesn't
//!     affect how inference works (it finds the smallest region that
//!     will do); it's just a post-condition that we have to check.
//!
//! **The key point is that once this function is done, we have
//! reduced all of our "type-region outlives" obligations into relationships
//! between individual regions.**
//!
//! One key input to this function is the set of "region-bound pairs".
//! These are basically the relationships between type parameters and
//! regions that are in scope at the point where the outlives
//! obligation was incurred. **When type-checking a function,
//! particularly in the face of closures, this is not known until
//! regionck runs!** This is because some of those bounds come
//! from things we have yet to infer.
//!
//! Consider:
//!
//! ```
//! fn bar<T>(a: T, b: impl for<'a> Fn(&'a T)) {}
//! fn foo<T>(x: T) {
//!     bar(x, |y| { /* ... */})
//!     //      ^ closure arg
//! }
//! ```
//!
//! Here, the type of `y` may involve inference variables and the
//! like, and it may also contain implied bounds that are needed to
//! type-check the closure body (e.g., here it informs us that `T`
//! outlives the late-bound region `'a`).
//!
//! Note that by delaying the gathering of implied bounds until all
//! inference information is known, we may find relationships between
//! bound regions and other regions in the environment. For example,
//! when we first check a closure like the one expected as argument
//! to `foo`:
//!
//! ```
//! fn foo<U, F: for<'a> FnMut(&'a U)>(_f: F) {}
//! ```
//!
//! the type of the closure's first argument would be `&'a ?U`. We
//! might later infer `?U` to something like `&'b u32`, which would
//! imply that `'b: 'a`.
//
// PORT: `TypeOutlives<'cx, 'tcx, D>` is the generated class (obligations.gen.ts); `D: TypeOutlivesDelegate` is the
// interface below (`&mut self` methods on an object). Its methods are assigned onto the prototype, `new` onto the class.
// `impl TypeOutlivesDelegate for &InferCtxt` (obligations.rs:720) is the delegate object built by
// `InferCtxt_TypeOutlivesDelegate(infcx)`.
// PORT: `mir::ConstraintCategory` is not ported (M4): it is `unknown`, produced and passed through untouched.
// PORT: other rustc_infer modules are read inside function bodies only (infcx-contract "How to fill a stub" 6).
import { TransitiveRelationBuilder } from "../../../rustc_data_structures/transitive_relation.ts";
import type { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, TransitiveRelation } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_Binder_ClauseKind } from "../../../rustc_middle/ty/predicate.ts";
import { ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Binder, type PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import type { ArgOutlivesClause, PolyTypeOutlivesClause, RegionOutlivesClause, RegionVid, TypeOutlivesClause, Variance } from "../../../rustc_type_ir/decls.ts";
import { fold_tuple2 } from "../../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { type Component, declared_bounds_from_definition, push_outlives_components } from "../../../rustc_type_ir/outlives.ts";
import { type RegionEqPredicate, visit_with_OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import { Assumptions, destructure_type_outlives_constraints_in_root, RegionConstraint } from "../../../rustc_type_ir/region_constraint.ts";
import type { VisibleForLeakCheck } from "../../../rustc_type_ir/solve/mod.ts";
import { fold_Region, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { visit_with_Alias } from "../../../rustc_type_ir/ty/alias.gen.ts";
import { debug_InferTy, visit_with_AliasTyKind } from "../../../rustc_type_ir/ty_kind.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { debug_vec, PLAIN, PRETTY } from "../../../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { InferCtxt } from "../../decls.ts";
import type { SubregionOrigin, TypeOutlivesConstraint } from "../mod.ts";
import * as infer_mod from "../mod.ts";
import type { GenericKind, VerifyBound } from "../region_constraints/mod.ts";
import * as region_constraints from "../region_constraints/mod.ts";
import type { OutlivesEnvironment, RegionBoundPairs } from "./env.ts";
import { TypeOutlives } from "./obligations.gen.ts";
import * as verify from "./verify.ts";

export * from "./obligations.gen.ts";

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:86 register_outlives_constraint
InferCtxt.prototype.register_outlives_constraint = function (this: InferCtxt, _0: ArgOutlivesClause, vis: VisibleForLeakCheck, cause: ObligationCause): void {
  const { _0: arg, _1: r2 } = _0;
  const k = GenericArg.kind(arg);
  switch (k.$) {
    case "Lifetime": {
      const r1 = k._0;
      this.register_region_outlives_constraint({ _0: r1, _1: r2 }, vis, cause);
      break;
    }
    case "Type": {
      const ty1 = k._0;
      this.register_type_outlives_constraint(ty1, r2, cause);
      break;
    }
    case "Const":
      unreachable();
  }
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:103 register_region_eq_constraint
InferCtxt.prototype.register_region_eq_constraint = function (this: InferCtxt, _0: RegionEqPredicate, vis: VisibleForLeakCheck, cause: ObligationCause): void {
  const { _0: r_a, _1: r_b } = _0;
  const origin = infer_mod.SubregionOrigin.from_obligation_cause(cause, () => ({ $: "RelateRegionParamBound", _0: cause.span, _1: undefined }));
  this.equate_regions(origin, r_a, r_b, vis);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:115 register_region_outlives_constraint
InferCtxt.prototype.register_region_outlives_constraint = function (this: InferCtxt, _0: RegionOutlivesClause, vis: VisibleForLeakCheck, cause: ObligationCause): void {
  const { _0: r_a, _1: r_b } = _0;
  const origin = infer_mod.SubregionOrigin.from_obligation_cause(cause, () => ({ $: "RelateRegionParamBound", _0: cause.span, _1: undefined }));
  // `'a: 'b` ==> `'b <= 'a`
  this.sub_regions(origin, r_b, r_a, vis);
};

/// Registers that the given region obligation must be resolved
/// from within the scope of `body_id`. These regions are enqueued
/// and later processed by regionck, when full type information is
/// available (see `region_obligations` field for more
/// information).
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:134 register_type_outlives_constraint_inner
InferCtxt.prototype.register_type_outlives_constraint_inner = function (this: InferCtxt, obligation: TypeOutlivesConstraint): void {
  const inner = this.inner;
  inner.undo_log.push({ $: "PushTypeOutlivesConstraint" });
  inner.region_obligations_.push(obligation);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:143 register_solver_region_constraint
InferCtxt.prototype.register_solver_region_constraint = function (this: InferCtxt, c: import("../solver_region_constraints.ts").SolverRegionConstraint): void {
  const inner = this.inner;

  const old_constraint = inner.solver_region_constraint_storage.get_constraint();
  // PORT: `old_constraint.clone()`: the constraint trees are immutable values.
  const new_constraint = RegionConstraint.build_and(c, old_constraint);

  // FIXME(-Zassumptions-on-binders): This is pretty bad for perf, we don't make incremental
  // changes to the region constraints, instead we just rewrite the entire thing every time
  // and store the old version.
  inner.undo_log.push({ $: "OverwriteSolverRegionConstraint", old_constraint });
  inner.solver_region_constraint_storage.overwrite(new_constraint);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:159 register_type_outlives_constraint
InferCtxt.prototype.register_type_outlives_constraint = function (this: InferCtxt, sup_type: Ty, sub_region: Region, cause: ObligationCause): void {
  assert(!this.tcx.assumptions_on_binders(), "assertion failed: !self.tcx.assumptions_on_binders()");

  // `is_global` means the type has no params, infer, placeholder, or non-`'static`
  // free regions. If the type has none of these things, then we can skip registering
  // this outlives obligation since it has no components which affect lifetime
  // checking in an interesting way.
  if (TypeVisitableExt.is_global(sup_type, fold_Ty)) {
    return;
  }

  // debug!(?sup_type, ?sub_region, ?cause);
  const origin = infer_mod.SubregionOrigin.from_obligation_cause(cause, (): SubregionOrigin => {
    const code = ObligationCauseCode.peel_derives(cause.code_());
    let span: Span | undefined;
    if ((code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") && !Span.is_dummy(code._1)) {
      span = code._1;
    } else if (code.$ === "OpaqueTypeBound" && !Span.is_dummy(code._0)) {
      span = code._0;
    } else {
      span = undefined;
    }
    return { $: "RelateParamBound", _0: cause.span, _1: sup_type, _2: span };
  });

  this.register_type_outlives_constraint_inner({ sup_type, sub_region, origin });
};

/// Trait queries just want to pass back type obligations "as is"
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:201 take_registered_region_obligations
InferCtxt.prototype.take_registered_region_obligations = function (this: InferCtxt): TypeOutlivesConstraint[] {
  assert(!this.in_snapshot(), "cannot take registered region obligations in a snapshot");
  const taken = this.inner.region_obligations_;
  this.inner.region_obligations_ = [];
  return taken;
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:206 num_registered_region_obligations
InferCtxt.prototype.num_registered_region_obligations = function (this: InferCtxt): number {
  return this.inner.region_obligations_.length;
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:210 registered_region_obligations_since
InferCtxt.prototype.registered_region_obligations_since = function (this: InferCtxt, prev: number): TypeOutlivesConstraint[] {
  return this.inner.region_obligations_.slice(prev).map(infer_mod.clone_TypeOutlivesConstraint);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:217 clone_registered_region_obligations
InferCtxt.prototype.clone_registered_region_obligations = function (this: InferCtxt): TypeOutlivesConstraint[] {
  return this.inner.region_obligations_.map(infer_mod.clone_TypeOutlivesConstraint);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:221 register_region_assumption
InferCtxt.prototype.register_region_assumption = function (this: InferCtxt, assumption: ArgOutlivesClause): void {
  const inner = this.inner;
  inner.undo_log.push({ $: "PushRegionAssumption" });
  inner.region_assumptions_.push(assumption);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:227 take_registered_region_assumptions
InferCtxt.prototype.take_registered_region_assumptions = function (this: InferCtxt): ArgOutlivesClause[] {
  assert(!this.in_snapshot(), "cannot take registered region assumptions in a snapshot");
  const taken = this.inner.region_assumptions_;
  this.inner.region_assumptions_ = [];
  return taken;
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:232 destructure_solver_region_constraints_for_regionck
InferCtxt.prototype.destructure_solver_region_constraints_for_regionck = function (this: InferCtxt, outlives_env: OutlivesEnvironment): void {
  // `FreeRegionMap::relation` stores `'sub <= 'sup` edges while
  // `Assumptions::region_outlives` expects `'longer: 'shorter` ones, so the
  // edges have to be inverted here.
  const region_outlives = TransitiveRelationBuilder.default<Region>();
  for (const [r1, r2] of outlives_env.free_region_map().relation.base_edges()) {
    region_outlives.add(r2, r1);
  }
  const assumptions = Assumptions.new(
    this,
    assumed_type_outlives(this.tcx, outlives_env.known_type_outlives(), outlives_env.region_bound_pairs()),
    region_outlives.freeze(),
    UniverseIndex.ROOT,
  );
  this.destructure_solver_region_constraints(assumptions, InferCtxt_TypeOutlivesDelegate(this));
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:256 destructure_solver_region_constraints_for_borrowck
InferCtxt.prototype.destructure_solver_region_constraints_for_borrowck = function (
  this: InferCtxt,
  // this is always ConstraintConversion but lol
  conversion: TypeOutlivesDelegate,
  known_type_outlives: readonly PolyTypeOutlivesClause[],
  region_bound_pairs: RegionBoundPairs,
  region_outlives: TransitiveRelation<RegionVid>,
): void {
  const clauses = assumed_type_outlives(this.tcx, known_type_outlives, region_bound_pairs);
  // `region_outlives.maybe_map(|r| Some(Region::new_var(self.tcx, r))).unwrap()`
  const region_outlives_ = unwrap(region_outlives.maybe_map((r) => Region.new_var(this.tcx, r)));
  const assumptions = Assumptions.new(this, clauses, region_outlives_, UniverseIndex.ROOT);
  this.destructure_solver_region_constraints(assumptions, conversion);
};

// #[instrument(level = "debug", skip(self, conversion))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:274 destructure_solver_region_constraints
InferCtxt.prototype.destructure_solver_region_constraints = function (this: InferCtxt, assumptions: Assumptions, conversion: TypeOutlivesDelegate): void {
  assert(this.tcx.assumptions_on_binders(), "assertion failed: self.tcx.assumptions_on_binders()");
  assert(this.next_trait_solver(), "assertion failed: self.next_trait_solver()");

  let constraint = this.inner.solver_region_constraint_storage.get_constraint();
  // debug!(?constraint);
  constraint = destructure_type_outlives_constraints_in_root(this, constraint, assumptions);
  // debug!(?constraint);

  // FIXME(-Zassumptions-on-binders): actually implement OR as an  OR
  const cs = [...constraint.and_constraint._0];
  for (const and_constraint of constraint.or_constraint._0) {
    cs.push(...and_constraint._0);
  }
  for (const c of cs) {
    switch (c.$) {
      case "Ambiguity": {
        const span = c._0;
        this.dcx().struct_span_err(span, "unable to satisfy constraints involving placeholders due to unknown implied bounds").emit();
        break;
      }
      case "RegionOutlives": {
        const [a, b, span] = [c._0, c._1, c._2];
        const origin: SubregionOrigin = { $: "SolverRegionConstraint", _0: span };
        const category = infer_mod.SubregionOrigin.to_constraint_category(origin);
        conversion.push_sub_region_constraint(
          origin, // we flip these because regionck is silly :>
          b,
          a,
          category,
        );
        break;
      }
      case "AliasTyOutlivesViaEnv":
      case "PlaceholderTyOutlives":
        unreachable();
    }
  }
};

/// Process the region obligations that must be proven (during
/// `regionck`) for the given `body_id`, given information about
/// the region bounds in scope and so forth.
///
/// See the `region_obligations` field of `InferCtxt` for some
/// comments about how this function fits into the overall expected
/// flow of the inferencer. The key point is that it is
/// invoked after all type-inference variables have been bound --
/// right before lexical region resolution.
// #[instrument(level = "debug", skip(self, outlives_env))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:335 process_registered_region_obligations
InferCtxt.prototype.process_registered_region_obligations = function (this: InferCtxt, outlives_env: OutlivesEnvironment): void {
  assert(!this.in_snapshot(), "cannot process registered region obligations in a snapshot");

  if (this.tcx.assumptions_on_binders()) {
    this.destructure_solver_region_constraints_for_regionck(outlives_env);
  }

  // Must loop since the process of normalizing may itself register region obligations.
  for (let iteration = 0; ; iteration++) {
    const my_region_obligations = this.take_registered_region_obligations();
    if (my_region_obligations.length === 0) {
      break;
    }

    if (!this.tcx.recursion_limit().value_within_limit(iteration)) {
      // This may actually be reachable. If so, we should convert
      // this to a proper error/consider whether we should detect
      // this somewhere else.
      bug(`unexpected overflowed when processing region obligations: ${debug_vec(my_region_obligations, PRETTY, infer_mod.debug_TypeOutlivesConstraint)}`);
    }

    for (const { sup_type: sup_type0, sub_region: sub_region0, origin } of my_region_obligations) {
      // `TypeOutlives` is structural, so we should try to opportunistically resolve all
      // region vids before processing regions, so we have a better chance to match clauses
      // in our param-env.
      //
      // We *want* this folder to live in `rustc_type_ir`. Our best way to call into it is
      // through `InferCtxtLike` and it is not defined as an inherent method on `InferCtxt`.
      // #[allow(rustc::usage_of_type_ir_traits)]
      const [sup_type, sub_region] = this.deeply_resolve_via_unification_table<[Ty, Region]>([sup_type0, sub_region0], fold_tuple2(fold_Ty, fold_Region));

      if (this.tcx.sess.opts.unstable_opts.higher_ranked_assumptions && outlives_env.higher_ranked_assumptions().has({ _0: sup_type, _1: sub_region })) {
        continue;
      }

      // debug!(?sup_type, ?sub_region, ?origin);

      const outlives = TypeOutlives.new(
        InferCtxt_TypeOutlivesDelegate(this),
        this.tcx,
        outlives_env.region_bound_pairs(),
        undefined,
        outlives_env.known_type_outlives(),
      );
      const category = infer_mod.SubregionOrigin.to_constraint_category(origin);
      outlives.type_must_outlive(origin, sup_type, sub_region, category);
    }
  }
};

/// The type outlives assumptions available in the root context, as clauses for
/// [`region_constraint::Assumptions::new`] to elaborate.
///
/// `known_type_outlives` only contains the explicit `Ty: 'a` where clauses. The implied bounds,
/// e.g. `T: 'a` from a `&'a T` argument, are only tracked in `region_bound_pairs` so we have to
/// pull them in separately. Without them we'd fail to prove `T: 'a` for a `&'a T` argument
/// whenever the only explicit bound on `T` mentions a different region.
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:400 assumed_type_outlives
export function assumed_type_outlives(tcx: TyCtxt, known_type_outlives: readonly PolyTypeOutlivesClause[], region_bound_pairs: RegionBoundPairs): Clause[] {
  const to_clause = (c: PolyTypeOutlivesClause): Clause =>
    Clause_upcast_from_Binder_ClauseKind(Binder.map_bound(c, (_0) => ({ $: "TypeOutlives", _0 })), tcx);
  const out: Clause[] = [];
  for (const c of known_type_outlives) {
    out.push(to_clause(c));
  }
  for (const { _0: kind, _1: r } of region_bound_pairs) {
    out.push(to_clause(Binder.dummy<TypeOutlivesClause>({ _0: region_constraints.GenericKind.to_ty(kind as GenericKind, tcx), _1: r }, visit_TypeOutlivesClause)));
  }
  return out;
}

declare module "./obligations.gen.ts" {
  interface TypeOutlives<D> {
    type_must_outlive(origin: SubregionOrigin, ty: Ty, region: Region, category: unknown): void;
    components_must_outlive(origin: SubregionOrigin, components: readonly Component[], region: Region, category: unknown): void;
    param_ty_must_outlive(origin: SubregionOrigin, region: Region, param_ty: ParamTy): void;
    placeholder_ty_must_outlive(origin: SubregionOrigin, region: Region, placeholder_ty: PlaceholderType): void;
    alias_ty_must_outlive(origin: SubregionOrigin, region: Region, alias_ty: AliasTy): void;
    args_must_outlive(args: GenericArgs, origin: SubregionOrigin, region: Region, opt_variances: readonly Variance[] | undefined): void;
  }
  namespace TypeOutlives {
    function new_<D extends TypeOutlivesDelegate>(
      delegate: D,
      tcx: TyCtxt,
      region_bound_pairs: RegionBoundPairs,
      implicit_region_bound: Region | undefined,
      caller_bounds: readonly PolyTypeOutlivesClause[],
    ): TypeOutlives<D>;
    export { new_ as new };
  }
}

// rustc-trait: compiler/rustc_infer/src/infer/outlives/obligations.rs:432 TypeOutlivesDelegate
export interface TypeOutlivesDelegate {
  // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:433 push_sub_region_constraint
  push_sub_region_constraint(origin: SubregionOrigin, a: Region, b: Region, constraint_category: unknown): void;

  // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:441 push_verify
  push_verify(origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void;
}

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:454 new
(TypeOutlives as unknown as { new: typeof TypeOutlives.new }).new = function <D extends TypeOutlivesDelegate>(
  delegate: D,
  tcx: TyCtxt,
  region_bound_pairs: RegionBoundPairs,
  implicit_region_bound: Region | undefined,
  caller_bounds: readonly PolyTypeOutlivesClause[],
): TypeOutlives<D> {
  return new TypeOutlives<D>(delegate, tcx, verify.VerifyBoundCx.new(tcx, region_bound_pairs, implicit_region_bound, caller_bounds));
};

/// Adds constraints to inference such that `T: 'a` holds (or
/// reports an error if it cannot).
///
/// # Parameters
///
/// - `origin`, the reason we need this constraint
/// - `ty`, the type `T`
/// - `region`, the region `'a`
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:482 type_must_outlive
TypeOutlives.prototype.type_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  origin: SubregionOrigin,
  ty: Ty,
  region: Region,
  category: unknown,
): void {
  assert(!TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty), "assertion failed: !ty.has_escaping_bound_vars()");
  // debug_assert!(!ty.has_non_region_infer());
  // debug_assert!(
  //     !self.tcx.next_trait_solver_globally() || !ty.has_non_rigid_aliases(),
  //     "{ty:?} has non-rigid aliases"
  // );

  const components: Component[] = [];
  push_outlives_components(this.tcx, ty, components);
  this.components_must_outlive(origin, components, region, category);
};

// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:501 components_must_outlive
TypeOutlives.prototype.components_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  origin0: SubregionOrigin,
  components: readonly Component[],
  region: Region,
  category: unknown,
): void {
  for (const component of components) {
    const origin = infer_mod.clone_SubregionOrigin(origin0);
    switch (component.$) {
      case "Region": {
        const region1 = component._0;
        this.delegate.push_sub_region_constraint(origin, region, region1, category);
        break;
      }
      case "Param": {
        const param_ty = component._0;
        this.param_ty_must_outlive(origin, region, param_ty);
        break;
      }
      case "Placeholder": {
        const placeholder_ty = component._0;
        this.placeholder_ty_must_outlive(origin, region, placeholder_ty);
        break;
      }
      case "Alias": {
        const alias_ty = component._1;
        // debug_assert_eq!(*is_rigid, ty::IsRigid::yes_if_next_solver(self.tcx));
        this.alias_ty_must_outlive(origin, region, alias_ty);
        break;
      }
      case "EscapingAlias": {
        const subcomponents = component._0;
        this.components_must_outlive(origin, subcomponents, region, category);
        break;
      }
      case "UnresolvedInferenceVariable": {
        const v = component._0;
        // Ignore this, we presume it will yield an error later,
        // since if a type variable is not resolved by this point
        // it never will be.
        this.tcx.dcx().span_delayed_bug(infer_mod.SubregionOrigin.span(origin), `unresolved inference variable in outlives: ${debug_InferTy(v, PLAIN)}`);
        break;
      }
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:541 param_ty_must_outlive
TypeOutlives.prototype.param_ty_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  origin: SubregionOrigin,
  region: Region,
  param_ty: ParamTy,
): void {
  const verify_bound = this.verify_bound.param_or_placeholder_bound(ParamTy.to_ty(param_ty, this.tcx));
  this.delegate.push_verify(origin, { $: "Param", _0: param_ty }, region, verify_bound);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:552 placeholder_ty_must_outlive
TypeOutlives.prototype.placeholder_ty_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  origin: SubregionOrigin,
  region: Region,
  placeholder_ty: PlaceholderType,
): void {
  const verify_bound = this.verify_bound.param_or_placeholder_bound(Ty.new_placeholder(this.tcx, placeholder_ty));
  this.delegate.push_verify(origin, { $: "Placeholder", _0: placeholder_ty }, region, verify_bound);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:570 alias_ty_must_outlive
TypeOutlives.prototype.alias_ty_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  origin: SubregionOrigin,
  region: Region,
  alias_ty: AliasTy,
): void {
  // An optimization for a common case with opaque types.
  if (alias_ty.args.length === 0) {
    return;
  }

  if (TypeVisitableExt.has_non_region_infer(alias_ty, visit_AliasTy)) {
    this.tcx.dcx().span_delayed_bug(infer_mod.SubregionOrigin.span(origin), "an alias has infers during region solving");
    return;
  }

  // This case is thorny for inference. The fundamental problem is
  // that there are many cases where we have choice, and inference
  // doesn't like choice (the current region inference in
  // particular). :) First off, we have to choose between using the
  // OutlivesProjectionEnv, OutlivesProjectionTraitDef, and
  // OutlivesProjectionComponent rules, any one of which is
  // sufficient. If there are no inference variables involved, it's
  // not hard to pick the right rule, but if there are, we're in a
  // bit of a catch 22: if we picked which rule we were going to
  // use, we could add constraints to the region inference graph
  // that make it apply, but if we don't add those constraints, the
  // rule might not apply (but another rule might). For now, we err
  // on the side of adding too few edges into the graph.

  // Compute the bounds we can derive from the trait definition.
  // These are guaranteed to apply, no matter the inference
  // results.
  const trait_bounds: Region[] = [...declared_bounds_from_definition(this.tcx, alias_ty)];

  // debug!(?trait_bounds);

  // Compute the bounds we can derive from the environment. This
  // is an "approximate" match -- in some cases, these bounds
  // may not apply.
  const approx_env_bounds = this.verify_bound.approx_declared_bounds_from_env(alias_ty);
  // debug!(?approx_env_bounds);

  // If declared bounds list is empty, the only applicable rule is
  // OutlivesProjectionComponent. If there are inference variables,
  // then, we can break down the outlives into more primitive
  // components without adding unnecessary edges.
  //
  // If there are *no* inference variables, however, we COULD do
  // this, but we choose not to, because the error messages are less
  // good. For example, a requirement like `T::Item: 'r` would be
  // translated to a requirement that `T: 'r`; when this is reported
  // to the user, it will thus say "T: 'r must hold so that T::Item:
  // 'r holds". But that makes it sound like the only way to fix
  // the problem is to add `T: 'r`, which isn't true. So, if there are no
  // inference variables, we use a verify constraint instead of adding
  // edges, which winds up enforcing the same condition.
  const kind = alias_ty.kind;
  if (
    approx_env_bounds.length === 0 &&
    trait_bounds.length === 0 &&
    (TypeVisitableExt.has_infer_regions(alias_ty, visit_AliasTy) || kind.$ === "Opaque")
  ) {
    // debug!("no declared bounds");
    const opt_variances = this.tcx.opt_alias_variances(AliasTermKind.from_AliasTyKind(kind));
    this.args_must_outlive(alias_ty.args, origin, region, opt_variances);
    return;
  }

  // If we found a unique bound `'b` from the trait, and we
  // found nothing else from the environment, then the best
  // action is to require that `'b: 'r`, so do that.
  //
  // This is best no matter what rule we use:
  //
  // - OutlivesProjectionEnv: these would translate to the requirement that `'b:'r`
  // - OutlivesProjectionTraitDef: these would translate to the requirement that `'b:'r`
  // - OutlivesProjectionComponent: this would require `'b:'r`
  //   in addition to other conditions
  if (
    trait_bounds.length !== 0 &&
    (() => {
      for (const r of trait_bounds.slice(1)) {
        if (r !== trait_bounds[0]) return false;
      }
      // NB: The environment may contain `for<'a> T: 'a` style bounds.
      // In that case, we don't know if they are equal to the trait bound
      // or not (since we don't *know* whether the environment bound even applies),
      // so just map to `None` here if there are bound vars, ensuring that
      // the call to `all` will fail below.
      for (const b of approx_env_bounds) {
        if (Binder.no_bound_vars(Binder.map_bound(b, (b) => b._1), fold_Region) !== trait_bounds[0]) return false;
      }
      return true;
    })()
  ) {
    const unique_bound = trait_bounds[0]!;
    // debug!(?unique_bound);
    // debug!("unique declared bound appears in trait ref");
    const category = infer_mod.SubregionOrigin.to_constraint_category(origin);
    this.delegate.push_sub_region_constraint(origin, region, unique_bound, category);
    return;
  }

  // Fallback to verifying after the fact that there exists a
  // declared bound, or that all the components appearing in the
  // projection outlive; in some cases, this may add insufficient
  // edges into the inference graph, leading to inference failures
  // even though a satisfactory solution exists.
  const verify_bound = this.verify_bound.alias_bound(alias_ty);
  // debug!("alias_must_outlive: pushing {:?}", verify_bound);
  this.delegate.push_verify(origin, { $: "Alias", _0: alias_ty }, region, verify_bound);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:684 args_must_outlive
TypeOutlives.prototype.args_must_outlive = function <D extends TypeOutlivesDelegate>(
  this: TypeOutlives<D>,
  args: GenericArgs,
  origin: SubregionOrigin,
  region: Region,
  opt_variances: readonly Variance[] | undefined,
): void {
  const constraint = infer_mod.SubregionOrigin.to_constraint_category(origin);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime": {
        const lt = k._0;
        let variance: Variance;
        if (opt_variances !== undefined) {
          if (index >= opt_variances.length) {
            panic(`index out of bounds: the len is ${opt_variances.length} but the index is ${index}`);
          }
          variance = opt_variances[index]!;
        } else {
          variance = "Invariant";
        }
        if (variance === "Invariant") {
          this.delegate.push_sub_region_constraint(infer_mod.clone_SubregionOrigin(origin), region, lt, constraint);
        }
        break;
      }
      case "Type": {
        const ty = k._0;
        this.type_must_outlive(infer_mod.clone_SubregionOrigin(origin), ty, region, constraint);
        break;
      }
      case "Const":
        // Const parameters don't impose constraints.
        break;
    }
  }
};

/** PORT: `impl<'cx, 'tcx> TypeOutlivesDelegate<'tcx> for &'cx InferCtxt<'tcx>` (obligations.rs:720) as a delegate object. */
export function InferCtxt_TypeOutlivesDelegate(infcx: InferCtxt): TypeOutlivesDelegate {
  return {
    // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:721 push_sub_region_constraint
    push_sub_region_constraint(origin: SubregionOrigin, a: Region, b: Region, _constraint_category: unknown): void {
      // We don't do leak check in lexical region resolution
      infcx.sub_regions(origin, a, b, "Unreachable");
    },

    // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:732 push_verify
    push_verify(origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void {
      infcx.verify_generic_bound(origin, kind, a, bound);
    },
  };
}

// ---- helpers ----

/** PORT: `TypeVisitable` of `ty::TypeOutlivesClause` (`OutlivesClause<Ty>`, generated impl). */
const visit_TypeOutlivesClause: TypeVisitable<TypeOutlivesClause> = {
  visit_with: <R>(s: TypeOutlivesClause, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, fold_Ty.visit_with),
};

/** PORT: `TypeVisitable` of `ty::AliasTy` (`Alias<AliasTyKind>`, generated impls). */
const visit_AliasTy: TypeVisitable<AliasTy> = {
  visit_with: <R>(s: AliasTy, v: TypeVisitor<R>): R => visit_with_Alias(s, v, visit_with_AliasTyKind),
};
