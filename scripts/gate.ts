// The ratchet. The protected set (harness/baseline/<suite>.txt) lists every case that has
// ever been accepted as MATCH. A revision is acceptable only if it loses none of them.
//
//   bun scripts/gate.ts run [--suites lex,parse] [--skip-static] [--skip-heavy]
//       oracle check (pinned commit and components, scripts/lib/toolchain.ts) + probe check + typecheck + unit tests (src/tools in 4 worker processes, then its heaviest files alone, then scripts/harness in a second process, one file at a time;
//       RUST_TS_REQUIRE_PROBES=1; any skipped test not in ALLOWED_SKIPS fails) + marker check + marker order of src/rustc_monomorphize/ + full difftest
//       of each suite; prints lost/gained.
//       Heavy suites (`Suite.heavy`, plan-m5 §4.2: core-scale runs, one process at a time) run after all the
//       others, one after another, and print each run's wall/user time and max RSS (an RSS over the suite's budget
//       is a `note:`, not a failure: D11). `--skip-heavy` leaves them out: they are listed as not run (`notRun` in
//       gate.json), none of their cases counts as lost, and the run cannot be accepted if one of them is protected.
//       It refuses to start on battery (one `ERROR:` line), unless `--allow-battery`: a gate on battery ran up to 3.5x slower, so a
//       timeout can become a false protected loss (docs/reviews/perf-near-limit.md, question c). Power lost during a run is a `note:`, never
//       a failure. gate.json records power, load, swap and times (`host`, `SuiteGate.startedAt`...), which no status or verdict reads
//       (scripts/lib/host-state.ts). On a host with no battery or no `pmset`, none of this does anything but record `power: null`.
//       The static steps end with two more (lane harness-w44): INFO sites (src/rust_ts/info_sites_check.ts: every upstream INFO site
//       in a ported fn is live or a stop) and frozen lists (scripts/frozen-lists.ts: a fixed sample of protected cases with the
//       interned lists frozen). A failed static step stops the run before the suites (review harness-w43 F7): the run cannot be
//       accepted, so its suites would cost hours for nothing. gate.json is written with `pass: false`, no suite results, and every
//       suite listed in `notRun`; `--skip-static` runs the suites without the static steps (and that run cannot be accepted either).
//       Its `upstreamOk` is checked then (the static steps must leave the upstream checkout clean). Both records name the frozen
//       lists step's run directory (`frozenLists`, `<run>-frozen-lists`), null when it wrote none.
//       It refuses to start while `RUST_TS_FREEZE_LISTS` or `NODE_ENV` is set (`freezeEnvRefusal`): every subject would inherit it.
//       A static step without a junit report that prints `note:` lines (frozen lists, on a missing `gate.json`) has them printed in
//       the gate's output and recorded in gate.json `staticNotes` (review root-w44-check N1); they never decide anything.
//   bun scripts/gate.ts accept --run <run-id>
//       grow the protected set with that gate run's new MATCHes. Refused if the run lost anything,
//       skipped static checks, skipped a protected suite, ran on a dirty tree, or HEAD has moved since.
//
// Unstable cases (`Suite.unstable`, difftest's UNSTABLE status: oracle output that is not reproducible) are never
// protected: a run fails if a baseline lists one, and accept refuses to add one. The upstream checkout must be clean
// when a run starts (or it stops with `ERROR:`), and a run fails if a suite changes it (scripts/lib/upstream.ts).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HOST_RLIB_RUN, IR_RUN, MIRI_SYSROOT_RUN, RG_CHECK, RLIB_NATIVE_RUN, RMETA_RUN, SUITES, suite as getSuite, type Suite } from "../harness/suites.ts";
import { difftest, heavyErrorLines, heavyLine, unstableOf, type HeavyRun, type OracleRerun, type RetryLoad, type Usage } from "./difftest.ts";
import { DATA, REPO, RUNS, UPSTREAM, die, ensureDir, nowId, parseArgs, run } from "./lib/common.ts";
import { HostLog, REAL_HOST, StuckReads, batteryRefusal, sampleHost, type HostReaders, type HostSample } from "./lib/host-state.ts";
import { miriBinary } from "./lib/miri.ts";
import { verifyOraclePin } from "./lib/oracle.ts";
import { BUN_QUIET_VARS, UNIT_STEPS, UNIT_TEST_TIMEOUT_MS, aloneJunit, aloneStepArgs, oneProcessEnv, unitStepArgs, unitStepEnv, type UnitStep } from "./lib/unit-steps.ts";
import { upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { oracleTestProbes, probeBinary, probeStaleness } from "./probes.ts";
import { parseIrRunArgs } from "./ir-run.ts";
import type { IrTier } from "./lib/ir-normal.ts";
import { parseHostRlibRunArgs } from "./host-rlib-run.ts";
import { parseMiriSysrootRunArgs } from "./miri-sysroot-run.ts";
import { parseRmetaRunArgs } from "./rmeta-run.ts";
import { parseRlibNativeRunArgs } from "./rlib-native-run.ts";
import { record } from "./state.ts";

const BASELINE = join(REPO, "harness", "baseline");

export function readBaseline(suite: string): Set<string> {
  const p = join(BASELINE, `${suite}.txt`);
  if (!existsSync(p)) return new Set();
  return new Set(readFileSync(p, "utf8").split("\n").filter(Boolean));
}

interface SuiteGate {
  suite: string;
  baseline: number;
  match: number;
  total: number;
  lost: string[];
  gained: string[];
  /** See `SubjectStats` in difftest.ts (informational; never affects pass/accept). */
  batchOnlyFailures?: number;
  batchOnlyTimeouts?: number;
  /** Cases whose oracle timed out twice (ORACLE_TIMEOUT): not MATCH, so a protected one is lost. */
  oracleTimeouts?: string[];
  /** Protected cases the suite does not generate on this host, with the suite's reason (`Suite.skipped`). */
  lostSkipped?: { id: string; reason: string }[];
  /** Cases whose oracle output is not reproducible (UNSTABLE: listed in `Suite.unstable` or detected); never protected. */
  unstable?: string[];
  /** Cases whose subject timed out in difftest's parallel pool and were re-run alone (their status is the re-run's). */
  retried?: string[];
  /**
   * Every subject that timed out in the pool, with its final status and each attempt's time and max RSS (`CaseResult.attempts`).
   * Informational: a status never reads it. Lane harness-w40; `MATCH` here is a case that matched only through the re-run.
   * `load1`: the host's 1-minute load at the pool's timeout and around the re-run (`RetryLoad`; lane harness-w45): a lost
   * near-limit case with a high `aloneStart`/`aloneEnd` lost to outside load. scripts/frozen-lists.ts reads the ids.
   */
  retryTimes?: { id: string; status: string; pool: Usage; alone?: Usage; load1?: RetryLoad }[];
  /** Paths of the upstream checkout this suite's run changed (scripts/lib/upstream.ts); any fails the run. */
  upstreamChanges?: string[];
  /** Heavy suites: each run's wall/user time and max RSS (informational; an RSS over budget never fails the run). */
  heavy?: HeavyRun[];
  /**
   * Heavy suites: the `ERROR:` lines of `heavyErrorLines` (a subject over its RSS budget, an unavailable resource usage).
   * Reported and recorded, but by root's decision (lane harness-m5b; plan-m5 D11) they do not by themselves fail the gate.
   */
  heavyErrors?: string[];
  /** Split suites: how many sections only the subject printed (not cases; listed in the run's `<suite>.extra.jsonl`). */
  extra?: number;
  /**
   * Split suites: each run's oracle re-run for its diff files (difftest.ts header). One that did not reproduce the
   * cached entry made the cases it would have scored UNSTABLE, so a protected one among them is lost.
   */
  oracleReruns?: OracleRerun[];
  /** Informational (scripts/lib/host-state.ts): when the suite ran, and power, load and swap at its two ends. */
  startedAt?: string;
  endedAt?: string;
  hostStart?: HostSample;
  hostEnd?: HostSample;
  /** An IR suite: the normal form tier this run read it at (review harness-m7a H3). */
  irTier?: IrTier;
}

/** Where a gate's host record comes from: the real host, or a test's fake readers. */
export interface GateHost {
  readers: HostReaders;
  pollMs: number;
  keepEveryMs: number;
  /** `sampleHost`'s limit; tests shorten it. */
  readLimitMs?: number;
  /** Tests only: replaces `staticChecks` (then the unit tests' probes are not required: no unit test runs). */
  staticChecks?: (runDir: string) => Promise<StaticChecks>;
}
const REAL_GATE_HOST: GateHost = { readers: REAL_HOST, pollMs: 60_000, keepEveryMs: 600_000 };

/**
 * Why the gate must not start with this environment, or `undefined`. `RUST_TS_FREEZE_LISTS=1` (or `NODE_ENV=test`) freezes the
 * interned lists of every subject it starts (src/rustc_middle/ty/list.ts `FREEZE_LISTS`; scripts/lib/env.ts passes both on): the
 * output is the same, but heavy next-solver cases run about 22% longer, enough to turn a case near its limit into a false loss
 * (review perf-heavy F3). Any other `NODE_ENV` would leave the unit tests' lists unfrozen (`bun test` sets it only when unset,
 * review perf-heavy F2). The "frozen lists" step sets the variable for its own sample only.
 */
export function freezeEnvRefusal(env: Record<string, string | undefined> = process.env): string | undefined {
  const set = ["RUST_TS_FREEZE_LISTS", "NODE_ENV"].filter((k) => env[k] !== undefined);
  if (set.length === 0) return undefined;
  return `${set.map((k) => `${k}=${env[k]}`).join(" and ")} set: every subject (and \`bun test\`) would inherit it; unset it and re-run the gate (the "frozen lists" step freezes its own sample)`;
}

/** Protected ids of `suite` that its `Suite.unstable` lists: an unstable case can never be protected. */
export function protectedUnstable(suite: string, base: Set<string> = readBaseline(suite)): string[] {
  return [...unstableOf(getSuite(suite)).keys()].filter((id) => base.has(id)).sort();
}

/**
 * Every probe the gate needs must be built before anything runs: the oracle probes of the suites
 * it runs (`Suite.probes`) and, unless static checks are skipped, the probes the unit tests read
 * (they run with RUST_TS_REQUIRE_PROBES=1, so a missing probe fails them): the ones named in test
 * files (`oracleTestProbes`) and every registered suite's, which scripts/gate-probes.test.ts needs
 * to check every suite's oracle command. One `ERROR:` line per missing probe, with its build
 * command. Also checks that every program each suite's oracle command runs (`oracleRuns`) is
 * `rustc` or one of its declared probes, so `Suite.probes` cannot drift from `Suite.oracle`
 * (`undeclaredRuns`).
 */
export function checkProbes(suites: string[], unitTests: boolean): boolean {
  const need = new Map<string, string[]>();
  const add = (probe: string, by: string) => {
    const b = need.get(probe) ?? [];
    if (!b.includes(by)) need.set(probe, [...b, by]);
  };
  for (const name of suites) for (const p of getSuite(name).probes ?? []) add(p, `suite ${name}`);
  if (unitTests) {
    for (const p of oracleTestProbes(UNIT_STEPS.flatMap((u) => u.roots))) add(p, "unit tests");
    for (const s of SUITES) for (const p of s.probes ?? []) add(p, "runner unit tests (scripts/gate-probes.test.ts)");
  }
  let ok = true;
  for (const [probe, by] of [...need].sort()) {
    if (!existsSync(probeBinary(probe))) {
      console.log(`ERROR: probe '${probe}' not built (needed by ${by.join(", ")}); run: bun scripts/probes.ts build ${probe}`);
      ok = false;
      continue;
    }
    // Fails here, in seconds, not after a whole gate (review harness-w39 N2). `unknown` is not stale: it says nothing.
    const stale = probeStaleness(probe);
    if (stale.state === "stale") {
      console.log(`ERROR: ${stale.why}`);
      ok = false;
    }
  }
  if (!ok) return false;
  for (const name of suites) {
    for (const e of undeclaredRuns(getSuite(name))) {
      console.log(`ERROR: ${e}`);
      ok = false;
    }
  }
  return ok;
}

/**
 * The programs an oracle command runs: its first word, except for scripts/rmeta-run.ts under Bun (the rmeta suites),
 * or scripts/miri-sysroot-run.ts or scripts/host-rlib-run.ts or scripts/rlib-native-run.ts
 * where it is the wrapper's compiler (the first word after its `--`) and, with `--dump`, its probe, for scripts/ir-run.ts
 * (the IR suites), its compiler, and for scripts/rg-check.ts (the check-rg suites), the oracle rustc through its cargo.
 * Throws on a malformed wrapper command line (`parseRmetaRunArgs`, `parseIrRunArgs`).
 */
export function oracleRuns(cmd: string[]): string[] {
  if (cmd[0] === process.execPath && cmd[1] === IR_RUN) return [parseIrRunArgs(cmd.slice(2)).compiler[0]!];
  if (cmd[0] === process.execPath && cmd[1] === RG_CHECK) return ["rustc"];
  if (cmd[0] === process.execPath && cmd[1] === MIRI_SYSROOT_RUN) return [parseMiriSysrootRunArgs(cmd.slice(2)).compiler[0]!];
  if (cmd[0] === process.execPath && cmd[1] === HOST_RLIB_RUN) return [parseHostRlibRunArgs(cmd.slice(2)).compiler[0]!];
  if (cmd[0] === process.execPath && cmd[1] === RLIB_NATIVE_RUN) return [parseRlibNativeRunArgs(cmd.slice(2)).compiler[0]!];
  if (cmd[0] === process.execPath && cmd[1] === RMETA_RUN) {
    const a = parseRmetaRunArgs(cmd.slice(2));
    return [a.compiler[0]!, ...(a.dump !== undefined ? [a.dump] : [])];
  }
  return [cmd[0]!];
}

/**
 * One message per program a suite's oracle command runs (`oracleRuns`) that is neither `rustc` nor a declared probe
 * (nor, for a Miri suite, the isolated Miri binary).
 */
export function undeclaredRuns(s: Suite): string[] {
  const declared = (s.probes ?? []).map(probeBinary);
  let runs: string[];
  try {
    runs = oracleRuns(s.oracle([{ id: "", file: "", args: [] }]));
  } catch (e) {
    return [`suite ${s.name}: ${e instanceof Error ? e.message : String(e)}`];
  }
  // A Miri suite's oracle is the isolated toolchain's Miri (scripts/lib/miri.ts; difftest verifies it).
  const miri = s.miri ? miriBinary() : undefined;
  return runs.filter((p) => p !== "rustc" && p !== miri && !declared.includes(p)).map((p) => `suite ${s.name} runs ${p} but declares probes [${(s.probes ?? []).join(", ")}]`);
}

/**
 * Unit tests that may skip under RUST_TS_REQUIRE_PROBES=1. Every other skipped test fails the gate:
 * with every probe required, a skip means a test silently did not run (a missing input, a guard
 * that no longer holds, a `test.skip` left behind). An entry names one test exactly: its file and
 * its full path (enclosing `describe` names, outermost first, then the test name), and allows it
 * to skip at most once.
 */
export const ALLOWED_SKIPS: { file: string; path: string[]; why: string }[] = [
  {
    // Upstream `#[cfg(target_os = "linux")]`: reads /proc/self/cmdline, whose stat size lies (0).
    // The port keeps the platform gate (`test.skipIf(process.platform !== "linux")`), top level.
    file: "src/rustc_span/source_map/tests.test.ts",
    path: ["read_binary_file_handles_lying_stat"],
    why: "Linux-only test (upstream #[cfg(target_os = \"linux\")])",
  },
];

export interface SkippedTest {
  file: string;
  /** Enclosing `describe` names (outermost first), then the test name. */
  path: string[];
}

const xmlUnescape = (s: string): string =>
  s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-fA-F]+|#\d+);/g, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );

