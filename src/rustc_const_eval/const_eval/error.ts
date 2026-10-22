// Port of compiler/rustc_const_eval/src/const_eval/error.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { ConstEvalErrKind } from "./error.gen.ts";
import { CompileTimeMachine, type CompileTimeInterpCx } from "./machine.ts";
import { type FrameNote } from "../diagnostics.ts";
import { type Diag } from "../../rustc_errors/lib.ts";
import { type Lint } from "../../rustc_lint_defs/lib.ts";
import { type ErrorHandled, type InterpErrorInfo, type InterpErrorKind } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { Frame } from "../interpret/stack.gen.ts";

export * from "./error.gen.ts";

// impl Display for ConstEvalErrKind
// stub: compiler/rustc_const_eval/src/const_eval/error.rs:47 fmt (lane ctfe-a)
export function display_ConstEvalErrKind(self: ConstEvalErrKind, f: Fmt): string {
  return unported("rustc_const_eval::const_eval::error::ConstEvalErrKind::fmt");
}

// impl Into<InterpErrorInfo<'tcx>> for ConstEvalErrKind
// stub: compiler/rustc_const_eval/src/const_eval/error.rs:92 into (lane ctfe-a)
export function ConstEvalErrKind_into_InterpErrorInfo(self: ConstEvalErrKind): InterpErrorInfo {
  return unported("rustc_const_eval::const_eval::error::ConstEvalErrKind::into");
}

// stub: compiler/rustc_const_eval/src/const_eval/error.rs:97 get_span_and_frames (lane ctfe-a)
export function get_span_and_frames(tcx: TyCtxtAt, stack: readonly Frame[]): [Span, FrameNote[]] {
  return unported("rustc_const_eval::const_eval::error::get_span_and_frames");
}

// stub: compiler/rustc_const_eval/src/const_eval/error.rs:169 report (lane ctfe-a)
export function report(ecx: CompileTimeInterpCx, error: InterpErrorKind, mk: (a0: Diag, a1: Span, a2: FrameNote[]) => void): ErrorHandled {
  return unported("rustc_const_eval::const_eval::error::report");
}

// stub: compiler/rustc_const_eval/src/const_eval/error.rs:242 lint (lane ctfe-a)
export function lint<L>(tcx: TyCtxtAt, machine: CompileTimeMachine, lint: Lint, decorator: (a0: FrameNote[]) => L): void {
  return unported("rustc_const_eval::const_eval::error::lint");
}
