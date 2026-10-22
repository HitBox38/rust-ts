// Port of compiler/rustc_mir_build/src/builder/expr/stmt.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Scope as region_Scope } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { Builder, type BlockAnd } from "../mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // stmt.rs:14 (lane mb-expr-a)
    stmt_expr(block: BasicBlock, expr_id: ExprId, statement_scope: region_Scope | undefined): BlockAnd<null>;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/stmt.rs:14 stmt_expr (lane mb-expr-a)
Builder.prototype.stmt_expr = function (this: Builder, block: BasicBlock, expr_id: ExprId, statement_scope: region_Scope | undefined): BlockAnd<null> {
  return unported("rustc_mir_build::builder::expr::stmt::Builder::stmt_expr");
};