const xmlAttr = (attrs: string, k: string): string | undefined => {
  const a = new RegExp(`\\s${k}="([^"]*)"`).exec(attrs);
  return a ? xmlUnescape(a[1]!) : undefined;
};

/**
 * Skipped and failed test cases of a `bun test --reporter=junit` report. Bun writes one `<testsuite>` per
 * file, nested `<testsuite>`s for `describe` blocks, and `<testcase ...>` elements (self-closing,
 * or holding `<skipped .../>` / `<failure>`). The report is read as a sequence of these tags, with
 * attributes matched as `k="..."` pairs (a value may contain `>`, never a raw `"`), keeping a stack
 * of open `<testsuite>` names for each test's `describe` path. Throws on an unbalanced report or if
 * the skipped count disagrees with the report's own `<testsuites skipped="N">` total.
 */
export function junitTests(xml: string): { skipped: SkippedTest[]; failed: SkippedTest[]; files: string[]; slowest?: TimedTest } {
  const out: SkippedTest[] = [];
  const failed: SkippedTest[] = [];
  const files = new Set<string>();
  let slowest: TimedTest | undefined;
  const suites: string[] = [];
  let cur: { file: string; path: string[]; skipped: boolean; failed: boolean } | undefined;
  const tags = /<(\/?)(testsuites|testsuite|testcase|skipped|failure)\b((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  for (const m of xml.matchAll(tags)) {
    const [, close, tag, attrs, selfClose] = m as unknown as [string, string, string, string, string];
    if (tag === "testsuite") {
      if (close) {
        if (suites.pop() === undefined) throw new Error("junit report: unbalanced </testsuite>");
      } else if (!selfClose) suites.push(xmlAttr(attrs, "name") ?? "");
    } else if (tag === "testcase") {
      if (close) {
        if (!cur) throw new Error("junit report: unbalanced </testcase>");
        if (cur.skipped) out.push({ file: cur.file, path: cur.path });
        if (cur.failed) failed.push({ file: cur.file, path: cur.path });
        cur = undefined;
      } else {
        if (cur) throw new Error("junit report: nested <testcase>");
        // suites[0] is the file's own <testsuite>; the rest are describe blocks.
        const t = { file: (xmlAttr(attrs, "file") ?? "").replaceAll("\\", "/"), path: [...suites.slice(1), xmlAttr(attrs, "name") ?? ""], skipped: false, failed: false };
        files.add(t.file);
        const timeS = Number(xmlAttr(attrs, "time"));
        if (Number.isFinite(timeS) && (slowest === undefined || timeS > slowest.timeS)) slowest = { file: t.file, path: t.path, timeS };
        if (!selfClose) cur = t;
      }
    } else if (tag === "skipped" && !close && cur) {
      cur.skipped = true;
    } else if (tag === "failure" && !close && cur) {
      cur.failed = true;
    }
  }
  if (cur || suites.length) throw new Error("junit report: unterminated <testcase>/<testsuite>");
  const total = /<testsuites\b(?:\s+[\w:.-]+="[^"]*")*?\s+skipped="(\d+)"/.exec(xml);
  if (!total) throw new Error("junit report has no <testsuites skipped=...> total");
  if (Number(total[1]) !== out.length) throw new Error(`junit report says ${total[1]} skipped, found ${out.length} skipped testcases`);
  return { skipped: out, failed, files: [...files].sort(), ...(slowest ? { slowest } : {}) };
}

/** A test case of a junit report with its time (`<testcase time="...">`, seconds). */
export interface TimedTest extends SkippedTest {
  timeS: number;
}

/**
 * The test files `bun test`'s output names with an error outside any test: Bun prints the file's path on a line of its own
 * (`src/x.test.ts:`), then `# Unhandled error between tests`. A file that throws at load (a top-level throw, a bad import,
 * a throwing `describe`) is reported only this way: it is absent from the junit report (review unit-parallel N3).
 */
export function errorsOutsideTests(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const files = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "# Unhandled error between tests") continue;
    for (let j = i - 1; j >= 0; j--) {
      const m = /^(\S.*\.test\.[cm]?[jt]sx?):$/.exec(lines[j]!);
      if (m) {
        files.add(m[1]!.replaceAll("\\", "/"));
        break;
      }
    }
  }
  return [...files].sort();
}

