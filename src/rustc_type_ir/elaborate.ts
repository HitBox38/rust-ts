// Port of compiler/rustc_type_ir/src/elaborate.rs (lane tyir-relate).
//
// PORT (D3/D4):
// - `I` is erased (`cx: TyCtxt`; `Interner` methods through `interner(cx)`, see relate.ts).
// - `trait Elaboratable<I>` is the descriptor `Elaboratable<O>` (the impl fns over `self: O`); a generic fn over
//   `O: Elaboratable<I>` takes it last (`d_O`), and `Elaborator` keeps it in its trailing field `d_O`.
// - `HashSet<..>` of interned values is a `KeyedSet` keyed by `intern_key` (D5); `elaborate_outlives_assumptions`
//   returns it in insertion order (D6: interned keys). `HashSet<I::TraitId>` is a `DefIdSet`.
// - `impl Iterator` types are classes with `next` / `size_hint` plus `[Symbol.iterator]` (rustc_hir pat_util.ts
//   precedent); `impl Iterator` returns built with adaptors are generators whose eager part runs first.
// - `smallvec![]` is `[]`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { type DefId, DefIdSet } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Binder } from "./binder.ts";
import type { TypeFoldable } from "./fold.ts";
import { SolverTraitLangItem } from "./lang_items.ts";
import { type Component, push_outlives_components } from "./outlives.ts";
import type { BoundConstness, OutlivesClause, TraitClause, TraitRef } from "./predicate.ts";
import { type ClauseKind, fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "./predicate_kind.ts";
import { Binder_rebind, interner } from "./relate.ts";
import type { Region } from "./sty/mod.ts";
import { AliasTy, Binder_map_bound, Binder_skip_binder } from "./ty_kind.ts";
import type { Unnormalized } from "./unnormalized.ts";

// ---- PORT stand-ins for fns of other files that are not ported yet -------------------------------------------------
// Not markers. Upstream bodies (all one-liners); root repoints them at the real ports.

/** PORT: stand-in for `EarlyBinder::iter_identity` (binder.rs:457, lane tyir-binder): `map(Unnormalized::new)`. */
function* EarlyBinder_iter_identity<T>(self: { value: Iterable<T> }): Generator<Unnormalized<T>> {
  for (const value of self.value) yield { value, _tcx: undefined };
}

/** PORT: stand-in for `Unnormalized::skip_norm_wip` (unnormalized.rs:71): the field read. */
function Unnormalized_skip_norm_wip<T>(self: Unnormalized<T>): T {
  return self.value;
}

/** PORT: stand-in for `TraitClause::def_id` (predicate.rs:218) / `HostEffectClause::def_id` (predicate.rs:684). */
function trait_ref_def_id(self: { trait_ref: TraitRef }): DefId {
  return self.trait_ref.def_id;
}

/** PORT: stand-in for `Binder<TraitClause>::def_id` (predicate.rs:228): `self.skip_binder().def_id()`. */
function PolyTraitClause_def_id(self: Binder<TraitClause>): DefId {
  // Ok to skip binder since trait `DefId` does not care about regions.
  return trait_ref_def_id(Binder_skip_binder(self));
}

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, Binder<ClauseKind>> for Clause` (rustc_middle ty/predicate.rs:491). */
function upcast_Binder_ClauseKind_Clause(from: Binder<ClauseKind>, tcx: TyCtxt): Clause {
  return tcx.mk_predicate(Binder_map_bound<ClauseKind, PredicateKind>(from, (clause) => ({ $: "Clause", _0: clause }))).expect_clause();
}

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, PolyTraitClause> for Predicate` (rustc_middle ty/predicate.rs:530). */
function upcast_PolyTraitClause_Predicate(from: Binder<TraitClause>, tcx: TyCtxt): Predicate {
  // `map_bound_no_validate_bound_vars` (binder.rs) maps the value and keeps the bound vars, like `map_bound` without
  // its debug-only validation.
  return tcx.mk_predicate(Binder_map_bound<TraitClause, PredicateKind>(from, (p) => ({ $: "Clause", _0: { $: "Trait", _0: p } })));
}

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, Binder<TraitRef>> for Clause` (rustc_middle ty/predicate.rs:510), through
 *  `impl UpcastFrom<I, Binder<TraitRef>> for Binder<TraitClause>` (predicate.rs:249) and
 *  `impl UpcastFrom<TyCtxt, PolyTraitClause> for Clause` (rustc_middle ty/predicate.rs:544). */
function upcast_PolyTraitRef_Clause(from: Binder<TraitRef>, tcx: TyCtxt): Clause {
  const pred: Binder<TraitClause> = Binder_map_bound(from, (trait_ref) => ({ trait_ref, polarity: "Positive" as const }));
  const p: Predicate = upcast_PolyTraitClause_Predicate(pred, tcx);
  return p.expect_clause();
}

/** PORT: stand-in for `Unnormalized<Binder<TraitRef>>::to_host_effect_clause` (unnormalized.rs:150, lane tyir-misc). */
function Unnormalized_to_host_effect_clause(self: Unnormalized<Binder<TraitRef>>, cx: TyCtxt, constness: BoundConstness): Unnormalized<Clause> {
  const inner = upcast_Binder_ClauseKind_Clause(
    Binder_map_bound<TraitRef, ClauseKind>(self.value, (trait_ref) => ({ $: "HostEffect", _0: { trait_ref, constness } })),
    cx,
  );
  return { value: inner, _tcx: undefined };
}

/** PORT: the `TypeFoldable` impl fns of `PredicateKind` (generated) as a D4 descriptor, for `anonymize_bound_vars`. */
const fold_PredicateKind: TypeFoldable<PredicateKind> = {
  visit_with: visit_with_PredicateKind,
  try_fold_with: try_fold_with_PredicateKind,
  fold_with: fold_with_PredicateKind,
};

// ---- elaborate.rs -------------------------------------------------------------------------------------------------

type Filter = "All" | "OnlySelf";
const Filter = { All: "All", OnlySelf: "OnlySelf" } as const;

// #[derive(Eq, PartialEq)]: `===`.
type ElaborateSized = "Yes" | "No";
const ElaborateSized = { Yes: "Yes", No: "No" } as const;

/// Describes how to elaborate an obligation into a sub-obligation.
// rustc-trait: compiler/rustc_type_ir/src/elaborate.rs:37 Elaboratable
export interface Elaboratable<O> {
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:38 predicate
  predicate(self: O): Predicate;

  // Makes a new `Self` but with a different clause that comes from elaboration.
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:41 child
  child(self: O, clause: Clause): O;

  // Makes a new `Self` but with a different clause and a different cause
  // code (if `Self` has one, such as [`PredicateObligation`]).
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:45 child_with_derived_cause
  child_with_derived_cause(self: O, clause: Clause, span: Span, parent_trait_pred: Binder<TraitClause>, index: number): O;
}

// rustc-type: compiler/rustc_type_ir/src/elaborate.rs:54 ClauseWithSupertraitSpan
export class ClauseWithSupertraitSpan {
  constructor(
    public clause: Clause,
    // Span of the supertrait predicate that lead to this clause.
    public supertrait_span: Span,
  ) {}

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:61 new
  static new(clause: Clause, span: Span): ClauseWithSupertraitSpan {
    return new ClauseWithSupertraitSpan(clause, span);
  }
}

/** `impl<I: Interner> Elaboratable<I> for ClauseWithSupertraitSpan<I>` */
export const Elaboratable_ClauseWithSupertraitSpan: Elaboratable<ClauseWithSupertraitSpan> = {
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:67 predicate
  predicate(self) {
    return self.clause.as_predicate();
  },

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:71 child
  child(self, clause) {
    return new ClauseWithSupertraitSpan(clause, self.supertrait_span);
  },

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:75 child_with_derived_cause
  child_with_derived_cause(_self, clause, supertrait_span, _parent_trait_pred, _index) {
    return new ClauseWithSupertraitSpan(clause, supertrait_span);
  },
};

/** PORT: stand-in for `impl Elaboratable<TyCtxt> for ty::Clause` (rustc_middle ty/elaborate_impl.rs:6). */
export const Elaboratable_Clause: Elaboratable<Clause> = {
  predicate(self) {
    return self.as_predicate();
  },
  child(_self, clause) {
    return clause;
  },
  child_with_derived_cause(_self, clause, _span, _parent_trait_pred, _index) {
    return clause;
  },
};

// rustc: compiler/rustc_type_ir/src/elaborate.rs:86 elaborate
export function elaborate<O>(cx: TyCtxt, obligations: Iterable<O>, d_O: Elaboratable<O>): Elaborator<O> {
  const elaborator = new Elaborator<O>(cx, [], new KeyedSet<Binder<PredicateKind>>(intern_key), Filter.All, ElaborateSized.No, d_O);
  elaborator.extend_deduped(obligations);
  return elaborator;
}

/// "Elaboration" is the process of identifying all the predicates that
/// are implied by a source predicate. Currently, this basically means
/// walking the "supertraits" and other similar assumptions. For example,
/// if we know that `T: Ord`, the elaborator would deduce that `T: PartialOrd`
/// holds as well. Similarly, if we have `trait Foo: 'static`, and we know that
/// `T: Foo`, then we know that `T: 'static`.
// rustc-type: compiler/rustc_type_ir/src/elaborate.rs:17 Elaborator
export class Elaborator<O> implements Iterable<O> {
  constructor(
    public cx: TyCtxt,
    public stack: O[],
    public visited: KeyedSet<Binder<PredicateKind>>,
    public mode: Filter,
    public elaborate_sized_: ElaborateSized,
    /** PORT (D4): the `O: Elaboratable<I>` impl. */
    public d_O: Elaboratable<O>,
  ) {}

  /// Adds `obligations` to the stack.
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:103 extend_deduped
  extend_deduped(obligations: Iterable<O>): void {
    // Only keep those bounds that we haven't already seen.
    // This is necessary to prevent infinite recursion in some
    // cases. One common case is when people define
    // `trait Sized: Sized { }` rather than `trait Sized { }`.
    for (const o of obligations) {
      const key = interner(this.cx).anonymize_bound_vars(this.d_O.predicate(o).kind(), fold_PredicateKind);
      const fresh = !this.visited.has(key);
      this.visited.add(key);
      if (fresh) this.stack.push(o);
    }
  }

  /// Filter to only the supertraits of trait predicates, i.e. only the predicates
  /// that have `Self` as their self type, instead of all implied predicates.
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:117 filter_only_self
  filter_only_self(): this {
    this.mode = Filter.OnlySelf;
    return this;
  }

  /// Start elaborating `Sized` - reqd during coherence checking, normally skipped to improve
  /// compiler performance.
  // PORT: the field is `elaborate_sized_` (this method needs the name).
  // rustc: compiler/rustc_type_ir/src/elaborate.rs:124 elaborate_sized
  elaborate_sized(): this {
    this.elaborate_sized_ = ElaborateSized.Yes;
    return this;
  }

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:129 elaborate
  elaborate(elaboratable: O): void {
    const cx = this.cx;
    const d = this.d_O;

    // We only elaborate clauses.
    const clause = d.predicate(elaboratable).as_clause();
    if (clause === undefined) {
      return;
    }

    // PERF(sized-hierarchy): To avoid iterating over sizedness supertraits in
    // parameter environments, as an optimisation, sizedness supertraits aren't
    // elaborated, so check if a `Sized` obligation is being elaborated to a
    // `MetaSized` obligation and emit it. Candidate assembly and confirmation
    // are modified to check for the `Sized` subtrait when a `MetaSized` obligation
    // is present.
    if (this.elaborate_sized_ === ElaborateSized.No) {
      const c = clause.as_trait_clause();
      if (c !== undefined) {
        const did = PolyTraitClause_def_id(c);
        if (interner(this.cx).is_trait_lang_item(did, SolverTraitLangItem.Sized)) {
          return;
        }
      }
    }

    const bound_clause = clause.kind();
    const k = Binder_skip_binder(bound_clause);
    switch (k.$) {
      case "Trait": {
        const data = k._0;
        // Negative trait bounds do not imply any supertrait bounds
        if (data.polarity !== "Positive") {
          return;
        }

        const map_to_child_clause = (index: number, [clause, span]: [Clause, Span]): O =>
          d.child_with_derived_cause(elaboratable, clause.instantiate_supertrait(cx, Binder_rebind(bound_clause, data.trait_ref)), span, Binder_rebind(bound_clause, data), index);

        // Get clauses implied by the trait, or only super clauses if we only care
        // about self clauses.
        switch (this.mode) {
          case "All": {
            const it = EarlyBinder_iter_identity(interner(cx).explicit_implied_clauses_of(trait_ref_def_id(data)));
            this.extend_deduped(
              (function* () {
                let index = 0;
                for (const u of it) yield map_to_child_clause(index++, Unnormalized_skip_norm_wip(u));
              })(),
            );
            break;
          }
          case "OnlySelf": {
            const it = EarlyBinder_iter_identity(interner(cx).explicit_super_clauses_of(trait_ref_def_id(data)));
            this.extend_deduped(
              (function* () {
                let index = 0;
                for (const u of it) yield map_to_child_clause(index++, Unnormalized_skip_norm_wip(u));
              })(),
            );
            break;
          }
        }
        break;
      }
      // `T: [const] Trait` implies `T: [const] Supertrait`.
      case "HostEffect": {
        const data = k._0;
        const it = EarlyBinder_iter_identity(interner(cx).ir_explicit_implied_const_bounds(trait_ref_def_id(data)));
        this.extend_deduped(
          (function* () {
            for (const trait_ref of it) {
              yield d.child(
                elaboratable,
                Unnormalized_skip_norm_wip(Unnormalized_to_host_effect_clause(trait_ref, cx, data.constness)).instantiate_supertrait(cx, Binder_rebind(bound_clause, data.trait_ref)),
              );
            }
          })(),
        );
        break;
      }
      case "TypeOutlives": {
        const [ty_max, r_min] = [k._0._0, k._0._1];
        // We know that `T: 'a` for some type `T`. We can
        // often elaborate this. For example, if we know that
        // `[U]: 'a`, that implies that `U: 'a`. Similarly, if
        // we know `&'a U: 'b`, then we know that `'a: 'b` and
        // `U: 'b`.
        //
        // We can basically ignore bound regions here. So for
        // example `for<'c> Foo<'a,'c>: 'b` can be elaborated to
        // `'a: 'b`.

        // Ignore `for<'a> T: 'a` -- we might in the future
        // consider this as evidence that `T: 'static`, but
        // I'm a bit wary of such constructions and so for now
        // I want to be conservative. --nmatsakis
        if (r_min.is_bound()) {
          return;
        }

        const components: Component[] = [];
        push_outlives_components(cx, ty_max, components);
        this.extend_deduped(
          (function* () {
            for (const component of components) {
              const clause = elaborate_component_to_clause(cx, component, r_min);
              if (clause === undefined) continue;
              yield d.child(elaboratable, upcast_Binder_ClauseKind_Clause(Binder_rebind(bound_clause, clause), cx));
            }
          })(),
        );
        break;
      }
      case "RegionOutlives":
        // Nothing to elaborate from `'a: 'b`.
        break;
      case "WellFormed":
        // Currently, we do not elaborate WF predicates,
        // although we easily could.
        break;
      case "Projection":
        // Nothing to elaborate in a projection predicate.
        break;
      case "ConstEvaluatable":
        // Currently, we do not elaborate const-evaluatable
        // predicates.
        break;
      case "ConstArgHasType":
        // Nothing to elaborate
        break;
      case "UnstableFeature":
        // Nothing to elaborate
        break;
    }
  }

  // ---- impl Iterator for Elaborator ----
  // type Item = O;

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:298 size_hint
  size_hint(): [number, number | undefined] {
    return [this.stack.length, undefined];
  }

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:302 next
  next(): O | undefined {
    // Extract next item from top-most stack frame, if any.
    const obligation = this.stack.pop();
    if (obligation !== undefined) {
      this.elaborate(obligation);
      return obligation;
    } else {
      return undefined;
    }
  }

  // PORT: lets `for (const o of elaborator)` drive `next` like a Rust `for` loop.
  *[Symbol.iterator](): Iterator<O> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }

  // ---- impl<I: Interner> Elaborator<I, I::Clause> ----

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:360 filter_to_traits
  filter_to_traits(this: Elaborator<Clause>): FilterToTraits {
    return new FilterToTraits(this);
  }
}

