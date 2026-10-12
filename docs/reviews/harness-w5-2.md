ACCEPT-WITH-FIXES

# Review: harness-w5 fix round (9b37604 on `lane/harness-w5`)

Reviewer: review-hw5b (independent, read-only). This is a delta review of the fixes for `docs/reviews/harness-w5.md`.
- Scope: `git diff 3b1a556 9b37604`. 3b1a556 is the merge of main (71559cd) into the lane.
  - Files: `scripts/difftest.ts`, `src/std/result{,.test}.ts`, `tools/probes/emitdump/main.rs`,
    `harness/corpus/gen-emit.ts`, 24 modified and 60 new `harness/corpus/emit/gen/*.json`, and the handoff.
- Cross-checked against `git diff cc4447d 9b37604 -- . ':!harness/corpus'`. Everything else in that diff is main's
  content brought in by 3b1a556.

Every status is still exactly what single-case runs give.
- F2, F4 and F6 are done as asked.
- F1 is fixed for the scenario it targeted. But it introduced a new linear-cost path: G1 below, LOW, a four-line fix
  that I verified.
- G1 cannot lose or fake a protected case, and no current dump driver triggers it, so it does not need to block the
  merge. Land it with or before the next harness batch.

## Findings

### G1 (LOW, performance; regression vs cc4447d and main): one process per case when every section is complete but the process fails
- Where: `scripts/difftest.ts`, `runSubject` → `runBatch`, the `if (k > 0)` branch after `suspectFails` is false.
- Trigger: the failed process printed a complete section for every case. Then:
  1. `k = rest.length - 1`.
  2. The suspect is the last case, and it passes alone.
  3. `prefix = rest.slice(0, k + 1)` is the identical batch that just failed. It is re-run and fails again.
  4. `runBatch(rest.slice(0, k))` repeats the same steps one case shorter.
- Cost: 3 processes per case, and 2 timeouts per case when the failure is a timeout.
- Measured (`--batch-size 100`, `jobs` 1, `timeoutMs` 2000). Statuses are identical in every column.

  | scenario | 9b37604 | main (dbd9bb9) | `--batch-size 1` | 9b37604 + fix below |
  |---|---|---|---|---|
  | liar at #10 (prints every header, then exits 101), header-first | 270 processes | 15 | 100 | 12 |
  | full section, then `exitCode = 101`, at #10 of 100 (header-first or buffered) | 270 | 15 | 100 | 12 |
  | full section, then the process stays alive (leaked timer), at #5 of 40 | 105 processes, 141 s (~68 timeouts) | 11, 12 s | 40, 3 s | 15, 12 s |

- With lex's `timeoutMs` of 120 000, the last row is about 2 h for one 40-case chunk.
- The first review measured the liar on cc4447d at 55 processes.
- Today's lexdump, escapedump and emitdump stop at the failing file, so they never produce "all sections complete,
  then fail". That is why this is LOW.
- Fix (verified in a scratch copy): when `k + 1 === rest.length`, the output pinpoints nothing. Bisect `[0, k)`
  instead of re-running the identical batch:
  ```ts
  if (k > 0 && k + 1 === rest.length) {
    const mid = k >> 1;
    await runBatch(rest.slice(0, mid));
    await runBatch(rest.slice(mid, k));
  } else if (k > 0) {
    const prefix = rest.slice(0, k + 1);
    ... // unchanged
  ```
- With this patch, over all 51 fake jobs:
  - every status equals `--batch-size 1`;
  - the jobs above drop to 12–15 processes, and mixed drops from 64/66 to 53/55;
  - every other job's process count is unchanged.

