// Contract stub for compiler/rustc_middle/src/ty/visit.rs (lane ty-contract; the file belongs to lane ty-results).
//
// The methods this file defines upstream on `TyCtxt` are declared in ty/decls.ts (`// ty/visit.rs:<line>`
// lines). Until they are ported, the calls below install `unported(..)` placeholders for them. To fill one:
// assign `<Class>.prototype.<name> = function (this: <Class>, ..) { .. }` (a static: `<Class>.<name> = function ..`)
// with the `// rustc:` marker above it, in upstream order, and delete the name from its list (the call when the list
// is empty). The free fns, types and other impls of the upstream file are not stubbed: port them here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import { TyCtxt } from "./context.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

unported_methods(TyCtxt.prototype, "rustc_middle::ty::visit::TyCtxt", [
  "for_each_free_region",
  "all_free_regions_meet",
  "any_free_region_meets",
  "collect_constrained_late_bound_regions",
  "collect_referenced_late_bound_regions",
  "collect_late_bound_regions",
]);
