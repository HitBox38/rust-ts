import { expect, test } from "bun:test";
import { field_mut, replace_in_place } from "./mut_ref.ts";

test("field_mut reads and writes the slot", () => {
  const o = { a: 1, b: 2 };
  const r = field_mut(o, "a");
  r.value = 5;
  expect(o).toEqual({ a: 5, b: 2 });
  o.a = 7;
  expect(r.value).toBe(7);
});

test("replace_in_place: same identity, other variant's fields removed, prototype taken over", () => {
  class A {
    constructor(public x: number) {}
  }
  class B {
    constructor(public y: string) {}
  }
  type E = { $: "Foo"; _0: number } | { $: "Bar"; a: number; b: number };
  const dst = { $: "Bar", a: 1, b: 2 } as E;
  replace_in_place<E>(dst, { $: "Foo", _0: 3 });
  expect(dst).toEqual({ $: "Foo", _0: 3 });
  expect(Object.keys(dst)).toEqual(["$", "_0"]);
  const a = new A(1) as A | B;
  replace_in_place<A | B>(a, new B("z"));
  expect(a).toBeInstanceOf(B);
  expect((a as unknown as B).y).toBe("z");
  const same = { $: "Foo", _0: 1 } as E;
  replace_in_place(same, same);
  expect(same).toEqual({ $: "Foo", _0: 1 });
});
