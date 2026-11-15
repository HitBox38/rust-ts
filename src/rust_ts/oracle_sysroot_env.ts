// Not upstream: the spawn of the oracle's `rustc +<pin> --print sysroot` that both its users make (rustc_session/filesearch.ts
// `default_sysroot`, rust_ts/llvm/tools.ts `oracle_sysroot`), shared so they stay in lockstep: the pin, the environment
// (review root-w58-check N2) and the spawn itself (review root-w58-recheck N1). Each caller keeps its own error handling and
// its own reading of stdout.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The repository root, where `UPSTREAM.json` pins the oracle toolchain. */
const REPO = join(import.meta.dir, "..", "..");

/**
 * Only what rustup needs to find the pinned toolchain and what a process needs to start (`PATH`, `HOME`, `RUSTUP_HOME`,
 * `CARGO_HOME`; `USERPROFILE`, `SYSTEMROOT` on Windows, as scripts/lib/env.ts keeps them), and never installing anything.
 * PORT (root at integ-w58): the compile's own environment must not reach the oracle here, or a variable rustc reads at session
 * start (`MACOSX_DEPLOYMENT_TARGET=abc` in codegen_backend.oracle.test.ts) fails this spawn instead of the compile. Upstream's
 * `default_sysroot` reads no environment variable.
 */
export function oracle_sysroot_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTUP_AUTO_INSTALL: "0" };
  for (const k of ["PATH", "HOME", "RUSTUP_HOME", "CARGO_HOME", "USERPROFILE", "SYSTEMROOT"]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** `UPSTREAM.json`'s `rust.toolchain`: the pinned oracle toolchain's name. */
export function oracle_toolchain(): string {
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")) as { rust: { toolchain: string } };
  return pin.rust.toolchain;
}

/** What `spawn_print_sysroot` returns: the exit code and both streams, decoded, as the child wrote them. */
export interface PrintSysrootOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * `rustc +<toolchain> --print sysroot` with `oracle_sysroot_env()`, no stdin (`"ignore"`, which is also `Bun.spawnSync`'s
 * default) and both streams piped. stdout is returned untrimmed, with `println!`'s newline: callers strip it as they need.
 * Throws as `Bun.spawnSync` does when `rustc` is not on `PATH` at all.
 */
export function spawn_print_sysroot(toolchain: string): PrintSysrootOutput {
  const r = Bun.spawnSync(["rustc", `+${toolchain}`, "--print", "sysroot"], {
    env: oracle_sysroot_env(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
