//! Tests for the tree
// Port of src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-b`
// (plan-m6 wave 38).
//
// PENDING miri-tb-a: every test here needs lane miri-tb-a's `Permission`, `Exhaustive` and tables. Root renames this file to
// tree/tests.test.ts after merging that lane (docs/handoff/miri-tb-b.md). It has no `.ts` extension until then so that
// neither bun test nor tsc nor contract.test.ts sees it.
//
// PORT: `impl Exhaustive for X` are `Exhaustive_X` tables (exhaustive.ts); `TestEvent<RetX, RetY>`'s parameters are the
// tables of `RetX` / `RetY`, `AllowRet` is `Exhaustive_unit` and `NoRet` is `Exhaustive_never`.
// PORT: `impl LocationState { compatible_with_protector }` (test-only) is a module fn.
// PORT: `LocStateProt` / `LocStateProtPair` values are immutable here (`perform_access` mutates a private copy of the
// `LocationState`), so upstream's `.clone()` of a pair shares the object. `Hash`/`Eq` of the sets is a string key.
import { expect, test } from "bun:test";
import { type AccessKind, display_AccessKind } from "../../mod.ts";
import { copy, type Exhaustive, Exhaustive_array2, Exhaustive_bool, Exhaustive_never, Exhaustive_tuple2, Exhaustive_unit } from "../exhaustive.ts";
import { debug_TransitionError } from "../diagnostics.ts";
import { Exhaustive_AccessKind, Exhaustive_AccessRelatedness, Exhaustive_Permission, display_Permission, Permission } from "../perms.ts";
import { AccessRelatedness, clone_LocationState, debug_LocationState, display_LocationState, LocationState, LocationState_eq } from "../tree.ts";
import { debug_AccessRelatedness } from "../tree.gen.ts";
import { PLAIN } from "../../../../std/fmt.ts";
import { assert, panic } from "../../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../../std/result.ts";

// impl Exhaustive for LocationState
const Exhaustive_LocationState: Exhaustive<LocationState> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:10 exhaustive
  *exhaustive() {
    // We keep `latest_foreign_access` at `None` as that's just a cache.
    for (const [permission, accessed] of Exhaustive_tuple2(Exhaustive_Permission, Exhaustive_bool, copy).exhaustive()) {
      const x = new LocationState(accessed, permission, "None");
      if (x.possible()) yield x;
    }
  },
};

/// Ensure that the current internal state can exist at the same time as a protector.
/// In practice this only eliminates `ReservedIM` that is never used in the presence
/// of a protector (we instead emit `ReservedFrz` on retag).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:30 compatible_with_protector
function compatible_with_protector(self: LocationState): boolean {
  return self.permission.compatible_with_protector();
}

// Exhaustive check that for any starting configuration loc,
// for any two read accesses r1 and r2, if `loc + r1 + r2` is not UB
// and results in `loc'`, then `loc + r2 + r1` is also not UB and results
// in the same final state `loc'`.
// This lets us justify arbitrary read-read reorderings.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:42 all_read_accesses_commute
test("all_read_accesses_commute", () => {
  const kind: AccessKind = "Read";
  // Two of the four combinations of `AccessRelatedness` are trivial,
  // but we might as well check them all.
  for (const [rel1, rel2] of Exhaustive_array2(Exhaustive_AccessRelatedness, copy).exhaustive()) {
    // Any protector state works, but we can't move reads across function boundaries
    // so the two read accesses occur under the same protector.
    for (const protected_ of Exhaustive_bool.exhaustive()) {
      for (const loc of Exhaustive_LocationState.exhaustive()) {
        if (protected_) {
          if (!compatible_with_protector(loc)) continue; // precondition!
        }
        // Apply 1 then 2. Failure here means that there is UB in the source
        // and we skip the check in the target.
        const loc12 = clone_LocationState(loc);
        if (loc12.perform_access(kind, rel1, protected_).$ !== "Ok") continue; // precondition!
        if (loc12.perform_access(kind, rel2, protected_).$ !== "Ok") continue; // precondition!

        // If 1 followed by 2 succeeded, then 2 followed by 1 must also succeed...
        const loc21 = clone_LocationState(loc);
        unwrap_result(loc21.perform_access(kind, rel2, protected_), debug_TransitionError);
        unwrap_result(loc21.perform_access(kind, rel1, protected_), debug_TransitionError);

        // ... and produce the same final result.
        assert(
          LocationState_eq(loc12, loc21),
          () =>
            `assertion \`left == right\` failed: Read accesses ${debug_AccessRelatedness(rel1, PLAIN)} followed by ${debug_AccessRelatedness(rel2, PLAIN)} do not commute !\n  left: ${debug_LocationState(loc12, PLAIN)}\n right: ${debug_LocationState(loc21, PLAIN)}`,
        );
      }
    }
  }
});

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:75 as_foreign_or_child
function as_foreign_or_child(related: AccessRelatedness): string {
  return AccessRelatedness.is_foreign(related) ? "foreign" : "child";
}

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:79 as_protected
function as_protected(b: boolean): string {
  return b ? " (protected)" : "";
}

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:83 as_lazy_or_accessed
function as_lazy_or_accessed(b: boolean): string {
  return b ? "accessed" : "lazy";
}

