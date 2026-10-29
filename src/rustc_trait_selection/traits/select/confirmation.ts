// Port of compiler/rustc_trait_selection/src/traits/select/confirmation.rs (lane old-candidates-confirm, wave 18c).
//
// The confirmation methods of `SelectionContext` (confirmation.rs:33 `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>`) are
// assigned onto `SelectionContext.prototype` in upstream order; their signatures are declared in ../../decls.ts
// (`declare module "./traits/select/mod.gen.ts"`). `fn flatten_answer_tree` (:292) is a local function of
// `confirm_transmutability_candidate`.
//
// PORT (file-wide):
// - `#[instrument]`, `debug!` (tracing) produce no output in the oracle: dropped / kept as comments.
// - `?` on a `Result<_, SelectionError>` returns the `Err` unchanged; `.map_err(|_| SelectionError::Unimplemented)?` returns
//   `Err(SelectionError::Unimplemented)`.
// - `ThinVec` / `PredicateObligations` are arrays; `thin_vec![x]` is `[x]`.
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only (lazy `require`). ../../lib.ts imports this file after ./mod.ts.

//! Confirmation.
//!
//! Confirmation unifies the output type parameters of the trait
//! with the values found in the obligation, possibly yielding a
//! type error. See the [rustc dev guide] for more details.
//!
//! [rustc dev guide]:
//! https://rustc-dev-guide.rust-lang.org/traits/resolution.html#confirmation

