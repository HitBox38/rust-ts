//! This module is responsible for managing the absolute addresses that allocations are located at,
//! and for casting between pointers and integers based on those addresses.
// Port of src/tools/miri/src/alloc_addresses/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36).
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (lane miri-alloc):
// - Addresses are `u64` = `bigint` (decision C5). `RefCell` borrows are erased (`borrow()` / `borrow_mut()` / `drop`).
// - `MiriMachine.rng` is the vendored `StdRng` (lane vendor-rand; typemap, lane miri-machine), read through `machine_rng`.
// - Native-lib mode (`!machine.native_lib.is_empty()`) stops `unported` (decision C6: `-Zmiri-native-lib` is rejected
//   earlier, bin/miri.rs; the branches need host addresses of the bytes).
// - `GlobalDataRaceHandler::as_genmc_ref` / `as_vclocks_ref` (data_race_handler.rs:47 / :39) are lane miri-race's
//   companion fns.
import { GlobalDataRaceHandler } from "../concurrency/data_race_handler.ts";
import { AllocBytes_MiriAllocBytes, type MiriAllocBytes, type MiriAllocParams } from "../alloc/alloc_bytes.ts";
import { GlobalStateInner, ProvenanceMode } from "./mod.gen.ts";
import { AddressGenerator } from "./address_generator.ts";
import { ReusePool } from "./reuse_pool.ts";
import { type BorTag } from "../borrow_tracker/mod.ts";
import { clone_VClock, VClock } from "../concurrency/vector_clock.ts";
import { SpanDedupDiagnostic, TerminationInfo, TerminationInfo_into_machine_stop } from "../diagnostics.ts";
import { type MiriConfig } from "../eval.ts";
import { type Pointer } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx, MiriMachine, Provenance } from "../machine.ts";
import { type LiveAllocs, type VisitWith } from "../provenance_gc.ts";
import { Align, debug_AlignFromBytesError, type Size, Size as Size_ } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AllocId, debug_AllocId, InterpErrorInfo_from_InterpErrorKind, interp_ok, type InterpResult, Pointer as interpret_Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { CtfeProvenance, PointerArithmetic_provided } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_int, debug_struct_non_exhaustive, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { port_methods } from "../../rust_ts/miri_stub.ts";
import { binary_search_by } from "../../std/slice.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { type Rng } from "../../vendor/rand_core/lib.ts";
import { type StdRng } from "../../vendor/rand/rngs/std.ts";
export * from "./mod.gen.ts";

// mod address_generator;
// mod reuse_pool;
// pub use self::address_generator::AddressGenerator;
export { AddressGenerator } from "./address_generator.ts";

/** PORT: `machine.rng` (a `RefCell<StdRng>`) as the vendored `StdRng` (header). */
function machine_rng(machine: MiriMachine): StdRng {
  return machine.rng;
}

