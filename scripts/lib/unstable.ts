// Oracle output that is not reproducible (lane harness-w20c): see `Suite.unstable` (harness/suites.ts) and the
// UNSTABLE status (scripts/difftest.ts), and the part of it that is masked at comparison instead (lane harness-w40).
// No imports, so unit tests can load it without scripts/lib/common.ts.

/**
 * Oracle stderr patterns that are not reproducible between two runs of the same oracle binary (lane harness-w20c).
 * A single-mode case whose oracle stderr matches one is UNSTABLE even if its suite does not list it
 * (`Suite.unstable`): its output is never cached (a cached one is removed) and never compared. compiletest avoids this
 * one (`RUSTC_ICE=0`; rustc_driver_impl `ice_path_with_config`). The panic message's thread id and the long-type note's
 * hash used to be here; they are masked at comparison now (`maskThreadId`, `maskLongTypeHash`).
 */
export const UNSTABLE_ORACLE_PATTERNS: { re: RegExp; reason: string }[] = [
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
  /^error: the compiler unexpectedly panicked/m,
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

/** `maskThreadId` of the host compiler's thread alone (rustc_interface `run_in_thread_with_globals`'s `.name("rustc")`). */
const maskRustcThreadId = (stderr: string): string =>
  stderr.replace(/^(thread 'rustc' \((?:rtid )?)(\d+|<+tid>)(\) panicked)/gm, (_m, a: string, id: string, b: string) => `${a}${id.startsWith("<") ? `<${id}` : "<tid>"}${b}`);

/**
 * The long-type note, `the full name for the type has been written to '<dir>/<stem>.long-type-<digits>.txt'`, names a hash
 * of an interned type's address (rustc_middle ty/error.rs `short_string_namespace`: `DefaultHasher` over `Hash` of an
 * interned value), which ASLR changes on every run, so no value can match. This masks only those digits (lane harness-w40;
 * docs/reviews/fixers-40.md N1): compiletest's own normalization (runtest.rs:2616, `$LONG_TYPE_HASH`), differing in both directions:
 * compiletest's pattern has no quote and needs `$TEST_BUILD_DIR/` and a stem with no dot; this one is narrower on the closing quote and wider on the
 * directory, so that the directory, the stem (digits in it included) and the note's text still compare. A literal
 * `<hash>` gets one more `<`, as in `maskThreadId`. What this gives up: whether two notes name one file.
 */
export const maskLongTypeHash = (stderr: string): string =>
  stderr.replace(/(\.long-type-)(\d+|<+hash>)(\.txt')/g, (_m, a: string, id: string, b: string) => `${a}${id.startsWith("<") ? `<${id}` : "<hash>"}${b}`);

/**
 * The mask a comparison applies to a stderr, given the oracle's stderr: the long-type hash always; the thread id everywhere but a Miri
 * suite (`Suite.miri`; lane harness-m6a). There an interpreted program's panic message names the id Miri's `gettid` shim returns
 * (shims/env.rs `get_tid`: the pid plus the thread index, and with isolation on the pid is a constant, so `thread 'main' (1000) panicked`),
 * which is deterministic and must be compared. So a Miri suite masks only when its host process ICEd (`isIceStderr`, including the
 * `bug!` path), and then only the host's thread, `thread 'rustc'` (docs/reviews/harness-w40.md L2): a program's own panic before the ICE,
 * or a program that merely prints a marker, keeps its id compared. A host panic on another thread stays unmasked, and shows as a DIFF.
 * **What is still hidden:** a program that names its own thread `rustc` and prints an ICE marker at the start of a line. Text alone
 * cannot tell that from an ICE. No case does it, and it hides only the digits of that one line.
 */
export const stderrMask = (miri: boolean, oracleStderr: string): ((stderr: string) => string) =>
  !miri ? (e) => maskLongTypeHash(maskThreadId(e)) : isIceStderr(oracleStderr) ? (e) => maskLongTypeHash(maskRustcThreadId(e)) : maskLongTypeHash;

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
