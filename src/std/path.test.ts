// rust-ts: `impl Hash for Path` (path_hash) feeds the hasher the same calls upstream does.
import { expect, test } from "bun:test";
import { type Hasher, path_hash } from "./path.ts";

/** Records every hasher call, so equal logs mean equal hashes upstream. */
function calls(p: string): string[] {
  const log: string[] = [];
  const h: Hasher = {
    write: (b) => void log.push(`write(${Array.from(b).join(",")})`),
    write_u8: (i) => void log.push(`u8(${i})`),
    write_usize: (i) => void log.push(`usize(${i})`),
    write_isize: (i) => void log.push(`isize(${i})`),
    write_length_prefix: (n) => void log.push(`len(${n})`),
  };
  path_hash(p, h);
  return log;
}

/** The byte stream only (concatenated `write`s) plus the trailing chunk_bits. */
function stream(p: string): string {
  return calls(p).join(" ");
}

test("the root is never hashed: `/a` == `a`, `/` == ``", () => {
  expect(stream("/a")).toBe(stream("a"));
  expect(stream("/")).toBe(stream(""));
  expect(stream("")).toBe("usize(0)");
  expect(stream("/x.rs")).toBe(stream("x.rs"));
});

test("separators and `.` after a separator are skipped like components()", () => {
  expect(stream("a/./b")).toBe(stream("a/b"));
  expect(stream("a//b")).toBe(stream("a/b"));
  expect(stream("a/b/")).toBe(stream("a/b"));
  expect(stream("a/b/.")).toBe(stream("a/b"));
  // a leading `.` is kept (components() yields CurDir for it)
  expect(stream("./a")).not.toBe(stream("a"));
  // `..` is a real component
  expect(stream("a/../b")).not.toBe(stream("a/b"));
});

test("chunk_bits separates `foo/bar` from `foobar`", () => {
  const a = calls("foo/bar");
  const b = calls("foobar");
  expect(a.slice(0, -1).join("").replaceAll(")write(", ",")).toBe(b.slice(0, -1).join(""));
  expect(a.at(-1)).not.toBe(b.at(-1));
  // chunk_bits = rotr(rotr(0 + 3, 2) + 3, 2) on a 64-bit usize
  const rotr = (x: bigint): bigint => ((x >> 2n) | (x << 62n)) & ((1n << 64n) - 1n);
  expect(a.at(-1)).toBe(`usize(${rotr(rotr(3n) + 3n)})`);
  expect(b.at(-1)).toBe(`usize(${rotr(6n)})`);
});
