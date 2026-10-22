//! As explained in [`crate::usefulness`], values and patterns are made from constructors applied to
//! fields. This file defines types that represent patterns in this way.
//
// Port of compiler/rustc_pattern_analysis/src/pat.rs (lane pat-b). Conventions: lib.ts header.
import { Constructor, ConstructorSet } from "./constructor.ts";
import type { PatCx, PatCxStatic, PatCxTypes } from "./lib.ts";
import type { FxHasher } from "../vendor/rustc_hash/lib.ts";
import { type Debug, debug_int, debug_tuple, type Fmt } from "../std/fmt.ts";

// use self::Constructor::*;

/// A globally unique id to distinguish patterns.
// #[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
// rustc-type: compiler/rustc_pattern_analysis/src/pat.rs:14 PatId
export type PatId = number & { readonly __brand: "rustc_pattern_analysis::PatId" };
/** `static PAT_ID: AtomicU32` (the counter of `PatId::new`). */
let PAT_ID = 0;
export const PatId = {
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:16 new
  new(): PatId {
    // use std::sync::atomic::{AtomicU32, Ordering};
    // static PAT_ID: AtomicU32 = AtomicU32::new(0);
    return PAT_ID++ as PatId;
  },
};
/** The derived `Debug` of `PatId`. */
export const debug_PatId: Debug<PatId> = (v, f) => debug_tuple(f, "PatId", [debug_int(v, f)]);

/// A pattern with an index denoting which field it corresponds to.
// rustc-type: compiler/rustc_pattern_analysis/src/pat.rs:24 IndexedPat
export interface IndexedPat<Cx extends PatCxTypes> {
  readonly idx: number;
  readonly pat: DeconstructedPat<Cx>;
}