### G2 (INFO): `unwrap_result` guard, remaining holes and one fail-closed case
- What I verified:
  - The guard reports 0 violations on the lane and on current main (dbd9bb9). On main, 2 non-test lines mention
    `unwrap_result`.
  - The 11 self-tests pass.
  - It catches all of these: `as` aliases (import and export), `const uw = unwrap_result`, passing it as a value,
    `unwrap_result(r,)`, `unwrap_result(\n f(a, b),\n)`, `R.unwrap_result(r)`, `(await import(..)).unwrap_result(r)`,
    `unwrap_result?.(r)`, destructuring renames, `unwrap_result(r /* , d */)` and `unwrap_result(...xs)`.
  - It accepts `import type`, multi-line import lists and `R.unwrap_result(r, d)`.
- Still missed (all contrived; no action needed unless cheap):
  - a call inside a template interpolation, `` `${unwrap_result(r)}` ``, because template literals are blanked whole;
  - `R["unwrap_result"](r)`;
  - code after a regex literal that contains a quote (`/"/`), which the string blanker swallows.
- Fails closed: an explicit generic call `unwrap_result<A, B>(r, d)` is rejected. If ported code ever needs explicit
  type arguments, the guard needs `<...>` skipping.

### G3 (INFO): batch-only counting can under-count a leak that shares a batch with a real failure
- This is by design, and it is what the first review asked for.
- In my mixed set (poison→victim among 14 failing cases), every failed batch that holds the leak also holds a case
  that fails alone, so the count is 0 where the truth is 1.
- The pure leak sets count correctly:
  - poison→victim: 1;
  - one poison with three victims: 1.
- No set over-counts. Every all-fail, crash, timeout, liar and wrong-header set reports 0.

### F3 is still open (root)
- `$RUST_TS_DATA/probes/emitdump/Cargo.toml` still points at `.data/lanes/harness-w5/tools/probes/emitdump/main.rs`.
- After merging, run `bun scripts/probes.ts build symdump emitdump` from main before the gate.

## What I checked

### F1: bisection bounds the cost, and statuses equal single-case runs
- Setup:
  - runtime-injected suites passed to the lane's (and main's) `difftest()`;
  - scratch `RUST_TS_DATA` (upstream symlinked), `timeoutMs` 2000, `jobs` 1;
  - a fake node subject in three output modes:
    - buffered: prints only on a clean exit, like lexdump and escapedump;
    - header-first;
    - catchflush: flushes on a crash but not on a kill, like emitdump.
- 15 scenarios × 3 modes = 45 jobs, each at lane `--batch-size 100`, lane `--batch-size 1` and main `--batch-size 100`.
  - Scenarios:
    - a buffered hang at #60;
    - crashes at #60 and #61;
    - 200 cases with sparse crashes;
    - 200 all-fail;
    - exit 70 at #40;
    - 3 timeouts;
    - 12 all-hang;
    - a mixed set: ok, poison/victim, fail70, crash, crashafter, wrong header ×2, prefail, liar, lie70, exit1, no
      output, diff, hang, partial;
    - a liar;
    - wrong headers plus a crash;
    - two leak sets;
    - a crash after partial output;
    - a crash at the first case and at the last.
  - Result: per-case statuses are identical across all three columns in all 45 jobs.
- Exact `Output`s:
  - `runSubject` batch versus per-case `runSubject` give byte-identical `Output`s (text, code, timedOut) for all 1380
    cases of the mixed, wrong-header, leak, liar and partial sets, in all 3 modes.
- Process counts and wall time (lane vs main):

  | scenario | lane | main |
  |---|---|---|
  | buffered hang at #60 | 18 processes / 14 s | 15 / 16 s |
  | header-first hang at #60 | 5 / 4 s | 15 / 16 s |
  | 3 timeouts | 35 / 30 s (buffered), 13 / 12 s (header) | 35 / 40 s |
  | all-hang | 13 / 26 s | 23 / 46 s |
  | all-fail 200 | 202 | 398 |
  | sparse 200 | 28 (buffered), 10 (header) | 28 |

  The handoff's numbers reproduce exactly: 18, 20, 5, 6, 10 and 202.