/** `|(addr, _)| *addr` compared with `addr` (the `binary_search_by_key` of `int_to_ptr_map`). */
function by_addr(addr: bigint): (x: [bigint, AllocId]) => -1 | 0 | 1 {
  return (x) => (x[0] < addr ? -1 : x[0] > addr ? 1 : 0);
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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
    // alloc_addresses/mod.rs:63 (impl VisitProvenance)
    visit_provenance(_visit: VisitWith): void;
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

// impl VisitProvenance for GlobalStateInner
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:63 visit_provenance
GlobalStateInner.prototype.visit_provenance = function (this: GlobalStateInner, _visit: VisitWith): void {
  // let GlobalStateInner { int_to_ptr_map: _, base_addr: _, prepared_alloc_bytes: _, exposed: _,
  //     address_generation: _, provenance_mode: _ } = self;
  // Though base_addr, int_to_ptr_map, and exposed contain AllocIds, we do not want to visit them.
  // int_to_ptr_map and exposed must contain only live allocations, and those
  // are never garbage collected.
  // base_addr is only relevant if we have a pointer to an AllocId and need to look up its
  // base address; so if an AllocId is not reachable from somewhere else we can remove it
  // here.
};

// rustc: src/tools/miri/src/alloc_addresses/mod.rs:82 new
(GlobalStateInner as unknown as { new: (config: MiriConfig, stack_addr: bigint, tcx: TyCtxt) => GlobalStateInner }).new =
  function (config: MiriConfig, stack_addr: bigint, tcx: TyCtxt): GlobalStateInner {
    return new GlobalStateInner(
      /* int_to_ptr_map */ [],
      /* base_addr */ new Map(),
      /* exposed */ new Set(),
      /* provenance_mode */ config.provenance_mode,
      /* address_generation */ config.native_lib.length === 0 && config.genmc_config === undefined
        ? [
            AddressGenerator.new({ start: stack_addr, end: PointerArithmetic_provided.target_usize_max(tcx) }),
            ReusePool.new(config),
          ]
        : undefined,
      /* prepared_alloc_bytes */ config.native_lib.length !== 0 ? new Map() : undefined,
    );
  };

// rustc: src/tools/miri/src/alloc_addresses/mod.rs:99 remove_unreachable_allocs
GlobalStateInner.prototype.remove_unreachable_allocs = function (this: GlobalStateInner, allocs: LiveAllocs): void {
  // `exposed` and `int_to_ptr_map` are cleared immediately when an allocation
  // is freed, so `base_addr` is the only one we have to clean up based on the GC.
  // self.base_addr.retain(|id, _| allocs.is_live(*id));
  for (const id of this.base_addr.keys()) {
    if (!allocs.is_live(id)) this.base_addr.delete(id);
  }
};

// ---- impl EvalContextExtPriv for MiriInterpCx ----
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:108 addr_from_alloc_id_uncached
InterpCx.prototype.addr_from_alloc_id_uncached = function (
  this: MiriInterpCx,
  global_state: GlobalStateInner,
  alloc_id: AllocId,
  memory_kind: MemoryKind,
): InterpResult<bigint> {
  const this_ = this.eval_context_ref();
  const info = this_.get_alloc_info(alloc_id);

  // This is either called immediately after allocation (and then cached), or when
  // adjusting `tcx` pointers (which never get freed). So assert that we are looking
  // at a live allocation. This also ensures that we never re-assign an address to an
  // allocation that previously had an address, but then was freed and the address
  // information was removed.
  assert(!(info.kind === "Dead"), "assertion failed: !matches!(info.kind, AllocKind::Dead)");

  // TypeId allocations always have a "base address" of 0 (i.e., the relative offset is the
  // hash fragment and therefore equal to the actual integer value).
  if (info.kind === "TypeId") {
    return interp_ok(0n);
  }

  // Miri's address assignment leaks state across thread boundaries, which is incompatible
  // with GenMC execution. So we instead let GenMC assign addresses to allocations.
  const genmc_ctx = GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race);
  if (genmc_ctx !== undefined) {
    const addr = genmc_ctx.handle_alloc(this_, alloc_id, info.size, info.align, memory_kind);
    if (addr.$ === "Err") return addr;
    return interp_ok(addr._0);
  }

  // This allocation does not have a base address yet, pick or reuse one.
  if (this_.machine.native_lib.length !== 0) {
    // In native lib mode, we use the "real" address of the bytes for this allocation.
    // This ensures the interpreted program and native code have the same view of memory.
    // PORT: header (decision C6): the native-lib arm (alloc_addresses/mod.rs:139-196) needs host addresses.
    return unported("miri::alloc_addresses::addr_from_alloc_id_uncached: native-lib mode (decision C6)");
  }
  // We are not in native lib or genmc mode, so we control the addresses ourselves.
  const [addr_gen, reuse] = unwrap(global_state.address_generation);
  const rng = machine_rng(this_.machine);
  const reused = reuse.take_addr(rng, info.size, info.align, memory_kind, this_.active_thread());
  if (reused !== undefined) {
    const [reuse_addr, clock] = reused;
    // If we use some other thread's address, that implies a happens-before.
    if (clock !== undefined) {
      const r = this_.acquire_clock(clock);
      if (r.$ === "Err") return r;
    }
    return interp_ok(reuse_addr);
  } else {
    // We have to pick a fresh address.
    const new_addr = addr_gen.generate(info.size, info.align, rng);
    if (new_addr.$ === "Err") return new_addr;

    // If we filled up more than half the address space, start aggressively reusing
    // addresses to avoid running out.
    const remaining_range = addr_gen.get_remaining();
    if (remaining_range.start > remaining_range.end / 2n) {
      reuse.address_space_shortage();
    }

    return interp_ok(new_addr._0);
  }
};

