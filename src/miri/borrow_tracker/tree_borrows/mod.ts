// Port of src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a` (plan-m6
// wave 38). Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: `impl Tree` is on tree.gen.ts's class, another module's: `port_methods` (C10). `NewPermission` is this module's own.
// `LocationState_eq` below is the `#[derive(PartialEq)]` of tree.rs:36, which `DedupRangeMap::iter_mut` needs.
// Logging: upstream `trace!` lines are verbatim comments (A6: only `info!` is ported, by lane miri-log; this file has none).
import { type AccessKind, BorTag, BorrowTrackerMethod, type GlobalState, type GlobalStateInner, type TreeBorrowsParams } from "../mod.ts";
import { IdempotentForeignAccess } from "./foreign_access_skipping.ts";
import { NewPermission } from "./mod.gen.ts";
import { clone_Permission, display_Permission, Permission, Permission_eq } from "./perms.ts";
import { clone_LocationState, LocationState, Tree } from "./tree.ts";
import { AllocDataRaceHandler } from "../../concurrency/data_race_handler.ts";
import { DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { type NonHaltingDiagnostic } from "../../diagnostics.ts";
import { type ImmTy, type MPlaceTy, type Pointer } from "../../lib.ts";
import { clone_Provenance, type FrameExtra, type MemoryKind, type MiriInterpCx, type MiriMachine, type Provenance, type ProvenanceExtra } from "../../machine.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { debug_Size, Size, Size_eq } from "../../../rustc_abi/lib.ts";
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../../rustc_const_eval/interpret/machine.gen.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type Immediate, ImmTy as interpret_ImmTy } from "../../../rustc_const_eval/interpret/operand.ts";
import { clone_MPlaceTy } from "../../../rustc_const_eval/interpret/place.ts";
import { type Projectable } from "../../../rustc_const_eval/interpret/projection.ts";
import { type Frame } from "../../../rustc_const_eval/interpret/stack.gen.ts";
import { alloc_range, AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, InterpErrorInfo_from_InterpErrorKind, type InterpErrorKind, interp_ok, InterpResult, type UndefinedBehaviorInfo } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Instance } from "../../../rustc_middle/ty/instance.ts";
import { HasAttrs_DefId, type Ty } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
import { write_stderr } from "../../../std/io.ts";
export * from "./mod.gen.ts";

// pub mod diagnostics; mod foreign_access_skipping; mod perms; mod tree; mod tree_visitor; mod unimap; mod wildcard;
// #[cfg(test)] mod exhaustive;
// PORT: the child modules are their own TS modules (src/miri/lib.ts loads them).

// pub type AllocState = Tree; (mod.gen.ts)

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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

/** `#[derive(PartialEq)]` of `LocationState` (tree.rs:36). */
function LocationState_eq(a: LocationState, b: LocationState): boolean {
  return a.accessed === b.accessed && Permission_eq(a.permission, b.permission) && a.idempotent_foreign_access === b.idempotent_foreign_access;
}

/** `err_ub!(..)` (rustc_const_eval/interpret/intrinsics.ts has the same private helper). */
function err_ub(info: UndefinedBehaviorInfo): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: info };
}

/** `eprintln!` (PORT: synchronous write to fd 2, as borrow_tracker/mod.ts). */
function eprintln(s: string): void {
  write_stderr(`${s}\n`);
}