/** A unit report's slowest test above this many seconds is a `note:` (review unit-parallel N4): half the 60 s per-test limit. */
export const SLOW_TEST_NOTE_S = 30;

/** Skipped test cases of a `bun test --reporter=junit` report (`junitTests`). */
export const junitSkips = (xml: string): SkippedTest[] => junitTests(xml).skipped;

/** Splits skips into allowlisted and unexpected ones; each ALLOWED_SKIPS entry is used at most once. */
export function classifySkips(skips: SkippedTest[]): { allowed: SkippedTest[]; unexpected: SkippedTest[] } {
  const unused = [...ALLOWED_SKIPS];
  const allowed: SkippedTest[] = [];
  const unexpected: SkippedTest[] = [];
  for (const t of skips) {
    const i = unused.findIndex((a) => a.file === t.file && a.path.length === t.path.length && a.path.every((p, j) => p === t.path[j]));
    if (i >= 0) {
      unused.splice(i, 1);
      allowed.push(t);
    } else unexpected.push(t);
  }
  return { allowed, unexpected };
}

/** Unit-test skips of a gate run (recorded in gate.json). */
interface SkipReport {
  skipped: number;
  allowed: number;
  unexpected: SkippedTest[];
}

/** One static step of the gate. `junit`: the step writes that junit report, whose skipped tests are checked. */
export interface StaticStep {
  name: string;
  cmd: string[];
  /** Added to the gate's environment; null unsets a variable. */
  env: Record<string, string | null>;
  junit?: string;
  /** Working directory; default the repo. */
  cwd?: string;
  /** With `junit`: a slowest test above this many seconds is a `note:` (default `SLOW_TEST_NOTE_S`). */
  slowNoteS?: number;
  /** With `junit`: the files of this step's report are run one after another, alone (the note's advice differs). */
  alone?: boolean;
}

