// Port of ena =0.14.4 `src/unify/mod.rs` (re-exported by rustc_data_structures as `unify`; rustc_type_ir
// re-exports `NoError`, `UnifyKey` and `UnifyValue`). Built without the `persistent` feature.
//
// PORT: generics.
// - `K: UnifyKey` is a dictionary `UnifyKey<K, V, E>`: `V` is its associated `Value` type and `E` is
//   `V::Error`. It carries `Value` (the `UnifyValue` dictionary of `V`) and `eq` (the `PartialEq`
//   supertrait: keys are compared with it, never with `===`). `Debug` / `Copy` are not needed
//   (`debug!` stays a comment; keys are immutable values).
// - `V: UnifyValue` is a dictionary `UnifyValue<V, E>` with `clone` (the `Clone` supertrait).
// - `UnificationTable<S>` is `UnificationTable<K, V, E, S>`; methods that need
//   `S: UnificationStoreMut` / `S: UnificationStore` say so in their `this` type.
// - `K1: Into<K>` parameters are `K`: callers convert (e.g. `TyVid` → `TyVidEqKey`) themselves.
// - `Option<&V>` / `Option<V>` of a `V` that may itself be `undefined`-able (e.g. `Option<i32>`) is
//   `{ $: "Some", _0 } | undefined`; `Range<K>` is `{ start, end }`.
//
//! Union-find implementation. The main type is `UnificationTable`.
//!
//! You can define your own type for the *keys* in the table, but you
//! must implement `UnifyKey` for that type. The assumption is that
//! keys will be newtyped integers, hence we require that they
//! implement `Copy`.
//!
//! Keys can have values associated with them. The assumption is that
//! these values are cheaply cloneable (ideally, `Copy`), and some of
//! the interfaces are oriented around that assumption. If you just
//! want the classical "union-find" algorithm where you group things
//! into sets, use the `Value` type of `()`.
//!
//! When you have keys with non-trivial values, you must also define
//! how those values can be merged. As part of doing this, you can
//! define the "error" type to return on error; if errors are not
//! possible, use `NoError` (an uninstantiable struct). Using this
//! type also unlocks various more ergonomic methods (e.g., `union()`
//! in place of `unify_var_var()`).
//!
//! The best way to see how it is used is to read the `tests.rs` file;
//! search for e.g. `UnitKey`.