/// Values and patterns can be represented as a constructor applied to some fields. This represents
/// a pattern in this form. A `DeconstructedPat` will almost always come from user input; the only
/// exception are some `Wildcard`s introduced during pattern lowering.
// PORT: the private fields `ctor` / `ty` / `data` / `arity` are `ctor_` / `ty_` / `data_` / `arity_`: the getters
// `ctor()` / `ty()` / `data()` / `arity()` have the same names.
// rustc-type: compiler/rustc_pattern_analysis/src/pat.rs:32 DeconstructedPat
export class DeconstructedPat<Cx extends PatCxTypes = PatCxTypes> {
  constructor(
    readonly ctor_: Constructor<Cx>,
    readonly fields: readonly IndexedPat<Cx>[],
    /// The number of fields in this pattern. E.g. if the pattern is `SomeStruct { field12: true, ..
    /// }` this would be the total number of fields of the struct.
    /// This is also the same as `self.ctor.arity(self.ty)`.
    readonly arity_: number,
    readonly ty_: Cx["Ty"],
    /// Extra data to store in a pattern.
    readonly data_: Cx["PatData"],
    /// Globally-unique id used to track usefulness at the level of subpatterns.
    readonly uid: PatId,
  ) {}

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:47 new
  static new<Cx extends PatCxTypes>(
    ctor: Constructor<Cx>,
    fields: IndexedPat<Cx>[],
    arity: number,
    ty: Cx["Ty"],
    data: Cx["PatData"],
  ): DeconstructedPat<Cx> {
    return new DeconstructedPat(ctor, fields, arity, ty, data, PatId.new());
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:57 at_index
  at_index(idx: number): IndexedPat<Cx> {
    return { idx, pat: this };
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:61 is_or_pat
  is_or_pat(): boolean {
    return this.ctor_.$ === "Or";
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:65 ctor
  ctor(): Constructor<Cx> {
    return this.ctor_;
  }
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:68 ty
  ty(): Cx["Ty"] {
    return this.ty_;
  }
  /// Returns the extra data stored in a pattern.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:72 data
  data(): Cx["PatData"] {
    return this.data_;
  }
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:75 arity
  arity(): number {
    return this.arity_;
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:79 iter_fields
  iter_fields(): readonly IndexedPat<Cx>[] {
    return this.fields;
  }

  /// Specialize this pattern with a constructor.
  /// `other_ctor` can be different from `self.ctor`, but must be covered by it.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:85 specialize
  specialize(other_ctor: Constructor<Cx>, other_ctor_arity: number): PatOrWild<Cx>[] {
    if (other_ctor.$ === "PrivateUninhabited") {
      // Skip this column.
      return [];
    }

    // Start with a slice of wildcards of the appropriate length.
    const fields: PatOrWild<Cx>[] = [];
    for (let i = 0; i < other_ctor_arity; i++) fields.push(PatOrWild.Wild);
    // Fill `fields` with our fields. The arities are known to be compatible.
    const ctor = this.ctor_;
    // The only non-trivial case: two slices of different arity. `other_ctor` is guaranteed
    // to have a larger arity, so we adjust the indices of the patterns in the suffix so
    // that they are correctly positioned in the larger slice.
    if (ctor.$ === "Slice" && ctor._0.kind.$ === "VarLen" && this.arity_ !== other_ctor_arity) {
      const prefix = ctor._0.kind._0;
      for (const ipat of this.fields) {
        const new_idx =
          ipat.idx < prefix
            ? ipat.idx
            : // Adjust the indices in the suffix.
              ipat.idx + other_ctor_arity - this.arity_;
        fields[new_idx] = { $: "Pat", _0: ipat.pat };
      }
    } else {
      for (const ipat of this.fields) {
        fields[ipat.idx] = { $: "Pat", _0: ipat.pat };
      }
    }
    return fields;
  }

  /// Walk top-down and call `it` in each place where a pattern occurs
  /// starting with the root pattern `walk` is called on. If `it` returns
  /// false then we will descend no further but siblings will be processed.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:127 walk
  walk(it: (pat: DeconstructedPat<Cx>) => boolean): void {
    if (!it(this)) {
      return;
    }

    for (const p of this.iter_fields()) {
      p.pat.walk(it);
    }
  }

  /// Delegate to `uid`.
  // impl<Cx: PatCx> PartialEq for DeconstructedPat<Cx>
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:151 eq
  eq(other: DeconstructedPat<Cx>): boolean {
    return this.uid === other.uid;
  }

  /// Delegate to `uid`.
  // impl<Cx: PatCx> std::hash::Hash for DeconstructedPat<Cx>
  // PORT: as a `Map` / `Set` key the object itself is used (one object per `uid`); this is for hashers.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:159 hash
  hash(state: Pick<FxHasher, "write_u32">): void {
    // `PatId(u32)`'s derived `Hash`
    state.write_u32(this.uid);
  }
}

/// This is best effort and not good enough for a `Display` impl.
// impl<Cx: PatCx> fmt::Debug for DeconstructedPat<Cx>
// PORT: `cx` is the static side of `Cx` (lib.ts header).
// rustc: compiler/rustc_pattern_analysis/src/pat.rs:140 fmt
export function debug_DeconstructedPat<Cx extends PatCxTypes>(cx: PatCxStatic<Cx>): Debug<DeconstructedPat<Cx>> {
  const debug_pat_or_wild = debug_PatOrWild(cx);
  return (self, f) => {
    const fields: PatOrWild<Cx>[] = [];
    for (let i = 0; i < self.arity_; i++) fields.push(PatOrWild.Wild);
    for (const ipat of self.iter_fields()) {
      fields[ipat.idx] = { $: "Pat", _0: ipat.pat };
    }
    return Constructor.fmt_fields(self.ctor(), f, self.ty(), fields, debug_pat_or_wild, cx);
  };
}

/// Represents either a pattern obtained from user input or a wildcard constructed during the
/// algorithm. Do not use `Wild` to represent a wildcard pattern comping from user input.
///
/// This is morally `Option<&'p DeconstructedPat>` where `None` is interpreted as a wildcard.
// rustc-type: compiler/rustc_pattern_analysis/src/pat.rs:168 PatOrWild
export type PatOrWild<Cx extends PatCxTypes> =
  /// A non-user-provided wildcard, created during specialization.
  | { readonly $: "Wild" }
  /// A user-provided pattern.
  | { readonly $: "Pat"; readonly _0: DeconstructedPat<Cx> };

export const PatOrWild = {
  Wild: Object.freeze({ $: "Wild" } as const) as PatOrWild<never>,

  // impl<'p, Cx: PatCx> Clone for PatOrWild<'p, Cx> (and `Copy`)
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:176 clone
  clone<Cx extends PatCxTypes>(self: PatOrWild<Cx>): PatOrWild<Cx> {
    // `*self`. PORT: a `PatOrWild` is never written in place, so the copy is the value itself.
    return self;
  },

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:184 as_pat
  as_pat<Cx extends PatCxTypes>(self: PatOrWild<Cx>): DeconstructedPat<Cx> | undefined {
    switch (self.$) {
      case "Wild":
        return undefined;
      case "Pat":
        return self._0;
    }
  },
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:190 ctor
  ctor<Cx extends PatCxTypes>(self: PatOrWild<Cx>): Constructor<Cx> {
    switch (self.$) {
      case "Wild":
        return Constructor.Wildcard;
      case "Pat":
        return self._0.ctor();
    }
  },

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:197 is_or_pat
  is_or_pat<Cx extends PatCxTypes>(self: PatOrWild<Cx>): boolean {
    switch (self.$) {
      case "Wild":
        return false;
      case "Pat":
        return self._0.is_or_pat();
    }
  },

  /// Expand this or-pattern into its alternatives. This only expands one or-pattern; use
  /// `flatten_or_pat` to recursively expand nested or-patterns.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:206 expand_or_pat
  expand_or_pat<Cx extends PatCxTypes>(self: PatOrWild<Cx>): PatOrWild<Cx>[] {
    if (self.$ === "Pat" && self._0.is_or_pat()) {
      return self._0.iter_fields().map((ipat): PatOrWild<Cx> => ({ $: "Pat", _0: ipat.pat }));
    }
    return [self];
  },

  /// Recursively expand this (possibly-nested) or-pattern into its alternatives.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:216 flatten_or_pat
  flatten_or_pat<Cx extends PatCxTypes>(self: PatOrWild<Cx>): PatOrWild<Cx>[] {
    if (self.$ === "Pat" && self._0.is_or_pat()) {
      return self._0.iter_fields().flatMap((ipat) => PatOrWild.flatten_or_pat<Cx>({ $: "Pat", _0: ipat.pat }));
    }
    return [self];
  },

  /// Specialize this pattern with a constructor.
  /// `other_ctor` can be different from `self.ctor`, but must be covered by it.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:228 specialize
  specialize<Cx extends PatCxTypes>(self: PatOrWild<Cx>, other_ctor: Constructor<Cx>, ctor_arity: number): PatOrWild<Cx>[] {
    switch (self.$) {
      case "Wild": {
        const v: PatOrWild<Cx>[] = [];
        for (let i = 0; i < ctor_arity; i++) v.push(PatOrWild.Wild);
        return v;
      }
      case "Pat":
        return self._0.specialize(other_ctor, ctor_arity);
    }
  },
};

// impl<'p, Cx: PatCx> fmt::Debug for PatOrWild<'p, Cx>
// PORT: `cx` is the static side of `Cx` (lib.ts header).
// rustc: compiler/rustc_pattern_analysis/src/pat.rs:241 fmt
export function debug_PatOrWild<Cx extends PatCxTypes>(cx: PatCxStatic<Cx>): Debug<PatOrWild<Cx>> {
  return (self, f) => {
    switch (self.$) {
      case "Wild":
        return "_";
      case "Pat":
        return debug_DeconstructedPat(cx)(self._0, f);
    }
  };
}

/// Same idea as `DeconstructedPat`, except this is a fictitious pattern built up for diagnostics
/// purposes. As such they don't use interning and can be cloned.
// PORT: the private fields `ctor` / `ty` are `ctor_` / `ty_`: the getters `ctor()` / `ty()` have the same names.
// rustc-type: compiler/rustc_pattern_analysis/src/pat.rs:251 WitnessPat
export class WitnessPat<Cx extends PatCxTypes = PatCxTypes> {
  constructor(
    readonly ctor_: Constructor<Cx>,
    public fields: WitnessPat<Cx>[],
    readonly ty_: Cx["Ty"],
  ) {}

  // impl<Cx: PatCx> Clone for WitnessPat<Cx>
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:258 clone
  clone(): WitnessPat<Cx> {
    // PORT: `self.ty.clone()` is the identity (lib.ts header).
    return new WitnessPat(
      Constructor.clone(this.ctor_),
      this.fields.map((p) => p.clone()),
      this.ty_,
    );
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:264 new
  static new<Cx extends PatCxTypes>(ctor: Constructor<Cx>, fields: WitnessPat<Cx>[], ty: Cx["Ty"]): WitnessPat<Cx> {
    return new WitnessPat(ctor, fields, ty);
  }
  /// Create a wildcard pattern for this type. If the type is empty, we create a `!` pattern.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:268 wildcard
  static wildcard<Cx extends PatCxTypes>(cx: PatCx<Cx>, ty: Cx["Ty"]): WitnessPat<Cx> {
    // `cx.ctors_for_ty(&ty).is_ok_and(|ctors| ctors.all_empty())`
    const ctors = cx.ctors_for_ty(ty);
    const is_empty = ctors.$ === "Ok" && ConstructorSet.all_empty(ctors._0);
    const ctor = is_empty ? Constructor.Never : Constructor.Wildcard;
    return WitnessPat.new<Cx>(ctor, [], ty);
  }

  /// Construct a pattern that matches everything that starts with this constructor.
  /// For example, if `ctor` is a `Constructor::Variant` for `Option::Some`, we get the pattern
  /// `Some(_)`.
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:277 wild_from_ctor
  static wild_from_ctor<Cx extends PatCxTypes>(cx: PatCx<Cx>, ctor: Constructor<Cx>, ty: Cx["Ty"]): WitnessPat<Cx> {
    if (ctor.$ === "Wildcard") {
      return WitnessPat.wildcard(cx, ty);
    }
    const fields: WitnessPat<Cx>[] = [];
    for (const [sub_ty, { _0: skip }] of cx.ctor_sub_tys(ctor, ty)) {
      if (skip) continue;
      fields.push(WitnessPat.wildcard(cx, sub_ty));
    }
    return WitnessPat.new(ctor, fields, ty);
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:289 ctor
  ctor(): Constructor<Cx> {
    return this.ctor_;
  }
  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:292 ty
  ty(): Cx["Ty"] {
    return this.ty_;
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:296 is_never_pattern
  is_never_pattern(): boolean {
    switch (this.ctor().$) {
      case "Never":
        return true;
      case "Or":
        return this.fields.every((p) => p.is_never_pattern());
      default:
        return this.fields.some((p) => p.is_never_pattern());
    }
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat.rs:304 iter_fields
  iter_fields(): readonly WitnessPat<Cx>[] {
    return this.fields;
  }
}

/// This is best effort and not good enough for a `Display` impl.
// impl<Cx: PatCx> fmt::Debug for WitnessPat<Cx>
// PORT: `cx` is the static side of `Cx` (lib.ts header).
// rustc: compiler/rustc_pattern_analysis/src/pat.rs:311 fmt
export function debug_WitnessPat<Cx extends PatCxTypes>(cx: PatCxStatic<Cx>): Debug<WitnessPat<Cx>> {
  const debug: Debug<WitnessPat<Cx>> = (self: WitnessPat<Cx>, f: Fmt): string =>
    Constructor.fmt_fields(self.ctor(), f, self.ty(), self.fields, debug, cx);
  return debug;
}
