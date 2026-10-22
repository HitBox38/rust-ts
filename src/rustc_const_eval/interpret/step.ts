// Port of compiler/rustc_const_eval/src/interpret/step.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-step-call; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { FnArg } from "./call.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type EvaluatedCalleeAndArgs } from "./step.gen.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type AggregateKind, type Operand as mir_Operand, type Place as mir_Place, type Rvalue, type Statement, type Terminator } from "../../rustc_middle/mir/mod.ts";
import { type Spanned } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import { PlaceTy } from "./place.gen.ts";

export * from "./step.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // step.rs:41 (lane interp-step-call)
    step(): InterpResult<boolean>;
    // step.rs:81 (lane interp-step-call)
    eval_statement(stmt: Statement): InterpResult;
    // step.rs:160 (lane interp-step-call)
    eval_rvalue_into_place(rvalue: Rvalue, place: mir_Place): InterpResult;
    // step.rs:306 (lane interp-step-call)
    write_aggregate(kind: AggregateKind, operands: readonly mir_Operand[], dest: PlaceTy): InterpResult;
    // step.rs:365 (lane interp-step-call)
    write_repeat(operand: mir_Operand, dest: PlaceTy): InterpResult;
    // step.rs:403 (lane interp-step-call)
    eval_fn_call_argument(op: mir_Operand, move_definitely_disjoint: boolean): InterpResult<FnArg>;
    // step.rs:438 (lane interp-step-call)
    eval_callee_and_args(terminator: Terminator, func: mir_Operand, args: readonly Spanned<mir_Operand>[], dest: mir_Place): InterpResult<EvaluatedCalleeAndArgs<M>>;
    // step.rs:519 (lane interp-step-call)
    eval_terminator(terminator: Terminator): InterpResult;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/step.rs:41 step (lane interp-step-call)
InterpCx.prototype.step = function (this: InterpCx): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::step::InterpCx::step");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:81 eval_statement (lane interp-step-call)
InterpCx.prototype.eval_statement = function (this: InterpCx, stmt: Statement): InterpResult {
  return unported("rustc_const_eval::interpret::step::InterpCx::eval_statement");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:160 eval_rvalue_into_place (lane interp-step-call)
InterpCx.prototype.eval_rvalue_into_place = function (this: InterpCx, rvalue: Rvalue, place: mir_Place): InterpResult {
  return unported("rustc_const_eval::interpret::step::InterpCx::eval_rvalue_into_place");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:306 write_aggregate (lane interp-step-call)
InterpCx.prototype.write_aggregate = function (this: InterpCx, kind: AggregateKind, operands: readonly mir_Operand[], dest: PlaceTy): InterpResult {
  return unported("rustc_const_eval::interpret::step::InterpCx::write_aggregate");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:365 write_repeat (lane interp-step-call)
InterpCx.prototype.write_repeat = function (this: InterpCx, operand: mir_Operand, dest: PlaceTy): InterpResult {
  return unported("rustc_const_eval::interpret::step::InterpCx::write_repeat");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:403 eval_fn_call_argument (lane interp-step-call)
InterpCx.prototype.eval_fn_call_argument = function (this: InterpCx, op: mir_Operand, move_definitely_disjoint: boolean): InterpResult<FnArg> {
  return unported("rustc_const_eval::interpret::step::InterpCx::eval_fn_call_argument");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:438 eval_callee_and_args (lane interp-step-call)
InterpCx.prototype.eval_callee_and_args = function (this: InterpCx, terminator: Terminator, func: mir_Operand, args: readonly Spanned<mir_Operand>[], dest: mir_Place): InterpResult<EvaluatedCalleeAndArgs<Machine>> {
  return unported("rustc_const_eval::interpret::step::InterpCx::eval_callee_and_args");
};

// stub: compiler/rustc_const_eval/src/interpret/step.rs:519 eval_terminator (lane interp-step-call)
InterpCx.prototype.eval_terminator = function (this: InterpCx, terminator: Terminator): InterpResult {
  return unported("rustc_const_eval::interpret::step::InterpCx::eval_terminator");
};
