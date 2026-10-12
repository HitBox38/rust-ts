// Port of type-map 0.5.1 (the version in upstream's Cargo.lock), src/lib.rs.
//
// PORT: representation of `std::any::TypeId` / `Box<dyn Any>`:
// - `TypeId<T>` is a unique token object, created once per Rust type (`TypeId.new<T>(name)`) next
//   to the TS type it stands for. `TypeId::of::<T>()` becomes "pass the token for `T`", so every
//   generic fn `f::<T>()` takes the token as its first parameter. Maps key on the token's identity
//   (`TypeId` is `Eq + Hash` on the type).
// - `Box<dyn Any>` is the value itself (`unknown`). A map entry is only ever written under the
//   token of its own type, so `downcast()` / `downcast_ref()` / `downcast_mut()` of an entry
//   always succeed (the `.unwrap()`s upstream never fire); `KvPair::extract` compares tokens.
// - `&mut T` returns are the value itself: callers mutate objects in place (a `HashMap` in
//   intl-memoizer); a primitive `T` cannot be written through, use `insert`.
// - `FxHashMap<TypeId, Box<dyn Any>>` → `Map<TypeId, unknown>`; `hash_map::{Occupied,Vacant}Entry`
//   → the map plus the key.
// - `#[derive(Debug)]` on the entry types / `TypeMap` is not ported: `TypeId`'s Debug is a
//   compiler-chosen hash and `dyn Any` prints `Any { .. }`; nothing formats it.
// - `pub mod concurrent` (the `Send + Sync` copy) is `./concurrent.ts`, re-exported as `concurrent`.
import { Err, Ok, type Result } from "../../std/result.ts";

export * as concurrent from "./concurrent.ts";

/** PORT: `std::any::TypeId` (see the header). */
export class TypeId<T = unknown> {
  declare readonly __phantom?: (x: T) => T;
  private constructor(readonly name: string) {}
  /** A fresh token for the Rust type named `name` (the name is informational only). */
  static new<T>(name: string): TypeId<T> {
    return new TypeId<T>(name);
  }
}

/** PORT: `hash_map::OccupiedEntry` / `hash_map::VacantEntry` over `FxHashMap<TypeId, Box<dyn Any>>`. */
export interface MapEntry {
  readonly map: Map<TypeId, unknown>;
  readonly key: TypeId;
}

/// Prepared key-value pair
export class KvPair {
  constructor(
    readonly _0: TypeId,
    readonly _1: unknown,
  ) {}

  // crate: type-map-0.5.1/src/lib.rs:12 new
  static new<T>(T: TypeId<T>, value: T): KvPair {
    return new KvPair(T as TypeId, value);
  }

  // crate: type-map-0.5.1/src/lib.rs:16 extract
  extract<T>(T: TypeId<T>): Result<T, KvPair> {
    const key = this._0;
    const value = this._1;
    // `value.downcast()`: Ok iff the boxed value is a `T`.
    return key === (T as TypeId) ? Ok(value as T) : Err(new KvPair(key, value));
  }
}

/// A view into an occupied entry in a `TypeMap`.
export class OccupiedEntry<T> {
  declare readonly __phantom?: (x: T) => T;
  constructor(readonly data: MapEntry) {}

  /// Gets a reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:34 get
  get(): T {
    return this.data.map.get(this.data.key) as T;
  }

  ///Gets a mutable reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:39 get_mut
  get_mut(): T {
    return this.data.map.get(this.data.key) as T;
  }

  /// Converts the `OccupiedEntry` into a mutable reference to the value in the entry
  /// with a lifetime bound to the map itself.
  // crate: type-map-0.5.1/src/lib.rs:45 into_mut
  into_mut(): T {
    return this.data.map.get(this.data.key) as T;
  }

  /// Sets the value of the entry, and returns the entry's old value.
  // crate: type-map-0.5.1/src/lib.rs:50 insert
  insert(value: T): T {
    const old = this.data.map.get(this.data.key) as T;
    this.data.map.set(this.data.key, value);
    return old;
  }

  /// Takes the value out of the entry, and returns it.
  // crate: type-map-0.5.1/src/lib.rs:59 remove
  remove(): T {
    const old = this.data.map.get(this.data.key) as T;
    this.data.map.delete(this.data.key);
    return old;
  }
}

/// A view into a vacant entry in a `TypeMap`.
export class VacantEntry<T> {
  declare readonly __phantom?: (x: T) => T;
  constructor(readonly data: MapEntry) {}

