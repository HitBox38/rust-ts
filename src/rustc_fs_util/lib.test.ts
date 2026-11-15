// Tests of rustc_fs_util's `link_or_copy` (lane rg-fix-a): the hard link, the `AlreadyExists` retry after `remove_file`, and the
// copy fallback, which stops `unported` while src/std has no `std::fs::copy`.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { Unported } from "../std/panic.ts";
import { link_or_copy } from "./lib.ts";

const WORK = join(DATA, "tmp", "fs-util-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

test("link_or_copy hard-links, and replaces an existing destination", () => {
  mkdirSync(WORK, { recursive: true });
  const p = join(WORK, "p.bc");
  const q = join(WORK, "q.o");
  writeFileSync(p, "one");
  expect(link_or_copy(p, q)).toEqual({ $: "Ok", _0: "Link" });
  expect(statSync(q).ino).toBe(statSync(p).ino);
  // The destination exists now: `hard_link` fails with `AlreadyExists`, the destination is removed and the link made again.
  const r = join(WORK, "r.bc");
  writeFileSync(r, "two");
  expect(link_or_copy(r, q)).toEqual({ $: "Ok", _0: "Link" });
  expect(statSync(q).ino).toBe(statSync(r).ino);
  expect(readFileSync(q, "utf8")).toBe("two");
  expect(readFileSync(p, "utf8")).toBe("one");
});

test("link_or_copy's copy fallback stops unported", () => {
  mkdirSync(WORK, { recursive: true });
  // A missing source: `hard_link` fails with `NotFound`, not `AlreadyExists`, so upstream goes on to `fs::copy`.
  expect(() => link_or_copy(join(WORK, "missing"), join(WORK, "dest"))).toThrow(Unported);
});
