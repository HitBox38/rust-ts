import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS, gateRecordProblem, groupResult, protectedNotRun, type GateRecord } from "./criteria.ts";

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

test("ir-hello counts every case: an oracle timeout on one is not met on the other (review harness-w43 F3)", () => {
  const ir = group("ir-hello");
  expect(groupResult(ir, gate([s("ir-hello", 1, 2, ["b"])])).met).toBe(false);
  expect(groupResult(ir, gate([s("ir-hello", 2, 2)])).met).toBe(true);
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

test("a gate narrowed to the group's suites does not meet it: losses in the protected set are unknown (review integ-w38-recheck N3)", () => {
  const g = gate([s("miri-pass", 350, 350), s("miri-pass-heavy", 8, 8)]);
  expect(groupResult(miriPass, g).met).toBe(true);
  const r = groupResult(miriPass, g, ["miri-pass", "lex", "mir", "emit", "parse"]);
  expect(r.met).toBe(false);
  expect(r.problems).toEqual(["4 protected suite(s) not in this gate, so losses are unknown (lex, mir, emit, ...)"]);
  expect(protectedNotRun(g, ["miri-pass"])).toEqual([]);
});

test("M7a: the plan's four figures (plan-m7 §6 Gates), as groups of their own (review harness-m7a H3)", () => {
  const m7a = GROUPS.filter((g) => g.milestone === "M7a").map((g) => [g.suites.join("+"), g.count ? `${g.count.atLeast} of ${g.count.of}` : g.percent]);
  expect(m7a).toEqual([["ir-hello", 100], ["mir-o2", 99], ["mono-ui", 99], ["check-rg", "33 of 34"]]);
});

describe("a count group: check-rg's crates", () => {
  const rg = group("check-rg");
  const base = readFileSync(join(import.meta.dir, "..", "harness", "baseline", "check-rg.txt"), "utf8").split("\n").filter(Boolean);
  const ids = (lost: string[], gained: string[], over: Partial<GateRecord["suites"][number]> = {}) => gate([{ ...s("check-rg", 0, 36), lost, gained, ...over }]);
  test("its pattern names the 34 crates of the protected set: not the run's case, nor a build script's probe", () => {
    const crates = base.filter((id) => rg.count!.cases.test(id));
    expect(crates.length).toBe(34);
    expect(base.filter((id) => !rg.count!.cases.test(id))).toEqual(["ripgrep-15.2.0", "ripgrep-15.2.0|anyhow (a build script's probe)"]);
  });
  test("MATCH is the protected set less lost plus gained, among the crates", () => {
    const b = new Map([["check-rg", base.filter((id) => id !== "ripgrep-15.2.0|zmij")]]);
    const all = groupResult(rg, ids([], ["ripgrep-15.2.0|zmij"]), [], b);
    expect([all.match, all.of, all.met]).toEqual([34, 34, true]);
    // A lost crate and a lost run case: one crate fewer, still met at 33; two crates fewer, not. (A real gate that loses a case fails, and
    // is not met for that too; this fake one passes, so only the count decides.)
    const full = new Map([["check-rg", base]]);
    const one = groupResult(rg, ids(["ripgrep-15.2.0|bstr", "ripgrep-15.2.0"], []), [], full);
    expect([one.match, one.met]).toEqual([33, true]);
    const two = groupResult(rg, ids(["ripgrep-15.2.0|bstr", "ripgrep-15.2.0|itoa"], []), [], full);
    expect([two.match, two.met]).toEqual([32, false]);
  });
  test("no protected set, or no lost and gained, is a problem, not a figure; nor is a case list longer than the plan's", () => {
    expect(groupResult(rg, ids([], []), [], new Map()).problems).toEqual(["check-rg: no protected set, lost or gained to count crates from"]);
    expect(groupResult(rg, gate([s("check-rg", 36, 36)]), [], new Map([["check-rg", base]])).met).toBe(false);
    const more = groupResult(rg, ids([], ["ripgrep-15.2.0|extra_crate"]), [], new Map([["check-rg", base]]));
    expect([more.match, more.met, more.problems]).toEqual([35, false, ["35 crates seen, where the plan counts 34"]]);
  });
});
