// Port of the `#[cfg(test)] mod tests` of unicode-normalization =0.1.25 `src/normalize.rs`.
import { expect, test } from "bun:test";
import { compose_hangul } from "./normalize.ts";

// Regression test from a bugfix where we were composing an LV_Syllable with
// T_BASE directly. (We should only compose an LV_Syllable with a character
// in the range `T_BASE + 1 ..= T_LAST`.)
// crate: unicode-normalization-0.1.25/src/normalize.rs:222 test_hangul_composition
test("test_hangul_composition", () => {
  expect(compose_hangul(0xc8e0, 0x11a7)).toBe(undefined);
});
