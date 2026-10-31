// Port of src/tools/miri/src/alloc_addresses/reuse_pool.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into reuse_pool.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { ReusePool } from "./reuse_pool.gen.ts";
import { type ThreadId } from "../concurrency/thread.ts";
import { type VClock } from "../concurrency/vector_clock.ts";
import { type MiriConfig } from "../eval.ts";
import { type MemoryKind } from "../machine.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./reuse_pool.gen.ts";

declare module "./reuse_pool.gen.ts" {
  interface ReusePool {
    // alloc_addresses/reuse_pool.rs:43
    address_space_shortage(): void;
    // alloc_addresses/reuse_pool.rs:49
    subpool(align: Align): ([bigint, Size, ThreadId, VClock])[];
    // alloc_addresses/reuse_pool.rs:57
    add_addr(rng: Pending<"impl Rng">, addr: bigint, size: Size, align: Align, kind: MemoryKind, thread: ThreadId, clock: (() => VClock)): void;
    // alloc_addresses/reuse_pool.rs:90
    take_addr(rng: Pending<"impl Rng">, size: Size, align: Align, kind: MemoryKind, thread: ThreadId): [bigint, VClock | undefined] | undefined;
  }
  namespace ReusePool {
    // alloc_addresses/reuse_pool.rs:32
    function new_(config: MiriConfig): ReusePool;
    export { new_ as new };
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::alloc_addresses::reuse_pool::ReusePool", "src/tools/miri/src/alloc_addresses/reuse_pool.rs", "miri-alloc", () => ReusePool.prototype, ["address_space_shortage", "subpool", "add_addr", "take_addr"]);
stub_statics("miri::alloc_addresses::reuse_pool::ReusePool", "src/tools/miri/src/alloc_addresses/reuse_pool.rs", "miri-alloc", () => ReusePool, ["new"]);
