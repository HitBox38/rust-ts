import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Unported } from "../std/panic.ts";
import { test_scratch_dir } from "./test_scratch.ts";
import { cc_or_unported } from "./tinycc.ts";

const DIR = test_scratch_dir("tinycc");

// docs/reviews/pm-cross-thread.md N6: a TinyCC failure is one `unported` line, not an uncaught `Error`.
test("cc_or_unported: a compile error is one Unported line naming the helper", () => {
  const src = join(DIR, "bad.c");
  writeFileSync(src, "int f(void) { return x; }\n");
  let caught: unknown;
  try {
    cc_or_unported("rust_ts::test (bad.c)", { source: src, symbols: { f: { args: [], returns: "i32" } } });
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Unported);
  const what = (caught as Unported).what;
  expect(what.startsWith("rust_ts::test (bad.c) (TinyCC failed: ")).toBe(true);
  expect(what).toContain("'x' undeclared");
  expect(what).not.toContain("\n");
});

test("cc_or_unported: a good source compiles", () => {
  const src = join(DIR, "good.c");
  writeFileSync(src, "int f(void) { return 7; }\n");
  const lib = cc_or_unported("rust_ts::test (good.c)", { source: src, symbols: { f: { args: [], returns: "i32" } } });
  expect((lib.symbols.f as () => number)()).toBe(7);
});
