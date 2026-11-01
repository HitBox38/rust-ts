// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-sb` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type BorTag, type GlobalStateInner, type ProtectorKind } from "../mod.ts";
import { AllocHistory, Creation, DiagnosticCx, DiagnosticCxBuilder, Invalidation, RetagInfo, type TagHistory } from "./diagnostics.gen.ts";
import { type Item } from "./item.ts";
import { type Stack } from "./stack.ts";
import { type MiriMachine, type ProvenanceExtra } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Size } from "../../../rustc_abi/lib.ts";
import { type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpErrorKind } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
export * from "./diagnostics.gen.ts";

declare module "./diagnostics.gen.ts" {
  interface Creation {
    // borrow_tracker/stacked_borrows/diagnostics.rs:36
    generate_diagnostic(): [string, Span];
  }
}
declare module "./diagnostics.gen.ts" {
  interface Invalidation {
    // borrow_tracker/stacked_borrows/diagnostics.rs:71
    generate_diagnostic(): [string, Span];
  }
}
declare module "./diagnostics.gen.ts" {
  interface DiagnosticCxBuilder {
    // borrow_tracker/stacked_borrows/diagnostics.rs:128
    build(history: AllocHistory, offset: Size): DiagnosticCx;
  }
  namespace DiagnosticCxBuilder {
    // borrow_tracker/stacked_borrows/diagnostics.rs:136
    export let retag: (machine: MiriMachine, info: RetagInfo, new_tag: BorTag, orig_tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:149
    export let read: (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:154
    export let write: (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:163
    export let dealloc: (machine: MiriMachine, tag: ProvenanceExtra) => DiagnosticCxBuilder;
  }
}
declare module "./diagnostics.gen.ts" {
  interface DiagnosticCx {
    // borrow_tracker/stacked_borrows/diagnostics.rs:170
    unbuild(): DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:235
    start_grant(perm: Pending<"Permission">): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:262
    log_creation(): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:271
    log_invalidation(tag: BorTag): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:291
    log_protector(): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:300
    get_logs_relevant_to(tag: BorTag, protector_tag: BorTag | undefined): TagHistory | undefined;
    // borrow_tracker/stacked_borrows/diagnostics.rs:375
    grant_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:398
    access_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:420
    protector_error(item: Item, kind: ProtectorKind): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:445
    dealloc_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:462
    check_tracked_tag_popped(item: Item, global: GlobalStateInner): void;
  }
}
declare module "./diagnostics.gen.ts" {
  interface AllocHistory {
    // borrow_tracker/stacked_borrows/diagnostics.rs:227
    retain(live_tags: Set<BorTag>): void;
  }
  namespace AllocHistory {
    // borrow_tracker/stacked_borrows/diagnostics.rs:217
    function new_(id: AllocId, item: Item, machine: MiriMachine): AllocHistory;
    export { new_ as new };
  }
}
declare module "./diagnostics.gen.ts" {
  interface RetagInfo {
    // borrow_tracker/stacked_borrows/diagnostics.rs:503
    summary(): string;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for InvalidationCause (borrow_tracker/stacked_borrows/diagnostics.rs:92): fmt (:93)
// fn err_sb_ub (borrow_tracker/stacked_borrows/diagnostics.rs:12)
// fn operation_summary (borrow_tracker/stacked_borrows/diagnostics.rs:483)
// fn error_cause (borrow_tracker/stacked_borrows/diagnostics.rs:487)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::Creation", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => Creation.prototype, ["generate_diagnostic"]);
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::Invalidation", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => Invalidation.prototype, ["generate_diagnostic"]);
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::DiagnosticCxBuilder", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => DiagnosticCxBuilder.prototype, ["build"]);
stub_statics("miri::borrow_tracker::stacked_borrows::diagnostics::DiagnosticCxBuilder", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => DiagnosticCxBuilder, ["retag", "read", "write", "dealloc"]);
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::DiagnosticCx", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => DiagnosticCx.prototype, ["unbuild", "start_grant", "log_creation", "log_invalidation", "log_protector", "get_logs_relevant_to", "grant_error", "access_error", "protector_error", "dealloc_error", "check_tracked_tag_popped"]);
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::AllocHistory", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => AllocHistory.prototype, ["retain"]);
stub_statics("miri::borrow_tracker::stacked_borrows::diagnostics::AllocHistory", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => AllocHistory, ["new"]);
stub_methods("miri::borrow_tracker::stacked_borrows::diagnostics::RetagInfo", "src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs", "miri-sb", () => RetagInfo.prototype, ["summary"]);
