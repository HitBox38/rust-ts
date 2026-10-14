// Port of compiler/rustc_ast_lowering/src/path.rs (STUB, lane lower-pat-path-block: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";


unported_methods(LoweringContext.prototype, "rustc_ast_lowering::path::LoweringContext", [
  "lower_qpath", "lower_use_path", "lower_path_segment", "maybe_insert_elided_lifetimes_in_path",
  "lower_angle_bracketed_parameter_data", "lower_parenthesized_parameter_data", "assoc_ty_binding",
  "map_trait_to_async_trait",
]);
