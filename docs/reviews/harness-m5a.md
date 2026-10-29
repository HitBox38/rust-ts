verdict: APPROVE

Batch: harness-m5a (`git diff main...lane/harness-m5a`, commits 8da0c05a, c1e787ee). Reviewed against plan-m5 §4.1–4.2, D6, D11
and the lane's handoff. I am read-only; I wrote only this file.

## What I ran (scratch detached worktree at c1e787ee, removed afterwards)
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun test scripts`: 49 pass, 0 fail (13 of them new, in split.test.ts).
- Existing suite: `RUST_TS_AGENT=rev-harness-m5a bun scripts/difftest.ts --suite parse --sample 100 --jobs 4`. Result: MATCH 100/100,
  and all 100 sampled ids are in harness/baseline/parse.txt (0 protected cases not MATCH). Run dir:
  `.data/runs/20261029-112027-rev-harness-m5a-6r1h`. The load average was about 9–11 on 12 cores while a full unit suite was running,
  so I used `--jobs 4`.
- Bun `resourceUsage().maxRSS` units on this macOS host: a child that allocates 300 MiB reports 329,269,248, so the value is in bytes,
  as the code assumes.
- I did not run the heavy core suites (as instructed).

## Checklist
1. **No ratchet weakening: OK.** The lost/gained computation in gateRun and gateAccept is untouched. Non-split, non-heavy suites keep:
   - the same cache keys (`inputDirs`/split parts are pushed only when set, and `depsOf` changes only for `inputDirs` suites);
   - the same jobs;
   - the same TIMEOUT re-run;
   - the same `record` path.
   `--skip-heavy` leaves the skipped suites out of `out`, so they count no losses, and records them in `notRun`. `gateAccept` still
   refuses a run that is missing any protected suite (gate.ts:360–361). An unprotected skipped heavy suite is not in `g.suites`, so
   accept never touches its baseline. Nothing is silently accepted.
2. **Split mode: OK.** A missing oracle section is DIFF with `first: missing…`, never MATCH. Extra sections are not cases: they are
   counted and listed. Order and separators live in the skeleton, which gates the run case. A run-level failure, UNSTABLE or a
   different exit code gives every case a non-MATCH status. Ids are key + occurrence index, never positions, and are namespaced
   `<run>|<section>`. The oracle cache keeps hashes only (about 1.5 MB gzipped for core). Diff filenames are cut + hashed.
3. **Heavy class: OK.** jobs = 1. Inside a run the oracle goes first, then the subject (and the oracle re-run, if any, comes after).
   Timeouts: subject 1,800 s, oracle 300 s with the 4x retry. Each process's wall/user/sys/RSS is recorded in the summary and in
   gate.json and printed in the gate. A run over budget gets a `note:` line and `overBudget: true`.
4. **Tests: adequate for the pure splitter.** They cover missing, extra, reordered, duplicate headers, a changed body, a changed
   separator, round trip, empty output, CTFE, promoted, trivial const and alloc. runSplit's status logic is not covered (finding 5).
5. **Information hiding:** minor gaps only (findings 3 and 4).

## Findings

1. scripts/difftest.ts:146, scripts/gate.ts:300 (also difftest.ts:1036): **non-blocking (decision for root).** An RSS over budget is a
   `note:` and never fails the gate or appears in an `ERROR:` line. D11's title says "fail loudly", but its body says "a reported
   regression, not a timeout". Under AGENTS.md §4 an auditor finds problems with `grep ERROR`, and that grep misses an over-budget run.
   The lane flagged this. Recommend that root records a decision: either keep `note:`, or print `ERROR:` without failing the gate, or
   fail the gate (a one-line change in gateRun).

2. scripts/lib/common.ts:92, scripts/difftest.ts:141: **non-blocking.**
   - If `resourceUsage()` returns undefined, RSS/CPU become NaN. They print as "NaN MB", serialize as `null` in gate.json, and
     `overBudget` is silently false (`NaN > budget`). This should be an `ERROR:` (or `note:`) line, not a silent pass.
   - Units are verified as bytes only on macOS (this review and the lane). On Linux, raw `wait4` `ru_maxrss` is in KiB. AGENTS.md also
     names Windows and WSL hosts.
   - If Bun passes the raw value through on those platforms, RSS would read 1024x too small and the budget could never trip.
   - Recommend a one-time check on Linux/Windows, or a sanity guard: an RSS under a few MB for a process that ran more than 1 s should
     print `ERROR:`.

3. scripts/difftest.ts:705–720: **non-blocking.** The code re-runs the oracle when a cached entry may be stale. If the fresh run does
   not reproduce the cached hashes and its exit code also differs (or it matches an unstable pattern):
   - the cache entry is removed;
   - the results stay scored against the cached hashes, which are now known to be non-reproducible;
   - the only trace is a console `ERROR:` line. It is not in gate.json and does not affect `pass`.
   So a gate run in that state can pass and be accepted, protecting sections compared against a non-reproducible oracle.
   - **Suggestion:** mark that run's cases UNSTABLE in this case. Also consider doing so in the "same code, different hashes" branch,
     which today rescores and re-caches the fresh output. Either way, record the event in the summary/gate.json for the auditor.
   - The risk is low: today's single mode never verifies its cache at all. That is why this is non-blocking.

4. scripts/gate.ts:296/329: **non-blocking.**
   - gate.json and the gate's console output do not carry the split `extra` count. An auditor sees it only in the difftest run's
     summary.json and `<suite>.extra.jsonl`.
   - The oracle re-run of finding 3 (its usage and its ERROR) is not in gate.json either.
   - Suggest adding `extra` to SuiteGate and printing a `note:` when it is non-zero.

5. scripts/lib/split.test.ts: **non-blocking.** No test exercises `runSplit`'s status mapping:
   - a run-level UNPORTED/CRASH/TIMEOUT/DIFF spread to all sections, with `first`/`unported` only on the run case;
   - ORACLE_TIMEOUT reporting only the run case;
   - `Suite.unstable` listing the run id vs. a single section id;
   - the cache re-run mismatch.
   These were verified only by the lane's throwaway end-to-end run. They are the ratchet-critical parts of split mode, so a small
   unit test with stub processes would be worth adding in a follow-up.

6. scripts/difftest.ts:731: **non-blocking (nit).** After the rescore with a fresh oracle (`o2`), the run case's diff file still uses
   the stale `o.stderr`, while its status was computed from `o2.stderr`. Also, a heavy run's `HeavyRun` (line 667) does not record the
   oracle re-run's usage.

7. scripts/lib/split.ts:44/57: **non-blocking (nit).** The doc says an id "depends only on the earlier sections with the same key". That
   is not strictly true: `keySet` comes from the same side's output.
   - Example: a subject that has an extra section whose key is literally `X @2` renumbers its own second `X` to `X @3`.
   - Its literal `X @2` would then be compared with the oracle's second `X`.
   - This is unreachable for MIR headers in practice (none end in ` @<n>`), so a doc tweak is enough.
   Also, split.ts:70 says "1,001 repeated headers" while the handoff says 1,107. One of them is stale.

8. harness/suites.ts (M5 block), scripts/lib/split.ts header: **non-blocking (note for root).** The id is keyed by the full header, not
   the bare def path, which matches plan §4.1. The lane documents the cost: a wrong signature becomes missing + extra rather than DIFF.
   This is safe for the ratchet. Two more costs once mir-core is protected:
   - harness/baseline/mir-core.txt will be about 5.2 MB, and each accept commits a new blob;
   - any change to the splitter renames ids, which shows up as mass "no longer a case" losses.
   That second effect is correctly conservative, but it means splitter changes need a reviewed baseline migration batch.
