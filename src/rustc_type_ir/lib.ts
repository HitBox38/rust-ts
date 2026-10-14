// Port of compiler/rustc_type_ir/src/lib.rs (lane tyir-misc, sub-lane lib-sty). The types with their derived Debug /
// TypeVisitable / TypeFoldable impls are generated into lib.gen.ts (set rustc_ty of tools/codegen/types.ts); this file
// holds the inherent methods and manual impls, in upstream order.
//
// PORT: methods of the generated newtype indices and enums live on same-named companion consts that spread the
// generated companion (PORTING §8, tyir-kind decision 1): `DebruijnIndex.shifted_in(d, 1)`, `Variance.xform(a, b)`,
// `UniverseIndex.next_universe(u)`, `ClosureKind.extends(a, b)`.
// PORT: upstream's `pub use <module>::*` glob re-exports (lib.rs:94-125) are not mirrored here: every module imports
// what it needs from the defining file (`./universe.ts`, `./sty/mod.ts`, ...), because re-exporting them from lib.ts
// would make this leaf module import most of the crate and create init-order cycles.
import { type Debug, PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { BoundVarIndexKind } from "./binder.ts";
import * as gen from "./lib.gen.ts";

export * from "./lib.gen.ts";

// PORT: `newtype_index!`'s `const INNERMOST = 0;` is generated as `INNERMOST` (lib.gen.ts); used below.
const INNERMOST = gen.INNERMOST;

// PORT: `u32` arithmetic of the release-built oracle wraps (no overflow checks); `>>> 0` reduces to `u32`, and
// `DebruijnIndex::from_u32` then asserts the `newtype_index!` maximum like upstream.
export type DebruijnIndex = gen.DebruijnIndex;
export const DebruijnIndex = {
  ...gen.DebruijnIndex,

  /// Returns the resulting index when this value is moved into
  /// `amount` number of new binders. So, e.g., if you had
  ///
  ///    for<'a> fn(&'a x)
  ///
  /// and you wanted to change it to
  ///
  ///    for<'a> fn(for<'b> fn(&'a x))
  ///
  /// you would need to shift the index for `'a` into a new binder.
  // rustc: compiler/rustc_type_ir/src/lib.rs:189 shifted_in
  shifted_in(self: gen.DebruijnIndex, amount: number): gen.DebruijnIndex {
    return gen.DebruijnIndex.from_u32((gen.DebruijnIndex.as_u32(self) + amount) >>> 0);
  },

  /// Update this index in place by shifting it "in" through
  /// `amount` number of binders.
  // rustc: compiler/rustc_type_ir/src/lib.rs:196 shift_in
  shift_in(self: MutRef<gen.DebruijnIndex>, amount: number): void {
    self.value = DebruijnIndex.shifted_in(self.value, amount);
  },

  /// Returns the resulting index when this value is moved out from
  /// `amount` number of new binders.
  // rustc: compiler/rustc_type_ir/src/lib.rs:204 shifted_out
  shifted_out(self: gen.DebruijnIndex, amount: number): gen.DebruijnIndex {
    return gen.DebruijnIndex.from_u32((gen.DebruijnIndex.as_u32(self) - amount) >>> 0);
  },

  /// Update in place by shifting out from `amount` binders.
  // rustc: compiler/rustc_type_ir/src/lib.rs:210 shift_out
  shift_out(self: MutRef<gen.DebruijnIndex>, amount: number): void {
    self.value = DebruijnIndex.shifted_out(self.value, amount);
  },

  /// Adjusts any De Bruijn indices so as to make `to_binder` the
  /// innermost binder. That is, if we have something bound at `to_binder`,
  /// it will now be bound at INNERMOST. This is an appropriate thing to do
  /// when moving a region out from inside binders:
  ///
  /// ```ignore (illustrative)
  ///             for<'a>   fn(for<'b>   for<'c>   fn(&'a u32), _)
  /// // Binder:  D3           D2        D1            ^^
  /// ```
  ///
  /// Here, the region `'a` would have the De Bruijn index D3,
  /// because it is the bound 3 binders out. However, if we wanted
  /// to refer to that region `'a` in the second argument (the `_`),
  /// those two binders would not be in scope. In that case, we
  /// might invoke `shift_out_to_binder(D3)`. This would adjust the
  /// De Bruijn index of `'a` to D1 (the innermost binder).
  ///
  /// If we invoke `shift_out_to_binder` and the region is in fact
  /// bound by one of the binders we are shifting out of, that is an
  /// error (and should fail an assertion failure).
  // rustc: compiler/rustc_type_ir/src/lib.rs:235 shifted_out_to_binder
  shifted_out_to_binder(self: gen.DebruijnIndex, to_binder: gen.DebruijnIndex): gen.DebruijnIndex {
    return DebruijnIndex.shifted_out(self, (gen.DebruijnIndex.as_u32(to_binder) - gen.DebruijnIndex.as_u32(INNERMOST)) >>> 0);
  },
};

// PORT: `fmt: &mut T` (`T: fmt::Write`) is the returned text; `var: impl Debug` takes its Debug fn. Each `write!`
// formats with fresh options (`PLAIN`).
// rustc: compiler/rustc_type_ir/src/lib.rs:240 debug_bound_var
export function debug_bound_var<T>(bound_index: BoundVarIndexKind, var_: T, debug_T: Debug<T>): string {
  switch (bound_index.$) {
    case "Bound": {
      const debruijn = bound_index._0;
      if (debruijn === INNERMOST) {
        return `^${debug_T(var_, PLAIN)}`;
      } else {
        return `^${gen.DebruijnIndex.index(debruijn)}_${debug_T(var_, PLAIN)}`;
      }
    }
    case "Canonical": {
      return `^c_${debug_T(var_, PLAIN)}`;
    }
  }
}

export type Variance = gen.Variance;
export const Variance = {
  ...gen.Variance,

  /// `a.xform(b)` combines the variance of a context with the
  /// variance of a type with the following meaning. If we are in a
  /// context with variance `a`, and we encounter a type argument in
  /// a position with variance `b`, then `a.xform(b)` is the new
  /// variance with which the argument appears.
  ///
  /// Example 1:
  /// ```ignore (illustrative)
  /// *mut Vec<i32>
  /// ```
  /// Here, the "ambient" variance starts as covariant. `*mut T` is
  /// invariant with respect to `T`, so the variance in which the
  /// `Vec<i32>` appears is `Covariant.xform(Invariant)`, which
  /// yields `Invariant`. Now, the type `Vec<T>` is covariant with
  /// respect to its type argument `T`, and hence the variance of
  /// the `i32` here is `Invariant.xform(Covariant)`, which results
  /// (again) in `Invariant`.
  ///
  /// Example 2:
  /// ```ignore (illustrative)
  /// fn(*const Vec<i32>, *mut Vec<i32)
  /// ```
  /// The ambient variance is covariant. A `fn` type is
  /// contravariant with respect to its parameters, so the variance
  /// within which both pointer types appear is
  /// `Covariant.xform(Contravariant)`, or `Contravariant`. `*const
  /// T` is covariant with respect to `T`, so the variance within
  /// which the first `Vec<i32>` appears is
  /// `Contravariant.xform(Covariant)` or `Contravariant`. The same
  /// is true for its `i32` argument. In the `*mut T` case, the
  /// variance of `Vec<i32>` is `Contravariant.xform(Invariant)`,
  /// and hence the outermost type is `Invariant` with respect to
  /// `Vec<i32>` (and its `i32` argument).
  ///
  /// Source: Figure 1 of "Taming the Wildcards:
  /// Combining Definition- and Use-Site Variance" published in PLDI'11.
  // rustc: compiler/rustc_type_ir/src/lib.rs:306 xform
  xform(self: gen.Variance, v: gen.Variance): gen.Variance {
    // Figure 1, column 1.
    if (self === "Covariant" && v === "Covariant") return "Covariant";
    if (self === "Covariant" && v === "Contravariant") return "Contravariant";
    if (self === "Covariant" && v === "Invariant") return "Invariant";
    if (self === "Covariant" && v === "Bivariant") return "Bivariant";

    // Figure 1, column 2.
    if (self === "Contravariant" && v === "Covariant") return "Contravariant";
    if (self === "Contravariant" && v === "Contravariant") return "Covariant";
    if (self === "Contravariant" && v === "Invariant") return "Invariant";
    if (self === "Contravariant" && v === "Bivariant") return "Bivariant";

    // Figure 1, column 3.
    if (self === "Invariant") return "Invariant";

    // Figure 1, column 4.
    return "Bivariant";
  },
};

// rustc: compiler/rustc_type_ir/src/lib.rs:330 fmt
export const debug_Variance: Debug<gen.Variance> = (self, _f) => {
  switch (self) {
    case "Covariant":
      return "+";
    case "Contravariant":
      return "-";
    case "Invariant":
      return "o";
    case "Bivariant":
      return "*";
  }
};

export type UniverseIndex = gen.UniverseIndex;
export const UniverseIndex = {
  ...gen.UniverseIndex,

  ROOT: gen.UniverseIndex.ZERO,

  /// Returns the "next" universe index in order -- this new index
  /// is considered to extend all previous universes. This
  /// corresponds to entering a `forall` quantifier. So, for
  /// example, suppose we have this type in universe `U`:
  ///
  /// ```ignore (illustrative)
  /// for<'a> fn(&'a u32)
  /// ```
  ///
  /// Once we "enter" into this `for<'a>` quantifier, we are in a
  /// new universe that extends `U` -- in this new universe, we can
  /// name the region `'a`, but that region was not nameable from
  /// `U` because it was not in scope there.
  // rustc: compiler/rustc_type_ir/src/lib.rs:400 next_universe
  next_universe(self: gen.UniverseIndex): gen.UniverseIndex {
    const n = gen.UniverseIndex.as_u32(self) + 1;
    // `checked_add(1).unwrap()`
    if (n > 0xffff_ffff) panic("called `Option::unwrap()` on a `None` value");
    return gen.UniverseIndex.from_u32(n);
  },

  /// Returns `true` if `self` can name a name from `other` -- in other words,
  /// if the set of names in `self` is a superset of those in
  /// `other` (`self >= other`).
  // rustc: compiler/rustc_type_ir/src/lib.rs:407 can_name
  can_name(self: gen.UniverseIndex, other: gen.UniverseIndex): boolean {
    return self >= other;
  },

  /// Returns `true` if `self` cannot name some names from `other` -- in other
  /// words, if the set of names in `self` is a strict subset of
  /// those in `other` (`self < other`).
  // rustc: compiler/rustc_type_ir/src/lib.rs:414 cannot_name
  cannot_name(self: gen.UniverseIndex, other: gen.UniverseIndex): boolean {
    return self < other;
  },

  /// Returns `true` if `self` is the root universe, otherwise false.
  // rustc: compiler/rustc_type_ir/src/lib.rs:419 is_root
  is_root(self: gen.UniverseIndex): boolean {
    return self === UniverseIndex.ROOT;
  },

  // PORT: `impl Default for UniverseIndex` (tyir-kind decision 2: `default_()`).
  // rustc: compiler/rustc_type_ir/src/lib.rs:425 default
  default_(): gen.UniverseIndex {
    return UniverseIndex.ROOT;
  },
};

export type ClosureKind = gen.ClosureKind;
export const ClosureKind = {
  ...gen.ClosureKind,

  /// This is the initial value used when doing upvar inference.
  LATTICE_BOTTOM: "Fn" as gen.ClosureKind,

  // rustc: compiler/rustc_type_ir/src/lib.rs:457 as_str
  as_str(self: gen.ClosureKind): string {
    switch (self) {
      case "Fn":
        return "Fn";
      case "FnMut":
        return "FnMut";
      case "FnOnce":
        return "FnOnce";
    }
  },

  /// Returns `true` if a type that impls this closure kind
  /// must also implement `other`.
  // rustc: compiler/rustc_type_ir/src/lib.rs:468 extends
  extends(self: gen.ClosureKind, other: gen.ClosureKind): boolean {
    if (
      (self === "Fn" && (other === "Fn" || other === "FnMut" || other === "FnOnce"))
      || (self === "FnMut" && (other === "FnMut" || other === "FnOnce"))
      || (self === "FnOnce" && other === "FnOnce")
    ) {
      return true;
    }
    return false;
  },
};

// PORT: `self.as_str().fmt(f)`: `Display` returns the text (convention of `display_InferTy`); padding flags are
// not modelled.
// rustc: compiler/rustc_type_ir/src/lib.rs:480 fmt
export function display_ClosureKind(self: gen.ClosureKind): string {
  return ClosureKind.as_str(self);
}