// PORT: returns `as_ptr()` (the bytes' view, alloc_bytes.ts header) for `*const u8`; only reached from the native-lib
// arm of `addr_from_alloc_id_uncached`, which stops `unported` (header).
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:225 dummy_alloc
export function dummy_alloc(params: MiriAllocParams): Uint8Array {
  // Allocate some dummy memory to get a unique address for this function/vtable.
  const alloc_bytes = AllocBytes_MiriAllocBytes.from_bytes(new Uint8Array(1), unwrap_result(Align.from_bytes(1), debug_AlignFromBytesError), params);
  const ptr = AllocBytes_MiriAllocBytes.as_ptr(alloc_bytes);
  // Leak the underlying memory to ensure it remains unique.
  // std::mem::forget(alloc_bytes);
  return ptr;
}

// ---- impl EvalContextExt for MiriInterpCx ----
// Returns the `AllocId` that corresponds to the specified addr,
// or `None` if the addr is out of bounds.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:238 alloc_id_from_addr
InterpCx.prototype.alloc_id_from_addr = function (this: MiriInterpCx, addr_: bigint, size: bigint): AllocId | undefined {
  const this_ = this.eval_context_ref();
  const global_state = this_.machine.alloc_addresses;
  assert(global_state.provenance_mode !== ProvenanceMode.Strict, "assertion failed: global_state.provenance_mode != ProvenanceMode::Strict");

  // We always search the allocation to the right of this address. So if the size is strictly
  // negative, we have to search for `addr-1` instead.
  const addr = size >= 0n ? addr_ : addr_ > 0n ? addr_ - 1n : 0n;
  const pos = binary_search_by(global_state.int_to_ptr_map, by_addr(addr));

  // Determine the in-bounds provenance for this pointer.
  let alloc_id: AllocId | undefined;
  if (pos.ok) {
    alloc_id = global_state.int_to_ptr_map[pos.i]![1];
  } else if (pos.i === 0) {
    alloc_id = undefined;
  } else {
    // This is the largest of the addresses smaller than `int`,
    // i.e. the greatest lower bound (glb)
    const [glb, alloc_id_] = global_state.int_to_ptr_map[pos.i - 1]!;
    // This never overflows because `addr >= glb`
    const offset = addr - glb;
    // We require this to be strict in-bounds of the allocation. This arm is only
    // entered for addresses that are not the base address, so even zero-sized
    // allocations will get recognized at their base address -- but all other
    // allocations will *not* be recognized at their "end" address.
    const size = this_.get_alloc_info(alloc_id_).size;
    alloc_id = offset < size.bytes_u64() ? alloc_id_ : undefined;
  }
  if (alloc_id === undefined) return undefined;

  // We only use this provenance if it has been exposed.
  if (global_state.exposed.has(alloc_id)) {
    // This must still be live, since we remove allocations from `int_to_ptr_map` when they get freed.
    // debug_assert!(this.is_alloc_live(alloc_id));
    return alloc_id;
  } else {
    return undefined;
  }
};

