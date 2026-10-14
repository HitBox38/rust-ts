// Lane ty-utils: the rustc_ty_utils providers that only read the HIR (`asyncness`, `defaultness` from ty.rs,
// `nested_bodies_within` from nested_bodies.rs) through the ported driver (ty_test/run.ts), and the providers that read
// rustc_hir_analysis queries (`opaque_types_defined_by`, `assumed_wf_types` run to the end since merge-w16a; `param_env`
// stops at `clauses_of`'s `inferred_outlives_of`, wave 17). The expected report (ty_test/ty.expected.txt) was checked by
// reading ty.rs / nested_bodies.rs: trait items without a default are `Default { has_value: false }`, trait impls and
// their items `Final`; nested bodies come before their parent; nested items (`f::inner`) are not visited; the inline
// const of `g` is its nested body.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "ty_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

test("ty_test/ty.rs: HIR-only providers and the stops of the others", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--crate-type", "lib", "--edition=2021", "ty.rs"];
  const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), ...args], { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
  expect({ exit: r.exitCode, stdout: r.stdout.toString() }).toEqual({ exit: 0, stdout: readFileSync(join(DIR, "ty.expected.txt"), "utf8") });
}, 120_000);
