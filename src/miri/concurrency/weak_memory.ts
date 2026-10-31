// Port of src/tools/miri/src/concurrency/weak_memory.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-sb` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into weak_memory.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AtomicReadOrd, type AtomicRwOrd, type AtomicWriteOrd, type ThreadClockSet } from "./data_race.ts";
import { type ThreadManager } from "./thread.ts";
import { type VClock, type VectorIdx } from "./vector_clock.ts";
import { type LoadRecency, StoreBuffer, StoreBufferAlloc, StoreElement } from "./weak_memory.gen.ts";
import { type MPlaceTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./weak_memory.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- concurrency/weak_memory.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/weak_memory.rs:497
    buffered_atomic_rmw(this: MiriInterpCx, new_val: Scalar, place: MPlaceTy, atomic: AtomicRwOrd, init: Scalar): InterpResult;
    // concurrency/weak_memory.rs:543
    buffered_atomic_read(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd, latest_in_mo: Scalar, validate: ((_0: VClock | undefined) => InterpResult)): InterpResult<Scalar | undefined>;
    // concurrency/weak_memory.rs:601
    buffered_atomic_write(this: MiriInterpCx, val: Scalar, dest: MPlaceTy, atomic: AtomicWriteOrd, init: Scalar | undefined): InterpResult;
    // concurrency/weak_memory.rs:646
    perform_read_on_buffered_latest(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd): InterpResult;
  }
}

declare module "./weak_memory.gen.ts" {
  interface StoreBufferAlloc {
    // concurrency/weak_memory.rs:189
    non_atomic_write(range: AllocRange, global: Pending<"DataRaceState">): void;
    // concurrency/weak_memory.rs:211
    get_store_buffer(range: AllocRange): InterpResult<Pending<"Ref<'_, StoreBuffer>"> | undefined>;
    // concurrency/weak_memory.rs:227
    get_or_create_store_buffer_mut(range: AllocRange, init: Scalar | undefined): InterpResult<StoreBuffer>;
  }
  namespace StoreBufferAlloc {
    // concurrency/weak_memory.rs:181
    export let new_allocation: () => StoreBufferAlloc;
  }
}
declare module "./weak_memory.gen.ts" {
  interface StoreBuffer {
    // concurrency/weak_memory.rs:281
    read_from_last_store(global: Pending<"DataRaceState">, thread_mgr: ThreadManager, is_seqcst: boolean): void;
    // concurrency/weak_memory.rs:294
    buffered_read(global: Pending<"DataRaceState">, thread_mgr: ThreadManager, is_seqcst: boolean, rng: Pending<"impl rand::Rng + ?Sized">, validate: ((_0: VClock | undefined) => InterpResult)): InterpResult<[Scalar | undefined, LoadRecency]>;
    // concurrency/weak_memory.rs:324
    buffered_write(val: Scalar, global: Pending<"DataRaceState">, thread_mgr: ThreadManager, is_seqcst: boolean, sync_clock: VClock): InterpResult;
    // concurrency/weak_memory.rs:339
    fetch_store<R>(is_seqcst: boolean, clocks: ThreadClockSet, rng: R): [StoreElement, LoadRecency];
    // concurrency/weak_memory.rs:422
    store_impl(val: Scalar, index: VectorIdx, thread_clock: VClock, is_seqcst: boolean, sync_clock: VClock): void;
  }
  namespace StoreBuffer {
    // concurrency/weak_memory.rs:263
    function new_(init: Scalar | undefined): StoreBuffer;
    export { new_ as new };
  }
}
declare module "./weak_memory.gen.ts" {
  interface StoreElement {
    // concurrency/weak_memory.rs:480
    load_impl(index: VectorIdx, clocks: ThreadClockSet, is_seqcst: boolean): Scalar | undefined;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for StoreBufferAlloc (concurrency/weak_memory.rs:120): visit_provenance (:121)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::weak_memory::EvalContextExt", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => InterpCx.prototype, ["buffered_atomic_rmw", "buffered_atomic_read", "buffered_atomic_write", "perform_read_on_buffered_latest"]);
stub_methods("miri::concurrency::weak_memory::StoreBufferAlloc", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => StoreBufferAlloc.prototype, ["non_atomic_write", "get_store_buffer", "get_or_create_store_buffer_mut"]);
stub_statics("miri::concurrency::weak_memory::StoreBufferAlloc", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => StoreBufferAlloc, ["new_allocation"]);
stub_methods("miri::concurrency::weak_memory::StoreBuffer", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => StoreBuffer.prototype, ["read_from_last_store", "buffered_read", "buffered_write", "fetch_store", "store_impl"]);
stub_statics("miri::concurrency::weak_memory::StoreBuffer", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => StoreBuffer, ["new"]);
stub_methods("miri::concurrency::weak_memory::StoreElement", "src/tools/miri/src/concurrency/weak_memory.rs", "miri-sb", () => StoreElement.prototype, ["load_impl"]);