/**
 * The static steps of unit-test step `u` (scripts/lib/unit-steps.ts), their junit reports in `runDir`: the step, then
 * "<name> (alone)" if it runs files alone after its workers. A pass in one process (the alone files, or a step without
 * workers) has `oneProcessEnv`, so that Bun names its files as it starts them (`crashedIn`, review harness-w45 N1).
 */
export function unitStaticSteps(u: UnitStep, runDir: string, timeoutMs: number = UNIT_TEST_TIMEOUT_MS): StaticStep[] {
  const env = unitStepEnv(DATA, process.env.RUST_TS_HOST_TUPLE);
  const junit = join(runDir, u.junit);
  const steps: StaticStep[] = [{ name: u.name, cmd: [process.execPath, ...unitStepArgs(u, junit, timeoutMs)], env: u.parallel === undefined ? oneProcessEnv(env) : env, junit }];
  const aloneReport = join(runDir, aloneJunit(u));
  const alone = aloneStepArgs(u, aloneReport, timeoutMs);
  if (alone) steps.push({ name: `${u.name} (alone)`, cmd: [process.execPath, ...alone], env: oneProcessEnv(env), junit: aloneReport, alone: true });
  return steps;
}

/** A line of `bun test`'s output that names the test file Bun is starting (`src/x.test.ts:`). */
const BUN_FILE_LINE = /^(\S.*\.test\.[cm]?[jt]sx?):$/;

/**
 * The test file `bun test` was running when its process ended without a junit report: the last file name in its output
 * (stderr, where Bun prints them), or undefined if it printed none. Bun prints a file's name as it starts the file, before
 * loading it, unless a BUN_QUIET_VARS variable is set (then only before a failure): so in a one-process pass with
 * `oneProcessEnv`, it is the file that called `process.exit`, aborted or crashed, at load or in a test (review harness-w45 N1).
 */
export function crashedIn(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = BUN_FILE_LINE.exec(lines[i]!);
    if (m) return m[1]!.replaceAll("\\", "/");
  }
  return undefined;
}

/**
 * The lines of a failed step's output worth printing: non-empty, without Bun's passing tests (`(pass) ...`), nor a file name
 * that nothing follows but another file name or the closing counts. With `oneProcessEnv` Bun prints both for every file,
 * and they would push the failure out of the tail the gate prints. Reporting only.
 */
export function outputTail(output: string, n = 15): string[] {
  const lines = output.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("(pass) "));
  const kept = lines.filter((l, i) => !(BUN_FILE_LINE.test(l) && i + 1 < lines.length && (BUN_FILE_LINE.test(lines[i + 1]!) || /^ \d+ pass$/.test(lines[i + 1]!))));
  return kept.slice(-n);
}

