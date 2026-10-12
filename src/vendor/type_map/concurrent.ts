// Port of type-map 0.5.1, src/lib.rs `pub mod concurrent` (lib.rs:198..401): the same `TypeMap`
// with `Send + Sync` bounds on the values. Representation as in ./lib.ts (see its header); the
// bounds are erased, and the `(boxed as Box<dyn Any>)` upcasts are no-ops.

/// Provides the same `TypeMap` container, but with `Send` + `Sync` bounds on values
import { Err, Ok, type Result } from "../../std/result.ts";
import type { MapEntry, TypeId } from "./lib.ts";

/// Prepared key-value pair
export class KvPair {
  constructor(
    readonly _0: TypeId,
    readonly _1: unknown,
  ) {}

  // crate: type-map-0.5.1/src/lib.rs:211 new
  static new<T>(T: TypeId<T>, value: T): KvPair {
    return new KvPair(T as TypeId, value);
  }

  // crate: type-map-0.5.1/src/lib.rs:215 extract
  extract<T>(T: TypeId<T>): Result<T, KvPair> {
    const key = this._0;
    const value = this._1;
    if (key === (T as TypeId) /* value.is::<T>() */) {
      return Ok(value as T);
    } else {
      return Err(new KvPair(key, value));
    }
  }
}

/// A view into an occupied entry in a `TypeMap`.
export class OccupiedEntry<T> {
  declare readonly __phantom?: (x: T) => T;
  constructor(readonly data: MapEntry) {}

  /// Gets a reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:237 get
  get(): T {
    return this.data.map.get(this.data.key) as T;
  }

  ///Gets a mutable reference to the value in the entry.
  // crate: type-map-0.5.1/src/lib.rs:242 get_mut
  get_mut(): T {
    return this.data.map.get(this.data.key) as T;
  }

  /// Converts the `OccupiedEntry` into a mutable reference to the value in the entry
  /// with a lifetime bound to the map itself.
  // crate: type-map-0.5.1/src/lib.rs:248 into_mut
  into_mut(): T {
    return this.data.map.get(this.data.key) as T;
  }

  /// Sets the value of the entry, and returns the entry's old value.
  // crate: type-map-0.5.1/src/lib.rs:253 insert
  insert(value: T): T {
    const old = this.data.map.get(this.data.key) as T;
    this.data.map.set(this.data.key, value);
    return old;
  }

  /// Takes the value out of the entry, and returns it.
  // crate: type-map-0.5.1/src/lib.rs:261 remove
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
  // crate: type-map-0.5.1/src/lib.rs:278 insert
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
  // crate: type-map-0.5.1/src/lib.rs:293 or_insert
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
  // crate: type-map-0.5.1/src/lib.rs:302 or_insert_with
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
  // crate: type-map-0.5.1/src/lib.rs:319 new
  static new(): TypeMap {
    return new TypeMap(undefined);
  }

  /// Insert a prepared `KvPair` into this `TypeMap`.
  ///
  /// If a value of this type already exists, it will be returned.
  // crate: type-map-0.5.1/src/lib.rs:326 insert_kv_pair
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
  // crate: type-map-0.5.1/src/lib.rs:336 insert
  insert<T>(T: TypeId<T>, val: T): T | undefined {
    const m = (this.map ??= new Map());
    const had = m.has(T as TypeId);
    const boxed = m.get(T as TypeId);
    m.set(T as TypeId, val);
    return had ? (boxed as T) : undefined;
  }

  /// Check if container contains value for type
  // crate: type-map-0.5.1/src/lib.rs:344 contains
  contains<T>(T: TypeId<T>): boolean {
    return this.map !== undefined && this.map.has(T as TypeId);
  }

  /// Get a reference to a value previously inserted on this `TypeMap`.
  // crate: type-map-0.5.1/src/lib.rs:352 get
  get<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    return this.map.get(T as TypeId) as T;
  }

  /// Get a mutable reference to a value previously inserted on this `TypeMap`.
  // crate: type-map-0.5.1/src/lib.rs:360 get_mut
  get_mut<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    return this.map.get(T as TypeId) as T;
  }

  /// Remove a value from this `TypeMap`.
  ///
  /// If a value of this type exists, it will be returned.
  // crate: type-map-0.5.1/src/lib.rs:370 remove
  remove<T>(T: TypeId<T>): T | undefined {
    if (this.map === undefined || !this.map.has(T as TypeId)) return undefined;
    const boxed = this.map.get(T as TypeId) as T;
    this.map.delete(T as TypeId);
    return boxed;
  }

  /// Clear the `TypeMap` of all inserted values.
  // crate: type-map-0.5.1/src/lib.rs:379 clear
  clear(): void {
    this.map = undefined;
  }

  /// Get an entry in the `TypeMap` for in-place manipulation.
  // crate: type-map-0.5.1/src/lib.rs:384 entry
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
