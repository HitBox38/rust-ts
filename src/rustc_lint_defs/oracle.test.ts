// The generated `declare_lint!` statics (builtin.gen.ts) against the oracle's lint table:
// `rustc +nightly --edition <e> -W help` prints every registered lint as `name  default  meaning`
// (rustc_driver_impl describe_lints: `name_lower()` with `_` -> `-`, `default_level(sess.edition()).as_str()`,
// `desc`), sorted by `(default_level, name)`, then the lint groups. The table also lists lints of other
// crates (rustc_lint, ...); only the builtin.rs ones are matched. Skips (visibly) when rustc is
// unavailable, fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { PIN } from "../../scripts/lib/common.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { FutureIncompatibilityReason, Level, Level_discriminant, Lint } from "./lib.ts";
import * as builtin from "./builtin.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const EDITIONS: [string, Edition][] = [
  ["2015", "Edition2015"],
  ["2018", "Edition2018"],
  ["2021", "Edition2021"],
  ["2024", "Edition2024"],
];

// Review w456b L1: the oracle is only the pinned toolchain; a drifted `+${PIN.toolchain}` is "unavailable".
function rustcAtPin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const AT_PIN = rustcAtPin();

function oracleHelp(edition: string): string | undefined {
  if (!AT_PIN) return undefined;
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--edition", edition, "-W", "help"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) return undefined;
    return r.stdout.toString().replaceAll("\r\n", "\n");
  } catch {
    return undefined;
  }
}

