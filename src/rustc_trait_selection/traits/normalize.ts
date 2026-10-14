//! Deeply normalize types using the old trait solver.
//
// Port of compiler/rustc_trait_selection/src/traits/normalize.rs (lane trait-sel-traits-a; the contract stub was lane
// infcx-contract's). `#[extension(pub trait NormalizeExt)] impl At` puts `normalize` / `deeply_normalize` on
// `At.prototype` (rustc_trait_selection decls.ts). `AssocTypeNormalizer` (codegen `hand`) is the class below with its
// `TypeFolder` impl.
//
// PORT (old solver, plan-m3 D9): `SelectionContext` (traits/select, wave 20) and the old solver's projection
// (`project::{normalize_projection_term, opt_normalize_projection_term, normalize_inherent_projection,
// const_of_item_or_delayed_bug}`, traits/project.rs, wave 20) are not ported. `SelectionContext` is the view
// `SelectionContext` below (the members `AssocTypeNormalizer` reads); `SelectionContext::new` and the `project` fns are
// `pending_*` stand-ins that stop as UNPORTED. With the next solver (the default outside the ui suites),
// `normalize` / `deeply_normalize` go to `crate::solve::{normalize, deeply_normalize}` (solve/normalize.rs, lane
// trait-sel-solve), also `pending_*` stand-ins here (root repoints them at merge).
//
// Init order: top-level code here touches only rustc_infer (loaded first by ../lib.ts) and other crates.

