// Port of chacha20 =0.10.0 `src/backends.rs`: the backend selection (`cfg_if!`).
//
// PORT: only `soft` is ported (`./backends/soft.ts`). The SIMD backends below are what the oracle host compiles
// (`neon` on aarch64 with the `neon` target feature; `avx2`/`sse2` picked at run time by cpufeatures on x86_64;
// `avx512` only with `--cfg chacha20_avx512`). They produce the same keystream as `soft` (ChaCha is defined on
// u32 words), which the vendor-rand probe checks against the oracle-built crate, so they are crate-skip.
export * as soft from "./backends/soft.ts";

// crate-skip: chacha20-0.10.0/src/backends/neon.rs:44 new SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:68 inner SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:92 rng_inner SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:126 gen_ks_block SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:139 gen_par_ks_blocks SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:226 write_par_ks_blocks SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:282 double_quarter_round SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:290 add_xor_rot SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:320 rows_to_cols SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/neon.rs:329 cols_to_rows SIMD backend (neon): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:38 inner SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:84 rng_inner SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:133 gen_ks_block SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:154 gen_par_ks_blocks SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:185 rng_gen_par_ks_blocks SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:209 rounds SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:230 double_quarter_round SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:274 rows_to_cols SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:302 cols_to_rows SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx2.rs:313 add_xor_rot SIMD backend (avx2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:33 inner SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:76 gen_ks_block SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:92 gen_par_ks_blocks SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:114 rng_inner SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:139 gen_ks_blocks SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:157 rounds SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:188 double_quarter_round SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:232 rows_to_cols SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:260 cols_to_rows SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/sse2.rs:271 add_xor_rot SIMD backend (sse2): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:32 inner SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:69 increment_ctr SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:86 gen_blocks_fullwidth SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:215 gen_blocks_halfwidth SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:292 gen_par_ks_blocks SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:297 gen_ks_block SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:316 gen_tail_blocks SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:343 rounds SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:367 double_quarter_round SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:411 rows_to_cols SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:439 cols_to_rows SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:450 add_xor_rot SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:489 rounds_halfwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:505 double_quarter_round_halfwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:514 rows_to_cols_halfwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:524 cols_to_rows_halfwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:534 add_xor_rot_halfwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:562 rounds_quarterwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:577 double_quarter_round_quarterwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:585 rows_to_cols_quarterwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:594 cols_to_rows_quarterwide SIMD backend (avx512): same keystream as soft, which is the port's backend
// crate-skip: chacha20-0.10.0/src/backends/avx512.rs:603 add_xor_rot_quarterwide SIMD backend (avx512): same keystream as soft, which is the port's backend
