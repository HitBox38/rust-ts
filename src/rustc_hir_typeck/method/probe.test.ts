// Lane typeck-probe: the `method_autoderef_steps` provider (method/probe.rs:635) on small `#![no_core]` crates through
// the ported driver (probe_test/run.ts): builtin deref steps over references, `Box`, raw pointers (`from_unsafe_deref`),
// slices and `str`; the extra unsized step of an array (`unsize`, the `autoderefs` count of the `Deref` chain); type
// and const parameters under the fn's `param_env`; the recursion limit (`reached_recursion_limit`, silenced); the
// `arbitrary_self_types` branch (the `Receiver` chain zipped with the `Deref` chain); an inference variable as the final
// type (`opt_bad_ty`), alone and behind a reference.
//
// The expected stdout / stderr / exit were produced by the pinned rustc_driver running the same loop with
// `tcx.method_autoderef_steps(goal)` (docs/handoff/typeck-probe.md, "Oracle check"); ours must equal them byte for byte.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "probe_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

for (const file of ["steps.rs", "limit.rs", "recv.rs"] as const) {
  test(`probe_test/${file}: method_autoderef_steps equals the pinned rustc's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), "--sysroot", s, "--edition=2021", file], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
    const ours = { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    const base = join(DIR, file.replace(/\.rs$/, ""));
    expect(ours).toEqual({ exit: 0, stdout: readFileSync(`${base}.stdout`, "utf8"), stderr: readFileSync(`${base}.stderr`, "utf8") });
  }, 120_000);
}
