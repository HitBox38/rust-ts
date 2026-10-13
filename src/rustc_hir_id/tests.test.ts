// Port of compiler/rustc_hir_id/src/tests.rs, plus focused tests of the hand-ported parts of
// lib.rs / definitions.rs / def_path_hash_map.rs that do not need a StableHasher.
import { describe, expect, test } from "bun:test";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { create_default_session_globals_then, create_session_globals_then } from "../rustc_span/lib.ts";
import { CRATE_DEF_ID, DefIndex, DefPathHash, LOCAL_CRATE, LocalDefId, LocalModId, StableCrateId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Config, HashTableOwned } from "./def_path_hash_map.ts";
import {
  DefKey,
  DefPath,
  DefPathData,
  DefPathDataMap,
  Definitions,
  DisambiguatedDefPathData,
  PerParentDisambiguatorState,
  PerParentDisambiguatorsMap,
  SortedMap,
  debug_DefKey,
  debug_PerParentDisambiguatorState,
  debug_SortedMap,
  default_DefPathToIndexMap,
  display_DefPathData,
} from "./definitions.ts";
import { CRATE_HIR_ID, CRATE_OWNER_ID, HirId, HirId_INVALID, HirId_eq, HirId_from_LocalModId, HirId_make_owner, ItemLocalId, OwnerId, OwnerId_new, debug_HirId, display_HirId } from "./lib.ts";

// rustc: compiler/rustc_hir_id/src/tests.rs:11 def_path_hash_depends_on_crate_id
test("def_path_hash_depends_on_crate_id", () => {
  // This test makes sure that *both* halves of a DefPathHash depend on
  // the crate-id of the defining crate. This is a desirable property
  // because the crate-id can be more easily changed than the DefPath
  // of an item, so, in the case of a crate-local DefPathHash collision,
  // the user can simply "roll the dice again" for all DefPathHashes in
  // the crate by changing the crate disambiguator (e.g. via bumping the
  // crate's version number).

  create_session_globals_then("Edition2024", [], undefined, () => {
    const id0 = StableCrateId.new(Symbol.intern("foo"), false, ["1"], "");
    const id1 = StableCrateId.new(Symbol.intern("foo"), false, ["2"], "");

    const h0 = mk_test_hash(id0);
    const h1 = mk_test_hash(id1);

    expect(DefPathHash.stable_crate_id(h0)).not.toBe(DefPathHash.stable_crate_id(h1));
    expect(DefPathHash.local_hash(h0)).not.toBe(DefPathHash.local_hash(h1));

    // rustc: compiler/rustc_hir_id/src/tests.rs:30 mk_test_hash
    function mk_test_hash(stable_crate_id: StableCrateId): DefPathHash {
      const parent_hash = DefPathHash.new(stable_crate_id, Hash64.new(StableCrateId.as_u64(stable_crate_id)));

      const key = new DefKey(undefined, new DisambiguatedDefPathData(DefPathData.CrateRoot, 0));

      return key.compute_stable_hash(parent_hash);
    }
  });
});

const SCI = StableCrateId.of(Hash64.new(0x1234_5678_9abc_def0n));

