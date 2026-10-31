// Port of rand_core =0.10.1 `src/unwrap_err.rs`.
import { Err, Ok, type Result } from "../../std/result.ts";
import { panic } from "../../std/panic.ts";
import { Rng_for_TryRng, type Infallible, type Rng, type TryCryptoRng, type TryRng } from "./lib.ts";

/// Wrapper around [`TryRng`] implementation which implements [`TryRng`]
/// with [`Error`] = [`Infallible`][core::convert::Infallible].
///
/// This is useful when using a fallible RNG with an API expecting an infallible RNG.
/// The wrapper panics on errors.
// PORT: `E: core::error::Error` is rendered with `display_err` (its `Display`) in the panic message.
export class UnwrapErr<E> implements Rng, TryCryptoRng<Infallible> {
  constructor(
    public _0: TryRng<E>,
    /** PORT: `R::Error`'s `Display`. */
    readonly display_err: (e: E) => string = String,
  ) {}

  // impl<R: TryRng> TryRng for UnwrapErr<R>
  // crate: rand_core-0.10.1/src/unwrap_err.rs:36 try_next_u32
  try_next_u32(): Result<number, Infallible> {
    const r = this._0.try_next_u32();
    return r.$ === "Ok" ? r : Err(panic_msg(r._0, this.display_err));
  }

  // crate: rand_core-0.10.1/src/unwrap_err.rs:41 try_next_u64
  try_next_u64(): Result<bigint, Infallible> {
    const r = this._0.try_next_u64();
    return r.$ === "Ok" ? r : Err(panic_msg(r._0, this.display_err));
  }

  // crate: rand_core-0.10.1/src/unwrap_err.rs:46 try_fill_bytes
  try_fill_bytes(dst: Uint8Array): Result<void, Infallible> {
    const r = this._0.try_fill_bytes(dst);
    return r.$ === "Ok" ? Ok(undefined) : Err(panic_msg(r._0, this.display_err));
  }

  // impl Rng (blanket impl over `TryRng<Error = Infallible>`)
  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }

  // impl<'r, R: TryRng + ?Sized> UnwrapErr<&'r mut R>
  /// Reborrow with a new lifetime
  ///
  /// Rust allows references like `&T` or `&mut T` to be "reborrowed" through
  /// coercion: essentially, the pointer is copied under a new, shorter, lifetime.
  /// Until rfcs#1403 lands, reborrows on user types require a method call.
  // crate: rand_core-0.10.1/src/unwrap_err.rs:64 re
  re(): UnwrapErr<E> {
    return new UnwrapErr(this._0, this.display_err);
  }
}

// crate: rand_core-0.10.1/src/unwrap_err.rs:51 panic_msg
function panic_msg<E>(err: E, display_err: (e: E) => string): Infallible {
  panic(`rand_core::UnwrapErr: failed to unwrap: ${display_err(err)}`);
}