// rustc: compiler/rustc_type_ir/src/elaborate.rs:252 elaborate_component_to_clause
function elaborate_component_to_clause(cx: TyCtxt, component: Component, outlives_region: Region): ClauseKind | undefined {
  switch (component.$) {
    case "Region": {
      const r = component._0;
      if (r.is_bound()) {
        return undefined;
      } else {
        return { $: "RegionOutlives", _0: { _0: r, _1: outlives_region } };
      }
    }

    case "Param": {
      const ty = Ty.ir_new_param(cx, component._0);
      return { $: "TypeOutlives", _0: { _0: ty, _1: outlives_region } };
    }

    case "Placeholder": {
      const ty = Ty.new_placeholder(cx, component._0);
      return { $: "TypeOutlives", _0: { _0: ty, _1: outlives_region } };
    }

    case "UnresolvedInferenceVariable":
      return undefined;

    case "Alias": {
      // We might end up here if we have `Foo<<Bar as Baz>::Assoc>: 'a`.
      // With this, we can deduce that `<Bar as Baz>::Assoc: 'a`.
      return { $: "TypeOutlives", _0: { _0: AliasTy.to_ty(component._1, cx, component._0), _1: outlives_region } };
    }

    case "EscapingAlias":
      // We might be able to do more here, but we don't
      // want to deal with escaping vars right now.
      return undefined;
  }
}

