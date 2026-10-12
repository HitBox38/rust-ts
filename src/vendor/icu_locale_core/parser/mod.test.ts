// Port of icu_locale_core 2.3.0 `src/parser/mod.rs` `mod test`.
import { expect, test } from "bun:test";
import { utf8 } from "../../../std/str.ts";
import { skip_before_separator, SubtagIterator } from "./mod.ts";

// crate: icu_locale_core-2.3.0/src/parser/mod.rs:98 slice_to_str
function slice_to_str(input: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(input);
}
const opt = (x: Uint8Array | undefined) => (x === undefined ? undefined : slice_to_str(x));

// crate: icu_locale_core-2.3.0/src/parser/mod.rs:103 subtag_iterator_peek_test
test("subtag_iterator_peek_test", () => {
  const slice = "de-at-u-ca-foobar";
  const si = SubtagIterator.new(utf8(slice));

  expect(opt(si.peek())).toBe("de");
  expect(opt(si.peek())).toBe("de");
  expect(opt(si.next())).toBe("de");

  expect(opt(si.peek())).toBe("at");
  expect(opt(si.peek())).toBe("at");
  expect(opt(si.next())).toBe("at");
});

// crate: icu_locale_core-2.3.0/src/parser/mod.rs:117 subtag_iterator_test
test("subtag_iterator_test", () => {
  let si = SubtagIterator.new(utf8(""));
  expect(opt(si.next())).toBe("");

  si = SubtagIterator.new(utf8("-"));
  expect(opt(si.next())).toBe("");

  si = SubtagIterator.new(utf8("-en"));
  expect(opt(si.next())).toBe("");
  expect(opt(si.next())).toBe("en");
  expect(si.next()).toBe(undefined);

  expect([...SubtagIterator.new(utf8("en"))].map(slice_to_str)).toEqual(["en"]);
  expect([...SubtagIterator.new(utf8("en-"))].map(slice_to_str)).toEqual(["en", ""]);

  si = SubtagIterator.new(utf8("--"));
  expect(opt(si.next())).toBe("");
  expect(opt(si.next())).toBe("");
  expect(opt(si.next())).toBe("");
  expect(si.next()).toBe(undefined);

  si = SubtagIterator.new(utf8("-en-"));
  expect(opt(si.next())).toBe("");
  expect(opt(si.next())).toBe("en");
  expect(opt(si.next())).toBe("");
  expect(si.next()).toBe(undefined);

  expect([...SubtagIterator.new(utf8("de-at-u-ca-foobar"))].map(slice_to_str)).toEqual(["de", "at", "u", "ca", "foobar"]);
});

// crate: icu_locale_core-2.3.0/src/parser/mod.rs:163 skip_before_separator_test
test("skip_before_separator_test", () => {
  expect(slice_to_str(skip_before_separator(utf8("")))).toBe("");
  expect(slice_to_str(skip_before_separator(utf8("en")))).toBe("en");
  expect(slice_to_str(skip_before_separator(utf8("en-")))).toBe("en");
  expect(slice_to_str(skip_before_separator(utf8("en--US")))).toBe("en");
  expect(slice_to_str(skip_before_separator(utf8("-US")))).toBe("");
  expect(slice_to_str(skip_before_separator(utf8("US")))).toBe("US");
  expect(slice_to_str(skip_before_separator(utf8("-")))).toBe("");
});
