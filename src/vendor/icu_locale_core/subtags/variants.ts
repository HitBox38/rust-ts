// Port of icu_locale_core 2.3.0 `src/subtags/variants.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `ShortBoxSlice<Variant>` is a `Variant[]` (PORTING §5: SmallVec-like → `T[]`).
import { Ok, type Result } from "../../../std/result.ts";
import { EachSubtagWriteable, each_subtag_writeable_borrow } from "../helpers.ts";
import { binary_search_by } from "../../litemap/map.ts";
import type { Variant } from "./variant.ts";

/// A list of variants (examples: `["macos", "posix"]`, etc.)
///
/// [`Variants`] stores a list of [`Variant`] subtags in a canonical form
/// by sorting and deduplicating them.
// #[derive(Default, Debug, PartialEq, Eq, Clone, Hash, PartialOrd, Ord)]
export class Variants extends EachSubtagWriteable {
  constructor(public _0: Variant[]) {
    super();
  }

  /// Returns a new empty list of variants. Same as [`default()`](Default::default()), but is `const`.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:43 new
  static new(): Variants {
    return new Variants([]);
  }

  /// Creates a new [`Variants`] set from a single [`Variant`].
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:57 from_variant
  static from_variant(variant: Variant): Variants {
    return new Variants([variant]);
  }

  /// Creates a new [`Variants`] set from a [`Vec`].
  /// The caller is expected to provide sorted and deduplicated vector as
  /// an input.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:83 from_vec_unchecked
  static from_vec_unchecked(input: Variant[]): Variants {
    return new Variants(input);
  }

  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:88 from_short_slice_unchecked
  static from_short_slice_unchecked(input: Variant[]): Variants {
    return new Variants(input);
  }

  /// Empties the [`Variants`] list.
  ///
  /// Returns the old list.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:113 clear
  clear(): Variants {
    const old = this._0;
    this._0 = [];
    return new Variants(old);
  }

  /// Whether the list of variants is empty.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:118 is_empty
  is_empty(): boolean {
    return this._0.length === 0;
  }

  /// Pushes a [`Variant`] onto the [`Variants`] list, keeping the list sorted.
  ///
  /// Returns `true` if the variant was not already present.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:140 push
  push(variant: Variant): boolean {
    const r = binary_search_by(this._0, (x) => x.cmp(variant));
    if (r.$ === "Ok") {
      return false; // Already present
    } else {
      this._0.splice(r._0, 0, variant);
      return true;
    }
  }

  /// Removes a [`Variant`] from the [`Variants`] list.
  ///
  /// Returns `true` if the variant was present.
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:164 remove
  remove(variant: Variant): boolean {
    const r = binary_search_by(this._0, (x) => x.cmp(variant));
    if (r.$ === "Ok") {
      this._0.splice(r._0, 1);
      return true;
    } else {
      return false;
    }
  }

  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:174 for_each_subtag_str
  for_each_subtag_str<E>(f: (subtag: string) => Result<undefined, E>): Result<undefined, E> {
    for (const t of this.deref()) {
      const r = f(t.as_str());
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  }

  // impl_writeable_for_subtag_list!(Variants, "macos", "posix"): borrow when there is one variant.
  override writeable_borrow(): string | undefined {
    return each_subtag_writeable_borrow(this._0.length === 1, () => this._0[0]!.as_str());
  }

  // impl Deref for Variants
  // crate: icu_locale_core-2.3.0/src/subtags/variants.rs:187 deref
  deref(): readonly Variant[] {
    return this._0;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Variants): boolean {
    return this._0.length === other._0.length && this._0.every((v, i) => v.eq(other._0[i]!));
  }

  /** `#[derive(Ord)]`: lexicographic over the slice. */
  cmp(other: Variants): -1 | 0 | 1 {
    const n = Math.min(this._0.length, other._0.length);
    for (let i = 0; i < n; i++) {
      const c = this._0[i]!.cmp(other._0[i]!);
      if (c !== 0) return c;
    }
    return this._0.length === other._0.length ? 0 : this._0.length < other._0.length ? -1 : 1;
  }

  clone(): Variants {
    return new Variants(this._0.slice());
  }
}
