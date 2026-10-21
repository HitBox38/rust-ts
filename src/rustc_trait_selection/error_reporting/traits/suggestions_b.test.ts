// Lane errrep-sugg-b: error_reporting/traits/suggestions.rs:2485..5017 (`note_obligation_cause_code(_inner)` and the
// async-await notes) on small `#![no_core]` crates through the ported driver (suggestions_b_test/run.ts), against the
// pinned rustc.
//
// run.ts replaces `report_fulfillment_errors` (lane errrep-traits-a) by a TEST stand-in that emits an E0277 with a
// placeholder message and adds only what `note_obligation_cause` adds first (`maybe_note_obligation_cause_for_async_await`
// / `note_obligation_cause_code`). So the test checks, per error, that the sub-diagnostics ours prints (every line from
// the first `note:` / `help:` / `= note:` / `= help:` line on) occur verbatim, contiguously, in the oracle's error; or that
// ours stops at one of `PENDING` (exact `unported(..)` texts of other lanes).
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

/** The `error[..]` blocks of a human-format stderr. */
function errors(stderr: string): string[] {
  return stderr.split("\n\n").filter((b) => b.startsWith("error["));
}

/** A block's sub-diagnostics: every line from the first child header on. */
function children(block: string): string {
  const lines = block.split("\n");
  const i = lines.findIndex((l) => /^(note|help)(\[|:)/.test(l) || /^\s*= (note|help):/.test(l));
  return i < 0 ? "" : lines.slice(i).join("\n");
}

/** Cases whose `note_obligation_cause_code` output ours prints exactly (the code paths named). */
const EXACT: readonly (readonly [string, number, string])[] = [
  // WhereClause on an implicit `Sized` bound: "required by an implicit `Sized` bound in `Need`" + its span label
  ["implicit_sized.rs", 1, "note: required by an implicit `Sized` bound in `Need`"],
  // FieldSized (struct last field / enum variant): the note + help + the `&` / `Box` suggestions
  ["field_sized.rs", 2, "= note: only the last field of a struct may have a dynamically sized type"],
  // WhereClause on an associated type's implicit bound: the span note + "consider relaxing the implicit `Sized` restriction"
  ["assoc_sized.rs", 1, "help: consider relaxing the implicit `Sized` restriction"],
  // TrivialBound: the `#![feature(trivial_bounds)]` suggestion
  ["trivial_bound.rs", 1, "help: add `#![feature(trivial_bounds)]` to the crate attributes to enable"],
];

for (const [file, n, child] of EXACT) {
  test(`suggestions_b_test/${file}: note_obligation_cause_code prints the oracle's sub-diagnostics`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), ...args(s, file)]);
    expect(ours.stderr).not.toContain("unported:");
    expect(ours.exit).toBe(oracle.exit);
    const o = errors(oracle.stderr);
    const t = errors(ours.stderr);
    expect(o.length).toBe(n);
    expect(t.length).toBe(n);
    expect(ours.stderr).toContain(child);
    for (let i = 0; i < n; i++) {
      const c = children(t[i]!);
      expect(c).not.toBe("");
      expect(o[i]!).toContain(c);
    }
  }, 120_000);
}

/** The exact `unported(..)` texts the remaining cases stop at today (other lanes' fns). */
const PENDING: readonly (readonly [string, string, string])[] = [
  // BuiltinDerived (`within `W`, the trait `Sync` is not implemented for `S``): `is_recursive_obligation`
  // (fulfillment_errors.rs, lane errrep-traits-a/-b)
  ["auto_trait.rs", "error[E0277]", "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt::is_recursive_obligation"],
  // ImplDerived under WhereClause: `point_at_assoc_type_restriction` (suggestions.rs:7154, lane errrep-sugg-c)
  ["where_clause.rs", "error[E0277]", "rustc_trait_selection::error_reporting::traits::suggestions::point_at_assoc_type_restriction"],
];

for (const [file, code, stop] of PENDING) {
  test(`suggestions_b_test/${file}: the oracle reports ${code}; ours stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    expect(oracle.stderr).toContain(code);
    const ours = run(["bun", join(DIR, "run.ts"), ...args(s, file)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    expect(m?.[1]).toBe(stop);
  }, 120_000);
}
