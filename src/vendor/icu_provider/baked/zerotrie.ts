// Port of icu_provider 2.3.0 `src/baked/zerotrie.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! Data stored as as [`ZeroTrieSimpleAscii`]
import { ZeroTrieSimpleAscii_cursor } from "../../zerotrie/cursor.ts";
import type { ZeroTrieSimpleAscii } from "../../zerotrie/zerotrie.ts";
import type { DataStore } from "../baked.ts";
import type { DataIdentifierBorrowed } from "../request.ts";
import { DataPayload } from "../response.ts";

/// This is a valid separator as `DataLocale` will never produce it.
///
/// Mostly duplicated from icu_provider::export::bake::marker::ID_SEPARATOR
export const ID_SEPARATOR = 0x1e;

export { ZeroTrieSimpleAscii } from "../../zerotrie/zerotrie.ts";

// crate: icu_provider-2.3.0/src/baked/zerotrie.rs:22 get_index
function get_index(trie: ZeroTrieSimpleAscii, id: DataIdentifierBorrowed, attributes_prefix_match: boolean): number | undefined {
  const cursor = ZeroTrieSimpleAscii_cursor(trie);
  const _is_ascii = id.locale.write_to(cursor);
  if (!id.marker_attributes.is_empty()) {
    cursor.step(ID_SEPARATOR);
    if (id.marker_attributes.write_to(cursor).$ === "Err") return undefined;
    for (;;) {
      const v = cursor.take_value();
      if (v !== undefined) {
        return v;
      }
      if (!attributes_prefix_match || cursor.probe(0) === undefined) {
        return undefined;
      }
    }
  } else {
    return cursor.take_value();
  }
}

// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:48 iter `IterableDataProvider` / `DataIdentifierCow` are not ported; unused on rustc's path

/// Regular baked data: a trie for lookups and a slice of values
// #[derive(Debug)]
export class Data<T> implements DataStore<T> {
  constructor(
    // Unsafe invariant: actual values contained MUST be valid indices into `values`
    public trie: ZeroTrieSimpleAscii,
    public values: readonly T[],
  ) {}

  /// Construct from a trie and values
  ///
  /// # Safety
  /// The actual values contained in the trie must be valid indices into `values`
  // crate: icu_provider-2.3.0/src/baked/zerotrie.rs:80 from_trie_and_values_unchecked
  static from_trie_and_values_unchecked<T>(trie: ZeroTrieSimpleAscii, values: readonly T[]): Data<T> {
    return new Data(trie, values);
  }

  // impl<M: DataMarker> super::DataStore<M> for Data<M>
  // crate: icu_provider-2.3.0/src/baked/zerotrie.rs:90 get
  get(id: DataIdentifierBorrowed, attributes_prefix_match: boolean): DataPayload<T> | undefined {
    const i = get_index(this.trie, id, attributes_prefix_match);
    if (i === undefined) return undefined;
    // Safety: Allowed since `i` came from the trie and the field safety invariant
    return DataPayload.from_static_ref(this.values[i]!);
  }

  // crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:107 iter `IterableDataProvider` is not ported; unused on rustc's path
}

// `DataRef<M>` and `DataForVarULEs<M>` are not ported (rustc_baked_icu_data uses `Data`).
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:125 from_trie_and_refs_unchecked DataRef: unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:135 get DataRef: unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:153 iter DataRef: unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:186 from_trie_and_values_unchecked DataForVarULEs: unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:199 get DataForVarULEs: unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/baked/zerotrie.rs:217 iter DataForVarULEs: unused on rustc's path


