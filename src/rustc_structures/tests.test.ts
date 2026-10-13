// Port of compiler/rustc_structures/src/tests.rs
import { expect, test } from "bun:test";
import { SanitizerSet } from "./lib.ts";

// rustc: compiler/rustc_structures/src/tests.rs:4 test_combine_with_defaults_no_conflict
test("test_combine_with_defaults_no_conflict", () => {
  const defaults = SanitizerSet.SHADOWCALLSTACK;
  const explicit = SanitizerSet.ADDRESS;
  expect(SanitizerSet.combine_with_defaults(explicit, defaults)).toBe(SanitizerSet.union(SanitizerSet.ADDRESS, SanitizerSet.SHADOWCALLSTACK));
});

// rustc: compiler/rustc_structures/src/tests.rs:14 test_combine_with_defaults_safestack_address_conflict
test("test_combine_with_defaults_safestack_address_conflict", () => {
  const defaults = SanitizerSet.SAFESTACK;
  const explicit = SanitizerSet.ADDRESS;
  // SafeStack should be implicitly disabled when Address is explicitly provided.
  expect(SanitizerSet.combine_with_defaults(explicit, defaults)).toBe(SanitizerSet.ADDRESS);
});

// rustc: compiler/rustc_structures/src/tests.rs:22 test_combine_with_defaults_empty_explicit
test("test_combine_with_defaults_empty_explicit", () => {
  const defaults = SanitizerSet.SAFESTACK;
  const explicit = SanitizerSet.empty();
  expect(SanitizerSet.combine_with_defaults(explicit, defaults)).toBe(SanitizerSet.SAFESTACK);
});

// rustc: compiler/rustc_structures/src/tests.rs:29 test_combine_with_defaults_safestack_cfi
test("test_combine_with_defaults_safestack_cfi", () => {
  const defaults = SanitizerSet.SAFESTACK;
  const explicit = SanitizerSet.CFI;
  expect(SanitizerSet.combine_with_defaults(explicit, defaults)).toBe(SanitizerSet.union(SanitizerSet.CFI, SanitizerSet.SAFESTACK));
});
