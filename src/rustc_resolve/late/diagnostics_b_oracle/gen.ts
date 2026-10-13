// Oracle fixture generator for lane res-late-diag-b's tests (not a port).
//
//   bun src/rustc_resolve/late/diagnostics_b_oracle/gen.ts   (needs the pinned oracle toolchain and the
//                                                              resdump probe: `bun scripts/probes.ts build resdump`)
//
// For each `cases/<name>.rs`, runs in `cases/` (so file names in the output are relative)
//   $RUST_TS_DATA/target/probes/release/resdump --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>
//     --edition=2021 -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core <name>.rs
// (the `resdump-nocore` suite's oracle: diagnostics up to and including name resolution, no type checking)
// and records stderr and the exit code in expected.json (stdout, the resolver dump, is not needed here).
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oracleSysroot } from "../../../../scripts/lib/oracle.ts";

const HERE = import.meta.dir;
export const CASES = join(HERE, "cases");
export const ENV = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

export interface Outcome {
  stderr: string;
  exit: number;
}

export function case_names(): string[] {
  return readdirSync(CASES)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** The nocore suites' arguments for `name` without `--sysroot` (the port ignores it; the oracle needs it). */
export function port_args(name: string): string[] {
  return ["--target", "x86_64-unknown-linux-gnu", "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", `${name}.rs`];
}

export function resdump_probe(): string {
  const data = process.env.RUST_TS_DATA;
  if (data === undefined) throw new Error("ERROR: RUST_TS_DATA is not set");
  return join(data, "target", "probes", "release", "resdump");
}

export function run_oracle(name: string): Outcome {
  const args = port_args(name);
  args.splice(2, 0, "--sysroot", oracleSysroot());
  const p = Bun.spawnSync([resdump_probe(), ...args], { cwd: CASES, env: { ...process.env, ...ENV } });
  return { stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
}

if (import.meta.main) {
  const out: Record<string, Outcome> = {};
  for (const name of case_names()) out[name] = run_oracle(name);
  writeFileSync(join(HERE, "expected.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${Object.keys(out).length} outcomes`);
}
