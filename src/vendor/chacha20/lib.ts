// Port of chacha20 =0.10.0 `src/lib.rs` (lane vendor-rand, plan-m6 D5), with the features rand 0.10.1
// enables: `default-features = false, features = ["rng"]` (so `cipher`, `xchacha`, `zeroize` are off and the
// `cipher`-only items are crate-skip).
//
// PORT: the state is a `Uint32Array(16)` (stores wrap to u32, so `wrapping_add` is `+` then store).
// `R: Rounds` and `V: Variant` are tables held by the core. Only the portable `soft` backend is ported: the
// oracle host takes `neon` (aarch64) or `avx2`/`sse2` (x86_64), which compute the same keystream (the vendor-rand
// probe compares the streams), so `tokens` (cpufeatures detection) is erased.
// PORT: `pub use rng::{ChaCha8Rng, ChaCha12Rng, ChaCha20Rng, Seed, SerializedRngState}` is not repeated here:
// rng.ts builds its generators from this module's `R8`/`R12`/`R20` at module evaluation, so this module must
// not import it. Import the generators from `./rng.ts`.
import { assert, assert_eq } from "../../std/panic.ts";
import type { Variant } from "./variants.ts";

export * as variants from "./variants.ts";
export * as rand_core from "../rand_core/lib.ts";
export * as backends from "./backends.ts";

// #[cfg(feature = "cipher")] mod chacha; #[cfg(feature = "legacy")] mod legacy; #[cfg(feature = "xchacha")] mod xchacha;
// crate-skip: chacha20-0.10.0/src/chacha.rs:35 new cfg(feature = "cipher"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/legacy.rs:31 new cfg(feature = "legacy"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:60 new cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:74 remaining_blocks cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:79 process_with_backend cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:88 get_block_pos cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:93 set_block_pos cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:116 hchacha cfg(feature = "xchacha"): off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/xchacha.rs:166 test_vector cfg(feature = "xchacha") test: off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/tests/kats.rs:73 chacha20_keystream test of the `cipher` API (off in rand's `features = ["rng"]`)
// crate-skip: chacha20-0.10.0/tests/kats.rs:86 chacha20_encryption test of the `cipher` API (off in rand's `features = ["rng"]`)
// crate-skip: chacha20-0.10.0/tests/kats.rs:161 xchacha20_keystream test of the `xchacha` API (off in rand's `features = ["rng"]`)
// crate-skip: chacha20-0.10.0/tests/kats.rs:174 xchacha20_encryption test of the `xchacha` API (off in rand's `features = ["rng"]`)
// crate-skip: chacha20-0.10.0/tests/kats.rs:217 chacha20_offsets test of the `cipher` API (off in rand's `features = ["rng"]`)

/// State initialization constant ("expand 32-byte k")
const CONSTANTS: readonly number[] = [0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574];

/// Number of 32-bit words in the ChaCha state
export const STATE_WORDS = 16;

/// Marker type for a number of ChaCha rounds to perform.
export interface Rounds {
  /// The amount of rounds to perform
  readonly COUNT: number;
}

/// 8-rounds
export const R8: Rounds = { COUNT: 4 };

/// 12-rounds
export const R12: Rounds = { COUNT: 6 };

/// 20-rounds
export const R20: Rounds = { COUNT: 10 };

/// The ChaCha core function.
export class ChaChaCore<Counter> {
  constructor(
    /// Internal state of the core function
    public state: Uint32Array,
    /** PORT: `PhantomData<(R, V)>`: the rounds and variant tables. */
    readonly R: Rounds,
    readonly V: Variant<Counter>,
  ) {}

