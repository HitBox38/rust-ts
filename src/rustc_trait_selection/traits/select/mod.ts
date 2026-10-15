//! Candidate selection. See the [rustc dev guide] for more information on how this works.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html#selection
//
// Port of compiler/rustc_trait_selection/src/traits/select/mod.rs (lanes old-select-a / old-select-b, wave 18b).
//
// Contract stub (lane selcx-contract): `SelectionContext` (generated class, ./mod.gen.ts) gets every method of the old
// solver's `impl SelectionContext` blocks, declared in ../../decls.ts (`declare module "./traits/select/mod.gen.ts"`,
// grouped by file with `// <file>:<line>`). This file holds the methods of mod.rs; candidate_assembly.ts and
// confirmation.ts hold theirs. Ported here already: `new`, `typing_mode`, `with_query_mode`, `tcx`, the
// `IntercrateAmbiguityCause` impl, and the helper impls at the end of the file (`TraitObligationStack`,
// `ProvisionalEvaluationCache`, `TraitObligationStackList`, the manual `Debug`).
//
// How to fill a stub (docs/handoff/selcx-contract.md): port each fn in upstream order as
// `SelectionContext.prototype.<name> = function (this: SelectionContext, ..) { .. };` with its
// `// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:<line> <name>` marker directly above, then delete
// the name from the `unported_methods(..)` list below (and the call when the list is empty). Do not change a declared
// signature in decls.ts: a wrong one goes in your handoff (or a local `declare module` marked
// `// PORT(decls): pending root`).
//
// PORT (representation):
// - `TraitObligationStack` / `ProvisionalEvaluationCache` are generated classes; `Cell` / `RefCell` fields are the values.
//   `ProvisionalEvaluationCache.map` is an `FxIndexMap` keyed by `PolyTraitClause` (a `Binder` struct, not interned): it
//   is a `KeyedMap` on `intern_key` (`ProvisionalEvaluationCache.default`).
// - `TraitObligationStackList` (`#[derive(Copy, Clone)]`, `Iterator`) is a hand class: its field `head` is `head_`
//   (the method `head()` has the name). `next()` mutates the list in place (`*self = o.previous`), so a copy that is
//   iterated is `clone_TraitObligationStackList(list)` wherever Rust copies the value; it is also a JS iterable.
// - `debug!` / `trace!` / `#[instrument]` are dropped (no tracing in the port).
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { Diag } from "../../../rustc_errors/lib.ts";
import { TypeFreshener } from "../../../rustc_infer/infer/freshen.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { display_TraitRefPrintSugared, TraitRef_print_trait_sugared, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import type { PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import type { EvaluationResult } from "../../../rustc_middle/traits/select.ts";
import { debug_Binder } from "../../../rustc_type_ir/binder.ts";
import { type CantBeErased, TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { debug_TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { type Fmt, PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import type { TraitQueryMode } from "../mod.gen.ts";
import {
  type IntercrateAmbiguityCause as IntercrateAmbiguityCauseT,
  type ProvisionalEvaluation,
  ProvisionalEvaluationCache,
  SelectionContext,
  TraitObligationStack,
} from "./mod.gen.ts";

export * from "./mod.gen.ts";
// `pub use rustc_middle::traits::select::*;`
export * from "../../../rustc_middle/traits/select.ts";

// ---- impl<'tcx> IntercrateAmbiguityCause<'tcx> (mod.rs:62) ----------------------------------------------------------

export type IntercrateAmbiguityCause = IntercrateAmbiguityCauseT;
export const IntercrateAmbiguityCause = {
  /// Emits notes when the overlap is caused by complex intercrate ambiguities.
  /// See #23980 for details.
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:65 add_intercrate_ambiguity_hint
  add_intercrate_ambiguity_hint(self: IntercrateAmbiguityCause, err: Diag): void {
    err.note(IntercrateAmbiguityCause.intercrate_ambiguity_hint(self));
  },

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:69 intercrate_ambiguity_hint
  intercrate_ambiguity_hint(self: IntercrateAmbiguityCause): string {
    return with_no_trimmed_paths(() => {
      switch (self.$) {
        case "DownstreamCrate": {
          const { trait_ref, self_ty } = self;
          const trait_desc = display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref));
          const self_desc = self_ty !== undefined ? ` for type \`${display_Ty(self_ty)}\`` : "";
          return `downstream crates may implement trait \`${trait_desc}\`${self_desc}`;
        }
        case "UpstreamCrateUpdate": {
          const { trait_ref, self_ty } = self;
          const trait_desc = display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref));
          const self_desc = self_ty !== undefined ? ` for type \`${display_Ty(self_ty)}\`` : "";
          return `upstream crates may add a new impl of trait \`${trait_desc}\`${self_desc} in future versions`;
        }
      }
    });
  },
};

// ---- impl<'cx, 'tcx> SelectionContext<'cx, 'tcx> (mod.rs:180) ---------------------------------------------------------

