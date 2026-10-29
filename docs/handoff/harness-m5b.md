# Handoff: harness-m5b (fixes from the harness-m5a review, so mir-core can be protected; harness batch, needs an independent review)

Branch `lane/harness-m5b`, from main `fb048c64`, with **`integ-w31` merged in** (`git merge integ-w31`, merge commit
`321fb6e7`) for the stablehash fix that mir-core needs. The lane's own change is commit `a64e29c6` (review it with
`git diff 321fb6e7 a64e29c6`). No ported upstream code: no coverage numbers, no `// rustc:` markers, no `// PORT:`, no
`unported(...)`. Baselines, oracle outputs, probes and suite definitions are unchanged: the only edit to
`harness/suites.ts` is the `Suite.heavy` doc comment.

## Files touched
- `scripts/difftest.ts`: `Usage`/`usageOf`/`HeavyRun`/`heavyErrorLines` (items 1, 2), `runSplit` (exported for the test;
  item 3), `OracleRerun`, summary/return `oracleReruns`, CLI lines, header comment.
- `scripts/gate.ts`: `SuiteGate.heavyErrors`, `.extra`, `.oracleReruns`; their console lines (item 4).
- `scripts/lib/common.ts`: `ProcResult.usage` doc only (units).
- `scripts/lib/split.ts`: doc only (item 6). **Note:** split.ts's source hash is part of a split suite's oracle cache
  key, so this invalidates mir-core's cache entry once (one fresh oracle run; ids are unchanged).
- `harness/suites.ts`: `Suite.heavy` doc only.
- New tests: `scripts/split-run.test.ts` (1 test, 71 expects), `scripts/lib/common.test.ts` (1 test).