  /// Sets the value of the entry with the key of the `VacantEntry`, and returns a mutable reference to it.
  // crate: type-map-0.5.1/src/lib.rs:73 insert
  insert(value: T): T {
    this.data.map.set(this.data.key, value);
    return value;
  }
}

/// A view into a single entry in a map, which may either be vacant or occupied.
export type Entry<T> = { $: "Occupied"; _0: OccupiedEntry<T> } | { $: "Vacant"; _0: VacantEntry<T> };

export const Entry = {
  /// Ensures a value is in the entry by inserting the default if empty, and returns
  /// a mutable reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:88 or_insert
  or_insert<T>(self: Entry<T>, default_: T): T {
    switch (self.$) {
      case "Occupied":
        return self._0.into_mut();
      case "Vacant":
        return self._0.insert(default_);
    }
  },

  /// Ensures a value is in the entry by inserting the result of the default function if empty, and returns
  /// a mutable reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:97 or_insert_with
  or_insert_with<T>(self: Entry<T>, default_: () => T): T {
    switch (self.$) {
      case "Occupied":
        return self._0.into_mut();
      case "Vacant":
        return self._0.insert(default_());
    }
  },
};

/// The typemap container
// #[derive(Debug, Default)]
export class TypeMap {
  constructor(public map: Map<TypeId, unknown> | undefined) {}

  /** `#[derive(Default)]` */
  static default(): TypeMap {
    return new TypeMap(undefined);
  }

  /// Create an empty `TypeMap`.
  // crate: type-map-0.5.1/src/lib.rs:114 new
  static new(): TypeMap {
    return new TypeMap(undefined);
  }

  /// Insert a prepared `KvPair` into this `TypeMap`.
  ///
  /// If a value of this type already exists, it will be returned.
  // crate: type-map-0.5.1/src/lib.rs:121 insert_kv_pair
  insert_kv_pair(kv: KvPair): KvPair | undefined {
    const key = kv._0;
    const value = kv._1;
    const m = (this.map ??= new Map());
    const had = m.has(key);
    const old_value = m.get(key);
    m.set(key, value);
    return had ? new KvPair(key, old_value) : undefined;
  }

  /// Insert a value into this `TypeMap`.
  ///
  /// If a value of this type already exists, it will be returned.
  // crate: type-map-0.5.1/src/lib.rs:131 insert
  insert<T>(T: TypeId<T>, val: T): T | undefined {
    const m = (this.map ??= new Map());
    const had = m.has(T as TypeId);
    const boxed = m.get(T as TypeId);
    m.set(T as TypeId, val);
    return had ? (boxed as T) : undefined;
  }

  /// Check if container contains value for type
  // crate: type-map-0.5.1/src/lib.rs:139 contains
  contains<T>(T: TypeId<T>): boolean {
    return this.map !== undefined && this.map.has(T as TypeId);
  }

  /// Get a reference to a value previously inserted on this `TypeMap`.
  // crate: type-map-0.5.1/src/lib.rs:147 get
  get<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    return this.map.get(T as TypeId) as T;
  }

  /// Get a mutable reference to a value previously inserted on this `TypeMap`.
  // crate: type-map-0.5.1/src/lib.rs:155 get_mut
  get_mut<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    return this.map.get(T as TypeId) as T;
  }

  /// Remove a value from this `TypeMap`.
  ///
  /// If a value of this type exists, it will be returned.
  // crate: type-map-0.5.1/src/lib.rs:165 remove
  remove<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    const boxed = this.map.get(T as TypeId) as T;
    this.map.delete(T as TypeId);
    return boxed;
  }

  /// Clear the `TypeMap` of all inserted values.
  // crate: type-map-0.5.1/src/lib.rs:174 clear
  clear(): void {
    this.map = undefined;
  }

  /// Get an entry in the `TypeMap` for in-place manipulation.
  // crate: type-map-0.5.1/src/lib.rs:179 entry
  entry<T>(T: TypeId<T>): Entry<T> {
    const map = (this.map ??= new Map());
    const e: MapEntry = { map, key: T as TypeId };
    if (map.has(T as TypeId)) {
      return { $: "Occupied", _0: new OccupiedEntry<T>(e) };
    } else {
      return { $: "Vacant", _0: new VacantEntry<T>(e) };
    }
  }
}
