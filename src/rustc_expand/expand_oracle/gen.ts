// Oracle fixture generator for lane expand-base's module/config tests (not a port).
//
//   bun src/rustc_expand/expand_oracle/gen.ts        (needs `rustc +nightly`, the pinned oracle)
//
// For each `cases/<name>/` directory, runs the oracle in that directory:
//   rustc +nightly -Zunpretty=expanded -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core -Zui-testing
//         [contents of cases/<name>/ARGS] main.rs
// and records stdout (minus the two injected no_core attribute lines), stderr and the exit code in
// expected.json. `walk.ts` (the TS side) gets the same command line without -Zunpretty/-Zcrate-attr.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const CASES = join(HERE, "cases");

export function case_args(name: string): string[] {
  const f = join(CASES, name, "ARGS");
  const extra = existsSync(f) ? readFileSync(f, "utf8").split(/\s+/).filter((s) => s !== "") : [];
  return ["-Zui-testing", ...extra, "main.rs"];
}

export function strip_injected(stdout: string): string {
  const lines = stdout.split("\n");
  for (const injected of ["#![feature(no_core)]", "#![no_core]"]) {
    const i = lines.indexOf(injected);
    if (i >= 0) lines.splice(i, 1);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const out: Record<string, { args: string[]; stdout: string; stderr: string; exit: number }> = {};
  for (const name of readdirSync(CASES).sort()) {
    const args = case_args(name);
    const p = Bun.spawnSync(
      ["rustc", `+${PIN.toolchain}`, "-Zunpretty=expanded", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", ...args],
      { cwd: join(CASES, name), env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } },
    );
    out[name] = {
      args,
      stdout: strip_injected(p.stdout.toString()),
      stderr: p.stderr.toString(),
      exit: p.exitCode ?? -1,
    };
  }
  writeFileSync(join(HERE, "expected.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${Object.keys(out).length} cases`);
}
