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

/**
 * `unstableOracleReason` for a Miri suite (`Suite.miri`; lane harness-m6a). The interpreted program's panic message
 * names the thread id Miri's `gettid` shim returns (shims/env.rs `get_tid`: the pid plus the thread index, and with
 * isolation on the pid is a constant, so `thread 'main' (1000) panicked`): deterministic, never a reason. Only a panic
 * of the host process itself (Miri or rustc ICEing, which prints rustc_driver_impl's `the compiler unexpectedly
 * panicked. This is a bug` from its ICE hook) names a real OS thread id; the thread-id pattern applies only then. The
 * other patterns apply as everywhere.
 */
export function unstableMiriOracleReason(stderr: string): string | undefined {
  const ice = /the compiler unexpectedly panicked/.test(stderr);
  const p = UNSTABLE_ORACLE_PATTERNS.find((p, i) => (i !== 0 || ice) && p.re.test(stderr));
  return p ? `detected: ${p.reason}` : undefined;
}
