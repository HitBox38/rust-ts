// Oracle fixture tests through type checking (not a port; test helper).
//
// A fixture directory holds `<case>.rs` plus `<case>.stderr` / `<case>.exit`: the human-format stderr and exit status of
// the tydump probe (tools/probes/tydump, rustc-dev at the pin: `run_required_analyses` up to type checking), so only
// diagnostics up to typeck appear. `REGEN=1` rewrites the fixtures from the probe; nothing else writes them.
//
// `typeck_oracle_fixture_tests(label, dir, cases)` defines, at module scope of a test file:
// - one test asserting every fixture equals the live probe output (and that each case reports an error or a warning);
// - one test per case asserting the port's stderr and exit status (src/rust_ts/tydump.ts, the tydump suites' subject,
//   same stop point) equal the fixture byte for byte. stdout (the dump itself) is not compared here.
// Both run in the fixture directory with the file name as a relative path, so the fixtures carry no host paths. The
// arguments are those of the demand_adjust_test fixtures: `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>`
// (crates without `#![no_core]` load the pinned core/std metadata) `--edition=2021 --crate-type lib`; a case given as
// `{ name, edition }` uses that edition instead.
//
// Without the probe or the oracle toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SUBJECT = join(REPO, "src/rust_ts/tydump.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

interface Out {
  exit: number;
  stderr: string;
}

function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

/** A case: the file stem, optionally with the edition (default 2021). */
export type FixtureCase = string | { readonly name: string; readonly edition: string };

const case_name = (c: FixtureCase): string => (typeof c === "string" ? c : c.name);

const args = (s: string, c: FixtureCase): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  s,
  `--edition=${typeof c === "string" ? "2021" : c.edition}`,
  "--crate-type",
  "lib",
  `${case_name(c)}.rs`,
];

/** The oracle side: the tydump probe on `<dir>/<c>.rs`. */
function oracle(dir: string, s: string, c: FixtureCase): Out {
  return run([PROBE, ...args(s, c)], dir);
}

function expected(dir: string, c: string): Out {
  return {
    exit: Number(readFileSync(join(dir, `${c}.exit`), "utf8").trim()),
    stderr: readFileSync(join(dir, `${c}.stderr`), "utf8"),
  };
}

/** The probe and the oracle sysroot, or `undefined` (a skip; a failure under RUST_TS_REQUIRE_PROBES=1). */
function setup(): string | undefined {
  const s = existsSync(PROBE) ? sysroot() : undefined;
  if (s === undefined && REQUIRE) throw new Error("ERROR: tydump probe or oracle sysroot missing (bun scripts/probes.ts build tydump)");
  return s;
}

export function typeck_oracle_fixture_tests(label: string, dir: string, cases: readonly FixtureCase[]): void {
  if (REGEN) {
    const s = setup();
    if (s === undefined) throw new Error("ERROR: REGEN needs the tydump probe and the oracle sysroot");
    for (const c of cases) {
      const o = oracle(dir, s, c);
      writeFileSync(join(dir, `${case_name(c)}.stderr`), o.stderr);
      writeFileSync(join(dir, `${case_name(c)}.exit`), `${o.exit}\n`);
    }
  }

  test(`${label}: fixtures are the current oracle output`, () => {
    const s = setup();
    if (s === undefined) return;
    for (const c of cases) {
      const o = oracle(dir, s, c);
      // every case reports something (guards against a case that tests nothing)
      expect(o.stderr).toMatch(/^(error|warning)(\[E\d+\])?: /m);
      expect({ c, ...o }).toEqual({ c, ...expected(dir, case_name(c)) });
    }
  }, 120_000);

  for (const c of cases) {
    test(`${label}/${case_name(c)}.rs: the port's stderr and exit equal the oracle's`, () => {
      const s = setup();
      if (s === undefined) return;
      const r = run(["bun", SUBJECT, ...args(s, c)], dir);
      expect({ c, ...r }).toEqual({ c, ...expected(dir, case_name(c)) });
    }, 120_000);
  }
}