/// Returns the base address of an allocation, or an error if no base address could be found
///
/// # Panics
/// If `memory_kind = None` and the `alloc_id` is not cached, meaning that the first call to this function per `alloc_id` must get the `memory_kind`.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:281 addr_from_alloc_id
InterpCx.prototype.addr_from_alloc_id = function (
  this: MiriInterpCx,
  alloc_id: AllocId,
  memory_kind_: MemoryKind | undefined,
): InterpResult<bigint> {
  const this_ = this.eval_context_ref();
  const global_state = this_.machine.alloc_addresses;

  const addr = global_state.base_addr.get(alloc_id);
  if (addr !== undefined) {
    return interp_ok(addr);
  } else {
    // First time we're looking for the absolute address of this allocation.
    const memory_kind = unwrap(memory_kind_, "memory_kind is required since alloc_id is not cached");
    const base_addr_ = this_.addr_from_alloc_id_uncached(global_state, alloc_id, memory_kind);
    if (base_addr_.$ === "Err") return base_addr_;
    const base_addr = base_addr_._0;
    // trace!("Assigning base address {:#x} to allocation {:?}", base_addr, alloc_id);

    // Store address in cache.
    // global_state.base_addr.try_insert(alloc_id, base_addr).unwrap();
    const old = global_state.base_addr.get(alloc_id);
    if (old !== undefined) {
      panic(
        `called \`Result::unwrap()\` on an \`Err\` value: ${debug_struct_non_exhaustive(PLAIN, "OccupiedError", [
          ["key", debug_AllocId(alloc_id, PLAIN)],
          ["old_value", debug_int(old, PLAIN)],
          ["new_value", debug_int(base_addr, PLAIN)],
        ])}`,
      );
    }
    global_state.base_addr.set(alloc_id, base_addr);

    // Also maintain the opposite mapping in `int_to_ptr_map`, ensuring we keep it
    // sorted. We have a fast-path for the common case that this address is bigger than
    // all previous ones. We skip this for allocations at address 0; those can't be
    // real, they must be TypeId "fake allocations".
    if (base_addr !== 0n) {
      const last = global_state.int_to_ptr_map[global_state.int_to_ptr_map.length - 1];
      let pos: number;
      if (last !== undefined && last[0] < base_addr) {
        pos = global_state.int_to_ptr_map.length;
      } else {
        const r = binary_search_by(global_state.int_to_ptr_map, by_addr(base_addr));
        // .unwrap_err()
        if (r.ok) panic(`called \`Result::unwrap_err()\` on an \`Ok\` value: ${r.i}`);
        pos = r.i;
      }
      global_state.int_to_ptr_map.splice(pos, 0, [base_addr, alloc_id]);
    }

    return interp_ok(base_addr);
  }
};

// rustc: src/tools/miri/src/alloc_addresses/mod.rs:328 expose_provenance
InterpCx.prototype.expose_provenance = function (this: MiriInterpCx, provenance: Provenance): InterpResult {
  const this_ = this.eval_context_ref();
  const global_state = this_.machine.alloc_addresses;

  let alloc_id: AllocId, tag: BorTag;
  switch (provenance.$) {
    case "Concrete":
      [alloc_id, tag] = [provenance.alloc_id, provenance.tag];
      break;
    case "Wildcard":
      // No need to do anything for wildcard pointers as
      // their provenances have already been previously exposed.
      return interp_ok(undefined);
  }

  // In strict mode, we don't need this, so we can save some cycles by not tracking it.
  if (global_state.provenance_mode === ProvenanceMode.Strict) {
    return interp_ok(undefined);
  }
  // Exposing a dead alloc is a no-op, because it's not possible to get a dead allocation
  // via int2ptr.
  if (!this_.is_alloc_live(alloc_id)) {
    return interp_ok(undefined);
  }
  // trace!("Exposing allocation id {alloc_id:?}");
  global_state.exposed.add(alloc_id);
  // Release the global state before we call `expose_tag`, which may call `get_alloc_info_extra`,
  // which may need access to the global state.
  // drop(global_state);
  if (this_.machine.borrow_tracker !== undefined) {
    const r = this_.expose_tag(alloc_id, tag);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/** `static DEDUP: SpanDedupDiagnostic = SpanDedupDiagnostic::new();` (alloc_addresses/mod.rs:371), created on first use
 * (init-order rule C10: no other module's value at top level). */
let DEDUP_ptr_from_addr_cast: SpanDedupDiagnostic | undefined;

// rustc: src/tools/miri/src/alloc_addresses/mod.rs:361 ptr_from_addr_cast
InterpCx.prototype.ptr_from_addr_cast = function (this: MiriInterpCx, addr: bigint): InterpResult<Pointer> {
  // trace!("Casting {:#x} to a pointer", addr);

  const this_ = this.eval_context_ref();
  const global_state = this_.machine.alloc_addresses;

  // Potentially emit a warning.
  switch (global_state.provenance_mode) {
    case "Default": {
      // The first time this happens at a particular location, print a warning.
      DEDUP_ptr_from_addr_cast ??= SpanDedupDiagnostic.new();
      this_.dedup_diagnostic(DEDUP_ptr_from_addr_cast, (first) => ({ $: "Int2Ptr", details: first }));
      break;
    }
    case "Strict": {
      // throw_machine_stop!(TerminationInfo::Int2PtrWithStrictProvenance);
      return Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop(TerminationInfo.Int2PtrWithStrictProvenance)));
    }
    case "Permissive":
      break;
  }

  // We do *not* look up the `AllocId` here! This is a `usize as ptr` cast, and it is
  // completely legal to do a cast and then `wrapping_offset` to another allocation and only
  // *then* do a memory access. So the allocation that the pointer happens to point to on a
  // cast is fairly irrelevant. Instead we generate this as a "wildcard" pointer, such that
  // *every time the pointer is used*, we do an `AllocId` lookup to find the (exposed)
  // allocation it might be referencing.
  return interp_ok(interpret_Pointer.new<Provenance | undefined>(Provenance.Wildcard, Size_.from_bytes(addr)));
};

