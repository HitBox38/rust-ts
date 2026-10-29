// Port of twox-hash =2.1.2 `src/xxhash3/streaming.rs`.
//
// PORT: the secret storage `S: FixedBuffer` (`[u8; N]`, `&[u8; N]`, `&mut [u8; N]`, `Box<[u8]>`) is always
// a `Uint8Array`, and `AsRef<[u8]>`/`AsMut<[u8]>` are the array itself; `FixedBuffer`/`FixedMutBuffer`
// are marker traits with no methods. The `Buffer` (`[u8; 256]`) is a `Uint8Array`.
// PORT: `#[derive(Clone)]`/`#[derive(Copy, Clone)]` are `clone_<Type>` functions (the copy semantics are
// load-bearing: `finish_impl` works on a copy of the `StripeAccumulator`, so finishing does not change the
// hasher).

import { debug_tuple, type Debug } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { assert } from "../../../std/panic.ts";
import {
  CUTOFF,
  DEFAULT_SECRET,
  DEFAULT_SECRET_LENGTH,
  DEFAULT_SECRET_RAW,
  DEFAULT_SEED,
  type DefaultSecret,
  derive_secret,
  bp_as_chunks,
  stripes_with_tail,
} from "../xxhash3.ts";
import { type Acc, do_scalar, INITIAL_ACCUMULATORS, type Vector } from "./large.ts";
import { display_Error, type Error as SecretError, Secret, SECRET_MINIMUM_LENGTH } from "./secret.ts";

/// A buffer containing the secret bytes.
///
/// # Safety
///
/// Must always return a slice with the same number of elements.
// pub unsafe trait FixedBuffer: AsRef<[u8]> {}
export type FixedBuffer = Uint8Array;

/// A mutable buffer to contain the secret bytes.
///
/// # Safety
///
/// Must always return a slice with the same number of elements. The
/// slice must always be the same as that returned from
/// [`AsRef::as_ref`][].
// pub unsafe trait FixedMutBuffer: FixedBuffer + AsMut<[u8]> {}
export type FixedMutBuffer = Uint8Array;

const STRIPE_BYTES = 64;
const BUFFERED_STRIPES = 4;
const BUFFERED_BYTES = STRIPE_BYTES * BUFFERED_STRIPES;
/** `type Buffer = [u8; BUFFERED_BYTES];` */
type Buffer = Uint8Array;

// Ensure that a full buffer always implies we are in the 241+ byte case.
assert(BUFFERED_BYTES > CUTOFF);

/// Holds secret and temporary buffers that are ensured to be
/// appropriately sized.
// #[derive(Clone)]
export class SecretBuffer<S extends FixedBuffer = FixedBuffer> {
  constructor(
    public seed: bigint,
    public secret: S,
    public buffer: Buffer,
  ) {}

  /// Returns the secret.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:55 into_secret
  into_secret(): S {
    return this.secret;
  }

  /// Takes the seed, secret, and buffer and performs no
  /// modifications to them, only validating that the sizes are
  /// appropriate.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:67 new
  static new<S extends FixedBuffer>(seed: bigint, secret: S): Result<SecretBuffer<S>, SecretTooShortError<S>> {
    const r = Secret.new(secret);
    switch (r.$) {
      case "Ok":
        return Ok(new SecretBuffer(seed, secret, new Uint8Array(BUFFERED_BYTES)));
      case "Err":
        return Err(new SecretTooShortError(r._0, secret));
    }
  }