/// Test that tree compacting (as performed by the GC) is sound.
/// Specifically, the GC will replace a parent by a child if the parent is not
/// protected, and if `can_be_replaced_by_child(parent, child)` is true.
/// To check that this is sound, the function must be a simulation, i.e.
/// if both are accessed, the results must still be in simulation, and also
/// if an access is UB, it must also be UB if done only at the child.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:94 tree_compacting_is_sound
test("tree_compacting_is_sound", () => {
  // The parent is unprotected
  const parent_protected = false;
  for (const [[parent, child], child_protected] of Exhaustive_tuple2(Exhaustive_array2(Exhaustive_LocationState, clone_LocationState), Exhaustive_bool, ([a, b]): [LocationState, LocationState] => [clone_LocationState(a), clone_LocationState(b)]).exhaustive()) {
    if (child_protected) {
      if (!compatible_with_protector(child)) continue; // precondition!
    }
    if (!parent.permission_().can_be_replaced_by_child(child.permission_())) continue; // precondition!
    for (const [kind, rel] of Exhaustive_tuple2(Exhaustive_AccessKind, Exhaustive_AccessRelatedness, copy).exhaustive()) {
      const new_parent = parent.perform_access_no_fluff(kind, rel, parent_protected);
      const new_child = child.perform_access_no_fluff(kind, rel, child_protected);
      if (new_parent !== undefined && new_child !== undefined) {
        const np = new_parent;
        const nc = new_child;
        assert(
          np.permission_().can_be_replaced_by_child(nc.permission_()),
          () =>
            `\`can_be_replaced_by_child\` is not a simulation: on a ${as_foreign_or_child(rel)} ${display_AccessKind(kind)} to a ${display_Permission(parent.permission_())} parent and a ${as_lazy_or_accessed(child.accessed_())} ${display_Permission(child.permission_())}${as_protected(child_protected)} child, the parent becomes ${display_Permission(np.permission_())}, the child becomes ${display_Permission(nc.permission_())}, and these are not in simulation!`,
        );
      } else if (new_child === undefined) {
        // the child produced UB, this is fine no matter what the parent does
      } else {
        const nc = new_child;
        panic(
          `\`can_be_replaced_by_child\` does not have the UB property: on a ${as_foreign_or_child(rel)} ${display_AccessKind(kind)} to a(n) ${display_Permission(parent.permission_())} parent and a(n) ${as_lazy_or_accessed(child.accessed_())} ${display_Permission(child.permission_())}${as_protected(child_protected)} child, only the parent causes UB, while the child becomes ${display_Permission(nc.permission_())}, and it is not allowed for only the parent to cause UB!`,
        );
      }
    }
  }
});

// Ensure that of 2 accesses happen, one foreign and one a child, and we are protected, that we
// get UB unless they are both reads.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:144 protected_enforces_noalias
test("protected_enforces_noalias", () => {
  for (const [rel1, rel2] of Exhaustive_array2(Exhaustive_AccessRelatedness, copy).exhaustive()) {
    // We want to check pairs of accesses where one is foreign and one is not.
    if (AccessRelatedness.is_foreign(rel1) === AccessRelatedness.is_foreign(rel2)) continue; // precondition!
    for (const [kind1, kind2] of Exhaustive_array2(Exhaustive_AccessKind, copy).exhaustive()) {
      const protected_ = true;
      for (const state of Exhaustive_LocationState.exhaustive()) {
        if (!compatible_with_protector(state)) continue; // `.filter(|s| s.compatible_with_protector())`
        if (state.perform_access(kind1, rel1, protected_).$ !== "Ok") continue; // precondition!
        if (state.perform_access(kind2, rel2, protected_).$ !== "Ok") continue; // precondition!
        // If these were both allowed, it must have been two reads.
        assert(kind1 === "Read" && kind2 === "Read", "failed to enforce noalias between two accesses that are not both reads");
      }
    }
  }
});

