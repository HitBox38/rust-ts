// Port of src/tools/miri/src/alloc_addresses/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MiriAllocBytes, type MiriAllocParams } from "../alloc/alloc_bytes.ts";
import { GlobalStateInner } from "./mod.gen.ts";
import { type BorTag } from "../borrow_tracker/mod.ts";
import { type MiriConfig } from "../eval.ts";
import { type Pointer } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx, MiriMachine, type Provenance } from "../machine.ts";
import { type LiveAllocs } from "../provenance_gc.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AllocId, type InterpResult, type Pointer as interpret_Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { type CtfeProvenance } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./mod.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- alloc_addresses/mod.rs: `trait EvalContextExtPriv` (impl for `MiriInterpCx`) ----
    // alloc_addresses/mod.rs:108
    addr_from_alloc_id_uncached(this: MiriInterpCx, global_state: GlobalStateInner, alloc_id: AllocId, memory_kind: MemoryKind): InterpResult<bigint>;
    // ---- alloc_addresses/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // alloc_addresses/mod.rs:238
    alloc_id_from_addr(this: MiriInterpCx, addr: bigint, size: bigint): AllocId | undefined;
    // alloc_addresses/mod.rs:281
    addr_from_alloc_id(this: MiriInterpCx, alloc_id: AllocId, memory_kind: MemoryKind | undefined): InterpResult<bigint>;
    // alloc_addresses/mod.rs:328
    expose_provenance(this: MiriInterpCx, provenance: Provenance): InterpResult;
    // alloc_addresses/mod.rs:361
    ptr_from_addr_cast(this: MiriInterpCx, addr: bigint): InterpResult<Pointer>;
    // alloc_addresses/mod.rs:392
    adjust_alloc_root_pointer(this: MiriInterpCx, ptr: interpret_Pointer<CtfeProvenance>, tag: BorTag, kind: MemoryKind): InterpResult<interpret_Pointer<Provenance>>;
    // alloc_addresses/mod.rs:415
    get_global_alloc_bytes(this: MiriInterpCx, id: AllocId, bytes: Uint8Array, align: Align): InterpResult<MiriAllocBytes>;
    // alloc_addresses/mod.rs:452
    ptr_get_alloc(this: MiriInterpCx, ptr: interpret_Pointer<Provenance>, size: bigint): [AllocId, Size] | undefined;
    // alloc_addresses/mod.rs:478
    exposed_allocs(this: MiriInterpCx): AllocId[];
  }
}

declare module "./mod.gen.ts" {
  interface GlobalStateInner {
    // alloc_addresses/mod.rs:99
    remove_unreachable_allocs(allocs: LiveAllocs): void;
  }
  namespace GlobalStateInner {
    // alloc_addresses/mod.rs:82
    function new_(config: MiriConfig, stack_addr: bigint, tcx: TyCtxt): GlobalStateInner;
    export { new_ as new };
  }
}
declare module "../machine.gen.ts" {
  interface MiriMachine {
    // alloc_addresses/mod.rs:485
    free_alloc_id(dead_id: AllocId, size: Size, align: Align, kind: MemoryKind): void;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for GlobalStateInner (alloc_addresses/mod.rs:62): visit_provenance (:63)
// fn dummy_alloc (alloc_addresses/mod.rs:225)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::alloc_addresses::EvalContextExtPriv", "src/tools/miri/src/alloc_addresses/mod.rs", "miri-alloc", () => InterpCx.prototype, ["addr_from_alloc_id_uncached"]);
stub_methods("miri::alloc_addresses::EvalContextExt", "src/tools/miri/src/alloc_addresses/mod.rs", "miri-alloc", () => InterpCx.prototype, ["alloc_id_from_addr", "addr_from_alloc_id", "expose_provenance", "ptr_from_addr_cast", "adjust_alloc_root_pointer", "get_global_alloc_bytes", "ptr_get_alloc", "exposed_allocs"]);
stub_methods("miri::alloc_addresses::GlobalStateInner", "src/tools/miri/src/alloc_addresses/mod.rs", "miri-alloc", () => GlobalStateInner.prototype, ["remove_unreachable_allocs"]);
stub_statics("miri::alloc_addresses::GlobalStateInner", "src/tools/miri/src/alloc_addresses/mod.rs", "miri-alloc", () => GlobalStateInner, ["new"]);
stub_methods("miri::alloc_addresses::MiriMachine", "src/tools/miri/src/alloc_addresses/mod.rs", "miri-alloc", () => MiriMachine.prototype, ["free_alloc_id"]);
