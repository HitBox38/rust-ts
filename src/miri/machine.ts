//! Global machine state as well as implementation of the interpreter engine
//! `Machine` trait.
// Port of src/tools/miri/src/machine.rs (crate `miri`, plan-m6 D2). Its types are generated into machine.gen.ts (tools/codegen
// set `miri`). Fill lane: `miri-machine` (plan-m6 wave 36). Lane miri-contract (wave 35) wrote the contract part (the core types and their type-level impls, marked
// below); lane miri-machine ported the rest (docs/handoff/miri-machine.md), in upstream order around it.
// - Inherent fns of the generated classes are prototype methods; their associated fns are statics (`MiriMachine.new`,
//   `MiriMachine.init_allocation`, `PrimitiveLayouts.new`). `impl Machine for MiriMachine`'s fns are prototype methods of
//   `MiriMachine` (`M::f(ecx, ..)` is `ecx.machine.f(ecx, ..)`, interpret/machine.ts header).
// - `RefCell<T>` / `Cell<T>` / `Rc<T>` / `Box<T>` fields are the value (PORTING §5): `bt.borrow_mut().new_frame()` is
//   `bt.new_frame()`.
// - Calls into other wave-36 lanes go through the skeleton's declarations. The few fns the skeleton does not declare (enum
//   companion methods such as `AtomicReadOrd::from`, `VisitProvenance` impls of other modules' types, `impl Default` of
//   generated classes) are looked up at call time by the `pending` / `visit_*` glue at the end of the file
//   (`PORT(contract)`; they stop `unported` until the owning lane has ported them).
// - `measureme` (`-Zmiri-measureme`) is not vendored: `MiriMachine::new` stops `unported` when it is requested, so the
//   profiler and `FrameExtra.timing` are always `None`. `-Zmiri-native-lib` stops `unported` (decision miri-contract C6).
//
// Contract (docs/handoff/miri-contract.md):
// - `MiriInterpCx` is `InterpCx<'tcx, MiriMachine<'tcx>>` = `InterpCx<MiriMachine>`: `MiriMachine` implements
//   `Machine<MiriMachineTypes>` (lane interp-miri-reconcile: the associated types record, the associated items as prototype
//   members, the provided defaults; the impl's fns are lane miri-machine's).
// - PORT (decision miri-contract C5 amendment): `MiriMachine.basic_block_count` (u64, +1 per terminator) is a `number`
//   (typemap `fields`): it counts executed basic blocks, far below 2^53 for any run that ends.
// - `trait MiriInterpCxExt` + Miri's `EvalContextExt` traits are `InterpCx` methods (`declare module` augmentations of
//   rustc_const_eval interpret/eval_context.ts, `this: MiriInterpCx`); `let this = self.eval_context_mut();` is
//   `const this_ = this.eval_context_mut();`.
// - Enums keep the generated companions; their methods are added PORTING §8-style (`MiriMemoryKind.should_save_..`), trait
//   impls are impl tables (`MayLeak_MiriMemoryKind`, `Provenance_Provenance`) or `<kind>_<Type>` fns (`display_..`,
//   `MemoryKind_from_MiriMemoryKind`), as borrowck-contract rules 4-5.
import * as gen from "./machine.gen.ts";
import { AllocExtra, type MemoryKind, MiriMachine, PrimitiveLayouts } from "./machine.gen.ts";
import type { MiriAllocBytes } from "./alloc/alloc_bytes.ts";
import { AllocBytes_MiriAllocBytes, MiriAllocParams } from "./alloc/alloc_bytes.ts";
import type { IsolatedAlloc } from "./alloc/mod.ts";
import { GlobalStateInner as alloc_addresses_GlobalStateInner } from "./alloc_addresses/mod.ts";
import * as borrow_tracker_ns from "./borrow_tracker/mod.ts";
import { type AllocState, BorTag, type BorrowTrackerMethod, debug_BorTag, debug_FrameState as debug_borrow_tracker_FrameState, type GlobalState } from "./borrow_tracker/mod.ts";
import { MonotonicClock } from "./clock.ts";
import { BlockingIoManager } from "./concurrency/blocking_io.ts";
import * as data_race_ns from "./concurrency/data_race.ts";
import {
  type AtomicFenceOrd,
  type AtomicReadOrd,
  type AtomicRwOrd,
  type AtomicWriteOrd,
  debug_FrameState as debug_data_race_FrameState,
  FrameState as data_race_FrameState,
  GlobalState as data_race_GlobalState,
  VClockAlloc,
} from "./concurrency/data_race.ts";
import * as data_race_handler_ns from "./concurrency/data_race_handler.ts";
import { AllocDataRaceHandler, GlobalDataRaceHandler } from "./concurrency/data_race_handler.ts";
import type { GenmcCtx } from "./concurrency/genmc/dummy.ts";
import { type StackEmptyCallback, type ThreadId, ThreadManager } from "./concurrency/thread.ts";
import { StoreBufferAlloc } from "./concurrency/weak_memory.ts";
import { MonoHashMap } from "./data_structures/mono_hash_map.ts";
import { type SyncObj } from "./concurrency/sync.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import * as diagnostics_ns from "./diagnostics.ts";
import type { TerminationInfo } from "./diagnostics.ts";
import type { MiriConfig } from "./eval.ts";
import { is_no_core } from "./helpers.ts";
import type { ImmTy, MPlaceTy, OpTy, PlaceTy, FnArg, Pointer, Scalar, StrictPointer } from "./lib.ts";
import { apply_random_float_error_to_imm } from "./math.ts";
import * as provenance_gc_ns from "./provenance_gc.ts";
import type { VisitProvenance, VisitWith } from "./provenance_gc.ts";
import * as cpu_affinity_ns from "./shims/cpu_affinity.ts";
import { CpuAffinityMask } from "./shims/cpu_affinity.ts";
import * as env_ns from "./shims/env.ts";
import { EnvVars } from "./shims/env.ts";
import { FdTable } from "./shims/files.ts";
import type { DynSym } from "./shims/foreign_items.ts";
import { DelayedReadinessUpdates } from "./shims/readiness.ts";
import { TlsData } from "./shims/tls.ts";
import { DirTable } from "./shims/unix/fs.ts";
import * as unwind_ns from "./shims/unwind.ts";
import { debug_CatchUnwindData } from "./shims/unwind.ts";
import { type ExternAbi, ExternAbi as ExternAbiC } from "../rustc_abi/extern_abi.ts";
import { Align, debug_AlignFromBytesError, debug_Size, Size, Size_cmp, Size_eq } from "../rustc_abi/lib.ts";
import type { AllocatorKind, SpecialAllocatorMethod } from "../rustc_ast/expand/allocator.gen.ts";
import { default_fn_name, global_fn_name } from "../rustc_ast/expand/allocator.ts";
import { allocator_shim_contents } from "../rustc_codegen_ssa/base.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, Cow, type Machine, type MachineTypes, Machine_provided, type MayLeak, type ReturnAction, type RetagMode } from "../rustc_const_eval/interpret/machine.ts";
import type { AllocKind } from "../rustc_const_eval/interpret/memory.gen.ts";
import { MemoryKind as interpret_MemoryKind } from "../rustc_const_eval/interpret/memory.ts";
import { Immediate } from "../rustc_const_eval/interpret/operand.ts";
import type { AtomicRmwOp } from "../rustc_const_eval/interpret/operator.gen.ts";
import type { Frame, FrameInfo } from "../rustc_const_eval/interpret/stack.gen.ts";
import type { EnteredTraceSpan } from "../rustc_const_eval/interpret/util.ts";
import type { RangeSet } from "../rustc_const_eval/interpret/validity.gen.ts";
import { type CodegenFnAttrs, TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Allocation } from "../rustc_middle/mir/interpret/allocation.ts";
import {
  type AllocId,
  type AllocRange,
  alloc_range,
  CTFE_ALLOC_SALT,
  CtfeProvenance,
  debug_AllocId,
  type InterpErrorKind,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  type MachineStopType,
  type Misalignment,
  type ObjectProvenance,
  type Pointer as interpret_Pointer,
  register_object_provenance,
} from "../rustc_middle/mir/interpret/mod.ts";
import type { AssertMessage, BasicBlock, BinOp, Body, Local } from "../rustc_middle/mir/mod.ts";
import { RuntimeChecks, UnwindAction, UnwindTerminateReason } from "../rustc_middle/mir/syntax.ts";
import type { TyCtxtAt } from "../rustc_middle/query/calls.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AtomicOrdering } from "../rustc_middle/ty/consts/int.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Instance, display_Instance } from "../rustc_middle/ty/instance.ts";
import * as tracing from "../rust_ts/tracing.ts";
import { debug_LayoutError, type LayoutCx, type LayoutError, type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { type SymbolName, Ty } from "../rustc_middle/ty/mod.ts";
import { type CrateNum, type DefId, debug_DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import { assert_eq_msg } from "../rustc_type_ir/search_graph/mod.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { FnSigKind, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { define_assoc, provide_defaults } from "../rust_ts/provided.ts";
import { type Debug, debug_int, debug_option, debug_struct, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import type { IoError as io_Error } from "../std/io.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { RngExt } from "../vendor/rand/rng.ts";
import { StdRng } from "../vendor/rand/rngs/std.ts";
import { StandardUniform_bool } from "../vendor/rand/distr/other.ts";
import { Range } from "../vendor/rand/distr/uniform.ts";
import { SampleUniform_usize } from "../vendor/rand/distr/uniform_int.ts";
import type { Float, FloatType } from "../vendor/rustc_apfloat/lib.ts";
export * from "./machine.gen.ts";

/// First real-time signal.
/// `signal(7)` says this must be between 32 and 64 and specifies 34 or 35
/// as typical values.
export const SIGRTMIN = 34;

/// Last real-time signal.
/// `signal(7)` says it must be between 32 and 64 and specifies
/// `SIGRTMAX` - `SIGRTMIN` >= 8 (which is the value of `_POSIX_RTSIG_MAX`)
export const SIGRTMAX = 42;

/// Each anonymous global (constant, vtable, function pointer, ...) has multiple addresses, but only
/// this many. Since const allocations are never deallocated, choosing a new [`AllocId`] and thus
/// base address for each evaluation would produce unbounded memory usage.
const ADDRS_PER_ANON_GLOBAL = 32;

// ---------------------------------------------------------------- contract part (lane miri-contract) ----

// impl<'tcx> std::fmt::Debug for FrameExtra<'tcx>
// rustc: src/tools/miri/src/machine.rs:156 fmt
export const debug_FrameExtra: Debug<gen.FrameExtra> = (self, f) => {
  // Omitting `timing`, it does not support `Debug`.
  const { borrow_tracker, catch_unwind, timing: _, user_relevance, data_race } = self;
  return debug_struct(f, "FrameData", [
    ["borrow_tracker", debug_option(borrow_tracker, f, debug_borrow_tracker_FrameState)],
    ["catch_unwind", debug_option(catch_unwind, f, debug_CatchUnwindData)],
    ["user_relevance", debug_int(user_relevance, f)],
    ["data_race", debug_option(data_race, f, debug_data_race_FrameState)],
  ]);
};

// impl VisitProvenance for FrameExtra<'_>
/** PORT: `FrameExtra` is a generated interface, so its `VisitProvenance` impl is a table (borrowck-contract rule 5). */
export const VisitProvenance_FrameExtra = {
  // rustc: src/tools/miri/src/machine.rs:170 visit_provenance
  visit_provenance(self: gen.FrameExtra, visit: VisitWith): void {
    const { catch_unwind, borrow_tracker, timing: _timing, user_relevance: _user_relevance, data_race: _data_race } = self;

    // catch_unwind.visit_provenance(visit);  (`Option<T>`, provenance_gc.rs:33)
    if (catch_unwind !== undefined) {
      visit_table(unwind_ns, "VisitProvenance_CatchUnwindData", catch_unwind, visit, "miri::shims::unwind::CatchUnwindData (lane miri-shims-a)");
    }
    // borrow_tracker.visit_provenance(visit);  (`Option<T>`, provenance_gc.rs:33)
    if (borrow_tracker !== undefined) {
      visit_table(borrow_tracker_ns, "VisitProvenance_FrameState", borrow_tracker, visit, "miri::borrow_tracker::FrameState (lane miri-alloc)");
    }
  },
};

/** PORT: the methods of `impl MiriMemoryKind` on the generated companion (PORTING §8). */
export interface MiriMemoryKind_methods {
  /** Whether we have a useful allocation span for an allocation of this kind. */
  should_save_allocation_span(self: MiriMemoryKind): boolean;
}
export type MiriMemoryKind = gen.MiriMemoryKind;
export const MiriMemoryKind = gen.MiriMemoryKind as typeof gen.MiriMemoryKind & MiriMemoryKind_methods;

// impl From<MiriMemoryKind> for MemoryKind
// rustc: src/tools/miri/src/machine.rs:215 from
export function MemoryKind_from_MiriMemoryKind(kind: MiriMemoryKind): gen.MemoryKind {
  return { $: "Machine", _0: kind };
}

// impl MayLeak for MiriMemoryKind
export const MayLeak_MiriMemoryKind: MayLeak<MiriMemoryKind> = {
  // rustc: src/tools/miri/src/machine.rs:222 may_leak
  may_leak(self: MiriMemoryKind): boolean {
    switch (self) {
      case "Rust":
      case "Miri":
      case "C":
      case "WinHeap":
      case "WinLocal":
      case "Runtime":
        return false;
      case "Machine":
      case "Global":
      case "ExternStatic":
      case "Tls":
      case "Mmap":
      case "SocketAddress":
        return true;
    }
  },
};

// rustc: src/tools/miri/src/machine.rs:233 should_save_allocation_span
MiriMemoryKind.should_save_allocation_span = function (self: MiriMemoryKind): boolean {
  switch (self) {
    // Heap allocations are fine since the `Allocation` is created immediately.
    case "Rust":
    case "Miri":
    case "C":
    case "WinHeap":
    case "WinLocal":
    case "Mmap":
      return true;
    // Everything else is unclear, let's not show potentially confusing spans.
    case "Machine":
    case "Global":
    case "ExternStatic":
    case "Tls":
    case "Runtime":
    case "SocketAddress":
      return false;
  }
};

// impl fmt::Display for MiriMemoryKind
// rustc: src/tools/miri/src/machine.rs:245 fmt
export function display_MiriMemoryKind(self: MiriMemoryKind): string {
  switch (self) {
    case "Rust":
      return "Rust heap";
    case "Miri":
      return "Miri bare-metal heap";
    case "C":
      return "C heap";
    case "WinHeap":
      return "Windows heap";
    case "WinLocal":
      return "Windows local memory";
    case "Machine":
      return "machine-managed memory";
    case "Runtime":
      return "language runtime memory";
    case "Global":
      return "global (static or const)";
    case "ExternStatic":
      return "extern static";
    case "Tls":
      return "thread-local static";
    case "Mmap":
      return "mmap";
    case "SocketAddress":
      return "socket address";
  }
}

export type Provenance = gen.Provenance;
export const Provenance = gen.Provenance;

// impl fmt::Debug for Provenance
// rustc: src/tools/miri/src/machine.rs:316 fmt
export const debug_Provenance: Debug<Provenance> = (self, f) => {
  let out = "";
  switch (self.$) {
    case "Concrete": {
      const { alloc_id, tag } = self;
      // Forward `alternate` flag to `alloc_id` printing.
      if (f.alternate) {
        out += `[${debug_AllocId(alloc_id, PRETTY)}]`;
      } else {
        out += `[${debug_AllocId(alloc_id, PLAIN)}]`;
      }
      // Print Borrow Tracker tag.
      out += debug_BorTag(tag, PLAIN);
      break;
    }
    case "Wildcard":
      out += "[wildcard]";
      break;
  }
  return out;
};

/**
 * `impl interpret::Provenance for Provenance` (the interp-generic contract: rustc_middle's `provenance_of(prov)` returns
 * this table for a Miri provenance value, an object `{ $: "Concrete" | "Wildcard" }`, through `register_object_provenance`
 * below; it is also `MiriMachine`'s `Machine.Provenance`). PORT: the supertraits `PartialEq` (derived) and `Debug` are
 * `eq` / `debug`; `owns` tells a Miri provenance object from another machine's (pointer.ts `ObjectProvenance`).
 */
export const Provenance_Provenance: ObjectProvenance<Provenance> = {
  /// We use absolute addresses in the `offset` of a `StrictPointer`.
  OFFSET_IS_ADDR: true,

  /// Miri implements wildcard provenance.
  WILDCARD: gen.Provenance.Wildcard,

  // rustc: src/tools/miri/src/machine.rs:343 get_alloc_id
  get_alloc_id(self: Provenance): AllocId | undefined {
    switch (self.$) {
      case "Concrete":
        return self.alloc_id;
      case "Wildcard":
        return undefined;
    }
  },

  // rustc: src/tools/miri/src/machine.rs:350 fmt
  fmt(ptr: interpret_Pointer<Provenance>, f: Fmt): string {
    const [prov, addr] = ptr.into_raw_parts(); // offset is absolute address
    let out = `0x${addr.bytes_u64().toString(16)}`;
    if (f.alternate) {
      out += debug_Provenance(prov, PRETTY);
    } else {
      out += debug_Provenance(prov, PLAIN);
    }
    return out;
  },

  /** `#[derive(PartialEq)]`: the same variant, and for `Concrete` the same `alloc_id` and `tag`. */
  eq(a: Provenance, b: Provenance): boolean {
    if (a.$ === "Concrete") return b.$ === "Concrete" && a.alloc_id === b.alloc_id && a.tag === b.tag;
    return b.$ === "Wildcard";
  },

  debug: debug_Provenance,

  owns(prov: object): boolean {
    const p = prov as { $?: unknown };
    return (p.$ === "Concrete" && "alloc_id" in prov && "tag" in prov) || p.$ === "Wildcard";
  },
};
// PORT (plan-m6 D3): `provenance_of` finds the impl of a Miri provenance value (pointer.ts; once, at load).
register_object_provenance(Provenance_Provenance);

/** PORT: the methods of `impl ProvenanceExtra` on the generated companion (PORTING §8). */
export interface ProvenanceExtra_methods {
  and_then<T>(self: ProvenanceExtra, f: (_0: BorTag) => T | undefined): T | undefined;
}
export type ProvenanceExtra = gen.ProvenanceExtra;
export const ProvenanceExtra = gen.ProvenanceExtra as typeof gen.ProvenanceExtra & ProvenanceExtra_methods;

// impl fmt::Debug for ProvenanceExtra
// rustc: src/tools/miri/src/machine.rs:363 fmt
export const debug_ProvenanceExtra: Debug<ProvenanceExtra> = (self, _f) => {
  switch (self.$) {
    case "Concrete":
      return debug_BorTag(self._0, PLAIN);
    case "Wildcard":
      return "<wildcard>";
  }
};

// rustc: src/tools/miri/src/machine.rs:372 and_then
ProvenanceExtra.and_then = function <T>(self: ProvenanceExtra, f: (_0: BorTag) => T | undefined): T | undefined {
  switch (self.$) {
    case "Concrete":
      return f(self._0);
    case "Wildcard":
      return undefined;
  }
};

// We need a `Clone` impl because the machine passes `Allocation` through `Cow`...
// but that should never end up actually cloning our `AllocExtra`.
// impl<'tcx> Clone for AllocExtra<'tcx>
// rustc: src/tools/miri/src/machine.rs:404 clone
export function clone_AllocExtra(_self: AllocExtra): AllocExtra {
  return panic("our allocations should never be cloned");
}

// impl VisitProvenance for AllocExtra<'_>
declare module "./machine.gen.ts" {
  interface AllocExtra extends VisitProvenance {}
}
// rustc: src/tools/miri/src/machine.rs:410 visit_provenance
AllocExtra.prototype.visit_provenance = function (this: AllocExtra, visit: VisitWith): void {
  const { borrow_tracker, data_race, backtrace: _backtrace, sync_objs: _sync_objs } = this;

  // borrow_tracker.visit_provenance(visit);  (`Option<T>`, provenance_gc.rs:33)
  if (borrow_tracker !== undefined) {
    visit_table(borrow_tracker_ns, "VisitProvenance_AllocState", borrow_tracker, visit, "miri::borrow_tracker::AllocState (lane miri-alloc)");
  }
  // data_race.visit_provenance(visit);
  visit_table(data_race_handler_ns, "VisitProvenance_AllocDataRaceHandler", data_race, visit, "miri::concurrency::AllocDataRaceHandler (lane miri-race)");
};

declare module "./machine.gen.ts" {
  interface PrimitiveLayouts {
    // machine.rs:484
    uint(size: Size): TyAndLayout | undefined;
    // machine.rs:495
    int(size: Size): TyAndLayout | undefined;
  }
  namespace PrimitiveLayouts {
    // machine.rs:442
    function new_(layout_cx: LayoutCx): Result<PrimitiveLayouts, LayoutError>;
    export { new_ as new };
  }
}

// impl<'tcx> PrimitiveLayouts<'tcx>
// rustc: src/tools/miri/src/machine.rs:442 new
(PrimitiveLayouts as unknown as { new: (layout_cx: LayoutCx) => Result<PrimitiveLayouts, LayoutError> }).new = function (
  layout_cx: LayoutCx,
): Result<PrimitiveLayouts, LayoutError> {
  const tcx = layout_cx.tcx_();

  const unit_ptr_mut = Ty.new_mut_ptr(tcx, tcx.types.unit);
  const unit_ptr_const = Ty.new_imm_ptr(tcx, tcx.types.unit);
  // We fall back to `()` if the lang item is missing, so `no_core` works better with Miri.
  const c_void_id = tcx.lang_items().get("CVoid");
  let c_void: Ty;
  if (c_void_id !== undefined) {
    c_void = Instance.ty(Instance.mono(tcx, c_void_id), tcx, layout_cx.typing_env);
  } else {
    c_void = tcx.types.unit;
  }
  const void_ptr_mut = Ty.new_mut_ptr(tcx, c_void);
  const void_ptr_const = Ty.new_imm_ptr(tcx, c_void);

  const sig_kind = FnSigKind.set_safety(FnSigKind.set_abi(FnSigKind.default_(), { $: "C", unwind: false }), "Safe");
  const fn_ptr = Ty.new_fn_ptr(tcx, Binder.dummy(tcx.mk_fn_sig([], tcx.types.unit, sig_kind), fold_FnSig));

  // PORT: each `layout_cx.layout_of(ty)?` in field order.
  const tys: Ty[] = [
    tcx.types.unit,
    tcx.types.i8,
    tcx.types.i16,
    tcx.types.i32,
    tcx.types.i64,
    tcx.types.i128,
    tcx.types.isize,
    tcx.types.u8,
    tcx.types.u16,
    tcx.types.u32,
    tcx.types.u64,
    tcx.types.u128,
    tcx.types.usize,
    tcx.types.bool,
    unit_ptr_mut,
    unit_ptr_const,
    void_ptr_mut,
    void_ptr_const,
    fn_ptr,
  ];
  const l: TyAndLayout[] = [];
  for (const ty of tys) {
    const r = layout_cx.layout_of(ty);
    if (r.$ === "Err") return r;
    l.push(r._0);
  }
  return Ok(
    new PrimitiveLayouts(
      /* unit */ l[0]!,
      /* i8 */ l[1]!,
      /* i16 */ l[2]!,
      /* i32 */ l[3]!,
      /* i64 */ l[4]!,
      /* i128 */ l[5]!,
      /* isize */ l[6]!,
      /* u8 */ l[7]!,
      /* u16 */ l[8]!,
      /* u32 */ l[9]!,
      /* u64 */ l[10]!,
      /* u128 */ l[11]!,
      /* usize */ l[12]!,
      /* bool */ l[13]!,
      /* unit_ptr_mut */ l[14]!,
      /* unit_ptr_const */ l[15]!,
      /* void_ptr_mut */ l[16]!,
      /* void_ptr_const */ l[17]!,
      /* fn_ptr */ l[18]!,
    ),
  );
};

// rustc: src/tools/miri/src/machine.rs:484 uint
PrimitiveLayouts.prototype.uint = function (this: PrimitiveLayouts, size: Size): TyAndLayout | undefined {
  switch (size.bits()) {
    case 8:
      return this.u8;
    case 16:
      return this.u16;
    case 32:
      return this.u32;
    case 64:
      return this.u64;
    case 128:
      return this.u128;
    default:
      return undefined;
  }
};

// rustc: src/tools/miri/src/machine.rs:495 int
PrimitiveLayouts.prototype.int = function (this: PrimitiveLayouts, size: Size): TyAndLayout | undefined {
  switch (size.bits()) {
    case 8:
      return this.i8;
    case 16:
      return this.i16;
    case 32:
      return this.i32;
    case 64:
      return this.i64;
    case 128:
      return this.i128;
    default:
      return undefined;
  }
};

/** `Either<Symbol, SpecialAllocatorMethod>` (rustc_data_structures::either; the type of `allocator_shim_symbols`). */
type AllocatorShimSymbol = { readonly $: "Left"; _0: Symbol } | { readonly $: "Right"; _0: SpecialAllocatorMethod };

declare module "./machine.gen.ts" {
  interface MiriMachine {
    // machine.rs:933
    communicate(): boolean;
    // machine.rs:938
    is_local(instance: Instance): boolean;
    // machine.rs:944
    handle_abnormal_termination(): void;
    // machine.rs:952
    page_align(): Align;
    // machine.rs:956
    allocated_span(alloc_id: AllocId): Span | undefined;
    // machine.rs:960
    deallocated_span(alloc_id: AllocId): Span | undefined;
  }
  namespace MiriMachine {
    // machine.rs:700
    function new_(config: MiriConfig, layout_cx: LayoutCx, genmc_ctx: GenmcCtx | undefined): MiriMachine;
    export { new_ as new };
    // machine.rs:869
    export let allocator_shim_symbols: (tcx: TyCtxt) => Map<Symbol, AllocatorShimSymbol>;
    // machine.rs:901
    export let get_user_relevant_crates: (tcx: TyCtxt, config: MiriConfig) => CrateNum[];
    // machine.rs:922
    export let late_init: (ecx: MiriInterpCx, config: MiriConfig, on_main_stack_empty: StackEmptyCallback) => InterpResult;
    // machine.rs:967
    export let init_allocation: (ecx: MiriInterpCx, id: AllocId, kind: MemoryKind, size: Size, align: Align) => InterpResult<AllocExtra>;
  }
}

// impl<'tcx> MiriMachine<'tcx>
/// Create a new MiriMachine.
///
/// Invariant: `genmc_ctx.is_some() == config.genmc_config.is_some()`
// rustc: src/tools/miri/src/machine.rs:700 new
(MiriMachine as unknown as { new: (config: MiriConfig, layout_cx: LayoutCx, genmc_ctx: GenmcCtx | undefined) => MiriMachine }).new = function (
  config: MiriConfig,
  layout_cx: LayoutCx,
  genmc_ctx: GenmcCtx | undefined,
): MiriMachine {
  const tcx = layout_cx.tcx_();
  const user_relevant_crates = MiriMachine.get_user_relevant_crates(tcx, config);
  const layouts = expect_result(PrimitiveLayouts.new(layout_cx), "Couldn't get layouts of primitive types", debug_LayoutError_ref);
  let profiler: never | undefined;
  if (config.measureme_out !== undefined) {
    // PORT: `measureme` (`-Zmiri-measureme`) is not vendored: the profiler (and `FrameExtra.timing`) is never built.
    profiler = unported("miri::machine::MiriMachine::new: measureme profiler (-Zmiri-measureme)");
  } else {
    profiler = undefined;
  }
  const rng = StdRng.seed_from_u64(config.seed ?? 0n);
  let borrow_tracker: GlobalState | undefined;
  if (config.borrow_tracker !== undefined) {
    const bt = config.borrow_tracker;
    borrow_tracker = BorrowTrackerMethod_().instantiate_global_state(bt, config);
  } else {
    borrow_tracker = undefined;
  }
  let data_race: GlobalDataRaceHandler;
  if (config.genmc_config !== undefined) {
    // `genmc_ctx` persists across executions, so we don't create a new one here.
    data_race = { $: "Genmc", _0: unwrap(genmc_ctx) };
  } else if (config.data_race_detector) {
    data_race = { $: "Vclocks", _0: data_race_GlobalState.new(config) };
  } else {
    data_race = GlobalDataRaceHandler.None;
  }
  // Determine page size, stack address, and stack size.
  // These values are mostly meaningless, but the stack address is also where we start
  // allocating physical integer addresses for all allocations.
  let page_size: bigint;
  if (config.page_size !== undefined) {
    page_size = config.page_size;
  } else {
    const target = tcx.sess.target;
    switch (target.arch.$) {
      case "Wasm32":
      case "Wasm64":
        page_size = 64n * 1024n; // https://webassembly.github.io/spec/core/exec/runtime.html#memory-instances
        break;
      case "AArch64":
        if (target.is_like_darwin) {
          // No "definitive" source, but see:
          // https://www.wwdcnotes.com/notes/wwdc20/10214/
          // https://github.com/ziglang/zig/issues/11308 etc.
          page_size = 16n * 1024n;
          break;
        }
        page_size = 4n * 1024n;
        break;
      default:
        page_size = 4n * 1024n;
        break;
    }
  }
  // On 16bit targets, 32 pages is more than the entire address space!
  const stack_addr = tcx.data_layout().pointer_size().bits() < 32 ? page_size : page_size * 32n;
  const stack_size = tcx.data_layout().pointer_size().bits() < 32 ? page_size * 4n : page_size * 16n;
  const MAX_CPUS = cpu_affinity_MAX_CPUS();
  assert(
    config.num_cpus <= MAX_CPUS,
    () => `miri only supports up to ${MAX_CPUS} CPUs, but ${config.num_cpus} were configured`,
  );
  const threads = ThreadManager.new(config);
  let thread_cpu_affinity: Map<ThreadId, CpuAffinityMask> | undefined;
  const os = tcx.sess.target.os.$;
  if ((os === "Linux" || os === "FreeBsd" || os === "Android") && !is_no_core(tcx)) {
    const affinity = new Map<ThreadId, CpuAffinityMask>();
    // PORT(contract): cpu_affinity.ts declares `cx` as `Pending<impl LayoutOf>`; the value is the `LayoutCx`.
    affinity.set(threads.active_thread_(), CpuAffinityMask.new(layout_cx as unknown as Parameters<typeof CpuAffinityMask.new>[0], config.num_cpus));
    thread_cpu_affinity = affinity;
  } else {
    thread_cpu_affinity = undefined;
  }
  const blocking_io = expect_result(
    BlockingIoManager.new(config.isolated_op.$ === "Allow"),
    "Couldn't create poll instance",
    debug_io_Error_ref,
  );
  const alloc_addresses = alloc_addresses_GlobalStateInner.new(config, stack_addr, tcx);

  // PORT: the struct literal's fields are evaluated in its order into locals, then passed in declaration order.
  // `env_vars` depends on a full interpreter so we cannot properly initialize it yet.
  const env_vars: EnvVars = EnvVars.Uninit; // EnvVars::default()
  const main_fn_ret_place = undefined;
  const argc = undefined;
  const argv = undefined;
  const cmd_line = undefined;
  const current_exe = config.current_exe;
  const tls = TlsData_default();
  const isolated_op = config.isolated_op;
  const validation = config.validation;
  const fds = FdTable.init(config.mute_stdout_stderr);
  const delayed_readiness_updates = new DelayedReadinessUpdates([]); // Rc::new(DelayedReadinessUpdates::default())
  const dirs = DirTable_default(); // Default::default()
  const static_roots: AllocId[] = [];
  const string_cache = new Map<string, never>();
  const exported_symbols_cache = new Map<Symbol, Instance | undefined>();
  const backtrace_style = config.backtrace_style;
  const extern_statics = new Map<Symbol, StrictPointer>();
  const extern_statics_imports = new Map<Symbol, StrictPointer>();
  const extern_static_weak_import_default = undefined;
  let allocator: IsolatedAlloc | undefined;
  if (config.native_lib.length !== 0) {
    // PORT (decision miri-contract C6): built without `native-lib`; `IsolatedAlloc` is only used with a native lib.
    allocator = unported("miri::machine::MiriMachine::new: -Zmiri-native-lib (crate::alloc::isolated_alloc::IsolatedAlloc)");
  } else {
    allocator = undefined;
  }
  const tracked_alloc_ids = new Set(config.tracked_alloc_ids);
  const track_alloc_accesses = config.track_alloc_accesses;
  const check_alignment = config.check_alignment;
  const cmpxchg_weak_failure_rate = config.cmpxchg_weak_failure_rate;
  const preemption_rate = config.preemption_rate;
  const report_progress = config.report_progress;
  const basic_block_count = 0;
  const monotonic_clock = MonotonicClock.new(config.isolated_op.$ === "Allow");
  // #[cfg(not(all(feature = "native-lib", unix)))]
  const native_lib: never[] = config.native_lib.map((_) => {
    // PORT (decision miri-contract C6): upstream's not-enabled panic is an `unported` stop (the oracle has `native-lib`).
    // panic!("calling functions from native libraries via FFI is not supported in this build of Miri")
    return unported("miri::machine::MiriMachine::new: -Zmiri-native-lib (shims/native_lib)");
  });
  const gc_interval = config.gc_interval;
  const since_gc = 0;
  const num_cpus = config.num_cpus;
  const collect_leak_backtraces = config.collect_leak_backtraces;
  const allocation_spans = new Map<AllocId, [Span, Span | undefined]>();
  const symbolic_alignment = new Map<AllocId, [Size, Align]>();
  const union_data_ranges = new Map<Ty, RangeSet>();
  const pthread_mutex_sanity = false;
  const pthread_rwlock_sanity = false;
  const pthread_condvar_sanity = false;
  const allocator_shim_symbols = MiriMachine.allocator_shim_symbols(tcx);
  const mangle_internal_symbol_cache = new Map<string, string>();
  const float_nondet = config.float_nondet;
  const float_rounding_error = config.float_rounding_error;
  const short_fd_operations = config.short_fd_operations;

  return new MiriMachine(
    tcx,
    borrow_tracker,
    data_race,
    alloc_addresses,
    env_vars,
    main_fn_ret_place,
    argc,
    argv,
    cmd_line,
    current_exe,
    tls,
    isolated_op,
    validation,
    fds,
    dirs,
    delayed_readiness_updates,
    monotonic_clock,
    threads,
    blocking_io,
    thread_cpu_affinity,
    layouts,
    static_roots,
    profiler,
    string_cache,
    exported_symbols_cache,
    backtrace_style,
    user_relevant_crates,
    extern_statics,
    extern_statics_imports,
    extern_static_weak_import_default,
    rng,
    allocator,
    tracked_alloc_ids,
    track_alloc_accesses,
    check_alignment,
    cmpxchg_weak_failure_rate,
    preemption_rate,
    report_progress,
    basic_block_count,
    native_lib,
    gc_interval,
    since_gc,
    num_cpus,
    page_size,
    stack_addr,
    stack_size,
    collect_leak_backtraces,
    allocation_spans,
    symbolic_alignment,
    union_data_ranges,
    pthread_mutex_sanity,
    pthread_rwlock_sanity,
    pthread_condvar_sanity,
    allocator_shim_symbols,
    mangle_internal_symbol_cache,
    float_nondet,
    float_rounding_error,
    short_fd_operations,
  );
};

// rustc: src/tools/miri/src/machine.rs:869 allocator_shim_symbols
MiriMachine.allocator_shim_symbols = function (tcx: TyCtxt): Map<Symbol, AllocatorShimSymbol> {
  // use rustc_codegen_ssa::base::allocator_shim_contents;

  // codegen uses `allocator_kind_for_codegen` here, but that's only needed to deal with
  // dylibs which we do not support.
  const kind = tcx.allocator_kind(null) as AllocatorKind | undefined;
  if (kind === undefined) {
    return new Map(); // Default::default()
  }
  const methods = allocator_shim_contents(tcx, kind);
  const symbols = new Map<Symbol, AllocatorShimSymbol>();
  for (const method of methods) {
    const from_name = Symbol.intern(mangle_internal_symbol(tcx, global_fn_name(method.name)));
    let to: AllocatorShimSymbol;
    if (method.special !== undefined) {
      const special = method.special;
      to = { $: "Right", _0: special };
    } else {
      to = { $: "Left", _0: Symbol.intern(mangle_internal_symbol(tcx, default_fn_name(method.name))) };
    }
    // symbols.try_insert(from_name, to).unwrap();
    if (symbols.has(from_name)) {
      // PORT: `OccupiedError`'s Debug is not ported; the ICE text keeps core's prefix.
      return panic("called `Result::unwrap()` on an `Err` value: OccupiedError { .. }");
    }
    symbols.set(from_name, to);
  }
  return symbols;
};

/// Retrieve the list of user-relevant crates based on MIRI_LOCAL_CRATES as set by cargo-miri,
/// and extra crates set in the config.
// rustc: src/tools/miri/src/machine.rs:901 get_user_relevant_crates
MiriMachine.get_user_relevant_crates = function (tcx: TyCtxt, config: MiriConfig): CrateNum[] {
  // Convert the local crate names from the passed-in config into CrateNums so that they can
  // be looked up quickly during execution
  // PORT (plan-m6 D14): `std::env::var` reads the host environment (`process.env`; a non-Unicode value is `Err`, as unset).
  const local_crates_var = process.env["MIRI_LOCAL_CRATES"];
  const local_crate_names: string[] = local_crates_var !== undefined ? local_crates_var.split(",").map((krate) => krate) : [];
  const local_crates: CrateNum[] = [];
  for (const crate_num of tcx.crates(null)) {
    const name_ = tcx.crate_name(crate_num);
    const name = Symbol.as_str(name_);
    if ([...local_crate_names, ...config.user_relevant_crates].some((local_name) => local_name === name)) {
      local_crates.push(crate_num);
    }
  }
  return local_crates;
};

// rustc: src/tools/miri/src/machine.rs:922 late_init
MiriMachine.late_init = function (ecx: MiriInterpCx, config: MiriConfig, on_main_stack_empty: StackEmptyCallback): InterpResult {
  const r0 = EnvVars_().init(ecx, config);
  if (r0.$ === "Err") return r0;
  const r1 = MiriMachine.init_extern_statics(ecx);
  if (r1.$ === "Err") return r1;
  ThreadManager.init(ecx, on_main_stack_empty);
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/machine.rs:933 communicate
MiriMachine.prototype.communicate = function (this: MiriMachine): boolean {
  return this.isolated_op.$ === "Allow";
};

/// Check whether the stack frame that this `FrameInfo` refers to is part of a local crate.
// rustc: src/tools/miri/src/machine.rs:938 is_local
MiriMachine.prototype.is_local = function (this: MiriMachine, instance: Instance): boolean {
  const def_id = Instance.def_id(instance);
  return def_id.is_local() || this.user_relevant_crates.includes(def_id.krate);
};

/// Called when the interpreter is going to shut down abnormally, such as due to a Ctrl-C.
// rustc: src/tools/miri/src/machine.rs:944 handle_abnormal_termination
MiriMachine.prototype.handle_abnormal_termination = function (this: MiriMachine): void {
  // All strings in the profile data are stored in a single string table which is not
  // written to disk until the profiler is dropped. If the interpreter exits without dropping
  // the profiler, it is not possible to interpret the profile data and all measureme tools
  // will panic when given the file.
  // drop(self.profiler.take());
  this.profiler = undefined;
};

// rustc: src/tools/miri/src/machine.rs:952 page_align
MiriMachine.prototype.page_align = function (this: MiriMachine): Align {
  return unwrap_result(Align.from_bytes(this.page_size), debug_AlignFromBytesError);
};

// rustc: src/tools/miri/src/machine.rs:956 allocated_span
MiriMachine.prototype.allocated_span = function (this: MiriMachine, alloc_id: AllocId): Span | undefined {
  const e = this.allocation_spans.get(alloc_id);
  return e === undefined ? undefined : e[0];
};

// rustc: src/tools/miri/src/machine.rs:960 deallocated_span
MiriMachine.prototype.deallocated_span = function (this: MiriMachine, alloc_id: AllocId): Span | undefined {
  const e = this.allocation_spans.get(alloc_id);
  return e === undefined ? undefined : e[1];
};

// rustc: src/tools/miri/src/machine.rs:967 init_allocation
MiriMachine.init_allocation = function (ecx: MiriInterpCx, id: AllocId, kind: MemoryKind, size: Size, align: Align): InterpResult<AllocExtra> {
  if (ecx.machine.tracked_alloc_ids.has(id)) {
    ecx.emit_diagnostic({ $: "TrackingAlloc", _0: id, _1: size, _2: align });
  }

  const bt = ecx.machine.borrow_tracker;
  const borrow_tracker = bt === undefined ? undefined : bt.new_allocation(id, size, kind, ecx.machine);

  let data_race: AllocDataRaceHandler;
  const global_data_race = ecx.machine.data_race;
  switch (global_data_race.$) {
    case "None":
      data_race = AllocDataRaceHandler.None;
      break;
    case "Vclocks": {
      const data_race_ = global_data_race._0;
      data_race = {
        $: "Vclocks",
        _0: VClockAlloc.new_allocation(data_race_, ecx.machine.threads, size, kind, ecx.machine.current_user_relevant_span()),
        _1: data_race_.weak_memory ? StoreBufferAlloc.new_allocation() : undefined,
      };
      break;
    }
    case "Genmc":
      // GenMC learns about new allocations directly from the alloc_addresses module,
      // since it has to be able to control the address at which they are placed.
      data_race = AllocDataRaceHandler.Genmc;
      break;
  }

  // If an allocation is leaked, we want to report a backtrace to indicate where it was
  // allocated. We don't need to record a backtrace for allocations which are allowed to
  // leak.
  let backtrace: FrameInfo[] | undefined;
  if (interpret_MemoryKind.may_leak(kind, MayLeak_MiriMemoryKind) || !ecx.machine.collect_leak_backtraces) {
    backtrace = undefined;
  } else {
    backtrace = ecx.generate_stacktrace();
  }

  if (kind.$ === "Machine" && MiriMemoryKind.should_save_allocation_span(kind._0)) {
    ecx.machine.allocation_spans.set(id, [ecx.machine.current_user_relevant_span(), undefined]);
  }

  // `sync_objs: BTreeMap::default()`
  return interp_ok(new AllocExtra(borrow_tracker, data_race, backtrace, new_sync_objs()));
};

// impl VisitProvenance for MiriMachine<'_>
declare module "./machine.gen.ts" {
  interface MiriMachine extends VisitProvenance {}
}
// rustc: src/tools/miri/src/machine.rs:1030 visit_provenance
MiriMachine.prototype.visit_provenance = function (this: MiriMachine, visit: VisitWith): void {
  // PORT: upstream destructures every field (a compile-time check that none is forgotten); the ones visited are named.
  const {
    threads,
    tls,
    env_vars,
    main_fn_ret_place,
    argc,
    argv,
    cmd_line,
    extern_statics,
    extern_statics_imports,
    extern_static_weak_import_default,
    dirs,
    borrow_tracker,
    data_race,
    alloc_addresses,
    fds,
  } = this;

  visit_object(threads, visit, "miri::concurrency::thread::ThreadManager (lane miri-threads)");
  visit_object(tls, visit, "miri::shims::tls::TlsData (lane miri-shims-a)");
  visit_table(env_ns, "VisitProvenance_EnvVars", env_vars, visit, "miri::shims::env::EnvVars (lane miri-shims-a)");
  visit_object(dirs, visit, "miri::shims::unix::fs::DirTable (lane miri-fs)");
  visit_object(fds, visit, "miri::shims::files::FdTable (lane miri-shims-b)");
  visit_table(data_race_handler_ns, "VisitProvenance_GlobalDataRaceHandler", data_race, visit, "miri::concurrency::GlobalDataRaceHandler (lane miri-race)");
  // borrow_tracker.visit_provenance(visit);  (`Option<RefCell<T>>`, provenance_gc.rs:33 / :88)
  if (borrow_tracker !== undefined) {
    visit_object(borrow_tracker, visit, "miri::borrow_tracker::GlobalStateInner (lane miri-alloc)");
  }
  // alloc_addresses.visit_provenance(visit);  (`RefCell<T>`, provenance_gc.rs:88)
  visit_object(alloc_addresses, visit, "miri::alloc_addresses::GlobalStateInner (lane miri-alloc)");
  // main_fn_ret_place.visit_provenance(visit);  (`Option<T>`, provenance_gc.rs:33)
  if (main_fn_ret_place !== undefined) {
    visit_table(provenance_gc_ns, "VisitProvenance_MPlaceTy", main_fn_ret_place, visit, "miri::provenance_gc: MPlaceTy (lane miri-driver)");
  }
  // argc / argv / cmd_line / extern_static_weak_import_default: `Option<Pointer>` / `Option<StrictPointer>`
  // (provenance_gc.rs:33, :114, :120: the pointer's provenance).
  visit_pointer(argc, visit);
  visit_pointer(argv, visit);
  visit_pointer(cmd_line, visit);
  visit_pointer(extern_static_weak_import_default, visit);
  // extern_statics / extern_statics_imports: `FxHashMap<Symbol, StrictPointer>` (provenance_gc.rs:79; a `Symbol` has
  // no provenance, `no_provenance!`).
  for (const [_key, value] of extern_statics) visit_pointer(value, visit);
  for (const [_key, value] of extern_statics_imports) visit_pointer(value, visit);
};

// ---- contract part (lane interp-miri-reconcile, miri-contract review M1/M7): `impl Machine for MiriMachine`'s
// associated types and consts (machine.rs:1133-1149) ----

/**
 * PORT (plan-m6 D3): the associated types of `impl Machine<'tcx> for MiriMachine<'tcx>` (machine.rs:1134-1145) as the
 * interpreter's type-level record (rustc_const_eval interpret/machine.ts `MachineTypes`).
 */
export interface MiriMachineTypes extends MachineTypes {
  MemoryKind: MiriMemoryKind;
  Provenance: Provenance;
  ProvenanceExtra: ProvenanceExtra;
  ExtraFnVal: DynSym;
  FrameExtra: gen.FrameExtra;
  AllocExtra: AllocExtra;
  Bytes: MiriAllocBytes;
  /** `<MiriAllocBytes as AllocBytes>::AllocParams` (alloc/alloc_bytes.rs:109). */
  AllocParams: MiriAllocParams;
  MemoryMap: MonoHashMap<AllocId, [gen.MemoryKind, Allocation<Provenance, AllocExtra, MiriAllocBytes>]>;
}

// PORT (plan-m6 D3): `MiriMachine` implements `Machine<MiriMachineTypes>` by declaration merging on the generated class.
// The impl's associated types and consts are prototype members (`define_assoc` below); its fns (machine.rs:1152-2127)
// are prototype methods of `MiriMachine` (after `MiriInterpCxExt` below; the hook `stack` is `stack_` in the port); the
// provided fns it does not override are `Machine_provided`'s (`provide_defaults`).
declare module "./machine.gen.ts" {
  interface MiriMachine extends Machine<MiriMachineTypes> {}
}

define_assoc(
  MiriMachine.prototype,
  {
    // type MemoryKind = MiriMemoryKind;  (its `MayLeak`, `Display` and derived `Eq`)
    MayLeak_MemoryKind: MayLeak_MiriMemoryKind,
    display_MemoryKind: (self: MiriMemoryKind, _f: Fmt): string => display_MiriMemoryKind(self),
    MemoryKind_eq: (a: MiriMemoryKind, b: MiriMemoryKind): boolean => a === b,
    // type Provenance = Provenance;
    Provenance: Provenance_Provenance,
    // type MemoryMap = MonoHashMap<AllocId, (MemoryKind, Allocation<Provenance, Self::AllocExtra, Self::Bytes>)>;
    MemoryMap_default: (): MiriMachineTypes["MemoryMap"] => MonoHashMap.default(),
    // const GLOBAL_KIND: Option<MiriMemoryKind> = Some(MiriMemoryKind::Global);
    GLOBAL_KIND: gen.MiriMemoryKind.Global,
    // const PANIC_ON_ALLOC_FAIL: bool = false;
    PANIC_ON_ALLOC_FAIL: false,
    // (not overridden: the provided `ALL_CONSTS_ARE_PRECHECKED = true`)
    ALL_CONSTS_ARE_PRECHECKED: true,
  },
  {
    // type Bytes = MiriAllocBytes;  (another module's value: read on use, C10)
    Bytes: () => AllocBytes_MiriAllocBytes,
  },
);

// The provided fns of `trait Machine` that machine.rs:1133 overrides (the rest are the defaults).
provide_defaults(MiriMachine.prototype, Machine_provided.prototype, [
  "alignment_check",
  "enforce_validity_recursively",
  "generate_nan",
  "apply_float_nondet",
  "equal_float_min_max",
  "thread_local_static_pointer",
  "before_memory_read",
  "before_memory_write",
  "before_memory_deallocation",
  "retag_ptr_value",
  "with_retag_mode",
  "protect_in_place_function_argument",
  "before_terminator",
  "after_stack_push",
  "before_stack_pop",
  "after_stack_pop",
  "after_local_read",
  "after_local_write",
  "after_local_moved_to_memory",
  "cached_union_data_range",
  "enter_trace_span",
]);

/// A rustc InterpCx for Miri.
// rustc-type: src/tools/miri/src/machine.rs:1114 MiriInterpCx
export type MiriInterpCx = InterpCx<MiriMachine>;

/// A little trait that's useful to be inherited by extension traits.
// PORT: implemented by `InterpCx` (augmentation below); the TS interface is what an extension method's `this` needs.
export interface MiriInterpCxExt {
  // rustc: src/tools/miri/src/machine.rs:1118 eval_context_ref
  eval_context_ref(): MiriInterpCx;
  // rustc: src/tools/miri/src/machine.rs:1119 eval_context_mut
  eval_context_mut(): MiriInterpCx;
}

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- machine.rs: `impl MiriInterpCxExt for MiriInterpCx` (lane miri-contract) ----
    eval_context_ref(this: MiriInterpCx): MiriInterpCx;
    eval_context_mut(this: MiriInterpCx): MiriInterpCx;
  }
}

// impl<'tcx> MiriInterpCxExt<'tcx> for MiriInterpCx<'tcx>
// rustc: src/tools/miri/src/machine.rs:1123 eval_context_ref
InterpCx.prototype.eval_context_ref = function (this: MiriInterpCx): MiriInterpCx {
  return this;
};
// rustc: src/tools/miri/src/machine.rs:1127 eval_context_mut
InterpCx.prototype.eval_context_mut = function (this: MiriInterpCx): MiriInterpCx {
  return this;
};

// ---- `impl<'tcx> Machine<'tcx> for MiriMachine<'tcx>` (machine.rs:1133): the fns (prototype methods, `M::f(ecx, ..)` is
// `ecx.machine.f(ecx, ..)`; the associated types / consts and the provided defaults are above) ----

/// Machine hook implementations.
// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1152 enforce_alignment
MiriMachine.prototype.enforce_alignment = function (this: MiriMachine, ecx: MiriInterpCx): boolean {
  return ecx.machine.check_alignment !== "None";
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1157 alignment_check
MiriMachine.prototype.alignment_check = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  alloc_id: AllocId,
  alloc_align: Align,
  alloc_kind: AllocKind,
  offset: Size,
  align: Align,
): Misalignment | undefined {
  if (ecx.machine.check_alignment !== "Symbolic") {
    // Just use the built-in check.
    return undefined;
  }
  if (alloc_kind !== "LiveData") {
    // Can't have any extra info here.
    return undefined;
  }
  // Let's see which alignment we have been promised for this allocation.
  const [promised_offset, promised_align] = ecx.machine.symbolic_alignment.get(alloc_id) ?? [Size.ZERO, alloc_align];
  if (promised_align.pow2 < align.pow2) {
    // Definitely not enough.
    return { has: promised_align, required: align };
  } else {
    // What's the offset between us and the promised alignment?
    // PORT: `u64::wrapping_sub` on the bigint byte counts.
    const distance = BigInt.asUintN(64, offset.bytes_u64() - promised_offset.bytes_u64());
    // That must also be aligned.
    if (distance % BigInt(align.bytes()) === 0n) {
      // All looking good!
      return undefined;
    } else {
      // The biggest power of two through which `distance` is divisible.
      const distance_pow2 = 1n << BigInt(u64_trailing_zeros(distance));
      return {
        has: unwrap_result(Align.from_bytes(distance_pow2), debug_AlignFromBytesError),
        required: align,
      };
    }
  }
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1203 enforce_validity
MiriMachine.prototype.enforce_validity = function (this: MiriMachine, ecx: MiriInterpCx, _layout: TyAndLayout): boolean {
  return ecx.machine.validation !== "No";
};
// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1207 enforce_validity_recursively
MiriMachine.prototype.enforce_validity_recursively = function (this: MiriMachine, ecx: MiriInterpCx, _layout: TyAndLayout): boolean {
  return ecx.machine.validation === "Deep";
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1215 ignore_optional_overflow_checks
MiriMachine.prototype.ignore_optional_overflow_checks = function (this: MiriMachine, ecx: MiriInterpCx): boolean {
  return !ecx.tcx.deref().sess.overflow_checks();
};

// rustc: src/tools/miri/src/machine.rs:1219 check_fn_target_features
MiriMachine.prototype.check_fn_target_features = function (this: MiriMachine, ecx: MiriInterpCx, instance: Instance): InterpResult {
  const tcx = ecx.tcx.deref();
  const attrs = TyCtxt_codegen_instance_attrs(tcx, instance.def);
  if (attrs.target_features.some((feature) => !tcx.sess.internal_target_features.has(feature.name))) {
    let unavailable = "";
    for (const feature of attrs.target_features) {
      if (!(feature.kind !== "Implied" && !tcx.sess.internal_target_features.has(feature.name))) continue;
      if (unavailable.length !== 0) {
        unavailable += ", ";
      }
      unavailable += Symbol.as_str(feature.name);
    }
    const msg = `calling a function that requires unavailable target features: ${unavailable}`;
    // On WASM, this is not UB, but instead gets rejected during validation of the module
    // (see #84988).
    if (tcx.sess.target.is_like_wasm) {
      // throw_machine_stop!(TerminationInfo::Abort(msg));
      return throw_machine_stop({ $: "Abort", _0: msg });
    } else {
      // throw_ub_format!("{msg}");
      return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(msg)));
    }
  }
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1258 find_mir_or_eval_fn
MiriMachine.prototype.find_mir_or_eval_fn = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  instance: Instance,
  abi: FnAbi<Ty>,
  args: readonly FnArg[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult<[Body, Instance] | undefined> {
  // For foreign items, try to see if we can emulate them.
  if (ecx.tcx.deref().is_foreign_item(Instance.def_id(instance))) {
    // let _trace = enter_trace_span!("emulate_foreign_item");
    // An external function call that does not have a MIR body. We either find MIR elsewhere
    // or emulate its effect.
    // This will be Ok(None) if we're emulating the intrinsic entirely within Miri (no need
    // to run extra MIR), and Ok(Some(body)) if we found MIR to run for the
    // foreign function
    // Any needed call to `goto_block` will be performed by `emulate_foreign_item`.
    const args_ = ecx.copy_fn_args(args); // FIXME: Should `InPlace` arguments be reset to uninit?
    const link_name = Symbol.intern((ecx.tcx.deref().symbol_name(instance) as SymbolName).name);
    return ecx.emulate_foreign_item(link_name, abi, args_, dest, ret, unwind);
  }

  if (GlobalDataRaceHandler_().as_genmc_ref(ecx.machine.data_race) !== undefined) {
    // PORT(contract): genmc/dummy.ts declares `_args` as `Pending<FnArg>[]`; the values are this hook's `FnArg`s.
    const r = ecx.genmc_intercept_function(instance, args as unknown as Parameters<MiriInterpCx["genmc_intercept_function"]>[1], dest);
    if (r.$ === "Err") return r;
    if (r._0) {
      const r2 = ecx.return_to_block(ret);
      if (r2.$ === "Err") return r2;
      return interp_ok(undefined);
    }
  }

  // Otherwise, load the MIR.
  // let _trace = enter_trace_span!("load_mir");
  const body = ecx.load_mir(instance.def, undefined);
  if (body.$ === "Err") return body;
  return interp_ok<[Body, Instance] | undefined>([body._0, instance]);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1294 call_extra_fn
MiriMachine.prototype.call_extra_fn = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  fn_val: DynSym,
  abi: FnAbi<Ty>,
  args: readonly FnArg[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult {
  const args_ = ecx.copy_fn_args(args); // FIXME: Should `InPlace` arguments be reset to uninit?
  return ecx.emulate_dyn_sym(fn_val, abi, args_, dest, ret, unwind);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1308 call_intrinsic
MiriMachine.prototype.call_intrinsic = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  instance: Instance,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult<Instance | undefined> {
  return ecx.call_intrinsic(instance, args, dest, ret, unwind);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1320 call_llvm_intrinsic
MiriMachine.prototype.call_llvm_intrinsic = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  instance: Instance,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
): InterpResult {
  return ecx.call_llvm_intrinsic(instance, args, dest, ret);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1331 assert_panic
MiriMachine.prototype.assert_panic = function (this: MiriMachine, ecx: MiriInterpCx, msg: AssertMessage, unwind: UnwindAction): InterpResult {
  return ecx.assert_panic(msg, unwind);
};

// rustc: src/tools/miri/src/machine.rs:1339 panic_nounwind
MiriMachine.prototype.panic_nounwind = function (this: MiriMachine, ecx: MiriInterpCx, msg: string): InterpResult {
  return ecx.start_panic_nounwind(msg);
};

// rustc: src/tools/miri/src/machine.rs:1343 unwind_terminate
MiriMachine.prototype.unwind_terminate = function (this: MiriMachine, ecx: MiriInterpCx, reason: UnwindTerminateReason): InterpResult {
  // Call the lang item.
  const panic_ = unwrap(ecx.tcx.deref().lang_items().get(UnwindTerminateReason.lang_item(reason)));
  const panic_instance = Instance.mono(ecx.tcx.tcx, panic_);
  const r = ecx.call_function(panic_instance, ExternAbiC.Rust, [], undefined, { $: "Goto", ret: undefined, unwind: UnwindAction.Unreachable });
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1361 binary_ptr_op
MiriMachine.prototype.binary_ptr_op = function (this: MiriMachine, ecx: MiriInterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  // PORT (decision miri-contract C8): Miri's `operator::EvalContextExt::binary_ptr_op` is `binary_ptr_op_`.
  return ecx.binary_ptr_op_(bin_op, left, right);
};

// rustc: src/tools/miri/src/machine.rs:1370 atomic_load
MiriMachine.prototype.atomic_load = function (this: MiriMachine, ecx: MiriInterpCx, place: MPlaceTy, ordering: AtomicOrdering): InterpResult<Scalar> {
  return ecx.read_scalar_atomic(place, AtomicReadOrd_().from(ordering));
};

// rustc: src/tools/miri/src/machine.rs:1378 atomic_store
MiriMachine.prototype.atomic_store = function (this: MiriMachine, ecx: MiriInterpCx, place: MPlaceTy, val: ImmTy, ordering: AtomicOrdering): InterpResult {
  return ecx.write_scalar_atomic(imm_to_scalar(val.imm), place, AtomicWriteOrd_().from(ordering));
};

// rustc: src/tools/miri/src/machine.rs:1387 atomic_rmw
MiriMachine.prototype.atomic_rmw = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  place: MPlaceTy,
  op: AtomicRmwOp,
  operand: ImmTy,
  ordering: AtomicOrdering,
): InterpResult<Scalar> {
  return ecx.atomic_rmw(place, operand, op, AtomicRwOrd_().from(ordering));
};

// rustc: src/tools/miri/src/machine.rs:1397 atomic_compare_exchange
MiriMachine.prototype.atomic_compare_exchange = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  place: MPlaceTy,
  expected_old: ImmTy,
  new_: ImmTy,
  can_fail_spuriously: boolean,
  success_ordering: AtomicOrdering,
  failure_ordering: AtomicOrdering,
): InterpResult<[Scalar, boolean]> {
  return ecx.atomic_compare_exchange(
    place,
    expected_old,
    imm_to_scalar(new_.imm),
    AtomicRwOrd_().from(success_ordering),
    AtomicReadOrd_().from(failure_ordering),
    can_fail_spuriously,
  );
};

// rustc: src/tools/miri/src/machine.rs:1416 atomic_fence
MiriMachine.prototype.atomic_fence = function (this: MiriMachine, ecx: MiriInterpCx, ordering: AtomicOrdering, singlethread: boolean): InterpResult {
  if (singlethread) {
    // We don't support signal handlers or interrupts so this is a NOP.
    return interp_ok(undefined);
  }
  return ecx.atomic_fence(AtomicFenceOrd_().from(ordering));
};

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // PORT(contract): pending lane miri-eval. `operator::EvalContextExt::generate_nan::<F1, F2>` (operator.rs) constructs an
    // `F2`, so it takes `F2`'s `FloatType` dictionary as the trailing parameter (interpret/machine.ts header: `generate_nan(ecx,
    // inputs, F2_)`); operator.ts declares it without. This overload is the signature the hook calls.
    generate_nan<F1, F2 extends Float<F2>>(this: MiriInterpCx, inputs: readonly F1[], F2_: FloatType<F2>): F2;
  }
}

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1429 generate_nan
MiriMachine.prototype.generate_nan = function <F1, F2 extends Float<F2>>(this: MiriMachine, ecx: MiriInterpCx, inputs: readonly F1[], F2_: FloatType<F2>): F2 {
  // PORT: `F2: Float` is the trailing dictionary (interpret/machine.ts header); Miri's `generate_nan` takes it too.
  return ecx.generate_nan<F1, F2>(inputs, F2_);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1437 apply_float_nondet
MiriMachine.prototype.apply_float_nondet = function (this: MiriMachine, ecx: MiriInterpCx, val: ImmTy): InterpResult<ImmTy> {
  return apply_random_float_error_to_imm(ecx, val, 4);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1445 equal_float_min_max
MiriMachine.prototype.equal_float_min_max = function <F>(this: MiriMachine, ecx: MiriInterpCx, a: F, b: F): F {
  return ecx.equal_float_min_max(a, b);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1450 float_fuse_mul_add
MiriMachine.prototype.float_fuse_mul_add = function (this: MiriMachine, ecx: MiriInterpCx): boolean {
  return ecx.machine.float_nondet && RngExt.random(ecx.machine.rng, StandardUniform_bool);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1455 runtime_checks
MiriMachine.prototype.runtime_checks = function (this: MiriMachine, ecx: MiriInterpCx, r: RuntimeChecks): InterpResult<boolean> {
  return interp_ok(RuntimeChecks.value(r, ecx.tcx.deref().sess));
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1463 thread_local_static_pointer
MiriMachine.prototype.thread_local_static_pointer = function (this: MiriMachine, ecx: MiriInterpCx, def_id: DefId): InterpResult<StrictPointer> {
  return ecx.get_or_create_thread_local_alloc(def_id);
};

// rustc: src/tools/miri/src/machine.rs:1470 extern_static_pointer
MiriMachine.prototype.extern_static_pointer = function (this: MiriMachine, ecx: MiriInterpCx, def_id: DefId): InterpResult<StrictPointer> {
  const tcx = ecx.tcx.deref();
  const link_name = Symbol.intern((tcx.symbol_name(Instance.mono(tcx, def_id)) as SymbolName).name);
  const def_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
  const extern_decl_layout = unwrap_result(tcx.layout_of(ecx.typing_env_().as_query_input(def_ty)) as Result<TyAndLayout, LayoutError>, debug_LayoutError_ref);

  // Look up the `ptr` in the right map, depending on whether this is an "import"
  // static or a real one.
  let ptr: StrictPointer | undefined;
  if ((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).import_linkage === undefined) {
    ptr = ecx.machine.extern_statics.get(link_name);
  } else {
    ptr = ecx.machine.extern_statics_imports.get(link_name);
  }
  if (ptr !== undefined) {
    const r = ecx.check_shim_symbol_clash(link_name);
    if (r.$ === "Err") return r;
    // Various parts of the engine rely on `get_alloc_info` for size and alignment
    // information. That uses the type information of this static.
    // Make sure it matches the Miri allocation for this.
    const prov = ptr.provenance;
    if (prov.$ !== "Concrete") {
      return panic("extern_statics cannot contain wildcards");
    }
    const alloc_id = prov.alloc_id;
    const info = ecx.get_alloc_info(alloc_id);
    if (Size_cmp(extern_decl_layout.size, info.size) > 0 || extern_decl_layout.align.abi.pow2 > info.align.pow2) {
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub_format(
            `extern static \`${Symbol.as_str(link_name)}\` has been declared as \`${Symbol.as_str(tcx.crate_name(def_id.krate))}::${tcx.def_path_str(def_id)}\` ` +
              `with a size of ${extern_decl_layout.size.bytes()} bytes and alignment of ${extern_decl_layout.align.abi.bytes()} bytes, ` +
              `but Miri emulates it via an extern static shim ` +
              `with a size of ${info.size.bytes()} bytes and alignment of ${info.align.bytes()} bytes`,
          ),
        ),
      );
    }
    return interp_ok(ptr);
  } else if ((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).import_linkage === "ExternalWeak") {
    // Symbols with weak linkage default to null if they are not defined. However we can't
    // create new allocations here. On the plus side we know rustc rejects non-ptr-sized
    // weak statics so we can just use a single global "null" allocation for all of them.
    // The memory we are assigning this address to is anyway somewhat "fake", it's an
    // indirection introduced by how Rust represents external symbols with linkage (see
    // <https://github.com/rust-lang/rust/issues/156468>). So we can just specify that such
    // memory does not have unique addresses, despite being technically a `static`.
    assert_eq_msg(extern_decl_layout.size, tcx.data_layout().pointer_size(), Size_eq, debug_Size, () => "non-pointer-sized weak static");
    return interp_ok(expect(ecx.machine.extern_static_weak_import_default, "`missing_weak_symbol` should have been initialized"));
  } else {
    // Look for a Rust static with this symbol name in the crate graph.
    const instance_r = ecx.lookup_exported_static(link_name);
    if (instance_r.$ === "Err") return instance_r;
    const instance = instance_r._0;
    if (instance === undefined) {
      // throw_unsup_format!("extern static `{link_name}` is not supported by Miri");
      return Err(InterpErrorInfo_from_InterpErrorKind(err_unsup_format(`extern static \`${Symbol.as_str(link_name)}\` is not supported by Miri`)));
    }
    // Evaluate the static to get its allocation.
    const place = ecx.eval_global(instance);
    if (place.$ === "Err") return place;
    // PORT (plan-m6 D3): `eval_global` is typed with the CTFE defaults (interpret/machine.ts header); the place is Miri's.
    const static_ptr = unwrap_result((place._0 as unknown as MPlaceTy).ptr().into_pointer_or_addr(), debug_Size);
    // Validate the allocation matches the declared size and alignment.
    const alloc_id = unwrap(Provenance_Provenance.get_alloc_id(static_ptr.provenance));
    const info = ecx.get_alloc_info(alloc_id);
    if (Size_cmp(extern_decl_layout.size, info.size) > 0 || extern_decl_layout.align.abi.pow2 > info.align.pow2) {
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub_format(
            `extern static \`${Symbol.as_str(link_name)}\` has been declared as \`${Symbol.as_str(tcx.crate_name(def_id.krate))}::${tcx.def_path_str(def_id)}\` ` +
              `with a size of ${extern_decl_layout.size.bytes()} bytes and alignment of ${extern_decl_layout.align.abi.bytes()} bytes, ` +
              `but the exported static with that name has a size of ${info.size.bytes()} bytes and ` +
              `alignment of ${info.align.bytes()} bytes`,
          ),
        ),
      );
    }
    // Check that the mutability of the declared static matches that of the backing.
    // If the backing static can be modified (because it is a `static mut`, or because
    // it is a `static` whose type has interior mutability) while the declaration here
    // is a non-mut `static` with a `Freeze` type, then the compiler's assumption that
    // the value never changes may be violated, so this may cause UB.
    // This is somehow defensive, as the allocation might be mutable but no mutation
    // ever happens, but this is probably the most precise thing we can do.
    // Specially, the second case is very defensive and we may be able to lift it.
    const def_kind = tcx.def_kind(def_id);
    if (def_kind.$ !== "Static") {
      return unreachable(`internal error: entered unreachable code: \`${debug_DefId(def_id, PLAIN)}\` is not a static`);
    }
    const mutability = def_kind.mutability;
    const decl_is_mut = !(mutability === "Not" && ecx.type_is_freeze(extern_decl_layout.ty));
    const backing_r = ecx.get_alloc_mutability(alloc_id);
    if (backing_r.$ === "Err") return backing_r;
    const backing_is_mut = backing_r._0 === "Mut";
    if (!decl_is_mut && backing_is_mut) {
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub_format(
            `extern static \`${Symbol.as_str(tcx.crate_name(def_id.krate))}::${tcx.def_path_str(def_id)}\` is declared as an immutable \`static\`, ` +
              `but the backing static is mutable`,
          ),
        ),
      );
    }
    if (decl_is_mut && !backing_is_mut) {
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub_format(
            `extern static \`${Symbol.as_str(tcx.crate_name(def_id.krate))}::${tcx.def_path_str(def_id)}\` is declared as an mutable \`static\`, ` +
              `but the backing static is immutable`,
          ),
        ),
      );
    }
    return interp_ok(static_ptr);
  }
};

// rustc: src/tools/miri/src/machine.rs:1586 init_local_allocation
MiriMachine.prototype.init_local_allocation = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  id: AllocId,
  kind: MemoryKind,
  size: Size,
  align: Align,
): InterpResult<AllocExtra> {
  assert(!(kind.$ === "Machine" && kind._0 === "Global"), "assertion failed: kind != MiriMemoryKind::Global.into()");
  return MiriMachine.init_allocation(ecx, id, kind, size, align);
};

// PORT(contract): upstream's hook takes the tcx pointer (`ptr: interpret::Pointer<CtfeProvenance>`, interpret/machine.rs:442;
// memory.ts passes `Pointer_from_AllocId(id)`); the port's `Machine` interface types it `Pointer<Self::Provenance>`, so the
// assignment is cast (reported for root in docs/handoff/miri-machine.md).
// rustc: src/tools/miri/src/machine.rs:1597 adjust_alloc_root_pointer
(MiriMachine.prototype as { adjust_alloc_root_pointer: unknown }).adjust_alloc_root_pointer = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  ptr: interpret_Pointer<CtfeProvenance>,
  kind: MemoryKind | undefined,
): InterpResult<interpret_Pointer<Provenance>> {
  const kind_ = expect(kind, "we set our GLOBAL_KIND so this cannot be None");
  const alloc_id = CtfeProvenance.alloc_id(ptr.provenance);
  // if cfg!(debug_assertions) { .. }  (rustc ships without debug assertions: the release oracle skips it)
  // The machine promises to never call us on thread-local or extern statics.
  // FIXME: can we somehow preserve the immutability of `ptr`?
  let tag: BorTag;
  const borrow_tracker = ecx.machine.borrow_tracker;
  if (borrow_tracker !== undefined) {
    tag = borrow_tracker.root_ptr_tag(alloc_id, ecx.machine);
  } else {
    // Value does not matter, SB is disabled
    tag = BorTag.default();
  }
  return ecx.adjust_alloc_root_pointer(ptr, tag, kind_);
};

