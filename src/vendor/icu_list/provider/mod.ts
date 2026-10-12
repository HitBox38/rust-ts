// Port of icu_list 2.3.0 `src/provider/mod.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

// Provider structs must be stable
//! 🚧 \[Unstable\] Data provider struct definitions for this ICU4X component.
//!
//! <div class="stab unstable">
//! 🚧 This code is considered unstable; it may change at any time, in breaking or non-breaking ways,
//! including in SemVer minor releases. While the serde representation of data structs is guaranteed
//! to be stable, their Rust representation might not be. Use with caution.
//! </div>
//!
//! Read more about data providers: [`icu_provider`]
import { DataMarkerAttributes } from "../../icu_provider/request.ts";
import { data_marker } from "../../icu_provider/marker.ts";
import { SerdeDFA } from "./serde_dfa.ts";

// mod serde_dfa;
export { SerdeDFA } from "./serde_dfa.ts";

// #[cfg(feature = "compiled_data")] pub struct Baked; (+ impl_list_*_v1!(Baked)):
// the `compiled_data` feature is off in rustc's build (rustc uses rustc_baked_icu_data instead).

// #[cfg(feature = "datagen")] pub const MARKERS: &[DataMarkerInfo] (feature off)

// data_marker!(
/// Marker for and lists
export const ListAndV1 = data_marker<ListFormatterPatterns>("ListAndV1");
/// Marker for or lists
export const ListOrV1 = data_marker<ListFormatterPatterns>("ListOrV1");
/// Marker for unit lists
export const ListUnitV1 = data_marker<ListFormatterPatterns>("ListUnitV1");

// icu_provider::data_struct!(ListFormatterPatterns<'_>, #[cfg(feature = "datagen")]);

/// Symbols and metadata required for [`ListFormatter`](crate::ListFormatter).
///
/// <div class="stab unstable">
/// 🚧 This code is considered unstable; it may change at any time, in breaking or non-breaking ways,
/// including in SemVer minor releases. While the serde representation of data structs is guaranteed
/// to be stable, their Rust representation might not be. Use with caution.
/// </div>
// #[derive(Clone, Debug, PartialEq, yoke::Yokeable, zerofrom::ZeroFrom)]
export class ListFormatterPatterns {
  constructor(
    /// The start pattern
    public start: ListJoinerPattern,
    /// The middle pattern. It doesn't need to be a pattern because it has to start with `{0}`
    /// and end with `{1}`, so we just store the string in between.
    // PORT: `VarZeroCow<'data, str>` is a string.
    public middle: string,
    /// The end pattern
    public end: ConditionalListJoinerPattern,
    /// The pair pattern, if it's different from the end pattern.
    public pair: ConditionalListJoinerPattern | undefined,
  ) {}

  /// The marker attributes for narrow lists
  static readonly NARROW: DataMarkerAttributes = DataMarkerAttributes.from_str_or_panic("N");
  // #[doc(hidden)]
  static readonly NARROW_STR: string = ListFormatterPatterns.NARROW.as_str();
  /// The marker attributes for short lists
  static readonly SHORT: DataMarkerAttributes = DataMarkerAttributes.from_str_or_panic("S");
  // #[doc(hidden)]
  static readonly SHORT_STR: string = ListFormatterPatterns.SHORT.as_str();
  /// The marker attributes for wide lists
  static readonly WIDE: DataMarkerAttributes = DataMarkerAttributes.from_str_or_panic("W");
  // #[doc(hidden)]
  static readonly WIDE_STR: string = ListFormatterPatterns.WIDE.as_str();
}

/// A pattern that can behave conditionally on the next element.
// #[derive(Clone, Debug, PartialEq, yoke::Yokeable, zerofrom::ZeroFrom)]
export class ConditionalListJoinerPattern {
  /// The default pattern
  default: ListJoinerPattern;

  constructor(
    default_: ListJoinerPattern,
    /// And optional special case
    public special_case: SpecialCasePattern | undefined,
  ) {
    this.default = default_;
  }
}

/// The special case of a [`ConditionalListJoinerPattern`]
// #[derive(Clone, Debug, PartialEq, yoke::Yokeable, zerofrom::ZeroFrom)]
export class SpecialCasePattern {
  constructor(
    /// The condition on the following element
    public condition: SerdeDFA,
    /// The pattern if the condition matches
    public pattern: ListJoinerPattern,
  ) {}
}

// crate-skip: icu_list-2.3.0/src/provider/mod.rs:161 deserialize_option feature "serde" off

/// A pattern containing two numeric placeholders ("{0}, and {1}.")
// #[derive(Clone, Debug, PartialEq, yoke::Yokeable, zerofrom::ZeroFrom)]
export class ListJoinerPattern {
  constructor(
    /// The pattern string without the placeholders
    // PORT: `VarZeroCow<'data, str>` is a string; `index_0`/`index_1` are UTF-8 byte offsets into it.
    public string: string,
    /// The index of the first placeholder. Always `<= index_1`.
    // Always 0 for CLDR data, so we don't need to serialize it.
    // In-memory we have free space for it as index_1 doesn't
    // fill a word.
    public index_0: number,
    /// The index of the second placeholder. Always `< string.len()`.
    public index_1: number,
  ) {}

  // crate-skip: icu_list-2.3.0/src/provider/mod.rs:214 deserialize feature "serde" off

  /// Constructs a [`ListJoinerPattern`] from raw parts. Used by databake.
  ///
  /// # Panics
  /// If `string[..index_1]` panics.
  // crate: icu_list-2.3.0/src/provider/mod.rs:244 from_parts
  static from_parts(string: string, index_1: number): ListJoinerPattern {
    return new ListJoinerPattern(string, 0, index_1);
  }

  // crate-skip: icu_list-2.3.0/src/provider/mod.rs:255 bake feature "datagen" off
  // crate-skip: icu_list-2.3.0/src/provider/mod.rs:267 borrows_size feature "datagen" off
}

// crate-skip: icu_list-2.3.0/src/provider/mod.rs:274 databake #[cfg(all(test, feature = "datagen"))]