/// Convert a relative (tcx) pointer to a Miri pointer.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:392 adjust_alloc_root_pointer
InterpCx.prototype.adjust_alloc_root_pointer = function (
  this: MiriInterpCx,
  ptr: interpret_Pointer<CtfeProvenance>,
  tag: BorTag,
  kind: MemoryKind,
): InterpResult<interpret_Pointer<Provenance>> {
  const this_ = this.eval_context_ref();

  const [prov, offset] = ptr.prov_and_relative_offset();
  const alloc_id = CtfeProvenance.alloc_id(prov);

  // Get a pointer to the beginning of this allocation.
  const base_addr = this_.addr_from_alloc_id(alloc_id, kind);
  if (base_addr.$ === "Err") return base_addr;
  const base_ptr = interpret_Pointer.new<Provenance>({ $: "Concrete", alloc_id, tag }, Size_.from_bytes(base_addr._0));
  // Add offset with the right kind of pointer-overflowing arithmetic.
  return interp_ok(base_ptr.wrapping_offset(offset, this_));
};

// This returns some prepared `MiriAllocBytes`, either because `addr_from_alloc_id` reserved
// memory space in the past, or by doing the pre-allocation right upon being called.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:415 get_global_alloc_bytes
InterpCx.prototype.get_global_alloc_bytes = function (
  this: MiriInterpCx,
  id: AllocId,
  bytes: Uint8Array,
  align: Align,
): InterpResult<MiriAllocBytes> {
  const this_ = this.eval_context_ref();
  assert(this_.tcx.tcx.try_get_global_alloc(id) !== undefined, "assertion failed: this.tcx.try_get_global_alloc(id).is_some()");
  if (this_.machine.native_lib.length !== 0) {
    // In native lib mode, MiriAllocBytes for global allocations are handled via `prepared_alloc_bytes`.
    // PORT: header (decision C6): alloc_addresses/mod.rs:424-443 (the prepared host bytes) is native-lib only.
    return unported("miri::alloc_addresses::get_global_alloc_bytes: native-lib mode (decision C6)");
  } else {
    const params = this_.machine.get_default_alloc_params();
    // MiriAllocBytes::from_bytes(std::borrow::Cow::Borrowed(bytes), align, params)
    return interp_ok(AllocBytes_MiriAllocBytes.from_bytes(bytes, align, params));
  }
};

/// When a pointer is used for a memory access, this computes where in which allocation the
/// access is going.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:452 ptr_get_alloc
InterpCx.prototype.ptr_get_alloc = function (
  this: MiriInterpCx,
  ptr: interpret_Pointer<Provenance>,
  size: bigint,
): [AllocId, Size] | undefined {
  const this_ = this.eval_context_ref();

  const [tag, addr] = ptr.into_raw_parts(); // addr is absolute (Miri provenance)

  let alloc_id: AllocId;
  if (tag.$ === "Concrete") {
    alloc_id = tag.alloc_id;
  } else {
    // A wildcard pointer.
    const id = this_.alloc_id_from_addr(addr.bytes_u64(), size);
    if (id === undefined) return undefined;
    alloc_id = id;
  }

  // This cannot fail: since we already have a pointer with that provenance, adjust_alloc_root_pointer
  // must have been called in the past, so we can just look up the address in the map.
  const base_addr = unwrap(this_.machine.alloc_addresses.base_addr.get(alloc_id));

  // Measured (docs/handoff/miri-perf.md, 486 Ginstr at base): -8.4 Ginstr with the other pointer-arithmetic fast paths (memory.ts `check_and_deref_ptr`, pointer.ts `wrapping_offset`).
  // PORT(perf): in numbers when the difference is exact, in range and below 2^32, where the wrapping and the truncation to
  // the target's usize do nothing. A big `addr` is `NaN` and fails the test.
  const rel_ = addr.small - Number(base_addr);
  if (rel_ >= 0 && rel_ < 0x1_0000_0000 && base_addr <= 0x1f_ffff_ffff_ffffn) return [alloc_id, Size_.from_bytes(rel_)];

  // Wrapping "addr - base_addr"
  const rel_offset = PointerArithmetic_provided.truncate_to_target_usize(this_, BigInt.asUintN(64, addr.bytes_u64() - base_addr));
  return [alloc_id, Size_.from_bytes(rel_offset)];
};

