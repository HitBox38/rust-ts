// Lane encoder-a (plan-m5 wave 33): `[u8]`'s encoding (encoder.rs:402), `encode_def_path_table` (:556),
// `encode_def_path_hash_map` (:577), and the hand `Encodable`s they reach: `DefKey` (rustc_hir_id definitions.rs:118)
// and `DefPathHashMapRef` (def_path_hash_map.rs:36).
// Each is checked by a round trip: encode with the port's `EncodeContext` (over a `MemEncoder`), then decode with the
// port's decoders (`LazyTable::get`, `LazyValue::decode` over a `MetadataBlob`, `decode_DefKey`,
// `decode_DefPathHashMapRef`) and compare with the `Definitions` that were encoded.
import { expect, test } from "bun:test";
import "../lib.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { encode_DefKey, PerParentDisambiguatorState, Definitions, type DefKey } from "../../rustc_hir_id/definitions.ts";
import { decode_DefKey } from "../../rustc_hir_id/definitions.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { MAGIC_END_BYTES, MemEncoder, type FileEncoder } from "../../rustc_serialize/opaque.ts";
import { CRATE_DEF_ID, DefIndex, DefPathHash, type LocalDefId, StableCrateId } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Panic } from "../../std/panic.ts";
import { MetadataBlob } from "./decoder.ts";
import { DefPathHashMapRef, decode_DefPathHashMapRef, encode_DefPathHashMapRef } from "./def_path_hash_map.ts";
import { EncodeContext, encode_slice_u8 } from "./encoder.ts";
import { LazyState, LazyValue, TableBuilders_default } from "./mod.ts";
import { fse_Option_LazyValue, fse_u64 } from "./table.ts";

const SCI = StableCrateId.of(Hash64.new(0x0fed_cba9_8765_4321n));

/** An `EncodeContext` over a `MemEncoder` with a stand-in `TyCtxt` (only what the def-path encoders read). */
function ecx(tcx: TyCtxt | undefined, is_proc_macro = false): EncodeContext {
  const none = undefined as never;
  const e = new EncodeContext(
    MemEncoder.new() as unknown as FileEncoder,
    none,
    tcx ?? none,
    none,
    TableBuilders_default(),
    LazyState.NoNode,
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    none,
    new Map(),
    is_proc_macro,
    none,
    new Map(),
  );
  // positions start at 1 (`NonZero`); the real encoder starts with the header
  e.emit_u8(0xee);
  return e;
}
const finish = (e: EncodeContext): Uint8Array => (e.opaque as unknown as MemEncoder).finish();
const blob_of = (bytes: Uint8Array): MetadataBlob => new MetadataBlob(new Uint8Array([...bytes, ...MAGIC_END_BYTES]));

/** A `TyCtxt` with `definitions()`, `resolutions(()).proc_macros` and `def_path_hash_to_def_index_map()`. */
function fake_tcx(defs: Definitions, proc_macros: LocalDefId[] = []): TyCtxt {
  return {
    definitions: () => defs,
    resolutions: (_: null) => ({ proc_macros }),
    def_path_hash_to_def_index_map: () => defs.def_path_hash_to_def_index_map(),
  } as unknown as TyCtxt;
}

/** A crate root with a few children (two with the same name, so a disambiguator), a nested def, and two defs created
 * after `commit_end_of_determinism` (they land in `after_parallel_alloc`). */
function make_defs(): Definitions {
  const defs = Definitions.new(SCI);
  const dis = PerParentDisambiguatorState.new(CRATE_DEF_ID);
  const a = defs.create_def(CRATE_DEF_ID, { $: "TypeNs", _0: Symbol.intern("a") }, dis);
  defs.create_def(CRATE_DEF_ID, { $: "TypeNs", _0: Symbol.intern("a") }, dis);
  defs.create_def(CRATE_DEF_ID, { $: "ValueNs", _0: Symbol.intern("f") }, dis);
  defs.create_def(a, { $: "Impl" }, PerParentDisambiguatorState.new(a));
  defs.commit_end_of_determinism();
  defs.create_def(CRATE_DEF_ID, { $: "Closure" }, dis);
  defs.create_def(a, { $: "MacroNs", _0: Symbol.intern("m") }, PerParentDisambiguatorState.new(a));
  return defs;
}

const def_key_eq = (a: DefKey, b: DefKey): boolean =>
  a.parent === b.parent && a.disambiguated_data.disambiguator === b.disambiguated_data.disambiguator && JSON.stringify(a.disambiguated_data.data) === JSON.stringify(b.disambiguated_data.data);

test("[u8] encodes as its length then the raw bytes (encoder.rs:402)", () => {
  const e = ecx(undefined);
  encode_slice_u8(new Uint8Array([1, 2, 3]), e);
  encode_slice_u8(new Uint8Array(200).fill(9), e);
  const b = [...finish(e)];
  expect(b.slice(0, 5)).toEqual([0xee, 3, 1, 2, 3]);
  // 200 = LEB128 0xc8 0x01
  expect(b.slice(5, 7)).toEqual([0xc8, 0x01]);
  expect(b.length).toBe(7 + 200);
});

