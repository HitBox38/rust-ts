// Port of twox-hash =2.1.2 `src/xxhash3/secret.rs`.
//
// PORT: `Secret([u8])` (an unsized `#[repr(transparent)]` wrapper made by transmuting `&[u8]`) is a class
// holding the `Uint8Array`; `&Secret` is the object. The views and words it hands out are `subarray`
// views of it. `reassert_preconditions` keeps its `debug_assert!` as a comment; `assert_unchecked` is an
// optimizer hint only.

import { debug_tuple, type Debug } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { unwrap } from "../../../std/panic.ts";
import { bp_as_chunks, pairs_of_u64_bytes, u32_from_le_bytes, u64_from_le_bytes } from "../xxhash3.ts";

/// The minimum length of a secret.
export const SECRET_MINIMUM_LENGTH = 136;

export class Secret {
  constructor(readonly _0: Uint8Array) {}

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:16 new
  static new(bytes: Uint8Array): Result<Secret, Error> {
    // Safety: We check for validity before returning.
    const this_ = Secret.new_unchecked(bytes);
    if (this_.is_valid()) {
      return Ok(this_);
    } else {
      return Err(Error_());
    }
  }

  /// # Safety
  ///
  /// You must ensure that the secret byte length is >=
  /// SECRET_MINIMUM_LENGTH.
  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:33 new_unchecked
  static new_unchecked(bytes: Uint8Array): Secret {
    // Safety: We are `#[repr(transparent)]`. It's up to the
    // caller to ensure the length
    return new Secret(bytes);
  }

  // crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:41 for_64 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std

  // #[cfg(feature = "xxhash3_128")]
  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:47 for_128
  for_128(): Secret128BitView {
    return new Secret128BitView(this);
  }

  /** PORT: `&[[u8; 16]]` -> an array of 16-byte views. */
  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:52 words_for_17_to_128
  words_for_17_to_128(): Uint8Array[] {
    this.reassert_preconditions();

    const [words] = bp_as_chunks(this._0, 16);
    return words;
  }

