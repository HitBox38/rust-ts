# Handoff: probe-rmetadump-fix (harness batch: fixes for review probe-rmetadump)

Branch `lane/probe-rmetadump-fix`, branched from `lane/probe-rmetadump` (e9adf40d). This is a harness batch, so it needs
an independent review. It ports no compiler code: there are no `unported(...)` calls, no `// PORT:` decisions and no
coverage change (`bun scripts/coverage.ts --check`: markers ok, 23064; vendor 4680).

## Files touched

| file | what |
|---|---|
| `scripts/gate.ts` | finding 1: `oracleRuns`, `undeclaredRuns` (new, exported); `checkProbes` uses them |
| `scripts/gate-probes.test.ts` (new) | `checkProbes` over every registered suite, and unit cases of the wrapper check |
| `harness/suites.ts` | `RMETA_RUN` exported; comments for findings 2 and 9c |
| `scripts/rmeta-run.ts` | finding 2: the "differs" line goes to the side file `subject.differs`; finding 5b: header comment |
| `scripts/rmeta-run.test.ts` | the bytes test expects the side file, not a second stdout line |
| `tools/probes/rmetadump/main.rs` | comments only: finding 5a (repeated def paths), finding 7 (blank lines) |

## The fixes

1. **BLOCKING: `checkProbes` and the wrapper (finding 1).**
   - `oracleRuns(cmd)` lists the programs an oracle command runs. Normally that is the command's first word. For
     `[process.execPath, RMETA_RUN, ...]` it parses the wrapper's command line with the wrapper's own
     `parseRmetaRunArgs` and returns the compiler (the first word after `--`) and, with `--dump`, the probe.
   - `undeclaredRuns(suite)` returns one message for each such program that is neither `rustc` nor a declared probe.
     A malformed wrapper command line also gives a message.
   - `checkProbes` prints each message as `ERROR: ...`, as before.
   - Bun running any other script is still checked as Bun, so it is still refused.
   - Test `scripts/gate-probes.test.ts`, run in a child process like `unstable.test.ts`:
     - `checkProbes(every suite, false)` is true and prints nothing;
     - `undeclaredRuns` is empty for every suite;
     - the four wrapper suites run `rustc`, and rmeta-core and rmeta-ui also run the probe;
     - negative cases: an undeclared `--dump` probe, a non-rustc compiler, another Bun script, and a malformed wrapper
       command line.

     Suites whose declared probes are not built are left out, because `probePath` would end the process. Under
     `RUST_TS_REQUIRE_PROBES=1` that list must be empty.
   - Checked that the test catches the regression: with the wrapper case disabled, it fails with the reviewer's four
     `ERROR:` lines.
2. **Stale `oracle.rmeta` (finding 2).** The subject's compared stdout is now only `rmeta: <size> bytes, sha256 <hex>`.
   - The first-difference line goes to `<dir>/subject.differs`. It is written only when `oracle.rmeta` exists and
     differs.
   - The file is removed at the start of every subject run, so it always describes the last run.
   - A stale `oracle.rmeta` can no longer change any status.
   - I chose the side file over keying the out dir by the cache key. The cache key is computed in difftest, not in
     the suite's command.
3. **Comments (finding 5).**
   - The probe header no longer says def paths are unique. It says 18 repeat in core at the pin, that `uniqueIds`
     numbers the repeats, and that a missing or extra def shifts no other def's id, except among the repeats of its
     own path.
   - The rmeta-run.ts header says what the code does: a compiler that exits 0 without writing a file prints
     `rmeta: none` and exits 0.
4. **Probe not built (finding 9c).** `rmetaOracleKey` already reads the probe through `probePath`, which prints
   `ERROR: probe 'rmetadump' not built; run: bun scripts/probes.ts build rmetadump` and exits 1. It does not throw.
   I checked this with `RUST_TS_DATA` pointed at an empty directory. The only code change is the doc comment, which
   now says so. I added no test, because the check would need a child process with a different `RUST_TS_DATA`.
5. **Blank lines (finding 7).** The probe header and `Out::row`'s doc comment both say this now. Empty lines inside a
   multi-line value are dropped on both sides, so rmeta-* cannot see a difference made only of blank lines. check-*
   still sees it.

Findings 3, 4, 8 and 9a are left for root to record, as instructed. They are unchanged.

## Verification (RUST_TS_AGENT=root-f5de)

- `bun test scripts harness`: 76 pass, 0 fail (was 75: the new gate-probes test).
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/gate.ts run --suites check-core,rmeta-ui --skip-static` got past `checkProbes`. Before this fix it died
  with "missing probes". rmeta-ui's subjects started running, and then I stopped the gate and its children (my own
  PIDs). I deleted its partial run directory (`gate-20261030-202606-root-f5de-tcd5`, which held only an empty `diffs/`).

| run | before | after |
|---|---|---|
| `rmeta-ui --sample 20` | 20 UNPORTED (the same 20 ids in the lane's runs `probe-rmetadump-rmeta-ui`, `-rmeta-ui2`) | 20 UNPORTED: all 20 statuses identical (`20261030-202828-root-f5de-besa`) |
| `check-ui --sample 20` | 20 UNPORTED (the same 20 ids in the lane's run `probe-rmetadump-check-ui`) | 20 UNPORTED: all 20 statuses identical (`20261030-202901-root-f5de-34w2`) |
| `mir --sample 100` | gate-20261030-102229-root-fsro | 99 MATCH + 1 UNSTABLE: all 100 statuses identical to the gate, 0 protected lost (`20261030-202843-root-f5de-dv19`) |

## For root

1. **Oracle cache re-key.** `rmetaOracleKey` hashes rmeta-run.ts's source, so this batch re-keys the oracle cache of
   all four rmeta suites once. Their oracles re-run, including rmeta-core (about 6 s) and check-core (about 5 s). The
   oracle's output does not change: only the subject side's `--bytes` output changed. No other suite's key changes.
2. **Probe source changed, binary not rebuilt.** `tools/probes/rmetadump/main.rs` changed only in comments, but the
   comments add lines. A rebuild may change the binary, because panic locations embed line numbers, and that re-keys
   rmeta-core and rmeta-ui once more. I did not rebuild the shared probe. Root may rebuild it when convenient.
3. **New `subject.differs` file.** It sits in `$RUST_TS_DATA/rmeta/<suite>/<hash>/` next to `{oracle,subject}.rmeta`.
   It is diagnosis only and is never compared. Its sha256 tells whether `oracle.rmeta` is the file that the cached
   oracle output describes.
4. **Note on the gate's unit tests.** The gate runs `bun test src tools`, so `scripts/*.test.ts` (this new test
   included) are not part of the gate's unit tests. Root may want to add `scripts` and `harness` there. That change is
   not in this batch.
