// Port of rand_xoshiro =0.7.0 `src/lib.rs`: `SplitMix64` and `Xoshiro128StarStar`, what rustc_abi's `-Zrandomize-layout`
// shuffle uses. The other generators are not ported.
export { SplitMix64 } from "./splitmix64.ts";
export { Xoshiro128StarStar } from "./xoshiro128starstar.ts";
