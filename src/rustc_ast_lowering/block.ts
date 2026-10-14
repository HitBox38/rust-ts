// Port of compiler/rustc_ast_lowering/src/block.rs (STUB, lane lower-pat-path-block: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";


unported_methods(LoweringContext.prototype, "rustc_ast_lowering::block::LoweringContext", [
  "lower_block", "lower_block_noalloc", "lower_stmts", "impl_trait_in_bindings_ctxt", "lower_local",
  "lower_block_check_mode",
]);
