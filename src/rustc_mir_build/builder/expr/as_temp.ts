// Port of compiler/rustc_mir_build/src/builder/expr/as_temp.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Local } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { Builder, type BlockAnd } from "../mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // as_temp.rs:16 (lane mb-expr-a)
    as_temp(block: BasicBlock, temp_lifetime: TempLifetime, expr_id: ExprId, mutability: Mutability): BlockAnd<Local>;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_temp.rs:16 as_temp (lane mb-expr-a)
Builder.prototype.as_temp = function (this: Builder, block: BasicBlock, temp_lifetime: TempLifetime, expr_id: ExprId, mutability: Mutability): BlockAnd<Local> {
  return unported("rustc_mir_build::builder::expr::as_temp::Builder::as_temp");
};
