// Unit tests of the Stacked Borrows `Item` packing (lane miri-sb). Upstream item.rs has no `#[cfg(test)]` tests; these
// check the port's repacking below 2^53 (decision 2026-11-01, item.ts header): round-trips at the tag / flag edges, the
// derived `PartialEq` on the packed word, `set_permission`, Debug, and the lowered `TAG_MASK` bound.
import { expect, test } from "bun:test";
import { type BorTag } from "../mod.ts";
import { debug_Item, Item, Item_eq, Permission, TAG_MASK } from "./item.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Unported } from "../../../std/panic.ts";

const T = (n: number) => n as BorTag;
const PERMS: Permission[] = ["Unique", "SharedReadWrite", "SharedReadOnly", "Disabled"];

test("TAG_MASK is 2^50 - 1 and every packed word stays a safe integer", () => {
  expect(TAG_MASK).toBe(2 ** 50 - 1);
  const top = Item.new(T(TAG_MASK), "Disabled", true);
  expect(Number.isSafeInteger(top._0)).toBe(true);
  expect(top._0).toBe(2 ** 53 - 1);
});

test("tag / perm / protected round-trip at the edges", () => {
  for (const tag of [1, 2, 3, 0xffff_ffff, 2 ** 32, 2 ** 49, TAG_MASK - 1, TAG_MASK]) {
    for (const perm of PERMS) {
      for (const prot of [false, true]) {
        const it = Item.new(T(tag), perm, prot);
        expect(it.tag()).toBe(T(tag));
        expect(it.perm()).toBe(perm);
        expect(it.protected()).toBe(prot);
      }
    }
  }
});

test("distinct (tag, perm, protected) give distinct words; equal ones equal words", () => {
  const seen = new Map<number, string>();
  for (const tag of [1, 2, TAG_MASK]) {
    for (const perm of PERMS) {
      for (const prot of [false, true]) {
        const w = Item.new(T(tag), perm, prot)._0;
        const k = `${tag}/${perm}/${prot}`;
        expect(seen.has(w)).toBe(false);
        seen.set(w, k);
        expect(Item_eq(Item.new(T(tag), perm, prot), Item.new(T(tag), perm, prot))).toBe(true);
      }
    }
  }
  expect(Item_eq(Item.new(T(5), "Unique", false), Item.new(T(5), "Unique", true))).toBe(false);
});

test("set_permission rewrites only the permission bits", () => {
  for (const tag of [1, TAG_MASK]) {
    for (const from of PERMS) {
      for (const to of PERMS) {
        for (const prot of [false, true]) {
          const it = Item.new(T(tag), from, prot);
          it.set_permission(to);
          expect(it.tag()).toBe(T(tag));
          expect(it.perm()).toBe(to);
          expect(it.protected()).toBe(prot);
          expect(Item_eq(it, Item.new(T(tag), to, prot))).toBe(true);
        }
      }
    }
  }
});

test("Permission bits are upstream's (to_bits / from_bits)", () => {
  expect(PERMS.map((p) => Permission.to_bits(p))).toEqual([0, 1, 2, 3]);
  expect([0, 1, 2, 3].map((b) => Permission.from_bits(b))).toEqual(PERMS);
  expect(() => Permission.from_bits(4)).toThrow();
});

test("Debug of Item is `[{perm:?} for {tag:?}]`", () => {
  expect(debug_Item(Item.new(T(7), "SharedReadOnly", false), PLAIN)).toBe("[SharedReadOnly for <7>]");
  expect(debug_Item(Item.new(T(1), "Unique", true), PLAIN)).toBe("[Unique for <1>]");
});

test("a tag past the lowered TAG_MASK stops unported (not a panic)", () => {
  expect(() => Item.new(T(TAG_MASK + 1), "Unique", false)).toThrow(Unported);
});
