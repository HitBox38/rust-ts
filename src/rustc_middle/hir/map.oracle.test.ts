// Oracle tests of lane middle-hir: rustc_middle hir/mod.rs + hir/map.rs and the `-Zunpretty=hir-tree` arm of
// rustc_driver_impl/src/pretty.rs, ahead of the lowering lanes.
//
// hir_tree_oracle/run.ts runs the ported driver with `lower_to_hir` overridden by a stand-in that builds the HIR of a
// modules-only crate from the expanded AST. Everything after that is the real path: the `hir_owner` / `hir_attr_map`
// providers, `hir_crate_items` (`ItemCollector`, nested-module order), `hir_owner_nodes` and pretty.rs's HirTree arm.
// - `tree`: the subject's stdout must equal the pinned rustc's `-Zunpretty=hir-tree` stdout (fixture
//   `<case>.hir-tree.stdout`; `REGEN=1` rewrites it from the oracle, which is re-checked on every run when present).
// - `accessors`: `tcx.hir_*` results (parents, ancestor walks, spans, module items) on the same HIR, against
//   `<case>.accessors.txt`, whose values were derived by reading hir/map.rs and hir/mod.rs (the oracle prints none of
//   them in hir-tree mode).
// Bin crates: `opt_hash` is `None`, so the fixture does not depend on `hash_owner_nodes` (lowering computes it).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "hir_tree_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = ["mods"] as const;

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
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
  "--crate-type",
  "bin",
  "--edition=2021",
  `--remap-path-prefix=${DIR}=/hir_tree_oracle`,
  `${c}.rs`,
];

function run(cmd: string[]): { exit: number; stdout: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString() };
}

const fixture_path = (c: string): string => join(DIR, `${c}.hir-tree.stdout`);
const accessors_path = (c: string): string => join(DIR, `${c}.accessors.txt`);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s, c)]);
    if (r.exit !== 0) throw new Error(`ERROR: oracle exit ${r.exit} on ${c}.rs`);
    writeFileSync(fixture_path(c), r.stdout);
  }
}

test("hir_tree_oracle fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s, c)]);
    expect({ c, exit: r.exit, stdout: r.stdout }).toEqual({ c, exit: 0, stdout: readFileSync(fixture_path(c), "utf8") });
  }
}, 120_000);

test("the hir_tree_oracle fixture exercises nested modules", () => {
  const f = readFileSync(fixture_path("mods"), "utf8");
  // Owner order: the crate root, then free items in visit order (`m`, its nested `n`, then `k`).
  expect([...f.matchAll(/^DefId\(0:(\d+) ~ [^)]*\) => /gm)].map((m) => m[1])).toEqual(["0", "1", "2", "3"]);
  expect(f).toContain("::m::n) => OwnerNodes");
});

for (const c of CASES) {
  test(`hir_tree_oracle/${c}.rs: -Zunpretty=hir-tree over the stand-in lowering prints as the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), "tree", "-Zunpretty=hir-tree", ...args(s, c)]);
    expect({ c, exit: r.exit, stdout: r.stdout }).toEqual({ c, exit: 0, stdout: readFileSync(fixture_path(c), "utf8") });
  }, 120_000);

  test(`hir_tree_oracle/${c}.rs: tcx.hir_* accessors`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), "accessors", ...args(s, c)]);
    expect({ c, exit: r.exit, stdout: r.stdout }).toEqual({ c, exit: 0, stdout: readFileSync(accessors_path(c), "utf8") });
  }, 120_000);
}
