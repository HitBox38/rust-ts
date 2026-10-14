// Port of compiler/rustc_ast_lowering/src/pat.rs (STUB, lane lower-pat-path-block: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";


unported_methods(LoweringContext.prototype, "rustc_ast_lowering::pat::LoweringContext", [
  "lower_pat", "lower_pat_mut", "lower_pat_tuple", "lower_pat_slice", "lower_pat_ident",
  "pat_wild_with_node_id_of", "pat_with_node_id_of", "ban_extra_rest_pat", "ban_illegal_rest_pat",
  "lower_range_end", "lower_expr_within_pat", "lower_ty_pat", "lower_ty_pat_mut", "lower_excluded_range_end",
  "lower_ty_pat_range_end",
]);
