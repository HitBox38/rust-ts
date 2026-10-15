//! Code for the 'normalization' query. This consists of a wrapper
//! which folds deeply, invoking the underlying
//! `normalize_canonicalized_projection` query when it encounters projections.
//
// Port of compiler/rustc_trait_selection/src/traits/query/normalize.rs (lane old-query-typeops, wave 18c).
//
// PORT:
// - `#[extension(pub trait QueryNormalizeExt)] impl At` puts `query_normalize` on `At.prototype` (declared in
//   ../../decls.ts); `T: TypeFoldable` is the trailing descriptor `d_T` (D4).
// - `MaxEscapingBoundVarVisitor` (generated interface, ./normalize.gen.ts) is visited by the local class
//   `MaxEscapingBoundVarVisitorImpl` that carries its fields (`TypeVisitor` needs the `Result` impl and methods);
//   `type Result = ()` is `undefined`.
// - `QueryNormalizer` (generated class, ./normalize.gen.ts) implements `FallibleTypeFolder<NoSolution>` through the
//   `declare module` below (precedent rustc_infer freshen.ts); its methods are assigned on the prototype.
//   `cache: SsoHashMap<Ty, Ty>` is a `Map` keyed by the interned `Ty`; `cause: &ObligationCause` is the At's cause
//   (shared, not cloned).
// - `std::any::type_name::<T>()` only feeds `debug!` / `info!` (tracing produces no output in the oracle): left out.
// - `infcx.err_ctxt()` (error_reporting, wave 19) is read through `err_ctxt` (../mod.ts); `build_overflow_error` is not
//   in its `TypeErrCtxtView` yet, so this file reads it through the local view `OverflowErrCtxtView`
//   (PORT(decls): pending root: add it to `TypeErrCtxtView`).
// Init order: top-level code here may touch only rustc_infer (loaded first by ../../lib.ts), ./normalize.gen.ts and other
// crates; this crate's other modules are read inside function bodies.

