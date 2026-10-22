// Port of compiler/rustc_mir_build/src/builder/block.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-mod; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BasicBlock, type Place, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { type BlockId, type ExprId, type StmtId } from "../../rustc_middle/thir.ts";
import { Builder, type BlockAnd } from "./mod.ts";
import { type Scope } from "./scope.gen.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";

declare module "./mod.ts" {
  interface Builder {
    // block.rs:14 (lane mb-mod)
    ast_block(destination: Place, block: BasicBlock, ast_block: BlockId, source_info: SourceInfo): BlockAnd<null>;
    // block.rs:34 (lane mb-mod)
    ast_block_stmts(destination: Place, block: BasicBlock, span: Span, stmts: readonly StmtId[], expr: ExprId | undefined, region_scope: Scope): BlockAnd<null>;
  }
}

// stub: compiler/rustc_mir_build/src/builder/block.rs:14 ast_block (lane mb-mod)
Builder.prototype.ast_block = function (this: Builder, destination: Place, block: BasicBlock, ast_block: BlockId, source_info: SourceInfo): BlockAnd<null> {
  return unported("rustc_mir_build::builder::block::Builder::ast_block");
};

// stub: compiler/rustc_mir_build/src/builder/block.rs:34 ast_block_stmts (lane mb-mod)
Builder.prototype.ast_block_stmts = function (this: Builder, destination: Place, block: BasicBlock, span: Span, stmts: readonly StmtId[], expr: ExprId | undefined, region_scope: Scope): BlockAnd<null> {
  return unported("rustc_mir_build::builder::block::Builder::ast_block_stmts");
};