/// Return a list of all exposed allocations.
// PORT: the `FxHashSet` iteration order is the insertion order here; only native-lib (shims/native_lib/mod.rs:555,
// out of scope, decision C6) reads the list.
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:478 exposed_allocs
InterpCx.prototype.exposed_allocs = function (this: MiriInterpCx): AllocId[] {
  const this_ = this.eval_context_ref();
  return [...this_.machine.alloc_addresses.exposed];
};

// ---- impl MiriMachine ----
// rustc: src/tools/miri/src/alloc_addresses/mod.rs:485 free_alloc_id
function free_alloc_id(this: MiriMachine, dead_id: AllocId, size: Size, align: Align, kind: MemoryKind): void {
  const global_state = this.alloc_addresses;
  const rng = machine_rng(this);

  // We can *not* remove this from `base_addr`, since the interpreter design requires that we
  // be able to retrieve an AllocId + offset for any memory access *before* we check if the
  // access is valid. Specifically, `ptr_get_alloc` is called on each attempt at a memory
  // access to determine the allocation ID and offset -- and there can still be pointers with
  // `dead_id` that one can attempt to use for a memory access. `ptr_get_alloc` may return
  // `None` only if the pointer truly has no provenance (this ensures consistent error
  // messages).
  // However, we *can* remove it from `int_to_ptr_map`, since any wildcard pointers that exist
  // can no longer actually be accessing that address. This ensures `alloc_id_from_addr` never
  // returns a dead allocation.
  // To avoid a linear scan we first look up the address in `base_addr`, and then find it in
  // `int_to_ptr_map`.
  const addr = unwrap(global_state.base_addr.get(dead_id));
  const pos_ = binary_search_by(global_state.int_to_ptr_map, by_addr(addr));
  // .unwrap()
  if (!pos_.ok) panic(`called \`Result::unwrap()\` on an \`Err\` value: ${pos_.i}`);
  const pos = pos_.i;
  const removed = global_state.int_to_ptr_map.splice(pos, 1)[0]!;
  // double-check that we removed the right thing
  assert_eq<[bigint, AllocId]>(
    removed,
    [addr, dead_id],
    (v) => `(${v[0]}, ${debug_AllocId(v[1], PLAIN)})`,
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  // We can also remove it from `exposed`, since this allocation can anyway not be returned by
  // `alloc_id_from_addr` any more.
  global_state.exposed.delete(dead_id);
  // Also remember this address for future reuse.
  if (global_state.address_generation !== undefined) {
    const [_addr_gen, reuse] = global_state.address_generation;
    const thread = this.threads.active_thread_();
    reuse.add_addr(rng, addr, size, align, kind, thread, () => {
      // We cannot be in GenMC mode as then `address_generation` is `None`. We cannot use
      // `self.release_clock` as `self.alloc_addresses` is borrowed.
      const data_race = GlobalDataRaceHandler.as_vclocks_ref(this.data_race);
      if (data_race !== undefined) {
        return data_race.release_clock(this.threads, (clock) => clone_VClock(clock));
      } else {
        // VClock::default()
        return new VClock([]);
      }
    });
  }
}
// PORT: `MiriMachine` is machine.gen.ts's class: a deferred port (init-order rule C10, port_methods).
port_methods("miri::alloc_addresses::MiriMachine", () => MiriMachine.prototype, { free_alloc_id });