/** A `note:` line a static step printed (gate.json `staticNotes`; review root-w44-check N1). */
export interface StaticNote {
  step: string;
  note: string;
}

/** What the static steps found: `ok` decides; `skips` and `notes` are recorded. */
export interface StaticChecks {
  ok: boolean;
  skips?: SkipReport;
  notes?: StaticNote[];
}

/**
 * Runs one static step with the gate's 30-minute limit, prints its `ok`/`ERROR:` lines, and checks the skipped tests of
 * its junit report, if it writes one, against ALLOWED_SKIPS. `pass`: the step passed and nothing it skipped was not allowed.
 * A step that writes a report prints `ok` only once the report is read (review unit-parallel N3: an `exit(0)` in a serial
 * `bun test` leaves exit 0 and no report). A failed one names its failed tests and the files with an error outside any test
 * (`errorsOutsideTests`), or says that nothing is named. Each report's slowest test is printed, and one over `slowNoteS`
 * is a `note:` (review unit-parallel N4; reporting only: no file is moved).
 * A step without a report returns the `note:` lines it printed (`notes`), and prints them after its `ok` line, or, if it
 * failed, those not in the tail already printed (review root-w44-check N1: frozen lists' notes left no trace). A `bun test`
 * step's output holds its tests' own output, so its `note:` lines are not taken. Reporting only: `pass` is decided as before.
 */
export async function runStaticStep(step: StaticStep): Promise<{ pass: boolean; skips?: { allowed: SkippedTest[]; unexpected: SkippedTest[] }; notes?: string[] }> {
  const { name, cmd, env, junit: report, cwd } = step;
  const r = await run(cmd, { timeoutMs: 1_800_000, env, ...(cwd === undefined ? {} : { cwd }) });
  let pass = r.code === 0;
  const output = r.stdout + r.stderr;
  const tail = pass ? [] : outputTail(output);
  if (!pass) {
    console.log(`ERROR: ${name}`);
    console.log(tail.join("\n"));
  }
  if (report === undefined) {
    const notes = output.split(/\r?\n/).filter((l) => l.startsWith("note:"));
    if (pass) console.log(`ok    ${name}`);
    for (const l of notes) if (pass || !tail.includes(l)) console.log(l);
    return { pass, notes };
  }
  // Files with an error outside any test: in no report, so named from the output (review unit-parallel N3).
  const outside = pass ? [] : errorsOutsideTests(output);
  const nameOutside = (inReport: readonly string[]) => {
    for (const f of outside.slice(0, 20)) console.log(`  failed: ${f}: an error outside any test${inReport.includes(f) ? "" : " (it threw at load, a bad import or a throwing describe: the file is not in the junit report)"}`);
  };
  if (!existsSync(report)) {
    const exit = r.timedOut ? "timed out" : `exited ${r.code}`;
    console.log(`ERROR: ${name} wrote no junit report (${report}); cannot check for skipped tests (bun test ${exit}${r.timedOut ? "" : ": a test that called process.exit, an abort or a crash?"})`);
    nameOutside([]);
    // A worker that dies is named among the failures above; one process that ends names nothing but the last file it started (review harness-w45 N1).
    const last = crashedIn(r.stderr);
    if (last !== undefined) console.log(`  failed: ${last}: the last test file bun test started; the process ended in it with no report (process.exit, an abort or a crash, at load or in a test)`);
    else console.log(`  ${name}: bun test printed no test file's name, so the file is not known (Bun names its files only in a one-process pass, and only when none of ${BUN_QUIET_VARS.join(", ")} is set)`);
    return { pass: false };
  }
  let found: SkippedTest[];
  let failed: SkippedTest[];
  let files: string[];
  let slowest: TimedTest | undefined;
  try {
    ({ skipped: found, failed, files, slowest } = junitTests(readFileSync(report, "utf8")));
  } catch (e) {
    console.log(`ERROR: cannot read the ${name} junit report ${report}: ${e instanceof Error ? e.message : String(e)}`);
    return { pass: false };
  }
  if (pass) console.log(`ok    ${name}`);
  // Under --parallel the failures print wherever their worker's output lands, often outside the tail above.
  for (const t of failed.slice(0, 20)) console.log(`  failed: ${t.file}: ${t.path.join(" > ")}`);
  if (failed.length > 20) console.log(`  ... and ${failed.length - 20} more failed tests (${report})`);
  if (!pass) {
    nameOutside(files);
    if (failed.length === 0 && outside.length === 0) console.log(`ERROR: ${name}: bun test exited ${r.code}, but its junit report names no failed test and its output no file: a crash, a .only under CI=true, or a timeout of the step (see the output above)`);
  }
  const { allowed, unexpected } = classifySkips(found);
  console.log(`${unexpected.length ? "ERROR:" : "ok   "} ${name.replace(/s$/, "")} skips: ${allowed.length + unexpected.length} (${allowed.length} allowlisted, ${unexpected.length} not allowed under RUST_TS_REQUIRE_PROBES=1)`);
  for (const t of unexpected.slice(0, 20)) console.log(`  skipped: ${t.file}: ${t.path.join(" > ")}`);
  if (unexpected.length) pass = false;
  if (slowest !== undefined) {
    const at = `${slowest.file}: ${slowest.path.join(" > ")} (${slowest.timeS.toFixed(1)} s)`;
    console.log(`  slowest: ${at}`);
    const limit = step.slowNoteS ?? SLOW_TEST_NOTE_S;
    if (slowest.timeS > limit)
      console.log(
        `note: ${name}: its slowest test took over ${limit} s, ${at}; ${step.alone ? "even alone, a test this slow" : "among the workers, a test this slow"} can reach the ${UNIT_TEST_TIMEOUT_MS / 1000} s per-test limit under load${step.alone ? "" : ": consider adding its file to the step's alone list (scripts/lib/unit-steps.ts)"}`,
      );
  }
  return { pass, skips: { allowed, unexpected } };
}

/** The run id of the "frozen lists" step of the gate run at `runDir`: a run directory of its own, beside the gate's. */
export const frozenListsRunId = (runDir: string): string => `${basename(runDir)}-frozen-lists`;

