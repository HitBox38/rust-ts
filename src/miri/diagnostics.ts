// Port of src/tools/miri/src/diagnostics.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-driver` (plan-m6 wave 36): ported.
// Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (lane miri-driver):
// - `impl MachineStopType for TerminationInfo` (+ its `Display` / `Debug`): `TerminationInfo` is a generated union of plain
//   objects, so the `Box<dyn MachineStopType>` of `throw_machine_stop!(info)` is a `TerminationInfoStop` wrapping it:
//   `{ $: "MachineStop", _0: TerminationInfoStop.new(info) }` (`TerminationInfo_into_machine_stop(info)` builds the
//   whole `InterpErrorKind`). `info.downcast_ref::<TerminationInfo>()` is `TerminationInfoStop.downcast_ref(info)`.
// - The `note!` / `note_span!` macros are `note(msg)` / `note_span(span, msg)` returning the `(Option<Span>, String)` pair.
// - `trace!` lines stay comments (plan-m6 A6: only `info!` events are ported, by lane miri-log).
import { type ThreadId } from "./concurrency/thread.ts";
import { type DiagLevel, type NonHaltingDiagnostic, SpanDedupDiagnostic, type TerminationInfo } from "./diagnostics.gen.ts";
import { type AllocExtra, type MemoryKind, type MiriInterpCx, MiriMachine, type Provenance, debug_ProvenanceExtra, display_MiriMemoryKind } from "./machine.ts";
import type { MiriAllocBytes } from "./alloc/alloc_bytes.ts";
import { type AccessKind } from "./borrow_tracker/mod.ts";
import { debug_Item } from "./borrow_tracker/stacked_borrows/item.ts";
import { type Pointer } from "./lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { debug_DumpAllocs, display_MemoryKind } from "../rustc_const_eval/interpret/memory.ts";
import { Frame, type FrameInfo } from "../rustc_const_eval/interpret/stack.ts";
import { Diag, display_Level, type Level } from "../rustc_errors/lib.ts";
import { type Allocation, display_AllocRange } from "../rustc_middle/mir/interpret/allocation.ts";
import {
  type AllocId,
  debug_AllocId,
  debug_Pointer,
  display_AllocId,
  display_Pointer_Option,
  type InterpErrorInfo,
  type InterpErrorKind,
  type MachineStopType,
} from "../rustc_middle/mir/interpret/mod.ts";
import { display_Instance, Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { bug } from "../rustc_span/macros.ts";
import { type Fmt, PLAIN } from "../std/fmt.ts";
import { display_IoError } from "../std/io.ts";
import { assert, unported } from "../std/panic.ts";
export * from "./diagnostics.gen.ts";

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- diagnostics.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // diagnostics.rs:842
    emit_diagnostic(this: MiriInterpCx, e: NonHaltingDiagnostic): void;
    // diagnostics.rs:848
    handle_ice(this: MiriInterpCx): void;
    // diagnostics.rs:870
    dedup_diagnostic(this: MiriInterpCx, dedup: SpanDedupDiagnostic, f: (first: boolean) => NonHaltingDiagnostic): void;
  }
}

declare module "./machine.gen.ts" {
  interface MiriMachine {
    // diagnostics.rs:639
    emit_diagnostic(e: NonHaltingDiagnostic): void;
  }
}
declare module "./diagnostics.gen.ts" {
  namespace SpanDedupDiagnostic {
    // diagnostics.rs:904
    function new_(): SpanDedupDiagnostic;
    export { new_ as new };
  }
}

/** `impl Display for AccessKind` (borrow_tracker/mod.rs:22, lane miri-alloc). PORT(contract): pending miri-alloc (not
 * declared); root replaces this call with that lane's `display_AccessKind` when it lands. */
function display_AccessKind(_k: AccessKind): string {
  return unported("miri::borrow_tracker::AccessKind: Display (src/tools/miri/src/borrow_tracker/mod.rs:22; lane miri-alloc, not declared)");
}

// impl fmt::Display for TerminationInfo
// rustc: src/tools/miri/src/diagnostics.rs:71 fmt
export function display_TerminationInfo(self: TerminationInfo): string {
  // use TerminationInfo::*;
  switch (self.$) {
    case "Exit": {
      const { code } = self;
      return `the evaluated program completed with exit code ${code}`;
    }
    case "Abort":
      return `${self._0}`;
    case "Interrupted":
      return "interpretation was interrupted";
    case "UnsupportedInIsolation":
      return `${self._0}`;
    case "Int2PtrWithStrictProvenance":
      return "integer-to-pointer casts and `ptr::with_exposed_provenance` are not supported with `-Zmiri-strict-provenance`";
    case "StackedBorrowsUb":
      return `${self.msg}`;
    case "TreeBorrowsUb":
      return `${self.title}`;
    case "GlobalDeadlock":
      return "the evaluated program deadlocked";
    case "LocalDeadlock":
      return "a thread deadlocked";
    case "GenmcMoot":
      return "GenMC wants to skip this execution";
    case "MultipleSymbolDefinitions":
      return `multiple definitions of symbol \`${Symbol.as_str(self.link_name)}\``;
    case "SymbolShimClashing":
      return `found \`${Symbol.as_str(self.link_name)}\` symbol definition that clashes with a built-in shim`;
    case "DataRace": {
      const { involves_non_atomic, ptr, op1, op2 } = self;
      return `${involves_non_atomic ? "Data race" : "Race condition"} detected between (1) ${op1.action} on ${op1.thread_info} and (2) ${op2.action} on ${op2.thread_info} at ${debug_Pointer(ptr, PLAIN, debug_AllocId)}`;
    }
    case "UnsupportedForeignItem":
      return `${self._0}`;
  }
}

