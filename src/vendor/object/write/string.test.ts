// Port of object 0.39.1 `src/write/string.rs` `mod tests`.
import { expect, test } from "bun:test";
import { StringTable } from "./string.ts";

const b = (s: string): Uint8Array => new TextEncoder().encode(s);

test("string_table", () => {
  const table = new StringTable();
  const id0 = table.add(b(""));
  const id1 = table.add(b("foo"));
  const id2 = table.add(b("bar"));
  const id3 = table.add(b("foobar"));

  const data: number[] = [];
  data.push(0);
  table.write(1, data);
  expect(data).toEqual([...b("\0foobar\0foo\0")]);

  expect(table.get_offset(id0)).toBe(11);
  expect(table.get_offset(id1)).toBe(8);
  expect(table.get_offset(id2)).toBe(4);
  expect(table.get_offset(id3)).toBe(1);
});

test("add dedups, and rejects a null byte", () => {
  const table = new StringTable();
  expect(table.add(b("x"))).toBe(table.add(b("x")));
  expect(() => table.add(b("a\0b"))).toThrow();
});
