import { expect, test } from "bun:test";
import { GROUPS, groupResult, type SuiteSummary } from "./criteria.ts";

const full = (MATCH: number, total: number, ORACLE_TIMEOUT = 0): SuiteSummary => ({ total, MATCH, ORACLE_TIMEOUT, sample: null, filter: null });
const miriPass = GROUPS.find((g) => g.name.endsWith("miri-pass"))!;
const of = (m: Record<string, SuiteSummary>) => (s: string) => m[s];

test("the figure sums the group: one suite's share can read met while the group is not, and the reverse", () => {
  const under = groupResult(miriPass, of({ "miri-pass": full(281, 350), "miri-pass-heavy": full(6, 10) }));
  expect([under.match, under.of, under.met]).toEqual([287, 360, false]);
  const over = groupResult(miriPass, of({ "miri-pass": full(279, 350), "miri-pass-heavy": full(10, 10) }));
  expect([over.match, over.of, over.met]).toEqual([289, 360, true]);
});

test("a suite missing from the run leaves the group not met, however good the rest is", () => {
  const r = groupResult(miriPass, of({ "miri-pass": full(350, 350) }));
  expect(r.met).toBe(false);
  expect(r.problems).toEqual(["miri-pass-heavy: not in this run"]);
});

test("a sample or filter run is not a full figure", () => {
  const sampled = { ...full(10, 10), sample: 10 };
  expect(groupResult(miriPass, of({ "miri-pass": sampled, "miri-pass-heavy": full(10, 10) })).met).toBe(false);
  const filtered = { ...full(10, 10), filter: "x" };
  expect(groupResult(miriPass, of({ "miri-pass": full(10, 10), "miri-pass-heavy": filtered })).problems).toEqual(["miri-pass-heavy: not a full run"]);
});

test("ORACLE_TIMEOUT leaves the denominator (plan-m6 A9); met is decided on the exact counts", () => {
  const r = groupResult(miriPass, of({ "miri-pass": full(8, 12, 2), "miri-pass-heavy": full(0, 0) }));
  expect([r.match, r.of, r.met]).toEqual([8, 10, true]);
  // 79.996% would round to 80 in the printed line, and is not met.
  const close = groupResult(miriPass, of({ "miri-pass": full(19999, 25000), "miri-pass-heavy": full(0, 0) }));
  expect([close.percent, close.met]).toEqual([80, false]);
});
