// Lane check-region-intrinsic: check/region.rs, check/intrinsic.rs and check/always_applicable.rs on small
// `#![no_core]` crates through the ported driver, against the oracle.
//
// 1. region_test/: `region_scope_tree` of every body owner, `{:#?}`, equals region_test/<crate>.expected.txt, the output
//    of the rustc-dev probe region_test/scopedump (`tcx.region_scope_tree(did)` of the pinned nightly, run with the
//    same arguments; see its header). Its hash maps print in rustc's hashbrown order (region_test/run.ts).
// 2. intrinsic_test/: errors.rs (E0093, E0094, safety mismatch) prints exactly the oracle rustc's stderr. ok.rs and
//    ok_lang.rs are accepted by the oracle, so every region-free intrinsic's computed signature equals the declared one;
//    mismatch.rs gets one E0308 per intrinsic from the oracle, so every computed signature differs from the declared one
//    (`check_function_signature`, which compares them, is lane check-check's; intrinsic_test/run.ts records them).
// 3. drop_test/: specialized.rs (E0366) and negative.rs print exactly the oracle rustc's stderr; implied.rs (E0367)
//    prints the oracle's stderr or stops at one of `PENDING` (rustc_trait_selection's `ObligationCtxt`, wave 17).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const OUT = mkdtempSync(join(tmpdir(), "check-region-intrinsic-"));

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(dir: string, cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: dir, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const args = (s: string, edition: string, file: string): string[] => ["--sysroot", s, `--edition=${edition}`, "--crate-type", "lib", "--emit=metadata", "--out-dir", OUT, file];

// ---- 1. region_scope_tree ----------------------------------------------------------------------------------------

const REGION = join(import.meta.dir, "region_test");

for (const [file, edition] of [
  ["scopes.rs", "2021"],
  ["scopes_2024.rs", "2024"],
  ["tail_lint.rs", "2021"],
] as const) {
  test(`region_test/${file}: region_scope_tree of every body equals the scopedump probe's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const expected = readFileSync(join(REGION, file.replace(/\.rs$/, ".expected.txt")), "utf8");
    const ours = run(REGION, ["bun", join(REGION, "run.ts"), "scopes", ...args(s, edition, file)]);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: 0, stderr: "" });
    expect(ours.stdout).toBe(expected);
  }, 120_000);
}

test("region_test: the fixtures exercise every scope kind and both hash maps", () => {
  const all = ["scopes", "scopes_2024", "tail_lint"].map((n) => readFileSync(join(REGION, `${n}.expected.txt`), "utf8")).join("\n");
  for (const kind of ["Node(", "CallSite(", "Arguments(", "Destruction(", "IfThen(", "IfThen[edition2024](", "MatchGuard(", "Remainder {"]) {
    expect(all).toContain(kind);
  }
  // non-empty `extended_temp_scopes` (incl. `None` for const initializers) and `backwards_incompatible_scope`
  expect(all).toMatch(/extended_temp_scopes: UnordMap \{\n {8}inner: \{\n {12}\d+: Some\(/);
  expect(all).toMatch(/extended_temp_scopes: UnordMap \{\n {8}inner: \{\n {12}\d+: None,/);
  expect(all).toMatch(/backwards_incompatible_scope: UnordMap \{\n {8}inner: \{\n {12}\d+: Node\(/);
});

// ---- 2. intrinsics -------------------------------------------------------------------------------------------------

const INTRINSIC = join(import.meta.dir, "intrinsic_test");

test("intrinsic_test/errors.rs: E0093 / E0094 / safety mismatch print as the oracle", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = run(INTRINSIC, ["rustc", `+${PIN.toolchain}`, ...args(s, "2021", "errors.rs")]);
  const ours = run(INTRINSIC, ["bun", join(INTRINSIC, "run.ts"), "intrinsics", ...args(s, "2021", "errors.rs")]);
  expect(oracle.stderr.split("error[E0094]").length - 1).toBe(3);
  expect(oracle.stderr.split("error[E0093]").length - 1).toBe(2);
  expect(oracle.stderr.split("intrinsic safety mismatch").length - 1).toBe(2);
  expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  // `ctpop<'a, T>`: the late-bound lifetime is not counted, so it reaches `check_function_signature`.
  expect(ours.stdout).toBe("ctpop: regions\n");
}, 120_000);

for (const [file, n] of [
  ["ok.rs", 36],
  ["ok_lang.rs", 8],
] as const) {
  test(`intrinsic_test/${file}: every computed signature equals the declared one (the oracle accepts the crate)`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(INTRINSIC, ["rustc", `+${PIN.toolchain}`, ...args(s, "2021", file)]);
    expect({ exit: oracle.exit, stderr: oracle.stderr }).toEqual({ exit: 0, stderr: "" });
    const ours = run(INTRINSIC, ["bun", join(INTRINSIC, "run.ts"), "intrinsics", ...args(s, "2021", file)]);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: 0, stderr: "" });
    const lines = ours.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(n);
    expect(lines.filter((l) => !l.endsWith(": same") && !l.endsWith(": regions"))).toEqual([]);
    expect(lines.filter((l) => l.endsWith(": same")).length).toBeGreaterThanOrEqual(n - 1);
  }, 120_000);
}

test("intrinsic_test/mismatch.rs: every computed signature differs (the oracle reports one E0308 per intrinsic)", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = run(INTRINSIC, ["rustc", `+${PIN.toolchain}`, ...args(s, "2021", "mismatch.rs")]);
  const ours = run(INTRINSIC, ["bun", join(INTRINSIC, "run.ts"), "intrinsics", ...args(s, "2021", "mismatch.rs")]);
  const n = oracle.stderr.split("error[E0308]: intrinsic has wrong type").length - 1;
  expect(n).toBe(7);
  expect(ours.exit).toBe(0);
  const lines = ours.stdout.trimEnd().split("\n");
  expect(lines.length).toBe(n);
  expect(lines.filter((l) => !l.endsWith(": differs"))).toEqual([]);
}, 120_000);

// ---- 3. Drop impls -------------------------------------------------------------------------------------------------

const DROP = join(import.meta.dir, "drop_test");

/** The exact `unported(..)` texts drop_test may stop at today (stand-ins for other wave-17 lanes). */
const PENDING = new Set(["rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics"]);

for (const [file, code, n] of [
  ["specialized.rs", "error[E0366]", 5],
  ["negative.rs", "negative `Drop` impls are not supported", 1],
] as const) {
  test(`drop_test/${file}: check_drop_impl prints as the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(DROP, ["rustc", `+${PIN.toolchain}`, ...args(s, "2021", file)]);
    const ours = run(DROP, ["bun", join(DROP, "run.ts"), "drops", ...args(s, "2021", file)]);
    expect(oracle.stderr.split(code).length - 1).toBe(n);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

test("drop_test/implied.rs: E0367 prints as the oracle, or stops as PENDING", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = run(DROP, ["rustc", `+${PIN.toolchain}`, ...args(s, "2021", "implied.rs")]);
  const ours = run(DROP, ["bun", join(DROP, "run.ts"), "drops", ...args(s, "2021", "implied.rs")]);
  expect(oracle.stderr.split("error[E0367]").length - 1).toBe(2);
  const m = /unported: (.*)\n/.exec(ours.stderr);
  if (m !== null) expect(PENDING).toContain(m[1]!);
  else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
}, 120_000);
