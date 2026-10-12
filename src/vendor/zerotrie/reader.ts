// Port of zerotrie 0.2.5 `src/reader.rs` (lookups; the iterators are not ported).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! # Internal layout of ZeroTrie
//!
//! A ZeroTrie is composed of a series of nodes stored in sequence in a byte slice.
//!
//! There are 4 types of nodes:
//!
//! 1. ASCII (`0xxxxxxx`): matches a literal ASCII byte.
//! 2. Span (`101xxxxx`): matches a span of non-ASCII bytes.
//! 3. Value (`100xxxxx`): associates a value with a string
//! 4. Branch (`11xxxxxx`): matches one of a set of bytes.
//!
//! (The layout details and examples of upstream's module docs are not repeated here.)
import { unported } from "../../std/panic.ts";
import { binary_search_by } from "../litemap/map.ts";
import { u8_to_ascii_lowercase } from "../tinystr/asciibyte.ts";
import type { AsciiProbeResult } from "./cursor.ts";
import { debug_split_at, debug_unwrap_or } from "./helpers.ts";
import type { ZeroTrieBuilderOptions } from "./options.ts";
import { read_varint_meta2, read_varint_meta3 } from "./varint.ts";

const cmp_u8 = (a: number, b: number): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

/// Given a slice starting with an offset table, returns the trie for the given index.
///
/// Arguments:
/// - `trie` = a trie pointing at an offset table (after the branch node and search table)
/// - `i` = the desired index within the offset table
/// - `n` = the number of items in the offset table
/// - `w` = the width of the offset table items minus one
// crate: zerotrie-0.2.5/src/reader.rs:224 get_branch
function get_branch(trie: Uint8Array, i: number, n: number, w: number): Uint8Array {
  let p = 0;
  let q = 0;
  for (;;) {
    let indices: Uint8Array;
    [indices, trie] = debug_split_at(trie, n - 1);
    p = p * 256 + (i === 0 ? 0 : debug_unwrap_or(indices[i - 1], 0));
    const x = indices[i];
    q = x !== undefined ? q * 256 + x : trie.length;
    if (w === 0) {
      break;
    }
    w -= 1;
  }
  return debug_unwrap_or(p <= q && q <= trie.length ? trie.subarray(p, q) : undefined, new Uint8Array(0));
}

/// Version of [`get_branch()`] specialized for the case `w == 0` for performance
// crate: zerotrie-0.2.5/src/reader.rs:250 get_branch_w0
function get_branch_w0(trie: Uint8Array, i: number, n: number): Uint8Array {
  let indices: Uint8Array;
  [indices, trie] = debug_split_at(trie, n - 1);
  const p = i === 0 ? 0 : debug_unwrap_or(indices[i - 1], 0);
  const x = indices[i];
  const q = x !== undefined ? x : trie.length;
  return debug_unwrap_or(p <= q && q <= trie.length ? trie.subarray(p, q) : undefined, new Uint8Array(0));
}

/// The node type. See the module-level docs for more explanation of the four node types.
type NodeType =
  /// An ASCII node. Contains a single literal ASCII byte and no varint.
  | "Ascii"
  /// A span node. Contains a varint indicating how big the span is.
  | "Span"
  /// A value node. Contains a varint representing the value.
  | "Value"
  /// A branch node. Contains a varint of the number of output nodes, plus W in the high bits.
  | "Branch";

// impl core::fmt::Debug for NodeType
// crate: zerotrie-0.2.5/src/reader.rs:278 fmt
export function debug_NodeType(v: NodeType): string {
  switch (v) {
    case "Ascii":
      return "a";
    case "Span":
      return "s";
    case "Value":
      return "v";
    case "Branch":
      return "m";
  }
}

// crate: zerotrie-0.2.5/src/reader.rs:290 byte_type
function byte_type(b: number): NodeType {
  switch (b & 0b11100000) {
    case 0b10000000:
      return "Value";
    case 0b10100000:
      return "Span";
    case 0b11000000:
      return "Branch";
    case 0b11100000:
      return "Branch";
    default:
      return "Ascii";
  }
}