  // #[cfg(test)]
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:80 is_valid
  is_valid(): boolean {
    const secret = this.secret;

    return secret.length >= SECRET_MINIMUM_LENGTH;
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:87 n_stripes
  n_stripes(): number {
    return SecretBuffer.secret(this.secret).n_stripes();
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:92 parts
  parts(): [bigint, Secret, Buffer] {
    return [this.seed, SecretBuffer.secret(this.secret), this.buffer];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:97 parts_mut
  parts_mut(): [bigint, Secret, Buffer] {
    return [this.seed, SecretBuffer.secret(this.secret), this.buffer];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:101 secret
  static secret(secret_: FixedBuffer): Secret {
    const secret = secret_;
    // Safety: We established the length at construction and the
    // length is not allowed to change.
    return Secret.new_unchecked(secret);
  }

  /// Fills the secret buffer with a secret derived from the seed
  /// and the default secret. The secret must be exactly
  /// [`DEFAULT_SECRET_LENGTH`][] bytes long.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:116 with_seed
  static with_seed<S extends FixedMutBuffer>(seed: bigint, secret: S): Result<SecretBuffer<S>, SecretWithSeedError<S>> {
    // match <&mut DefaultSecret>::try_from(secret.as_mut())
    if (secret.length === DEFAULT_SECRET_LENGTH) {
      const secret_slice: DefaultSecret = secret;
      secret_slice.set(DEFAULT_SECRET_RAW);
      derive_secret(seed, secret_slice);

      return Ok(new SecretBuffer(seed, secret, new Uint8Array(BUFFERED_BYTES)));
    } else {
      return Err(new SecretWithSeedError(secret));
    }
  }

  // impl SecretBuffer<&'static [u8; DEFAULT_SECRET_LENGTH]>
  /// Use the default seed and secret values while allocating nothing.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:136 default
  static default_(): SecretBuffer<DefaultSecret> {
    return new SecretBuffer(DEFAULT_SEED, DEFAULT_SECRET_RAW, new Uint8Array(BUFFERED_BYTES));
  }

  // mod with_alloc: type AllocSecretBuffer = SecretBuffer<Box<[u8]>>;

  /// Allocates the secret and temporary buffers and fills them
  /// with the default seed and secret values.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:387 allocate_default
  static allocate_default(): SecretBuffer<Uint8Array> {
    return new SecretBuffer(DEFAULT_SEED, DEFAULT_SECRET_RAW.slice(), new Uint8Array(BUFFERED_BYTES));
  }

  /// Allocates the secret and temporary buffers and uses the
  /// provided seed to construct the secret value.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:397 allocate_with_seed
  static allocate_with_seed(seed: bigint): SecretBuffer<Uint8Array> {
    const secret = DEFAULT_SECRET_RAW.slice();
    derive_secret(seed, secret);

    return new SecretBuffer(seed, secret.slice(), new Uint8Array(BUFFERED_BYTES));
  }

  /// Allocates the temporary buffer and uses the provided seed
  /// and secret buffer.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:410 allocate_with_seed_and_secret
  static allocate_with_seed_and_secret(seed: bigint, secret: Uint8Array): Result<SecretBuffer<Uint8Array>, SecretTooShortError<Uint8Array>> {
    return SecretBuffer.new(seed, secret);
  }
}

export function clone_SecretBuffer<S extends FixedBuffer>(v: SecretBuffer<S>): SecretBuffer<S> {
  return new SecretBuffer(v.seed, v.secret.slice() as S, v.buffer.slice());
}

// #[derive(Clone)]
export class RawHasherCore<S extends FixedBuffer = FixedBuffer> {
  constructor(
    public secret_buffer: SecretBuffer<S>,
    public buffer_usage: number,
    public stripe_accumulator: StripeAccumulator,
    public total_bytes: number,
  ) {}

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:154 new
  static new<S extends FixedBuffer>(secret_buffer: SecretBuffer<S>): RawHasherCore<S> {
    return new RawHasherCore(secret_buffer, 0, StripeAccumulator.new(), 0);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:163 into_secret
  into_secret(): S {
    return this.secret_buffer.into_secret();
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:173 write
  write(input: Uint8Array): void {
    const this_ = this;
    // dispatch! { fn write_impl<S>(this: &mut RawHasherCore<S>, input: &[u8]) [S: FixedBuffer] }
    // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:176 write_impl
    do_scalar(write_impl<S>, this_, input);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:182 finish
  finish<O>(finalize: Finalize<O>): O {
    const this_ = this;
    // dispatch! { fn finish_impl<S, F>(this: &RawHasherCore<S>, finalize: F) -> F::Output [S: FixedBuffer, F: Finalize] }
    // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:188 finish_impl
    return do_scalar(finish_impl<S, O>, this_, finalize);
  }

  // mod with_alloc: pub type AllocRawHasher = RawHasherCore<Box<[u8]>>;

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:421 allocate_default
  static allocate_default(): AllocRawHasher {
    return RawHasherCore.new(SecretBuffer.allocate_default());
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:425 allocate_with_seed
  static allocate_with_seed(seed: bigint): AllocRawHasher {
    return RawHasherCore.new(SecretBuffer.allocate_with_seed(seed));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:429 allocate_with_seed_and_secret
  static allocate_with_seed_and_secret(seed: bigint, secret: Uint8Array): Result<AllocRawHasher, SecretTooShortError<Uint8Array>> {
    const r = SecretBuffer.allocate_with_seed_and_secret(seed, secret);
    return r.$ === "Ok" ? Ok(RawHasherCore.new(r._0)) : r;
  }
}

export function clone_RawHasherCore<S extends FixedBuffer>(v: RawHasherCore<S>): RawHasherCore<S> {
  return new RawHasherCore(clone_SecretBuffer(v.secret_buffer), v.buffer_usage, clone_StripeAccumulator(v.stripe_accumulator), v.total_bytes);
}

// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:195 write_impl
function write_impl<S extends FixedBuffer>(vector: Vector, this_: RawHasherCore<S>, input: Uint8Array): void {
  if (input.length === 0) {
    return;
  }

  const { secret_buffer, stripe_accumulator } = this_;

  const n_stripes = secret_buffer.n_stripes();
  const [, secret, buffer] = secret_buffer.parts_mut();

  this_.total_bytes += input.length;

  // Safety: This is an invariant of the buffer.
  // debug_assert!(*buffer_usage <= buffer.len());
  // assert_unchecked(*buffer_usage <= buffer.len())

  // We have some previous data saved; try to fill it up and process it first
  if (buffer.length !== 0) {
    const remaining = buffer.subarray(this_.buffer_usage);
    const n_to_copy = Math.min(remaining.length, input.length);

    const remaining_head = remaining.subarray(0, n_to_copy);
    const remaining_tail = remaining.subarray(n_to_copy);
    const input_head = input.subarray(0, n_to_copy);
    const input_tail = input.subarray(n_to_copy);

    remaining_head.set(input_head);
    this_.buffer_usage += n_to_copy;

    input = input_tail;

    // We did not fill up the buffer
    if (remaining_tail.length !== 0) {
      return;
    }

    // We don't know this isn't the last of the data
    if (input.length === 0) {
      return;
    }

    const [stripes] = bp_as_chunks(buffer, 64);
    for (const stripe of stripes) {
      stripe_accumulator.process_stripe(vector, stripe, n_stripes, secret);
    }
    this_.buffer_usage = 0;
  }

  // debug_assert!(*buffer_usage == 0);

  // Process as much of the input data in-place as possible,
  // while leaving at least one full stripe for the
  // finalization.
  // if let Some(len) = input.len().checked_sub(STRIPE_BYTES)
  if (input.length >= STRIPE_BYTES) {
    const len = input.length - STRIPE_BYTES;
    const full_block_point = Math.floor(len / STRIPE_BYTES) * STRIPE_BYTES;
    // Safety: We know that `full_block_point` must be less than
    // `input.len()` as we subtracted and then integer-divided
    // (which rounds down) and then multiplied back. That's not
    // evident to the compiler and `split_at` results in a
    // potential panic.
    //
    // https://github.com/llvm/llvm-project/issues/104827
    const stripes0 = input.subarray(0, full_block_point);
    const remainder = input.subarray(full_block_point);
    const [stripes] = bp_as_chunks(stripes0, 64);

    for (const stripe of stripes) {
      stripe_accumulator.process_stripe(vector, stripe, n_stripes, secret);
    }
    input = remainder;
  }

  // Any remaining data has to be less than the buffer, and the
  // buffer is empty so just fill up the buffer.
  // debug_assert!(*buffer_usage == 0);
  // debug_assert!(!input.is_empty());

  // Safety: We have parsed all the full blocks of input except one
  // and potentially a full block minus one byte. That amount of
  // data must be less than the buffer.
  // debug_assert!(input.len() < 2 * STRIPE_BYTES);
  // debug_assert!(2 * STRIPE_BYTES < buffer.len());
  const buffer_head = buffer.subarray(0, input.length);

  buffer_head.set(input);
  this_.buffer_usage = input.length;
}

// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:294 finish_impl
function finish_impl<S extends FixedBuffer, O>(vector: Vector, this_: RawHasherCore<S>, finalize: Finalize<O>): O {
  const secret_buffer = this_.secret_buffer;
  const buffer_usage = this_.buffer_usage;
  const stripe_accumulator = clone_StripeAccumulator(this_.stripe_accumulator);
  const total_bytes = this_.total_bytes;

  const n_stripes = secret_buffer.n_stripes();
  const [seed, secret, buffer] = secret_buffer.parts();

  // Safety: This is an invariant of the buffer.
  // debug_assert!(buffer_usage <= buffer.len());
  // assert_unchecked(buffer_usage <= buffer.len())

  if (total_bytes > CUTOFF) {
    const input = buffer.subarray(0, buffer_usage);

    // Ingest final stripes
    const [stripes, remainder] = stripes_with_tail(input);
    for (const stripe of stripes) {
      stripe_accumulator.process_stripe(vector, stripe, n_stripes, secret);
    }

    const temp = new Uint8Array(64);

    let last_stripe: Uint8Array;
    // match input.last_chunk()
    if (input.length >= 64) {
      last_stripe = input.subarray(input.length - 64);
    } else {
      const n_to_reuse = 64 - input.length;
      const to_reuse = buffer.length - n_to_reuse;

      const temp_head = temp.subarray(0, n_to_reuse);
      const temp_tail = temp.subarray(n_to_reuse);
      temp_head.set(buffer.subarray(to_reuse));
      temp_tail.set(input);

      last_stripe = temp;
    }

    return finalize.large(vector, stripe_accumulator.accumulator, remainder, last_stripe, secret, total_bytes);
  } else {
    return finalize.small(DEFAULT_SECRET, seed, buffer.subarray(0, total_bytes));
  }
}

// pub trait Finalize { type Output; .. }
export interface Finalize<Output> {
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:356 small
  small(secret: Secret, seed: bigint, input: Uint8Array): Output;

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:358 large
  large(vector: Vector, acc: Acc, last_block: Uint8Array, last_stripe: Uint8Array, secret: Secret, len: number): Output;
}

// #[cfg(feature = "alloc")] pub mod with_alloc: the `AllocSecretBuffer` and `AllocRawHasher` constructors are
// static methods of `SecretBuffer` and `RawHasherCore` above.
//
// Safety: A plain slice will never change size.
// unsafe impl FixedBuffer for Box<[u8]> {}
// unsafe impl FixedMutBuffer for Box<[u8]> {}

export type AllocRawHasher = RawHasherCore<Uint8Array>;

/// Tracks which stripe we are currently on to know which part of the
/// secret we should be using.
// #[derive(Copy, Clone)]
export class StripeAccumulator {
  constructor(
    public accumulator: Acc,
    public current_stripe: number,
  ) {}

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:450 new
  static new(): StripeAccumulator {
    return new StripeAccumulator(INITIAL_ACCUMULATORS.slice(), 0);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:458 process_stripe
  process_stripe(vector: Vector, stripe: Uint8Array, n_stripes: number, secret: Secret): void {
    const accumulator = this.accumulator;

    // For each stripe

    // Safety: The number of stripes is determined by the
    // block size, which is determined by the secret size.
    const secret_stripe = secret.stripe(this.current_stripe);
    vector.accumulate(accumulator, stripe, secret_stripe);

    this.current_stripe += 1;

    // After a full block's worth
    if (this.current_stripe === n_stripes) {
      const secret_end = secret.last_stripe();
      vector.round_scramble(accumulator, secret_end);

      this.current_stripe = 0;
    }
  }
}

export function clone_StripeAccumulator(v: StripeAccumulator): StripeAccumulator {
  return new StripeAccumulator(v.accumulator.slice(), v.current_stripe);
}

/// The provided secret was not exactly [`DEFAULT_SECRET_LENGTH`][]
/// bytes.
export class SecretWithSeedError<S> {
  constructor(readonly _0: S) {}

  /// Returns the secret.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:496 into_secret
  into_secret(): S {
    return this._0;
  }
}

// impl<S> core::fmt::Debug for SecretWithSeedError<S>
// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:504 fmt
export const debug_SecretWithSeedError: Debug<SecretWithSeedError<unknown>> = (_v, f) => debug_tuple(f, "SecretWithSeedError", []);

// impl<S> core::fmt::Display for SecretWithSeedError<S>
// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:510 fmt
export function display_SecretWithSeedError(_self: SecretWithSeedError<unknown>): string {
  return `The secret must be exactly ${DEFAULT_SECRET_LENGTH} bytes`;
}

/// The provided secret was not at least [`SECRET_MINIMUM_LENGTH`][]
/// bytes.
export class SecretTooShortError<S> {
  constructor(
    readonly _0: SecretError,
    readonly _1: S,
  ) {}

  /// Returns the secret.
  // crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:524 into_secret
  into_secret(): S {
    return this._1;
  }
}

// impl<S> core::fmt::Debug for SecretTooShortError<S>
// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:532 fmt
export const debug_SecretTooShortError: Debug<SecretTooShortError<unknown>> = (_v, f) => debug_tuple(f, "SecretTooShortError", []);

// impl<S> core::fmt::Display for SecretTooShortError<S>
// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:538 fmt
export function display_SecretTooShortError(self: SecretTooShortError<unknown>): string {
  return display_Error(self._0);
}