import { ControlFlow, type ControlFlow as ControlFlowT } from "../../../rustc_ast_ir/visit.ts";
import { debug_LangItem, LangItem } from "../../../rustc_attr_ir/lang_items.gen.ts";
import { ToTrace_TraitRef, ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import { debug_Obligation, Obligation, type PolyTraitObligation, type PredicateObligation, type PredicateObligations, type Selection, type TraitObligation } from "../../../rustc_infer/traits/mod.ts";
import { Normalized } from "../../../rustc_infer/traits/project.gen.ts";
import {
  clone_ObligationCause,
  type ImplSource,
  type ImplSourceUserDefinedData,
  type ObligationCause,
  type ObligationCauseCode,
  type SelectionError,
} from "../../../rustc_middle/traits/mod.ts";
import type { DerivedCause } from "../../../rustc_middle/traits/mod.gen.ts";
import type { SelectionCandidate } from "../../../rustc_middle/traits/select.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Const, GenericArgs, ParamEnv, Predicate, Region } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { AssocItem, AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import {
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_ClauseKind,
  Predicate_upcast_from_PolyRegionOutlivesClause,
  Predicate_upcast_from_PolyTraitRef,
  Predicate_upcast_from_RegionOutlivesClause,
  Predicate_upcast_from_TraitRef,
} from "../../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Clause, fold_Span, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import type { DenseBitSet } from "../../../rustc_index/bit_set.ts";
import { type DefId, debug_DefId } from "../../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { Binder, debug_Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { ExistentialPredicate, ExistentialTraitRef, OutlivesClause, PolyExistentialPredicate, TraitClause, TraitRef } from "../../../rustc_type_ir/decls.ts";
import { supertraits } from "../../../rustc_type_ir/elaborate.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { debug_TraitRef } from "../../../rustc_type_ir/ir_print.ts";
import { ClosureKind } from "../../../rustc_type_ir/lib.ts";
import {
  as_interner,
  debug_TraitClause,
  ExistentialTraitRef as ExistentialTraitRefC,
  fold_with_ExistentialPredicate,
  fold_with_ExistentialTraitRef,
  fold_with_OutlivesClause,
  fold_with_TraitClause,
  fold_with_TraitRef,
  PolyExistentialPredicate as PolyExistentialPredicateC,
  PolyExistentialTraitRef,
  PolyTraitClause,
  TraitClause as TraitClauseC,
  TraitRef as TraitRefC,
  try_fold_with_ExistentialPredicate,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_OutlivesClause,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_ExistentialPredicate,
  visit_with_ExistentialTraitRef,
  visit_with_OutlivesClause,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import type { BuiltinImplSource } from "../../../rustc_type_ir/solve/mod.ts";
import { PolyFnSig, FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { debug_option, PLAIN } from "../../../std/fmt.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import * as rustc_transmute from "../../../rustc_transmute/lib.ts";
import { type AutoImplConstituents, fold_with_AutoImplConstituents, SelectionContext, try_fold_with_AutoImplConstituents, visit_with_AutoImplConstituents } from "./mod.gen.ts";

// ---- D4 descriptors / upcasts ---------------------------------------------------------------------------------------

const d_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};
const d_ExistentialPredicate: TypeFoldable<ExistentialPredicate> = {
  visit_with: visit_with_ExistentialPredicate,
  try_fold_with: try_fold_with_ExistentialPredicate,
  fold_with: fold_with_ExistentialPredicate,
};
const d_AutoImplConstituents: TypeFoldable<AutoImplConstituents> = {
  visit_with: visit_with_AutoImplConstituents,
  try_fold_with: try_fold_with_AutoImplConstituents,
  fold_with: fold_with_AutoImplConstituents,
};
/** `ty::ArgOutlivesClause` (`OutlivesClause<GenericArg>`). */
const d_ArgOutlivesClause: TypeFoldable<OutlivesClause<GenericArg>> = {
  visit_with: (s, v) => visit_with_OutlivesClause(s, v, fold_GenericArg.visit_with),
  try_fold_with: (s, f) => try_fold_with_OutlivesClause(s, f, fold_GenericArg.try_fold_with),
  fold_with: (s, f) => fold_with_OutlivesClause(s, f, fold_GenericArg.fold_with),
};

type Upcast<F, T> = (from: F, tcx: Interner) => T;
const upcast_TraitRef = Predicate_upcast_from_TraitRef as unknown as Upcast<TraitRef, Predicate>;
const upcast_PolyTraitRef = Predicate_upcast_from_PolyTraitRef as unknown as Upcast<Binder<TraitRef>, Predicate>;
const upcast_Clause = Predicate_upcast_from_Clause as unknown as Upcast<Clause, Predicate>;
const upcast_RegionOutlivesClause = Predicate_upcast_from_RegionOutlivesClause as unknown as Upcast<OutlivesClause<Region>, Predicate>;
const upcast_PolyRegionOutlivesClause = Predicate_upcast_from_PolyRegionOutlivesClause as unknown as Upcast<Binder<OutlivesClause<Region>>, Predicate>;
/** `impl<T> Upcast<I, T> for T` at `TraitClause` (`obligation.with(tcx, placeholder_predicate)` builds a `TraitObligation`). */
const upcast_identity_TraitClause: Upcast<TraitClause, TraitClause> = (from) => from;
/** `impl<T> Upcast<I, T> for T` at `Predicate`. */
const upcast_identity_Predicate: Upcast<Predicate, Predicate> = (from) => from;

/** `ObligationCauseCode::BuiltinDerived` as the variant constructor passed to `derived_cause`. */
const BuiltinDerived = (d: DerivedCause): ObligationCauseCode => ({ $: "BuiltinDerived", _0: d });

/** `BuiltinImplSource::Misc`. */
const Misc: BuiltinImplSource = { $: "Misc" };

/** `crate::traits::normalize` (read lazily: init order). */
function normalize_mod(): typeof import("../normalize.ts") {
  return (normalize_mod__m ??= require("../normalize.ts") as typeof import("../normalize.ts"));
}
var normalize_mod__m: typeof import("../normalize.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** `crate::traits::util` (read lazily: init order). */
function util(): typeof import("../util.ts") {
  return (util__m ??= require("../util.ts") as typeof import("../util.ts"));
}
var util__m: typeof import("../util.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** `{:?}` of a `PolyTraitObligation`. */
function debug_PolyTraitObligation(o: PolyTraitObligation): string {
  return debug_Obligation(o, PLAIN, (p, f) => debug_Binder(p, f, debug_TraitClause));
}

/** `Iterator::nth` over `util::supertraits`. */
function nth<T>(it: Iterable<T>, n: number): T | undefined {
  let i = 0;
  for (const x of it) {
    if (i === n) return x;
    i++;
  }
  return undefined;
}

// ---- impl<'cx, 'tcx> SelectionContext<'cx, 'tcx> (confirmation.rs:33) ------------------------------------------------

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:35 confirm_candidate
SelectionContext.prototype.confirm_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidate: SelectionCandidate,
): Result<Selection, SelectionError> {
  let r: Selection;
  switch (candidate.$) {
    case "SizedCandidate": {
      const data = this.confirm_builtin_candidate(obligation);
      r = { $: "Builtin", _0: Misc, _1: data };
      break;
    }

    case "BuiltinCandidate": {
      const data = this.confirm_builtin_candidate(obligation);
      r = { $: "Builtin", _0: Misc, _1: data };
      break;
    }

    case "TransmutabilityCandidate": {
      const data = this.confirm_transmutability_candidate(obligation);
      if (data.$ === "Err") return data;
      r = { $: "Builtin", _0: Misc, _1: data._0 };
      break;
    }

    case "ParamCandidate": {
      const param = candidate._0;
      const obligations = this.confirm_param_candidate(
        obligation,
        Binder.map_bound(param, (t) => t.trait_ref),
      );
      r = { $: "Param", _0: obligations };
      break;
    }

    case "ImplCandidate": {
      const impl_def_id = candidate._0;
      r = { $: "UserDefined", _0: this.confirm_impl_candidate(obligation, impl_def_id) };
      break;
    }

    case "AutoImplCandidate": {
      const data = this.confirm_auto_impl_candidate(obligation);
      if (data.$ === "Err") return data;
      r = { $: "Builtin", _0: Misc, _1: data._0 };
      break;
    }

    case "ProjectionCandidate": {
      const idx = candidate.idx;
      const obligations = this.confirm_projection_candidate(obligation, idx);
      if (obligations.$ === "Err") return obligations;
      r = { $: "Param", _0: obligations._0 };
      break;
    }

    case "ObjectCandidate": {
      const idx = candidate._0;
      const s = this.confirm_object_candidate(obligation, idx);
      if (s.$ === "Err") return s;
      r = s._0;
      break;
    }

    case "ClosureCandidate": {
      const vtable_closure = this.confirm_closure_candidate(obligation);
      if (vtable_closure.$ === "Err") return vtable_closure;
      r = { $: "Builtin", _0: Misc, _1: vtable_closure._0 };
      break;
    }

    case "AsyncClosureCandidate": {
      const vtable_closure = this.confirm_async_closure_candidate(obligation);
      if (vtable_closure.$ === "Err") return vtable_closure;
      r = { $: "Builtin", _0: Misc, _1: vtable_closure._0 };
      break;
    }

    // No nested obligations or confirmation process. The checks that we do in
    // candidate assembly are sufficient.
    case "AsyncFnKindHelperCandidate": {
      r = { $: "Builtin", _0: Misc, _1: [] };
      break;
    }

    case "CoroutineCandidate": {
      const vtable_coroutine = this.confirm_coroutine_candidate(obligation);
      if (vtable_coroutine.$ === "Err") return vtable_coroutine;
      r = { $: "Builtin", _0: Misc, _1: vtable_coroutine._0 };
      break;
    }

    case "FutureCandidate": {
      const vtable_future = this.confirm_future_candidate(obligation);
      if (vtable_future.$ === "Err") return vtable_future;
      r = { $: "Builtin", _0: Misc, _1: vtable_future._0 };
      break;
    }

    case "IteratorCandidate": {
      const vtable_iterator = this.confirm_iterator_candidate(obligation);
      if (vtable_iterator.$ === "Err") return vtable_iterator;
      r = { $: "Builtin", _0: Misc, _1: vtable_iterator._0 };
      break;
    }

    case "AsyncIteratorCandidate": {
      const vtable_iterator = this.confirm_async_iterator_candidate(obligation);
      if (vtable_iterator.$ === "Err") return vtable_iterator;
      r = { $: "Builtin", _0: Misc, _1: vtable_iterator._0 };
      break;
    }

    case "FnPointerCandidate": {
      const data = this.confirm_fn_pointer_candidate(obligation);
      if (data.$ === "Err") return data;
      r = { $: "Builtin", _0: Misc, _1: data._0 };
      break;
    }

    case "TraitAliasCandidate": {
      const data = this.confirm_trait_alias_candidate(obligation);
      r = { $: "Builtin", _0: Misc, _1: data };
      break;
    }

    case "BuiltinObjectCandidate": {
      // This indicates something like `Trait + Send: Send`. In this case, we know that
      // this holds because that's what the object type is telling us, and there's really
      // no additional obligations to prove and no types in particular to unify, etc.
      r = { $: "Builtin", _0: Misc, _1: [] };
      break;
    }

    case "BuiltinUnsizeCandidate": {
      const s = this.confirm_builtin_unsize_candidate(obligation);
      if (s.$ === "Err") return s;
      r = s._0;
      break;
    }

    case "TraitUpcastingUnsizeCandidate": {
      const idx = candidate._0;
      const s = this.confirm_trait_upcasting_unsize_candidate(obligation, idx);
      if (s.$ === "Err") return s;
      r = s._0;
      break;
    }

    case "BikeshedGuaranteedNoDropCandidate": {
      r = this.confirm_bikeshed_guaranteed_no_drop_candidate(obligation);
      break;
    }

    case "TryAsDynCandidate":
      r = this.confirm_try_as_dyn_candidate(obligation);
      break;
  }
  return Ok(r);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:145 confirm_projection_candidate
SelectionContext.prototype.confirm_projection_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  idx: number,
): Result<PredicateObligations, SelectionError> {
  const placeholder_trait_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause).trait_ref;
  const placeholder_self_ty = this.infcx.shallow_resolve(TraitRefC.self_ty(placeholder_trait_predicate));
  const cf = this.for_each_item_bound<Clause>(
    placeholder_self_ty,
    (_, clause, clause_idx, __): ControlFlowT<Clause, null> => {
      if (clause_idx === idx) {
        return ControlFlow.Break(clause);
      } else {
        return ControlFlow.Continue(null);
      }
    },
    () => unreachable(),
  );
  const candidate_predicate_ = unwrap(cf.$ === "Break" ? cf._0 : undefined, "expected to index into clause that exists");
  const candidate_predicate__ = unwrap(candidate_predicate_.as_trait_clause(), "projection candidate is not a trait predicate");
  const candidate_predicate = util().lazily_elaborate_sizedness_candidate(this.infcx, obligation, candidate_predicate__);

  const candidate_ = Binder.map_bound(candidate_predicate, (t) => t.trait_ref);

  const candidate__ = this.infcx.instantiate_binder_with_fresh_vars(obligation.cause.span, BoundRegionConversionTime.HigherRankedType, candidate_, d_TraitRef);
  const obligations: PredicateObligations = [];
  const candidate = normalize_mod().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    Unnormalized.new_wip(candidate__),
    obligations,
    d_TraitRef,
  );

  const eq = this.infcx.at(obligation.cause, obligation.param_env).eq("No", placeholder_trait_predicate, candidate, ToTrace_TraitRef);
  if (eq.$ === "Err") return Err({ $: "Unimplemented" });
  obligations.push(...eq._0.obligations);

  return Ok(obligations);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:201 confirm_param_candidate
SelectionContext.prototype.confirm_param_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  param_: Binder<TraitRef>,
): PredicateObligations {
  // debug!(?obligation, ?param, "confirm_param_candidate");

  const param = Binder.map_bound(
    util().lazily_elaborate_sizedness_candidate(this.infcx, obligation, PolyTraitClause.upcast_from_PolyTraitRef(param_, as_interner(this.infcx.tcx))),
    (p) => p.trait_ref,
  );

  // During evaluation, we already checked that this
  // where-clause trait-ref could be unified with the obligation
  // trait-ref. Repeat that unification now without any
  // transactional boundary; it should not fail.
  const r = this.match_where_clause_trait_ref(obligation, param);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    return bug(`Where clause \`${debug_Binder(param, PLAIN, debug_TraitRef)}\` was applicable to \`${debug_PolyTraitObligation(obligation)}\` but now is not`);
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:232 confirm_builtin_candidate
SelectionContext.prototype.confirm_builtin_candidate = function (this: SelectionContext, obligation: PolyTraitObligation): PredicateObligations {
  // debug!(?obligation, "confirm_builtin_candidate");
  const tcx = this.tcx();
  const trait_def = PolyTraitClause.def_id(obligation.predicate);
  const self_ty = this.infcx.shallow_resolve(this.infcx.enter_forall_and_leak_universe(PolyTraitClause.self_ty(obligation.predicate), fold_Ty));
  const lang = tcx.as_lang_item(trait_def);
  let types_: Binder<Ty[]>;
  switch (lang) {
    case LangItem.Sized:
      types_ = this.sizedness_conditions(self_ty, "Sized");
      break;
    case LangItem.MetaSized:
      types_ = this.sizedness_conditions(self_ty, "MetaSized");
      break;
    case LangItem.PointeeSized:
      return bug("`PointeeSized` is removing during lowering");
    case LangItem.Copy:
    case LangItem.Clone:
    case LangItem.TrivialClone:
      types_ = this.copy_clone_conditions(self_ty);
      break;
    case LangItem.FusedIterator:
      if (this.coroutine_is_gen(self_ty)) {
        types_ = Binder.dummy<Ty[]>([], fold_Vec(fold_Ty));
      } else {
        return unreachable("internal error: entered unreachable code: tried to assemble `FusedIterator` for non-gen coroutine");
      }
      break;
    case LangItem.Destruct:
    case LangItem.DiscriminantKind:
    case LangItem.Field:
    case LangItem.FnPtrTrait:
    case LangItem.PointeeTrait:
    case LangItem.Tuple:
    case LangItem.Unpin:
      types_ = Binder.dummy<Ty[]>([], fold_Vec(fold_Ty));
      break;
    default: {
      const other = lang;
      return bug(`unexpected builtin trait ${debug_DefId(trait_def, PLAIN)} (${debug_option(other, PLAIN, debug_LangItem)})`);
    }
  }
  const types = this.infcx.enter_forall_and_leak_universe(types_, fold_Vec(fold_Ty)) as Ty[];

  const cause = obligation.derived_cause(BuiltinDerived);
  return this.collect_predicates_for_types(obligation.param_env, cause, obligation.recursion_depth + 1, trait_def, types);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:284 confirm_transmutability_candidate
SelectionContext.prototype.confirm_transmutability_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  // use rustc_transmute::{Answer, Assume, Condition};
  type Assume = rustc_transmute.Assume;
  type Condition = rustc_transmute.Condition<Region, Ty>;

  /// Flatten the `Condition` tree into a conjunction of obligations.
  // #[instrument(level = "debug", skip(tcx, obligation))]
  // rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:292 flatten_answer_tree
  function flatten_answer_tree(tcx: TyCtxt, obligation: PolyTraitObligation, cond: Condition, assume_: Assume): PredicateObligations {
    switch (cond.$) {
      // FIXME(bryangarza): Add separate `IfAny` case, instead of treating as `IfAll`
      // Not possible until the trait solver supports disjunctions of obligations
      case "IfAll":
      case "IfAny": {
        const conds = cond._0;
        return conds.flatMap((cond) => flatten_answer_tree(tcx, obligation, cond, assume_));
      }
      case "Immutable": {
        const ty = cond.ty;
        const trait_ref = TraitRefC.new(as_interner(tcx), tcx.require_lang_item(LangItem.Freeze, obligation.cause.span), [GenericArg.from_Ty(ty)]);
        return [
          Obligation.with_depth(tcx, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, obligation.param_env, trait_ref, upcast_TraitRef),
        ];
      }
      case "Outlives": {
        const long = cond.long;
        const short = cond.short;
        const outlives: OutlivesClause<Region> = { _0: long, _1: short };
        return [
          Obligation.with_depth(
            tcx,
            clone_ObligationCause(obligation.cause),
            obligation.recursion_depth + 1,
            obligation.param_env,
            outlives,
            upcast_RegionOutlivesClause,
          ),
        ];
      }
      case "Transmutable": {
        const src = cond.src;
        const dst = cond.dst;
        const transmute_trait = PolyTraitClause.def_id(obligation.predicate);
        const assume: Const = Binder.skip_binder(obligation.predicate).trait_ref.args.const_at(2);
        const trait_ref = TraitRefC.new(as_interner(tcx), transmute_trait, [GenericArg.from_Ty(dst), GenericArg.from_Ty(src), GenericArg.from_Const(assume)]);
        return [
          Obligation.with_depth(tcx, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, obligation.param_env, trait_ref, upcast_TraitRef),
        ];
      }
    }
  }

  const predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);

  let assume = predicate.trait_ref.args.const_at(2);
  if (this.tcx().features().generic_const_exprs()) {
    const traits_mod = require("../mod.ts") as typeof import("../mod.ts");
    assume = traits_mod.evaluate_const(this.infcx, assume, obligation.param_env);
  }
  const assume_ = rustc_transmute.Assume.from_const(this.infcx.tcx, assume);
  if (assume_ === undefined) {
    return Err({ $: "Unimplemented" });
  }

  const dst = predicate.trait_ref.args.type_at(0);
  const src = predicate.trait_ref.args.type_at(1);

  // debug!(?src, ?dst);
  const transmute_env = rustc_transmute.TransmuteTypeEnv.new(this.infcx.tcx);
  const maybe_transmutable = transmute_env.is_transmutable(src, dst, assume_);

  let fully_flattened: PredicateObligations;
  switch (maybe_transmutable.$) {
    case "No":
      return Err({ $: "Unimplemented" });
    case "If":
      fully_flattened = flatten_answer_tree(this.tcx(), obligation, maybe_transmutable._0, assume_);
      break;
    case "Yes":
      fully_flattened = [];
      break;
  }

  // debug!(?fully_flattened);
  return Ok(fully_flattened);
};

