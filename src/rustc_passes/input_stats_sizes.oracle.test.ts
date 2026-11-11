// The committed input_stats_sizes.gen.ts must be what tools/gen-input-stats-sizes.ts renders from the `nodesizes`
// probe now (the oracle compiler's own `size_of::<T>()` of the AST and HIR types `-Zinput-stats` measures). Skips
// visibly when the probe is not built; RUST_TS_REQUIRE_PROBES=1 (the gate) makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { probeBinary } from "../../scripts/probes.ts";
import { GEN_FILE, probeOutput, render } from "../../tools/gen-input-stats-sizes.ts";
import { NODE_SIZES } from "./input_stats_sizes.gen.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(probeBinary("nodesizes")) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: nodesizes probe not built (bun scripts/probes.ts build nodesizes); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

test.skipIf(SKIP)("input_stats_sizes.gen.ts is what the nodesizes probe prints (not stale)", () => {
  expect(readFileSync(GEN_FILE, "utf8")).toBe(render(probeOutput()));
});

test("render parses strictly", () => {
  expect(() => render("hir::Item 88")).toThrow("newline");
  expect(() => render("hir::Item 88\nhir::Item 88\n")).toThrow("duplicate");
  expect(() => render("hir::Item 0x58\n")).toThrow("unexpected line");
  expect(() => render("")).toThrow();
  expect(render("hir::Item 88\n")).toContain(`"hir::Item": 88,`);
});

test("every size is a positive integer", () => {
  for (const [k, v] of Object.entries(NODE_SIZES)) expect([k, Number.isInteger(v) && v > 0]).toEqual([k, true]);
});
