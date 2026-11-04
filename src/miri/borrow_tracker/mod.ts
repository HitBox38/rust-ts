// Port of src/tools/miri/src/borrow_tracker/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36); `BorTag` is the
// contract part (lane miri-contract).
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (lane miri-alloc):
// - `RefCell` / `Box` are erased: `GlobalState` is the `GlobalStateInner`, `AllocState::StackedBorrows(Box<RefCell<..>>)`
//   holds the `Stacks` / `Tree` itself; `borrow()` / `borrow_mut()` / `get_mut()` are the value.
// - Inherent methods of the enums `BorrowTrackerMethod` and `AllocState` live on their companions (PORTING §8).
// - `VisitProvenance` (provenance_gc.ts): `GlobalStateInner` is a class, so a prototype method; `FrameState` (an
//   interface) and `AllocState` (a union) get impl tables `VisitProvenance_FrameState` / `VisitProvenance_AllocState`.
// - `enter_trace_span!` is a comment (the release oracle has no tracing spans); `trace!` lines are verbatim comments; the
//   one `info!` (`retag_ptr_value`) is live (lane miri-log-fix, src/rust_ts/tracing.ts).
// - Stacked Borrows (lane miri-sb) and Tree Borrows (wave 38) are reached through their skeleton declarations.
import { type AccessKind, type AllocState as gen_AllocState, BorrowTrackerMethod as gen_BorrowTrackerMethod, type FrameState, GlobalStateInner, type TreeBorrowsParams } from "./mod.gen.ts";
import { Stacks } from "./stacked_borrows/mod.ts";
import { Tree } from "./tree_borrows/tree.ts";
import { type MiriConfig } from "../eval.ts";
import { type ImmTy, type MPlaceTy, type Pointer } from "../lib.ts";
import { AllocExtra } from "../machine.ts";
import { type FrameExtra, type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance, type ProvenanceExtra, debug_Provenance } from "../machine.ts";
import { debug_Immediate } from "../../rustc_const_eval/interpret/operand.gen.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import * as tracing from "../../rust_ts/tracing.ts";
import { type LiveAllocs, type VisitWith } from "../provenance_gc.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode, debug_RetagMode } from "../../rustc_const_eval/interpret/machine.gen.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type Frame } from "../../rustc_const_eval/interpret/stack.gen.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, interp_ok, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { port_methods } from "../../rust_ts/miri_stub.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { write_stderr } from "../../std/io.ts";
export * from "./mod.gen.ts";

/** `eprintln!` (PORT: synchronous write to fd 2, as rustc_mir_transform/pass_manager.ts). */
function eprintln(s: string): void {
  write_stderr(`${s}\n`);
}

// impl fmt::Display for AccessKind
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:22 fmt
export function display_AccessKind(self: AccessKind): string {
  switch (self) {
    case "Read":
      return "read access";
    case "Write":
      return "write access";
  }
}

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

// impl VisitProvenance for FrameState
export const VisitProvenance_FrameState = {
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:88 visit_provenance
  visit_provenance(self: FrameState, visit: VisitWith): void {
    // Visit all protected tags. At least in Tree Borrows,
    // protected tags can not be GC'd because they still have
    // an access coming when the protector ends. Additionally,
    // the tree compacting mechanism of TB's GC relies on the fact
    // that all protected tags are marked as live for correctness,
    // so we _have_ to visit them here.
    for (const [id, tag] of self.protected_tags) {
      visit(id, tag);
    }
  },
};

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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
    on_stack_pop(this: MiriInterpCx, frame: Frame<Provenance, FrameExtra>): InterpResult;
  }
}

