//! Implements "Stacked Borrows".  See <https://github.com/rust-lang/unsafe-code-guidelines/blob/master/wip/stacked-borrows.md>
//! for further information.
// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-sb` (plan-m6
// wave 36). Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT(contract): the private core ops of `impl Stack` in this file (`find_first_write_incompatible`, `item_invalidated`,
// `access`, `dealloc`, `grant`) and `Permission::grants` are module functions taking the receiver first
// (`Stack_access(stack, ..)`, `Permission_grants(perm, access)`), not members assigned on `Stack.prototype` / the
// `Permission` companion: those belong to other modules (stack.gen.ts / item.gen.ts), and assigning them here at load
// would read another Miri module's value at top level (C10), which fails in the ESM cycle stack.gen.ts ->
// borrow_tracker/mod.ts -> .. -> this module (the contract test loads every module as a fresh entry point). Upstream they
// are private to stacked_borrows (stack.rs calls `grants`), so no other lane calls them. The skeleton's declarations of
// these five `Stack` members are removed.
// PORT(contract): `AllocExtra::borrow_tracker_sb{,_mut}` (borrow_tracker/mod.rs:411/:419, lane miri-alloc) are declared
// returning `borrow_tracker::AllocState` (the enum); upstream returns `&RefCell<stacked_borrows::AllocState>` = `Stacks`.
// `sb_state` below reads them as `Stacks` until miri-alloc corrects the declaration.
// PORT(contract): `AllocDataRaceHandler::as_vclocks_{ref,mut}` (concurrency/data_race_handler.rs:53/:57, lane miri-race)
// are not declared by the skeleton (companion fns, "lane decides"); `as_vclocks` below is their one-arm `if let`.
// Logging: upstream `trace!` lines are verbatim comments (A6: only `info!` is ported, by lane miri-log; this file has none).
import { type AccessKind, BorTag, debug_BorTag, type GlobalStateInner, type ProtectorKind } from "../mod.ts";
import { DiagnosticCxBuilder, type DiagnosticCx, RetagInfo, type RetagCause } from "./diagnostics.ts";
import { AllocHistory } from "./diagnostics.ts";
import { clone_Item, debug_Permission, Item, Permission } from "./item.ts";
import { type ItemInvalidationCause, type NewPermission as NewPermission_, Stacks } from "./mod.gen.ts";
import { Stack } from "./stack.ts";
import { type VClockAlloc } from "../../concurrency/data_race.ts";
import { type AllocDataRaceHandler } from "../../concurrency/data_race_handler.ts";
import { DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { type NonHaltingDiagnostic } from "../../diagnostics.ts";
import { type ImmTy, type MPlaceTy } from "../../lib.ts";
import { type AllocExtra, clone_Provenance, type FrameExtra, type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance, type ProvenanceExtra } from "../../machine.ts";
import { type VisitWith } from "../../provenance_gc.ts";
import { Size, Size_eq } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../../rustc_const_eval/interpret/machine.gen.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type Immediate, ImmTy as interpret_ImmTy } from "../../../rustc_const_eval/interpret/operand.ts";
import { type Projectable } from "../../../rustc_const_eval/interpret/projection.ts";
import { clone_MPlaceTy } from "../../../rustc_const_eval/interpret/place.ts";
import { type Frame } from "../../../rustc_const_eval/interpret/stack.gen.ts";
import { alloc_range, type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, InterpErrorInfo_from_InterpErrorKind, interp_ok, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { stdout_write_all } from "../../../std/io.ts";
import { assert, panic, unreachable, unwrap } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
export * from "./mod.gen.ts";

// pub mod diagnostics; mod item; mod stack;
// PORT: the child modules are their own TS modules (src/miri/lib.ts loads them); `pub use self::item::{Item,
// Permission}; pub use self::stack::Stack;` are lib.ts's re-exports.

// pub type AllocState = Stacks; (mod.gen.ts)

/** PORT: `impl NewPermission` on a companion const (PORTING §8). */
export type NewPermission = NewPermission_;
export const NewPermission = {
  /// A key function: determine the permissions to grant at a retag for the given kind of
  /// reference/pointer.
  // rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:62 from_ref_ty
  from_ref_ty(ty: Ty, mode: RetagMode, cx: MiriInterpCx): NewPermission {
    const protector: ProtectorKind | undefined = mode === "FnEntry" ? "StrongProtector" : undefined;
    const kind = ty.kind();
    if (kind.$ === "Ref" && kind._2 === "Mut") {
      const pointee = kind._1;
      if (mode === "TwoPhase") {
        // We mostly just give up on 2phase-borrows, and treat these exactly like raw pointers.
        assert(protector === undefined, "assertion failed: protector.is_none()"); // RetagMode can't be both FnEntry and TwoPhase.
        return { $: "Uniform", perm: Permission.SharedReadWrite, access: undefined, protector: undefined };
      } else if (pointee.is_unpin(cx.tcx.tcx, cx.typing_env_()) && pointee.is_unsafe_unpin(cx.tcx.tcx, cx.typing_env_())) {
        // A regular full mutable reference. On `FnEntry` this is `noalias` and `dereferenceable`.
        return { $: "Uniform", perm: Permission.Unique, access: "Write", protector };
      } else {
        // `!Unpin` dereferences do not get `noalias` nor `dereferenceable`.
        return { $: "Uniform", perm: Permission.SharedReadWrite, access: undefined, protector: undefined };
      }
    } else if (kind.$ === "RawPtr" && kind._1 === "Mut") {
      assert(mode === "Raw", "assertion failed: mode == RetagMode::Raw");
      assert(protector === undefined, "assertion failed: protector.is_none()"); // RetagMode can't be both FnEntry and Raw.
      // Mutable raw pointer. No access, not protected.
      return { $: "Uniform", perm: Permission.SharedReadWrite, access: undefined, protector: undefined };
    } else if (kind.$ === "Ref" && kind._2 === "Not") {
      // Shared references. If frozen, these get `noalias` and `dereferenceable`; otherwise neither.
      return {
        $: "FreezeSensitive",
        freeze_perm: Permission.SharedReadOnly,
        freeze_access: "Read",
        freeze_protector: protector,
        nonfreeze_perm: Permission.SharedReadWrite,
        // Inside UnsafeCell, this does *not* count as an access, as there
        // might actually be mutable references further up the stack that
        // we have to keep alive.
        nonfreeze_access: undefined,
        // We do not protect inside UnsafeCell.
        // This fixes https://github.com/rust-lang/rust/issues/55005.
      };
    } else if (kind.$ === "RawPtr" && kind._1 === "Not") {
      assert(mode === "Raw", "assertion failed: mode == RetagMode::Raw");
      assert(protector === undefined, "assertion failed: protector.is_none()"); // RetagMode can't be both FnEntry and Raw.
      // `*const T`, when freshly created, are read-only in the frozen part.
      return {
        $: "FreezeSensitive",
        freeze_perm: Permission.SharedReadOnly,
        freeze_access: "Read",
        freeze_protector: undefined,
        nonfreeze_perm: Permission.SharedReadWrite,
        nonfreeze_access: undefined,
      };
    } else {
      return unreachable();
    }
  },

  // rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:133 from_box_ty
  from_box_ty(ty: Ty, mode: RetagMode, cx: MiriInterpCx): NewPermission {
    // `ty` is not the `Box` but the field of the Box with this pointer (due to allocator handling).
    const pointee = unwrap(ty.builtin_deref(true));
    if (pointee.is_unpin(cx.tcx.tcx, cx.typing_env_()) && pointee.is_unsafe_unpin(cx.tcx.tcx, cx.typing_env_())) {
      // A regular box. On `FnEntry` this is `noalias`, but not `dereferenceable` (hence only
      // a weak protector).
      return { $: "Uniform", perm: Permission.Unique, access: "Write", protector: mode === "FnEntry" ? "WeakProtector" : undefined };
    } else {
      // `!Unpin` boxes do not get `noalias` nor `dereferenceable`.
      return { $: "Uniform", perm: Permission.SharedReadWrite, access: undefined, protector: undefined };
    }
  },

  // rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:156 protector
  protector(self: NewPermission): ProtectorKind | undefined {
    switch (self.$) {
      case "Uniform":
        return self.protector;
      case "FreezeSensitive":
        return self.freeze_protector;
    }
  },
};

// # Stacked Borrows Core Begin

/// We need to make at least the following things true:
///
/// U1: After creating a `Uniq`, it is at the top.
/// U2: If the top is `Uniq`, accesses must be through that `Uniq` or remove it.
/// U3: If an access happens with a `Uniq`, it requires the `Uniq` to be in the stack.
///
/// F1: After creating a `&`, the parts outside `UnsafeCell` have our `SharedReadOnly` on top.
/// F2: If a write access happens, it pops the `SharedReadOnly`.  This has three pieces:
///     F2a: If a write happens granted by an item below our `SharedReadOnly`, the `SharedReadOnly`
///          gets popped.
///     F2b: No `SharedReadWrite` or `Unique` will ever be added on top of our `SharedReadOnly`.
/// F3: If an access happens with an `&` outside `UnsafeCell`,
///     it requires the `SharedReadOnly` to still be in the stack.
///
/// Core relation on `Permission` to define which accesses are allowed
// impl Permission
/// This defines for a given permission, whether it permits the given kind of access.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:183 grants
export function Permission_grants(self: Permission, access: AccessKind): boolean {
  // Disabled grants nothing. Otherwise, all items grant read access, and except for SharedReadOnly they grant write access.
  return self !== "Disabled" && (access === "Read" || self !== "SharedReadOnly");
}

// /// Determines whether an item was invalidated by a conflicting access, or by deallocation.
// enum ItemInvalidationCause { Conflict, Dealloc } (mod.gen.ts)

/// Core per-location operations: access, dealloc, reborrow.
// impl<'tcx> Stack
/// Find the first write-incompatible item above the given one --
/// i.e, find the height to which the stack will be truncated when writing to `granting`.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:201 find_first_write_incompatible
export function Stack_find_first_write_incompatible(self: Stack, granting: number): number {
  // PORT: `self.get(i)` copies the item; these read-only uses read the slot (no clone).
  const perm = unwrap(self.borrows[granting]).perm();
  switch (perm) {
    case "SharedReadOnly":
      return panic("Cannot use SharedReadOnly for writing");
    case "Disabled":
      return panic("Cannot use Disabled for anything");
    case "Unique":
      // On a write, everything above us is incompatible.
      return granting + 1;
    case "SharedReadWrite": {
      // The SharedReadWrite *just* above us are compatible, to skip those.
      let idx = granting + 1;
      let item: Item | undefined;
      while ((item = self.borrows[idx]) !== undefined) {
        if (item.perm() === Permission.SharedReadWrite) {
          // Go on.
          idx += 1;
        } else {
          // Found first incompatible!
          break;
        }
      }
      return idx;
    }
  }
}

/// The given item was invalidated -- check its protectors for whether that will cause UB.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:228 item_invalidated
export function Stack_item_invalidated(item: Item, global: GlobalStateInner, dcx: DiagnosticCx, cause: ItemInvalidationCause): InterpResult {
  if (!(global.tracked_pointer_tags.size === 0)) {
    dcx.check_tracked_tag_popped(item, global);
  }

  if (!item.protected()) {
    return interp_ok(undefined);
  }

  // We store tags twice, once in global.protected_tags and once in each call frame.
  // We do this because consulting a single global set in this function is faster
  // than attempting to search all call frames in the program for the `FrameExtra`
  // (if any) which is protecting the popped tag.
  //
  // This duplication trades off making `end_call` slower to make this function faster. This
  // trade-off is profitable in practice for a combination of two reasons.
  // 1. A single protected tag can (and does in some programs) protect thousands of `Item`s.
  //    Therefore, adding overhead in function call/return is profitable even if it only
  //    saves a little work in this function.
  // 2. Most frames protect only one or two tags. So this duplicative global turns a search
  //    which ends up about linear in the number of protected tags in the program into a
  //    constant time check (and a slow linear, because the tags in the frames aren't contiguous).
  const protector_kind = global.protected_tags.get(item.tag());
  if (protector_kind !== undefined) {
    // The only way this is okay is if the protector is weak and we are deallocating with
    // the right pointer.
    const allowed = cause === "Dealloc" && protector_kind === "WeakProtector";
    if (!allowed) {
      return Err(InterpErrorInfo_from_InterpErrorKind(dcx.protector_error(item, protector_kind)));
    }
  }
  return interp_ok(undefined);
}

/// Test if a memory `access` using pointer tagged `tag` is granted.
/// If yes, return the index of the item that granted it.
/// `range` refers the entire operation, and `offset` refers to the specific offset into the
/// allocation that we are currently checking.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:271 access
export function Stack_access(self: Stack, access: AccessKind, tag: ProvenanceExtra, global: GlobalStateInner, dcx: DiagnosticCx, exposed_tags: Set<BorTag>): InterpResult {
  // Two main steps: Find granting item, remove incompatible items above.

  // Step 1: Find granting item.
  const granting_r = self.find_granting(access, tag, exposed_tags);
  if (granting_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(dcx.access_error(self)));
  const granting_idx = granting_r._0;

  // Step 2: Remove incompatible items above them.  Make sure we do not remove protected
  // items.  Behavior differs for reads and writes.
  // In case of wildcards/unknown matches, we remove everything that is *definitely* gone.
  if (access === "Write") {
    // Remove everything above the write-compatible items, like a proper stack. This makes sure read-only and unique
    // pointers become invalid on write accesses (ensures F2a, and ensures U2 for write accesses).
    let first_incompatible_idx: number;
    if (granting_idx !== undefined) {
      // The granting_idx *might* be approximate, but any lower idx would remove more
      // things. Even if this is a Unique and the lower idx is an SRW (which removes
      // less), there is an SRW group boundary here so strictly more would get removed.
      first_incompatible_idx = Stack_find_first_write_incompatible(self, granting_idx);
    } else {
      // We are writing to something in the unknown part.
      // There is a SRW group boundary between the unknown and the known, so everything is incompatible.
      first_incompatible_idx = 0;
    }
    const r = self.pop_items_after(first_incompatible_idx, (item) => {
      const r = Stack_item_invalidated(item, global, dcx, "Conflict");
      if (r.$ === "Err") return r;
      dcx.log_invalidation(item.tag());
      return interp_ok(undefined);
    });
    if (r.$ === "Err") return r;
  } else {
    // On a read, *disable* all `Unique` above the granting item.  This ensures U2 for read accesses.
    // The reason this is not following the stack discipline (by removing the first Unique and
    // everything on top of it) is that in `let raw = &mut *x as *mut _; let _val = *x;`, the second statement
    // would pop the `Unique` from the reborrow of the first statement, and subsequently also pop the
    // `SharedReadWrite` for `raw`.
    // This pattern occurs a lot in the standard library: create a raw pointer, then also create a shared
    // reference and use that.
    // We *disable* instead of removing `Unique` to avoid "connecting" two neighbouring blocks of SRWs.
    let first_incompatible_idx: number;
    if (granting_idx !== undefined) {
      // The granting_idx *might* be approximate, but any lower idx would disable more things.
      first_incompatible_idx = granting_idx + 1;
    } else {
      // We are reading from something in the unknown part. That means *all* `Unique` we know about are dead now.
      first_incompatible_idx = 0;
    }
    const r = self.disable_uniques_starting_at(first_incompatible_idx, (item) => {
      const r = Stack_item_invalidated(item, global, dcx, "Conflict");
      if (r.$ === "Err") return r;
      dcx.log_invalidation(item.tag());
      return interp_ok(undefined);
    });
    if (r.$ === "Err") return r;
  }

  // If this was an approximate action, we now collapse everything into an unknown.
  if (granting_idx === undefined || tag.$ === "Wildcard") {
    // Compute the upper bound of the items that remain.
    // (This is why we did all the work above: to reduce the items we have to consider here.)
    let max = BorTag.one();
    for (let i = 0; i < self.len(); i++) {
      const item = unwrap(self.borrows[i]); // PORT: `self.get(i).unwrap()`, read-only (no clone)
      // Skip disabled items, they cannot be matched anyway.
      if (!(item.perm() === "Disabled")) {
        // We are looking for a strict upper bound, so add 1 to this tag.
        const succ = unwrap(BorTag.succ(item.tag()));
        max = succ > max ? succ : max; // cmp::max
      }
    }
    const unk = self.unknown_bottom_();
    if (unk !== undefined) {
      max = unk > max ? unk : max; // cmp::max
    }
    // Use `max` as new strict upper bound for everything.
    // trace!(
    //     "access: forgetting stack to upper bound {max} due to wildcard or unknown access",
    //     max = max.get(),
    // );
    self.set_unknown_bottom(max);
  }

  // Done.
  return interp_ok(undefined);
}

/// Deallocate a location: Like a write access, but also there must be no
/// active protectors at all because we will remove all items.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:359 dealloc
export function Stack_dealloc(self: Stack, tag: ProvenanceExtra, global: GlobalStateInner, dcx: DiagnosticCx, exposed_tags: Set<BorTag>): InterpResult {
  // Step 1: Make a write access.
  // As part of this we do regular protector checking, i.e. even weakly protected items cause UB when popped.
  const r = Stack_access(self, "Write", tag, global, dcx, exposed_tags);
  if (r.$ === "Err") return r;

  // Step 2: Pretend we remove the remaining items, checking if any are strongly protected.
  for (let idx = self.len() - 1; idx >= 0; idx--) {
    const item = unwrap(self.get(idx));
    const r = Stack_item_invalidated(item, global, dcx, "Dealloc");
    if (r.$ === "Err") return r;
  }

  return interp_ok(undefined);
}

/// Derive a new pointer from one with the given tag.
///
/// `access` indicates which kind of memory access this retag itself should correspond to.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:382 grant
export function Stack_grant(
  self: Stack,
  derived_from: ProvenanceExtra,
  new_: Item,
  access: AccessKind | undefined,
  global: GlobalStateInner,
  dcx: DiagnosticCx,
  exposed_tags: Set<BorTag>,
): InterpResult {
  dcx.start_grant(new_.perm());

  // Compute where to put the new item.
  // Either way, we ensure that we insert the new item in a way such that between
  // `derived_from` and the new one, there are only items *compatible with* `derived_from`.
  let new_idx: number;
  if (access !== undefined) {
    // Simple case: We are just a regular memory access, and then push our thing on top,
    // like a regular stack.
    // This ensures F2b for `Unique`, by removing offending `SharedReadOnly`.
    const r = Stack_access(self, access, derived_from, global, dcx, exposed_tags);
    if (r.$ === "Err") return r;

    // We insert "as far up as possible": We know only compatible items are remaining
    // on top of `derived_from`, and we want the new item at the top so that we
    // get the strongest possible guarantees.
    // This ensures U1 and F1.
    new_idx = self.len();
  } else {
    // The tricky case: creating a new SRW permission without actually being an access.
    assert(new_.perm() === Permission.SharedReadWrite, "assertion failed: new.perm() == Permission::SharedReadWrite");

    // First we figure out which item grants our parent (`derived_from`) this kind of access.
    // We use that to determine where to put the new item.
    const granting_r = self.find_granting("Write", derived_from, exposed_tags);
    if (granting_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(dcx.grant_error(self)));
    const granting_idx = granting_r._0;

    if (!(granting_idx !== undefined && derived_from.$ === "Concrete")) {
      // The parent is a wildcard pointer or matched the unknown bottom.
      // This is approximate. Nobody knows what happened, so forget everything.
      // The new thing is SRW anyway, so we cannot push it "on top of the unknown part"
      // (for all we know, it might join an SRW group inside the unknown).
      // trace!(
      //     "reborrow: forgetting stack entirely due to SharedReadWrite reborrow from wildcard or unknown"
      // );
      self.set_unknown_bottom(global.next_ptr_tag);
      return interp_ok(undefined);
    }

    // SharedReadWrite can coexist with "existing loans", meaning they don't act like a write
    // access.  Instead of popping the stack, we insert the item at the place the stack would
    // be popped to (i.e., we insert it above all the write-compatible items).
    // This ensures F2b by adding the new item below any potentially existing `SharedReadOnly`.
    new_idx = Stack_find_first_write_incompatible(self, granting_idx);
  }

  // Put the new item there.
  // trace!("reborrow: adding item {:?}", new);
  self.insert(new_idx, new_);
  return interp_ok(undefined);
}
// # Stacked Borrows Core End

declare module "./mod.gen.ts" {
  interface Stacks {
    // borrow_tracker/stacked_borrows/mod.rs:447
    remove_unreachable_tags(live_tags: Set<BorTag>): void;
    // borrow_tracker/stacked_borrows/mod.rs:456 (impl VisitProvenance for Stacks)
    visit_provenance(visit: VisitWith): void;
    // borrow_tracker/stacked_borrows/mod.rs:485
    for_each(range: AllocRange, dcx_builder: DiagnosticCxBuilder, f: (_0: Stack, _1: DiagnosticCx, _2: Set<BorTag>) => InterpResult): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:527
    before_memory_read(alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:551
    before_memory_write(alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult;
    // borrow_tracker/stacked_borrows/mod.rs:572
    before_memory_deallocation(alloc_id: AllocId, tag: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult;
  }
  namespace Stacks {
    // borrow_tracker/stacked_borrows/mod.rs:467
    function new_(size: Size, perm: Permission, tag: BorTag, id: AllocId, machine: MiriMachine): Stacks;
    export { new_ as new };
    // borrow_tracker/stacked_borrows/mod.rs:506
    export let new_allocation: (id: AllocId, size: Size, state: GlobalStateInner, kind: MemoryKind, machine: MiriMachine) => Stacks;
  }
}

/// Integration with the BorTag garbage collector
// impl Stacks
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:447 remove_unreachable_tags
Stacks.prototype.remove_unreachable_tags = function (this: Stacks, live_tags: Set<BorTag>): void {
  for (const [_stack_range, stack] of this.stacks.iter_mut_all()) {
    stack.retain(live_tags);
  }
  this.history.retain(live_tags);
};

// impl VisitProvenance for Stacks
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:456 visit_provenance
Stacks.prototype.visit_provenance = function (this: Stacks, visit: VisitWith): void {
  for (const tag of this.exposed_tags) {
    visit(undefined, tag);
  }
};

/// Map per-stack operations to higher-level per-location-range operations.
// impl<'tcx> Stacks
/// Creates a new stack with an initial tag. For diagnostic purposes, we also need to know
/// the [`AllocId`] of the allocation this is associated with.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:467 new
(Stacks as unknown as { new: (size: Size, perm: Permission, tag: BorTag, id: AllocId, machine: MiriMachine) => Stacks }).new = function (
  size: Size,
  perm: Permission,
  tag: BorTag,
  id: AllocId,
  machine: MiriMachine,
): Stacks {
  const item = Item.new(tag, perm, false);
  const stack = Stack.new(clone_Item(item));

  return new Stacks(DedupRangeMap.new(size, stack), AllocHistory.new(id, item, machine), new Set());
};

/// Call `f` on every stack in the range.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:485 for_each
Stacks.prototype.for_each = function (
  this: Stacks,
  range: AllocRange,
  dcx_builder: DiagnosticCxBuilder,
  f: (_0: Stack, _1: DiagnosticCx, _2: Set<BorTag>) => InterpResult,
): InterpResult {
  for (const [stack_range, stack] of this.stacks.iter_mut(range.start, range.size)) {
    // PORT: the iterator's `ops::Range<u64>` is `{ start: number; end: number }` (dedup_range_map.ts, C5 amendment).
    const dcx = dcx_builder.build(this.history, Size.from_bytes((stack_range as unknown as { start: number }).start));
    const r = f(stack, dcx, this.exposed_tags);
    if (r.$ === "Err") return r;
    dcx_builder = dcx.unbuild();
  }
  return interp_ok(undefined);
};

/** PORT(contract, header): `extra.borrow_tracker_sb()` / `_mut().get_mut()` as the `Stacks` upstream returns. */
function sb_state(extra: AllocExtra, mut: boolean): Stacks {
  return (mut ? extra.borrow_tracker_sb_mut() : extra.borrow_tracker_sb()) as unknown as Stacks;
}

/** PORT(contract, header): `AllocDataRaceHandler::as_vclocks_ref` / `as_vclocks_mut` (data_race_handler.rs:53/:57). */
function as_vclocks(h: AllocDataRaceHandler): VClockAlloc | undefined {
  // if let Self::Vclocks(data_race, _weak_memory) = self { Some(data_race) } else { None }
  return h.$ === "Vclocks" ? h._0 : undefined;
}

/// Glue code to connect with Miri Machine Hooks
// impl Stacks
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:506 new_allocation
Stacks.new_allocation = function (id: AllocId, size: Size, state: GlobalStateInner, kind: MemoryKind, machine: MiriMachine): Stacks {
  let base_tag: BorTag;
  let perm: Permission;
  switch (kind.$) {
    // New unique borrow. This tag is not accessible by the program,
    // so it will only ever be used when using the local directly (i.e.,
    // not through a pointer). That is, whenever we directly write to a local, this will pop
    // everything else off the stack, invalidating all previous pointers,
    // and in particular, *all* raw pointers.
    case "Stack":
      [base_tag, perm] = [state.root_ptr_tag(id, machine), Permission.Unique];
      break;
    // Everything else is shared by default.
    default:
      [base_tag, perm] = [state.root_ptr_tag(id, machine), Permission.SharedReadWrite];
      break;
  }
  return Stacks.new(size, perm, base_tag, id, machine);
};

// #[inline(always)]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:527 before_memory_read
Stacks.prototype.before_memory_read = function (this: Stacks, alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult {
  void alloc_id; // only in the `trace!` below
  // trace!(
  //     "read access with tag {:?}: {:?}, size {}",
  //     tag,
  //     interpret::Pointer::new(alloc_id, range.start),
  //     range.size.bytes()
  // );
  const dcx = DiagnosticCxBuilder.read(machine, tag, range);
  const state = unwrap(machine.borrow_tracker);
  return this.for_each(range, dcx, (stack, dcx, exposed_tags) => Stack_access(stack, "Read", tag, state, dcx, exposed_tags));
};

// #[inline(always)]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:551 before_memory_write
Stacks.prototype.before_memory_write = function (this: Stacks, alloc_id: AllocId, tag: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult {
  void alloc_id; // only in the `trace!` below
  // trace!(
  //     "write access with tag {:?}: {:?}, size {}",
  //     tag,
  //     interpret::Pointer::new(alloc_id, range.start),
  //     range.size.bytes()
  // );
  const dcx = DiagnosticCxBuilder.write(machine, tag, range);
  const state = unwrap(machine.borrow_tracker);
  return this.for_each(range, dcx, (stack, dcx, exposed_tags) => Stack_access(stack, "Write", tag, state, dcx, exposed_tags));
};

// #[inline(always)]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:572 before_memory_deallocation
Stacks.prototype.before_memory_deallocation = function (this: Stacks, alloc_id: AllocId, tag: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult {
  void alloc_id; // only in the `trace!` below
  // trace!("deallocation with tag {:?}: {:?}, size {}", tag, alloc_id, size.bytes());
  const dcx = DiagnosticCxBuilder.dealloc(machine, tag);
  const state = unwrap(machine.borrow_tracker);
  const r = this.for_each(alloc_range(Size.ZERO, size), dcx, (stack, dcx, exposed_tags) => Stack_dealloc(stack, tag, state, dcx, exposed_tags));
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Retagging/reborrowing.  There is some policy in here, such as which permissions
/// to grant for which references, and when to add protectors.
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

// impl<'tcx, 'ecx> EvalContextPrivExt<'tcx, 'ecx> for crate::MiriInterpCx<'tcx> {}
// trait EvalContextPrivExt<'tcx, 'ecx>: crate::MiriInterpCxExt<'tcx>
/// Returns the provenance that should be used henceforth.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:594 sb_reborrow
InterpCx.prototype.sb_reborrow = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  size: Size,
  new_perm: NewPermission,
  new_tag: BorTag,
  retag_info: RetagInfo, // diagnostics info about this retag
): InterpResult<Provenance | undefined> {
  const this_ = this.eval_context_mut();
  // Ensure we bail out if the pointer goes out-of-bounds (see miri#1050).
  const chk = this_.check_ptr_access(place.ptr(), size, { $: "Dereferenceable", _0: "pointer" });
  if (chk.$ === "Err") return chk;

  // It is crucial that this gets called on all code paths, to ensure we track tag creation.
  const log_creation = (
    this_: MiriInterpCx,
    loc: [AllocId, Size, ProvenanceExtra] | undefined, // alloc_id, base_offset, orig_tag
  ): InterpResult => {
    const global = unwrap(this_.machine.borrow_tracker);
    const ty = place.layout.ty;
    if (global.tracked_pointer_tags.has(new_tag)) {
      let kind_str = "";
      if (new_perm.$ === "Uniform") {
        kind_str += `${new_perm.perm} permission`;
      } else if (new_perm.$ === "FreezeSensitive" && ty.is_freeze(this_.tcx.tcx, this_.typing_env_())) {
        kind_str += `${new_perm.freeze_perm} permission`;
      } else if (new_perm.$ === "FreezeSensitive") {
        kind_str += `${new_perm.freeze_perm}/${new_perm.nonfreeze_perm} permission for frozen/non-frozen parts`;
      }
      kind_str += ` (pointee type ${display_Ty(ty)})`;
      const diag: NonHaltingDiagnostic = {
        $: "CreatedPointerTag",
        _0: BigInt(BorTag.inner(new_tag)),
        _1: kind_str,
        _2: loc === undefined ? undefined : [loc[0], alloc_range(loc[1], size), loc[2]],
      };
      this_.emit_diagnostic(diag);
    }
    // drop(global); // don't hold that reference any longer than we have to

    if (loc === undefined) {
      return interp_ok(undefined);
    }
    const [alloc_id, base_offset, orig_tag] = loc;

    const alloc_kind = this_.get_alloc_info(alloc_id).kind;
    switch (alloc_kind) {
      case "LiveData": {
        // This should have alloc_extra data, but `get_alloc_extra` can still fail
        // if converting this alloc_id from a global to a local one
        // uncovers a non-supported `extern static`.
        const extra_r = this_.get_alloc_extra(alloc_id);
        if (extra_r.$ === "Err") return extra_r;
        const stacked_borrows = sb_state(extra_r._0, false);
        // Note that we create a *second* `DiagnosticCxBuilder` below for the actual retag.
        // FIXME: can this be done cleaner?
        const dcx_b = DiagnosticCxBuilder.retag(this_.machine, retag_info, new_tag, orig_tag, alloc_range(base_offset, size));
        const dcx = dcx_b.build(stacked_borrows.history, base_offset);
        dcx.log_creation();
        if (NewPermission.protector(new_perm) !== undefined) {
          dcx.log_protector();
        }
        break;
      }
      case "Function":
      case "VTable":
      case "TypeId":
      case "Dead":
      case "VaList": {
        // No stacked borrows on these allocations.
        break;
      }
    }
    return interp_ok(undefined);
  };

  if (Size_eq(size, Size.ZERO)) {
    // trace!(
    //     "reborrow of size 0: reference {:?} derived from {:?} (pointee {}) with permissions {new_perm:?}",
    //     new_tag,
    //     place.ptr(),
    //     place.layout.ty,
    // );
    // Don't update any stacks for a zero-sized access; borrow stacks are per-byte and this
    // touches no bytes so there is no stack to put this tag in.
    // However, if the pointer for this operation points at a real allocation we still
    // record where it was created so that we can issue a helpful diagnostic if there is an
    // attempt to use it for a non-zero-sized access.
    // Dangling slices are a common case here; it's valid to get their length but with raw
    // pointer tagging for example all calls to get_unchecked on them are invalid.
    const got = this_.ptr_try_get_alloc_id(place.ptr(), 0n);
    if (got.$ === "Ok") {
      const [alloc_id, base_offset, orig_tag] = got._0;
      const r = log_creation(this_, [alloc_id, base_offset, orig_tag]);
      if (r.$ === "Err") return r;
      // Still give it the new provenance, it got retagged after all. If this was a
      // wildcard pointer, this will fix the AllocId and make future accesses with this
      // reference to other allocations UB, but that's fine: due to subobject provenance,
      // *all* future accesses with this reference should be UB!
      return interp_ok({ $: "Concrete", alloc_id, tag: new_tag });
    } else {
      // This pointer doesn't come with an AllocId. :shrug:
      const r = log_creation(this_, undefined);
      if (r.$ === "Err") return r;
      // Provenance unchanged. Ideally we'd make this pointer UB to use like above,
      // but there's no easy way to do that.
      return interp_ok(place.ptr().provenance);
    }
  }

  // The pointer *must* have a valid AllocId to continue, so we want to resolve this to
  // a concrete ID even for wildcard pointers.
  const got = this_.ptr_get_alloc_id(place.ptr(), 0n);
  if (got.$ === "Err") return got;
  const [alloc_id, base_offset, orig_tag] = got._0;
  const lc = log_creation(this_, [alloc_id, base_offset, orig_tag]);
  if (lc.$ === "Err") return lc;

  // trace!(
  //     "reborrow: reference {:?} derived from {:?} (pointee {}) with permissions {new_perm:?}: {:?}, size {}",
  //     new_tag,
  //     orig_tag,
  //     place.layout.ty,
  //     interpret::Pointer::new(alloc_id, base_offset),
  //     size.bytes()
  // );

  const protect = NewPermission.protector(new_perm);
  if (protect !== undefined) {
    // See comment in `Stack::item_invalidated` for why we store the tag twice.
    // PORT: `frame_mut()` is typed with the CTFE defaults; a Miri frame is `Frame<Provenance, FrameExtra>`.
    unwrap((this_.frame_mut() as unknown as Frame<Provenance, FrameExtra>).extra.borrow_tracker).protected_tags.push([alloc_id, new_tag]);
    unwrap(this_.machine.borrow_tracker).protected_tags.set(new_tag, protect);
  }

  // Update the stacks, according to the new permission information we are given.
  switch (new_perm.$) {
    case "Uniform": {
      const { perm, access, protector } = new_perm;
      assert(perm !== Permission.SharedReadOnly, "assertion failed: perm != Permission::SharedReadOnly");
      // Here we can avoid `borrow()` calls because we have mutable references.
      // Note that this asserts that the allocation is mutable -- but since we are creating a
      // mutable pointer, that seems reasonable.
      const em = this_.get_alloc_extra_mut(alloc_id);
      if (em.$ === "Err") return em;
      const [alloc_extra, machine] = em._0;
      const stacked_borrows = sb_state(alloc_extra, true);
      const item = Item.new(new_tag, perm, protector !== undefined);
      const range = alloc_range(base_offset, size);
      const global = unwrap(machine.borrow_tracker);
      const dcx = DiagnosticCxBuilder.retag(machine, retag_info, new_tag, orig_tag, alloc_range(base_offset, size));
      const r = stacked_borrows.for_each(range, dcx, (stack, dcx, exposed_tags) =>
        // PORT: `item` is `Copy`: each stack gets its own copy.
        Stack_grant(stack, orig_tag, clone_Item(item), access, global, dcx, exposed_tags),
      );
      if (r.$ === "Err") return r;
      // drop(global);
      if (access !== undefined) {
        assert(access === "Write", () => `assertion \`left == right\` failed\n  left: ${access}\n right: Write`);
        // Make sure the data race model also knows about this.
        // FIXME(genmc): Ensure this is still done in GenMC mode. Check for other places where GenMC may need to be informed.
        const data_race = as_vclocks(alloc_extra.data_race);
        if (data_race !== undefined) {
          const w = data_race.write_non_atomic(alloc_id, range, "Retag", place.layout.ty, machine);
          if (w.$ === "Err") return w;
        }
      }
      break;
    }
    case "FreezeSensitive": {
      const { freeze_perm, freeze_access, freeze_protector, nonfreeze_perm, nonfreeze_access } = new_perm;
      // The permission is not uniform across the entire range!
      // We need a frozen-sensitive reborrow.
      // We have to use shared references to alloc/memory_extra here since
      // `visit_freeze_sensitive` needs to access the global state.
      const er = this_.get_alloc_extra(alloc_id);
      if (er.$ === "Err") return er;
      const alloc_extra = er._0;
      const stacked_borrows = sb_state(alloc_extra, false);
      const v = this_.visit_freeze_sensitive(place, size, (range_, frozen) => {
        // Adjust range.
        // range.start += base_offset;
        const range = alloc_range(range_.start.add(base_offset), range_.size);
        // We are only ever `SharedReadOnly` inside the frozen bits.
        const [perm, access, protector] = frozen
          ? ([freeze_perm, freeze_access, freeze_protector] as const)
          : ([nonfreeze_perm, nonfreeze_access, undefined] as const);
        const item = Item.new(new_tag, perm, protector !== undefined);
        const global = unwrap(this_.machine.borrow_tracker);
        const dcx = DiagnosticCxBuilder.retag(this_.machine, retag_info, new_tag, orig_tag, alloc_range(base_offset, size));
        const r = stacked_borrows.for_each(range, dcx, (stack, dcx, exposed_tags) =>
          // PORT: `item` is `Copy`: each stack gets its own copy.
          Stack_grant(stack, orig_tag, clone_Item(item), access, global, dcx, exposed_tags),
        );
        if (r.$ === "Err") return r;
        // drop(global);
        if (access !== undefined) {
          assert(access === "Read", () => `assertion \`left == right\` failed\n  left: ${access}\n right: Read`);
          // Make sure the data race model also knows about this.
          const data_race = as_vclocks(alloc_extra.data_race);
          if (data_race !== undefined) {
            const rr = data_race.read_non_atomic(alloc_id, range, "Retag", place.layout.ty, this_.machine);
            if (rr.$ === "Err") return rr;
          }
        }
        return interp_ok(undefined);
      });
      if (v.$ === "Err") return v;
      break;
    }
  }

  return interp_ok({ $: "Concrete", alloc_id, tag: new_tag });
};

/** `static DEDUP: AtomicBool` of `sb_retag_place` (mod.rs:836): process-global, like upstream. */
let DEDUP = false;

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:824 sb_retag_place
InterpCx.prototype.sb_retag_place = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  new_perm: NewPermission,
  info: RetagInfo, // diagnostics info about this retag
): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_mut();
  // PORT: `size_and_align_of_val` / `ImmTy::from_immediate` are typed with the CTFE provenance default (interp-generic
  // left them unparameterised); the values are Miri's, so they cross that signature as `unknown` casts.
  const sa = this_.size_and_align_of_val(place as unknown as Projectable);
  if (sa.$ === "Err") return sa;
  const size = sa._0 === undefined ? undefined : sa._0[0];
  // FIXME: If we cannot determine the size (because the unsized tail is an `extern type`),
  // bail out -- we cannot reasonably figure out which memory range to reborrow.
  // See https://github.com/rust-lang/unsafe-code-guidelines/issues/276.
  if (size === undefined) {
    // static DEDUP: AtomicBool = AtomicBool::new(false);
    // if !DEDUP.swap(true, std::sync::atomic::Ordering::Relaxed)
    const was = DEDUP;
    DEDUP = true;
    if (!was) {
      this_.emit_diagnostic({ $: "ExternTypeReborrow" });
    }
    return interp_ok(clone_MPlaceTy(place, clone_Provenance));
  }

  // Compute new borrow.
  const new_tag = unwrap(this_.machine.borrow_tracker).new_ptr();

  // Reborrow.
  const np = this_.sb_reborrow(place, size, new_perm, new_tag, info);
  if (np.$ === "Err") return np;
  const new_prov = np._0;

  // Adjust place.
  // (If the closure gets called, that means the old provenance was `Some`, and hence the new
  // one must also be `Some`.)
  return interp_ok(clone_MPlaceTy(place, clone_Provenance).map_provenance((_) => unwrap(new_prov)));
};

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// pub trait EvalContextExt<'tcx>: crate::MiriInterpCxExt<'tcx>
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:858 sb_retag_ptr_value
InterpCx.prototype.sb_retag_ptr_value = function (this: MiriInterpCx, val: ImmTy, ty: Ty, mode: RetagMode): InterpResult<ImmTy | undefined> {
  const this_ = this.eval_context_mut();
  let cause: RetagCause;
  switch (mode) {
    case "TwoPhase":
      cause = "TwoPhase";
      break;
    case "FnEntry":
      cause = "FnEntry";
      break;
    case "Raw":
    case "Default":
      cause = "Normal";
      break;
    case "None":
      return interp_ok(undefined); // no retagging
  }
  let new_perm: NewPermission;
  if (ty.is_box()) {
    if (ty.is_box_global(this_.tcx.tcx)) {
      new_perm = NewPermission.from_box_ty(val.layout.ty, mode, this_);
    } else {
      // Boxes with custom allocator are not retagged.
      return interp_ok(undefined);
    }
  } else {
    new_perm = NewPermission.from_ref_ty(val.layout.ty, mode, this_);
  }

  const info = new RetagInfo(cause);
  const pr = this_.imm_ptr_to_mplace(val);
  if (pr.$ === "Err") return pr;
  const place = pr._0;
  const npr = this_.sb_retag_place(place, new_perm, info);
  if (npr.$ === "Err") return npr;
  const new_place = npr._0;
  return interp_ok(interpret_ImmTy.from_immediate(new_place.to_ref(this_) as unknown as Immediate, val.layout) as unknown as ImmTy);
};

/// Protect a place so that it cannot be used any more for the duration of the current function
/// call.
///
/// This is used to ensure soundness of in-place function argument/return passing.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:892 sb_protect_place
InterpCx.prototype.sb_protect_place = function (this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_mut();

  // Retag it. With protection! That is the entire point.
  const new_perm: NewPermission = { $: "Uniform", perm: Permission.Unique, access: "Write", protector: "StrongProtector" };
  return this_.sb_retag_place(place, new_perm, new RetagInfo("InPlaceFnPassing"));
};

/// Mark the given tag as exposed. It was found on a pointer with the given AllocId.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:905 sb_expose_tag
InterpCx.prototype.sb_expose_tag = function (this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult {
  const this_ = this.eval_context_ref();

  // Function pointers and dead objects don't have an alloc_extra so we ignore them.
  // This is okay because accessing them is UB anyway, no need for any Stacked Borrows checks.
  // NOT using `get_alloc_extra_mut` since this might be a read-only allocation!
  const kind = this_.get_alloc_info(alloc_id).kind;
  switch (kind) {
    case "LiveData": {
      // This should have alloc_extra data, but `get_alloc_extra` can still fail
      // if converting this alloc_id from a global to a local one
      // uncovers a non-supported `extern static`.
      const er = this_.get_alloc_extra(alloc_id);
      if (er.$ === "Err") return er;
      const alloc_extra = er._0;
      // trace!("Stacked Borrows tag {tag:?} exposed in {alloc_id:?}");
      sb_state(alloc_extra, false).exposed_tags.add(tag);
      break;
    }
    case "Function":
    case "VTable":
    case "TypeId":
    case "Dead":
    case "VaList": {
      // No stacked borrows on these allocations.
      break;
    }
  }
  return interp_ok(undefined);
};

/** `print!` / `println!`: Miri's own stdout (a write failure panics, like `print!`). */
function print_(s: string): void {
  const r = stdout_write_all(new TextEncoder().encode(s));
  if (r.$ === "Err") panic("failed printing to stdout");
}

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/mod.rs:932 print_stacks
InterpCx.prototype.print_stacks = function (this: MiriInterpCx, alloc_id: AllocId): InterpResult {
  const this_ = this.eval_context_mut();
  const er = this_.get_alloc_extra(alloc_id);
  if (er.$ === "Err") return er;
  const alloc_extra = er._0;
  const stacks = sb_state(alloc_extra, false);
  for (const [range_, stack] of stacks.stacks.iter_all()) {
    // PORT: `ops::Range<u64>` (dedup_range_map.ts, C5 amendment); `{range:?}` is `start..end`.
    const range = range_ as unknown as { start: number; end: number };
    print_(`${range.start}..${range.end}: [`);
    const bottom = stack.unknown_bottom_();
    if (bottom !== undefined) {
      print_(` unknown-bottom(..${debug_BorTag(bottom, PLAIN)})`);
    }
    for (let i = 0; i < stack.len(); i++) {
      const item = unwrap(stack.get(i));
      print_(` ${debug_Permission(item.perm(), PLAIN)}${debug_BorTag(item.tag(), PLAIN)}`);
    }
    print_(" ]\n");
  }
  return interp_ok(undefined);
};
