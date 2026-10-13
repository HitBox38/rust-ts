// Port of compiler/rustc_hir_id/src/def_path_hash_map.rs
// Types are generated into def_path_hash_map.gen.ts (tools/codegen/types.ts, set `rustc_hir`).
import { Hash64 } from "../rustc_hashes/lib.ts";
import { DefIndex } from "../rustc_span/def_id.ts";
import type { Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type * as gen from "./def_path_hash_map.gen.ts";

export * from "./def_path_hash_map.gen.ts";

// PORT: `impl odht::Config for Config` -> the associated fns on the companion of the unit struct.
// `type Key = Hash64; type Value = DefIndex; type EncodedKey = [u8; 8]; type EncodedValue = [u8; 4];
// type H = odht::UnHashFn;`
export type Config = gen.Config;
export const Config = {
  // rustc: compiler/rustc_hir_id/src/def_path_hash_map.rs:18 encode_key
  encode_key(k: Hash64): Uint8Array {
    return u64_to_le_bytes(Hash64.as_u64(k));
  },

  // rustc: compiler/rustc_hir_id/src/def_path_hash_map.rs:23 encode_value
  encode_value(v: DefIndex): Uint8Array {
    return u32_to_le_bytes(DefIndex.as_u32(v));
  },

  // rustc: compiler/rustc_hir_id/src/def_path_hash_map.rs:28 decode_key
  decode_key(k: Uint8Array): Hash64 {
    return Hash64.new(u64_from_le_bytes(k));
  },

  // rustc: compiler/rustc_hir_id/src/def_path_hash_map.rs:33 decode_value
  decode_value(v: Uint8Array): DefIndex {
    return DefIndex.from_u32(u32_from_le_bytes(v));
  },
};

/** `u64::to_le_bytes` */
function u64_to_le_bytes(x: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, x, true);
  return b;
}
/** `u32::to_le_bytes` */
function u32_to_le_bytes(x: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, x, true);
  return b;
}
/** `u64::from_le_bytes` */
function u64_from_le_bytes(b: Uint8Array): bigint {
  return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
}
/** `u32::from_le_bytes` */
function u32_from_le_bytes(b: Uint8Array): number {
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
}

/**
 * PORT: stand-in for `odht::HashTableOwned<Config>` until odht is vendored (the metadata lanes
 * need its on-disk layout: `DefPathHashMapRef` in rmeta). Only the in-memory map API used by
 * rustc_hir_id is provided, with odht's semantics: `get` returns the value for a key, `insert`
 * stores it and returns the previous value. Iteration order and the raw byte layout (which odht
 * defines) are not modelled; nothing here iterates or serializes the table.
 */
export class HashTableOwned {
  private readonly map = new Map<Hash64, DefIndex>();

  /** `HashTableOwned::default()` */
  static default(): HashTableOwned {
    return new HashTableOwned();
  }

  /** `HashTableOwned::get(&self, key: &K) -> Option<V>` */
  get(key: Hash64): DefIndex | undefined {
    return this.map.get(key);
  }

  /** `HashTableOwned::insert(&mut self, key: &K, value: &V) -> Option<V>` */
  insert(key: Hash64, value: DefIndex): DefIndex | undefined {
    const old = this.map.get(key);
    this.map.set(key, value);
    return old;
  }

  /** `HashTableOwned::len()` */
  len(): number {
    return this.map.size;
  }
}

/** `<odht::HashTableOwned<C> as Debug>::fmt` (odht's own format; not ported). */
export const debug_HashTableOwned: Debug<HashTableOwned> = (_v, _f) => unported("odht::HashTableOwned Debug (odht not vendored)");