/// This handles the case where an `auto trait Foo` impl is being used.
/// The idea is that the impl applies to `X : Foo` if the following conditions are met:
///
/// 1. For each constituent type `Y` in `X`, `Y : Foo` holds
/// 2. For each where-clause `C` declared on `Foo`, `[Self => X] C` holds.
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:384 confirm_auto_impl_candidate
SelectionContext.prototype.confirm_auto_impl_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  assert_eq(PolyTraitClause.polarity(obligation.predicate), "Positive", (v) => v);

  const self_ty_ = Binder.map_bound(PolyTraitClause.self_ty(obligation.predicate), (ty) => this.infcx.shallow_resolve(ty));
  const self_ty = this.infcx.enter_forall_and_leak_universe(self_ty_, fold_Ty);

  const constituents_ = this.constituent_types_for_auto_trait(self_ty);
  if (constituents_.$ === "Err") return constituents_;
  const constituents = this.infcx.enter_forall_and_leak_universe(constituents_._0, d_AutoImplConstituents);

  const cause = obligation.derived_cause(BuiltinDerived);
  const obligations = this.collect_predicates_for_types(
    obligation.param_env,
    clone_ObligationCause(cause),
    obligation.recursion_depth + 1,
    PolyTraitClause.def_id(obligation.predicate),
    constituents.types,
  );

  // Only normalize these goals if `-Zhigher-ranked-assumptions` is enabled, since
  // we don't want to cause ourselves to do extra work if we're not even able to
  // take advantage of these assumption clauses.
  if (this.tcx().sess.opts.unstable_opts.higher_ranked_assumptions) {
    // FIXME(coroutine_clone): We could uplift this into `collect_predicates_for_types`
    // and do this for `Copy`/`Clone` too, but that's feature-gated so it doesn't really
    // matter yet.
    for (const assumption_ of constituents.assumptions) {
      const assumption = normalize_mod().normalize_with_depth_to(
        this,
        obligation.param_env,
        clone_ObligationCause(cause),
        obligation.recursion_depth + 1,
        Unnormalized.new_wip(assumption_),
        obligations,
        d_ArgOutlivesClause,
      );
      this.infcx.register_region_assumption(assumption);
    }
  }

  return Ok(obligations);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:428 confirm_impl_candidate
