import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS, gateRecordProblem, groupResult, milestoneVerdicts, protectedNotRun, type GateRecord } from "./criteria.ts";

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

test("M7b and M7c: the plan's figures (plan-m7 §6 Gates; lane harness-m7b), one group each", () => {
  const of = (m: string) => GROUPS.filter((g) => g.milestone === m).map((g) => [g.suites.join("+"), g.percent, g.allCases === true]);
  expect(of("M7b")).toEqual([["native-hello", 100, true], ["run-pass-native", 80, false], ["ir-run-pass", 70, false]]);
  expect(of("M7c")).toEqual([["run-pass-native", 98, false], ["run-fail-native", 95, false], ["ir-run-pass", 95, false]]);
  // `--milestone M7` selects all of M7a-c; `M7b` only its own.
  expect(GROUPS.filter((g) => g.milestone.startsWith("M7b")).length).toBe(3);
  // native-hello's one case: an oracle timeout is not left out.
  const hello = GROUPS.find((g) => g.name === "plan-m7 M7b native-hello")!;
  expect(groupResult(hello, gate([s("native-hello", 0, 1, ["hello"])])).met).toBe(false);
  expect(groupResult(hello, gate([s("native-hello", 1, 1)])).met).toBe(true);
  // 80% on the exact counts.
  const rp = GROUPS.find((g) => g.name === "plan-m7 M7b run-pass-native")!;
  expect(groupResult(rp, gate([{ ...s("run-pass-native", 80, 100), unstable: [] }])).met).toBe(true);
  expect(groupResult(rp, gate([{ ...s("run-pass-native", 79, 100), unstable: [] }])).met).toBe(false);
});

