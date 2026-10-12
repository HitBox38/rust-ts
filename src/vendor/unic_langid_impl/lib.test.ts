// Port of the `#[test]` in unic-langid-impl 0.9.6 `src/lib.rs`.
import { expect, test } from "bun:test";
import { utf8 } from "../../std/str.ts";
import { LanguageIdentifier } from "./lib.ts";

// crate: unic-langid-impl-0.9.6/src/lib.rs:536 invalid_subtag
test("invalid_subtag", () => {
  expect(LanguageIdentifier.from_bytes(utf8("en-ÁÁÁÁ")).$ === "Err").toBe(true);
});