///////////////////////////////////////////////////////////////////////////
// Supertrait iterator
///////////////////////////////////////////////////////////////////////////

/// Computes the def-ids of the transitive supertraits of `trait_def_id`. This (intentionally)
/// does not compute the full elaborated super-predicates but just the set of def-ids. It is used
/// to identify which traits may define a given associated type to help avoid cycle errors,
/// and to make size estimates for vtable layout computation.
///
/// rust-analyzer has a query for this, so don't use this function there.
// #[cfg(feature = "nightly")]: rustc builds rustc_type_ir with `nightly`.
// rustc: compiler/rustc_type_ir/src/elaborate.rs:324 supertrait_def_ids
export function supertrait_def_ids(cx: TyCtxt, trait_def_id: DefId): Iterable<DefId> {
  const set = new DefIdSet();
  const stack = [trait_def_id];

  set.add(trait_def_id);

  return (function* () {
    for (;;) {
      const trait_def_id = stack.pop();
      if (trait_def_id === undefined) return;

      for (const u of EarlyBinder_iter_identity(interner(cx).explicit_super_clauses_of(trait_def_id))) {
        const [clause, _] = Unnormalized_skip_norm_wip(u);
        const k = Binder_skip_binder(clause.kind());
        if (k.$ === "Trait") {
          const fresh = !set.has(trait_ref_def_id(k._0));
          set.add(trait_ref_def_id(k._0));
          if (fresh) {
            stack.push(trait_ref_def_id(k._0));
          }
        }
      }

      yield trait_def_id;
    }
  })();
}

