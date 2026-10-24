// Port of compiler/rustc_const_eval/src/const_eval/error.rs (lane ctfe-a; declared by lane interp-contract, plan-m4 wave
// 23b). `ConstEvalErrKind` is generated into error.gen.ts; its `Display`, `impl MachineStopType` (the trait object
// `ConstEvalErrKind_as_MachineStopType`) and `Into<InterpErrorInfo>` are here, with `get_span_and_frames`, `report` and
// `lint`. interpret/eval_context.ts's header has the representation notes.
import { ConstEvalErrKind, debug_ConstEvalErrKind } from "./error.gen.ts";
import { CompileTimeMachine, type CompileTimeInterpCx } from "./machine.ts";
import * as diagnostics from "../diagnostics.ts";
import { type FrameNote } from "../diagnostics.ts";
import { type Diag, type Diagnostic, E0080 } from "../../rustc_errors/lib.ts";
import { type Lint } from "../../rustc_lint_defs/lib.ts";
import { display_AssertKind } from "../../rustc_middle/mir/terminator.ts";
import {
  display_AllocId,
  display_InterpErrorKind,
  display_Pointer_Option,
  type ErrorHandled,
  type InterpErrorInfo,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type MachineStopType,
  MachineStopType_provided,
  ReportedErrorInfo,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { debug_ConstInt } from "../../rustc_middle/ty/consts/int.ts";
import { InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { Frame } from "../interpret/stack.gen.ts";

export * from "./error.gen.ts";

// impl fmt::Display for ConstEvalErrKind
// rustc: compiler/rustc_const_eval/src/const_eval/error.rs:47 fmt
export function display_ConstEvalErrKind(self: ConstEvalErrKind, f: Fmt): string {
  // use ConstEvalErrKind::*;
  switch (self.$) {
    case "ConstAccessesMutGlobal":
      return "constant accesses mutable global memory";
    case "ModifiedGlobal": {
      return "modifying a static's initial value from another static's initializer";
    }
    case "Panic":
      return `evaluation panicked: ${display_Symbol(self.msg)}`;
    case "Abort":
      return "the program aborted execution";
    case "RecursiveStatic": {
      return "encountered static that tried to access itself during initialization";
    }
    case "AssertFailure":
      return display_AssertKind(self._0, debug_ConstInt);
    case "WriteThroughImmutablePointer": {
      return "writing through a pointer that was derived from a shared (immutable) reference";
    }
    case "ConstMakeGlobalPtrAlreadyMadeGlobal": {
      return `attempting to call \`const_make_global\` twice on the same allocation ${display_AllocId(self._0, f)}`;
    }
    case "ConstMakeGlobalPtrIsNonHeap": {
      return `pointer passed to \`const_make_global\` does not point to a heap allocation: ${display_Pointer_Option(self._0, PLAIN)}`;
    }
    case "ConstMakeGlobalWithDanglingPtr": {
      return `pointer passed to \`const_make_global\` is dangling: ${display_Pointer_Option(self._0, PLAIN)}`;
    }
    case "ConstMakeGlobalWithOffset": {
      return `making ${display_Pointer_Option(self._0, PLAIN)} global which does not point to the beginning of an object`;
    }
  }
}

// impl MachineStopType for ConstEvalErrKind {}
/** PORT: `Box<dyn MachineStopType>` of a `ConstEvalErrKind` (interpret error.ts's `MachineStopType`: `Display` /
 *  `Debug` / the provided `with_validation_path`); `value` keeps the boxed value (`downcast_ref`). */
export function ConstEvalErrKind_as_MachineStopType(self: ConstEvalErrKind): MachineStopType & { readonly value: ConstEvalErrKind } {
  const obj = {
    value: self,
    display: (): string => display_ConstEvalErrKind(self, PLAIN),
    debug: (f: Fmt): string => debug_ConstEvalErrKind(self, f),
    with_validation_path: (path: string): void => MachineStopType_provided.with_validation_path(obj, path),
  };
  return obj;
}

/// The errors become [`InterpErrorKind::MachineStop`] when being raised.
// impl<'tcx> Into<InterpErrorInfo<'tcx>> for ConstEvalErrKind
// rustc: compiler/rustc_const_eval/src/const_eval/error.rs:92 into
export function ConstEvalErrKind_into_InterpErrorInfo(self: ConstEvalErrKind): InterpErrorInfo {
  // err_machine_stop!(self).into()
  return InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: ConstEvalErrKind_as_MachineStopType(self) });
}

