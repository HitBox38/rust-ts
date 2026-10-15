// Lane small-gaps-17: `Autoderef` (autoderef.rs) on small `#![no_core]` crates through the ported driver
// (autoderef_test/run.ts): builtin steps over `&&T`, `&mut`, raw pointers (with and without `include_raw_pointers`),
// slices and the `owned_box` lang item; the recursion limit (E0055, and `silence_errors`); an overloaded `Deref` step.
//
// The expected stdout / stderr / exit were produced by the pinned rustc_driver running the same loop with
// rustc_hir_analysis's own `Autoderef` (docs/handoff/small-gaps-17.md, "Oracle check"); ours must equal them byte for
// byte. The overloaded step needs rustc_trait_selection (`predicate_may_hold_opaque_types_jank`, wave 20 old-query-typeops;
// then `ObligationCtxt`, lane trait-sel-traits-a): until those land ours stops at one of `PENDING`, and the case turns into
// an oracle match when they do.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "autoderef_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** The exact `unported(..)` texts the overloaded case stops at today (other lanes' stubs / stand-ins). */
const PENDING = new Set([
  "rustc_trait_selection::traits::query::evaluate_obligation::InferCtxt::predicate_may_hold_opaque_types_jank",
  "rustc_trait_selection::traits::ObligationCtxt::new",
]);

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

for (const [file, exit] of [
  ["builtin.rs", 0],
  ["limit.rs", 1],
  ["overloaded.rs", 0],
] as const) {
  test(`autoderef_test/${file}: Autoderef steps equal the pinned rustc's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), "--sysroot", s, "--edition=2021", file], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
    const ours = { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    const m = /^UNPORTED: (.*)\n/m.exec(ours.stderr);
    if (m !== null && file === "overloaded.rs") {
      expect(ours.exit).toBe(70);
      expect(PENDING).toContain(m[1]!);
      return;
    }
    const base = join(DIR, file.replace(/\.rs$/, ""));
    expect(ours).toEqual({ exit, stdout: readFileSync(`${base}.stdout`, "utf8"), stderr: readFileSync(`${base}.stderr`, "utf8") });
  }, 120_000);
}
