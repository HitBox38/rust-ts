// Shared by ../aarch64.oracle.test.ts and regen.ts (lane abi-vtable; not a port).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const TARGETS = ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu"];

export interface Case {
  target: string;
  file: string;
  /** Under `oracle/`. */
  oracle: string;
}
// `sizes.rs` also runs on x86_64, the only way into `callconv/x86_64.ts`: what `abi.rs` would add there is not worth its fixture.
export const CASES: Case[] = [
  ...TARGETS.map((target) => ({ target, file: "abi.rs", oracle: `${target}.txt` })),
  ...[...TARGETS, "x86_64-unknown-linux-gnu"].map((target) => ({ target, file: "sizes.rs", oracle: `sizes.${target}.txt` })),
];

export function abi_args(c: Case, out: string): string[] {
  return ["--target", c.target, "-O", c.file, "--crate-name", "abi", "--emit=metadata", "--out-dir", out];
}

// As collector_oracle/common.ts `clean_env`.
export function test_env(): Record<string, string> {
  const env: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) env[k] = v;
  }
  return env;
}
