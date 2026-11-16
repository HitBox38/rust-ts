// scripts/lib/protect.ts (plan-m8 D19, lane harness-m8a-gate): "never protected" made mechanical. `gate.ts accept` writes into
// harness/baseline, so its decisions are tested here, on `planAccept` with fake inputs; scripts/gate-headroom.test.ts runs `gate run`'s
// refusal and scripts/difftest-env.test.ts the ENV status end to end.
import { describe, expect, test } from "bun:test";
import { matchIdsOfJsonl, neverProtectBaselineErrors, planAccept, type AcceptInputs, type ProtectSuite } from "./protect.ts";

const jsonl = (rows: { id: string; status: string }[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

describe("matchIdsOfJsonl: the only ids accept may protect", () => {
  test("MATCH only: ENV, UNSTABLE, ORACLE_TIMEOUT and the rest never", () => {
    const text = jsonl([
      { id: "a", status: "MATCH" },
      { id: "b", status: "ENV" },
      { id: "c", status: "UNSTABLE" },
      { id: "d", status: "ORACLE_TIMEOUT" },
      { id: "e", status: "DIFF" },
      { id: "f", status: "MATCH" },
    ]);
    expect([...matchIdsOfJsonl(text)].sort()).toEqual(["a", "f"]);
  });
  test("a run that is all ENV protects nothing", () => {
    expect(matchIdsOfJsonl(jsonl([{ id: "x", status: "ENV" }, { id: "y", status: "ENV" }])).size).toBe(0);
    expect(matchIdsOfJsonl("").size).toBe(0);
  });
});

describe("neverProtectBaselineErrors: gate run and accept refuse a neverProtect suite with a baseline file", () => {
  const suites: ProtectSuite[] = [{ name: "plain" }, { name: "report", neverProtect: "plan-m8 D23" }, { name: "lane", neverProtect: "always" }];
  test("one line per such suite, naming it, its decision and its baseline file", () => {
    const e = neverProtectBaselineErrors(suites, (n) => n !== "lane");
    expect(e.length).toBe(1);
    expect(e[0]).toContain("suite report is never protected (neverProtect: plan-m8 D23)");
    expect(e[0]).toContain("harness/baseline/report.txt");
    expect(e[0]!.includes("\n")).toBe(false);
    expect(neverProtectBaselineErrors(suites, () => true).length).toBe(2);
  });
  test("a protected suite with a baseline, or a neverProtect one without: nothing", () => {
    expect(neverProtectBaselineErrors(suites, (n) => n === "plain")).toEqual([]);
    expect(neverProtectBaselineErrors(suites, () => false)).toEqual([]);
  });
});

describe("planAccept", () => {
  /** Inputs over `defs`, protected sets `bases` and run MATCHes `runs`; `read` records every suite whose matches or baseline were read. */
  function inputs(defs: ProtectSuite[], bases: Record<string, string[]>, runs: Record<string, string[]>, unstable: Record<string, string[]> = {}) {
    const read: string[] = [];
    const inp: AcceptInputs = {
      suite: (n) => {
        const s = defs.find((d) => d.name === n);
        if (s === undefined) throw new Error(`unknown suite ${n}`);
        return s;
      },
      baseline: (n) => {
        read.push(`baseline ${n}`);
        return new Set(bases[n] ?? []);
      },
      matches: (n) => {
        read.push(`matches ${n}`);
        return new Set(runs[n] ?? []);
      },
      unstable: (n, base) => (unstable[n] ?? []).filter((id) => base.has(id)),
    };
    return { inp, read };
  }

  test("accept skips a neverProtect suite's matches, whatever the run's suites were", () => {
    const { inp, read } = inputs([{ name: "p" }, { name: "r", neverProtect: "report until D23" }], { p: ["a"] }, { p: ["a", "b"], r: ["x", "y"] });
    const plan = planAccept("run", ["p", "r"], inp);
    expect("refusal" in plan).toBe(false);
    if ("refusal" in plan) return;
    expect(plan.skipped).toEqual([{ suite: "r", why: "report until D23" }]);
    expect(plan.grown.map((g) => [g.suite, [...g.base].sort(), g.before])).toEqual([["p", ["a", "b"], 1]]);
    // Its matches and baseline are never read, so nothing about it can be written.
    expect(read).toEqual(["baseline p", "matches p"]);
  });

  test("a run of only a neverProtect suite grows nothing", () => {
    const { inp } = inputs([{ name: "r", neverProtect: "x" }], {}, { r: ["m"] });
    const plan = planAccept("run", ["r"], inp);
    expect(plan).toEqual({ grown: [], skipped: [{ suite: "r", why: "x" }] });
  });

  test("a loss refuses the whole run before anything is written; so does an unstable case", () => {
    const lost = planAccept("run", ["p", "q"], inputs([{ name: "p" }, { name: "q" }], { q: ["gone"] }, { p: ["a"], q: [] }).inp);
    expect(lost).toEqual({ refusal: "gate run run: q results lose 1 protected case(s) (e.g. gone)" });
    const unstable = planAccept("run", ["p"], inputs([{ name: "p" }], {}, { p: ["u"] }, { p: ["u"] }).inp);
    expect("refusal" in unstable && unstable.refusal).toContain("would protect 1 case(s) the suite lists as unstable (e.g. u)");
  });

  test("an unknown suite name throws, as getSuite does", () => {
    expect(() => planAccept("run", ["nope"], inputs([], {}, {}).inp)).toThrow("unknown suite nope");
  });
});
