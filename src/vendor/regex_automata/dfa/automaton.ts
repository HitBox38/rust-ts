// Port of regex-automata 0.4.13 `src/dfa/automaton.rs` (`StartError` only; the `Automaton` trait's
// required methods are implemented directly on the sparse DFA, see sparse.ts).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).
import type { Anchored } from "../util/search.ts";

/// An error that can occur when computing the start state for a search.
// #[non_exhaustive] #[derive(Clone, Debug)]
export type StartError =
  /// An error that occurs when a starting configuration's look-behind byte is
  /// in this DFA's quit set.
  | { readonly $: "Quit"; readonly byte: number }
  /// An error that occurs when the caller requests an anchored mode that
  /// isn't supported by the DFA.
  | { readonly $: "UnsupportedAnchored"; readonly mode: Anchored };

export const StartError = {
  // crate: regex-automata-0.4.13/src/dfa/automaton.rs:2108 quit
  quit(byte: number): StartError {
    return { $: "Quit", byte };
  },

  // crate: regex-automata-0.4.13/src/dfa/automaton.rs:2112 unsupported_anchored
  unsupported_anchored(mode: Anchored): StartError {
    return { $: "UnsupportedAnchored", mode };
  },
};
