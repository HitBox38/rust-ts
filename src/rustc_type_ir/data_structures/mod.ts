// Port of compiler/rustc_type_ir/src/data_structures/mod.rs (lane tyir-misc, sub-lane lib-sty): re-exports only.
// PORT: `HashMap` / `HashSet` / `IndexMap` / `IndexSet` / `SsoHashMap` / `SsoHashSet` are JS `Map` / `Set` (PORTING §5);
// ena's `NoError` / `UnifyKey` / `UnifyValue` are in src/vendor/ena/unify/mod.ts.
export { DelayedMap, DelayedSet } from "./delayed_map.ts";
