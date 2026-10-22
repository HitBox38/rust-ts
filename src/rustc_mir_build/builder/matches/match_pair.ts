// Port of compiler/rustc_mir_build/src/builder/matches/match_pair.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-matches-c; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Pat } from "../../../rustc_middle/thir.ts";
import { type PlaceBuilder } from "../expr/as_place.gen.ts";
import { InterPat } from "./match_pair.gen.ts";
import { FlatPat, type MatchPairTree, type PatternExtraData } from "./mod.gen.ts";
import { Builder } from "../mod.ts";
import { unported } from "../../../std/panic.ts";
export * from "./match_pair.gen.ts";

declare module "./mod.gen.ts" {
  namespace FlatPat {
    // match_pair.rs:73 (lane mb-matches-c)
    function new_(place: PlaceBuilder, pattern: Pat, cx: Builder): FlatPat;
    export { new_ as new };
    // match_pair.rs:88 (lane mb-matches-c)
    export function from_inter_pat(inter_pat: InterPat): FlatPat;
  }
}

declare module "./match_pair.gen.ts" {
  namespace InterPat {
    // match_pair.rs:210 (lane mb-matches-c)
    export function lower_thir_pat(cx: Builder, place_builder: PlaceBuilder, pattern: Pat): InterPat;
  }
}

// stub: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:18 prefix_slice_suffix (lane mb-matches-c)
export function prefix_slice_suffix(place: PlaceBuilder, array_len: number | undefined, prefix: readonly Pat[], opt_slice: Pat | undefined, suffix: readonly Pat[]): [PlaceBuilder, Pat][] {
  return unported("rustc_mir_build::builder::matches::match_pair::prefix_slice_suffix");
}

// stub: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:73 new (lane mb-matches-c)
(FlatPat as unknown as { new: typeof FlatPat.new }).new = function (place: PlaceBuilder, pattern: Pat, cx: Builder): FlatPat {
  return unported("rustc_mir_build::builder::matches::match_pair::FlatPat::new");
};

// stub: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:88 from_inter_pat (lane mb-matches-c)
(FlatPat as unknown as { from_inter_pat: typeof FlatPat.from_inter_pat }).from_inter_pat = function (inter_pat: InterPat): FlatPat {
  return unported("rustc_mir_build::builder::matches::match_pair::FlatPat::from_inter_pat");
};

// stub: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:104 squash_inter_pat (lane mb-matches-c)
export function squash_inter_pat(inter_pat: InterPat, match_pairs: MatchPairTree[], extra_data: PatternExtraData): void {
  return unported("rustc_mir_build::builder::matches::match_pair::squash_inter_pat");
}

// stub: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:210 lower_thir_pat (lane mb-matches-c)
(InterPat as unknown as { lower_thir_pat: typeof InterPat.lower_thir_pat }).lower_thir_pat = function (cx: Builder, place_builder: PlaceBuilder, pattern: Pat): InterPat {
  return unported("rustc_mir_build::builder::matches::match_pair::InterPat::lower_thir_pat");
};
