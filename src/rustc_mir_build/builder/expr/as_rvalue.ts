// Port of compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-b; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Scope as region_Scope, type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type BinOp, type Operand, type Rvalue, type SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type ExprKind } from "../../../rustc_middle/thir.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { Builder, type BlockAnd } from "../mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // as_rvalue.rs:29 (lane mb-expr-b)
    as_local_rvalue(block: BasicBlock, expr_id: ExprId): BlockAnd<Rvalue>;
    // as_rvalue.rs:43 (lane mb-expr-b)
    as_rvalue(block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Rvalue>;
    // as_rvalue.rs:445 (lane mb-expr-b)
    build_binary_op(block: BasicBlock, op: BinOp, span: Span, ty: Ty, lhs: Operand, rhs: Operand): BlockAnd<Rvalue>;
    // as_rvalue.rs:599 (lane mb-expr-b)
    check_constness(kind: ExprKind): boolean;
    // as_rvalue.rs:618 (lane mb-expr-b)
    build_zero_repeat(block: BasicBlock, value: ExprId, scope: TempLifetime, outer_source_info: SourceInfo): BlockAnd<Rvalue>;
    // as_rvalue.rs:656 (lane mb-expr-b)
    limit_capture_mutability(upvar_span: Span, upvar_ty: Ty, temp_lifetime: region_Scope | undefined, block: BasicBlock, arg: ExprId): BlockAnd<Operand>;
    // as_rvalue.rs:738 (lane mb-expr-b)
    neg_1_literal(span: Span, ty: Ty): Operand;
    // as_rvalue.rs:747 (lane mb-expr-b)
    minval_literal(span: Span, ty: Ty): Operand;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:29 as_local_rvalue (lane mb-expr-b)
Builder.prototype.as_local_rvalue = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Rvalue> {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::as_local_rvalue");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:43 as_rvalue (lane mb-expr-b)
Builder.prototype.as_rvalue = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Rvalue> {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::as_rvalue");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:445 build_binary_op (lane mb-expr-b)
Builder.prototype.build_binary_op = function (this: Builder, block: BasicBlock, op: BinOp, span: Span, ty: Ty, lhs: Operand, rhs: Operand): BlockAnd<Rvalue> {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::build_binary_op");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:599 check_constness (lane mb-expr-b)
Builder.prototype.check_constness = function (this: Builder, kind: ExprKind): boolean {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::check_constness");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:618 build_zero_repeat (lane mb-expr-b)
Builder.prototype.build_zero_repeat = function (this: Builder, block: BasicBlock, value: ExprId, scope: TempLifetime, outer_source_info: SourceInfo): BlockAnd<Rvalue> {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::build_zero_repeat");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:656 limit_capture_mutability (lane mb-expr-b)
Builder.prototype.limit_capture_mutability = function (this: Builder, upvar_span: Span, upvar_ty: Ty, temp_lifetime: region_Scope | undefined, block: BasicBlock, arg: ExprId): BlockAnd<Operand> {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::limit_capture_mutability");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:738 neg_1_literal (lane mb-expr-b)
Builder.prototype.neg_1_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::neg_1_literal");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:747 minval_literal (lane mb-expr-b)
Builder.prototype.minval_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  return unported("rustc_mir_build::builder::expr::as_rvalue::Builder::minval_literal");
};