/// We are going to exhaustively test the possibility of inserting
/// a spurious read in some code.
///
/// We choose some pointer `x` through which we want a spurious read to be inserted.
/// `x` must thus be reborrowed, not have any children, and initially start protected.
///
/// To check if inserting a spurious read is possible, we observe the behavior
/// of some pointer `y` different from `x` (possibly from a different thread, thus
/// the protectors on `x` and `y` are not necessarily well-nested).
/// It must be the case that no matter the context, the insertion of a spurious read
/// through `x` does not introduce UB in code that did not already have UB.
///
/// Testing this will need some setup to simulate the evolution of the permissions
/// of `x` and `y` under arbitrary code. This arbitrary code of course includes
/// read and write accesses through `x` and `y`, but it must also consider
/// the less obvious:
/// - accesses through pointers that are *neither* `x` nor `y`,
/// - retags of `y` that change its relative position to `x`.
///
///
/// The general code pattern thus looks like
///     [thread 1]             || [thread 2]
///                            || y exists
///     retag x (protect)      ||
///                      arbitrary code
///                           read/write x/y/other
///                        or retag y
///                        or unprotect y
///     <spurious read x>      ||
///                      arbitrary code
///                           read/write x/y/other
///                        or retag y
///                        or unprotect y
///                        or unprotect x
///
/// `x` must still be protected at the moment the spurious read is inserted
/// because spurious reads are impossible in general on unprotected tags.
// mod spurious_read

/// Accessed pointer.
type PtrSelector = "X" | "Y" | "Other";

/// Relative position of `x` and `y`.
/// `y` cannot be a child of `x` because `x` gets retagged as the first
/// thing in the pattern, so it cannot have children.
type RelPosXY = "MutuallyForeign" /** X is a child of Y. */ | "XChildY";

// impl Exhaustive for PtrSelector
const Exhaustive_PtrSelector: Exhaustive<PtrSelector> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:222 exhaustive
  *exhaustive() {
    yield* ["X", "Y", "Other"] as const;
  },
};

// impl fmt::Display for PtrSelector
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:229 fmt
function display_PtrSelector(self: PtrSelector): string {
  switch (self) {
    case "X":
      return "x";
    case "Y":
      return "y";
    case "Other":
      return "z";
  }
}

// impl Exhaustive for RelPosXY
const Exhaustive_RelPosXY: Exhaustive<RelPosXY> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:239 exhaustive
  *exhaustive() {
    yield* ["MutuallyForeign", "XChildY"] as const;
  },
};

// impl fmt::Display for RelPosXY
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:246 fmt
function display_RelPosXY(self: RelPosXY): string {
  switch (self) {
    case "MutuallyForeign":
      return "x and y are mutually foreign";
    case "XChildY":
      return "x is a child of y";
  }
}

/// Knowing the relative position of `x` to `y`, determine the relative
/// position of the accessed pointer defined by `self` relative to each `x`
/// and `y`.
///
/// The output is not necessarily well-defined in general, but it
/// is unique when considered up to equivalence by `AccessRelatedness::is_foreign`
/// (e.g. having `RelPosXY::XChildY` and `PtrSelector::Other`, strictly
/// speaking it is impossible to determine if `Other` is a `DistantAccess`
/// or an `AncestorAccess` relative to `y`, but it doesn't really matter
/// because `DistantAccess.is_foreign() == AncestorAccess.is_foreign()`).
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:265 rel_pair
function rel_pair(self: PtrSelector, xy_rel: RelPosXY): [AccessRelatedness, AccessRelatedness] {
  switch (xy_rel) {
    case "MutuallyForeign":
      switch (self) {
        case "X":
          return ["LocalAccess", "ForeignAccess"];
        case "Y":
          return ["ForeignAccess", "LocalAccess"];
        case "Other":
          return ["ForeignAccess", "ForeignAccess"];
      }
    // fallthrough is unreachable: the inner match is exhaustive
    case "XChildY":
      switch (self) {
        case "X":
          return ["LocalAccess", "LocalAccess"];
        case "Y":
          return ["ForeignAccess", "LocalAccess"];
        case "Other":
          return ["ForeignAccess", "ForeignAccess"];
      }
  }
}

