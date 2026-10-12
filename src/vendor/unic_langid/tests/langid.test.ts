// Port of unic-langid 0.9.6 `tests/langid.rs` (with the `unic-langid-macros` feature, as rustc builds it).
import { expect, test } from "bun:test";
import { unwrap_result } from "../../../std/result.ts";
import { display_LanguageIdentifier, langid, langid_slice, langids, LanguageIdentifier } from "../lib.ts";

// crate: unic-langid-0.9.6/tests/langid.rs:6 basic_test
test("basic_test", () => {
  const loc = unwrap_result(LanguageIdentifier.from_str("en-US"));
  expect(display_LanguageIdentifier(loc)).toBe("en-US");
});

// crate: unic-langid-0.9.6/tests/langid.rs:13 langid_macro_test
test("langid_macro_test", () => {
  const loc = langid("en-US");
  expect(display_LanguageIdentifier(loc)).toBe("en-US");

  // ensure it can be used in a const context
  langid("en-US");
});

// crate: unic-langid-0.9.6/tests/langid.rs:23 langids_macro_test
test("langids_macro_test", () => {
  const ls = langids("en-US", "pl", "de-AT", "Pl-Latn-PL");
  expect(ls.length).toBe(4);
  expect(ls[3]!.language.as_str()).toBe("pl");

  // check trailing comma
  langids("en-US", "pl");
});

// crate: unic-langid-0.9.6/tests/langid.rs:34 langid_slice_macro_test
test("langid_slice_macro_test", () => {
  const ls = langids("en-US", "pl", "de-AT", "Pl-Latn-PL");

  // ensure it can be used in a const context
  const CONST_LANGIDS = langid_slice("en-US", "pl", "de-AT", "Pl-Latn-PL");
  expect(CONST_LANGIDS.length).toBe(ls.length);
  CONST_LANGIDS.forEach((l, i) => expect(l.eq(ls[i]!)).toBe(true));

  // check trailing comma
  langid_slice("en-US", "pl");
});

// crate: unic-langid-0.9.6/tests/langid.rs:47 langid_ord
test("langid_ord", () => {
  const input = ["en-Latn", "en-US"];

  const ls: LanguageIdentifier[] = input.map((l) => unwrap_result(LanguageIdentifier.from_str(l)));

  expect(ls.map((l) => display_LanguageIdentifier(l))).toEqual(["en-Latn", "en-US"]);

  input.sort();
  expect(input).toEqual(["en-Latn", "en-US"]);

  ls.sort((a, b) => a.cmp(b));

  expect(ls.map((l) => display_LanguageIdentifier(l))).toEqual(["en-US", "en-Latn"]);
});

test("rust-ts: langid! panics like `expect` on a malformed identifier", () => {
  expect(() => langid("en-US-x-private")).toThrow("Malformed Language Identifier: ParserError(InvalidSubtag)");
});
