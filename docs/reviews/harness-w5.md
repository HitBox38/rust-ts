ACCEPT-WITH-FIXES

# Review: harness-w5 (head cc4447d on `lane/harness-w5`)

Reviewer: review-hw5 (independent, read-only). Scope is `git diff main...lane/harness-w5` (merge base 4e5f5ca):
- the new `emit` suite:
  - `tools/probes/emitdump/{Cargo.toml.in,main.rs}`
  - `src/rust_ts/emitdump.ts`
  - `harness/corpus/gen-emit.ts`
  - `harness/corpus/emit/**` (1354 generated + 52 hand-written cases)
  - `harness/suites.ts`
- `scripts/{probes,difftest,gate,coverage,crate-src}.ts`
- `tools/probes/symdump/Cargo.toml.in`
- `src/std/result{,.test}.ts`
- the handoff

Nothing else changed: no baselines, no `docs/state`.

The `emit` oracle is faithful, and the corpus is meaningful and deterministic. Gate acceptance rules are intact, and no
status changes under any adversarial suite I built. The fixes requested are:
- F1, MEDIUM: a performance regression in the new difftest split, for subjects that buffer their output (lex,
  escape and emit all do). Statuses stay correct.
- F2, LOW: the new batch-only counters over-count.

Neither can lose or fake a protected case, so they need not block the merge. F1 should land before the next gate on
a revision that might hang a lex or escape case.

## Findings

### F1 (MEDIUM, performance): the split degrades to one retry per case when the subject buffers its output
- Where: `scripts/difftest.ts:171-208` (the `runBatch` loop in `runSubject`; split at 192-205).
- What happens: when the failed process printed nothing useful, the first case without a complete section (`k`) is
  just the first case whose output was lost.
  1. That case passes alone.
  2. The remainder `(k, n)` is re-run as one batch.
  3. That batch fails again at the same file, with `k = 0`.
  4. So the loop peels one case per iteration: about 2·j processes for a failure at position j.
  5. For a hang, that is j full timeouts. The old bisection needed about log2(n) of them.
- Which subjects buffer:
  - `src/rust_ts/lexdump.ts` and `escapedump.ts` keep up to 1 MiB in a string and have no `catch`, so an
    uncaught throw or a kill loses the tail.
  - `src/rust_ts/emitdump.ts:137-158` flushes only at the end or in `catch`, so a timeout kill loses everything.
- Reproduced with a fake buffering subject (100 cases, scratch `RUST_TS_DATA`, `timeoutMs` 3000, `--batch-size 100`,
  `jobs 1`):

  | scenario | lane | main |
  |---|---|---|
  | hang at #60 | 124 processes, 187 s, `batchOnlyTimeouts=60` | 24 s |
  | crash at #60 and #61 | 125 processes, `batchOnlyFailures=60` | |

  Statuses were identical to `--batch-size 1` and to main in both cases.
- Real impact:
  - lex and escape use `timeoutMs` 120 000.
  - One hanging file deep in a 100-file chunk costs on the order of j × 2 min (up to more than an hour per chunk).
    With bisection it was about 7 × 2 min.
- Fix (keeps "no output of a failed process is ever attributed"):
  - When the suspect `rest[k]` passes on its own, the split point carried no information. Bisect the remainder
    `(k, n)` in halves (as before this batch) instead of re-running it whole.
  - Keep the three-way split plus streak only when the suspect fails on its own, i.e. the header pinpointed the
    culprit.
  - That bounds the cost to O(log n) per uninformative failure and keeps O(1) for header-first output.
  - Optionally, also make the dump drivers write each case's section as soon as it completes. That is a subject-side
    change for the owners of those files.

### F2 (LOW): `batchOnlyFailures` / `batchOnlyTimeouts` count innocent cases
- Where: `scripts/difftest.ts:203-205` (`batchOnly*++` at 204).
- The counter increments whenever the chosen suspect passes alone. The suspect is often not the culprit:
  - an exit-0 case before the culprit whose header is wrong or missing;
  - a lying or over-printing failed process, where `k` jumps to the end and each recursion level peels and counts
    one case;
  - lost buffered output (F1).
