//! Random number generators and adapters
//
// Port of rand =0.10.1 `src/rngs/mod.rs`: `StdRng` (feature `std_rng`). `SmallRng`/`Xoshiro*`, `ThreadRng`
// (`thread_rng`, needs getrandom: `unported` per plan-m6 D5) and `SysRng` are not ported.
export { StdRng } from "./std.ts";
