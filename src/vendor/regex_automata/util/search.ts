// Port of regex-automata 0.4.13 `src/util/search.rs` (the `Anchored` mode only).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: the target is little-endian (the oracle hosts aarch64 and x86_64 are), so `from_ne_bytes`
// reads little-endian. `StateID`/`PatternID` are `number`s (u32).

/// The type of anchored search to perform.
// #[derive(Clone, Copy, Debug, Eq, PartialEq)]
export type Anchored =
  /// Run an unanchored search. This means a match may occur anywhere at or
  /// after the start position of the search.
  ///
  /// This search can return a match for any pattern in the regex.
  | { readonly $: "No" }
  /// Run an anchored search. This means that a match must begin at the
  /// start position of the search.
  ///
  /// This search can return a match for any pattern in the regex.
  | { readonly $: "Yes" }
  /// Run an anchored search for a specific pattern. This means that a match
  /// must be for the given pattern and must begin at the start position of
  /// the search.
  | { readonly $: "Pattern"; readonly _0: number };
export const Anchored = {
  No: { $: "No" } as Anchored,
  Yes: { $: "Yes" } as Anchored,
};
