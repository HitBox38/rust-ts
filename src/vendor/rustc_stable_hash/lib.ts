// Port of rustc-stable-hash =0.1.2 `src/lib.rs` (rustc builds it with the `nightly` feature).
//
//! A stable hashing algorithm used by rustc

import { SipHasher128 } from "./sip128.ts";
import { StableHasher } from "./stable_hasher.ts";

/// Hashers collection
// PORT: `pub mod hashers` is flattened into this module.
export { debug_SipHasher128, debug_SipHasher128Hash, SipHasher128, type SipHasher128Hash, SipHasher128Hash_eq } from "./sip128.ts";

/// Stable 128-bits Sip Hasher
///
/// [`StableHasher`] version of [`SipHasher128`].
///
/// [`StableHasher`]: super::StableHasher
export type StableSipHasher128 = StableHasher<SipHasher128>;
// PORT: companion of the alias: `StableSipHasher128::new()` (`H: Default` is `SipHasher128`).
export const StableSipHasher128 = {
  new(): StableSipHasher128 {
    return StableHasher.new(SipHasher128);
  },
  default(): StableSipHasher128 {
    return StableHasher.default(SipHasher128);
  },
  with_hasher(state: SipHasher128): StableSipHasher128 {
    return StableHasher.with_hasher(state);
  },
};

export { debug_StableHasher, StableHasher } from "./stable_hasher.ts";

export type { FromStableHash } from "./stable_hasher.ts";

export { type ExtendedHasher, ExtendedHasher_provided, type Hasher, Hasher_provided, type HashOf } from "./stable_hasher.ts";