/**
 * gate.json's `frozenLists`: where the "frozen lists" step's results are (review harness-w44 N2), or null if it wrote none
 * (static checks skipped, or not run).
 */
export function frozenListsRecord(runDir: string): { runId: string; dir: string } | null {
  const runId = frozenListsRunId(runDir);
  const dir = join(dirname(runDir), runId);
  return existsSync(dir) ? { runId, dir } : null;
}

export async function staticChecks(runDir: string): Promise<StaticChecks> {
  // The unit-test steps are UNIT_STEPS (scripts/lib/unit-steps.ts): disjoint roots, each passed as a path; their
  // environment and arguments (`unitStepEnv`, `unitStepArgs`) say why each part is there.
  const steps: StaticStep[] = [
    { name: "typecheck", cmd: ["bunx", "tsc", "--noEmit", "-p", "."], env: {} },
    ...UNIT_STEPS.flatMap((u) => unitStaticSteps(u, runDir)),
    // --offline: a vendor crate missing from cargo's cache is an ERROR, never network I/O.
    { name: "markers", cmd: [process.execPath, "scripts/coverage.ts", "--check", "--offline"], env: {} },
    // A crate with no marker out of upstream's order stays so (PORTING section 3; fixers-44 W5). Others have allowed inversions (section 8).
    { name: "marker order", cmd: [process.execPath, "scripts/coverage.ts", "--order", "--require-clean", "src/rustc_monomorphize/"], env: {} },
    // Every upstream INFO site in a ported fn is live or a stop: protected cases set `RUSTC_LOG` (lane harness-w44, review w40c-audit N2).
    { name: "info sites", cmd: [process.execPath, "src/rust_ts/info_sites_check.ts", "--out", join(runDir, "info-sites")], env: {} },
    // Protected cases with the interned lists frozen, so a write to one fails here (lane harness-w44, review perf-heavy F1).
    { name: "frozen lists", cmd: [process.execPath, "scripts/frozen-lists.ts", "--run-id", frozenListsRunId(runDir)], env: { RUST_TS_FREEZE_LISTS: "1" } },
  ];
  let ok = true;
  let skips: SkipReport | undefined;
  const notes: StaticNote[] = [];
  for (const step of steps) {
    const r = await runStaticStep(step);
    if (!r.pass) ok = false;
    for (const note of r.notes ?? []) notes.push({ step: step.name, note });
    // Both reports add up into one SkipReport (`skips` of the run record).
    if (r.skips)
      skips = {
        skipped: (skips?.skipped ?? 0) + r.skips.allowed.length + r.skips.unexpected.length,
        allowed: (skips?.allowed ?? 0) + r.skips.allowed.length,
        unexpected: [...(skips?.unexpected ?? []), ...r.skips.unexpected],
      };
  }
  return { ok, skips, notes };
}

/** Commit and cleanliness of the tree under test, recorded so an accepted run names exactly what it tested. */
async function provenance(): Promise<{ head: string; dirty: string[] }> {
  const h = await run(["git", "rev-parse", "HEAD"]);
  const head = h.stdout.trim();
  if (h.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) die(`git rev-parse HEAD failed: ${(h.stderr || h.stdout).trim()}`);
  const st = await run(["git", "status", "--porcelain"]);
  if (st.code !== 0) die(`git status failed: ${st.stderr.trim()}`);
  return { head, dirty: st.stdout.split("\n").filter(Boolean) };
}

function protectedSuites(): string[] {
  return readdirSync(BASELINE)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -4));
}

