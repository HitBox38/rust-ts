// Unit test of apple.ts's `stdout_to_path` (lane fixers-60, review fixers-59 N2): upstream keeps the bytes as they are
// (`OsStringExt::from_vec`, apple.rs:299-300), so a leading U+FEFF, valid UTF-8, stays part of the path; only the trailing
// newline goes.
import { expect, test } from "bun:test";
import { stdout_to_path } from "./apple.ts";

test("stdout_to_path keeps a leading U+FEFF and drops one trailing newline", () => {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  expect(stdout_to_path(bytes("﻿/Applications/Xcode.app\n"))).toBe("﻿/Applications/Xcode.app");
  expect(stdout_to_path(bytes("/a/b\n\n"))).toBe("/a/b\n");
  expect(stdout_to_path(bytes("/a/b"))).toBe("/a/b");
});
