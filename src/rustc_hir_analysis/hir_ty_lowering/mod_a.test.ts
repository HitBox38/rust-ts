// Lane hir-ty-lowering-a: the `impl dyn HirTyLowerer` methods of hir_ty_lowering/mod.rs:1..2185, the `AssocItemQSelf` /
// `LowerTypeRelativePathMode` methods and `ForbidParamUsesFolder`, run through a `HirTyLowerer` trait object on the
// no_core items of mod_a_test/lower.rs by the ported driver (mod_a_test/run.ts; its header explains the test implementor).
// The expected report (mod_a_test/lower.expected.txt) was checked by reading mod.rs. Its `PENDING <case>: <text>` lines
// pin the exact `unported(..)` text where a case reaches another lane's stub (collect-a `generics_of`, collect-rbv
// `named_variable_map`, hir-ty-lowering-d's errors.rs methods, rustc_infer, stability's `lookup_deprecation_entry`):
// update them as those lanes land.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "mod_a_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

test("mod_a_test/lower.rs: hir_ty_lowering/mod.rs:1..2185 through a HirTyLowerer trait object", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--crate-type", "lib", "--edition=2021", "lower.rs"];
  const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), ...args], { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
  expect({ exit: r.exitCode, stdout: r.stdout.toString() }).toEqual({ exit: 0, stdout: readFileSync(join(DIR, "lower.expected.txt"), "utf8") });
}, 120_000);
