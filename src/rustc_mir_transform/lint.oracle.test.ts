// The `-Zlint-mir` pass (lint.rs, lane ctfe-util) end to end against the oracle: the mirdump probe (tools/probes/mirdump)
// and the ported driver (src/rust_ts/mirdump.ts) on the same files and argv (as validate.oracle.test.ts).
// - tests/ui/mir/lint/*.rs with `-Zlint-mir -Zeagerly-emit-delayed-bugs` (their own `-Ztreat-err-as-bug` turns the first
//   delayed bug into an ICE whose report prints the `#[track_caller]` location, which the port has not): the lint's
//   `broken MIR in ..` delayed bugs are emitted as errors, so stdout, stderr and the exit code must be identical.
//   no-storage / storage-live / storage-return are rejected (`visit_local`, `StorageLive`, `Return`);
//   assignment-overlap / call-overlap are `build-fail` tests whose MIR is only linted after optimizations (codegen),
//   so the dump accepts them.
// - validate_oracle/ctors.rs (lane mt-validate's fixture: constructors and small bodies) under `-Zlint-mir`: no false
//   positive, output identical.
// Skips (visibly) if the probe is missing; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "ctfe-util-lint-test", process.env.RUST_TS_AGENT ?? "default");

function probe(): string | undefined {
  try {
    const { probeBinary } = require("../../scripts/probes.ts") as typeof import("../../scripts/probes.ts");
    const p = probeBinary("mirdump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}
const PROBE = probe();
if (PROBE === undefined && !REQUIRE) console.log("SKIP: mirdump probe missing (bun scripts/probes.ts build mirdump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"]).stdout.toString().trim());

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
function both(file: string, cwd: string, extra: string[]): [Out, Out] {
  mkdirSync(WORK, { recursive: true });
  const args = [file, "--sysroot", sysroot(), "--target=x86_64-unknown-linux-gnu", "--edition=2021", "--emit", "metadata", "--out-dir", WORK, ...extra];
  return [run([PROBE!, ...args], cwd), run([process.execPath, join(REPO, "src/rust_ts/mirdump.ts"), ...args], cwd)];
}
function check_probe(): boolean {
  if (PROBE === undefined) {
    if (REQUIRE) throw new Error("ERROR: mirdump probe missing (bun scripts/probes.ts build mirdump)");
    return false;
  }
  return true;
}

const LINT: [string, boolean][] = [
  ["no-storage", true],
  ["storage-live", true],
  ["storage-return", true],
  ["assignment-overlap", false],
  ["call-overlap", false],
];
for (const [t, rejected] of LINT) {
  test(`tests/ui/mir/lint/${t}.rs under -Zlint-mir: output equals the probe's${rejected ? " (broken MIR)" : ""}`, () => {
    if (!check_probe()) return;
    const [o, p] = both(`tests/ui/mir/lint/${t}.rs`, UPSTREAM, ["--crate-type=lib", "-Zlint-mir", "-Zeagerly-emit-delayed-bugs"]);
    expect(o.code).toBe(rejected ? 1 : 0);
    if (rejected) expect(o.stderr).toContain("error: broken MIR in ");
    else expect(o.stderr).not.toContain("broken MIR");
    expect(p.stderr).toBe(o.stderr);
    expect(p.stdout).toBe(o.stdout);
    expect(p.code).toBe(o.code);
  }, 120_000);
}

test("constructors and small bodies under -Zlint-mir: mirdump output equals the probe's", () => {
  if (!check_probe()) return;
  const fixtures = join(import.meta.dir, "validate_oracle");
  const [o, p] = both(join(fixtures, "ctors.rs"), fixtures, ["-Zlint-mir"]);
  expect(o.code).toBe(0);
  expect(p.stderr).toBe(o.stderr);
  expect(p.stdout).toBe(o.stdout);
  expect(p.code).toBe(o.code);
}, 120_000);
