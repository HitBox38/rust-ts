// Port of compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-custom-tail; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Safety } from "../../../../rustc_hir/hir.ts";
import { type BasicBlock, type CastKind, type Local, type Operand, type Place, type PlaceTy, type Rvalue, type StatementKind, type SwitchTargets, type TerminatorKind, type UnwindAction, type UnwindTerminateReason } from "../../../../rustc_middle/mir/mod.ts";
import { type ArmId, type ExprId } from "../../../../rustc_middle/thir.ts";
import { type PointerCoercion } from "../../../../rustc_middle/ty/adjustment.ts";
import { ParseCtxt, type PResult } from "../mod.gen.ts";
import { type Span } from "../../../../rustc_span/lib.ts";
import { unported } from "../../../../std/panic.ts";

declare module "../mod.gen.ts" {
  interface ParseCtxt {
    // instruction.rs:16 (lane mb-custom-tail)
    parse_statement(expr_id: ExprId): PResult<StatementKind>;
    // instruction.rs:44 (lane mb-custom-tail)
    parse_terminator(expr_id: ExprId): PResult<TerminatorKind>;
    // instruction.rs:83 (lane mb-custom-tail)
    parse_unwind_terminate_reason(expr_id: ExprId): PResult<UnwindTerminateReason>;
    // instruction.rs:94 (lane mb-custom-tail)
    parse_unwind_action(expr_id: ExprId): PResult<UnwindAction>;
    // instruction.rs:111 (lane mb-custom-tail)
    parse_return_to(expr_id: ExprId): PResult<BasicBlock>;
    // instruction.rs:119 (lane mb-custom-tail)
    parse_match(arms: readonly ArmId[], span: Span): PResult<SwitchTargets>;
    // instruction.rs:159 (lane mb-custom-tail)
    parse_call(args: readonly ExprId[]): PResult<TerminatorKind>;
    // instruction.rs:191 (lane mb-custom-tail)
    parse_tail_call(args: readonly ExprId[]): PResult<TerminatorKind>;
    // instruction.rs:210 (lane mb-custom-tail)
    parse_cast_fn_ptr_safety(expr_id: ExprId): PResult<Safety>;
    // instruction.rs:221 (lane mb-custom-tail)
    parse_cast_pointer_coercion(expr_id: ExprId): PResult<PointerCoercion>;
    // instruction.rs:254 (lane mb-custom-tail)
    parse_cast_kind(expr_id: ExprId): PResult<CastKind>;
    // instruction.rs:301 (lane mb-custom-tail)
    parse_rvalue(expr_id: ExprId): PResult<Rvalue>;
    // instruction.rs:387 (lane mb-custom-tail)
    parse_operand(expr_id: ExprId): PResult<Operand>;
    // instruction.rs:406 (lane mb-custom-tail)
    parse_place(expr_id: ExprId): PResult<Place>;
    // instruction.rs:410 (lane mb-custom-tail)
    parse_place_inner(expr_id: ExprId): PResult<[Place, PlaceTy]>;
    // instruction.rs:446 (lane mb-custom-tail)
    parse_local(expr_id: ExprId): PResult<Local>;
    // instruction.rs:452 (lane mb-custom-tail)
    parse_block(expr_id: ExprId): PResult<BasicBlock>;
    // instruction.rs:458 (lane mb-custom-tail)
    parse_static(expr_id: ExprId): PResult<Operand>;
    // instruction.rs:478 (lane mb-custom-tail)
    parse_integer_literal(expr_id: ExprId): PResult<bigint>;
  }
}

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:16 parse_statement (lane mb-custom-tail)
ParseCtxt.prototype.parse_statement = function (this: ParseCtxt, expr_id: ExprId): PResult<StatementKind> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_statement");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:44 parse_terminator (lane mb-custom-tail)
ParseCtxt.prototype.parse_terminator = function (this: ParseCtxt, expr_id: ExprId): PResult<TerminatorKind> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_terminator");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:83 parse_unwind_terminate_reason (lane mb-custom-tail)
ParseCtxt.prototype.parse_unwind_terminate_reason = function (this: ParseCtxt, expr_id: ExprId): PResult<UnwindTerminateReason> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_unwind_terminate_reason");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:94 parse_unwind_action (lane mb-custom-tail)
ParseCtxt.prototype.parse_unwind_action = function (this: ParseCtxt, expr_id: ExprId): PResult<UnwindAction> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_unwind_action");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:111 parse_return_to (lane mb-custom-tail)
ParseCtxt.prototype.parse_return_to = function (this: ParseCtxt, expr_id: ExprId): PResult<BasicBlock> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_return_to");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:119 parse_match (lane mb-custom-tail)
ParseCtxt.prototype.parse_match = function (this: ParseCtxt, arms: readonly ArmId[], span: Span): PResult<SwitchTargets> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_match");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:159 parse_call (lane mb-custom-tail)
ParseCtxt.prototype.parse_call = function (this: ParseCtxt, args: readonly ExprId[]): PResult<TerminatorKind> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_call");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:191 parse_tail_call (lane mb-custom-tail)
ParseCtxt.prototype.parse_tail_call = function (this: ParseCtxt, args: readonly ExprId[]): PResult<TerminatorKind> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_tail_call");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:210 parse_cast_fn_ptr_safety (lane mb-custom-tail)
ParseCtxt.prototype.parse_cast_fn_ptr_safety = function (this: ParseCtxt, expr_id: ExprId): PResult<Safety> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_cast_fn_ptr_safety");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:221 parse_cast_pointer_coercion (lane mb-custom-tail)
ParseCtxt.prototype.parse_cast_pointer_coercion = function (this: ParseCtxt, expr_id: ExprId): PResult<PointerCoercion> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_cast_pointer_coercion");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:254 parse_cast_kind (lane mb-custom-tail)
ParseCtxt.prototype.parse_cast_kind = function (this: ParseCtxt, expr_id: ExprId): PResult<CastKind> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_cast_kind");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:301 parse_rvalue (lane mb-custom-tail)
ParseCtxt.prototype.parse_rvalue = function (this: ParseCtxt, expr_id: ExprId): PResult<Rvalue> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_rvalue");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:387 parse_operand (lane mb-custom-tail)
ParseCtxt.prototype.parse_operand = function (this: ParseCtxt, expr_id: ExprId): PResult<Operand> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_operand");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:406 parse_place (lane mb-custom-tail)
ParseCtxt.prototype.parse_place = function (this: ParseCtxt, expr_id: ExprId): PResult<Place> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_place");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:410 parse_place_inner (lane mb-custom-tail)
ParseCtxt.prototype.parse_place_inner = function (this: ParseCtxt, expr_id: ExprId): PResult<[Place, PlaceTy]> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_place_inner");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:446 parse_local (lane mb-custom-tail)
ParseCtxt.prototype.parse_local = function (this: ParseCtxt, expr_id: ExprId): PResult<Local> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_local");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:452 parse_block (lane mb-custom-tail)
ParseCtxt.prototype.parse_block = function (this: ParseCtxt, expr_id: ExprId): PResult<BasicBlock> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_block");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:458 parse_static (lane mb-custom-tail)
ParseCtxt.prototype.parse_static = function (this: ParseCtxt, expr_id: ExprId): PResult<Operand> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_static");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:478 parse_integer_literal (lane mb-custom-tail)
ParseCtxt.prototype.parse_integer_literal = function (this: ParseCtxt, expr_id: ExprId): PResult<bigint> {
  return unported("rustc_mir_build::builder::custom::parse::instruction::ParseCtxt::parse_integer_literal");
};
