// pathdiff 0.2.3's doc examples for `diff_paths` (src/lib.rs:20-41). `PathBuf` equality compares components, so the
// expected `"../"` is the path `..`.
import { describe, expect, test } from "bun:test";
import { path_eq } from "../../std/path.ts";
import { diff_paths } from "./lib.ts";

test.skipIf(process.platform === "win32")("diff_paths doc examples", () => {
  expect(diff_paths("/foo/bar", "/foo/bar/baz")).toBe("..");
  expect(diff_paths("/foo/bar/baz", "/foo/bar")).toBe("baz");
  expect(diff_paths("/foo/bar/quux", "/foo/bar/baz")).toBe("../quux");
  expect(diff_paths("/foo/bar/baz", "/foo/bar/quux")).toBe("../baz");
  expect(diff_paths("/foo/bar", "/foo/bar/quux")).toBe("..");

  expect(diff_paths("/foo/bar", "baz")).toBe("/foo/bar");
  expect(diff_paths("/foo/bar", "/baz")).toBe("../foo/bar");
  expect(diff_paths("foo", "bar")).toBe("../foo");
});

test.skipIf(process.platform === "win32")("diff_paths: a `..` in the base gives None, a `.` keeps the component", () => {
  expect(diff_paths("a/b", "a/../c")).toBeUndefined();
  expect(diff_paths("./a", "./b")).toBe("../a");
});

// pathdiff 0.2.3's `mod tests` (src/lib.rs:170-251, `#[cfg(test)]`). The camino half of `assert_diff_paths` is off (the
// `camino` feature is not enabled in rustc's build). Unix only, as the port of `diff_paths` is checked there; upstream's
// Windows variant of `abs` (`C:\`) is not run.
describe.skipIf(process.platform === "win32")("pathdiff mod tests", () => {
  /** `assert_eq!(diff_paths(path, base), expected.map(|s| s.into()))`: `PathBuf ==` compares components. */
  // crate: pathdiff-0.2.3/src/lib.rs:247 assert_diff_paths
  function assert_diff_paths(path: string, base: string, expected: string | undefined): void {
    const got = diff_paths(path, base);
    if (expected === undefined || got === undefined) {
      expect(got).toBe(expected);
    } else {
      expect([got, path_eq(got, expected)]).toEqual([got, true]);
    }
  }

  // crate: pathdiff-0.2.3/src/lib.rs:176 test_absolute
  test("test_absolute", () => {
    // Absolute paths look different on Windows vs Unix.
    // crate: pathdiff-0.2.3/src/lib.rs:177 abs
    const abs = (path: string): string => `/${path}`;

    assert_diff_paths(abs("foo"), abs("bar"), "../foo");
    assert_diff_paths(abs("foo"), "bar", abs("foo"));
    assert_diff_paths("foo", abs("bar"), undefined);
    assert_diff_paths("foo", "bar", "../foo");
  });

  // crate: pathdiff-0.2.3/src/lib.rs:195 test_identity
  test("test_identity", () => {
    assert_diff_paths(".", ".", "");
    assert_diff_paths("../foo", "../foo", "");
    assert_diff_paths("./foo", "./foo", "");
    assert_diff_paths("/foo", "/foo", "");
    assert_diff_paths("foo", "foo", "");

    assert_diff_paths("../foo/bar/baz", "../foo/bar/baz", "");
    assert_diff_paths("foo/bar/baz", "foo/bar/baz", "");
  });

  // crate: pathdiff-0.2.3/src/lib.rs:207 test_subset
  test("test_subset", () => {
    assert_diff_paths("foo", "fo", "../foo");
    assert_diff_paths("fo", "foo", "../fo");
  });

  // crate: pathdiff-0.2.3/src/lib.rs:213 test_empty
  test("test_empty", () => {
    assert_diff_paths("", "", "");
    assert_diff_paths("foo", "", "foo");
    assert_diff_paths("", "foo", "..");
  });

  // crate: pathdiff-0.2.3/src/lib.rs:220 test_relative
  test("test_relative", () => {
    assert_diff_paths("../foo", "../bar", "../foo");
    assert_diff_paths("../foo", "../foo/bar/baz", "../..");
    assert_diff_paths("../foo/bar/baz", "../foo", "bar/baz");

    assert_diff_paths("foo/bar/baz", "foo", "bar/baz");
    assert_diff_paths("foo/bar/baz", "foo/bar", "baz");
    assert_diff_paths("foo/bar/baz", "foo/bar/baz", "");
    assert_diff_paths("foo/bar/baz", "foo/bar/baz/", "");

    assert_diff_paths("foo/bar/baz/", "foo", "bar/baz");
    assert_diff_paths("foo/bar/baz/", "foo/bar", "baz");
    assert_diff_paths("foo/bar/baz/", "foo/bar/baz", "");
    assert_diff_paths("foo/bar/baz/", "foo/bar/baz/", "");

    assert_diff_paths("foo/bar/baz", "foo/", "bar/baz");
    assert_diff_paths("foo/bar/baz", "foo/bar/", "baz");
    assert_diff_paths("foo/bar/baz", "foo/bar/baz", "");
  });

  // crate: pathdiff-0.2.3/src/lib.rs:241 test_current_directory
  test("test_current_directory", () => {
    assert_diff_paths(".", "foo", "../.");
    assert_diff_paths("foo", ".", "foo");
    assert_diff_paths("/foo", "/.", "foo");
  });
});