  /// Constructs a ChaChaCore with the specified `key` and `iv`.
  ///
  /// You must ensure that the iv is of the correct size when using this method
  /// directly.
  ///
  /// # Panics
  /// If `iv.len()` is not equal to 4, 8, or 12.
  // crate: chacha20-0.10.0/src/lib.rs:223 new_internal
  static new_internal<Counter>(R: Rounds, V: Variant<Counter>, key: Uint8Array, iv: Uint8Array): ChaChaCore<Counter> {
    assert(iv.length === 4 || iv.length === 8 || iv.length === 12, "assertion failed: matches!(iv.len(), 4 | 8 | 12)");

    const state = new Uint32Array(STATE_WORDS);

    const ctr_size = V.counter_size / 4;
    // `state.split_at_mut(4)`, `state_rem.split_at_mut(8)`, `state_rem.split_at_mut(ctr_size)`
    const const_dst = state.subarray(0, 4);
    const key_dst = state.subarray(4, 12);
    const iv_dst = state.subarray(12 + ctr_size);

    const_dst.set(CONSTANTS);

    // TODO(tarcieri): when MSRV 1.88, use `[T]::as_chunks` to avoid panic
    {
      for (let i = 0; i < 8 && i * 4 + 4 <= key.length; i++) {
        key_dst[i] = u32_from_le_bytes(key, i * 4);
      }

      assert_eq(iv_dst.length * 4, iv.length, String);
      for (let i = 0; i < iv_dst.length; i++) {
        iv_dst[i] = u32_from_le_bytes(iv, i * 4);
      }
    }

    // PORT: `let tokens = ();` (the soft backend; see the file header).
    return new ChaChaCore(state, R, V);
  }

  /// Get the current block position.
  // crate: chacha20-0.10.0/src/lib.rs:279 get_block_pos
  get_block_pos(): Counter {
    return this.V.get_block_pos(this.state.subarray(12));
  }

  /// Set the block position.
  // crate: chacha20-0.10.0/src/lib.rs:285 set_block_pos
  set_block_pos(pos: Counter): void {
    this.V.set_block_pos(this.state.subarray(12), pos);
  }
}

// impl<R: Rounds, V: Variant> fmt::Debug for ChaChaCore<R, V>
// crate: chacha20-0.10.0/src/lib.rs:291 fmt
export function debug_ChaChaCore<Counter>(v: ChaChaCore<Counter>): string {
  return `ChaChaCore<R: ${v.R.COUNT}, V: ${v.V.counter_size * 8}-bit)> { ... }`;
}

// crate-skip: chacha20-0.10.0/src/lib.rs:306 get_block_pos cfg(feature = "cipher"): StreamCipherSeekCore, off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/lib.rs:311 set_block_pos cfg(feature = "cipher"): StreamCipherSeekCore, off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/lib.rs:319 remaining_blocks cfg(feature = "cipher"): StreamCipherCore, off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/lib.rs:323 process_with_backend cfg(feature = "cipher"): StreamCipherCore, off in rand's `features = ["rng"]`
// crate-skip: chacha20-0.10.0/src/lib.rs:392 drop cfg(feature = "zeroize"): off in rand's dependency

/// The ChaCha20 quarter round function
///
/// We located this function in the root of the crate as we want it to be available
/// for the soft backend and for xchacha.
// crate: chacha20-0.10.0/src/lib.rs:405 quarter_round
export function quarter_round(a: number, b: number, c: number, d: number, state: Uint32Array): void {
  state[a] = state[a]! + state[b]!;
  state[d] = state[d]! ^ state[a]!;
  state[d] = rotl(state[d]!, 16);

  state[c] = state[c]! + state[d]!;
  state[b] = state[b]! ^ state[c]!;
  state[b] = rotl(state[b]!, 12);

  state[a] = state[a]! + state[b]!;
  state[d] = state[d]! ^ state[a]!;
  state[d] = rotl(state[d]!, 8);

  state[c] = state[c]! + state[d]!;
  state[b] = state[b]! ^ state[c]!;
  state[b] = rotl(state[b]!, 7);
}

/** `u32::rotate_left` (the result is stored into a `Uint32Array`, which drops the sign). */
function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** `u32::from_le_bytes(src[at..at + 4].try_into().unwrap())` */
function u32_from_le_bytes(src: Uint8Array, at: number): number {
  return (src[at]! | (src[at + 1]! << 8) | (src[at + 2]! << 16) | (src[at + 3]! << 24)) >>> 0;
}
