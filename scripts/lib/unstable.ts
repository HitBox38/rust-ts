// Oracle output that is not reproducible (lane harness-w20c): see `Suite.unstable` (harness/suites.ts) and the
// UNSTABLE status (scripts/difftest.ts), and the part of it that is masked at comparison instead (lane harness-w40).
// No imports, so unit tests can load it without scripts/lib/common.ts.

/**
 * Oracle stderr patterns that are not reproducible between two runs of the same oracle binary (lane harness-w20c).
 * A single-mode case whose oracle stderr matches one is UNSTABLE even if its suite does not list it
 * (`Suite.unstable`): its output is never cached (a cached one is removed) and never compared. compiletest normalizes
 * the first away (runtest.rs `normalize_output`: `$LONG_TYPE_HASH`), which this harness does not do, and avoids the
 * second (`RUSTC_ICE=0`; rustc_driver_impl `ice_path_with_config`). The panic message's thread id used to be here; it is
 * masked at comparison now (`maskThreadId`).
 */
export const UNSTABLE_ORACLE_PATTERNS: { re: RegExp; reason: string }[] = [
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
 * std's panic message names the OS thread id, `thread '<name>' (<tid>) panicked`, which no two runs share. This masks
 * only those digits (lane harness-w40; docs/reviews/plan-ice-report.md): compiletest's own normalization
 * (runtest.rs:2626, `$TID`), narrower: anchored at the line's start, keeping the name and `rtid`, so a thread name, a
 * location or a payload still compares. An id that is not digits stays as it is. A literal `<tid>` gets one more `<`, so
 * that no text can equal a masked id: the mapping is injective but for the digits.
 */
export const maskThreadId = (stderr: string): string =>
  stderr.replace(/^(thread '[^'\n]*' \((?:rtid )?)(\d+|<+tid>)(\) panicked)/gm, (_m, a: string, id: string, b: string) => `${a}${id.startsWith("<") ? `<${id}` : "<tid>"}${b}`);

/**
 * The mask a comparison applies to a stderr, given the oracle's stderr. A Miri suite (`Suite.miri`; lane harness-m6a)
 * masks only when its host process ICEd (`isIceStderr`, including the `bug!` path): an interpreted program's panic message
 * names the id Miri's `gettid` shim returns (shims/env.rs `get_tid`: the pid plus the thread index, and with isolation on
 * the pid is a constant, so `thread 'main' (1000) panicked`), which is deterministic and must be compared.
 */
export const stderrMask = (miri: boolean, oracleStderr: string): ((stderr: string) => string) => (!miri || isIceStderr(oracleStderr) ? maskThreadId : (e) => e);

/** The markers of a single-mode output's text (difftest `render`). */
export const STDERR_MARK = "\n--- stderr ---\n";
export const EXIT_MARK = "\n--- exit: ";

/**
 * Where the stderr of a rendered text starts and ends. The last marker: `render` puts the real one after all of stdout,
 * so whatever a stdout holds, this range is inside the real stderr. A stderr that prints the marker itself gets a range
 * too short, which masks less and can only show a difference, never hide one.
 */
function stderrRange(text: string): [number, number] | undefined {
  const start = text.lastIndexOf(STDERR_MARK);
  const end = text.lastIndexOf(EXIT_MARK);
  return start < 0 || end < start + STDERR_MARK.length ? undefined : [start + STDERR_MARK.length, end];
}

/**
 * The two rendered texts a single-mode case compares: both sides' stderr masked (`stderrMask`), stdout and the exit code
 * as they are. What is cached and what the diff files show keep the raw text. A text with no markers (a subject that
 * timed out) stays as it is.
 */
export function maskedTexts(miri: boolean, oracle: string, subject: string): [string, string] {
  const o = stderrRange(oracle);
  const mask = stderrMask(miri, o ? oracle.slice(o[0], o[1]) : "");
  const masked = (text: string, r: [number, number] | undefined) => (r ? text.slice(0, r[0]) + mask(text.slice(r[0], r[1])) + text.slice(r[1]) : text);
  return [masked(oracle, o), masked(subject, stderrRange(subject))];
}