SelectionContext.prototype.confirm_impl_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  impl_def_id: DefId,
): ImplSourceUserDefinedData<PredicateObligation> {
  // debug!(?obligation, ?impl_def_id, "confirm_impl_candidate");

  // First, create the generic parameters by matching the impl again,
  // this time not in a probe.
  const args = this.rematch_impl(impl_def_id, obligation);
  // debug!(?args, "impl args");

  return this.vtable_impl(impl_def_id, args, obligation.cause, obligation.recursion_depth + 1, obligation.param_env, obligation.predicate);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:450 vtable_impl
SelectionContext.prototype.vtable_impl = function (
  this: SelectionContext,
  impl_def_id: DefId,
  args: Normalized<GenericArgs>,
  cause: ObligationCause,
  recursion_depth: number,
  param_env: ParamEnv,
  parent_trait_pred: Binder<TraitClause>,
): ImplSourceUserDefinedData<PredicateObligation> {
  // debug!(?impl_def_id, ?args, ?recursion_depth, "vtable_impl");

  const impl_obligations = this.impl_or_trait_obligations(cause, recursion_depth, param_env, impl_def_id, args.value, parent_trait_pred);

  // debug!(?impl_obligations, "vtable_impl");

  // Because of RFC447, the impl-trait-ref and obligations
  // are sufficient to determine the impl args, without
  // relying on projections in the impl-trait-ref.
  //
  // e.g., `impl<U: Tr, V: Iterator<Item=U>> Foo<<U as Tr>::T> for V`
  impl_obligations.push(...args.obligations);

  return { impl_def_id, args: args.value, nested: impl_obligations };
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:482 confirm_object_candidate
SelectionContext.prototype.confirm_object_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  index: number,
): Result<ImplSource<PredicateObligation>, SelectionError> {
  const tcx = this.tcx();
  // debug!(?obligation, ?index, "confirm_object_candidate");

  const trait_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(trait_predicate));
  const sk = self_ty.kind();
  if (sk.$ !== "Dynamic") {
    return span_bug(obligation.cause.span, "object candidate with non-object");
  }
  const data = sk._0;

  const object_trait_ref_ = data.principal() ?? span_bug(obligation.cause.span, "object candidate with no principal");
  const object_trait_ref__ = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    object_trait_ref_,
    d_ExistentialTraitRef,
  );
  const object_trait_ref = ExistentialTraitRefC.with_self_ty(object_trait_ref__, as_interner(this.tcx()), self_ty);

  const nested: PredicateObligations = [];

  const supertraits_ = supertraits(tcx, Binder.dummy(object_trait_ref, d_TraitRef));
  const unnormalized_upcast_trait_ref = unwrap(nth(supertraits_, index), "supertraits iterator no longer has as many elements");

  const upcast_trait_ref_ = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    unnormalized_upcast_trait_ref,
    d_TraitRef,
  );
  const upcast_trait_ref = normalize_mod().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    Unnormalized.new_wip(upcast_trait_ref_),
    nested,
    d_TraitRef,
  );

  const eq = this.infcx.at(obligation.cause, obligation.param_env).eq("No", trait_predicate.trait_ref, upcast_trait_ref, ToTrace_TraitRef);
  if (eq.$ === "Err") return Err({ $: "Unimplemented" });
  nested.push(...eq._0.obligations);

  // Check supertraits hold. This is so that their associated type bounds
  // will be checked in the code below.
  for (const clause of EarlyBinder.iter_instantiated_copied(
    tcx.explicit_super_clauses_of(TraitClauseC.def_id(trait_predicate)) as EarlyBinder<readonly [Clause, import("../../../rustc_span/lib.ts").Span][]>,
    tcx,
    trait_predicate.trait_ref.args,
    fold_tuple2(fold_Clause, fold_Span),
  )) {
    const supertrait = Unnormalized.unzip(clause)[0];
    const normalized_supertrait = normalize_mod().normalize_with_depth_to(
      this,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      supertrait,
      nested,
      fold_Clause,
    );
    nested.push(obligation.with(tcx, normalized_supertrait, upcast_Clause));
  }

  const assoc_types: DefId[] = [];
  for (const item of AssocItems.in_definition_order(tcx.associated_items(TraitClauseC.def_id(trait_predicate)) as AssocItems)) {
    // Associated types that require `Self: Sized` do not show up in the built-in
    // implementation of `Trait for dyn Trait`, and can be dropped here.
    if (tcx.generics_require_sized_self(item.def_id)) continue;
    if (AssocItem.is_type(item)) assoc_types.push(item.def_id);
  }

  for (const assoc_type of assoc_types) {
    const defs: Generics = tcx.generics_of(assoc_type) as Generics;

    if (defs.own_params.length !== 0) {
      tcx.dcx().span_delayed_bug(obligation.cause.span, "GATs in trait object shouldn't have been considered");
      return Err({ $: "TraitDynIncompatible", _0: trait_predicate.trait_ref.def_id });
    }

    // This maybe belongs in wf, but that can't (doesn't) handle
    // higher-ranked things.
    // Prevent, e.g., `dyn Iterator<Item = str>`.
    for (const bound of EarlyBinder.transpose_iter(this.tcx().item_bounds(assoc_type) as EarlyBinder<readonly Clause[]>)) {
      const normalized_bound = normalize_mod().normalize_with_depth_to(
        this,
        obligation.param_env,
        clone_ObligationCause(obligation.cause),
        obligation.recursion_depth + 1,
        EarlyBinder.instantiate(bound, tcx, trait_predicate.trait_ref.args, fold_Clause),
        nested,
        fold_Clause,
      );
      nested.push(obligation.with(tcx, normalized_bound, upcast_Clause));
    }
  }

  // debug!(?nested, "object nested obligations");

  return Ok({ $: "Builtin", _0: { $: "Object", _0: index }, _1: nested });
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:593 confirm_fn_pointer_candidate
SelectionContext.prototype.confirm_fn_pointer_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  // debug!(?obligation, "confirm_fn_pointer_candidate");
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));

  const tcx = this.tcx();
  const sig_ = self_ty.unnormalized_fn_sig(tcx);
  const output_ty_ = Unnormalized.map(sig_, (sig) => this.infcx.enter_forall_and_leak_universe(PolyFnSig.output(sig), fold_Ty));
  const sig = Unnormalized.skip_norm_wip(sig_);
  const trait_ref = Binder.map_bound(
    util().closure_trait_ref_and_return_type(tcx, PolyTraitClause.def_id(obligation.predicate), self_ty, sig, "Yes"),
    ([trait_ref, _]) => trait_ref,
  );

  const nested_ = this.equate_trait_refs(obligation.with(tcx, placeholder_predicate, upcast_identity_TraitClause), trait_ref);
  if (nested_.$ === "Err") return nested_;
  const nested = nested_._0;
  const cause = obligation.derived_cause(BuiltinDerived);

  // Confirm the `type Output: Sized;` bound that is present on `FnOnce`
  const output_ty = normalize_mod().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(cause),
    obligation.recursion_depth,
    output_ty_,
    nested,
    fold_Ty,
  );
  const tr = TraitRefC.new(as_interner(this.tcx()), this.tcx().require_lang_item(LangItem.Sized, cause.span), [GenericArg.from_Ty(output_ty)]);
  nested.push(Obligation.new(this.infcx.tcx, cause, obligation.param_env, tr, upcast_TraitRef));

  return Ok(nested);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:637 confirm_trait_alias_candidate
