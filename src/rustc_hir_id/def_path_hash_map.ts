// Port of compiler/rustc_hir_id/src/def_path_hash_map.rs
// Types are generated into def_path_hash_map.gen.ts (tools/codegen/types.ts, set `rustc_hir`).
import { Hash64 } from "../rustc_hashes/lib.ts";
import { DefIndex } from "../rustc_span/def_id.ts";
import * as odht from "../vendor/odht/lib.ts";
import type * as gen from "./def_path_hash_map.gen.ts";

export * from "./def_path_hash_map.gen.ts";

// PORT: `impl odht::Config for Config` -> the associated types (as odht dictionaries) and fns on the
// companion of the unit struct; `type Key = Hash64; type Value = DefIndex;` are the type arguments of
// `odht::Config<Hash64, DefIndex>`.
export type Config = gen.Config;
export const Config = {
  // This hash-map is single-crate, so we only need to key by the local hash.
  // type Key = Hash64;
  // type Value = DefIndex;

  /** `type EncodedKey = [u8; 8];` */
  EncodedKey: odht.ByteArray_u8_array(8),
  /** `type EncodedValue = [u8; 4];` */
  EncodedValue: odht.ByteArray_u8_array(4),

  /** `type H = odht::UnHashFn;` */
  H: odht.UnHashFn,

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
} satisfies odht.Config<Hash64, DefIndex>;

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
 * PORT: `odht::HashTableOwned<Config>` (vendored odht), named `HashTableOwned` here because the codegen
 * typemap (`odht::HashTableOwned`) imports it from this module for `DefPathHashMap`. The type is odht's
 * table at this `Config`'s `Key`/`Value`; the value is odht's class (its constructors take the `Config`
 * dictionary first: `HashTableOwned::default()` is `HashTableOwned.default(Config)`).
 */
export type HashTableOwned = odht.HashTableOwned<Hash64, DefIndex>;
export const HashTableOwned = odht.HashTableOwned;

/** `<odht::HashTableOwned<C> as Debug>::fmt` (vendored odht). */
export const debug_HashTableOwned = odht.debug_HashTableOwned;
