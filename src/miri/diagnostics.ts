// Port of src/tools/miri/src/diagnostics.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ThreadId } from "./concurrency/thread.ts";
import { type DiagLevel, type NonHaltingDiagnostic, SpanDedupDiagnostic } from "./diagnostics.gen.ts";
import { type MemoryKind, type MiriInterpCx, MiriMachine } from "./machine.ts";
import { stub_methods, stub_statics } from "../rust_ts/miri_stub.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { type FrameInfo } from "../rustc_const_eval/interpret/stack.gen.ts";
import { type Allocation } from "../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpErrorInfo } from "../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
export * from "./diagnostics.gen.ts";

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- diagnostics.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // diagnostics.rs:842
    emit_diagnostic(this: MiriInterpCx, e: NonHaltingDiagnostic): void;
    // diagnostics.rs:848
    handle_ice(this: MiriInterpCx): void;
    // diagnostics.rs:870
    dedup_diagnostic(this: MiriInterpCx, dedup: SpanDedupDiagnostic, f: ((_0: boolean) => NonHaltingDiagnostic)): void;
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

// diagnostics.rs:183 (pub)
export function prune_stacktrace(stacktrace: FrameInfo[], machine: MiriMachine): [FrameInfo[], boolean] {
  return unported("miri::diagnostics::prune_stacktrace (src/tools/miri/src/diagnostics.rs:183; lane miri-driver)");
}
// diagnostics.rs:241 (pub)
export function report_result(ecx: MiriInterpCx, res: InterpErrorInfo): [number, boolean] | undefined {
  return unported("miri::diagnostics::report_result (src/tools/miri/src/diagnostics.rs:241; lane miri-driver)");
}
// diagnostics.rs:511 (pub)
export function report_leaks(ecx: MiriInterpCx, leaks: ([AllocId, MemoryKind, Allocation])[]): void {
  return unported("miri::diagnostics::report_leaks (src/tools/miri/src/diagnostics.rs:511; lane miri-driver)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for TerminationInfo (diagnostics.rs:70): fmt (:71)
// impl fmt::Debug for TerminationInfo (diagnostics.rs:107): fmt (:108)
// impl MachineStopType for TerminationInfo (diagnostics.rs:113): with_validation_path (:114)
// macro_rules! note (diagnostics.rs:172)
// macro_rules! note_span (diagnostics.rs:176)
// fn report_msg (diagnostics.rs:553)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::diagnostics::EvalContextExt", "src/tools/miri/src/diagnostics.rs", "miri-driver", () => InterpCx.prototype, ["emit_diagnostic", "handle_ice", "dedup_diagnostic"]);
stub_methods("miri::diagnostics::MiriMachine", "src/tools/miri/src/diagnostics.rs", "miri-driver", () => MiriMachine.prototype, ["emit_diagnostic"]);
stub_statics("miri::diagnostics::SpanDedupDiagnostic", "src/tools/miri/src/diagnostics.rs", "miri-driver", () => SpanDedupDiagnostic, ["new"]);