SelectionContext.prototype.confirm_trait_alias_candidate = function (this: SelectionContext, obligation: PolyTraitObligation): PredicateObligations {
  // debug!(?obligation, "confirm_trait_alias_candidate");

  const predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const trait_ref = predicate.trait_ref;
  const trait_def_id = trait_ref.def_id;
  const args = trait_ref.args;

  const trait_obligations = this.impl_or_trait_obligations(
    obligation.cause,
    obligation.recursion_depth,
    obligation.param_env,
    trait_def_id,
    args,
    obligation.predicate,
  );

  // debug!(?trait_def_id, ?trait_obligations, "trait alias obligations");

  return trait_obligations;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:662 confirm_coroutine_candidate
SelectionContext.prototype.confirm_coroutine_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return bug(`closure candidate for non-closure ${debug_PolyTraitObligation(obligation)}`);
  }
  const args = k._1;

  // debug!(?obligation, ?coroutine_def_id, ?args, "confirm_coroutine_candidate");

  const coroutine_sig = CoroutineArgs.sig(args.as_coroutine());

  const [trait_ref] = util().coroutine_trait_ref_and_outputs(this.tcx(), PolyTraitClause.def_id(obligation.predicate), self_ty, coroutine_sig);

  const nested = this.equate_trait_refs(obligation.with(this.tcx(), placeholder_predicate, upcast_identity_TraitClause), Binder.dummy(trait_ref, d_TraitRef));
  if (nested.$ === "Err") return nested;
  // debug!(?trait_ref, ?nested, "coroutine candidate obligations");

  return Ok(nested._0);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:692 confirm_future_candidate
SelectionContext.prototype.confirm_future_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return bug(`closure candidate for non-closure ${debug_PolyTraitObligation(obligation)}`);
  }
  const args = k._1;

  // debug!(?obligation, ?coroutine_def_id, ?args, "confirm_future_candidate");

  const coroutine_sig = CoroutineArgs.sig(args.as_coroutine());

  const [trait_ref] = util().future_trait_ref_and_outputs(this.tcx(), PolyTraitClause.def_id(obligation.predicate), self_ty, coroutine_sig);

  const nested = this.equate_trait_refs(obligation.with(this.tcx(), placeholder_predicate, upcast_identity_TraitClause), Binder.dummy(trait_ref, d_TraitRef));
  if (nested.$ === "Err") return nested;
  // debug!(?trait_ref, ?nested, "future candidate obligations");

  return Ok(nested._0);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:722 confirm_iterator_candidate
SelectionContext.prototype.confirm_iterator_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return bug(`closure candidate for non-closure ${debug_PolyTraitObligation(obligation)}`);
  }
  const args = k._1;

  // debug!(?obligation, ?coroutine_def_id, ?args, "confirm_iterator_candidate");

  const gen_sig = CoroutineArgs.sig(args.as_coroutine());

  const [trait_ref] = util().iterator_trait_ref_and_outputs(this.tcx(), PolyTraitClause.def_id(obligation.predicate), self_ty, gen_sig);

  const nested = this.equate_trait_refs(obligation.with(this.tcx(), placeholder_predicate, upcast_identity_TraitClause), Binder.dummy(trait_ref, d_TraitRef));
  if (nested.$ === "Err") return nested;
  // debug!(?trait_ref, ?nested, "iterator candidate obligations");

  return Ok(nested._0);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:752 confirm_async_iterator_candidate
SelectionContext.prototype.confirm_async_iterator_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return bug(`closure candidate for non-closure ${debug_PolyTraitObligation(obligation)}`);
  }
  const args = k._1;

  // debug!(?obligation, ?coroutine_def_id, ?args, "confirm_async_iterator_candidate");

  const gen_sig = CoroutineArgs.sig(args.as_coroutine());

  const [trait_ref] = util().async_iterator_trait_ref_and_outputs(this.tcx(), PolyTraitClause.def_id(obligation.predicate), self_ty, gen_sig);

  const nested = this.equate_trait_refs(obligation.with(this.tcx(), placeholder_predicate, upcast_identity_TraitClause), Binder.dummy(trait_ref, d_TraitRef));
  if (nested.$ === "Err") return nested;
  // debug!(?trait_ref, ?nested, "iterator candidate obligations");

  return Ok(nested._0);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:783 confirm_closure_candidate
SelectionContext.prototype.confirm_closure_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty: Ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));

  let trait_ref: Binder<TraitRef>;
  const k = self_ty.kind();
  switch (k.$) {
    case "Closure":
      trait_ref = this.closure_trait_ref_unnormalized(self_ty, PolyTraitClause.def_id(obligation.predicate));
      break;
    case "CoroutineClosure": {
      const args = k._1;
      trait_ref = Binder.map_bound(CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure()), (sig) =>
        TraitRefC.new(as_interner(this.tcx()), PolyTraitClause.def_id(obligation.predicate), [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(sig.tupled_inputs_ty)]),
      );
      break;
    }
    default:
      return bug(`closure candidate for non-closure ${debug_PolyTraitObligation(obligation)}`);
  }

  return this.equate_trait_refs(obligation.with(this.tcx(), placeholder_predicate, upcast_identity_TraitClause), trait_ref);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:812 confirm_async_closure_candidate
