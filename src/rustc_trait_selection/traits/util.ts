// Port of compiler/rustc_trait_selection/src/traits/util.rs (lane trait-sel-traits-a). `TupleArgumentsFlag` is
// generated (util.gen.ts).
//
// PORT: `FxHashSet<ty::PolyProjectionClause>` holds `Binder` structs: a `KeyedSet` on `intern_key`. `SmallVec<[Span; 1]>`
// is `Span[]`; the `VecDeque` work queue is an array with a read index (`pop_front`).

export * from "./util.gen.ts";

// `pub use rustc_infer::traits::util::*;`
export * from "../../rustc_infer/traits/util.ts";
// `pub use rustc_next_trait_solver::placeholder::{BoundVarReplacer, PlaceholderReplacer};`
export { BoundVarReplacer, PlaceholderReplacer } from "../../rustc_next_trait_solver/placeholder.ts";

import { BoundVarReplacer, PlaceholderReplacer } from "../../rustc_next_trait_solver/placeholder.ts";
import { supertraits } from "../../rustc_type_ir/elaborate.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { Defaultness } from "../../rustc_hir/hir.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { PolyTraitObligation } from "../../rustc_infer/traits/mod.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import {
  as_interner,
  fold_with_ProjectionClause,
  PolyTraitClause,
  PolyTraitRef,
  type ProjectionClause,
  type TraitClause,
  TraitClause as TraitClauseC,
  TraitRef,
  try_fold_with_ProjectionClause,
  visit_with_ProjectionClause,
} from "../../rustc_type_ir/predicate.ts";
import type { SizedTraitKind } from "../../rustc_type_ir/solve/mod.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { FnSig as FnSigC } from "../../rustc_type_ir/ty_kind.ts";
import type { GenSig } from "../../rustc_type_ir/ty_kind/closure.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { assert } from "../../std/panic.ts";
import type { TupleArgumentsFlag } from "./util.gen.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";