// impl fmt::Debug for TerminationInfo
// rustc: src/tools/miri/src/diagnostics.rs:108 fmt
export function debug_TerminationInfo(self: TerminationInfo, _f: Fmt): string {
  return display_TerminationInfo(self);
}

/** `Box<dyn MachineStopType>` holding a `TerminationInfo` (PORT: header). */
export class TerminationInfoStop implements MachineStopType {
  constructor(public info: TerminationInfo) {}

  static new(info: TerminationInfo): TerminationInfoStop {
    return new TerminationInfoStop(info);
  }

  /** `info.downcast_ref::<TerminationInfo>()` of a `Box<dyn MachineStopType>`. */
  static downcast_ref(stop: MachineStopType): TerminationInfo | undefined {
    return stop instanceof TerminationInfoStop ? stop.info : undefined;
  }

  display(): string {
    return display_TerminationInfo(this.info);
  }

  debug(f: Fmt): string {
    return debug_TerminationInfo(this.info, f);
  }

  // impl MachineStopType for TerminationInfo
  // rustc: src/tools/miri/src/diagnostics.rs:114 with_validation_path
  with_validation_path(path: string): void {
    const self = this.info;
    // use TerminationInfo::*;
    switch (self.$) {
      case "StackedBorrowsUb": {
        const { help } = self;
        help.push(`while retagging field ${path}`);
        break;
      }
      default:
        break;
    }
  }
}

/** `throw_machine_stop!(info)`'s error kind: `InterpErrorKind::MachineStop(Box::new(info))`. */
export function TerminationInfo_into_machine_stop(info: TerminationInfo): InterpErrorKind {
  return { $: "MachineStop", _0: TerminationInfoStop.new(info) };
}

/// Generate a note/help text without a span.
// macro_rules! note { ($($tt:tt)*) => { (None, format!($($tt)*)) }; }
function note(msg: string): [Span | undefined, string] {
  return [undefined, msg];
}
/// Generate a note/help text with a span.
// macro_rules! note_span { ($span:expr, $($tt:tt)*) => { (Some($span), format!($($tt)*)) }; }
function note_span(span: Span, msg: string): [Span | undefined, string] {
  return [span, msg];
}

/// Attempts to prune a stacktrace to omit the Rust runtime, and returns a bool indicating if any
/// frames were pruned. If the stacktrace does not have any local frames, we conclude that it must
/// be pointing to a problem in the Rust runtime itself, and do not prune it at all.
// rustc: src/tools/miri/src/diagnostics.rs:183 prune_stacktrace
export function prune_stacktrace(stacktrace_: FrameInfo[], machine: MiriMachine): [FrameInfo[], boolean] {
  let stacktrace = stacktrace_;
  switch (machine.backtrace_style) {
    case "Off": {
      // Remove all frames marked with `caller_location` -- that attribute indicates we
      // usually want to point at the caller, not them.
      stacktrace = stacktrace.filter((frame) => !InstanceKind.requires_caller_location(frame.instance.def, machine.tcx));
      // Retain one frame so that we can print a span for the error itself
      stacktrace = stacktrace.slice(0, 1);
      return [stacktrace, false];
    }
    case "Short": {
      const original_len = stacktrace.length;
      // Remove all frames marked with `caller_location` -- that attribute indicates we
      // usually want to point at the caller, not them.
      stacktrace = stacktrace.filter((frame) => !InstanceKind.requires_caller_location(frame.instance.def, machine.tcx));
      // Only prune further frames if there is at least one local frame. This check ensures
      // that if we get a backtrace that never makes it to the user code because it has
      // detected a bug in the Rust runtime, we don't prune away every frame.
      const has_local_frame = stacktrace.some((frame) => machine.is_local(frame.instance));
      if (has_local_frame) {
        // This is part of the logic that `std` uses to select the relevant part of a
        // backtrace. But here, we only look for __rust_begin_short_backtrace, not
        // __rust_end_short_backtrace because the end symbol comes from a call to the default
        // panic handler.
        const taken: FrameInfo[] = [];
        for (const frame of stacktrace) {
          const def_id = Instance.def_id(frame.instance);
          const path = machine.tcx.def_path_str(def_id);
          if (path.includes("__rust_begin_short_backtrace")) break;
          taken.push(frame);
        }
        stacktrace = taken;

        // After we prune frames from the bottom, there are a few left that are part of the
        // Rust runtime. So we remove frames until we get to a local symbol, which should be
        // main or a test.
        // This len check ensures that we don't somehow remove every frame, as doing so breaks
        // the primary error message.
        while (stacktrace.length > 1 && !machine.is_local(stacktrace[stacktrace.length - 1]!.instance)) {
          stacktrace.pop();
        }
      }
      const was_pruned = stacktrace.length !== original_len;
      return [stacktrace, was_pruned];
    }
    case "Full":
      return [stacktrace, false];
  }
}

