// Unit tests of scripts/lib/mir-dump.ts (phase-diff's `-Zdump-mir` comparison, lane harness-w21).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dumpFilesInOrder, firstDumpDifference } from "./mir-dump.ts";

const root = mkdtempSync(join(tmpdir(), "mir-dump-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
/** A dump dir holding `files` ([name, text]) written in that order (mtimes 1 s apart). */
function dir(files: [string, string][]): string {
  const d = join(root, String(n++));
  mkdirSync(d);
  files.forEach(([name, text], i) => {
    writeFileSync(join(d, name), text);
    utimesSync(join(d, name), 1_000_000 + i, 1_000_000 + i);
  });
  return d;
}

test("files are listed in write (mtime) order, not name order", () => {
  const d = dir([
    ["a.f.built.after.mir", "1"],
    ["a.f.SimplifyCfg-initial.before.mir", "2"],
    ["a.f.SimplifyCfg-initial.after.mir", "3"],
    ["a.f.PromoteTemps.before.mir", "4"],
  ]);
  expect(dumpFilesInOrder(d)).toEqual(["a.f.built.after.mir", "a.f.SimplifyCfg-initial.before.mir", "a.f.SimplifyCfg-initial.after.mir", "a.f.PromoteTemps.before.mir"]);
  expect(dumpFilesInOrder(join(root, "does-not-exist"))).toEqual([]);
});

test("identical dumps: no difference", () => {
  const files: [string, string][] = [
    ["a.f.built.after.mir", "fn f() {\n}\n"],
    ["a.f.renumber.0.mir", "x\n"],
  ];
  expect(firstDumpDifference(dir(files), dir(files))).toBeUndefined();
});

test("the first differing file in the oracle's order, with its first differing line", () => {
  const o = dir([
    ["a.f.built.after.mir", "same\n"],
    ["a.f.X.after.mir", "l1\nl2\nl3\n"],
    ["a.f.Y.after.mir", "y\n"],
  ]);
  const s = dir([
    ["a.f.built.after.mir", "same\n"],
    ["a.f.Y.after.mir", "different\n"],
    ["a.f.X.after.mir", "l1\nL2\nl3\n"],
  ]);
  expect(firstDumpDifference(o, s)).toEqual({ file: "a.f.X.after.mir", kind: "differs", line: 2, oracle: "l2", subject: "L2", matched: 1 });
});

test("a file the subject did not write, and a file only the subject wrote", () => {
  const o = dir([
    ["a.f.built.after.mir", "b\n"],
    ["a.f.X.after.mir", "x\n"],
  ]);
  expect(firstDumpDifference(o, dir([["a.f.built.after.mir", "b\n"]]))).toEqual({ file: "a.f.X.after.mir", kind: "missing", matched: 1 });
  expect(firstDumpDifference(o, dir([]))).toEqual({ file: "a.f.built.after.mir", kind: "missing", matched: 0 });
  // Everything the oracle wrote matches; the subject wrote one more file.
  const s = dir([
    ["a.f.built.after.mir", "b\n"],
    ["a.f.X.after.mir", "x\n"],
    ["a.f.Z.after.mir", "z\n"],
  ]);
  expect(firstDumpDifference(o, s)).toEqual({ file: "a.f.Z.after.mir", kind: "extra", matched: 2 });
});

test("an extra subject file written before the first differing file is reported first", () => {
  const o = dir([
    ["a.f.built.after.mir", "b\n"],
    ["a.f.X.after.mir", "x\n"],
  ]);
  const s = dir([
    ["a.f.built.after.mir", "b\n"],
    ["a.f.Extra.after.mir", "e\n"],
    ["a.f.X.after.mir", "not x\n"],
  ]);
  expect(firstDumpDifference(o, s)).toEqual({ file: "a.f.Extra.after.mir", kind: "extra", matched: 1 });
  // Written after it: the differing file comes first.
  const s2 = dir([
    ["a.f.built.after.mir", "b\n"],
    ["a.f.X.after.mir", "not x\n"],
    ["a.f.Extra.after.mir", "e\n"],
  ]);
  expect(firstDumpDifference(o, s2)?.kind).toBe("differs");
});