- Code reading:
  - Termination holds: every recursive `runBatch` call is on a strict sub-slice.
  - The one non-shrinking step is the `prefix` re-run when `k + 1 === n` (G1). It is a single `exec`, not a
    recursion, and is followed by `runBatch([0, k))`.
  - Only exit-0 processes (`attribute`) or single-case runs (`runOne`) set statuses.
  - When the `prefix` re-run passes, it overwrites the suspect's single-run status with that exit-0 batch's section.
    That is the same rule as any passing batch.
- `classify`, `runOracle`, `splitBatch` and the oracle cache key are unchanged.

### F2
- Code reading:
  - Failed multi-case batches are recorded in `exec`.
  - They are filtered after resolution by "no case fails on its own".
  - Strict supersets are dropped, and identical id sets are de-duplicated. That last step covers `prefix === rest`
    in G1.
  - Timeouts are counted separately.
- In the 135 matrix runs, `batchOnlyFailures` and `batchOnlyTimeouts` were 0 everywhere except the two leak sets,
  which count exactly 1.

### F4
See G2.

### F6
- rustc sets both flags from `-Zmacro-backtrace`:
  - the emitter: `session.rs:1283` and `:1308`;
  - `DiagCtxtFlags`: `config.rs:1594` `dcx_flags`.
  - At the pin `DiagCtxtFlags.macro_backtrace` is never read by `compiler/`. Setting it is faithful but has no effect
    on output.
- The width wins over `ui_testing`, as the generator comment says: `annotate_snippet_emitter_writer.rs:526`.
  Both are independent options in `default_emitter`.
- The 24 modified `options-*` files differ from 3b1a556 only by adding `"flags": {"macro_backtrace": true}`, and only
  where `emitter.macro_backtrace` is true (structural JSON check).
- In the whole corpus, emitter and flags `macro_backtrace` agree in every case: 44 = 24 options + 20 combo.
- All 60 combo cases set `ui_testing` plus a numeric `diagnostic_width`.
- Generator determinism: `gen-emit.ts`, run twice in scratch, is byte-identical between the two runs and with the
  committed `emit/gen` (1414 files).
- Oracle determinism: the probe run twice over the 260 combo plus options cases gives identical output. There are
  260 headers and no host paths.
- Full families on the lane:
  - `--filter combo`: MATCH=60/60;
  - `--filter options`: MATCH=200/200.
- The probe change is a comment only (`main.rs`, delayed-bug note).

### Nothing else
- Case-list hashes (`sha256(JSON.stringify(cases()))[:16]`) are identical on the lane and on current main (dbd9bb9):

  | suite | cases | hash |
  |---|---|---|
  | lex | 25780 | a8a356bd10b8a7b6 |
  | parse | 21526 | b244fb01ad2573be |
  | escape | 25780 | a8a356bd10b8a7b6 |
  | symbols | 10 | 7b46e1e12e1f8d93 |
  | escape-synthetic | 11 | 6618a744d214bf09 |
  | fluent-parse | 4210 | 696bc26b11376778 |
  | fluent-format | 4210 | 696bc26b11376778 |

- emit has 1466 cases, hash 1bf53fe82cb7084a, which matches the handoff.
- The fix round touches no `harness/baseline` and no `docs/state`.
- Its only script change is `scripts/difftest.ts` (`runSubject`). `gate.ts` and `classify` (MATCH semantics) are
  unchanged.
- `git merge-tree main lane/harness-w5` is clean.

### Spot runs (lane worktree, `RUST_TS_AGENT=review-hw5b`)

| run | result |
|---|---|
| `--suite emit --sample 300` (run `review-hw5b-emit`, 13 combo cases) | MATCH=300, 3 processes, batch-only 0/0 |
| `--suite lex --sample 300` (run `review-hw5b-lex`) | MATCH=300, 3 processes, batch-only 0/0 |

## For root
- Merge.
- Rebuild the shared probes from main (F3), gate with `emit`, and accept.
- Schedule G1 (the four-line `k + 1 === rest.length` bisect above) in the next `scripts/` batch.
