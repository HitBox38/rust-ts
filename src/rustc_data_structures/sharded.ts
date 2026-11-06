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
// PORT(perf) (lane perf-near-limit): `intern_value` and `intern_slice` are the table as upstream has it, a hash that only picks
// the bucket and `==` on the value (rust_ts/intern_key.ts `value_hash`, `value_eq`), and need no key string. An interner uses
// either these or the key-string methods, never both.

import { hash_mix, observe_interned, observe_interned_slice, value_eq, value_hash } from "../rust_ts/intern_key.ts";

/** PORT(perf): test hook, see `set_intern_shadow`. */
let shadow: ((set: object, value: unknown, got: unknown) => void) | undefined;
/**
 * Test hook: `f` sees every `intern_value` / `intern_slice` result with its value, so a test can check that a table keyed by
 * `intern_key` would give the same object.
 */
export function set_intern_shadow(f: typeof shadow): void {
  shadow = f;
}

function slice_eq<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!value_eq(a[i], b[i])) return false;
  return true;
}

export class ShardedHashMap<K, V> {
  /** canonical key of the borrowed value -> the stored `(K, V)` */
  protected readonly table = new Map<string, [K, V]>();
  /** PORT(perf): `value_hash` -> the first stored entry with that hash. */
  private readonly hashed = new Map<number, K>();
  /** PORT(perf): `value_hash` -> the later entries with that hash. Empty unless two distinct values collide. */
  private readonly collided = new Map<number, K[]>();
  private hashed_len = 0;

  // rustc: compiler/rustc_data_structures/src/sharded.rs:146 with_capacity
  static with_capacity<K, V>(_cap: number): ShardedHashMap<K, V> {
    // PORT: `per_shard_cap = cap.div_ceil(shards())` is a capacity hint only; a JS `Map` has none.
    return new ShardedHashMap<K, V>();
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:150 len
  len(): number {
    return this.table.size + this.hashed_len;
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

  // rustc: compiler/rustc_data_structures/src/sharded.rs:215 intern_ref
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern_ref<Q>(this: InternedSet<K>, _value: Q, key: string, make: () => K): K {
    const hit = this.table.get(key);
    if (hit !== undefined) return hit[0];
    const v = make();
    this.table.set(key, [v, null]);
    return v;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:234 intern
  /** PORT: `key` is the canonical key of `value` (module comment). */
  intern<Q>(this: InternedSet<K>, value: Q, key: string, make: (value: Q) => K): K {
    const hit = this.table.get(key);
    if (hit !== undefined) return hit[0];
    const v = make(value);
    this.table.set(key, [v, null]);
    return v;
  }

  /**
   * PORT(perf): `intern`, with no key string (module comment). `value_of(k)` is the value `k` was made from: the fields
   * compared are that stored value's, so nothing may write to it after this (hash-consed values are immutable upstream, and
   * `set_intern_shadow`'s test would see a write as a different object from a key table).
   */
  intern_value<Q>(this: InternedSet<K>, value: Q, value_of: (k: K) => Q, make: (value: Q) => K): K {
    observe_interned(value);
    const h = value_hash(value);
    const first = this.hashed.get(h);
    let got: K | undefined;
    if (first === undefined) {
      got = make(value);
      this.hashed.set(h, got);
      this.hashed_len++;
    } else if (value_eq(value, value_of(first))) {
      got = first;
    } else {
      const rest = this.collided.get(h);
      if (rest !== undefined) {
        for (let i = 0; i < rest.length; i++) {
          if (value_eq(value, value_of(rest[i]!))) {
            got = rest[i]!;
            break;
          }
        }
      }
      if (got === undefined) {
        got = make(value);
        if (rest === undefined) this.collided.set(h, [got]);
        else rest.push(got);
        this.hashed_len++;
      }
    }
    if (shadow !== undefined) shadow(this, value, got);
    return got;
  }

  /**
   * PORT(perf): `intern_ref` of a slice, with no key string. The stored list is an interned object that `value_eq` compares by
   * id, so slices compare element by element here; `v` may itself be a list: it is its elements, as in `slice_intern`'s key.
   */
  intern_slice<T>(this: InternedSet<K & readonly T[]>, v: readonly T[], make: () => K & readonly T[]): K & readonly T[] {
    observe_interned_slice(v);
    let h = v.length;
    for (let i = 0; i < v.length; i++) h = hash_mix(h, value_hash(v[i]));
    const first = this.hashed.get(h);
    let got: (K & readonly T[]) | undefined;
    if (first === undefined) {
      got = make();
      this.hashed.set(h, got);
      this.hashed_len++;
    } else if (slice_eq(v, first)) {
      got = first;
    } else {
      const rest = this.collided.get(h);
      if (rest !== undefined) {
        for (let i = 0; i < rest.length; i++) {
          if (slice_eq(v, rest[i]!)) {
            got = rest[i]!;
            break;
          }
        }
      }
      if (got === undefined) {
        got = make();
        if (rest === undefined) this.collided.set(h, [got]);
        else rest.push(got);
        this.hashed_len++;
      }
    }
    if (shadow !== undefined) shadow(this, v, got);
    return got;
  }

  // rustc: compiler/rustc_data_structures/src/sharded.rs:259 contains_pointer_to
  /** PORT: `IntoPointer` is object identity: is `value` the object stored under `key`? */
  contains_pointer_to(this: InternedSet<K>, value: K, key: string): boolean {
    const hit = this.table.get(key);
    return hit !== undefined && hit[0] === value;
  }
}

/** PORT: `ShardedHashMap<K, ()>`, the interner set (`impl<K: Eq + Hash + Copy> ShardedHashMap<K, ()>`). */
export type InternedSet<K> = ShardedHashMap<K, null>;
