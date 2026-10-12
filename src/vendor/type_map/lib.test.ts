// Port of the `#[test]` in type-map 0.5.1 `src/lib.rs`.
import { expect, test } from "bun:test";
import { Entry, TypeId, TypeMap } from "./lib.ts";

// crate: type-map-0.5.1/src/lib.rs:404 test_type_map
test("test_type_map", () => {
  // #[derive(Debug, PartialEq)]
  class MyType {
    constructor(public _0: number) {}
  }
  const MyType_ID = TypeId.new<MyType>("MyType");

  // #[derive(Debug, PartialEq, Default)]
  class MyType2 {
    constructor(public _0: string) {}
    static default(): MyType2 {
      return new MyType2("");
    }
  }
  const MyType2_ID = TypeId.new<MyType2>("MyType2");
  const i32_ID = TypeId.new<number>("i32");
  const bool_ID = TypeId.new<boolean>("bool");

  const map = TypeMap.new();

  map.insert(i32_ID, 5);
  map.insert(MyType_ID, new MyType(10));

  expect(map.get(i32_ID)).toBe(5);
  expect(map.get_mut(i32_ID)).toBe(5);

  expect(map.remove(i32_ID)).toBe(5);
  expect(map.get(i32_ID)).toBeUndefined();

  expect(map.get(bool_ID)).toBeUndefined();
  expect(map.get(MyType_ID)).toEqual(new MyType(10));

  const entry = map.entry(MyType2_ID);

  const v = Entry.or_insert_with(entry, MyType2.default);

  v._0 = "Hello";

  expect(map.get(MyType2_ID)).toEqual(new MyType2("Hello"));
});
