// Port of zerotrie 0.2.5 `src/zerotrie.rs` (`ZeroTrieSimpleAscii` over a byte slice only).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: the trie types are generic over their `Store`; only `ZeroTrieSimpleAscii<&[u8]>` is used on
// rustc's path (baked data), so the store is a `Uint8Array`. The other trie types
// (`ZeroAsciiIgnoreCaseTrie`, `ZeroTriePerfectHash`, `ZeroTrieExtendedCapacity`, `ZeroTrie`), the
// builders, conversions, serde/databake/zerovec impls and iterators are not ported.
import { get_parameterized } from "./reader.ts";
import { ZeroTrieSimpleAscii_OPTIONS } from "./options.ts";

/// A data structure that compactly maps from ASCII strings to integers.
///
/// For more information, see [`ZeroTrie`].
// #[repr(transparent)] #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
export class ZeroTrieSimpleAscii {
  constructor(
    // #[doc(hidden)] // for databake, but there are no invariants
    public store: Uint8Array,
  ) {}

  // impl_zerotrie_subtype!(ZeroTrieSimpleAscii, ..)
  /// Create a trie directly from a store.
  ///
  /// If the store does not contain valid bytes, unexpected behavior may occur.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:293 from_store
  static from_store(store: Uint8Array): ZeroTrieSimpleAscii {
    return new ZeroTrieSimpleAscii(store);
  }

  /// Takes the byte store from this trie.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:298 into_store
  into_store(): Uint8Array {
    return this.store;
  }

  /// Queries the trie for a string.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:327 get
  get(key: Uint8Array): number | undefined {
    return get_parameterized(ZeroTrieSimpleAscii_OPTIONS, this.store, key);
  }

  /// Returns `true` if the trie is empty.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:332 is_empty
  is_empty(): boolean {
    return this.store.length === 0;
  }

  /// Returns the size of the trie in number of bytes.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:349 byte_len
  byte_len(): number {
    return this.store.length;
  }

  /// Returns the bytes contained in the underlying store.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:354 as_bytes
  as_bytes(): Uint8Array {
    return this.store;
  }

  /// Returns this trie as a reference transparent over a byte slice.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:359 as_borrowed
  as_borrowed(): ZeroTrieSimpleAscii {
    return this;
  }

  /// Returns a trie with a store borrowing from this trie.
  // crate: zerotrie-0.2.5/src/zerotrie.rs:364 as_borrowed_slice
  as_borrowed_slice(): ZeroTrieSimpleAscii {
    return ZeroTrieSimpleAscii.from_store(this.store);
  }
}