export async function gateRun(requested: string[], skipStatic: boolean, skipHeavy: boolean, allowBattery = false, gateHost: GateHost = REAL_GATE_HOST): Promise<void> {
  for (const name of requested) getSuite(name); // unknown suite names fail here
  const envRefused = freezeEnvRefusal();
  if (envRefused !== undefined) die(envRefused);
  // Before anything starts. What this reads decides only whether a run starts: no status or verdict reads the record below.
  const note = (l: string) => console.log(l);
  const stuck = new StuckReads(note);
  const first = await sampleHost(gateHost.readers, gateHost.readLimitMs, stuck);
  const refused = batteryRefusal(first.power, allowBattery);
  if (refused !== undefined) die(refused);
  if (first.power?.onBattery) console.log(`note: running on battery (--allow-battery)${first.power.percent === null ? "" : `, at ${first.power.percent}%`}: timings will run slow, and a timeout may be false`);
  const host = new HostLog(gateHost.readers, { pollMs: gateHost.pollMs, keepEveryMs: gateHost.keepEveryMs, note, allowBattery, firstOnBattery: first.power?.onBattery, stuck, readLimitMs: gateHost.readLimitMs });
  await host.mark();
  host.start();
  // Heavy suites last, in their given order (plan-m5 §4.2); `--skip-heavy` leaves them out, as not run.
  const isHeavy = (name: string) => getSuite(name).heavy !== undefined;
  const notRun = skipHeavy ? requested.filter(isHeavy).map((suite) => ({ suite, reason: "--skip-heavy" })) : [];
  const suites = [...requested.filter((n) => !isHeavy(n)), ...(skipHeavy ? [] : requested.filter(isHeavy))];
  for (const { suite } of notRun) console.log(`note: heavy suite ${suite} not run (--skip-heavy): none of its cases counts as lost, and a run that skips a protected suite cannot be accepted`);
  const runId = `gate-${nowId()}`;
  const prov = await provenance();
  if (prov.dirty.length) console.log(`note: tree is dirty (${prov.dirty.length} paths); this run cannot be accepted`);
  // Before anything runs the oracle (unit tests, aux builds, suites): the pinned commit and components.
  await verifyOraclePin();
  if (!checkProbes(suites, !skipStatic && gateHost.staticChecks === undefined)) die("a probe is missing or stale; do what the lines above say and re-run the gate");
  const dirtyUpstream = upstreamStatus(UPSTREAM);
  if (dirtyUpstream.length) {
    console.log(upstreamError("the upstream checkout is not clean", dirtyUpstream, UPSTREAM));
    die("the gate runs only on a clean upstream checkout");
  }
  let unstableOk = true;
  for (const suite of suites) {
    const bad = protectedUnstable(suite);
    if (bad.length) {
      console.log(`ERROR: ${suite}: the baseline protects ${bad.length} case(s) the suite lists as unstable (e.g. ${bad[0]}); an unstable case can never be protected`);
      unstableOk = false;
    }
  }
  const runDir = ensureDir(join(RUNS, runId));
  const st: StaticChecks = skipStatic ? { ok: true } : await (gateHost.staticChecks ?? staticChecks)(runDir);
  const staticOk = st.ok;
  if (!staticOk) {
    // A failed static step: the run cannot be accepted, so the suites are not run (see the header).
    console.log(`ERROR: a static check failed; the ${suites.length} suite(s) are not run (fix it and re-run; --skip-static runs the suites without the static checks)`);
    await host.mark();
    host.stop();
    const stopped = [...notRun, ...suites.map((suite) => ({ suite, reason: "a static check failed" }))];
    // Checked, not assumed (review harness-w44 N2): it was clean at the start, and only the static steps ran since.
    const staticUpstream = upstreamStatus(UPSTREAM);
    if (staticUpstream.length) console.log(upstreamError("a static step changed the upstream checkout", staticUpstream, UPSTREAM));
    writeFileSync(join(runDir, "gate.json"), JSON.stringify({ runId, pass: false, staticOk, skipStatic, unitTestSkips: st.skips ?? null, staticNotes: st.notes ?? [], head: prov.head, dirty: prov.dirty, unstableOk, upstreamOk: staticUpstream.length === 0, ...(staticUpstream.length ? { upstreamChanges: staticUpstream } : {}), frozenLists: frozenListsRecord(runDir), suites: [], notRun: stopped, host: host.record(allowBattery) }, null, 1));
    console.log(`gate FAIL run=${runId}`);
    process.exit(1);
  }
  const out: SuiteGate[] = [];
  for (const suite of suites) {
    const hostStart = await host.mark();
    const { results, stats, upstreamChanges, heavy, extra, oracleReruns } = await difftest({ suite, runId, quiet: true });
    const hostEnd = await host.mark();
    const irTier = getSuite(suite).irTier;
    const base = readBaseline(suite);
    const match = new Set(results.filter((r) => r.status === "MATCH").map((r) => r.id));
    const lost = [...base].filter((id) => !match.has(id));
    const gained = [...match].filter((id) => !base.has(id));
    const byId = new Map(results.map((r) => [r.id, r]));
    const oracleTimeouts = results.filter((r) => r.status === "ORACLE_TIMEOUT").map((r) => r.id);
    const skippedWhy = new Map((getSuite(suite).skipped?.() ?? []).map((k) => [k.id, k.reason]));
    const lostSkipped = lost.filter((id) => skippedWhy.has(id)).map((id) => ({ id, reason: skippedWhy.get(id)! }));
    const unstable = results.filter((r) => r.status === "UNSTABLE").map((r) => r.id);
    const retried = results.filter((r) => r.retried).map((r) => r.id);
    const retryTimes = results.flatMap((r) => (r.attempts ? [{ id: r.id, status: r.status, ...r.attempts }] : []));
    const heavyErrors = (heavy ?? []).flatMap((h) => heavyErrorLines(suite, h));
    out.push({ suite, baseline: base.size, match: match.size, total: results.length, lost, gained, batchOnlyFailures: stats.batchOnlyFailures, batchOnlyTimeouts: stats.batchOnlyTimeouts, oracleTimeouts, lostSkipped, unstable, retried, retryTimes, upstreamChanges, ...(heavy ? { heavy, heavyErrors } : {}), ...(extra !== undefined ? { extra, oracleReruns } : {}), startedAt: hostStart.at, endedAt: hostEnd.at, hostStart, hostEnd, ...(irTier ? { irTier } : {}) });
    console.log(`${lost.length ? "ERROR:" : "ok   "} ${suite}: protected=${base.size} match=${match.size}/${results.length} lost=${lost.length} gained=${gained.length}`);
    if (irTier) console.log(`note: ${suite}: read at IR tier ${irTier}`);
    for (const h of heavy ?? []) console.log(`  ${heavyLine(suite, h)}`);
    // (Reported, recorded in gate.json, but not a gate failure by themselves: see `SuiteGate.heavyErrors`.)
    for (const l of heavyErrors) console.log(l);
    if (extra) console.log(`note: ${suite}: ${extra} section(s) only the subject printed (not cases; listed in ${suite}.extra.jsonl)`);
    if (oracleReruns?.length) {
      const n = (o: OracleRerun["outcome"]) => oracleReruns.filter((x) => x.outcome === o).length;
      const bad = n("not reproduced");
      console.log(`${bad ? "ERROR:" : "note:"} ${suite}: oracle re-runs for diff files: ${n("reproduced")} reproduced, ${n("timed out")} timed out, ${bad} did not reproduce (their cases UNSTABLE; see \`oracleReruns\` in gate.json)`);
    }
    const why = (id: string): string => {
      const r = byId.get(id);
      if (r?.status === "ORACLE_TIMEOUT") return ` (ORACLE_TIMEOUT; subject: ${r.subject})`;
      if (r?.status === "UNSTABLE") return ` (UNSTABLE: ${r.unstable}; subject: ${r.subject})`;
      if (skippedWhy.has(id)) return ` (not applicable on this host: ${skippedWhy.get(id)})`;
      if (!r) return " (no longer a case of this suite)";
      if (r.retried) return ` (${r.status}, after a pool TIMEOUT and a re-run alone)`;
      return ` (${r.status})`;
    };
    for (const id of lost.slice(0, 20)) console.log(`  lost: ${id}${why(id)}`);
    if (oracleTimeouts.length) console.log(`note: ${suite}: ${oracleTimeouts.length} case(s) ORACLE_TIMEOUT (the oracle timed out twice; not compared)`);
    if (unstable.length) console.log(`note: ${suite}: ${unstable.length} case(s) UNSTABLE (the oracle's output is not reproducible; not compared, never protected)`);
    if (retried.length) {
      const still = retried.filter((id) => byId.get(id)!.status === "TIMEOUT").length;
      console.log(`note: ${suite}: ${retried.length} subject TIMEOUT(s) in the pool re-run alone: ${retried.length - still} finished, ${still} timed out again`);
    }
    if (stats.batchOnlyFailures || stats.batchOnlyTimeouts) {
      console.log(`note: ${suite}: ${stats.batchOnlyFailures} batch-only failure(s), ${stats.batchOnlyTimeouts} batch-only timeout(s) (a batch process failed at a case that passes alone; see ${suite}.summary.json)`);
    }
  }
  // The tree must be the same at the end as at the start, or the run tested a moving target.
  const after = await provenance();
  const unchanged = after.head === prov.head && after.dirty.join("\n") === prov.dirty.join("\n");
  if (!unchanged) console.log("ERROR: the tree changed while the gate was running");
  const upstreamOk = out.every((s) => !s.upstreamChanges?.length);
  if (!upstreamOk) console.log("ERROR: a suite changed the upstream checkout (see `upstreamChanges` in gate.json)");
  const pass = staticOk && unchanged && unstableOk && upstreamOk && out.every((s) => s.lost.length === 0);
  await host.mark();
  host.stop();
  if (host.powerLost.length) console.log(`note: this gate lost power ${host.powerLost.length} time(s), first seen at ${host.powerLost[0]!.at}; a lost case from about then on may be a false timeout (\`host\` in gate.json)`);
  writeFileSync(join(RUNS, runId, "gate.json"), JSON.stringify({ runId, pass, staticOk, skipStatic, unitTestSkips: st.skips ?? null, staticNotes: st.notes ?? [], head: prov.head, dirty: prov.dirty, unstableOk, upstreamOk, frozenLists: frozenListsRecord(runDir), suites: out, ...(notRun.length ? { notRun } : {}), host: host.record(allowBattery) }, null, 1));
  console.log(`gate ${pass ? "PASS" : "FAIL"} run=${runId}`);
  if (!pass) process.exit(1);
}

