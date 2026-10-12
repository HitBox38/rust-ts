// Port of the `#[cfg(test)] mod tests` in fluent-bundle 0.16.0 `src/args.rs`.
import { expect, test } from "bun:test";
import { FluentArgs } from "./args.ts";
import { FluentValue, FluentValue_from_num } from "./types/mod.ts";
import "./lib.ts";

// crate: fluent-bundle-0.16.0/src/args.rs:139 replace_existing_arguments
test("replace_existing_arguments", () => {
  const args = FluentArgs.new();

  args.set("name", FluentValue.from_str("John"));
  args.set("emailCount", FluentValue_from_num(5));
  expect(args._0.length).toBe(2);
  expect(FluentValue.eq(args.get("name")!, { $: "String", _0: "John" })).toBe(true);
  expect(FluentValue.eq(args.get("emailCount")!, FluentValue.try_number("5"))).toBe(true);

  args.set("name", FluentValue.from_str("Jane"));
  args.set("emailCount", FluentValue_from_num(7));
  expect(args._0.length).toBe(2);
  expect(FluentValue.eq(args.get("name")!, { $: "String", _0: "Jane" })).toBe(true);
  expect(FluentValue.eq(args.get("emailCount")!, FluentValue.try_number("7"))).toBe(true);
});

test("keys are kept sorted by str Ord (UTF-8 byte order)", () => {
  const args = FluentArgs.new();
  for (const k of ["b", "\u{ff61}", "a", "\u{1f600}", "B", ""]) args.set(k, FluentValue.from_str(k));
  // U+FF61 < U+1F600 in code point / UTF-8 order (JS `<` on UTF-16 would put the emoji first).
  expect(args._0.map(([k]) => k)).toEqual(["", "B", "a", "b", "\u{ff61}", "\u{1f600}"]);
});
