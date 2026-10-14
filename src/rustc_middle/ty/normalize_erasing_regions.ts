// Contract stub for compiler/rustc_middle/src/ty/normalize_erasing_regions.rs (lane ty-contract; the file belongs to lane ty-results).
//
// The methods this file defines upstream on `TyCtxt` are declared in ty/decls.ts (`// ty/normalize_erasing_regions.rs:<line>`
// lines). Until they are ported, the calls below install `unported(..)` placeholders for them. To fill one:
// assign `<Class>.prototype.<name> = function (this: <Class>, ..) { .. }` (a static: `<Class>.<name> = function ..`)
// with the `// rustc:` marker above it, in upstream order, and delete the name from its list (the call when the list
// is empty). The free fns, types and other impls of the upstream file are not stubbed: port them here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import { TyCtxt } from "./context.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

unported_methods(TyCtxt.prototype, "rustc_middle::ty::normalize_erasing_regions::TyCtxt", [
  "normalize_erasing_regions",
  "assert_fully_normalized",
  "debug_assert_fully_normalized",
  "try_normalize_erasing_regions",
  "normalize_erasing_late_bound_regions",
  "instantiate_and_normalize_erasing_regions",
  "try_instantiate_and_normalize_erasing_regions",
]);