test("DefKey encodes its parent as an `Option<LocalDefId>` (the EncodeContext override) and decodes back", () => {
  create_default_session_globals_then(() => {
    const defs = make_defs();
    const e = ecx(undefined);
    const keys = defs.enumerated_keys_and_path_hashes().map(([, k]) => k);
    for (const k of keys) encode_DefKey(k, e);
    const bytes = finish(e);
    // the crate root: `None` parent (0), `CrateRoot` (0), disambiguator 0
    expect([...bytes.slice(0, 4)]).toEqual([0xee, 0, 0, 0]);
    // `a`: `Some(LocalDefId(0))` parent (1, then the index as a `u32`: 0), `TypeNs` (variant 5), then its symbol
    expect([...bytes.slice(4, 7)]).toEqual([1, 0, 5]);
    const blob = blob_of(bytes);
    const decoded = LazyValue.from_position<DefKey[]>(1).decode(blob, (d) => keys.map(() => decode_DefKey(d)));
    expect(decoded.length).toBe(7);
    for (let i = 0; i < keys.length; i++) expect(`${i}: ${def_key_eq(keys[i]!, decoded[i]!)}`).toBe(`${i}: true`);
  });
});

test("encode_def_path_table + encode_def_path_hash_map round-trip through the tables and the odht map", () => {
  create_default_session_globals_then(() => {
    const defs = make_defs();
    const e = ecx(fake_tcx(defs));
    e.encode_def_path_table();
    const def_path_hash_map = e.encode_def_path_hash_map();
    const def_keys = e.tables.def_keys.encode(e.opaque);
    const def_path_hashes = e.tables.def_path_hashes.encode(e.opaque);
    const blob = blob_of(finish(e));

    const all = defs.enumerated_keys_and_path_hashes();
    expect(all.length).toBe(7);
    expect(def_keys.len).toBe(7);
    for (const [index, key, hash] of all) {
      const i = DefIndex.as_u32(index);
      const lazy = def_keys.get(fse_Option_LazyValue, blob, i as never) as LazyValue<DefKey> | undefined;
      expect(def_key_eq(lazy!.decode(blob, decode_DefKey), key)).toBe(true);
      expect(def_path_hashes.get(fse_u64, blob, i as never)).toBe(Hash64.as_u64(DefPathHash.local_hash(hash)));
    }

    const map = def_path_hash_map.decode(blob, decode_DefPathHashMapRef);
    expect(map.$).toBe("OwnedFromMetadata");
    // the two defs made after `commit_end_of_determinism` are in the sorted (non-deterministic) part
    if (map.$ === "OwnedFromMetadata") expect(map._1.len()).toBe(2);
    for (const [index, , hash] of all) {
      expect(DefPathHashMapRef.def_path_hash_to_def_index(map, hash)).toBe(index);
    }
    expect(DefPathHashMapRef.def_path_hash_to_def_index(map, DefPathHash.new(SCI, Hash64.new(12345n)))).toBeUndefined();
  });
});

test("encode_def_path_table of a proc-macro crate records only the crate root and the proc macros", () => {
  create_default_session_globals_then(() => {
    const defs = make_defs();
    const pm = 3 as LocalDefId;
    const e = ecx(fake_tcx(defs, [pm]), true);
    e.encode_def_path_table();
    const def_keys = e.tables.def_keys.encode(e.opaque);
    const def_path_hashes = e.tables.def_path_hashes.encode(e.opaque);
    const blob = blob_of(finish(e));
    expect(def_keys.len).toBe(4);
    for (let i = 0; i < 4; i++) {
      const lazy = def_keys.get(fse_Option_LazyValue, blob, i as never) as LazyValue<DefKey> | undefined;
      const recorded = i === 0 || i === 3;
      expect(`${i}: ${lazy !== undefined}`).toBe(`${i}: ${recorded}`);
      if (recorded) {
        expect(def_key_eq(lazy!.decode(blob, decode_DefKey), defs.def_key(i as LocalDefId))).toBe(true);
        expect(def_path_hashes.get(fse_u64, blob, i as never)).toBe(Hash64.as_u64(DefPathHash.local_hash(defs.def_path_hash(i as LocalDefId))));
      } else {
        expect(def_path_hashes.get(fse_u64, blob, i as never)).toBe(0n);
      }
    }
  });
});

test("DefPathHashMapRef: the after-parallel part must be set; OwnedFromMetadata cannot be encoded", () => {
  create_default_session_globals_then(() => {
    const defs = Definitions.new(SCI);
    const e = ecx(undefined);
    expect(() => encode_DefPathHashMapRef({ $: "BorrowedFromTcx", _0: defs.def_path_hash_to_def_index_map() }, e)).toThrow(Panic);
    expect(() => encode_DefPathHashMapRef({ $: "BorrowedFromTcx", _0: defs.def_path_hash_to_def_index_map() }, e)).toThrow("must be set before metadata encoding");
    expect(() => encode_DefPathHashMapRef({ $: "OwnedFromMetadata" } as never, e)).toThrow("DefPathHashMap::OwnedFromMetadata variant only exists for deserialization");
  });
});