// impl<'tcx> Tree
port_methods("miri::borrow_tracker::tree_borrows::Tree", () => Tree, {
  /// Create a new allocation, i.e. a new tree
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:31 new_allocation
  new_allocation: function (id: AllocId, size: Size, state: GlobalStateInner, _kind: MemoryKind, machine: MiriMachine): Tree {
    const tag = state.root_ptr_tag(id, machine); // Fresh tag for the root
    const span = machine.current_user_relevant_span();
    return Tree.new(tag, size, span);
  },
});
port_methods("miri::borrow_tracker::tree_borrows::Tree", () => Tree.prototype, {
  /// Check that an access on the entire range is permitted, and update
  /// the tree.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:45 before_memory_access
  before_memory_access: function (this: Tree, access_kind: AccessKind, alloc_id: AllocId, prov: ProvenanceExtra, range: AllocRange, machine: MiriMachine): InterpResult {
    // trace!(
    //     "{} with tag {:?}: {:?}, size {}",
    //     access_kind,
    //     prov,
    //     interpret::Pointer::new(alloc_id, range.start),
    //     range.size.bytes(),
    // );
    const global = unwrap(machine.borrow_tracker);
    const span = machine.current_user_relevant_span();
    return this.perform_access(prov, range, access_kind, { $: "Explicit", _0: access_kind }, global, alloc_id, span);
  },

  /// Check that this pointer has permission to deallocate this range.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:74 before_memory_deallocation
  before_memory_deallocation: function (this: Tree, alloc_id: AllocId, prov: ProvenanceExtra, size: Size, machine: MiriMachine): InterpResult {
    const global = unwrap(machine.borrow_tracker);
    const span = machine.current_user_relevant_span();
    return this.dealloc(prov, alloc_range(Size.ZERO, size), global, alloc_id, span);
  },

  /// A tag just lost its protector.
  ///
  /// This emits a special kind of access that is only applied
  /// to accessed locations, as a protection against other
  /// tags not having been made aware of the existence of this
  /// protector.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:92 release_protector
  release_protector: function (
    this: Tree,
    machine: MiriMachine,
    global: GlobalState,
    tag: BorTag,
    alloc_id: AllocId, // diagnostics
  ): InterpResult {
    const span = machine.current_user_relevant_span();
    const r = this.perform_protector_end_access(tag, global, alloc_id, span);
    if (r.$ === "Err") return r;

    this.update_exposure_for_protector_release(tag);

    return interp_ok(undefined);
  },
});

/// Policy for a new borrow.
// #[derive(Debug, Clone, Copy)] pub struct NewPermission { .. } (mod.gen.ts)

// impl<'tcx> NewPermission
/// Determine NewPermission of the reference/Box from the type of the pointee.
///
/// A `ref_mutability` of `None` indicates a `Box` type.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:126 new
NewPermission.new = function (pointee: Ty, ref_mutability: Mutability | undefined, mode: RetagMode, cx: MiriInterpCx): NewPermission | undefined {
  if (mode === "None") {
    return undefined;
  }

  const ty_is_unpin = pointee.is_unpin(cx.tcx.tcx, cx.typing_env_()) && pointee.is_unsafe_unpin(cx.tcx.tcx, cx.typing_env_());
  const ty_is_freeze = pointee.is_freeze(cx.tcx.tcx, cx.typing_env_());
  const is_protected = mode === "FnEntry";

  // Check if the implicit writes feature is globally enabled, using the
  // `-Zmiri-tree-borrows-implicit-writes` flag, and not locally disabled using the
  // `#[rustc_no_writable]` attribute. For performance reasons, only performs the lookup if
  // is_protected is true as implicit writes are only performed for protected references.
  let implicit_writes_enabled = false;
  if (is_protected) {
    const implicit_writes = cx.get_tree_borrows_params().implicit_writes;
    const def_id = Instance.def_id(cx.frame().instance_());
    implicit_writes_enabled =
      implicit_writes && find_attr(HasAttrs_DefId.get_attrs(def_id, cx.tcx.tcx), (k) => (k.$ === "RustcNoWritable" ? null : undefined)) === undefined;
  }

  if ((ref_mutability === "Mut" || ref_mutability === undefined) && !ty_is_unpin) {
    // Mutable reference / Box to pinning type: retagging is a NOP.
    // FIXME: with `UnsafePinned`, this should do proper per-byte tracking.
    return undefined;
  }

  // enum Part { InsideFrozen, InsideUnsafeCell, Outside }
  type Part = "InsideFrozen" | "InsideUnsafeCell" | "Outside";

  const perm = (part: Part): Permission => {
    // Whether we should consider this byte to be frozen.
    // Outside bytes are frozen only if the entire type is frozen.
    let frozen: boolean;
    switch (part) {
      case "InsideFrozen":
        frozen = true;
        break;
      case "InsideUnsafeCell":
        frozen = false;
        break;
      case "Outside":
        frozen = ty_is_freeze;
        break;
    }
    switch (ref_mutability) {
      // Shared references
      case "Not":
        if (frozen) {
          return Permission.new_frozen();
        } else {
          return Permission.new_cell();
        }
      // Mutable references
      case "Mut": {
        if (implicit_writes_enabled && part !== "Outside") {
          // We cannot use `Unique` for the outside part.
          return Permission.new_unique();
        } else if (is_protected || frozen) {
          // We also use this for protected `&mut UnsafeCell` as otherwise adding
          // `noalias` would not be sound.
          return Permission.new_reserved_frz();
        } else {
          return Permission.new_reserved_im();
        }
      }
      // Boxes
      case undefined: {
        if (implicit_writes_enabled && part !== "Outside") {
          // Boxes are treated the same as mutable references.
          return Permission.new_unique();
        } else if (is_protected || frozen) {
          // We also use this for protected `Box<UnsafeCell>` as otherwise adding
          // `noalias` would not be sound.
          return Permission.new_reserved_frz();
        } else {
          return Permission.new_reserved_im();
        }
      }
    }
  };

  return new NewPermission(
    perm("InsideFrozen"),
    perm("InsideUnsafeCell"),
    perm("Outside"),
    is_protected
      ? ref_mutability !== undefined
        ? // Strong protector for references
          "StrongProtector"
        : // Weak protector for boxes
          "WeakProtector"
      : undefined,
  );
};

