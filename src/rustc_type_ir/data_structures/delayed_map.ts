// Port of compiler/rustc_type_ir/src/data_structures/delayed_map.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT: `HashMap<K, V>` / `HashSet<T>` (FxHashMap / FxHashSet) are a `Map` / `Set` (PORTING §5). A key that is a
// composite value (e.g. `(DebruijnIndex, Ty)` in `FoldEscapingRegions`) needs a key fn: `default_(key)` then uses
// rust_ts/keyed.ts's `KeyedMap` / `KeyedSet` (PORTING §5 "other composite keys"); primitives and interned objects
// need none. The caches are never iterated, so their order does not matter.
// PORT: `#[derive(Debug)]` of both structs is not used by rustc's output and is not ported.
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";

const CACHE_CUTOFF = 32;

/// A hashmap which only starts hashing after ignoring the first few inputs.
///
/// This is used in type folders as in nearly all cases caching is not worth it
/// as nearly all folded types are tiny. However, there are very rare incredibly
/// large types for which caching is necessary to avoid hangs.
// rustc-type: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:13 DelayedMap
export class DelayedMap<K, V> {
  constructor(
    public cache: Map<K, V>,
    public count: number,
  ) {}

  // PORT: `impl Default for DelayedMap` (tyir-kind decision 2: `default_()`); `key` per the module comment.
  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:19 default
  static default_<K, V>(key?: (k: K) => string | number): DelayedMap<K, V> {
    return new DelayedMap<K, V>(key === undefined ? new Map() : new KeyedMap(key), 0);
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:26 insert
  insert(key: K, value: V): boolean {
    if (this.count >= CACHE_CUTOFF) {
      return this.cold_insert(key, value);
    } else {
      this.count += 1;
      return true;
    }
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:37 cold_insert
  cold_insert(key: K, value: V): boolean {
    // `self.cache.insert(key, value).is_none()`
    const had = this.cache.has(key);
    this.cache.set(key, value);
    return !had;
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:42 get
  get(key: K): V | undefined {
    if (this.cache.size === 0) {
      return undefined;
    } else {
      return this.cold_get(key);
    }
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:48 cold_get
  cold_get(key: K): V | undefined {
    return this.cache.get(key);
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:53 clear
  clear(): void {
    this.cache.clear();
    this.count = 0;
  }
}

// rustc-type: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:60 DelayedSet
export class DelayedSet<T> {
  constructor(
    public cache: Set<T>,
    public count: number,
  ) {}

  // PORT: `impl Default for DelayedSet` (`default_()`); `key` per the module comment.
  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:66 default
  static default_<T>(key?: (v: T) => string | number): DelayedSet<T> {
    return new DelayedSet<T>(key === undefined ? new Set() : new KeyedSet(key), 0);
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:73 insert
  insert(value: T): boolean {
    if (this.count >= CACHE_CUTOFF) {
      return this.cold_insert(value);
    } else {
      this.count += 1;
      return true;
    }
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:84 cold_insert
  cold_insert(value: T): boolean {
    // `self.cache.insert(value)`: `true` if it was not present
    const had = this.cache.has(value);
    this.cache.add(value);
    return !had;
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:89 contains
  contains(value: T): boolean {
    return this.cache.size !== 0 && this.cold_contains(value);
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:95 cold_contains
  cold_contains(value: T): boolean {
    return this.cache.has(value);
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:100 clear
  clear(): void {
    this.cache.clear();
    this.count = 0;
  }
}
