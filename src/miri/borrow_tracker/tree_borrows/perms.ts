// Port of src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a`
// (plan-m6 wave 38). Its types are generated into perms.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: `impl PermissionPriv` is on the generated companion (PORTING §8); the unit variants are its frozen singletons
// and `ReservedFrz { conflicted }` an object. A `PermissionPriv` or `Permission` is `Copy`, but nothing ever assigns a
// field of one (a transition makes a new value and `LocationState.permission` is replaced), so copies can share them;
// compare with `PermissionPriv_eq` / `Permission_eq` (`derive(PartialEq)`), never `===` (two `ReservedFrz` are two objects).
// PORT: `Display` impls are `display_<Type>(v): string` (no formatter options reach them: each is `write!(f, "{}", ..)`).
// PORT: `rel_pos.is_foreign()` (tree.rs:1231, `matches!(self, ForeignAccess)`) is inlined.
// PORT: the `#[cfg(test)]` non-test items tree/tests.rs needs (`compatible_with_protector`,
// `is_reserved_frz_with_conflicted`, the `Exhaustive_*` tables) are exported here; the `#[test]` fns are in perms.test.ts.
import { type AccessKind } from "../mod.ts";
import { Exhaustive_bool, type Exhaustive } from "./exhaustive.ts";
import { type IdempotentForeignAccess } from "./foreign_access_skipping.ts";
import { type TransitionError } from "./diagnostics.ts";
import * as gen from "./perms.gen.ts";
import { PermTransition, Permission } from "./perms.gen.ts";
import { type AccessRelatedness } from "./tree.ts";
import { type WildcardAccessLevel } from "./wildcard.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unreachable } from "../../../std/panic.ts";
export * from "./perms.gen.ts";

