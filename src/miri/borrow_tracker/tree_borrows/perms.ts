// Port of src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into perms.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind } from "../mod.ts";
import { type IdempotentForeignAccess } from "./foreign_access_skipping.ts";
import { PermTransition, Permission, type PermissionPriv } from "./perms.gen.ts";
import { type AccessRelatedness } from "./tree.ts";
import { type WildcardAccessLevel } from "./wildcard.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { unported } from "../../../std/panic.ts";
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
  }
}

// borrow_tracker/tree_borrows/perms.rs:220 (pub(super))
export function perform_access(kind: AccessKind, rel_pos: AccessRelatedness, child: PermissionPriv, protected_: boolean): PermissionPriv | undefined {
  return unported("miri::borrow_tracker::tree_borrows::perms::perform_access (src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs:220; lane miri-tb-a)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl PartialOrd for PermissionPriv (borrow_tracker/tree_borrows/perms.rs:58): partial_cmp (:64)
// impl PermissionPriv (borrow_tracker/tree_borrows/perms.rs:91) [PermissionPriv is not a generated class: companion fns / hand type, lane decides]: is_initial (:93), compatible_with_protector (:99), strongest_idempotent_foreign_access (:107)
// impl fmt::Display for PermissionPriv (borrow_tracker/tree_borrows/perms.rs:424): fmt (:425)
// impl fmt::Display for PermTransition (borrow_tracker/tree_borrows/perms.rs:442): fmt (:443)
// impl fmt::Display for Permission (borrow_tracker/tree_borrows/perms.rs:448): fmt (:449)
// impl Permission (inline `mod diagnostics`, borrow_tracker/tree_borrows/perms.rs:454): short_name (:456)
// impl PermTransition (inline `mod diagnostics`, borrow_tracker/tree_borrows/perms.rs:472): summary (:475), is_relevant (:514), endpoint (:617)
// impl Exhaustive for PermissionPriv (borrow_tracker/tree_borrows/perms.rs:638): exhaustive (:639)
// impl Exhaustive for Permission (borrow_tracker/tree_borrows/perms.rs:648): exhaustive (:649)
// impl Exhaustive for AccessKind (borrow_tracker/tree_borrows/perms.rs:654): exhaustive (:655)
// impl Exhaustive for AccessRelatedness (borrow_tracker/tree_borrows/perms.rs:661): exhaustive (:662)
// fn child_read (borrow_tracker/tree_borrows/perms.rs:138)
// fn foreign_read (borrow_tracker/tree_borrows/perms.rs:149)
// fn child_write (borrow_tracker/tree_borrows/perms.rs:186)
// fn foreign_write (borrow_tracker/tree_borrows/perms.rs:203)
// fn all_transitions_idempotent (borrow_tracker/tree_borrows/perms.rs:671)
// fn foreign_read_is_noop_after_foreign_write (borrow_tracker/tree_borrows/perms.rs:700)
// fn permission_sifa_is_correct (borrow_tracker/tree_borrows/perms.rs:725)
// fn permissionpriv_partialord_is_reachability (borrow_tracker/tree_borrows/perms.rs:753)
// fn strongest_allowed_local_access (borrow_tracker/tree_borrows/perms.rs:800)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::perms::Permission", "src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs", "miri-tb-a", () => Permission.prototype, ["is_initial", "is_disabled", "is_frozen", "is_cell", "is_unique", "compatible_with_protector", "associated_access", "can_be_replaced_by_child", "strongest_idempotent_foreign_access", "strongest_allowed_local_access", "is_reserved_frz_with_conflicted"]);
stub_statics("miri::borrow_tracker::tree_borrows::perms::Permission", "src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs", "miri-tb-a", () => Permission, ["new_unique", "new_reserved_frz", "new_reserved_im", "new_frozen", "new_disabled", "new_cell", "perform_access"]);
stub_methods("miri::borrow_tracker::tree_borrows::perms::PermTransition", "src/tools/miri/src/borrow_tracker/tree_borrows/perms.rs", "miri-tb-a", () => PermTransition.prototype, ["is_possible", "is_noop", "applied", "produces_disabled"]);
