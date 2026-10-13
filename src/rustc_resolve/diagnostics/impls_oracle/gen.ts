// Oracle fixture generator for lane res-diag-a's diagnostics tests (not a port).
//
//   bun src/rustc_resolve/diagnostics/impls_oracle/gen.ts      (needs the pinned oracle `rustc +<toolchain>`)
//
// For each `cases/<name>.rs`, runs the oracle rustc in `cases/` (so file names in the output are relative) with
// the nocore suites' arguments (`ARGS`) and records `exit <code>` plus its stderr in `cases/<name>.stderr`.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oracleRustcCmd, oracleSysroot } from "../../../../scripts/lib/oracle.ts";

const HERE = import.meta.dir;
export const CASES = join(HERE, "cases");
export const ENV = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** Arguments before the file name (edition 2021, `no_core`, as the nocore suites). */
export function ARGS(sysroot: boolean): string[] {
  const s = sysroot ? ["--sysroot", oracleSysroot()] : [];
  return ["--target", "x86_64-unknown-linux-gnu", ...s, "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core"];
}

export function case_names(): string[] {
  return readdirSync(CASES)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** `exit <code>\n<stderr>` of the oracle for `cases/<name>.rs`. */
export function run_oracle(name: string): string {
  const p = Bun.spawnSync(oracleRustcCmd([...ARGS(true), "--emit=metadata", "-o", "/dev/null", `${name}.rs`]), {
    cwd: CASES,
    env: { ...process.env, ...ENV },
  });
  return `exit ${p.exitCode}\n${p.stderr.toString()}`;
}

if (import.meta.main) {
  for (const name of case_names()) {
    writeFileSync(join(CASES, `${name}.stderr`), run_oracle(name));
    console.log(`${name}: written`);
  }
}
