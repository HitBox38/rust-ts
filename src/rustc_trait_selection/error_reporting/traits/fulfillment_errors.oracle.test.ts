// Oracle regression tests for lane ui-diffs-20: `TypeErrCtxt::error_implies` / `trait_error_implies_projection_error`
// (fulfillment_errors.rs:1595 / :1638) compare `Goal`s and their `ParamEnv`s with the derived `PartialEq`, i.e. by the
// interned `caller_bounds` list (`ParamEnv_eq`), not by the identity of the `ParamEnv` wrapper object. Comparing the
// wrapper made `report_fulfillment_errors` (traits/mod.rs) suppress nothing when two errors carried equal param-envs
// built separately: duplicate errors (an extra E0277/E0271 after the oracle's last error) and, when the suppressed
// error came first, the wrong goal or closure error reported.
//
// Oracle: the tydump probe (tools/probes/tydump, rustc-dev); subject: src/rust_ts/tydump.ts. The cases are the
// tests/ui files where the tydump-ui suite found the DIFFs (docs/handoff/harness-w20.md, items 1-5), compiled against
// the oracle's std with `-Zdeduplicate-diagnostics=no` (as compiletest; the default would hide exact duplicates).
// stdout, stderr and the exit code must be identical.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO, UPSTREAM } from "../../../../scripts/lib/common.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: tydump probe not built (bun scripts/probes.ts build tydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const SUBJECT = join(REPO, "src/rust_ts/tydump.ts");

function sysroot(): string {
  const { oracleSysroot } = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
  return oracleSysroot();
}

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP"].includes(k)) ENV[k] = v;
}
ENV.RUSTC_ICE = "0";
ENV.RUST_BACKTRACE = "0";

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: UPSTREAM, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

/** tests/ui file, its revision's flags. */
const CASES: [string, string[]][] = [
  // An extra E0277 `Foo: Bound` (two param-env clauses normalizing the same alias).
  ["tests/ui/traits/next-solver/cycles/normalizes-to-is-not-productive.rs", ["-Znext-solver"]],
  // An extra E0271 `Foo<fn(&())>::Assoc == &()`.
  ["tests/ui/traits/next-solver/implied_outlives_bounds_not_resolving_vars_ice.rs", ["-Znext-solver"]],
  // An extra E0277 `dyn Iterator<..>` is not `Sized`.
  ["tests/ui/traits/dyn-iterator-deref-in-for-loop.rs", ["-Znext-solver", "--cfg", "next"]],
  // `T: PartialOrd` must be reported, not `T: PartialEq`.
  ["tests/ui/traits/non_lifetime_binders/foreach-partial-eq-next-solver.rs", ["-Znext-solver=globally"]],
  // `Fn()` closure errors for `extern "C" fn` / `unsafe fn`, not `FnOnce()`.
  ["tests/ui/traits/next-solver/fn-trait.rs", ["-Znext-solver"]],
];

for (const [file, flags] of CASES) {
  test.skipIf(SKIP)(`error_implies (ui-diffs-20) oracle: ${file} ${flags.join(" ")}`, async () => {
    const args = [file, "--sysroot", sysroot(), "--edition=2021", "-Zdeduplicate-diagnostics=no", ...flags];
    const [oracle, subject] = await Promise.all([run([PROBE, ...args]), run(["bun", SUBJECT, ...args])]);
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.stdout).toBe(oracle.stdout);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
