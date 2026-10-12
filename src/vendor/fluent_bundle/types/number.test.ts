// Port of the `#[cfg(test)] mod tests` in fluent-bundle 0.16.0 `src/types/number.rs`.
import { expect, test } from "bun:test";
import { FluentValue, FluentValue_from_num_ref } from "./mod.ts";

// crate: fluent-bundle-0.16.0/src/types/number.rs:254 value_from_copy_ref
test("value_from_copy_ref", () => {
  const x = 1; // 1i16
  const y = x;
  const z: FluentValue = FluentValue_from_num_ref(y);
  expect(FluentValue.eq(z, FluentValue.try_number("1"))).toBe(true);
});
