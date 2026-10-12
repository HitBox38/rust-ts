ACCEPT-WITH-FIXES

# Review: harness-w4b (commit 8c0492e on `lane/harness-w4b`)

Reviewer: review-hw4b (independent, read-only). Scope is `git diff main...lane/harness-w4b`:
- `scripts/difftest.ts`
- `scripts/coverage.ts`
- `scripts/crate-src.ts`
- `tools/probes/fluentdump/build.rs`
- the handoff

All three changes do what the handoff says, and I found no correctness defect in the ratchet path.

One finding blocks integration as-is (F1). Merged alone, the lane makes the gate's `markers` step fail on a real but
pre-existing bad marker on main. Root must land the generator fix in the same integration. The other findings are
LOW or INFO.

## Findings

### F1 (MEDIUM, integration-blocking): `coverage.ts --check` fails on main's tree once this lands
- Where: `src/vendor/unicode_width/tables.gen.ts:8`, emitted by `tools/gen-unicode-width.ts:100`.
- The error is real.
  - The marker is `// crate: unicode-width-0.2.2/src/tables.rs:165 UNICODE_VERSION`.
  - Upstream line 165 of the registry `unicode-width-0.2.2/src/tables.rs` is `pub const UNICODE_VERSION: (u8, u8, u8) =
    (17, 0, 0);`. That is a const, not a fn, so no fn can ever match it.
- Scenario:
  1. Merge the lane.
  2. `bun scripts/gate.ts run`.
  3. The `markers` step runs `coverage.ts --check` and exits 1.
  4. The gate fails.
- I reproduced it twice: on the lane's own tree, and on main 5156c44 with the lane's `coverage.ts`/`crate-src.ts`
  checked out in a scratch worktree. Both give exactly this one ERROR line.
- Fix, in the same integration as the merge:
  - make `tools/gen-unicode-width.ts:100` emit a plain provenance comment, e.g.
    `// unicode-width-0.2.2/src/tables.rs:165 (const)`, not a `crate:` marker;
  - regenerate `tables.gen.ts`;
  - then run the gate.

### F2 (LOW, performance): bisection costs up to 2n-1 processes per failing chunk
- Where: `scripts/difftest.ts:140-145`.
- A chunk whose cases all fail costs `2n-2` subject processes instead of 1.
- Measured with a fake suite of 200 always-exit-70 cases at `--batch-size 100`: main 2 processes, lane 398 processes.
- On fluent-format (1471 UNPORTED cases) the full run takes 30.5 s, against 19.1 s for `--batch-size 1`.
- Realistic risk: a regression that makes a shared module throw at load time. Every lex case (25780) would then fail,
  and the gate's lex difftest would spawn about 51k processes instead of 258, i.e. minutes instead of seconds. The
  statuses would still be correct, so this is not a ratchet problem.
- Timeouts are unaffected (they were already bisected the same way).
- Fix (keeps the "no failed-process output is ever attributed" property):
  - Use the failed run's stdout only to choose the split point, never for statuses.
  - Let `k` be the index of the first case without a complete section.
  - Re-run `batch[0..k)`, `[batch[k]]` and `batch[k+1..)`. Each part is strictly smaller than the batch, so this
    terminates.
  - A wrong or lying header can only make the split worse, never change a status.
  - This needs O(failures) processes instead of O(failures × log n).

### F3 (LOW): batch-only failures are now silently masked
- Where: `scripts/difftest.ts:140`.
- If a file fails only because of state left over from an earlier file in the same process, bisection separates the
  two files and both score their isolated status.
- Scenario: fake suite `ok01 ok02 poison1 victim1`, where `victim1` exits 101 only after `poison1` ran in the same
  process.
  - main: `victim1=CRASH`
  - lane: `victim1=MATCH` (5 processes)
- The isolated status is the defensible "true" one: it equals `--batch-size 1`, and rustc compiles one file per
  process. But a state leak in a dump driver is a real bug that now leaves no trace.
- Fix: count failed batches whose bisection ends with every leaf succeeding (`batchOnlyFailures`), and write the
  count into `<suite>.summary.json`. Do the same if a non-empty count is ever seen in the gate output. No status
  changes.

### F4 (LOW): coverage.ts resolves every vendor crate on every invocation
- Where: `scripts/coverage.ts:131` (`await vendorCrates()` before any mode dispatch).
- The call runs even for `--missing compiler/...` and compiler-only `--crate`.
- `crateSrc` falls back to `cargo fetch`, which needs the network, writes to `~/.cargo`, and creates
  `$RUST_TS_DATA/crate-fetch`.
