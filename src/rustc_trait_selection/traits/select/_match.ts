// Port of compiler/rustc_trait_selection/src/traits/select/_match.rs (lane old-candidates-confirm, wave 18b).
//
// Contract stub (lane selcx-contract): `MatchAgainstFreshVars` is the generated class of ./_match.gen.ts. Its
// `impl TypeRelation<TyCtxt> for MatchAgainstFreshVars` (the relation `match_fresh_trait_preds` uses) is file-local: the
// lane makes the class implement rustc_type_ir's `TypeRelation` (relate.ts; precedent: rustc_infer's `TypeRelating`)
// with a `declare module "./_match.gen.ts"` here, assigns the methods below onto its prototype in upstream order with
// their markers, and deletes the names from the list.
//   _match.rs:30 new(tcx) -> MatchAgainstFreshVars          (static)
//   _match.rs:36 cx / :40 relate_ty_args / :53 relate_with_variance / :64 regions / :73 tys / :97 consts / :121 binders
//
// Init order: top-level code here touches only ./_match.gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { MatchAgainstFreshVars } from "./_match.gen.ts";

export * from "./_match.gen.ts";

declare module "./_match.gen.ts" {
  namespace MatchAgainstFreshVars {
    // _match.rs:30
    function new_(tcx: TyCtxt): MatchAgainstFreshVars;
    export { new_ as new };
  }
}

Object.assign(MatchAgainstFreshVars, {
  // _match.rs:30 (stub)
  new(_tcx: TyCtxt): MatchAgainstFreshVars {
    return unported("rustc_trait_selection::traits::select::_match::MatchAgainstFreshVars::new");
  },
});

unported_methods(MatchAgainstFreshVars.prototype, "rustc_trait_selection::traits::select::_match::MatchAgainstFreshVars", [
  "cx",
  "relate_ty_args",
  "relate_with_variance",
  "regions",
  "tys",
  "consts",
  "binders",
]);
