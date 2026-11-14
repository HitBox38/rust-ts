// pathdiff 0.2.3's doc examples for `diff_paths` (src/lib.rs:20-41). `PathBuf` equality compares components, so the
// expected `"../"` is the path `..`.
import { expect, test } from "bun:test";
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
