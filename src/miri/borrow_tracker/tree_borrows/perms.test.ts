// Port of `mod propagation_optimization_checks` of src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs (lane miri-tb-a;
// the `impl Exhaustive`s are in perms.ts, since tree/tests.rs needs them too), then lane checks: the whole state machine as
// a table written from upstream's match arms, and the diagnostic texts (which the oracle's error output contains).
import { expect, test } from "bun:test";
import { copy, Exhaustive_array2, Exhaustive_array3, Exhaustive_bool, Exhaustive_tuple2 } from "./exhaustive.ts";
import { IdempotentForeignAccess_discriminant } from "./foreign_access_skipping.ts";
import {
  clone_Permission,
  clone_PermissionPriv,
  debug_Permission,
  debug_PermissionPriv,
  display_Permission,
  display_PermissionPriv,
  display_PermTransition,
  Exhaustive_AccessKind,
  Exhaustive_AccessRelatedness,
  Exhaustive_Permission,
  Exhaustive_PermissionPriv,
  perform_access,
  Permission,
  Permission_eq,
  PermissionPriv,
  PermissionPriv_eq,
  PermTransition,
  PermTransition_eq,
} from "./perms.ts";
import { type TransitionError } from "./diagnostics.ts";
import { WildcardAccessLevel_discriminant } from "./wildcard.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, Panic, unwrap } from "../../../std/panic.ts";

const dbg = (p: PermissionPriv): string => debug_PermissionPriv(p, PLAIN);
const access_rel = Exhaustive_tuple2(Exhaustive_AccessKind, Exhaustive_AccessRelatedness, copy);
const bool_pair = Exhaustive_tuple2(Exhaustive_bool, Exhaustive_bool, copy);

// #[test]
// For any kind of access, if we do it twice the second should be a no-op.
// Even if the protector has disappeared.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:671 all_transitions_idempotent
test("all_transitions_idempotent", () => {
  // use transition::*;
  for (const old of Exhaustive_PermissionPriv.exhaustive()) {
    for (const [old_protected, new_protected] of bool_pair.exhaustive()) {
      // Protector can't appear out of nowhere: either the permission was
      // created with a protector (`old_protected = true`) and it then may
      // or may not lose it (`new_protected = false`, resp. `new_protected = true`),
      // or it didn't have one upon creation and never will
      // (`old_protected = new_protected = false`).
      // We thus eliminate from this test and all other tests
      // the case where the tag is initially unprotected and later becomes protected.
      if (!(old_protected || !new_protected)) continue; // precondition!(old_protected || !new_protected);
      if (old_protected) {
        if (!PermissionPriv.compatible_with_protector(old)) continue; // precondition!(old.compatible_with_protector());
      }
      for (const [access, rel_pos] of access_rel.exhaustive()) {
        const new_ = perform_access(access, rel_pos, old, old_protected);
        if (new_ !== undefined) {
          assert_eq(new_, unwrap(perform_access(access, rel_pos, new_, new_protected)), dbg, PermissionPriv_eq);
        }
      }
    }
  }
});

// #[test]
// #[rustfmt::skip]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:700 foreign_read_is_noop_after_foreign_write
test("foreign_read_is_noop_after_foreign_write", () => {
  // use transition::*;
  const old_access = "Write";
  const new_access = "Read";
  for (const old of Exhaustive_PermissionPriv.exhaustive()) {
    for (const [old_protected, new_protected] of Exhaustive_array2(Exhaustive_bool, copy).exhaustive()) {
      if (!(old_protected || !new_protected)) continue; // precondition!(old_protected || !new_protected);
      if (old_protected) {
        if (!PermissionPriv.compatible_with_protector(old)) continue; // precondition!(old.compatible_with_protector());
      }
      for (const rel_pos of Exhaustive_AccessRelatedness.exhaustive()) {
        if (!(rel_pos === "ForeignAccess")) continue; // precondition!(rel_pos.is_foreign());
        const new_ = perform_access(old_access, rel_pos, old, old_protected);
        if (new_ !== undefined) {
          assert_eq(new_, unwrap(perform_access(new_access, rel_pos, new_, new_protected)), dbg, PermissionPriv_eq);
        }
      }
    }
  }
});

