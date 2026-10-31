// Port of src/tools/miri/src/borrow_tracker/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them. `BorTag` is the contract
// part (lane miri-contract, ported below).
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AllocState, type BorrowTrackerMethod, type FrameState, GlobalStateInner } from "./mod.gen.ts";
import { type ImmTy, type MPlaceTy, type Pointer } from "../lib.ts";
import { AllocExtra } from "../machine.ts";
import { type FrameExtra, type MemoryKind, type MiriInterpCx, type MiriMachine } from "../machine.ts";
import { type LiveAllocs } from "../provenance_gc.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../rustc_const_eval/interpret/machine.gen.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type Frame } from "../../rustc_const_eval/interpret/stack.gen.ts";
import { type AllocId, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
export * from "./mod.gen.ts";

// ---- `BorTag` (contract part, lane miri-contract): the generated modules call its Debug / Clone ----
/// Tracking pointer provenance
// rustc-type: src/tools/miri/src/borrow_tracker/mod.rs:32 BorTag
// `pub struct BorTag(NonZero<u64>)`, `#[derive(Copy, Clone, Hash, PartialEq, Eq, PartialOrd, Ord)]` (lane miri-contract).
// PORT: a branded number (PORTING §5 interned handles): tags are handed out one per retag / allocation from 1 upwards
// (`GlobalStateInner.next_ptr_tag`), so they stay below 2^53; `==` / `<` are the derived `PartialEq` / `Ord`. `get()` /
// `inner()` are `number`s (a caller that packs a tag into a `u64` bigint, stacked_borrows `Item`, converts with `BigInt`).
export type BorTag = number & { readonly __brand: "BorTag" };

/** PORT: `impl BorTag` (+ `Default`) on the companion const (PORTING §8). */
export const BorTag = {
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:35 new
  new(i: number): BorTag | undefined {
    // NonZero::new(i).map(BorTag)
    return i === 0 ? undefined : (i as BorTag);
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:39 get
  get(self: BorTag): number {
    return self;
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:43 inner
  inner(self: BorTag): number {
    return self;
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:47 succ
  succ(self: BorTag): BorTag | undefined {
    // self.0.checked_add(1).map(Self)
    // PORT: `checked_add` overflows at u64::MAX, which a number never reaches (header); the `None` arm is unreachable.
    return (self + 1) as BorTag;
  },

  /// The minimum representable tag
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:52 one
  one(): BorTag {
    return BorTag.new(1)!;
  },

  /// The default to be used when borrow tracking is disabled
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:59 default
  default(): BorTag {
    return BorTag.one();
  },
};

/** `#[derive(Clone)]` of a `Copy` handle: identity. */
export function clone_BorTag(v: BorTag): BorTag {
  return v;
}

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:65 fmt
export const debug_BorTag: Debug<BorTag> = (self, _f) => `<${self}>`;

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- borrow_tracker/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // borrow_tracker/mod.rs:272
    retag_ptr_value(this: MiriInterpCx, val: ImmTy, ty: Ty): InterpResult<ImmTy | undefined>;
    // borrow_tracker/mod.rs:289
    with_retag_mode<T>(this: MiriInterpCx, mode: RetagMode, f: ((_0: MiriInterpCx) => InterpResult<T>)): InterpResult<T>;
    // borrow_tracker/mod.rs:307
    protect_place(this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy>;
    // borrow_tracker/mod.rs:317
    expose_tag(this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult;
    // borrow_tracker/mod.rs:328
    give_pointer_debug_name(this: MiriInterpCx, ptr: Pointer, nth_parent: number, name: string): InterpResult;
    // borrow_tracker/mod.rs:346
    print_borrow_state(this: MiriInterpCx, alloc_id: AllocId, show_unnamed: boolean): InterpResult;
    // borrow_tracker/mod.rs:359
    on_stack_pop(this: MiriInterpCx, frame: Frame<FrameExtra>): InterpResult;
  }
}

declare module "./mod.gen.ts" {
  interface GlobalStateInner {
    // borrow_tracker/mod.rs:171
    new_ptr(): BorTag;
    // borrow_tracker/mod.rs:177
    new_frame(): FrameState;
    // borrow_tracker/mod.rs:181
    end_call(frame: FrameExtra): void;
    // borrow_tracker/mod.rs:192
    root_ptr_tag(id: AllocId, machine: MiriMachine): BorTag;
    // borrow_tracker/mod.rs:208
    remove_unreachable_allocs(allocs: LiveAllocs): void;
    // borrow_tracker/mod.rs:212 // PORT: `borrow_tracker_method_` (a field `borrow_tracker_method` exists; mir-contract rule)
    borrow_tracker_method_(): BorrowTrackerMethod;
    // borrow_tracker/mod.rs:249
    new_allocation(id: AllocId, alloc_size: Size, kind: MemoryKind, machine: MiriMachine): AllocState;
  }
  namespace GlobalStateInner {
    // borrow_tracker/mod.rs:156
    function new_(borrow_tracker_method: BorrowTrackerMethod, tracked_pointer_tags: Set<BorTag>): GlobalStateInner;
    export { new_ as new };
  }
}
declare module "../machine.gen.ts" {
  interface AllocExtra {
    // borrow_tracker/mod.rs:411
    borrow_tracker_sb(): AllocState;
    // borrow_tracker/mod.rs:419
    borrow_tracker_sb_mut(): AllocState;
    // borrow_tracker/mod.rs:427
    borrow_tracker_tb(): AllocState;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for AccessKind (borrow_tracker/mod.rs:21): fmt (:22)
// impl VisitProvenance for FrameState (borrow_tracker/mod.rs:87): visit_provenance (:88)
// impl VisitProvenance for GlobalStateInner (borrow_tracker/mod.rs:123): visit_provenance (:124)
// impl BorrowTrackerMethod (borrow_tracker/mod.rs:234) [BorrowTrackerMethod is not a generated class: companion fns / hand type, lane decides]: instantiate_global_state (:235), get_tree_borrows_params (:240)
// impl AllocState (borrow_tracker/mod.rs:435) [AllocState is not a generated class: companion fns / hand type, lane decides]: before_memory_read (:436), before_memory_write (:458), before_memory_deallocation (:480), remove_unreachable_tags (:497), release_protector (:506)
// impl VisitProvenance for AllocState (borrow_tracker/mod.rs:526): visit_provenance (:527)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::EvalContextExt", "src/tools/miri/src/borrow_tracker/mod.rs", "miri-alloc", () => InterpCx.prototype, ["retag_ptr_value", "with_retag_mode", "protect_place", "expose_tag", "give_pointer_debug_name", "print_borrow_state", "on_stack_pop"]);
stub_methods("miri::borrow_tracker::GlobalStateInner", "src/tools/miri/src/borrow_tracker/mod.rs", "miri-alloc", () => GlobalStateInner.prototype, ["new_ptr", "new_frame", "end_call", "root_ptr_tag", "remove_unreachable_allocs", "borrow_tracker_method_", "new_allocation"]);
stub_statics("miri::borrow_tracker::GlobalStateInner", "src/tools/miri/src/borrow_tracker/mod.rs", "miri-alloc", () => GlobalStateInner, ["new"]);
stub_methods("miri::borrow_tracker::AllocExtra", "src/tools/miri/src/borrow_tracker/mod.rs", "miri-alloc", () => AllocExtra.prototype, ["borrow_tracker_sb", "borrow_tracker_sb_mut", "borrow_tracker_tb"]);