/** `#[derive(Clone)]` of `FrameNote` (diagnostics.rs). */
function clone_FrameNote(frame: FrameNote): FrameNote {
  return { ...frame, span_context: [...frame.span_context] };
}

// rustc: compiler/rustc_const_eval/src/const_eval/error.rs:97 get_span_and_frames
export function get_span_and_frames(tcx: TyCtxtAt, stack: readonly Frame[]): [Span, FrameNote[]] {
  let stacktrace = Frame.generate_stacktrace_from_stack(stack, tcx.tcx);
  // Filter out `requires_caller_location` frames.
  stacktrace = stacktrace.filter((frame) => !InstanceKind.requires_caller_location(frame.instance.def, tcx.tcx));
  const last = stacktrace[stacktrace.length - 1];
  const span = last !== undefined ? last.span : tcx.span;

  const frames: FrameNote[] = [];

  // Add notes to the backtrace. Don't print a single-line backtrace though.
  if (stacktrace.length > 1) {
    // Helper closure to print duplicated lines.
    const add_frame = (frame: FrameNote): void => {
      frames.push({ ...clone_FrameNote(frame), times: 0 });
      // Don't print [... additional calls ...] if the number of lines is small
      if (frame.times < 3) {
        const times = frame.times;
        frame.times = 0;
        for (let i = 0; i < times; i++) frames.push(clone_FrameNote(frame));
      } else {
        frames.push(frame);
      }
    };

    let last_frame: FrameNote | undefined = undefined;
    for (const frame_info of stacktrace) {
      const frame = frame_info.as_note(tcx.tcx);
      if (last_frame !== undefined) {
        if (last_frame.span === frame.span && last_frame.where_ === frame.where_ && last_frame.instance === frame.instance) {
          last_frame.times += 1;
        } else {
          // add_frame(mem::replace(last_frame, frame))
          const old = last_frame;
          last_frame = frame;
          add_frame(old);
        }
      } else {
        last_frame = frame;
      }
    }
    if (last_frame !== undefined) {
      add_frame(last_frame);
    }
  }

  // In `rustc`, we present const-eval errors from the outer-most place first to the inner-most.
  // So we reverse the frames here. The first frame will be the same as the span from the current
  // `TyCtxtAt<'_>`, so we remove it as it would be redundant.
  frames.reverse();
  if (frames.length > 0) {
    frames.splice(0, 1);
  }
  const last_ = frames[frames.length - 1];
  if (
    last_ !== undefined &&
    // If the span is not going to be printed, we don't want the span label for `is_last`.
    tcx.tcx.sess.source_map().span_to_snippet(Span.source_callsite(last_.span)).$ === "Ok"
  ) {
    last_.has_label = true;
  }

  return [span, frames];
}