// #[test]
// #[rustfmt::skip]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:725 permission_sifa_is_correct
test("permission_sifa_is_correct", () => {
  const D = IdempotentForeignAccess_discriminant;
  // Tests that `strongest_idempotent_foreign_access` is correct. See `foreign_access_skipping.rs`.
  for (const perm of Exhaustive_PermissionPriv.exhaustive()) {
    // Assert that adding a protector makes it less idempotent.
    if (PermissionPriv.compatible_with_protector(perm)) {
      assert(
        D[PermissionPriv.strongest_idempotent_foreign_access(perm, true)] <= D[PermissionPriv.strongest_idempotent_foreign_access(perm, false)],
        "assertion failed: perm.strongest_idempotent_foreign_access(true) <= perm.strongest_idempotent_foreign_access(false)",
      );
    }
    for (const prot of Exhaustive_bool.exhaustive()) {
      if (prot) {
        if (!PermissionPriv.compatible_with_protector(perm)) continue; // precondition!(perm.compatible_with_protector());
      }
      const access = PermissionPriv.strongest_idempotent_foreign_access(perm, prot);
      // We now assert it is idempotent, and never causes UB.
      // First, if the SIFA includes foreign reads, assert it is idempotent under foreign reads.
      if (D[access] >= D.Read) {
        assert_eq(perm, unwrap(perform_access("Read", "ForeignAccess", perm, prot)), dbg, PermissionPriv_eq);
      }
      // Then, if the SIFA includes foreign writes, assert it is idempotent under foreign writes.
      if (D[access] >= D.Write) {
        assert_eq(perm, unwrap(perform_access("Write", "ForeignAccess", perm, prot)), dbg, PermissionPriv_eq);
      }
    }
  }
});

// #[test]
// Check that all transitions are consistent with the order on PermissionPriv,
// i.e. Reserved -> Unique -> Frozen -> Disabled
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:753 permissionpriv_partialord_is_reachability
test("permissionpriv_partialord_is_reachability", () => {
  // PORT: `FxHashSet<(PermissionPriv, PermissionPriv)>`: a set of the pairs' Debug strings (the set is only probed).
  const key = (a: PermissionPriv, b: PermissionPriv): string => `${dbg(a)} ${dbg(b)}`;
  const reach = new Set<string>();
  // One-step transitions + reflexivity
  for (const start of Exhaustive_PermissionPriv.exhaustive()) {
    reach.add(key(start, start));
    for (const [access, rel] of access_rel.exhaustive()) {
      for (const prot of Exhaustive_bool.exhaustive()) {
        if (prot) {
          if (!PermissionPriv.compatible_with_protector(start)) continue; // precondition!(start.compatible_with_protector());
        }
        const end = perform_access(access, rel, start, prot);
        if (end !== undefined) {
          reach.add(key(start, end));
        }
      }
    }
  }
  // Transitive closure
  let finished = false;
  while (!finished) {
    finished = true;
    for (const [start, mid, end] of Exhaustive_array3(Exhaustive_PermissionPriv, clone_PermissionPriv).exhaustive()) {
      if (reach.has(key(start, mid)) && reach.has(key(mid, end)) && !reach.has(key(start, end))) {
        finished = false;
        reach.add(key(start, end));
      }
    }
  }
  // Check that it matches `<`
  for (const [p1, p2] of Exhaustive_array2(Exhaustive_PermissionPriv, clone_PermissionPriv).exhaustive()) {
    const c = PermissionPriv.partial_cmp(p1, p2);
    const le12 = c === -1 || c === 0;
    const reach12 = reach.has(key(p1, p2));
    assert(
      le12 === reach12,
      () => `\`${display_PermissionPriv(p1)} reach ${display_PermissionPriv(p2)}\` (${reach12}) does not match \`${display_PermissionPriv(p1)} <= ${display_PermissionPriv(p2)}\` (${le12})`,
    );
  }
});

/// Checks that  `strongest_allowed_child_access` correctly
/// represents which transitions are possible.
// #[test]
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:800 strongest_allowed_local_access
test("strongest_allowed_local_access", () => {
  const W = WildcardAccessLevel_discriminant;
  for (const [permission, protected_] of Exhaustive_tuple2(Exhaustive_Permission, Exhaustive_bool, clone_Permission).exhaustive()) {
    const strongest_local_access = permission.strongest_allowed_local_access(protected_);

    const is_read_valid = Permission.perform_access("Read", "LocalAccess", permission, protected_) !== undefined;

    const is_write_valid = Permission.perform_access("Write", "LocalAccess", permission, protected_) !== undefined;

    expect(is_read_valid).toBe(W[strongest_local_access] >= W.Read);
    expect(is_write_valid).toBe(W[strongest_local_access] >= W.Write);
  }
});

