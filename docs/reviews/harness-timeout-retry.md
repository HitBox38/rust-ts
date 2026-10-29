verdict: APPROVE

# Review: harness batch `harness-timeout-retry` (commit 3fbad7bd on main 5db53573)

Reviewer: independent, read-only. I read the diff, then the code around it at 3fbad7bd: `runSubject`, `classify`, `runOracle`, `pool`, `run` (scripts/lib/common.ts), and the consumers in `gateRun`, `matchesOfRun` and `gateAccept`. Checks run in the worktree: `bunx tsc --noEmit -p .` is clean, and `bun test scripts` gives 36 pass, 0 fail. I did not run any difftest or gate.

## Summary

The refactor preserves behaviour. The retry cannot produce a MATCH that a `--jobs 1` run of the same tree would not also produce. The retry is limited to plain subject TIMEOUTs: `classify(oc, sc) === "TIMEOUT"` means the oracle did not time out and is not UNSTABLE. It reuses the pool's oracle output object, uses the same `s.timeoutMs`, and still requires byte-identical text and exit code. A subject that is slower than the limit on its own still reports TIMEOUT. None of the findings below is blocking. Findings 1 and 2 are worth a small follow-up batch.

Points checked that need no change:
- `record(...)` is a verbatim move of the old per-case body. For every status other than TIMEOUT, these behave as before: UNPORTED/DIFF/CRASH/UNSTABLE/ORACLE_TIMEOUT fields, `oracleTimeoutSubjects`, blessed results, diff files, and `results`. `results` and `blessedResults` are sorted after the loop, so moving retried cases to the end of push order has no effect on the jsonl. Subsets and counts are computed from `results` after the retries, so they reflect the final status.
- A retried case never re-enters `record` as ORACLE_TIMEOUT or UNSTABLE, because `oc` is unchanged. So `oracleTimeoutSubjects` cannot be double-counted or skewed. ORACLE_TIMEOUT and UNSTABLE cases whose subject also timed out are not retried, which is correct: they can never be MATCH.
- Batch-mode suites: in the pool, a TIMEOUT status in batch mode can only come from `runOne`, a single-case process (failed batch output is never attributed). The retry `runSubject(s, [c], ...)` goes through `runBatch([c])`, then `rest.length === 1`, then `runOne`: the same kind of process and the same output extraction (`splitBatch`, `parts.has(c.file)`). Its result is what `--batch-size 1` would give, which the harness already treats as authoritative.
- Single-mode suites: `exec([c])` applies `caseEnv(c.env)` and `RUST_TS_IMPL=impl` exactly as in the pool, and `render(r)` is the same.
- `stats.processes` counts the retry processes, which is consistent with what the field means. A single-case `runSubject` call records no `failedBatches`, so the batch-only counters cannot change.
- The retries run before `upstreamStatus` is taken after the run, so the upstream-mutation check covers them. `seconds` includes them.
- `matchesOfRun` and accept read only `id` and `status` from the jsonl, so the extra `retried` key is harmless.
- `--impl stub/shim`: `impl` is passed through to the retry. Stub/shim processes exit quickly, so in practice there is nothing to retry.
- `--sample/--filter`: the retry only touches cases already in `cases`, so nothing changes there.
- Current cost: the last three gate runs (gate-20261028-193011, -132035, -023542) had 2, 1 and 0 subject TIMEOUTs, so the added serial time is a few minutes at most.

## Findings

1. **scripts/difftest.ts:602-607, non-blocking (recommended follow-up). The serial retry has no upper bound.**
   Every pool TIMEOUT costs up to one more full `s.timeoutMs` (60-120 s), run one at a time, with no progress output (the pool's progress line has already ended). A regression that makes a common path hang (for example an infinite loop in the parser) would time out thousands of cases. The gate would then add N x 60 s on top of the pool, which is days for a 21k-case suite, and to the operator the run would look hung. This is a cost and visibility problem, not a ratchet problem. Suggested fix: cap the retries, either to a fixed number or to something like `jobs`. Cases past the cap keep their TIMEOUT, which can only lose a MATCH, never invent one. Print a note when the cap is hit, and optionally write a progress line during the retry phase when not `quiet`.

2. **scripts/gate.ts:282 / 295-299, non-blocking. Retried cases are missing from `gate.json`.**
   The gate already lists `oracleTimeouts`, `unstable`, `lostSkipped` and the batch-only counts in `SuiteGate` for the regression auditor. Retries appear only as a console note and in `<suite>.summary.json` / `<suite>.jsonl`. A protected case that MATCHed only on its serial retry is exactly what the auditor should be able to see from the gate evidence, since a case near the limit is a future flake. Also, `why(id)` (gate.ts:284) reports a lost case whose retry timed out again as plain ` (TIMEOUT)`, without saying it was retried. Suggested fix: add `retried?: string[]` (or `{ id, status }[]`) to `SuiteGate`, and have `why` say `TIMEOUT, also on serial re-run`.

3. **scripts/difftest.ts:602-605 / 649, non-blocking (naming). `recovered` in `subjectTimeoutRetries` counts any retry that did not time out, including DIFF, CRASH and UNPORTED, not only MATCH.**
   The console notes say "finished", which is accurate. A reader of summary.json, however, could take `recovered` to mean "now matches". Suggested fix: rename it to `finished`, or add a separate `matched` count.

4. **scripts/difftest.ts (pool vs retry), non-blocking (informational). Batch-only timeout accounting does not see a recovered case.**
   Batch-only accounting in the pool's `runSubject` call treats the pool-timed-out case as failing on its own. So a timed-out batch that contained it is not counted in `batchOnlyTimeouts`, even when the serial retry later shows the case passes alone. This is an undercount of a purely informational counter and affects no status. It may be worth a comment where the retry happens. No code change needed.

5. **scripts/difftest.ts:569, non-blocking (trivial). The 500-diff-file cap now applies to retried cases last.**
   Retried cases are recorded after the pool. When a run already has 500 or more non-MATCH, non-UNPORTED cases, a TIMEOUT that also timed out on retry gets no diff file, where before it competed in pool order. For a TIMEOUT that only loses the oracle/subject dump (the subject text is just stderr of a killed process), and the jsonl still has the status. Acceptable as is.

6. **(no file), non-blocking. The batch adds no unit test.**
   The existing pattern (scripts/unstable.test.ts) runs difftest in a child process. A small test using a stub suite whose subject sleeps past `timeoutMs` on its first invocation only (for example a marker file) would pin down two things: (a) a retried MATCH carries `retried: true`, and (b) a subject that is slow on every run stays TIMEOUT. That second property is the one the ratchet depends on.

## Root follow-up (137bb3ae)

Findings 1-3 fixed: re-runs capped at SUBJECT_TIMEOUT_RETRY_CAP=50 with progress output; `recovered` renamed `finished` (plus `notRetried`); gate.json `retried` ids and a lost retried case says so. Findings 4-6 left as recorded (report-only counter, diff-file order, no unit test).
