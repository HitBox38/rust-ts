// Port of compiler/rustc_const_eval/src/interpret/stack.rs (lane interp-step-call; declared by lane interp-contract,
// docs/handoff/interp-contract.md): the low-level pushing and popping of stack frames and the (de)allocation of local
// variables (interpret/eval_context.ts's header has the representation notes).
//! Manages the low-level pushing and popping of stack frames and the (de)allocation of local variables.
//! For handling of argument passing and return values, see the `call` module.
import { type FrameNote } from "../diagnostics.ts";
import { InterpCx, from_known_layout } from "./eval_context.ts";
import { ReturnAction, type Machine } from "./machine.ts";
import { Immediate, type Operand } from "./operand.ts";
import { MemPlaceMeta } from "./place.ts";
import { Frame, FrameInfo, LocalState, LocalValue, debug_LocalValue, type ReturnContinuation } from "./stack.gen.ts";
import { type FnArg } from "./call.gen.ts";
import type { ArgAbi } from "./call.ts";
import { MemoryKind } from "./memory.gen.ts";
import { type HirId } from "../../rustc_hir_id/lib.ts";
import {
  type AllocId,
  type CtfeProvenance,
  debug_CtfeProvenance,
  debug_Pointer_Option,
  debug_Scalar,
  ErrorHandled,
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  type Pointer,
  Provenance_CtfeProvenance,
  UndefinedBehaviorInfo,
  UnsupportedOpInfo,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type Body, Const as mir_Const, type Either, type Local, Location, RETURN_PLACE, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { fold_Const as fold_mir_Const } from "../../rustc_middle/mir/consts.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { with_ } from "../../rustc_middle/ty/context/tls.ts";
import { display_Instance, Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { always_storage_live_locals } from "../../rustc_mir_dataflow/impls/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { debug_option, debug_struct, type Fmt } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";


/** Lazy interpret hand module read at call time (init order, eval_context.ts header). */
function call(): typeof import("./call.ts") {
  return (call_cache ??= require("./call.ts") as typeof import("./call.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var call_cache: typeof import("./call.ts") | undefined;
/** Lazy `crate::util` (util/mod.ts, lane ctfe-util). */
function util(): typeof import("../util/mod.ts") {
  return (util_cache ??= require("../util/mod.ts") as typeof import("../util/mod.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var util_cache: typeof import("../util/mod.ts") | undefined;

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
    with_extra<Extra>(extra: Extra): Frame<Extra>;
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
    // PORT: `I: Iterator<Item = (&FnArg, &ArgAbi)>`, `J: Iterator<Item = (usize, &ArgAbi)>` (taken `&mut` by the caller).
    allocate_varargs(caller_args: Iterator<[FnArg, ArgAbi<Ty>]>, callee_abis: Iterator<[number, ArgAbi<Ty>]>): InterpResult<MPlaceTy[]>;
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

  /// By default a `SpanGuard` does nothing.
  // rustc: compiler/rustc_const_eval/src/interpret/stack.rs:32 new
  static new(): SpanGuard {
    return new SpanGuard(/* tracing::Span::none() */ undefined, /* PhantomData */ undefined);
  }

  /// If a span is entered, we exit the previous span (if any, normally none) and enter the
  /// new span. This is mainly so we don't have to use `Option` for the `tracing_span` field of
  /// `Frame` by creating a dummy span to being with and then entering it once the frame has
  /// been pushed.
  // rustc: compiler/rustc_const_eval/src/interpret/stack.rs:40 enter
  // PORT: `span: tracing::Span` is `unknown` (the field's type).
  enter(span: unknown): void {
    // This executes the destructor on the previous instance of `SpanGuard`, ensuring that
    // we never enter or exit more spans than vice versa. Unless you `mem::leak`, then we
    // can't protect the tracing stack, but that'll just lead to weird logging, no actual
    // problems.
    this.drop();
    this._0 = span;
    this._1 = undefined;
    // PORT: `self.0.with_subscriber(|(id, dispatch)| dispatch.enter(id))`: no tracing subscriber is ported, so a span
    // has no subscriber and this is a no-op (as for `Span::none()`).
  }

  // impl Drop for SpanGuard
  // rustc: compiler/rustc_const_eval/src/interpret/stack.rs:53 drop
  drop(): void {
    // PORT: `self.0.with_subscriber(|(id, dispatch)| dispatch.exit(id))`: no subscriber (see `enter`), a no-op.
  }
}

// impl Debug for LocalState
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:140 fmt
export function debug_LocalState(self: LocalState, f: Fmt): string {
  return debug_struct(f, "LocalState", [
    ["value", debug_LocalValue(self.value, f)],
    ["ty", debug_option(self.layout === undefined ? undefined : self.layout.ty, f, debug_Ty)],
  ]);
}

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:165 make_live_uninit
LocalState.prototype.make_live_uninit = function (this: LocalState): void {
  this.value = { $: "Live", _0: { $: "Immediate", _0: Immediate.Uninit } };
};

/// This is a hack because Miri needs a way to visit all the provenance in a `LocalState`
/// without having a layout or `TyCtxt` available, and we want to keep the `Operand` type
/// private. Does not count as a read of the local for the AM! It's a "ghost" read, like for
/// validation or similar purposes.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:173 as_mplace_or_imm_ghost
LocalState.prototype.as_mplace_or_imm_ghost = function (this: LocalState): Either<[Pointer<CtfeProvenance | undefined>, MemPlaceMeta], Immediate> | undefined {
  const value = this.value;
  switch (value.$) {
    case "Dead":
      return undefined;
    case "Live": {
      const op = value._0;
      switch (op.$) {
        case "Indirect": {
          const mplace = op._0;
          return { $: "Left", _0: [mplace.ptr, mplace.meta] };
        }
        case "Immediate":
          return { $: "Right", _0: op._0 };
      }
    }
  }
};

/// Read the local's value or error if the local is not yet live or not live anymore.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:185 access
LocalState.prototype.access = function (this: LocalState): InterpResult<Operand> {
  const value = this.value;
  switch (value.$) {
    case "Dead":
      // throw_ub!(DeadLocal)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: UndefinedBehaviorInfo.DeadLocal })); // could even be "invalid program"?
    case "Live": {
      const val = value._0;
      return interp_ok(val);
    }
  }
};

/// Overwrite the local. If the local can be overwritten in place, return a reference
/// to do so; otherwise return the `MemPlace` to consult instead.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:195 access_mut
// PORT: `&mut Operand` is the (immutable) operand; a write through it is a write of `LocalState.value` (the mutable
// state, interp-contract representation decision 4): `local.value = LocalValue::Live(new_operand)`.
LocalState.prototype.access_mut = function (this: LocalState): InterpResult<Operand> {
  const value = this.value;
  switch (value.$) {
    case "Dead":
      // throw_ub!(DeadLocal)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: UndefinedBehaviorInfo.DeadLocal })); // could even be "invalid program"?
    case "Live": {
      const val = value._0;
      return interp_ok(val);
    }
  }
};

// FIXME: only used by miri, should be removed once translatable.
// impl Display for FrameInfo
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:212 fmt
export function display_FrameInfo(self: FrameInfo, f: Fmt): string {
  void f;
  return with_((tcx) => {
    if (tcx.def_key(Instance.def_id(self.instance)).disambiguated_data.data.$ === "Closure") {
      return "inside closure";
    } else {
      // Note: this triggers a `must_produce_diag` state, which means that if we ever
      // get here we must emit a diagnostic. We should never display a `FrameInfo` unless
      // we actually want to emit a warning or error to the user.
      return `inside \`${display_Instance(self.instance)}\``;
    }
  });
}

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:227 as_note
FrameInfo.prototype.as_note = function (this: FrameInfo, tcx: TyCtxt): FrameNote {
  const span = this.span;
  if (tcx.def_key(Instance.def_id(this.instance)).disambiguated_data.data.$ === "Closure") {
    return {
      where_: "closure",
      span,
      span_context: [],
      instance: "",
      times: 0,
      has_label: false,
    };
  } else {
    const instance = display_Instance(this.instance);
    const span_context = util().context_spans(tcx, span, Instance.def_id(this.instance));
    // Note: this triggers a `must_produce_diag` state, which means that if we ever get
    // here we must emit a diagnostic. We should never display a `FrameInfo` unless we
    // actually want to emit a warning or error to the user.
    return {
      where_: "instance",
      span,
      span_context,
      instance,
      times: 0,
      has_label: false,
    };
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:257 with_extra
Frame.prototype.with_extra = function <Extra>(this: Frame, extra: Extra): Frame<Extra> {
  return new Frame<Extra>(
    this.body,
    this.instance,
    extra,
    this.return_cont,
    this.return_place,
    this.locals,
    this.va_list,
    this.tracing_span,
    this.loc,
  );
};

/// Get the current location within the Frame.
///
/// If this is `Right`, we are not currently executing any particular statement in
/// this frame (can happen e.g. during frame initialization, and during unwinding on
/// frames without cleanup code).
///
/// Used by [priroda](https://github.com/oli-obk/priroda).
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:280 current_loc
Frame.prototype.current_loc = function (this: Frame): Either<Location, Span> {
  return this.loc;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:284 body
Frame.prototype.body_ = function (this: Frame): Body {
  return this.body;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:288 instance
Frame.prototype.instance_ = function (this: Frame): Instance {
  return this.instance;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:292 return_place
Frame.prototype.return_place_ = function (this: Frame): PlaceTy {
  return this.return_place;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:296 return_cont
Frame.prototype.return_cont_ = function (this: Frame): ReturnContinuation {
  return this.return_cont;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:300 locals
Frame.prototype.locals_ = function (this: Frame): LocalState[] {
  return this.locals;
};

/// Return the `SourceInfo` of the current instruction.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:305 current_source_info
Frame.prototype.current_source_info = function (this: Frame): SourceInfo | undefined {
  return this.loc.$ === "Left" ? this.body.source_info(this.loc._0) : undefined;
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:309 current_span
Frame.prototype.current_span = function (this: Frame): Span {
  switch (this.loc.$) {
    case "Left":
      return this.body.source_info(this.loc._0).span;
    case "Right":
      return this.loc._0;
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:316 lint_root
Frame.prototype.lint_root = function (this: Frame, tcx: TyCtxt): HirId | undefined {
  // We first try to get a HirId via the current source scope,
  // and fall back to `body.source`.
  const source_info = this.current_source_info();
  let lint_root: HirId | undefined = undefined;
  if (source_info !== undefined) {
    const local_data = unwrap(this.body.source_scopes[source_info.scope]).local_data;
    switch (local_data.$) {
      case "Set":
        lint_root = local_data._0.lint_root;
        break;
      case "Clear":
        lint_root = undefined;
        break;
    }
  }
  if (lint_root === undefined) {
    const def_id = this.body.source.def_id().as_local();
    lint_root = def_id === undefined ? undefined : tcx.local_def_id_to_hir_id(def_id);
  }
  return lint_root;
};

/** PORT: the address of a frame's locals buffer: TS arrays have no address, so each `locals` array gets a unique
 * number on first use (only ever compared for equality, like the address). */
const LOCALS_ADDRS = new WeakMap<LocalState[], number>();
let next_locals_addr = 1;

/// Returns the address of the buffer where the locals are stored. This is used by `Place` as a
/// sanity check to detect bugs where we mix up which stack frame a place refers to.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:333 locals_addr
Frame.prototype.locals_addr = function (this: Frame): number {
  let addr = LOCALS_ADDRS.get(this.locals);
  if (addr === undefined) {
    addr = next_locals_addr++;
    LOCALS_ADDRS.set(this.locals, addr);
  }
  return addr;
};

// #[must_use]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:338 generate_stacktrace_from_stack
(Frame as { generate_stacktrace_from_stack: typeof Frame.generate_stacktrace_from_stack }).generate_stacktrace_from_stack = function (stack: readonly Frame[], tcx: TyCtxt): FrameInfo[] {
  const frames: FrameInfo[] = [];
  // This deliberately does *not* honor `requires_caller_location` since it is used for much
  // more than just panics.
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    let span: Span;
    switch (frame.loc.$) {
      case "Left": {
        const loc = frame.loc._0;
        // If the stacktrace passes through MIR-inlined source scopes, add them.
        const source_info = frame.body.source_info(loc);
        let span_ = source_info.span;
        const scope = source_info.scope;
        let scope_data = unwrap(frame.body.source_scopes[scope]);
        while (scope_data.inlined !== undefined) {
          const [instance, call_span] = scope_data.inlined;
          frames.push(new FrameInfo(instance, span_));
          span_ = call_span;
          scope_data = unwrap(frame.body.source_scopes[unwrap(scope_data.parent_scope)]);
        }
        span = span_;
        break;
      }
      case "Right":
        span = frame.loc._0;
        break;
    }
    if (Span.is_dummy(span)) {
      // Some statements lack a proper span; point at the function instead.
      span = tcx.def_span(Instance.def_id(frame.instance));
    }
    frames.push(new FrameInfo(frame.instance, span));
  }
  // trace!("generate stacktrace: {:#?}", frames);
  return frames;
};

/// Very low-level helper that pushes a stack frame without initializing
/// the arguments or local variables.
///
/// The high-level version of this is `init_stack_frame`.
// #[instrument(skip(self, body, return_place, return_cont), level = "debug")]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:377 push_stack_frame_raw
InterpCx.prototype.push_stack_frame_raw = function (this: InterpCx, instance: Instance, body: Body, return_place: PlaceTy, return_cont: ReturnContinuation): InterpResult {
  // trace!("body: {:#?}", body);

  // We can push a `Root` frame if and only if the stack is empty.
  // debug_assert_eq!(
  //     self.stack().is_empty(),
  //     matches!(return_cont, ReturnContinuation::Stop { .. })
  // );

  // First push a stack frame so we have access to `instantiate_from_current_frame` and other
  // `self.frame()`-based functions.
  // PORT: `IndexVec::from_elem(dead_local, ..)` clones `dead_local` per local (`LocalState` is mutable).
  const locals = body.local_decls.map(() => new LocalState(LocalValue.Dead, /* Cell::new(None) */ undefined));
  // PORT: `extra: ()` is `null` (the CTFE machines' `FrameExtra`, interp-contract decision 2).
  const pre_frame = new Frame<null>(
    body,
    instance,
    null,
    return_cont,
    return_place,
    locals,
    [],
    SpanGuard.new(),
    { $: "Right", _0: this.tcx.def_span(body.source.def_id()) }, // Span used for errors caused during preamble.
  );
  const frame_r = this.machine.init_frame(this, pre_frame);
  if (frame_r.$ === "Err") return frame_r;
  const frame = frame_r._0;
  this.stack_mut().push(frame);

  // Make sure all the constants required by this frame evaluate successfully (post-monomorphization check).
  for (const const_ of body.required_consts_()) {
    // We can't use `eval_mir_constant` here as that assumes that all required consts have
    // already been checked, so we need a separate tracing call.
    // let _trace = enter_trace_span!(M, const_eval::required_consts, ?const_.const_);
    const c_r = this.instantiate_from_current_frame_and_normalize_erasing_regions(const_.const_, fold_mir_Const);
    if (c_r.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(c_r._0));
    const c = c_r._0;
    const r = mir_Const.eval(c, this.tcx.deref(), this.typing_env, const_.span);
    if (r.$ === "Err") {
      const err = r._0;
      ErrorHandled.emit_note(err, this.tcx.deref());
      return Err(InterpErrorInfo_from_ErrorHandled(err));
    }
  }

  // Finish things up.
  const r = this.machine.after_stack_push(this);
  if (r.$ === "Err") return r;
  // `tracing_separate_thread` is used to instruct the tracing_chrome [tracing::Layer] in Miri
  // to put the "frame" span on a separate trace thread/line than other spans, to make the
  // visualization in <https://ui.perfetto.dev> easier to interpret. It is set to a value of
  // [tracing::field::Empty] so that other tracing layers (e.g. the logger) will ignore it.
  // let span = info_span!("frame", tracing_separate_thread = Empty, frame = %instance);
  // PORT: `info_span!` under the default WARN filter is a disabled span (`Span::none()`, `undefined`).
  const span = undefined;
  this.frame_mut().tracing_span.enter(span);

  return interp_ok(undefined);
};

/// Low-level helper that pops a stack frame from the stack without any cleanup.
/// This invokes `before_stack_pop`.
/// After calling this function, you need to deal with the return value, and then
/// invoke `cleanup_stack_frame`.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:439 pop_stack_frame_raw
InterpCx.prototype.pop_stack_frame_raw = function (this: InterpCx): InterpResult<Frame> {
  const r = this.machine.before_stack_pop(this);
  if (r.$ === "Err") return r;
  const frame = unwrap(this.stack_mut().pop(), "tried to pop a stack frame, but there were none");
  return interp_ok(frame);
};

/// Deallocate local variables in the stack frame, and invoke `after_stack_pop`.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:449 cleanup_stack_frame
InterpCx.prototype.cleanup_stack_frame = function (this: InterpCx, unwinding: boolean, frame: Frame): InterpResult<ReturnAction> {
  const return_cont = frame.return_cont;

  // Cleanup: deallocate locals.
  // Usually we want to clean up (deallocate locals), but in a few rare cases we don't.
  // We do this while the frame is still on the stack, so errors point to the callee.
  let cleanup: boolean;
  switch (return_cont.$) {
    case "Goto":
      cleanup = true;
      break;
    case "Stop":
      cleanup = return_cont.cleanup;
      break;
  }

  if (cleanup) {
    for (const local of frame.locals) {
      const r = this.deallocate_local(local.value);
      if (r.$ === "Err") return r;
    }

    // Deallocate any c-variadic arguments.
    const r = this.deallocate_varargs(frame.va_list);
    if (r.$ === "Err") return r;

    // Call the machine hook, which determines the next steps.
    const return_action_r = this.machine.after_stack_pop(this, frame, unwinding);
    if (return_action_r.$ === "Err") return return_action_r;
    const return_action = return_action_r._0;
    if (return_action === ReturnAction.NoCleanup) {
      panic(`assertion \`left != right\` failed\n  left: ${return_action}\n right: ${ReturnAction.NoCleanup}`);
    }
    return interp_ok(return_action);
  } else {
    // We also skip the machine hook when there's no cleanup. This not a real "pop" anyway.
    return interp_ok<ReturnAction>(ReturnAction.NoCleanup);
  }
};

/// Call this after `push_stack_frame_raw` and when all the other setup that needs to be done
/// is completed.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:484 push_stack_frame_done
InterpCx.prototype.push_stack_frame_done = function (this: InterpCx): InterpResult {
  // Mark all locals as live that are not arguments and don't have `Storage*` annotations
  // (this includes the return place, but not the arguments).
  const r = this.storage_live(RETURN_PLACE);
  if (r.$ === "Err") return r;

  const body = this.body();
  const always_live = always_storage_live_locals(body);
  for (const local of body.vars_and_temps_iter()) {
    if (always_live.contains(local)) {
      const r = this.storage_live(local);
      if (r.$ === "Err") return r;
    }
  }

  // Get ready to execute the first instruction in the stack frame.
  this.frame_mut().loc = { $: "Left", _0: Location.START };

  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:503 storage_live_dyn
InterpCx.prototype.storage_live_dyn = function (this: InterpCx, local: Local, meta: MemPlaceMeta): InterpResult {
  // trace!("{:?} is now live", local);

  // We avoid `ty.is_trivially_sized` since that does something expensive for ADTs.
  // rustc: compiler/rustc_const_eval/src/interpret/stack.rs:511 is_very_trivially_sized
  function is_very_trivially_sized(ty: Ty): boolean {
    const kind = ty.kind();
    switch (kind.$) {
      case "Infer":
        switch (kind._0.$) {
          case "IntVar":
          case "FloatVar":
            return true;
          case "TyVar":
            return false;
          case "FreshTy":
          case "FreshIntTy":
          case "FreshFloatTy":
            return bug(`\`is_very_trivially_sized\` applied to unexpected type: ${ty.toString()}`);
        }
      // (every arm of the inner switch returns)
      case "Uint":
      case "Int":
      case "Bool":
      case "Float":
      case "FnDef":
      case "FnPtr":
      case "RawPtr":
      case "Char":
      case "Ref":
      case "Coroutine":
      case "CoroutineWitness":
      case "Array":
      case "Closure":
      case "CoroutineClosure":
      case "Never":
      case "Error":
        return true;

      case "Str":
      case "Slice":
      case "Dynamic":
      case "Foreign":
        return false;

      case "Tuple": {
        const tys = kind._0;
        const last = tys[tys.length - 1];
        return last === undefined || is_very_trivially_sized(last);
      }

      case "Pat":
        return is_very_trivially_sized(kind._0);

      // We don't want to do any queries, so there is not much we can do with ADTs.
      case "Adt":
        return false;

      case "UnsafeBinder":
        return is_very_trivially_sized(Binder.skip_binder(UnsafeBinderInner.into_Binder(kind._0)));

      case "Alias":
      case "Param":
      case "Placeholder":
        return false;

      case "Bound":
        return bug(`\`is_very_trivially_sized\` applied to unexpected type: ${ty.toString()}`);
    }
  }

  // This is a hot function, we avoid computing the layout when possible.
  // `unsized_` will be `None` for sized types and `Some(layout)` for unsized types.
  let unsized_: TyAndLayout | undefined;
  if (is_very_trivially_sized(unwrap(this.body().local_decls[local]).ty)) {
    unsized_ = undefined;
  } else {
    // We need the layout.
    const layout_r = this.layout_of_local(this.frame(), local, undefined);
    if (layout_r.$ === "Err") return layout_r;
    const layout = layout_r._0;
    unsized_ = layout.is_sized() ? undefined : layout;
  }

  let local_op: Operand;
  if (unsized_ !== undefined) {
    const layout = unsized_;
    if (!MemPlaceMeta.has_meta(meta)) {
      // throw_unsup!(UnsizedLocal)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: UnsupportedOpInfo.UnsizedLocal }));
    }
    // Need to allocate some memory, since `Immediate::Uninit` cannot be unsized.
    const dest_place_r = this.allocate_dyn(layout, MemoryKind.Stack, meta);
    if (dest_place_r.$ === "Err") return dest_place_r;
    const dest_place = dest_place_r._0;
    local_op = { $: "Indirect", _0: dest_place.mplace_() };
  } else {
    // Just make this an efficient immediate.
    assert(!MemPlaceMeta.has_meta(meta), "assertion failed: !meta.has_meta()"); // we're dropping the metadata
    // Make sure the machine knows this "write" is happening. (This is important so that
    // races involving local variable allocation can be detected by Miri.)
    const r = this.machine.after_local_write(this, local, /*storage_live*/ true);
    if (r.$ === "Err") return r;
    // Note that not calling `layout_of` here does have one real consequence:
    // if the type is too big, we'll only notice this when the local is actually initialized,
    // which is a bit too late -- we should ideally notice this already here, when the memory
    // is conceptually allocated. But given how rare that error is and that this is a hot function,
    // we accept this downside for now.
    local_op = { $: "Immediate", _0: Immediate.Uninit };
  }
  const local_val: LocalValue = { $: "Live", _0: local_op };

  // If the local is already live, deallocate its old memory.
  const state = unwrap(this.frame_mut().locals[local]);
  const old = state.value;
  state.value = local_val;
  const r = this.deallocate_local(old);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Mark a storage as live, killing the previous content.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:592 storage_live
InterpCx.prototype.storage_live = function (this: InterpCx, local: Local): InterpResult {
  return this.storage_live_dyn(local, MemPlaceMeta.None);
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:596 storage_dead
InterpCx.prototype.storage_dead = function (this: InterpCx, local: Local): InterpResult {
  assert(local !== RETURN_PLACE, "Cannot make return place dead");
  // trace!("{:?} is now dead", local);

  // If the local is already dead, this is a NOP.
  const state = unwrap(this.frame_mut().locals[local]);
  const old = state.value;
  state.value = LocalValue.Dead;
  const r = this.deallocate_local(old);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:606 deallocate_local
InterpCx.prototype.deallocate_local = function (this: InterpCx, local: LocalValue): InterpResult {
  if (local.$ === "Live" && local._0.$ === "Indirect") {
    const ptr = local._0._0.ptr;
    // All locals have a backing allocation, even if the allocation is empty
    // due to the local having ZST type. Hence we can `unwrap`.
    // trace!(
    //     "deallocating local {:?}: {:?}",
    //     local,
    //     // Locals always have a `alloc_id` (they are never the result of a int2ptr).
    //     self.dump_alloc(ptr.provenance.unwrap().get_alloc_id().unwrap())
    // );
    const r = this.deallocate_ptr(ptr, undefined, MemoryKind.Stack);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// This is public because it is used by [Aquascope](https://github.com/cognitive-engineering-lab/aquascope/)
/// to analyze all the locals in a stack frame.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:624 layout_of_local
InterpCx.prototype.layout_of_local = function (this: InterpCx, frame: Frame, local: Local, layout: TyAndLayout | undefined): InterpResult<TyAndLayout> {
  const state = unwrap(frame.locals[local]);
  const cached = state.layout;
  if (cached !== undefined) {
    return interp_ok(cached);
  }

  const layout_r = from_known_layout(this.tcx, this.typing_env, layout, () => {
    const local_ty = unwrap(frame.body.local_decls[local]).ty;
    const local_ty_r = this.instantiate_from_frame_and_normalize_erasing_regions(frame, local_ty, fold_Ty);
    if (local_ty_r.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(local_ty_r._0));
    const r = this.layout_of(local_ty_r._0);
    return r.$ === "Err" ? Err(InterpErrorInfo_from_InterpErrorKind(r._0)) : r;
  });
  if (layout_r.$ === "Err") return layout_r;
  const layout_ = layout_r._0;

  // Layouts of locals are requested a lot, so we cache them.
  state.layout = layout_;
  return interp_ok(layout_);
};

/// Consume the arguments provided by the iterator and store them as a list
/// of variadic arguments. Return a list of the places that hold those arguments.
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:651 allocate_varargs
InterpCx.prototype.allocate_varargs = function (this: InterpCx, caller_args: Iterator<[FnArg, ArgAbi<Ty>]>, callee_abis: Iterator<[number, ArgAbi<Ty>]>): InterpResult<MPlaceTy[]> {
  // Consume the remaining arguments and store them in fresh allocations.
  const varargs: MPlaceTy[] = [];
  for (let next = caller_args.next(); !next.done; next = caller_args.next()) {
    const [fn_arg, caller_abi] = next.value;
    // The callee ABI is entirely computed based on which arguments the caller has
    // provided so it should not be possible to get a mismatch here.
    const callee_next = callee_abis.next();
    const [_idx, callee_abi] = unwrap(callee_next.done ? undefined : callee_next.value);
    const compat = this.check_argument_compat(caller_abi, callee_abi);
    if (compat.$ === "Err") return compat;
    assert(compat._0, "assertion failed: self.check_argument_compat(caller_abi, callee_abi)?");
    // FIXME: do we have to worry about in-place argument passing?
    const op = call().FnArg.copy_fn_arg(fn_arg);
    const mplace_r = this.allocate(op.layout, MemoryKind.Stack);
    if (mplace_r.$ === "Err") return mplace_r;
    const mplace = mplace_r._0;
    const r = this.copy_op(op, mplace);
    if (r.$ === "Err") return r;

    varargs.push(mplace);
  }
  assert(callee_abis.next().done === true, "assertion failed: callee_abis.next().is_none()");

  return interp_ok(varargs);
};

/// Deallocate the variadic arguments in the list (that must have been created with `allocate_varargs`).
// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:680 deallocate_varargs
InterpCx.prototype.deallocate_varargs = function (this: InterpCx, varargs: readonly MPlaceTy[]): InterpResult {
  for (const vararg of varargs) {
    const ptr = vararg.ptr();

    // trace!(
    //     "deallocating vararg {:?}: {:?}",
    //     vararg,
    //     // Locals always have a `alloc_id` (they are never the result of a int2ptr).
    //     self.dump_alloc(ptr.provenance.unwrap().get_alloc_id().unwrap())
    // );
    const r = this.deallocate_ptr(ptr, undefined, MemoryKind.Stack);
    if (r.$ === "Err") return r;
  }

  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/stack.rs:701 print
LocalState.prototype.print = function (this: LocalState, allocs: (AllocId | undefined)[], fmt: Fmt): string {
  let out = "";
  const value = this.value;
  if (value.$ === "Dead") {
    out += " is dead";
  } else if (value._0.$ === "Indirect") {
    const mplace = value._0._0;
    const meta = mplace.meta;
    out += ` by ${meta.$ === "Meta" ? ` meta(${debug_Scalar(meta._0, fmt, debug_CtfeProvenance)})` : ""} ref ${debug_Pointer_Option(mplace.ptr, fmt, debug_CtfeProvenance)}:`;
    const prov = mplace.ptr.provenance;
    if (prov !== undefined) allocs.push(Provenance_CtfeProvenance.get_alloc_id(prov));
  } else {
    const imm = value._0._0;
    switch (imm.$) {
      case "Uninit":
        out += " is uninitialized";
        break;
      case "Scalar": {
        const val = imm._0;
        out += ` ${debug_Scalar(val, fmt, debug_CtfeProvenance)}`;
        if (val.$ === "Ptr") {
          const ptr = val._0;
          allocs.push(Provenance_CtfeProvenance.get_alloc_id(ptr.provenance));
        }
        break;
      }
      case "ScalarPair": {
        const val1 = imm._0;
        const val2 = imm._1;
        out += ` (${debug_Scalar(val1, fmt, debug_CtfeProvenance)}, ${debug_Scalar(val2, fmt, debug_CtfeProvenance)})`;
        if (val1.$ === "Ptr") {
          const ptr = val1._0;
          allocs.push(Provenance_CtfeProvenance.get_alloc_id(ptr.provenance));
        }
        if (val2.$ === "Ptr") {
          const ptr = val2._0;
          allocs.push(Provenance_CtfeProvenance.get_alloc_id(ptr.provenance));
        }
        break;
      }
    }
  }

  return out;
};
