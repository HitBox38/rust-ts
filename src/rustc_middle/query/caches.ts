// Port of compiler/rustc_middle/src/query/caches.rs.
//
// PORT: JS `Map`s key by identity, so `DefaultCache` keys its map by the key's `hash_key` (the
// `Eq + Hash` of the `QueryKey` impl, query/keys.ts) and stores the key next to the value. Sharding
// and locks are erased (PORTING §5). `VecCache` (rustc_data_structures/src/vec_cache.rs, bucketed
// lock-free storage) is a dense array here: same observable behaviour (`lookup`/`complete`/`for_each`
// in index order/`len`), see `VecCache` below.
import { DefId, LOCAL_CRATE, type DefIndex } from "../../rustc_span/def_id.ts";
import type { DepNodeIndex } from "../dep_graph/graph.ts";

/** `Option<(V, DepNodeIndex)>`: a tuple, because `V` itself may be `undefined` (an `Option`). */
export type CacheEntry<V> = readonly [V, DepNodeIndex];

/// Trait for types that serve as an in-memory cache for query results,
/// for a given key (argument) type and value (return) type.
///
/// Types implementing this trait are associated with actual key/value types
/// by the `Cache` associated type of the `rustc_middle::query::Key` trait.
export interface QueryCache<K, V> {
  /// Returns the cached value (and other information) associated with the
  /// given key, if it is present in the cache.
  // rustc: compiler/rustc_middle/src/query/caches.rs:34 lookup
  lookup(key: K): CacheEntry<V> | undefined;

  /// Adds a key/value entry to this cache.
  ///
  /// Called by some part of the query system, after having obtained the
  /// value by executing the query or loading a cached value from disk.
  // rustc: compiler/rustc_middle/src/query/caches.rs:40 complete
  complete(key: K, value: V, index: DepNodeIndex): void;

  /// Calls a closure on each entry in this cache.
  // rustc: compiler/rustc_middle/src/query/caches.rs:43 for_each
  for_each(f: (key: K, value: V, index: DepNodeIndex) => void): void;

  /// Returns the number of entries currently in this cache.
  ///
  /// Useful for reserving capacity in data structures that will hold the
  /// output of a call to [`Self::for_each`].
  // rustc: compiler/rustc_middle/src/query/caches.rs:49 len
  len(): number;
}

/// Create the query cache for the case where we don't need to track present entries.
///
/// The default implementation ignores this; override this method for a cache that can use it
/// for optimization.
// rustc: compiler/rustc_middle/src/query/caches.rs:25 without_track_present
export function QueryCache_without_track_present<C>(default_: () => C): C {
  return default_();
}

/// In-memory cache for queries whose keys aren't suitable for any of the
/// more specialized kinds of cache. Backed by a sharded hashmap.
export class DefaultCache<K, V> implements QueryCache<K, V> {
  /** PORT: `ShardedHashMap<K, (V, DepNodeIndex)>`, keyed by `hash_key(key)` (see the module comment). */
  private cache = new Map<string | number | bigint, [K, V, DepNodeIndex]>();

  constructor(readonly hash_key: (key: K) => string | number | bigint) {}

