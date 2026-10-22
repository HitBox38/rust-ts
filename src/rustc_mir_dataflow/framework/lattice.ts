// Port of compiler/rustc_mir_dataflow/src/framework/lattice.rs (lane dataflow-contract).
//
// PORT (plan-m4 D5): traits are impl tables (PORTING §5 "generic code over the trait takes the needed functions as
// parameters"): `JoinSemiLattice<T>` is `{ eq, join }` (the `Eq` supertrait is `eq`), `HasBottom<T>` / `HasTop<T>`
// hold the consts. An impl for a generic type is a function of the inner impls (`JoinSemiLattice_MaybeReachable(S)`).
// - Domain values are mutable objects changed in place (`&mut self` is the object). `MaybeReachable` values are
//   therefore never shared frozen singletons: `Unreachable` is a fresh `{ $: "Unreachable" }` (`MaybeReachable.
//   Unreachable()`), and `*self = v` is `MaybeReachable.assign(self, v)` (moves `v`'s payload into `self`).
// - `FlatSet<T>` is `Copy`: its values are immutable (`FlatSet.Bottom` / `FlatSet.Top` are frozen singletons) and
//   `join(&mut self, ..)` takes a `MutRef<FlatSet<T>>` slot (PORTING §8 out-parameter rule).
//! Traits used to represent [lattices] for use as the domain of a dataflow analysis.
//!
//! # Overview
//!
//! The most common lattice is a powerset of some set `S`, ordered by [set inclusion]. The [Hasse
//! diagram] for the powerset of a set with two elements (`X` and `Y`) is shown below. Note that
//! distinct elements at the same height in a Hasse diagram (e.g. `{X}` and `{Y}`) are
//! *incomparable*, not equal.
//!
//! ```text
//!      {X, Y}    <- top
//!       /  \
//!    {X}    {Y}
//!       \  /
//!        {}      <- bottom
//!
//! ```
//!
//! The defining characteristic of a lattice—the one that differentiates it from a [partially
//! ordered set][poset]—is the existence of a *unique* least upper and greatest lower bound for
//! every pair of elements. The lattice join operator (`∨`) returns the least upper bound, and the
//! lattice meet operator (`∧`) returns the greatest lower bound. Types that implement one operator
//! but not the other are known as semilattices. Dataflow analysis only uses the join operator and
//! will work with any join-semilattice, but both should be specified when possible.
//!
//! ## `PartialOrd`
//!
//! Given that it represents a partially ordered set, you may be surprised that [`JoinSemiLattice`]
//! does not have [`PartialOrd`] as a supertrait. This
//! is because most standard library types use lexicographic ordering instead of set inclusion for
//! their `PartialOrd` impl. Since we do not actually need to compare lattice elements to run a
//! dataflow analysis, there's no need for a newtype wrapper with a custom `PartialOrd` impl. The
//! only benefit would be the ability to check that the least upper (or greatest lower) bound
//! returned by the lattice join (or meet) operator was in fact greater (or lower) than the inputs.
//!
//! [lattices]: https://en.wikipedia.org/wiki/Lattice_(order)
//! [set inclusion]: https://en.wikipedia.org/wiki/Subset
//! [Hasse diagram]: https://en.wikipedia.org/wiki/Hasse_diagram
//! [poset]: https://en.wikipedia.org/wiki/Partially_ordered_set

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type Debug, debug_tuple } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { DenseBitSet_eq, MixedBitSet, MixedBitSet_eq } from "../../rustc_index/bit_set.ts";
import type { BitSetExt, Clone } from "./mod.ts";

/// A [partially ordered set][poset] that has a [least upper bound][lub] for any pair of elements
/// in the set.
///
/// [lub]: https://en.wikipedia.org/wiki/Infimum_and_supremum
/// [poset]: https://en.wikipedia.org/wiki/Partially_ordered_set
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/lattice.rs:51 JoinSemiLattice
export interface JoinSemiLattice<T> {
  /** The `Eq` supertrait (`==`). */
  eq(a: T, b: T): boolean;

  /// Computes the least upper bound of two elements, storing the result in `self` and returning
  /// `true` if `self` has changed.
  ///
  /// The lattice join operator is abbreviated as `∨`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:56 join
  join(self: T, other: T): boolean;
}

/// A set that has a "bottom" element, which is less than or equal to any other element.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/lattice.rs:60 HasBottom
export interface HasBottom<T> {
  readonly BOTTOM: T;

  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:63 is_bottom
  is_bottom(self: T): boolean;
}