// crate: zerotrie-0.2.5/src/reader.rs:301 get_parameterized
export function get_parameterized(OPTIONS: ZeroTrieBuilderOptions, trie: Uint8Array, ascii: Uint8Array): number | undefined {
  for (;;) {
    if (trie.length === 0) return undefined;
    const b = trie[0]!;
    trie = trie.subarray(1);
    const bt = byte_type(b);
    let x: number;
    switch (bt) {
      case "Ascii":
        x = 0;
        break;
      case "Span":
        if (OPTIONS.ascii_mode === "BinarySpans") {
          [x, trie] = read_varint_meta3(b, trie);
        } else {
          // debug_assert!(false, "Span node found in ASCII trie!");
          return undefined;
        }
        break;
      case "Value":
        [x, trie] = read_varint_meta3(b, trie);
        break;
      case "Branch":
        [x, trie] = read_varint_meta2(b, trie);
        break;
    }
    if (ascii.length !== 0) {
      const c = ascii[0]!;
      const temp = ascii.subarray(1);
      if (bt === "Ascii") {
        const is_match = OPTIONS.case_sensitivity === "IgnoreCase" ? u8_to_ascii_lowercase(b) === u8_to_ascii_lowercase(c) : b === c;
        if (is_match) {
          // Matched a byte
          ascii = temp;
          continue;
        } else {
          // Byte that doesn't match
          return undefined;
        }
      }
      if (bt === "Value") {
        // Value node, but not at end of string
        continue;
      }
      if (OPTIONS.ascii_mode === "BinarySpans" && bt === "Span") {
        let trie_span: Uint8Array;
        [trie_span, trie] = debug_split_at(trie, x);
        if (x > ascii.length) return undefined;
        const ascii_span = ascii.subarray(0, x);
        ascii = ascii.subarray(x);
        if (trie_span.length === ascii_span.length && trie_span.every((v, i) => v === ascii_span[i])) {
          // Matched a byte span
          continue;
        } else {
          // Byte span that doesn't match
          return undefined;
        }
      }
      // Branch node
      let w: number;
      [x, w] = x >= 256 ? [x & 0xff, x >>> 8] : [x, 0];
      // https://github.com/rust-lang/rust-clippy/issues/11285
      if (OPTIONS.capacity_mode !== "Extended") {
        // See comment regarding this assertion in macros_reader.rs
        // debug_assert!(w <= 3, "get: w > 3 but we assume w <= 3");
        w = w & 0x3;
      }
      x = x === 0 ? 256 : x;
      let i: number;
      if (OPTIONS.phf_mode === "BinaryOnly" || x < 16) {
        // binary search
        let search: Uint8Array;
        [search, trie] = debug_split_at(trie, x);
        const bsearch_result =
          OPTIONS.case_sensitivity === "IgnoreCase"
            ? binary_search_by([...search], (y) => cmp_u8(u8_to_ascii_lowercase(y), u8_to_ascii_lowercase(c)))
            : binary_search_by([...search], (y) => cmp_u8(y, c));
        if (bsearch_result.$ === "Err") return undefined;
        i = bsearch_result._0;
      } else {
        // phf
        return unported("zerotrie::byte_phf::PerfectByteHashMap::get");
      }
      trie = w === 0 ? get_branch_w0(trie, i, x) : get_branch(trie, i, x, w);
      ascii = temp;
      continue;
    } else {
      if (bt === "Value") {
        // Value node at end of string
        return x;
      }
      return undefined;
    }
  }
}

// DISCUSS: This function is 7% faster *on aarch64* if we assert a max on w.
//
// | Bench         | No Assert, x86_64 | No Assert, aarch64 | Assertion, x86_64 | Assertion, aarch64 |
// |---------------|-------------------|--------------------|-------------------|--------------------|
// | basic         | ~187.51 ns        | ~97.586 ns         | ~199.11 ns        | ~99.236 ns         |
// | subtags_10pct | ~9.5557 µs        | ~4.8696 µs         | ~9.5779 µs        | ~4.5649 µs         |
// | subtags_full  | ~137.75 µs        | ~76.016 µs         | ~142.02 µs        | ~70.254 µs         |

/// Steps one node into the trie assuming all branch nodes are binary search and that
/// there are no span nodes.
///
/// The input-output argument `trie` starts at the original trie and ends pointing to
/// the sub-trie reachable by `c`.
///
/// PORT: `trie: &mut &[u8]` is a `{ value }` cell (PORTING §8 `MutRef`).
// crate: zerotrie-0.2.5/src/reader.rs:415 step_parameterized
export function step_parameterized(OPTIONS: ZeroTrieBuilderOptions, trie: { value: Uint8Array }, c: number): number | undefined {
  // Currently, the only option that step_parameterized supports is case-insensitivity.
  // debug_assert!(matches!(T::OPTIONS.ascii_mode, AsciiMode::AsciiOnly), "Spans not yet implemented in step function");
  // debug_assert!(matches!(T::OPTIONS.phf_mode, PhfMode::BinaryOnly), "PHF not yet implemented in step function");
  // debug_assert!(matches!(T::OPTIONS.capacity_mode, CapacityMode::Normal), "Extended capacity not yet implemented in step function");
  let b: number;
  let x: number;
  for (;;) {
    if (trie.value.length === 0) {
      // Empty trie or only a value node
      return undefined;
    }
    b = trie.value[0]!;
    trie.value = trie.value.subarray(1);
    const bt = byte_type(b);
    if (bt === "Ascii") {
      const is_match = OPTIONS.case_sensitivity === "IgnoreCase" ? u8_to_ascii_lowercase(b) === u8_to_ascii_lowercase(c) : b === c;
      if (is_match) {
        // Matched a byte
        return b;
      } else {
        // Byte that doesn't match
        trie.value = new Uint8Array(0);
        return undefined;
      }
    } else if (bt === "Branch") {
      // Proceed to the branch node logic below
      [x, trie.value] = read_varint_meta2(b, trie.value);
      break;
    } else if (bt === "Span") {
      // Question: Should we put the trie back into a valid state?
      // Currently this code is unreachable so let's not worry about it.
      // debug_assert!(false, "Span node found in ASCII trie!");
      return undefined;
    } else {
      // Skip the value node and go to the next node
      [, trie.value] = read_varint_meta3(b, trie.value);
      continue;
    }
  }
  // Branch node
  let w: number;
  [x, w] = x >= 256 ? [x & 0xff, x >>> 8] : [x, 0];
  // See comment regarding this assertion in macros_reader.rs
  // debug_assert!(w <= 3, "get: w > 3 but we assume w <= 3");
  w = w & 0x3;
  x = x === 0 ? 256 : x;
  // Always use binary search
  let search: Uint8Array;
  [search, trie.value] = debug_split_at(trie.value, x);
  const bsearch_result =
    OPTIONS.case_sensitivity === "IgnoreCase"
      ? binary_search_by([...search], (y) => cmp_u8(u8_to_ascii_lowercase(y), u8_to_ascii_lowercase(c)))
      : binary_search_by([...search], (y) => cmp_u8(y, c));
  if (bsearch_result.$ === "Ok") {
    const i = bsearch_result._0;
    // Matched a byte
    trie.value = w === 0 ? get_branch_w0(trie.value, i, x) : get_branch(trie.value, i, x, w);
    return search[i]!;
  } else {
    // Byte that doesn't match
    trie.value = new Uint8Array(0);
    return undefined;
  }
}