SelectionContext.prototype.confirm_async_closure_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<PredicateObligations, SelectionError> {
  const placeholder_predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, d_TraitClause);
  const self_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(placeholder_predicate));

  const tcx = this.tcx();

  const nested: PredicateObligations = [];
  let trait_ref: Binder<TraitRef>;
  let kind_ty: Ty;
  const k = self_ty.kind();
  switch (k.$) {
    case "CoroutineClosure": {
      const args = k._1.as_coroutine_closure();
      const trait_ref_ = Binder.map_bound(CoroutineClosureArgs.coroutine_closure_sig(args), (sig) =>
        TraitRefC.new(as_interner(this.tcx()), PolyTraitClause.def_id(obligation.predicate), [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(sig.tupled_inputs_ty)]),
      );

      // Note that unlike below, we don't need to check `Future + Sized` for
      // the output coroutine because they are `Future + Sized` by construction.

      [trait_ref, kind_ty] = [trait_ref_, CoroutineClosureArgs.kind_ty(args)];
      break;
    }
    case "FnDef":
    case "FnPtr": {
      const sig = self_ty.fn_sig(tcx);
      const trait_ref_ = Binder.map_bound(sig, (sig) =>
        TraitRefC.new(as_interner(this.tcx()), PolyTraitClause.def_id(obligation.predicate), [
          GenericArg.from_Ty(self_ty),
          GenericArg.from_Ty(Ty.new_tup(tcx, [...FnSig.inputs(sig)])),
        ]),
      );

      // We must additionally check that the return type impls `Future + Sized`.
      const future_trait_def_id = tcx.require_lang_item(LangItem.Future, obligation.cause.span);
      nested.push(
        obligation.with(
          tcx,
          Binder.map_bound(PolyFnSig.output(sig), (output_ty) => TraitRefC.new(as_interner(tcx), future_trait_def_id, [GenericArg.from_Ty(output_ty)])),
          upcast_PolyTraitRef,
        ),
      );
      const sized_trait_def_id = tcx.require_lang_item(LangItem.Sized, obligation.cause.span);
      nested.push(
        obligation.with(
          tcx,
          Binder.map_bound(PolyFnSig.output(sig), (output_ty) => TraitRefC.new(as_interner(tcx), sized_trait_def_id, [GenericArg.from_Ty(output_ty)])),
          upcast_PolyTraitRef,
        ),
      );

      [trait_ref, kind_ty] = [trait_ref_, Ty.from_closure_kind(tcx, "Fn")];
      break;
    }
    case "Closure": {
      const args = k._1.as_closure();
      const sig = ClosureArgs.sig(args);
      const trait_ref_ = Binder.map_bound(sig, (sig) =>
        TraitRefC.new(as_interner(this.tcx()), PolyTraitClause.def_id(obligation.predicate), [
          GenericArg.from_Ty(self_ty),
          GenericArg.from_Ty([...FnSig.inputs(sig)][0]!),
        ]),
      );

      // We must additionally check that the return type impls `Future + Sized`.
      const future_trait_def_id = tcx.require_lang_item(LangItem.Future, obligation.cause.span);
      const placeholder_output_ty = this.infcx.enter_forall_and_leak_universe(PolyFnSig.output(sig), fold_Ty);
      nested.push(
        obligation.with(tcx, TraitRefC.new(as_interner(tcx), future_trait_def_id, [GenericArg.from_Ty(placeholder_output_ty)]), upcast_TraitRef),
      );
      const sized_trait_def_id = tcx.require_lang_item(LangItem.Sized, obligation.cause.span);
      nested.push(
        obligation.with(
          tcx,
          Binder.map_bound(PolyFnSig.output(sig), (output_ty) => TraitRefC.new(as_interner(tcx), sized_trait_def_id, [GenericArg.from_Ty(output_ty)])),
          upcast_PolyTraitRef,
        ),
      );

      [trait_ref, kind_ty] = [trait_ref_, ClosureArgs.kind_ty(args)];
      break;
    }
    default:
      return bug("expected callable type for AsyncFn candidate");
  }

  const eq = this.equate_trait_refs(obligation.with(tcx, placeholder_predicate, upcast_identity_TraitClause), trait_ref);
  if (eq.$ === "Err") return eq;
  nested.push(...eq._0);

  const goal_kind = unwrap(this.tcx().async_fn_trait_kind_from_def_id(PolyTraitClause.def_id(obligation.predicate)));

  // If we have not yet determined the `ClosureKind` of the closure or coroutine-closure,
  // then additionally register an `AsyncFnKindHelper` goal which will fail if the kind
  // is constrained to an insufficient type later on.
  const closure_kind = this.infcx.shallow_resolve(kind_ty).to_opt_closure_kind();
  if (closure_kind !== undefined) {
    if (!ClosureKind.extends(closure_kind, goal_kind)) {
      return Err({ $: "Unimplemented" });
    }
  } else {
    nested.push(
      Obligation.new(
        this.tcx(),
        obligation.derived_cause(BuiltinDerived),
        obligation.param_env,
        TraitRefC.new(as_interner(this.tcx()), this.tcx().require_lang_item(LangItem.AsyncFnKindHelper, obligation.cause.span), [
          GenericArg.from_Ty(kind_ty),
          GenericArg.from_Ty(Ty.from_closure_kind(this.tcx(), goal_kind)),
        ]),
        upcast_TraitRef,
      ),
    );
  }

  return Ok(nested);
};

