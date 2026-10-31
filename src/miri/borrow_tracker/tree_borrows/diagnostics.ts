// Port of src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-b` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type BorTag, type ProtectorKind } from "../mod.ts";
import { DiagnosticInfo, DisplayFmt, DisplayIndent, DisplayRepr, type Event, History, HistoryData, NodeDebugInfo, type S, TbError, type TransitionError } from "./diagnostics.gen.ts";
import { type PermTransition, type Permission } from "./perms.ts";
import { type LocationState, Tree } from "./tree.ts";
import { type UniIndex } from "./unimap.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type InterpErrorKind, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { unported } from "../../../std/panic.ts";
export * from "./diagnostics.gen.ts";

declare module "./diagnostics.gen.ts" {
  interface DiagnosticInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:95
    create_event(transition: PermTransition, is_foreign: boolean): Event;
  }
}
declare module "./diagnostics.gen.ts" {
  interface History {
    // borrow_tracker/tree_borrows/diagnostics.rs:125
    push(event: Event): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:279
    forget(): History;
    // borrow_tracker/tree_borrows/diagnostics.rs:285
    extract_relevant(error_offset: bigint, error_kind: TransitionError): History;
  }
}
declare module "./diagnostics.gen.ts" {
  interface HistoryData {
    // borrow_tracker/tree_borrows/diagnostics.rs:132
    extend(new_history: History, tag_name: string, show_initial_state: boolean): void;
  }
}
declare module "./diagnostics.gen.ts" {
  interface NodeDebugInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:202
    add_name(name: string): void;
  }
  namespace NodeDebugInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:195
    function new_(tag: BorTag, initial: Permission, span: Span): NodeDebugInfo;
    export { new_ as new };
  }
}
declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/diagnostics.rs:227
    nth_parent(tag: BorTag, nth_parent: number): BorTag | undefined;
    // borrow_tracker/tree_borrows/diagnostics.rs:237
    give_pointer_debug_name(tag: BorTag, nth_parent: number, name: string): InterpResult;
    // borrow_tracker/tree_borrows/diagnostics.rs:254
    is_allocation_of(tag: BorTag): boolean;
    // borrow_tracker/tree_borrows/diagnostics.rs:876
    print_tree(protected_tags: Map<BorTag, ProtectorKind>, show_unnamed: boolean): InterpResult;
  }
}
declare module "./diagnostics.gen.ts" {
  interface TbError {
    // borrow_tracker/tree_borrows/diagnostics.rs:319
    build(): InterpErrorKind;
  }
}
declare module "./diagnostics.gen.ts" {
  interface DisplayFmt {
    // borrow_tracker/tree_borrows/diagnostics.rs:549
    print_perm(perm: LocationState | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:563
    print_tag(tag: BorTag, name: string | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:573
    print_protector(protector: ProtectorKind | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:585
    print_exposed(exposed: boolean): S;
  }
}
declare module "./diagnostics.gen.ts" {
  interface DisplayIndent {
    // borrow_tracker/tree_borrows/diagnostics.rs:602
    increment(formatter: DisplayFmt, is_last: boolean): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:611
    decrement(formatter: DisplayFmt): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:618
    write(s: string): void;
  }
  namespace DisplayIndent {
    // borrow_tracker/tree_borrows/diagnostics.rs:595
    function new_(): DisplayIndent;
    export { new_ as new };
  }
}
declare module "./diagnostics.gen.ts" {
  namespace DisplayRepr {
    // borrow_tracker/tree_borrows/diagnostics.rs:640
    export let from: (tree: Tree, root: UniIndex, show_unnamed: boolean) => DisplayRepr | undefined;
    // borrow_tracker/tree_borrows/diagnostics.rs:691
    export let print: (main_root: DisplayRepr | undefined, wildcard_subtrees: readonly DisplayRepr[], fmt: DisplayFmt, indenter: DisplayIndent, protected_tags: Map<BorTag, ProtectorKind>, ranges: Pending<"Range<u64>">[], print_warning: boolean) => void;
  }
}

// borrow_tracker/tree_borrows/diagnostics.rs:398 (pub)
export function no_valid_exposed_references_error(..._args: never[]): never {  // signature not translated
  return unported("miri::borrow_tracker::tree_borrows::diagnostics::no_valid_exposed_references_error (src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:398; lane miri-tb-b)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for AccessCause (borrow_tracker/tree_borrows/diagnostics.rs:23): fmt (:24)
// impl AccessCause (borrow_tracker/tree_borrows/diagnostics.rs:38) [AccessCause is not a generated class: companion fns / hand type, lane decides]: print_as_access (:39)
// impl fmt::Display for NodeDebugInfo (borrow_tracker/tree_borrows/diagnostics.rs:212): fmt (:213)
// fn char_repeat (borrow_tracker/tree_borrows/diagnostics.rs:624)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::DiagnosticInfo", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => DiagnosticInfo.prototype, ["create_event"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::History", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => History.prototype, ["push", "forget", "extract_relevant"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::HistoryData", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => HistoryData.prototype, ["extend"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::NodeDebugInfo", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => NodeDebugInfo.prototype, ["add_name"]);
stub_statics("miri::borrow_tracker::tree_borrows::diagnostics::NodeDebugInfo", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => NodeDebugInfo, ["new"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => Tree.prototype, ["nth_parent", "give_pointer_debug_name", "is_allocation_of", "print_tree"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::TbError", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => TbError.prototype, ["build"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::DisplayFmt", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => DisplayFmt.prototype, ["print_perm", "print_tag", "print_protector", "print_exposed"]);
stub_methods("miri::borrow_tracker::tree_borrows::diagnostics::DisplayIndent", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => DisplayIndent.prototype, ["increment", "decrement", "write"]);
stub_statics("miri::borrow_tracker::tree_borrows::diagnostics::DisplayIndent", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => DisplayIndent, ["new"]);
stub_statics("miri::borrow_tracker::tree_borrows::diagnostics::DisplayRepr", "src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs", "miri-tb-b", () => DisplayRepr, ["from", "print"]);
