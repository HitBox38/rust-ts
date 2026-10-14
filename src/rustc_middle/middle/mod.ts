// Port of compiler/rustc_middle/src/middle/mod.rs: its inline `pub mod lib_features` (lane passes-b). The other
// `pub mod`s of mod.rs are the sibling files (middle/stability.ts, middle/lang_items.ts, ...), loaded by
// rustc_middle/lib.ts.
//
// PORT: `LibFeatures` is a data struct (interface + companion, PORTING §5/§8): rustc_metadata's decoder
// (`get_lib_features`) builds the same `{ stability }` record. `UnordMap<Symbol, (FeatureStability, Span)>` is a `Map`.
// The derived Debug / StableHash / Encodable / BlobDecodable impls are not written (nothing prints, hashes or
// decodes them yet; rustc_metadata's `FeatureStability` decoding stops at `unported`).
import type { Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";

// pub mod lib_features {

/** `#[derive(Copy, Clone, Debug, PartialEq, Eq)]` */
export type FeatureStability =
  | { readonly $: "AcceptedSince"; _0: Symbol }
  | { readonly $: "Unstable"; old_name: Symbol | undefined };

/** `#[derive(StableHash, Debug, Default)]` */
export interface LibFeatures {
  stability: Map<Symbol, [FeatureStability, Span]>;
}

export const LibFeatures = {
  /** `#[derive(Default)]` */
  default(): LibFeatures {
    return { stability: new Map() };
  },

  // rustc: compiler/rustc_middle/src/middle/mod.rs:26 to_sorted_vec
  to_sorted_vec(self: LibFeatures): [Symbol, FeatureStability][] {
    // PORT: `UnordMap::to_sorted_stable_ord` sorts by the key's `StableCompare` (`Symbol::stable_cmp`).
    return [...self.stability]
      .sort(([a], [b]) => Symbol.stable_cmp(a, b))
      .map(([sym, [stab, _]]): [Symbol, FeatureStability] => [sym, stab]);
  },
};

// }
