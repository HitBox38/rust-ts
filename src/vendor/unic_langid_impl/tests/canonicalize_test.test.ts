// Port of unic-langid-impl 0.9.6 `tests/canonicalize_test.rs`.
import { expect, test } from "bun:test";
import { canonicalize } from "../lib.ts";

// crate: unic-langid-impl-0.9.6/tests/canonicalize_test.rs:3 assert_canonicalize
function assert_canonicalize(input: string, output: string): void {
  const r = canonicalize(input);
  if (r.$ === "Err") throw new Error("unwrap");
  expect(r._0).toBe(output);
}

// crate: unic-langid-impl-0.9.6/tests/canonicalize_test.rs:8 test_canonicalize
test("test_canonicalize", () => {
  assert_canonicalize("Pl", "pl");
  assert_canonicalize("eN-uS", "en-US");
  assert_canonicalize("ZH_hans_hK", "zh-Hans-HK");
  assert_canonicalize("en-scouse-fonipa", "en-fonipa-scouse");
});
