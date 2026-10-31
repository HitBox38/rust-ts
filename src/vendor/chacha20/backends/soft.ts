//! Portable implementation which does not rely on architecture-specific
//! intrinsics.
//
// Port of chacha20 =0.10.0 `src/backends/soft.rs` (the `rng` half; `cipher` is off).
// PORT: on the oracle host this file is not compiled (aarch64 takes `neon`, x86_64 `avx2`/`sse2`); it is the
// port's only backend. The SIMD backends compute the same keystream (vendor-rand probe), see the
// `crate-skip:` markers in backends.ts.
import { quarter_round, type ChaChaCore, type Rounds } from "../lib.ts";

/** `crate::rng::BLOCK_WORDS` */
const BLOCK_WORDS = 16;

export class Backend<Counter> {
  constructor(public _0: ChaChaCore<Counter>) {}

  // crate-skip: chacha20-0.10.0/src/backends/soft.rs:33 gen_ks_block cfg(feature = "cipher"): StreamCipherBackend, off in rand's `features = ["rng"]`

  // #[cfg(feature = "rng")] impl<R: Rounds, V: Variant> Backend<'_, R, V>
  // crate: chacha20-0.10.0/src/backends/soft.rs:51 gen_ks_blocks
  gen_ks_blocks(buffer: Uint32Array | number[]): void {
    const state = this._0.state;
    for (let block = 0; block < 4; block++) {
      const res = run_rounds(this._0.R, state);
      // `let mut ctr = (u64::from(state[13]) << 32) | u64::from(state[12]); ctr = ctr.wrapping_add(1);`
      // PORT: the u64 counter is kept as its two u32 halves.
      let ctr_lo = state[12]! + 1;
      let ctr_hi = state[13]!;
      if (ctr_lo > 0xffff_ffff) {
        ctr_lo = 0;
        ctr_hi = (ctr_hi + 1) >>> 0;
      }
      state[12] = ctr_lo;
      state[13] = ctr_hi;

      for (let i = 0; i < BLOCK_WORDS; i++) buffer[block * BLOCK_WORDS + i] = res[i]!;
    }
  }
}

// crate: chacha20-0.10.0/src/backends/soft.rs:66 run_rounds
function run_rounds(R: Rounds, state: Uint32Array): Uint32Array {
  const res = state.slice();

  for (let r = 0; r < R.COUNT; r++) {
    // column rounds
    quarter_round(0, 4, 8, 12, res);
    quarter_round(1, 5, 9, 13, res);
    quarter_round(2, 6, 10, 14, res);
    quarter_round(3, 7, 11, 15, res);

    // diagonal rounds
    quarter_round(0, 5, 10, 15, res);
    quarter_round(1, 6, 11, 12, res);
    quarter_round(2, 7, 8, 13, res);
    quarter_round(3, 4, 9, 14, res);
  }

  for (let i = 0; i < res.length; i++) {
    res[i] = res[i]! + state[i]!;
  }
  return res;
}
