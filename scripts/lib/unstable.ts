// Oracle output that is not reproducible (lane harness-w20c): see `Suite.unstable` (harness/suites.ts) and the
// UNSTABLE status (scripts/difftest.ts). No imports, so unit tests can load it without scripts/lib/common.ts.

/** The thread-id pattern of `UNSTABLE_ORACLE_PATTERNS`, named so `unstableMiriOracleReason` does not depend on its position. */
export const THREAD_ID_PATTERN: { re: RegExp; reason: string } = {
  re: /^thread '[^'\n]*' \((?:rtid )?\d+\) panicked/m,
  reason: "the panic message names the oracle's OS thread id (`thread '<name>' (<tid>) panicked`)",
};
/**
 * Oracle stderr patterns that are not reproducible between two runs of the same oracle binary (lane harness-w20c).
 * A single-mode case whose oracle stderr matches one is UNSTABLE even if its suite does not list it
 * (`Suite.unstable`): its output is never cached (a cached one is removed) and never compared. compiletest
 * normalizes the first two away (runtest.rs `normalize_output`: `$TID`, `$LONG_TYPE_HASH`), which this harness does
 * not do, and avoids the third (`RUSTC_ICE=0`; rustc_driver_impl `ice_path_with_config`).
 */
export const UNSTABLE_ORACLE_PATTERNS: { re: RegExp; reason: string }[] = [
  THREAD_ID_PATTERN,
  { re: /\.long-type-\d+\.txt'/, reason: "the long-type note names `<stem>.long-type-<hash>.txt`, a hash of an interned type's address" },
  { re: /rustc-ice-[0-9T_:-]+-\d+\.txt/, reason: "the ICE note names the report file `rustc-ice-<time>-<pid>.txt`" },
];

/** The reason of the first `UNSTABLE_ORACLE_PATTERNS` entry that `stderr` matches, if any. */
export function unstableOracleReason(stderr: string): string | undefined {
  const p = UNSTABLE_ORACLE_PATTERNS.find((p) => p.re.test(stderr));
  return p ? `detected: ${p.reason}` : undefined;
}

/**
 * The host process (Miri or rustc) ICEd: rustc_driver_impl `report_ice` (lib.rs:1539) prints `error: the compiler
 * unexpectedly panicked. This is a bug` only when the payload is not an `ExplicitBug` / `DelayedBugPanic` (a `bug!` /
 * `span_bug!` / delayed bug has printed its own `error: internal compiler error: ...` already), but always prints the
 * `IceVersion` note (`note: rustc <version> running on <host tuple>`), and before it either `IceBugReport` (`note: we
 * would appreciate a bug report: <url>`) or `IceBugReportInternalFeature` (`note: using internal features is not
 * supported ...`). Any one of these marks the stderr as an ICE (lane harness-w36; review harness-m6a N1).
 */
const ICE_MARKERS = [
  /the compiler unexpectedly panicked/,
  /^error: internal compiler error(?:\[E\d+\])?: /m,
  /^note: we would appreciate a bug report: /m,
  /^note: using internal features is not supported and expected to cause internal compiler errors/m,
  /^note: rustc \S+.* running on \S+$/m,
];
export const isIceStderr = (stderr: string): boolean => ICE_MARKERS.some((re) => re.test(stderr));

/**
 * `unstableOracleReason` for a Miri suite (`Suite.miri`; lane harness-m6a). The interpreted program's panic message
 * names the thread id Miri's `gettid` shim returns (shims/env.rs `get_tid`: the pid plus the thread index, and with
 * isolation on the pid is a constant, so `thread 'main' (1000) panicked`): deterministic, never a reason. Only a panic
 * of the host process itself (Miri or rustc ICEing, `isIceStderr`, including the `bug!` path) names a real OS thread
 * id; the thread-id pattern (`THREAD_ID_PATTERN`) applies only then. The other patterns apply as everywhere.
 */
export function unstableMiriOracleReason(stderr: string): string | undefined {
  const ice = isIceStderr(stderr);
  const p = UNSTABLE_ORACLE_PATTERNS.find((p) => (p !== THREAD_ID_PATTERN || ice) && p.re.test(stderr));
  return p ? `detected: ${p.reason}` : undefined;
}
