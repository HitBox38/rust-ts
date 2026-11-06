// Unit tests of unstable cases (lane harness-w20c): difftest's UNSTABLE status and the gate's refusal to protect a
// listed unstable case. difftest.ts and gate.ts load scripts/lib/common.ts, so (as harness/compiletest.test.ts) they
// are loaded in a child process; see scripts/lib/deps.test.ts for why.
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CHILD = `
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const o = (text, code = 0, extra = {}) => ({ text, code, timedOut: false, ...extra });
const listed = (name) => [...d.unstableOf(SUITES.find((s) => s.name === name)).entries()];
const id = listed("tydump-ui")[0][0];
const single = { mode: "single" };
const miri = { mode: "single", miri: true };
const batch = { mode: "batch" };
console.log(JSON.stringify({
  statuses: d.STATUSES,
  same: d.classify(o("a"), o("a")),
  unstableSame: d.classify(o("a", 0, { unstable: "why" }), o("a")),
  unstableUnported: d.classify(o("a", 0, { unstable: "why" }), o("x", 70)),
  oracleTimeoutFirst: d.classify({ text: "", code: 0, timedOut: true, unstable: "why" }, o("")),
  // Through \`compared\`, as difftest calls it (scripts/lib/unstable.test.ts has the pairs).
  masked: [
    [single, "", "thread 'a' (1) panicked at x", "", "thread 'a' (2) panicked at x"],
    [single, "", "thread 'a' (1) panicked at x", "", "thread 'b' (2) panicked at x"],
    [single, "thread 'a' (1) panicked", "", "thread 'a' (2) panicked", ""],
    [miri, "", "thread 'main' (1000) panicked at x", "", "thread 'main' (1001) panicked at x"],
    [batch, "", "thread 'a' (1) panicked at x", "", "thread 'a' (2) panicked at x"],
  ].map(([s, a, b, c, e]) => d.classify(...d.compared(s, o(d.render({ stdout: a, stderr: b, code: 0 })), o(d.render({ stdout: c, stderr: e, code: 0 }))))),
  unstableStaysFirst: d.classify(...d.compared(single, o(d.render({ stdout: "", stderr: "thread 'a' (1) panicked", code: 0 }), 0, { unstable: "why" }), o(d.render({ stdout: "", stderr: "thread 'a' (2) panicked", code: 0 })))),
  batchIsUntouched: d.compared(batch, o("x"), o("y"))[0].text,
  tydump: listed("tydump-ui"),
  thirdump: listed("thirdump-ui"),
  mirdump: listed("mirdump-ui"),
  mir: listed("mir"),
  thirTree: listed("thir-tree"),
  withUnstable: SUITES.filter((s) => s.unstable).map((s) => s.name),
  protectedListed: g.protectedUnstable("tydump-ui", new Set([id, "tests/ui/typeck/other.rs"])),
  protectedNone: g.protectedUnstable("tydump-ui", new Set(["tests/ui/typeck/other.rs"])),
  baselinesClean: SUITES.map((s) => [s.name, g.protectedUnstable(s.name)]).filter(([, b]) => b.length),
}));
`;

test("UNSTABLE status, the M3 ui lists, and the gate's refusal to protect listed cases", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.statuses).toContain("UNSTABLE");
  expect(j.same).toBe("MATCH");
  // An unstable oracle output is never MATCH, even when the texts are equal.
  expect(j.unstableSame).toBe("UNSTABLE");
  expect(j.unstableUnported).toBe("UNSTABLE");
  expect(j.oracleTimeoutFirst).toBe("ORACLE_TIMEOUT");
  // A thread id is masked, in a single-mode suite's stderr; a name, stdout, a Miri program's id and a batch suite are not.
  expect(j.masked).toEqual(["MATCH", "DIFF", "DIFF", "DIFF", "DIFF"]);
  expect(j.unstableStaysFirst).toBe("UNSTABLE");
  expect(j.batchIsUntouched).toBe("x");
  // The measured cases: tydump-ui and thirdump-ui's long-type tests (harness/suites.ts M3_UI_UNSTABLE), which thir-tree shares;
  // miri-pass and miri-pass-heavy's (MIRI_PASS_UNSTABLE, lane harness-m6c).
  expect(j.tydump.length).toBe(2);
  expect(j.thirdump).toEqual(j.tydump);
  for (const [, why] of j.tydump) expect(why.length).toBeGreaterThan(0);
  expect(j.withUnstable).toEqual(["tydump-ui", "thirdump-ui", "thir-tree", "miri-pass", "miri-pass-heavy"]);
  expect(j.mirdump).toEqual([]);
  expect(j.mir).toEqual([]);
  expect(j.thirTree).toEqual(j.tydump);
  expect(j.protectedListed).toEqual([j.tydump[0][0]]);
  expect(j.protectedNone).toEqual([]);
  // No baseline protects a listed unstable case.
  expect(j.baselinesClean).toEqual([]);
}, 120_000);