/// Steps one node into the trie, assuming all branch nodes are binary search and that
/// there are no span nodes, using an index.
///
/// The input-output argument `trie` starts at the original trie and ends pointing to
/// the sub-trie indexed by `index`.
// crate: zerotrie-0.2.5/src/reader.rs:518 probe_parameterized
export function probe_parameterized(_OPTIONS: ZeroTrieBuilderOptions, trie: { value: Uint8Array }, index: number): AsciiProbeResult | undefined {
  // Currently, the only option that probe_parameterized supports is case-insensitivity.
  // (debug assertions as in step_parameterized)
  let b: number;
  let x: number;
  for (;;) {
    if (trie.value.length === 0) {
      // Empty trie or only a value node
      return undefined;
    }
    b = trie.value[0]!;
    trie.value = trie.value.subarray(1);
    const bt = byte_type(b);
    if (bt === "Ascii") {
      if (index > 0) {
        trie.value = new Uint8Array(0);
        return undefined;
      }
      return { byte: b, total_siblings: 1 };
    } else if (bt === "Branch") {
      // Proceed to the branch node logic below
      [x, trie.value] = read_varint_meta2(b, trie.value);
      break;
    } else if (bt === "Span") {
      // Question: Should we put the trie back into a valid state?
      // Currently this code is unreachable so let's not worry about it.
      // debug_assert!(false, "Span node found in ASCII trie!");
      return undefined;
    } else {
      // Skip the value node and go to the next node
      [, trie.value] = read_varint_meta3(b, trie.value);
      continue;
    }
  }
  // Branch node
  let w: number;
  [x, w] = x >= 256 ? [x & 0xff, x >>> 8] : [x, 0];
  // debug_assert!(u8::try_from(x).is_ok());
  const total_siblings = x & 0xff;
  // See comment regarding this assertion in macros_reader.rs
  // debug_assert!(w <= 3, "get: w > 3 but we assume w <= 3");
  w = w & 0x3;
  x = x === 0 ? 256 : x;
  if (index >= x) {
    trie.value = new Uint8Array(0);
    return undefined;
  }
  let search: Uint8Array;
  [search, trie.value] = debug_split_at(trie.value, x);
  trie.value = w === 0 ? get_branch_w0(trie.value, index, x) : get_branch(trie.value, index, x, w);
  return { byte: search[index]!, total_siblings };
}

/// Steps one node into the trie if the head node is a value node, returning the value.
/// If the head node is not a value node, no change is made.
///
/// The input-output argument `trie` starts at the original trie and ends pointing to
/// the sub-trie with the value node removed.
// crate: zerotrie-0.2.5/src/reader.rs:607 take_value
export function take_value(trie: { value: Uint8Array }): number | undefined {
  if (trie.value.length === 0) return undefined;
  const b = trie.value[0]!;
  const new_trie = trie.value.subarray(1);
  switch (byte_type(b)) {
    case "Ascii":
    case "Span":
    case "Branch":
      return undefined;
    case "Value": {
      let x: number;
      [x, trie.value] = read_varint_meta3(b, new_trie);
      return x;
    }
  }
}

// `ZeroTrieIterator` (reader.rs:626) is not ported: only used by `iter()` (iterable providers).
// crate-skip: zerotrie-0.2.5/src/reader.rs:639 new ZeroTrieIterator: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/reader.rs:650 next ZeroTrieIterator: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/reader.rs:715 get_iter_phf ZeroTrieIterator: unused on rustc's path
// crate-skip: zerotrie-0.2.5/src/reader.rs:723 get_iter_ascii_or_panic ZeroTrieIterator: unused on rustc's path