/// Called on `usize as ptr` casts.
// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1628 ptr_from_addr_cast
MiriMachine.prototype.ptr_from_addr_cast = function (this: MiriMachine, ecx: MiriInterpCx, addr: bigint): InterpResult<Pointer> {
  return ecx.ptr_from_addr_cast(addr);
};

/// Called on `ptr as usize` casts.
/// (Actually computing the resulting `usize` doesn't need machine help,
/// that's just `Scalar::try_to_int`.)
// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1636 expose_provenance
MiriMachine.prototype.expose_provenance = function (this: MiriMachine, ecx: MiriInterpCx, provenance: Provenance): InterpResult {
  return ecx.expose_provenance(provenance);
};

/// Convert a pointer with provenance into an allocation-offset pair and extra provenance info.
/// `size` says how many bytes of memory are expected at that pointer. The *sign* of `size` can
/// be used to disambiguate situations where a wildcard pointer sits right in between two
/// allocations.
///
/// If `ptr.provenance.get_alloc_id()` is `Some(p)`, the returned `AllocId` must be `p`.
/// The resulting `AllocId` will just be used for that one step and the forgotten again
/// (i.e., we'll never turn the data returned here back into a `Pointer` that might be
/// stored in machine state).
///
/// When this fails, that means the pointer does not point to a live allocation.
// rustc: src/tools/miri/src/machine.rs:1654 ptr_get_alloc
MiriMachine.prototype.ptr_get_alloc = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  ptr: StrictPointer,
  size: bigint,
): [AllocId, Size, ProvenanceExtra] | undefined {
  const rel = ecx.ptr_get_alloc(ptr, size);

  if (rel === undefined) return undefined;
  const [alloc_id, size_] = rel;
  let tag: ProvenanceExtra;
  const prov = ptr.provenance;
  switch (prov.$) {
    case "Concrete":
      tag = { $: "Concrete", _0: prov.tag };
      break;
    case "Wildcard":
      tag = ProvenanceExtra.Wildcard;
      break;
  }
  return [alloc_id, size_, tag];
};