Object.assign(SelectionContext, {
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:181 new
  new(infcx: InferCtxt): SelectionContext {
    return new SelectionContext(infcx, TypeFreshener.new(infcx), "Standard" satisfies TraitQueryMode);
  },

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:193 with_query_mode
  with_query_mode(infcx: InferCtxt, query_mode: TraitQueryMode): SelectionContext {
    // debug!(?query_mode, "with_query_mode");
    const base = SelectionContext.new(infcx);
    return new SelectionContext(base.infcx, base.freshener, query_mode);
  },
});

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:189 typing_mode
SelectionContext.prototype.typing_mode = function (this: SelectionContext): TypingMode<CantBeErased> {
  return TypingMode.assert_not_erased(this.infcx.typing_mode_raw());
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:201 tcx
SelectionContext.prototype.tcx = function (this: SelectionContext): TyCtxt {
  return this.infcx.tcx;
};

// ==== lane old-select-b: mod.rs:1704..2797 (winnowing, builtin rules and helpers) ===================================
//
// PORT (old-select-b):
// - The imports of this region sit here (ESM hoists them), apart from the other lanes' blocks to ease the merge.
// - Other rustc_trait_selection modules (normalize.rs, util.rs) are read lazily inside the bodies (init order: module
//   comment); `./_match.ts` only imports other crates, so it is a static import.
// - Derived `PartialEq` of `PolyTraitClause` / `TraitRef` is the `eq` of their `Relate` descriptors (rustc_type_ir
//   relate.ts: `Binder` compares the value and the interned `bound_vars`; the structs compare by `intern_key`).
// - `Iterator::try_reduce` with an `Option`-returning closure is `try_reduce` below; its `Option<Option<T>>` is
//   `{ $: "Some", _0: T | undefined } | undefined` (PORTING §5).
// - `bug!` / `unreachable!(..)` texts are verbatim (`unreachable!(msg)` panics with core's
//   "internal error: entered unreachable code: msg").

import { DefineOpaqueTypes } from "../../../rustc_infer/infer/at.gen.ts";
import {
  ToTrace_PolyExistentialProjection,
  ToTrace_PolyExistentialTraitRef,
  ToTrace_TraitRef,
} from "../../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import { Obligation, type PolyTraitObligation, type PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import { Normalized } from "../../../rustc_infer/traits/project.gen.ts";
import {
  clone_ObligationCause,
  ObligationCause,
  type ObligationCauseCode,
  SelectionError,
  type SelectionResult,
} from "../../../rustc_middle/traits/mod.ts";
import {
  clone_SelectionCandidate,
  EvaluationResult as EvaluationResultC,
  type SelectionCandidate,
} from "../../../rustc_middle/traits/select.ts";
import type { Clause, GenericArgs, ParamEnv, Region as RegionT } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../../../rustc_middle/ty/generics.ts";
import { RawList, type List } from "../../../rustc_middle/ty/list.ts";
import { debug_Ty, type ImplTraitHeader, Ty } from "../../../rustc_middle/ty/mod.ts";
import {
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_PolyRegionOutlivesClause,
  Predicate_upcast_from_TraitRef,
  type PolyExistentialPredicate,
} from "../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, DefIdSet, debug_DefId } from "../../../rustc_span/def_id.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type {
  CoroutineWitnessTypes,
  ExistentialProjection,
  ExistentialTraitRef as ExistentialTraitRefT,
  PolyTraitRef,
  RegionOutlivesClause,
  TraitClause,
  TraitRef as TraitRefT,
} from "../../../rustc_type_ir/decls.ts";
import { supertrait_def_ids } from "../../../rustc_type_ir/elaborate.ts";
import { fold_Vec, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { TypeVisitable } from "../../../rustc_type_ir/visit.ts";
import {
  as_interner,
  ExistentialTraitRef,
  PolyExistentialProjection,
  PolyTraitClause as PolyTraitClauseC,
  TraitRef as TraitRefC,
  visit_with_OutlivesClause,
} from "../../../rustc_type_ir/predicate.ts";
import {
  relate_Binder,
  relate_ExistentialProjection,
  relate_ExistentialTraitRef,
  relate_TraitClause,
  relate_TraitRef,
} from "../../../rustc_type_ir/relate.ts";
import type { AliasBoundKind, CandidatePreferenceMode, SizedTraitKind } from "../../../rustc_type_ir/solve/mod.ts";
import { fold_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import {
  fold_with_CoroutineWitnessTypes,
  try_fold_with_CoroutineWitnessTypes,
  UnsafeBinderInner,
  visit_with_CoroutineWitnessTypes,
} from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { format_debug, debug_option } from "../../../std/fmt.ts";
import { assert_eq, unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { MatchAgainstFreshVars } from "./_match.ts";
import {
  type AutoImplConstituents,
  type EvaluatedCandidate,
  visit_with_AutoImplConstituents,
} from "./mod.gen.ts";

/** Lazily read modules of this crate (init order: module comment). */
function normalize_mod_b(): typeof import("../normalize.ts") {
  return require("../normalize.ts") as typeof import("../normalize.ts");
}
function util_mod_b(): typeof import("../util.ts") {
  return require("../util.ts") as typeof import("../util.ts");
}

/** D4 descriptor of `ty::PolyTraitClause` (`Binder<TraitClause>`: `TypeFoldable` + `PartialEq` + `Relate`). */
const d_PolyTraitClause = relate_Binder<TraitClause>(relate_TraitClause);
/** D4 descriptor of `ty::PolyTraitRef`. */
const d_PolyTraitRef = relate_Binder<TraitRefT>(relate_TraitRef);
/** `Vec<Ty>: TypeVisitable` (for `Binder::dummy`). */
const d_VecTy: TypeVisitable<Ty[]> = {
  visit_with: (s, v) => fold_Vec(fold_Ty).visit_with(s, v),
};
/** `AutoImplConstituents: TypeVisitable` (generated derive, ./mod.gen.ts). */
const d_AutoImplConstituents: TypeVisitable<AutoImplConstituents> = { visit_with: visit_with_AutoImplConstituents };
/** `RegionOutlivesClause: TypeVisitable` (for `Binder::dummy`). */
const d_RegionOutlivesClause: TypeVisitable<RegionOutlivesClause> = {
  visit_with: (s, v) => visit_with_OutlivesClause(s, v, fold_Region.visit_with),
};
/** `ty::Binder<CoroutineWitnessTypes>: TypeFoldable` (the `coroutine_hidden_types` query value). */
const d_Binder_CoroutineWitnessTypes: TypeFoldable<Binder<CoroutineWitnessTypes>> = fold_Binder<CoroutineWitnessTypes>({
  visit_with: visit_with_CoroutineWitnessTypes,
  try_fold_with: try_fold_with_CoroutineWitnessTypes,
  fold_with: fold_with_CoroutineWitnessTypes,
});

/** PORT: `Iterator::try_reduce` with an `Option`-returning closure (`None` short-circuits). */
function try_reduce<T>(iter: Iterable<T>, f: (a: T, b: T) => T | undefined): { $: "Some"; _0: T | undefined } | undefined {
  let first = true;
  let acc: T | undefined;
  for (const x of iter) {
    if (first) {
      first = false;
      acc = x;
      continue;
    }
    const r = f(acc as T, x);
    if (r === undefined) return undefined;
    acc = r;
  }
  return { $: "Some", _0: acc };
}

/// ## Winnowing
///
/// Winnowing is the process of attempting to resolve ambiguity by
/// probing further. During the winnowing process, we unify all
/// type variables and then we also attempt to evaluate recursive
/// bounds to see if they are satisfied.

/// If there are multiple ways to prove a trait goal, we make some
/// *fairly arbitrary* choices about which candidate is actually used.
///
/// For more details, look at the implementation of this method :)
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1716 winnow_candidates
SelectionContext.prototype.winnow_candidates = function (
  this: SelectionContext,
  has_non_region_infer: boolean,
  candidate_preference_mode: CandidatePreferenceMode,
  candidates: EvaluatedCandidate[],
): SelectionCandidate | undefined {
  if (candidates.length === 1) {
    return candidates.pop()!.candidate;
  }

  // We prefer `Sized` candidates over everything.
  const sized_candidate = candidates.find((c) => c.candidate.$ === "SizedCandidate");
  if (sized_candidate !== undefined) {
    // There should only ever be a single sized candidate
    // as they would otherwise overlap.
    // debug_assert_eq!(sized_candidates.next(), None);
    // Only prefer the built-in `Sized` candidate if its nested goals are certain.
    // Otherwise, we may encounter failure later on if inference causes this candidate
    // to not hold, but a where clause would've applied instead.
    if (EvaluationResultC.must_apply_modulo_regions(sized_candidate.evaluation)) {
      return clone_SelectionCandidate(sized_candidate.candidate);
    } else {
      return undefined;
    }
  }

  // Before we consider where-bounds, we have to deduplicate them here and also
  // drop where-bounds in case the same where-bound exists without bound vars.
  // This is necessary as elaborating super-trait bounds may result in duplicates.
  search_victim: for (;;) {
    for (let i = 0; i < candidates.length; i++) {
      const this_c = candidates[i]!.candidate;
      if (this_c.$ !== "ParamCandidate") continue;
      const this_ = this_c._0;
      for (let j = 0; j < candidates.length; j++) {
        if (i === j) {
          continue;
        }

        const other_c = candidates[j]!.candidate;
        if (other_c.$ !== "ParamCandidate") continue;
        const other = other_c._0;
        if (d_PolyTraitClause.eq(this_, other)) {
          candidates.splice(j, 1);
          continue search_victim;
        }

        if (
          relate_TraitRef.eq(Binder.skip_binder(this_).trait_ref, Binder.skip_binder(other).trait_ref) &&
          Binder.skip_binder(this_).polarity === Binder.skip_binder(other).polarity &&
          !TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(this_).trait_ref, relate_TraitRef)
        ) {
          candidates.splice(j, 1);
          continue search_victim;
        }
      }
    }

    break;
  }

  const alias_bounds: [number, AliasBoundKind][] = [];
  for (const c of candidates) {
    if (c.candidate.$ === "ProjectionCandidate") {
      alias_bounds.push([c.candidate.idx, c.candidate.kind]);
    }
  }
  // Extract non-nested alias bound candidates, will be preferred over where bounds if
  // we're proving an auto-trait, sizedness trait or default trait.
  if (candidate_preference_mode === "Marker") {
    const r = try_reduce(
      alias_bounds.filter(([_idx, kind]) => kind === "SelfBounds").map(([idx, _kind]) => idx),
      (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
    );
    if (r !== undefined && r._0 !== undefined) {
      return { $: "ProjectionCandidate", idx: r._0, kind: "SelfBounds" };
    } else if (r !== undefined) {
      // Some(None) => {}
    } else {
      return undefined;
    }
  }

  // The next highest priority is for non-global where-bounds. However, while we don't
  // prefer global where-clauses here, we do bail with ambiguity when encountering both
  // a global and a non-global where-clause.
  //
  // Our handling of where-bounds is generally fairly messy but necessary for backwards
  // compatibility, see #50825 for why we need to handle global where-bounds like this.
  const is_global = (c: PolyTraitClause): boolean =>
    TypeVisitableExt.is_global(c, d_PolyTraitClause) && !TypeVisitableExt.has_bound_vars(c, d_PolyTraitClause);
  let has_global_bounds = false;
  let param_candidate: PolyTraitClause | undefined = undefined;
  for (const cand of candidates) {
    if (cand.candidate.$ !== "ParamCandidate") continue;
    const c = cand.candidate._0;
    if (is_global(c)) {
      has_global_bounds = true;
    } else {
      const prev = param_candidate;
      param_candidate = c;
      if (prev !== undefined) {
        // Ambiguity, two potentially different where-clauses
        return undefined;
      }
    }
  }
  if (param_candidate !== undefined) {
    const predicate = param_candidate;
    // Ambiguity, a global and a non-global where-bound.
    if (has_global_bounds) {
      return undefined;
    } else {
      return { $: "ParamCandidate", _0: predicate };
    }
  }

  // Prefer alias-bounds over blanket impls for rigid associated types. This is
  // fairly arbitrary but once again necessary for backwards compatibility.
  // If there are multiple applicable candidates which don't affect type inference,
  // choose the one with the lowest index.
  {
    const r = try_reduce<[number, AliasBoundKind]>(alias_bounds, ([c1, k1], [c2, k2]) => {
      if (has_non_region_infer) {
        return undefined;
      } else if (c1 < c2) {
        return [c1, k1];
      } else {
        return [c2, k2];
      }
    });
    if (r !== undefined && r._0 !== undefined) {
      const [idx, kind] = r._0;
      return { $: "ProjectionCandidate", idx, kind };
    } else if (r !== undefined) {
      // Some(None) => {}
    } else {
      return undefined;
    }
  }

  // Need to prioritize builtin trait object impls as `<dyn Any as Any>::type_id`
  // should use the vtable method and not the method provided by the user-defined
  // impl `impl<T: ?Sized> Any for T { .. }`. This really shouldn't exist but is
  // necessary due to #57893. We again arbitrarily prefer the applicable candidate
  // with the lowest index.
  //
  // We do not want to use these impls to guide inference in case a user-written impl
  // may also apply.
  const object_bound = try_reduce(
    candidates.flatMap((c) => (c.candidate.$ === "ObjectCandidate" ? [c.candidate._0] : [])),
    (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
  );
  if (object_bound !== undefined && object_bound._0 !== undefined) {
    const index = object_bound._0;
    return has_non_region_infer && candidates.some((c) => c.candidate.$ === "ImplCandidate")
      ? undefined
      : { $: "ObjectCandidate", _0: index };
  } else if (object_bound !== undefined) {
    // Some(None) => {}
  } else {
    return undefined;
  }
  // Same for upcasting.
  const upcast_bound = try_reduce(
    candidates.flatMap((c) => (c.candidate.$ === "TraitUpcastingUnsizeCandidate" ? [c.candidate._0] : [])),
    (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
  );
  if (upcast_bound !== undefined && upcast_bound._0 !== undefined) {
    return { $: "TraitUpcastingUnsizeCandidate", _0: upcast_bound._0 };
  } else if (upcast_bound !== undefined) {
    // Some(None) => {}
  } else {
    return undefined;
  }

  // Finally, handle overlapping user-written impls.
  let impl_candidate: [DefId, EvaluationResult] | undefined = undefined;
  for (const cand of candidates) {
    if (cand.candidate.$ !== "ImplCandidate") continue;
    const c: [DefId, EvaluationResult] = [cand.candidate._0, cand.evaluation];
    const prev: [DefId, EvaluationResult] | undefined = impl_candidate;
    impl_candidate = c;
    if (prev !== undefined) {
      if (this.prefer_lhs_over_victim(has_non_region_infer, c, prev[0])) {
        // Ok, prefer `c` over the previous entry
      } else if (this.prefer_lhs_over_victim(has_non_region_infer, prev, c[0])) {
        // Ok, keep `prev` instead of the new entry
        impl_candidate = prev;
      } else {
        // Ambiguity, two potentially different where-clauses
        return undefined;
      }
    }
  }
  if (impl_candidate !== undefined) {
    const [def_id, _evaluation] = impl_candidate;
    // Don't use impl candidates which overlap with other candidates.
    // This should pretty much only ever happen with malformed impls.
    if (
      candidates.every((c) => {
        switch (c.candidate.$) {
          case "SizedCandidate":
          case "BuiltinCandidate":
          case "TransmutabilityCandidate":
          case "AutoImplCandidate":
          case "ClosureCandidate":
          case "AsyncClosureCandidate":
          case "AsyncFnKindHelperCandidate":
          case "CoroutineCandidate":
          case "FutureCandidate":
          case "IteratorCandidate":
          case "AsyncIteratorCandidate":
          case "FnPointerCandidate":
          case "TraitAliasCandidate":
          case "TraitUpcastingUnsizeCandidate":
          case "BuiltinObjectCandidate":
          case "BuiltinUnsizeCandidate":
          case "TryAsDynCandidate":
          case "BikeshedGuaranteedNoDropCandidate":
            return false;
          // Non-global param candidates have already been handled, global
          // where-bounds get ignored.
          case "ParamCandidate":
          case "ImplCandidate":
            return true;
          case "ProjectionCandidate":
          case "ObjectCandidate":
            return unreachable();
        }
      })
    ) {
      return { $: "ImplCandidate", _0: def_id };
    } else {
      return undefined;
    }
  }

  if (candidates.length === 1) {
    return candidates.pop()!.candidate;
  } else {
    // Also try ignoring all global where-bounds and check whether we end
    // with a unique candidate in this case.
    const not_a_global_where_bound = candidates.filter((c) => !(c.candidate.$ === "ParamCandidate" && is_global(c.candidate._0)));
    return not_a_global_where_bound.length === 1 ? not_a_global_where_bound[0]!.candidate : undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1951 prefer_lhs_over_victim
SelectionContext.prototype.prefer_lhs_over_victim = function (
  this: SelectionContext,
  has_non_region_infer: boolean,
  [lhs, lhs_evaluation]: [DefId, EvaluationResult],
  victim: DefId,
): boolean {
  const tcx = this.tcx();
  // See if we can toss out `victim` based on specialization.
  //
  // While this requires us to know *for sure* that the `lhs` impl applies
  // we still use modulo regions here. This is fine as specialization currently
  // assumes that specializing impls have to be always applicable, meaning that
  // the only allowed region constraints may be constraints also present on the default impl.
  if (EvaluationResultC.must_apply_modulo_regions(lhs_evaluation)) {
    if (tcx.specializes([lhs, victim])) {
      return true;
    }
  }

  const overlap = tcx.impls_are_allowed_to_overlap(lhs, victim);
  if (overlap === undefined) {
    return false;
  }
  if (overlap.$ === "Permitted" && overlap.marker === false) {
    // For candidates which already reference errors it doesn't really
    // matter what we do 🤷
    return EvaluationResultC.must_apply_considering_regions(lhs_evaluation);
  } else {
    // Some(ty::ImplOverlapKind::Permitted { marker: true })
    // Subtle: If the predicate we are evaluating has inference
    // variables, do *not* allow discarding candidates due to
    // marker trait impls.
    //
    // Without this restriction, we could end up accidentally
    // constraining inference variables based on an arbitrarily
    // chosen trait impl.
    //
    // Imagine we have the following code:
    //
    // ```rust
    // #[marker] trait MyTrait {}
    // impl MyTrait for u8 {}
    // impl MyTrait for bool {}
    // ```
    //
    // And we are evaluating the predicate `<_#0t as MyTrait>`.
    //
    // During selection, we will end up with one candidate for each
    // impl of `MyTrait`. If we were to discard one impl in favor
    // of the other, we would be left with one candidate, causing
    // us to "successfully" select the predicate, unifying
    // _#0t with (for example) `u8`.
    //
    // However, we have no reason to believe that this unification
    // is correct - we've essentially just picked an arbitrary
    // *possibility* for _#0t, and required that this be the *only*
    // possibility.
    //
    // Eventually, we will either:
    // 1) Unify all inference variables in the predicate through
    // some other means (e.g. type-checking of a function). We will
    // then be in a position to drop marker trait candidates
    // without constraining inference variables (since there are
    // none left to constrain)
    // 2) Be left with some unconstrained inference variables. We
    // will then correctly report an inference error, since the
    // existence of multiple marker trait impls tells us nothing
    // about which one should actually apply.
    return !has_non_region_infer && EvaluationResultC.must_apply_considering_regions(lhs_evaluation);
  }
};

// ---- impl<'tcx> SelectionContext<'_, 'tcx> (mod.rs:2023) ----

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2024 sizedness_conditions
SelectionContext.prototype.sizedness_conditions = function (this: SelectionContext, self_ty: Ty, sizedness: SizedTraitKind): Binder<Ty[]> {
  const k = self_ty.kind();
  switch (k.$) {
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return Binder.dummy<Ty[]>([], d_VecTy);
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble \`Sized\` of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Coroutine":
    case "CoroutineWitness":
    case "Array":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      return Binder.dummy<Ty[]>([], d_VecTy);

    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        case "Sized":
          return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsized type");
        case "MetaSized":
          return Binder.dummy<Ty[]>([], d_VecTy);
      }
      break;

    case "Foreign":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsized type");

    case "Tuple": {
      const tys = k._0;
      const last = tys[tys.length - 1];
      return Binder.dummy(last === undefined ? [] : [last], d_VecTy);
    }

    case "Pat":
      return Binder.dummy([k._0], d_VecTy);

    case "Adt": {
      const [def, args] = [k._0, k._1];
      const crit = def.sizedness_constraint(this.tcx(), sizedness);
      if (crit !== undefined) {
        return Binder.dummy([Unnormalized.skip_norm_wip(EarlyBinder.instantiate(crit, this.tcx(), args, fold_Ty))], d_VecTy);
      } else {
        return Binder.dummy<Ty[]>([], d_VecTy);
      }
    }

    case "UnsafeBinder":
      return Binder.map_bound(UnsafeBinderInner.into_Binder(k._0), (ty) => [ty]);

    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
      return bug(`asked to assemble \`Sized\` of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2081 copy_clone_conditions
SelectionContext.prototype.copy_clone_conditions = function (this: SelectionContext, self_ty: Ty): Binder<Ty[]> {
  const k = self_ty.kind();
  switch (k.$) {
    case "FnDef":
    case "FnPtr":
    case "Error":
      return Binder.dummy<Ty[]>([], d_VecTy);

    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
    case "Ref":
      if (k._2 === "Not") {
        return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
      }
      // ty::Ref(_, _, ty::Mutability::Mut)
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);

    // FIXME(unsafe_binder): Should we conditionally
    // (i.e. universally) implement copy/clone?
    case "UnsafeBinder":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsafe binder");

    case "Tuple": {
      // (*) binder moved here
      return Binder.dummy([...k._0], d_VecTy);
    }

    case "Pat": {
      // (*) binder moved here
      return Binder.dummy([k._0], d_VecTy);
    }

    case "Coroutine": {
      const [def_id, args] = [k._0, k._1];
      switch (this.tcx().coroutine_movability(def_id)) {
        case "Static":
          return unreachable("internal error: entered unreachable code: tried to assemble `Clone` for static coroutine");
        case "Movable":
          if (this.tcx().features().coroutine_clone()) {
            return Binder.dummy(
              [CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), Ty.new_coroutine_witness_for_coroutine(this.tcx(), def_id, args)],
              d_VecTy,
            );
          } else {
            return unreachable("internal error: entered unreachable code: tried to assemble `Clone` for coroutine without enabled feature");
          }
      }
      break;
    }

    case "CoroutineWitness": {
      const [def_id, args] = [k._0, k._1];
      return Binder.map_bound(
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(
            this.infcx.tcx.coroutine_hidden_types(def_id) as EarlyBinder<Binder<CoroutineWitnessTypes>>,
            this.infcx.tcx,
            args,
            d_Binder_CoroutineWitnessTypes,
          ),
        ),
        (witness) => [...witness.types],
      );
    }

    case "Closure":
      return Binder.dummy([...ClosureArgs.upvar_tys(k._1.as_closure())], d_VecTy);

    case "CoroutineClosure":
      return Binder.dummy([...CoroutineClosureArgs.upvar_tys(k._1.as_coroutine_closure())], d_VecTy);

    case "Foreign":
    case "Str":
    case "Slice":
    case "Dynamic":
    case "Adt":
    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2160 coroutine_is_gen
SelectionContext.prototype.coroutine_is_gen = function (this: SelectionContext, self_ty: Ty): boolean {
  const k = self_ty.kind();
  return k.$ === "Coroutine" && this.tcx().coroutine_is_gen(k._0);
};

/// For default impls, we need to break apart a type into its
/// "constituent types" -- meaning, the types that it contains.
///
/// Here are some (simple) examples:
///
/// ```ignore (illustrative)
/// (i32, u32) -> [i32, u32]
/// Foo where struct Foo { x: i32, y: u32 } -> [i32, u32]
/// Bar<i32> where struct Bar<T> { x: T, y: u32 } -> [i32, u32]
/// Zed<i32> where enum Zed { A(T), B(u32) } -> [i32, u32]
/// ```
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2177 constituent_types_for_auto_trait
SelectionContext.prototype.constituent_types_for_auto_trait = function (
  this: SelectionContext,
  t: Ty,
): Result<Binder<AutoImplConstituents>, SelectionError> {
  const k = t.kind();
  const empty = (): AutoImplConstituents => ({ types: [], assumptions: [] });
  switch (k.$) {
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "Error":
    case "Never":
    case "Char":
      return Ok(Binder.dummy(empty(), d_AutoImplConstituents));

    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return Ok(Binder.dummy(empty(), d_AutoImplConstituents));
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);

    // This branch is only for `experimental_default_bounds`.
    // Other foreign types were rejected earlier in
    // `assemble_candidates_from_auto_impls`.
    case "Foreign":
      return Ok(Binder.dummy(empty(), d_AutoImplConstituents));

    case "UnsafeBinder":
      return Ok(Binder.map_bound(UnsafeBinderInner.into_Binder(k._0), (ty): AutoImplConstituents => ({ types: [ty], assumptions: [] })));

    // Treat this like `struct str([u8]);`
    case "Str":
      return Ok(
        Binder.dummy<AutoImplConstituents>(
          {
            types: [Ty.new_slice(this.tcx(), this.tcx().types.u8)],
            assumptions: [],
          },
          d_AutoImplConstituents,
        ),
      );

    case "Placeholder":
    case "Dynamic":
    case "Param":
    case "Bound":
      return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);

    case "RawPtr":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._0], assumptions: [] }, d_AutoImplConstituents));
    case "Ref":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._1], assumptions: [] }, d_AutoImplConstituents));

    case "Pat":
    case "Array":
    case "Slice":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._0], assumptions: [] }, d_AutoImplConstituents));

    case "Tuple":
      // (T1, ..., Tn) -- meets any bound that all of T1...Tn meet
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [...k._0], assumptions: [] }, d_AutoImplConstituents));

    case "Closure": {
      const ty = this.infcx.shallow_resolve(ClosureArgs.tupled_upvars_ty(k._1.as_closure()));
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [ty], assumptions: [] }, d_AutoImplConstituents));
    }

    case "CoroutineClosure": {
      const ty = this.infcx.shallow_resolve(CoroutineClosureArgs.tupled_upvars_ty(k._1.as_coroutine_closure()));
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [ty], assumptions: [] }, d_AutoImplConstituents));
    }

    case "Coroutine": {
      const [def_id, args] = [k._0, k._1];
      const ty = this.infcx.shallow_resolve(CoroutineArgs.tupled_upvars_ty(args.as_coroutine()));
      const tcx = this.tcx();
      const witness = Ty.new_coroutine_witness_for_coroutine(tcx, def_id, args);
      return Ok(
        Binder.dummy<AutoImplConstituents>(
          {
            types: [ty, witness],
            assumptions: [],
          },
          d_AutoImplConstituents,
        ),
      );
    }

    case "CoroutineWitness": {
      const [def_id, args] = [k._0, k._1];
      return Ok(
        Binder.map_bound(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(
              this.infcx.tcx.coroutine_hidden_types(def_id) as EarlyBinder<Binder<CoroutineWitnessTypes>>,
              this.infcx.tcx,
              args,
              d_Binder_CoroutineWitnessTypes,
            ),
          ),
          (witness): AutoImplConstituents => ({
            types: [...witness.types],
            assumptions: [...witness.assumptions],
          }),
        ),
      );
    }

    case "Adt": {
      const [def, args] = [k._0, k._1];
      // For `PhantomData<T>`, we pass `T`.
      if (def.is_phantom_data()) {
        return Ok(
          Binder.dummy<AutoImplConstituents>(
            {
              types: [...args.types()],
              assumptions: [],
            },
            d_AutoImplConstituents,
          ),
        );
      }

      const types: Ty[] = [];
      for (const f of def.all_fields()) types.push(Unnormalized.skip_norm_wip(f.ty(this.tcx(), args)));
      return Ok(Binder.dummy<AutoImplConstituents>({ types, assumptions: [] }, d_AutoImplConstituents));
    }

    case "Alias": {
      const alias = k._1;
      switch (alias.kind.$) {
        case "Projection":
        case "Inherent":
        case "Free":
          return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);
        case "Opaque": {
          const def_id = alias.kind.def_id;
          const args = alias.args;
          if (this.infcx.can_define_opaque_ty(def_id)) {
            return unreachable();
          } else {
            // We can resolve the opaque type to its hidden type,
            // which enforces a DAG between the functions requiring
            // the auto trait bounds in question.
            const ty = this.tcx().type_of_opaque(def_id) as EarlyBinder<Ty>;
            return Ok(
              Binder.dummy<AutoImplConstituents>(
                {
                  types: [Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ty, this.tcx(), args, fold_Ty))],
                  assumptions: [],
                },
                d_AutoImplConstituents,
              ),
            );
          }
        }
      }
      break;
    }
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2307 collect_predicates_for_types
SelectionContext.prototype.collect_predicates_for_types = function (
  this: SelectionContext,
  param_env: ParamEnv,
  cause: ObligationCause,
  recursion_depth: number,
  trait_def_id: DefId,
  types: Ty[],
): PredicateObligations {
  // Because the types were potentially derived from
  // higher-ranked obligations they may reference late-bound
  // regions. For example, `for<'a> Foo<&'a i32> : Copy` would
  // yield a type like `for<'a> &'a i32`. In general, we
  // maintain the invariant that we never manipulate bound
  // regions, so we have to process these bound regions somehow.
  //
  // The strategy is to:
  //
  // 1. Instantiate those regions to placeholder regions (e.g.,
  //    `for<'a> &'a i32` becomes `&0 i32`.
  // 2. Produce something like `&'0 i32 : Copy`
  // 3. Re-bind the regions back to `for<'a> &'a i32 : Copy`

  const out: PredicateObligations = [];
  for (const placeholder_ty of types) {
    const { value: normalized_ty, obligations } = normalize_mod_b().normalize_with_depth(
      this,
      param_env,
      clone_ObligationCause(cause),
      recursion_depth,
      Unnormalized.new_wip(placeholder_ty),
      fold_Ty,
    );

    const tcx = this.tcx();
    let trait_ref: TraitRefT;
    if ((tcx.generics_of(trait_def_id) as Generics).own_params.length === 1) {
      trait_ref = TraitRefC.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(normalized_ty)]);
    } else {
      // If this is an ill-formed auto/built-in trait, then synthesize
      // new error args for the missing generics.
      const err_args = RawList.extend_with_error(tcx, trait_def_id, [GenericArg.from_Ty(normalized_ty)]);
      trait_ref = TraitRefC.new_from_args(as_interner(tcx), trait_def_id, err_args);
    }

    const obligation = Obligation.new(this.tcx(), clone_ObligationCause(cause), param_env, trait_ref, (from: TraitRefT, _i) =>
      Predicate_upcast_from_TraitRef(from, tcx),
    );
    obligations.push(obligation);
    out.push(...obligations);
  }
  return out;
};