/// Retagging/reborrowing.
/// Policy on which permission to grant to each pointer should be left to
/// the implementation of NewPermission.
// impl<'tcx> EvalContextPrivExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// trait EvalContextPrivExt<'tcx>: crate::MiriInterpCxExt<'tcx>
// #[track_caller]
// #[inline]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:231 get_tree_borrows_params
InterpCx.prototype.get_tree_borrows_params = function (this: MiriInterpCx): TreeBorrowsParams {
  const this_ = this.eval_context_ref();
  const borrow_tracker = unwrap(this_.machine.borrow_tracker);
  return BorrowTrackerMethod.get_tree_borrows_params(borrow_tracker.borrow_tracker_method);
};

/// Returns the provenance that should be used henceforth.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:238 tb_reborrow
InterpCx.prototype.tb_reborrow = function (
  this: MiriInterpCx,
  place: MPlaceTy, // parent tag extracted from here
  ptr_size: Size,
  new_perm: NewPermission,
  new_tag: BorTag,
): InterpResult<Provenance | undefined> {
  const this_ = this.eval_context_mut();
  // Ensure we bail out if the pointer goes out-of-bounds (see miri#1050).
  const chk = this_.check_ptr_access(place.ptr(), ptr_size, { $: "Dereferenceable", _0: "pointer" });
  if (chk.$ === "Err") return chk;

  // It is crucial that this gets called on all code paths, to ensure we track tag creation.
  const log_creation = (
    this_: MiriInterpCx,
    loc: [AllocId, Size, ProvenanceExtra] | undefined, // alloc_id, base_offset, orig_tag
  ): InterpResult => {
    const global = unwrap(this_.machine.borrow_tracker);
    const ty = place.layout.ty;
    if (global.tracked_pointer_tags.has(new_tag)) {
      const ty_is_freeze = ty.is_freeze(this_.tcx.tcx, this_.typing_env_());
      const kind_str = ty_is_freeze
        ? `initial state ${display_Permission(new_perm.freeze_perm)} (pointee type ${display_Ty(ty)})`
        : `initial state ${display_Permission(new_perm.freeze_perm)}/${display_Permission(new_perm.nonfreeze_perm)} outside/inside UnsafeCell (pointee type ${display_Ty(ty)})`;
      const diag: NonHaltingDiagnostic = {
        $: "CreatedPointerTag",
        _0: BigInt(BorTag.inner(new_tag)),
        _1: kind_str,
        _2: loc === undefined ? undefined : [loc[0], alloc_range(loc[1], ptr_size), loc[2]],
      };
      this_.emit_diagnostic(diag);
    }
    // drop(global); // don't hold that reference any longer than we have to
    return interp_ok(undefined);
  };

  // trace!("Reborrow of size {:?}", ptr_size);
  // Unlike SB, we *do* a proper retag for size 0 if can identify the allocation.
  // After all, the pointer may be lazily initialized outside this initial range.
  const got = this_.ptr_try_get_alloc_id(place.ptr(), 0n);
  if (got.$ !== "Ok") {
    assert_eq(ptr_size, Size.ZERO, (v) => debug_Size(v, PLAIN), Size_eq); // we did the deref check above, size has to be 0 here
    // This pointer doesn't come with an AllocId, so there's no
    // memory to do retagging in.
    const new_prov = place.ptr().provenance;
    // trace!("reborrow of size 0: reusing {:?} (pointee {})", place.ptr(), place.layout.ty,);
    const lc = log_creation(this_, undefined);
    if (lc.$ === "Err") return lc;
    // Keep original provenance.
    return interp_ok(new_prov);
  }
  const [alloc_id, base_offset, parent_prov] = got._0;
  const new_prov: Provenance = { $: "Concrete", alloc_id, tag: new_tag };

  const lc = log_creation(this_, [alloc_id, base_offset, parent_prov]);
  if (lc.$ === "Err") return lc;

  // trace!(
  //     "reborrow: reference {:?} derived from {:?} (pointee {}): {:?}, size {}",
  //     new_tag,
  //     parent_prov,
  //     place.layout.ty,
  //     interpret::Pointer::new(alloc_id, base_offset),
  //     ptr_size.bytes()
  // );

  const protect = new_perm.protector;
  if (protect !== undefined) {
    // We register the protection in two different places.
    // This makes creating a protector slower, but checking whether a tag
    // is protected faster.
    // PORT: `frame_mut()` is typed with the CTFE defaults; a Miri frame is `Frame<Provenance, FrameExtra>`.
    unwrap((this_.frame_mut() as unknown as Frame<Provenance, FrameExtra>).extra.borrow_tracker).protected_tags.push([alloc_id, new_tag]);
    unwrap(this_.machine.borrow_tracker, "We should have borrow tracking data").protected_tags.set(new_tag, protect);
  }

  const alloc_kind = this_.get_alloc_info(alloc_id).kind;
  if (alloc_kind !== "LiveData") {
    assert_eq(ptr_size, Size.ZERO, (v) => debug_Size(v, PLAIN), Size_eq); // we did the deref check above, size has to be 0 here
    // There's not actually any bytes here where accesses could even be tracked.
    // Just produce the new provenance, nothing else to do.
    return interp_ok(new_prov);
  }

  const protected_ = new_perm.protector !== undefined;
  const precise_interior_mut = this_.get_tree_borrows_params().precise_interior_mut;

  // Compute initial "inside" permissions.
  const loc_state = (frozen: boolean): LocationState => {
    // PORT: `Permission` is `Copy`: the state gets its own.
    const perm = clone_Permission(frozen ? new_perm.freeze_perm : new_perm.nonfreeze_perm);
    const sifa = perm.strongest_idempotent_foreign_access(protected_);

    if (perm.associated_access() !== undefined) {
      return LocationState.new_accessed(perm, sifa);
    } else {
      return LocationState.new_non_accessed(perm, sifa);
    }
  };
  let inside_perms: DedupRangeMap<LocationState>;
  if (!precise_interior_mut) {
    // For `!Freeze` types, just pretend the entire thing is an `UnsafeCell`.
    const ty_is_freeze = place.layout.ty.is_freeze(this_.tcx.tcx, this_.typing_env_());
    inside_perms = DedupRangeMap.new(ptr_size, loc_state(ty_is_freeze));
  } else {
    // The initial state will be overwritten by the visitor below.
    const perms_map = DedupRangeMap.new(ptr_size, LocationState.new_accessed(Permission.new_disabled(), IdempotentForeignAccess.None));
    const v = this_.visit_freeze_sensitive(place, ptr_size, (range, frozen) => {
      const state = loc_state(frozen);
      for (const [_loc_range, _loc, elem] of perms_map.iter_mut(range.start, range.size, clone_LocationState, LocationState_eq)) {
        // PORT: `LocationState` is `Copy` and mutable here: each element gets its own (`*loc = state`).
        elem.data = clone_LocationState(state);
      }
      return interp_ok(undefined);
    });
    if (v.$ === "Err") return v;
    inside_perms = perms_map;
  }

  const er = this_.get_alloc_extra(alloc_id);
  if (er.$ === "Err") return er;
  const alloc_extra = er._0;
  const tree_borrows = alloc_extra.borrow_tracker_tb();

  for (const [perm_range, loc_state] of inside_perms.iter_all()) {
    const access = loc_state.permission_().associated_access();
    if (access !== undefined) {
      // Some reborrows incur a read/write access to the parent.
      // As a write also implies a read, a single write is performed instead of a read and a write.

      // writing to an immutable allocation (static variables) is UB, check this here
      if (access === "Write" && InterpResult.unwrap(this_.get_alloc_mutability(alloc_id)) === "Not") {
        // throw_ub!(WriteToReadOnly(alloc_id))
        return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "WriteToReadOnly", _0: alloc_id })));
      }

      // Adjust range to be relative to allocation start (rather than to `place`).
      const range_in_alloc = new AllocRange(Size.from_bytes(perm_range.start).add(base_offset), Size.from_bytes(perm_range.end - perm_range.start));

      const pa = tree_borrows.perform_access(
        parent_prov,
        range_in_alloc,
        access,
        { $: "Reborrow", _0: access },
        unwrap(this_.machine.borrow_tracker),
        alloc_id,
        this_.machine.current_user_relevant_span(),
      );
      if (pa.$ === "Err") return pa;

      // Also inform the data race model (but only if any bytes are actually affected).
      if (range_in_alloc.size.bytes() > 0) {
        const data_race = AllocDataRaceHandler.as_vclocks_ref(alloc_extra.data_race);
        if (data_race !== undefined) {
          switch (access) {
            case "Read": {
              const r = data_race.read_non_atomic(alloc_id, range_in_alloc, "Retag", place.layout.ty, this_.machine);
              if (r.$ === "Err") return r;
              break;
            }
            case "Write": {
              const w = data_race.write_non_atomic(alloc_id, range_in_alloc, "Retag", place.layout.ty, this_.machine);
              if (w.$ === "Err") return w;
              break;
            }
          }
        }
      }
    }
  }

  // Record the parent-child pair in the tree.
  const nc = tree_borrows.new_child(
    base_offset,
    parent_prov,
    new_tag,
    inside_perms,
    clone_Permission(new_perm.outside_perm),
    protected_,
    this_.machine.current_user_relevant_span(),
  );
  if (nc.$ === "Err") return nc;

  return interp_ok(new_prov);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:436 tb_retag_place
