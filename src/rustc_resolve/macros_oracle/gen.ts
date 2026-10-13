// Oracle fixture generator for lane res-macros' end-to-end tests (not a port).
//
//   bun src/rustc_resolve/macros_oracle/gen.ts        (needs `rustc +nightly-..`, the pinned oracle, and the
//                                                       resdump probe: `bun scripts/probes.ts build resdump`)
//
// For each `cases/<name>.rs`, runs in `cases/` (so file names in the output are relative):
//   - mode `resdump`:  $RUST_TS_DATA/target/probes/release/resdump <ARGS> <name>.rs
//     (the `resdump-nocore` suite's oracle, harness/suites.ts);
//   - mode `expanded`: rustc +<pin> <ARGS> -Zunpretty=expanded <name>.rs
//     (the `unpretty-expanded-nocore` suite's oracle);
// with ARGS = the nocore suites' arguments (`--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>
// --edition=2021 -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core`), and records stdout, stderr and the
// exit code in expected.json. Also records `unit/paths.rs` under `-Zunpretty=expanded,hygiene` (the
// expansion `kind: Macro(..)` lines, whose descriptions are `fast_print_path`'s output) as
// `unit/paths/hygiene` for macros.test.ts. The TS side (macros_oracle.test.ts) runs src/rust_ts/resdump.ts and
// src/rust_ts/main.ts with the same arguments.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oracleRustcCmd, oracleSysroot } from "../../../scripts/lib/oracle.ts";

const HERE = import.meta.dir;
export const CASES = join(HERE, "cases");
export const MODES = ["resdump", "expanded"] as const;
export type Mode = (typeof MODES)[number];
export const ENV = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

export interface Outcome {
  stdout: string;
  stderr: string;
  exit: number;
}

export function case_names(): string[] {
  return readdirSync(CASES)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function base_args(name: string): string[] {
  return ["--target", "x86_64-unknown-linux-gnu", "--sysroot", oracleSysroot(), "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", `${name}.rs`];
}

export function mode_args(mode: Mode, name: string): string[] {
  const args = base_args(name);
  if (mode === "expanded") args.splice(args.length - 1, 0, "-Zunpretty=expanded");
  return args;
}

export function resdump_probe(): string {
  const data = process.env.RUST_TS_DATA;
  if (data === undefined) throw new Error("ERROR: RUST_TS_DATA is not set");
  return join(data, "target", "probes", "release", "resdump");
}

export function run_oracle(mode: Mode, name: string): Outcome {
  const cmd = mode === "resdump" ? [resdump_probe(), ...mode_args(mode, name)] : oracleRustcCmd(mode_args(mode, name));
  const p = Bun.spawnSync(cmd, { cwd: CASES, env: { ...process.env, ...ENV } });
  return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
}

export const UNIT = join(HERE, "unit");

/** The `kind: Macro(..)` lines of `-Zunpretty=expanded,hygiene` on unit/paths.rs. */
export function paths_hygiene_oracle(): Outcome {
  const args = base_args("paths");
  args.splice(args.length - 1, 0, "-Zunpretty=expanded,hygiene");
  const p = Bun.spawnSync(oracleRustcCmd(args), { cwd: UNIT, env: { ...process.env, ...ENV } });
  const lines = p.stdout
    .toString()
    .split("\n")
    .filter((l) => l.includes("kind: Macro("));
  return { stdout: lines.join("\n") + "\n", stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
}

if (import.meta.main) {
  const out: Record<string, Outcome> = {};
  for (const name of case_names()) {
    for (const mode of MODES) out[`${name}/${mode}`] = run_oracle(mode, name);
  }
  out["unit/paths/hygiene"] = paths_hygiene_oracle();
  writeFileSync(join(HERE, "expected.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${Object.keys(out).length} outcomes`);
}
