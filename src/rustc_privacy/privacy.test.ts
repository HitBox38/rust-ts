// Tests of lane privacy-effvis: the real rustc_privacy providers through the driver.
//
// privacy_test/run.ts runs the ported driver, then `effective_visibilities(())` and (unless `--effvis-only`)
// `check_private_in_public(module)` for every module, as `analysis`'s `misc_checking_3` does (see its header).
// `<case>.stderr` / `<case>.exit` are the pinned rustc's output and exit status (`REGEN=1` rewrites them).
//
// - `ev_*`: `#[rustc_effective_visibility]` dumps (`TestReachabilityVisitor`); `ev_basic`, `ev_full_priv`, `ev_glob`,
//   `ev_macro`, `ev_macro_2` are copies of tests/ui/privacy/effective_visibilities{,_full_priv,_glob}.rs and
//   effective-visibilities-macro{,-2}.rs. They run `--effvis-only`: `check_private_in_public` reaches the
//   `unnameable_types` / `private_interfaces` lints, whose HIR lint levels (`shallow_lint_levels_on`) are not
//   ported yet.
// - `e0446_*`, `clean_pub`: `check_private_in_public` (E0446 hard errors; no lint fires).
// - `--mod-privacy`: `check_mod_privacy` on a crate without bodies runs clean; with bodies it stops UNPORTED (exit 70)
//   at the `typeck` query.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "privacy_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

type Mode = "--effvis-only" | "full" | "--mod-privacy";
const CASES: readonly (readonly [string, Mode])[] = [
  ["ev_basic", "--effvis-only"],
  ["ev_full_priv", "--effvis-only"],
  ["ev_glob", "--effvis-only"],
  ["ev_macro", "--effvis-only"],
  ["ev_macro_2", "--effvis-only"],
  ["ev_reach", "--effvis-only"],
  ["ev_glob", "full"],
  ["e0446_impl_assoc", "full"],
  ["e0446_trait_default", "full"],
  ["clean_pub", "full"],
  ["mod_privacy_no_bodies", "--mod-privacy"],
];
const ORACLE_CASES = [...new Set(CASES.map(([c]) => c))];

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

const args = (sysroot: string, c: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zui-testing",
  "--crate-type",
  "lib",
  // `check_mod_deathness` (rustc_passes dead.rs) is not part of this lane; the oracle's dead-code warnings are off.
  "-A",
  "dead_code",
  `${c}.rs`,
];
const oracle_args = (sysroot: string, c: string): string[] => [...args(sysroot, c), "--emit=metadata", "-o", join(process.env.TMPDIR ?? "/tmp", `privacy_test_${c}.rmeta`)];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of ORACLE_CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);
    writeFileSync(join(DIR, `${c}.stderr`), r.stderr);
    writeFileSync(join(DIR, `${c}.exit`), `${r.exit}\n`);
  }
}

const expected = (c: string) => ({
  exit: Number(readFileSync(join(DIR, `${c}.exit`), "utf8").trim()),
  stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8"),
});

test("privacy_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of ORACLE_CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);
    expect({ c, ...r }).toEqual({ c, ...expected(c) });
  }
}, 120_000);

for (const [c, mode] of CASES) {
  test(`privacy_test/${c}.rs (${mode}): equals the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...(mode === "full" ? [] : [mode]), ...args(s, c)]);
    expect(r).toEqual(expected(c));
  }, 120_000);
}

test("privacy_test/clean_pub.rs (--mod-privacy): check_mod_privacy stops UNPORTED at typeck", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const r = run(["bun", join(DIR, "run.ts"), "--mod-privacy", ...args(s, "clean_pub")]);
  expect({ exit: r.exit, tail: r.stderr.trim().split("\n").at(-1) }).toEqual({ exit: 70, tail: "rust-ts: unported: rustc_hir_typeck::loops::check" });
}, 120_000);
