// Oracle comparison for lane res-diag-a (diagnostics/impls.rs 1..1977 and the manual impls of diagnostics/mod.rs):
// small `#![no_core]` library crates whose only errors are name-resolution errors reported by the ported part of
// the resolver. Each case runs impls_oracle/run.ts in a subprocess (expansion, `finalize_imports`, `report_errors`;
// see its header for the test-only stand-ins) and must print exactly the oracle's stderr and exit code
// (impls_oracle/cases/<name>.stderr, from impls_oracle/gen.ts: `rustc +<pin>` with the nocore arguments).
//
// PENDING: cases that reach another lane's unported code (name -> the `unported` they stop at). Each still runs and
// must stop at exactly that point (exit 70); the lane that lands it (or root) removes the entry, and the case must
// then match the oracle byte for byte.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, case_names, ENV, run_oracle } from "./impls_oracle/gen.ts";

const RUN = join(import.meta.dir, "impls_oracle", "run.ts");

const PENDING: Record<string, string> = {
  // `throw_unresolved_import_error` matches the oracle once these res-diag-b fns are ported (validated locally with
  // no-op stand-ins for them: `check_for_module_export_macro` -> None, `on_unknown_data` -> None,
  // `find_cfg_stripped` -> no stripped items).
  unresolved_import: "rustc_resolve::diagnostics::impls::Resolver::check_for_module_export_macro",
  vis_unresolved: "rustc_resolve::diagnostics::impls::Resolver::report_path_resolution_error",
  private_import: "rustc_resolve::diagnostics::impls::Resolver::report_privacy_error",
  ambiguous_glob: "rustc_resolve::diagnostics::impls::Resolver::ambiguity_diagnostic",
};

/** `exit <code>\n<stderr>` of the port for `cases/<name>.rs`. */
function run_port(name: string): string {
  const p = Bun.spawnSync([process.execPath, RUN, `${name}.rs`], { cwd: CASES, env: { ...process.env, ...ENV } });
  return `exit ${p.exitCode}\n${p.stderr.toString()}`;
}

for (const name of case_names()) {
  test(`resolution diagnostics vs the oracle: ${name}`, () => {
    const got = run_port(name);
    const pending = PENDING[name];
    if (pending !== undefined) {
      expect(got.split("\n")[0]).toBe("exit 70");
      expect(got).toContain(`\nUNPORTED: ${pending}\n`);
      return;
    }
    expect(got).toBe(readFileSync(join(CASES, `${name}.stderr`), "utf8"));
  }, 60_000);
}

test("every case is still named in its fixture", () => {
  // Guard: each case's fixture shows the diagnostic the case is named for.
  const want: Record<string, string> = {
    conflict_kinds: "error[E0428]",
    conflict_values: "error[E0428]",
    conflict_imports: "error[E0255]",
    conflict_same_import: "error[E0252]",
    vis_errors: "error[E0742]",
    vis_unresolved: "error[E0433]",
    unresolved_import: "error[E0432]",
    private_import: "error[E0603]",
    ambiguous_glob: "error[E0659]",
  };
  expect(case_names()).toEqual(Object.keys(want).sort());
  for (const [name, code] of Object.entries(want)) {
    expect({ name, has: readFileSync(join(CASES, `${name}.stderr`), "utf8").includes(code) }).toEqual({ name, has: true });
  }
});

test("the fixtures are the current oracle output", () => {
  const req = process.env.RUST_TS_REQUIRE_PROBES === "1";
  if (process.env.RUST_TS_DATA === undefined) {
    if (req) throw new Error("ERROR: RUST_TS_DATA is not set (the oracle toolchain is needed)");
    return;
  }
  for (const name of case_names()) {
    expect({ name, out: run_oracle(name) }).toEqual({ name, out: readFileSync(join(CASES, `${name}.stderr`), "utf8") });
  }
}, 300_000);
