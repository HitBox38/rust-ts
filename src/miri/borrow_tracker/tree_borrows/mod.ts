// Port of src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind, type BorTag, type GlobalState, type GlobalStateInner, type TreeBorrowsParams } from "../mod.ts";
import { NewPermission } from "./mod.gen.ts";
import { Tree } from "./tree.ts";
import { type ImmTy, type MPlaceTy, type Pointer } from "../../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance, type ProvenanceExtra } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Size } from "../../../rustc_abi/lib.ts";
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../../rustc_const_eval/interpret/machine.gen.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
export * from "./mod.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- borrow_tracker/tree_borrows/mod.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // borrow_tracker/tree_borrows/mod.rs:231
    get_tree_borrows_params(this: MiriInterpCx): TreeBorrowsParams;
    // borrow_tracker/tree_borrows/mod.rs:238
    tb_reborrow(this: MiriInterpCx, place: MPlaceTy, ptr_size: Size, new_perm: NewPermission, new_tag: BorTag): InterpResult<Provenance | undefined>;
    // borrow_tracker/tree_borrows/mod.rs:436
    tb_retag_place(this: MiriInterpCx, place: MPlaceTy, new_perm: NewPermission): InterpResult<MPlaceTy>;
    // ---- borrow_tracker/tree_borrows/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // borrow_tracker/tree_borrows/mod.rs:474
    tb_retag_ptr_value(this: MiriInterpCx, val: ImmTy, ty: Ty, mode: RetagMode): InterpResult<ImmTy | undefined>;
    // borrow_tracker/tree_borrows/mod.rs:513
    tb_protect_place(this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy>;
    // borrow_tracker/tree_borrows/mod.rs:531
    tb_expose_tag(this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult;
    // borrow_tracker/tree_borrows/mod.rs:563
    print_tree(this: MiriInterpCx, alloc_id: AllocId, show_unnamed: boolean): InterpResult;
    // borrow_tracker/tree_borrows/mod.rs:574
    tb_give_pointer_debug_name(this: MiriInterpCx, ptr: Pointer, nth_parent: number, name: string): InterpResult;
  }
}

declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/mod.rs:45
    before_memory_access(access_kind: AccessKind, alloc_id: AllocId, prov: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
    // borrow_tracker/tree_borrows/mod.rs:74
    before_memory_deallocation(alloc_id: AllocId, prov: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult;
    // borrow_tracker/tree_borrows/mod.rs:92
    release_protector(machine: MiriMachine, global: GlobalState, tag: BorTag, alloc_id: AllocId): InterpResult;
  }
  namespace Tree {
    // borrow_tracker/tree_borrows/mod.rs:31
    export let new_allocation: (id: AllocId, size: Size, state: GlobalStateInner, _kind: MemoryKind, machine: MiriMachine) => Tree;
  }
}
declare module "./mod.gen.ts" {
  namespace NewPermission {
    // borrow_tracker/tree_borrows/mod.rs:126
    function new_(pointee: Ty, ref_mutability: Mutability | undefined, mode: RetagMode, cx: MiriInterpCx): NewPermission | undefined;
    export { new_ as new };
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::EvalContextPrivExt", "src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs", "miri-tb-a", () => InterpCx.prototype, ["get_tree_borrows_params", "tb_reborrow", "tb_retag_place"]);
stub_methods("miri::borrow_tracker::tree_borrows::EvalContextExt", "src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs", "miri-tb-a", () => InterpCx.prototype, ["tb_retag_ptr_value", "tb_protect_place", "tb_expose_tag", "print_tree", "tb_give_pointer_debug_name"]);
stub_methods("miri::borrow_tracker::tree_borrows::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs", "miri-tb-a", () => Tree.prototype, ["before_memory_access", "before_memory_deallocation", "release_protector"]);
stub_statics("miri::borrow_tracker::tree_borrows::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs", "miri-tb-a", () => Tree, ["new_allocation"]);
stub_statics("miri::borrow_tracker::tree_borrows::NewPermission", "src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs", "miri-tb-a", () => NewPermission, ["new"]);