/// Report the result of a Miri execution.
///
/// Returns `Some` if this was regular program termination with a given exit code and a `bool`
/// indicating whether a leak check should happen; `None` if execution was aborted with an error.
// rustc: src/tools/miri/src/diagnostics.rs:241 report_result
export function report_result(ecx: MiriInterpCx, res: InterpErrorInfo): [number, boolean] | undefined {
  // use InterpErrorKind::*;
  // use UndefinedBehaviorInfo::*;

  const labels: string[] = [];

  let title: string | undefined;
  let helps: [Span | undefined, string][];
  const kind = res.kind();
  if (kind.$ === "MachineStop") {
    const info = TerminationInfoStop.downcast_ref(kind._0);
    if (info === undefined) return bug("invalid MachineStop payload");
    // use TerminationInfo::*;
    switch (info.$) {
      case "Exit": {
        const { code, leak_check } = info;
        return [code, leak_check];
      }
      case "Abort":
        title = "abnormal termination";
        break;
      case "Interrupted":
        title = undefined;
        break;
      case "UnsupportedInIsolation":
      case "Int2PtrWithStrictProvenance":
      case "UnsupportedForeignItem":
        title = "unsupported operation";
        break;
      case "StackedBorrowsUb":
      case "TreeBorrowsUb":
      case "DataRace":
        title = "Undefined Behavior";
        break;
      case "GenmcMoot": {
        // `assert!(ecx.machine.data_race.as_genmc_ref().is_some())`
        // PORT: `GlobalDataRaceHandler::as_genmc_ref` (lane miri-race, not declared) is `Some` exactly for `Genmc`.
        assert(ecx.machine.data_race.$ === "Genmc", "assertion failed: ecx.machine.data_race.as_genmc_ref().is_some()");
        return [0, false];
      }
      case "LocalDeadlock": {
        labels.push(`thread got stuck here`);
        title = undefined;
        break;
      }
      case "GlobalDeadlock": {
        // Global deadlocks are reported differently: just show all blocked threads.
        // The "active" thread might actually be terminated, so we ignore it.
        let any_pruned = false;
        for (const [thread, stack] of ecx.machine.threads.all_blocked_stacks()) {
          const stacktrace0 = Frame.generate_stacktrace_from_stack(stack as unknown as readonly Frame[], ecx.tcx.deref());
          const [stacktrace, was_pruned] = prune_stacktrace(stacktrace0, ecx.machine);
          any_pruned ||= was_pruned;
          report_msg("Error", `the evaluated program deadlocked`, [`thread got stuck here`], [], [], stacktrace, thread, ecx.machine);
        }
        if (any_pruned) {
          ecx.tcx.deref().dcx().note("some details are omitted, run with `MIRIFLAGS=-Zmiri-backtrace=full` for a verbose backtrace");
        }
        return undefined;
      }
      case "MultipleSymbolDefinitions":
      case "SymbolShimClashing":
        title = undefined;
        break;
    }
    // #[rustfmt::skip]
    switch (info.$) {
      case "UnsupportedInIsolation":
        helps = [
          note("set `MIRIFLAGS=-Zmiri-disable-isolation` to disable isolation;"),
          note("or set `MIRIFLAGS=-Zmiri-isolation-error=warn` to make Miri return an error code from isolated operations (if supported for that operation) and continue with a warning"),
        ];
        break;
      case "UnsupportedForeignItem": {
        helps = [
          note("this means the program tried to do something Miri does not support; it does not indicate a bug in the program"),
        ];
        break;
      }
      case "StackedBorrowsUb": {
        const { help, history } = info;
        labels.push(...help);
        const helps_: [Span | undefined, string][] = [
          note("this indicates a potential bug in the program: it performed an invalid operation, but the Stacked Borrows rules it violated are still experimental"),
          note("see https://github.com/rust-lang/unsafe-code-guidelines/blob/master/wip/stacked-borrows.md for further information"),
        ];
        if (history !== undefined) {
          const { created, invalidated, protected: protected_ } = history;
          helps_.push([created[1], created[0]]);
          if (invalidated !== undefined) {
            const [msg, span] = invalidated;
            helps_.push(note_span(span, `${msg}`));
          }
          if (protected_ !== undefined) {
            const [protector_msg, protector_span] = protected_;
            helps_.push(note_span(protector_span, `${protector_msg}`));
          }
        }
        helps = helps_;
        break;
      }
      case "TreeBorrowsUb": {
        const { details, history } = info;
        const helps_: [Span | undefined, string][] = [
          note("this indicates a potential bug in the program: it performed an invalid operation, but the Tree Borrows rules it violated are still experimental"),
          note("see https://github.com/rust-lang/unsafe-code-guidelines/blob/master/wip/tree-borrows.md for further information"),
        ];
        for (const m of details) {
          helps_.push(note(`${m}`));
        }
        for (const event of history.events) {
          helps_.push([event[0], event[1]]);
        }
        helps = helps_;
        break;
      }
      case "MultipleSymbolDefinitions": {
        const { first, first_crate, second, second_crate } = info;
        helps = [
          note_span(first, `it's first defined here, in crate \`${Symbol.as_str(first_crate)}\``),
          note_span(second, `then it's defined here again, in crate \`${Symbol.as_str(second_crate)}\``),
        ];
        break;
      }
      case "SymbolShimClashing": {
        const { link_name, span } = info;
        helps = [note_span(span, `the \`${Symbol.as_str(link_name)}\` symbol is defined here`)];
        break;
      }
      case "Int2PtrWithStrictProvenance":
        helps = [note("use Strict Provenance APIs (https://doc.rust-lang.org/nightly/std/ptr/index.html#strict-provenance, https://crates.io/crates/sptr) instead")];
        break;
      case "DataRace": {
        const { op1, extra, retag_explain } = info;
        labels.push(`(2) just happened here`);
        const helps_: [Span | undefined, string][] = [note_span(op1.span, "and (1) occurred earlier here")];
        if (extra !== undefined) {
          helps_.push(note(`${extra}`));
          helps_.push(note("see https://doc.rust-lang.org/nightly/std/sync/atomic/index.html#memory-model-for-atomic-accesses for more information about the Rust memory model"));
        }
        if (retag_explain) {
          helps_.push(note("retags occur on all (re)borrows and as well as when references are copied or moved"));
          helps_.push(note("retags permit optimizations that insert speculative reads or writes"));
          helps_.push(note("therefore from the perspective of data races, a retag has the same implications as a read or write"));
        }
        helps_.push(note("this indicates a bug in the program: it performed an invalid operation, and caused Undefined Behavior"));
        helps_.push(note("see https://doc.rust-lang.org/nightly/reference/behavior-considered-undefined.html for further information"));
        helps = helps_;
        break;
      }
      default:
        helps = [];
    }
  } else {
    let title_: string;
    if (kind.$ === "UndefinedBehavior" && kind._0.$ === "ValidationError" && kind._0.ptr_bytes_warning) {
      ecx.handle_ice(); // print interpreter backtrace (this is outside the eval `catch_unwind`)
      return bug(`This validation error should be impossible in Miri: ${res.to_string()}`);
    } else if (kind.$ === "UndefinedBehavior") {
      title_ = "Undefined Behavior";
    } else if (kind.$ === "ResourceExhaustion") {
      title_ = "resource exhaustion";
    } else if (
      kind.$ === "Unsupported" &&
      // We list only the ones that can actually happen.
      (kind._0.$ === "Unsupported" || kind._0.$ === "UnsizedLocal" || kind._0.$ === "ExternTypeField")
    ) {
      title_ = "unsupported operation";
    } else if (
      kind.$ === "InvalidProgram" &&
      // We list only the ones that can actually happen.
      (kind._0.$ === "AlreadyReported" || kind._0.$ === "Layout")
    ) {
      title_ = "post-monomorphization error";
    } else {
      ecx.handle_ice(); // print interpreter backtrace (this is outside the eval `catch_unwind`)
      return bug(`This error should be impossible in Miri: ${res.to_string()}`);
    }
    // #[rustfmt::skip]
    if (kind.$ === "Unsupported") {
      helps = [
        note("this is likely not a bug in the program; it indicates that the program performed an operation that Miri does not support"),
      ];
    } else if (kind.$ === "ResourceExhaustion" && kind._0 === "AddressSpaceFull" && ecx.machine.data_race.$ === "Genmc") {
      // PORT: `ecx.machine.data_race.as_genmc_ref().is_some()` (see `GenmcMoot` above).
      helps = [note("in GenMC mode, the address space is limited to 4GB per thread, and addresses cannot be reused")];
    } else if (kind.$ === "UndefinedBehavior" && kind._0.$ === "AlignmentCheckFailed" && ecx.machine.check_alignment === "Symbolic") {
      helps = [
        note("this usually indicates that your program performed an invalid operation and caused Undefined Behavior"),
        note("but due to `-Zmiri-symbolic-alignment-check`, alignment errors can also be false positives"),
      ];
    } else if (kind.$ === "UndefinedBehavior") {
      const info = kind._0;
      const helps_: [Span | undefined, string][] = [
        note("this indicates a bug in the program: it performed an invalid operation, and caused Undefined Behavior"),
        note("see https://doc.rust-lang.org/nightly/reference/behavior-considered-undefined.html for further information"),
      ];
      if (info.$ === "PointerUseAfterFree" || info.$ === "PointerOutOfBounds") {
        const alloc_id = info.$ === "PointerUseAfterFree" ? info._0 : info.alloc_id;
        const span1 = ecx.machine.allocated_span(alloc_id);
        if (span1 !== undefined) {
          helps_.push(note_span(span1, `${display_AllocId(alloc_id)} was allocated here:`));
        }
        const span2 = ecx.machine.deallocated_span(alloc_id);
        if (span2 !== undefined) {
          helps_.push(note_span(span2, `${display_AllocId(alloc_id)} was deallocated here:`));
        }
      } else if (info.$ === "AbiMismatchArgument" || info.$ === "AbiMismatchReturn") {
        helps_.push(note("this means these two types are not *guaranteed* to be ABI-compatible across all targets"));
        helps_.push(note("if you think this code should be accepted anyway, please report an issue with Miri"));
      }
      helps = helps_;
    } else if (kind.$ === "InvalidProgram" && kind._0.$ === "AlreadyReported") {
      // This got already reported. No point in reporting it again.
      return undefined;
    } else {
      helps = [];
    }
    title = title_;
  }

  const stacktrace0 = ecx.generate_stacktrace();
  const [stacktrace, pruned] = prune_stacktrace(stacktrace0, ecx.machine);

  // We want to dump the allocation if this is `InvalidUninitBytes`.
  // Since `format_interp_error` consumes `e`, we compute the outut early.
  let extra = "";
  if (kind.$ === "UndefinedBehavior" && kind._0.$ === "InvalidUninitBytes" && kind._0._0 !== undefined) {
    const [alloc_id, access] = kind._0._0;
    extra += `Uninitialized memory occurred at ${display_AllocId(alloc_id)}${display_AllocRange(access.bad)}, in this allocation:\n`;
    extra += `${debug_DumpAllocs(ecx.dump_alloc(alloc_id), PLAIN)}\n`;
  }

  let primary_msg = "";
  if (title !== undefined) {
    primary_msg += `${title}: `;
  }
  primary_msg += `${res.to_string()}`;

  if (labels.length === 0) {
    labels.push(`${title ?? "error"} occurred ${stacktrace.length === 0 ? "due to this code" : "here"}`);
  }

  report_msg("Error", primary_msg, labels, [], helps, stacktrace, ecx.active_thread(), ecx.machine);

  process.stderr.write(`${extra}`); // newlines are already in the string

  // Include a note like `std` does when we omit frames from a backtrace
  if (pruned) {
    ecx.tcx.deref().dcx().note("some details are omitted, run with `MIRIFLAGS=-Zmiri-backtrace=full` for a verbose backtrace");
  }

  // Debug-dump all locals.
  // for (i, frame) in ecx.active_thread_stack().iter().enumerate() {
  //     trace!("-------------------");
  //     trace!("Frame {}", i);
  //     trace!("    return: {:?}", frame.return_place());
  //     for (i, local) in frame.locals().iter().enumerate() {
  //         trace!("    local {}: {:?}", i, local);
  //     }
  // }

  return undefined;
}

