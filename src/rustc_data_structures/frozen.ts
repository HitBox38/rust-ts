// Port of compiler/rustc_data_structures/src/frozen.rs
//
// PORT: `Frozen<T>` is the inner value `T` (as transitive_relation.ts already treats it): TS has no `&`/`&mut`
// distinction to enforce, so the newtype only matters for its derived `Debug` (`Frozen(..)`, `debug_Frozen`).
// `Frozen::freeze(x)` and `Deref::deref` are the identity.
import { type Debug, debug_tuple, type Fmt } from "../std/fmt.ts";

//! An immutable, owned value (except for interior mutability).
//!
//! The purpose of `Frozen` is to make a value immutable for the sake of defensive programming. For example,
//! suppose we have the following:
//!
//! ```rust
//! struct Bar { /* some data */ }
//!
//! struct Foo {
//!     /// Some computed data that should never change after construction.
//!     pub computed: Bar,
//!
//!     /* some other fields */
//! }
//!
//! impl Bar {
//!     /// Mutate the `Bar`.
//!     pub fn mutate(&mut self) { }
//! }
//! ```
//!
//! Now suppose we want to pass around a mutable `Foo` instance but, we want to make sure that
//! `computed` does not change accidentally (e.g. somebody might accidentally call
//! `foo.computed.mutate()`). This is what `Frozen` is for. We can do the following:
//!
//! ```
//! # struct Bar {}
//! use rustc_data_structures::frozen::Frozen;
//!
//! struct Foo {
//!     /// Some computed data that should never change after construction.
//!     pub computed: Frozen<Bar>,
//!
//!     /* some other fields */
//! }
//! ```
//!
//! `Frozen` impls `Deref`, so we can ergonomically call methods on `Bar`, but it doesn't `impl
//! DerefMut`. Now calling `foo.compute.mutate()` will result in a compile-time error stating that
//! `mutate` requires a mutable reference but we don't have one.
//!
//! # Caveats
//!
//! - `Frozen` doesn't try to defend against interior mutability (e.g. `Frozen<RefCell<Bar>>`).
//! - `Frozen` doesn't pin it's contents (e.g. one could still do `foo.computed =
//!    Frozen::freeze(new_bar)`).

/// An owned immutable value.
// rustc-type: compiler/rustc_data_structures/src/frozen.rs:50 Frozen
export type Frozen<T> = T;

export const Frozen = {
  // rustc: compiler/rustc_data_structures/src/frozen.rs:53 freeze
  freeze<T>(val: T): Frozen<T> {
    return val;
  },

  // impl<T> std::ops::Deref for Frozen<T>
  // rustc: compiler/rustc_data_structures/src/frozen.rs:61 deref
  deref<T>(self: Frozen<T>): T {
    return self;
  },
};

/** `#[derive(Debug)]` of `Frozen<T>` (a tuple struct). */
export function debug_Frozen<T>(v: Frozen<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_tuple(f, "Frozen", [debug_T(v, f)]);
}
