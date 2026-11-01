// Port of src/tools/miri/src/data_structures/mono_hash_map.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mono_hash_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { MonoHashMap } from "./mono_hash_map.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { provide_defaults } from "../../rust_ts/provided.ts";
import { type AllocMap, AllocMap_provided } from "../../rustc_const_eval/interpret/machine.ts";
export * from "./mono_hash_map.gen.ts";

declare module "./mono_hash_map.gen.ts" {
  interface MonoHashMap<K, V> {
    // data_structures/mono_hash_map.rs:29
    iter<T>(f: ((_0: Iterable<[K, V]>) => T)): T;
  }
}

// ---- contract part (lane interp-miri-reconcile, miri-contract review M7): `impl AllocMap<K, V> for MonoHashMap<K, V>` ----
// `MonoHashMap` is Miri's `Machine::MemoryMap`. PORT: the generated class gets the trait's methods by declaration merging;
// the impl's own methods (:42-:106, the inventory below) are `unported` stubs until lane miri-driver ports them, and the
// provided method it does not override (`get_mut`) is copied from `AllocMap_provided` (src/rust_ts/provided.ts).
// `impl Default` (:35) is the static `default`.
declare module "./mono_hash_map.gen.ts" {
  interface MonoHashMap<K, V> extends AllocMap<K, V> {}
  namespace MonoHashMap {
    // data_structures/mono_hash_map.rs:35
    function default_<K, V>(): MonoHashMap<K, V>;
    export { default_ as default };
  }
}
// `get` (:98) is the impl's; `get_mut` is the default.
provide_defaults(MonoHashMap.prototype, AllocMap_provided.prototype, ["get"]);

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Default for MonoHashMap<K, V> (data_structures/mono_hash_map.rs:34): default (:35)
// impl AllocMap<K, V> for MonoHashMap<K, V> (data_structures/mono_hash_map.rs:40): contains_key (:42), contains_key_ref (:50), insert (:58), remove (:63), filter_map_collect (:71), get_or (:82), get (:98), get_mut_or (:106)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::data_structures::mono_hash_map::MonoHashMap", "src/tools/miri/src/data_structures/mono_hash_map.rs", "miri-driver", () => MonoHashMap.prototype, ["iter"]);
stub_statics("miri::data_structures::mono_hash_map::MonoHashMap", "src/tools/miri/src/data_structures/mono_hash_map.rs", "miri-driver", () => MonoHashMap, ["default"]);
stub_methods("miri::data_structures::mono_hash_map::MonoHashMap (impl AllocMap)", "src/tools/miri/src/data_structures/mono_hash_map.rs", "miri-driver", () => MonoHashMap.prototype, ["contains_key", "contains_key_ref", "insert", "remove", "filter_map_collect", "get_or", "get", "get_mut_or"]);