test("M7's percent groups leave UNSTABLE out of the denominator, as plan-m7 §6 says; M6's do not (review harness-m7b F2)", () => {
  const withUnstable = (suite: string, match: number, total: number, unstable: string[], oracleTimeouts: string[] = []) => ({ ...s(suite, match, total, oracleTimeouts), unstable });
  // The review's case: 274 MATCH of 289 with 15 UNSTABLE meets 95% only with them left out.
  const rf = GROUPS.find((g) => g.name === "plan-m7 M7c run-fail-native")!;
  const fifteen = Array.from({ length: 15 }, (_, i) => `u${i}`);
  const r = groupResult(rf, gate([withUnstable("run-fail-native", 274, 289, fifteen)]));
  expect([r.match, r.of, r.unstable, r.percent, r.met]).toEqual([274, 274, 15, 100, true]);
  // ORACLE_TIMEOUT and UNSTABLE both come out.
  const both = groupResult(rf, gate([withUnstable("run-fail-native", 270, 289, fifteen, ["t1", "t2"])]));
  expect([both.of, both.oracleTimeouts, both.unstable]).toEqual([272, 2, 15]);
  // A gate.json without the list cannot decide it.
  expect(groupResult(rf, gate([s("run-fail-native", 289, 289)])).problems).toEqual(["run-fail-native: this gate.json has no unstable list to leave out"]);
  // Every M7 percent group but the every-case ones leaves them out; no M6 group does, and M6's figures are as before.
  expect(GROUPS.filter((g) => g.milestone.startsWith("M7") && !g.count && !g.allCases).every((g) => g.excludeUnstable)).toBe(true);
  expect(GROUPS.filter((g) => g.milestone.startsWith("M6")).some((g) => g.excludeUnstable)).toBe(false);
  const m6 = groupResult(group("M6b run-fail"), gate([withUnstable("run-fail-miri", 270, 294, ["a", "b"], ["t"])]));
  expect([m6.of, m6.unstable, m6.met]).toEqual([293, 0, true]);
  // native-hello counts every case: an UNSTABLE hello is not met.
  const hello = GROUPS.find((g) => g.name === "plan-m7 M7b native-hello")!;
  expect(groupResult(hello, gate([withUnstable("native-hello", 0, 1, ["hello"])])).met).toBe(false);
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

test("M7d: the plan's four figures (plan-m7 §6 Gates; lane harness-m7d), one group each", () => {
  const m7d = GROUPS.filter((g) => g.milestone === "M7d");
  expect(m7d.map((g) => [g.suites.join("+"), g.count ? `${g.count.atLeast} of ${g.count.of}` : g.percent, g.allCases === true, g.minMatch ?? null])).toEqual([
    ["rg-build", 100, true, null],
    ["rg-behaviour", 100, true, null],
    ["check-rg", "34 of 34", false, null],
    ["pm-self", 0, false, 1],
  ]);
  const withUnstable = (suite: string, match: number, total: number, unstable: string[] = [], oracleTimeouts: string[] = []) => ({ ...s(suite, match, total, oracleTimeouts), unstable });
  // rg-build's one case and every scripted query: an oracle timeout or an UNSTABLE query is not met.
  const build = m7d[0]!;
  expect(groupResult(build, gate([withUnstable("rg-build", 1, 1)])).met).toBe(true);
  expect(groupResult(build, gate([withUnstable("rg-build", 0, 1, [], ["ripgrep-15.2.0"])])).met).toBe(false);
  const behaviour = m7d[1]!;
  expect(groupResult(behaviour, gate([withUnstable("rg-behaviour", 62, 63)])).met).toBe(false);
  expect(groupResult(behaviour, gate([withUnstable("rg-behaviour", 62, 63, ["json"])])).met).toBe(false);
  expect(groupResult(behaviour, gate([withUnstable("rg-behaviour", 63, 63)])).met).toBe(true);
  // pm-self: one MATCH is enough, none is not, whatever the percent.
  const pm = m7d[3]!;
  const one = groupResult(pm, gate([withUnstable("pm-self", 1, 282)]));
  expect([one.match, one.of, one.minMatch, one.met]).toEqual([1, 282, 1, true]);
  expect(groupResult(pm, gate([withUnstable("pm-self", 0, 282)])).met).toBe(false);
  // check-rg needs all 34 crates now: 33 is M7a's figure, not M7d's.
  const rg = m7d[2]!;
  const base = readFileSync(join(import.meta.dir, "..", "harness", "baseline", "check-rg.txt"), "utf8").split("\n").filter(Boolean);
  const lost = (ids: string[]) => groupResult(rg, gate([{ ...s("check-rg", 0, 36), lost: ids, gained: [] }]), [], new Map([["check-rg", base]]));
  expect([lost([]).match, lost([]).met]).toEqual([34, true]);
  expect([lost(["ripgrep-15.2.0|bstr"]).match, lost(["ripgrep-15.2.0|bstr"]).met]).toEqual([33, false]);
  expect(groupResult(group("M7a check-rg"), gate([{ ...s("check-rg", 0, 36), lost: ["ripgrep-15.2.0|bstr"], gained: [] }]), [], new Map([["check-rg", base]])).met).toBe(true);
});

test("each milestone gets its own verdict line, and the last line says what the exit status means (review harness-m7b-recheck note 1)", () => {
  // M7a and M7b met, M7c not: `--milestone M7` exits 1, which says nothing about M7a or M7b.
  const m7 = [
    { milestone: "M7a", met: true },
    { milestone: "M7a", met: true },
    { milestone: "M7b", met: true },
    { milestone: "M7c", met: false },
    { milestone: "M7c", met: true },
  ];
  expect(milestoneVerdicts(m7)).toEqual([
    "milestone M7a: met (2 of 2 groups met)",
    "milestone M7b: met (1 of 1 groups met)",
    "milestone M7c: not met (1 of 2 groups met)",
    "exit 1: not met: M7c; met all the same: M7a, M7b (read each milestone's line, not the exit status)",
  ]);
  expect(milestoneVerdicts(m7.slice(0, 3)).at(-1)).toBe("exit 0: every selected milestone is met (M7a, M7b)");
  expect(milestoneVerdicts([{ milestone: "M7c", met: false }]).at(-1)).toBe("exit 1: not met: M7c");
  // Every group's milestone is one the verdicts can name.
  expect(milestoneVerdicts(GROUPS.map((g) => ({ milestone: g.milestone, met: true }))).length).toBe(new Set(GROUPS.map((g) => g.milestone)).size + 1);
});

test("the percent groups naming one suite agree on excludeUnstable, so difftest's per-suite criterion can follow them (review harness-m7b-recheck note 3)", () => {
  const by = new Map<string, Set<boolean>>();
  for (const g of GROUPS) if (!g.count && !g.allCases) for (const suite of g.suites) by.set(suite, (by.get(suite) ?? new Set()).add(g.excludeUnstable === true));
  expect([...by].filter(([, v]) => v.size > 1).map(([k]) => k)).toEqual([]);
});

test("ENV leaves every denominator but an allCases group's, and is counted (plan-m8 §6, D19); a gate.json without the list has none", () => {
  const r = groupResult(miriPass, gate([{ ...s("miri-pass", 8, 13, ["a"]), env: ["e1", "e2"] }, s("miri-pass-heavy", 0, 0)]));
  expect([r.match, r.of, r.oracleTimeouts, r.env, r.met]).toEqual([8, 10, 1, 2, true]);
  expect("env" in groupResult(miriPass, gate([s("miri-pass", 8, 10), s("miri-pass-heavy", 0, 0)]))).toBe(false);
  // An allCases group counts every case: an ENV one is not left out.
  const ir = groupResult(group("ir-hello"), gate([{ ...s("ir-hello", 1, 2), env: ["b"] }]));
  expect([ir.of, ir.met, ir.env]).toEqual([2, false, undefined]);
});