/// Arbitrary access parametrized by the relative position of `x` and `y`
/// to each other.
interface TestAccess {
  ptr: PtrSelector;
  kind: AccessKind;
}

// impl Exhaustive for TestAccess
const Exhaustive_TestAccess: Exhaustive<TestAccess> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:293 exhaustive
  *exhaustive() {
    for (const [ptr, kind] of Exhaustive_tuple2(Exhaustive_PtrSelector, Exhaustive_AccessKind, copy).exhaustive()) {
      yield { ptr, kind };
    }
  },
};

// impl fmt::Display for TestAccess
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:302 fmt
function display_TestAccess(self: TestAccess): string {
  const kind_text = self.kind === "Read" ? "read" : "write";
  return `${kind_text} ${display_PtrSelector(self.ptr)}`;
}

const AllowRet = Exhaustive_unit;
const NoRet = Exhaustive_never;
/// Events relevant to the evolution of 2 pointers are
/// - any access to the same location
/// - end of one of them being protected
/// - a retag that would change their relative position
///
/// The type `TestEvent` models these kinds of events.
///
/// In order to prevent `x` or `y` from losing their protector,
/// choose a type `RetX` or `RetY` that is not inhabited.
/// e.g.
/// - `TestEvent<AllowRet, AllowRet>` is any event including end of protector on either `x` or `y`
/// - `TestEvent<NoRet, NoRet>` is any access
/// - `TestEvent<NoRet, AllowRet>` allows for `y` to lose its protector but not `x`
type TestEvent<RetX, RetY> =
  | { readonly $: "Access"; _0: TestAccess }
  | { readonly $: "RetX"; _0: RetX }
  | { readonly $: "RetY"; _0: RetY }
  /// The inner `LocStateProt` must be an initial state (as per the `is_initial` function)
  | { readonly $: "RetagY"; _0: LocStateProt };

// impl<RetX, RetY> Exhaustive for TestEvent<RetX, RetY>
function Exhaustive_TestEvent<RetX, RetY>(RetX: Exhaustive<RetX>, RetY: Exhaustive<RetY>): Exhaustive<TestEvent<RetX, RetY>> {
  return {
    // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:340 exhaustive
    *exhaustive() {
      for (const acc of Exhaustive_TestAccess.exhaustive()) yield { $: "Access", _0: acc };
      for (const retx of RetX.exhaustive()) yield { $: "RetX", _0: retx };
      for (const rety of RetY.exhaustive()) yield { $: "RetY", _0: rety };
      for (const s of Exhaustive_LocStateProt.exhaustive()) if (s.is_initial()) yield { $: "RetagY", _0: s };
    },
  };
}

// impl<RetX, RetY> fmt::Display for TestEvent<RetX, RetY>
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:355 fmt
function display_TestEvent<RetX, RetY>(self: TestEvent<RetX, RetY>): string {
  switch (self.$) {
    case "Access":
      return display_TestAccess(self._0);
    // The fields of the `Ret` variants just serve to make them
    // impossible to instantiate via the `RetX = NoRet` type; we can
    // always ignore their value.
    case "RetX":
      return "ret x";
    case "RetY":
      return "ret y";
    case "RetagY":
      return `retag y (${display_LocStateProt(self._0)})`;
  }
}

/// The state of a pointer on a location, including the protector.
/// It is represented here with the protector bound to the `LocationState` rather
/// than the `Map<Location, LocationState>` as is normally the case,
/// but since all our exhaustive tests look at a  single location
/// there's no risk of `prot` for different locations of the same tag getting
/// out of sync.
class LocStateProt {
  constructor(
    readonly state: LocationState,
    readonly prot: boolean,
  ) {}

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:381 is_initial
  is_initial(): boolean {
    return this.state.permission_().is_initial();
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:385 perform_access
  perform_access(kind: AccessKind, rel: AccessRelatedness): Result<LocStateProt, null> {
    const state = clone_LocationState(this.state);
    if (state.perform_access(kind, rel, this.prot).$ === "Err") return Err(null);
    return Ok(new LocStateProt(state, this.prot));
  }

  /// Remove the protector.
  /// This does not perform the implicit read on function exit because
  /// `LocStateProt` does not have enough context to apply its effect.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:394 end_protector
  end_protector(): LocStateProt {
    return new LocStateProt(this.state, false);
  }
}

// impl Exhaustive for LocStateProt
const Exhaustive_LocStateProt: Exhaustive<LocStateProt> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:400 exhaustive
  *exhaustive() {
    for (const [state, prot] of Exhaustive_tuple2(Exhaustive_LocationState, Exhaustive_bool, clone_LocationState).exhaustive()) {
      yield new LocStateProt(state, prot);
    }
  },
};