import { At, type InferCtxt } from "../../rustc_infer/decls.ts";
import { InferOk } from "../../rustc_infer/infer/mod.ts";
import type { FromSolverError, TraitEngine } from "../../rustc_infer/traits/engine.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import { Normalized } from "../../rustc_infer/traits/project.ts";
import { type ObligationCause, type ObligationCauseCode, clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv, Predicate, Term } from "../../rustc_middle/ty/decls.ts";
import { Term as TermC, Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { debug_Obligation } from "../../rustc_infer/traits/mod.ts";
import { debug_Predicate } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { fold_Term } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { type Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import type { Pending } from "../../rustc_type_ir/decls.ts";
import type { AliasTerm } from "../../rustc_type_ir/ty/alias.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.gen.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { type CantBeErased, TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import {
  AliasTerm as AliasTermC,
  AliasTermKind,
  fold_with_AliasTermKind,
  try_fold_with_AliasTermKind,
  visit_with_AliasTermKind,
} from "../../rustc_type_ir/term_kind.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_vec, PRETTY } from "../../std/fmt.ts";
import { assert, unported, unreachable } from "../../std/panic.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { NextSolverError } from "../decls.ts";
import { BoundVarReplacer, PlaceholderReplacer } from "./util.ts";
import { err_ctxt, evaluate_const, with_replaced_escaping_bound_vars } from "./mod.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { Clause_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";

/**
 * `traits::select::SelectionContext<'cx, 'tcx>` (traits/select/mod.rs; the old solver, wave 20): the members
 * `AssocTypeNormalizer` uses.
 */
export interface SelectionContext {
  readonly __pending?: Pending<"rustc_trait_selection::traits::select::SelectionContext">;
  /** `pub infcx: &'cx InferCtxt<'tcx>` */
  readonly infcx: InferCtxt;
  // select/mod.rs `fn tcx(&self) -> TyCtxt<'tcx>`
  tcx(): TyCtxt;
  // select/mod.rs `fn typing_mode(&self) -> TypingMode<'tcx>`
  typing_mode(): TypingMode<CantBeErased>;
}

// ---- #[extension(pub trait NormalizeExt<'tcx>)] impl<'tcx> At<'_, 'tcx> ---------------------------------------------

/// Normalize a value using the `AssocTypeNormalizer`.
///
/// This normalization should be used when the type contains inference variables or the
/// projection may be fallible.
// rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:30 normalize
At.prototype.normalize = function <T>(this: At, value: Unnormalized<T>, d_T: TypeFoldable<T>): InferOk<T> {
  if (this.infcx.next_trait_solver()) {
    const { value: value_, obligations } = pending_solve_normalize(this, value, d_T);
    return new InferOk(value_, obligations);
  } else {
    const selcx = pending_SelectionContext_new(this.infcx);
    const { value: value_, obligations } = normalize_with_depth(selcx, this.param_env, clone_ObligationCause(this.cause), 0, value, d_T);
    return new InferOk(value_, obligations);
  }
};

/// Deeply normalizes `value`, replacing all aliases which can by normalized in
/// the current environment. In the new solver this errors in case normalization
/// fails or is ambiguous.
///
/// In the old solver this simply uses `normalizes` and adds the nested obligations
/// to the `fulfill_cx`. This is necessary as we otherwise end up recomputing the
/// same goals in both a temporary and the shared context which negatively impacts
/// performance as these don't share caching.
///
/// FIXME(-Znext-solver=no): For performance reasons, we currently reuse an existing
/// fulfillment context in the old solver. Once we have removed the old solver, we
/// can remove the `fulfill_cx` parameter on this function.
// rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:57 deeply_normalize
At.prototype.deeply_normalize = function <T, E>(
  this: At,
  value: Unnormalized<T>,
  fulfill_cx: TraitEngine<E>,
  d_T: TypeFoldable<T>,
  from_solver_error_E: FromSolverError<E, NextSolverError>,
): Result<T, E[]> {
  if (this.infcx.next_trait_solver()) {
    return pending_solve_deeply_normalize(this, value, d_T, from_solver_error_E);
  } else {
    if (fulfill_cx.has_pending_obligations()) {
      const pending_obligations = fulfill_cx.pending_obligations();
      return span_bug(
        pending_obligations[0]!.cause.span,
        `deeply_normalize should not be called with pending obligations: ${debug_vec(pending_obligations, PRETTY, (o, f) => debug_Obligation(o, f, debug_Predicate))}`,
      );
    }
    const value_ = this.normalize(value, d_T).into_value_registering_obligations(this.infcx, fulfill_cx);
    const errors = fulfill_cx.evaluate_obligations_error_on_ambiguity(this.infcx);
    const value2 = this.infcx.deeply_resolve_ignoring_regions(value_, d_T);
    switch (errors.$) {
      case "NoErrors":
        return Ok(value2);
      case "HasErrors": {
        // Drop pending obligations, since deep normalization may happen
        // in a loop and we don't want to trigger the assertion on the next
        // iteration due to pending ambiguous obligations we've left over.
        void fulfill_cx.collect_remaining_errors(this.infcx);
        return Err(errors._0);
      }
    }
  }
};

/// As `normalize`, but with a custom depth.
// rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:97 normalize_with_depth
export function normalize_with_depth<T>(
  selcx: SelectionContext,
  param_env: ParamEnv,
  cause: ObligationCause,
  depth: number,
  value: Unnormalized<T>,
  d_T: TypeFoldable<T>,
): Normalized<T> {
  const obligations: PredicateObligations = [];
  const value_ = normalize_with_depth_to(selcx, param_env, cause, depth, value, obligations, d_T);
  return new Normalized(value_, obligations);
}

// #[instrument(level = "info", skip(selcx, param_env, cause, obligations))]
// rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:113 normalize_with_depth_to
export function normalize_with_depth_to<T>(
  selcx: SelectionContext,
  param_env: ParamEnv,
  cause: ObligationCause,
  depth: number,
  value: Unnormalized<T>,
  obligations: PredicateObligations,
  d_T: TypeFoldable<T>,
): T {
  // debug!(obligations.len = obligations.len());
  const normalizer = AssocTypeNormalizer.new(selcx, param_env, cause, depth, obligations);
  const result = normalizer.fold(Unnormalized.skip_normalization(value), d_T);
  // debug!(?result, obligations.len = normalizer.obligations.len());
  // debug!(?normalizer.obligations,);
  return result;
}

// rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:132 needs_normalization
export function needs_normalization<T>(infcx: InferCtxt, value: T, d_T: TypeVisitable<T>): boolean {
  let flags = TypeFlags.HAS_ALIAS;

  // Opaques are treated as rigid outside of `TypingMode::PostAnalysis`,
  // so we can ignore those.
  const mode = TypingMode.assert_not_erased(infcx.typing_mode_raw());
  switch (mode.$) {
    // FIXME(#132279): We likely want to reveal opaques during post borrowck analysis
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
      flags = TypeFlags.remove(flags, TypeFlags.HAS_TY_OPAQUE);
      break;
    case "Reflection":
    case "PostAnalysis":
    case "Codegen":
      break;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
  }

  return TypeVisitableExt.has_type_flags(value, flags, d_T);
}

// rustc-type: compiler/rustc_trait_selection/src/traits/normalize.rs:154 AssocTypeNormalizer
export class AssocTypeNormalizer implements TypeFolder {
  constructor(
    public selcx: SelectionContext,
    public param_env: ParamEnv,
    public cause: ObligationCause,
    /** `&'a mut PredicateObligations<'tcx>`: the caller's array, pushed to in place. */
    public obligations: PredicateObligations,
    public depth: number,
    public universes: (UniverseIndex | undefined)[],
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:164 new
  static new(selcx: SelectionContext, param_env: ParamEnv, cause: ObligationCause, depth: number, obligations: PredicateObligations): AssocTypeNormalizer {
    // debug_assert!(!selcx.infcx.next_trait_solver());
    return new AssocTypeNormalizer(selcx, param_env, cause, obligations, depth, []);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:175 fold
  fold<T>(value_: T, d_T: TypeFoldable<T>): T {
    const value = this.selcx.infcx.deeply_resolve_ignoring_regions(value_, d_T);
    // debug!(?value);

    assert(!TypeVisitableExt.has_escaping_bound_vars(value, d_T), "Normalizing value without wrapping in a `Binder`");

    if (!needs_normalization(this.selcx.infcx, value, d_T)) {
      return value;
    } else {
      return d_T.fold_with(value, this);
    }
  }

  // FIXME(mgca): While this supports constants, it is only used for types by default right now
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:189 normalize_trait_projection
  normalize_trait_projection(proj_: AliasTerm): Term {
    if (!TypeVisitableExt.has_escaping_bound_vars(proj_, d_AliasTerm())) {
      // When we don't have escaping bound vars we can normalize ambig aliases
      // to inference variables (done in `normalize_projection_ty`). This would
      // be wrong if there were escaping bound vars as even if we instantiated
      // the bound vars with placeholders, we wouldn't be able to map them back
      // after normalization succeeded.
      //
      // Also, as an optimization: when we don't have escaping bound vars, we don't
      // need to replace them with placeholders (see branch below).
      const proj = d_AliasTerm().fold_with(proj_, this);
      return pending_project_normalize_projection_term(this.selcx, this.param_env, proj, clone_ObligationCause(this.cause), this.depth, this.obligations);
    } else {
      // If there are escaping bound vars, we temporarily replace the
      // bound vars with placeholders. Note though, that in the case
      // that we still can't project for whatever reason (e.g. self
      // type isn't known enough), we *can't* register an obligation
      // and return an inference variable (since then that obligation
      // would have bound vars and that's a can of worms). Instead,
      // we just give up and fall back to pretending like we never tried!
      //
      // Note: this isn't necessarily the final approach here; we may
      // want to figure out how to register obligations with escaping vars
      // or handle this some other way.
      const infcx = this.selcx.infcx;
      const [proj1, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(infcx, this.universes, proj_, d_AliasTerm());
      const proj = d_AliasTerm().fold_with(proj1, this);
      const r = pending_project_opt_normalize_projection_term(this.selcx, this.param_env, proj, clone_ObligationCause(this.cause), this.depth, this.obligations);
      const normalized_term = (r.$ === "Ok" ? r._0 : undefined) ?? AliasTermC.to_term(proj, infcx.tcx, "No");

      return PlaceholderReplacer.replace_placeholders(infcx, mapped_regions, mapped_types, mapped_consts, this.universes, normalized_term, fold_Term);
    }
  }

  // FIXME(mgca): While this supports constants, it is only used for types by default right now
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:249 normalize_inherent_projection
  normalize_inherent_projection(inherent_: AliasTerm): Term {
    if (!TypeVisitableExt.has_escaping_bound_vars(inherent_, d_AliasTerm())) {
      // When we don't have escaping bound vars we can normalize ambig aliases
      // to inference variables (done in `normalize_projection_ty`). This would
      // be wrong if there were escaping bound vars as even if we instantiated
      // the bound vars with placeholders, we wouldn't be able to map them back
      // after normalization succeeded.
      //
      // Also, as an optimization: when we don't have escaping bound vars, we don't
      // need to replace them with placeholders (see branch below).

      const inherent = d_AliasTerm().fold_with(inherent_, this);
      return pending_project_normalize_inherent_projection(this.selcx, this.param_env, inherent, clone_ObligationCause(this.cause), this.depth, this.obligations);
    } else {
      const infcx = this.selcx.infcx;
      const [inherent1, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(infcx, this.universes, inherent_, d_AliasTerm());
      const inherent2 = d_AliasTerm().fold_with(inherent1, this);
      const inherent = pending_project_normalize_inherent_projection(this.selcx, this.param_env, inherent2, clone_ObligationCause(this.cause), this.depth, this.obligations);

      return PlaceholderReplacer.replace_placeholders(infcx, mapped_regions, mapped_types, mapped_consts, this.universes, inherent, fold_Term);
    }
  }

  // FIXME(mgca): While this supports constants, it is only used for types by default right now
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:296 normalize_free_alias
  normalize_free_alias(free: AliasTerm): Term {
    const recursion_limit = this.cx().recursion_limit();
    if (!recursion_limit.value_within_limit(this.depth)) {
      err_ctxt(this.selcx.infcx).report_overflow_error({ $: "DeeplyNormalize", _0: free }, this.cause.span, false, (diag) => {
        diag.note("in case this is a recursive type alias, consider using a struct, enum, or union instead");
      });
    }

    const def_id = AliasTermC.expect_free_def_id(free);

    // We don't replace bound vars in the generic arguments of the free alias with
    // placeholders. This doesn't cause any issues as instantiating parameters with
    // bound variables is special-cased to rewrite the debruijn index to be higher
    // whenever we fold through a binder.
    //
    // However, we do replace any escaping bound vars in the resulting goals with
    // placeholders as the trait solver does not expect to encounter escaping bound
    // vars in obligations.
    //
    // FIXME(checked_type_alias): Check how much this actually matters for perf before
    // stabilization. This is a bit weird and generally not how we handle binders in
    // the compiler so ideally we'd do the same boundvar->placeholder->boundvar dance
    // that other kinds of normalization do.
    const infcx = this.selcx.infcx;
    for (const [clause_u, span] of GenericClauses.instantiate_own(infcx.tcx.clauses_of(def_id) as GenericClauses, infcx.tcx, free.args)) {
      let clause: Clause = Unnormalized.skip_norm_wip(clause_u);
      if (TypeVisitableExt.has_escaping_bound_vars(free, d_AliasTerm())) {
        [clause] = BoundVarReplacer.replace_bound_vars(infcx, this.universes, clause, fold_Clause);
      }
      const cause = clone_ObligationCause(this.cause);
      cause.map_code((code): ObligationCauseCode => ({ $: "TypeAlias", _0: code, _1: span, _2: def_id }));
      this.obligations.push(Obligation.new(infcx.tcx, cause, this.param_env, clause, Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate));
    }
    this.depth += 1;
    let res: Term;
    if (AliasTermKind.is_type(free.kind)) {
      res = TermC.from_Ty(
        fold_Ty.fold_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(infcx.tcx.type_of(def_id) as EarlyBinder<Ty>, infcx.tcx, free.args, fold_Ty)), this),
      );
    } else {
      res = TermC.from_Const(
        fold_Const.fold_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(pending_project_const_of_item_or_delayed_bug(infcx.tcx, def_id), infcx.tcx, free.args, fold_Const)), this),
      );
    }
    // When normalizing a free const alias, register a `ConstArgHasType`
    // obligation to ensure the const value's type matches the declared type.
    const ct = TermC.as_const(res);
    if (ct !== undefined) {
      const expected_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(infcx.tcx.type_of(def_id) as EarlyBinder<Ty>, infcx.tcx, free.args, fold_Ty));
      this.obligations.push(
        Obligation.with_depth(infcx.tcx, clone_ObligationCause(this.cause), this.depth, this.param_env, { $: "ConstArgHasType", _0: ct, _1: expected_ty }, Predicate_upcast_from_ClauseKind as (from: import("../../rustc_type_ir/decls.ts").ClauseKind, tcx: Interner) => Predicate),
      );
    }
    this.depth -= 1;
    return res;
  }

  // ---- impl<'a, 'b, 'tcx> TypeFolder<TyCtxt<'tcx>> for AssocTypeNormalizer<'a, 'b, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:379 cx
  cx(): TyCtxt {
    return this.selcx.tcx();
  }

  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:383 fold_binder
  fold_binder<T>(t_: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.universes.push(undefined);
    const t = fold_Binder(d).super_fold_with(t_, this);
    this.universes.pop();
    return t;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:393 fold_ty
  fold_ty(ty: Ty): Ty {
    // We don't use the rigid marker in old solver.
    // debug_assert!(!ty.has_rigid_aliases());

    if (!needs_normalization(this.selcx.infcx, ty, fold_Ty)) {
      return ty;
    }

    const k = ty.kind();
    if (k.$ !== "Alias") {
      return fold_Ty.super_fold_with(ty, this);
    }
    const data = k._1;

    // We try to be a little clever here as a performance optimization in
    // cases where there are nested projections under binders.
    // For example:
    // ```
    // for<'a> fn(<T as Foo>::One<'a, Box<dyn Bar<'a, Item=<T as Foo>::Two<'a>>>>)
    // ```
    // We normalize the args on the projection before the projecting, but
    // if we're naive, we'll
    //   replace bound vars on inner, project inner, replace placeholders on inner,
    //   replace bound vars on outer, project outer, replace placeholders on outer
    //
    // However, if we're a bit more clever, we can replace the bound vars
    // on the entire type before normalizing nested projections, meaning we
    //   replace bound vars on outer, project inner,
    //   project outer, replace placeholders on outer
    //
    // This is possible because the inner `'a` will already be a placeholder
    // when we need to normalize the inner projection
    //
    // On the other hand, this does add a bit of complexity, since we only
    // replace bound vars if the current type is a `Projection` and we need
    // to make sure we don't forget to fold the args regardless.

    switch (data.kind.$) {
      case "Opaque": {
        const def_id = data.kind.def_id;
        // Only normalize `impl Trait` outside of type inference, usually in codegen.
        const mode = this.selcx.typing_mode();
        switch (mode.$) {
          // FIXME(#132279): We likely want to reveal opaques during post borrowck analysis
          case "Typeck":
          case "PostTypeckUntilBorrowck":
          case "PostBorrowck":
            return fold_Ty.super_fold_with(ty, this);
          case "Reflection":
          case "PostAnalysis":
          case "Codegen": {
            const recursion_limit = this.cx().recursion_limit();
            if (!recursion_limit.value_within_limit(this.depth)) {
              err_ctxt(this.selcx.infcx).report_overflow_error({ $: "DeeplyNormalize", _0: AliasTermC.from_AliasTy(data) }, this.cause.span, true, (_) => {});
            }

            const args = d_GenericArgs().fold_with(data.args, this);
            const generic_ty = this.cx().type_of(def_id) as EarlyBinder<Ty>;
            const concrete_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(generic_ty, this.cx(), args, fold_Ty));
            this.depth += 1;
            const folded_ty = this.fold_ty(concrete_ty);
            this.depth -= 1;
            return folded_ty;
          }
          case "Coherence":
            return unreachable("internal error: entered unreachable code: old solver coherence");
          // PORT: `ErasedNotCoherence(CantBeErased)` is uninhabited (no arm upstream).
          case "ErasedNotCoherence":
            return mode._0;
        }
      }

      case "Projection":
        return TermC.expect_type(this.normalize_trait_projection(AliasTermC.from_AliasTy(data)));
      case "Inherent":
        return TermC.expect_type(this.normalize_inherent_projection(AliasTermC.from_AliasTy(data)));
      case "Free":
        return TermC.expect_type(this.normalize_free_alias(AliasTermC.from_AliasTy(data)));
    }
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:466 fold_const
  fold_const(ct_: Const): Const {
    // We don't use the rigid marker in old solver.
    // debug_assert!(!ct.has_rigid_aliases());

    const tcx = this.selcx.tcx();

    const k0 = ct_.kind();
    if (
      (tcx.features().generic_const_exprs() &&
        // Normalize type_const items even with feature `generic_const_exprs`.
        !(k0.$ === "Alias" && AliasConstKind.is_direct_const(k0._1.kind, tcx as unknown as Interner))) ||
      !needs_normalization(this.selcx.infcx, ct_, fold_Const)
    ) {
      return ct_;
    }

    if (k0.$ !== "Alias") {
      return fold_Const.super_fold_with(ct_, this);
    }
    const alias_const = k0._1;

    // Note that the Projection/Inherent/Free cases are unreachable on stable,
    // unless a `gca_min_const_items` feature gate error has already
    // been emitted earlier in compilation.
    //
    // That's because we can only end up with an Alias ty::Const for a const item
    // if it was marked with `type const`. Using this attribute without the mgca
    // feature gate causes a parse error.
    let ct: Const;
    switch (alias_const.kind.$) {
      case "Projection":
        ct = TermC.expect_const(this.normalize_trait_projection(AliasTermC.from_AliasConst(alias_const)));
        break;
      case "InherentSelf":
      case "InherentImpl":
        ct = TermC.expect_const(this.normalize_inherent_projection(AliasTermC.from_AliasConst(alias_const)));
        break;
      case "Free":
        ct = TermC.expect_const(this.normalize_free_alias(AliasTermC.from_AliasConst(alias_const)));
        break;
      case "Anon": {
        const ct1 = fold_Const.super_fold_with(ct_, this);
        ct = with_replaced_escaping_bound_vars(this.selcx.infcx, this.universes, ct1, (ct) => evaluate_const(this.selcx.infcx, ct, this.param_env), fold_Const, fold_Const);
        break;
      }
    }

    // We re-fold the normalized const as the `ty` field on `ConstKind::Value` may be
    // unnormalized after const evaluation returns.
    return fold_Const.super_fold_with(ct, this);
  }

  // #[inline]
  // rustc: compiler/rustc_trait_selection/src/traits/normalize.rs:519 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (d.allow_normalization(p) && needs_normalization(this.selcx.infcx, p, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // The provided `TypeFolder` methods `AssocTypeNormalizer` does not override (fold.rs).
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// ---- PORT: descriptors -------------------------------------------------------------------------------------------------

/** The derived `TypeFoldable` of `AliasTerm` (= `Alias<AliasTermKind>`, rustc_type_ir ty/alias.rs) as a D4 descriptor. */
function d_AliasTerm(): TypeFoldable<AliasTerm> {
  return {
    visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
    try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
    fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
  };
}
/** The `TypeFoldable` of `GenericArgs` (rustc_middle generic_args.ts). */
function d_GenericArgs(): TypeFoldable<import("../../rustc_middle/ty/decls.ts").GenericArgs> {
  return fold_GenericArgs;
}

// ---- PORT(merge): stand-ins for other lanes' items (each stops as UNPORTED; root repoints them) ------------------------

/** `crate::solve::normalize(at, value)` (solve/normalize.rs, lane trait-sel-solve). */
function pending_solve_normalize<T>(_at: At, _value: Unnormalized<T>, _d_T: TypeFoldable<T>): Normalized<T> {
  return unported("rustc_trait_selection::solve::normalize::normalize (solve/normalize.rs, lane trait-sel-solve)");
}

/** `crate::solve::deeply_normalize(at, value)` (solve/normalize.rs, lane trait-sel-solve). */
function pending_solve_deeply_normalize<T, E>(_at: At, _value: Unnormalized<T>, _d_T: TypeFoldable<T>, _from_solver_error_E: FromSolverError<E, NextSolverError>): Result<T, E[]> {
  return unported("rustc_trait_selection::solve::normalize::deeply_normalize (solve/normalize.rs, lane trait-sel-solve)");
}

/** `SelectionContext::new(infcx)` (traits/select/mod.rs; old solver, wave 20). */
function pending_SelectionContext_new(_infcx: InferCtxt): SelectionContext {
  return unported("rustc_trait_selection::traits::select::SelectionContext::new (old solver, wave 20)");
}

/** `project::normalize_projection_term` (traits/project.rs; old solver, wave 20). */
function pending_project_normalize_projection_term(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Term {
  return unported("rustc_trait_selection::traits::project::normalize_projection_term (old solver, wave 20)");
}

/** `project::opt_normalize_projection_term(..).ok().flatten()` (traits/project.rs; old solver, wave 20). */
function pending_project_opt_normalize_projection_term(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _projection_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Result<Term | undefined, unknown> {
  return unported("rustc_trait_selection::traits::project::opt_normalize_projection_term (old solver, wave 20)");
}

/** `project::normalize_inherent_projection` (traits/project.rs; old solver, wave 20). */
function pending_project_normalize_inherent_projection(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Term {
  return unported("rustc_trait_selection::traits::project::normalize_inherent_projection (old solver, wave 20)");
}

/** `project::const_of_item_or_delayed_bug` (traits/project.rs, wave 20). */
function pending_project_const_of_item_or_delayed_bug(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Const> {
  return unported("rustc_trait_selection::traits::project::const_of_item_or_delayed_bug (traits/project.rs, wave 20)");
}
