// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-sb` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind, type BorTag, type GlobalStateInner } from "../mod.ts";
import { type DiagnosticCx, type DiagnosticCxBuilder, type RetagInfo } from "./diagnostics.ts";
import { type Item } from "./item.ts";
import { type ItemInvalidationCause, type NewPermission, Stacks } from "./mod.gen.ts";
import { Stack } from "./stack.ts";
import { type ImmTy, type MPlaceTy } from "../../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance, type ProvenanceExtra } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../../rustc_const_eval/interpret/machine.gen.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
export * from "./mod.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- borrow_tracker/stacked_borrows/mod.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // borrow_tracker/stacked_borrows/mod.rs:594
    sb_reborrow(this: MiriInterpCx, place: MPlaceTy, size: Size, new_perm: NewPermission, new_tag: BorTag, retag_info: RetagInfo): InterpResult<Provenance | undefined>;
    // borrow_tracker/stacked_borrows/mod.rs:824
    sb_retag_place(this: MiriInterpCx, place: MPlaceTy, new_perm: NewPermission, info: RetagInfo): InterpResult<MPlaceTy>;
    // ---- borrow_tracker/stacked_borrows/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // borrow_tracker/stacked_borrows/mod.rs:858
    sb_retag_ptr_value(this: MiriInterpCx, val: ImmTy, ty: Ty, mode: RetagMode): InterpResult<ImmTy | undefined>;
    // borrow_tracker/stacked_borrows/mod.rs:892
    sb_protect_place(this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy>;
    // borrow_tracker/stacked_borrows/mod.rs:905
    sb_expose_tag(this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:932
    print_stacks(this: MiriInterpCx, alloc_id: AllocId): InterpResult;
  }
}

declare module "./stack.gen.ts" {
  interface Stack {
    // borrow_tracker/stacked_borrows/mod.rs:201
    find_first_write_incompatible(granting: number): number;
    // borrow_tracker/stacked_borrows/mod.rs:271
    access(access: AccessKind, tag: ProvenanceExtra, global: GlobalStateInner, dcx: DiagnosticCx, exposed_tags: Set<BorTag>): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:359
    dealloc(tag: ProvenanceExtra, global: GlobalStateInner, dcx: DiagnosticCx, exposed_tags: Set<BorTag>): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:382
    grant(derived_from: ProvenanceExtra, new_: Item, access: AccessKind | undefined, global: GlobalStateInner, dcx: DiagnosticCx, exposed_tags: Set<BorTag>): InterpResult;
  }
  namespace Stack {
    // borrow_tracker/stacked_borrows/mod.rs:228
    export let item_invalidated: (item: Item, global: GlobalStateInner, dcx: DiagnosticCx, cause: ItemInvalidationCause) => InterpResult;
  }
}
declare module "./mod.gen.ts" {
  interface Stacks {
    // borrow_tracker/stacked_borrows/mod.rs:447
    remove_unreachable_tags(live_tags: Set<BorTag>): void;
    // borrow_tracker/stacked_borrows/mod.rs:485
    for_each(range: AllocRange, dcx_builder: DiagnosticCxBuilder, f: ((_0: Stack, _1: DiagnosticCx, _2: Set<BorTag>) => InterpResult)): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:527
    before_memory_read(alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:551
    before_memory_write(alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:572
    before_memory_deallocation(alloc_id: AllocId, tag: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult;
  }
  namespace Stacks {
    // borrow_tracker/stacked_borrows/mod.rs:467
    function new_(size: Size, perm: Pending<"Permission">, tag: BorTag, id: AllocId, machine: MiriMachine): Stacks;
    export { new_ as new };
    // borrow_tracker/stacked_borrows/mod.rs:506
    export let new_allocation: (id: AllocId, size: Size, state: GlobalStateInner, kind: MemoryKind, machine: MiriMachine) => Stacks;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl NewPermission (borrow_tracker/stacked_borrows/mod.rs:59) [NewPermission is not a generated class: companion fns / hand type, lane decides]: from_ref_ty (:62), from_box_ty (:133), protector (:156)
// impl Permission (borrow_tracker/stacked_borrows/mod.rs:181) [Permission is not a generated class: companion fns / hand type, lane decides]: grants (:183)
// impl VisitProvenance for Stacks (borrow_tracker/stacked_borrows/mod.rs:455): visit_provenance (:456)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::stacked_borrows::EvalContextPrivExt", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => InterpCx.prototype, ["sb_reborrow", "sb_retag_place"]);
stub_methods("miri::borrow_tracker::stacked_borrows::EvalContextExt", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => InterpCx.prototype, ["sb_retag_ptr_value", "sb_protect_place", "sb_expose_tag", "print_stacks"]);
stub_methods("miri::borrow_tracker::stacked_borrows::Stack", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => Stack.prototype, ["find_first_write_incompatible", "access", "dealloc", "grant"]);
stub_statics("miri::borrow_tracker::stacked_borrows::Stack", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => Stack, ["item_invalidated"]);
stub_methods("miri::borrow_tracker::stacked_borrows::Stacks", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => Stacks.prototype, ["remove_unreachable_tags", "for_each", "before_memory_read", "before_memory_write", "before_memory_deallocation"]);
stub_statics("miri::borrow_tracker::stacked_borrows::Stacks", "src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs", "miri-sb", () => Stacks, ["new", "new_allocation"]);
