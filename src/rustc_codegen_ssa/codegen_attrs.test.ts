// Lane codegen-fn-attrs: the `codegen_fn_attrs` query (codegen_attrs.rs + target_features.rs) on small `#![no_core]`
// crates through the ported driver (codegen_attrs_test/run.ts), against the pinned rustc.
//
// The runner computes `codegen_fn_attrs` of every definition with codegen attrs (as check.rs `check_item_type` does).
// On crates whose only errors are `codegen_fn_attrs` diagnostics, ours prints exactly the oracle's stderr and exit code:
// `#[inline(always)]` + `#[target_feature]`, invalid feature names (closest-name help, `+` suggestion, cross-arch note),
// an unstable target feature (`feature_err`), tied AArch64 features, `#[no_mangle]` on a weak lang item and on a
// `#[rustc_std_internal_symbol]`, and a clean crate. `safe_trait.rs` also gets rustc's E0053 from `compare_impl_item`
// (not run here), so only its first diagnostic is compared.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "codegen_attrs_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** Runs the oracle and ours on `file`; `undefined` when the sysroot is missing (and probes are not required). */
function both(file: string, target: string): { oracle: ReturnType<typeof run>; ours: ReturnType<typeof run> } | undefined {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return undefined;
  }
  const out = mkdtempSync(join(tmpdir(), "rust-ts-codegen-attrs-"));
  try {
    const args = ["--sysroot", s, "--target", target, "--edition=2021", "--emit=metadata", "-o", join(out, "out.rmeta"), file];
    return { oracle: run(["rustc", `+${PIN.toolchain}`, ...args]), ours: run(["bun", join(DIR, "run.ts"), ...args]) };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const X86 = "x86_64-unknown-linux-gnu";

for (const [file, target, expected] of [
  ["clean.rs", X86, undefined],
  ["inline_always_tf.rs", X86, "cannot use `#[inline(always)]` with `#[target_feature]`"],
  ["feature_not_valid.rs", X86, "Did you mean to compile for one of those targets"],
  ["unstable_feature.rs", X86, "error[E0658]: the target feature `amx-tile` is currently unstable"],
  ["tied_aarch64.rs", "aarch64-unknown-linux-gnu", "must all be either enabled or disabled together"],
  ["no_mangle_lang.rs", X86, "`rbreak rust_eh_personality`"],
  ["no_mangle_internal.rs", X86, "`#[no_mangle]` cannot be used on internal language items"],
] as const) {
  test(`codegen_attrs_test/${file}: ours equals the oracle`, () => {
    const r = both(file, target);
    if (r === undefined) return;
    if (expected === undefined) expect({ exit: r.oracle.exit, stderr: r.oracle.stderr }).toEqual({ exit: 0, stderr: "" });
    else expect(r.oracle.stderr).toContain(expected);
    expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: r.oracle.exit, stderr: r.oracle.stderr });
  }, 120_000);
}

test("codegen_attrs_test/safe_trait.rs: ours prints the oracle's first diagnostic", () => {
  const r = both("safe_trait.rs", X86);
  if (r === undefined) return;
  const first = (s: string): string => s.slice(0, s.indexOf("\n\n") + 2);
  expect(first(r.oracle.stderr)).toContain("`#[target_feature(..)]` cannot be applied to safe trait method");
  expect(first(r.ours.stderr)).toBe(first(r.oracle.stderr));
  expect(r.ours.exit).toBe(1);
  expect(r.ours.stderr.slice(first(r.ours.stderr).length)).toBe("error: aborting due to 1 previous error\n\n");
}, 120_000);