declare module "./mod.gen.ts" {
  interface GlobalStateInner {
    // borrow_tracker/mod.rs:124 (impl VisitProvenance)
    visit_provenance(_visit: VisitWith): void;
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
    borrow_tracker_sb(): Stacks;
    // borrow_tracker/mod.rs:419
    borrow_tracker_sb_mut(): Stacks;
    // borrow_tracker/mod.rs:427
    borrow_tracker_tb(): Tree;
  }
}
// `impl VisitProvenance for Stacks` (stacked_borrows/mod.rs:456, ported in stacked_borrows/mod.ts) and `for Tree`
// (tree_borrows/tree.rs:1201; PORT(contract): pending lane miri-tb-b, wave 37) are declared here; `VisitProvenance_AllocState`
// calls them as methods (the provenance_gc.ts convention for classes).
declare module "./stacked_borrows/mod.gen.ts" {
  interface Stacks {
    visit_provenance(visit: VisitWith): void;
  }
}
declare module "./tree_borrows/tree.gen.ts" {
  interface Tree {
    visit_provenance(visit: VisitWith): void;
  }
}

// impl VisitProvenance for GlobalStateInner
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:124 visit_provenance
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
visit_provenance: function (this: GlobalStateInner, _visit: VisitWith): void {
  // All the provenance in protected_tags is also stored in FrameState, and visited there.
  // The only other candidate is base_ptr_tags, and that does not need visiting since we don't ever
  // GC the bottommost/root tag.
}});

/// Utilities for initialization and ID generation
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:156 new
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner, {
new: function (
  borrow_tracker_method: BorrowTrackerMethod,
  tracked_pointer_tags: Set<BorTag>,
): GlobalStateInner {
  return new GlobalStateInner(
    borrow_tracker_method,
    /* retag_mode */ "Default",
    /* next_ptr_tag */ BorTag.one(),
    /* root_ptr_tags */ new Map(),
    /* protected_tags */ new Map(),
    tracked_pointer_tags,
  );
}});

/// Generates a new pointer tag. Remember to also check track_pointer_tags and log its creation!
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:171 new_ptr
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
new_ptr: function (this: GlobalStateInner): BorTag {
  const id = this.next_ptr_tag;
  this.next_ptr_tag = unwrap(BorTag.succ(id));
  return id;
}});

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:177 new_frame
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
new_frame: function (this: GlobalStateInner): FrameState {
  return { protected_tags: [] };
}});

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:181 end_call
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
end_call: function (this: GlobalStateInner, frame: FrameExtra): void {
  for (const [_, tag] of unwrap(frame.borrow_tracker, "we should have borrow tracking data").protected_tags) {
    this.protected_tags.delete(tag);
  }
}});

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:192 root_ptr_tag
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
root_ptr_tag: function (this: GlobalStateInner, id: AllocId, machine: MiriMachine): BorTag {
  const existing = this.root_ptr_tags.get(id);
  if (existing !== undefined) return existing;
  const tag = this.new_ptr();
  if (this.tracked_pointer_tags.has(tag)) {
    machine.emit_diagnostic({ $: "CreatedPointerTag", _0: BigInt(BorTag.inner(tag)), _1: undefined, _2: undefined });
  }
  // trace!("New allocation {:?} has rpot tag {:?}", id, tag);
  // self.root_ptr_tags.try_insert(id, tag).unwrap();  (PORT: `id` is absent, checked above)
  this.root_ptr_tags.set(id, tag);
  return tag;
}});

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:208 remove_unreachable_allocs
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
remove_unreachable_allocs: function (this: GlobalStateInner, allocs: LiveAllocs): void {
  // self.root_ptr_tags.retain(|id, _| allocs.is_live(*id));
  for (const id of this.root_ptr_tags.keys()) {
    if (!allocs.is_live(id)) this.root_ptr_tags.delete(id);
  }
}});

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:212 borrow_tracker_method
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
borrow_tracker_method_: function (this: GlobalStateInner): BorrowTrackerMethod {
  return this.borrow_tracker_method;
}});

