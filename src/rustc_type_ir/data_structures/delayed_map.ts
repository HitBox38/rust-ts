// Port of compiler/rustc_type_ir/src/data_structures/delayed_map.rs (lane tyir-binder: needed by rustc_middle ty/fold.rs's
// `BoundVarReplacer` and ty_kind/closure.rs's `FoldEscapingRegions`).
//
// PORT: `HashMap<K, V>` / `HashSet<T>` with `K: Hash + Eq` are a `KeyedMap` / `KeyedSet` over a key function given at
// construction (the keys are tuples of interned values, `(DebruijnIndex, Ty)`); they are only probed, never iterated,
// so their order is not observable (D6).
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
    public cache: KeyedMap<K, V>,
    public count: number,
  ) {}

  /** PORT: `K: Hash + Eq` is the key function. */
  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:19 default
  static default<K, V>(key: (k: K) => string | number): DelayedMap<K, V> {
    return new DelayedMap(new KeyedMap<K, V>(key), 0);
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
    public cache: KeyedSet<T>,
    public count: number,
  ) {}

  /** PORT: `T: Hash + Eq` is the key function. */
  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:66 default
  static default<T>(key: (t: T) => string | number): DelayedSet<T> {
    return new DelayedSet(new KeyedSet<T>(key), 0);
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
    if (this.cache.has(value)) return false;
    this.cache.add(value);
    return true;
  }

  // rustc: compiler/rustc_type_ir/src/data_structures/delayed_map.rs:89 contains
  contains(value: T): boolean {
    return !(this.cache.size === 0) && this.cold_contains(value);
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
