// Port of the `#[cfg(test)]` tests of unicase-2.8.1 (lib.rs, ascii.rs, unicode/mod.rs) that don't need
// `DefaultHasher` (hash equality is checked through `UniCase_key`, the hash byte stream) or nightly.
import { expect, test } from "bun:test";
import { Ascii, UniCase, UniCase_key } from "./lib.ts";
import { Unicode } from "./unicode/mod.ts";

// crate: unicase-2.8.1/src/lib.rs:332 test_eq_ascii
test("test_eq_ascii", () => {
  const a = UniCase.new("foobar");
  const b = UniCase.new("FOOBAR");
  const c = UniCase.ascii("FoObAr");

  expect(a.eq(b)).toBe(true);
  expect(b.eq(a)).toBe(true);
  expect(a.eq(c)).toBe(true);
  expect(c.eq(a)).toBe(true);
  expect(UniCase_key(a)).toBe(UniCase_key(b));
  expect(UniCase_key(a)).toBe(UniCase_key(c));
  expect(a.is_ascii()).toBe(true);
  expect(b.is_ascii()).toBe(true);
  expect(c.is_ascii()).toBe(true);
});

// crate: unicase-2.8.1/src/lib.rs:349 test_eq_unicode
test("test_eq_unicode", () => {
  const a = UniCase.new("στιγμας");
  const b = UniCase.new("στιγμασ");
  expect(a.eq(b)).toBe(true);
  expect(b.eq(a)).toBe(true);
  expect(UniCase_key(a)).toBe(UniCase_key(b));
});

// crate: unicase-2.8.1/src/lib.rs:358 test_eq_unicode_left_is_substring
test("test_eq_unicode_left_is_substring", () => {
  const a = UniCase.unicode("foo");
  const b = UniCase.unicode("foobar");
  expect(a.eq(b)).toBe(false);
  expect(b.eq(a)).toBe(false);
});

// crate: unicase-2.8.1/src/lib.rs:400 test_case_cmp
test("test_case_cmp", () => {
  expect(UniCase.new("a").cmp(UniCase.new("B"))).toBe(-1);
  expect(UniCase.new("A").cmp(UniCase.new("b"))).toBe(-1);
  expect(UniCase.new("aa").cmp(UniCase.new("a"))).toBe(1);
  expect(UniCase.new("a").cmp(UniCase.new("aa"))).toBe(-1);
  expect(UniCase.new("a").cmp(UniCase.new("AA"))).toBe(-1);
});

test("ascii vs unicode keys agree (Kelvin sign folds to k)", () => {
  expect(UniCase.new("K").eq(UniCase.new("K"))).toBe(true);
  expect(UniCase_key(UniCase.new("K"))).toBe(UniCase_key(UniCase.new("K")));
});

// crate: unicase-2.8.1/src/ascii.rs:131 test_case_insensitive
test("ascii test_case_insensitive", () => {
  const a = new Ascii("foobar");
  expect(a.eq("FOOBAR")).toBe(true);
});

const eq_ = (l: string, r: string) => expect(new Unicode(l).eq(new Unicode(r))).toBe(true);

// crate: unicase-2.8.1/src/unicode/mod.rs:182 test_ascii_folding
test("test_ascii_folding", () => {
  eq_("foo bar", "FoO BAR");
});

// crate: unicase-2.8.1/src/unicode/mod.rs:187 test_simple_case_folding
test("test_simple_case_folding", () => {
  eq_("στιγμας", "στιγμασ");
});

// crate: unicase-2.8.1/src/unicode/mod.rs:192 test_full_case_folding
test("test_full_case_folding", () => {
  eq_("ﬂour", "flour");
  eq_("Maße", "MASSE");
  eq_("ᾲ στο διάολο", "ὰι στο διάολο");
});

// crate: unicase-2.8.1/src/unicode/mod.rs:199 test_to_folded_case
test("test_to_folded_case", () => {
  expect(new Unicode("Maße").to_folded_case()).toBe("masse");
});
