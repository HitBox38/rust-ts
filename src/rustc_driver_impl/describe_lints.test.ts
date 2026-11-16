// Tests of src/rustc_driver_impl/lib.ts `describe_lints` (lib.rs:974) with lints a tool registered (`-W help` under a tool
// driver such as clippy-driver; lane clippy-fix-a). Upstream's second `let max_name_len` / `let padded` shadow the first, so the
// loaded-lints table keeps the lint-name width and only the group tables use the group-name width.
//
// Each case runs the port's `rustc -W help` in a child (describe_lints_test/run.ts) with a fake tool whose lints and groups
// come through `Config.register_lints`:
// - two constructed cases, whose expected text follows upstream's format code (`{padded}  {:7.7}  {desc}` rows, two `\n`s
//   after each table): a tool lint name longer than its group names (the case that threw `RangeError` before the fix) and a
//   group name longer than the tool's lint names (the case that padded the loaded lints to the group width);
// - the pinned clippy-driver's `-W help` (tool oracle, plan-m8 D2), byte for byte, with a fake tool that registers the lints
//   and groups the oracle lists (names, default levels, descriptions, members in order), registered in reverse order so the
//   port's own sort is what orders them. Skipped visibly when the tool oracle is not installed; RUST_TS_REQUIRE_PROBES=1 makes
//   that a failure.
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const RUN = join(import.meta.dir, "describe_lints_test", "run.ts");
const WORK = test_scratch_dir("describe-lints");
let n = 0;

interface Spec {
  lints: [string, string, string][];
  groups: [string, string[]][];
}

function run_port(spec: Spec): string {
  const file = join(WORK, `spec-${n++}.json`);
  writeFileSync(file, JSON.stringify(spec));
  const r = Bun.spawnSync(["bun", RUN, file], { stdout: "pipe", stderr: "pipe" });
  const stderr = r.stderr.toString();
  if (r.exitCode !== 0) throw new Error(`ERROR: port -W help exited ${r.exitCode}: ${stderr.split("\n").slice(0, 5).join(" | ")}`);
  expect(stderr).toBe("");
  return r.stdout.toString();
}

/** `padded(x)` of upstream: `x` right-aligned to `width` chars. */
const pad = (x: string, width: number): string => " ".repeat(width - [...x].length) + x;
/** `{:7.7}` */
const w7 = (s: string): string => s.slice(0, 7).padEnd(7);

/** The rows of the table after `title` (its two header rows included), up to its first empty line. */
function table(text: string, title: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(title);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(lines[at + 1]).toBe("");
  const rows: string[] = [];
  for (let i = at + 2; i < lines.length && lines[i] !== ""; i++) rows.push(lines[i]!);
  return rows;
}

/** The width every row of a `-W help` table pads its first column to: all rows must agree. */
function column_width(rows: readonly string[]): number {
  // the first column is right-aligned: its end is the first two spaces after its first non-space
  const widths = new Set(rows.map((r) => r.slice(4).indexOf("  ", r.slice(4).search(/\S/))));
  expect(widths.size).toBe(1);
  return [...widths][0]!;
}

/** Upstream's text from "Lint checks loaded by this crate:" to the end, for `lints` (already in `sort_lints` order) and
 *  `groups` (in `sort_lint_groups` order), the lint column `lw` and the group column `gw` wide. */
function loaded_sections(lints: Spec["lints"], groups: Spec["groups"], lw: number, gw: number): string {
  const name = (s: string) => s.toLowerCase().replaceAll("_", "-");
  let s = "Lint checks loaded by this crate:\n\n";
  s += `    ${pad("name", lw)}  ${w7("default")}  meaning\n`;
  s += `    ${pad("----", lw)}  ${w7("-------")}  -------\n`;
  for (const [n, level, desc] of lints) s += `    ${pad(name(n), lw)}  ${w7(level.toLowerCase())}  ${desc}\n`;
  s += "\n\n";
  s += "Lint groups loaded by this crate:\n\n";
  s += `    ${pad("name", gw)}  sub-lints\n`;
  s += `    ${pad("----", gw)}  ---------\n`;
  for (const [g, members] of groups) s += `    ${pad(name(g), gw)}  ${members.map(name).join(", ")}\n`;
  s += "\n\n";
  return s;
}

function check_constructed(spec: Spec, lw: number, gw: number): void {
  const out = run_port(spec);
  // Every rustc table is padded to the widest name of the builtin and loaded ones together; the fake names are the widest.
  expect(column_width(table(out, "Lint checks provided by rustc:"))).toBe(lw);
  expect(column_width(table(out, "Lint groups provided by rustc:"))).toBe(gw);
  const at = out.indexOf("Lint checks loaded by this crate:");
  expect(at).toBeGreaterThan(0);
  // `sort_lints`: by (default level, name): Allow < Warn; `sort_lint_groups`: by name
  const lints = [...spec.lints].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] === "Allow" ? -1 : 1));
  const groups = [...spec.groups].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  expect(out.slice(at)).toBe(loaded_sections(lints, groups, lw, gw));
}