describe("rustc_hir_id::lib", () => {
  test("HirId / OwnerId Debug and consts", () => {
    expect(debug_HirId(CRATE_HIR_ID, PLAIN)).toBe("HirId(DefId { krate: crate0, index: DefIndex(0) }.0)");
    expect(debug_HirId(CRATE_HIR_ID, PRETTY)).toBe("HirId(DefId { krate: crate0, index: DefIndex(0) }.0)");
    expect(display_HirId(new HirId(CRATE_OWNER_ID, ItemLocalId.from_u32(10)))).toBe("HirId(DefId { krate: crate0, index: DefIndex(0) }.10)");
    expect(ItemLocalId.INVALID).toBe(ItemLocalId.MAX);
    expect(HirId_INVALID.local_id).toBe(0xffff_ff00 as ItemLocalId);
    expect(CRATE_HIR_ID.is_owner()).toBe(true);
    expect(HirId_INVALID.as_owner()).toBeUndefined();
    expect(() => HirId_INVALID.expect_owner()).toThrow(Panic);
    expect(HirId_eq(HirId_make_owner(CRATE_DEF_ID), CRATE_HIR_ID)).toBe(true);
    expect(HirId_eq(HirId_from_LocalModId(LocalModId.new_unchecked(LocalDefId.new(3))), new HirId(new OwnerId(LocalDefId.new(3)), ItemLocalId.ZERO))).toBe(true);
    expect(OwnerId_new(5).index()).toBe(5);
    expect(OwnerId_new(5).to_def_id().is_local()).toBe(true);
  });
});

