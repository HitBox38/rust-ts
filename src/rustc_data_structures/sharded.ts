// Partial port of compiler/rustc_data_structures/src/sharded.rs: the `ShardedHashMap<K, ()>` interning
// surface that rustc_middle's `CtxtInterners` uses (`InternedSet`, ty/context.rs:136).
//
// PORT (single-threaded, PORTING §5 sync types; docs/plan-m3.md D2):
// - `Sharded<T>` is always `Single` (`is_dyn_thread_safe()` is false), so a `ShardedHashMap` is one table and
//   the shard / lock fns are not needed by the interners (not ported).
// - The `hashbrown::HashTable<(K, V)>` keyed by `make_hash` + `table_entry`'s `k.borrow() == key` becomes a
//   JS `Map<string, [K, V]>` keyed by the canonical key of the borrowed value (`Q`), which callers pass in:
//   the derived `Hash` + `PartialEq` of `Q` as a string (rust_ts/intern_key.ts). Equal keys <=> `==` values.
// - Insertion order is the JS `Map`'s; nothing iterates an interner (D6).
import { assert } from "../std/panic.ts";

export class ShardedHashMap<K, V> {
  /** canonical key of the borrowed value -> the stored `(K, V)` */
  protected readonly table = new Map<string, [K, V]>();

  // rustc: compiler/rustc_data_structures/src/sharded.rs:146 with_capacity
  static with_capacity<K, V>(_cap: number): ShardedHashMap<K, V> {
    // PORT: `per_shard_cap = cap.div_ceil(shards())` is a capacity hint only; a JS `Map` has none.
    return new ShardedHashMap<K, V>();
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:150 len
  len(): number {
    return this.table.size;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:157 get
  /** PORT: `key` is the canonical key of the borrowed `&Q` (module comment). */
  get(key: string): V | undefined {
    const e = this.table.get(key);
    return e === undefined ? undefined : e[1];
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:170 get_or_insert_with
  get_or_insert_with(key: K, hash_key: string, default_: () => V): V {
    const e = this.table.get(hash_key);
    if (e !== undefined) return e[1];
    const value = default_();
    this.table.set(hash_key, [key, value]);
    return value;
  }

  /// Insert value into the [`ShardedHashMap`] with unique key.
  ///
  /// This function panics if debug_assertions are enabled and uniqueness is violated.
  /// If uniqueness is violated but debug_assertions are disabled then lookups will arbitrarily
  /// return one of the inserted elements.
  // rustc: compiler/rustc_data_structures/src/sharded.rs:193 insert_unique
  insert_unique(key: K, hash_key: string, value: V): void {
    // PORT: the `debug_assertions` arm is off in rustc; `insert_unique` without the check. A JS `Map` keeps one
    // entry per key, so a violated uniqueness keeps the first (upstream: an arbitrary one).
    if (!this.table.has(hash_key)) this.table.set(hash_key, [key, value]);
  }
}

/** PORT: `ShardedHashMap<K, ()>`, the interner set (`impl<K: Eq + Hash + Copy> ShardedHashMap<K, ()>`). */
export class InternedSet<K> extends ShardedHashMap<K, null> {
  static override with_capacity<K>(_cap: number): InternedSet<K> {
    // PORT: capacity hint dropped (see `ShardedHashMap::with_capacity`).
    return new InternedSet<K>();
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:215 intern_ref
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern_ref<Q>(_value: Q, key: string, make: () => K): K {
    const hit = this.get_stored(key);
    if (hit !== undefined) return hit;
    const v = make();
    this.insert_unique(v, key, null);
    return v;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:234 intern
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern<Q>(value: Q, key: string, make: (value: Q) => K): K {
    const hit = this.get_stored(key);
    if (hit !== undefined) return hit;
    const v = make(value);
    this.insert_unique(v, key, null);
    return v;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:259 contains_pointer_to
  /** PORT: `IntoPointer` is object identity: is `value` the object stored under `key`? */
  contains_pointer_to(value: K, key: string): boolean {
    return this.get_stored(key) === value;
  }

  /** The stored `K` for `key` (the `Entry::Occupied(e) => e.get().0` arm). */
  private get_stored(key: string): K | undefined {
    const e = this.table.get(key);
    return e === undefined ? undefined : e[0];
  }
}