// impl fmt::Display for LocStateProt
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:408 fmt
function display_LocStateProt(self: LocStateProt): string {
  let f = display_LocationState(self.state);
  if (self.prot) {
    f += ", protect";
  }
  return f;
}

/** `#[derive(Hash, Eq)]` of `LocStateProt`, as a key. */
function key_LocStateProt(self: LocStateProt): string {
  const inner = self.state.permission.inner;
  const perm = inner.$ === "ReservedFrz" ? `ReservedFrz${inner.conflicted}` : inner.$;
  return `${self.state.accessed}/${perm}/${self.state.idempotent_foreign_access}/${self.prot}`;
}

/// The states of two pointers to the same location,
/// and their relationship to each other in the tree.
///
/// Note that the two states interact: using one pointer can have
/// an impact on the other.
/// This makes `LocStateProtPair` more meaningful than a simple
/// `(LocStateProt, LocStateProt)` where the two states are not guaranteed
/// to be updated at the same time.
/// Some `LocStateProtPair` may be unreachable through normal means
/// such as `x: Unique, y: Unique` in the case of mutually foreign pointers.
class LocStateProtPair {
  constructor(
    readonly xy_rel: RelPosXY,
    readonly x: LocStateProt,
    readonly y: LocStateProt,
  ) {}

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:435 perform_test_access
  perform_test_access(acc: TestAccess): Result<LocStateProtPair, null> {
    const [xrel, yrel] = rel_pair(acc.ptr, this.xy_rel);
    const x = this.x.perform_access(acc.kind, xrel);
    if (x.$ === "Err") return x;
    const y = this.y.perform_access(acc.kind, yrel);
    if (y.$ === "Err") return y;
    return Ok(new LocStateProtPair(this.xy_rel, x._0, y._0));
  }

  /// Perform a read on the given pointer if its state is `accessed`.
  /// Must be called just after reborrowing a pointer, and just after
  /// removing a protector.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:445 retag_dependent_access
  retag_dependent_access(ptr: PtrSelector): Result<LocStateProtPair, null> {
    let accessed: AccessKind | undefined;
    switch (ptr) {
      case "X":
        accessed = this.x.state.accessed ? this.x.state.permission.associated_access() : undefined;
        break;
      case "Y":
        accessed = this.y.state.accessed ? this.y.state.permission.associated_access() : undefined;
        break;
      case "Other":
        return panic("the `accessed` status of `PtrSelector::Other` is unknown, do not pass it to `read_if_accessed`");
    }
    if (accessed !== undefined) {
      return this.perform_test_access({ ptr, kind: accessed });
    } else {
      return Ok(this);
    }
  }

  /// Remove the protector of `x`, including the implicit read on function exit.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:464 end_protector_x
  end_protector_x(): Result<LocStateProtPair, null> {
    const x = this.x.end_protector();
    return new LocStateProtPair(this.xy_rel, x, this.y).retag_dependent_access("X");
  }