const AVAILABLE = oracleHelp("2015") !== undefined;
const SKIP = !AVAILABLE && !REQUIRE_PROBES;
if (SKIP) console.log(`SKIP: rustc +${PIN.toolchain} at ${PIN.commit.slice(0, 12)} -W help unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

/** Every `Lint` static exported by builtin.gen.ts, in declaration order. */
function builtinLints(): Lint[] {
  return Object.values(builtin).filter((v): v is Lint => typeof v === "object" && v !== null && "default_level" in v && "desc" in v);
}

/// Declared in builtin.rs but registered by no `LintStore` at the pin, so `-W help` does not list them:
/// PRIVATE_MACRO_USE (rustc_resolve) and UNSAFE_PANIC_HANDLERS (rustc_hir_typeck) are emitted but are not
/// in `hardwired::lint_vec`; UNSUPPORTED_FN_PTR_CALLING_CONVENTIONS is `register_removed` (rustc_lint lib.rs).
const NOT_REGISTERED = ["PRIVATE_MACRO_USE", "UNSAFE_PANIC_HANDLERS", "UNSUPPORTED_FN_PTR_CALLING_CONVENTIONS"];

interface Row {
  level: string;
  desc: string;
  index: number;
}

/** The "Lint checks provided by rustc:" table and the "Lint groups provided by rustc:" members. */
function parseHelp(help: string): { rows: Map<string, Row>; groups: Map<string, string[]> } {
  const lines = help.split("\n");
  const section = (title: string): string[] => {
    let i = lines.indexOf(title);
    expect(i).toBeGreaterThanOrEqual(0);
    i++;
    while (lines[i] === "") i++;
    i += 2; // header + dashes
    const out: string[] = [];
    for (; i < lines.length && lines[i] !== ""; i++) out.push(lines[i]!);
    return out;
  };
  const rows = new Map<string, Row>();
  for (const line of section("Lint checks provided by rustc:")) {
    const m = /^\s*(\S+)  (\S+)\s+(.*)$/.exec(line);
    expect(m).not.toBeNull();
    rows.set(m![1]!, { level: m![2]!, desc: m![3]!, index: rows.size });
  }
  const groups = new Map<string, string[]>();
  for (const line of section("Lint groups provided by rustc:")) {
    const m = /^\s*(\S+)  (.*)$/.exec(line);
    expect(m).not.toBeNull();
    groups.set(m![1]!, m![2]!.split(", "));
  }
  return { rows, groups };
}

const dashed = (l: Lint): string => Lint.name_lower(l).replaceAll("_", "-");

for (const [ed, edition] of EDITIONS) {
  test.skipIf(SKIP)(`builtin.gen.ts lints match \`rustc --edition ${ed} -W help\` (name, default level, desc, order)`, () => {
    const help = oracleHelp(ed);
    if (help === undefined) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} -W help unavailable and RUST_TS_REQUIRE_PROBES=1`);
    const { rows } = parseHelp(help);
    const lints = builtinLints();
    expect(lints.length).toBe(153);
    const mismatches: string[] = [];
    const seen: Lint[] = [];
    for (const lint of lints) {
      const row = rows.get(dashed(lint));
      if (NOT_REGISTERED.includes(lint.name)) {
        if (row !== undefined) mismatches.push(`${dashed(lint)}: listed by -W help, expected unregistered`);
        continue;
      }
      if (row === undefined) {
        mismatches.push(`${dashed(lint)}: missing from -W help`);
        continue;
      }
      seen.push(lint);
      // describe_lints: `lint.default_level(sess.edition()).as_str()`
      const level = Level.as_str(Lint.default_level(lint, edition));
      if (row.level !== level) mismatches.push(`${dashed(lint)}: default ${level}, oracle ${row.level}`);
      // describe_lints prints `desc` with `{}` (the table is not wrapped)
      if (row.desc !== lint.desc) mismatches.push(`${dashed(lint)}: desc ${JSON.stringify(lint.desc)}, oracle ${JSON.stringify(row.desc)}`);
    }
    expect(mismatches).toEqual([]);
    expect(seen.length).toBe(lints.length - NOT_REGISTERED.length);
    // the HardwiredLints list and the builtin.rs pass are registered (rustc_lint register_builtins)
    for (const l of [...builtin.hardwired.lint_vec(), ...new builtin.UnusedDocComment().get_lints()]) expect(seen).toContain(l);
    // sort_lints: `sort_by_cached_key(|x| (x.default_level(sess.edition()), x.name))`; our subset must
    // appear in the same relative order as the oracle's table.
    const key = (l: Lint): [number, string] => [Level_discriminant[Lint.default_level(l, edition)], l.name];
    const sorted = [...seen].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
    });
    const byOracle = [...seen].sort((a, b) => rows.get(dashed(a))!.index - rows.get(dashed(b))!.index);
    expect(byOracle.map((l) => l.name)).toEqual(sorted.map((l) => l.name));
  });
}

test.skipIf(SKIP)("future_incompatible lints are in the oracle's future-incompatible / rust-20xx-compatibility groups", () => {
  const help = oracleHelp("2015");
  if (help === undefined) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} -W help unavailable and RUST_TS_REQUIRE_PROBES=1`);
  const { groups } = parseHelp(help);
  const problems: string[] = [];
  let n = 0;
  for (const lint of builtinLints()) {
    if (NOT_REGISTERED.includes(lint.name) || lint.future_incompatible === undefined) continue;
    n++;
    // rustc_lint context.rs register_lints: `reason.edition()` → `edition.lint_name()` group, else `future_incompatible`
    const e = FutureIncompatibilityReason.edition(lint.future_incompatible.reason);
    const group = e === undefined ? "future-incompatible" : `rust-${e.slice("Edition".length)}-compatibility`;
    if (!groups.get(group)?.includes(dashed(lint))) problems.push(`${dashed(lint)} not in ${group}`);
    for (const [g, members] of groups) {
      if (g !== group && (g === "future-incompatible" || /^rust-\d+-compatibility$/.test(g)) && members.includes(dashed(lint))) {
        problems.push(`${dashed(lint)} unexpectedly in ${g}`);
      }
    }
  }
  expect(problems).toEqual([]);
  expect(n).toBeGreaterThan(50);
});