///////////////////////////////////////////////////////////////////////////
// Matching
//
// Matching is a common path used for both evaluation and
// confirmation. It basically unifies types that appear in impls
// and traits. This does affect the surrounding environment;
// therefore, when used during evaluation, match routines must be
// run inside of a `probe()` so that their side-effects are
// contained.

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2371 rematch_impl
SelectionContext.prototype.rematch_impl = function (this: SelectionContext, impl_def_id: DefId, obligation: PolyTraitObligation): Normalized<GenericArgs> {
  const impl_trait_header = this.tcx().impl_trait_header(impl_def_id) as ImplTraitHeader;
  const r = this.match_impl(impl_def_id, impl_trait_header, obligation);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const predicate = this.infcx.deeply_resolve_ignoring_regions(obligation.predicate, d_PolyTraitClause);
    return bug(
      `impl ${format_debug(impl_def_id, debug_DefId, PLAIN)} was matchable against ${format_debug(predicate, (p, f) => debug_Binder(p, f, debug_TraitClause), PLAIN)} but now is not`,
    );
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2387 match_impl
SelectionContext.prototype.match_impl = function (
  this: SelectionContext,
  impl_def_id: DefId,
  impl_trait_header: ImplTraitHeader,
  obligation: PolyTraitObligation,
): Result<Normalized<GenericArgs>, null> {
  const placeholder_obligation = this.infcx.enter_forall_and_leak_universe(obligation.predicate, relate_TraitClause);
  const placeholder_obligation_trait_ref = placeholder_obligation.trait_ref;

  const impl_args = this.infcx.fresh_args_for_item(obligation.cause.span, impl_def_id);

  const trait_ref = EarlyBinder.instantiate(impl_trait_header.trait_ref, this.tcx(), impl_args, relate_TraitRef);
  // debug!(?impl_trait_header);

  const nested_obligations: PredicateObligations = [];
  const impl_trait_ref = normalize_mod_b().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    trait_ref,
    nested_obligations,
    relate_TraitRef,
  );

  // debug!(?impl_trait_ref, ?placeholder_obligation_trait_ref);

  const cause = ObligationCause.new(obligation.cause.span, obligation.cause.body_def_id, {
    $: "MatchImpl",
    _0: clone_ObligationCause(obligation.cause),
    _1: impl_def_id,
  } satisfies ObligationCauseCode);

  const r = this.infcx.at(cause, obligation.param_env).eq(DefineOpaqueTypes.No, placeholder_obligation_trait_ref, impl_trait_ref, ToTrace_TraitRef);
  // .map_err(|e| debug!("match_impl: failed eq_trait_refs due to `{}`", e.to_string(self.tcx())))?;
  if (r.$ === "Err") return Err(null);
  const { obligations } = r._0;
  nested_obligations.push(...obligations);

  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Reflection":
      if (!this.tcx().impl_is_fully_generic_for_reflection(impl_def_id)) {
        // debug!("reflection mode only allows fully generic impls");
        return Err(null);
      }
      break;
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "Codegen":
    case "ErasedNotCoherence":
    case "PostAnalysis":
      break;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
  }

  return Ok(new Normalized(impl_args, nested_obligations));
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2452 match_upcast_principal
SelectionContext.prototype.match_upcast_principal = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  unnormalized_upcast_principal: Unnormalized<PolyTraitRef>,
  a_data: List<PolyExistentialPredicate>,
  b_data: List<PolyExistentialPredicate>,
  a_region: RegionT,
  b_region: RegionT,
): SelectionResult<PredicateObligations> {
  const tcx = this.tcx();
  const nested: PredicateObligations = [];

  // We may upcast to auto traits that are either explicitly listed in
  // the object type's bounds, or implied by the principal trait ref's
  // supertraits.
  const a_auto_traits = new DefIdSet();
  for (const def_id of a_data.auto_traits()) a_auto_traits.add(def_id);
  const principal_def_id = a_data.principal_def_id();
  if (principal_def_id !== undefined) {
    for (const def_id of supertrait_def_ids(tcx, principal_def_id)) {
      if (tcx.trait_is_auto(def_id)) a_auto_traits.add(def_id);
    }
  }

  const upcast_principal = normalize_mod_b().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    unnormalized_upcast_principal,
    nested,
    d_PolyTraitRef,
  );

  for (const bound of b_data) {
    const bk = Binder.skip_binder(bound);
    switch (bk.$) {
      // Check that a_ty's supertrait (upcast_principal) is compatible
      // with the target (b_ty).
      case "Trait": {
        const target_principal = bk._0;
        const hr_source_principal = Binder.map_bound(upcast_principal, (trait_ref) => ExistentialTraitRef.erase_self_ty(as_interner(tcx), trait_ref));
        const hr_target_principal = Binder.rebind(bound, target_principal);

        const r = this.infcx.enter_forall(
          hr_target_principal,
          (target_principal) => {
            const source_principal = this.infcx.instantiate_binder_with_fresh_vars(
              obligation.cause.span,
              BoundRegionConversionTime.HigherRankedType,
              hr_source_principal,
              relate_ExistentialTraitRef,
            );
            return this.infcx
              .at(obligation.cause, obligation.param_env)
              .eq_trace(
                DefineOpaqueTypes.Yes,
                ToTrace_PolyExistentialTraitRef.to_trace(obligation.cause, hr_target_principal, hr_source_principal),
                target_principal,
                source_principal,
                relate_ExistentialTraitRef,
              );
          },
          relate_ExistentialTraitRef,
        );
        if (r.$ === "Err") return Err(SelectionError.Unimplemented);
        nested.push(...r._0.into_obligations());
        break;
      }
      // Check that b_ty's projection is satisfied by exactly one of
      // a_ty's projections. First, we look through the list to see if
      // any match. If not, error. Then, if *more* than one matches, we
      // return ambiguity. Otherwise, if exactly one matches, equate
      // it with b_ty's projection.
      case "Projection": {
        const target_projection = bk._0;
        const hr_target_projection = Binder.rebind(bound, target_projection);

        const infcx = this.infcx;
        const matching_projections = (function* (): Generator<Binder<ExistentialProjection>> {
          for (const hr_source_projection of a_data.projection_bounds()) {
            // Eager normalization means that we can just use can_eq
            // here instead of equating and processing obligations.
            if (
              DefId_eq(PolyExistentialProjection.item_def_id(hr_source_projection), PolyExistentialProjection.item_def_id(hr_target_projection)) &&
              infcx.probe((_) => {
                return (
                  infcx.enter_forall(
                    hr_target_projection,
                    (target_projection) => {
                      const source_projection = infcx.instantiate_binder_with_fresh_vars(
                        obligation.cause.span,
                        BoundRegionConversionTime.HigherRankedType,
                        hr_source_projection,
                        relate_ExistentialProjection,
                      );
                      return infcx
                        .at(obligation.cause, obligation.param_env)
                        .eq_trace(
                          DefineOpaqueTypes.Yes,
                          ToTrace_PolyExistentialProjection.to_trace(obligation.cause, hr_target_projection, hr_source_projection),
                          target_projection,
                          source_projection,
                          relate_ExistentialProjection,
                        );
                    },
                    relate_ExistentialProjection,
                  ).$ === "Ok"
                );
              })
            ) {
              yield hr_source_projection;
            }
          }
        })();

        const first = matching_projections.next();
        if (first.done) {
          return Err(SelectionError.Unimplemented);
        }
        const hr_source_projection = first.value;
        if (!matching_projections.next().done) {
          return Ok(undefined);
        }
        const r = this.infcx.enter_forall(
          hr_target_projection,
          (target_projection) => {
            const source_projection = this.infcx.instantiate_binder_with_fresh_vars(
              obligation.cause.span,
              BoundRegionConversionTime.HigherRankedType,
              hr_source_projection,
              relate_ExistentialProjection,
            );
            return this.infcx
              .at(obligation.cause, obligation.param_env)
              .eq_trace(
                DefineOpaqueTypes.Yes,
                ToTrace_PolyExistentialProjection.to_trace(obligation.cause, hr_target_projection, hr_source_projection),
                target_projection,
                source_projection,
                relate_ExistentialProjection,
              );
          },
          relate_ExistentialProjection,
        );
        if (r.$ === "Err") return Err(SelectionError.Unimplemented);
        nested.push(...r._0.into_obligations());
        break;
      }
      // Check that b_ty's auto traits are present in a_ty's bounds.
      case "AutoTrait": {
        const def_id = bk._0;
        if (!a_auto_traits.has(def_id)) {
          return Err(SelectionError.Unimplemented);
        }
        break;
      }
    }
  }

  nested.push(
    Obligation.with_depth(
      tcx,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      obligation.param_env,
      Binder.dummy<RegionOutlivesClause>({ _0: a_region, _1: b_region }, d_RegionOutlivesClause),
      (from: Binder<RegionOutlivesClause>, _i) => Predicate_upcast_from_PolyRegionOutlivesClause(from, tcx),
    ),
  );

  return Ok(nested);
};

