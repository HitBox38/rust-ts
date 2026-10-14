// Port of compiler/rustc_type_ir/src/region_constraint.rs (lane tyir-misc, sub-lane region-constraint). The types with
// their derived Debug / TypeVisitable / TypeFoldable impls are generated into region_constraint.gen.ts (set rustc_ty of
// tools/codegen/types.ts); this file holds the inherent methods, the manual Debug impls and the free fns, in upstream
// order.
//
//! The bulk of the logic for implementing `-Zassumptions-on-binders`
//
// PORT (D3): `I: Interner` is erased; `cx: I` is `TyCtxt` (`InferCtxtLike::cx`). `Infcx: InferCtxtLike` is the
// `InferCtxtLike` interface (infer_ctxt.ts).
// PORT: methods of the generated structs/enums (`Assumptions`, `LeafRegionConstraint`, `Or`, `And`,
// `RegionConstraint`) live on same-named companion consts taking `self` first (tyir-kind decision 1). The span
// parameter `S` (default `()`) is a TS type parameter; `()` is `null`. `S: Clone` clones are the value itself (spans
// are numbers, `()` is `null`).
// PORT: the derived `PartialEq`/`Hash` of `LeafRegionConstraint` (used through `without_span()` comparisons and the
// `IndexSet` of `And::new`) is the canonical intern key (rust_ts/intern_key.ts): two leaves get the same key exactly
// when they are `==` (interned `Region`/`Ty`/lists by identity, everything else by value).
// PORT: iterator-returning fns (`regions_outlived_by`, `regions_outliving`, `regions_outlived_by_placeholder`) return
// arrays; their adapters are side-effect free, so eager evaluation yields the same items in the same order.
// PORT: `#[instrument(level = "debug", ..)]` and `debug!` are tracing only (no output in the oracle build); they are
// kept as comments.
// PORT: fns of other files/lanes that are not ported yet are module-local stand-ins at the end of this file (each with a
// `// PORT: stand-in` comment).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TransitiveRelation as TransitiveRelationPending } from "../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { type Clause, fold_with_Clause, try_fold_with_Clause, visit_with_Clause } from "../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_with_Ty, type Ty, try_fold_with_Ty, visit_with_Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { type Debug, debug_str, debug_struct, debug_tuple, debug_vec, type Fmt, format_debug, PLAIN } from "../std/fmt.ts";
import { field_mut } from "../std/mut_ref.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { type Binder, type BoundRegion, type BoundVariableKind, debug_Binder, fold_with_Binder, try_fold_with_Binder, visit_with_Binder } from "./binder.ts";
import {
  type FallibleTypeFolder,
  fold_with_tuple2,
  type FoldWith,
  type PredicateProxy,
  try_fold_with_tuple2,
  type TryFoldWith,
  type TypeFoldable,
  type TypeFolder,
  TypeFolder_provided,
  type TypeVisitor,
  visit_with_tuple2,
  type VisitWith,
} from "./fold.ts";
import type { InferCtxtLike } from "./infer_ctxt.ts";
import { BoundVar, DebruijnIndex, UniverseIndex, type Variance } from "./lib.ts";
import { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "./macros.ts";
import { debug_OutlivesClause, fold_with_OutlivesClause, type OutlivesClause, try_fold_with_OutlivesClause, visit_with_OutlivesClause } from "./predicate.ts";
import * as gen from "./region_constraint.gen.ts";
import type { RelateResult, VarianceDiagInfo } from "./relate.ts";
import type { Const } from "./sty/consts.ts";
import { debug_Region, fold_with_Region, Region, try_fold_with_Region, visit_with_Region } from "./sty/mod.ts";
import { type AliasTy, debug_Alias, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "./ty/alias.ts";
import { AliasTy as AliasTyC, Binder_map_bound, Binder_skip_binder, debug_AliasTyKind, fold_with_AliasTyKind, try_fold_with_AliasTyKind, visit_with_AliasTyKind } from "./ty_kind.ts";
import type { Unnormalized } from "./unnormalized.ts";
import { max_universe } from "./universe.ts";

export * from "./region_constraint.gen.ts";

// Workaround for TransitiveRelation being in rustc_data_structures which isn't accessible on stable
// #[cfg(not(feature = "nightly"))]
// #[derive(Default, Clone, Debug)]
// pub struct TransitiveRelation<T>(T);
// PORT: the `#[cfg(not(feature = "nightly"))]` items (lines 15-49) are rust-analyzer's stand-ins; rustc builds
// rustc_type_ir with `feature = "nightly"`, so they are dead code here. They are ported as written under the names
// `TransitiveRelation_not_nightly` / `TransitiveRelationBuilder_not_nightly`, so that they do not shadow the real
// rustc_data_structures types this file uses.
// #[cfg(not(feature = "nightly"))]
export const TransitiveRelation_not_nightly = {
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:20 reachable_from
  reachable_from<T>(_self: unknown, _data: T): T[] {
    return unreachable("internal error: entered unreachable code: -Zassumptions-on-binders is not supported for r-a");
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:24 base_edges
  base_edges<T>(_self: unknown): Iterable<[T, T]> {
    return unreachable("internal error: entered unreachable code: -Zassumptions-on-binders is not supported for r-a");

    // #[allow(unreachable_code)]
    // [].into_iter()
  },
};
// #[derive(Clone, Debug)]
// #[cfg(not(feature = "nightly"))]
// pub struct TransitiveRelationBuilder<T>(T);
// #[cfg(not(feature = "nightly"))]
export const TransitiveRelationBuilder_not_nightly = {
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:36 freeze
  freeze(_self: unknown): never {
    return unreachable("internal error: entered unreachable code: -Zassumptions-on-binders is not supported for r-a");
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:40 add
  add<T>(_self: unknown, _a: T, _b: T): void {
    unreachable("internal error: entered unreachable code: -Zassumptions-on-binders is not supported for r-a");
  },

  // #[cfg(not(feature = "nightly"))]
  // impl<T> Default for TransitiveRelationBuilder<T>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:46 default
  default_(): never {
    return unreachable("internal error: entered unreachable code: -Zassumptions-on-binders is not supported for r-a");
  },
};

// ---- Assumptions ----------------------------------------------------------------------------------------------------

export type Assumptions = gen.Assumptions;

// rustc: compiler/rustc_type_ir/src/region_constraint.rs:75 fmt
export const debug_Assumptions: Debug<Assumptions> = (v, f) => {
  return debug_struct(f, "Assumptions", [
    ["type_outlives", debug_vec(v.type_outlives, f, (b, f) => debug_Binder(b, f, (oc, f) => debug_OutlivesClause(oc, f, debug_Ty)))],
    ["region_graph", debug_str("elided")],
  ]);
};

export const Assumptions = {
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:84 empty
  empty(): Assumptions {
    return {
      type_outlives: [],
      region_outlives: TransitiveRelationBuilder_freeze(TransitiveRelationBuilder_default<Region>()),
      inverse_region_outlives: TransitiveRelationBuilder_freeze(TransitiveRelationBuilder_default<Region>()),
    };
  },

  /// Builds assumptions from `clauses`, elaborating them and keeping the outlives ones.
  ///
  /// Callers hand us their clauses straight from the environment, so we have to elaborate
  /// here to get at the implied outlives bounds:
  /// - a `Ty: 'a` clause tells us that every region component of `Ty` outlives `'a`, e.g.
  ///   `&'b u8: 'a` implies `'b: 'a`. Without it we'd fail to prove `'b: 'a` when leaving
  ///   the binder these assumptions belong to.
  /// - it also gives us the components as type outlives, e.g. `Vec<T>: 'a` implies `T: 'a`,
  ///   which we need for placeholder and alias outlives.
  /// - trait clauses imply their supertraits, so `T: Bound<'a>` where `trait Bound<'c>: 'c`
  ///   gives us `T: 'a`. This is why we take clauses rather than just the outlives ones:
  ///   filtering down to outlives before elaborating would throw those away.
  ///
  /// Only the clauses whose max universe is exactly `universe` are kept, which is what the
  /// solver wants when computing the assumptions of a single binder. This happens after
  /// elaboration on purpose, so a clause whose regions live in more than one universe still
  /// contributes its implied bounds to each of them: `(&'b u8, &'c u8): 'a` gives us
  /// `'c: 'a` in `'c`s universe even though the clause itself is in `'b`s.
  ///
  /// Use [`Assumptions::new_unelaborated`] when the caller needs the assumptions to be
  /// exactly the clauses it passed in.
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:113 new
  new(infcx: InferCtxtLike, clauses: Iterable<Clause>, region_outlives: TransitiveRelation<Region>, universe: UniverseIndex): Assumptions {
    const type_outlives: Binder<OutlivesClause<Ty>>[] = [];
    const region_outlives_builder = TransitiveRelationBuilder_default<Region>();
    for (const [r1, r2] of TransitiveRelation_base_edges(region_outlives)) {
      TransitiveRelationBuilder_add(region_outlives_builder, r1, r2);
    }

    const clauses_ = elaborate(infcx.cx(), clauses).filter((clause) => max_universe(infcx, clause, fold_Clause_) === universe);
    for (const clause of clauses_) {
      const k = Binder_skip_binder(clause.kind());
      switch (k.$) {
        // The type outlives assumptions are kept around as they are required for
        // proving placeholder and alias outlives.
        case "TypeOutlives": {
          type_outlives.push(unwrap(clause.as_type_outlives_clause()));
          break;
        }
        case "RegionOutlives": {
          const r1 = k._0._0;
          const r2 = k._0._1;
          // `elaborate` drops the components which are bound inside of the type and
          // bails on `for<'a> Ty: 'a`, so both regions here are free even though the
          // clause itself may still be under a binder.
          // debug_assert!(!r1.is_bound() && !r2.is_bound());
          TransitiveRelationBuilder_add(region_outlives_builder, r1, r2);
          break;
        }
        // Anything else can't be used as an outlives assumption.
        default:
          break;
      }
    }

    return Assumptions.new_unelaborated(type_outlives, TransitiveRelationBuilder_freeze(region_outlives_builder));
  },

  /// Builds assumptions from exactly the given clauses, see [`Assumptions::new`] for when
  /// the clauses should get elaborated instead.
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:151 new_unelaborated
  new_unelaborated(type_outlives: Binder<OutlivesClause<Ty>>[], region_outlives: TransitiveRelation<Region>): Assumptions {
    return {
      inverse_region_outlives: (() => {
        const builder = TransitiveRelationBuilder_default<Region>();
        for (const [r1, r2] of TransitiveRelation_base_edges(region_outlives)) {
          TransitiveRelationBuilder_add(builder, r2, r1);
        }
        return TransitiveRelationBuilder_freeze(builder);
      })(),
      type_outlives,
      region_outlives,
    };
  },
};

// ---- LeafRegionConstraint -------------------------------------------------------------------------------------------

export type LeafRegionConstraint<S = null> = gen.LeafRegionConstraint<S>;

// rustc: compiler/rustc_type_ir/src/region_constraint.rs:198 fmt
export function debug_LeafRegionConstraint<S>(v: LeafRegionConstraint<S>, f: Fmt, _debug_S: Debug<S>): string {
  switch (v.$) {
    case "Ambiguity":
      return "Ambiguity";
    case "RegionOutlives": {
      const r1 = v._0;
      const r2 = v._1;
      return debug_tuple(f, "RegionOutlives", [debug_Region(r1, f), debug_Region(r2, f)]);
    }
    case "AliasTyOutlivesViaEnv": {
      const bound_outlives = v._0;
      return debug_tuple(f, "AliasTyOutlivesViaEnv", [debug_Binder(bound_outlives, f, debug_AliasTy_Region)]);
    }
    case "PlaceholderTyOutlives": {
      const ty = v._0;
      const r = v._1;
      return debug_tuple(f, "PlaceholderTyOutlives", [debug_Ty(ty, f), debug_Region(r, f)]);
    }
  }
}

/** `<(AliasTy<I>, Region<I>) as Debug>::fmt` (the std tuple impl). */
function debug_AliasTy_Region(v: [AliasTy, Region], f: Fmt): string {
  return debug_tuple(f, "", [debug_Alias(v[0], f, debug_AliasTyKind), debug_Region(v[1], f)]);
}

export const LeafRegionConstraint = {
  // impl<I: Interner> LeafRegionConstraint<I>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:215 with_span
  with_span<S>(self: LeafRegionConstraint, span: S): LeafRegionConstraint<S> {
    switch (self.$) {
      case "Ambiguity":
        return { $: "Ambiguity", _0: span };
      case "RegionOutlives":
        return { $: "RegionOutlives", _0: self._0, _1: self._1, _2: span };
      case "AliasTyOutlivesViaEnv":
        return { $: "AliasTyOutlivesViaEnv", _0: self._0, _1: span };
      case "PlaceholderTyOutlives":
        return { $: "PlaceholderTyOutlives", _0: self._0, _1: self._1, _2: span };
    }
  },

  // impl<I: Interner, S: Clone + Debug + Eq + Hash> LeafRegionConstraint<I, S>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:233 without_span
  without_span<S>(self: LeafRegionConstraint<S>): LeafRegionConstraint {
    switch (self.$) {
      case "Ambiguity":
        return { $: "Ambiguity", _0: null };
      case "RegionOutlives":
        return { $: "RegionOutlives", _0: self._0, _1: self._1, _2: null };
      case "AliasTyOutlivesViaEnv":
        return { $: "AliasTyOutlivesViaEnv", _0: self._0, _1: null };
      case "PlaceholderTyOutlives":
        return { $: "PlaceholderTyOutlives", _0: self._0, _1: self._1, _2: null };
    }
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:244 span
  span<S>(self: LeafRegionConstraint<S>): S {
    let s: S;
    switch (self.$) {
      case "Ambiguity":
        s = self._0;
        break;
      case "RegionOutlives":
        s = self._2;
        break;
      case "AliasTyOutlivesViaEnv":
        s = self._1;
        break;
      case "PlaceholderTyOutlives":
        s = self._2;
        break;
    }
    return s;
  },

  // PORT: from the later `impl<I: Interner, S: Clone + Debug> LeafRegionConstraint<I, S>` block (PORTING §8: the
  // companion holds every method; the marker keeps the upstream line).
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:542 is_ambig
  is_ambig<S>(self: LeafRegionConstraint<S>): boolean {
    return self.$ === "Ambiguity";
  },
};

/** PORT: `c1.clone().without_span() == c2.clone().without_span()` (derived `PartialEq`, file header). */
function eq_without_span<S>(c1: LeafRegionConstraint<S>, c2: LeafRegionConstraint<S>): boolean {
  return intern_key(LeafRegionConstraint.without_span(c1)) === intern_key(LeafRegionConstraint.without_span(c2));
}

// ---- Or -------------------------------------------------------------------------------------------------------------

export type Or<S = null> = gen.Or<S>;

export const Or = {
  // impl<I: Interner> Or<I>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:270 with_spans
  with_spans<S>(self: Or, span: S): Or<S> {
    return { _0: self._0.map((and) => And.with_spans(and, span)) };
  },

  // impl<I: Interner, S: Clone + Hash + Debug + Eq> Or<I, S>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:278 new_true
  new_true<S = null>(): Or<S> {
    return { _0: [And.new_true<S>()] };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:282 is_true
  is_true<S>(self: Or<S>): boolean {
    // OR([AND([])])
    if (self._0.length === 1 && self._0[0]!._0.length === 0) {
      return true;
    } else {
      return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:293 new_false
  new_false<S = null>(): Or<S> {
    return { _0: [] };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:297 is_false
  is_false<S>(self: Or<S>): boolean {
    // OR([])
    return self._0.length === 0;
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:302 new
  new<S>(i: Iterable<And<S>>): Or<S> {
    const ands = [...i];
    const new_ands: And<S>[] = [];

    for (const and of ands) {
      // An empty AND is trivially true, which makes the whole OR true no matter what the
      // other candidates are. `And::new` discards leaf constraints which are trivially
      // true, so this is how e.g. a reflexive `'a: 'a` candidate discharges an OR.
      if (and._0.length === 0) {
        return Or.new_true<S>();
      }

      // FIXME(-Zassumptions-on-binders): We only discard an AND which is equivalent to one
      // we already have. More generally we should discard any AND which is a superset of
      // another, as it requires strictly more to hold. E.g. the second AND in
      // `OR(AND('a: 'b), AND('a: 'b, 'b: 'c))` is never the one which makes the OR true.
      if (new_ands.every((c) => !And.is_and_equivalent_to(c, and))) {
        new_ands.push(and);
      }
    }

    return { _0: new_ands };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:326 new_ambig
  new_ambig<S>(s: S): Or<S> {
    return Or.new_leaf<S>({ $: "Ambiguity", _0: s });
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:330 new_leaf
  new_leaf<S>(l: LeafRegionConstraint<S>): Or<S> {
    return Or.new([And.new([l])]);
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:334 build_and
  build_and<S>(a: Or<S>, b: Or<S>): Or<S> {
    // FIXME(-Zassumptions-on-binders): probably bad for perf, doing a lot of reallocating
    // and whatnot here :3

    // Important: keeps `ands` empty if either `b_and` or `a_and` is empty
    const ands: And<S>[] = [];
    for (const b_and of b._0) {
      for (const a_and of a._0.slice()) {
        ands.push(And.new([...a_and._0, ...b_and._0]));
      }
    }

    return Or.new(ands);
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:349 build_or
  build_or<S>(a: Or<S>, b: Or<S>): Or<S> {
    return Or.new([...a._0, ...b._0]);
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:353 without_spans
  without_spans<S>(self: Or<S>): Or {
    return { _0: self._0.map((and) => And.without_spans(and)) };
  },
};

// ---- And ------------------------------------------------------------------------------------------------------------

export type And<S = null> = gen.And<S>;

export const And = {
  // impl<I: Interner> And<I>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:366 with_spans
  with_spans<S>(self: And, span: S): And<S> {
    return { _0: self._0.map((leaf) => LeafRegionConstraint.with_span(leaf, span)) };
  },

  // impl<I: Interner, S: Clone + Hash + Debug + Eq> And<I, S>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:374 new_true
  new_true<S = null>(): And<S> {
    return { _0: [] };
  },

  // PORT: `IndexSet<LeafRegionConstraint<I>>` is a `Set` of intern keys (file header); only membership is used.
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:378 new
  new<S>(i: Iterable<LeafRegionConstraint<S>>): And<S> {
    const seen = new Set<string>();
    return {
      _0: [...i].filter((leaf) => {
        // Outlives is reflexive so a `'a: 'a` leaf is always true and carries no
        // information. Dropping it here keeps the rest of the code from having to special
        // case it, and is what lets an OR with a reflexive candidate be recognized as true.
        if (leaf.$ === "RegionOutlives" && leaf._0 === leaf._1) {
          return false;
        }

        if (seen.has(intern_key(LeafRegionConstraint.without_span(leaf)))) {
          return false;
        } else {
          seen.add(intern_key(LeafRegionConstraint.without_span(leaf)));
          return true;
        }
      }),
    };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:402 is_and_equivalent_to
  is_and_equivalent_to<S>(self: And<S>, other: And<S>): boolean {
    const this_ = self._0.slice();
    const other_ = other._0.slice();

    return this_.every((c1) => other_.some((c2) => eq_without_span(c1, c2))) && other_.every((c2) => this_.some((c1) => eq_without_span(c1, c2)));
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:413 without_spans
  without_spans<S>(self: And<S>): And {
    return { _0: self._0.map((leaf) => LeafRegionConstraint.without_span(leaf)) };
  },
};

// ---- RegionConstraint -----------------------------------------------------------------------------------------------

export type RegionConstraint<S = null> = gen.RegionConstraint<S>;

export const RegionConstraint = {
  // impl<I: Interner> RegionConstraint<I>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:436 with_spans
  with_spans<S>(self: RegionConstraint, span: S): RegionConstraint<S> {
    return {
      and_constraint: And.with_spans(self.and_constraint, span),
      or_constraint: Or.with_spans(self.or_constraint, span),
    };
  },

  // impl<I: Interner, S: Clone + Debug + Eq + Hash> RegionConstraint<I, S>
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:447 new_from_or
  new_from_or<S>(or: Or<S>): RegionConstraint<S> {
    const fst = or._0[0];
    if (fst === undefined) {
      return RegionConstraint.new_false<S>();
    }
    let and_constraint = fst._0.slice();

    for (const and of or._0.slice(1)) {
      and_constraint = and_constraint.filter((c) => and._0.some((c2) => eq_without_span(c, c2)));
    }
    const and_constraint_ = And.new(and_constraint);

    const or_constraint = Or.new(or._0.map((and) => And.new(and._0.filter((c) => and_constraint_._0.every((s_c) => !eq_without_span(c, s_c))))));

    return {
      and_constraint: Or.is_false(or_constraint) ? And.new_true<S>() : and_constraint_,
      or_constraint,
    };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:475 splatted_and_constraints
  splatted_and_constraints<S>(self: RegionConstraint<S>): Or<S> {
    return Or.new(self.or_constraint._0.map((and) => And.new([...and._0, ...self.and_constraint._0])));
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:481 build_and
  build_and<S>(a: RegionConstraint<S>, b: RegionConstraint<S>): RegionConstraint<S> {
    const and_constraint = And.new([...a.and_constraint._0, ...b.and_constraint._0]);
    const or_constraint = Or.build_and(a.or_constraint, b.or_constraint);

    return {
      and_constraint: Or.is_false(or_constraint) ? And.new_true<S>() : and_constraint,
      or_constraint,
    };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:491 build_or
  build_or<S>(a: RegionConstraint<S>, b: RegionConstraint<S>): RegionConstraint<S> {
    return RegionConstraint.new_from_or(Or.build_or(RegionConstraint.splatted_and_constraints(a), RegionConstraint.splatted_and_constraints(b)));
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:495 new_true
  new_true<S = null>(): RegionConstraint<S> {
    return { and_constraint: And.new_true<S>(), or_constraint: Or.new_true<S>() };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:499 is_true
  is_true<S>(self: RegionConstraint<S>): boolean {
    return self.and_constraint._0.length === 0 && Or.is_true(self.or_constraint);
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:503 new_false
  new_false<S = null>(): RegionConstraint<S> {
    return { and_constraint: And.new_true<S>(), or_constraint: Or.new_false<S>() };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:507 is_false
  is_false<S>(self: RegionConstraint<S>): boolean {
    return Or.is_false(self.or_constraint);
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:511 new_ambig
  new_ambig<S>(span: S): RegionConstraint<S> {
    return {
      and_constraint: And.new<S>([{ $: "Ambiguity", _0: span }]),
      or_constraint: Or.new_true<S>(),
    };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:518 is_ambig
  is_ambig<S>(self: RegionConstraint<S>): boolean {
    const and = self.and_constraint._0;
    if (and.length === 1 && LeafRegionConstraint.is_ambig(and[0]!) && Or.is_true(self.or_constraint)) {
      return true;
    } else {
      return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:529 without_spans
  without_spans<S>(self: RegionConstraint<S>): RegionConstraint {
    return {
      and_constraint: And.without_spans(self.and_constraint),
      or_constraint: Or.without_spans(self.or_constraint),
    };
  },

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:536 new_leaf
  new_leaf<S>(l: LeafRegionConstraint<S>): RegionConstraint<S> {
    return { and_constraint: And.new([l]), or_constraint: Or.new_true<S>() };
  },
};

// (`impl LeafRegionConstraint { fn is_ambig }` (:541) is on the `LeafRegionConstraint` companion above.)

// ---- eager placeholder handling -------------------------------------------------------------------------------------

/// Takes any constraints involving placeholders from the current universe and eagerly checks them.
/// This can be done a few ways:
/// - There's an assumption on the binder introducing the placeholder which means the constraint is satisfied (true)
/// - There's assumptions on the binder introducing the placeholder which allow us to rewrite the constraint in
///    terms of lower universe variables. For example given `for<'a> where('b: 'a) { prove(T: '!a_u1) }` we can
///    convert this constraint to `T: 'b` which no longer references anything from `u1`.
/// - There are no relevant assumptions so we can neither rewrite the constraint nor consider it satisfied (false)
/// - We failed to compute the full set of assumptions when entering the binder corresponding to `u`. (ambiguity)
///
/// After handling all of the region constraints in `u` we then evaluate the entire constraint as much as possible,
/// propagating true/false/ambiguity as close to the root of the constraint as we can. The returned constraint should
/// be checked for whether it is true/false/ambiguous as that should affect the result of whatever operation required
/// entering the binder corresponding to `u`.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:561 eagerly_handle_placeholders_in_universe
export function eagerly_handle_placeholders_in_universe(infcx: InferCtxtLike, constraint: RegionConstraint, u: UniverseIndex): RegionConstraint {
  assert(u > UniverseIndex.ROOT, "eagerly handle placeholders called for root universe");

  const assumptions = infcx.get_placeholder_assumptions(u);

  // 1. rewrite type outlives constraints involving things from `u` into either region constraints
  //     involving things from `u` or type outlives constraints not involving things from `u`
  //
  //    IOW, we only want to encounter things from `u` as part of region out lives constraints.
  const constraint_1 = rewrite_type_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx, constraint, u, assumptions);

  // 2. compute transitive region outlives and get a new set of region outlives constraints by
  //     looking for every region which either a placeholder_u flows into it, or it flows into
  //     the placeholder.
  const constraint_2 = compute_new_region_constraints(infcx, constraint_1, u);

  // 3. rewrite region outlives constraints (potentially to false/true)
  const constraint_3 = pull_region_outlives_constraints_out_of_universe(infcx, constraint_2, u, assumptions);

  return constraint_3;
}

/// Filter our region constraints to not include constraints between region variables from `u` and
/// other regions as those are always satisfied. This requires some care to handle correctly for example:
/// `'!a_u1: '?x_u1: '!b_u1` should result in us requiring `'!a_u1: '!b_u1` rather than dropping the two
/// constraints entirely.
///
/// The only constraints involving things from `u` should be region outlives constraints at this point. Type
/// outlives constraints should have been handled already either by destructuring into region outlives or by
/// being rewritten in terms of smaller universe variables.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:602 compute_new_region_constraints
function compute_new_region_constraints(infcx: InferCtxtLike, constraint: RegionConstraint, u: UniverseIndex): RegionConstraint {
  // PORT: `regions: &mut IndexSet<Region>` is an insertion-ordered `Set` (interned `Region`s compare by identity).
  const extend_from_and = (builder: TransitiveRelationBuilder<Region>, regions: Set<Region>, constraints: LeafRegionConstraint[], and: And): void => {
    for (const c of and._0) {
      switch (c.$) {
        case "Ambiguity":
        case "PlaceholderTyOutlives":
        case "AliasTyOutlivesViaEnv":
          constraints.push(c);
          break;
        case "RegionOutlives": {
          const r1 = c._0;
          const r2 = c._1;
          regions.add(r1);
          regions.add(r2);
          TransitiveRelationBuilder_add(builder, r2, r1);
          break;
        }
      }
    }
  };

  const base_region_flows_builder = TransitiveRelationBuilder_default<Region>();
  const base_regions = new Set<Region>();
  const base_constraints: LeafRegionConstraint[] = [];
  extend_from_and(base_region_flows_builder, base_regions, base_constraints, constraint.and_constraint);

  const new_ands: Or[] = [];
  for (const and of constraint.or_constraint._0) {
    const region_flows_builder = TransitiveRelationBuilder_clone(base_region_flows_builder);
    const regions = new Set(base_regions);
    const constraints = base_constraints.slice();
    extend_from_and(region_flows_builder, regions, constraints, and);

    const region_flow = TransitiveRelationBuilder_freeze(region_flows_builder);
    for (const r of regions) {
      for (const ub of TransitiveRelation_reachable_from(region_flow, r)) {
        // we want to retain any region constraints between two "placeholder-likes" where for our
        // purposes a placeholder-like is either a placeholder or variable in a lower universe
        const is_placeholder_like = (r: Region): boolean => {
          const k = r.kind();
          switch (k.$) {
            case "ReLateParam":
            case "ReEarlyParam":
            case "RePlaceholder":
            case "ReStatic":
              return true;
            case "ReVar":
              return max_universe(infcx, r, fold_Region_) < u;
            case "ReError":
              return false;
            case "ReErased":
            case "ReBound":
              return unreachable();
          }
        };

        if (is_placeholder_like(r) && is_placeholder_like(ub)) {
          constraints.push({ $: "RegionOutlives", _0: ub, _1: r, _2: null });
        }
      }
    }

    new_ands.push(Or.new([And.new(constraints)]));
  }

  // FIXME(-Zassumptions-on-binders): probably bad for perf!
  return RegionConstraint.new_from_or(new_ands.reduce((acc, c) => Or.build_or(acc, c), Or.new_false()));
}

/// Handles converting region outlives constraints involving placeholders from `u` into OR constraints
/// involving regions from smaller universes with known relationships to the placeholder. For example:
/// ```ignore (not rust)
/// for<'a, 'b> where(
///     'c: 'b, 'd: 'b,
///     'a: 'e, 'a: 'f,
/// ) {
///     'a_u1: 'b_u1
/// }
/// ```
/// will get converted to:
/// ```ignore (not rust)
/// OR(
///     'e: 'c,
///     'e: 'd,
///     'f: 'c,
///     'f: 'd,
/// )
/// ```
/// if we are handling constraints in `u1`.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:695 pull_region_outlives_constraints_out_of_universe
function pull_region_outlives_constraints_out_of_universe(infcx: InferCtxtLike, constraint: RegionConstraint, u: UniverseIndex, assumptions: Assumptions): RegionConstraint {
  assert(max_universe(infcx, constraint, fold_RegionConstraint_unit) <= u, "assertion failed: max_universe(infcx, constraint.clone()) <= u");

  // FIXME(-Zassumptions-on-binders): we don't lower universes of region variables when exiting `u`
  // this seems dubious/potentially wrong? we can't just blindly do this though as if we had something
  // like `!T_u -> ?x_u -> !U_u` then lowering `?x` to `u-1` when exiting `u` would be wrong.
  //
  // I'm not even sure this would be necessary given we filter out region constraints involving regions#
  // from the current universe and only retain those between placeholders.

  const pull_and = (and: And): Or => {
    const pulled_constraints: Or[] = [];
    for (const c of and._0) {
      switch (c.$) {
        case "Ambiguity":
        case "PlaceholderTyOutlives":
        case "AliasTyOutlivesViaEnv": {
          assert(max_universe(infcx, c, fold_LeafRegionConstraint_unit) < u, "assertion failed: max_universe(infcx, c.clone()) < u");
          pulled_constraints.push(Or.new_leaf(c));
          break;
        }
        case "RegionOutlives": {
          const region_1 = c._0;
          const region_2 = c._1;
          const region_1_u = max_universe(infcx, region_1, fold_Region_);
          const region_2_u = max_universe(infcx, region_2, fold_Region_);

          if (region_1_u !== u && region_2_u !== u) {
            pulled_constraints.push(Or.new_leaf(c));
            continue;
          }

          // The constraint may already be entailed by the assumptions of the binder we are
          // leaving, e.g. `for<'a, 'b> where 'b: 'a { 'b: 'a }`. There is nothing to lift into
          // a smaller universe in that case, and looking for lower universe candidates would
          // wrongly result in `Or([])` whenever the placeholders have no lower universe bounds.
          if (regions_outlived_by(region_1, assumptions).some((r) => r === region_2)) {
            continue;
          }

          const candidates: LeafRegionConstraint[] = [];

          for (const ub of regions_outlived_by(region_1, assumptions).filter((r) => max_universe(infcx, r, fold_Region_) < u)) {
            // FIXME(-Zassumptions-on-binders): if `region_2` is in a smaller universe there'll be both
            // `'region_2` and `'static` as lower bounds which seems... unfortunate and may cause us to
            // add a bunch of duplicate `'ub: 'static` candidates the more binders we leave.
            for (const lb of regions_outliving(region_2, assumptions, infcx.cx()).filter((r) => max_universe(infcx, r, fold_Region_) < u)) {
              // As long as any region outlived by `region_1` outlives any region region which
              // `region_2` outlives, we know that `region_1: region_2` holds. In other words,
              // there exists some set of 4 regions for which `'r1: 'i1` `'i1: 'i2` `'i2: 'r2`
              candidates.push({ $: "RegionOutlives", _0: ub, _1: lb, _2: null });
            }
          }

          pulled_constraints.push(Or.new(candidates.map((c) => And.new([c]))));
          break;
        }
      }
    }

    return pulled_constraints.reduce((acc, c) => Or.build_and(acc, c), Or.new_true());
  };

  const and_constraint = pull_and(constraint.and_constraint);
  const or_constraint = constraint.or_constraint._0.reduce((acc, c) => Or.build_or(acc, pull_and(c)), Or.new_false());
  return RegionConstraint.new_from_or(Or.build_and(and_constraint, or_constraint));
}

/// Converts type outlives constraints into region outlives constraints. This assumes the *complete* set of
/// assumptions are known. This should not be called until the end of type checking.
///
/// The returned region constraint will not have *any* PlaceholderTyOutlives or AliasTyOutlivesViaEnv constraints.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:780 destructure_type_outlives_constraints_in_root
export function destructure_type_outlives_constraints_in_root<S>(infcx: InferCtxtLike, constraint: RegionConstraint<S>, assumptions: Assumptions): RegionConstraint<S> {
  const destructure_and = (and: And<S>): Or<S> => {
    // debug!("rewriting and: {:?}", and);
    const destructured_constraints: Or<S>[] = [];
    for (const c of and._0) {
      switch (c.$) {
        case "Ambiguity":
        case "RegionOutlives":
          destructured_constraints.push(Or.new_leaf(c));
          break;
        case "PlaceholderTyOutlives": {
          const ty = c._0;
          const r = c._1;
          const span = c._2;
          destructured_constraints.push(
            Or.new(regions_outlived_by_placeholder(ty, assumptions, infcx.cx()).map((assumption_r) => And.new<S>([{ $: "RegionOutlives", _0: assumption_r, _1: r, _2: span }]))),
          );
          break;
        }
        case "AliasTyOutlivesViaEnv": {
          const bound_outlives = c._0;
          const span = c._1;
          destructured_constraints.push(Or.with_spans(alias_outlives_candidates_from_assumptions(infcx, bound_outlives, assumptions), span));
          break;
        }
      }
    }
    // debug!(?destructured_constraints);
    const merged_constraints = destructured_constraints.reduce((acc, c) => Or.build_and(acc, c), Or.new_true<S>());
    // debug!(?merged_constraints);
    return merged_constraints;
  };

  const and_constraint = destructure_and(constraint.and_constraint);
  const or_constraint = constraint.or_constraint._0.reduce((acc, c) => Or.build_or(acc, destructure_and(c)), Or.new_false<S>());

  return RegionConstraint.new_from_or(Or.build_and(and_constraint, or_constraint));
}

/// Converts type outlives constraints into either region outlives constraints, or type outlives
/// constraints which do not contain anything from `u`.
///
/// This only works off assumptions associated with the binder corresponding to `u` both for
/// perf reasons and because the full set of region assumptions is not known during type checking
/// due to closure signature inference.
///
/// This only really causes problems for higher-ranked outlives assumptions, for example if we have
/// `where for<'a> <T as Trait<'a>>::Assoc: 'b` then we can't use that to prove `<T as Trait<'!c>>::Assoc: 'b`
/// until we are in the root context. See comments inside this function for more detail.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:847 rewrite_type_outlives_constraints_in_universe_for_eager_placeholder_handling
function rewrite_type_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx: InferCtxtLike, constraint: RegionConstraint, u: UniverseIndex, assumptions: Assumptions): RegionConstraint {
  // PORT: `assert!(cond, fmt, args)` formats its message only when the assertion fails.
  if (!(max_universe(infcx, constraint, fold_RegionConstraint_unit) <= u)) {
    panic(`constraint ${format_debug(constraint, debug_RegionConstraint_unit, PLAIN)} contains terms from a larger universe than ${format_debug(u, UniverseIndex.debug, PLAIN)}`);
  }

  const rewrite_and = (and: And): Or => {
    const rewritten_constraints: Or[] = [];
    for (const c of and._0) {
      switch (c.$) {
        case "Ambiguity":
        case "RegionOutlives":
          rewritten_constraints.push(Or.new_leaf(c));
          break;
        case "PlaceholderTyOutlives": {
          const ty = c._0;
          const region = c._1;
          rewritten_constraints.push(rewrite_placeholder_ty_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx, ty, region, u, assumptions));
          break;
        }
        case "AliasTyOutlivesViaEnv": {
          const bound_outlives = c._0;
          rewritten_constraints.push(rewrite_alias_ty_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx, bound_outlives, u, assumptions));
          break;
        }
      }
    }
    return rewritten_constraints.reduce((acc, c) => Or.build_and(acc, c), Or.new_true());
  };

  const and_constraint = rewrite_and(constraint.and_constraint);
  const or_constraint = constraint.or_constraint._0.reduce((acc, c) => Or.build_or(acc, rewrite_and(c)), Or.new_false());

  return RegionConstraint.new_from_or(Or.build_and(and_constraint, or_constraint));
}

// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:892 rewrite_placeholder_ty_outlives_constraints_in_universe_for_eager_placeholder_handling
function rewrite_placeholder_ty_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx: InferCtxtLike, ty: Ty, region: Region, u: UniverseIndex, assumptions: Assumptions): Or {
  const ty_u = max_universe(infcx, ty, fold_Ty_);
  const region_u = max_universe(infcx, region, fold_Region_);

  if (region_u !== u && ty_u !== u) {
    return Or.new_leaf({ $: "PlaceholderTyOutlives", _0: ty, _1: region, _2: null });
  }

  const candidates: LeafRegionConstraint[] = [];

  // There could be `!T: 'region` assumptions in the env even if `!T` is in a
  // smaller universe
  candidates.push(...regions_outlived_by_placeholder(ty, assumptions, infcx.cx()).map((assumption_r): LeafRegionConstraint => ({ $: "RegionOutlives", _0: assumption_r, _1: region, _2: null })));

  // We can express `!T: 'region` as `!T: 'r` where `'r: 'region`. This is only necessary
  // if the placeholder type is in a smaller universe as otherwise we know all regions which
  // the placeholder outlives and can just destructure into an OR of RegionOutlives.
  if (region_u === u && ty_u < u) {
    candidates.push(
      ...regions_outliving(region, assumptions, infcx.cx())
        .filter((r) => max_universe(infcx, r, fold_Region_) < u)
        .map((r): LeafRegionConstraint => ({ $: "PlaceholderTyOutlives", _0: ty, _1: r, _2: null })),
    );
  }

  return Or.new(candidates.map((c) => And.new([c])));
}

// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:935 rewrite_alias_ty_outlives_constraints_in_universe_for_eager_placeholder_handling
function rewrite_alias_ty_outlives_constraints_in_universe_for_eager_placeholder_handling(infcx: InferCtxtLike, bound_outlives: Binder<[AliasTy, Region]>, u: UniverseIndex, assumptions: Assumptions): Or {
  if (max_universe(infcx, bound_outlives, fold_Binder_AliasTy_Region) !== u) {
    return Or.new_leaf({ $: "AliasTyOutlivesViaEnv", _0: bound_outlives, _1: null });
  }

  const candidates: Or[] = [];

  // given there can be higher ranked assumptions, e.g. `for<'a> <T as Trait<'a>>::Assoc: 'c`, that
  // means that it's actually *always* possible for an alias outlive to be satisfied in the root universe
  // which means there should *always* be atleast one candidate when destructuring alias outlives.
  //
  // we dont care about this for region outlives as `for<'a> 'a: 'b` can't exist as we don't elaborate
  // higher ranked type outlives assumptions into higher ranked region outlives assumptions. similarly,
  // we don't care about `for<'a> Foo<'a>: 'b` as we always destructure adts into their components and if
  // we dont equivalently elaborate the assumption into assumptions on the adt's components we just drop the
  // assumptions
  //
  // so actually only `for<'a, 'b> Alias<'a>: 'b` and `for<'a> T: 'a` are assumptions we actually need to
  // handle.
  const higher_ranked_candidate_for_outlived_region = (region: Region): Or => {
    const bound_outlives_ = Binder_map_bound(bound_outlives, ([alias, _]): [AliasTy, Region] => [alias, region]);

    const replacer = new PlaceholderReplacer(infcx.cx(), Binder_bound_vars(bound_outlives_).length, new Map(), u, DebruijnIndex.ZERO);
    const escaping_outlives = fold_AliasTy_Region.fold_with(Binder_skip_binder(bound_outlives_), replacer);
    // PORT: `core::mem::take(&mut replacer.bound_vars)`.
    const taken = replacer.bound_vars;
    replacer.bound_vars = new Map();
    const bound_vars: BoundVariableKind[] = [...Binder_bound_vars(bound_outlives_), ...[...taken].map(([_, bound_region]): BoundVariableKind => ({ $: "Region", _0: bound_region.kind }))];
    const bound_outlives__ = Binder_bind_with_vars(escaping_outlives, RawList.from_vars(infcx.cx(), bound_vars));

    // `PlaceholderReplacer` only folds regions. A non-lifetime binder can leave
    // a placeholder type in `u`, so this type-outlives constraint cannot be
    // handled by the region-outlives-only eager placeholder machinery.
    if (max_universe(infcx, bound_outlives__, fold_Binder_AliasTy_Region) === u) {
      return Or.new_ambig(null);
    }

    // debug!("higher ranked candidate: {bound_outlives:?}");
    return Or.new_leaf({ $: "AliasTyOutlivesViaEnv", _0: bound_outlives__, _1: null });
  };

  // We elaborate something like `Alias<'a_u2>: 'b_u2` into alias outlives involving each
  // region which is known to outlive `'b_u2`. So e.g. if `'c_u2: 'b_u2` is known to hold
  // would wind up looking at `Alias<'a_u2>: 'c_u2` as well as `Alias<'a_u2>: 'b_u2`.
  //
  // This is important in two cases. First, if the outliving region is in a lower universe then
  // we've successfully lowered the universe of one of the terms in our alias outlives constraint.
  //
  // Secondly, if it's a region in the current universe *and* it's a region in the components of the
  // alias then we get a less general constraint after replacing with bound vars compared to if we
  // had just replaced the initial region. See `assumptions_on_binders/alias_outlives_with_repeated_placeholder.rs`
  const escaping_r = Binder_skip_binder(bound_outlives)[1];
  if (max_universe(infcx, escaping_r, fold_Region_) < u || Region_has_escaping_bound_vars(escaping_r)) {
    // we don't know anything about lower universe regions, and we also don't bother
    // looking at the assumptions on the `AliasTyOutlivesViaEnv` binder.
    candidates.push(higher_ranked_candidate_for_outlived_region(escaping_r));
  } else {
    for (const r of regions_outliving(escaping_r, assumptions, infcx.cx())) {
      candidates.push(higher_ranked_candidate_for_outlived_region(r));
    }
  }

  // Actually look at the assumptions and matching our higher ranked alias outlives goal
  // against potentially higher ranked type outlives assumptions.
  candidates.push(alias_outlives_candidates_from_assumptions(infcx, bound_outlives, assumptions));

  // I'm not convinced our handling here is *complete* so for now
  // let's be conservative and not let alias outlives' cause NoSolution
  // in coherence
  const typing_mode = infcx.typing_mode_raw();
  switch (typing_mode.$) {
    case "Coherence":
      candidates.push(Or.new_ambig(null));
      break;
    case "Typeck":
    case "Reflection":
    case "ErasedNotCoherence":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "PostAnalysis":
    case "Codegen":
      break;
  }

  return candidates.reduce((acc, c) => Or.build_or(acc, c), Or.new_false());
}

/// Returns all regions `r2` for which `r: r2` is known to hold in
/// the universe associated with `assumptions`
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:1040 regions_outlived_by
export function regions_outlived_by(r: Region, assumptions: Assumptions): Region[] {
  return [...TransitiveRelation_reachable_from(assumptions.region_outlives, r), r];
}

/// Returns all regions `r2` for which `r2: r` is known to hold in
/// the universe associated with `assumptions`
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:1049 regions_outliving
export function regions_outliving(r: Region, assumptions: Assumptions, cx: TyCtxt): Region[] {
  return [
    ...TransitiveRelation_reachable_from(assumptions.inverse_region_outlives, r),
    // FIXME(-Zassumptions-on-binders): 'static may have been an input region canonicalized to something else is that important?
    // FIXME(-Zassumptions-on-binders): do we need to adding the reflexive edge here?
    r,
    Region.new_static(cx),
  ];
}

/// Returns all regions `r` for which `!t: r` is known to hold in
/// the universe associated with `assumptions`
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:1065 regions_outlived_by_placeholder
export function regions_outlived_by_placeholder(t: Ty, assumptions: Assumptions, cx: TyCtxt): Region[] {
  switch (t.kind().$) {
    case "Placeholder":
    case "Param":
      break;
    default:
      return unreachable(`internal error: entered unreachable code: non-placeholder in \`regions_outlived_by_placeholder\`: ${format_debug(t, debug_Ty, PLAIN)}`);
  }

  return assumptions.type_outlives.flatMap((binder): Region[] => {
    const oc = Binder_no_bound_vars(binder);
    if (oc !== undefined) {
      const ty = oc._0;
      const r = oc._1;
      return ty === t ? [r] : [];
    } else {
      return [Region.new_static(cx)];
    }
  });
}

// rustc-type: compiler/rustc_type_ir/src/region_constraint.rs:1081 PlaceholderReplacer
export class PlaceholderReplacer implements TypeFolder {
  /** PORT: `IndexMap<BoundVar, BoundRegion>` is an insertion-ordered `Map` keyed by the `BoundVar` number. */
  constructor(
    public cx_: TyCtxt,
    public existing_var_count: number,
    public bound_vars: Map<BoundVar, BoundRegion>,
    public universe: UniverseIndex,
    public current_index: DebruijnIndex,
  ) {}

  // PORT: the field `cx` is `cx_` (the `TypeFolder::cx` method takes the name).
  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1090 cx
  cx(): TyCtxt {
    return this.cx_;
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1094 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "RePlaceholder" && k._0.universe === this.universe) {
      const p = k._0;
      const bound_vars_len = this.bound_vars.size;
      const default_: BoundRegion = {
        var: BoundVar.from_usize(this.existing_var_count + bound_vars_len),
        kind: p.bound.kind,
      };
      let mapped_var = this.bound_vars.get(p.bound.var);
      if (mapped_var === undefined) {
        mapped_var = default_;
        this.bound_vars.set(p.bound.var, mapped_var);
      }
      return Region.new_bound(this.cx_, this.current_index, mapped_var);
    } else {
      // FIXME(-Zassumptions-on-binders): We should be handling region variables here somehow
      return r;
    }
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1109 fold_binder
  fold_binder<T>(b: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    DebruijnIndex.shift_in(field_mut(this, "current_index"), 1);
    const b_ = Binder_super_fold_with(b, this, d);
    DebruijnIndex.shift_out(field_mut(this, "current_index"), 1);
    return b_;
  }

  // PORT: the provided `TypeFolder` methods this impl keeps (PORTING §8).
  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: import("../rustc_middle/ty/list.ts").Clauses): import("../rustc_middle/ty/list.ts").Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// Converts an `AliasTyOutlivesViaEnv` constraint into an OR of region outlives constraints by
/// matching the alias against any `Alias: 'a` assumptions. This is somewhat tricky as we have a
/// potentially higher ranked alias being equated with a potentially higher ranked assumption and
/// we don't handle it correctly right now (though it is a somewhat reasonable halfway step).
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_type_ir/src/region_constraint.rs:1122 alias_outlives_candidates_from_assumptions
function alias_outlives_candidates_from_assumptions(infcx: InferCtxtLike, bound_outlives: Binder<[AliasTy, Region]>, assumptions: Assumptions): Or {
  const candidates: And[] = [];

  const prev_universe = infcx.universe();

  infcx.enter_forall_with_empty_assumptions(
    bound_outlives,
    ([alias, r]) => {
      for (const bound_type_outlives of assumptions.type_outlives) {
        const oc = infcx.instantiate_binder_with_infer(bound_type_outlives, fold_OutlivesClause_Ty);
        const alias2 = oc._0;
        const r2 = oc._1;

        const relation = new HigherRankedAliasMatcher(infcx, [{ $: "RegionOutlives", _0: r2, _1: r, _2: null }]);

        // FIXME(#155345): Both sides should be rigid in the future.
        // Currently we can't guarantee that.
        if (relation.relate(AliasTyC.to_ty(alias, infcx.cx(), "No"), Unnormalized_skip_norm_wip(set_aliases_to_non_rigid(infcx.cx(), alias2, fold_Ty_)), relate_Ty).$ === "Ok") {
          candidates.push(And.new(relation.region_constraints));
        }
      }
    },
    fold_AliasTy_Region,
  );

  const constraint = RegionConstraint.new_from_or(Or.new(candidates));

  const largest_universe = infcx.universe();
  // debug!(?prev_universe, ?largest_universe);

  let canonical_constraint = constraint;
  for (let u = UniverseIndex.index(largest_universe); u >= UniverseIndex.index(prev_universe) + 1; u--) {
    canonical_constraint = eagerly_handle_placeholders_in_universe(infcx, canonical_constraint, UniverseIndex.from_usize(u));
  }

  return RegionConstraint.splatted_and_constraints(canonical_constraint);
}

// rustc-type: compiler/rustc_type_ir/src/region_constraint.rs:1167 HigherRankedAliasMatcher
class HigherRankedAliasMatcher implements TypeRelation {
  constructor(
    public infcx: InferCtxtLike,
    public region_constraints: LeafRegionConstraint[],
  ) {}

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1175 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  // PORT: the provided `TypeRelation::relate` (relate.rs:60, stand-in below).
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided_relate(this, a, b, d);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1179 relate_ty_args
  relate_ty_args(a_ty: Ty, _b_ty: Ty, _ty_def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _mk: (args: GenericArgs) => Ty): RelateResult<Ty> {
    const r = relate_args_invariantly(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1192 relate_with_variance
  relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    // FIXME(-Zassumptions-on-binders): bivariance is important for opaque type args so
    // we should actually handle variance in some way here.
    return this.relate(a, b, d);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1204 tys
  tys(a: Ty, b: Ty): RelateResult<Ty> {
    return structurally_relate_tys(this, a, b);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1208 regions
  regions(a: Region, b: Region): RelateResult<Region> {
    if (a !== b) {
      this.region_constraints.push({ $: "RegionOutlives", _0: a, _1: b, _2: null });
      this.region_constraints.push({ $: "RegionOutlives", _0: b, _1: a, _2: null });
    }
    return Ok(a);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1216 consts
  consts(a: Const, b: Const): RelateResult<Const> {
    return structurally_relate_consts(this, a, b);
  }

  // rustc: compiler/rustc_type_ir/src/region_constraint.rs:1220 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    const r1 = this.infcx.enter_forall_with_empty_assumptions(
      a,
      (a) => {
        const u = this.infcx.universe();
        this.infcx.insert_placeholder_assumptions(u, Assumptions.empty());
        const b_ = this.infcx.instantiate_binder_with_infer(b, d);
        return this.relate(a, b_, d);
      },
      d,
    );
    if (r1.$ === "Err") return r1;

    const r2 = this.infcx.enter_forall_with_empty_assumptions(
      b,
      (b) => {
        const u = this.infcx.universe();
        this.infcx.insert_placeholder_assumptions(u, Assumptions.empty());
        const a_ = this.infcx.instantiate_binder_with_infer(a, d);
        return this.relate(a_, b, d);
      },
      d,
    );
    if (r2.$ === "Err") return r2;

    return Ok(a);
  }
}

// ---- D4 descriptors of the traversed types (fold.ts header) ---------------------------------------------------------

function descriptor<T>(visit_with: VisitWith<T>, try_fold_with: TryFoldWith<T>, fold_with: FoldWith<T>): TypeFoldable<T> {
  return { visit_with, try_fold_with, fold_with };
}

const fold_Region_: TypeFoldable<Region> = descriptor(visit_with_Region, try_fold_with_Region, fold_with_Region);
const fold_Ty_: TypeFoldable<Ty> = descriptor(visit_with_Ty, try_fold_with_Ty, fold_with_Ty);
const fold_Clause_: TypeFoldable<Clause> = descriptor(visit_with_Clause, try_fold_with_Clause, fold_with_Clause);
/** `LeafRegionConstraint<I, ()>` (`()` is trivially traversable). */
const fold_LeafRegionConstraint_unit: TypeFoldable<LeafRegionConstraint> = descriptor(
  <R>(s: LeafRegionConstraint, v: TypeVisitor<R>): R => gen.visit_with_LeafRegionConstraint<null, R>(s, v, visit_with_trivial),
  <E>(s: LeafRegionConstraint, f: FallibleTypeFolder<E>): Result<LeafRegionConstraint, E> => gen.try_fold_with_LeafRegionConstraint<null, E>(s, f, try_fold_with_trivial),
  (s: LeafRegionConstraint, f: TypeFolder): LeafRegionConstraint => gen.fold_with_LeafRegionConstraint<null>(s, f, fold_with_trivial),
);
/** `RegionConstraint<I, ()>`. */
const fold_RegionConstraint_unit: TypeFoldable<RegionConstraint> = descriptor(
  <R>(s: RegionConstraint, v: TypeVisitor<R>): R => gen.visit_with_RegionConstraint<null, R>(s, v, visit_with_trivial),
  <E>(s: RegionConstraint, f: FallibleTypeFolder<E>): Result<RegionConstraint, E> => gen.try_fold_with_RegionConstraint<null, E>(s, f, try_fold_with_trivial),
  (s: RegionConstraint, f: TypeFolder): RegionConstraint => gen.fold_with_RegionConstraint<null>(s, f, fold_with_trivial),
);
const debug_RegionConstraint_unit: Debug<RegionConstraint> = (v, f) => gen.debug_RegionConstraint<null>(v, f, () => "()");
/** `(AliasTy<I>, Region<I>)`. */
const fold_AliasTy_Region: TypeFoldable<[AliasTy, Region]> = descriptor(
  <R>(s: [AliasTy, Region], v: TypeVisitor<R>): R =>
    visit_with_tuple2<AliasTy, Region, R>(s, v, <R>(a: AliasTy, v: TypeVisitor<R>): R => visit_with_Alias(a, v, visit_with_AliasTyKind), visit_with_Region),
  <E>(s: [AliasTy, Region], f: FallibleTypeFolder<E>): Result<[AliasTy, Region], E> =>
    try_fold_with_tuple2<AliasTy, Region, E>(s, f, <E>(a: AliasTy, f: FallibleTypeFolder<E>): Result<AliasTy, E> => try_fold_with_Alias(a, f, try_fold_with_AliasTyKind), try_fold_with_Region),
  (s: [AliasTy, Region], f: TypeFolder): [AliasTy, Region] => fold_with_tuple2<AliasTy, Region>(s, f, (a: AliasTy, f: TypeFolder): AliasTy => fold_with_Alias(a, f, fold_with_AliasTyKind), fold_with_Region),
);
/** `Binder<I, (AliasTy<I>, Region<I>)>`. */
const fold_Binder_AliasTy_Region: TypeFoldable<Binder<[AliasTy, Region]>> = descriptor(
  <R>(s: Binder<[AliasTy, Region]>, v: TypeVisitor<R>): R => visit_with_Binder(s, v, fold_AliasTy_Region.visit_with),
  <E>(s: Binder<[AliasTy, Region]>, f: FallibleTypeFolder<E>): Result<Binder<[AliasTy, Region]>, E> => try_fold_with_Binder(s, f, fold_AliasTy_Region.try_fold_with),
  (s: Binder<[AliasTy, Region]>, f: TypeFolder): Binder<[AliasTy, Region]> => fold_with_Binder(s, f, fold_AliasTy_Region.fold_with),
);
/** `OutlivesClause<I, I::Ty>`. */
const fold_OutlivesClause_Ty: TypeFoldable<OutlivesClause<Ty>> = descriptor(
  <R>(s: OutlivesClause<Ty>, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, visit_with_Ty),
  <E>(s: OutlivesClause<Ty>, f: FallibleTypeFolder<E>): Result<OutlivesClause<Ty>, E> => try_fold_with_OutlivesClause(s, f, try_fold_with_Ty),
  (s: OutlivesClause<Ty>, f: TypeFolder): OutlivesClause<Ty> => fold_with_OutlivesClause(s, f, fold_with_Ty),
);

// ---- PORT stand-ins for fns of other files / lanes that are not ported yet ------------------------------------------

/** PORT: `rustc_data_structures::transitive_relation::TransitiveRelation<T>` (decls.ts `Pending1`). */
type TransitiveRelation<T> = TransitiveRelationPending<T>;
/**
 * PORT: stand-in for `rustc_data_structures::transitive_relation::TransitiveRelationBuilder<T>`
 * (compiler/rustc_data_structures/src/transitive_relation.rs, not ported yet; plan-m3 lists it under rustc_data_structures).
 */
type TransitiveRelationBuilder<T> = { readonly __pending: "TransitiveRelationBuilder"; readonly __T?: T };
/**
 * PORT: the `TransitiveRelation` methods this file calls, as a view of the (pending) relation object. The real type
 * (rustc_data_structures transitive_relation.rs, not ported yet) is expected to have these methods; until then no
 * relation can be built here (the builder stand-ins are unported), so these calls only reach relations constructed
 * elsewhere (the unit tests build them).
 */
interface TransitiveRelationMethods<T> {
  // transitive_relation.rs `reachable_from`
  reachable_from(a: T): T[];
  // transitive_relation.rs `base_edges`
  base_edges(): Iterable<[T, T]>;
}
/** PORT: stand-in for `TransitiveRelation::reachable_from` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelation_reachable_from<T>(self: TransitiveRelation<T>, a: T): T[] {
  return (self as unknown as TransitiveRelationMethods<T>).reachable_from(a);
}
/** PORT: stand-in for `TransitiveRelation::base_edges` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelation_base_edges<T>(self: TransitiveRelation<T>): Iterable<[T, T]> {
  return (self as unknown as TransitiveRelationMethods<T>).base_edges();
}
/** PORT: stand-in for `<TransitiveRelationBuilder<T> as Default>::default` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelationBuilder_default<T>(): TransitiveRelationBuilder<T> {
  return unported("rustc_data_structures::transitive_relation::TransitiveRelationBuilder::default");
}
/** PORT: stand-in for `TransitiveRelationBuilder::add` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelationBuilder_add<T>(_self: TransitiveRelationBuilder<T>, _a: T, _b: T): void {
  unported("rustc_data_structures::transitive_relation::TransitiveRelationBuilder::add");
}
/** PORT: stand-in for `TransitiveRelationBuilder::freeze` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelationBuilder_freeze<T>(_self: TransitiveRelationBuilder<T>): TransitiveRelation<T> {
  return unported("rustc_data_structures::transitive_relation::TransitiveRelationBuilder::freeze");
}
/** PORT: stand-in for `<TransitiveRelationBuilder<T> as Clone>::clone` (rustc_data_structures transitive_relation.rs). */
function TransitiveRelationBuilder_clone<T>(_self: TransitiveRelationBuilder<T>): TransitiveRelationBuilder<T> {
  return unported("rustc_data_structures::transitive_relation::TransitiveRelationBuilder::clone");
}

/** PORT: stand-in for `rustc_type_ir::elaborate::elaborate` over clauses (elaborate.rs:86, lane tyir-relate). */
function elaborate(_cx: TyCtxt, _obligations: Iterable<Clause>): Clause[] {
  return unported("rustc_type_ir::elaborate::elaborate");
}

/** PORT: stand-in for `Binder::bound_vars` (binder.rs, lane tyir-binder): the field read. */
function Binder_bound_vars<T>(self: Binder<T>): readonly BoundVariableKind[] {
  return self.bound_vars;
}
/** PORT: stand-in for `Binder::bind_with_vars` (binder.rs, lane tyir-binder); its `cfg!(debug_assertions)` check is off in
 *  the oracle build. */
function Binder_bind_with_vars<T>(value: T, bound_vars: Binder<T>["bound_vars"]): Binder<T> {
  return { value, bound_vars };
}
/** PORT: stand-in for `Binder::no_bound_vars` (binder.rs, lane tyir-binder; needs `has_escaping_bound_vars`). */
function Binder_no_bound_vars<T>(_self: Binder<T>): T | undefined {
  return unported("rustc_type_ir::binder::Binder::no_bound_vars");
}
/** PORT: stand-in for `impl TypeSuperFoldable for Binder` (binder.rs, lane tyir-binder):
 *  `self.map_bound(|t| t.fold_with(folder))`. */
function Binder_super_fold_with<T>(self: Binder<T>, folder: TypeFolder, d: TypeFoldable<T>): Binder<T> {
  return Binder_map_bound(self, (t) => d.fold_with(t, folder));
}
/** PORT: stand-in for `TypeVisitableExt::has_escaping_bound_vars` on `Region` (visit.rs:267, lane tyir-binder). */
function Region_has_escaping_bound_vars(_r: Region): boolean {
  return unported("rustc_type_ir::visit::TypeVisitableExt::has_escaping_bound_vars");
}
/** PORT: stand-in for `rustc_type_ir::fold::set_aliases_to_non_rigid` (fold.rs:594, lane tyir-binder). */
function set_aliases_to_non_rigid<T>(_cx: TyCtxt, _value: T, _d_T: TypeFoldable<T>): Unnormalized<T> {
  return unported("rustc_type_ir::fold::set_aliases_to_non_rigid");
}
/** PORT: stand-in for `Unnormalized::skip_norm_wip` (unnormalized.rs:71, sub-lane predicate): the field read. */
function Unnormalized_skip_norm_wip<T>(self: Unnormalized<T>): T {
  return self.value;
}

/** PORT: stand-in for `trait Relate<I>` (relate.rs:104, lane tyir-relate) as a D4-style descriptor. */
interface Relate<T> extends TypeFoldable<T> {
  relate(relation: TypeRelation, a: T, b: T): RelateResult<T>;
}
/** PORT: stand-in for `trait TypeRelation<I>` (relate.rs:56, lane tyir-relate); generic methods take the `Relate`
 *  descriptor last. */
interface TypeRelation {
  cx(): TyCtxt;
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
  relate_ty_args(a_ty: Ty, b_ty: Ty, ty_def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, mk: (args: GenericArgs) => Ty): RelateResult<Ty>;
  relate_with_variance<T>(variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
  tys(a: Ty, b: Ty): RelateResult<Ty>;
  regions(a: Region, b: Region): RelateResult<Region>;
  consts(a: Const, b: Const): RelateResult<Const>;
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
}
/** PORT: stand-in for the provided `TypeRelation::relate` (relate.rs:60, lane tyir-relate): `Relate::relate(self, a, b)`. */
function TypeRelation_provided_relate<T>(self: TypeRelation, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return d.relate(self, a, b);
}
/** PORT: stand-in for `impl Relate for I::Ty` (relate.rs, lane tyir-relate): `relation.tys(a, b)`. */
const relate_Ty: Relate<Ty> = {
  ...fold_Ty_,
  relate(relation: TypeRelation, a: Ty, b: Ty): RelateResult<Ty> {
    return relation.tys(a, b);
  },
};
/** PORT: stand-in for `rustc_type_ir::relate::relate_args_invariantly` (relate.rs:112, lane tyir-relate). */
function relate_args_invariantly(_relation: TypeRelation, _a_arg: GenericArgs, _b_arg: GenericArgs): RelateResult<GenericArgs> {
  return unported("rustc_type_ir::relate::relate_args_invariantly");
}
/** PORT: stand-in for `rustc_type_ir::relate::structurally_relate_tys` (relate.rs:347, lane tyir-relate). */
function structurally_relate_tys(_relation: TypeRelation, _a: Ty, _b: Ty): RelateResult<Ty> {
  return unported("rustc_type_ir::relate::structurally_relate_tys");
}
/** PORT: stand-in for `rustc_type_ir::relate::structurally_relate_consts` (relate.rs:552, lane tyir-relate). */
function structurally_relate_consts(_relation: TypeRelation, _a: Const, _b: Const): RelateResult<Const> {
  return unported("rustc_type_ir::relate::structurally_relate_consts");
}