// ---- lane checks ----

const Cell = new Permission(PermissionPriv.Cell);
const ResF = new Permission({ $: "ReservedFrz", conflicted: false });
const ResC = new Permission({ $: "ReservedFrz", conflicted: true });
const RIM = new Permission(PermissionPriv.ReservedIM);
const Unq = new Permission(PermissionPriv.Unique);
const Frz = new Permission(PermissionPriv.Frozen);
const Dis = new Permission(PermissionPriv.Disabled);

/** One row per start state: the result of (child read, foreign read, child write, foreign write); `UB` is no transition. */
function check_table(protected_: boolean, rows: [Permission, string, string, string, string][]): void {
  for (const [start, cr, fr, cw, fw] of rows) {
    const got = (kind: "Read" | "Write", rel: "LocalAccess" | "ForeignAccess"): string => {
      const t = Permission.perform_access(kind, rel, start, protected_);
      return t === undefined ? "UB" : unwrap(t.applied(start)).short_name().trim();
    };
    expect([start.short_name(), got("Read", "LocalAccess"), got("Read", "ForeignAccess"), got("Write", "LocalAccess"), got("Write", "ForeignAccess")]).toEqual([
      start.short_name(),
      cr,
      fr,
      cw,
      fw,
    ]);
  }
}

test("the state machine, unprotected", () => {
  check_table(false, [
    //                 child read, foreign read, child write, foreign write
    [Cell, "Cel", "Cel", "Cel", "Cel"],
    [ResF, "Res", "Res", "Unq", "Dis"],
    [ResC, "ResC", "ResC", "Unq", "Dis"],
    [RIM, "ReIM", "ReIM", "Unq", "ReIM"],
    [Unq, "Unq", "Frz", "Unq", "Dis"],
    [Frz, "Frz", "Frz", "UB", "Dis"],
    [Dis, "UB", "Dis", "UB", "Dis"],
  ]);
});

test("the state machine, protected", () => {
  check_table(true, [
    //                 child read, foreign read, child write, foreign write
    [Cell, "Cel", "Cel", "Cel", "Cel"],
    [ResF, "Res", "ResC", "Unq", "Dis"],
    [ResC, "ResC", "ResC", "UB", "Dis"],
    [Unq, "Unq", "Dis", "Unq", "Dis"],
    [Frz, "Frz", "Frz", "UB", "Dis"],
    [Dis, "UB", "Dis", "UB", "Dis"],
  ]);
  // A protected `ReservedIM` cannot exist: the foreign accesses assert it, the child accesses do not look.
  for (const kind of ["Read", "Write"] as const) {
    let err: unknown;
    try {
      Permission.perform_access(kind, "ForeignAccess", RIM, true);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Panic);
    expect((err as Panic).message).toBe("assertion failed: !protected");
  }
  expect(unwrap(Permission.perform_access("Read", "LocalAccess", RIM, true)).endpoint().short_name()).toBe("ReIM");
  expect(unwrap(Permission.perform_access("Write", "LocalAccess", RIM, true)).endpoint().short_name()).toBe("Unq ");
});