/// Normalize `where_clause_trait_ref` and try to match it against
/// `obligation`. If successful, return any predicates that
/// result from the normalization.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2615 match_where_clause_trait_ref
SelectionContext.prototype.match_where_clause_trait_ref = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  where_clause_trait_ref: PolyTraitRef,
): Result<PredicateObligations, null> {
  return this.match_poly_trait_ref(obligation, where_clause_trait_ref);
};

/// Returns `Ok` if `poly_trait_ref` being true implies that the
/// obligation is satisfied.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2626 match_poly_trait_ref
SelectionContext.prototype.match_poly_trait_ref = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  poly_trait_ref: PolyTraitRef,
): Result<PredicateObligations, null> {
  const predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, relate_TraitClause);
  const trait_ref = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    poly_trait_ref,
    relate_TraitRef,
  );
  const r = this.infcx.at(obligation.cause, obligation.param_env).eq(DefineOpaqueTypes.No, predicate.trait_ref, trait_ref, ToTrace_TraitRef);
  if (r.$ === "Ok") {
    const { obligations } = r._0;
    return Ok(obligations);
  }
  return Err(null);
};

///////////////////////////////////////////////////////////////////////////
// Miscellany

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2647 match_fresh_trait_preds
SelectionContext.prototype.match_fresh_trait_preds = function (this: SelectionContext, previous: PolyTraitClause, current: PolyTraitClause): boolean {
  const matcher = MatchAgainstFreshVars.new(this.tcx());
  return matcher.relate(previous, current, d_PolyTraitClause).$ === "Ok";
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2656 push_stack
SelectionContext.prototype.push_stack = function (
  this: SelectionContext,
  previous_stack: TraitObligationStackList,
  obligation: PolyTraitObligation,
): TraitObligationStack {
  const fresh_trait_pred = d_PolyTraitClause.fold_with(obligation.predicate, this.freshener);

  const dfn = previous_stack.cache.next_dfn();
  const depth = previous_stack.depth() + 1;
  // PORT: `previous_stack` is a `Copy` value moved into the stack: stored as its own copy (`next()` mutates in place).
  return new TraitObligationStack(obligation, fresh_trait_pred, depth, clone_TraitObligationStackList(previous_stack), depth, dfn);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2676 closure_trait_ref_unnormalized
SelectionContext.prototype.closure_trait_ref_unnormalized = function (this: SelectionContext, self_ty: Ty, fn_trait_def_id: DefId): PolyTraitRef {
  const k = self_ty.kind();
  if (k.$ !== "Closure") {
    return bug(`expected closure, found ${display_Ty(self_ty)}`);
  }
  const args = k._1;
  const closure_sig = ClosureArgs.sig(args.as_closure());

  return Binder.map_bound(
    util_mod_b().closure_trait_ref_and_return_type(this.tcx(), fn_trait_def_id, self_ty, closure_sig, "No"),
    ([trait_ref, _]) => trait_ref,
  );
};

/// Returns the obligations that are implied by instantiating an
/// impl or trait. The obligations are instantiated and fully
/// normalized. This is used when confirming an impl or default
/// impl.
// #[instrument(level = "debug", skip(self, cause, param_env))]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2701 impl_or_trait_obligations
SelectionContext.prototype.impl_or_trait_obligations = function (
  this: SelectionContext,
  cause: ObligationCause,
  recursion_depth: number,
  param_env: ParamEnv,
  def_id: DefId, // of impl or trait
  args: GenericArgs, // for impl or trait
  parent_trait_pred: Binder<TraitClause>,
): PredicateObligations {
  const tcx = this.tcx();

  // To allow for one-pass evaluation of the nested obligation,
  // each predicate must be preceded by the obligations required
  // to normalize it.
  // for example, if we have:
  //    impl<U: Iterator<Item: Copy>, V: Iterator<Item = U>> Foo for V
  // the impl will have the following predicates:
  //    <V as Iterator>::Item = U,
  //    U: Iterator, U: Sized,
  //    V: Iterator, V: Sized,
  //    <U as Iterator>::Item: Copy
  // When we instantiate, say, `V => IntoIter<u32>, U => $0`, the last
  // obligation will normalize to `<$0 as Iterator>::Item = $1` and
  // `$1: Copy`, so we must ensure the obligations are emitted in
  // that order.
  const clauses_ = tcx.clauses_of(def_id) as GenericClauses;
  assert_eq(clauses_.parent, undefined, (v) => format_debug(v, (x, f) => debug_option(x, f, debug_DefId), PLAIN));
  const clauses = GenericClauses.instantiate_own(clauses_, tcx, args);
  const obligations: PredicateObligations = [];
  let index = 0;
  for (const [clause_, span] of clauses) {
    let cause_: ObligationCause;
    if (tcx.is_lang_item(PolyTraitClauseC.def_id(parent_trait_pred), "CoerceUnsized")) {
      cause_ = clone_ObligationCause(cause);
    } else {
      const index_ = index;
      cause_ = clone_ObligationCause(cause).derived_cause(parent_trait_pred, (derived) => ({
        $: "ImplDerived",
        _0: {
          derived,
          impl_or_alias_def_id: def_id,
          impl_def_clause_index: index_,
          span,
        },
      }));
    }
    const clause = normalize_mod_b().normalize_with_depth_to(
      this,
      param_env,
      clone_ObligationCause(cause_),
      recursion_depth,
      clause_,
      obligations,
      fold_Clause,
    );
    obligations.push(new Obligation(cause_, param_env, clause.as_predicate(), recursion_depth));
    index++;
  }

  // Register any outlives obligations from the trait here, cc #124336.
  const dk = tcx.def_kind(def_id);
  if (dk.$ === "Impl" && dk.of_trait === true) {
    for (const clause_ of EarlyBinder.iter_instantiated(tcx.impl_super_outlives(def_id) as EarlyBinder<readonly Clause[]>, tcx, args, fold_Clause)) {
      const clause = normalize_mod_b().normalize_with_depth_to(
        this,
        param_env,
        clone_ObligationCause(cause),
        recursion_depth,
        clause_,
        obligations,
        fold_Clause,
      );
      obligations.push(new Obligation(clone_ObligationCause(cause), param_env, clause.as_predicate(), recursion_depth));
    }
  }

  return obligations;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2782 should_stall_coroutine
SelectionContext.prototype.should_stall_coroutine = function (this: SelectionContext, def_id: DefId): boolean {
  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Typeck": {
      const stalled_generators = typing_mode.defining_opaque_types_and_generators;
      const local = def_id.as_local();
      return local !== undefined && stalled_generators.includes(local);
    }
    case "PostAnalysis":
    case "Reflection":
    case "Codegen":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
      return false;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
    case "ErasedNotCoherence":
      // PORT: uninhabited (`TypingMode<CantBeErased>`); upstream has no arm.
      return typing_mode._0;
  }
};

// ==== end of lane old-select-b ==========================================================================================

unported_methods(SelectionContext.prototype, "rustc_trait_selection::traits::select::SelectionContext", [
  // mod.rs:223..1709 (lane old-select-a)
  "poly_select",
  "select",
  "select_from_obligation",
  "candidate_from_obligation",
  "candidate_from_obligation_no_cache",
  "evaluate_root_obligation",
  "evaluation_probe",
  "evaluate_predicates_recursively",
  "evaluate_predicate_recursively",
  "evaluate_trait_predicate_recursively",
  "check_evaluation_cycle",
  "evaluate_stack",
  "coinductive_match",
  "evaluate_candidate",
  "check_evaluation_cache",
  "insert_evaluation_cache",
  "check_recursion_depth",
  "check_recursion_limit",
  "in_task",
  "filter_impls",
  "can_use_global_caches",
  "check_candidate_cache",
  "can_cache_candidate",
  "insert_candidate_cache",
  "for_each_item_bound",
  "match_normalize_trait_ref",
  "where_clause_may_apply",
  "match_projection_projections",
]);

// ---- impl<'o, 'tcx> TraitObligationStack<'o, 'tcx> (mod.rs:2799) -------------------------------------------------------

declare module "./mod.gen.ts" {
  interface TraitObligationStack {
    list(): TraitObligationStackList;
    cache(): ProvisionalEvaluationCache;
    iter(): TraitObligationStackList;
    update_reached_depth(reached_depth: number): void;
  }
  interface ProvisionalEvaluationCache {
    next_dfn(): number;
    get_provisional(fresh_trait_pred: PolyTraitClause): ProvisionalEvaluation | undefined;
    insert_provisional(from_dfn: number, reached_depth: number, fresh_trait_pred: PolyTraitClause, result: EvaluationResult): void;
    on_failure(dfn: number): void;
    on_completion(dfn: number): void;
  }
  namespace ProvisionalEvaluationCache {
    function default_(): ProvisionalEvaluationCache;
    export { default_ as default };
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2800 list
TraitObligationStack.prototype.list = function (this: TraitObligationStack): TraitObligationStackList {
  return TraitObligationStackList.with(this);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2804 cache
TraitObligationStack.prototype.cache = function (this: TraitObligationStack): ProvisionalEvaluationCache {
  return this.previous.cache;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2808 iter
TraitObligationStack.prototype.iter = function (this: TraitObligationStack): TraitObligationStackList {
  return this.list();
};

/// Indicates that attempting to evaluate this stack entry
/// required accessing something from the stack at depth `reached_depth`.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2814 update_reached_depth
TraitObligationStack.prototype.update_reached_depth = function (this: TraitObligationStack, reached_depth: number): void {
  assert(
    this.depth >= reached_depth,
    `invoked \`update_reached_depth\` with something under this stack: self.depth=${this.depth} reached_depth=${reached_depth}`,
  );
  // debug!(reached_depth, "update_reached_depth");
  let p: TraitObligationStack = this;
  while (reached_depth < p.depth) {
    // debug!(?p.fresh_trait_pred, "update_reached_depth: marking as cycle participant");
    p.reached_depth = Math.min(p.reached_depth, reached_depth);
    p = p.previous.head_!;
  }
};

// ---- impl<'tcx> Default for ProvisionalEvaluationCache<'tcx> (mod.rs:2925) -----------------------------------------------

Object.assign(ProvisionalEvaluationCache, {
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2926 default
  default(): ProvisionalEvaluationCache {
    return new ProvisionalEvaluationCache(0, new KeyedMap<PolyTraitClause, ProvisionalEvaluation>(intern_key), []);
  },
});

// ---- impl<'tcx> ProvisionalEvaluationCache<'tcx> (mod.rs:2931) -------------------------------------------------------

/// Get the next DFN in sequence (basically a counter).
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2933 next_dfn
ProvisionalEvaluationCache.prototype.next_dfn = function (this: ProvisionalEvaluationCache): number {
  const result = this.dfn;
  this.dfn = result + 1;
  return result;
};

/// Check the provisional cache for any result for
/// `fresh_trait_pred`. If there is a hit, then you must consider
/// it an access to the stack slots at depth
/// `reached_depth` (from the returned value).
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2943 get_provisional
ProvisionalEvaluationCache.prototype.get_provisional = function (
  this: ProvisionalEvaluationCache,
  fresh_trait_pred: PolyTraitClause,
): ProvisionalEvaluation | undefined {
  // debug!(?fresh_trait_pred, "get_provisional = {:#?}", self.map.borrow().get(&fresh_trait_pred));
  const v = this.map.get(fresh_trait_pred);
  if (v === undefined) return undefined;
  // `Some(*v)`: `ProvisionalEvaluation` is `Copy`
  return { from_dfn: v.from_dfn, reached_depth: v.reached_depth, result: v.result };
};

/// Insert a provisional result into the cache. The result came
/// from the node with the given DFN. It accessed a minimum depth
/// of `reached_depth` to compute. It evaluated `fresh_trait_pred`
/// and resulted in `result`.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2959 insert_provisional
ProvisionalEvaluationCache.prototype.insert_provisional = function (
  this: ProvisionalEvaluationCache,
  from_dfn: number,
  reached_depth: number,
  fresh_trait_pred: PolyTraitClause,
  result: EvaluationResult,
): void {
  // debug!(?from_dfn, ?fresh_trait_pred, ?result, "insert_provisional");

  const map = this.map;

  // Subtle: when we complete working on the DFN `from_dfn`, anything
  // that remains in the provisional cache must be dependent on some older
  // stack entry than `from_dfn`. We have to update their depth with our transitive
  // depth in that case or else it would be referring to some popped note.
  //
  // Example:
  // A (reached depth 0)
  //   ...
  //      B // depth 1 -- reached depth = 0
  //          C // depth 2 -- reached depth = 1 (should be 0)
  //              B
  //          A // depth 0
  //   D (reached depth 1)
  //      C (cache -- reached depth = 2)
  for (const [_k, v] of map) {
    if (v.from_dfn >= from_dfn) {
      v.reached_depth = Math.min(reached_depth, v.reached_depth);
    }
  }

  map.set(fresh_trait_pred, { from_dfn, reached_depth, result });
};

/// Invoked when the node with dfn `dfn` does not get a successful
/// result. This will clear out any provisional cache entries
/// originating from nodes visited before this node (`from_dfn < dfn`).
/// This is because the provisional entries are things which must
/// assume that the things on the stack at the time of their creation
/// succeeded -- since the failing node is presently at the top of
/// the stack, these provisional entries must either depend on it or
/// some ancestor of it.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3001 on_failure
ProvisionalEvaluationCache.prototype.on_failure = function (this: ProvisionalEvaluationCache, dfn: number): void {
  // debug!(?dfn, "on_failure");
  for (const [key, evaluation] of [...this.map]) {
    if (evaluation.from_dfn < dfn) {
      // debug!("on_failure: removing {:?}", key);
      this.map.delete(key);
    }
  }
};

/// Invoked when the node at depth `depth` completed without
/// depending on anything higher in the stack (if that completion
/// was a failure, then `on_failure` should have been invoked
/// already).
///
/// Note that we may still have provisional cache items remaining
/// in the cache when this is done. For example, if there is a
/// cycle:
///
/// * A depends on...
///     * B depends on A
///     * C depends on...
///         * D depends on C
///     * ...
///
/// Then as we complete the C node we will have a provisional cache
/// with results for A, B, C, and D. This method would clear out
/// the C and D results, but leave A and B provisional.
///
/// This is determined based on the DFN: we remove any provisional
/// results created since `dfn` started (e.g., in our example, dfn
/// would be 2, representing the C node, and hence we would
/// remove the result for D, which has DFN 3, but not the results for
/// A and B, which have DFNs 0 and 1 respectively).
///
/// Note that we *do not* attempt to cache these cycle participants
/// in the evaluation cache. Doing so would require carefully computing
/// the correct `DepNode` to store in the cache entry:
/// cycle participants may implicitly depend on query results
/// related to other participants in the cycle, due to our logic
/// which examines the evaluation stack.
///
/// We used to try to perform this caching,
/// but it lead to multiple incremental compilation ICEs
/// (see #92987 and #96319), and was very hard to understand.
/// Fortunately, removing the caching didn't seem to
/// have a performance impact in practice.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3050 on_completion
ProvisionalEvaluationCache.prototype.on_completion = function (this: ProvisionalEvaluationCache, dfn: number): void {
  // debug!(?dfn, "on_completion");
  for (const [fresh_trait_pred, evaluation] of [...this.map]) {
    if (evaluation.from_dfn >= dfn) {
      // debug!(?fresh_trait_pred, ?eval, "on_completion");
      this.map.delete(fresh_trait_pred);
    }
  }
};

// ---- TraitObligationStackList (mod.rs:3063; hand class) ----------------------------------------------------------------

// rustc-type: compiler/rustc_trait_selection/src/traits/select/mod.rs:3063 TraitObligationStackList
export class TraitObligationStackList implements Iterable<TraitObligationStack> {
  constructor(
    public cache: ProvisionalEvaluationCache,
    /** PORT: the field `head` (the method `head()` has the name). */
    public head_: TraitObligationStack | undefined,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3069 empty
  static empty(cache: ProvisionalEvaluationCache): TraitObligationStackList {
    return new TraitObligationStackList(cache, undefined);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3073 with
  static with(r: TraitObligationStack): TraitObligationStackList {
    return new TraitObligationStackList(r.cache(), r);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3077 head
  head(): TraitObligationStack | undefined {
    return this.head_;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3081 depth
  depth(): number {
    const head = this.head_;
    if (head !== undefined) {
      return head.depth;
    } else {
      return 0;
    }
  }

  // ---- impl<'o, 'tcx> Iterator for TraitObligationStackList<'o, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3089 next
  next(): TraitObligationStack | undefined {
    const o = this.head_;
    if (o === undefined) return undefined;
    // `*self = o.previous`
    this.cache = o.previous.cache;
    this.head_ = o.previous.head_;
    return o;
  }

  /** PORT: iterates a copy (`for x in list` consumes a `Copy` value). */
  *[Symbol.iterator](): Iterator<TraitObligationStack> {
    const it = clone_TraitObligationStackList(this);
    for (let o = it.next(); o !== undefined; o = it.next()) yield o;
  }
}

/** `#[derive(Copy, Clone)]` of `TraitObligationStackList`. */
export function clone_TraitObligationStackList(v: TraitObligationStackList): TraitObligationStackList {
  return new TraitObligationStackList(v.cache, v.head_);
}

// ---- impl<'o, 'tcx> fmt::Debug for TraitObligationStack<'o, 'tcx> (mod.rs:3096) ---------------------------------------

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3097 fmt
export function debug_TraitObligationStack(self: TraitObligationStack, _f: Fmt): string {
  // PORT: `write!(f, ..)` formats `{:?}` with fresh (plain) flags.
  return `TraitObligationStack(${debug_Obligation(self.obligation, PLAIN, (p, f) => debug_Binder(p, f, debug_TraitClause))})`;
}