/// In the case of closure types and fn pointers,
/// we currently treat the input type parameters on the trait as
/// outputs. This means that when we have a match we have only
/// considered the self type, so we have to go back and make sure
/// to relate the argument types too. This is kind of wrong, but
/// since we control the full set of impls, also not that wrong,
/// and it DOES yield better error messages (since we don't report
/// errors as if there is no applicable impl, but rather report
/// errors are about mismatched argument types.
///
/// Here is an example. Imagine we have a closure expression
/// and we desugared it so that the type of the expression is
/// `Closure`, and `Closure` expects `i32` as argument. Then it
/// is "as if" the compiler generated this impl:
/// ```ignore (illustrative)
/// impl Fn(i32) for Closure { ... }
/// ```
/// Now imagine our obligation is `Closure: Fn(usize)`. So far
/// we have matched the self type `Closure`. At this point we'll
/// compare the `i32` to `usize` and generate an error.
///
/// Note that this checking occurs *after* the impl has selected,
/// because these output type parameters should not affect the
/// selection of the impl. Therefore, if there is a mismatch, we
/// report an error to the user.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:958 equate_trait_refs
SelectionContext.prototype.equate_trait_refs = function (
  this: SelectionContext,
  obligation: TraitObligation,
  found_trait_ref_: Binder<TraitRef>,
): Result<PredicateObligations, SelectionError> {
  const found_trait_ref__ = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    found_trait_ref_,
    d_TraitRef,
  );
  // Normalize the obligation and expected trait refs together, because why not
  const {
    obligations: nested,
    value: [obligation_trait_ref, found_trait_ref],
  } = normalize_mod().normalize_with_depth(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    Unnormalized.new_wip<[TraitRef, TraitRef]>([obligation.predicate.trait_ref, found_trait_ref__]),
    fold_tuple2(d_TraitRef, d_TraitRef),
  );

  // needed to define opaque types for tests/ui/type-alias-impl-trait/assoc-projection-ice.rs
  const r = this.infcx.at(obligation.cause, obligation.param_env).eq("Yes", obligation_trait_ref, found_trait_ref, ToTrace_TraitRef);
  if (r.$ === "Ok") {
    const obligations = r._0.obligations;
    obligations.push(...nested);
    return Ok(obligations);
  } else {
    const terr = r._0;
    return Err({
      $: "SignatureMismatch",
      _0: {
        expected_trait_ref: obligation_trait_ref,
        found_trait_ref,
        terr,
      },
    });
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:995 confirm_trait_upcasting_unsize_candidate
SelectionContext.prototype.confirm_trait_upcasting_unsize_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  idx: number,
): Result<ImplSource<PredicateObligation>, SelectionError> {
  const tcx = this.tcx();

  // `assemble_candidates_for_unsizing` should ensure there are no late-bound
  // regions here. See the comment there for more details.
  const predicate = unwrap(Binder.no_bound_vars(obligation.predicate, d_TraitClause));
  const a_ty = this.infcx.shallow_resolve(TraitClauseC.self_ty(predicate));
  const b_ty = this.infcx.shallow_resolve(predicate.trait_ref.args.type_at(1));

  const ak = a_ty.kind();
  if (ak.$ !== "Dynamic") {
    return bug("expected `dyn` type in `confirm_trait_upcasting_unsize_candidate`");
  }
  const a_data = ak._0;
  const a_region = ak._1;
  const bk = b_ty.kind();
  if (bk.$ !== "Dynamic") {
    return bug("expected `dyn` type in `confirm_trait_upcasting_unsize_candidate`");
  }
  const b_data = bk._0;
  const b_region = bk._1;

  const source_principal = PolyExistentialTraitRef.with_self_ty(unwrap(a_data.principal()), as_interner(tcx), a_ty);
  const unnormalized_upcast_principal = Unnormalized.new_wip(unwrap(nth(supertraits(tcx, source_principal), idx)));

  const nested_ = this.match_upcast_principal(obligation, unnormalized_upcast_principal, a_data, b_data, a_region, b_region);
  if (nested_.$ === "Err") return nested_;
  const nested = unwrap(nested_._0, "did not expect ambiguity during confirmation");

  return Ok({ $: "Builtin", _0: { $: "TraitUpcasting", _0: idx }, _1: nested });
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:1033 confirm_builtin_unsize_candidate
SelectionContext.prototype.confirm_builtin_unsize_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): Result<ImplSource<PredicateObligation>, SelectionError> {
  const tcx = this.tcx();

  // `assemble_candidates_for_unsizing` should ensure there are no late-bound
  // regions here. See the comment there for more details.
  const source = this.infcx.shallow_resolve(unwrap(Binder.no_bound_vars(obligation.self_ty(), fold_Ty)));
  const target_ = Binder.skip_binder(obligation.predicate).trait_ref.args.type_at(1);
  const target = this.infcx.shallow_resolve(target_);
  // debug!(?source, ?target, "confirm_builtin_unsize_candidate");

  const sk = source.kind();
  const tk = target.kind();
  let r: ImplSource<PredicateObligation>;
  if (sk.$ === "Dynamic" && tk.$ === "Dynamic") {
    // `dyn Trait + Kx + 'a` -> `dyn Trait + Ky + 'b` (auto traits and lifetime subtyping).
    const data_a = sk._0;
    const r_a = sk._1;
    const data_b = tk._0;
    const r_b = tk._1;
    // See `assemble_candidates_for_unsizing` for more info.
    // We already checked the compatibility of auto traits within `assemble_candidates_for_unsizing`.
    let existential_predicates;
    if (data_b.principal() !== undefined) {
      const iter = function* (): Generator<PolyExistentialPredicate> {
        const principal = data_a.principal();
        if (principal !== undefined) yield Binder.map_bound(principal, (t): ExistentialPredicate => ({ $: "Trait", _0: t }));
        for (const b of data_a.projection_bounds()) yield Binder.map_bound(b, (p): ExistentialPredicate => ({ $: "Projection", _0: p }));
        for (const did of data_b.auto_traits()) yield Binder.dummy<ExistentialPredicate>({ $: "AutoTrait", _0: did }, d_ExistentialPredicate);
      };
      existential_predicates = tcx.mk_poly_existential_predicates_from_iter(iter());
    } else {
      // If we're unsizing to a dyn type that has no principal, then drop
      // the principal and projections from the type. We use the auto traits
      // from the RHS type since as we noted that we've checked for auto
      // trait compatibility during unsizing.
      const iter = function* (): Generator<PolyExistentialPredicate> {
        for (const did of data_b.auto_traits()) yield Binder.dummy<ExistentialPredicate>({ $: "AutoTrait", _0: did }, d_ExistentialPredicate);
      };
      existential_predicates = tcx.mk_poly_existential_predicates_from_iter(iter());
    }
    const source_trait = Ty.new_dynamic(tcx, existential_predicates, r_b);

    // Require that the traits involved in this upcast are **equal**;
    // only the **lifetime bound** is changed.
    const sup = this.infcx.at(obligation.cause, obligation.param_env).sup("Yes", target, source_trait, ToTrace_Ty);
    if (sup.$ === "Err") return Err({ $: "Unimplemented" });
    const obligations = sup._0.obligations;

    // Register one obligation for 'a: 'b.
    const outlives: OutlivesClause<Region> = { _0: r_a, _1: r_b };
    obligations.push(
      Obligation.with_depth(
        tcx,
        clone_ObligationCause(obligation.cause),
        obligation.recursion_depth + 1,
        obligation.param_env,
        Binder.rebind(obligation.predicate, outlives),
        upcast_PolyRegionOutlivesClause,
      ),
    );

    r = { $: "Builtin", _0: Misc, _1: obligations };
  } else if (tk.$ === "Dynamic") {
    // `T` -> `dyn Trait`
    const data = tk._0;
    const r_ = tk._1;
    const object_dids = function* (): Generator<DefId> {
      yield* data.auto_traits();
      const p = data.principal_def_id();
      if (p !== undefined) yield p;
    };
    for (const did of object_dids()) {
      if (!tcx.is_dyn_compatible(did)) {
        return Err({ $: "TraitDynIncompatible", _0: did });
      }
    }

    const predicate_to_obligation = (predicate: Predicate): PredicateObligation =>
      Obligation.with_depth(tcx, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, obligation.param_env, predicate, upcast_identity_Predicate);

    // Create obligations:
    //  - Casting `T` to `Trait`
    //  - For all the various builtin bounds attached to the object cast. (In other
    //  words, if the object type is `Foo + Send`, this would create an obligation for
    //  the `Send` check.)
    //  - Projection predicates
    const nested: PredicateObligations = [];
    for (const predicate of data) {
      nested.push(predicate_to_obligation(Predicate_upcast_from_Clause(PolyExistentialPredicateC.with_self_ty(predicate, tcx, source), tcx)));
    }

    // We can only make objects from sized types.
    const tr = TraitRefC.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, obligation.cause.span), [GenericArg.from_Ty(source)]);
    nested.push(predicate_to_obligation(Predicate_upcast_from_TraitRef(tr, tcx)));

    // If the type is `Foo + 'a`, ensure that the type
    // being cast to `Foo + 'a` outlives `'a`:
    const outlives: OutlivesClause<Ty> = { _0: source, _1: r_ };
    nested.push(predicate_to_obligation(Predicate_upcast_from_ClauseKind({ $: "TypeOutlives", _0: outlives }, tcx)));

    r = { $: "Builtin", _0: Misc, _1: nested };
  } else if (sk.$ === "Array" && tk.$ === "Slice") {
    // `[T; n]` -> `[T]`
    const a = sk._0;
    const b = tk._0;
    const eq = this.infcx.at(obligation.cause, obligation.param_env).eq("Yes", b, a, ToTrace_Ty);
    if (eq.$ === "Err") return Err({ $: "Unimplemented" });
    const obligations = eq._0.obligations;

    r = { $: "Builtin", _0: Misc, _1: obligations };
  } else if (sk.$ === "Adt" && tk.$ === "Adt") {
    // `Struct<T>` -> `Struct<U>`
    const def = sk._0;
    const args_a = sk._1;
    const args_b = tk._1;
    const unsizing_params = tcx.unsizing_params_for_adt(def.did()) as DenseBitSet<number>;
    if (unsizing_params.is_empty()) {
      return Err({ $: "Unimplemented" });
    }

    const tail_field = def.non_enum_variant().tail();
    const tail_field_ty = tcx.type_of(tail_field.did) as EarlyBinder<Ty>;

    const nested: PredicateObligations = [];

    // Extract `TailField<T>` and `TailField<U>` from `Struct<T>` and `Struct<U>`,
    // normalizing in the process, since `type_of` returns something directly from
    // HIR ty lowering (which means it's un-normalized).
    const source_tail = normalize_mod().normalize_with_depth_to(
      this,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      EarlyBinder.instantiate(tail_field_ty, tcx, args_a, fold_Ty),
      nested,
      fold_Ty,
    );
    const target_tail = normalize_mod().normalize_with_depth_to(
      this,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      EarlyBinder.instantiate(tail_field_ty, tcx, args_b, fold_Ty),
      nested,
      fold_Ty,
    );

    // Check that the source struct with the target's
    // unsizing parameters is equal to the target.
    const args = tcx.mk_args_from_iter(
      (function* () {
        let i = 0;
        for (const k of args_a) {
          yield unsizing_params.contains(i) ? args_b[i]! : k;
          i++;
        }
      })(),
    );
    const new_struct = Ty.new_adt(tcx, def, args);
    const eq = this.infcx.at(obligation.cause, obligation.param_env).eq("Yes", target, new_struct, ToTrace_Ty);
    if (eq.$ === "Err") return Err({ $: "Unimplemented" });
    nested.push(...eq._0.obligations);

    // Construct the nested `TailField<T>: Unsize<TailField<U>>` predicate.
    const tail_unsize_obligation = obligation.with(
      tcx,
      TraitRefC.new(as_interner(tcx), PolyTraitClause.def_id(obligation.predicate), [GenericArg.from_Ty(source_tail), GenericArg.from_Ty(target_tail)]),
      upcast_TraitRef,
    );
    nested.push(tail_unsize_obligation);

    r = { $: "Builtin", _0: Misc, _1: nested };
  } else {
    return bug(`source: ${display_Ty(source)}, target: ${display_Ty(target)}`);
  }
  return Ok(r);
};