test("the constructors and predicates of Permission", () => {
  expect(Permission_eq(Permission.new_unique(), Unq)).toBe(true);
  expect(Permission_eq(Permission.new_reserved_frz(), ResF)).toBe(true);
  expect(Permission_eq(Permission.new_reserved_frz(), ResC)).toBe(false);
  expect(Permission_eq(Permission.new_reserved_im(), RIM)).toBe(true);
  expect(Permission_eq(Permission.new_frozen(), Frz)).toBe(true);
  expect(Permission_eq(Permission.new_disabled(), Dis)).toBe(true);
  expect(Permission_eq(Permission.new_cell(), Cell)).toBe(true);
  expect([Cell, ResF, ResC, RIM, Unq, Frz, Dis].map((p) => p.is_initial())).toEqual([true, true, false, true, true, true, false]);
  expect([Cell, ResF, RIM, Unq, Frz, Dis].map((p) => p.compatible_with_protector())).toEqual([false, true, false, true, true, true]);
  expect(Dis.is_disabled() && Frz.is_frozen() && Cell.is_cell() && Unq.is_unique()).toBe(true);
  expect(Unq.is_disabled() || Unq.is_frozen() || Unq.is_cell() || Dis.is_unique()).toBe(false);
  expect([Cell, ResF, RIM, Unq, Frz, Dis].map((p) => p.associated_access())).toEqual([undefined, "Read", "Read", "Write", "Read", "Read"]);
  expect(ResF.is_reserved_frz_with_conflicted(false)).toBe(true);
  expect(ResF.is_reserved_frz_with_conflicted(true)).toBe(false);
  expect(ResC.is_reserved_frz_with_conflicted(true)).toBe(true);
  expect(Unq.is_reserved_frz_with_conflicted(false)).toBe(false);
});

test("can_be_replaced_by_child, from upstream's arms", () => {
  const order = [Cell, RIM, ResF, ResC, Unq, Frz, Dis];
  const table: Record<string, string> = {
    // parent: Cel ReIM Res ResC Unq Frz Dis as children (1 = replaceable)
    "Cel ": "1111111",
    ReIM: "0111111",
    "Res ": "0011111",
    ResC: "0011111",
    "Unq ": "0000111",
    "Frz ": "0000011",
    "Dis ": "0000001",
  };
  for (const parent of order) {
    const got = order.map((child) => (parent.can_be_replaced_by_child(child) ? "1" : "0")).join("");
    expect(`${parent.short_name()}:${got}`).toBe(`${parent.short_name()}:${table[parent.short_name()]}`);
  }
});

test("strongest_idempotent_foreign_access, from upstream's arms", () => {
  const sifa = (p: Permission, prot: boolean) => p.strongest_idempotent_foreign_access(prot);
  expect([Cell, ResF, ResC, RIM, Unq, Frz, Dis].map((p) => sifa(p, false))).toEqual(["Write", "Read", "Read", "Write", "None", "Read", "Write"]);
  expect([Cell, ResF, ResC, Unq, Frz, Dis].map((p) => sifa(p, true))).toEqual(["Write", "None", "Read", "None", "Read", "Write"]);
  let err: unknown;
  try {
    sifa(RIM, true);
  } catch (e) {
    err = e;
  }
  expect((err as Panic).message).toBe("internal error: entered unreachable code: Protected ReservedIM should not exist!");
});

test("Display and short_name", () => {
  expect([Cell, ResF, ResC, RIM, Unq, Frz, Dis].map(display_Permission)).toEqual([
    "Cell",
    "Reserved",
    "Reserved (conflicted)",
    "Reserved (interior mutable)",
    "Unique",
    "Frozen",
    "Disabled",
  ]);
  const names = [Cell, ResF, ResC, RIM, Unq, Frz, Dis].map((p) => p.short_name());
  expect(names).toEqual(["Cel ", "Res ", "ResC", "ReIM", "Unq ", "Frz ", "Dis "]);
  // "uniformly 3 letters for nice alignment", plus the separator: `DisplayFmtPermission.uninit` is `----`.
  for (const n of names) expect(n.length).toBe(4);
  expect(display_PermTransition(new PermTransition(ResF.inner, Unq.inner))).toBe("from Reserved to Unique");
  expect(debug_Permission(ResC, PLAIN)).toBe("Permission { inner: ReservedFrz { conflicted: true } }");
});

const T = (from: Permission, to: Permission) => new PermTransition(from.inner, to.inner);

test("PermTransition: is_possible, is_noop, applied, produces_disabled, endpoint, eq", () => {
  expect(T(ResF, Unq).is_possible()).toBe(true);
  expect(T(Unq, ResF).is_possible()).toBe(false);
  expect(T(RIM, ResF).is_possible()).toBe(false); // incomparable
  expect(T(Cell, Unq).is_possible()).toBe(false); // incomparable
  expect(T(Cell, Cell).is_possible()).toBe(true);
  expect(T(ResF, ResF).is_noop()).toBe(true);
  expect(T(ResF, ResC).is_noop()).toBe(false);
  expect(T(ResF, Unq).applied(ResF)!.is_unique()).toBe(true);
  expect(T(ResF, Unq).applied(ResC)).toBeUndefined();
  expect(T(Frz, Dis).produces_disabled()).toBe(true);
  expect(T(ResF, Frz).produces_disabled()).toBe(false);
  expect(T(ResF, Frz).endpoint().is_frozen()).toBe(true);
  expect(PermTransition_eq(T(ResF, Unq), T(ResF, Unq))).toBe(true);
  expect(PermTransition_eq(T(ResF, Unq), T(ResC, Unq))).toBe(false);
});

