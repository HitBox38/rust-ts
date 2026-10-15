//! Support code for rustdoc and external tools.
//! You really don't want to be using this unless you need to.
//
// Port of compiler/rustc_trait_selection/src/traits/auto_trait.rs (stub only: rustdoc's auto-trait finder; no compiler
// path calls it, so it has no lane in M3).
//
// Contract stub (lane selcx-contract): the types are generated (./auto_trait.gen.ts); `AutoTraitFinder`'s methods are
// `unported` placeholders (auto_trait.rs:53 new (static), :75 find_auto_trait_generics, :187
// find_auto_trait_generics_next_solver, :297 evaluate_predicates, :440 add_user_clause, :526 map_vid_to_region, :623
// is_param_no_infer, :627 is_of_param, :637 is_self_referential_projection, :645 evaluate_nested_obligations, :908
// clean_pred).

import { unported_methods } from "../../rust_ts/stubs.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";
import { AutoTraitFinder } from "./auto_trait.gen.ts";

export * from "./auto_trait.gen.ts";

declare module "./auto_trait.gen.ts" {
  namespace AutoTraitFinder {
    // auto_trait.rs:53
    function new_(tcx: TyCtxt): AutoTraitFinder;
    export { new_ as new };
  }
}

Object.assign(AutoTraitFinder, {
  // auto_trait.rs:53 (stub)
  new(_tcx: TyCtxt): AutoTraitFinder {
    return unported("rustc_trait_selection::traits::auto_trait::AutoTraitFinder::new");
  },
});

unported_methods(AutoTraitFinder.prototype, "rustc_trait_selection::traits::auto_trait::AutoTraitFinder", [
  "find_auto_trait_generics",
  "find_auto_trait_generics_next_solver",
  "evaluate_predicates",
  "add_user_clause",
  "map_vid_to_region",
  "is_param_no_infer",
  "is_of_param",
  "is_self_referential_projection",
  "evaluate_nested_obligations",
  "clean_pred",
]);
