// Port of compiler/rustc_middle/src/middle/mod.rs: the inline `pub mod lib_features { .. }` (the other `pub mod`s
// are their own files under middle/ and are imported directly by their users).
// PORT: created by lane passes-a for rustc_passes/lib_features.ts; `lib_features` is a namespace export.
import type { Span } from "../../rustc_span/lib.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_map, debug_option, debug_struct, debug_tuple } from "../../std/fmt.ts";

export namespace lib_features {
  // rustc-type: compiler/rustc_middle/src/middle/mod.rs:15 FeatureStability
  // #[derive(Copy, Clone, Debug, PartialEq, Eq)]
  export type FeatureStability =
    | { readonly $: "AcceptedSince"; readonly _0: Symbol }
    | { readonly $: "Unstable"; readonly old_name: Symbol | undefined };

  /** `#[derive(Debug)]` */
  export const debug_FeatureStability: Debug<FeatureStability> = (v, f) => {
    switch (v.$) {
      case "AcceptedSince":
        return debug_tuple(f, "AcceptedSince", [debug_Symbol(v._0, f)]);
      case "Unstable":
        return debug_struct(f, "Unstable", [["old_name", debug_option(v.old_name, f, debug_Symbol)]]);
    }
  };

  /** `#[derive(PartialEq)]` */
  export function FeatureStability_eq(a: FeatureStability, b: FeatureStability): boolean {
    if (a.$ === "AcceptedSince") return b.$ === "AcceptedSince" && a._0 === b._0;
    return b.$ === "Unstable" && a.old_name === b.old_name;
  }

  // rustc-type: compiler/rustc_middle/src/middle/mod.rs:21 LibFeatures
  // #[derive(StableHash, Debug, Default)]
  // PORT: a data interface plus a companion (not a class): the metadata decoder (rmeta/decoder.ts
  // `get_lib_features`) builds the extern value as a `{ stability }` record. `UnordMap<Symbol, ..>` is a `Map`.
  export interface LibFeatures {
    stability: Map<Symbol, [FeatureStability, Span]>;
  }

  /** `#[derive(Debug)]` (the `UnordMap` prints in its iteration order). */
  export const debug_LibFeatures: Debug<LibFeatures> = (v, f) =>
    debug_struct(f, "LibFeatures", [
      [
        "stability",
        debug_map(
          f,
          [...v.stability].map(([k, x]) => [debug_Symbol(k, f), debug_tuple(f, "", [debug_FeatureStability(x[0], f), debug_Span(x[1], f)])]),
        ),
      ],
    ]);

  export const LibFeatures = {
    /** `#[derive(Default)]` */
    default(): LibFeatures {
      return { stability: new Map() };
    },

    // rustc: compiler/rustc_middle/src/middle/mod.rs:26 to_sorted_vec
    to_sorted_vec(self: LibFeatures): [Symbol, FeatureStability][] {
      // PORT: `to_sorted_stable_ord()` sorts by `Symbol`'s `StableCompare` (`as_str().cmp(..)`, byte order); feature
      // names are ASCII, so the JS string order is the same.
      return [...self.stability]
        .sort(([a], [b]) => {
          const x = Symbol.as_str(a);
          const y = Symbol.as_str(b);
          return x < y ? -1 : x > y ? 1 : 0;
        })
        .map(([sym, [stab, _]]) => [sym, stab]);
    },
  };
}
