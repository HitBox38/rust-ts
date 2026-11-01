//! This is a "monotonic `FxHashMap`": A `FxHashMap` that, when shared, can be pushed to but not
//! otherwise mutated. We also box items in the map. This means we can safely provide
//! shared references into existing items in the `FxHashMap`, because they will not be dropped
//! (from being removed) or moved (because they are boxed).
//! The API is completely tailored to what `memory.rs` needs. It is still in
//! a separate file to minimize the amount of code that has to care about the unsafety.
// Port of src/tools/miri/src/data_structures/mono_hash_map.rs (crate `miri`, plan-m6 D2; lane miri-driver, wave 36).
// Its types are generated into mono_hash_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT (lane miri-driver): `RefCell<FxHashMap<K, Box<V>>>` is an `FxHashMap` (src/rust_ts/hash_map.ts): the iteration
// order of `filter_map_collect` / `iter` (leak reports, `miri_print_alloc`) is hashbrown's bucket order, as upstream.
// The key type's `Hash` is a parameter of `default`; Miri's only `MonoHashMap` is `Machine::MemoryMap` with
// `K = AllocId` (`NonZero<u64>`: `write_u64`, which FxHasher treats like `write_usize` on 64-bit hosts), so `default()`
// uses `usize_key`. The value is `Box<V>` (a pointer: `LAYOUT_PTR`). The `RefCell` borrow flags have no TS counterpart
// (the borrows the unsafe blocks rely on cannot conflict in single-threaded TS); `Box<V>` is the value itself.
import { MonoHashMap } from "./mono_hash_map.gen.ts";
import { FxHashMap, type KeyType, LAYOUT_PTR, usize_key } from "../../rust_ts/hash_map.ts";
import { provide_defaults } from "../../rust_ts/provided.ts";
import { type AllocMap, AllocMap_provided } from "../../rustc_const_eval/interpret/machine.ts";
import { panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
export * from "./mono_hash_map.gen.ts";

declare module "./mono_hash_map.gen.ts" {
  interface MonoHashMap<K, V> {
    // data_structures/mono_hash_map.rs:29
    iter<T>(f: (_0: Iterable<[K, V]>) => T): T;
  }
}

// ---- `impl AllocMap<K, V> for MonoHashMap<K, V>` (lane interp-miri-reconcile, miri-contract review M7) ----
// `MonoHashMap` is Miri's `Machine::MemoryMap`. PORT: the generated class gets the trait's methods by declaration merging;
// the provided method it does not override (`get_mut`) is copied from `AllocMap_provided` (src/rust_ts/provided.ts).
// `impl Default` (:35) is the static `default`.
declare module "./mono_hash_map.gen.ts" {
  interface MonoHashMap<K, V> extends AllocMap<K, V> {}
  namespace MonoHashMap {
    // data_structures/mono_hash_map.rs:35
    function default_<K, V>(key?: KeyType<K>): MonoHashMap<K, V>;
    export { default_ as default };
  }
}

/** The map inside the `RefCell` (constructed by `default` as an `FxHashMap`). */
function map_of<K, V>(m: MonoHashMap<K, V>): Map<K, V> {
  return m._0;
}

/// This function exists for priroda to be able to iterate over all evaluator memory.
///
/// The function is somewhat roundabout with the closure argument because internally the
/// `MonoHashMap` uses a `RefCell`. When iterating over the `FxHashMap` inside the `RefCell`,
/// we need to keep a borrow to the `FxHashMap` inside the iterator. The borrow is only alive
/// as long as the `Ref` returned by `RefCell::borrow()` is alive. So we can't return the
/// iterator, as that would drop the `Ref`. We can't return both, as it's not possible in Rust
/// to have a struct/tuple with a field that refers to another field.
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:29 iter
MonoHashMap.prototype.iter = function <K, V, T>(this: MonoHashMap<K, V>, f: (_0: Iterable<[K, V]>) => T): T {
  return f(map_of(this).entries());
};

// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:35 default
MonoHashMap.default = function <K, V>(key: KeyType<K> = usize_key as unknown as KeyType<K>): MonoHashMap<K, V> {
  return new MonoHashMap<K, V>(FxHashMap.default<K, V>(key, LAYOUT_PTR));
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:42 contains_key
MonoHashMap.prototype.contains_key = function <K, V>(this: MonoHashMap<K, V>, k: K): boolean {
  return map_of(this).has(k);
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:50 contains_key_ref
MonoHashMap.prototype.contains_key_ref = function <K, V>(this: MonoHashMap<K, V>, k: K): boolean {
  return map_of(this).has(k);
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:58 insert
MonoHashMap.prototype.insert = function <K, V>(this: MonoHashMap<K, V>, k: K, v: V): V | undefined {
  const m = map_of(this);
  const old = m.get(k);
  const had = old !== undefined || m.has(k);
  m.set(k, v);
  return had ? old : undefined;
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:63 remove
MonoHashMap.prototype.remove = function <K, V>(this: MonoHashMap<K, V>, k: K): V | undefined {
  const m = map_of(this);
  const old = m.get(k);
  if (!m.delete(k)) return undefined;
  return old;
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:71 filter_map_collect
MonoHashMap.prototype.filter_map_collect = function <K, V, T>(this: MonoHashMap<K, V>, f: (k: K, v: V) => T | undefined): T[] {
  const out: T[] = [];
  for (const [k, v] of map_of(this)) {
    const t = f(k, v);
    if (t !== undefined) out.push(t);
  }
  return out;
};

/// The most interesting method: Providing a shared reference without
/// holding the `RefCell` open, and inserting new data if the key
/// is not used yet.
/// `vacant` is called if the key is not found in the map;
/// if it returns a reference, that is used directly, if it
/// returns owned data, that is put into the map and returned.
// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:82 get_or
MonoHashMap.prototype.get_or = function <K, V, E>(this: MonoHashMap<K, V>, k: K, vacant: () => Result<V, E>): Result<V, E> {
  const m = map_of(this);
  // We cannot hold borrow_mut while calling `vacant`, since that might have to do lookups in this very map.
  if (m.has(k)) {
    // This is safe because `val` points into a `Box`, that we know will not move and
    // will also not be dropped as long as the shared reference `self` is live.
    return Ok(m.get(k) as V);
  }
  const r = vacant();
  if (r.$ === "Err") return r;
  const new_val = r._0;
  // `self.0.borrow_mut().try_insert(k, new_val).ok().unwrap()`
  if (m.has(k)) panic("called `Option::unwrap()` on a `None` value");
  m.set(k, new_val);
  // This is safe because `val` points into a `Box`, that we know will not move and
  // will also not be dropped as long as the shared reference `self` is live.
  return Ok(new_val);
};

/// Read-only lookup (avoid read-acquiring the RefCell).
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:98 get
MonoHashMap.prototype.get = function <K, V>(this: MonoHashMap<K, V>, k: K): V | undefined {
  // This is safe because `val` points into a `Box`, that we know will not move and
  // will also not be dropped as long as the shared reference `self` is live.
  return map_of(this).get(k);
};

// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/mono_hash_map.rs:106 get_mut_or
MonoHashMap.prototype.get_mut_or = function <K, V, E>(this: MonoHashMap<K, V>, k: K, vacant: () => Result<V, E>): Result<V, E> {
  const m = map_of(this);
  if (m.has(k)) {
    // Entry::Occupied(e) => Ok(e.into_mut()),
    return Ok(m.get(k) as V);
  }
  // Entry::Vacant(e) => { let v = vacant()?; Ok(e.insert(Box::new(v))) }
  // PORT: std's `entry` (hashbrown `rustc_entry`) reserves room for one element when the key is vacant, before `vacant`
  // runs (so even when it fails): the same table growth here.
  if (m instanceof FxHashMap) m.reserve(1);
  const r = vacant();
  if (r.$ === "Err") return r;
  m.set(k, r._0);
  return Ok(r._0);
};

// `get` (:98) is the impl's; `get_mut` is the default.
provide_defaults(MonoHashMap.prototype, AllocMap_provided.prototype, ["get"]);