/** A suite's entry in the accept record; the tier as the run read it, so a protected set says which tier it was protected at. */
export const acceptEntry = (protectedCases: number, s: Pick<SuiteGate, "total" | "irTier">) => ({ protected: protectedCases, total: s.total, ...(s.irTier ? { irTier: s.irTier } : {}) });

/** MATCH ids of one suite, re-read from the run's own per-case results (not from gate.json). */
function matchesOfRun(runId: string, suite: string): Set<string> {
  const p = join(RUNS, runId, `${suite}.jsonl`);
  if (!existsSync(p)) die(`gate run ${runId} has no results for ${suite}`);
  const ids = new Set<string>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { id: string; status: string };
    if (r.status === "MATCH") ids.add(r.id);
  }
  return ids;
}

async function gateAccept(runId: string): Promise<void> {
  const p = join(RUNS, runId, "gate.json");
  if (!existsSync(p)) die(`no gate result at ${p}`);
  const g = JSON.parse(readFileSync(p, "utf8")) as { pass: boolean; skipStatic?: boolean; head?: string; dirty?: string[]; suites: SuiteGate[] };
  if (!g.pass) die(`gate run ${runId} did not pass; nothing accepted`);
  if (g.head === undefined || g.dirty === undefined) die(`gate run ${runId} has no provenance (older gate.ts); re-run the gate`);
  if (g.skipStatic) die(`gate run ${runId} skipped static checks; nothing accepted`);
  if (g.dirty.length) die(`gate run ${runId} ran on a dirty tree (${g.dirty.length} paths); commit, then re-run the gate`);
  const now = await provenance();
  if (now.head !== g.head) die(`gate run ${runId} tested ${g.head.slice(0, 10)} but HEAD is ${now.head.slice(0, 10)}; re-run the gate`);
  // Only state records (docs/state/) may be pending; anything else would be committed untested.
  const stray = now.dirty.filter((l) => !l.slice(3).startsWith("docs/state/"));
  if (stray.length) die(`tree is dirty outside docs/state/ (${stray.slice(0, 3).join("; ")}); commit or stash, then re-run the gate`);
  const missing = protectedSuites().filter((name) => !g.suites.some((x) => x.suite === name));
  if (missing.length) die(`gate run ${runId} did not run protected suite(s) ${missing.join(", ")}; nothing accepted`);
  const summary: Record<string, ReturnType<typeof acceptEntry>> = {};
  // Every suite is checked before any baseline is written, so a refusal leaves every baseline as it was.
  const grown: { suite: string; base: Set<string>; before: number; run: SuiteGate }[] = [];
  for (const s of g.suites) {
    getSuite(s.suite); // registered suite names only (also keeps the baseline path inside harness/baseline)
    const base = readBaseline(s.suite);
    const before = base.size;
    const match = matchesOfRun(runId, s.suite);
    const lost = [...base].filter((id) => !match.has(id));
    if (lost.length) die(`gate run ${runId}: ${s.suite} results lose ${lost.length} protected case(s) (e.g. ${lost[0]})`);
    for (const id of match) base.add(id);
    const unstable = protectedUnstable(s.suite, base);
    if (unstable.length) die(`gate run ${runId}: ${s.suite} would protect ${unstable.length} case(s) the suite lists as unstable (e.g. ${unstable[0]}); nothing accepted`);
    grown.push({ suite: s.suite, base, before, run: s });
  }
  for (const { suite, base, before, run } of grown) {
    writeFileSync(join(BASELINE, `${suite}.txt`), [...base].sort().join("\n") + "\n");
    summary[suite] = acceptEntry(base.size, run);
    console.log(`${suite}: protected set ${before} -> ${base.size}`);
  }
  record("accept", `accepted gate run ${runId} (tested ${g.head})`, { runId, head: g.head, suites: summary });
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "run") {
    const suites =
      typeof a.suites === "string"
        ? a.suites.split(",")
        : protectedSuites();
    await gateRun(suites, Boolean(a["skip-static"]), Boolean(a["skip-heavy"]), Boolean(a["allow-battery"]));
  } else if (cmd === "accept" && typeof a.run === "string") {
    await gateAccept(a.run);
  } else {
    console.log("usage: bun scripts/gate.ts run [--suites a,b] [--skip-static] [--skip-heavy] [--allow-battery] | accept --run <run-id>");
  }
}
