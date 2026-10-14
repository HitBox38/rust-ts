// Oracle tests of lane query-growth: query cycles reported through the real driver.
//
// cycle_oracle/run.ts runs the ported driver on each case with stand-in providers for the analysis queries a cycle
// goes through (see its header); the cycle detection, `create_cycle_error`, the `Cycle` diagnostic, the
// `check_representability` cycle handler (`recursive_type_error`, E0072), the query descriptions and `def_path_str`
// are the real ones. Its stderr and exit code must equal the pinned rustc's on the same file (fixture
// `<case>.stderr`; `REGEN=1` rewrites the fixtures from the oracle, which is re-checked on every run when present).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "cycle_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** Each case and the extra flags it runs with. */
const CASES: readonly { c: string; flags?: readonly string[] }[] = [
  // E0391 through `type_of` (type alias cycles: one, two and three frames).
  { c: "type_alias1" },
  { c: "type_alias" },
  { c: "type_alias3" },
  // `description` with `-Zverbose-internals` appends `[{name:?}]`.
  { c: "type_alias", flags: ["-Zverbose-internals"] },
  // E0391 through `explicit_implied_clauses_of` (trait alias cycle).
  { c: "trait_alias" },
  // E0072 from the `check_representability` cycle handler.
  { c: "rec1" },
  { c: "rec2" },
  { c: "rec3" },
  { c: "rec6" },
  { c: "rec_enum" },
  { c: "rec_alias" },
];
type Case = (typeof CASES)[number];

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string, { c, flags }: Case): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zui-testing",
  ...(flags ?? []),
  `${c}.rs`,
];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

const fixture_path = ({ c, flags }: Case): string => join(DIR, `${c}${flags?.length ? `.${flags.join("").replace(/^-Z/, "")}` : ""}.stderr`);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c)]);
    if (r.exit !== 1) throw new Error(`ERROR: oracle exit ${r.exit} on ${c.c}.rs`);
    writeFileSync(fixture_path(c), r.stderr);
  }
}

test("cycle_oracle fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c)]);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 1, stderr: readFileSync(fixture_path(c), "utf8") });
  }
}, 120_000);

for (const c of CASES) {
  test(`cycle_oracle/${c.c}.rs${c.flags ? ` ${c.flags.join(" ")}` : ""}: the cycle report matches the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 1, stderr: readFileSync(fixture_path(c), "utf8") });
  }, 120_000);
}