- Scenario: on a host whose registry does not hold one of the 16 crates (for example the Windows `D:` setup after
  a cargo cache clean), the gate's `markers` step has to go to the network, or dies with `ERROR: cargo fetch failed`.
- On this machine all 16 crates were in the registry: my run with a scratch `RUST_TS_DATA` created no `crate-fetch`
  dir.
- Fix:
  - resolve vendor crates lazily, only for vendor rows, vendor markers and vendor `--missing`;
  - optionally pass `--offline` to the fetch from the gate path, so a missing crate fails with a clear ERROR rather
    than doing network I/O.

### F5 (INFO, pre-existing, unchanged): exit-0 batches trust `file:` headers
- Where: `scripts/difftest.ts:146-151` (`splitBatch`).
- In a process that exits 0, a section is attributed by its header text. Headers are not checked to appear exactly
  once and in batch order.
- Scenario: the subject handles `steal1` by printing `file: tok1` plus tok1's correct output, then skips `tok1`. Then
  `tok1` scores MATCH from output its own processing never produced.
- Reproduced on the lane (`steal1=DIFF tok1=MATCH`). Main behaves the same; this batch did not introduce it.
- Cheap hardening that fits the new design: when the sequence of headers is not exactly the batch's file order, treat
  the batch as failed and bisect.

### F6 (INFO): vendor totals and new crates
- Vendor totals count every `.rs` in the package (tests/benches/examples). So unic-langid shows 5/5 although `src/`
  has 0 fns, and benches/examples show up as gaps. Root should decide whether those need `crate-skip:` markers.
- Any future vendor crate (e.g. lane `icu-list`, if it adds `icu_list` markers) will fail `--check` with "names no
  harness/scope.json vendor crate" until `harness/scope.json` `vendor` lists it. `scope.json` needs owner approval.
  This is intended, but porters should be told.

## What I checked

### 1. difftest batch bisection
- **Diff scope.**
  - Only `runSubject` changed: the `failed` condition was hoisted and widened from `timedOut` to `code !== 0 ||
    timedOut`, and the comment was updated.
  - `runSubject` and `classify` gained `export`.
  - `runOracle`, `cachePath` (oracle cache key), `oracleVersion`, `splitBatch`, `classify`'s body and single-mode suites
    are byte-identical to main.
- **MATCH semantics.** Unchanged: a case is MATCH only when its text and code equal the oracle's. Text comes either
  from a complete section of an exit-0 process (code 0), or from a single-case process.
- **No partial attribution.** The only place a failed process's output is read is the `forEach`, and it is reached
  only when `batch.length === 1`. There, `complete` is always false (`i + 1 < 1` is false), so the case gets `{stderr,
  code, timedOut}` and its stdout is ignored.
- **No upgrade of genuine failures.** A case that fails alone fails in every batch that contains it. The recursion
  therefore always reaches it as a singleton, which records its own code and timeout state.
- **Termination.** Recursion happens only for `length > 1`, and `mid = length >> 1 >= 1`, so both halves are
  non-empty and strictly smaller. The depth is at most ceil(log2 n).
- **Timeouts.** The same per-process `timeoutMs` applies, and the halves run sequentially within one pool worker, as
  `runOracle` does. A singleton that times out, or prints a complete section and then hangs, is TIMEOUT.
- **Adversarial fake suite.**
  - Setup:
    - I injected a temporary suite object into the exported `SUITES` array at runtime; `harness/suites.ts` was not
      edited.
    - Runs went through the real `difftest()` with a scratch `RUST_TS_DATA`, whose `rust` is a symlink to the pin. So
      the real oracle cache and runs dir were never touched.
    - Timeout was 3 s, with 22 cases.
  - Subject behaviours:
    - ok
    - exit 70 after a partial section
    - complete section then exit 101
    - complete section then exit 70
    - prints the *next* file's correct section then exits 70
    - reprints the *previous* file's header with garbage then exits 1
    - hangs after a header
    - prints a complete section then hangs
    - poison/victim
    - wrong text
    - bare exit 1
  - Results at `--batch-size 100` and `--batch-size 1` on the lane are identical, case for case:
    - crash-after-print = CRASH
    - late-70 = UNPORTED
    - wrong-next-header = UNPORTED
    - garbage-prev-header = DIFF
    - hang and print-then-hang = TIMEOUT
    - every ok = MATCH, including the cases adjacent to each failure
  - Main at batch 100 scored all 22 CRASH, because the first file died, which shows the inherited-failure problem the
    lane fixes.