  // rustc: compiler/rustc_middle/src/query/caches.rs:59 default
  static default<K, V>(hash_key: (key: K) => string | number | bigint): DefaultCache<K, V> {
    return new DefaultCache<K, V>(hash_key);
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:73 lookup
  lookup(key: K): CacheEntry<V> | undefined {
    const e = this.cache.get(this.hash_key(key));
    return e === undefined ? undefined : [e[1], e[2]];
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:78 complete
  complete(key: K, value: V, index: DepNodeIndex): void {
    // `insert_unique`
    this.cache.set(this.hash_key(key), [key, value, index]);
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:82 for_each
  for_each(f: (key: K, value: V, index: DepNodeIndex) => void): void {
    // PORT: one shard; iteration in insertion order (upstream: hash order per shard; only used for
    // self-profiling / incremental encoding, which rust-ts does not do).
    for (const [k, v, i] of this.cache.values()) {
      f(k, v, i);
    }
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:90 len
  len(): number {
    return this.cache.size;
  }
}

/// In-memory cache for queries whose key type only has one value (e.g. `()`).
/// The cache therefore only needs to store one query return value.
export class SingleCache<V> implements QueryCache<null, V> {
  /** `OnceLock<(V, DepNodeIndex)>` */
  private cache: CacheEntry<V> | undefined = undefined;

  // rustc: compiler/rustc_middle/src/query/caches.rs:102 default
  static default<V>(): SingleCache<V> {
    return new SingleCache<V>();
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:115 lookup
  lookup(_key: null): CacheEntry<V> | undefined {
    return this.cache;
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:120 complete
  complete(_key: null, value: V, index: DepNodeIndex): void {
    // `self.cache.set((value, index)).ok();`: a second `set` is ignored.
    if (this.cache === undefined) this.cache = [value, index];
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:124 for_each
  for_each(f: (key: null, value: V, index: DepNodeIndex) => void): void {
    const value = this.cache;
    if (value !== undefined) {
      f(null, value[0], value[1]);
    }
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:130 len
  len(): number {
    return this.cache !== undefined ? 1 : 0;
  }
}

/**
 * PORT: stand-in for `rustc_data_structures::vec_cache::VecCache<K, V, DepNodeIndex>` (vec_cache.rs):
 * a dense array indexed by `K::index()`. `for_each` visits the present entries in index order; upstream
 * visits them in completion order when `track_present` is on and is not used otherwise. Neither is
 * observable without self-profiling / incremental (not ported).
 */
export class VecCache<K extends number, V> implements QueryCache<K, V> {
  private slots: (CacheEntry<V> | undefined)[] = [];
  private present = 0;

  static default<K extends number, V>(): VecCache<K, V> {
    return new VecCache<K, V>();
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:201 without_track_present
  static without_track_present<K extends number, V>(): VecCache<K, V> {
    return new VecCache<K, V>();
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:206 lookup
  lookup(key: K): CacheEntry<V> | undefined {
    return this.slots[key];
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:211 complete
  complete(key: K, value: V, index: DepNodeIndex): void {
    // vec_cache.rs `complete`: a slot is written once (a second completion of the same key is a bug
    // upstream: "caller raced calls to put()"); the query system never completes a key twice.
    if (this.slots[key] === undefined) this.present++;
    this.slots[key] = [value, index];
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:215 for_each
  for_each(f: (key: K, value: V, index: DepNodeIndex) => void): void {
    this.slots.forEach((e, i) => {
      if (e !== undefined) f(i as K, e[0], e[1]);
    });
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:219 len
  len(): number {
    return this.present;
  }
}

/// In-memory cache for queries whose key is a [`DefId`].
///
/// Selects between one of two internal caches, depending on whether the key
/// is a local ID or foreign-crate ID.
export class DefIdCache<V> implements QueryCache<DefId, V> {
  constructor(
    /// Stores the local DefIds in a dense map. Local queries are much more often dense, so this is
    /// a win over hashing query keys at marginal memory cost (~5% at most) compared to FxHashMap.
    readonly local: VecCache<DefIndex, V>,
    readonly foreign: DefaultCache<DefId, V>,
  ) {}

  // rustc: compiler/rustc_middle/src/query/caches.rs:147 default
  static default<V>(): DefIdCache<V> {
    return new DefIdCache<V>(VecCache.default(), DefaultCache.default(DefId_hash_key));
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:159 without_track_present
  static without_track_present<V>(): DefIdCache<V> {
    return new DefIdCache<V>(VecCache.without_track_present(), DefaultCache.default(DefId_hash_key));
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:164 lookup
  lookup(key: DefId): CacheEntry<V> | undefined {
    if (key.krate === LOCAL_CRATE) {
      return this.local.lookup(key.index);
    } else {
      return this.foreign.lookup(key);
    }
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:173 complete
  complete(key: DefId, value: V, index: DepNodeIndex): void {
    if (key.krate === LOCAL_CRATE) {
      this.local.complete(key.index, value, index);
    } else {
      this.foreign.complete(key, value, index);
    }
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:181 for_each
  for_each(f: (key: DefId, value: V, index: DepNodeIndex) => void): void {
    this.local.for_each((key, value, index) => {
      f(new DefId(key, LOCAL_CRATE), value, index);
    });
    this.foreign.for_each(f);
  }

  // rustc: compiler/rustc_middle/src/query/caches.rs:188 len
  len(): number {
    return this.local.len() + this.foreign.len();
  }
}

/** PORT: `impl Hash for DefId` (one `u64`, def_id.rs:269) as a JS map key: `krate * 2^32 + index`. */
export function DefId_hash_key(key: DefId): number {
  return key.krate * 0x1_0000_0000 + key.index;
}
