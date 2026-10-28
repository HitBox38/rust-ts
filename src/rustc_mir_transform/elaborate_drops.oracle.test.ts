// Oracle check of `ElaborateDrops` (lane mt-drops: elaborate_drops.ts + elaborate_drop.ts) against the pinned nightly
// rustc: the `-Zdump-mir=ElaborateDrops` before/after files of every fn body.
//
// The fixture elaborate_drops_oracle/drops.rs (std crate) is compiled by the oracle with
//   --crate-type=lib --edition=2021 -Zdump-mir=ElaborateDrops -Zdump-mir-exclude-pass-number --emit=mir
// and by the test driver elaborate_drops_oracle/run.ts (see its header: the real `mir_promoted` bodies, test-only
// stand-ins for the still-stubbed analysis cleanup passes, the real `SimplifyCfg::PostAnalysis` and `ElaborateDrops`
// run through the pass manager, whose dump hooks write the files). Both directories must hold the same files with the
// same bytes: the `before` files check that the driver feeds `ElaborateDrops` the oracle's input, the `after` files
// check the pass (drop flags, static / dead / conditional / open drops, drop ladders for structs, tuples, enums,
// closures, boxes, arrays and slices, cleanup-block drops, replace-drops, the patch's resume / terminate blocks).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
const SYSROOT = HAVE ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";

const WORK = join(DATA, "tmp", "elaborate-drops-oracle", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(REPO, "src/rustc_mir_transform/elaborate_drops_oracle/run.ts");
const FIXTURE = join(REPO, "src/rustc_mir_transform/elaborate_drops_oracle/drops.rs");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
function run(cmd: string[]): { stderr: string; code: number } {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}

test.skipIf(SKIP)("ElaborateDrops: -Zdump-mir=ElaborateDrops before/after files equal the oracle's", () => {
  const oracle_dir = join(WORK, "oracle");
  const ours_dir = join(WORK, "ours");
  for (const d of [oracle_dir, ours_dir]) {
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
  }
  const args = ["--crate-type=lib", "--edition=2021", "-Zdump-mir=ElaborateDrops", "-Zdump-mir-exclude-pass-number", FIXTURE];
  const oracle = run([...RUSTC, ...args, `-Zdump-mir-dir=${oracle_dir}`, "--emit=mir", "-o", join(WORK, "drops.mir")]);
  expect(oracle.code).toBe(0);
  const ours = run([process.execPath, RUNNER, "--sysroot", SYSROOT, ...args, `-Zdump-mir-dir=${ours_dir}`]);
  expect(ours.stderr).not.toContain("rust-ts: ");
  expect(ours.code).toBe(0);

  const oracle_files = readdirSync(oracle_dir).sort();
  const ours_files = readdirSync(ours_dir).sort();
  console.log(`ElaborateDrops: ${oracle_files.length} oracle dump files`);
  expect(oracle_files.length).toBeGreaterThan(90);
  expect(ours_files).toEqual(oracle_files);
  for (const f of oracle_files) {
    const o = readFileSync(join(oracle_dir, f), "utf8");
    const p = readFileSync(join(ours_dir, f), "utf8");
    if (p !== o) {
      // Show the first differing line.
      const ol = o.split("\n");
      const pl = p.split("\n");
      let k = 0;
      while (k < pl.length && ol[k] === pl[k]) k++;
      expect(`${f} line ${k + 1}: ${pl[k]}`).toBe(`${f} line ${k + 1}: ${ol[k]}`);
    }
  }
});