InterpCx.prototype.tb_retag_place = function (this: MiriInterpCx, place: MPlaceTy, new_perm: NewPermission): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_mut();

  // Determine the size of the reborrow.
  // For most types this is the entire size of the place, however
  // - when `extern type` is involved we use the size of the known prefix,
  // - if the pointer is not reborrowed (raw pointer) then we override the size
  //   to do a zero-length reborrow.
  // PORT: `size_and_align_of_val` / `ImmTy::from_immediate` are typed with the CTFE provenance default (interp-generic
  // left them unparameterised); the values are Miri's, so they cross that signature as `unknown` casts.
  const sa = this_.size_and_align_of_val(place as unknown as Projectable);
  if (sa.$ === "Err") return sa;
  const reborrow_size = sa._0 === undefined ? place.layout.size : sa._0[0];
  // trace!("Creating new permission: {:?} with size {:?}", new_perm, reborrow_size);

  // This new tag is not guaranteed to actually be used.
  //
  // If you run out of tags, consider the following optimization: adjust `tb_reborrow`
  // so that rather than taking as input a fresh tag and deciding whether it uses this
  // one or the parent it instead just returns whether a new tag should be created.
  // This will avoid creating tags than end up never being used.
  const new_tag = unwrap(this_.machine.borrow_tracker).new_ptr();

  // Compute the actual reborrow.
  const np = this_.tb_reborrow(place, reborrow_size, new_perm, new_tag);
  if (np.$ === "Err") return np;
  const new_prov = np._0;

  // Adjust place.
  // (If the closure gets called, that means the old provenance was `Some`, and hence the new
  // one must also be `Some`.)
  return interp_ok(clone_MPlaceTy(place, clone_Provenance).map_provenance((_) => unwrap(new_prov)));
};

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// pub trait EvalContextExt<'tcx>: crate::MiriInterpCxExt<'tcx>
/// Retag a pointer. References are passed to `from_ref_ty` and
/// raw pointers are never reborrowed.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:474 tb_retag_ptr_value
InterpCx.prototype.tb_retag_ptr_value = function (this: MiriInterpCx, val: ImmTy, ty: Ty, mode: RetagMode): InterpResult<ImmTy | undefined> {
  const this_ = this.eval_context_mut();
  let new_perm: NewPermission | undefined;
  const kind = ty.kind();
  if (ty.is_box_global(this_.tcx.tcx)) {
    // The `None` marks this as a Box.
    new_perm = NewPermission.new(unwrap(ty.builtin_deref(true)), undefined, mode, this_);
  } else if (kind.$ === "Ref") {
    new_perm = NewPermission.new(kind._1, kind._2, mode, this_);
  } else if (kind.$ === "RawPtr") {
    assert(mode === "Raw", "assertion failed: mode == RetagMode::Raw");
    // We don't give new tags to raw pointers.
    new_perm = undefined;
  } else if (ty.is_box()) {
    // No retagging for boxes with custom allocators.
    new_perm = undefined;
  } else {
    return panic(`tb_retag_ptr_value: invalid type ${display_Ty(ty)}`);
  }
  if (new_perm !== undefined) {
    const pr = this_.imm_ptr_to_mplace(val);
    if (pr.$ === "Err") return pr;
    const place = pr._0;
    const npr = this_.tb_retag_place(place, new_perm);
    if (npr.$ === "Err") return npr;
    const new_place = npr._0;
    return interp_ok(interpret_ImmTy.from_immediate(new_place.to_ref(this_) as unknown as Immediate, val.layout) as unknown as ImmTy);
  } else {
    return interp_ok(undefined);
  }
};

