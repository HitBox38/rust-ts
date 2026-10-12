// Port of icu_list 2.3.0 `src/options.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Options used by types in this crate

/// A list of options set by the developer to adjust the behavior of the [`ListFormatter`](super::ListFormatter).
// #[derive(Debug, Clone, Copy, PartialEq, Eq)] #[non_exhaustive]
export class ListFormatterOptions {
  constructor(
    /// The length variant should reflect available space for the list.
    public length: ListLength | undefined,
  ) {}

  // impl Default for ListFormatterOptions
  // crate: icu_list-2.3.0/src/options.rs:23 default
  static default_trait(): ListFormatterOptions {
    return ListFormatterOptions.default();
  }

  /// Constructs a new [`ListFormatterOptions`] struct.
  // crate: icu_list-2.3.0/src/options.rs:30 default
  static default(): ListFormatterOptions {
    return new ListFormatterOptions(undefined);
  }

  /// Auguments the struct with the set [`ListLength`].
  // crate: icu_list-2.3.0/src/options.rs:35 with_length
  with_length(length: ListLength): ListFormatterOptions {
    // `mut self` (Copy)
    return new ListFormatterOptions(length);
  }
}

/// Represents the style of a list. See the
/// [CLDR spec](https://unicode.org/reports/tr35/tr35-general.html#ListPatterns)
/// for an explanation of the different styles.
// #[derive(Copy, Clone, PartialEq, Eq, Debug, Hash, Default)] #[non_exhaustive]
export type ListLength =
  /// A typical list
  | "Wide"
  /// A shorter list
  | "Short"
  /// The shortest type of list
  | "Narrow";
// *Important*: When adding a variant here, make sure the code in
// ListFormatterPatterns::{start, middle, end, pair} stays panic-free!
export const ListLength = {
  Wide: "Wide",
  Short: "Short",
  Narrow: "Narrow",
  /** `#[default]` */
  default(): ListLength {
    return "Wide";
  },
} as const;
