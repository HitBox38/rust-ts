// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-sb` (plan-m6
// wave 36). Its types are generated into item.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (decision 2026-11-01, interp-miri-reconcile review N2; miri-contract C5 amendment): `Item(u64)` is a `number`
// (`Item._0`, typemap `fields`), not a bigint: the item is scanned on every access. Upstream packs the tag in bits 0-60,
// the permission in bits 61-62 and the protector flag in bit 63, which a double cannot hold exactly. The packing is private
// (`Item` derives only `PartialEq`/`Eq`/`Hash`; it is read through `tag()` / `perm()` / `protected()` / Debug), so it is
// repacked below 2^53 with arithmetic (no 32-bit bitwise ops): the tag in bits 0-49 (`TAG_MASK = 2^50 - 1`), the
// permission in bits 50-51, the protector flag in bit 52. Equal items have equal `_0` exactly as upstream (the map is a
// bijection on the reachable values), so the derived `PartialEq` is `a._0 === b._0`. `Item::new`'s
// `assert!(tag.get() <= TAG_MASK)` checks the lowered bound and stops `unported` (not a panic) past it: BorTags are handed
// out sequentially from 1, so no real run reaches 2^50.
// PORT: `Item` is `Copy`; the generated class is a mutable object (`set_permission` is `&mut self`), so every Rust copy
// that stays live next to its source is `clone_Item(v)` (PORTING §8), and nothing aliases one `Item` from two places, except
// the cache's slots after `Stack::new` (stack.ts).
import { BorTag, debug_BorTag } from "../mod.ts";
import * as gen from "./item.gen.ts";
import { Item } from "./item.gen.ts";
import { debug_Permission } from "./item.gen.ts";
import { type Debug } from "../../../std/fmt.ts";
import { unported, unreachable } from "../../../std/panic.ts";
export * from "./item.gen.ts";

// An Item contains 3 bitfields:
// * Bits 0-60 store a BorTag (61 bits).
// * Bits 61-62 store a Permission (2 bits).
// * Bit 63 stores a flag which indicates if we might have a protector (1 bit).
//   This is purely an optimization: if the bit is set, the tag *might* be
//   in `protected_tags`, but if the bit is not set then the tag is definitely
//   not in `protected_tags`.
// PORT: repacked below 2^53 (header): bits 0-49 tag, 50-51 permission, 52 protector; masks and shifts are the powers of
// two the arithmetic divides / multiplies by (`x & TAG_MASK` = `x % PERM_UNIT`, `x << PERM_SHIFT` = `x * PERM_UNIT`).
// const TAG_MASK: u64 = u64::MAX >> 3;
// const PERM_MASK: u64 = 0x3 << 61;
// const PROTECTED_MASK: u64 = 0x1 << 63;
// const PERM_SHIFT: u64 = 61;
// const PROTECTED_SHIFT: u64 = 63;
/** `1 << PERM_SHIFT` (PERM_SHIFT = 50). */
const PERM_UNIT = 2 ** 50;
/** `1 << PROTECTED_SHIFT` (PROTECTED_SHIFT = 52). */
const PROTECTED_UNIT = 2 ** 52;
/** The largest tag an item can hold (`TAG_MASK`). */
export const TAG_MASK = PERM_UNIT - 1;

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

// impl Item
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:24 new
(Item as unknown as { new: (tag: BorTag, perm: Permission, protected_: boolean) => Item }).new = function (tag: BorTag, perm: Permission, protected_: boolean): Item {
  // assert!(tag.get() <= TAG_MASK);
  if (!(BorTag.get(tag) <= TAG_MASK)) {
    // PORT (header): the lowered bound; upstream's is 2^61 - 1.
    return unported("miri::borrow_tracker::stacked_borrows::item::Item::new: tag beyond the port's packed TAG_MASK (2^50 - 1)");
  }
  const packed_tag = BorTag.get(tag);
  const packed_perm = Permission.to_bits(perm) * PERM_UNIT;
  const packed_protected = (protected_ ? 1 : 0) * PROTECTED_UNIT;

  const new_ = new Item(packed_tag + packed_perm + packed_protected);

  // debug_assert!(new.tag() == tag);
  // debug_assert!(new.perm() == perm);
  // debug_assert!(new.protected() == protected);

  return new_;
};

/// The pointers the permission is granted to.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:40 tag
Item.prototype.tag = function (this: Item): BorTag {
  // BorTag::new(self.0 & TAG_MASK).unwrap()
  return BorTag.new(this._0 % PERM_UNIT)!;
};

/// The permission this item grants.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:45 perm
Item.prototype.perm = function (this: Item): Permission {
  // Permission::from_bits((self.0 & PERM_MASK) >> PERM_SHIFT)
  return Permission.from_bits(Math.floor(this._0 / PERM_UNIT) % 4);
};

/// Whether or not there is a protector for this tag
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:50 protected
Item.prototype.protected = function (this: Item): boolean {
  // self.0 & PROTECTED_MASK > 0
  return this._0 >= PROTECTED_UNIT;
};

/// Set the Permission stored in this Item
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:55 set_permission
Item.prototype.set_permission = function (this: Item, perm: Permission): void {
  // Clear the current set permission
  // self.0 &= !PERM_MASK;
  this._0 -= (Math.floor(this._0 / PERM_UNIT) % 4) * PERM_UNIT;
  // Write Permission::Disabled to the Permission bits
  // self.0 |= perm.to_bits() << PERM_SHIFT;
  this._0 += Permission.to_bits(perm) * PERM_UNIT;
};

/** `#[derive(PartialEq)]` of `Item`: the packed word (header). */
export function Item_eq(a: Item, b: Item): boolean {
  return a._0 === b._0;
}

// impl fmt::Debug for Item
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:64 fmt
export const debug_Item: Debug<Item> = (self, f) => {
  // write!(f, "[{:?} for {:?}]", self.perm(), self.tag())
  return `[${debug_Permission(self.perm(), f)} for ${debug_BorTag(self.tag(), f)}]`;
};

/** PORT: the methods of `impl Permission` on the generated companion (PORTING §8). `grants` (mod.rs:183) is
 *  stacked_borrows/mod.ts's `Permission_grants` (it is another file's impl; C10 keeps it off this companion). */
export interface Permission_methods {
  readonly UNIQUE: number;
  readonly SHARED_READ_WRITE: number;
  readonly SHARED_READ_ONLY: number;
  readonly DISABLED: number;
  to_bits(self: Permission): number;
  from_bits(perm: number): Permission;
}
export type Permission = gen.Permission;
export const Permission = gen.Permission as typeof gen.Permission & Permission_methods;

// impl Permission
Object.assign(Permission, {
  UNIQUE: 0,
  SHARED_READ_WRITE: 1,
  SHARED_READ_ONLY: 2,
  DISABLED: 3,
});

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:89 to_bits
Permission.to_bits = function (self: Permission): number {
  switch (self) {
    case "Unique":
      return Permission.UNIQUE;
    case "SharedReadWrite":
      return Permission.SHARED_READ_WRITE;
    case "SharedReadOnly":
      return Permission.SHARED_READ_ONLY;
    case "Disabled":
      return Permission.DISABLED;
  }
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/item.rs:98 from_bits
Permission.from_bits = function (perm: number): Permission {
  switch (perm) {
    case Permission.UNIQUE:
      return "Unique";
    case Permission.SHARED_READ_WRITE:
      return "SharedReadWrite";
    case Permission.SHARED_READ_ONLY:
      return "SharedReadOnly";
    case Permission.DISABLED:
      return "Disabled";
    default:
      return unreachable();
  }
};