declare module "./perms.gen.ts" {
  interface Permission {
    // borrow_tracker/tree_borrows/perms.rs:251
    is_initial(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:255
    is_disabled(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:259
    is_frozen(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:264
    is_cell(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:269
    is_unique(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:306
    compatible_with_protector(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:311
    associated_access(): AccessKind | undefined;
    // borrow_tracker/tree_borrows/perms.rs:342
    can_be_replaced_by_child(child: Permission): boolean;
    // borrow_tracker/tree_borrows/perms.rs:376
    strongest_idempotent_foreign_access(prot: boolean): IdempotentForeignAccess;
    // borrow_tracker/tree_borrows/perms.rs:382
    strongest_allowed_local_access(protected_: boolean): WildcardAccessLevel;
    // borrow_tracker/tree_borrows/perms.rs:456
    short_name(): string;
    // borrow_tracker/tree_borrows/perms.rs:625
    is_reserved_frz_with_conflicted(expected_conflicted: boolean): boolean;
  }
  namespace Permission {
    // borrow_tracker/tree_borrows/perms.rs:274
    export let new_unique: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:279
    export let new_reserved_frz: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:284
    export let new_reserved_im: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:289
    export let new_frozen: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:295
    export let new_disabled: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:300
    export let new_cell: () => Permission;
    // borrow_tracker/tree_borrows/perms.rs:322
    export let perform_access: (kind: AccessKind, rel_pos: AccessRelatedness, old_perm: Permission, protected_: boolean) => PermTransition | undefined;
  }
}
declare module "./perms.gen.ts" {
  interface PermTransition {
    // borrow_tracker/tree_borrows/perms.rs:403
    is_possible(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:407
    is_noop(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:412
    applied(starting_point: Permission): Permission | undefined;
    // borrow_tracker/tree_borrows/perms.rs:417
    produces_disabled(): boolean;
    // borrow_tracker/tree_borrows/perms.rs:475
    summary(): string;
    // borrow_tracker/tree_borrows/perms.rs:514
    is_relevant(err: TransitionError): boolean;
    // borrow_tracker/tree_borrows/perms.rs:617
    endpoint(): Permission;
  }
}

/** PORT: the methods of `impl PermissionPriv` on the generated companion (PORTING §8). */
export interface PermissionPriv_methods {
  partial_cmp(self: PermissionPriv, other: PermissionPriv): -1 | 0 | 1 | undefined;
  is_initial(self: PermissionPriv): boolean;
  compatible_with_protector(self: PermissionPriv): boolean;
  strongest_idempotent_foreign_access(self: PermissionPriv, prot: boolean): IdempotentForeignAccess;
}
/// The activation states of a pointer.
export type PermissionPriv = gen.PermissionPriv;
export const PermissionPriv = gen.PermissionPriv as typeof gen.PermissionPriv & PermissionPriv_methods;

/** `#[derive(PartialEq)]` of `PermissionPriv`. */
export function PermissionPriv_eq(a: PermissionPriv, b: PermissionPriv): boolean {
  return a.$ === "ReservedFrz" ? b.$ === "ReservedFrz" && a.conflicted === b.conflicted : a.$ === b.$;
}
/** `#[derive(PartialEq)]` of `Permission`. */
export function Permission_eq(a: Permission, b: Permission): boolean {
  return PermissionPriv_eq(a.inner, b.inner);
}
/** `#[derive(PartialEq)]` of `PermTransition`. */
export function PermTransition_eq(a: PermTransition, b: PermTransition): boolean {
  return PermissionPriv_eq(a.from, b.from) && PermissionPriv_eq(a.to, b.to);
}

// impl PartialOrd for PermissionPriv
/// PermissionPriv is ordered by the reflexive transitive closure of
/// `Reserved(conflicted=false) < Reserved(conflicted=true) < Unique < Frozen < Disabled`.
/// `Reserved` that have incompatible `ty_is_freeze` are incomparable to each other.
/// This ordering matches the reachability by transitions, as asserted by the exhaustive test
/// `permissionpriv_partialord_is_reachability`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:64 partial_cmp
PermissionPriv.partial_cmp = function (self: PermissionPriv, other: PermissionPriv): -1 | 0 | 1 | undefined {
  if (PermissionPriv_eq(self, other)) return 0;
  // Versions of `Reserved` with different interior mutability are incomparable with each
  // other.
  if (
    (self.$ === "ReservedIM" && other.$ === "ReservedFrz") ||
    (self.$ === "ReservedFrz" && other.$ === "ReservedIM") ||
    // `Cell` is not comparable with any other permission
    // since it never transitions to any other state and we
    // can never get to `Cell` from another state.
    self.$ === "Cell" ||
    other.$ === "Cell"
  ) {
    return undefined;
  }
  if (self.$ === "Disabled") return 1;
  if (other.$ === "Disabled") return -1;
  if (self.$ === "Frozen") return 1;
  if (other.$ === "Frozen") return -1;
  if (self.$ === "Unique") return 1;
  if (other.$ === "Unique") return -1;
  if (self.$ === "ReservedIM" && other.$ === "ReservedIM") return 0;
  if (self.$ === "ReservedFrz" && other.$ === "ReservedFrz") {
    // `bool` is ordered such that `false <= true`, so this works as intended.
    return self.conflicted === other.conflicted ? 0 : self.conflicted ? 1 : -1;
  }
  return unreachable();
};

// impl PermissionPriv
/// Check if `self` can be the initial state of a pointer.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:93 is_initial
PermissionPriv.is_initial = function (self: PermissionPriv): boolean {
  return (self.$ === "ReservedFrz" && !self.conflicted) || self.$ === "Frozen" || self.$ === "ReservedIM" || self.$ === "Cell" || self.$ === "Unique";
};

/// Reject `ReservedIM` that cannot exist in the presence of a protector.
// #[cfg(test)]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:99 compatible_with_protector
PermissionPriv.compatible_with_protector = function (self: PermissionPriv): boolean {
  // FIXME(TB-Cell): It is unclear what to do here.
  // `Cell` will occur with a protector but won't provide the guarantees
  // of noalias (it will fail the `protected_enforces_noalias` test).
  return !(self.$ === "ReservedIM" || self.$ === "Cell");
};

/// See `foreign_access_skipping.rs`. Computes the SIFA of a permission.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:107 strongest_idempotent_foreign_access
PermissionPriv.strongest_idempotent_foreign_access = function (self: PermissionPriv, prot: boolean): IdempotentForeignAccess {
  switch (self.$) {
    // Cell survives any foreign access
    case "Cell":
      return "Write";
    case "ReservedFrz":
      // A protected non-conflicted Reserved will become conflicted under a foreign read,
      // and is hence not idempotent under it.
      if (prot && !self.conflicted) return "None";
      // Otherwise, foreign reads do not affect Reserved
      return "Read";
    case "ReservedIM":
      // Famously, ReservedIM survives foreign writes. It is never protected.
      if (prot) return unreachable("internal error: entered unreachable code: Protected ReservedIM should not exist!");
      return "Write";
    // Unique changes on any foreign access (becomes Frozen/Disabled).
    case "Unique":
      return "None";
    // Frozen survives foreign reads, but not writes.
    case "Frozen":
      return "Read";
    // Disabled survives foreign reads and writes. It survives them
    // even if protected, because a protected `Disabled` is not initialized
    // and does therefore not trigger UB.
    case "Disabled":
      return "Write";
  }
};

/// This module controls how each permission individually reacts to an access.
/// Although these functions take `protected` as an argument, this is NOT because
/// we check protector violations here, but because some permissions behave differently
/// when protected.
// mod transition
/// A child node was read-accessed: UB on Disabled, noop on the rest.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:138 child_read
function child_read(state: PermissionPriv, _protected: boolean): PermissionPriv | undefined {
  switch (state.$) {
    case "Disabled":
      return undefined;
    // The inner data `ty_is_freeze` of `Reserved` is always irrelevant for Read
    // accesses, since the data is not being mutated. Hence the `{ .. }`.
    case "Cell":
    case "ReservedFrz":
    case "ReservedIM":
    case "Unique":
    case "Frozen":
      return state;
  }
}

/// A non-child node was read-accessed: keep `Reserved` but mark it as `conflicted` if it
/// is protected; invalidate `Unique`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:149 foreign_read
function foreign_read(state: PermissionPriv, protected_: boolean): PermissionPriv | undefined {
  switch (state.$) {
    // Cell ignores foreign reads.
    case "Cell":
      return PermissionPriv.Cell;
    // Non-writeable states just ignore foreign reads.
    case "Frozen":
    case "Disabled":
      return state;
    // Writeable states are more tricky, and depend on whether things are protected.
    // The inner data `ty_is_freeze` of `Reserved` is always irrelevant for Read
    // accesses, since the data is not being mutated. Hence the `{ .. }`

    case "ReservedFrz":
    case "ReservedIM":
      // Someone else read. To make sure we won't write before function exit,
      // we set the "conflicted" flag, which will disallow writes while we are protected.
      if (state.$ === "ReservedFrz" && protected_) return { $: "ReservedFrz", conflicted: true };
      // Before activation and without protectors, foreign reads are fine.
      // That's the entire point of 2-phase borrows.
      // Even though we haven't checked `ReservedIM if protected` separately,
      // it is a state that cannot occur because under a protector we only
      // create `ReservedFrz` never `ReservedIM`.
      assert(!protected_, "assertion failed: !protected");
      return state;
    case "Unique":
      if (protected_) {
        // We wrote, someone else reads -- that's bad.
        // (Since Unique is always initialized, this move-to-protected will mean insta-UB.)
        return PermissionPriv.Disabled;
      } else {
        // We don't want to disable here to allow read-read reordering: it is crucial
        // that the foreign read does not invalidate future reads through this tag.
        return PermissionPriv.Frozen;
      }
  }
}

/// A child node was write-accessed: `Reserved` must become `Unique` to obtain
/// write permissions, `Frozen` and `Disabled` cannot obtain such permissions and produce UB.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:186 child_write
function child_write(state: PermissionPriv, protected_: boolean): PermissionPriv | undefined {
  switch (state.$) {
    // Cell ignores child writes.
    case "Cell":
      return PermissionPriv.Cell;
    case "ReservedFrz":
      // If the `conflicted` flag is set, then there was a foreign read during
      // the function call that is still ongoing (still `protected`),
      // this is UB (`noalias` violation).
      if (state.conflicted && protected_) return undefined;
      return PermissionPriv.Unique;
    // A write always activates the 2-phase borrow, even with interior
    // mutability
    case "ReservedIM":
    case "Unique":
      return PermissionPriv.Unique;
    case "Frozen":
    case "Disabled":
      return undefined;
  }
}

/// A non-child node was write-accessed: this makes everything `Disabled` except for
/// non-protected interior mutable `Reserved` which stay the same.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:203 foreign_write
function foreign_write(state: PermissionPriv, protected_: boolean): PermissionPriv | undefined {
  // There is no explicit dependency on `protected`, but recall that interior mutable
  // types receive a `ReservedFrz` instead of `ReservedIM` when retagged under a protector,
  // so the result of this function does indirectly depend on (past) protector status.
  switch (state.$) {
    // Cell ignores foreign writes.
    case "Cell":
      return PermissionPriv.Cell;
    case "ReservedIM":
      // We can never create a `ReservedIM` under a protector, only `ReservedFrz`.
      assert(!protected_, "assertion failed: !protected");
      return state;
    default:
      return PermissionPriv.Disabled;
  }
}

/// Dispatch handler depending on the kind of access and its position.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:220 perform_access
export function perform_access(kind: AccessKind, rel_pos: AccessRelatedness, child: PermissionPriv, protected_: boolean): PermissionPriv | undefined {
  const is_foreign = rel_pos === "ForeignAccess";
  if (kind === "Write" && is_foreign) return foreign_write(child, protected_);
  if (kind === "Read" && is_foreign) return foreign_read(child, protected_);
  if (kind === "Write" && !is_foreign) return child_write(child, protected_);
  return child_read(child, protected_);
}

/// Public interface to the state machine that controls read-write permissions.
/// This is the "private `enum`" pattern.
// pub struct Permission { inner: PermissionPriv } (perms.gen.ts)

/// Transition from one permission to the next.
// pub struct PermTransition { from: PermissionPriv, to: PermissionPriv } (perms.gen.ts)

// impl Permission
/// Check if `self` can be the initial state of a pointer.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:251 is_initial
Permission.prototype.is_initial = function (this: Permission): boolean {
  return PermissionPriv.is_initial(this.inner);
};
/// Check if `self` is the terminal state of a pointer (is `Disabled`).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:255 is_disabled
Permission.prototype.is_disabled = function (this: Permission): boolean {
  return this.inner.$ === "Disabled";
};
/// Check if `self` is the never-allow-writes-again state of a pointer (is `Frozen`).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:259 is_frozen
Permission.prototype.is_frozen = function (this: Permission): boolean {
  return this.inner.$ === "Frozen";
};

/// Check if `self` is the shared-reference-to-interior-mutable-data state of a pointer.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:264 is_cell
Permission.prototype.is_cell = function (this: Permission): boolean {
  return this.inner.$ === "Cell";
};

/// Check if `self` is a Permission of type `Unique`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:269 is_unique
Permission.prototype.is_unique = function (this: Permission): boolean {
  return this.inner.$ === "Unique";
};

/// Create a new Permission of type `Unique`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:274 new_unique
Permission.new_unique = function (): Permission {
  return new Permission(PermissionPriv.Unique);
};

/// Create a new Permission of type `ReservedFrz` with conflictedReserved set to false
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:279 new_reserved_frz
Permission.new_reserved_frz = function (): Permission {
  return new Permission({ $: "ReservedFrz", conflicted: false });
};

/// Default initial permission of an unprotected interior mutable reference.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:284 new_reserved_im
Permission.new_reserved_im = function (): Permission {
  return new Permission(PermissionPriv.ReservedIM);
};

/// Default initial permission of a reborrowed shared reference.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:289 new_frozen
Permission.new_frozen = function (): Permission {
  return new Permission(PermissionPriv.Frozen);
};

/// Default initial permission of  the root of a new tree at out-of-bounds positions.
/// Must *only* be used for the root, this is not in general an "initial" permission!
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:295 new_disabled
Permission.new_disabled = function (): Permission {
  return new Permission(PermissionPriv.Disabled);
};

/// Default initial permission of a shared reference to interior mutable data.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:300 new_cell
Permission.new_cell = function (): Permission {
  return new Permission(PermissionPriv.Cell);
};

/// Reject `ReservedIM` that cannot exist in the presence of a protector.
// #[cfg(test)]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:306 compatible_with_protector
Permission.prototype.compatible_with_protector = function (this: Permission): boolean {
  return PermissionPriv.compatible_with_protector(this.inner);
};

/// What kind of access to perform before releasing the protector or on a reborrow.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:311 associated_access
Permission.prototype.associated_access = function (this: Permission): AccessKind | undefined {
  switch (this.inner.$) {
    // Do not do perform access if it is a `Cell`, as this
    // can cause data races when using thread-safe data types.
    case "Cell":
      return undefined;
    case "Unique":
      return "Write";
    default:
      return "Read";
  }
};

/// Apply the transition to the inner PermissionPriv.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:322 perform_access
Permission.perform_access = function (kind: AccessKind, rel_pos: AccessRelatedness, old_perm: Permission, protected_: boolean): PermTransition | undefined {
  const old_state = old_perm.inner;
  const new_state = perform_access(kind, rel_pos, old_state, protected_);
  return new_state === undefined ? undefined : new PermTransition(old_state, new_state);
};

/// During a provenance GC, we want to compact the tree.
/// For this, we want to merge nodes upwards if they have a singleton parent.
/// But we need to be careful: If the parent is Frozen, and the child is Reserved,
/// we can not do such a merge. In general, such a merge is possible if the parent
/// allows similar accesses, and in particular if the parent never causes UB on its
/// own. This is enforced by a test, namely `tree_compacting_is_sound`. See that
/// test for more information.
/// This method is only sound if the parent is not protected. We never attempt to
/// remove protected parents.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:342 can_be_replaced_by_child
Permission.prototype.can_be_replaced_by_child = function (this: Permission, child: Permission): boolean {
  const self_ = this.inner.$;
  const child_ = child.inner.$;
  // Cell allows all transitions.
  if (self_ === "Cell") return true;
  // Cell is the most permissive, nothing can be replaced by Cell.
  // (ReservedIM, Cell) => true,
  if (child_ === "Cell") return false;
  // ReservedIM can be replaced by anything besides Cell.
  // ReservedIM allows all transitions, but unlike Cell, a local write
  // to ReservedIM transitions to Unique, while it is a no-op for Cell.
  if (self_ === "ReservedIM") return true;
  if (child_ === "ReservedIM") return false;
  // Reserved (as parent, where conflictedness does not matter)
  // can be replaced by all but ReservedIM and Cell,
  // since ReservedIM and Cell alone would survive foreign writes
  if (self_ === "ReservedFrz") return true;
  if (child_ === "ReservedFrz") return false;
  // Unique can not be replaced by something surviving
  // foreign reads and then remaining writable (i.e., Reserved*).
  // Replacing a state by itself is always okay, even if the child state is protected.
  // Unique can be replaced by Frozen, since it is not protected.
  if (self_ === "Unique" && (child_ === "Unique" || child_ === "Frozen" || child_ === "Disabled")) return true;
  if (child_ === "Unique") return false;
  // Frozen can only be replaced by Disabled (and itself).
  if (self_ === "Frozen" && (child_ === "Frozen" || child_ === "Disabled")) return true;
  if (child_ === "Frozen") return false;
  // Disabled can not be replaced by anything else.
  // (Disabled, Disabled) => true,
  return true;
};

/// Returns the strongest foreign action this node survives (without change),
/// where `prot` indicates if it is protected.
/// See `foreign_access_skipping`
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:376 strongest_idempotent_foreign_access
Permission.prototype.strongest_idempotent_foreign_access = function (this: Permission, prot: boolean): IdempotentForeignAccess {
  return PermissionPriv.strongest_idempotent_foreign_access(this.inner, prot);
};

/// Returns the strongest access allowed that is local to this node without
/// causing UB (only considers possible transitions to this permission).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:382 strongest_allowed_local_access
Permission.prototype.strongest_allowed_local_access = function (this: Permission, protected_: boolean): WildcardAccessLevel {
  const inner = this.inner;
  // Everything except disabled can be accessed by read access.
  if (inner.$ === "Disabled") return "None";
  // Frozen references cannot be written to by a child.
  if (inner.$ === "Frozen") return "Read";
  // If the `conflicted` flag is set, then there was a foreign read
  // during the function call that is still ongoing (still `protected`),
  // this is UB (`noalias` violation).
  if (inner.$ === "ReservedFrz" && inner.conflicted && protected_) return "Read";
  // Everything else allows writes.
  return "Write";
};

// impl PermTransition
/// All transitions created through normal means (using `perform_access`)
/// should be possible, but the same is not guaranteed by construction of
/// transitions inferred by diagnostics. This checks that a transition
/// reconstructed by diagnostics is indeed one that could happen.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:403 is_possible
PermTransition.prototype.is_possible = function (this: PermTransition): boolean {
  // `self.from <= self.to` (`PartialOrd::le`)
  const c = PermissionPriv.partial_cmp(this.from, this.to);
  return c === -1 || c === 0;
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:407 is_noop
PermTransition.prototype.is_noop = function (this: PermTransition): boolean {
  return PermissionPriv_eq(this.from, this.to);
};

/// Extract result of a transition (checks that the starting point matches).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:412 applied
PermTransition.prototype.applied = function (this: PermTransition, starting_point: Permission): Permission | undefined {
  return PermissionPriv_eq(starting_point.inner, this.from) ? new Permission(this.to) : undefined;
};

/// Determines if this transition would disable the permission.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:417 produces_disabled
PermTransition.prototype.produces_disabled = function (this: PermTransition): boolean {
  return this.to.$ === "Disabled";
};

// pub mod diagnostics
// impl fmt::Display for PermissionPriv
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:425 fmt
export function display_PermissionPriv(self: PermissionPriv): string {
  switch (self.$) {
    case "Cell":
      return "Cell";
    case "ReservedFrz":
      return self.conflicted ? "Reserved (conflicted)" : "Reserved";
    case "ReservedIM":
      return "Reserved (interior mutable)";
    case "Unique":
      return "Unique";
    case "Frozen":
      return "Frozen";
    case "Disabled":
      return "Disabled";
  }
}

// impl fmt::Display for PermTransition
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:443 fmt
export function display_PermTransition(self: PermTransition): string {
  return `from ${display_PermissionPriv(self.from)} to ${display_PermissionPriv(self.to)}`;
}

// impl fmt::Display for Permission
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:449 fmt
export function display_Permission(self: Permission): string {
  return display_PermissionPriv(self.inner);
}

// impl Permission
/// Abbreviated name of the permission (uniformly 3 letters for nice alignment).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:456 short_name
Permission.prototype.short_name = function (this: Permission): string {
  // Make sure there are all of the same length as each other
  // and also as `diagnostics::DisplayFmtPermission.uninit` otherwise
  // alignment will be incorrect.
  const inner = this.inner;
  switch (inner.$) {
    case "Cell":
      return "Cel ";
    case "ReservedFrz":
      return inner.conflicted ? "ResC" : "Res ";
    case "ReservedIM":
      return "ReIM";
    case "Unique":
      return "Unq ";
    case "Frozen":
      return "Frz ";
    case "Disabled":
      return "Dis ";
  }
};

// impl PermTransition
/// Readable explanation of the consequences of an event.
/// Fits in the sentence "This transition corresponds to {trans.summary()}".
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:475 summary
PermTransition.prototype.summary = function (this: PermTransition): string {
  assert(this.is_possible(), "assertion failed: self.is_possible()");
  assert(!this.is_noop(), "assertion failed: !self.is_noop()");
  const from = this.from;
  const to = this.to;
  if (to.$ === "Unique") return "the first write to a 2-phase borrowed mutable reference";
  if (to.$ === "Frozen") return "a loss of write permissions";
  if (from.$ === "ReservedFrz" && !from.conflicted && to.$ === "ReservedFrz" && to.conflicted) {
    return "a temporary loss of write permissions until function exit";
  }
  if (from.$ === "Frozen" && to.$ === "Disabled") return "a loss of read permissions";
  if (to.$ === "Disabled") return "a loss of read and write permissions";
  return unreachable(
    `internal error: entered unreachable code: Transition from ${gen.debug_PermissionPriv(from, PLAIN)} to ${gen.debug_PermissionPriv(to, PLAIN)} should never be possible`,
  );
};

/** `ReservedFrz { conflicted: <conflicted> }` */
function is_reserved_frz(p: PermissionPriv, conflicted: boolean): boolean {
  return p.$ === "ReservedFrz" && p.conflicted === conflicted;
}

/// Determines whether `self` is a relevant transition for the error `err`.
/// `self` will be a transition that happened to a tag some time before
/// that tag caused the error.
///
/// Irrelevant events:
/// - modifications of write permissions when the error is related to read permissions
///   (on failed reads and protected `Frozen -> Disabled`, ignore `Reserved -> Unique`,
///   `Reserved(conflicted=false) -> Reserved(conflicted=true)`, and `Unique -> Frozen`)
/// - all transitions for attempts to deallocate strongly protected tags
///
/// # Panics
///
/// This function assumes that its arguments apply to the same location
/// and that they were obtained during a normal execution. It will panic otherwise.
/// - all transitions involved in `self` and `err` should be increasing
///   (Reserved < Unique < Frozen < Disabled);
/// - between `self` and `err` the permission should also be increasing,
///   so all permissions inside `err` should be greater than `self.1`;
/// - `Unique`, `Reserved(conflicted=false)`, and `Cell` cannot cause an error
///   due to insufficient permissions, so `err` cannot be a `ChildAccessForbidden(_)`
///   of either of them;
/// - `err` should not be `ProtectedDisabled(Disabled)`, because the protected
///   tag should not have been `Disabled` in the first place (if this occurs it means
///   we have unprotected tags that become protected)
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:514 is_relevant
PermTransition.prototype.is_relevant = function (this: PermTransition, err: TransitionError): boolean {
  // NOTE: `super::super` is the visibility of `TransitionError`
  assert(this.is_possible(), "assertion failed: self.is_possible()");
  if (this.is_noop()) {
    return false;
  }
  const to = this.to;
  switch (err.$) {
    case "ChildAccessForbidden": {
      const insufficient = err._0.inner;
      // Show where the permission was gained then lost,
      // but ignore unrelated permissions.
      // This eliminates transitions like `Unique -> Frozen`
      // when the error is a failed `Read`.
      if (to.$ === "Frozen" && insufficient.$ === "Frozen") return true;
      if (to.$ === "Unique" && insufficient.$ === "Frozen") return true;
      if (to.$ === "Disabled" && insufficient.$ === "Disabled") return true;
      if (is_reserved_frz(to, true) && is_reserved_frz(insufficient, true)) return true;
      // A pointer being `Disabled` is a strictly stronger source of
      // errors than it being `Frozen`. If we try to access a `Disabled`,
      // then where it became `Frozen` (or `Unique` or `Reserved`) is the least
      // of our concerns for now.
      if ((is_reserved_frz(to, true) || to.$ === "Unique" || to.$ === "Frozen") && insufficient.$ === "Disabled") return false;
      if (is_reserved_frz(to, true) && insufficient.$ === "Frozen") return false;

      // `Unique`, `Reserved`, and `Cell` have all permissions, so a
      // `ChildAccessForbidden(Reserved | Unique)` can never exist.
      if (insufficient.$ === "Unique" || is_reserved_frz(insufficient, false) || insufficient.$ === "Cell") {
        return unreachable("internal error: entered unreachable code: this permission cannot cause an error");
      }
      // No transition has `Reserved { conflicted: false }` or `ReservedIM`
      // as its `.to` unless it's a noop. `Cell` cannot be in its `.to`
      // because all child accesses are a noop.
      if (is_reserved_frz(to, false) || to.$ === "ReservedIM" || to.$ === "Cell") {
        return unreachable("internal error: entered unreachable code: self is a noop transition");
      }
      // All transitions produced in normal executions (using `apply_access`)
      // change permissions in the order `Reserved -> Unique -> Frozen -> Disabled`.
      // We assume that the error was triggered on the same location that
      // the transition `self` applies to, so permissions found must be increasing
      // in the order `self.from < self.to <= insufficient.inner`
      // (Unique | Frozen | Disabled, ReservedFrz { .. } | ReservedIM)
      // | (Disabled, Frozen)
      // | (ReservedFrz { .. }, ReservedIM)
      return unreachable("internal error: entered unreachable code: permissions between self and err must be increasing");
    }
    case "ProtectedDisabled": {
      const before_disabled = err._0.inner;
      // Show how we got to the starting point of the forbidden transition,
      // but ignore what came before.
      // This eliminates transitions like `Reserved -> Unique`
      // when the error is a `Frozen -> Disabled`.
      // We absolutely want to know where it was activated/frozen/marked
      // conflicted.
      if (to.$ === "Unique" && before_disabled.$ === "Unique") return true;
      if (to.$ === "Frozen" && before_disabled.$ === "Frozen") return true;
      if (is_reserved_frz(to, true) && is_reserved_frz(before_disabled, true)) return true;
      // If the error is a transition `Frozen -> Disabled`, then we don't really
      // care whether before that was `Reserved -> Unique -> Frozen` or
      // `Frozen` directly.
      // The error will only show either
      // - created as Reserved { conflicted: false },
      //   then Reserved { .. } -> Disabled is forbidden
      // - created as Reserved { conflicted: false },
      //   then Unique -> Disabled is forbidden
      // A potential `Reserved { conflicted: false }
      //   -> Reserved { conflicted: true }` is inexistent or irrelevant,
      // and so is the `Reserved { conflicted: false } -> Unique`
      if (to.$ === "Unique" && before_disabled.$ === "Frozen") return false;
      if (is_reserved_frz(to, true)) return false;

      if (before_disabled.$ === "Disabled") {
        return unreachable("internal error: entered unreachable code: permission that results in Disabled should not itself be Disabled in the first place");
      }
      // No transition has `Reserved { conflicted: false }` or `ReservedIM` as its `.to`
      // unless it's a noop. `Cell` cannot be in its `.to` because all child
      // accesses are a noop.
      if (is_reserved_frz(to, false) || to.$ === "ReservedIM" || to.$ === "Cell") {
        return unreachable("internal error: entered unreachable code: self is a noop transition");
      }

      // Permissions only evolve in the order `Reserved -> Unique -> Frozen -> Disabled`,
      // so permissions found must be increasing in the order
      // `self.from < self.to <= forbidden.from < forbidden.to`.
      // (Disabled, Cell | ReservedFrz { .. } | ReservedIM | Unique | Frozen)
      // | (Frozen, Cell | ReservedFrz { .. } | ReservedIM | Unique)
      // | (Unique, Cell | ReservedFrz { .. } | ReservedIM)
      return unreachable("internal error: entered unreachable code: permissions between self and err must be increasing");
    }
    // We don't care because protectors evolve independently from
    // permissions.
    case "ProtectedDealloc":
      return false;
  }
};

/// Endpoint of a transition.
/// Meant only for diagnostics, use `applied` in non-diagnostics
/// code, which also checks that the starting point matches the current state.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:617 endpoint
PermTransition.prototype.endpoint = function (this: PermTransition): Permission {
  return new Permission(this.to);
};

// #[cfg(test)]
// impl Permission
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:625 is_reserved_frz_with_conflicted
Permission.prototype.is_reserved_frz_with_conflicted = function (this: Permission, expected_conflicted: boolean): boolean {
  const inner = this.inner;
  return inner.$ === "ReservedFrz" ? inner.conflicted === expected_conflicted : false;
};

// #[cfg(test)] mod propagation_optimization_checks: the `Exhaustive` impls (tree/tests.rs needs them too), then the
// `#[test]` fns in perms.test.ts.
// impl Exhaustive for PermissionPriv
export const Exhaustive_PermissionPriv: Exhaustive<PermissionPriv> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:639 exhaustive
  *exhaustive() {
    yield PermissionPriv.Unique;
    yield PermissionPriv.Frozen;
    yield PermissionPriv.Disabled;
    yield PermissionPriv.ReservedIM;
    yield PermissionPriv.Cell;
    for (const conflicted of Exhaustive_bool.exhaustive()) {
      yield { $: "ReservedFrz", conflicted };
    }
  },
};

// impl Exhaustive for Permission
export const Exhaustive_Permission: Exhaustive<Permission> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:649 exhaustive
  *exhaustive() {
    for (const inner of Exhaustive_PermissionPriv.exhaustive()) {
      yield new Permission(inner);
    }
  },
};

// impl Exhaustive for AccessKind
export const Exhaustive_AccessKind: Exhaustive<AccessKind> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:655 exhaustive
  *exhaustive() {
    yield "Read";
    yield "Write";
  },
};

// impl Exhaustive for AccessRelatedness
export const Exhaustive_AccessRelatedness: Exhaustive<AccessRelatedness> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:662 exhaustive
  *exhaustive() {
    yield "ForeignAccess";
    yield "LocalAccess";
  },
};
