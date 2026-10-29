// Port of polonius-engine =0.13.0 `src/lib.rs` (the version in upstream's Cargo.lock; rustc_borrowck's legacy
// Polonius, `-Zpolonius=legacy`, builds `AllFacts` and runs `Output::compute`).
//
// PORT: `extern crate log` (the `debug!` / `info!` / `error!` macros) has no output in rustc (no logger is
// installed for this crate), so those calls stay comments. `extern crate rustc_hash` (1.1.0): its
// `FxHashMap` / `FxHashSet` are JS `Map` / `Set` (see output/mod.ts).
//
/// Contains the core of the Polonius borrow checking engine.
/// Input is fed in via AllFacts, and outputs are returned via Output
// extern crate datafrog;
// #[macro_use]
// extern crate log;
// extern crate rustc_hash;

// mod facts;
// mod output;

// Reexports of facts
export { AllFacts, type Atom, type FactTypes } from "./facts.ts";
export { Algorithm, debug_Algorithm, Output } from "./output/mod.ts";