/** The derived `TypeFoldable` of `ProjectionClause` (rustc_type_ir predicate.rs) as a D4 descriptor. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};

/// Return the trait and projection predicates that come from eagerly expanding the
/// trait aliases in the list of clauses. For each trait predicate, record a stack
/// of spans that trace from the user-written trait alias bound. For projection predicates,
/// just record the span of the projection itself.
///
/// For trait aliases, we don't deduplicte the predicates, since we currently do not
/// consider duplicated traits as a single trait for the purposes of our "one trait principal"
/// restriction; however, for projections we do deduplicate them.
///
/// ```rust,ignore (fails)
/// trait Bar {}
/// trait Foo = Bar + Bar;
///
/// let dyn_incompatible: dyn Foo; // bad, two `Bar` principals.
/// ```
// rustc: compiler/rustc_trait_selection/src/traits/util.rs:34 expand_trait_aliases
export function expand_trait_aliases(
  tcx: TyCtxt,
  clauses: Iterable<[Clause, Span]>,
): [[Binder<TraitClause>, Span[]][], [Binder<ProjectionClause>, Span][]] {
  const trait_preds: [Binder<TraitClause>, Span[]][] = [];
  const projection_preds: [Binder<ProjectionClause>, Span][] = [];
  const seen_projection_preds = new KeyedSet<Binder<ProjectionClause>>(intern_key);

  const queue: [Clause, Span[]][] = [...clauses].map(([p, s]) => [p, [s]]);
  let head = 0;

  while (head < queue.length) {
    const [clause, spans] = queue[head++]!;
    const kind = Binder.skip_binder(clause.kind());
    switch (kind.$) {
      case "Trait": {
        const trait_pred = kind._0;
        if (tcx.is_trait_alias(TraitClauseC.def_id(trait_pred))) {
          for (const u of EarlyBinder.iter_identity_copied(tcx.explicit_super_clauses_of(TraitClauseC.def_id(trait_pred)) as EarlyBinder<readonly [Clause, Span][]>)) {
            const [super_clause, span] = Unnormalized.skip_norm_wip(u);
            const spans_ = [...spans];
            spans_.push(span);
            queue.push([super_clause.instantiate_supertrait(tcx, Binder.rebind(clause.kind(), trait_pred.trait_ref)), spans_]);
          }
        } else {
          trait_preds.push([Binder.rebind(clause.kind(), trait_pred), spans]);
        }
        break;
      }
      case "Projection": {
        const projection_pred = Binder.rebind(clause.kind(), kind._0);
        const anon = tcx.anonymize_bound_vars(projection_pred, d_ProjectionClause);
        if (seen_projection_preds.has(anon)) {
          continue;
        }
        seen_projection_preds.add(anon);
        projection_preds.push([projection_pred, spans[spans.length - 1]!]);
        break;
      }
      case "RegionOutlives":
      case "TypeOutlives":
      case "ConstArgHasType":
      case "WellFormed":
      case "ConstEvaluatable":
      case "UnstableFeature":
      case "HostEffect":
        break;
    }
  }

  return [trait_preds, projection_preds];
}

///////////////////////////////////////////////////////////////////////////
// Other
///////////////////////////////////////////////////////////////////////////

/// Casts a trait reference into a reference to one of its super
/// traits; returns `None` if `target_trait_def_id` is not a
/// supertrait.
// rustc: compiler/rustc_trait_selection/src/traits/util.rs:98 upcast_choices
export function upcast_choices(tcx: TyCtxt, source_trait_ref: Binder<TraitRef>, target_trait_def_id: DefId): Binder<TraitRef>[] {
  if (DefId_eq(PolyTraitRef.def_id(source_trait_ref), target_trait_def_id)) {
    return [source_trait_ref]; // Shortcut the most common case.
  }

  return [...supertraits(tcx, source_trait_ref)].filter((r) => DefId_eq(PolyTraitRef.def_id(r), target_trait_def_id));
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:110 closure_trait_ref_and_return_type
export function closure_trait_ref_and_return_type(
  tcx: TyCtxt,
  fn_trait_def_id: DefId,
  self_ty: Ty,
  sig: Binder<FnSig>,
  tuple_arguments: TupleArgumentsFlag,
): Binder<[TraitRef, Ty]> {
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_ty, fold_Ty), "assertion failed: !self_ty.has_escaping_bound_vars()");
  const arguments_tuple: Ty =
    tuple_arguments === "No" ? [...FnSigC.inputs(Binder.skip_binder(sig))][0]! : Ty.new_tup(tcx, [...FnSigC.inputs(Binder.skip_binder(sig))]);
  const trait_ref = TraitRef.new(as_interner(tcx), fn_trait_def_id, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(arguments_tuple)]);
  return Binder.map_bound(sig, (sig): [TraitRef, Ty] => [trait_ref, FnSigC.output(sig)]);
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:126 coroutine_trait_ref_and_outputs
export function coroutine_trait_ref_and_outputs(tcx: TyCtxt, fn_trait_def_id: DefId, self_ty: Ty, sig: GenSig): [TraitRef, Ty, Ty] {
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_ty, fold_Ty), "assertion failed: !self_ty.has_escaping_bound_vars()");
  const trait_ref = TraitRef.new(as_interner(tcx), fn_trait_def_id, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(sig.resume_ty)]);
  return [trait_ref, sig.yield_ty, sig.return_ty];
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:137 future_trait_ref_and_outputs
export function future_trait_ref_and_outputs(tcx: TyCtxt, fn_trait_def_id: DefId, self_ty: Ty, sig: GenSig): [TraitRef, Ty] {
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_ty, fold_Ty), "assertion failed: !self_ty.has_escaping_bound_vars()");
  const trait_ref = TraitRef.new(as_interner(tcx), fn_trait_def_id, [GenericArg.from_Ty(self_ty)]);
  return [trait_ref, sig.return_ty];
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:148 iterator_trait_ref_and_outputs
export function iterator_trait_ref_and_outputs(tcx: TyCtxt, iterator_def_id: DefId, self_ty: Ty, sig: GenSig): [TraitRef, Ty] {
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_ty, fold_Ty), "assertion failed: !self_ty.has_escaping_bound_vars()");
  const trait_ref = TraitRef.new(as_interner(tcx), iterator_def_id, [GenericArg.from_Ty(self_ty)]);
  return [trait_ref, sig.yield_ty];
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:159 async_iterator_trait_ref_and_outputs
export function async_iterator_trait_ref_and_outputs(tcx: TyCtxt, async_iterator_def_id: DefId, self_ty: Ty, sig: GenSig): [TraitRef, Ty] {
  assert(!TypeVisitableExt.has_escaping_bound_vars(self_ty, fold_Ty), "assertion failed: !self_ty.has_escaping_bound_vars()");
  const trait_ref = TraitRef.new(as_interner(tcx), async_iterator_def_id, [GenericArg.from_Ty(self_ty)]);
  return [trait_ref, sig.yield_ty];
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:170 impl_item_is_final
export function impl_item_is_final(tcx: TyCtxt, assoc_item: AssocItem): boolean {
  return Defaultness.is_final(AssocItem.defaultness(assoc_item, tcx)) && Defaultness.is_final(tcx.defaultness(AssocItem.container_id(assoc_item, tcx)) as Defaultness);
}

/// Executes `f` on `value` after replacing all escaping bound variables with placeholders
/// and then replaces these placeholders with the original bound variables in the result.
///
/// In most places, bound variables should be replaced right when entering a binder, making
/// this function unnecessary. However, normalization currently does not do that, so we have
/// to do this lazily.
///
/// You should not add any additional uses of this function, at least not without first
/// discussing it with t-types.
///
/// FIXME(@lcnr): We may even consider experimenting with eagerly replacing bound vars during
/// normalization as well, at which point this function will be unnecessary and can be removed.
// rustc: compiler/rustc_trait_selection/src/traits/util.rs:192 with_replaced_escaping_bound_vars
export function with_replaced_escaping_bound_vars<T, R>(
  infcx: InferCtxt,
  universe_indices: (UniverseIndex | undefined)[],
  value_: T,
  f: (value: T) => R,
  d_T: TypeFoldable<T>,
  d_R: TypeFoldable<R>,
): R {
  if (TypeVisitableExt.has_escaping_bound_vars(value_, d_T)) {
    const [value, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(infcx, universe_indices, value_, d_T);
    const result = f(value);
    return PlaceholderReplacer.replace_placeholders(infcx, mapped_regions, mapped_types, mapped_consts, universe_indices, result, d_R);
  } else {
    return f(value_);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/util.rs:220 sizedness_fast_path
export function sizedness_fast_path(tcx: TyCtxt, predicate: Predicate, param_env: ParamEnv): boolean {
  // Proving `Sized`/`MetaSized`, very often on "obviously sized" types like
  // `&T`, accounts for about 60% percentage of the predicates we have to prove. No need to
  // canonicalize and all that for such cases.
  const pk = Binder.skip_binder(predicate.kind());
  if (pk.$ === "Clause" && pk._0.$ === "Trait" && pk._0._0.polarity === "Positive") {
    const trait_pred = pk._0._0;
    let sizedness: SizedTraitKind;
    switch (tcx.as_lang_item(TraitClauseC.def_id(trait_pred))) {
      case "Sized":
        sizedness = "Sized";
        break;
      case "MetaSized":
        sizedness = "MetaSized";
        break;
      default:
        return false;
    }

    if (TraitClauseC.self_ty(trait_pred).has_trivial_sizedness(tcx, sizedness)) {
      // debug!("fast path -- trivial sizedness");
      return true;
    }

    const sk = TraitClauseC.self_ty(trait_pred).kind();
    if (sk.$ === "Param" || sk.$ === "Placeholder") {
      for (const clause of param_env.caller_bounds()) {
        const ck = Binder.skip_binder(clause.kind());
        if (
          ck.$ === "Trait" &&
          ck._0.polarity === "Positive" &&
          TraitClauseC.self_ty(ck._0) === TraitClauseC.self_ty(trait_pred) &&
          (DefId_eq(TraitClauseC.def_id(ck._0), TraitClauseC.def_id(trait_pred)) ||
            (sizedness === "MetaSized" && tcx.is_lang_item(TraitClauseC.def_id(ck._0), "Sized")))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/// To improve performance, sizedness traits are not elaborated and so special-casing is required
/// in the trait solver to find a `Sized` candidate for a `MetaSized` obligation. Returns the
/// predicate to used in the candidate for such a `obligation`, given a `candidate`.
// rustc: compiler/rustc_trait_selection/src/traits/util.rs:264 lazily_elaborate_sizedness_candidate
export function lazily_elaborate_sizedness_candidate(
  infcx: InferCtxt,
  obligation: PolyTraitObligation,
  candidate: Binder<TraitClause>,
): Binder<TraitClause> {
  if (
    !infcx.tcx.is_lang_item(PolyTraitClause.def_id(obligation.predicate), "MetaSized") ||
    !infcx.tcx.is_lang_item(PolyTraitClause.def_id(candidate), "Sized")
  ) {
    return candidate;
  }

  if (PolyTraitClause.polarity(obligation.predicate) !== "Positive" || PolyTraitClause.polarity(candidate) !== "Positive") {
    return candidate;
  }

  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(infcx.tcx));
  if (!drcx.args_may_unify(Binder.skip_binder(obligation.predicate).trait_ref.args, Binder.skip_binder(candidate).trait_ref.args)) {
    return candidate;
  }

  return Binder.map_bound(candidate, (c): TraitClause => ({
    trait_ref: TraitRef.new_from_args(as_interner(infcx.tcx), PolyTraitClause.def_id(obligation.predicate), c.trait_ref.args),
    polarity: c.polarity,
  }));
}
