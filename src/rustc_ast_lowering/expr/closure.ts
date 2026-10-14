// Port of compiler/rustc_ast_lowering/src/expr/closure.rs (STUB, lane lower-expr: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";


unported_methods(LoweringContext.prototype, "rustc_ast_lowering::expr::closure::LoweringContext", [
  "lower_expr_closure_expr", "lower_expr_coroutine_closure_with_move_exprs",
  "lower_expr_plain_closure_with_move_exprs", "lower_expr_closure", "closure_movability_for_fn",
  "lower_closure_binder", "lower_expr_coroutine_closure",
]);