/// Protect a place so that it cannot be used any more for the duration of the current function
/// call.
///
/// This is used to ensure soundness of in-place function argument/return passing.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:513 tb_protect_place
InterpCx.prototype.tb_protect_place = function (this: MiriInterpCx, place: MPlaceTy): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_mut();

  // Retag it. With protection! That is the entire point.
  const new_perm = new NewPermission(
    // Note: If we are creating a protected Reserved, which can
    // never be ReservedIM, the value of the `ty_is_freeze`
    // argument doesn't matter
    // (`ty_is_freeze || true` in `new_reserved` will always be `true`).
    Permission.new_reserved_frz(),
    Permission.new_reserved_frz(),
    Permission.new_reserved_frz(),
    "StrongProtector",
  );
  return this_.tb_retag_place(place, new_perm);
};

/// Mark the given tag as exposed. It was found on a pointer with the given AllocId.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:531 tb_expose_tag
InterpCx.prototype.tb_expose_tag = function (this: MiriInterpCx, alloc_id: AllocId, tag: BorTag): InterpResult {
  const this_ = this.eval_context_ref();

  // Function pointers and dead objects don't have an alloc_extra so we ignore them.
  // This is okay because accessing them is UB anyway, no need for any Tree Borrows checks.
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
      // trace!("Tree Borrows tag {tag:?} exposed in {alloc_id:?}");

      const global = unwrap(this_.machine.borrow_tracker);
      const protected_tags = global.protected_tags;
      const protected_ = protected_tags.has(tag);
      alloc_extra.borrow_tracker_tb().expose_tag(tag, protected_);
      break;
    }
    case "Function":
    case "VTable":
    case "TypeId":
    case "Dead":
    case "VaList": {
      // No tree borrows on these allocations.
      break;
    }
  }
  return interp_ok(undefined);
};

