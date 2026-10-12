// Port of zerotrie 0.2.5 `src/lib.rs` (subset: reading `ZeroTrieSimpleAscii` baked stores).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! A data structure offering zero-copy storage and retrieval of byte strings, with a focus
//! on the efficient storage of ASCII strings. Strings are mapped to `usize` values.
//!
//! (Examples and details of upstream's crate docs are not repeated here.)
export { type AsciiProbeResult, ZeroTrieSimpleAsciiCursor } from "./cursor.ts";
export { ZeroTrieSimpleAscii } from "./zerotrie.ts";
