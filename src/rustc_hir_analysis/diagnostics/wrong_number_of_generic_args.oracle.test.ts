// Oracle tests of lane wrong-num-args: E0107 (`WrongNumberOfGenericArgs`) through the real driver.
//
// wrong_num_oracle/run.ts runs the ported driver on each `#![no_core]` program with a stand-in caller
// (`check_generic_arg_count`) and stand-in `generics_of` / `trait_def` providers (see its header); the diagnostic, the
// HIR accessors, `def_path_str`, `def_descr`, `associated_items`, the source map and the emitter are the real ones. Its
// stderr and exit code must equal the pinned rustc's on the same file (fixture `<case>.stderr`; `REGEN=1` rewrites the
// fixtures from the oracle, which is re-checked on every run when present).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "wrong_num_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES: readonly string[] = [
  // too many / too few type args; `missing generics for ..`; defaults (`at least` / `at most`); const params
  "excess_ty",
  "missing_ty",
  "missing_ty_available",
  "defaults",
  "const_param",
  // lifetimes: missing (names from the definition, from an existing arg, `'static` in a const), excess, both kinds
  "lifetimes_missing",
  "lifetime_fn_arg",
  "lifetime_const",
  "lifetimes_excess",
  "mixed",
  // traits: impl header, associated item binding suggestion, missing args next to a constraint
  "trait_impl_excess",
  "trait_assoc_binding",
  "missing_with_constraint",
  // value paths: fn turbofish, `impl Trait` note, moving args to the trait
  "fn_value",
  "synth",
  "assoc_fn_to_trait",
  // def_descr of enums and type aliases, `def_path_str` through a module, trait impl headers (missing; `is_in_trait_impl`)
  "enum_alias",
  "module_path",
  "trait_impl_missing",
  "trait_impl_assoc",
];

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

const args = (sysroot: string, c: string): string[] => ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot, "--edition=2021", "-Zui-testing", `${c}.rs`];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

const fixture_path = (c: string): string => join(DIR, `${c}.stderr`);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c)]);
    if (r.exit !== 1) throw new Error(`ERROR: oracle exit ${r.exit} on ${c}.rs`);
    writeFileSync(fixture_path(c), r.stderr);
  }
}

test("wrong_num_oracle fixtures are the current oracle output", () => {
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
  test(`wrong_num_oracle/${c}.rs: E0107 matches the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 1, stderr: readFileSync(fixture_path(c), "utf8") });
  }, 120_000);
}