// rustc: src/tools/miri/src/diagnostics.rs:511 report_leaks
export function report_leaks(ecx: MiriInterpCx, leaks: [AllocId, MemoryKind, Allocation<Provenance, AllocExtra, MiriAllocBytes>][]): void {
  let any_pruned = false;
  for (const [id, kind, alloc] of leaks) {
    let title = `memory leaked: ${debug_AllocId(id, PLAIN)} (${display_MemoryKind(kind, PLAIN, display_MiriMemoryKind)}, size: ${alloc.size().bytes()}, align: ${alloc.align.bytes()})`;
    const backtrace0 = alloc.extra.backtrace;
    if (backtrace0 === undefined) {
      ecx.tcx.deref().dcx().err(title);
      continue;
    }
    title += ", allocated here:";
    const [backtrace, pruned] = prune_stacktrace(backtrace0, ecx.machine);
    any_pruned ||= pruned;
    report_msg(
      "Error",
      title,
      [],
      [],
      [],
      backtrace,
      undefined, // we don't know the thread this is from
      ecx.machine,
    );
  }
  if (any_pruned) {
    ecx.tcx.deref().dcx().note("some details are omitted, run with `MIRIFLAGS=-Zmiri-backtrace=full` for a verbose backtrace");
  }
}

/// Report an error or note (depending on the `error` argument) with the given stacktrace.
/// Also emits a full stacktrace of the interpreter stack.
/// We want to present a multi-line span message for some errors. Diagnostics do not support this
/// directly, so we pass the lines as a `Vec<String>` and display each line after the first with an
/// additional `span_label` or `note` call.
// rustc: src/tools/miri/src/diagnostics.rs:553 report_msg
function report_msg(
  diag_level: DiagLevel,
  title: string,
  span_msg: string[],
  notes: [Span | undefined, string][],
  helps: [Span | undefined, string][],
  stacktrace: readonly FrameInfo[],
  thread: ThreadId | undefined,
  machine: MiriMachine,
): void {
  const origin_span = thread !== undefined ? machine.threads.thread_ref(thread).origin_span : DUMMY_SP;
  const span = stacktrace.length > 0 ? stacktrace[0]!.span : origin_span;
  // The only time we do not have an origin span is for `main`, and there we check the signature
  // upfront. So we should always have a span here.
  assert(!Span.is_dummy(span), "assertion failed: !span.is_dummy()");

  const tcx = machine.tcx;
  let level: Level;
  switch (diag_level) {
    case "Error":
      level = { $: "Error" };
      break;
    case "Warning":
      level = { $: "Warning", _0: undefined };
      break;
    case "Note":
      level = { $: "Note" };
      break;
  }
  const err = Diag.new(tcx.sess.dcx(), level, title);
  err.span(span);

  // Show main message.
  for (const line of span_msg) {
    err.span_label(span, line);
  }

  // Show note and help messages.
  for (const [span, note] of notes) {
    if (span !== undefined) {
      err.span_note(span, note);
    } else {
      err.note(note);
    }
  }
  for (const [span, help] of helps) {
    if (span !== undefined) {
      err.span_help(span, help);
    } else {
      err.help(help);
    }
  }
  // Only print thread name if there are multiple threads.
  if (thread !== undefined && machine.threads.get_total_thread_count() > 1) {
    err.note(`this is on thread \`${machine.threads.get_thread_display_name(thread)}\``);
  }

  // Add backtrace
  if (stacktrace.length > 0) {
    // Skip it if we'd only shpw the span we have already shown
    if (stacktrace.length > 1) {
      const sm = tcx.sess.source_map();
      let out = `stack backtrace:`;
      for (let idx = 0; idx < stacktrace.length; idx++) {
        const frame_info = stacktrace[idx]!;
        const span = sm.span_to_diagnostic_string(frame_info.span);
        out += `\n${idx}: ${display_Instance(frame_info.instance)}`;
        out += `\n    at ${span}`;
      }
      err.note(out);
    }
    // For TLS dtors and non-main threads, show the "origin"
    if (!Span.is_dummy(origin_span)) {
      const what = stacktrace.length > 1 ? "the last function in that backtrace" : "the current function";
      err.span_note(origin_span, `${what} got called indirectly due to this code`);
    }
  } else if (!Span.is_dummy(span)) {
    err.note(`this ${display_Level(level)} occurred while pushing a call frame onto an empty stack`);
    err.note("the span indicates which code caused the function to be called, but may not be the literal call site");
  }

  err.emit();
}