// rustc: compiler/rustc_type_ir/src/elaborate.rs:352 supertraits
export function supertraits(cx: TyCtxt, trait_ref: Binder<TraitRef>): FilterToTraits {
  return elaborate(cx, [upcast_PolyTraitRef_Clause(trait_ref, cx)], Elaboratable_Clause).filter_only_self().filter_to_traits();
}

/// A filter around an iterator of predicates that makes it yield up
/// just trait references.
// PORT: `It: Iterator<Item = I::Clause>` is only ever `Elaborator<I, I::Clause>`; `_cx: PhantomData<I>` is erased.
// rustc-type: compiler/rustc_type_ir/src/elaborate.rs:367 FilterToTraits
export class FilterToTraits implements Iterable<Binder<TraitRef>> {
  constructor(public base_iterator: Elaborator<Clause>) {}

  // ---- impl Iterator for FilterToTraits ----
  // type Item = ty::Binder<I, ty::TraitRef<I>>;

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:375 next
  next(): Binder<TraitRef> | undefined {
    for (let pred = this.base_iterator.next(); pred !== undefined; pred = this.base_iterator.next()) {
      const data = pred.as_trait_clause();
      if (data !== undefined) {
        return Binder_map_bound(data, (t) => t.trait_ref);
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_type_ir/src/elaborate.rs:384 size_hint
  size_hint(): [number, number | undefined] {
    const [, upper] = this.base_iterator.size_hint();
    return [0, upper];
  }

  // PORT: lets `for (const t of it)` drive `next` like a Rust `for` loop.
  *[Symbol.iterator](): Iterator<Binder<TraitRef>> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

// rustc: compiler/rustc_type_ir/src/elaborate.rs:390 elaborate_outlives_assumptions
export function elaborate_outlives_assumptions(cx: TyCtxt, assumptions: Iterable<OutlivesClause<GenericArg>>): KeyedSet<OutlivesClause<GenericArg>> {
  const collected = new KeyedSet<OutlivesClause<GenericArg>>(intern_key);

  for (const { _0: arg1, _1: r2 } of assumptions) {
    collected.add({ _0: arg1, _1: r2 });
    const k = GenericArg.kind(arg1);
    switch (k.$) {
      // Elaborate the components of an type, since we may have substituted a
      // generic coroutine with a more specific type.
      case "Type": {
        const ty1 = k._0;
        const components: Component[] = [];
        push_outlives_components(cx, ty1, components);
        for (const c of components) {
          switch (c.$) {
            case "Region": {
              const r1 = c._0;
              if (!r1.is_bound()) {
                collected.add({ _0: GenericArg.from_Region(r1), _1: r2 });
              }
              break;
            }

            case "Param": {
              const ty = Ty.ir_new_param(cx, c._0);
              collected.add({ _0: GenericArg.from_Ty(ty), _1: r2 });
              break;
            }

            case "Placeholder": {
              const ty = Ty.new_placeholder(cx, c._0);
              collected.add({ _0: GenericArg.from_Ty(ty), _1: r2 });
              break;
            }

            case "Alias": {
              collected.add({ _0: GenericArg.from_Ty(AliasTy.to_ty(c._1, cx, c._0)), _1: r2 });
              break;
            }

            case "UnresolvedInferenceVariable":
            case "EscapingAlias":
              break;
          }
        }
        break;
      }
      // Nothing to elaborate for a region.
      case "Lifetime":
        break;
      // Consts don't really participate in outlives.
      case "Const":
        break;
    }
  }

  return collected;
}