/// This trait is indirectly exposed on stable, so do *not* extend the set of types that
/// implement the trait without FCP!
// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:1227 confirm_bikeshed_guaranteed_no_drop_candidate
SelectionContext.prototype.confirm_bikeshed_guaranteed_no_drop_candidate = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
): ImplSource<PredicateObligation> {
  const obligations: PredicateObligations = [];

  const tcx = this.tcx();
  const self_ty = PolyTraitClause.self_ty(obligation.predicate);
  const k = Binder.skip_binder(self_ty).kind();
  if (k.$ === "Ref") {
    // `&mut T` and `&T` always implement `BikeshedGuaranteedNoDrop`.
  } else if (k.$ === "Adt" && k._0.is_manually_drop()) {
    // `ManuallyDrop<T>` always implements `BikeshedGuaranteedNoDrop`.
  } else if (k.$ === "Tuple") {
    // Arrays and tuples implement `BikeshedGuaranteedNoDrop` only if
    // their constituent types implement `BikeshedGuaranteedNoDrop`.
    const tys = k._0;
    for (const elem_ty of tys) {
      obligations.push(
        obligation.with(
          tcx,
          Binder.rebind(self_ty, TraitRefC.new(as_interner(tcx), PolyTraitClause.def_id(obligation.predicate), [GenericArg.from_Ty(elem_ty)])),
          upcast_PolyTraitRef,
        ),
      );
    }
  } else if (k.$ === "Array") {
    const elem_ty = k._0;
    obligations.push(
      obligation.with(
        tcx,
        Binder.rebind(self_ty, TraitRefC.new(as_interner(tcx), PolyTraitClause.def_id(obligation.predicate), [GenericArg.from_Ty(elem_ty)])),
        upcast_PolyTraitRef,
      ),
    );
  } else if (!(k.$ === "Infer" && !(k._0.$ === "IntVar" || k._0.$ === "FloatVar"))) {
    // All other types implement `BikeshedGuaranteedNoDrop` only if
    // they implement `Copy`. We could be smart here and short-circuit
    // some trivially `Copy`/`!Copy` types, but there's no benefit.
    // ty::FnDef(..) | ty::FnPtr(..) | ty::Error(_) | ty::Uint(_) | ty::Int(_) | ty::Infer(ty::IntVar(_) | ty::FloatVar(_))
    // | ty::Bool | ty::Float(_) | ty::Char | ty::RawPtr(..) | ty::Never | ty::Pat(..) | ty::Dynamic(..) | ty::Str
    // | ty::Slice(_) | ty::Foreign(..) | ty::Adt(..) | ty::Alias(..) | ty::Param(_) | ty::Placeholder(..) | ty::Closure(..)
    // | ty::CoroutineClosure(..) | ty::Coroutine(..) | ty::UnsafeBinder(_) | ty::CoroutineWitness(..) | ty::Bound(..)
    obligations.push(
      obligation.with(
        tcx,
        Binder.map_bound(self_ty, (ty) => TraitRefC.new(as_interner(tcx), tcx.require_lang_item(LangItem.Copy, obligation.cause.span), [GenericArg.from_Ty(ty)])),
        upcast_PolyTraitRef,
      ),
    );
  } else {
    // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
    return panic(`unexpected type \`${debug_Binder(self_ty, PLAIN, debug_Ty)}\``);
  }

  return { $: "Builtin", _0: Misc, _1: obligations };
};

// rustc: compiler/rustc_trait_selection/src/traits/select/confirmation.rs:1314 confirm_try_as_dyn_candidate
SelectionContext.prototype.confirm_try_as_dyn_candidate = function (this: SelectionContext, obligation: PolyTraitObligation): ImplSource<PredicateObligation> {
  const tcx = this.tcx();

  const obligations: PredicateObligations = [];

  const self_ty = PolyTraitClause.self_ty(obligation.predicate);
  const ty_lifetime = Binder.map_bound(obligation.predicate, (p) => p.trait_ref.args.region_at(1));

  const k = Binder.skip_binder(self_ty).kind();
  if (k.$ === "Dynamic") {
    const lifetime = k._1;
    obligations.push(
      obligation.with(
        tcx,
        Binder.map_bound(ty_lifetime, (ty_lifetime): OutlivesClause<Region> => ({ _0: ty_lifetime, _1: lifetime })),
        upcast_PolyRegionOutlivesClause,
      ),
    );
  } else if (k.$ === "Infer" && (k._0.$ === "TyVar" || k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy")) {
    return panic(`unexpected type \`${debug_Binder(self_ty, PLAIN, debug_Ty)}\``);
  } else {
    // _ => {}
  }
  return { $: "Builtin", _0: Misc, _1: obligations };
};
