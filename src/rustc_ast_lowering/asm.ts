// Port of compiler/rustc_ast_lowering/src/asm.rs (STUB, lane lower-asm-format-contract: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";


unported_methods(LoweringContext.prototype, "rustc_ast_lowering::asm::LoweringContext", [
  "lower_inline_asm",
]);