- Measured on fake suites; statuses equal `--batch-size 1` in every set:

  | set | reported | true |
  |---|---|---|
  | mixed (`victim` after `poison`, `ok` after `crashafter`) | 6 failures + 2 timeouts | 2 |
  | liar (one case prints every header, then exits 101) | 25 failures, 55 processes | 0 |
  | prefail (dies before its own header) | 1 | 0 |

- The gate prints a `note:` line and stores the counts in `gate.json`, so the noise is user-visible and makes the
  note useless as a state-leak signal.
- Fix: count per failed batch process, not per suspect. Record each failed batch's case ids. After `runSubject`
  resolves it, count it as batch-only only if none of those cases ends with a failing (non-zero or timed-out)
  output. This is the w4b F3 definition.

### F3 (LOW, pre-existing hazard surfaced by this batch): shared probe binaries are built from a lane worktree
- `$RUST_TS_DATA/probes/emitdump/Cargo.toml` and `.../symdump/Cargo.toml` both point at
  `.data/lanes/harness-w5/tools/probes/<name>/main.rs`. The handoff says symdump was rebuilt from the lane.
- `checkProbes` (`scripts/gate.ts:45`) only checks that the binary exists. Main's gate therefore runs whatever
  binary a lane last built into the shared `target/probes`.
  - The oracle cache is keyed by binary hash, so results stay self-consistent.
  - But a lane-modified probe would silently become main's oracle.
  - symdump's `main.rs` is unchanged here, so there is no effect today.
- Fix:
  - Now: after merging, root runs `bun scripts/probes.ts build symdump emitdump` from main, before the gate.
  - Later: `probes.ts build` writes a stamp next to the binary (hash of the substituted manifest plus probe sources
    plus the REPO path). `checkProbes` fails with one `ERROR:` line when the stamp does not match the gate tree.

### F4 (LOW): the one-argument `unwrap_result` guard has holes
- Where: `src/std/result.test.ts:45-75`.
- Verified in a scratch copy:
  - it catches a direct `unwrap_result(r)` in non-test code;
  - it misses `import { unwrap_result as uw } ...; uw(r)`;
  - it misses `unwrap_result(r,)`, where the trailing comma counts as a second argument.
- Fix: give the test-only form its own name (e.g. `unwrap_result_untyped`) and grep for that name outside tests.
  Alternatively, also reject `unwrap_result as` imports and ignore trailing commas.
- The panic texts themselves are exact:
  - `library/core/src/result.rs:1232` gives `called \`Result::unwrap()\` on an \`Err\` value`;
  - `:1184` gives `expect`'s `msg`;
  - `:1865 unwrap_failed` gives `panic!("{msg}: {error:?}")`.

### F5 (LOW, pre-existing, item 3 "accept with unrun tests"): the gate ignores test skips
- `bun test src tools` exits 0 with skips, and `staticChecks` only looks at the exit code.
- `src/rustc_ast/ast.test.ts:27-51` turns tests into `test.skip` when `create_default_session_globals_then` (or
  `Ident` Debug) throws `Unported`. A regression to `Unported` there would silently drop those tests from the gate.
- Today the only skip is the Linux-only `read_binary_file_handles_lying_stat`.
- The `tools/codegen` up-to-date tests skip when the upstream checkout is missing. That case is harmless, because the
  gate's difftest then dies on `requireUpstream`.
- Fix:
  - the gate parses `N skip` and fails above an allowlist (1 on macOS/Windows, 0 on Linux);
  - and/or `ast.test.ts` drops its `Unported` fallbacks now that session globals are ported.

### F6 (INFO): corpus configuration notes
- Emitter `macro_backtrace`:
  - It is set in 24 cases, always on the emitter only and never on `DiagCtxtFlags`. rustc sets both from
    `-Zmacro-backtrace` (`session.rs:1283`, `config.rs:1594`).
  - Every span is root-context, so macro-backtrace rendering is never exercised.
  - Harmless, but the generator should set both together (as `dcx_flags` does) and not count this as macro
    coverage.
