//! Sequence-related functionality
//!
//! This module provides:
//!
//! *   [`IndexedRandom`] for sampling slices and other indexable lists
//! *   [`IndexedMutRandom`] for sampling slices and other mutably indexable lists
//! *   [`SliceRandom`] for mutating slices
//! *   [`IteratorRandom`] for sampling iterators
//! *   [`index::sample`] low-level API to choose multiple indices from
//!     `0..length`
//!
//! In order to make results reproducible across 32-64 bit architectures, all
//! `usize` indices are sampled as a `u32` where possible (also providing a
//! small performance boost in some cases).
//
// Port of rand =0.10.1 `src/seq/mod.rs` (the parts behind the ported submodules; `index` is not ported).
export { IteratorRandom, iter_nth, type RustIterator } from "./iterator.ts";
export { choose, IndexedRandom_provided, IndexedRandom_slice, SliceRandom, type IndexedRandom } from "./slice.ts";
