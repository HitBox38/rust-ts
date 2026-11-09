// Shared by ../code_stats.oracle.test.ts and regen.ts (lane fixers-49; not a port).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const FILE = "big.rs";
/** Under `oracle/`: the exit code, then stdout. */
export const ORACLE = "big.aarch64-apple-darwin.txt";

/** `#![no_core]` and an explicit target, so neither side needs a `rust-std` and the layouts do not depend on the host. */
export function args(out: string): string[] {
  return ["--target", "aarch64-apple-darwin", FILE, "--crate-name", "big", "--emit=metadata", "-Zprint-type-sizes", "--out-dir", out];
}

// As aarch64_oracle/common.ts `test_env`.
export function test_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) env[k] = v;
  }
  return env;
}