/// Display the tree.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:563 print_tree
InterpCx.prototype.print_tree = function (this: MiriInterpCx, alloc_id: AllocId, show_unnamed: boolean): InterpResult {
  const this_ = this.eval_context_mut();
  const er = this_.get_alloc_extra(alloc_id);
  if (er.$ === "Err") return er;
  const alloc_extra = er._0;
  const tree_borrows = alloc_extra.borrow_tracker_tb();
  const borrow_tracker = unwrap(this_.machine.borrow_tracker);
  return tree_borrows.print_tree(borrow_tracker.protected_tags, show_unnamed);
};

/// Give a name to the pointer, usually the name it has in the source code (for debugging).
/// The name given is `name` and the pointer that receives it is the `nth_parent`
/// of `ptr` (with 0 representing `ptr` itself)
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/mod.rs:574 tb_give_pointer_debug_name
InterpCx.prototype.tb_give_pointer_debug_name = function (this: MiriInterpCx, ptr: Pointer, nth_parent: number, name: string): InterpResult {
  const this_ = this.eval_context_mut();
  const provenance = ptr.provenance;
  if (provenance === undefined) {
    eprintln(`Can't give the name ${name} to pointer without provenance`);
    return interp_ok(undefined);
  }
  if (provenance.$ === "Wildcard") {
    eprintln(`Can't give the name ${name} to wildcard pointer`);
    return interp_ok(undefined);
  }
  const { tag, alloc_id } = provenance;
  const er = this_.get_alloc_extra(alloc_id);
  if (er.$ === "Err") return er;
  const alloc_extra = er._0;
  const tree_borrows = alloc_extra.borrow_tracker_tb();
  return tree_borrows.give_pointer_debug_name(tag, nth_parent, name);
};
