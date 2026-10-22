// Port of compiler/rustc_mir_build/src/builder/expr/as_operand.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type LocalInfo, type Operand } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { Builder, type BlockAnd, type NeedsTemporary } from "../mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // as_operand.rs:14 (lane mb-expr-a)
    local_temp_lifetime(): TempLifetime;
    // as_operand.rs:26 (lane mb-expr-a)
    as_local_operand(block: BasicBlock, expr_id: ExprId): BlockAnd<Operand>;
    // as_operand.rs:92 (lane mb-expr-a)
    as_local_call_operand(block: BasicBlock, expr: ExprId): BlockAnd<Operand>;
    // as_operand.rs:115 (lane mb-expr-a)
    as_operand(block: BasicBlock, scope: TempLifetime, expr_id: ExprId, local_info: LocalInfo, needs_temporary: NeedsTemporary): BlockAnd<Operand>;
    // as_operand.rs:160 (lane mb-expr-a)
    as_call_operand(block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Operand>;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:14 local_temp_lifetime (lane mb-expr-a)
Builder.prototype.local_temp_lifetime = function (this: Builder): TempLifetime {
  return unported("rustc_mir_build::builder::expr::as_operand::Builder::local_temp_lifetime");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:26 as_local_operand (lane mb-expr-a)
Builder.prototype.as_local_operand = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Operand> {
  return unported("rustc_mir_build::builder::expr::as_operand::Builder::as_local_operand");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:92 as_local_call_operand (lane mb-expr-a)
Builder.prototype.as_local_call_operand = function (this: Builder, block: BasicBlock, expr: ExprId): BlockAnd<Operand> {
  return unported("rustc_mir_build::builder::expr::as_operand::Builder::as_local_call_operand");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:115 as_operand (lane mb-expr-a)
Builder.prototype.as_operand = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId, local_info: LocalInfo, needs_temporary: NeedsTemporary): BlockAnd<Operand> {
  return unported("rustc_mir_build::builder::expr::as_operand::Builder::as_operand");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:160 as_call_operand (lane mb-expr-a)
Builder.prototype.as_call_operand = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Operand> {
  return unported("rustc_mir_build::builder::expr::as_operand::Builder::as_call_operand");
};