// impl<'tcx> MiriMachine<'tcx>
// rustc: src/tools/miri/src/diagnostics.rs:639 emit_diagnostic
MiriMachine.prototype.emit_diagnostic = function (this: MiriMachine, e: NonHaltingDiagnostic): void {
  // use NonHaltingDiagnostic::*;

  const stacktrace0 = Frame.generate_stacktrace_from_stack(this.threads.active_thread_stack() as unknown as readonly Frame[], this.tcx);
  const [stacktrace, _was_pruned] = prune_stacktrace(stacktrace0, this);

  let label: string;
  let diag_level: DiagLevel;
  switch (e.$) {
    case "RejectedIsolatedOp":
      [label, diag_level] = ["operation rejected by isolation", "Warning"];
      break;
    case "Int2Ptr":
      [label, diag_level] = ["integer-to-pointer cast", "Warning"];
      break;
    case "NativeCallSharedMem":
      [label, diag_level] = ["sharing memory with a native function", "Warning"];
      break;
    case "ExternTypeReborrow":
      [label, diag_level] = ["reborrow of reference to `extern type`", "Warning"];
      break;
    case "GenmcCompareExchangeWeak":
    case "GenmcCompareExchangeOrderingMismatch":
      [label, diag_level] = ["GenMC might miss possible behaviors of this code", "Warning"];
      break;
    case "CreatedPointerTag":
    case "PoppedPointerTag":
    case "TrackingAlloc":
    case "AccessedAlloc":
    case "FreedAlloc":
    case "ProgressReport":
    case "WeakMemoryOutdatedLoad":
      [label, diag_level] = ["tracking was triggered here", "Note"];
      break;
    case "FileInProcOpened":
      [label, diag_level] = ["open a file in `/proc`", "Warning"];
      break;
    case "ConnectingSocketGetsockname":
      [label, diag_level] = ["Called `getsockname` on connecting socket", "Warning"];
      break;
    case "SocketAddressResolution":
      [label, diag_level] = ["error during address resolution", "Warning"];
      break;
  }

  let title: string;
  switch (e.$) {
    case "CreatedPointerTag": {
      const tag = e._0;
      if (e._1 === undefined) {
        title = `created base tag ${tag}`;
      } else if (e._2 === undefined) {
        title = `created ${tag} with ${e._1} derived from unknown tag`;
      } else {
        const [alloc_id, range, orig_tag] = e._2;
        title = `created tag ${tag} with ${e._1} at ${display_AllocId(alloc_id)}${display_AllocRange(range)} derived from ${debug_ProvenanceExtra(orig_tag, PLAIN)}`;
      }
      break;
    }
    case "PoppedPointerTag": {
      const [item, cause] = [e._0, e._1];
      title = `popped tracked tag for item ${debug_Item(item, PLAIN)}${cause}`;
      break;
    }
    case "TrackingAlloc": {
      const [id, size, align] = [e._0, e._1, e._2];
      title = `now tracking allocation ${display_AllocId(id)} of ${size.bytes()} bytes (alignment ${align.bytes()} bytes)`;
      break;
    }
    case "AccessedAlloc": {
      const [id, range, access_kind] = [e._0, e._1, e._2];
      title = `${display_AccessKind(access_kind)} at ${display_AllocId(id)}${display_AllocRange(range)}`;
      break;
    }
    case "FreedAlloc":
      title = `freed allocation ${debug_AllocId(e._0, PLAIN)}`;
      break;
    case "RejectedIsolatedOp":
      title = `${e._0} was made to return an error due to isolation`;
      break;
    case "ProgressReport":
      title = `progress report: current operation being executed is here`;
      break;
    case "Int2Ptr":
      title = `integer-to-pointer cast`;
      break;
    case "NativeCallSharedMem":
      title = `sharing memory with a native function called via FFI`;
      break;
    case "WeakMemoryOutdatedLoad": {
      const ptr: Pointer = e.ptr;
      title = `weak memory emulation: outdated value returned from load at ${display_Pointer_Option(ptr, PLAIN)}`;
      break;
    }
    case "ExternTypeReborrow":
      title = `reborrow of a reference to \`extern type\` is not properly supported`;
      break;
    case "GenmcCompareExchangeWeak":
      title =
        "GenMC currently does not model spurious failures of `compare_exchange_weak`. Miri with GenMC might miss bugs related to spurious failures.";
      break;
    case "GenmcCompareExchangeOrderingMismatch": {
      const { success_ordering, upgraded_success_ordering, failure_ordering, effective_failure_ordering } = e;
      let was_upgraded_msg: string;
      if (success_ordering !== upgraded_success_ordering) {
        was_upgraded_msg = `Success ordering '${success_ordering}' was upgraded to '${upgraded_success_ordering}' to match failure ordering '${failure_ordering}'`;
      } else {
        // assert_ne!(failure_ordering, effective_failure_ordering);
        if (failure_ordering === effective_failure_ordering) {
          return bug(`assertion \`left != right\` failed\n  left: ${failure_ordering}\n right: ${effective_failure_ordering}`);
        }
        was_upgraded_msg = `Due to success ordering '${success_ordering}', the failure ordering '${failure_ordering}' is treated like '${effective_failure_ordering}'`;
      }
      title = `GenMC currently does not model the failure ordering for \`compare_exchange\`. ${was_upgraded_msg}. Miri with GenMC might miss bugs related to this memory access.`;
      break;
    }
    case "FileInProcOpened":
      title = `files in \`/proc\` can bypass the Abstract Machine and might not work properly in Miri`;
      break;
    case "ConnectingSocketGetsockname":
      title = `connecting sockets return unspecified socket addresses on Windows hosts`;
      break;
    case "SocketAddressResolution":
      title = `address resolution failed: ${display_IoError(e.error)}`;
      break;
  }

  let notes: [Span | undefined, string][];
  switch (e.$) {
    case "ProgressReport": {
      const { block_count } = e;
      notes = [note(`so far, ${block_count} basic blocks have been executed`)];
      break;
    }
    case "ConnectingSocketGetsockname":
      notes = [
        note(
          "Windows hosts do not provide `local_addr` information while the socket is still connecting, which might break the assumptions of code compiled for Unix targets",
        ),
        note("an unspecified socket address (e.g. `0.0.0.0:0`) will be returned instead"),
      ];
      break;
    case "SocketAddressResolution":
      notes = [note("Miri cannot return proper error information from this call; only a generic error code is being returned")];
      break;
    default:
      notes = [];
  }

  let helps: [Span | undefined, string][];
  if (e.$ === "Int2Ptr" && e.details) {
    const v: [Span | undefined, string][] = [
      note(
        "this program is using integer-to-pointer casts or (equivalently) `ptr::with_exposed_provenance`, which means that Miri might miss pointer bugs in this program",
      ),
      note("see https://doc.rust-lang.org/nightly/std/ptr/fn.with_exposed_provenance.html for more details on that operation"),
      note(
        "to ensure that Miri does not miss bugs in your program, use Strict Provenance APIs (https://doc.rust-lang.org/nightly/std/ptr/index.html#strict-provenance, https://crates.io/crates/sptr) instead",
      ),
      note("you can then set `MIRIFLAGS=-Zmiri-strict-provenance` to ensure you are not relying on `with_exposed_provenance` semantics"),
    ];
    const b = this.borrow_tracker;
    if (b !== undefined && b.borrow_tracker_method_().$ === "TreeBorrows") {
      v.push(note("Tree Borrows does not support integer-to-pointer casts, so the program is likely to go wrong when this pointer gets used"));
    } else {
      v.push(note("alternatively, `MIRIFLAGS=-Zmiri-permissive-provenance` disables this warning"));
    }
    helps = v;
  } else if (e.$ === "NativeCallSharedMem") {
    const { tracing } = e;
    if (tracing) {
      helps = [
        note("when memory is shared with a native function call, Miri can only track initialisation and provenance on a best-effort basis"),
        note("in particular, Miri assumes that the native call initializes all memory it has written to"),
        note("Miri also assumes that any part of this memory may be a pointer that is permitted to point to arbitrary exposed memory"),
        note(
          "what this means is that Miri will easily miss Undefined Behavior related to incorrect usage of this shared memory, so you should not take a clean Miri run as a signal that your FFI code is UB-free",
        ),
        note("tracing memory accesses in native code is not yet fully implemented, so there can be further imprecisions beyond what is documented here"),
      ];
    } else {
      helps = [
        note("when memory is shared with a native function call, Miri stops tracking initialization and provenance for that memory"),
        note("in particular, Miri assumes that the native call initializes all memory it has access to"),
        note("Miri also assumes that any part of this memory may be a pointer that is permitted to point to arbitrary exposed memory"),
        note(
          "what this means is that Miri will easily miss Undefined Behavior related to incorrect usage of this shared memory, so you should not take a clean Miri run as a signal that your FFI code is UB-free",
        ),
      ];
    }
  } else if (e.$ === "ExternTypeReborrow") {
    const b = this.borrow_tracker;
    assert(
      b !== undefined && b.borrow_tracker_method_().$ === "StackedBorrows",
      "assertion failed: self.borrow_tracker.as_ref().is_some_and(|b|\n        {\n            matches!(b.borrow().borrow_tracker_method(),\n                BorrowTrackerMethod::StackedBorrows)\n        })",
    );
    helps = [
      note("`extern type` are not compatible with the Stacked Borrows aliasing model implemented by Miri; Miri may miss bugs in this code"),
      note(
        "try running with `MIRIFLAGS=-Zmiri-tree-borrows` to use the more permissive but also even more experimental Tree Borrows aliasing checks instead",
      ),
    ];
  } else {
    helps = [];
  }

  report_msg(diag_level, title, [label], notes, helps, stacktrace, this.threads.active_thread_(), this);
};

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// rustc: src/tools/miri/src/diagnostics.rs:842 emit_diagnostic
InterpCx.prototype.emit_diagnostic = function (this: MiriInterpCx, e: NonHaltingDiagnostic): void {
  const this_ = this.eval_context_ref();
  this_.machine.emit_diagnostic(e);
};