  /// Remove the protector of `y`, including the implicit read on function exit.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:470 end_protector_y
  end_protector_y(): Result<LocStateProtPair, null> {
    const y = this.y.end_protector();
    return new LocStateProtPair(this.xy_rel, this.x, y).retag_dependent_access("Y");
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:475 retag_y
  retag_y(new_y: LocStateProt): Result<LocStateProtPair, null> {
    assert(new_y.is_initial(), "assertion failed: new_y.is_initial()");
    if (new_y.prot && !compatible_with_protector(new_y.state)) {
      return Err(null);
    }
    // `xy_rel` changes to "mutually foreign" now: `y` can no longer be a parent of `x`.
    return new LocStateProtPair("MutuallyForeign", this.x, new_y).retag_dependent_access("Y");
  }

  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:485 perform_test_event
  perform_test_event<RetX, RetY>(evt: TestEvent<RetX, RetY>): Result<LocStateProtPair, null> {
    switch (evt.$) {
      case "Access":
        return this.perform_test_access(evt._0);
      // The fields of the `Ret` variants just serve to make them
      // impossible to instantiate via the `RetX = NoRet` type; we can
      // always ignore their value.
      case "RetX":
        return this.end_protector_x();
      case "RetY":
        return this.end_protector_y();
      case "RetagY":
        return this.retag_y(evt._0);
    }
  }
}

/** `#[derive(Hash, Eq)]` of `LocStateProtPair`, as a key. */
function key_LocStateProtPair(self: LocStateProtPair): string {
  return `${self.xy_rel}:${key_LocStateProt(self.x)}:${key_LocStateProt(self.y)}`;
}

// impl Exhaustive for LocStateProtPair
const Exhaustive_LocStateProtPair: Exhaustive<LocStateProtPair> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:499 exhaustive
  *exhaustive() {
    for (const [x, y] of Exhaustive_array2(Exhaustive_LocStateProt, copy).exhaustive()) {
      for (const xy_rel of Exhaustive_RelPosXY.exhaustive()) {
        yield new LocStateProtPair(xy_rel, x, y);
      }
    }
  },
};

// impl fmt::Display for LocStateProtPair
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:508 fmt
function display_LocStateProtPair(self: LocStateProtPair): string {
  return `x:${display_LocStateProt(self.x)}, y:${display_LocStateProt(self.y)}`;
}

/// Arbitrary sequence of events, as experienced by two mutually foreign pointers
/// to the same location.
interface OpaqueCode<RetX, RetY> {
  events: TestEvent<RetX, RetY>[];
}

// impl<RetX, RetY> fmt::Display for OpaqueCode<RetX, RetY>
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:521 fmt
function display_OpaqueCode<RetX, RetY>(self: OpaqueCode<RetX, RetY>): string {
  let f = "";
  for (const evt of self.events) {
    f += `${display_TestEvent(evt)}; `;
  }
  return f;
}

// upstream's second `impl LocStateProtPair` (PORT: on the prototype, so the markers stay in upstream order)
interface LocStateProtPair {
  all_states_reachable_via_opaque_code<RetX, RetY>(RetX: Exhaustive<RetX>, RetY: Exhaustive<RetY>): [LocStateProtPair, OpaqueCode<RetX, RetY>][];
  distinguishable<RetX, RetY>(RetX: Exhaustive<RetX>, RetY: Exhaustive<RetY>, other: LocStateProtPair): boolean;
}

/// List all sequences of operations that start at `self` and do not cause UB
/// There are no duplicates: all sequences returned lead to distinct final states
/// (though the sequence is not guaranteed to be the shortest possible sequence of events).
/// Yields the states it reaches, and the sequence of operations that got us there.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:534 all_states_reachable_via_opaque_code
LocStateProtPair.prototype.all_states_reachable_via_opaque_code = function <RetX, RetY>(this: LocStateProtPair, RetX: Exhaustive<RetX>, RetY: Exhaustive<RetY>): [LocStateProtPair, OpaqueCode<RetX, RetY>][] {
  // We compute the reachable set of `Self` from `self` by non-UB `OpaqueCode`.
  // Configurations are `(reach: Self, code: OpaqueCode)` tuples
  // for which `code` applied to `self` returns `Ok(reach)`.

  // Stack of all configurations left to handle.
  const handle: [LocStateProtPair, OpaqueCode<RetX, RetY>][] = [[this, { events: [] }]];
  // Code that can be applied to `self`, and final state.
  const paths: [LocStateProtPair, OpaqueCode<RetX, RetY>][] = [];
  // Already explored states reachable from `self`
  const seen = new Set<string>();
  // This is essentially just computing the transitive closure by `perform_test_event`,
  // most of the work lies in remembering the path up to the current state.
  for (let top = handle.pop(); top !== undefined; top = handle.pop()) {
    const [state, path] = top;
    for (const evt of Exhaustive_TestEvent(RetX, RetY).exhaustive()) {
      const next = state.perform_test_event(evt);
      if (next.$ === "Ok") {
        const key = key_LocStateProtPair(next._0);
        if (!seen.has(key)) {
          seen.add(key);
          const evts: OpaqueCode<RetX, RetY> = { events: [...path.events, evt] };
          paths.push([next._0, evts]);
          handle.push([next._0, evts]);
        }
      }
    }
  }
  return paths;
};

