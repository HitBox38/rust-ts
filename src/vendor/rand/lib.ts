//! Utilities for random number generation
//!
//! Rand provides utilities to generate random numbers, to convert them to
//! useful types and distributions, and some randomness-related algorithms.
//
// Port of rand =0.10.1 `src/lib.rs` (lane vendor-rand, plan-m6 D5) with Miri's features (`rand = "0.10"`,
// defaults: `std`, `std_rng`, `sys_rng`, `thread_rng`). The `thread_rng`/`sys_rng` helpers (`rng()`, `random()`,
// `make_rng`, ...) need the host's getrandom, which plan-m6 D5 leaves `unported`; Miri only draws from its
// seeded `StdRng`, so they are not ported.
//
// PORT: import this crate through this file or its submodules; no submodule imports this file.
// Re-export rand_core itself
export * as rand_core from "../rand_core/lib.ts";

// Re-exports from rand_core
export { type CryptoRng, type Rng, type SeedableRng, type TryCryptoRng, type TryRng } from "../rand_core/lib.ts";

// Public modules
export * as distr from "./distr/mod.ts";
export * as rngs from "./rngs/mod.ts";
export * as seq from "./seq/mod.ts";

// Public exports
export { RngExt, Fill_u8, type Fill } from "./rng.ts";
