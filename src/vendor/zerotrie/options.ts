// Port of zerotrie 0.2.5 `src/options.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Options for building and reading from a ZeroTrie.
//!
//! These options are internal to the crate. A small selection of options
//! are exported by way of the different public types on this crate.

/// Whether to use the perfect hash function in the ZeroTrie.
// #[derive(Copy, Clone)]
export type PhfMode =
  /// Use binary search for all branch nodes.
  | "BinaryOnly"
  /// Use the perfect hash function for large branch nodes.
  | "UsePhf";

/// Whether to support non-ASCII data in the ZeroTrie.
// #[derive(Copy, Clone)]
export type AsciiMode =
  /// Support only ASCII, returning an error if non-ASCII is found.
  | "AsciiOnly"
  /// Support all data, creating span nodes for non-ASCII bytes.
  | "BinarySpans";

/// Whether to enforce a limit to the capacity of the ZeroTrie.
// #[derive(Copy, Clone)]
export type CapacityMode =
  /// Return an error if the trie requires a branch of more than 2^32 bytes.
  | "Normal"
  /// Construct the trie without returning an error.
  | "Extended";

/// How to handle strings with mixed ASCII case at a node, such as "abc" and "Abc"
// #[derive(Copy, Clone)]
export type CaseSensitivity =
  /// Allow all strings and sort them by byte value.
  | "Sensitive"
  /// Reject strings with different case and sort them as if `to_ascii_lowercase` is called.
  | "IgnoreCase";

// crate-skip: zerotrie-0.2.5/src/options.rs:21 to_u8_flag feature "serde" off
// crate-skip: zerotrie-0.2.5/src/options.rs:40 to_u8_flag feature "serde" off
// crate-skip: zerotrie-0.2.5/src/options.rs:59 to_u8_flag feature "serde" off
// crate-skip: zerotrie-0.2.5/src/options.rs:78 to_u8_flag feature "serde" off
// crate-skip: zerotrie-0.2.5/src/options.rs:96 to_u8_flags feature "serde" off

/// Options for building and reading from a ZeroTrie.
// #[derive(Copy, Clone)]
export interface ZeroTrieBuilderOptions {
  readonly phf_mode: PhfMode;
  readonly ascii_mode: AsciiMode;
  readonly capacity_mode: CapacityMode;
  readonly case_sensitivity: CaseSensitivity;
}

/// A trie type's `ZeroTrieWithOptions::OPTIONS`.
/// impl ZeroTrieWithOptions for crate::ZeroTrieSimpleAscii<S>
export const ZeroTrieSimpleAscii_OPTIONS: ZeroTrieBuilderOptions = {
  phf_mode: "BinaryOnly",
  ascii_mode: "AsciiOnly",
  capacity_mode: "Normal",
  case_sensitivity: "Sensitive",
};
/// impl ZeroTrieWithOptions for crate::ZeroAsciiIgnoreCaseTrie<S>
export const ZeroAsciiIgnoreCaseTrie_OPTIONS: ZeroTrieBuilderOptions = {
  phf_mode: "BinaryOnly",
  ascii_mode: "AsciiOnly",
  capacity_mode: "Normal",
  case_sensitivity: "IgnoreCase",
};
/// impl ZeroTrieWithOptions for crate::ZeroTriePerfectHash<S>
export const ZeroTriePerfectHash_OPTIONS: ZeroTrieBuilderOptions = {
  phf_mode: "UsePhf",
  ascii_mode: "BinarySpans",
  capacity_mode: "Normal",
  case_sensitivity: "Sensitive",
};
/// impl ZeroTrieWithOptions for crate::ZeroTrieExtendedCapacity<S>
export const ZeroTrieExtendedCapacity_OPTIONS: ZeroTrieBuilderOptions = {
  phf_mode: "UsePhf",
  ascii_mode: "BinarySpans",
  capacity_mode: "Extended",
  case_sensitivity: "Sensitive",
};