/// A set that has a "top" element, which is greater than or equal to any other element.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/lattice.rs:67 HasTop
export interface HasTop<T> {
  readonly TOP: T;
}

/// A `DenseBitSet` represents the lattice formed by the powerset of all possible values of the
/// index type `T` ordered by inclusion. Equivalently, it is a tuple of "two-point" lattices, one
/// for each possible value of `T`.
export const JoinSemiLattice_DenseBitSet = {
  eq: DenseBitSet_eq,

  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:75 join
  join<T extends number>(self: DenseBitSet<T>, other: DenseBitSet<T>): boolean {
    return self.union(other);
  },
};

export const JoinSemiLattice_MixedBitSet = {
  eq: MixedBitSet_eq,

  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:81 join
  join<T extends number>(self: MixedBitSet<T>, other: MixedBitSet<T>): boolean {
    return MixedBitSet.union(self, other);
  },
};

/// Extends a type `T` with top and bottom elements to make it a partially ordered set in which no
/// value of `T` is comparable with any other.
///
/// A flat set has the following [Hasse diagram]:
///
/// ```text
///          top
///  / ... / /  \ \ ... \
/// all possible values of `T`
///  \ ... \ \  / / ... /
///         bottom
/// ```
///
/// [Hasse diagram]: https://en.wikipedia.org/wiki/Hasse_diagram
// rustc-type: compiler/rustc_mir_dataflow/src/framework/lattice.rs:101 FlatSet
export type FlatSet<T> = { readonly $: "Bottom" } | { readonly $: "Elem"; readonly _0: T } | { readonly $: "Top" };

export const FlatSet = {
  Bottom: Object.freeze({ $: "Bottom" }) as FlatSet<never>,
  Top: Object.freeze({ $: "Top" }) as FlatSet<never>,
  Elem<T>(_0: T): FlatSet<T> {
    return { $: "Elem", _0 };
  },

  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:109 and_then
  and_then<T, U>(self: FlatSet<T>, f: (elem: T) => FlatSet<U>): FlatSet<U> {
    switch (self.$) {
      case "Elem":
        return f(self._0);
      case "Bottom":
        return FlatSet.Bottom;
      case "Top":
        return FlatSet.Top;
    }
  },
};

/** `#[derive(Debug)]` of `FlatSet<T>`. */
export function debug_FlatSet<T>(debug_T: Debug<T>): Debug<FlatSet<T>> {
  return (self, f) => (self.$ === "Elem" ? debug_tuple(f, "Elem", [debug_T(self._0, f)]) : self.$);
}

/** `#[derive(PartialEq)]` of `FlatSet<T>`. */
export function FlatSet_eq<T>(eq_T: (a: T, b: T) => boolean): (a: FlatSet<T>, b: FlatSet<T>) => boolean {
  return (a, b) => (a.$ === "Elem" && b.$ === "Elem" ? eq_T(a._0, b._0) : a.$ === b.$);
}

/** `impl<T: Clone + Eq> JoinSemiLattice for FlatSet<T>`: `self` is the slot (`FlatSet` is `Copy`, see the header). */
export function JoinSemiLattice_FlatSet<T>(eq_T: (a: T, b: T) => boolean, clone_T: (v: T) => T) {
  return {
    eq: FlatSet_eq(eq_T),

    // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:119 join
    join(self: MutRef<FlatSet<T>>, other: FlatSet<T>): boolean {
      let result: FlatSet<T>;
      const this_ = self.value;
      if (this_.$ === "Top" || other.$ === "Bottom") {
        return false;
      } else if (this_.$ === "Elem" && other.$ === "Elem" && eq_T(this_._0, other._0)) {
        return false;
      } else if (this_.$ === "Bottom" && other.$ === "Elem") {
        result = FlatSet.Elem(clone_T(other._0));
      } else {
        result = FlatSet.Top;
      }

      self.value = result;
      return true;
    },
  };
}

export const HasBottom_FlatSet = {
  BOTTOM: FlatSet.Bottom,

  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:137 is_bottom
  is_bottom<T>(self: FlatSet<T>): boolean {
    return self.$ === "Bottom";
  },
};

export const HasTop_FlatSet = {
  TOP: FlatSet.Top,
};

