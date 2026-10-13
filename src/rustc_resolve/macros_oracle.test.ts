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

// Where the port stops today (mode -> case -> unported text). Root advances these as lanes land.
// resdump mode: the dump itself (src/rust_ts/resdump.ts) is not written yet.
const RESDUMP_STOP = "rust_ts::resdump::dump (ResolverGlobalCtxt / ResolverAstLowering / definitions: rustc_middle::ty::TyCtxt and rustc_resolve are not ported)";
const STOPS: Record<Mode, Record<string, string>> = {
  resdump: Object.fromEntries(case_names().map((name) => [name, RESDUMP_STOP])),
  expanded: {},
} as Record<Mode, Record<string, string>>;
const PENDING: Record<string, string> = Object.fromEntries(
  MODES.flatMap((mode) => Object.entries(STOPS[mode] ?? {}).map(([name, stop]) => [`${name}/${mode}`, stop])),
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
