// compiler/rustc_abi/src/tests.rs. PORT: only `align_constants` is ported; the `WrappingRange` tests wait for
// wrapping_range.rs (not ported).
import { expect, test } from "bun:test";
import { Align, Align_eq } from "./lib.ts";

const unwrap = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
  if (r.$ === "Err") throw new Error("called `Result::unwrap()` on an `Err` value");
  return r._0;
};

test("align_constants", () => {
  expect(Align_eq(Align.ONE, unwrap(Align.from_bytes(1)))).toBe(true);
  expect(Align_eq(Align.EIGHT, unwrap(Align.from_bytes(8)))).toBe(true);
});
