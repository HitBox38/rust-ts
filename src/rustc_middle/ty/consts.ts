// Contract stub for compiler/rustc_middle/src/ty/consts.rs (lane ty-contract; the file belongs to lane ty-results).
//
// The methods this file defines upstream on `Const` are declared in ty/decls.ts (`// ty/consts.rs:<line>`
// lines). Until they are ported, the calls below install `unported(..)` placeholders for them. To fill one:
// assign `<Class>.prototype.<name> = function (this: <Class>, ..) { .. }` (a static: `<Class>.<name> = function ..`)
// with the `// rustc:` marker above it, in upstream order, and delete the name from its list (the call when the list
// is empty). The free fns, types and other impls of the upstream file are not stubbed: port them here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

// The types of this file with their derived Debug / TypeVisitable / TypeFoldable impls are generated into consts.gen.ts
// (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./consts.gen.ts";

unported_methods(Const.prototype, "rustc_middle::ty::consts::Const", [
  "to_value",
  "try_to_value",
  "to_leaf",
  "to_branch",
  "try_to_leaf",
  "try_to_scalar",
  "try_to_branch",
  "try_to_target_usize",
  "walk",
]);
unported_methods(Const, "rustc_middle::ty::consts::Const", [
  "from_bits",
  "zero_sized",
  "new_value",
  "from_bool",
  "from_target_usize",
]);