- No case combines `ui_testing` with `diagnostic_width`, which rustc allows.
- The delayed-bug flush is unreachable by construction, which is correct: every delayed bug sits next to an emitted
  error. Reaching it would print host-dependent text: `decorate` with `emitted_at` and a `RUST_BACKTRACE`-dependent
  backtrace, and `DelayedBugPanic` would abort the probe. Worth one line in the probe header.

### F7 (INFO): main has moved
- main is now 6c380fb (session-parse).
- `git merge-tree` main × lane is clean. The overlap is only in `tools/codegen/*.json`, and no `scripts/`,
  `harness/`, `src/std` or `rustc_errors`/`rustc_span` files changed.
- Root's post-merge gate covers it.

## What I checked

### 1. `emit` oracle faithfulness
- Probe build and lock:
  - The probe has path deps on the pinned `compiler/rustc_errors` and `rustc_span`, with `lockfile = "upstream"`.
  - I rebuilt it from the lane's template in scratch (`target/scratch-review`, `cargo +nightly`, which is commit
    6f5da406b, `RUSTC_BOOTSTRAP=1`, `CFG_RELEASE=1.101.0-nightly`).
  - The resolved `Cargo.lock` is byte-identical to the lane's build.
  - All 160 packages, with name, version and checksum, are in upstream's `Cargo.lock`. The only differences are
    pruned `name version` disambiguators.
  - The rebuilt binary's output on the full corpus is byte-identical to the shared one's.
- Emitter construction matches `rustc_session::session::default_emitter` (`session.rs:1282`):
  - The same setters are used. They are derive_setters, so order does not matter.
  - `--color always` with stderr not a TTY gives `AlwaysAnsi` (`emitter.rs:440`). `never` gives
    `AutoStream::never`, which equals `AutoStream::new(_, Never)` in anstream 0.6.21.
  - `source_map: false` corresponds to `-Zlink-only`. `terminal_url` is explicit, never `Auto` (env-dependent).
  - `DiagCtxt::new(..).with_flags(..)` mirrors `dcx_flags`, with `treat_err_as_bug`/`track_diagnostics` off.
  - There is no fallback bundle or translator at the pin.
- No post-processing: the bytes go to a `Shared` buffer that is printed verbatim. The only additions are the
  `file:` header and the never-triggered `no newline` footer.
  - 1406 headers for 1406 cases.
  - No host paths: no `/Users/` anywhere in the 881,659 bytes.
- The subject's framing is a driver mirror outside the code under test (`emitdump.ts`). It is header-first and
  flushes in `catch` (see F1 for timeouts).
- Probe and subject produce byte-identical full-corpus output (`cmp`).
- The corpus is meaningful. Counts are over the 1406 oracle sections, by heuristic:

  | feature | sections |
  |---|---|
  | carets | 1029 |
  | `LL` (ui_testing) | 787 |
  | removal/diff suggestion lines | 576 |
  | `...` | 482 |
  | multi-line spans | 479 |
  | multi-file | 441 |
  | expected/found | 412 |
  | CJK | 318 |
  | `+` suggestion lines | 205 |
  | ANSI colour | 194 |
  | unicode theme | 171 |
  | error-count summaries | 336 |
  | `--explain` | 183 |
  | short messages | 39 |
  | OSC-8 URLs | 38 |
  | FatalError | 62 |
  | ICE/ExplicitBug | 32 |
  | empty | 4 |

- A mutation (`"1 warning emitted"` changed to `"1 warnings emitted"` in a scratch copy of `src/rustc_errors/lib.ts`)
  changes 168 of the 1406 cases, so the suite is not trivially passing.
- Generator determinism: I ran `gen-emit.ts` twice in scratch. Both runs are byte-identical to each other and to the
  committed `emit/gen` (1354 files).