test("PermTransition::summary", () => {
  expect(T(ResF, Unq).summary()).toBe("the first write to a 2-phase borrowed mutable reference");
  expect(T(Unq, Frz).summary()).toBe("a loss of write permissions");
  expect(T(ResF, ResC).summary()).toBe("a temporary loss of write permissions until function exit");
  expect(T(Frz, Dis).summary()).toBe("a loss of read permissions");
  expect(T(Unq, Dis).summary()).toBe("a loss of read and write permissions");
  expect(T(ResF, Dis).summary()).toBe("a loss of read and write permissions");
  // The asserts come first.
  expect(() => T(Unq, ResF).summary()).toThrow("assertion failed: self.is_possible()");
  expect(() => T(Unq, Unq).summary()).toThrow("assertion failed: !self.is_noop()");
});

test("PermTransition::is_relevant", () => {
  const child: (p: Permission) => TransitionError = (p) => ({ $: "ChildAccessForbidden", _0: p });
  const prot: (p: Permission) => TransitionError = (p) => ({ $: "ProtectedDisabled", _0: p });
  const dealloc: TransitionError = { $: "ProtectedDealloc" };

  // A noop never is, whatever the error.
  expect(T(Unq, Unq).is_relevant(child(Unq))).toBe(false);
  expect(T(ResF, Unq).is_relevant(dealloc)).toBe(false);

  expect(T(Unq, Frz).is_relevant(child(Frz))).toBe(true);
  expect(T(ResF, Unq).is_relevant(child(Frz))).toBe(true);
  expect(T(Frz, Dis).is_relevant(child(Dis))).toBe(true);
  expect(T(ResF, ResC).is_relevant(child(ResC))).toBe(true);
  expect(T(ResF, ResC).is_relevant(child(Dis))).toBe(false);
  expect(T(ResF, Unq).is_relevant(child(Dis))).toBe(false);
  expect(T(Unq, Frz).is_relevant(child(Dis))).toBe(false);
  expect(T(ResF, ResC).is_relevant(child(Frz))).toBe(false);
  expect(() => T(ResF, Unq).is_relevant(child(Unq))).toThrow("this permission cannot cause an error");
  expect(() => T(ResF, Unq).is_relevant(child(ResF))).toThrow("this permission cannot cause an error");
  expect(() => T(ResF, Unq).is_relevant(child(Cell))).toThrow("this permission cannot cause an error");
  expect(() => T(Frz, Dis).is_relevant(child(Frz))).toThrow("permissions between self and err must be increasing");
  expect(() => T(ResF, Unq).is_relevant(child(ResC))).toThrow("permissions between self and err must be increasing");

  expect(T(ResF, Unq).is_relevant(prot(Unq))).toBe(true);
  expect(T(Unq, Frz).is_relevant(prot(Frz))).toBe(true);
  expect(T(ResF, ResC).is_relevant(prot(ResC))).toBe(true);
  expect(T(ResF, Unq).is_relevant(prot(Frz))).toBe(false);
  expect(T(ResF, ResC).is_relevant(prot(Unq))).toBe(false);
  expect(T(ResF, ResC).is_relevant(prot(Frz))).toBe(false);
  expect(() => T(ResF, Unq).is_relevant(prot(Dis))).toThrow("should not itself be Disabled in the first place");
  expect(() => T(Frz, Dis).is_relevant(prot(Unq))).toThrow("permissions between self and err must be increasing");
  expect(() => T(ResF, Unq).is_relevant(prot(ResF))).toThrow("permissions between self and err must be increasing");

  // The assert comes first.
  expect(() => T(Unq, ResF).is_relevant(dealloc)).toThrow("assertion failed: self.is_possible()");
});
