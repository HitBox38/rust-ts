// Port of src/tools/miri/src/data_structures/mono_hash_map.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mono_hash_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { MonoHashMap } from "./mono_hash_map.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
export * from "./mono_hash_map.gen.ts";

declare module "./mono_hash_map.gen.ts" {
  interface MonoHashMap<K, V> {
    // data_structures/mono_hash_map.rs:29
    iter<T>(f: ((_0: Iterable<[K, V]>) => T)): T;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Default for MonoHashMap<K, V> (data_structures/mono_hash_map.rs:34): default (:35)
// impl AllocMap<K, V> for MonoHashMap<K, V> (data_structures/mono_hash_map.rs:40): contains_key (:42), contains_key_ref (:50), insert (:58), remove (:63), filter_map_collect (:71), get_or (:82), get (:98), get_mut_or (:106)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::data_structures::mono_hash_map::MonoHashMap", "src/tools/miri/src/data_structures/mono_hash_map.rs", "miri-driver", () => MonoHashMap.prototype, ["iter"]);
