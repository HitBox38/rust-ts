// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-sb` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into item.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
// PORT (decision miri-contract C5 amendment, lane interp-miri-reconcile): `Item(u64)` is a `number` (`Item._0`, typemap
// `fields`), not a bigint: the item is scanned on every access. Upstream packs the tag in bits 0-60, the permission in
// bits 61-62 and the protector flag in bit 63, which a double cannot hold exactly. The packing is private (`Item` derives
// only `PartialEq`/`Eq`/`Hash`; it is read through `tag()` / `perm()` / `protected()` / Debug), so the fill lane packs it
// below 2^53 with arithmetic (no 32-bit bitwise ops), e.g. tag in bits 0-49, permission in bits 50-51, protector in bit
// 52, with `TAG_MASK = 2^50 - 1` (BorTags are handed out sequentially from 1: a run never reaches 2^50). Record it there.
import { type BorTag } from "../mod.ts";
import { Item, type Permission } from "./item.gen.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Debug } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
export * from "./item.gen.ts";

// ---- manual impls the generated modules call (stand-ins until the fill lane ports them) ----
/** `impl Debug for Item` (src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:63): lane miri-sb. */
export const debug_Item: Debug<Item> = (_v, _f) => unported("miri::borrow_tracker::stacked_borrows::item::Item: Debug (src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:63; lane miri-sb)");

declare module "./item.gen.ts" {
  interface Item {
    // borrow_tracker/stacked_borrows/item.rs:40
    tag(): BorTag;
    // borrow_tracker/stacked_borrows/item.rs:45
    perm(): Permission;
    // borrow_tracker/stacked_borrows/item.rs:50
    protected(): boolean;
    // borrow_tracker/stacked_borrows/item.rs:55
    set_permission(perm: Permission): void;
  }
  namespace Item {
    // borrow_tracker/stacked_borrows/item.rs:24
    function new_(tag: BorTag, perm: Permission, protected_: boolean): Item;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Debug for Item (borrow_tracker/stacked_borrows/item.rs:63): fmt (:64)
// impl Permission (borrow_tracker/stacked_borrows/item.rs:83) [Permission is not a generated class: companion fns / hand type, lane decides]: to_bits (:89), from_bits (:98)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::stacked_borrows::item::Item", "src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs", "miri-sb", () => Item.prototype, ["tag", "perm", "protected", "set_permission"]);
stub_statics("miri::borrow_tracker::stacked_borrows::item::Item", "src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs", "miri-sb", () => Item, ["new"]);