/// Which borrow tracking method to use
export type BorrowTrackerMethod = import("./mod.gen.ts").BorrowTrackerMethod;
/** PORT: `impl BorrowTrackerMethod` on the generated companion (PORTING §8). */
export interface BorrowTrackerMethod_methods {
  instantiate_global_state(self: BorrowTrackerMethod, config: MiriConfig): GlobalStateInner;
  get_tree_borrows_params(self: BorrowTrackerMethod): TreeBorrowsParams;
}
export const BorrowTrackerMethod = gen_BorrowTrackerMethod as typeof gen_BorrowTrackerMethod & BorrowTrackerMethod_methods;

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:235 instantiate_global_state
BorrowTrackerMethod.instantiate_global_state = function (self: BorrowTrackerMethod, config: MiriConfig): GlobalStateInner {
  // RefCell::new(GlobalStateInner::new(self, config.tracked_pointer_tags.clone()))
  return GlobalStateInner.new(self, new Set(config.tracked_pointer_tags));
};

// #[track_caller]
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:240 get_tree_borrows_params
BorrowTrackerMethod.get_tree_borrows_params = function (self: BorrowTrackerMethod): TreeBorrowsParams {
  switch (self.$) {
    case "TreeBorrows":
      return self._0;
    default:
      return panic("can only be called when `BorrowTrackerMethod` is `TreeBorrows`");
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:249 new_allocation
port_methods("miri::borrow_tracker::GlobalStateInner", () => GlobalStateInner.prototype, {
new_allocation: function (
  this: GlobalStateInner,
  id: AllocId,
  alloc_size: Size,
  kind: MemoryKind,
  machine: MiriMachine,
): AllocState {
  // let _trace = enter_trace_span!(borrow_tracker::new_allocation, ?id, ?alloc_size, ?kind);
  switch (this.borrow_tracker_method.$) {
    case "StackedBorrows":
      return { $: "StackedBorrows", _0: Stacks.new_allocation(id, alloc_size, this, kind, machine) };
    case "TreeBorrows":
      return { $: "TreeBorrows", _0: Tree.new_allocation(id, alloc_size, this, kind, machine) };
  }
}});

// ---- impl EvalContextExt for MiriInterpCx ----
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:272 retag_ptr_value
InterpCx.prototype.retag_ptr_value = function (this: MiriInterpCx, val: ImmTy, ty: Ty): InterpResult<ImmTy | undefined> {
  // let _trace = enter_trace_span!(borrow_tracker::retag_ptr_value, ?ty);
  const this_ = this.eval_context_mut();
  const state = unwrap(this_.machine.borrow_tracker);
  const method = state.borrow_tracker_method;
  const retag_mode = state.retag_mode;
  if (tracing.INFO_ENABLED) {
    tracing.info(
      "miri::borrow_tracker",
      () => `retag_ptr_value: type=${display_Ty(ty)}, mode=${debug_RetagMode(retag_mode, PLAIN)}, val=${debug_Immediate(val.imm, PLAIN, debug_Provenance)}`,
    );
  }
  switch (method.$) {
    case "StackedBorrows":
      return this_.sb_retag_ptr_value(val, ty, retag_mode);
    case "TreeBorrows":
      return this_.tb_retag_ptr_value(val, ty, retag_mode);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:289 with_retag_mode
InterpCx.prototype.with_retag_mode = function <T>(
  this: MiriInterpCx,
  mode: RetagMode,
  f: (_0: MiriInterpCx) => InterpResult<T>,
): InterpResult<T> {
  // Set up new mode, remembering the old mode.
  let state = unwrap(this.eval_context_mut().machine.borrow_tracker);
  // let old_mode = mem::replace(&mut state.retag_mode, mode);
  const old_mode = state.retag_mode;
  state.retag_mode = mode;

  const ret = f(this);

  // Restore old mode.
  state = unwrap(this.eval_context_mut().machine.borrow_tracker);
  state.retag_mode = old_mode;

  return ret;
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:307 protect_place
InterpCx.prototype.protect_place = function (this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy> {
  // let _trace = enter_trace_span!(borrow_tracker::protect_place, ?place);
  const this_ = this.eval_context_mut();
  const method = unwrap(this_.machine.borrow_tracker).borrow_tracker_method;
  switch (method.$) {
    case "StackedBorrows":
      return this_.sb_protect_place(place);
    case "TreeBorrows":
      return this_.tb_protect_place(place);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:317 expose_tag
InterpCx.prototype.expose_tag = function (this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult {
  // let _trace =
  //     enter_trace_span!(borrow_tracker::expose_tag, alloc_id = alloc_id.0, tag = tag.0);
  const this_ = this.eval_context_ref();
  const method = unwrap(this_.machine.borrow_tracker).borrow_tracker_method;
  switch (method.$) {
    case "StackedBorrows":
      return this_.sb_expose_tag(alloc_id, tag);
    case "TreeBorrows":
      return this_.tb_expose_tag(alloc_id, tag);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:328 give_pointer_debug_name
InterpCx.prototype.give_pointer_debug_name = function (this: MiriInterpCx, ptr: Pointer, nth_parent: number, name: string): InterpResult {
  const this_ = this.eval_context_mut();
  const method = unwrap(this_.machine.borrow_tracker).borrow_tracker_method;
  switch (method.$) {
    case "StackedBorrows": {
      this_.tcx.tcx.dcx().warn("Stacked Borrows does not support named pointers; `miri_pointer_name` is a no-op");
      return interp_ok(undefined);
    }
    case "TreeBorrows":
      return this_.tb_give_pointer_debug_name(ptr, nth_parent, name);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:346 print_borrow_state
InterpCx.prototype.print_borrow_state = function (this: MiriInterpCx, alloc_id: AllocId, show_unnamed: boolean): InterpResult {
  const this_ = this.eval_context_mut();
  const borrow_tracker = this_.machine.borrow_tracker;
  if (borrow_tracker === undefined) {
    eprintln("attempted to print borrow state, but no borrow state is being tracked");
    return interp_ok(undefined);
  }
  const method = borrow_tracker.borrow_tracker_method;
  switch (method.$) {
    case "StackedBorrows":
      return this_.print_stacks(alloc_id);
    case "TreeBorrows":
      return this_.print_tree(alloc_id, show_unnamed);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/mod.rs:359 on_stack_pop
InterpCx.prototype.on_stack_pop = function (this: MiriInterpCx, frame: Frame<Provenance, FrameExtra>): InterpResult {
  // let _trace = enter_trace_span!(borrow_tracker::on_stack_pop);
  const this_ = this.eval_context_ref();
  const borrow_tracker = unwrap(this_.machine.borrow_tracker);
  // The body of this loop needs `borrow_tracker` immutably
  // so we can't move this code inside the following `end_call`.

  for (const [alloc_id, tag] of unwrap(frame.extra.borrow_tracker, "we should have borrow tracking data").protected_tags) {
    // Just because the tag is protected doesn't guarantee that
    // the allocation still exists (weak protectors allow deallocations)
    // so we must check that the allocation exists.
    // If it does exist, then we have the guarantee that the
    // pointer is readable, and the implicit read access inserted
    // will never cause UB on the pointer itself.
    const kind = this_.get_alloc_info(alloc_id).kind;
    if (kind === "LiveData") {
      const alloc_extra = this_.get_alloc_extra(alloc_id); // can still fail for `extern static`
      if (alloc_extra.$ === "Err") return alloc_extra;
      const alloc_borrow_tracker = unwrap(alloc_extra._0.borrow_tracker);
      const r = AllocState.release_protector(alloc_borrow_tracker, this_.machine, borrow_tracker, tag, alloc_id);
      if (r.$ === "Err") return r;
    }
  }
  borrow_tracker.end_call(frame.extra);

  return interp_ok(undefined);
};

// ---- impl machine::AllocExtra<'_> ----
// #[track_caller]
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:411 borrow_tracker_sb
function borrow_tracker_sb(this: AllocExtra): Stacks {
  const bt = this.borrow_tracker;
  if (bt !== undefined && bt.$ === "StackedBorrows") return bt._0;
  return panic("expected Stacked Borrows borrow tracking, got something else");
}

// #[track_caller]
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:419 borrow_tracker_sb_mut
function borrow_tracker_sb_mut(this: AllocExtra): Stacks {
  const bt = this.borrow_tracker;
  if (bt !== undefined && bt.$ === "StackedBorrows") return bt._0;
  return panic("expected Stacked Borrows borrow tracking, got something else");
}

// #[track_caller]
// rustc: src/tools/miri/src/borrow_tracker/mod.rs:427 borrow_tracker_tb
function borrow_tracker_tb(this: AllocExtra): Tree {
  const bt = this.borrow_tracker;
  if (bt !== undefined && bt.$ === "TreeBorrows") return bt._0;
  return panic("expected Tree Borrows borrow tracking, got something else");
}

// PORT: `AllocExtra` is machine.gen.ts's class: installed with the other deferred ports (init-order rule C10, port_methods).
port_methods("miri::borrow_tracker::AllocExtra", () => AllocExtra.prototype, { borrow_tracker_sb, borrow_tracker_sb_mut, borrow_tracker_tb });

/// Extra per-allocation data for borrow tracking
export type AllocState = gen_AllocState;
/** PORT: `impl AllocState` on a companion (PORTING §8; the generated union has none). */
export const AllocState = {
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:436 before_memory_read
  before_memory_read(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult {
    // let _trace = enter_trace_span!(borrow_tracker::before_memory_read, alloc_id = alloc_id.0);
    switch (self.$) {
      case "StackedBorrows":
        return self._0.before_memory_read(alloc_id, prov_extra, range, machine);
      case "TreeBorrows":
        return self._0.before_memory_access("Read", alloc_id, prov_extra, range, machine);
    }
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:458 before_memory_write
  before_memory_write(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult {
    // let _trace = enter_trace_span!(borrow_tracker::before_memory_write, alloc_id = alloc_id.0);
    switch (self.$) {
      case "StackedBorrows":
        return self._0.before_memory_write(alloc_id, prov_extra, range, machine);
      case "TreeBorrows":
        return self._0.before_memory_access("Write", alloc_id, prov_extra, range, machine);
    }
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:480 before_memory_deallocation
  before_memory_deallocation(self: AllocState, alloc_id: AllocId, prov_extra: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult {
    // let _trace =
    //     enter_trace_span!(borrow_tracker::before_memory_deallocation, alloc_id = alloc_id.0);
    switch (self.$) {
      case "StackedBorrows":
        return self._0.before_memory_deallocation(alloc_id, prov_extra, size, machine);
      case "TreeBorrows":
        return self._0.before_memory_deallocation(alloc_id, prov_extra, size, machine);
    }
  },

  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:497 remove_unreachable_tags
  remove_unreachable_tags(self: AllocState, tags: Set<BorTag>): void {
    // let _trace = enter_trace_span!(borrow_tracker::remove_unreachable_tags);
    switch (self.$) {
      case "StackedBorrows":
        return self._0.remove_unreachable_tags(tags);
      case "TreeBorrows":
        return self._0.remove_unreachable_tags(tags);
    }
  },

  /// Tree Borrows needs to be told when a tag stops being protected.
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:506 release_protector
  release_protector(
    self: AllocState,
    machine: MiriMachine,
    global: GlobalStateInner,
    tag: BorTag,
    alloc_id: AllocId, // diagnostics
  ): InterpResult {
    // let _trace = enter_trace_span!(
    //     borrow_tracker::release_protector,
    //     alloc_id = alloc_id.0,
    //     tag = tag.0
    // );
    switch (self.$) {
      case "StackedBorrows":
        return interp_ok(undefined);
      case "TreeBorrows":
        return self._0.release_protector(machine, global, tag, alloc_id);
    }
  },
};

// impl VisitProvenance for AllocState
export const VisitProvenance_AllocState = {
  // rustc: src/tools/miri/src/borrow_tracker/mod.rs:527 visit_provenance
  visit_provenance(self: AllocState, visit: VisitWith): void {
    // let _trace = enter_trace_span!(borrow_tracker::visit_provenance);
    switch (self.$) {
      case "StackedBorrows":
        return self._0.visit_provenance(visit);
      case "TreeBorrows":
        return self._0.visit_provenance(visit);
    }
  },
};
