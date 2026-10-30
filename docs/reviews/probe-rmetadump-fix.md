verdict: APPROVE

Batch: lane/probe-rmetadump-fix (d7db36e5, one commit on top of lane/probe-rmetadump e9adf40d). This review covers only
`git diff lane/probe-rmetadump lane/probe-rmetadump-fix`, which touches 7 files: scripts/gate.ts,
scripts/gate-probes.test.ts (new), harness/suites.ts, scripts/rmeta-run.ts, scripts/rmeta-run.test.ts,
tools/probes/rmetadump/main.rs (comments only) and the handoff.

Checks I ran in scratch detached worktrees of the fix and of its base. Both worktrees were removed afterwards:
- `bun test scripts harness`: 76 pass, 0 fail.
- `bunx tsc --noEmit -p .`: exit 0, no output.
- Cache keys: I computed `cachePath` with a fixed file hash for the first, middle and last case of all 40 suites, on
  both the base and the fix. Exactly 4 suites changed: rmeta-core, check-core, rmeta-ui and check-ui, as expected.
  No other suite's key changed, and the case counts are the same.
- `bun scripts/gate.ts run --suites rmeta-ui --skip-static` (RUST_TS_AGENT=rev-pmf): it got past `checkProbes` with no
  `ERROR:`, and the rmeta-ui subject wrappers started. I then killed my own PID tree (gate 98207 and its descendants)
  and checked that none were left. I deleted the partial run dir `gate-20261030-203247-rev-pmf-z0b6`, which held only
  an empty `diffs/rmeta-ui`. The checkout stayed clean.

Questions asked:
- Finding 1 (BLOCKING): fixed.
  - `oracleRuns` (scripts/gate.ts:112) handles exactly one shape: argv[0] is `process.execPath` and argv[1] is
    `RMETA_RUN`. For that shape it parses the wrapper's command line with the wrapper's own `parseRmetaRunArgs`, so the
    two cannot drift. It returns the compiler's argv[0] plus the `--dump` probe.
  - Any other Bun script is still checked as Bun and refused. A malformed wrapper command line becomes an `ERROR:`
    message rather than an exception (`undeclaredRuns`, :121).
  - The check is stricter than before: the wrapper's compiler must itself be `rustc` or a declared probe.
  - `checkProbes` keeps its earlier first loop (missing probes) unchanged.
  - The new test is meaningful. It asserts `checkProbes` over every registered suite is true and silent, and that
    `undeclaredRuns` is empty for all suites. It pins what the four wrapper suites run. It also covers four negative
    cases: an undeclared `--dump` probe, a non-rustc compiler, another Bun script and a malformed wrapper. This catches
    the reviewer's regression, and also any later suite that drifts.
- Finding 2: fixed.
  - With `--bytes`, the subject's compared stdout is now only the byte line, which depends only on the subject's own
    file (scripts/rmeta-run.ts:142-146).
  - The first-difference line goes to `subject.differs`. That file is removed at the start of every subject run
    (:133), before the compiler runs, so a failed or `rmeta: none` run cannot leave a stale one behind.
  - A stale `oracle.rmeta` can no longer change any compared output or status. The test covers the line moving to the
    side file and the side file disappearing on a later equal run.
- Finding 5: handled.
  - 5a: the probe header no longer claims that def paths are unique. It gives the 18 repeats and `uniqueIds` `@n`.
  - 5b: the rmeta-run.ts header now says what the code does: a compiler that exits 0 but writes no file prints
    `rmeta: none` and exits 0.
- Finding 7: handled. Both the probe header and `Out::row`'s doc comment document that blank lines are dropped, and
  that check-* still sees such a difference. This is comments only; no logic changed.
- Finding 9c: handled as claimed.
  - `rmetaOracleKey` and `rmetaRun` reach the probe only through `probePath` (scripts/probes.ts:43). When the probe is
    not built, `probePath` calls `die` (scripts/lib/common.ts:44), which prints `ERROR: probe 'rmetadump' not built;
    run: ...` and exits 1. It does not throw.
  - The only change is the doc comment, and it is accurate.
- Existing suites: none of their statuses or cache keys changed (see the cache-key check above). The suites.ts diff is
  comments plus `export` on `RMETA_RUN`. The four rmeta suites get new oracle keys once, through the wrapper's source
  hash, as the handoff says.

Findings (all non-blocking):

1. scripts/gate-probes.test.ts:14-20, 31, 51. Severity: non-blocking (test robustness and accuracy of a claim).
   The test says suites whose probes are not built are left out. The handoff says the same. But only `all` and
   `errors` are guarded. `rmetaRuns` (:31) calls `s.oracle(...)` on every suite, unfiltered. On a machine with any
   probe missing, that hits `probePath` in a probe suite's oracle (lexdump, resdump, rmetadump, ...). `probePath` then
   ends the child with `ERROR: probe ... not built` and exit 1, so the test fails before it reaches the `unbuilt`
   branch. The skip path is dead code in practice.
   Failing loudly is acceptable, since the probes are required for the gate anyway, so this does not block. Either
   filter `rmetaRuns` by `built` as well, or drop the `unbuilt` handling and say plainly that the test needs every
   suite's probes built.

2. scripts/gate.ts:238 (unchanged). Severity: non-blocking (root item; the handoff's "For root" item 4 already raises
   it).
   The gate's unit-test step runs `bun test src tools`. So scripts/gate-probes.test.ts, the regression guard that
   finding 1 asked for, does not run as part of the gate. A later suite that breaks `checkProbes` would still be caught
   the first time someone runs that suite through the gate (it dies with `ERROR:` there), but the test only protects
   anything if root runs `bun test scripts harness`. Root should record whether to add `scripts harness` to the gate's
   unit tests, which is a separate harness batch.

3. tools/probes/rmetadump/main.rs (comment-only change) and harness/suites.ts `rmetaOracleKey`. Severity: non-blocking
   (note). As the handoff says, rebuilding the probe after this change may change its binary, because panic locations
   embed line numbers. That would re-key rmeta-core and rmeta-ui once more. The new suites are unprotected, so no
   ratchet is affected. Root should rebuild before the first rmeta-* acceptance, so that the accepted oracle cache
   matches the binary that is built.

4. scripts/rmeta-run.ts:130-133. Severity: non-blocking (note; this existed before the fix and is not made worse).
   `subject.differs` lives in the shared `$RUST_TS_DATA/rmeta/<suite>/<hash(id)>` directory, like `{oracle,subject}.rmeta`.
   Two concurrent runs of the same suite, such as two agents' `--sample` runs, can overwrite each other's diagnosis
   files. It is diagnosis only and never compared, so no status can change. It only matters when reading the file
   after the fact.

Findings 3, 4, 8 and 9a of the first review were left for root to record, as instructed, and are unchanged in this
batch. Nothing in the fix hides information from the regression auditor. No baseline, oracle output, existing suite
definition or protected-set logic was touched.