/// Extend a lattice with a bottom value to represent an unreachable execution.
///
/// The only useful action on an unreachable state is joining it with a reachable one to make it
/// reachable. All other actions, gen/kill for instance, are no-ops.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/lattice.rs:151 MaybeReachable
export type MaybeReachable<T> = { $: "Unreachable" } | { $: "Reachable"; _0: T };

export const MaybeReachable = {
  /** A fresh `MaybeReachable::Unreachable` (domain values are mutated in place; see the header). */
  Unreachable<T>(): MaybeReachable<T> {
    return { $: "Unreachable" };
  },
  Reachable<T>(_0: T): MaybeReachable<T> {
    return { $: "Reachable", _0 };
  },
  /** `*self = source` (a move: `self` takes `source`'s payload). */
  assign<T>(self: MaybeReachable<T>, source: MaybeReachable<T>): void {
    const s = self as { $: "Unreachable" | "Reachable"; _0?: T };
    if (source.$ === "Reachable") {
      s.$ = "Reachable";
      s._0 = source._0;
    } else {
      s.$ = "Unreachable";
      delete s._0;
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:157 is_reachable
  is_reachable<T>(self: MaybeReachable<T>): boolean {
    return self.$ === "Reachable";
  },

  /// Return whether the current state contains the given element. If the state is unreachable,
  /// it does no contain anything.
  // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:165 contains
  contains<S, T>(self: MaybeReachable<S>, elem: T, S_: BitSetExt<S, T>): boolean {
    switch (self.$) {
      case "Unreachable":
        return false;
      case "Reachable":
        return S_.contains(self._0, elem);
    }
  },
};

/** `#[derive(Debug)]` of `MaybeReachable<T>`. */
export function debug_MaybeReachable<T>(debug_T: Debug<T>): Debug<MaybeReachable<T>> {
  return (self, f) => (self.$ === "Reachable" ? debug_tuple(f, "Reachable", [debug_T(self._0, f)]) : "Unreachable");
}

/** `#[derive(PartialEq)]` of `MaybeReachable<T>`. */
export function MaybeReachable_eq<T>(eq_T: (a: T, b: T) => boolean): (a: MaybeReachable<T>, b: MaybeReachable<T>) => boolean {
  return (a, b) => (a.$ === "Reachable" && b.$ === "Reachable" ? eq_T(a._0, b._0) : a.$ === b.$);
}

/** `impl<T, S: BitSetExt<T>> BitSetExt<T> for MaybeReachable<S>`. */
export function BitSetExt_MaybeReachable<S, T>(S_: BitSetExt<S, T>): BitSetExt<MaybeReachable<S>, T> {
  return {
    // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:177 contains
    contains(self: MaybeReachable<S>, elem: T): boolean {
      return MaybeReachable.contains(self, elem, S_);
    },
  };
}

/** `impl<V: Clone> Clone for MaybeReachable<V>`. */
export function Clone_MaybeReachable<V>(V_: Clone<V>): Clone<MaybeReachable<V>> {
  const impl: Clone<MaybeReachable<V>> = {
    // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:183 clone
    clone(self: MaybeReachable<V>): MaybeReachable<V> {
      switch (self.$) {
        case "Reachable":
          return MaybeReachable.Reachable(V_.clone(self._0));
        case "Unreachable":
          return MaybeReachable.Unreachable();
      }
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:190 clone_from
    clone_from(self: MaybeReachable<V>, source: MaybeReachable<V>): void {
      if (self.$ === "Reachable" && source.$ === "Reachable") {
        V_.clone_from(self._0, source._0);
      } else {
        MaybeReachable.assign(self, impl.clone(source));
      }
    },
  };
  return impl;
}

/** `impl<T: JoinSemiLattice + Clone> JoinSemiLattice for MaybeReachable<T>`. */
export function JoinSemiLattice_MaybeReachable<T>(T_: JoinSemiLattice<T> & Clone<T>): JoinSemiLattice<MaybeReachable<T>> {
  const clone = Clone_MaybeReachable(T_);
  return {
    eq: MaybeReachable_eq(T_.eq),

    // rustc: compiler/rustc_mir_dataflow/src/framework/lattice.rs:201 join
    join(self: MaybeReachable<T>, other: MaybeReachable<T>): boolean {
      // Unreachable acts as a bottom.
      if (other.$ === "Unreachable") {
        return false;
      } else if (self.$ === "Unreachable") {
        MaybeReachable.assign(self, clone.clone(other));
        return true;
      } else {
        return T_.join(self._0, other._0);
      }
    },
  };
}