describe("rustc_hir_id::def_path_hash_map", () => {
  test("Config encodes little-endian and round-trips", () => {
    const k = Hash64.new(0x0102_0304_0506_0708n);
    expect([...Config.encode_key(k)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(Config.decode_key(Config.encode_key(k))).toBe(k);
    expect([...Config.encode_value(DefIndex.from_u32(0x0a0b0c0d))]).toEqual([0x0d, 0x0c, 0x0b, 0x0a]);
    expect(Config.decode_value(Config.encode_value(DefIndex.from_u32(77)))).toBe(DefIndex.from_u32(77));
  });

  test("HashTableOwned insert returns the previous value", () => {
    const t = HashTableOwned.default();
    expect(t.insert(Hash64.new(1n), DefIndex.from_u32(1))).toBeUndefined();
    expect(t.insert(Hash64.new(1n), DefIndex.from_u32(2))).toBe(DefIndex.from_u32(1));
    expect(t.get(Hash64.new(1n))).toBe(DefIndex.from_u32(2));
    expect(t.get(Hash64.new(2n))).toBeUndefined();
  });
});

describe("rustc_hir_id::definitions", () => {
  test("Definitions::new allocates the crate root", () => {
    const defs = Definitions.new(SCI);
    expect(defs.num_definitions()).toBe(1);
    const root = defs.def_key(CRATE_DEF_ID);
    expect(root.parent).toBeUndefined();
    expect(root.disambiguated_data.data.$).toBe("CrateRoot");
    expect(debug_DefKey(root, PLAIN)).toBe("DefKey { parent: None, disambiguated_data: DisambiguatedDefPathData { data: CrateRoot, disambiguator: 0 } }");
    const h = defs.def_path_hash(CRATE_DEF_ID);
    expect(DefPathHash.stable_crate_id(h)).toBe(SCI);
    expect(Hash64.as_u64(DefPathHash.local_hash(h))).toBe(StableCrateId.as_u64(SCI));
    expect(defs.local_def_path_hash_to_def_id(h)).toBe(CRATE_DEF_ID);
    expect(defs.def_path(CRATE_DEF_ID).data).toEqual([]);
    expect(defs.def_path(CRATE_DEF_ID).krate).toBe(LOCAL_CRATE);
    const e = defs.enumerated_keys_and_path_hashes();
    expect(e.length).toBe(1);
    expect(e[0]![2]).toBe(h);
  });

  test("allocate panics on a DefPathHash collision", () => {
    create_default_session_globals_then(() => {
      const defs = Definitions.new(SCI);
      const key = new DefKey(DefIndex.from_u32(0), new DisambiguatedDefPathData({ $: "TypeNs", _0: Symbol.intern("x") }, 0));
      // the root's local hash, again
      expect(() => defs.allocate(key, defs.def_path_hash(CRATE_DEF_ID))).toThrow(
        "found DefPathHash collision between DefPath {\n    data: [],\n    krate: crate0,\n} and DefPath {\n    data: [\n        DisambiguatedDefPathData {\n            data: TypeNs(\n                \"x\",\n            ),\n            disambiguator: 0,\n        },\n    ],\n    krate: crate0,\n}. Compilation cannot continue.",
      );
    });
  });

  test("allocate + def_path + DefPath strings", () => {
    create_default_session_globals_then(() => {
      const defs = Definitions.new(SCI);
      const a = defs.allocate(new DefKey(DefIndex.from_u32(0), new DisambiguatedDefPathData({ $: "TypeNs", _0: Symbol.intern("m") }, 0)), DefPathHash.new(SCI, Hash64.new(1n)));
      const b = defs.allocate(new DefKey(LocalDefId.local_def_index(a), new DisambiguatedDefPathData(DefPathData.Impl, 2)), DefPathHash.new(SCI, Hash64.new(2n)));
      const c = defs.allocate(new DefKey(LocalDefId.local_def_index(b), new DisambiguatedDefPathData({ $: "ValueNs", _0: Symbol.intern("f") }, 1)), DefPathHash.new(SCI, Hash64.new(3n)));
      const d = defs.allocate(new DefKey(LocalDefId.local_def_index(c), new DisambiguatedDefPathData({ $: "AnonAssocTy", _0: Symbol.intern("f") }, 0)), DefPathHash.new(SCI, Hash64.new(4n)));
      const p = defs.def_path(d);
      expect(p.data.length).toBe(4);
      expect(p.to_string_no_crate_verbose()).toBe("::m::{impl#2}::f#1::f::{anon_assoc#0}");
      expect(p.to_filename_friendly_no_crate()).toBe("m-{impl#2}-f#1-f::{anon_assoc#0}");
      expect(defs.local_def_path_hash_to_def_id(DefPathHash.new(SCI, Hash64.new(3n)))).toBe(c);
      expect(defs.def_key(c).get_opt_name()).toBe(Symbol.intern("f"));
      expect(defs.def_key(d).get_opt_name()).toBeUndefined();
      // as_sym without `verbose`
      expect(Symbol.as_str(new DisambiguatedDefPathData({ $: "ValueNs", _0: Symbol.intern("g") }, 3).as_sym(false))).toBe("g");
      // DefPath::make stops at the crate root and reverses
      const made = DefPath.make(LOCAL_CRATE, LocalDefId.local_def_index(c), (i) => defs.def_key(LocalDefId.of(i)));
      expect(made.to_string_no_crate_verbose()).toBe("::m::{impl#2}::f#1");
    });
  });

  test("Display of DefPathData", () => {
    create_default_session_globals_then(() => {
      expect(display_DefPathData(DefPathData.CrateRoot)).toBe("{{crate}}");
      expect(display_DefPathData(DefPathData.Impl)).toBe("{{impl}}");
      expect(display_DefPathData(DefPathData.ForeignMod)).toBe("{{extern}}");
      expect(display_DefPathData(DefPathData.Use)).toBe("{{use}}");
      expect(display_DefPathData(DefPathData.GlobalAsm)).toBe("{{global_asm}}");
      expect(display_DefPathData(DefPathData.Closure)).toBe("{{closure}}");
      expect(display_DefPathData(DefPathData.Ctor)).toBe("{{constructor}}");
      expect(display_DefPathData(DefPathData.AnonConst)).toBe("{{constant}}");
      expect(display_DefPathData(DefPathData.OpaqueTy)).toBe("{{opaque}}");
      expect(display_DefPathData({ $: "AnonAssocTy", _0: Symbol.intern("m") })).toBe("{{anon_assoc}}");
      expect(display_DefPathData(DefPathData.SyntheticCoroutineBody)).toBe("{{synthetic}}");
      expect(display_DefPathData(DefPathData.NestedStatic)).toBe("{{nested}}");
      expect(display_DefPathData(DefPathData.TestBinderConstraints)).toBe("{{test_binder_constraints}}");
      expect(display_DefPathData({ $: "OpaqueLifetime", _0: Symbol.intern("'a") })).toBe("'a");
      expect(DefPathData.hashed_symbol({ $: "AnonAssocTy", _0: Symbol.intern("m") })).toBe(Symbol.intern("m"));
      expect(DefPathData.get_opt_name({ $: "AnonAssocTy", _0: Symbol.intern("m") })).toBeUndefined();
    });
  });

  test("create_def asserts and counts disambiguators per DefPathData", () => {
    create_default_session_globals_then(() => {
      const defs = Definitions.new(SCI);
      const dis = PerParentDisambiguatorState.new(CRATE_DEF_ID);
      expect(() => defs.create_def(CRATE_DEF_ID, DefPathData.CrateRoot, dis)).toThrow("assertion failed: data != DefPathData::CrateRoot");
      // disambiguators are counted per DefPathData value before hashing
      defs.create_def(CRATE_DEF_ID, { $: "TypeNs", _0: Symbol.intern("a") }, dis);
      defs.create_def(CRATE_DEF_ID, { $: "TypeNs", _0: Symbol.intern("a") }, dis);
      defs.create_def(CRATE_DEF_ID, { $: "TypeNs", _0: Symbol.intern("b") }, dis);
      expect(dis.next.get({ $: "TypeNs", _0: Symbol.intern("a") })).toBe(2);
      expect(dis.next.get({ $: "TypeNs", _0: Symbol.intern("b") })).toBe(1);
      expect(dis.next.size).toBe(2);
    });
  });

  test("PerParentDisambiguatorState / map helpers", () => {
    const m = new Map<LocalDefId, PerParentDisambiguatorState>();
    const s = PerParentDisambiguatorsMap.get_or_create(m, CRATE_DEF_ID);
    expect(PerParentDisambiguatorsMap.get_or_create(m, CRATE_DEF_ID)).toBe(s);
    expect(debug_PerParentDisambiguatorState(s, PLAIN)).toBe("PerParentDisambiguatorState { next: {} }");
    s.next.set(DefPathData.Impl, 4);
    expect(debug_PerParentDisambiguatorState(s, PLAIN)).toBe("PerParentDisambiguatorState { next: {Impl: 4} }");
    const dm = new DefPathDataMap<number>();
    dm.set({ $: "Use" }, 1);
    expect(dm.get(DefPathData.Use)).toBe(1);
    expect(dm.has({ $: "Use" })).toBe(true);
  });

  test("DefPathToIndexMap + commit_end_of_determinism + SortedMap", () => {
    const m = default_DefPathToIndexMap();
    expect(m.insert(Hash64.new(5n), DefIndex.from_u32(1))).toBeUndefined();
    expect(m.insert(Hash64.new(5n), DefIndex.from_u32(2))).toBe(DefIndex.from_u32(1));
    const defs = Definitions.new(SCI);
    defs.commit_end_of_determinism();
    expect(() => defs.commit_end_of_determinism()).toThrow("this function should be called only once");
    const h = defs.def_path_hash_to_def_index_map();
    // after the end of determinism: before-map hits win, new hashes go to the sorted map
    expect(h.insert(StableCrateId._0(SCI), DefIndex.from_u32(9))).toBe(DefIndex.from_u32(0));
    expect(h.insert(Hash64.new(3n), DefIndex.from_u32(7))).toBeUndefined();
    expect(h.insert(Hash64.new(1n), DefIndex.from_u32(8))).toBeUndefined();
    expect(h.get(Hash64.new(3n))).toBe(DefIndex.from_u32(7));
    expect(debug_SortedMap(h.after_parallel_alloc!, PLAIN, (v) => String(v), (v) => String(v))).toBe("SortedMap { data: [(1, 8), (3, 7)] }");
    const sm = SortedMap.default<bigint, number>();
    expect(sm.insert(2n, 1)).toBeUndefined();
    expect(sm.insert(2n, 3)).toBe(1);
    expect(sm.get(2n)).toBe(3);
  });
});
