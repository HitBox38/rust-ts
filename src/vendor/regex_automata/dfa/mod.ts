// Port of regex-automata 0.4.13 `src/dfa/mod.rs` (the `DEAD` state id).
//
// Copyright (c) 2015 The Rust Project Developers; licensed under MIT OR Apache-2.0 (regex-automata).
//
// PORT: `StateID`/`PatternID` are `number`s (u32).

/// The special "dead" state that every DFA has. It is always the first state
/// (ID 0), and transitions to it are omitted in sparse DFAs.
// const DEAD: crate::util::primitives::StateID = crate::util::primitives::StateID::ZERO;
export const DEAD = 0;