## What changed, per review finding
1. **RSS over budget → `ERROR:` line** (`heavyErrorLines`, printed by difftest's CLI and the gate). Per root's decision it
   is reported and recorded in gate.json (`suites[].heavyErrors`, plus `heavy[].overBudget`) but does **not** by itself
   fail the gate; the code comments (difftest header, `heavyErrorLines`, `SuiteGate.heavyErrors`) say so.
2. **Resource usage.**
   - `Usage.userS/sysS/maxRssMb` are `number | null`; `null` comes with `Usage.unavailable` (why). They are null when
     Bun returns no usage, a non-finite one, or an implausible one: under 16 MiB max RSS after ≥ 1 s of CPU, which is
     what a KiB value read as bytes would look like. `overBudget` is false when the RSS is unknown, but every
     unavailable usage (subject, oracle, oracle re-run) gets its own `ERROR:` line, and the subject's says "its RSS
     budget is unchecked". So nothing goes NaN and silently never trips.
   - Units: **Bun 1.4.3 (the installed one) reports bytes on every platform.** Its source,
     `src/spawn_sys/spawn_process.rs` at tag `bun-v1.4.3`, `RusageFields::maxrss`, keeps `ru_maxrss` as is on Apple,
     multiplies it by 1024 elsewhere (Linux/BSD KiB), and uses `PeakWorkingSetSize` (bytes) on Windows.
   - `scripts/lib/common.test.ts` checks this on the host: a child that touches 256 MiB must report between 256 MiB and
     4 GiB. It passes on this macOS host. **Not run on Linux/Windows here:** Docker's daemon is not running on this
     machine, and I did not start it. On Linux, KiB read as bytes would fail that test, and the 16 MiB guard would turn
     it into "unavailable" + `ERROR:` in a heavy run.
3. **Oracle re-run mismatch** (`runSplit`).
   - When a cached split run has DIFFs, the oracle is run again for the diff files' text, as before. That re-run is now
     checked against the cached entry:
     - The exit code, stderr or skeleton (or section count) differs: **every case of the run is UNSTABLE**.
     - Only some sections' hashes differ: **those sections are UNSTABLE**. The others keep their statuses, which the
       re-run reproduced, and their diff files use the re-run's text.
   - In both cases the entry is removed, an `ERROR:` line is printed, and the event is recorded:
     - `unstable: "detected: the oracle's re-run did not reproduce its cached …"`;
     - `oracleRerun {run, outcome: "not reproduced", detail}` in the summary's `oracleReruns` and in gate.json.
   - The old behaviour is gone: it re-cached and rescored with the fresh output, or kept the stale scores.
   - A protected case that becomes UNSTABLE is not MATCH, so the gate loses it and fails. Nothing is scored against a
     non-reproducible cache.
   - A re-run that times out: the statuses stand (scored against the entry, which nothing contradicts). It gets
     `outcome: "timed out"`, a `note:` in the CLI, and `first` says the oracle text is unavailable. A re-run that
     reproduces gets `outcome: "reproduced"`.
   - Stale stderr nit fixed: the run case's diff file uses the stderr/exit of the oracle run whose text it shows.
   - The re-run's resources are recorded: `HeavyRun.oracleRerun`, printed in `heavyLine` as `; oracle re-run …`.
4. **gate.json / gate output.** For split suites, `SuiteGate.extra` (count) and `SuiteGate.oracleReruns`. The gate
   prints:
   - `note: <suite>: N section(s) only the subject printed` when N > 0;
   - one re-run line: `note:`, or `ERROR:` when any re-run did not reproduce.

   For heavy suites, `SuiteGate.heavyErrors` holds the `ERROR:` lines of item 1/2, and the gate prints them too.
5. **Tests** (`scripts/split-run.test.ts`, stub oracle/subject processes in a child with a temp `RUST_TS_DATA`, so the
   shared cache is never touched). Covered:
   - all MATCH;
   - extra section (listed, not a case; run case DIFF);
   - run-level UNPORTED, CRASH, exit-code DIFF and TIMEOUT spread to every section, with `unported`/`first` and the
     diff file only on the run case;
   - ORACLE_TIMEOUT: run case only, `subject`, not cached;
   - `Suite.unstable` listing the run (all UNSTABLE, not cached) vs one section (only that one; its diff dropped);
   - a detected unstable pattern;
   - the re-run: reproduced (diff text from the re-run; heavy `oracle: "cached"` + `oracleRerun` usage + overBudget),
     stderr differs (all UNSTABLE, entry removed, `ERROR:` line), one section differs (only it UNSTABLE, the other
     section keeps DIFF), re-run timed out;
   - `usageOf` (ok, none, NaN, KiB-implausible, short process) and `heavyErrorLines`.
6. **Nits.** The `uniqueIds` doc now says that an id also depends on whether the same side's output has a section keyed
   `<key> @k`, with the reviewer's example. The repeated-headers figure, measured from the cached mir-core oracle
   entry: 47,733 sections, **1,107** ids with an occurrence index (bodies that repeat an earlier header) among **135**
   distinct repeated headers. The handoff's 1,107 was right, so split.ts's "1,001" is fixed to that.

## Verification
- `bunx tsc --noEmit -p .`: clean. `bun test scripts harness`: 58 pass, 0 fail (was 56 + my 2 new).
  `bun scripts/coverage.ts --check`: markers ok.
- Existing suites unchanged (`RUST_TS_AGENT=root-f5de`; before = a detached worktree at `321fb6e7`, the same tree without
  this lane's commit):

| run | before | after |
|---|---|---|
| `parse --sample 200` | MATCH 200/200 (`m5b-parse-before`) | MATCH 200/200 (`m5b-parse-after`), jsonl byte-identical |
| `mir-minicore` (all 46) | MATCH 46 (`m5b-mirmini-before`) | MATCH 46 (`m5b-mirmini-after`), jsonl byte-identical |

- `mir-core`, heavy, on a quiet machine (no `GATE_RUNNING`, no other port/rustc/difftest process, load1 < 6 for 90 s
  before it started; load1 2.2 at the start, 3.8 at the end). Run `m5b-mir-core`, 23:37–23:39:
  - **MATCH 47,734 / 47,734** (47,733 sections + the run case `core`); extra 0; no oracle re-run (no DIFF); 125 s in
    all.
  - Subject (port): **119.2 s wall, 175.0 s user, 5.9 s sys, 9,788 MB max RSS**, exit 0, under the 12,288 MB budget,
    so no `ERROR:` line.
  - Oracle: 4.8 s wall, 4.5 s user, 1,171 MB, exit 0. It ran fresh, because split.ts's source hash moved the cache
    key; the new entry is cached.

## Notes for root
- Re-run mismatch → UNSTABLE (rather than invalidating the whole suite run) was my choice among the two the task
  allowed. A protected case caught by it is lost, so the gate fails loudly. An unprotected one is just not gained.
- The new `ERROR:` lines (over budget, usage unavailable) do not set `pass = false`, per root's decision. An auditor
  using `grep ERROR` on gate output therefore sees `ERROR:` lines on a passing gate; gate.json's `heavyErrors` says
  which.
- `runSplit` is now exported (for the test only).