const LONG_LINT = "faketool::A_TOOL_LINT_WHOSE_NAME_IS_LONGER_THAN_EVERY_BUILTIN_LINT_AND_GROUP_NAME";
const SHORT_LINT = "faketool::SHORT";
const LONG_GROUP = "faketool::a_tool_group_whose_name_is_longer_than_every_lint_name_builtin_or_loaded_by_far";

test("describe_lints: a tool lint name longer than every group name keeps the lint-name width in the loaded table", () => {
  const spec: Spec = {
    lints: [
      [SHORT_LINT, "Warn", "a short one"],
      [LONG_LINT, "Allow", "a long one"],
    ],
    // registered out of `sort_lints` / `sort_lint_groups` order, so the output's order is the port's sort (review N1)
    groups: [
      ["faketool::g", [LONG_LINT]],
      ["faketool::all", [SHORT_LINT, LONG_LINT]],
    ],
  };
  const gw = Math.max("warnings".length, "faketool::all".length, column_width_of_builtin_groups());
  expect(LONG_LINT.length).toBeGreaterThan(gw);
  check_constructed(spec, LONG_LINT.length, gw);
});

test("describe_lints: a tool group name longer than every lint name pads only the group tables to it", () => {
  const spec: Spec = {
    lints: [
      [SHORT_LINT, "Warn", "a short one"],
      [LONG_LINT, "Allow", "a long one"],
    ],
    groups: [[LONG_GROUP, [LONG_LINT, SHORT_LINT]]],
  };
  expect(LONG_GROUP.length).toBeGreaterThan(LONG_LINT.length);
  check_constructed(spec, LONG_LINT.length, LONG_GROUP.length);
});

let builtin_group_width: number | undefined;
/** The builtin groups' column width with no tool group wider: the port's own plain `-W help` (a tool with no groups). */
function column_width_of_builtin_groups(): number {
  if (builtin_group_width === undefined) {
    const out = run_port({ lints: [], groups: [] });
    expect(out.endsWith("\n\nThis crate does not load any additional lints or lint groups.\n")).toBe(true);
    builtin_group_width = column_width(table(out, "Lint groups provided by rustc:"));
  }
  return builtin_group_width;
}

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

test("describe_lints: the port's -W help with a tool's lints equals the pinned clippy-driver -W help byte for byte", async () => {
  const { toolOracleCmd, toolOracleEnv, verifyToolOracles } = await import("../../scripts/lib/oracle.ts");
  const cmd = toolOracleCmd("clippy", "clippy-driver", ["-W", "help"]);
  if (!existsSync(cmd[0]!)) {
    if (REQUIRE) throw new Error(`ERROR: clippy tool oracle not installed (${cmd[0]}) and RUST_TS_REQUIRE_PROBES=1`);
    console.log(`SKIP: clippy tool oracle not installed (${cmd[0]}); RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
    return;
  }
  verifyToolOracles();
  const oracle = Bun.spawnSync(cmd, { env: { ...process.env, ...toolOracleEnv() }, stdout: "pipe", stderr: "pipe" });
  expect(oracle.exitCode).toBe(0);
  const want = oracle.stdout.toString();

  // The fake tool registers what the oracle lists: `{padded}  {level:7.7}  {desc}` rows and `{padded}  {members}` rows.
  const upper = (s: string) => {
    const [tool, name] = s.split("::");
    return `${tool}::${name!.replaceAll("-", "_").toUpperCase()}`;
  };
  const level = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
  const lint_rows = table(want, "Lint checks loaded by this crate:").slice(2);
  const lw = column_width(lint_rows);
  const lints = lint_rows.map((r): [string, string, string] => [upper(r.slice(4, 4 + lw).trimStart()), level(r.slice(6 + lw, 13 + lw).trimEnd()), r.slice(15 + lw)]);
  const group_rows = table(want, "Lint groups loaded by this crate:").slice(2);
  const gw = column_width(group_rows);
  const groups = group_rows.map((r): [string, string[]] => [r.slice(4, 4 + gw).trimStart(), r.slice(6 + gw).split(", ").map(upper)]);
  expect(lints.length).toBeGreaterThan(800);
  // The case that threw before the fix: tool lint names wider than every group name.
  expect(lw).toBeGreaterThan(gw);

  // Registered in reverse of the oracle's (sorted) order, so a missing `sort_lints` / `sort_lint_groups` of the loaded lints
  // and groups shows (`LintStore` keeps registration order; review N1). Each group's members keep their order: describe_lints
  // prints them as registered.
  expect(run_port({ lints: [...lints].reverse(), groups: [...groups].reverse() })).toBe(want);
});
