verdict: APPROVE

Batch: harness-m5b (`git diff 321fb6e7 a64e29c6`; the only later lane commit, 5b1e073b, adds just the handoff). The spec is the
harness-m5a review findings (main:docs/reviews/harness-m5a.md) plus root's task (.data/tmp/w30/task-harness-m5b.md). I am
read-only and wrote only this file.

## What I ran
I ran these in a scratch detached worktree at 5b1e073b, with `.env.local` copied and `node_modules` symlinked. I removed the
worktree afterwards.
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun test scripts`: 51 pass, 0 fail, across 7 files. This includes the new split-run.test.ts and lib/common.test.ts. On this
  macOS host, common.test.ts confirms that `maxRssBytes` is in bytes.
- Existing suite: `RUST_TS_AGENT=rev-harness-m5b bun scripts/difftest.ts --suite parse --sample 100 --jobs 4`. Result: MATCH
  100/100. All 100 sampled ids are in harness/baseline/parse.txt, and 0 protected cases are not MATCH. The run dir is
  `.data/runs/20261029-214158-rev-harness-m5b-xj91`.
- I did not run the heavy core suites, as instructed.
- The batch does not change baselines, oracle outputs, probes or suite definitions. Its only harness/ change is the doc comment of
  `Suite.heavy`.

## Checklist
1. **No ratchet weakening: OK.**
   - gateRun's lost/gained/unstable computation is unchanged (gate.ts:297–307). The new fields only add to the record and print
     extra lines.
   - Non-split, non-heavy suites are untouched: `runSplit` and `usageOf` are reached only by split and heavy suites, and the
     difftest return adds `oracleReruns` only when `split`.
   - The m5a skip-heavy, notRun and accept-refuses-missing logic is not touched.
   - A re-run that does not reproduce now turns cases UNSTABLE, which is stricter than before. A protected case caught this way
     is lost, and the gate fails. An unprotected one is not gained. Nothing is scored against a cache that is known not to
     reproduce.
2. **Split mode: OK.**
   - The re-run check is in difftest.ts:755–785.
     - If the exit code, stderr or skeleton differs (or the section count does), every case of the run is UNSTABLE.
     - Otherwise each section is compared by id and hash, and only the changed ones become UNSTABLE.
     - The claim that "an equal skeleton has the same ids in the same order" holds: the skeleton holds one `<<id>>` line per
       section (split.ts:6–10).
   - The sections that reproduced keep their statuses, and their diff files use the re-run's text and exit code. This fixes the
     m5a stale-stderr nit.
   - The entry is removed, an `ERROR:` line is printed, and the event is recorded in summary and gate.json `oracleReruns`.
   - Missing, extra and reorder handling, the ids, and the hash-only cache are unchanged from m5a.
   - The split.ts edit is doc-only. Its source hash is part of the cache key, so mir-core's oracle cache is invalidated once. The
     handoff says so, and ids do not change.
3. **Heavy class: OK.**
   - The oracle re-run happens after the subject, so runs stay serial. It uses the oracle timeout with the 4x retry, and its usage
     is recorded (`HeavyRun.oracleRerun`, `heavyLine`).
   - Over budget is now an `ERROR:` line (`heavyErrorLines`, difftest.ts:186). The CLI and the gate print it, and gate.json
     records it (`heavyErrors`). Per root's decision in task-harness-m5b.md item 1, it does not by itself fail the gate. The
     comments say so in three places.
   - When usage is missing, non-finite or implausible (difftest.ts:166), the values are `null` with a reason, not NaN, and each
     such process gets an `ERROR:` line.
   - A KiB value read as bytes would be caught for any real core run. For example, 9.8 GB read as KiB is about 9.5 MiB, which is
     under the 16 MiB guard. The Bun source reference for units is documented.
4. **Tests: OK.** split-run.test.ts runs the real `runSplit` with stub processes and a temp RUST_TS_DATA, so the shared cache is
   not touched. It covers the cases m5a finding 5 asked for:
   - all MATCH and the extra section;
   - UNPORTED, CRASH, exit-code DIFF and TIMEOUT spreading to every section, with details only on the run case;
   - ORACLE_TIMEOUT reporting only the run case and not being cached;
   - unstable: the whole run listed, one section listed, and one detected;
   - the oracle re-run: reproduced (including heavy usage and over budget), whole entry differs, one section differs, and timed
     out;
   - `usageOf` and `heavyErrorLines`.
5. **Information hiding: improved.** gate.json now carries `extra`, `oracleReruns` and `heavyErrors`, and the gate prints a
   `note:` or `ERROR:` line for each. The remaining gaps are minor (findings 1–3).

## Findings

1. scripts/gate.ts:308–318, scripts/difftest.ts:186: **non-blocking (by root's decision; for the auditor).**
   - A gate can now pass while it prints `ERROR:` lines: over-budget or unavailable-usage lines, and a "did not reproduce" re-run
     line whose UNSTABLE cases happen to be unprotected.
   - Each line says "does not fail the gate", or points to gate.json, and the handoff flags it.
   - Still, under AGENTS.md §4 a `grep ERROR` on a passing gate no longer means failure. The regression auditor's instructions
     should say that `heavyErrors` and `oracleReruns[].outcome` in gate.json are the record. Root may also want to fold the
     count into the final pass/fail summary line.

2. scripts/difftest.ts:755: **non-blocking (pre-existing scope, not a regression).** The cache is verified only when a run has a
   DIFF, because only then is the oracle re-run.
   - A run that is all MATCH against a cached entry is never re-verified.
   - A re-run that times out (difftest.ts:790) leaves every status scored against the entry. The task allowed this, and nothing
     contradicts the entry.
   - So `oracleReruns` is evidence of non-reproducibility only on DIFF runs. It is not a general cache-integrity check. This is the
     same exposure as single mode and m5a's finding 3, so it is not blocking.

3. scripts/difftest.ts:767–777: **non-blocking (nit).** When the whole entry differs, every case is UNSTABLE, but the run's `extra`
   list is still the one computed against the cached hashes that did not reproduce. Extra sections are not cases, so the ratchet
   is unaffected. A reader of `<suite>.extra.jsonl` for that run sees sections compared against a stale entry. Clearing the list,
   or tagging it, would be cleaner.

4. scripts/lib/common.test.ts: **non-blocking.**
   - The bytes-unit test has run only on macOS. Linux, WSL and Windows rely on the cited Bun source and on the 16 MiB guard
     (difftest.ts:166). The guard turns a wrong unit into an `ERROR:` line rather than a silent pass.
   - AGENTS.md §5 names a Windows host and WSL2. Run `bun test scripts/lib/common.test.ts` once there before mir-core is
     protected on that host.
