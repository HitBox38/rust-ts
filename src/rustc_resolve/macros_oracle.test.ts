// End-to-end oracle comparison for lane res-macros: small `#![no_core]` crates exercising macros.rs and
// effective_visibilities.rs (`macro_rules!` scopes and lints, `#[derive]`, `#[rustc_builtin_macro]`
// builtins, `#[cfg_accessible]`, tool attributes and `#![register_tool]`, macro path errors,
// `OUT_OF_SCOPE_MACRO_CALLS`, effective visibilities), run through the whole ported driver exactly as the
// `resdump-nocore` and `unpretty-expanded-nocore` suites run them (macros_oracle/gen.ts documents the
// command lines; expected.json holds the oracle's stdout, stderr and exit code).
//
// PENDING: the cases that stop in code other lanes own. Each must still stop with exactly the listed
// `rust-ts: unported: ..` line (exit 70), so the test fails once the owning lane lands: then root (or the
// next lane) removes the entry and the case must match the oracle byte for byte.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, case_names, ENV, type Mode, MODES, mode_args, type Outcome, paths_hygiene_oracle, resdump_probe, run_oracle } from "./macros_oracle/gen.ts";

const HERE = import.meta.dir;
const REPO = join(HERE, "..", "..");
const expected = JSON.parse(readFileSync(join(HERE, "macros_oracle", "expected.json"), "utf8")) as Record<string, Outcome>;

// Where the port stops today, per case (both modes stop at the same point). Root advances these as lanes land.
const STOPS: Record<string, string> = {
  builtin_macros: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  derive_unresolved: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  effective_vis: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  expand_errors: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  expand_positions: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  macro_errors: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  macro_rules_basic: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  macro_rules_scopes: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  out_of_scope: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
  tool_attrs: "rustc_metadata::creader::CStore::from_tcx (wave 11)",
};
const PENDING: Record<string, string> = Object.fromEntries(
  case_names().flatMap((name) => (STOPS[name] === undefined ? [] : MODES.map((mode) => [`${name}/${mode}`, STOPS[name]]))),
);

function run_port(mode: Mode, name: string): Outcome {
  const script = mode === "resdump" ? "src/rust_ts/resdump.ts" : "src/rust_ts/main.ts";
  const p = Bun.spawnSync([process.execPath, join(REPO, script), ...mode_args(mode, name)], { cwd: CASES, env: { ...process.env, ...ENV } });
  return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
}

for (const name of case_names()) {
  for (const mode of MODES) {
    const key = `${name}/${mode}`;
    test(`${key}`, () => {
      const want = expected[key];
      if (want === undefined) throw new Error(`ERROR: no oracle outcome for ${key}; run bun src/rustc_resolve/macros_oracle/gen.ts`);
      const got = run_port(mode, name);
      const pending = PENDING[key];
      if (pending !== undefined) {
        expect({ exit: got.exit, unported: got.stderr.split("\n").filter((l) => l.startsWith("rust-ts: ")) }).toEqual({
          exit: 70,
          unported: [`rust-ts: unported: ${pending}`],
        });
        return;
      }
      expect(got).toEqual(want);
    }, 120_000);
  }
}

test("the fixtures are the current oracle output", () => {
  const req = process.env.RUST_TS_REQUIRE_PROBES === "1";
  if (process.env.RUST_TS_DATA === undefined || !existsSync(resdump_probe())) {
    if (req) throw new Error(`ERROR: resdump probe missing; bun scripts/probes.ts build resdump`);
    return;
  }
  for (const name of case_names()) {
    for (const mode of MODES) expect({ key: `${name}/${mode}`, ...run_oracle(mode, name) }).toEqual({ key: `${name}/${mode}`, ...expected[`${name}/${mode}`]! });
  }
  expect(paths_hygiene_oracle()).toEqual(expected["unit/paths/hygiene"]!);
}, 300_000);
