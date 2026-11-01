//! Global machine state as well as implementation of the interpreter engine
//! `Machine` trait.
// Port of src/tools/miri/src/machine.rs (crate `miri`, plan-m6 D2). Its types are generated into machine.gen.ts (tools/codegen
// set `miri`). Fill lane: `miri-machine` (plan-m6 wave 36). Lane miri-contract (wave 35) wrote the contract part (the core
// types and their type-level impls, marked below); the rest of the file is a STUB: docs/handoff/miri-contract.md ("How
// to fill a stub"). Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the
// end, installed by src/miri/lib.ts); the declarations were translated mechanically from the upstream signatures
// (`Pending<"..">` = a type the translation did not map) and the fill lane owns and corrects them.
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
import type { GenmcCtx } from "./concurrency/genmc/dummy.ts";
import type { StackEmptyCallback } from "./concurrency/thread.ts";
import type { MiriConfig } from "./eval.ts";
import { type AllocExtra, MiriMachine, PrimitiveLayouts } from "./machine.gen.ts";
import { debug_FrameState as debug_borrow_tracker_FrameState } from "./borrow_tracker/mod.ts";
import { debug_FrameState as debug_data_race_FrameState } from "./concurrency/data_race.ts";
import { debug_CatchUnwindData } from "./shims/unwind.ts";
import type { BorTag } from "./borrow_tracker/mod.ts";
import { debug_BorTag } from "./borrow_tracker/mod.ts";
import type { VisitProvenance } from "./provenance_gc.ts";
import { stub_methods, stub_statics } from "../rust_ts/miri_stub.ts";
import type { Align, Size } from "../rustc_abi/lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine, type MachineTypes, Machine_provided, type MayLeak } from "../rustc_const_eval/interpret/machine.ts";
import { define_assoc, provide_defaults } from "../rust_ts/provided.ts";
import { AllocBytes_MiriAllocBytes, type MiriAllocBytes, type MiriAllocParams } from "./alloc/alloc_bytes.ts";
import { MonoHashMap } from "./data_structures/mono_hash_map.ts";
import type { DynSym } from "./shims/foreign_items.ts";
import type { Allocation } from "../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, debug_AllocId, type InterpResult, type ObjectProvenance, type Pointer as interpret_Pointer, register_object_provenance } from "../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { LayoutCx, LayoutError, TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { CrateNum } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { Pending } from "../rustc_type_ir/decls.ts";
import { type Debug, debug_int, debug_option, debug_struct, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
export * from "./machine.gen.ts";

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
// The impl's associated types and consts are prototype members (`define_assoc` below); its fns (machine.rs:1152-2127,
// the inventory at the end) are `unported` stubs until lane miri-machine ports them on `MiriMachine.prototype` (the hook
// `stack` is `stack_` in the port); the provided fns it does not override are `Machine_provided`'s (`provide_defaults`).
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

/// Trait for callbacks handling asynchronous machine operations.
// PORT: `Box<dyn MachineCallback<'tcx, T>>` is this interface; `callback!` (machine.rs:2171) builds an object with
// `visit_provenance` and `call` (lane miri-machine ports the macro as a helper taking the captures and the body).
export interface MachineCallback<T> extends VisitProvenance {
  /// The function to be invoked when the callback is fired.
  // rustc: src/tools/miri/src/machine.rs:2144 call
  call(ecx: MiriInterpCx, arg: T): InterpResult; // self: Box<Self>
}

/// Type alias for boxed machine callbacks with generic argument type.
// rustc-type: src/tools/miri/src/machine.rs:2152 DynMachineCallback
export type DynMachineCallback<T> = MachineCallback<T>;

// ---------------------------------------------------------------- stub part (fill lane miri-machine) ----

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
    export let allocator_shim_symbols: (tcx: TyCtxt) => Map<Symbol, Pending<"Either<Symbol, SpecialAllocatorMethod>">>;
    // machine.rs:901
    export let get_user_relevant_crates: (tcx: TyCtxt, config: MiriConfig) => CrateNum[];
    // machine.rs:922
    export let late_init: (ecx: MiriInterpCx, config: MiriConfig, on_main_stack_empty: StackEmptyCallback) => InterpResult;
    // machine.rs:967
    export let init_allocation: (ecx: MiriInterpCx, id: AllocId, kind: MemoryKind, size: Size, align: Align) => InterpResult<AllocExtra>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for FrameExtra<'_> (machine.rs:169): visit_provenance (:170)
// impl VisitProvenance for AllocExtra<'_> (machine.rs:409): visit_provenance (:410)
// impl VisitProvenance for MiriMachine<'_> (machine.rs:1029): visit_provenance (:1030)
// impl Machine<'tcx> for MiriMachine<'tcx> (machine.rs:1133): enforce_alignment (:1152), alignment_check (:1157), enforce_validity (:1203), enforce_validity_recursively (:1207), ignore_optional_overflow_checks (:1215), check_fn_target_features (:1219), find_mir_or_eval_fn (:1258), call_extra_fn (:1294), call_intrinsic (:1308), call_llvm_intrinsic (:1320), assert_panic (:1331), panic_nounwind (:1339), unwind_terminate (:1343), binary_ptr_op (:1361), atomic_load (:1370), atomic_store (:1378), atomic_rmw (:1387), atomic_compare_exchange (:1397), atomic_fence (:1416), generate_nan (:1429), apply_float_nondet (:1437), equal_float_min_max (:1445), float_fuse_mul_add (:1450), runtime_checks (:1455), thread_local_static_pointer (:1463), extern_static_pointer (:1470), init_local_allocation (:1586), adjust_alloc_root_pointer (:1597), ptr_from_addr_cast (:1628), expose_provenance (:1636), ptr_get_alloc (:1654), adjust_global_allocation (:1678), before_memory_read (:1695), before_memory_write (:1736), before_memory_deallocation (:1790), retag_ptr_value (:1836), with_retag_mode (:1849), protect_in_place_function_argument (:1857), init_frame (:1879), stack (:1915), stack_mut (:1921), before_terminator (:1927), after_stack_push (:1961), before_stack_pop (:1971), after_stack_pop (:1999), after_local_read (:2022), after_local_write (:2030), after_local_moved_to_memory (:2042), get_global_alloc_salt (:2069), cached_union_data_range (:2110), get_default_alloc_params (:2118), enter_trace_span (:2127)
// macro_rules! callback (machine.rs:2171): fns in its body: visit_provenance (:2181), call (:2189)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::machine::PrimitiveLayouts", "src/tools/miri/src/machine.rs", "miri-machine", () => PrimitiveLayouts.prototype, ["uint", "int"]);
stub_statics("miri::machine::PrimitiveLayouts", "src/tools/miri/src/machine.rs", "miri-machine", () => PrimitiveLayouts, ["new"]);
stub_methods("miri::machine::MiriMachine", "src/tools/miri/src/machine.rs", "miri-machine", () => MiriMachine.prototype, ["communicate", "is_local", "handle_abnormal_termination", "page_align", "allocated_span", "deallocated_span"]);
stub_statics("miri::machine::MiriMachine", "src/tools/miri/src/machine.rs", "miri-machine", () => MiriMachine, ["new", "allocator_shim_symbols", "get_user_relevant_crates", "late_init", "init_allocation"]);
// `impl Machine<'tcx> for MiriMachine<'tcx>` (machine.rs:1133): every fn it defines, in upstream order (`stack` is `stack_`).
stub_methods("miri::machine::MiriMachine (impl Machine)", "src/tools/miri/src/machine.rs", "miri-machine", () => MiriMachine.prototype, [
  "enforce_alignment", "alignment_check", "enforce_validity", "enforce_validity_recursively", "ignore_optional_overflow_checks",
  "check_fn_target_features", "find_mir_or_eval_fn", "call_extra_fn", "call_intrinsic", "call_llvm_intrinsic", "assert_panic",
  "panic_nounwind", "unwind_terminate", "binary_ptr_op", "atomic_load", "atomic_store", "atomic_rmw", "atomic_compare_exchange",
  "atomic_fence", "generate_nan", "apply_float_nondet", "equal_float_min_max", "float_fuse_mul_add", "runtime_checks",
  "thread_local_static_pointer", "extern_static_pointer", "init_local_allocation", "adjust_alloc_root_pointer",
  "ptr_from_addr_cast", "expose_provenance", "ptr_get_alloc", "adjust_global_allocation", "before_memory_read",
  "before_memory_write", "before_memory_deallocation", "retag_ptr_value", "with_retag_mode",
  "protect_in_place_function_argument", "init_frame", "stack_", "stack_mut", "before_terminator", "after_stack_push",
  "before_stack_pop", "after_stack_pop", "after_local_read", "after_local_write", "after_local_moved_to_memory",
  "get_global_alloc_salt", "cached_union_data_range", "get_default_alloc_params", "enter_trace_span",
]);
