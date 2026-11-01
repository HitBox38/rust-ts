// Port of library/proc_macro/src/bridge/selfless_reify.rs
//
//! Abstraction for creating `fn` pointers from any callable that *effectively*
//! has the equivalent of implementing `Default`, even if the compiler neither
//! provides `Default` nor allows reifying closures (i.e. creating `fn` pointers)
//! other than those with absolutely no captures.
//!
//! More specifically, for a closure-like type to be "effectively `Default`":
//! * it must be a ZST (zero-sized type): no information contained within, so
//!   that `Default`'s return value (if it were implemented) is unambiguous
//! * it must be `Copy`: no captured "unique ZST tokens" or any other similar
//!   types that would make duplicating values at will unsound
//!   * combined with the ZST requirement, this confers a kind of "telecopy"
//!     ability: similar to `Copy`, but without keeping the value around, and
//!     instead "reconstructing" it (a noop given it's a ZST) when needed
//! * it must be *provably* inhabited: no captured uninhabited types or any
//!   other types that cannot be constructed by the user of this abstraction
//!   * the proof is a value of the closure-like type itself, in a sense the
//!     "seed" for the "telecopy" process made possible by ZST + `Copy`
//!   * this requirement is the only reason an abstraction limited to a specific
//!     usecase is required: ZST + `Copy` can be checked with *at worst* a panic
//!     at the "attempted `::default()` call" time, but that doesn't guarantee
//!     that the value can be soundly created, and attempting to use the typical
//!     "proof ZST token" approach leads yet again to having a ZST + `Copy` type
//!     that is not proof of anything without a value (i.e. isomorphic to a
//!     newtype of the type it's trying to prove the inhabitation of)
//!
//! A more flexible (and safer) solution to the general problem could exist once
//! `const`-generic parameters can have type parameters in their types:
//!
//! ```rust,ignore (needs future const-generics)
//! extern "C" fn ffi_wrapper<
//!     A, R,
//!     F: Fn(A) -> R,
//!     const f: F, // <-- this `const`-generic is not yet allowed
//! >(arg: A) -> R {
//!     f(arg)
//! }
//! ```
//
// PORT: a JS closure already is a function value, so "reifying" it is the closure itself wrapped in `wrapper`.
// The zero-size check (`const { assert!(size_of::<F>() == 0, ..) }`) is a compile-time property of the Rust
// closure type with no TS counterpart.

import type { BridgeConfig } from "./mod.ts";

// std: library/proc_macro/src/bridge/selfless_reify.rs:41 reify_to_extern_c_fn_hrt_bridge
export function reify_to_extern_c_fn_hrt_bridge<R>(f: (bridge: BridgeConfig) => R): (bridge: BridgeConfig) => R {
  // FIXME(eddyb) describe the `F` type (e.g. via `type_name::<F>`) once panic
  // formatting becomes possible in `const fn`.
  // const { assert!(size_of::<F>() == 0, "selfless_reify: closure must be zero-sized"); }
  // std: library/proc_macro/src/bridge/selfless_reify.rs:52 wrapper
  function wrapper(bridge: BridgeConfig): R {
    // SAFETY: `F` satisfies all criteria for "out of thin air"
    // reconstructability (see module-level doc comment).
    // PORT: `mem::conjure_zst::<F>()` is the captured `f`.
    return f(bridge);
  }
  const _f_proof = f;
  return wrapper;
}
