// Port of compiler/rustc_metadata/src/rmeta/def_path_hash_map.rs.
//
// PORT (lane rmeta-contract): `odht` 0.3.1 is not vendored yet: `OdhtHashTable` below is a stand-in whose
// `from_raw_bytes` / `get` call `unported`, so decoding a crate's `def_path_hash_map` (`CrateMetadata::new`)
// stops there until a lane vendors odht's read side (`HashTable::from_raw_bytes`, `get`; src/vendor/odht).
import type { OwnedSlice } from "../../rustc_data_structures/owned_slice.ts";
import { OwnedSlice_slice } from "../../rustc_data_structures/owned_slice.ts";
import { SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import type { Config as HashMapConfig } from "../../rustc_hir_id/def_path_hash_map.ts";
import type { DefPathToIndexMap } from "../../rustc_hir_id/definitions.ts";
import { decode_Hash64, decode_tuple, decode_Vec } from "../../rustc_serialize/serialize.ts";
import { DefPathHash, type DefIndex } from "../../rustc_span/def_id.ts";
import { panic, unported } from "../../std/panic.ts";
import type { BlobDecodeContext } from "./decoder.ts";

/** PORT: stand-in for `odht::HashTable<HashMapConfig, OwnedSlice>` (odht 0.3.1, not vendored). */
export class OdhtHashTable {
  declare readonly __config?: HashMapConfig;
  private constructor(readonly raw: OwnedSlice) {}

  /** `HashTable::from_raw_bytes(data) -> Result<HashTable<C, D>, Box<dyn Error>>` (odht lib.rs) */
  static from_raw_bytes(_data: OwnedSlice): { $: "Ok"; _0: OdhtHashTable } | { $: "Err"; _0: string } {
    return unported("odht::HashTable::from_raw_bytes (vendor odht 0.3.1 not ported)");
  }

  /** `HashTable::get(&self, key: &K) -> Option<V>` (odht lib.rs) */
  get(_key: Hash64): DefIndex | undefined {
    return unported("odht::HashTable::get (vendor odht 0.3.1 not ported)");
  }
}

export type DefPathHashMapRef =
  | { readonly $: "OwnedFromMetadata"; readonly _0: OdhtHashTable; readonly _1: SortedMap<Hash64, DefIndex> }
  | { readonly $: "BorrowedFromTcx"; readonly _0: DefPathToIndexMap };

export const DefPathHashMapRef = {
  // impl DefPathHashMapRef<'_>
  // rustc: compiler/rustc_metadata/src/rmeta/def_path_hash_map.rs:19 def_path_hash_to_def_index
  def_path_hash_to_def_index(self: DefPathHashMapRef, def_path_hash: DefPathHash): DefIndex | undefined {
    switch (self.$) {
      case "OwnedFromMetadata": {
        const det_map = self._0;
        const non_det_map = self._1;
        const hash = DefPathHash.local_hash(def_path_hash);
        // `det_map.get(hash).or_else(|| non_det_map.get(hash).copied())`
        const r = det_map.get(hash);
        return r !== undefined ? r : non_det_map.get(hash);
      }
      case "BorrowedFromTcx":
        return panic("DefPathHashMap::BorrowedFromTcx variant only exists for serialization");
    }
  },
};

// rustc-skip: compiler/rustc_metadata/src/rmeta/def_path_hash_map.rs:36 encode Encodable impl (metadata encoding, M5)

// impl<'a> Decodable<BlobDecodeContext<'a>> for DefPathHashMapRef<'static>
// rustc: compiler/rustc_metadata/src/rmeta/def_path_hash_map.rs:57 decode
export function decode_DefPathHashMapRef(d: BlobDecodeContext, ..._phantom: unknown[]): DefPathHashMapRef {
  const len = d.read_usize();
  const pos = d.position();
  const o = OwnedSlice_slice(d.blob().bytes(), (blob) => {
    // `&blob[pos..pos + len]`
    if (pos + len > blob.length) panic(`range end index ${pos + len} out of range for slice of length ${blob.length}`);
    return blob.subarray(pos, pos + len);
  });

  // Although we already have the data we need via the `OwnedSlice`, we still need
  // to advance the `DecodeContext`'s position so it's in a valid state after
  // the method. We use `read_raw_bytes()` for that.
  void d.read_raw_bytes(len);

  const r = OdhtHashTable.from_raw_bytes(o);
  if (r.$ === "Err") return panic(`decode error: ${r._0}`);
  const inner = r._0;

  const elements: [Hash64, DefIndex][] = decode_Vec(d, (d) => decode_tuple<[Hash64, DefIndex], BlobDecodeContext>(d, decode_Hash64, (d) => d.decode_def_index()));
  const non_det_map = SortedMap.from_presorted_elements(elements, Hash64_cmp);

  return { $: "OwnedFromMetadata", _0: inner, _1: non_det_map };
}

/** `Ord for Hash64` (the `u64`). */
function Hash64_cmp(a: Hash64, b: Hash64): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