import { At, type InferCtxt } from "../../../rustc_infer/decls.ts";
import type { PredicateObligation, PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import { Normalized } from "../../../rustc_infer/traits/project.ts";
import { into_MultiSpan } from "../../../rustc_error_messages/lib.ts";
import type { Canonical, CanonicalQueryInput, QueryResponse } from "../../../rustc_middle/infer/canonical.ts";
import { debug_QueryResponse, OriginalQueryValues } from "../../../rustc_middle/infer/canonical.ts";
import {
  debug_NormalizationResult,
  fold_with_NormalizationResult,
  type NormalizationResult,
  try_fold_with_NormalizationResult,
  visit_with_NormalizationResult,
} from "../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clauses, Region, Term } from "../../../rustc_middle/ty/decls.ts";
import { debug_ParamEnvAnd, fold_Term, type ParamEnvAnd, Term as TermC, Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../../rustc_span/lib.ts";
import { type Binder, EarlyBinder, fold_Binder, visit_Binder } from "../../../rustc_type_ir/binder.ts";
import { debug_Canonical, debug_CanonicalQueryInput } from "../../../rustc_type_ir/canonical.gen.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.gen.ts";
import { FallibleTypeFolder_provided, type FallibleTypeFolder, type PredicateProxy, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { DebruijnIndex, INNERMOST, type UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { AliasTerm as AliasTermC, AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { debug_AliasTermKind } from "../../../rustc_type_ir/term_kind.gen.ts";
import { BoundVarReplacer, PlaceholderReplacer } from "../../../rustc_next_trait_solver/placeholder.ts";
import { type AliasTerm, debug_AliasTerm, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { VisitorResult, type VisitorResult as VisitorResultT } from "../../../rustc_ast_ir/visit.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { FulfillmentError } from "../mod.gen.ts";
import { type MaxEscapingBoundVarVisitor, QueryNormalizer } from "./normalize.gen.ts";

export * from "./normalize.gen.ts";
// `pub use rustc_middle::traits::query::NormalizationResult;`
export type { NormalizationResult } from "../../../rustc_middle/traits/query.ts";

declare module "./normalize.gen.ts" {
  interface QueryNormalizer extends FallibleTypeFolder<NoSolution> {
    try_fold_free_or_assoc(term: AliasTerm): Result<Term, NoSolution>;
  }
}

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

// ---- #[extension(pub trait QueryNormalizeExt<'tcx>)] impl<'a, 'tcx> At<'a, 'tcx> -------------------------------------

/// Normalize `value` in the context of the inference context,
/// yielding a resulting type, or an error if `value` cannot be
/// normalized. If you don't care about regions, you should prefer
/// `normalize_erasing_regions`, which is more efficient.
///
/// If the normalization succeeds, returns back the normalized
/// value along with various outlives relations (in the form of
/// obligations that must be discharged).
///
/// This normalization should *only* be used when the projection is well-formed and
/// does not have possible ambiguity (contains inference variables).
///
/// After codegen, when lifetimes do not matter, it is preferable to instead
/// use [`TyCtxt::normalize_erasing_regions`], which wraps this procedure.
///
/// N.B. Once the new solver is stabilized this method of normalization will
/// likely be removed as trait solver operations are already cached by the query
/// system making this redundant.
// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:48 query_normalize
At.prototype.query_normalize = function <T>(this: At, value: T, d_T: TypeFoldable<T>): Result<Normalized<T>, NoSolution> {
  // debug!("normalize::<{}>(value={:?}, param_env={:?}, cause={:?})", std::any::type_name::<T>(), value, self.param_env, self.cause);

  // This is actually a consequence by the way `normalize_erasing_regions` works currently.
  // Because it needs to call the `normalize_generic_arg_after_erasing_regions`, it folds
  // through tys and consts in a `TypeFoldable`. Importantly, it skips binders, leaving us
  // with trying to normalize with escaping bound vars.
  //
  // Here, we just add the universes that we *would* have created had we passed through the binders.
  //
  // We *could* replace escaping bound vars eagerly here, but it doesn't seem really necessary.
  // The rest of the code is already set up to be lazy about replacing bound vars,
  // and only when we actually have to normalize.
  let universes: (UniverseIndex | undefined)[];
  if (TypeVisitableExt.has_escaping_bound_vars(value, d_T)) {
    const max_visitor = new MaxEscapingBoundVarVisitorImpl(INNERMOST, 0);
    d_T.visit_with(value, max_visitor);
    universes = new Array<undefined>(max_visitor.escaping).fill(undefined);
  } else {
    universes = [];
  }

  if (this.infcx.next_trait_solver()) {
    const r = solve_normalize().deeply_normalize_with_skipped_universes<T, FulfillmentError>(
      this,
      Unnormalized.new_wip(value),
      universes,
      solve_fulfill().FromSolverError_FulfillmentError,
      d_T,
    );
    switch (r.$) {
      case "Ok": {
        const value_ = r._0;
        return Ok(new Normalized(value_, []));
      }
      case "Err": {
        const errors = r._0;
        // We're imitating the old solver's behavior of eagerly reporting overflow
        // errors here. Otherwise we might silently ignore such errors. See #161542.
        let found: [PredicateObligation, boolean] | undefined;
        for (const e of errors) {
          const code = e.code;
          if (code.$ === "Ambiguity" && code.overflow !== undefined) {
            const suggest_higher_limit = code.overflow;
            found = [e.root_obligation, suggest_higher_limit];
            break;
          }
        }
        if (found !== undefined) {
          const [overflowed_obligation, suggest_higher_limit] = found;
          traits_mod().err_ctxt(this.infcx).report_overflow_obligation(overflowed_obligation, suggest_higher_limit);
        } else {
          return Err(NO_SOLUTION);
        }
      }
    }
  }

  if (!traits_normalize().needs_normalization(this.infcx, value, d_T)) {
    return Ok(new Normalized(value, []));
  }

  const normalizer = new QueryNormalizer(this.infcx, this.cause, this.param_env, [], new Map<Ty, Ty>(), 0, universes);

  const result = d_T.try_fold_with(value, normalizer);
  // info!("normalize::<{}>: result={:?} with {} obligations", std::any::type_name::<T>(), result, normalizer.obligations.len());
  // debug!("normalize::<{}>: obligations={:?}", std::any::type_name::<T>(), normalizer.obligations);
  if (result.$ === "Err") return result;
  return Ok(new Normalized(result._0, normalizer.obligations));
};

// Visitor to find the maximum escaping bound var
// rustc-type: compiler/rustc_trait_selection/src/traits/query/normalize.rs:141 MaxEscapingBoundVarVisitor
class MaxEscapingBoundVarVisitorImpl implements MaxEscapingBoundVarVisitor, TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result: VisitorResultT<undefined, unknown> = VisitorResult.unit;

  constructor(
    // The index which would count as escaping
    public outer_index: DebruijnIndex,
    public escaping: number,
  ) {}

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for MaxEscapingBoundVarVisitor ----

  // rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:148 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    DebruijnIndex.shift_in(field_mut(this, "outer_index"), 1);
    visit_Binder(d).super_visit_with(t, this);
    DebruijnIndex.shift_out(field_mut(this, "outer_index"), 1);
  }

  // #[inline]
  // rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:155 visit_ty
  visit_ty(t: Ty): undefined {
    if (t.outer_exclusive_binder() > this.outer_index) {
      this.escaping = Math.max(this.escaping, DebruijnIndex.as_usize(t.outer_exclusive_binder()) - DebruijnIndex.as_usize(this.outer_index));
    }
  }

  // #[inline]
  // rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:164 visit_region
  visit_region(r: Region): undefined {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 > this.outer_index) {
      const debruijn = k._0._0;
      this.escaping = Math.max(this.escaping, DebruijnIndex.as_usize(debruijn) - DebruijnIndex.as_usize(this.outer_index));
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:176 visit_const
  visit_const(ct: Const): undefined {
    if (ct.outer_exclusive_binder() > this.outer_index) {
      this.escaping = Math.max(this.escaping, DebruijnIndex.as_usize(ct.outer_exclusive_binder()) - DebruijnIndex.as_usize(this.outer_index));
    }
  }

  // (provided) the `TypeVisitor` methods `MaxEscapingBoundVarVisitor` does not override.
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

// ---- impl<'a, 'tcx> FallibleTypeFolder<TyCtxt<'tcx>> for QueryNormalizer<'a, 'tcx> ------------------------------------
// `type Error = NoSolution;`

// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:198 cx
QueryNormalizer.prototype.cx = function (this: QueryNormalizer): TyCtxt {
  return this.infcx.tcx;
};

// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:202 try_fold_binder
QueryNormalizer.prototype.try_fold_binder = function <T>(this: QueryNormalizer, t_: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, NoSolution> {
  this.universes.push(undefined);
  const t = fold_Binder(d).try_super_fold_with(t_, this);
  this.universes.pop();
  return t;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:213 try_fold_ty
QueryNormalizer.prototype.try_fold_ty = function (this: QueryNormalizer, ty: Ty): Result<Ty, NoSolution> {
  if (!traits_normalize().needs_normalization(this.infcx, ty, fold_Ty)) {
    return Ok(ty);
  }

  const cached = this.cache.get(ty);
  if (cached !== undefined) {
    return Ok(cached);
  }

  const k = ty.kind();
  if (k.$ !== "Alias") {
    const r = fold_Ty.try_super_fold_with(ty, this);
    if (r.$ === "Err") return r;
    const res = r._0;
    this.cache.set(ty, res);
    return Ok(res);
  }
  const data = k._1;

  // See note in `rustc_trait_selection::traits::project` about why we
  // wait to fold the args.
  let res: Ty;
  switch (data.kind.$) {
    case "Opaque": {
      const def_id = data.kind.def_id;
      // Only normalize `impl Trait` outside of type inference, usually in codegen.
      const mode = TypingMode.assert_not_erased(this.infcx.typing_mode_raw());
      switch (mode.$) {
        case "Typeck":
        case "PostTypeckUntilBorrowck":
        case "PostBorrowck": {
          const r = fold_Ty.try_super_fold_with(ty, this);
          if (r.$ === "Err") return r;
          res = r._0;
          break;
        }

        case "Reflection":
        case "PostAnalysis":
        case "Codegen": {
          const args_r = fold_GenericArgs.try_fold_with(data.args, this);
          if (args_r.$ === "Err") return args_r;
          const args = args_r._0;
          const recursion_limit = this.cx().recursion_limit();

          if (!recursion_limit.value_within_limit(this.anon_depth)) {
            const guar = (traits_mod().err_ctxt(this.infcx) as unknown as OverflowErrCtxtView)
              .build_overflow_error({ $: "DeeplyNormalize", _0: AliasTermC.from_AliasTy(data) }, this.cause.span, true)
              .delay_as_bug();
            return Ok(Ty.new_error(this.cx(), guar));
          }

          const generic_ty = this.cx().type_of(def_id) as EarlyBinder<Ty>;
          let concrete_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(generic_ty, this.cx(), args, fold_Ty));
          this.anon_depth += 1;
          if (concrete_ty === ty) {
            concrete_ty = Ty.new_error_with_message(this.cx(), into_MultiSpan(DUMMY_SP), "recursive opaque type");
          }
          const folded_ty = this.try_fold_ty(concrete_ty);
          this.anon_depth -= 1;
          if (folded_ty.$ === "Err") return folded_ty;
          res = folded_ty._0;
          break;
        }
        case "Coherence":
          return unreachable("internal error: entered unreachable code: old solver coherence");
        // PORT: `ErasedNotCoherence(CantBeErased)` is uninhabited after `assert_not_erased` (no arm upstream).
        case "ErasedNotCoherence":
          return mode._0;
      }
      break;
    }

    case "Projection":
    case "Inherent":
    case "Free": {
      const kind = data.kind;
      const r = this.try_fold_free_or_assoc(AliasTermC.new(this.cx(), AliasTermKind.from_AliasTyKind(kind), data.args));
      if (r.$ === "Err") return r;
      res = TermC.expect_type(r._0);
      break;
    }
  }

  this.cache.set(ty, res);
  return Ok(res);
};

// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:285 try_fold_const
QueryNormalizer.prototype.try_fold_const = function (this: QueryNormalizer, constant_: Const): Result<Const, NoSolution> {
  if (!traits_normalize().needs_normalization(this.infcx, constant_, fold_Const)) {
    return Ok(constant_);
  }

  const k = constant_.kind();
  if (k.$ !== "Alias") {
    return fold_Const.try_super_fold_with(constant_, this);
  }
  const alias_const = k._1;

  let constant: Const;
  if (alias_const.kind.$ === "Anon") {
    const traits = traits_mod();
    constant = traits.with_replaced_escaping_bound_vars(
      this.infcx,
      this.universes,
      constant_,
      (constant) => traits.evaluate_const(this.infcx, constant, this.param_env),
      fold_Const,
      fold_Const,
    );
  } else {
    const r = this.try_fold_free_or_assoc(AliasTermC.from_AliasConst(alias_const));
    if (r.$ === "Err") return r;
    constant = TermC.expect_const(r._0);
  }
  // debug!(?constant, ?self.param_env);
  return fold_Const.try_super_fold_with(constant, this);
};

// #[inline]
// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:312 try_fold_predicate
QueryNormalizer.prototype.try_fold_predicate = function <P>(this: QueryNormalizer, p: P, d: PredicateProxy<P>): Result<P, NoSolution> {
  if (d.allow_normalization(p) && traits_normalize().needs_normalization(this.infcx, p, d)) {
    return d.try_super_fold_with(p, this);
  } else {
    return Ok(p);
  }
};

// (provided) the `FallibleTypeFolder` methods `QueryNormalizer` does not override.
QueryNormalizer.prototype.try_fold_region = function (this: QueryNormalizer, r: Region): Result<Region, NoSolution> {
  return FallibleTypeFolder_provided.try_fold_region(this, r);
};
QueryNormalizer.prototype.try_fold_clauses = function (this: QueryNormalizer, c: Clauses): Result<Clauses, NoSolution> {
  return FallibleTypeFolder_provided.try_fold_clauses(this, c);
};

// ---- impl<'a, 'tcx> QueryNormalizer<'a, 'tcx> ------------------------------------------------------------------------

// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:325 try_fold_free_or_assoc
QueryNormalizer.prototype.try_fold_free_or_assoc = function (this: QueryNormalizer, term_: AliasTerm): Result<Term, NoSolution> {
  const infcx = this.infcx;
  const tcx = infcx.tcx;
  // Just an optimization: When we don't have escaping bound vars,
  // we don't need to replace them with placeholders.
  let term0: AliasTerm;
  let maps: PlaceholderMaps | undefined;
  if (TypeVisitableExt.has_escaping_bound_vars(term_, d_AliasTerm)) {
    const [term, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(infcx, this.universes, term_, d_AliasTerm);
    term0 = term;
    maps = [mapped_regions, mapped_types, mapped_consts];
  } else {
    term0 = term_;
    maps = undefined;
  }
  const term_r = d_AliasTerm.try_fold_with(term0, this);
  if (term_r.$ === "Err") return term_r;
  const term = term_r._0;

  const orig_values = OriginalQueryValues.default_();
  const c_term = infcx.canonicalize_query(this.param_env.and(term), orig_values, d_AliasTerm);
  // debug!("QueryNormalizer: c_term = {:#?}", c_term);
  // debug!("QueryNormalizer: orig_values = {:#?}", orig_values);
  let result_r: Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution>;
  switch (term.kind.$) {
    case "ProjectionTy":
    case "ProjectionConst":
      result_r = tcx.normalize_canonicalized_projection(c_term) as Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution>;
      break;
    case "FreeTy":
    case "FreeConst":
      result_r = tcx.normalize_canonicalized_free_alias(c_term) as Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution>;
      break;
    case "InherentTy":
    case "InherentConstSelf":
    case "InherentConstImpl":
      result_r = tcx.normalize_canonicalized_inherent_projection(c_term) as Result<Canonical<QueryResponse<NormalizationResult>>, NoSolution>;
      break;
    case "OpaqueTy":
    case "AnonConst": {
      const kind = term.kind;
      return unreachable(`internal error: entered unreachable code: did not expect ${debug_AliasTermKind(kind, PLAIN)} due to match arm above`);
    }
  }
  if (result_r.$ === "Err") return result_r;
  const result = result_r._0;
  // We don't expect ambiguity.
  if (!result.value.is_proven()) {
    // Rustdoc normalizes possibly not well-formed types, so only
    // treat this as a bug if we're not in rustdoc.
    if (!tcx.sess.opts.actually_rustdoc) {
      tcx.dcx().delayed_bug(`unexpected ambiguity: ${debug_c_term(c_term)} ${debug_result(result)}`);
    }
    return Err(NO_SOLUTION);
  }
  const ok_r = infcx.instantiate_query_response_and_region_obligations(this.cause, this.param_env, orig_values, result, d_NormalizationResult);
  if (ok_r.$ === "Err") return Err(NO_SOLUTION);
  const { value: result_, obligations } = ok_r._0;
  // debug!("QueryNormalizer: result = {:#?}", result);
  // debug!("QueryNormalizer: obligations = {:#?}", obligations);
  this.obligations.push(...obligations);
  let res: Term;
  if (maps !== undefined) {
    const [mapped_regions, mapped_types, mapped_consts] = maps;
    res = PlaceholderReplacer.replace_placeholders(infcx, mapped_regions, mapped_types, mapped_consts, this.universes, result_.normalized_term, fold_Term);
  } else {
    res = result_.normalized_term;
  }
  // `tcx.normalize_canonicalized_projection` may normalize to a type that
  // still has alias consts, so keep normalizing here if that's the case.
  // Similarly, `tcx.normalize_canonicalized_free_alias` will only unwrap one layer
  // of type/const and we need to continue folding it to reveal the TAIT behind it
  // or further normalize nested alias consts.
  if (
    res !== AliasTermC.to_term(term, tcx, "No") &&
    (TypeVisitableExt.has_type_flags(res, TypeFlags.HAS_CONST_ALIAS, fold_Term) || term.kind.$ === "FreeTy" || term.kind.$ === "FreeConst")
  ) {
    return fold_Term.try_fold_with(res, this);
  } else {
    return Ok(res);
  }
};

// ---- PORT: views, descriptors and lazily read modules ------------------------------------------------------------------

/**
 * PORT(decls): pending root. `TypeErrCtxt::build_overflow_error` (error_reporting/traits/overflow.rs, wave 19) is not in
 * ../mod.ts's `TypeErrCtxtView`; `Diag::delay_as_bug` returns the `ErrorGuaranteed`.
 */
interface OverflowErrCtxtView {
  build_overflow_error(
    cause: { $: "DeeplyNormalize"; _0: AliasTerm },
    span: Span,
    suggest_increasing_limit: boolean,
  ): { delay_as_bug(): ErrorGuaranteed };
}

/** The placeholder maps of `BoundVarReplacer::replace_bound_vars`. */
type PlaceholderMaps = [
  ReturnType<typeof BoundVarReplacer.replace_bound_vars>[1],
  ReturnType<typeof BoundVarReplacer.replace_bound_vars>[2],
  ReturnType<typeof BoundVarReplacer.replace_bound_vars>[3],
];

/** The derived `TypeFoldable` of `AliasTerm` (= `Alias<AliasTermKind>`, rustc_type_ir ty/alias.rs). */
const d_AliasTerm: TypeFoldable<AliasTerm> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};
/** The derived `TypeFoldable` of `NormalizationResult` (rustc_middle traits/query.rs). */
const d_NormalizationResult: TypeFoldable<NormalizationResult> = {
  visit_with: visit_with_NormalizationResult,
  try_fold_with: try_fold_with_NormalizationResult,
  fold_with: fold_with_NormalizationResult,
};

/** `{c_term:?}` of a `CanonicalQueryInput<ParamEnvAnd<AliasTerm>>`. */
function debug_c_term(c_term: CanonicalQueryInput<ParamEnvAnd<AliasTerm>>): string {
  return debug_CanonicalQueryInput(c_term, PLAIN, (v, f) => debug_ParamEnvAnd(v, f, debug_AliasTerm));
}
/** `{result:?}` of a `&Canonical<QueryResponse<NormalizationResult>>`. */
function debug_result(result: Canonical<QueryResponse<NormalizationResult>>): string {
  return debug_Canonical(result, PLAIN, (v, f) => debug_QueryResponse(v, f, debug_NormalizationResult));
}
function traits_mod(): typeof import("../mod.ts") {
  return require("../mod.ts") as typeof import("../mod.ts");
}
function traits_normalize(): typeof import("../normalize.ts") {
  return require("../normalize.ts") as typeof import("../normalize.ts");
}
function solve_normalize(): typeof import("../../solve/normalize.ts") {
  return require("../../solve/normalize.ts") as typeof import("../../solve/normalize.ts");
}
function solve_fulfill(): typeof import("../../solve/fulfill.ts") {
  return require("../../solve/fulfill.ts") as typeof import("../../solve/fulfill.ts");
}