  /// # Safety
  ///
  /// `i` must be less than the number of stripes in the secret
  /// ([`Self::n_stripes`][]).
  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:64 stripe
  stripe(i: number): Uint8Array {
    this.reassert_preconditions();

    // Safety: The caller has ensured that `i` is
    // in-bounds. `&[u8]` and `&[u8; 64]` have the same alignment.
    // debug_assert!(i < self.n_stripes());
    return this._0.subarray(i * 8, i * 8 + 64);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:76 last_stripe
  last_stripe(): Uint8Array {
    this.reassert_preconditions();

    return unwrap(last_chunk(this._0, 64));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:83 last_stripe_secret_better_name
  last_stripe_secret_better_name(): Uint8Array {
    this.reassert_preconditions();

    return unwrap(first_chunk(this._0.subarray(this._0.length - 71), 64));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:90 final_secret
  final_secret(): Uint8Array {
    this.reassert_preconditions();

    return unwrap(first_chunk(this._0.subarray(11), 64));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:97 len
  len(): number {
    return this._0.length;
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:102 n_stripes
  n_stripes(): number {
    // stripes_per_block
    return Math.floor((this.len() - 64) / 8);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:108 reassert_preconditions
  reassert_preconditions(): void {
    // Safety: The length of the bytes was checked at value
    // construction time.
    // debug_assert!(self.is_valid());
    // assert_unchecked(self.is_valid());
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:118 is_valid
  is_valid(): boolean {
    return this._0.length >= SECRET_MINIMUM_LENGTH;
  }
}

/** `<[u8]>::first_chunk::<N>()` as a view. */
function first_chunk(b: Uint8Array, N: number): Uint8Array | undefined {
  return b.length >= N ? b.subarray(0, N) : undefined;
}

/** `<[u8]>::last_chunk::<N>()` as a view. */
function last_chunk(b: Uint8Array, N: number): Uint8Array | undefined {
  return b.length >= N ? b.subarray(b.length - N) : undefined;
}

// #[cfg(feature = "xxhash3_64")] pub struct Secret64BitView<'a>(&'a Secret);
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:130 words_for_0 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:138 words_for_1_to_3 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:146 words_for_4_to_8 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:154 words_for_9_to_16 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:162 words_for_127_to_240_part1 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:170 words_for_127_to_240_part2 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:178 words_for_127_to_240_part3 cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std
// crate-skip: twox-hash-2.1.2/src/xxhash3/secret.rs:184 b cfg(feature = "xxhash3_64"): rustc_metadata enables only xxhash3_128 and std

// #[derive(Copy, Clone)]
// #[cfg(feature = "xxhash3_128")]
export class Secret128BitView {
  constructor(readonly _0: Secret) {}

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:196 words_for_0
  words_for_0(): [bigint, bigint, bigint, bigint] {
    this._0.reassert_preconditions();

    const [q] = bp_as_chunks(this.b().subarray(64), 8);
    return [u64_from_le_bytes(q[0]!), u64_from_le_bytes(q[1]!), u64_from_le_bytes(q[2]!), u64_from_le_bytes(q[3]!)];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:204 words_for_1_to_3
  words_for_1_to_3(): [number, number, number, number] {
    this._0.reassert_preconditions();

    const [q] = bp_as_chunks(this.b(), 4);
    return [u32_from_le_bytes(q[0]!), u32_from_le_bytes(q[1]!), u32_from_le_bytes(q[2]!), u32_from_le_bytes(q[3]!)];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:212 words_for_4_to_8
  words_for_4_to_8(): [bigint, bigint] {
    this._0.reassert_preconditions();

    const [q] = bp_as_chunks(this.b().subarray(16), 8);
    return [u64_from_le_bytes(q[0]!), u64_from_le_bytes(q[1]!)];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:220 words_for_9_to_16
  words_for_9_to_16(): [bigint, bigint, bigint, bigint] {
    this._0.reassert_preconditions();

    const [q] = bp_as_chunks(this.b().subarray(32), 8);
    return [u64_from_le_bytes(q[0]!), u64_from_le_bytes(q[1]!), u64_from_le_bytes(q[2]!), u64_from_le_bytes(q[3]!)];
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:228 words_for_127_to_240_part1
  words_for_127_to_240_part1(): Uint8Array[][] {
    this._0.reassert_preconditions();

    return pairs_of_u64_bytes(this.b());
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:235 words_for_127_to_240_part2
  words_for_127_to_240_part2(): Uint8Array[][] {
    this._0.reassert_preconditions();

    return pairs_of_u64_bytes(this.b().subarray(3));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:242 words_for_127_to_240_part3
  words_for_127_to_240_part3(): Uint8Array[] {
    this._0.reassert_preconditions();

    return unwrap(pairs_of_u64_bytes(this.b().subarray(103))[0]);
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:249 final_secret
  final_secret(): Uint8Array {
    this._0.reassert_preconditions();

    const b = this.b();
    return unwrap(first_chunk(b.subarray(b.length - 75), 64));
  }

  // crate: twox-hash-2.1.2/src/xxhash3/secret.rs:256 b
  b(): Uint8Array {
    return this._0._0;
  }
}

/** `#[derive(Debug)] pub struct Error(());` */
export interface Error {
  readonly _0: undefined;
}

/** `Error(())` */
export function Error_(): Error {
  return { _0: undefined };
}

export const debug_Error: Debug<Error> = (_v, f) => debug_tuple(f, "Error", ["()"]);

// impl core::fmt::Display for Error
// crate: twox-hash-2.1.2/src/xxhash3/secret.rs:267 fmt
export function display_Error(_self: Error): string {
  return `The secret must have at least ${SECRET_MINIMUM_LENGTH} bytes`;
}
