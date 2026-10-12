// Port of the `#[cfg(test)] mod tests` in tinystr 0.8.4 `src/macros.rs`.
import { expect, test } from "bun:test";
import { tinystr } from "./macros.ts";

// crate: tinystr-0.8.4/src/macros.rs:23 test_macro_construction
test("test_macro_construction", () => {
  let s1 = tinystr(8, "foobar");
  expect(s1.deref()).toBe("foobar");

  s1 = tinystr(12, "foobarbaz");
  expect(s1.deref()).toBe("foobarbaz");
});
