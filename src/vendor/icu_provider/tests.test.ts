// Ports of icu_provider 2.3.0's inline tests for marker.rs and request.rs.
import { expect, test } from "bun:test";
import { unwrap_result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { DataMarkerId, fxhash_32 } from "./marker.ts";
import { DataMarkerAttributes } from "./request.ts";

// crate: icu_provider-2.3.0/src/marker.rs:613 test_marker_syntax
test("test_marker_syntax", () => {
  // Valid markers:
  for (const n of ["HelloWorldV1", "HelloWorldFooV1", "HelloWorldV999", "Hello485FooV1"]) {
    expect(DataMarkerId.from_name(n).$).toBe("Ok");
  }

  // No version:
  expect(DataMarkerId.from_name("HelloWorld")).toEqual({ $: "Err", _0: ["[0-9]", "HelloWorld".length] });

  expect(DataMarkerId.from_name("HelloWorldV")).toEqual({ $: "Err", _0: ["[0-9]", "HelloWorldV".length] });
  expect(DataMarkerId.from_name("HelloWorldVFoo")).toEqual({ $: "Err", _0: ["[0-9]", "HelloWorldVFoo".length] });
  expect(DataMarkerId.from_name("HelloWorldV1Foo")).toEqual({ $: "Err", _0: ["[0-9]", "HelloWorldV1Foo".length] });
});

// crate-skip: icu_provider-2.3.0/src/marker.rs:641 test_id_debug the `debug` field exists only with debug assertions / `export` (off in rustc's build)

// crate: icu_provider-2.3.0/src/marker.rs:646 test_hash_word_32
test("test_hash_word_32", () => {
  expect(fxhash_32(utf8(""))).toBe(0);
  expect(fxhash_32(utf8("a"))).toBe(0xf3051f19);
  expect(fxhash_32(utf8("ab"))).toBe(0x2f9df119);
  expect(fxhash_32(utf8("abc"))).toBe(0xcb1d9396);
  expect(fxhash_32(utf8("abcd"))).toBe(0x8628f119);
  expect(fxhash_32(utf8("abcde"))).toBe(0xbebdb56d);
  expect(fxhash_32(utf8("abcdef"))).toBe(0x1ce8476d);
  expect(fxhash_32(utf8("abcdefg"))).toBe(0xc0f176a4);
  expect(fxhash_32(utf8("abcdefgh"))).toBe(0x09ab476d);
  expect(fxhash_32(utf8("abcdefghi"))).toBe(0xb72f5d88);
});

// crate: icu_provider-2.3.0/src/marker.rs:660 test_id_hash
test("test_id_hash", () => {
  expect([...unwrap_result(DataMarkerId.from_name("BarV1")).hashed().to_bytes()]).toEqual([212, 77, 158, 241]);
});

// crate: icu_provider-2.3.0/src/request.rs:386 test_data_marker_attributes_from_utf8
test("test_data_marker_attributes_from_utf8", () => {
  for (const s of ["long-meter", "long", "meter", "short-meter-second", "usd"]) {
    const marker = unwrap_result(DataMarkerAttributes.try_from_utf8(utf8(s)));
    expect(marker.as_str()).toBe(s);
  }
});

// crate: icu_provider-2.3.0/src/request.rs:402 test_data_marker_attributes_syntax
test("test_data_marker_attributes_syntax", () => {
  const valid_cases = ["long-meter", "long", "meter", "short-meter-second", "usd", "nested/part", "foo/bar/baz", ""];
  const invalid_cases = ["/leading", "trailing/", "double//slash", "invalid space", "invalid$character", "invalid\\backslash"];
  for (const s of valid_cases) expect(DataMarkerAttributes.try_from_str(s).$, `Expected valid: ${s}`).toBe("Ok");
  for (const s of invalid_cases) expect(DataMarkerAttributes.try_from_str(s).$, `Expected invalid: ${s}`).toBe("Err");
});