/// We had a panic in Miri itself, try to print something useful.
// rustc: src/tools/miri/src/diagnostics.rs:848 handle_ice
InterpCx.prototype.handle_ice = function (this: MiriInterpCx): void {
  process.stderr.write("\n");
  process.stderr.write("Miri caused an ICE during evaluation. Here's the interpreter backtrace at the time of the panic:\n");
  const this_ = this.eval_context_ref();
  const stacktrace = this_.generate_stacktrace();
  report_msg("Note", "the place in the program where the ICE was triggered", [], [], [], stacktrace, this_.active_thread(), this_.machine);
};

/// Call `f` only if this is the first time we are seeing this span.
/// The `first` parameter indicates whether this is the first time *ever* that this diagnostic
/// is emitted.
// rustc: src/tools/miri/src/diagnostics.rs:870 dedup_diagnostic
InterpCx.prototype.dedup_diagnostic = function (this: MiriInterpCx, dedup: SpanDedupDiagnostic, f: (first: boolean) => NonHaltingDiagnostic): void {
  const this_ = this.eval_context_ref();
  // We want to deduplicate both based on where the error seems to be located "from the user
  // perspective", and the location of the actual operation (to avoid warning about the same
  // operation called from different places in the local code).
  const span1 = this_.machine.current_user_relevant_span();
  // For the "location of the operation", we still skip `track_caller` frames, to match the
  // span that the diagnostic will point at.
  const stack = this_.active_thread_stack();
  let span2 = span1;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (!InstanceKind.requires_caller_location(frame.instance_().def, this_.tcx.deref())) {
      span2 = frame.current_span();
      break;
    }
  }

  const lock = dedup._0;
  const first = lock.size === 0;
  // Avoid mutating the hashset unless both spans are new.
  // `lock.insert(span1)` / `lock.insert(span2)`: `true` if the span was not yet in the set.
  const insert = (s: Span): boolean => {
    if (lock.has(s)) return false;
    lock.add(s);
    return true;
  };
  if (!lock.has(span2) && insert(span1) && (span1 === span2 || insert(span2))) {
    // Both of the two spans were newly inserted.
    this_.emit_diagnostic(f(first));
  }
};

// rustc: src/tools/miri/src/diagnostics.rs:904 new
SpanDedupDiagnostic.new = function (): SpanDedupDiagnostic {
  return new SpanDedupDiagnostic(new Set());
};
