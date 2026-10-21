// Oracle output that is not reproducible (lane harness-w20c): see `Suite.unstable` (harness/suites.ts) and the
// UNSTABLE status (scripts/difftest.ts). No imports, so unit tests can load it without scripts/lib/common.ts.

/**
 * Oracle stderr patterns that are not reproducible between two runs of the same oracle binary (lane harness-w20c).
 * A single-mode case whose oracle stderr matches one is UNSTABLE even if its suite does not list it
 * (`Suite.unstable`): its output is never cached (a cached one is removed) and never compared. compiletest
 * normalizes the first two away (runtest.rs `normalize_output`: `$TID`, `$LONG_TYPE_HASH`), which this harness does
 * not do, and avoids the third (`RUSTC_ICE=0`; rustc_driver_impl `ice_path_with_config`).
 */
export const UNSTABLE_ORACLE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /^thread '[^'\n]*' \((?:rtid )?\d+\) panicked/m, reason: "the panic message names the oracle's OS thread id (`thread '<name>' (<tid>) panicked`)" },
  { re: /\.long-type-\d+\.txt'/, reason: "the long-type note names `<stem>.long-type-<hash>.txt`, a hash of an interned type's address" },
  { re: /rustc-ice-[0-9T_:-]+-\d+\.txt/, reason: "the ICE note names the report file `rustc-ice-<time>-<pid>.txt`" },
];

/** The reason of the first `UNSTABLE_ORACLE_PATTERNS` entry that `stderr` matches, if any. */
export function unstableOracleReason(stderr: string): string | undefined {
  const p = UNSTABLE_ORACLE_PATTERNS.find((p) => p.re.test(stderr));
  return p ? `detected: ${p.reason}` : undefined;
}
