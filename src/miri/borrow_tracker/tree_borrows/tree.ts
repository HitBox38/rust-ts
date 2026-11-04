//! In this file we handle the "Tree" part of Tree Borrows, i.e. all tree
//! traversal functions, optimizations to trim branches, and keeping track of
//! the relative position of the access to each node being updated. This of course
//! also includes the definition of the tree structure.
//!
//! Functions here manipulate permissions but are oblivious to them: as
//! the internals of `Permission` are private, the update process is a black
//! box. All we need to know here are
//! - the fact that updates depend only on the old state, the status of protectors,
//!   and the relative position of the access;
//! - idempotency properties asserted in `perms.rs` (for optimizations)
// Port of src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-b`
// (plan-m6 wave 38). Its types are generated into tree.gen.ts (tools/codegen set `miri`); this module re-exports them.
// tree/tests.rs (`mod tests`) is ported as tree/tests.test.ts.pending-tb-a (it needs lane miri-tb-a; root renames it).
//
// PORT: `LocationState` is `Copy` and mutated in place, so every copy that stays live next to its source is a
// `clone_LocationState` (`new_child`'s `loc.perms.insert(idx, perm)` runs once per location range;
// `perform_access_no_fluff` takes `self` by value). A copy only read before the next access (`old_state` in the skippers,
// `perm` in `dealloc`'s check) shares the object: it is never written, and this is the hot path.
// PORT: `Permission` is `Copy`, but upstream has no `&mut self` method on it and no code assigns its `inner` (a transition
// stores a new value), so its copies share the object. The same goes for `UniIndex` (`idx` is never assigned) and for
// `AllocRange` (miri-sb's note).
// PORT: `Ord for IdempotentForeignAccess` is `IdempotentForeignAccess_discriminant`.
// PORT: the `Range<u64>` of `DiagnosticInfo.transition_range` / `Event.transition_range` is generated as `bigint`s (C5),
// while `DedupRangeMap` ranges are numbers (its C5 amendment), so `transition_range_of` converts them. Only the diagnostics
// read these ranges.
import { type AccessKind, type BorTag, type GlobalState } from "../mod.ts";
import { AccessCause, DiagnosticInfo, fmt_Permission, no_valid_exposed_references_error, NodeDebugInfo, TbError, type TransitionError } from "./diagnostics.ts";
import { debug_IdempotentForeignAccess, IdempotentForeignAccess, IdempotentForeignAccess_discriminant } from "./foreign_access_skipping.ts";
import { type PermTransition, Permission, type PermissionPriv } from "./perms.ts";
import * as gen from "./tree.gen.ts";
import { clone_LocationState, LocationState, LocationTree, Node, Tree } from "./tree.gen.ts";
import { ChildrenVisitMode, ContinueTraversal, type NodeAppArgs, TreeVisitor } from "./tree_visitor.ts";
import { type UniIndex, UniKeyMap, UniValMap } from "./unimap.ts";
import { ExposedCache, type ExposedCacheNode, WildcardAccessLevel, WildcardAccessRelatedness } from "./wildcard.ts";
import { type DedupRange, DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { type ProvenanceExtra } from "../../machine.ts";
import { type VisitWith } from "../../provenance_gc.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, InterpErrorInfo_from_InterpErrorKind, type InterpErrorKind, interp_ok, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { field_mut, type MutRef } from "../../../std/mut_ref.ts";
import { assert, assert_eq, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
export * from "./tree.gen.ts";

// ---- PORT(contract): pending miri-tb-a ----
// Items of lane miri-tb-a's files that its stubs do not declare, with upstream's signatures. `impl IdempotentForeignAccess`,
// `impl WildcardAccessLevel` and `impl WildcardAccessRelatedness` are "companion fns / hand type, lane decides" in the
// stubs' inventories: these are written to PORTING §8 (enum methods on the companion const; `&mut self` of a single-value
// handle is a `MutRef`). A companion const cannot be augmented with `declare module`, and reading it at load would break
// C10 (2), so each is reached by casting the companion at call time. All of it is here so integration changes one place.
// See docs/handoff/miri-tb-b.md.
interface IdempotentForeignAccess_methods {
  // borrow_tracker/tree_borrows/foreign_access_skipping.rs:40
  can_skip_foreign_access(self: IdempotentForeignAccess, happening_next: IdempotentForeignAccess): boolean;
  // borrow_tracker/tree_borrows/foreign_access_skipping.rs:49
  record_new(self: MutRef<IdempotentForeignAccess>, just_happened: IdempotentForeignAccess): void;
  // borrow_tracker/tree_borrows/foreign_access_skipping.rs:70
  from_foreign(acc: AccessKind): IdempotentForeignAccess;
  // borrow_tracker/tree_borrows/foreign_access_skipping.rs:80
  from_acc_and_rel(acc: AccessKind, rel: gen.AccessRelatedness): IdempotentForeignAccess;
  // borrow_tracker/tree_borrows/foreign_access_skipping.rs:87
  ensure_no_stronger_than(self: MutRef<IdempotentForeignAccess>, strongest_allowed: IdempotentForeignAccess): boolean;
}
const IFA = (): IdempotentForeignAccess_methods => IdempotentForeignAccess as unknown as IdempotentForeignAccess_methods;
// borrow_tracker/tree_borrows/wildcard.rs:24
const allows = (self: WildcardAccessLevel, kind: AccessKind): boolean =>
  (WildcardAccessLevel as unknown as { allows(self: WildcardAccessLevel, kind: AccessKind): boolean }).allows(self, kind);
// borrow_tracker/tree_borrows/wildcard.rs:44
const to_relatedness = (self: WildcardAccessRelatedness): gen.AccessRelatedness | undefined =>
  (WildcardAccessRelatedness as unknown as { to_relatedness(self: WildcardAccessRelatedness): gen.AccessRelatedness | undefined }).to_relatedness(self);
declare module "./unimap.gen.ts" {
  interface UniValMap<V> {
    // borrow_tracker/tree_borrows/unimap.rs:65: `V: PartialEq` as a parameter (PORTING §5, as `DedupRangeMap`'s `eq_T`).
    equivalent(other: UniValMap<V>, eq_V: (a: V, b: V) => boolean): boolean;
  }
}

/** `#[derive(PartialEq)]` of `PermissionPriv` / `Permission` (perms.rs:10, :238). */
function PermissionPriv_eq(a: PermissionPriv, b: PermissionPriv): boolean {
  return a.$ === "ReservedFrz" ? b.$ === "ReservedFrz" && a.conflicted === b.conflicted : a.$ === b.$;
}
/** `#[derive(PartialEq)]` of `ExposedCacheNode` (wildcard.rs:66). */
function ExposedCacheNode_eq(a: ExposedCacheNode, b: ExposedCacheNode): boolean {
  return a.local_writes === b.local_writes && a.local_reads === b.local_reads;
}

// ---- end of PORT(contract) ----

/** `#[derive(PartialEq)]` of `LocationState` (:36). */
export function LocationState_eq(a: LocationState, b: LocationState): boolean {
  return a.accessed === b.accessed && PermissionPriv_eq(a.permission.inner, b.permission.inner) && a.idempotent_foreign_access === b.idempotent_foreign_access;
}

/** `#[derive(PartialEq)]` of `LocationTree` (:261). `ExposedCache`'s derived eq is its `UniValMap`'s (wildcard.rs:61). */
export function LocationTree_eq(a: LocationTree, b: LocationTree): boolean {
  return a.perms.equivalent(b.perms, LocationState_eq) && a.exposed_cache._0.equivalent(b.exposed_cache._0, ExposedCacheNode_eq);
}

/** PORT: `Range<u64>` of a `DedupRangeMap` element as the generated type of `transition_range` (header). */
function transition_range_of(r: DedupRange): { start: bigint; end: bigint } {
  return { start: BigInt(r.start), end: BigInt(r.end) };
}

declare module "./tree.gen.ts" {
  interface LocationState {
    // borrow_tracker/tree_borrows/tree.rs:78
    possible(): boolean;
    // borrow_tracker/tree_borrows/tree.rs:85 // PORT: `accessed_` (a field `accessed` exists; mir-contract rule)
    accessed_(): boolean;
    // borrow_tracker/tree_borrows/tree.rs:89 // PORT: `permission_` (a field `permission` exists; mir-contract rule)
    permission_(): Permission;
    // borrow_tracker/tree_borrows/tree.rs:95
    perform_transition(idx: UniIndex, nodes: UniValMap<Node>, exposed_cache: ExposedCache, access_kind: AccessKind, relatedness: gen.AccessRelatedness, protected_: boolean, diagnostics: DiagnosticInfo): Result<null, TransitionError>;
    // borrow_tracker/tree_borrows/tree.rs:132
    perform_access(access_kind: AccessKind, rel_pos: gen.AccessRelatedness, protected_: boolean): Result<PermTransition, TransitionError>;
    // borrow_tracker/tree_borrows/tree.rs:168
    perform_access_no_fluff(access_kind: AccessKind, rel_pos: gen.AccessRelatedness, protected_: boolean): LocationState | undefined;
    // borrow_tracker/tree_borrows/tree.rs:182
    skip_if_known_noop(access_kind: AccessKind, rel_pos: gen.AccessRelatedness): ContinueTraversal;
    // borrow_tracker/tree_borrows/tree.rs:240
    record_new_access(access_kind: AccessKind, rel_pos: gen.AccessRelatedness): void;
  }
  namespace LocationState {
    // borrow_tracker/tree_borrows/tree.rs:64
    export let new_non_accessed: (permission: Permission, sifa: IdempotentForeignAccess) => LocationState;
    // borrow_tracker/tree_borrows/tree.rs:73
    export let new_accessed: (permission: Permission, sifa: IdempotentForeignAccess) => LocationState;
  }
}
declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/tree.rs:391
    new_child(base_offset: Size, parent_prov: ProvenanceExtra, new_tag: BorTag, inside_perms: DedupRangeMap<LocationState>, outside_perm: Permission, protected_: boolean, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:477
    update_idempotent_foreign_access_after_retag(current: UniIndex, strongest_allowed: IdempotentForeignAccess): void;
    // borrow_tracker/tree_borrows/tree.rs:522
    dealloc(prov: ProvenanceExtra, access_range: AllocRange, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:623
    perform_access(prov: ProvenanceExtra, access_range: AllocRange, access_kind: AccessKind, access_cause: AccessCause, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:671
    perform_protector_end_access(tag: BorTag, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:732
    remove_unreachable_tags(live_tags: Set<BorTag>): void;
    // borrow_tracker/tree_borrows/tree.rs:745
    is_useless(idx: UniIndex, live: Set<BorTag>): boolean;
    // borrow_tracker/tree_borrows/tree.rs:753
    can_be_replaced_by_single_child(idx: UniIndex, live: Set<BorTag>): UniIndex | undefined;
    // borrow_tracker/tree_borrows/tree.rs:796
    remove_useless_node(this_: UniIndex): void;
    // borrow_tracker/tree_borrows/tree.rs:823
    remove_useless_children(root: UniIndex, live: Set<BorTag>): void;
  }
  namespace Tree {
    // borrow_tracker/tree_borrows/tree.rs:338
    function new_(root_tag: BorTag, size: Size, span: Span): Tree;
    export { new_ as new };
  }
}
declare module "./tree.gen.ts" {
  interface LocationTree {
    // borrow_tracker/tree_borrows/tree.rs:913
    perform_access(roots: Iterable<UniIndex>, nodes: UniValMap<Node>, access_source: UniIndex | undefined, access_kind: AccessKind, global: GlobalState, visit_children: ChildrenVisitMode, diagnostics: DiagnosticInfo, min_exposed_child: BorTag | undefined): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:991
    perform_normal_access(access_source: UniIndex, nodes: UniValMap<Node>, access_kind: AccessKind, global: GlobalState, visit_children: ChildrenVisitMode, diagnostics: DiagnosticInfo): InterpResult<UniIndex>;
    // borrow_tracker/tree_borrows/tree.rs:1064
    perform_wildcard_access(root: UniIndex, access_source: UniIndex | undefined, max_local_tag: BorTag | undefined, nodes: UniValMap<Node>, access_kind: AccessKind, global: GlobalState, diagnostics: DiagnosticInfo, is_wildcard_tree: boolean): InterpResult;
  }
  namespace LocationTree {
    // borrow_tracker/tree_borrows/tree.rs:884
    export let get_min_exposed_child: (root: UniIndex, nodes: UniValMap<Node>) => BorTag | undefined;
  }
}
declare module "./tree.gen.ts" {
  interface Node {
    // borrow_tracker/tree_borrows/tree.rs:1192
    default_location_state(): LocationState;
  }
}

/// Constructs a new initial state. It has neither been accessed, nor been subjected
/// to any foreign access yet.
/// The permission is not allowed to be `Unique`.
/// `sifa` is the (strongest) idempotent foreign access, see `foreign_access_skipping.rs`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:64 new_non_accessed
LocationState.new_non_accessed = function (permission: Permission, sifa: IdempotentForeignAccess): LocationState {
  assert(permission.is_initial() || permission.is_disabled(), "assertion failed: permission.is_initial() || permission.is_disabled()");
  assert(!permission.is_unique(), "assertion failed: !permission.is_unique()");
  return new LocationState(false, permission, sifa);
};

/// Constructs a new initial state. It has not yet been subjected
/// to any foreign access. However, it is already marked as having been accessed.
/// `sifa` is the (strongest) idempotent foreign access, see `foreign_access_skipping.rs`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:73 new_accessed
LocationState.new_accessed = function (permission: Permission, sifa: IdempotentForeignAccess): LocationState {
  return new LocationState(true, permission, sifa);
};

/// Checks whether the current location state is ever reachable in a real execution.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:78 possible
LocationState.prototype.possible = function (this: LocationState): boolean {
  // `Unique` can only be reached on actually accessed locations.
  return this.accessed || !this.permission.is_unique();
};

/// Check if the location has been accessed, i.e. if it has
/// ever been accessed through a child pointer.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:85 accessed
LocationState.prototype.accessed_ = function (this: LocationState): boolean {
  return this.accessed;
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:89 permission
LocationState.prototype.permission_ = function (this: LocationState): Permission {
  return this.permission;
};

/// Performs an access on this index and updates node,
/// perm and wildcard_state to reflect the transition.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:95 perform_transition
LocationState.prototype.perform_transition = function (
  this: LocationState,
  idx: UniIndex,
  nodes: UniValMap<Node>,
  exposed_cache: ExposedCache,
  access_kind: AccessKind,
  relatedness: gen.AccessRelatedness,
  protected_: boolean,
  diagnostics: DiagnosticInfo,
): Result<null, TransitionError> {
  // Call this function now (i.e. only if we know `relatedness`), which
  // ensures it is only called when `skip_if_known_noop` returns
  // `Recurse`, due to the contract of `traverse_this_parents_children_other`.
  this.record_new_access(access_kind, relatedness);
  const old_access_level = this.permission.strongest_allowed_local_access(protected_);
  const transition_r = this.perform_access(access_kind, relatedness, protected_);
  if (transition_r.$ === "Err") return transition_r;
  const transition = transition_r._0;
  if (!transition.is_noop()) {
    const node = unwrap(nodes.get_mut(idx));
    // Record the event as part of the history.
    node.debug_info.history.push(diagnostics.create_event(transition, AccessRelatedness.is_foreign(relatedness)));

    // We need to update the wildcard state, if the permission
    // of an exposed pointer changes.
    if (node.is_exposed) {
      const access_level = this.permission.strongest_allowed_local_access(protected_);
      exposed_cache.update_exposure(nodes, idx, old_access_level, access_level);
    }
  }
  return Ok(null);
};

/// Apply the effect of an access to one location, including
/// - applying `Permission::perform_access` to the inner `Permission`,
/// - emitting protector UB if the location is accessed,
/// - updating the accessed status (child accesses produce accessed locations).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:132 perform_access
LocationState.prototype.perform_access = function (
  this: LocationState,
  access_kind: AccessKind,
  rel_pos: gen.AccessRelatedness,
  protected_: boolean,
): Result<PermTransition, TransitionError> {
  const old_perm = this.permission;
  const transition = Permission.perform_access(access_kind, rel_pos, old_perm, protected_);
  if (transition === undefined) return Err<TransitionError>({ $: "ChildAccessForbidden", _0: old_perm });
  this.accessed ||= !AccessRelatedness.is_foreign(rel_pos);
  this.permission = unwrap(transition.applied(old_perm));
  // Why do only accessed locations cause protector errors?
  // Consider two mutable references `x`, `y` into disjoint parts of
  // the same allocation. A priori, these may actually both be used to
  // access the entire allocation, as long as only reads occur. However,
  // a write to `y` needs to somehow record that `x` can no longer be used
  // on that location at all. For these non-accessed locations (i.e., locations
  // that haven't been accessed with `x` yet), we track the "future initial state":
  // it defaults to whatever the initial state of the tag is,
  // but the access to `y` moves that "future initial state" of `x` to `Disabled`.
  // However, usually a `Reserved -> Disabled` transition would be UB due to the protector!
  // So clearly protectors shouldn't fire for such "future initial state" transitions.
  //
  // See the test `two_mut_protected_same_alloc` in `tests/pass/tree_borrows/tree-borrows.rs`
  // for an example of safe code that would be UB if we forgot to check `self.accessed`.
  if (protected_ && this.accessed && transition.produces_disabled()) {
    return Err<TransitionError>({ $: "ProtectedDisabled", _0: old_perm });
  }
  // debug_assert!(self.possible());
  return Ok(transition);
};

/// Like `perform_access`, but ignores the concrete error cause and also uses state-passing
/// rather than a mutable reference. As such, it returns `Some(x)` if the transition succeeded,
/// or `None` if there was an error.
// #[cfg(test)]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:168 perform_access_no_fluff
LocationState.prototype.perform_access_no_fluff = function (
  this: LocationState,
  access_kind: AccessKind,
  rel_pos: gen.AccessRelatedness,
  protected_: boolean,
): LocationState | undefined {
  // PORT: `mut self` is a copy of the receiver.
  const self = clone_LocationState(this);
  switch (self.perform_access(access_kind, rel_pos, protected_).$) {
    case "Ok":
      return self;
    case "Err":
      return undefined;
  }
};

/// Tree traversal optimizations. See `foreign_access_skipping.rs`.
/// This checks if such a foreign access can be skipped.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:182 skip_if_known_noop
LocationState.prototype.skip_if_known_noop = function (this: LocationState, access_kind: AccessKind, rel_pos: gen.AccessRelatedness): ContinueTraversal {
  if (AccessRelatedness.is_foreign(rel_pos)) {
    const happening_now = IFA().from_foreign(access_kind);
    let new_access_noop = IFA().can_skip_foreign_access(this.idempotent_foreign_access, happening_now);
    if (this.permission.is_disabled()) {
      // A foreign access to a `Disabled` tag will have almost no observable effect.
      // It's a theorem that `Disabled` node have no protected accessed children,
      // and so this foreign access will never trigger any protector.
      // (Intuition: You're either protected accessed, and thus can't become Disabled
      // or you're already Disabled protected, but not accessed, and then can't
      // become accessed since that requires a child access, which Disabled blocks.)
      // Further, the children will never be able to read or write again, since they
      // have a `Disabled` parent. So this only affects diagnostics, such that the
      // blocking write will still be identified directly, just at a different tag.
      new_access_noop = true;
    }
    if (this.permission.is_frozen() && access_kind === "Read") {
      // A foreign read to a `Frozen` tag will have almost no observable effect.
      // It's a theorem that `Frozen` nodes have no `Unique` children, so all children
      // already survive foreign reads. Foreign reads in general have almost no
      // effect, the only further thing they could do is make protected `Reserved`
      // nodes become conflicted, i.e. make them reject child writes for the further
      // duration of their protector. But such a child write is already rejected
      // because this node is frozen. So this only affects diagnostics, but the
      // blocking read will still be identified directly, just at a different tag.
      new_access_noop = true;
    }
    if (new_access_noop) {
      // Abort traversal if the new access is indeed guaranteed
      // to be noop.
      // No need to update `self.idempotent_foreign_access`,
      // the type of the current streak among nonempty read-only
      // or nonempty with at least one write has not changed.
      return ContinueTraversal.SkipSelfAndChildren;
    } else {
      // Otherwise propagate this time, and also record the
      // access that just occurred so that we can skip the propagation
      // next time.
      return ContinueTraversal.Recurse;
    }
  } else {
    // A child access occurred, this breaks the streak of foreign
    // accesses in a row and the sequence since the previous child access
    // is now empty.
    return ContinueTraversal.Recurse;
  }
};

/// Records a new access, so that future access can potentially be skipped
/// by `skip_if_known_noop`. This must be called on child accesses, and otherwise
/// should be called on foreign accesses for increased performance. It should not be called
/// when `skip_if_known_noop` indicated skipping, since it then is a no-op.
/// See `foreign_access_skipping.rs`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:240 record_new_access
LocationState.prototype.record_new_access = function (this: LocationState, access_kind: AccessKind, rel_pos: gen.AccessRelatedness): void {
  // debug_assert!(matches!(
  //     self.skip_if_known_noop(access_kind, rel_pos),
  //     ContinueTraversal::Recurse
  // ));
  IFA().record_new(field_mut(this, "idempotent_foreign_access"), IFA().from_acc_and_rel(access_kind, rel_pos));
};

// impl fmt::Display for LocationState
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:251 fmt
export function display_LocationState(self: LocationState): string {
  let f = fmt_Permission(self.permission);
  if (!self.accessed) {
    f += "?";
  }
  return f;
}

/// Create a new tree, with only a root pointer.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:338 new
Tree.new = function (root_tag: BorTag, size: Size, span: Span): Tree {
  // The root has `Disabled` as the default permission,
  // so that any access out of bounds is invalid.
  const root_default_perm = Permission.new_disabled();
  const tag_mapping = new UniKeyMap<BorTag>(new Map(), []);
  const root_idx = tag_mapping.insert(root_tag);
  const nodes = new UniValMap<Node>([]);
  {
    const debug_info = NodeDebugInfo.new(root_tag, root_default_perm, span);
    // name the root so that all allocations contain one named pointer
    debug_info.add_name("root of the allocation");
    nodes.insert(
      root_idx,
      new Node(
        root_tag,
        undefined,
        [],
        root_default_perm,
        // The root may never be skipped, all accesses will be local.
        IdempotentForeignAccess.None,
        false,
        debug_info,
      ),
    );
  }
  let locations: DedupRangeMap<LocationTree>;
  {
    const perms = new UniValMap<LocationState>([]);
    // We manually set it to `Unique` on all in-bounds positions.
    // We also ensure that it is accessed, so that no `Unique` but
    // not yet accessed nodes exist. Essentially, we pretend there
    // was a write that initialized these to `Unique`.
    perms.insert(root_idx, LocationState.new_accessed(Permission.new_unique(), IdempotentForeignAccess.None));
    const exposed_cache = new ExposedCache(new UniValMap([]));
    locations = DedupRangeMap.new(size, new LocationTree(perms, exposed_cache));
  }
  return new Tree(tag_mapping, nodes, locations, [root_idx]);
};

/// Insert a new tag in the tree.
///
/// `inside_perm` defines the initial permissions for a block of memory starting at
/// `base_offset`. These may nor may not be already marked as "accessed".
/// `outside_perm` defines the initial permission for the rest of the allocation.
/// These are definitely not "accessed".
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:391 new_child
Tree.prototype.new_child = function (
  this: Tree,
  base_offset: Size,
  parent_prov: ProvenanceExtra,
  new_tag: BorTag,
  inside_perms: DedupRangeMap<LocationState>,
  outside_perm: Permission,
  protected_: boolean,
  span: Span,
): InterpResult {
  const idx = this.tag_mapping.insert(new_tag);
  let parent_idx: UniIndex | undefined;
  switch (parent_prov.$) {
    case "Concrete":
      parent_idx = unwrap(this.tag_mapping.get(parent_prov._0));
      break;
    case "Wildcard":
      parent_idx = undefined;
      break;
  }
  assert(outside_perm.is_initial(), "assertion failed: outside_perm.is_initial()");
  assert(!outside_perm.is_unique(), "assertion failed: !outside_perm.is_unique()");

  const default_strongest_idempotent = outside_perm.strongest_idempotent_foreign_access(protected_);
  // Create the node
  this.nodes.insert(
    idx,
    new Node(
      new_tag,
      parent_idx,
      [],
      outside_perm,
      default_strongest_idempotent,
      false,
      NodeDebugInfo.new(new_tag, outside_perm, span),
    ),
  );
  if (parent_idx !== undefined) {
    const parent_node = unwrap(this.nodes.get_mut(parent_idx));
    // Register new_tag as a child of parent_tag
    parent_node.children.push(idx);
  } else {
    // If the parent had wildcard provenance, then register the idx
    // as a new wildcard root.
    // This preserves the orderedness of `roots` because a newly created
    // tag is greater than all previous tags.
    this.roots.push(idx);
  }

  // We need to know the weakest SIFA for `update_idempotent_foreign_access_after_retag`.
  let min_sifa = default_strongest_idempotent;
  for (const [{ start, end }, perm] of inside_perms.iter(Size.from_bytes(0), inside_perms.size())) {
    assert(perm.permission.is_initial(), "assertion failed: perm.permission.is_initial()");
    assert_eq(perm.idempotent_foreign_access, perm.permission.strongest_idempotent_foreign_access(protected_), (v) => debug_IdempotentForeignAccess(v, PLAIN));

    // `cmp::min` (`Ord` by discriminant; on a tie it returns the first argument, the same value).
    if (IdempotentForeignAccess_discriminant[perm.idempotent_foreign_access] < IdempotentForeignAccess_discriminant[min_sifa]) {
      min_sifa = perm.idempotent_foreign_access;
    }
    for (const [_range, loc] of this.locations.iter_mut(Size.from_bytes(start).add(base_offset), Size.from_bytes(end - start), gen.clone_LocationTree, LocationTree_eq)) {
      loc.perms.insert(idx, clone_LocationState(perm));
    }
  }

  // We don't have to update `exposed_cache` as the new node is not exposed and
  // has no children so the default counts of 0 are correct.

  // If the parent is a wildcard pointer, then it doesn't track SIFA and doesn't need to be updated.
  if (parent_idx !== undefined) {
    // Inserting the new perms might have broken the SIFA invariant (see
    // `foreign_access_skipping.rs`) if the SIFA we inserted is weaker than that of some parent.
    // We now weaken the recorded SIFA for our parents, until the invariant is restored. We
    // could weaken them all to `None`, but it is more efficient to compute the SIFA for the new
    // permission statically, and use that. For this we need the *minimum* SIFA (`None` needs
    // more fixup than `Write`).
    this.update_idempotent_foreign_access_after_retag(parent_idx, min_sifa);
  }

  return interp_ok(undefined);
};

/// Restores the SIFA "children are stronger"/"parents are weaker" invariant after a retag:
/// reduce the SIFA of `current` and its parents to be no stronger than `strongest_allowed`.
/// See `foreign_access_skipping.rs` and [`Tree::new_child`].
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:477 update_idempotent_foreign_access_after_retag
Tree.prototype.update_idempotent_foreign_access_after_retag = function (this: Tree, current_: UniIndex, strongest_allowed: IdempotentForeignAccess): void {
  let current = current_;
  if (strongest_allowed === IdempotentForeignAccess.Write) {
    // Nothing is stronger than `Write`.
    return;
  }
  // We walk the tree upwards, until the invariant is restored
  for (;;) {
    const current_node = unwrap(this.nodes.get_mut(current));
    // Call `ensure_no_stronger_than` on all SIFAs for this node: the per-location SIFA, as well
    // as the default SIFA for not-yet-initialized locations.
    // Record whether we did any change; if not, the invariant is restored and we can stop the traversal.
    let any_change = false;
    for (const [_range, loc] of this.locations.iter_mut_all()) {
      // Check if this node has a state for this location (or range of locations).
      const perm = loc.perms.get_mut(current);
      if (perm !== undefined) {
        // Update the per-location SIFA, recording if it changed.
        any_change = IFA().ensure_no_stronger_than(field_mut(perm, "idempotent_foreign_access"), strongest_allowed) || any_change;
      }
    }
    // Now update `default_initial_idempotent_foreign_access`, which stores the default SIFA for not-yet-initialized locations.
    any_change = IFA().ensure_no_stronger_than(field_mut(current_node, "default_initial_idempotent_foreign_access"), strongest_allowed) || any_change;

    if (any_change) {
      const next = unwrap(this.nodes.get(current)).parent;
      if (next === undefined) {
        // We have arrived at the root.
        break;
      }
      current = next;
      continue;
    } else {
      break;
    }
  }
};

/// Deallocation requires
/// - a pointer that permits write accesses
/// - the absence of Strong Protectors anywhere in the allocation
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:522 dealloc
Tree.prototype.dealloc = function (
  this: Tree,
  prov: ProvenanceExtra,
  access_range: AllocRange,
  global: GlobalState,
  alloc_id: AllocId, // diagnostics
  span: Span, // diagnostics
): InterpResult {
  const access_r = this.perform_access(prov, access_range, "Write", AccessCause.Dealloc, global, alloc_id, span);
  if (access_r.$ === "Err") return access_r;

  let start_idx: UniIndex | undefined;
  switch (prov.$) {
    case "Concrete":
      start_idx = unwrap(this.tag_mapping.get(prov._0));
      break;
    case "Wildcard":
      start_idx = undefined;
      break;
  }

  // Check if this breaks any strong protector.
  // (Weak protectors are already handled by `perform_access`.)
  for (const [loc_range, loc] of this.locations.iter_mut(access_range.start, access_range.size, gen.clone_LocationTree, LocationTree_eq)) {
    const diagnostics = new DiagnosticInfo(alloc_id, span, transition_range_of(loc_range), access_range, AccessCause.Dealloc);
    // Checks the tree containing `idx` for strong protector violations.
    // It does this in traversal order.
    const check_tree = (idx: UniIndex): Result<UniIndex, InterpErrorKind> =>
      new TreeVisitor(this.nodes, loc).traverse_this_parents_children_other<InterpErrorKind>(
        idx,
        // Visit all children, skipping none.
        (_) => ContinueTraversal.Recurse,
        (args: NodeAppArgs<LocationTree>): Result<null, InterpErrorKind> => {
          const node = unwrap(args.nodes.get(args.idx));

          const perm = args.data.perms.get(args.idx) ?? node.default_location_state();
          if (
            global.protected_tags.get(node.tag) === "StrongProtector" &&
            // Don't check for protector if it is a Cell (see `unsafe_cell_deallocate` in `interior_mutability.rs`).
            // Related to https://github.com/rust-lang/rust/issues/55005.
            !perm.permission.is_cell() &&
            // Only trigger UB if the accessed bit is set, i.e. if the protector
            // is actually protecting this offset. See #4579. Note that this
            // takes into account the access we just did above!
            perm.accessed
          ) {
            return Err(
              new TbError(
                { $: "ProtectedDealloc" },
                diagnostics,
                node.debug_info,
                start_idx === undefined ? undefined : unwrap(args.nodes.get(start_idx)).debug_info,
              ).build(),
            );
          } else {
            return Ok(null);
          }
        },
      );
    // If we have a start index we first check its subtree in traversal order.
    // This results in us showing the error of the closest node instead of an
    // arbitrary one.
    let accessed_root: UniIndex | undefined;
    if (start_idx !== undefined) {
      const r = check_tree(start_idx);
      if (r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(r._0));
      accessed_root = r._0;
    }
    // Afterwards we check all other trees.
    // We iterate over the list in reverse order to ensure that we do not visit
    // a parent before its child.
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const root = this.roots[i]!;
      if (accessed_root !== undefined && root.idx === accessed_root.idx) {
        continue;
      }
      const r = check_tree(root);
      if (r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(r._0));
    }
  }
  return interp_ok(undefined);
};

/// Map the per-node and per-location `LocationState::perform_access`
/// to each location of the first component of `access_range_and_kind`,
/// on every tag of the allocation.
///
/// `LocationState::perform_access` will take care of raising transition
/// errors and updating the `accessed` status of each location,
/// this traversal adds to that:
/// - inserting into the map locations that do not exist yet,
/// - trimming the traversal,
/// - recording the history.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:623 perform_access
Tree.prototype.perform_access = function (
  this: Tree,
  prov: ProvenanceExtra,
  access_range: AllocRange,
  access_kind: AccessKind,
  access_cause: AccessCause, // diagnostics
  global: GlobalState,
  alloc_id: AllocId, // diagnostics
  span: Span, // diagnostics
): InterpResult {
  // #[cfg(feature = "expensive-consistency-checks")]
  // if self.roots.len() > 1 || matches!(prov, ProvenanceExtra::Wildcard) {
  //     self.verify_wildcard_consistency(global);
  // }

  let source_idx: UniIndex | undefined;
  switch (prov.$) {
    case "Concrete":
      source_idx = unwrap(this.tag_mapping.get(prov._0));
      break;
    case "Wildcard":
      source_idx = undefined;
      break;
  }
  // We iterate over affected locations and traverse the tree for each of them.
  for (const [loc_range, loc] of this.locations.iter_mut(access_range.start, access_range.size, gen.clone_LocationTree, LocationTree_eq)) {
    const diagnostics = new DiagnosticInfo(alloc_id, span, transition_range_of(loc_range), access_range, access_cause);
    const r = loc.perform_access(
      this.roots,
      this.nodes,
      source_idx,
      access_kind,
      global,
      ChildrenVisitMode.VisitChildrenOfAccessed,
      diagnostics,
      /* min_exposed_child */ undefined, // only matters for protector end access,
    );
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// This is the special access that is applied on protector release:
/// - the access will be applied only to accessed locations of the allocation,
/// - it will not be visible to children,
/// - it will be recorded as a `FnExit` diagnostic access
/// - and it will be a read except if the location is `Unique`, i.e. has been written to,
///   in which case it will be a write.
/// - otherwise identical to `Tree::perform_access`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:671 perform_protector_end_access
Tree.prototype.perform_protector_end_access = function (
  this: Tree,
  tag: BorTag,
  global: GlobalState,
  alloc_id: AllocId, // diagnostics
  span: Span, // diagnostics
): InterpResult {
  // #[cfg(feature = "expensive-consistency-checks")]
  // if self.roots.len() > 1 {
  //     self.verify_wildcard_consistency(global);
  // }

  const source_idx = unwrap(this.tag_mapping.get(tag));

  let min_exposed_child: BorTag | undefined;
  if (this.roots.length > 1) {
    min_exposed_child = LocationTree.get_min_exposed_child(source_idx, this.nodes);
  } else {
    // There's no point in computing this when there is just one tree.
    min_exposed_child = undefined;
  }

  // This is a special access through the entire allocation.
  // It actually only affects `accessed` locations, so we need
  // to filter on those before initiating the traversal.
  //
  // In addition this implicit access should not be visible to children,
  // thus the use of `traverse_nonchildren`.
  // See the test case `returned_mut_is_usable` from
  // `tests/pass/tree_borrows/tree-borrows.rs` for an example of
  // why this is important.
  for (const [loc_range, loc] of this.locations.iter_mut_all()) {
    // Only visit accessed permissions
    const p = loc.perms.get(source_idx);
    if (p !== undefined) {
      const access_kind = p.permission.associated_access();
      if (access_kind !== undefined && p.accessed) {
        const diagnostics = new DiagnosticInfo(alloc_id, span, transition_range_of(loc_range), undefined, { $: "FnExit", _0: access_kind });
        const r = loc.perform_access(
          this.roots,
          this.nodes,
          source_idx,
          access_kind,
          global,
          ChildrenVisitMode.SkipChildrenOfAccessed,
          diagnostics,
          min_exposed_child,
        );
        if (r.$ === "Err") return r;
      }
    }
  }
  return interp_ok(undefined);
};

/// Integration with the BorTag garbage collector
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:732 remove_unreachable_tags
Tree.prototype.remove_unreachable_tags = function (this: Tree, live_tags: Set<BorTag>): void {
  for (let i = 0; i < this.roots.length; i++) {
    this.remove_useless_children(this.roots[i]!, live_tags);
  }
  // Right after the GC runs is a good moment to check if we can
  // merge some adjacent ranges that were made equal by the removal of some
  // tags (this does not necessarily mean that they have identical internal representations,
  // see the `PartialEq` impl for `UniValMap`)
  this.locations.merge_adjacent_thorough(LocationTree_eq);
};

/// Checks if a node is useless and should be GC'ed.
/// A node is useless if it has no children and also the tag is no longer live.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:745 is_useless
Tree.prototype.is_useless = function (this: Tree, idx: UniIndex, live: Set<BorTag>): boolean {
  const node = unwrap(this.nodes.get(idx));
  return node.children.length === 0 && !live.has(node.tag);
};

/// Checks whether a node can be replaced by its only child.
/// If so, returns the index of said only child.
/// If not, returns none.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:753 can_be_replaced_by_single_child
Tree.prototype.can_be_replaced_by_single_child = function (this: Tree, idx: UniIndex, live: Set<BorTag>): UniIndex | undefined {
  const node = unwrap(this.nodes.get(idx));

  if (node.children.length !== 1) return undefined;
  const child_idx = node.children[0]!;

  // We never want to replace the root node, as it is also kept in `root_ptr_tags`.
  if (live.has(node.tag) || node.parent === undefined) {
    return undefined;
  }
  // Since protected nodes are never GC'd (see `borrow_tracker::FrameExtra::visit_provenance`),
  // we know that `node` is not protected because otherwise `live` would
  // have contained `node.tag`.
  const child = unwrap(this.nodes.get(child_idx));
  // Check that for that one child, `can_be_replaced_by_child` holds for the permission
  // on all locations.
  for (const [_range, loc] of this.locations.iter_all()) {
    const parent_perm = loc.perms.get(idx)?.permission ?? node.default_initial_perm;
    const child_perm = loc.perms.get(child_idx)?.permission ?? child.default_initial_perm;
    if (!parent_perm.can_be_replaced_by_child(child_perm)) {
      return undefined;
    }
  }

  return child_idx;
};

/// Properly removes a node.
/// The node to be removed should not otherwise be usable. It also
/// should have no children, but this is not checked, so that nodes
/// whose children were rotated somewhere else can be deleted without
/// having to first modify them to clear that array.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:796 remove_useless_node
Tree.prototype.remove_useless_node = function (this: Tree, this_: UniIndex): void {
  // Due to the API of UniMap we must make sure to call
  // `UniValMap::remove` for the key of this node on *all* maps that used it
  // (which are `self.nodes` and every range of `self.rperms`)
  // before we can safely apply `UniKeyMap::remove` to truly remove
  // this tag from the `tag_mapping`.
  const node = unwrap(this.nodes.remove(this_));
  for (const [_range, loc] of this.locations.iter_mut_all()) {
    loc.perms.remove(this_);
    loc.exposed_cache.remove(this_);
  }
  this.tag_mapping.remove(node.tag);
};

/// Traverses the entire tree looking for useless tags.
/// Removes from the tree all useless child nodes of root.
/// It will not delete the root itself.
///
/// NOTE: This leaves in the middle of the tree tags that are unreachable but have
/// reachable children. There is a potential for compacting the tree by reassigning
/// children of dead tags to the nearest live parent, but it must be done with care
/// not to remove UB.
///
/// Example: Consider the tree `root - parent - child`, with `parent: Frozen` and
/// `child: Reserved`. This tree can exist. If we blindly delete `parent` and reassign
/// `child` to be a direct child of `root` then Writes to `child` are now permitted
/// whereas they were not when `parent` was still there.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:823 remove_useless_children
Tree.prototype.remove_useless_children = function (this: Tree, root: UniIndex, live: Set<BorTag>): void {
  // To avoid stack overflows, we roll our own stack.
  // Each element in the stack consists of the current tag, and the number of the
  // next child to be processed.

  // The other functions are written using the `TreeVisitorStack`, but that does not work here
  // since we need to 1) do a post-traversal and 2) remove nodes from the tree.
  // Since we do a post-traversal (by deleting nodes only after handling all children),
  // we also need to be a bit smarter than "pop node, push all children."
  const stack: [UniIndex, number][] = [[root, 0]];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const tag = top[0];
    const node = unwrap(this.nodes.get(tag));
    if (top[1] < node.children.length) {
      // Visit the child by pushing it to the stack.
      // Also increase `nth_child` so that when we come back to the `tag` node, we
      // look at the next child.
      const next_child = node.children[top[1]]!;
      top[1] += 1;
      stack.push([next_child, 0]);
      continue;
    } else {
      // We have processed all children of `node`, so now it is time to process `node` itself.
      // First, get the current children of `node`. To appease the borrow checker,
      // we have to temporarily move the list out of the node, and then put the
      // list of remaining children back in.
      const tag_node = unwrap(this.nodes.get_mut(tag));
      const children_of_node = tag_node.children;
      tag_node.children = [];
      // Remove all useless children.
      // PORT: `retain_mut` is a compacting loop over the same array.
      let kept = 0;
      for (let i = 0; i < children_of_node.length; i++) {
        let idx = children_of_node[i]!;
        if (this.is_useless(idx, live)) {
          // Delete `idx` node everywhere else.
          this.remove_useless_node(idx);
          // And delete it from children_of_node.
        } else {
          const nextchild = this.can_be_replaced_by_single_child(idx, live);
          if (nextchild !== undefined) {
            // `nextchild` is our grandchild, and will become our direct child.
            // Delete the in-between node, `idx`.
            this.remove_useless_node(idx);
            // Set the new child's parent.
            unwrap(this.nodes.get_mut(nextchild)).parent = tag;
            // Save the new child in children_of_node.
            idx = nextchild;
          }
          // retain it
          children_of_node[kept++] = idx;
        }
      }
      children_of_node.length = kept;
      // Put back the now-filtered vector.
      unwrap(this.nodes.get_mut(tag)).children = children_of_node;

      // We are done, the parent can continue.
      stack.pop();
      continue;
    }
  }
};

/// Returns the smallest exposed tag, if any, that is a transitive child of `root`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:884 get_min_exposed_child
LocationTree.get_min_exposed_child = function (root: UniIndex, nodes: UniValMap<Node>): BorTag | undefined {
  // We cannot use the wildcard datastructure to improve this lookup. This is because
  // the datastructure only tracks enabled nodes and we need to also consider disabled ones.
  const stack: UniIndex[] = [root];
  let min_tag: BorTag | undefined = undefined;
  for (let idx = stack.pop(); idx !== undefined; idx = stack.pop()) {
    const node: Node = unwrap(nodes.get(idx));
    if (min_tag !== undefined && min_tag < node.tag) {
      // The minimum we found before is bigger than this tag, and therefore
      // also bigger than all its children, so we can skip this subtree.
      continue;
    }
    // `extend_from_slice` (PORT: a loop: a spread is limited by the argument count, and `children` is unbounded).
    for (const child of node.children) stack.push(child);
    if (node.is_exposed) {
      min_tag = min_tag !== undefined && min_tag < node.tag ? min_tag : node.tag;
    }
  }
  return min_tag;
};

/// Performs an access on this location.
/// * `access_source`: The index, if any, where the access came from.
/// * `visit_children`: Whether to skip updating the children of `access_source`.
/// * `min_exposed_child`: The tag of the smallest exposed (transitive) child of the accessed node.
///   This is only used with `visit_children == SkipChildrenOfAccessed`, where we need to skip children
///   of the accessed node.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:913 perform_access
LocationTree.prototype.perform_access = function (
  this: LocationTree,
  roots: Iterable<UniIndex>,
  nodes: UniValMap<Node>,
  access_source: UniIndex | undefined,
  access_kind: AccessKind,
  global: GlobalState,
  visit_children: ChildrenVisitMode,
  diagnostics: DiagnosticInfo,
  min_exposed_child: BorTag | undefined,
): InterpResult {
  let accessed_root: UniIndex | undefined;
  if (access_source !== undefined) {
    const r = this.perform_normal_access(access_source, nodes, access_kind, global, visit_children, diagnostics);
    if (r.$ === "Err") return r;
    accessed_root = r._0;
  } else {
    // `SkipChildrenOfAccessed` only gets set on protector release, which only
    // occurs on a known node.
    assert(visit_children === "VisitChildrenOfAccessed", "assertion failed: matches!(visit_children, ChildrenVisitMode::VisitChildrenOfAccessed)");
    accessed_root = undefined;
  }

  const accessed_root_tag = accessed_root === undefined ? undefined : unwrap(nodes.get(accessed_root)).tag;
  let i = -1;
  for (const root of roots) {
    i += 1;
    const tag = unwrap(nodes.get(root)).tag;
    // On a protector release access we have to skip the children of the accessed tag.
    // However, if the tag has exposed children then some of the wildcard subtrees could
    // also be children of the accessed node and would also need to be skipped. We can
    // narrow down which wildcard trees might be children by comparing their root tag to the
    // minimum exposed child of the accessed node. As the parent tag is always smaller
    // than the child tag this means we only need to skip subtrees with a root tag larger
    // than `min_exposed_child`. Once we find such a root, we can leave the loop because roots
    // are sorted by tag.
    if (visit_children === "SkipChildrenOfAccessed" && min_exposed_child !== undefined && tag > min_exposed_child) {
      break;
    }
    // We don't perform a wildcard access on the tree we already performed a
    // normal access on.
    if (accessed_root !== undefined && root.idx === accessed_root.idx) {
      continue;
    }
    // The choice of `max_local_tag` requires some thought.
    // This can only be a local access for nodes that are a parent of the accessed node
    // and are therefore smaller, so the accessed node itself is a valid choice for `max_local_tag`.
    // However, using `accessed_root` is better since that will be smaller. It is still a valid choice
    // because for nodes *in other trees*, if they are a parent of the accessed node then they
    // are a parent of `accessed_root`.
    //
    // As a consequence of this, since the root of the main tree is the smallest tag in the entire
    // allocation, if the access occurred in the main tree then other subtrees will only see foreign accesses.
    const r = this.perform_wildcard_access(
      root,
      access_source,
      /*max_local_tag*/ accessed_root_tag,
      nodes,
      access_kind,
      global,
      diagnostics,
      /*is_wildcard_tree*/ i !== 0,
    );
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// Performs a normal access on the tree containing `access_source`.
///
/// Returns the root index of this tree.
/// * `access_source`: The index of the tag being accessed.
/// * `visit_children`: Whether to skip the children of `access_source`
///   during the access. Used for protector end access.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:991 perform_normal_access
LocationTree.prototype.perform_normal_access = function (
  this: LocationTree,
  access_source: UniIndex,
  nodes: UniValMap<Node>,
  access_kind: AccessKind,
  global: GlobalState,
  visit_children: ChildrenVisitMode,
  diagnostics: DiagnosticInfo,
): InterpResult<UniIndex> {
  // Performs the per-node work:
  // - insert the permission if it does not exist
  // - perform the access
  // - record the transition
  // to which some optimizations are added:
  // - skip the traversal of the children in some cases
  // - do not record noop transitions
  //
  // `loc_range` is only for diagnostics (it is the range of
  // the `RangeMap` on which we are currently working).
  const node_skipper = (args: NodeAppArgs<LocationTree>): ContinueTraversal => {
    const node = unwrap(args.nodes.get(args.idx));
    const perm = args.data.perms.get(args.idx);

    const old_state = perm ?? node.default_location_state();
    return old_state.skip_if_known_noop(access_kind, args.rel_pos);
  };
  const node_app = (args: NodeAppArgs<LocationTree>): Result<null, InterpErrorKind> => {
    const node = unwrap(args.nodes.get_mut(args.idx));
    const perm = args.data.perms.entry(args.idx);

    const state = perm.or_insert(node.default_location_state());

    const protected_ = global.protected_tags.has(node.tag);
    const r = state.perform_transition(args.idx, args.nodes, args.data.exposed_cache, access_kind, args.rel_pos, protected_, diagnostics);
    if (r.$ === "Err") {
      const error_kind = r._0;
      return Err(new TbError(error_kind, diagnostics, unwrap(args.nodes.get(args.idx)).debug_info, unwrap(args.nodes.get(access_source)).debug_info).build());
    }
    return r;
  };

  const visitor = new TreeVisitor(nodes, this);
  let r: Result<UniIndex, InterpErrorKind>;
  switch (visit_children) {
    case "VisitChildrenOfAccessed":
      r = visitor.traverse_this_parents_children_other(access_source, node_skipper, node_app);
      break;
    case "SkipChildrenOfAccessed":
      r = visitor.traverse_nonchildren(access_source, node_skipper, node_app);
      break;
  }
  // `.into()`
  return r.$ === "Err" ? Err(InterpErrorInfo_from_InterpErrorKind(r._0)) : r;
};

/// Performs a wildcard access on the tree with root `root`. Takes the `access_relatedness`
/// for each node from the `WildcardState` datastructure.
/// * `root`: Root of the tree being accessed.
/// * `access_source`: the index of the accessed tag, if any.
///   This is only used for printing the correct tag on errors.
/// * `max_local_tag`: The access can only be local for nodes whose tag is
///   at most `max_local_tag`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:1064 perform_wildcard_access
LocationTree.prototype.perform_wildcard_access = function (
  this: LocationTree,
  root: UniIndex,
  access_source: UniIndex | undefined,
  max_local_tag: BorTag | undefined,
  nodes: UniValMap<Node>,
  access_kind: AccessKind,
  global: GlobalState,
  diagnostics: DiagnosticInfo,
  is_wildcard_tree: boolean,
): InterpResult {
  const get_relatedness = (idx: UniIndex, node: Node, loc: LocationTree): WildcardAccessRelatedness | undefined => {
    // If the tag is larger than `max_local_tag` then the access can only be foreign.
    const only_foreign = max_local_tag !== undefined && max_local_tag < node.tag;
    return loc.exposed_cache.access_relatedness(root, idx, access_kind, is_wildcard_tree, only_foreign);
  };

  // Whether there is an exposed node in this tree that allows this access.
  let has_valid_exposed = false;

  // This does a traversal across the tree updating children before their parents. The
  // difference to `perform_normal_access` is that we take the access relatedness from
  // the wildcard tracking state of the node instead of from the visitor itself.
  //
  // Unlike for a normal access, the iteration order is important for improving the
  // accuracy of wildcard accesses if `max_local_tag` is `Some`: processing the effects of this
  // access further down the tree can cause exposed nodes to lose permissions, thus updating
  // the wildcard data structure, which will be taken into account when processing the parent
  // nodes. Also see the test `cross_tree_update_older_invalid_exposed2.rs`
  // (Doing accesses in the opposite order cannot help with precision but the reasons are complicated;
  // see <https://github.com/rust-lang/miri/pull/4707#discussion_r2581661123>.)
  //
  // Note, however, that this is an approximation: there can be situations where a node is
  // marked as having an exposed foreign node, but actually that foreign node cannot be
  // the source of the access due to `max_local_tag`. The wildcard tracking cannot know
  // about `max_local_tag` so we will incorrectly assume that this might be a foreign access.
  const traversal = new TreeVisitor(nodes, this as LocationTree).traverse_children_this<InterpErrorKind>(
    root,
    (args): ContinueTraversal => {
      const node = unwrap(args.nodes.get(args.idx));
      const perm = args.data.perms.get(args.idx);

      const old_state = perm ?? node.default_location_state();
      // If we know where, relative to this node, the wildcard access occurs,
      // then check if we can skip the entire subtree.
      const wildcard_relatedness = get_relatedness(args.idx, node, args.data);
      const relatedness = wildcard_relatedness === undefined ? undefined : to_relatedness(wildcard_relatedness);
      if (relatedness !== undefined) {
        // We can use the usual SIFA machinery to skip nodes.
        return old_state.skip_if_known_noop(access_kind, relatedness);
      } else {
        return ContinueTraversal.Recurse;
      }
    },
    (args): Result<null, InterpErrorKind> => {
      const node = unwrap(args.nodes.get_mut(args.idx));

      const protected_ = global.protected_tags.has(node.tag);

      const wildcard_relatedness = get_relatedness(args.idx, node, args.data);
      if (wildcard_relatedness === undefined) {
        // There doesn't exist a valid exposed reference for this access to
        // happen through.
        // This can only happen if `root` is the main root: We set
        // `max_foreign_access==Write` on all wildcard roots, so at least a foreign access
        // is always possible on all nodes in a wildcard subtree.
        return Err(no_valid_exposed_references_error(diagnostics));
      }

      const entry = args.data.perms.entry(args.idx);
      const perm = entry.or_insert(node.default_location_state());

      // We only count exposed nodes through which an access could happen.
      if (
        node.is_exposed &&
        allows(perm.permission.strongest_allowed_local_access(protected_), access_kind) &&
        (max_local_tag === undefined || max_local_tag >= node.tag)
      ) {
        has_valid_exposed = true;
      }

      const relatedness = to_relatedness(wildcard_relatedness);
      if (relatedness === undefined) {
        // If the access type is Either, then we do not apply any transition
        // to this node, but we still update each of its children.
        // This is an imprecision! In the future, maybe we can still do some sort
        // of best-effort update here.
        return Ok(null);
      }

      // We know the exact relatedness, so we can actually do precise checks.
      const r = perm.perform_transition(args.idx, args.nodes, args.data.exposed_cache, access_kind, relatedness, protected_, diagnostics);
      if (r.$ === "Err") {
        const trans = r._0;
        const node = unwrap(args.nodes.get(args.idx));
        return Err(
          new TbError(trans, diagnostics, node.debug_info, access_source === undefined ? undefined : unwrap(args.nodes.get(access_source)).debug_info).build(),
        );
      }
      return r;
    },
  );
  if (traversal.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(traversal._0));
  // If there is no exposed node in this tree that allows this access, then the access *must*
  // be foreign to the entire subtree. Foreign accesses are only possible on wildcard subtrees
  // as there are no ancestors to the main root. So if we do not find a valid exposed node in
  // the main tree then this access is UB.
  if (!has_valid_exposed && !is_wildcard_tree) {
    return Err(InterpErrorInfo_from_InterpErrorKind(no_valid_exposed_references_error(diagnostics)));
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:1192 default_location_state
Node.prototype.default_location_state = function (this: Node): LocationState {
  return LocationState.new_non_accessed(this.default_initial_perm, this.default_initial_idempotent_foreign_access);
};

// impl VisitProvenance for Tree (declared in borrow_tracker/mod.ts)
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:1201 visit_provenance
Tree.prototype.visit_provenance = function (this: Tree, visit: VisitWith): void {
  // To ensure that the roots never get removed, we visit them.
  // FIXME: it should be possible to GC wildcard tree roots.
  for (const id of this.roots) {
    visit(undefined, unwrap(this.nodes.get(id)).tag);
  }
  // We also need to keep around any exposed tags through which
  // an access could still happen.
  for (const [_id, node] of this.nodes.iter()) {
    if (node.is_exposed) {
      visit(undefined, node.tag);
    }
  }
};

/** PORT: the methods of `impl AccessRelatedness` on the generated companion (PORTING §8). */
export interface AccessRelatedness_methods {
  is_foreign(self: gen.AccessRelatedness): boolean;
}
/// Relative position of the access
export type AccessRelatedness = gen.AccessRelatedness;
export const AccessRelatedness = gen.AccessRelatedness as typeof gen.AccessRelatedness & AccessRelatedness_methods;

/// Check that access is either Ancestor or Distant, i.e. not
/// a transitive child (initial pointer included).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs:1231 is_foreign
AccessRelatedness.is_foreign = function (self: gen.AccessRelatedness): boolean {
  return self === "ForeignAccess";
};
