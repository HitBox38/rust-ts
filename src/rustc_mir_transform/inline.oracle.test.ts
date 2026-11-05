// `Inline` end to end against the oracle: `-Zunpretty=mir` on the same file and argv, at the levels that run the pass.
// docs/reviews/mono-lanes.md O2: `map_unwind` gave every mapped `UnwindAction::Continue` the one `cleanup_block` object, and
// `remove_dead_blocks` then renumbered it once per edge, so MIR validation failed where the oracle passes.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import { caseEnv } from "../../scripts/lib/env.ts";
import { oracleRustcCmd, oracleSysroot } from "../../scripts/lib/oracle.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
function sysroot(): string | undefined {
  try {
    return oracleSysroot();
  } catch {
    return undefined;
  }
}
const SYSROOT = sysroot();
const SKIP = SYSROOT === undefined && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const FIXTURES = join(import.meta.dir, "inline_oracle");
const env = (): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...caseEnv({ RUSTC_ICE: "0", RUST_BACKTRACE: "0" }) })) {
    if (typeof v === "string") merged[k] = v;
  }
  return merged;
};
function run(cmd: string[]): { stdout: string; stderr: string; code: number } {
  const r = Bun.spawnSync(cmd, { cwd: FIXTURES, env: env(), stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}

test.skipIf(SKIP)(
  "shared_unwind.rs at -Copt-level=2: the inlined unwind edges keep their cleanup block",
  () => {
    const args = ["shared_unwind.rs", "--edition=2021", "--target=x86_64-unknown-linux-gnu", "--sysroot", SYSROOT!, "-Zwrite-long-types-to-disk=no", "-Zunpretty=mir", "-Copt-level=2"];
    const oracle = run(oracleRustcCmd(args));
    const port = run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args]);
    // The program does reach the path: the second inlined call is in `main`.
    expect(oracle.code).toBe(0);
    expect(oracle.stdout).toContain("Builder::spawn_unchecked::<");
    expect(port.stderr).toBe(oracle.stderr);
    expect(port.stdout === oracle.stdout).toBe(true);
    expect(port.code).toBe(oracle.code);
  },
  300_000,
);