/// Called to adjust global allocations to the Provenance and AllocExtra of this machine.
///
/// If `alloc` contains pointers, then they are all pointing to globals.
///
/// This should avoid copying if no work has to be done! If this returns an owned
/// allocation (because a copy had to be done to adjust things), machine memory will
/// cache the result. (This relies on `AllocMap::get_or` being able to add the
/// owned allocation to the map even when the map is shared.)
// rustc: src/tools/miri/src/machine.rs:1678 adjust_global_allocation
MiriMachine.prototype.adjust_global_allocation = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  id: AllocId,
  alloc: Allocation,
): InterpResult<Cow<Allocation<Provenance, AllocExtra, MiriAllocBytes>>> {
  const alloc_r = alloc.adjust_from_tcx<Provenance, MiriAllocBytes>(
    ecx.tcx.deref(),
    (bytes, align) => ecx.get_global_alloc_bytes(id, bytes, align),
    // PORT (plan-m6 D3): `global_root_pointer` takes the tcx pointer (`Pointer<CtfeProvenance>`); its body is CTFE-typed.
    (ptr) => ecx.global_root_pointer(ptr as unknown as StrictPointer),
  );
  if (alloc_r.$ === "Err") return alloc_r;
  const alloc_ = alloc_r._0;
  const kind = MemoryKind_from_MiriMemoryKind("Global");
  const extra = MiriMachine.init_allocation(ecx, id, kind, alloc_.size(), alloc_.align);
  if (extra.$ === "Err") return extra;
  return interp_ok(Cow.Owned(alloc_.with_extra(extra._0)));
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1695 before_memory_read
MiriMachine.prototype.before_memory_read = function (
  this: MiriMachine,
  _tcx: TyCtxtAt,
  machine: MiriMachine,
  alloc_extra: AllocExtra,
  ptr: Pointer,
  [alloc_id, prov_extra]: [AllocId, ProvenanceExtra],
  range: AllocRange,
): InterpResult {
  if (machine.track_alloc_accesses && machine.tracked_alloc_ids.has(alloc_id)) {
    machine.emit_diagnostic({ $: "AccessedAlloc", _0: alloc_id, _1: range, _2: "Read" });
  }
  // The order of checks is deliberate, to prefer reporting a data race over a borrow tracker error.
  const global_data_race = machine.data_race;
  switch (global_data_race.$) {
    case "None":
      break;
    case "Genmc": {
      const r = global_data_race._0.memory_load(machine, ptr.addr(Provenance_Provenance), range.size);
      if (r.$ === "Err") return r;
      break;
    }
    case "Vclocks": {
      // let _trace = enter_trace_span!(data_race::before_memory_read);
      const alloc_data_race = alloc_extra.data_race;
      if (alloc_data_race.$ !== "Vclocks") {
        return unreachable();
      }
      const data_race = alloc_data_race._0;
      const r = data_race.read_non_atomic(alloc_id, range, "Read", undefined, machine);
      if (r.$ === "Err") return r;
      break;
    }
  }
  const borrow_tracker = alloc_extra.borrow_tracker;
  if (borrow_tracker !== undefined) {
    const r = AllocState_().before_memory_read(borrow_tracker, alloc_id, prov_extra, range, machine);
    if (r.$ === "Err") return r;
  }
  // Check if there are any sync objects that would like to prevent reading this memory.
  // PORT: (perf) the emptiness test skips building the range of an empty map (no sync objects: the usual case).
  if (alloc_extra.sync_objs.size !== 0) {
    for (const [_offset, obj] of btree_range(alloc_extra.sync_objs, range.start, range.end())) {
      const r = obj.on_access("Read");
      if (r.$ === "Err") return r;
    }
  }

  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1736 before_memory_write
MiriMachine.prototype.before_memory_write = function (
  this: MiriMachine,
  _tcx: TyCtxtAt,
  machine: MiriMachine,
  alloc_extra: AllocExtra,
  ptr: Pointer,
  [alloc_id, prov_extra]: [AllocId, ProvenanceExtra],
  range: AllocRange,
): InterpResult {
  if (machine.track_alloc_accesses && machine.tracked_alloc_ids.has(alloc_id)) {
    machine.emit_diagnostic({ $: "AccessedAlloc", _0: alloc_id, _1: range, _2: "Write" });
  }
  const global_data_race = machine.data_race;
  switch (global_data_race.$) {
    case "None":
      break;
    case "Genmc": {
      const r = global_data_race._0.memory_store(machine, ptr.addr(Provenance_Provenance), range.size);
      if (r.$ === "Err") return r;
      break;
    }
    case "Vclocks": {
      // let _trace = enter_trace_span!(data_race::before_memory_write);
      const alloc_data_race = alloc_extra.data_race;
      if (alloc_data_race.$ !== "Vclocks") {
        return unreachable();
      }
      const data_race = alloc_data_race._0;
      const weak_memory = alloc_data_race._1;
      const r = data_race.write_non_atomic(alloc_id, range, "Write", undefined, machine);
      if (r.$ === "Err") return r;
      if (weak_memory !== undefined) {
        // PORT(contract): weak_memory.ts declares `global` as `Pending<DataRaceState>` (= `data_race::GlobalState`).
        weak_memory.non_atomic_write(range, unwrap(GlobalDataRaceHandler_().as_vclocks_ref(machine.data_race)) as unknown as Parameters<StoreBufferAlloc["non_atomic_write"]>[1]);
      }
      break;
    }
  }
  const borrow_tracker = alloc_extra.borrow_tracker;
  if (borrow_tracker !== undefined) {
    const r = AllocState_().before_memory_write(borrow_tracker, alloc_id, prov_extra, range, machine);
    if (r.$ === "Err") return r;
  }
  // Delete sync objects that don't like writes.
  // Most of the time, we can just skip this.
  if (alloc_extra.sync_objs.size !== 0) {
    const to_delete: Size[] = [];
    for (const [offset, obj] of btree_range(alloc_extra.sync_objs, range.start, range.end())) {
      const r = obj.on_access("Write");
      if (r.$ === "Err") return r;
      if (obj.delete_on_write()) {
        to_delete.push(offset);
      }
    }
    for (const offset of to_delete) {
      alloc_extra.sync_objs.delete(offset);
    }
  }
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1790 before_memory_deallocation
MiriMachine.prototype.before_memory_deallocation = function (
  this: MiriMachine,
  _tcx: TyCtxtAt,
  machine: MiriMachine,
  alloc_extra: AllocExtra,
  ptr: Pointer,
  [alloc_id, prove_extra]: [AllocId, ProvenanceExtra],
  size: Size,
  align: Align,
  kind: MemoryKind,
): InterpResult {
  if (machine.tracked_alloc_ids.has(alloc_id)) {
    machine.emit_diagnostic({ $: "FreedAlloc", _0: alloc_id });
  }
  const global_data_race = machine.data_race;
  switch (global_data_race.$) {
    case "None":
      break;
    case "Genmc": {
      const r = global_data_race._0.handle_dealloc(machine, alloc_id, ptr.addr(Provenance_Provenance), kind);
      if (r.$ === "Err") return r;
      break;
    }
    case "Vclocks": {
      // let _trace = enter_trace_span!(data_race::before_memory_deallocation);
      const data_race = unwrap(AllocDataRaceHandler_().as_vclocks_mut(alloc_extra.data_race));
      const r = data_race.write_non_atomic(alloc_id, alloc_range(Size.ZERO, size), "Deallocate", undefined, machine);
      if (r.$ === "Err") return r;
      break;
    }
  }
  const borrow_tracker = alloc_extra.borrow_tracker;
  if (borrow_tracker !== undefined) {
    const r = AllocState_().before_memory_deallocation(borrow_tracker, alloc_id, prove_extra, size, machine);
    if (r.$ === "Err") return r;
  }
  // Check if there are any sync objects that would like to prevent freeing this memory.
  // PORT: `BTreeMap::values()` is in key order (`btree_range` over every key); (perf) an empty map is skipped.
  if (alloc_extra.sync_objs.size !== 0) {
    for (const [_offset, obj] of btree_range(alloc_extra.sync_objs, undefined, undefined)) {
      const r = obj.on_access("Dealloc");
      if (r.$ === "Err") return r;
    }
  }

  const spans = machine.allocation_spans.get(alloc_id);
  if (spans !== undefined) {
    // *deallocated_at = Some(machine.current_user_relevant_span());
    spans[1] = machine.current_user_relevant_span();
  }
  machine.free_alloc_id(alloc_id, size, align, kind);
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1836 retag_ptr_value
MiriMachine.prototype.retag_ptr_value = function (this: MiriMachine, ecx: MiriInterpCx, val: ImmTy, ty: Ty): InterpResult<ImmTy | undefined> {
  if (ecx.machine.borrow_tracker !== undefined) {
    return ecx.retag_ptr_value(val, ty);
  } else {
    return interp_ok(undefined);
  }
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1849 with_retag_mode
MiriMachine.prototype.with_retag_mode = function <T>(
  this: MiriMachine,
  ecx: MiriInterpCx,
  mode: RetagMode,
  f: (ecx: MiriInterpCx) => InterpResult<T>,
): InterpResult<T> {
  if (ecx.machine.borrow_tracker !== undefined) {
    return ecx.with_retag_mode(mode, f);
  } else {
    return f(ecx);
  }
};

// rustc: src/tools/miri/src/machine.rs:1857 protect_in_place_function_argument
MiriMachine.prototype.protect_in_place_function_argument = function (this: MiriMachine, ecx: MiriInterpCx, place: MPlaceTy): InterpResult {
  // If we have a borrow tracker, we also have it set up protection so that all reads *and
  // writes* during this call are insta-UB.
  let protected_place: MPlaceTy;
  if (ecx.machine.borrow_tracker !== undefined) {
    const r = ecx.protect_place(place);
    if (r.$ === "Err") return r;
    protected_place = r._0;
  } else {
    // No borrow tracker.
    // PORT: `place.clone()`: interpreter places are never mutated in place (interpret/place.ts), so the value is shared.
    protected_place = place;
  }
  // We do need to write `uninit` so that even after the call ends, the former contents of
  // this place cannot be observed any more. We do the write after retagging so that for
  // Tree Borrows, this is considered to activate the new tag.
  // Conveniently this also ensures that the place actually points to suitable memory.
  const r = ecx.write_uninit(protected_place);
  if (r.$ === "Err") return r;
  // Now we throw away the protected place, ensuring its tag is never used again.
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1879 init_frame
MiriMachine.prototype.init_frame = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  frame: Frame<Provenance>,
): InterpResult<Frame<Provenance, gen.FrameExtra>> {
  // Start recording our event before doing anything else
  let timing: never | undefined;
  if (ecx.machine.profiler !== undefined) {
    // PORT: `measureme` is not vendored; `MiriMachine::new` never builds a profiler (it stops `unported`).
    timing = unported("miri::machine::MiriMachine::init_frame: measureme profiler");
  } else {
    timing = undefined;
  }

  const borrow_tracker = ecx.machine.borrow_tracker;

  const extra: gen.FrameExtra = {
    borrow_tracker: borrow_tracker === undefined ? undefined : borrow_tracker.new_frame(),
    catch_unwind: undefined,
    timing,
    user_relevance: ecx.machine.user_relevance(frame),
    // data_race::FrameState::default()  (`#[derive(Default)]`)
    data_race: GlobalDataRaceHandler_().as_vclocks_ref(ecx.machine.data_race) === undefined ? undefined : new data_race_FrameState(new Map()),
  };

  return interp_ok(frame.with_extra(extra));
};

// rustc: src/tools/miri/src/machine.rs:1915 stack
MiriMachine.prototype.stack_ = function (this: MiriMachine, ecx: MiriInterpCx): readonly Frame<Provenance, gen.FrameExtra>[] {
  return ecx.active_thread_stack();
};

// rustc: src/tools/miri/src/machine.rs:1921 stack_mut
MiriMachine.prototype.stack_mut = function (this: MiriMachine, ecx: MiriInterpCx): Frame<Provenance, gen.FrameExtra>[] {
  return ecx.active_thread_stack_mut();
};

// rustc: src/tools/miri/src/machine.rs:1927 before_terminator
MiriMachine.prototype.before_terminator = function (this: MiriMachine, ecx: MiriInterpCx): InterpResult {
  // PORT (decision miri-contract C5 amendment): `basic_block_count` is a number (machine.ts header).
  ecx.machine.basic_block_count += 1; // a u64 that is only incremented by 1 will "never" overflow
  ecx.machine.since_gc += 1;
  // Possibly report our progress. This will point at the terminator we are about to execute.
  const report_progress = ecx.machine.report_progress;
  if (report_progress !== undefined) {
    if (ecx.machine.basic_block_count % report_progress === 0) {
      ecx.emit_diagnostic({ $: "ProgressReport", block_count: BigInt(ecx.machine.basic_block_count) });
    }
  }

  // Search for BorTags to find all live pointers, then remove all other tags from borrow
  // stacks. Also clean up dropped readiness watchers from the global readiness interest
  // table and closed source file descriptions in the blocking I/O manager.
  // When debug assertions are enabled, run the GC as often as possible so that any cases
  // where it mistakenly removes an important tag become visible.
  if (ecx.machine.gc_interval > 0 && ecx.machine.since_gc >= ecx.machine.gc_interval) {
    ecx.machine.since_gc = 0;
    ecx.run_provenance_gc();
    ecx.machine.blocking_io.run_gc();
  }

  // These are our preemption points.
  // (This will only take effect after the terminator has been executed.)
  ecx.maybe_preempt_active_thread();

  // Make sure some time passes.
  ecx.machine.monotonic_clock.tick();

  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1961 after_stack_push
MiriMachine.prototype.after_stack_push = function (this: MiriMachine, ecx: MiriInterpCx): InterpResult {
  if (frame_(ecx).extra.user_relevance >= ecx.active_thread_ref().current_user_relevance()) {
    // We just pushed a frame that's at least as relevant as the so-far most relevant frame.
    // That means we are now the most relevant frame.
    const stack_len = ecx.active_thread_stack().length;
    ecx.active_thread_mut().set_top_user_relevant_frame(stack_len - 1);
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/machine.rs:1971 before_stack_pop
MiriMachine.prototype.before_stack_pop = function (this: MiriMachine, ecx: MiriInterpCx): InterpResult {
  const frame = frame_(ecx);
  // We want this *before* the return value copy, because the return place itself is protected
  // until we do `on_stack_pop` here, and we need to un-protect it to copy the return value.
  if (ecx.machine.borrow_tracker !== undefined) {
    const r = ecx.on_stack_pop(frame);
    if (r.$ === "Err") return r;
  }
  if (
    expect(ecx.active_thread_ref().top_user_relevant_frame_(), "there should always be a most relevant frame for a non-empty stack") ===
    ecx.frame_idx()
  ) {
    // We are popping the most relevant frame. We have no clue what the next relevant frame
    // below that is, so we recompute that.
    // (If this ever becomes a bottleneck, we could have `push` store the previous
    // user-relevant frame and restore that here.)
    // We have to skip the frame that is just being popped.
    ecx.active_thread_mut().recompute_top_user_relevant_frame(/* skip */ 1);
  }
  // tracing-tree can automatically annotate scope changes, but it gets very confused by our
  // concurrency and what it prints is just plain wrong. So we print our own information
  // instead. (Cc https://github.com/rust-lang/miri/issues/2266)
  if (tracing.INFO_ENABLED) tracing.info("miri::machine", () => `Leaving ${display_Instance(frame_(ecx).instance_())}`);
  return interp_ok(undefined);
};

// #[inline(always)]
// rustc: src/tools/miri/src/machine.rs:1999 after_stack_pop
MiriMachine.prototype.after_stack_pop = function (
  this: MiriMachine,
  ecx: MiriInterpCx,
  frame: Frame<Provenance, gen.FrameExtra>,
  unwinding: boolean,
): InterpResult<ReturnAction> {
  let res: InterpResult<ReturnAction>;
  {
    // Move `frame` into a sub-scope so we control when it will be dropped.
    const timing = frame.extra.timing;
    frame.extra.timing = undefined; // frame.extra.timing.take()
    res = ecx.handle_stack_pop_unwind(frame.extra, unwinding);
    if (ecx.machine.profiler !== undefined) {
      // profiler.finish_recording_interval_event(timing.unwrap());
      unported(`miri::machine::MiriMachine::after_stack_pop: measureme profiler (${String(timing)})`);
    }
    // PORT: the end of the sub-scope drops `frame` (`frame.extra` was moved out). Its `tracing_span` exits here
    // (`impl Drop for SpanGuard`), so `Continuing in` prints one level up.
    frame.tracing_span.drop();
  }
  // Needs to be done after dropping frame to show up on the right nesting level.
  // (Cc https://github.com/rust-lang/miri/issues/2266)
  if (ecx.active_thread_stack().length !== 0) {
    if (tracing.INFO_ENABLED) tracing.info("miri::machine", () => `Continuing in ${display_Instance(frame_(ecx).instance_())}`);
  }
  return res;
};

// rustc: src/tools/miri/src/machine.rs:2022 after_local_read
MiriMachine.prototype.after_local_read = function (this: MiriMachine, ecx: MiriInterpCx, local: Local): InterpResult {
  const data_race = frame_(ecx).extra.data_race;
  if (data_race !== undefined) {
    // let _trace = enter_trace_span!(data_race::after_local_read);
    data_race.local_read(local, ecx.machine);
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/machine.rs:2030 after_local_write
MiriMachine.prototype.after_local_write = function (this: MiriMachine, ecx: MiriInterpCx, local: Local, storage_live: boolean): InterpResult {
  const data_race = frame_(ecx).extra.data_race;
  if (data_race !== undefined) {
    // let _trace = enter_trace_span!(data_race::after_local_write);
    data_race.local_write(local, storage_live, ecx.machine);
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/machine.rs:2042 after_local_moved_to_memory
MiriMachine.prototype.after_local_moved_to_memory = function (this: MiriMachine, ecx: MiriInterpCx, local: Local, mplace: MPlaceTy): InterpResult {
  const prov = mplace.ptr().provenance;
  if (prov === undefined || prov.$ !== "Concrete") {
    return panic("after_local_allocated should only be called on fresh allocations");
  }
  const alloc_id = prov.alloc_id;
  // Record the span where this was allocated: the declaration of the local.
  const local_decl = frame_(ecx).body_().local_decls[local]!;
  const span = local_decl.source_info.span;
  ecx.machine.allocation_spans.set(alloc_id, [span, undefined]);
  // The data race system has to fix the clocks used for this write.
  const r = ecx.get_alloc_extra_mut(alloc_id);
  if (r.$ === "Err") return r;
  const [alloc_info, machine] = r._0;
  const stack = machine.threads.active_thread_stack();
  const data_race = unwrap(stack[stack.length - 1]).extra.data_race;
  if (data_race !== undefined) {
    // let _trace = enter_trace_span!(data_race::after_local_moved_to_memory);
    data_race.local_moved_to_memory(local, unwrap(AllocDataRaceHandler_().as_vclocks_mut(alloc_info.data_race)), machine);
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/machine.rs:2069 get_global_alloc_salt
MiriMachine.prototype.get_global_alloc_salt = function (this: MiriMachine, ecx: MiriInterpCx, instance: Instance | undefined): number {
  let unique: boolean;
  if (instance !== undefined) {
    // Functions cannot be identified by pointers, as asm-equal functions can get
    // deduplicated by the linker (we set the "unnamed_addr" attribute for LLVM) and
    // functions can be duplicated across crates. We thus generate a new `AllocId` for every
    // mention of a function. This means that `main as fn() == main as fn()` is false, while
    // `let x = main as fn(); x == x` is true. However, as a quality-of-life feature it can
    // be useful to identify certain functions uniquely, e.g. for backtraces. So we identify
    // whether codegen will actually emit duplicate functions. It does that when they have
    // non-lifetime generics, or when they can be inlined. All other functions are given a
    // unique address. This is not a stable guarantee! The `inline` attribute is a hint and
    // cannot be relied upon for anything. But if we don't do this, the
    // `__rust_begin_short_backtrace`/`__rust_end_short_backtrace` logic breaks and panic
    // backtraces look terrible.
    const is_generic = instance.args.some((arg) => GenericArg.kind(arg).$ !== "Lifetime");
    const tcx = ecx.tcx.deref();
    const can_be_inlined =
      tcx.sess.opts.unstable_opts.cross_crate_inline_threshold.$ === "Always" ||
      TyCtxt_codegen_instance_attrs(tcx, instance.def).inline.$ !== "Never";
    unique = !is_generic && !can_be_inlined;
  } else {
    // Non-functions are never unique.
    unique = false;
  }
  // Always use the same salt if the allocation is unique.
  if (unique) {
    return CTFE_ALLOC_SALT;
  } else {
    return RngExt.random_range(ecx.machine.rng, new Range(SampleUniform_usize, 0, ADDRS_PER_ANON_GLOBAL));
  }
};

// rustc: src/tools/miri/src/machine.rs:2110 cached_union_data_range
MiriMachine.prototype.cached_union_data_range = function (this: MiriMachine, ecx: MiriInterpCx, ty: Ty, compute_range: () => RangeSet): RangeSet {
  // Cow::Borrowed(ecx.machine.union_data_ranges.entry(ty).or_insert_with(compute_range))
  let range = ecx.machine.union_data_ranges.get(ty);
  if (range === undefined) {
    range = compute_range();
    ecx.machine.union_data_ranges.set(ty, range);
  }
  return range;
};

// rustc: src/tools/miri/src/machine.rs:2118 get_default_alloc_params
MiriMachine.prototype.get_default_alloc_params = function (this: MiriMachine): MiriAllocParams {
  // use crate::alloc::MiriAllocParams;

  const alloc = this.allocator;
  if (alloc !== undefined) {
    return { $: "Isolated", _0: alloc };
  } else {
    return MiriAllocParams.Global;
  }
};

// rustc: src/tools/miri/src/machine.rs:2127 enter_trace_span
MiriMachine.prototype.enter_trace_span = function (this: MiriMachine, span: () => unknown): EnteredTraceSpan {
  // #[cfg(feature = "tracing")] { span().entered() }  (the oracle's component is built without `tracing`)
  // #[cfg(not(feature = "tracing"))]
  // let _ = span; // so we avoid the "unused variable" warning
  void span;
  return undefined;
};

/// Trait for callbacks handling asynchronous machine operations.
// PORT: `Box<dyn MachineCallback<'tcx, T>>` is this interface; `callback!` (machine.rs:2171) builds an object with
// `visit_provenance` and `call` (the helper `callback` at the end of the file).
export interface MachineCallback<T> extends VisitProvenance {
  /// The function to be invoked when the callback is fired.
  // rustc: src/tools/miri/src/machine.rs:2144 call
  call(ecx: MiriInterpCx, arg: T): InterpResult; // self: Box<Self>
}

/// Type alias for boxed machine callbacks with generic argument type.
// rustc-type: src/tools/miri/src/machine.rs:2152 DynMachineCallback
export type DynMachineCallback<T> = MachineCallback<T>;

/// Creates a `DynMachineCallback`:
///
/// ```rust
/// callback!(
///     @capture<'tcx> {
///         var1: Ty1,
///         var2: Ty2<'tcx>,
///     }
///     |this, arg: ArgTy| {
///         // Implement the callback here.
///         todo!()
///     }
/// )
/// ```
///
/// All the argument types must implement `VisitProvenance`.
// #[macro_export] macro_rules! callback
// PORT: the macro is this helper. `@capture { name: Ty, .. }` is the object `captures` (moved into the callback, as the
// macro's struct fields); `visit_captures(captures, visit)` is the generated `VisitProvenance` impl (one
// `VisitProvenance::visit_provenance(&self.name, visit)` per capture, in capture order: the caller visits each field with
// its type's impl); `|this, arg: ArgTy| body` is `body(this_, arg, captures)` (the macro's `let Callback { name, .. } =
// *self;` is the caller destructuring `captures`). A callback is called at most once (`self: Box<Self>`).
export function callback<C, T>(
  captures: C,
  visit_captures: (captures: C, visit: VisitWith) => void,
  body: (this_: MiriInterpCx, arg: T, captures: C) => InterpResult,
): DynMachineCallback<T> {
  return {
    // impl VisitProvenance for Callback
    // rustc: src/tools/miri/src/machine.rs:2181 visit_provenance
    visit_provenance(_visit: VisitWith): void {
      visit_captures(captures, _visit);
    },
    // impl MachineCallback<$arg_ty> for Callback
    // rustc: src/tools/miri/src/machine.rs:2189 call
    call(this_: MiriInterpCx, arg: T): InterpResult {
      // #[allow(unused_variables)]
      // let Callback { $($name,)* _phantom } = *self;
      return body(this_, arg, captures);
    },
  };
}

// ---------------------------------------------------------------- private glue of this module ----

/** `throw_ub_format!` / `err_ub_format!(..)` (`err_ub!(Ub(format!(..)))`; interpret/memory.ts precedent). */
function err_ub_format(msg: string): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } };
}
/** `err_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function err_unsup_format(msg: string): InterpErrorKind {
  return { $: "Unsupported", _0: { $: "Unsupported", _0: msg } };
}

/**
 * `throw_machine_stop!(TerminationInfo::..)` (`InterpErrorKind::MachineStop(Box::new(..))`).
 * PORT(contract): pending lane miri-driver. `Box<dyn MachineStopType>` of a `TerminationInfo` needs the
 * `impl MachineStopType for TerminationInfo` (diagnostics.rs:113, with its `Display`/`Debug`), which the skeleton does
 * not declare; until diagnostics.ts provides it (as `MachineStopType_TerminationInfo(info)`), this stops `unported`.
 */
function throw_machine_stop<T>(info: TerminationInfo): InterpResult<T> {
  const box = pending<(info: TerminationInfo) => MachineStopType>(
    diagnostics_ns,
    "MachineStopType_TerminationInfo",
    "miri::diagnostics::TerminationInfo as MachineStopType (lane miri-driver)",
  );
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: box(info) }));
}

/** PORT (plan-m6 D3): `ecx.frame()` of the Miri machine: the `InterpCx` class body is typed with the CTFE defaults
 * (interpret/machine.ts header), the frame is Miri's (`Frame<Provenance, FrameExtra>`). */
function frame_(ecx: MiriInterpCx): Frame<Provenance, gen.FrameExtra> {
  return ecx.frame() as unknown as Frame<Provenance, gen.FrameExtra>;
}

/** `imm.to_scalar()` of a Miri immediate (`Immediate.to_scalar` is typed with the CTFE defaults; same reason). */
function imm_to_scalar(imm: Immediate<Provenance>): Scalar {
  return Immediate.to_scalar(imm as unknown as Immediate) as unknown as Scalar;
}

/** `u64::trailing_zeros` of a nonzero bigint (`< 2^64`). */
function u64_trailing_zeros(v: bigint): number {
  let n = 0;
  while ((v & 1n) === 0n && n < 64) {
    v >>= 1n;
    n += 1;
  }
  return n;
}

/**
 * `BTreeMap::<Size, Box<dyn SyncObj>>::default()` (`AllocExtra.sync_objs`). PORT (lane miri-threads-fix): `Size` is a
 * class, so the map is a `KeyedMap` keyed by the offset's value (`Size` has one representation per value, see
 * rustc_abi `Size`): sync.rs looks offsets up with fresh `Size` objects. Its order is `btree_range`'s.
 */
export function new_sync_objs(): KeyedMap<Size, SyncObj> {
  return new KeyedMap<Size, SyncObj>(Size_value_key);
}
function Size_value_key(s: Size): number | string {
  return s.big === undefined ? s.small : `${s.big}`;
}

/**
 * `BTreeMap<Size, V>::range(start..end)` (`start`/`end` `undefined`: unbounded, i.e. `iter()`/`values()`): the entries in
 * ascending key order. PORT: `AllocExtra.sync_objs` is a `KeyedMap<Size, _>` (generated; insertion-ordered), so the range is
 * filtered and sorted by `Size_cmp`; the keys are the map's own (`remove(&offset)` deletes by them).
 */
function btree_range<V>(map: Map<Size, V>, start: Size | undefined, end: Size | undefined): [Size, V][] {
  const out: [Size, V][] = [];
  for (const e of map) {
    if (start !== undefined && Size_cmp(e[0], start) < 0) continue;
    if (end !== undefined && Size_cmp(e[0], end) >= 0) continue;
    out.push(e);
  }
  out.sort((a, b) => Size_cmp(a[0], b[0]));
  return out;
}

/**
 * PORT(contract): a fn another wave-36 lane defines on an enum companion / a class (PORTING §8, borrowck-contract
 * rules 4-5) that the skeleton does not declare (so it cannot be imported typed). Read at call time (decision C10:
 * never at load); stops `unported` until that lane has ported it. Root replaces these with direct calls at integration.
 */
function pending<F>(owner: object | undefined, name: string, what: string): F {
  const f = owner === undefined ? undefined : (owner as Record<string, unknown>)[name];
  if (typeof f !== "function") return unported(`${what}::${name} (not ported yet; called from src/tools/miri/src/machine.rs)`);
  return f.bind(owner) as F;
}

/** `impl AtomicReadOrd` (concurrency/data_race.rs:96; lane miri-race). */
function AtomicReadOrd_(): { from(ordering: AtomicOrdering): AtomicReadOrd } {
  return { from: pending(data_race_ns.AtomicReadOrd, "from", "miri::concurrency::data_race::AtomicReadOrd (lane miri-race)") };
}
/** `impl AtomicWriteOrd` (concurrency/data_race.rs:116; lane miri-race). */
function AtomicWriteOrd_(): { from(ordering: AtomicOrdering): AtomicWriteOrd } {
  return { from: pending(data_race_ns.AtomicWriteOrd, "from", "miri::concurrency::data_race::AtomicWriteOrd (lane miri-race)") };
}
/** `impl AtomicRwOrd` (concurrency/data_race.rs:75; lane miri-race). */
function AtomicRwOrd_(): { from(ordering: AtomicOrdering): AtomicRwOrd } {
  return { from: pending(data_race_ns.AtomicRwOrd, "from", "miri::concurrency::data_race::AtomicRwOrd (lane miri-race)") };
}
/** `impl AtomicFenceOrd` (concurrency/data_race.rs:137; lane miri-race). */
function AtomicFenceOrd_(): { from(ordering: AtomicOrdering): AtomicFenceOrd } {
  return { from: pending(data_race_ns.AtomicFenceOrd, "from", "miri::concurrency::data_race::AtomicFenceOrd (lane miri-race)") };
}

/** `impl GlobalDataRaceHandler` (concurrency/data_race_handler.rs:34; lane miri-race). */
interface GlobalDataRaceHandler_methods {
  as_vclocks_ref(self: GlobalDataRaceHandler): data_race_GlobalState | undefined;
  as_genmc_ref(self: GlobalDataRaceHandler): GenmcCtx | undefined;
}
function GlobalDataRaceHandler_(): GlobalDataRaceHandler_methods {
  const c = data_race_handler_ns.GlobalDataRaceHandler;
  const what = "miri::concurrency::data_race_handler::GlobalDataRaceHandler (lane miri-race)";
  return {
    as_vclocks_ref: (self) => pending<GlobalDataRaceHandler_methods["as_vclocks_ref"]>(c, "as_vclocks_ref", what)(self),
    as_genmc_ref: (self) => pending<GlobalDataRaceHandler_methods["as_genmc_ref"]>(c, "as_genmc_ref", what)(self),
  };
}

/** `impl AllocDataRaceHandler` (concurrency/data_race_handler.rs:52; lane miri-race). */
function AllocDataRaceHandler_(): { as_vclocks_mut(self: AllocDataRaceHandler): VClockAlloc | undefined } {
  return {
    as_vclocks_mut: pending(
      data_race_handler_ns.AllocDataRaceHandler,
      "as_vclocks_mut",
      "miri::concurrency::data_race_handler::AllocDataRaceHandler (lane miri-race)",
    ),
  };
}

/** `impl AllocState` (borrow_tracker/mod.rs:435; lane miri-alloc). `AllocState` has no generated companion: the lane adds
 * `export const AllocState` to borrow_tracker/mod.ts (borrowck-contract rule 4). */
interface AllocState_methods {
  before_memory_read(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
  before_memory_write(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
  before_memory_deallocation(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult;
}
function AllocState_(): AllocState_methods {
  const c = (borrow_tracker_ns as unknown as Record<string, object | undefined>)["AllocState"];
  const what = "miri::borrow_tracker::AllocState (lane miri-alloc)";
  return {
    before_memory_read: (...a) => pending<AllocState_methods["before_memory_read"]>(c, "before_memory_read", what)(...a),
    before_memory_write: (...a) => pending<AllocState_methods["before_memory_write"]>(c, "before_memory_write", what)(...a),
    before_memory_deallocation: (...a) => pending<AllocState_methods["before_memory_deallocation"]>(c, "before_memory_deallocation", what)(...a),
  };
}

/** `impl BorrowTrackerMethod` (borrow_tracker/mod.rs:234; lane miri-alloc). */
function BorrowTrackerMethod_(): { instantiate_global_state(self: BorrowTrackerMethod, config: MiriConfig): GlobalState } {
  return {
    instantiate_global_state: pending(
      borrow_tracker_ns.BorrowTrackerMethod,
      "instantiate_global_state",
      "miri::borrow_tracker::BorrowTrackerMethod (lane miri-alloc)",
    ),
  };
}

/** `impl EnvVars` (shims/env.rs:29; lane miri-shims-a). */
function EnvVars_(): { init(ecx: MiriInterpCx, config: MiriConfig): InterpResult } {
  return { init: pending(env_ns.EnvVars, "init", "miri::shims::env::EnvVars (lane miri-shims-a)") };
}

/** `impl Default for TlsData` (shims/tls.rs:54; lane miri-shims-a): `TlsData.default()`. */
function TlsData_default(): TlsData {
  return pending<() => TlsData>(TlsData, "default", "miri::shims::tls::TlsData (impl Default; lane miri-shims-a)")();
}

/** `impl Default for DirTable` (shims/unix/fs.rs:218; lane miri-fs): `DirTable.default()`. */
function DirTable_default(): DirTable {
  return pending<() => DirTable>(DirTable, "default", "miri::shims::unix::fs::DirTable (impl Default; lane miri-fs)")();
}

/** `shims::cpu_affinity::MAX_CPUS` (lane miri-shims-b; not exported by the skeleton yet). */
function cpu_affinity_MAX_CPUS(): number {
  const v = (cpu_affinity_ns as unknown as Record<string, unknown>)["MAX_CPUS"];
  if (typeof v !== "number") return unported("miri::shims::cpu_affinity::MAX_CPUS (not ported yet; lane miri-shims-b)");
  return v;
}

/**
 * PORT(contract): `x.visit_provenance(visit)` of a class value whose `VisitProvenance` impl (a prototype method,
 * borrowck-contract rule 5) another wave-36 lane ports and the skeleton does not declare; `unported` until then.
 */
function visit_object(x: object, visit: VisitWith, what: string): void {
  const f = (x as Partial<VisitProvenance>).visit_provenance;
  if (typeof f !== "function") return unported(`${what}::visit_provenance (VisitProvenance; not ported yet; called from machine.rs)`);
  f.call(x, visit);
}

/**
 * PORT(contract): `VisitProvenance::visit_provenance(x, visit)` of a non-class value through its impl table
 * `VisitProvenance_<T>` (borrowck-contract rule 5) exported by the module `ns` of another wave-36 lane; `unported` until then.
 */
function visit_table<T>(ns: object, table: string, x: T, visit: VisitWith, what: string): void {
  const t = (ns as Record<string, { visit_provenance?: (self: T, visit: VisitWith) => void } | undefined>)[table];
  if (t === undefined || typeof t.visit_provenance !== "function") {
    return unported(`${what}: ${table}.visit_provenance (not ported yet; called from machine.rs)`);
  }
  t.visit_provenance(x, visit);
}

/**
 * `Option<Pointer>` / `Option<StrictPointer>` / `StrictPointer`'s `visit_provenance` (provenance_gc.rs:33 `Option<T>`, :114
 * `StrictPointer`, :120 `Pointer`: the pointer's provenance; :106 `Provenance`: a `Concrete` one visits its alloc id and tag).
 * PORT: these generic impls are three lines each upstream; inlined here (lane miri-driver ports the tables).
 */
function visit_pointer(ptr: interpret_Pointer<Provenance | undefined> | undefined, visit: VisitWith): void {
  if (ptr === undefined) return;
  const prov = ptr.provenance;
  if (prov !== undefined && prov.$ === "Concrete") {
    visit(prov.alloc_id, prov.tag);
  }
}

/** `Debug` of `&LayoutError` (the `expect`/`unwrap` texts). */
const debug_LayoutError_ref: Debug<LayoutError> = (e, f) => debug_LayoutError(e, f);
/** `Debug` of `std::io::Error` (the `expect` text of `BlockingIoManager::new`). */
const debug_io_Error_ref: Debug<io_Error> = (_e, _f) => unported("Debug of std::io::Error (BlockingIoManager::new failed)");

/** `Result::expect(msg)` (`E: Debug`): core's text ``{msg}: {e:?}``. */
function expect_result<T, E>(r: Result<T, E>, msg: string, debug_err: Debug<E>): T {
  if (r.$ === "Ok") return r._0;
  return panic(`${msg}: ${debug_err(r._0, PLAIN)}`);
}
/** `Option::expect(msg)`. */
function expect<T>(v: T | undefined, msg: string): T {
  if (v === undefined) return panic(msg);
  return v;
}
