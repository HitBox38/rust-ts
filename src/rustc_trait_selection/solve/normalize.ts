// Port of compiler/rustc_trait_selection/src/solve/normalize.rs (lane trait-sel-solve).
//
// PORT (D4): `T: TypeFoldable<TyCtxt>` adds the descriptor `d_T` last; `E: FromSolverError<'tcx, NextSolverError>` adds
// the descriptor `from_solver_error_E` before it.
// PORT: `crate::traits::BoundVarReplacer` is `pub use rustc_next_trait_solver::placeholder::BoundVarReplacer`
// (traits/util.rs:14), so it is imported from there directly.
// PORT: the folders are classes implementing rustc_type_ir's `TypeFolder`; the provided methods they do not override
// forward to `TypeFolder_provided`.

import type { At, InferCtxt } from "../../rustc_infer/decls.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import type { FromSolverError } from "../../rustc_infer/traits/engine.ts";
import { Normalized } from "../../rustc_infer/traits/project.ts";
import { clone_ObligationCause, ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv } from "../../rustc_middle/ty/decls.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { fold_Term, Term, type Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ProjectionClause, type Predicate } from "../../rustc_middle/ty/predicate.ts";
import { debug_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { normalize as nts_normalize, placeholder, solve } from "../../rustc_next_trait_solver/lib.ts";
import { type Binder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { UniverseIndex } from "../../rustc_type_ir/decls.ts";
import { fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import { type FallibleTypeFolder, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { as_interner, type ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { debug_Goal, type Goal } from "../../rustc_type_ir/solve/mod.ts";
import { Goal as GoalC } from "../../rustc_type_ir/solve/mod.ts";
import { type Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { type AliasConst, type AliasTerm as AliasTermT, type AliasTy, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTyKind, try_fold_with_AliasTyKind, visit_with_AliasTyKind } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { SolverDelegate } from "./delegate.ts";
import { FromSolverError_ScrubbedTraitError, FulfillmentCtxt, type NextSolverError } from "./fulfill.ts";

/// Normalize a value, deferring ambiguity and errors to fulfillment.
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:22 normalize
export function normalize<T>(at: At, value: Unnormalized<T>, d_T: TypeFoldable<T>): Normalized<T> {
  const r = normalize_with_universes(at, value, [], d_T);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const replacer = new ReplaceAliasWithInfer(at, [], []);
    const value1 = at.infcx.deeply_resolve_ignoring_regions(Unnormalized.skip_normalization(value), d_T);
    const value2 = d_T.fold_with(value1, replacer);
    return new Normalized(value2, replacer.obligations);
  }
}

/// Like `deeply_normalize`, but we handle ambiguity and inference variables in this routine.
/// The behavior should be same as the old solver.
/// On error, return the failed obligation.
/// For ambiguity, we have two cases:
///   - has_escaping_bound_vars: return the original alias.
///   - otherwise: return the normalized result. It can be (partially) inferred
///     even if the evaluation result is ambiguous.
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:45 normalize_with_universes
function normalize_with_universes<T>(
  at: At,
  value0: Unnormalized<T>,
  universes: (UniverseIndex | undefined)[],
  d_T: TypeFoldable<T>,
): Result<Normalized<T>, PredicateObligation> {
  const infcx = at.infcx;
  const value1 = Unnormalized.skip_normalization(value0);
  const value = infcx.deeply_resolve_ignoring_regions(value1, d_T);

  if (!infcx.tcx.renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(value, d_T)) {
    return Ok(new Normalized(value, []));
  }

  const stalled_goals: Goal<Predicate>[] = [];
  const folder = nts_normalize.NormalizationFolder.new<PredicateObligation>(infcx, universes, (alias_term) => {
    const delegate = SolverDelegate.from(infcx);
    const infer_term = delegate.deref().next_term_var_of_alias_kind(alias_term, at.cause.span);
    const predicate: ProjectionClause = { projection_term: alias_term, term: infer_term };
    const goal = GoalC.new(as_interner(infcx.tcx), at.param_env, predicate, solve.upcast_fn(Predicate_upcast_from_ProjectionClause));
    const r = solve.SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, goal, at.cause.span, undefined);
    if (r.$ === "Err") {
      return Err(Obligation.new(infcx.tcx, ObligationCause_clone(at.cause), goal.param_env, goal.predicate, solve.upcast_fn(Predicate_identity)));
    }
    const result = r._0;
    const normalized = infcx.deeply_resolve_ignoring_regions(infer_term, fold_Term_());
    let normalization_was_ambiguous: nts_normalize.NormalizationWasAmbiguous;
    switch (result.certainty.$) {
      case "Yes":
        normalization_was_ambiguous = nts_normalize.NormalizationWasAmbiguous.No;
        break;
      case "Maybe":
        stalled_goals.push(result.goal);
        normalization_was_ambiguous = nts_normalize.NormalizationWasAmbiguous.Yes;
        break;
    }
    return Ok([normalized, normalization_was_ambiguous]);
  });
  const r = d_T.try_fold_with(value, folder);
  if (r.$ === "Err") return r;
  const value_ = r._0;
  const obligations = stalled_goals.map((goal) =>
    Obligation.new(infcx.tcx, ObligationCause_clone(at.cause), goal.param_env, goal.predicate, solve.upcast_fn(Predicate_identity)),
  );
  return Ok(new Normalized(value_, obligations));
}

class ReplaceAliasWithInfer implements TypeFolder {
  constructor(
    public at: At,
    public obligations: PredicateObligations,
    public universes: (UniverseIndex | undefined)[],
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:103 term_to_infer
  term_to_infer(alias_term: AliasTermT): Term {
    const infcx = this.at.infcx;
    const infer_term = infcx.next_term_var_of_alias_kind(alias_term, this.at.cause.span);
    const obligation = Obligation.new(
      infcx.tcx,
      ObligationCause_clone(this.at.cause),
      this.at.param_env,
      { projection_term: alias_term, term: infer_term } satisfies ProjectionClause,
      solve.upcast_fn(Predicate_upcast_from_ProjectionClause),
    );
    this.obligations.push(obligation);
    return infer_term;
  }

  // ---- impl<'me, 'tcx> TypeFolder<TyCtxt<'tcx>> for ReplaceAliasWithInfer<'me, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:118 cx
  cx(): TyCtxt {
    return this.at.infcx.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:122 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.universes.push(undefined);
    const t_ = fold_Binder(d).super_fold_with(t, this);
    this.universes.pop();
    return t_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:132 fold_ty
  fold_ty(ty0: Ty): Ty {
    if (!this.cx().renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(ty0, fold_Ty)) {
      return ty0;
    }

    const ty = fold_Ty.super_fold_with(ty0, this);
    const k = ty.kind();
    if (k.$ !== "Alias") return ty;
    const orig_is_rigid = k._0;
    const alias = k._1;
    if (!this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      return ty;
    }

    if (TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
      const [replaced] = placeholder.BoundVarReplacer.replace_bound_vars(this.at.infcx, this.universes, alias, fold_AliasTy());
      // Keep the higher-ranked alias in the folded value; the fresh term is only
      // used to register its projection obligation.
      this.term_to_infer(AliasTerm.from_AliasTy(replaced));
      return ty;
    } else {
      return Term.expect_type(this.term_to_infer(AliasTerm.from_AliasTy(alias)));
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:155 fold_const
  fold_const(ct0: Const): Const {
    if (!this.cx().renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(ct0, fold_Const)) {
      return ct0;
    }

    const ct = fold_Const.super_fold_with(ct0, this);
    const k = ct.kind();
    if (k.$ !== "Alias") return ct;
    const orig_is_rigid = k._0;
    const alias_const = k._1;
    if (!this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      return ct;
    }

    if (TypeVisitableExt.has_escaping_bound_vars(ct, fold_Const)) {
      const [replaced] = placeholder.BoundVarReplacer.replace_bound_vars(this.at.infcx, this.universes, alias_const, fold_AliasConst());
      // Keep the higher-ranked alias in the folded value; the fresh term is only
      // used to register its projection obligation.
      this.term_to_infer(AliasTerm.from_AliasConst(replaced));
      return ct;
    } else {
      return Term.expect_const(this.term_to_infer(AliasTerm.from_AliasConst(alias_const)));
    }
  }

  // (provided) TypeFolder methods this impl does not override.
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// Deeply normalize all aliases in `value`. This does not handle inference and expects
/// its input to be already fully resolved.
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:184 deeply_normalize
export function deeply_normalize<T, E>(at: At, value: Unnormalized<T>, from_solver_error_E: FromSolverError<E, NextSolverError>, d_T: TypeFoldable<T>): Result<T, E[]> {
  assert(
    !TypeVisitableExt.has_escaping_bound_vars(Unnormalized.skip_normalization(Unnormalized.as_ref(value)), d_T),
    "assertion failed: !value.as_ref().skip_normalization().has_escaping_bound_vars()",
  );
  return deeply_normalize_with_skipped_universes(at, value, [], from_solver_error_E, d_T);
}

/// Deeply normalize all aliases in `value`. This does not handle inference and expects
/// its input to be already fully resolved.
///
/// Additionally takes a list of universes which represents the binders which have been
/// entered before passing `value` to the function. This is currently needed for
/// `normalize_erasing_regions`, which skips binders as it walks through a type.
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:202 deeply_normalize_with_skipped_universes
export function deeply_normalize_with_skipped_universes<T, E>(
  at: At,
  value: Unnormalized<T>,
  universes: (UniverseIndex | undefined)[],
  from_solver_error_E: FromSolverError<E, NextSolverError>,
  d_T: TypeFoldable<T>,
): Result<T, E[]> {
  const r = deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals(at, value, universes, from_solver_error_E, d_T);
  if (r.$ === "Err") return r;
  const [value_, coroutine_goals] = r._0;
  assert_eq(coroutine_goals, [], (v) => debug_vec(v, PLAIN, (g, f) => debug_Goal(g, f, debug_Predicate)), (a, b) => a.length === b.length);

  return Ok(value_);
}

/// Deeply normalize all aliases in `value`. This does not handle inference and expects
/// its input to be already fully resolved.
///
/// Additionally takes a list of universes which represents the binders which have been
/// entered before passing `value` to the function. This is currently needed for
/// `normalize_erasing_regions`, which skips binders as it walks through a type.
///
/// This returns a set of stalled obligations involving coroutines if the typing mode of
/// the underlying infcx has any stalled coroutine def ids.
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:229 deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals
export function deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals<T, E>(
  at: At,
  value0: Unnormalized<T>,
  universes: (UniverseIndex | undefined)[],
  from_solver_error_E: FromSolverError<E, NextSolverError>,
  d_T: TypeFoldable<T>,
): Result<[T, Goal<Predicate>[]], E[]> {
  const r = normalize_with_universes(at, value0, universes, d_T);
  if (r.$ === "Err") {
    return Err([from_solver_error_E.from_solver_error(at.infcx, { $: "TrueError", _0: r._0 })]);
  }
  const { value, obligations } = r._0;

  const fulfill_cx = FulfillmentCtxt.new<E>(at.infcx, from_solver_error_E);
  for (const pred of obligations) {
    fulfill_cx.register_predicate_obligation(at.infcx, pred);
  }

  const errors = fulfill_cx.try_evaluate_obligations(at.infcx);
  if (errors.$ === "HasErrors") {
    return Err(errors._0);
  }

  const stalled_coroutine_goals = fulfill_cx.drain_stalled_obligations_for_coroutines(at.infcx).map((obl) => obl.as_goal());

  const errors2 = fulfill_cx.collect_remaining_errors(at.infcx);
  if (errors2.$ === "HasErrors") {
    return Err(errors2._0);
  }

  return Ok([value, stalled_coroutine_goals]);
}

// Deeply normalize a value and return it
// rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:268 deeply_normalize_for_diagnostics
export function deeply_normalize_for_diagnostics<T>(infcx: InferCtxt, param_env: ParamEnv, t: T, d_T: TypeFoldable<T>): T {
  return d_T.fold_with(t, new DeeplyNormalizeForDiagnosticsFolder(infcx.at(ObligationCause.dummy(), param_env)));
}

class DeeplyNormalizeForDiagnosticsFolder implements TypeFolder {
  constructor(public at: At) {}

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:283 cx
  cx(): TyCtxt {
    return this.at.infcx.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:287 fold_ty
  fold_ty(ty: Ty): Ty {
    const infcx = this.at.infcx;
    const result = infcx.commit_if_ok((_) =>
      deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals(
        this.at,
        Unnormalized.new_wip(ty),
        new Array<UniverseIndex | undefined>(ty.outer_exclusive_binder()).fill(undefined),
        FromSolverError_ScrubbedTraitError,
        fold_Ty,
      ),
    );
    if (result.$ === "Ok") {
      return result._0[0];
    } else {
      return fold_Ty.super_fold_with(ty, this);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/normalize.rs:302 fold_const
  fold_const(ct: Const): Const {
    const infcx = this.at.infcx;
    const result = infcx.commit_if_ok((_) =>
      deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals(
        this.at,
        Unnormalized.new_wip(ct),
        new Array<UniverseIndex | undefined>(ct.outer_exclusive_binder()).fill(undefined),
        FromSolverError_ScrubbedTraitError,
        fold_Const,
      ),
    );
    if (result.$ === "Ok") {
      return result._0[0];
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  // (provided) TypeFolder methods this impl does not override.
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

/** `impl Upcast<I, Predicate> for Predicate` (the reflexive `UpcastFrom` impl). */
function Predicate_identity(p: Predicate, _tcx: TyCtxt): Predicate {
  return p;
}

/** `at.cause.clone()` */
function ObligationCause_clone(c: ObligationCause): ObligationCause {
  return clone_ObligationCause(c);
}

// PORT (D4): descriptors, built on call (the generated fns are read lazily).
function fold_Term_(): TypeFoldable<Term> {
  return fold_Term;
}
/** `ty::AliasTy<'tcx>` */
function fold_AliasTy(): TypeFoldable<AliasTy> {
  return {
    visit_with: <R>(s: AliasTy, v: TypeVisitor<R>): R => visit_with_Alias(s, v, visit_with_AliasTyKind),
    try_fold_with: <E>(s: AliasTy, f: FallibleTypeFolder<E>): Result<AliasTy, E> => try_fold_with_Alias(s, f, try_fold_with_AliasTyKind),
    fold_with: (s: AliasTy, f: TypeFolder): AliasTy => fold_with_Alias(s, f, fold_with_AliasTyKind),
  };
}
/** `ty::AliasConst<'tcx>` */
function fold_AliasConst(): TypeFoldable<AliasConst> {
  return {
    visit_with: <R>(s: AliasConst, v: TypeVisitor<R>): R => visit_with_Alias(s, v, visit_with_AliasConstKind),
    try_fold_with: <E>(s: AliasConst, f: FallibleTypeFolder<E>): Result<AliasConst, E> => try_fold_with_Alias(s, f, try_fold_with_AliasConstKind),
    fold_with: (s: AliasConst, f: TypeFolder): AliasConst => fold_with_Alias(s, f, fold_with_AliasConstKind),
  };
}

