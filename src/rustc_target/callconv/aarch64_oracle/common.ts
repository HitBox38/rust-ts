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
  /** Both sides ICE, each in its own form: the test compares the exit code and the panic's message, not all of stderr. */
  ice?: boolean;
}
// `sizes.rs` also runs on x86_64, the only way into `callconv/x86_64.ts`: what `abi.rs` would add there is not worth its fixture.
// `big.rs` and `big_err.rs` pin `Size` sites outside `callconv/` (lane fixers-46): they ride in this process for the unit budget.
// The ICE case is last, so no session runs after a panic.
export const CASES: Case[] = [
  ...TARGETS.map((target) => ({ target, file: "abi.rs", oracle: `${target}.txt` })),
  ...[...TARGETS, "x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"].map((target) => ({ target, file: "sizes.rs", oracle: `sizes.${target}.txt` })),
  { target: "aarch64-apple-darwin", file: "big.rs", oracle: "big.aarch64-apple-darwin.txt" },
  { target: "aarch64-apple-darwin", file: "big_err.rs", oracle: "big_err.aarch64-apple-darwin.txt" },
  { target: "aarch64-apple-darwin", file: "scalable_indirect.rs", oracle: "scalable_indirect.aarch64-apple-darwin.txt", ice: true },
];

/**
 * The panic message of an oracle ICE report: the lines after `thread 'rustc' (<id>) panicked at <location>:`, up to the
 * `RUST_BACKTRACE` note. The port prints the same message after `rust-ts: internal compiler error: `.
 */
export function ice_message(oracle_stderr: string): string {
  const m = /^thread 'rustc' \(\d+\) panicked at [^\n]*:\n([\s\S]*?)\nnote: run with `RUST_BACKTRACE=1`/m.exec(oracle_stderr);
  if (m === null) throw new Error("ERROR: no panic message in the oracle's ICE report");
  return m[1]!;
}

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
