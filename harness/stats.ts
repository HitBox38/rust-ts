// The `stats-ui` report suite (lane harness-w51; docs/handoff/stats.md "UI tests: the argv used, and what a report suite needs"):
// `-Zinput-stats`, `-Zmacro-stats` and `-Zmeta-stats`, whose tables rustc prints to stderr. Report only: no baseline, so
// `gate.ts run` leaves it out by default (as `cli`); `--suites stats-ui` runs it. One process per case and side; stdout, stderr
// and exit are compared. Both sides run from the upstream checkout.
//
// The cases, every list read from the pinned upstream sources:
// - `tests/ui/stats/*.rs` (3 at the pin: input-stats.rs, macro-stats.rs, meta-stats.rs), as pm-ui runs its tests: compiletest's
//   main-compile argv (harness/compiletest.ts `uiFileCases(.., { run: true, needs: true })`, so `needs-asm-support` and
//   `needs-deterministic-layouts` are evaluated as compiletest does for x86_64-unknown-linux-gnu), with `--emit=metadata`
//   appended unless compiletest passes `--emit metadata` itself (meta-stats.rs is `build-pass`: with metadata only, its table
//   comes from the rmeta encoder all the same, and nothing reaches codegen), env NOCORE_ENV + the test's, the session
//   variables pinned. The metadata goes where compiletest's `--out-dir` puts it, under the checkout's `build/` (as pm-ui).
//   Case id: the test file.
// - check-ui's 730 crates (`RMETA_UI_CORPUS`: tests/ui auxiliary lib crates, `--crate-type lib --emit=metadata`), each once
//   with each flag appended after its argv: 3 x 730 = 2,190 cases. Both sides run through scripts/rmeta-run.ts without
//   `--bytes` or `--dump` (it appends `-o <its directory>/lib<side>-<pid>.rmeta`, so nothing is written into the checkout and
//   the sides never share a file); the rmeta's bytes are check-ui's to compare. Case id: `<flag> <crate file>`.
import type { Case, Suite } from "./suites.ts";

/** The flags, in the order their crate cases are listed. */
export const STATS_FLAGS = ["-Zinput-stats", "-Zmacro-stats", "-Zmeta-stats"] as const;
/** The directory of the UI tests. */
export const STATS_UI_DIR = "tests/ui/stats";

/** The flag of a crate case (`-Zmeta-stats tests/ui/...`), or `undefined` for a UI test's case. */
export function statsFlagOf(id: string): string | undefined {
  const first = id.split(" ", 1)[0]!;
  return (STATS_FLAGS as readonly string[]).includes(first) ? first : undefined;
}

/** The crate cases: each of `crates` (check-ui's) with each flag appended, flags in `STATS_FLAGS` order. */
export function statsCrateCases(crates: readonly Case[]): Case[] {
  return STATS_FLAGS.flatMap((flag) => crates.map((c) => ({ ...c, id: `${flag} ${c.id}`, args: [...c.args, flag] })));
}

/**
 * A UI test's argv for this suite: `--emit=metadata` appended unless compiletest already passes `--emit metadata` (check
 * modes), as pm-ui's `pmUiArgs`. Refuses an argv that names none of the flags (a test that would print no table) or that still
 * ends with the parse-only flag of `uiCases` (not the main compile).
 */
export function statsUiArgs(id: string, args: readonly string[]): string[] {
  if (args.at(-1) === "-Zparse-crate-root-only") throw new Error(`ERROR: ${id}: argv ends with -Zparse-crate-root-only, not compiletest's main compile`);
  if (!args.some((a) => (STATS_FLAGS as readonly string[]).includes(a))) throw new Error(`ERROR: ${id}: argv has none of ${STATS_FLAGS.join(", ")}`);
  return args.some((a, i) => a === "--emit" && args[i + 1] === "metadata") ? [...args] : [...args, "--emit=metadata"];
}

/** What the suite takes from harness/suites.ts (which loads scripts/lib/common.ts, so this module does not). */
export interface StatsUiDeps {
  /** The UI tests' cases, prepared (`statsUiArgs`, env), and the tests compiletest would skip, with reasons. */
  ui: () => { cases: Case[]; skipped: { id: string; reason: string }[] };
  /** check-ui's cases. */
  crates: () => Case[];
  /** A UI case's command on a side: the compiler with the case's argv. */
  uiCmd: (side: "oracle" | "subject", c: Case) => string[];
  /** A crate case's command on a side: scripts/rmeta-run.ts around the compiler. */
  crateCmd: (side: "oracle" | "subject", c: Case) => string[];
  /** The wrapper's part of the oracle cache key (`rmetaOracleKey(false)`). */
  oracleKey: () => string;
}

/** The `stats-ui` suite (see the header). */
export function statsUiSuite(d: StatsUiDeps): Suite {
  let memo: Case[] | undefined;
  const side = (s: "oracle" | "subject") => ([c]: Case[]) => (statsFlagOf(c!.id) === undefined ? d.uiCmd(s, c!) : d.crateCmd(s, c!));
  return {
    name: "stats-ui",
    milestone: "M6",
    description:
      "report only: -Zinput-stats, -Zmacro-stats, -Zmeta-stats (harness/stats.ts): tests/ui/stats with compiletest's main-compile argv (--emit=metadata), and each flag on check-ui's 730 crates (rmeta-run, -o per side): stdout + stderr + exit",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    cases: () => (memo ??= [...d.ui().cases, ...statsCrateCases(d.crates())]),
    skipped: () => d.ui().skipped,
    subsets: {
      ui: (c) => statsFlagOf(c.id) === undefined,
      ...Object.fromEntries(STATS_FLAGS.map((f) => [f, (c: Case) => statsFlagOf(c.id) === f])),
    },
    oracleKey: d.oracleKey,
    oracle: side("oracle"),
    subject: side("subject"),
  };
}