/// Create a diagnostic for a const eval error.
///
/// This will use the `mk` function for adding more information to the error.
/// You can use it to add a stacktrace of current execution according to
/// `get_span_and_frames` or just give context on where the const eval error happened.
// rustc: compiler/rustc_const_eval/src/const_eval/error.rs:169 report
export function report(ecx: CompileTimeInterpCx, error: InterpErrorKind, mk: (a0: Diag, a1: Span, a2: FrameNote[]) => void): ErrorHandled {
  const tcx = ecx.tcx.tcx;
  // Special handling for certain errors
  // Don't emit a new diagnostic for these errors, they are already reported elsewhere or
  // should remain silent.
  if (error.$ === "InvalidProgram" && error._0.$ === "AlreadyReported") {
    // err_inval!(AlreadyReported(info))
    return { $: "Reported", _0: error._0._0, _1: DUMMY_SP };
  } else if (
    (error.$ === "InvalidProgram" && error._0.$ === "Layout" && error._0._0.$ === "TooGeneric") ||
    (error.$ === "InvalidProgram" && error._0.$ === "TooGeneric")
  ) {
    // err_inval!(Layout(LayoutError::TooGeneric(_))) | err_inval!(TooGeneric)
    return { $: "TooGeneric", _0: DUMMY_SP };
  } else if (error.$ === "InvalidProgram" && error._0.$ === "Layout" && error._0._0.$ === "ReferencesError") {
    // err_inval!(Layout(LayoutError::ReferencesError(guar)))
    const guar = error._0._0._0;
    // This can occur in infallible promoteds e.g. when a non-existent type or field is
    // encountered.
    return { $: "Reported", _0: ReportedErrorInfo.allowed_in_infallible(guar), _1: DUMMY_SP };
  } else {
    // Report remaining errors.
    const [span, frames] = get_span_and_frames(ecx.tcx, ecx.stack());
    const err = tcx.dcx().struct_span_err(span, display_InterpErrorKind(error));
    err.code(E0080);
    if (
      (error.$ === "UndefinedBehavior" && error._0.$ === "ValidationError" && error._0.ptr_bytes_warning === true) ||
      (error.$ === "Unsupported" && (error._0.$ === "ReadPointerAsInt" || error._0.$ === "ReadPartialPointer"))
    ) {
      err.help("this code performed an operation that depends on the underlying bytes representing a pointer");
      err.help("the absolute address of a pointer is not known at compile-time, so such operations are not supported");
    }
    if (error.$ === "UndefinedBehavior" && error._0.$ === "InvalidUninitBytes" && error._0._0 !== undefined) {
      const [alloc_id, _access] = error._0._0;
      const bytes = ecx.print_alloc_bytes_for_diagnostics(alloc_id);
      const info = ecx.get_alloc_info(alloc_id);
      const raw_bytes: diagnostics.RawBytesNote = {
        size: info.size.bytes(),
        align: info.align.bytes(),
        bytes,
      };
      err.subdiagnostic(diagnostics.RawBytesNote_subdiagnostic(raw_bytes));
    }

    // We allow invalid programs in infallible promoteds since invalid layouts can occur
    // anyway (e.g. due to size overflow). And we allow OOM as that can happen any time.
    const allowed_in_infallible = error.$ === "ResourceExhaustion" || error.$ === "InvalidProgram";

    mk(err, span, frames);
    const guar = err.emit_err();
    const reported = allowed_in_infallible ? ReportedErrorInfo.allowed_in_infallible(guar) : ReportedErrorInfo.const_eval_error(guar);
    return { $: "Reported", _0: reported, _1: span };
  }
}

/// Emit a lint from a const-eval situation, with a backtrace.
// Even if this is unused, please don't remove it -- chances are we will need to emit a lint during const-eval again in the future!
// #[allow(unused)]
// PORT: `L: for<'a> rustc_errors::Diagnostic<'a>` is the `Diagnostic` trait object the decorator returns.
// rustc: compiler/rustc_const_eval/src/const_eval/error.rs:242 lint
export function lint<L extends Diagnostic>(tcx: TyCtxtAt, machine: CompileTimeMachine, lint: Lint, decorator: (a0: FrameNote[]) => L): void {
  const [span, frames] = get_span_and_frames(tcx, machine.stack);

  tcx.tcx.emit_node_span_lint(lint, machine.best_lint_scope(tcx.tcx), span, decorator(frames));
}
