// Port of compiler/rustc_data_structures/src/steal.rs.
//
// PORT: `RwLock<Option<T>>` is the inner `Option<T>` (PORTING §5: sync wrappers are their inner value;
// single-threaded, so `try_write` never fails). `std::any::type_name::<T>()` (used in the panic
// messages) has no runtime counterpart: the creator passes the Rust type name (`type_name`), e.g.
// `"rustc_middle::middle::resolve::ResolverAstLowering"`.
import { type Debug, debug_option, debug_struct, debug_tuple } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import type { StableHashCtxt, StableHasher } from "./stable_hash.ts";

/// The `Steal` struct is intended to used as the value for a query.
/// Specifically, we sometimes have queries (*cough* MIR *cough*)
/// where we create a large, complex value that we want to iteratively
/// update (e.g., optimize). We could clone the value for each
/// optimization, but that'd be expensive. And yet we don't just want
/// to mutate it in place, because that would spoil the idea that
/// queries are these pure functions that produce an immutable value
/// (since if you did the query twice, you could observe the mutations).
/// So instead we have the query produce a `&'tcx Steal<mir::Body<'tcx>>`
/// (to be very specific). Now we can read from this
/// as much as we want (using `borrow()`), but you can also
/// `steal()`. Once you steal, any further attempt to read will panic.
/// Therefore, we know that -- assuming no ICE -- nobody is observing
/// the fact that the MIR was updated.
///
/// Obviously, whenever you have a query that yields a `Steal` value,
/// you must treat it with caution, and make sure that you know that
/// -- once the value is stolen -- it will never be read from again.
//
// FIXME(#41710): what is the best way to model linear queries?
export class Steal<T> {
  /** PORT: `RwLock<Option<T>>`; `{ $: "Some" }` wrapper because `T` may itself be `undefined`-able. */
  value: { _0: T } | undefined;
  /** PORT: `std::any::type_name::<T>()`, supplied by the creator (see the module comment). */
  readonly type_name: string;

  private constructor(value: { _0: T } | undefined, type_name: string) {
    this.value = value;
    this.type_name = type_name;
  }

  // rustc: compiler/rustc_data_structures/src/steal.rs:30 new
  static new<T>(value: T, type_name: string): Steal<T> {
    return new Steal<T>({ _0: value }, type_name);
  }

  // rustc: compiler/rustc_data_structures/src/steal.rs:35 borrow
  borrow(): T {
    const borrow = this.value;
    if (borrow === undefined) {
      panic(`attempted to read from stolen value: ${this.type_name}`);
    }
    return borrow._0;
  }

  /// An escape hatch for rustc drivers to mutate `Steal` caches.
  ///
  /// Use at your own risk. This can badly break incremental compilation
  /// and anything else that relies on the immutability of query caches.
  // rustc: compiler/rustc_data_structures/src/steal.rs:48 risky_hack_borrow_mut
  risky_hack_borrow_mut(): T {
    // PORT: the write guard is the value itself (objects are mutated in place).
    const borrow = this.value;
    if (borrow === undefined) {
      panic(`attempted to read from stolen value: ${this.type_name}`);
    }
    return borrow._0;
  }

  // rustc: compiler/rustc_data_structures/src/steal.rs:57 steal
  steal(): T {
    // `self.value.try_write().expect("stealing value which is locked")`: never locked (single-threaded).
    const value = this.value;
    this.value = undefined;
    if (value === undefined) panic("attempt to steal from stolen value");
    return value._0;
  }

  /// Writers of rustc drivers often encounter stealing issues. This function makes it possible to
  /// handle these errors gracefully.
  ///
  /// This should not be used within rustc as it leaks information not tracked
  /// by the query system, breaking incremental compilation.
  // rustc: compiler/rustc_data_structures/src/steal.rs:69 is_stolen
  is_stolen(): boolean {
    return this.value === undefined;
  }
}

// rustc: compiler/rustc_data_structures/src/steal.rs:75 stable_hash
export function stable_hash_Steal<T>(
  self: Steal<T>,
  hcx: StableHashCtxt,
  hasher: StableHasher,
  stable_hash_T: (v: T, hcx: StableHashCtxt, hasher: StableHasher) => void,
): void {
  stable_hash_T(self.borrow(), hcx, hasher);
}

/**
 * `#[derive(Debug)] struct Steal<T> { value: RwLock<Option<T>> }`, where `rustc_data_structures::sync::RwLock<T>`
 * is `#[derive(Debug)] struct RwLock<T>(parking_lot::RwLock<T>)` (sync.rs:172) and lock_api 0.4.14's Debug
 * (rwlock.rs:1235) prints `RwLock { data: .. }` (never `<locked>` here: nothing holds the lock while formatting).
 */
export function debug_Steal<T>(v: Steal<T>, f: Parameters<Debug<T>>[1], inner: Debug<T>): string {
  const data = debug_option(v.value, f, (x, f) => inner(x._0, f));
  return debug_struct(f, "Steal", [["value", debug_tuple(f, "RwLock", [debug_struct(f, "RwLock", [["data", data]])])]]);
}