- **fluent-format, full run from the lane** (`RUST_TS_AGENT=review-hw4b`):
  - `MATCH=2739 UNPORTED=1471 DIFF=0 CRASH=0 TIMEOUT=0`, which matches the handoff.
  - `--batch-size 1` gives the same counts, and the two `fluent-format.jsonl` files are byte-identical.
  - All 98 protected cases are MATCH.
  - Runs: `rhw4b-lane-ff`, `rhw4b-lane-ff-b1`.
- **lex and escape `--sample 500`, main vs lane:** both 500/500 MATCH, and the jsonl files are byte-identical (`rhw4b-{main,lane}-{lex,escape}`).
- **Gate.** `gate.ts` only consumes `difftest()` results (MATCH ids). For suites with no failing batch, the code path
  is unchanged: one process per chunk. Their lost/gained sets are therefore unaffected.
- **Root heads-up.** The next fluent-format accept will gain about 2641 cases. That growth comes from the harness
  change, not from a port change, and the accept message should say so.

### 2. coverage.ts vendor markers
- Setup: two scratch worktrees with identical `src/`, at the lane base 5670a5a and at 8c0492e, run with a scratch
  `RUST_TS_DATA`, so the shared `coverage.json` was not rewritten by me.
- **Default table.** The compiler section (9 lines) is byte-identical. The `coverage.json` compiler fields
  (`ported/total/crates`) are JSON-identical, plus a new `vendor` key. `state.ts` reads only `ported/total`. The
  vendor table matches the handoff (946/1358).
- **`--check`.** Base: `markers ok (1950)`. Lane: the compiler side has no errors, plus the single F1 ERROR (exit 1).
  On main 5156c44 with the lane's scripts, it gives the same single ERROR.
- **`--crate rustc_lexer` and `--missing compiler/rustc_lexer/src/lib.rs`.** Same per-file rows and the same
  `42/42 ported`. `--crate` only adds a `TOTAL ... in rustc_lexer` line and no longer writes `coverage.json`.
  That change is intended and harmless: a single-crate run used to overwrite the overall coverage that
  `state.ts summary` reports.
- **Negative tests.** I added a scratch `src/vendor/zz_review.ts` in the scratch worktree.
  - Correctly reported as errors:
    - wrong line
    - wrong name
    - wrong version
    - unknown crate
    - missing file
    - `crate-skip:` with a wrong line
    - a `..` path escaping the crate dir
    - a `/// crate:` doc-comment form
    - a marker inside a string literal (the regex is unanchored, like the `rustc:` regex)
  - Accepted: a correct marker, and a leading-zero line (`:020`, the same as the `rustc:` regex).
  - `--check --crate fluent-syntax` reports only that crate's bad marker. `--check --crate rustc_lexer` ignores vendor
    markers and prints `markers ok (1950; vendor 948)`.
- **crate-src.ts.**
  - The CLI is behaviour-identical between base and lane in all four cases I tried:
    - a crate locked at several versions → ERROR
    - `--version` → path
    - an unknown crate → ERROR, exit 1
    - no args → usage, exit 1
  - `import.meta.main` guards the CLI, so importing the module has no side effects.
  - `tools/codegen/vendor-tables.ts` spawns the CLI with `--version`, which is unchanged.

### 3. fluentdump verbatim guard
- **Extents vs upstream at the pin.** All seven extents match the BEGIN/END spans in `main.rs` (9, 68, 10, 11, 9, 15
  and 21 lines). Each recorded last line is the upstream end of the copied item.
- **Scratch build.**
  - Copied `build.rs`, `main.rs`, the substituted `Cargo.toml` and the shared probe's `Cargo.lock`.
  - Built with `CARGO_TARGET_DIR=$RUST_TS_DATA/target/scratch-review` and `--offline`; the target dir was deleted
    afterwards.
  - The unmodified copy builds (exit 0).
- **Mutations** of the `formatting.rs:39` block (plus `lib.rs:344` for reorder). Each one fails the build (exit 101)
  with the expected assertion:
  - shorten (END up 5)
  - empty (END right after BEGIN)
  - lengthen
  - move (`:40`)
  - one-line content edit
  - drop the last line
  - drop the markers
  - reorder two blocks
  - duplicate a block
  - stray END
  - unterminated block
- `seen == expected` still enforces the exact set and order.

### 4. Nothing else changed
- `git diff --stat main...lane/harness-w4b` lists only the four files above and the handoff.
- No `src/`, `harness/` (suites, case lists, baselines, corpus, scope.json) or oracle output changes.
- `bunx tsc --noEmit -p .` passes on the lane.

## Required before merge
- F1: fix the generator and regenerate, in the same integration.

## Recommended follow-ups
- F2 (split at the first incomplete section)
- F3 (batch-only failure counter)
- F4 (lazy, offline vendor resolution)
- F5 (header order check)
