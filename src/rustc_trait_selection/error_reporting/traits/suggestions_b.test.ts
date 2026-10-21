// Lane errrep-sugg-b: error_reporting/traits/suggestions.rs:2485..5017 (`note_obligation_cause_code(_inner)` and the
// async-await notes) on small `#![no_core]` crates through the ported driver (suggestions_b_test/run.ts), against the
// pinned rustc.
//
// Since merge-w19 run.ts reports through the real `report_fulfillment_errors` (wave 19), so every case must print the
// oracle's stderr and exit status byte for byte. (Before, a TEST stand-in printed a placeholder message and the test
// compared only the `note_obligation_cause_code` sub-diagnostics; `auto_trait.rs` / `where_clause.rs` were PENDING at
// `is_recursive_obligation` / `point_at_assoc_type_restriction`.)
import { expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "suggestions_b_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", "/dev/null", file];

/** The cases, with the `note_obligation_cause_code` path each covers and a line of it the oracle prints. */
const CASES: readonly (readonly [string, string])[] = [
  // WhereClause on an implicit `Sized` bound: "required by an implicit `Sized` bound in `Need`" + its span label
  ["implicit_sized.rs", "note: required by an implicit `Sized` bound in `Need`"],
  // FieldSized (struct last field / enum variant): the note + help + the `&` / `Box` suggestions
  ["field_sized.rs", "= note: only the last field of a struct may have a dynamically sized type"],
  // WhereClause on an associated type's implicit bound: the span note + "consider relaxing the implicit `Sized` restriction"
  ["assoc_sized.rs", "help: consider relaxing the implicit `Sized` restriction"],
  // TrivialBound: the `#![feature(trivial_bounds)]` suggestion
  ["trivial_bound.rs", "help: add `#![feature(trivial_bounds)]` to the crate attributes to enable"],
  // BuiltinDerived (`within `W`, the trait `Sync` is not implemented for `S``): `is_recursive_obligation`
  ["auto_trait.rs", "note: required because it appears within the type `W`"],
  // ImplDerived under WhereClause: `point_at_assoc_type_restriction` (suggestions.rs:7154)
  ["where_clause.rs", "error[E0277]: the trait bound `S: A` is not satisfied"],
];

for (const [file, line] of CASES) {
  test(`suggestions_b_test/${file}: prints the oracle's E0277 report`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), ...args(s, file)]);
    expect(oracle.stderr).toContain(line);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}
