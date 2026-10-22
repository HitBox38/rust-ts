// Unit tests of scripts/lib/mir-dump.ts (phase-diff's `-Zdump-mir` comparison, lane harness-w21).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dumpFilesInOrder, firstDumpDifference, matchKeys, parseDumpName } from "./mir-dump.ts";

const root = mkdtempSync(join(tmpdir(), "mir-dump-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
/** A dump dir holding `files` ([name, text]) written in that order (mtimes 1 s apart; all equal with `sameMtime`). */
function dir(files: [string, string][], sameMtime = false): string {
  const d = join(root, String(n++));
  mkdirSync(d);
  files.forEach(([name, text], i) => {
    writeFileSync(join(d, name), text);
    const t = 1_000_000 + (sameMtime ? 0 : i);
    utimesSync(join(d, name), t, t);
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

// Lane harness-w23 (review-w21 L1/L3): names with the pass number (no `-Zdump-mir-exclude-pass-number`).
test("dump names: the pass number is split off; matching keys number repeated passes", () => {
  expect(parseDumpName("t1.main.1-2-003.AddCallGuards.before.mir")).toEqual({
    stripped: "t1.main.AddCallGuards.before.mir",
    body: "t1.main",
    num: [1, 2, 3],
    rank: 0,
  });
  expect(parseDumpName("t1.main-promoted[0].-------.nll.0.regioncx.all.dot")).toEqual({
    stripped: "t1.main-promoted[0].nll.0.regioncx.all.dot",
    body: "t1.main-promoted[0]",
    num: undefined,
    rank: 2,
  });
  expect(parseDumpName("a.f.X.after.mir").stripped).toBe("a.f.X.after.mir");
  expect(matchKeys(["a.f.2-1-004.AddCallGuards.after.mir", "a.f.2-2-001.X.after.mir", "a.f.2-2-005.AddCallGuards.after.mir"])).toEqual([
    "a.f.AddCallGuards.after.mir",
    "a.f.X.after.mir",
    "a.f.AddCallGuards.after.mir#1",
  ]);
});

test("a pass that runs twice keeps both dumps, and the second one is compared too", () => {
  const o = dir([
    ["a.f.2-1-004.AddCallGuards.after.mir", "first\n"],
    ["a.f.2-2-005.AddCallGuards.after.mir", "second\n"],
  ]);
  const s = dir([
    ["a.f.2-1-004.AddCallGuards.after.mir", "first\n"],
    ["a.f.2-2-005.AddCallGuards.after.mir", "SECOND\n"],
  ]);
  expect(firstDumpDifference(o, s)).toEqual({ file: "a.f.2-2-005.AddCallGuards.after.mir", kind: "differs", line: 1, oracle: "second", subject: "SECOND", matched: 1 });
});

test("an extra pass in the subject shifts its pass numbers but is reported as the one extra file", () => {
  const o = dir([
    ["a.f.2-1-001.A.after.mir", "a\n"],
    ["a.f.2-1-002.B.after.mir", "b\n"],
  ]);
  const s = dir([
    ["a.f.2-1-001.A.after.mir", "a\n"],
    ["a.f.2-1-002.Extra.after.mir", "e\n"],
    ["a.f.2-1-003.B.after.mir", "b\n"],
  ]);
  expect(firstDumpDifference(o, s)).toEqual({ file: "a.f.2-1-002.Extra.after.mir", kind: "extra", matched: 2 });
  const s2 = dir([
    ["a.f.2-1-001.A.after.mir", "a\n"],
    ["a.f.2-1-002.Extra.after.mir", "e\n"],
    ["a.f.2-1-003.B.after.mir", "not b\n"],
  ]);
  expect(firstDumpDifference(o, s2)).toEqual({ file: "a.f.2-1-002.Extra.after.mir", kind: "extra", matched: 1 });
});

test("equal mtimes: one body's dumps in pass-number order, `before` ahead of `after`", () => {
  const d = dir(
    [
      ["a.f.2-1-010.Z.after.mir", ""],
      ["a.f.2-1-010.Z.before.mir", ""],
      ["a.f.2-1-002.Y.after.mir", ""],
      ["a.f.1-0-000.analysis.after.mir", ""],
    ],
    true,
  );
  expect(dumpFilesInOrder(d)).toEqual(["a.f.1-0-000.analysis.after.mir", "a.f.2-1-002.Y.after.mir", "a.f.2-1-010.Z.before.mir", "a.f.2-1-010.Z.after.mir"]);
});
