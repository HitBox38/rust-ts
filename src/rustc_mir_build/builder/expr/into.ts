// Port of compiler/rustc_mir_build/src/builder/expr/into.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-b; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BasicBlock, type Place } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { Builder, type BlockAnd } from "../mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // into.rs:26 (lane mb-expr-b)
    expr_into_dest(destination: Place, block: BasicBlock, expr_id: ExprId): BlockAnd<null>;
    // into.rs:941 (lane mb-expr-b)
    is_let(expr: ExprId): boolean;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/into.rs:26 expr_into_dest (lane mb-expr-b)
Builder.prototype.expr_into_dest = function (this: Builder, destination: Place, block: BasicBlock, expr_id: ExprId): BlockAnd<null> {
  return unported("rustc_mir_build::builder::expr::into::Builder::expr_into_dest");
};

// PORT: a fn nested in `expr_into_dest` (into.rs:26), declared at module level until its fill lane moves it inside.
// stub: compiler/rustc_mir_build/src/builder/expr/into.rs:270 is_supported_loop_match_type (lane mb-expr-b)
function is_supported_loop_match_type(ty: Ty): boolean {
  return unported("rustc_mir_build::builder::expr::into::Builder::expr_into_dest::is_supported_loop_match_type");
}

// stub: compiler/rustc_mir_build/src/builder/expr/into.rs:941 is_let (lane mb-expr-b)
Builder.prototype.is_let = function (this: Builder, expr: ExprId): boolean {
  return unported("rustc_mir_build::builder::expr::into::Builder::is_let");
};
