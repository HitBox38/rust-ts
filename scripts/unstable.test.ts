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
console.log(JSON.stringify({
  statuses: d.STATUSES,
  same: d.classify(o("a"), o("a")),
  unstableSame: d.classify(o("a", 0, { unstable: "why" }), o("a")),
  unstableUnported: d.classify(o("a", 0, { unstable: "why" }), o("x", 70)),
  oracleTimeoutFirst: d.classify({ text: "", code: 0, timedOut: true, unstable: "why" }, o("")),
  tydump: listed("tydump-ui"),
  thirdump: listed("thirdump-ui"),
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
  // The 8 measured cases (harness/suites.ts M3_UI_UNSTABLE), with reasons, in both M3 ui suites and nowhere else.
  expect(j.tydump.length).toBe(8);
  expect(j.thirdump).toEqual(j.tydump);
  for (const [, why] of j.tydump) expect(why.length).toBeGreaterThan(0);
  expect(j.withUnstable).toEqual(["tydump-ui", "thirdump-ui"]);
  expect(j.protectedListed).toEqual([j.tydump[0][0]]);
  expect(j.protectedNone).toEqual([]);
  // No baseline protects a listed unstable case.
  expect(j.baselinesClean).toEqual([]);
}, 120_000);