import { type Debug, debug_struct, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import type { UndoLog as SvUndoLog } from "../snapshot_vec.ts";
import type { UndoLogs, VecLog } from "../undo_log.ts";
import { InPlace, type UnificationStore, type UnificationStoreBase, type UnificationStoreMut } from "./backing_vec.ts";

export {
  Delegate,
  InPlace,
  type InPlaceUndoLog,
  type UnificationStore,
  type UnificationStoreBase,
  UnificationStoreBase_provided,
  type UnificationStoreMut,
} from "./backing_vec.ts";

/** `std::ops::Range<T>` */
export interface Range<T> {
  readonly start: T;
  readonly end: T;
}

/** PORT: `S::Key`, `S::Value` and `<S::Value as UnifyValue>::Error` of a store type `S`. */
export type StoreKey<S> = S extends { readonly Key: UnifyKey<infer K, infer _V, infer _E> } ? K : never;
export type StoreValue<S> = S extends { readonly Key: UnifyKey<infer _K, infer V, infer _E> } ? V : never;
export type StoreError<S> = S extends { readonly Key: UnifyKey<infer _K, infer _V, infer E> } ? E : never;

/** `Some(v)` of an `Option<T>` whose `T` may itself be `undefined`. */
export interface Some<T> {
  readonly $: "Some";
  readonly _0: T;
}

/// This trait is implemented by any type that can serve as a type
/// variable. We call such variables *unification keys*. For example,
/// this trait is implemented by `IntVid`, which represents integral
/// variables.
///
/// Each key type has an associated value type `V`. For example, for
/// `IntVid`, this is `Option<IntVarValue>`, representing some
/// (possibly not yet known) sort of integer.
///
/// Clients are expected to provide implementations of this trait; you
/// can see some examples in the `test` module.
export interface UnifyKey<K, V, E = unknown> {
  /** PORT: `type Value: UnifyValue` (with `Error = E`). */
  readonly Value: UnifyValue<V, E>;

  /** PORT: the `PartialEq` supertrait. */
  eq(a: K, b: K): boolean;

  // crate: ena-0.14.4/src/unify/mod.rs:66 index
  index(self: K): number;

  // crate: ena-0.14.4/src/unify/mod.rs:68 from_index
  from_index(u: number): K;

  // crate: ena-0.14.4/src/unify/mod.rs:70 tag
  tag(): string;

  /// You should return first the key that should be used as root,
  /// then the other key (that will then point to the new root).
  ///
  /// NB. The only reason to implement this method is if you want to
  /// control what value is returned from `find()`. In general, it
  /// is better to let the unification table determine the root,
  /// since overriding the rank can cause execution time to increase
  /// dramatically.
  order_roots(a: K, a_value: V, b: K, b_value: V): [K, K] | undefined; // (provided)
}

/** The provided methods of `UnifyKey`. */
export const UnifyKey_provided = {
  // crate: ena-0.14.4/src/unify/mod.rs:81 order_roots
  order_roots<K, V>(_a: K, _a_value: V, _b: K, _b_value: V): [K, K] | undefined {
    return undefined;
  },
};

/// Trait implemented for **values** associated with a unification
/// key. This trait defines how to merge the values from two keys that
/// are unioned together. This merging can be fallible. If you attempt
/// to union two keys whose values cannot be merged, then the error is
/// propagated up and the two keys are not unioned.
///
/// This crate provides implementations of `UnifyValue` for `()`
/// (which is infallible) and `Option<T>` (where `T: UnifyValue`). The
/// option implementation merges two sum-values using the `UnifyValue`
/// implementation of `T`.
///
/// See also `EqUnifyValue`, which is a convenience trait for cases
/// where the "merge" operation succeeds only if the two values are
/// equal.
// PORT: `type Error` is the type parameter `E`.
export interface UnifyValue<V, E> {
  /** PORT: the `Clone` supertrait. */
  clone(v: V): V;

  /// Given two values, produce a new value that combines them.
  /// If that is not possible, produce an error.
  // crate: ena-0.14.4/src/unify/mod.rs:114 unify_values
  unify_values(value1: V, value2: V): Result<V, E>;
}

/// A convenient helper for unification values which must be equal or
/// else an error occurs. For example, if you are unifying types in a
/// simple functional language, this may be appropriate, since (e.g.)
/// you can't unify a type variable bound to `int` with one bound to
/// `float` (but you can unify two type variables both bound to
/// `int`).
///
/// Any type which implements `EqUnifyValue` automatially implements
/// `UnifyValue`; if the two values are equal, merging is permitted.
/// Otherwise, the error `(v1, v2)` is returned, where `v1` and `v2`
/// are the two unequal values.
// PORT: the `Eq + Clone` supertraits.
export interface EqUnifyValue<T> {
  eq(a: T, b: T): boolean;
  clone(v: T): T;
}

/** `impl<T: EqUnifyValue> UnifyValue for T` (`Error = (T, T)`). */
export function UnifyValue_EqUnifyValue<T>(T_: EqUnifyValue<T>): UnifyValue<T, [T, T]> {
  return {
    clone: (v) => T_.clone(v),

    // crate: ena-0.14.4/src/unify/mod.rs:133 unify_values
    unify_values(value1: T, value2: T): Result<T, [T, T]> {
      if (T_.eq(value1, value2)) {
        return Ok(T_.clone(value1));
      } else {
        return Err<[T, T]>([T_.clone(value1), T_.clone(value2)]);
      }
    },
  };
}

/// A struct which can never be instantiated. Used
/// for the error type for infallible cases.
export class NoError {
  private constructor(readonly _dummy: undefined) {}
}

/** `#[derive(Debug)] NoError` */
export const debug_NoError: Debug<NoError> = (_v, f) => debug_struct(f, "NoError", [["_dummy", "()"]]);

/// Value of a unification key. We implement Tarjan's union-find
/// algorithm: when two keys are unified, one of them is converted
/// into a "redirect" pointing at the other. These redirects form a
/// DAG: the roots of the DAG (nodes that are not redirected) are each
/// associated with a value of type `V` and a rank. The rank is used
/// to keep the DAG relatively balanced, which helps keep the running
/// time of the algorithm under control. For more information, see
/// <http://en.wikipedia.org/wiki/Disjoint-set_data_structure>.
export class VarValue<K, V> {
  constructor(
    public parent: K, // if equal to self, this is a root
    public value: V, // value assigned (only relevant to root)
    public rank: number, // max depth (only relevant to root)
  ) {}

  // crate: ena-0.14.4/src/unify/mod.rs:208 new_var
  static new_var<K, V>(key: K, value: V): VarValue<K, V> {
    return VarValue.new(key, value, 0);
  }

  // crate: ena-0.14.4/src/unify/mod.rs:212 new
  static new<K, V>(parent: K, value: V, rank: number): VarValue<K, V> {
    return new VarValue(
      parent, // this is a root
      value,
      rank,
    );
  }

  // crate: ena-0.14.4/src/unify/mod.rs:220 redirect
  redirect(to: K): void {
    this.parent = to;
  }

  // crate: ena-0.14.4/src/unify/mod.rs:224 root
  root(rank: number, value: V): void {
    this.rank = rank;
    this.value = value;
  }

  /** `#[derive(Clone)]` (`K: Copy`; `K::Value: Clone` is `Value`). */
  clone<E>(Value: UnifyValue<V, E>): VarValue<K, V> {
    return new VarValue(this.parent, Value.clone(this.value), this.rank);
  }
}

/** `#[derive(Debug)] VarValue<K>` */
export function debug_VarValue<K, V>(v: VarValue<K, V>, f: Fmt, debug_K: Debug<K>, debug_V: Debug<V>): string {
  return debug_struct(f, "VarValue", [
    ["parent", debug_K(v.parent, f)],
    ["value", debug_V(v.value, f)],
    ["rank", String(v.rank)],
  ]);
}

/// Table of unification keys and their values. You must define a key type K
/// that implements the `UnifyKey` trait. Unification tables can be used in two-modes:
///
/// - in-place (`UnificationTable<InPlace<K>>` or `InPlaceUnificationTable<K>`):
///   - This is the standard mutable mode, where the array is modified
///     in place.
///   - To do backtracking, you can employ the `snapshot` and `rollback_to`
///     methods.
/// - persistent (`UnificationTable<Persistent<K>>` or `PersistentUnificationTable<K>`):
///   - In this mode, we use a persistent vector to store the data, so that
///     cloning the table is an O(1) operation.
///   - This implies that ordinary operations are quite a bit slower though.
///   - Requires the `persistent` feature be selected in your Cargo.toml file.
export class UnificationTable<K, V, E, S extends UnificationStoreBase<K, V, E> = InPlace<K, V, E>> {
  constructor(
    /// Indicates the current value of each key.
    public values: S,
  ) {}

  /** `#[derive(Clone)]`: `S: Clone` is `clone_S`. */
  clone(clone_S: (s: S) => S): UnificationTable<K, V, E, S> {
    return new UnificationTable<K, V, E, S>(clone_S(this.values));
  }

  // ---- impl UnificationTableStorage<K> ----

  /// Creates a `UnificationTable` using an external `undo_log`, allowing mutating methods to be
  /// called if `L` does not implement `UndoLogs`
  // crate: ena-0.14.4/src/unify/mod.rs:236 with_log
  with_log<L extends UndoLogs<SvUndoLog<VarValue<K, V>, undefined>>>(
    this: UnificationTableStorage<K, V, E>,
    undo_log: L,
  ): UnificationTable<K, V, E, InPlace<K, V, E, L>> {
    return new UnificationTable<K, V, E, InPlace<K, V, E, L>>(new InPlace<K, V, E, L>(this.values.values.with_log(undo_log), this.values.Key));
  }

  // We can't use V:LatticeValue, much as I would like to,
  // because frequently the pattern is that V=Option<U> for some
  // other type parameter U, and we have no way to say
  // Option<U>:LatticeValue.

  // PORT: `S: Default` is `S_default`.
  // crate: ena-0.14.4/src/unify/mod.rs:257 new
  static new<S extends UnificationStoreBase<StoreKey<S>, StoreValue<S>, StoreError<S>>>(
    S_default: () => S,
  ): UnificationTable<StoreKey<S>, StoreValue<S>, StoreError<S>, S> {
    // `Self::default()` (derived: `values: S::default()`)
    return new UnificationTable(S_default());
  }

  // ---- impl<S: UnificationStore> UnificationTable<S> ----

  /// Starts a new snapshot. Each snapshot must be either
  /// rolled back or committed in a "LIFO" (stack) order.
  // crate: ena-0.14.4/src/unify/mod.rs:265 snapshot
  snapshot<Snap>(this: UnificationTable<K, V, E, UnificationStore<K, V, E, Snap>>): Snapshot<Snap> {
    return {
      snapshot: this.values.start_snapshot(),
    };
  }

  /// Reverses all changes since the last snapshot. Also
  /// removes any keys that have been created since then.
  // crate: ena-0.14.4/src/unify/mod.rs:274 rollback_to
  rollback_to<Snap>(this: UnificationTable<K, V, E, UnificationStore<K, V, E, Snap>>, snapshot: Snapshot<Snap>): void {
    // debug!("{}: rollback_to()", S::tag());
    this.values.rollback_to(snapshot.snapshot);
  }

  /// Commits all changes since the last snapshot. Of course, they
  /// can still be undone if there is a snapshot further out.
  // crate: ena-0.14.4/src/unify/mod.rs:281 commit
  commit<Snap>(this: UnificationTable<K, V, E, UnificationStore<K, V, E, Snap>>, snapshot: Snapshot<Snap>): void {
    // debug!("{}: commit()", S::tag());
    this.values.commit(snapshot.snapshot);
  }

  /// Returns the keys of all variables created since the `snapshot`.
  // crate: ena-0.14.4/src/unify/mod.rs:287 vars_since_snapshot
  vars_since_snapshot<Snap>(this: UnificationTable<K, V, E, UnificationStore<K, V, E, Snap>>, snapshot: Snapshot<Snap>): Range<K> {
    const range = this.values.values_since_snapshot(snapshot.snapshot);
    return { start: this.values.Key.from_index(range.start >>> 0), end: this.values.Key.from_index(range.end >>> 0) };
  }

  // ---- impl<S: UnificationStoreBase> UnificationTable<S> ----

  /// Returns the number of keys created so far.
  // crate: ena-0.14.4/src/unify/mod.rs:295 len
  len(): number {
    return this.values.len();
  }

  /// Obtains the current value for a particular key.
  /// Not for end-users; they can use `probe_value`.
  // crate: ena-0.14.4/src/unify/mod.rs:301 value
  value(key: K): VarValue<K, V> {
    return this.values.index(this.values.Key.index(key));
  }

  // ---- impl<S: UnificationStoreMut> UnificationTable<S> ----

  /// Creates a fresh key with the given value.
  // crate: ena-0.14.4/src/unify/mod.rs:308 new_key
  new_key(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, value: V): K {
    const len = this.values.len();
    const key: K = this.values.Key.from_index(len >>> 0);
    this.values.push(VarValue.new_var(key, value));
    // debug!("{}: created new key: {:?}", S::tag(), key);
    return key;
  }

  /// Reserve memory for `num_new_keys` to be created. Does not
  /// actually create the new keys; you must then invoke `new_key`.
  // crate: ena-0.14.4/src/unify/mod.rs:318 reserve
  reserve(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, num_new_keys: number): void {
    this.values.reserve(num_new_keys);
  }

  /// Clears all unifications that have been performed, resetting to
  /// the initial state. The values of each variable are given by
  /// the closure.
  // crate: ena-0.14.4/src/unify/mod.rs:325 reset_unifications
  reset_unifications(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, value: (key: K) => V): void {
    const Key = this.values.Key;
    this.values.reset_unifications((i) => {
      const key = Key.from_index(i >>> 0);
      const value_ = value(key);
      return VarValue.new_var(key, value_);
    });
  }

  /// Find the root node for `vid`. This uses the standard
  /// union-find algorithm with path compression:
  /// <http://en.wikipedia.org/wiki/Disjoint-set_data_structure>.
  ///
  /// NB. This is a building-block operation and you would probably
  /// prefer to call `probe` below.
  ///
  /// This is an always-inlined version of this function for the hot
  /// callsites. `uninlined_get_root_key` is the never-inlined version.
  // crate: ena-0.14.4/src/unify/mod.rs:343 inlined_get_root_key
  inlined_get_root_key(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, vid: K): K {
    const Key = this.values.Key;
    const v = this.value(vid);
    if (Key.eq(v.parent, vid)) {
      return vid;
    }

    const redirect = v.parent;
    const root_key: K = this.uninlined_get_root_key(redirect);
    if (!Key.eq(root_key, redirect)) {
      // Path compression
      this.update_value(vid, (value) => {
        value.parent = root_key;
      });
    }

    return root_key;
  }

  // This is a never-inlined version of this function for cold callsites.
  // 'inlined_get_root_key` is the always-inlined version.
  // crate: ena-0.14.4/src/unify/mod.rs:362 uninlined_get_root_key
  uninlined_get_root_key(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, vid: K): K {
    return this.inlined_get_root_key(vid);
  }

  // crate: ena-0.14.4/src/unify/mod.rs:366 update_value
  update_value(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, key: K, op: (value: VarValue<K, V>) => void): void {
    this.values.update(this.values.Key.index(key), op);
    // debug!("Updated variable {:?} to {:?}", key, self.value(key));
  }

  /// Either redirects `node_a` to `node_b` or vice versa, depending
  /// on the relative rank. The value associated with the new root
  /// will be `new_value`.
  ///
  /// NB: This is the "union" operation of "union-find". It is
  /// really more of a building block. If the values associated with
  /// your key are non-trivial, you would probably prefer to call
  /// `unify_var_var` below.
  // crate: ena-0.14.4/src/unify/mod.rs:382 unify_roots
  unify_roots(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, key_a: K, key_b: K, new_value: V): void {
    // debug!("unify(key_a={:?}, key_b={:?})", key_a, key_b);

    const Key = this.values.Key;
    const rank_a = this.value(key_a).rank;
    const rank_b = this.value(key_b).rank;
    const roots = Key.order_roots(key_a, this.value(key_a).value, key_b, this.value(key_b).value);
    if (roots !== undefined) {
      const [new_root, redirected] = roots;
      // compute the new rank for the new root that they chose;
      // this may not be the optimal choice.
      let new_rank: number;
      if (Key.eq(new_root, key_a)) {
        // debug_assert!(redirected == key_b);
        if (rank_a > rank_b) {
          new_rank = rank_a;
        } else {
          new_rank = rank_b + 1;
        }
      } else {
        // debug_assert!(new_root == key_b);
        // debug_assert!(redirected == key_a);
        if (rank_b > rank_a) {
          new_rank = rank_b;
        } else {
          new_rank = rank_a + 1;
        }
      }
      this.redirect_root(new_rank, redirected, new_root, new_value);
    } else if (rank_a > rank_b) {
      // a has greater rank, so a should become b's parent,
      // i.e., b should redirect to a.
      this.redirect_root(rank_a, key_b, key_a, new_value);
    } else if (rank_a < rank_b) {
      // b has greater rank, so a should redirect to b.
      this.redirect_root(rank_b, key_a, key_b, new_value);
    } else {
      // If equal, redirect one to the other and increment the
      // other's rank.
      this.redirect_root(rank_a + 1, key_a, key_b, new_value);
    }
  }

  /// Internal method to redirect `old_root_key` (which is currently
  /// a root) to a child of `new_root_key` (which will remain a
  /// root). The rank and value of `new_root_key` will be updated to
  /// `new_rank` and `new_value` respectively.
  // crate: ena-0.14.4/src/unify/mod.rs:430 redirect_root
  redirect_root(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, new_rank: number, old_root_key: K, new_root_key: K, new_value: V): void {
    this.update_value(old_root_key, (old_root_value) => {
      old_root_value.redirect(new_root_key);
    });
    this.update_value(new_root_key, (new_root_value) => {
      new_root_value.root(new_rank, new_value);
    });
  }

  // ---- Public API: impl<S: UnificationStoreBase<Key = K, Value = V>> ----

  /// Obtains current value for key without any pointer chasing; may return `None` if key has been union'd.
  // crate: ena-0.14.4/src/unify/mod.rs:457 try_probe_value
  try_probe_value(id: K): Some<V> | undefined {
    const v = this.value(id);
    if (this.values.Key.eq(v.parent, id)) {
      return { $: "Some", _0: v.value };
    }
    return undefined;
  }

  // ---- Public API: impl<S: UnificationStoreMut<Key = K, Value = V>> ----

  /// Unions two keys without the possibility of failure; only
  /// applicable when unify values use `NoError` as their error
  /// type.
  // crate: ena-0.14.4/src/unify/mod.rs:480 union
  union(this: UnificationTable<K, V, NoError, UnificationStoreMut<K, V, NoError>>, a_id: K, b_id: K): void {
    unwrap_result(this.unify_var_var(a_id, b_id), debug_NoError);
  }

  /// Unions a key and a value without the possibility of failure;
  /// only applicable when unify values use `NoError` as their error
  /// type.
  // crate: ena-0.14.4/src/unify/mod.rs:492 union_value
  union_value(this: UnificationTable<K, V, NoError, UnificationStoreMut<K, V, NoError>>, id: K, value: V): void {
    unwrap_result(this.unify_var_value(id, value), debug_NoError);
  }

  /// Given two keys, indicates whether they have been unioned together.
  // crate: ena-0.14.4/src/unify/mod.rs:501 unioned
  unioned(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, a_id: K, b_id: K): boolean {
    return this.values.Key.eq(this.find(a_id), this.find(b_id));
  }

  /// Given a key, returns the (current) root key.
  // crate: ena-0.14.4/src/unify/mod.rs:510 find
  find(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, id: K): K {
    return this.uninlined_get_root_key(id);
  }

  /// Unions together two variables, merging their values. If
  /// merging the values fails, the error is propagated and this
  /// method has no effect.
  // crate: ena-0.14.4/src/unify/mod.rs:521 unify_var_var
  unify_var_var(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, a_id: K, b_id: K): Result<undefined, E> {
    const root_a = this.uninlined_get_root_key(a_id);
    const root_b = this.uninlined_get_root_key(b_id);

    if (this.values.Key.eq(root_a, root_b)) {
      return Ok(undefined);
    }

    const combined = this.values.Key.Value.unify_values(this.value(root_a).value, this.value(root_b).value);
    if (combined.$ === "Err") return combined;

    this.unify_roots(root_a, root_b, combined._0);
    return Ok(undefined);
  }

  /// Sets the value of the key `a_id` to `b`, attempting to merge
  /// with the previous value.
  // crate: ena-0.14.4/src/unify/mod.rs:543 unify_var_value
  unify_var_value(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, a_id: K, b: V): Result<undefined, E> {
    const root_a = this.uninlined_get_root_key(a_id);
    const r = this.values.Key.Value.unify_values(this.value(root_a).value, b);
    if (r.$ === "Err") return r;
    const value = r._0;
    this.update_value(root_a, (node) => {
      node.value = value;
    });
    return Ok(undefined);
  }

  /// Returns the current value for the given key. If the key has
  /// been union'd, this will give the value from the current root.
  // crate: ena-0.14.4/src/unify/mod.rs:556 probe_value
  probe_value(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, id: K): V {
    return this.inlined_probe_value(id);
  }

  // An always-inlined version of `probe_value`, for hot callsites.
  // crate: ena-0.14.4/src/unify/mod.rs:565 inlined_probe_value
  inlined_probe_value(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, id_: K): V {
    const id = this.inlined_get_root_key(id_);
    return this.values.Key.Value.clone(this.value(id).value);
  }

  // An always-inlined version of `probe_value`, for hot callsites.
  // And returns the root key of the given key along with the value.
  // crate: ena-0.14.4/src/unify/mod.rs:577 inlined_probe_key_value
  inlined_probe_key_value(this: UnificationTable<K, V, E, UnificationStoreMut<K, V, E>>, id_: K): [K, V] {
    const id = this.inlined_get_root_key(id_);
    return [id, this.values.Key.Value.clone(this.value(id).value)];
  }

  // ---- impl Rollback<sv::UndoLog<Delegate<K>>> for UnificationTableStorage<K> (backing_vec.rs) ----

  // crate: ena-0.14.4/src/unify/backing_vec.rs:168 reverse
  reverse(this: UnificationTableStorage<K, V, E>, undo: SvUndoLog<VarValue<K, V>, undefined>): void {
    this.values.values.reverse(undo);
  }
}

/** `#[derive(Debug)] UnificationTable<S>` (`S: Debug` is `debug_S`). */
export function debug_UnificationTable<K, V, E, S extends UnificationStoreBase<K, V, E>>(v: UnificationTable<K, V, E, S>, f: Fmt, debug_S: Debug<S>): string {
  return debug_struct(f, "UnificationTable", [["values", debug_S(v.values, f)]]);
}

export type UnificationStorage<K, V> = VarValue<K, V>[];
export type UnificationTableStorage<K, V, E> = UnificationTable<K, V, E, InPlace<K, V, E, undefined>>;

/// A unification table that uses an "in-place" vector.
export type InPlaceUnificationTable<K, V, E, L = VecLog<SvUndoLog<VarValue<K, V>, undefined>>> = UnificationTable<K, V, E, InPlace<K, V, E, L>>;

/// At any time, users may snapshot a unification table.  The changes
/// made during the snapshot may either be *committed* or *rolled back*.
// PORT: `S::Snapshot` is `Snap`; the `PhantomData<S>` marker is erased.
export interface Snapshot<Snap> {
  readonly snapshot: Snap;
}

///////////////////////////////////////////////////////////////////////////

/** `impl UnifyValue for ()` */
export const UnifyValue_unit: UnifyValue<undefined, NoError> = {
  clone: (v) => v,

  // crate: ena-0.14.4/src/unify/mod.rs:592 unify_values
  unify_values(_value1: undefined, _value2: undefined): Result<undefined, NoError> {
    return Ok(undefined);
  },
};

/** `impl<V: UnifyValue> UnifyValue for Option<V>` (`Error = V::Error`). */
export function UnifyValue_Option<V, E>(V_: UnifyValue<V, E>): UnifyValue<V | undefined, E> {
  return {
    clone: (v) => (v === undefined ? undefined : V_.clone(v)),

    // crate: ena-0.14.4/src/unify/mod.rs:600 unify_values
    unify_values(a: V | undefined, b: V | undefined): Result<V | undefined, E> {
      if (a === undefined && b === undefined) {
        return Ok(undefined);
      } else if (a !== undefined && b === undefined) {
        return Ok(V_.clone(a));
      } else if (a === undefined && b !== undefined) {
        return Ok(V_.clone(b));
      } else {
        const r = V_.unify_values(a as V, b as V);
        switch (r.$) {
          case "Ok":
            return Ok(r._0);
          case "Err":
            return Err(r._0);
        }
      }
    },
  };
}