- `PROBE_ENV` generalisation:
  - `probeMeta("symdump")` is `{RUSTC_BOOTSTRAP: "1", CFG_RELEASE: "1.101.0-nightly"}`, identical to the old table.
  - Every other probe has an empty env.
  - `symbols` is 10/10 MATCH with the rebuilt binary.

### 2. difftest F2/F3 split
- I built runtime-injected fake suites (scratch `RUST_TS_DATA`, `timeoutMs` 3000):
  - mixed: ok, poison/victim, fail70, crash, exit1, wrong header, no output, diff, hang, crashafter, liar, lie70,
    prefail;
  - all-fail (200);
  - sparse crashes;
  - prefail;
  - liar;
  - timeouts;
  - buffered crash and buffered hang.
- In every set the statuses at `--batch-size 100` equal `--batch-size 1`, and equal main's bisection.
- Process counts: all-fail 202, sparse 10.
- `classify`/MATCH semantics, `runOracle`, `cachePath`/`oracleVersion` and `splitBatch` are unchanged. The diff
  starts after `runOracle`.
- The exit-0 missing-header behaviour (score stderr) is unchanged.
- Termination holds: each iteration consumes at least 1 case, and recursion is on strict prefixes.
- Problems found: F1 and F2.

### 3. coverage F4, `--offline`, gate
- I ran old (4e5f5ca) and new `coverage.ts` over the same tree, in these modes:
  - `--check`;
  - `--check --crate rustc_errors` and `--check --crate annotate-snippets`;
  - `--crate rustc_lexer` and `--crate unicode-width-0.2.2`;
  - compiler and vendor `--missing`;
  - the tables.
- Every mode's output is identical between old and new.
- `--check --offline` prints `markers ok (2210; vendor 2048)`.
- `--crate annotate_snippets` (underscore) crashes with ENOENT in both versions, so that is pre-existing and not this
  batch.
- `checkProbes` with an empty scratch `RUST_TS_DATA` printed 10 ERROR lines (5 suite probes and 5 unit-test probes)
  and returned false.
- `oracleTestProbes()` finds annotate, listfmt, plurals, typedefs and uwidth.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools` on the lane: 502 pass, 1 skip, 0 fail.
- `run()` merges `env` into `process.env`, so the `{}` env for typecheck and markers is safe.
- `gateAccept` is unchanged. It still refuses runs that:
  - did not pass;
  - have no provenance;
  - skipped static checks;
  - were dirty;
  - were made at a different HEAD;
  - leave a stray dirty tree;
  - are missing a protected suite;
  - lose a case (re-read from the per-case jsonl).
- `checkProbes` dies before any `gate.json` is written. Accepting with unrun tests is only possible through skips
  (F5).

### 4. `result.ts`
- The texts are exact (see F4).
- `PLAIN` rendering is `{:?}`.
- No non-test caller uses the one-argument form today, on the lane or on current main.

### 5. Nothing else changed
- These suites have the same case count and the same hash (`sha256(JSON.stringify(cases()))[:16]`) on main and on
  the lane: lex, parse, escape, symbols, escape-synthetic, fluent-parse and fluent-format.
- emit: 1406 cases, hash d8583fbc254273e2.
- No `harness/baseline` changes.

### Spot runs (lane worktree, `RUST_TS_AGENT=review-hw5`)

| run | result |
|---|---|
| `--suite emit --sample 200` (run `review-hw5-emit`) | MATCH=200, 2 processes, batch-only 0/0 |
| `--suite fluent-format --sample 200` (run `review-hw5-ff`) | MATCH=200 |
| `--suite symbols` (run `review-hw5-sym`) | MATCH=10 |

## For root
- Merge, then rebuild the shared probes from main (`bun scripts/probes.ts build symdump emitdump`, see F3). Then
  gate with `emit` included and accept.
- Schedule F1 and F2 (`scripts/difftest.ts`) as a small reviewed harness batch. F4 and F5 can go with it.
