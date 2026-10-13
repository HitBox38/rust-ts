// Port of hashbrown =0.17.1 `src/control/group/mod.rs`.
//
// TESTING NOTE:
//
// Because this module uses `cfg(..)` to select an implementation, it will not
// be linted without being run on targets that actually load each of these
// modules. Be sure to edit `ci/tools.sh` to add in the necessary cfgs if you
// change these, so that your implementation gets properly linted.
//
// PORT: the `cfg_if!` is resolved for the oracle host, aarch64-apple-darwin: `target_arch =
// "aarch64"`, `target_feature = "neon"` (part of the target's baseline features), little-endian, not
// miri, so std's (and rustc_data_structures') hashbrown uses the NEON group: `Group::WIDTH` = 8,
// `BitMaskWord` = u64, `BITMASK_STRIDE` = 8. Only `neon.rs` is ported. (The generic 64-bit group has
// the same width and finds the same empty/deleted/full slots; only `match_tag` may report false
// positives there, which `eq` filters, so bucket placement is the same.)
export { BITMASK_ITER_MASK, BITMASK_STRIDE, type BitMaskWord, Group, type NonZeroBitMaskWord } from "./neon.ts";
