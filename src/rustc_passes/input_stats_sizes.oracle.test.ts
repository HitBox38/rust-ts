// The committed input_stats_sizes.gen.ts must be what tools/gen-input-stats-sizes.ts renders from the `nodesizes`
// probe now (the oracle compiler's own `size_of::<T>()` of the AST and HIR types `-Zinput-stats` measures). Skips
// visibly when the probe is not built; RUST_TS_REQUIRE_PROBES=1 (the gate) makes that a failure of this one test, not
// an exit of the whole `bun test` process (probePath would `die`).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { probeBinary } from "../../scripts/probes.ts";
import { GEN_FILE, probeOutput, render } from "../../tools/gen-input-stats-sizes.ts";
import { NODE_SIZES } from "./input_stats_sizes.gen.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(probeBinary("nodesizes")) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: nodesizes probe not built (bun scripts/probes.ts build nodesizes); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

test.skipIf(SKIP)("input_stats_sizes.gen.ts is what the nodesizes probe prints (not stale)", () => {
  expect([probeBinary("nodesizes"), existsSync(probeBinary("nodesizes"))]).toEqual([probeBinary("nodesizes"), true]);
  expect(readFileSync(GEN_FILE, "utf8")).toBe(render(probeOutput()));
});

test("render parses strictly", () => {
  expect(() => render("hir::Item 88")).toThrow("newline");
  expect(() => render("hir::Item 88\nhir::Item 88\n")).toThrow("duplicate");
  expect(() => render("hir::Item 0x58\n")).toThrow("unexpected line");
  expect(() => render("")).toThrow();
  expect(render("hir::Item 88\n")).toContain(`"hir::Item": 88,`);
});

/** A `size_of::<T>()`: a non-negative integer (zero for a ZST). */
const is_size = (v: number): boolean => Number.isInteger(v) && v >= 0;

test("is_size admits a ZST's zero and nothing else odd", () => {
  expect([0, 1, 88].map(is_size)).toEqual([true, true, true]);
  expect([-1, 0.5, Number.NaN].map(is_size)).toEqual([false, false, false]);
});

test("every size is a non-negative integer", () => {
  for (const [k, v] of Object.entries(NODE_SIZES)) expect([k, is_size(v)]).toEqual([k, true]);
});