/// Two states (by convention `self` is the source and `other` is the target)
/// are "distinguishable" if there exists a sequence of instructions
/// that causes UB in the target but not in the source.
/// This implementation simply explores the reachable space
/// by all sequences of `TestEvent`.
/// This function can be instantiated with `RetX` and `RetY`
/// among `NoRet` or `AllowRet` to resp. forbid/allow `x`/`y` to lose their
/// protector.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:580 distinguishable
LocStateProtPair.prototype.distinguishable = function <RetX, RetY>(this: LocStateProtPair, RetX: Exhaustive<RetX>, RetY: Exhaustive<RetY>, other: LocStateProtPair): boolean {
  if (key_LocStateProtPair(this) === key_LocStateProtPair(other)) return false;
  const states: [LocStateProtPair, LocStateProtPair][] = [[this, other]];
  const seen = new Set<string>();
  for (let state = states.pop(); state !== undefined; state = states.pop()) {
    const key = `${key_LocStateProtPair(state[0])}|${key_LocStateProtPair(state[1])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [source, target] = state;
    for (const evt of Exhaustive_TestEvent(RetX, RetY).exhaustive()) {
      // Generate successor states through events (accesses and protector ends)
      const new_source = source.perform_test_event(evt);
      if (new_source.$ !== "Ok") continue;
      const new_target = target.perform_test_event(evt);
      if (new_target.$ !== "Ok") return true;
      if (key_LocStateProtPair(new_source._0) === key_LocStateProtPair(new_target._0)) continue;
      states.push([new_source._0, new_target._0]);
    }
  }
  return false;
};

// `Reserved { conflicted: false }` and `Reserved { conflicted: true }` are properly indistinguishable
// under the conditions where we want to insert a spurious read.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:606 reserved_aliased_protected_indistinguishable
test("reserved_aliased_protected_indistinguishable", () => {
  const source = new LocStateProtPair(
    "MutuallyForeign",
    new LocStateProt(
      // For the tests, the strongest idempotent foreign access does not matter, so we use `Default::default`
      LocationState.new_accessed(Permission.new_frozen(), "None"),
      true,
    ),
    new LocStateProt(LocationState.new_non_accessed(Permission.new_reserved_frz(), "None"), true),
  );
  const acc: TestAccess = { ptr: "X", kind: "Read" };
  const target = unwrap_result(source.perform_test_access(acc));
  expect(source.y.state.permission.is_reserved_frz_with_conflicted(false)).toBe(true);
  expect(target.y.state.permission.is_reserved_frz_with_conflicted(true)).toBe(true);
  expect(source.distinguishable(AllowRet, AllowRet, target)).toBe(false);
});

// impl Exhaustive for Pattern
const Exhaustive_Pattern: Exhaustive<Pattern> = {
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:654 exhaustive
  *exhaustive() {
    const v: Pattern[] = [];
    for (const xy_rel of Exhaustive_RelPosXY.exhaustive()) {
      for (const [x_retag_perm, y_current_perm] of Exhaustive_tuple2(Exhaustive_LocationState, Exhaustive_LocationState, clone_LocationState).exhaustive()) {
        // We can only do spurious reads for accessed locations anyway.
        if (!x_retag_perm.accessed) continue; // precondition!
        // And `x` just got retagged, so it must be initial.
        if (!x_retag_perm.permission.is_initial()) continue; // precondition!
        // As stated earlier, `x` is always protected in the patterns we consider here.
        if (!compatible_with_protector(x_retag_perm)) continue; // precondition!
        for (const y_protected of Exhaustive_bool.exhaustive()) {
          // Finally `y` that is optionally protected must have a compatible permission.
          if (y_protected) {
            if (!compatible_with_protector(y_current_perm)) continue; // precondition!
          }
          v.push(new Pattern(xy_rel, x_retag_perm, y_current_perm, y_protected));
        }
      }
    }
    yield* v;
  },
};

// impl fmt::Display for Pattern
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:679 fmt
function display_Pattern(self: Pattern): string {
  const [x, y] = self.retag_permissions();
  let f = `${display_RelPosXY(self.xy_rel)}; `;
  f += `y: (${display_LocStateProt(y)}); `;
  f += `retag x (${display_LocStateProt(x)}); `;

  f += "<arbitrary code>; <spurious read x>;";
  return f;
}

class Pattern {
  constructor(
    /// The relative position of `x` and `y` at the beginning of the arbitrary
    /// code (i.e., just after `x` got created).
    /// Might change during the execution if said arbitrary code contains any `retag y`.
    readonly xy_rel: RelPosXY,
    /// Permission that `x` will be created as
    /// (always protected until a possible `ret x` in the second phase).
    /// This one should be initial (as per `is_initial`).
    readonly x_retag_perm: LocationState,
    /// Permission that `y` has at the beginning of the pattern.
    /// Can be any state, not necessarily initial
    /// (since `y` exists already before the pattern starts).
    /// This state might be reset during the execution if the opaque code
    /// contains any `retag y`, but only to an initial state this time.
    readonly y_current_perm: LocationState,
    /// Whether `y` starts with a protector.
    /// Might change if the opaque code contains any `ret y`.
    readonly y_protected: boolean,
  ) {}

  /// Return the permission that `y` starts as, and the permission that we
  /// will retag `x` with.
  /// This does not yet include a possible read-on-reborrow through `x`.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:694 retag_permissions
  retag_permissions(): [LocStateProt, LocStateProt] {
    const x = new LocStateProt(this.x_retag_perm, true);
    const y = new LocStateProt(this.y_current_perm, this.y_protected);
    return [x, y];
  }

  /// State that the pattern deterministically produces immediately after
  /// the retag of `x`.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:702 initial_state
  initial_state(): Result<LocStateProtPair, null> {
    const [x, y] = this.retag_permissions();
    const state = new LocStateProtPair(this.xy_rel, x, y);
    return state.retag_dependent_access("X");
  }
}

/// For each of the patterns described above, execute it once
/// as-is, and once with a spurious read inserted. Report any UB
/// in the target but not in the source.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree/tests.rs:713 test_all_patterns
test(
  "test_all_patterns",
  () => {
    let ok = 0;
    let err = 0;
    for (const pat of Exhaustive_Pattern.exhaustive()) {
      const initial_source = pat.initial_state();
      if (initial_source.$ !== "Ok") {
        // Failed to retag `x` in the source (e.g. `y` was protected Unique)
        continue;
      }
      // `x` must stay protected, but the function protecting `y` might return here
      for (const [final_source, opaque] of initial_source._0.all_states_reachable_via_opaque_code(/*X*/ NoRet, /*Y*/ AllowRet)) {
        // Both executions are identical up to here.
        // Now we do nothing in the source and in the target we do a spurious read.
        // Then we check if the resulting states are distinguishable.
        let distinguishable: string | undefined;
        {
          assert(final_source.x.prot, "assertion failed: final_source.x.prot");
          const spurious_read: TestAccess = { ptr: "X", kind: "Read" };
          const final_target = final_source.perform_test_access(spurious_read);
          if (final_target.$ === "Ok") {
            // Only after the spurious read has been executed can `x` lose its
            // protector.
            distinguishable = final_source.distinguishable(/*X*/ AllowRet, /*Y*/ AllowRet, final_target._0) ? display_LocStateProtPair(final_target._0) : undefined;
          } else {
            distinguishable = "UB";
          }
        }
        if (distinguishable !== undefined) {
          const final_target = distinguishable;
          console.error(`For pattern '${display_Pattern(pat)}', inserting a spurious read through x makes the final state '${final_target}' instead of '${display_LocStateProtPair(final_source)}' which is observable`);
          console.error(`  (arbitrary code instanciated with '${display_OpaqueCode(opaque)}')`);
          err += 1;
          // We found an instantiation of the opaque code that makes this Pattern
          // fail, we don't really need to check the rest.
          break;
        }
        ok += 1;
      }
    }
    if (err > 0) {
      panic(`Test failed after ${err}/${ok + err} patterns had UB in the target but not the source`);
    }
    // Not upstream: make sure the exploration ran at all.
    expect(ok).toBeGreaterThan(0);
  },
  600_000,
);

// `impl Exhaustive for LocStateProtPair` is unused upstream too, except that it is part of the module's API.
void Exhaustive_LocStateProtPair;
