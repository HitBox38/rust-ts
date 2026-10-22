// Port of compiler/rustc_const_eval/src/interpret/stack.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-step-call; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type FrameNote } from "../diagnostics.ts";
import { InterpCx } from "./eval_context.ts";
import { ReturnAction, type Machine } from "./machine.ts";
import { Immediate, type Operand } from "./operand.ts";
import { MemPlaceMeta } from "./place.ts";
import { Frame, FrameInfo, LocalState, LocalValue, type ReturnContinuation } from "./stack.gen.ts";
import { type HirId } from "../../rustc_hir_id/lib.ts";
import { type AllocId, type CtfeProvenance, type InterpResult, type Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Body, type Either, type Local, type Location, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";

export * from "./stack.gen.ts";

declare module "./stack.gen.ts" {
  interface LocalState {
    // stack.rs:165 (lane interp-step-call)
    make_live_uninit(): void;
    // stack.rs:173 (lane interp-step-call)
    as_mplace_or_imm_ghost(): Either<[Pointer<CtfeProvenance | undefined>, MemPlaceMeta], Immediate> | undefined;
    // stack.rs:185 (lane interp-step-call)
    access(): InterpResult<Operand>;
    // stack.rs:195 (lane interp-step-call)
    access_mut(): InterpResult<Operand>;
    // stack.rs:701 (lane interp-step-call)
    print(allocs: (AllocId | undefined)[], fmt: Fmt): string;
  }
}

declare module "./stack.gen.ts" {
  interface FrameInfo {
    // stack.rs:227 (lane interp-step-call)
    as_note(tcx: TyCtxt): FrameNote;
  }
}

declare module "./stack.gen.ts" {
  interface Frame {
    // stack.rs:257 (lane interp-step-call)
    with_extra<Extra>(extra: Extra): Frame;
    // stack.rs:280 (lane interp-step-call)
    current_loc(): Either<Location, Span>;
    // stack.rs:284 (lane interp-step-call)
    body_(): Body;
    // stack.rs:288 (lane interp-step-call)
    instance_(): Instance;
    // stack.rs:292 (lane interp-step-call)
    return_place_(): PlaceTy;
    // stack.rs:296 (lane interp-step-call)
    return_cont_(): ReturnContinuation;
    // stack.rs:300 (lane interp-step-call)
    locals_(): LocalState[];
    // stack.rs:305 (lane interp-step-call)
    current_source_info(): SourceInfo | undefined;
    // stack.rs:309 (lane interp-step-call)
    current_span(): Span;
    // stack.rs:316 (lane interp-step-call)
    lint_root(tcx: TyCtxt): HirId | undefined;
    // stack.rs:333 (lane interp-step-call)
    locals_addr(): number;
  }
}

declare module "./stack.gen.ts" {
  namespace Frame {
    // stack.rs:338 (lane interp-step-call)
    function generate_stacktrace_from_stack(stack: readonly Frame[], tcx: TyCtxt): FrameInfo[];
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // stack.rs:377 (lane interp-step-call)
    push_stack_frame_raw(instance: Instance, body: Body, return_place: PlaceTy, return_cont: ReturnContinuation): InterpResult;
    // stack.rs:439 (lane interp-step-call)
    pop_stack_frame_raw(): InterpResult<Frame>;
    // stack.rs:449 (lane interp-step-call)
    cleanup_stack_frame(unwinding: boolean, frame: Frame): InterpResult<ReturnAction>;
    // stack.rs:484 (lane interp-step-call)
    push_stack_frame_done(): InterpResult;
    // stack.rs:503 (lane interp-step-call)
    storage_live_dyn(local: Local, meta: MemPlaceMeta): InterpResult;
    // stack.rs:592 (lane interp-step-call)
    storage_live(local: Local): InterpResult;
    // stack.rs:596 (lane interp-step-call)
    storage_dead(local: Local): InterpResult;
    // stack.rs:606 (lane interp-step-call)
    deallocate_local(local: LocalValue): InterpResult;
    // stack.rs:624 (lane interp-step-call)
    layout_of_local(frame: Frame, local: Local, layout: TyAndLayout | undefined): InterpResult<TyAndLayout>;
    // stack.rs:651 (lane interp-step-call)
    allocate_varargs<I, J>(caller_args: I, callee_abis: J): InterpResult<MPlaceTy[]>;
    // stack.rs:680 (lane interp-step-call)
    deallocate_varargs(varargs: readonly MPlaceTy[]): InterpResult;
  }
}

// The Phantomdata exists to prevent this type from being `Send`. If it were sent across a thread
// boundary and dropped in the other thread, it would exit the span in the other thread.
// rustc-type: compiler/rustc_const_eval/src/interpret/stack.rs:28 SpanGuard
// PORT: `tracing::Span` is not ported (no tracing): `_0` holds the span value (`Span::none()` is `undefined`);
// `impl Drop` is `drop()`, called where upstream drops the guard (frame pop).
export class SpanGuard {
  constructor(
    public _0: unknown,
    public _1: undefined,
  ) {}

  // stub: compiler/rustc_const_eval/src/interpret/stack.rs:32 new (lane interp-step-call)
  static new(): SpanGuard {
    return unported("rustc_const_eval::interpret::stack::SpanGuard::new");
  }

  // stub: compiler/rustc_const_eval/src/interpret/stack.rs:40 enter (lane interp-step-call)
  enter(span: Span): void {
    return unported("rustc_const_eval::interpret::stack::SpanGuard::enter");
  }

  // stub: compiler/rustc_const_eval/src/interpret/stack.rs:53 drop (lane interp-step-call)
  drop(): void {
    return unported("rustc_const_eval::interpret::stack::SpanGuard::drop");
  }

}

// impl Debug for LocalState
// stub: compiler/rustc_const_eval/src/interpret/stack.rs:140 fmt (lane interp-step-call)
export function debug_LocalState(self: LocalState, f: Fmt): string {
  return unported("rustc_const_eval::interpret::stack::LocalState::fmt");
}

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:165 make_live_uninit (lane interp-step-call)
LocalState.prototype.make_live_uninit = function (this: LocalState): void {
  return unported("rustc_const_eval::interpret::stack::LocalState::make_live_uninit");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:173 as_mplace_or_imm_ghost (lane interp-step-call)
LocalState.prototype.as_mplace_or_imm_ghost = function (this: LocalState): Either<[Pointer<CtfeProvenance | undefined>, MemPlaceMeta], Immediate> | undefined {
  return unported("rustc_const_eval::interpret::stack::LocalState::as_mplace_or_imm_ghost");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:185 access (lane interp-step-call)
LocalState.prototype.access = function (this: LocalState): InterpResult<Operand> {
  return unported("rustc_const_eval::interpret::stack::LocalState::access");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:195 access_mut (lane interp-step-call)
LocalState.prototype.access_mut = function (this: LocalState): InterpResult<Operand> {
  return unported("rustc_const_eval::interpret::stack::LocalState::access_mut");
};

// impl Display for FrameInfo
// stub: compiler/rustc_const_eval/src/interpret/stack.rs:212 fmt (lane interp-step-call)
export function display_FrameInfo(self: FrameInfo, f: Fmt): string {
  return unported("rustc_const_eval::interpret::stack::FrameInfo::fmt");
}

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:227 as_note (lane interp-step-call)
FrameInfo.prototype.as_note = function (this: FrameInfo, tcx: TyCtxt): FrameNote {
  return unported("rustc_const_eval::interpret::stack::FrameInfo::as_note");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:257 with_extra (lane interp-step-call)
Frame.prototype.with_extra = function <Extra>(this: Frame, extra: Extra): Frame {
  return unported("rustc_const_eval::interpret::stack::Frame::with_extra");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:280 current_loc (lane interp-step-call)
Frame.prototype.current_loc = function (this: Frame): Either<Location, Span> {
  return unported("rustc_const_eval::interpret::stack::Frame::current_loc");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:284 body (lane interp-step-call)
Frame.prototype.body_ = function (this: Frame): Body {
  return unported("rustc_const_eval::interpret::stack::Frame::body");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:288 instance (lane interp-step-call)
Frame.prototype.instance_ = function (this: Frame): Instance {
  return unported("rustc_const_eval::interpret::stack::Frame::instance");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:292 return_place (lane interp-step-call)
Frame.prototype.return_place_ = function (this: Frame): PlaceTy {
  return unported("rustc_const_eval::interpret::stack::Frame::return_place");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:296 return_cont (lane interp-step-call)
Frame.prototype.return_cont_ = function (this: Frame): ReturnContinuation {
  return unported("rustc_const_eval::interpret::stack::Frame::return_cont");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:300 locals (lane interp-step-call)
Frame.prototype.locals_ = function (this: Frame): LocalState[] {
  return unported("rustc_const_eval::interpret::stack::Frame::locals");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:305 current_source_info (lane interp-step-call)
Frame.prototype.current_source_info = function (this: Frame): SourceInfo | undefined {
  return unported("rustc_const_eval::interpret::stack::Frame::current_source_info");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:309 current_span (lane interp-step-call)
Frame.prototype.current_span = function (this: Frame): Span {
  return unported("rustc_const_eval::interpret::stack::Frame::current_span");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:316 lint_root (lane interp-step-call)
Frame.prototype.lint_root = function (this: Frame, tcx: TyCtxt): HirId | undefined {
  return unported("rustc_const_eval::interpret::stack::Frame::lint_root");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:333 locals_addr (lane interp-step-call)
Frame.prototype.locals_addr = function (this: Frame): number {
  return unported("rustc_const_eval::interpret::stack::Frame::locals_addr");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:338 generate_stacktrace_from_stack (lane interp-step-call)
(Frame as { generate_stacktrace_from_stack: typeof Frame.generate_stacktrace_from_stack }).generate_stacktrace_from_stack = function (stack: readonly Frame[], tcx: TyCtxt): FrameInfo[] {
  return unported("rustc_const_eval::interpret::stack::Frame::generate_stacktrace_from_stack");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:377 push_stack_frame_raw (lane interp-step-call)
InterpCx.prototype.push_stack_frame_raw = function (this: InterpCx, instance: Instance, body: Body, return_place: PlaceTy, return_cont: ReturnContinuation): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::push_stack_frame_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:439 pop_stack_frame_raw (lane interp-step-call)
InterpCx.prototype.pop_stack_frame_raw = function (this: InterpCx): InterpResult<Frame> {
  return unported("rustc_const_eval::interpret::stack::InterpCx::pop_stack_frame_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:449 cleanup_stack_frame (lane interp-step-call)
InterpCx.prototype.cleanup_stack_frame = function (this: InterpCx, unwinding: boolean, frame: Frame): InterpResult<ReturnAction> {
  return unported("rustc_const_eval::interpret::stack::InterpCx::cleanup_stack_frame");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:484 push_stack_frame_done (lane interp-step-call)
InterpCx.prototype.push_stack_frame_done = function (this: InterpCx): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::push_stack_frame_done");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:503 storage_live_dyn (lane interp-step-call)
InterpCx.prototype.storage_live_dyn = function (this: InterpCx, local: Local, meta: MemPlaceMeta): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::storage_live_dyn");
};

// PORT: nested in `storage_live_dyn` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/stack.rs:511 is_very_trivially_sized (lane interp-step-call)
function is_very_trivially_sized(ty: Ty): boolean {
  return unported("rustc_const_eval::interpret::stack::storage_live_dyn::is_very_trivially_sized");
}

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:592 storage_live (lane interp-step-call)
InterpCx.prototype.storage_live = function (this: InterpCx, local: Local): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::storage_live");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:596 storage_dead (lane interp-step-call)
InterpCx.prototype.storage_dead = function (this: InterpCx, local: Local): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::storage_dead");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:606 deallocate_local (lane interp-step-call)
InterpCx.prototype.deallocate_local = function (this: InterpCx, local: LocalValue): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::deallocate_local");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:624 layout_of_local (lane interp-step-call)
InterpCx.prototype.layout_of_local = function (this: InterpCx, frame: Frame, local: Local, layout: TyAndLayout | undefined): InterpResult<TyAndLayout> {
  return unported("rustc_const_eval::interpret::stack::InterpCx::layout_of_local");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:651 allocate_varargs (lane interp-step-call)
InterpCx.prototype.allocate_varargs = function <I, J>(this: InterpCx, caller_args: I, callee_abis: J): InterpResult<MPlaceTy[]> {
  return unported("rustc_const_eval::interpret::stack::InterpCx::allocate_varargs");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:680 deallocate_varargs (lane interp-step-call)
InterpCx.prototype.deallocate_varargs = function (this: InterpCx, varargs: readonly MPlaceTy[]): InterpResult {
  return unported("rustc_const_eval::interpret::stack::InterpCx::deallocate_varargs");
};

// stub: compiler/rustc_const_eval/src/interpret/stack.rs:701 print (lane interp-step-call)
LocalState.prototype.print = function (this: LocalState, allocs: (AllocId | undefined)[], fmt: Fmt): string {
  return unported("rustc_const_eval::interpret::stack::LocalState::print");
};
