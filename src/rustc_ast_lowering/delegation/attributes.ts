// Port of compiler/rustc_ast_lowering/src/delegation/attributes.rs (STUB, lane lower-delegation: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the
// contract) and assigned onto the prototype here, in upstream order, each with its `// rustc:` marker; until
// then the `unported_methods(..)` calls below install an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::delegation::attributes::LoweringContext", [
  "add_attrs_if_needed", "create_new_attrs",
]);
