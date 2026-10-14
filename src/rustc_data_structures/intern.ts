// Port of compiler/rustc_data_structures/src/intern.rs.
//
// PORT (docs/plan-m3.md D2, amends PORTING §5 "Interned handles"): `Interned<'a, T>` is a reference whose
// *address* is its identity. In the port the hash-consed object itself plays that role: every interned class
// (`Ty`, `Region`, `Const`, `Predicate`, `Clause`, `RawList`, ...) carries the `INTERNED` brand and a
// sequential `id`, is frozen after construction, and is unique per value (one object per interner entry).
// So:
// - `Interned::new_unchecked(&x)` is `x` itself (the object the interner just made);
// - `PartialEq` (`ptr::eq`) is `===`; `Hash` (`ptr::hash`) is "use the object as the JS `Map`/`Set` key";
// - `Deref` is the object's own fields;
// - the `id` is used only to build intern keys of *containing* values (rust_ts/intern_key.ts). It is never
//   printed and never ordered on: upstream `Interned` has no `Ord`.
// `RawList` extends `Array` (so a `&List<T>` is directly a `readonly T[]`); it carries the brand and `id`
// itself instead of extending `Interned`.
import type { Debug, Fmt } from "../std/fmt.ts";
import type { FxHasher } from "../vendor/rustc_hash/lib.ts";
import type { StableHash, StableHashCtxt, StableHasher } from "./stable_hash.ts";

/** The brand of hash-consed objects: rust_ts/intern_key.ts keys them by `id`. */
export const INTERNED: unique symbol = Symbol("rustc_data_structures::intern::Interned");

let next_id = 0;

/** PORT: the next sequential intern id (module comment). One counter per process. */
export function next_intern_id(): number {
  return next_id++;
}

/// This type is a reference with one special behaviour: the reference pointer (i.e. the address of
/// the value referred to) is used for equality and hashing, rather than the value's contents, as
/// would occur with a vanilla reference. There are two cases when this is useful.
///
/// - Types where uniqueness is guaranteed. This is most commonly achieved via interning -- hence
///   the name `Interned` -- though it may also be possible via other means. In this case, the use
///   of `Interned` is primarily a performance optimization, because pointer equality/hashing gives
///   the same results as value equality/hashing, but is faster. (The use of the `Interned` type
///   also provides documentation about the interned-ness.)
///
///   Note that in this case it is possible to have a `T` and a `Interned<T>` that are (or refer
///   to) equal but different values. But if you have two different `Interned<T>`s, they both refer
///   to the same value, at a single location in memory.
///
/// - Types with identity, where distinct values should always be considered unequal, even if they
///   have equal values. These are rare in Rust, but do occur sometimes. In this case, the use of
///   `Interned` gives different behaviour, because pointer equality/hashing gives different result
///   to value equality/hashing, and is also faster.
///
/// The `PrivateZst` field means you can pattern match with `Interned(v, _)` but you can only
/// construct a `Interned` with `new_unchecked`, and not directly. This means that all creation
/// points can be audited easily.
// PORT: the base class of hash-consed objects (module comment). Subclasses assign their fields and then
// `Object.freeze(this)` at the end of their constructor.
export abstract class Interned {
  declare readonly [INTERNED]: true;
  /** PORT: sequential id, used only inside intern keys (module comment). */
  readonly id: number = next_intern_id();

  /// Create a new `Interned` value. The value referred to *must* satisfy one of the following
  /// two conditions.
  /// - It must be unique and it must remain unique in the future.
  /// - It must be of a type with "identity" such that distinct values should always be
  ///   considered unequal.
  ///
  /// This function has `_unchecked` in the name but is not `unsafe`, because if neither of these
  /// conditions is met it will cause incorrect behaviour but will not affect memory safety.
  // rustc: compiler/rustc_data_structures/src/intern.rs:48 new_unchecked
  static new_unchecked<T extends Interned>(t: T): T {
    return t;
  }

  // rustc: compiler/rustc_data_structures/src/intern.rs:54 clone
  clone(): this {
    return this;
  }

  // rustc: compiler/rustc_data_structures/src/intern.rs:65 deref
  deref(): this {
    return this;
  }

  // rustc: compiler/rustc_data_structures/src/intern.rs:72 eq
  eq(other: Interned): boolean {
    // Pointer equality implies equality, due to the uniqueness constraint.
    return this === other;
  }
}
Object.defineProperty(Interned.prototype, INTERNED, { value: true });

// rustc: compiler/rustc_data_structures/src/intern.rs:82 hash
/**
 * PORT: `ptr::hash(self.0, s)` writes the address; the port writes the intern `id` instead (a JS object has no
 * address). As a JS `Map`/`Set` key the object itself is used, so this is only reached by hand-written `Hash`
 * impls that hash an interned field into a hasher (FxHash order of interned-keyed maps is D6: not reproduced).
 */
export function hash_Interned(self: Interned, s: Pick<FxHasher, "write_usize">): void {
  s.write_usize(self.id);
}

// rustc: compiler/rustc_data_structures/src/intern.rs:92 stable_hash
/** `impl<T: StableHash> StableHash for Interned<'_, T>`: the referent's stable hash. */
export function stable_hash_Interned<T>(self: T, hcx: StableHashCtxt, hasher: StableHasher, stable_hash_T: StableHash<T>): void {
  stable_hash_T(self, hcx, hasher);
}

// rustc: compiler/rustc_data_structures/src/intern.rs:98 fmt
/** `impl<T: Debug> Debug for Interned<'_, T>`: the referent's Debug (`self.0.fmt(f)`). */
export function debug_Interned<T>(v: T, f: Fmt, debug_T: Debug<T>): string {
  return debug_T(v, f);
}
