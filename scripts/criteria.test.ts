import { expect, test } from "bun:test";
import { GROUPS, gateRecordProblem, groupResult, type GateRecord } from "./criteria.ts";

const s = (suite: string, match: number, total: number, oracleTimeouts: string[] = []) => ({ suite, match, total, oracleTimeouts });
const gate = (suites: GateRecord["suites"], over: Partial<GateRecord> = {}): GateRecord => ({ pass: true, staticOk: true, skipStatic: false, head: "abc", dirty: [], suites, ...over });
const group = (end: string) => GROUPS.find((g) => g.name.endsWith(end))!;
const miriPass = group("miri-pass");

test("the figure sums the group: one suite's share can read met while the group is not, and the reverse", () => {
  const under = groupResult(miriPass, gate([s("miri-pass", 281, 350), s("miri-pass-heavy", 6, 10)]));
  expect([under.match, under.of, under.met]).toEqual([287, 360, false]);
  const over = groupResult(miriPass, gate([s("miri-pass", 279, 350), s("miri-pass-heavy", 10, 10)]));
  expect([over.match, over.of, over.met]).toEqual([289, 360, true]);
});

test("a suite the gate did not run leaves the group not met, however good the rest is", () => {
  const r = groupResult(miriPass, gate([s("miri-pass", 350, 350)]));
  expect(r.met).toBe(false);
  expect(r.problems).toEqual(["miri-pass-heavy: not in this gate"]);
});

test("run-pass cannot hide run-fail: run-fail has its own group (plan-m6 A9, review re-check L2)", () => {
  const suites = [s("run-pass-miri", 3416, 3470), s("run-pass-miri-heavy", 8, 8), s("run-fail-miri", 0, 294)];
  expect(groupResult(group("run-pass"), gate(suites)).met).toBe(true);
  expect(groupResult(group("run-fail"), gate(suites)).met).toBe(false);
});

test("good numbers from a failed, dirty or static-skipping gate are not met (review re-check L1)", () => {
  const suites = [s("miri-pass", 350, 350), s("miri-pass-heavy", 10, 10)];
  expect(groupResult(miriPass, gate(suites)).met).toBe(true);
  expect(groupResult(miriPass, gate(suites, { pass: false })).problems).toEqual(["the gate did not pass"]);
  expect(groupResult(miriPass, gate(suites, { dirty: ["M a.ts"] })).problems).toEqual(["the gate's tree was dirty"]);
  expect(groupResult(miriPass, gate(suites, { skipStatic: true })).problems).toEqual(["the gate's static steps did not run clean"]);
  expect(groupResult(miriPass, gate(suites, { staticOk: false })).met).toBe(false);
});

test("ORACLE_TIMEOUT leaves the denominator and is counted (plan-m6 A9); met is decided on the exact counts", () => {
  const r = groupResult(miriPass, gate([s("miri-pass", 8, 12, ["a", "b"]), s("miri-pass-heavy", 0, 0)]));
  expect([r.match, r.of, r.oracleTimeouts, r.met]).toEqual([8, 10, 2, true]);
  // 79.996% rounds to 80 in the printed line, and is not met.
  const close = groupResult(miriPass, gate([s("miri-pass", 19999, 25000), s("miri-pass-heavy", 0, 0)]));
  expect([close.percent, close.met]).toEqual([80, false]);
});

test("a gate.json missing what the figure reads is named, not a crash", () => {
  const ok = gate([s("miri-pass", 1, 1)]);
  expect(gateRecordProblem(ok)).toBeUndefined();
  expect(gateRecordProblem(null)).toBe("not an object");
  const { head: _head, ...noHead } = ok;
  expect(gateRecordProblem(noHead)).toContain("head, dirty or suites");
  const { pass: _pass, ...noPass } = ok;
  expect(gateRecordProblem(noPass)).toContain("pass, staticOk or skipStatic");
  expect(gateRecordProblem({ ...ok, suites: [{ suite: "x", match: 1, total: 1 }] })).toContain("a suites entry lacks");
});
