verdict: PASS WITH NOTES

Independent re-check of harness batch `harness-m7b` (wave 40r) after the first review's FAIL (`docs/reviews/harness-m7b.md`, `99a5229d`).
Subject: commit `3385d616` on `t3/add-m7b-report-suites`, on top of `941ed6c4`; main `e80bc814`. Root's decision for F1 and F2: `docs/state/history.jsonl`, 2026-11-14T14:53, "harness-m7b (review F1, F2)".
I am read-only on the lane: this file is all I wrote to the tree. Line numbers are at `3385d616`. AC power throughout, no `GATE_RUNNING`, load 2-4, `--jobs 6` at most, `RUST_TS_AGENT=review-m7b-rc*`. My scripts and outputs are in this session's scratch directory, not in the repo or `$RUST_TS_DATA`.

**F1, F2 and F3 are fixed, and the protected side is untouched.** The masks hide only libtest's time and the thread id, and every port-like mistake I tried still differs. The UNSTABLE list holds up: I reproduced 5 of the 6 cases I re-ran, and the sixth is a genuine race in its source. M7c's run-fail 95% is now reachable. The cfg evaluation is right for every libc case in the corpus. The `HOME` sweep kills nothing outside its case. The notes below are small; none blocks the batch.

## 1. Protected suites are untouched

**All 75 suites, dumped independently.** My own dump imports `harness/suites.ts` and `scripts/difftest.ts` from the tree. It ran on `e80bc814` and on `3385d616`, both checked out in this same worktree, so the repo path is the same in commands and keys. For each suite it hashes:
- the metadata (mode, split, heavy, inputDirs, timeouts, cwd, probes, `readsOnlyCaseFile`, miri, irTier, criterion, `maskProgramOutput`, subset names, the list of hooks);
- every case (id, file, args, env, mode), every skip and the `unstable()` list;
- every case's oracle and subject command, `caseLock`, `irArgs` and `blessed`, or the batch command;
- the subsets' membership;
- `oracleKey()`;
- 15 evenly spaced full oracle cache keys (`caseOracleCacheKey`).

Result: **75 of 75 identical.** The six new suites:

| Suite | Cases | Skipped | Unstable | `maskProgramOutput` |
|---|---:|---:|---:|---|
| `ir-run-pass`, `ir-run-pass-o0` | 3,479 | 488 | - | no |
| `ir-host` | 3,415 | 552 | - | no |
| `native-hello` | 1 | - | - | yes |
| `run-pass-native` | 3,414 | 553 | 18 | yes |
| `run-fail-native` | 289 | 37 | 7 | yes |

So the new mask is set on the three native suites only. For every other suite, `maskedTexts` without the new argument gives the same text as before: the refactored `head` is `text.slice(0, r[0])`, as before, and I checked it directly.

**criteria.ts on `gate-20261114-065555-root-0e2v`, on main and on the branch:**
- `--milestone M6`: **byte-identical**, exit 0 both.
- `--milestone M7`: same figures and verdicts for every M7a group: `ir-hello` 2/2, `mir-o2` and `mono-ui` 3475/3479, `check-rg` 34 of 34. The output is not byte-identical, for two reasons (note 1):
  - `mir-o2` and `mono-ui` gain the words `, 0 unstable excluded`;
  - the six M7b/M7c lines from the lane's first round are added, all "not in this gate".

  So the exit code goes from 0 to 1. That is right, since M7 is not met, but anything that read exit 0 as "M7a met" must now read the M7a lines.

**`mono-ui --sample 200 --jobs 6`** (`review-m7b-rc-mono`): 200 MATCH.

## 2. F1: determinism

**The masks are minimal.** `maskLibtestTime` is anchored to a whole line `test result: …; finished in <digits>.<digits>s`. The thread-id mask is the existing line-anchored one, now applied to stdout as well. I took a libtest output with a captured panic and compared it with `maskedTexts(…, maskProgramOutput)` after one change at a time:
- **Equal, as they should be:**
  - only the thread id differs, on stdout or on stderr;
  - only libtest's time differs.
- **Still differ (a port bug would show):**
  - a wrong test name;
  - a missing `test x ... ok` line;
  - two test lines swapped;
  - `running N tests` wrong;
  - the panicking thread's name wrong;
  - the panic location wrong;
  - wrong pass/fail counts or status in the summary;
  - a different time format (`1s`);
  - the exit code;
  - an extra line;
  - a program's own `finished in 1.00s` vs `2.00s` (not on a `test result:` line);
  - an indented summary;
  - a literal `<tid>` against digits.

Two harmless details:
- On stderr the thread id is masked twice, once by `stderrMask` and once by `maskProgramOutput`, so it reads `<<tid>`. It is the same on both sides, and the mapping is still injective.
- The time mask would also hide a different number of decimals in libtest's own line. That line is formatted by std, from the oracle's sysroot, so no port code produces it.

**Spot-check: 6 listed cases, the oracle command run 3 times each** (each run compiles once and runs the program twice):

| Case | What I saw | Listed reason |
|---|---|---|
| `collections/hashmap/hashmap-debug-format.rs` | UNSTABLE 3/3. One invocation printed `Found {"two": 2, "one": 1}, but expected …`, the others nothing | right (hash seed) |
| `runtime/running-with-no-runtime.rs` | UNSTABLE 3/3. A tid inside a `{:?}`-printed child stderr: `(231970756)` vs `(231971464)` | right |
| `mir/alignment/misaligned_lhs.rs` (run-fail) | UNSTABLE 3/3. `but is 0x16fcc72a9` vs `0x16f4cf2a9` | right (ASLR) |
| `abi/stack-probes.rs#aarch64` | UNSTABLE 3/3. `thread 'main' (231976002) has overflowed its stack` | right |
| `attributes/log-backtrace.rs` | The two runs **agree** in all 3 invocations, but the 3 invocations differ at the `rustc_codegen_ssa::back::link` log line (the temp dir) | right; see note 2 |
| `threads-sendsync/yield.rs` | Stable in all 3 invocations (6 runs) | The lane listed it on the first review's sighting. The source prints `1 2 3` from `main` and `4 5 6` from a spawned thread with `yield_now` between them, a real race. The reason is right; it is just rare here |

**`RUST_TEST_THREADS=1` and `exec-env`:**
- `programEnv` sets the variable in the fixed part, before `exec-env`, so a test's own value wins. Unit-tested: `--libtest --env RUST_TEST_THREADS=4` gives `4`.
- The one corpus test that sets it is `threads-sendsync/test-tasks-invalid-value.rs` (`exec-env:RUST_TEST_THREADS=foo`, `--test`). Its command carries `--env` and `--libtest`. On the oracle the run prints `RUST_TEST_THREADS is \`foo\`, should be a positive integer`, and the verdict reads `run-fail: met`, with its error-pattern `found`.

**`oracle-self --suite run-pass-native --sample 50 --jobs 6`:** 50 equal, 0 unstable, 0 differ, 0 timed out; 32 s.

## 3. F2: the denominator

- `groupResult` subtracts gate.json's per-suite `unstable` list for groups with `excludeUnstable`, as well as `oracleTimeouts`.
  - gate.ts gives each case exactly one status, so a case is never in both lists, and nothing is subtracted twice.
  - A gate.json without the list is reported as a problem, not passed silently.
  - `allCases` groups (the hellos) still count every case.
- The test covers:
  - the first review's 274/289 with 15 UNSTABLE, now 274/274;
  - both exclusions at once;
  - the missing list;
  - the M6 groups unchanged;
  - an UNSTABLE hello, which is not met.
- **M7c's run-fail 95% is now reachable.** The 7 listed cases are always UNSTABLE. A perfect port reads 282/282. With up to 14 more cases failing, it still reads ≥ 95%.
- The last accepted gate's gate.json has an `unstable` list on all 61 suites, so the M7a groups read without a problem.
- difftest's own report-only criterion line still counts UNSTABLE (note 3).

## 4. F3: cfg-aware libc detection

I ran the whole corpus: the 30 files under `tests/ui` (test and aux files) that contain `extern crate libc`. I compared the old detection with `libcLoadedOn(text, hostCfg())`:
- They disagree on exactly 2 files, `intrinsics/panic-uninitialized-zeroed.rs` (both revisions) and `process/env-null-vars.rs`. Both gate the crate with `#[cfg(target_os = "linux")]`, which is false on this host, so the review's 3 cases are kept.
- On the oracle, all 3 compile and run, `run-pass: met (Pass)`.
- Every other gate on an `extern crate libc` in the corpus is `unix` or `not(windows)`, and evaluates true, so those files still count as loading libc. Examples: `runtime/out-of-stack.rs`, `abi/segfault-no-out-of-stack.rs`, `process/no-stdio.rs`, `command/command-uid-gid.rs`, `foreign/foreign2.rs`.

**"Unparseable counts as true" over-skips nothing today.** All 36 `#[cfg(…)]` predicates in those 30 files parse. No file has a crate-level `#![cfg]` or a revision cfg on its `extern crate libc`.

One latent bug that misses in the other direction (note 4).

## 5. N1 and N3: the `HOME` sweep

**Safe.** `killEscaped(dir)` kills a process only if its `ps -axwwE` line holds ` HOME=<case dir>/home ` as a space-delimited word, and never the wrapper itself. This is why that is safe:
- `<case dir>` is `$RUST_TS_DATA/native/<suite>/<hash(id)>`, unique per suite and case.
- The sweep runs inside `nativeRun`'s `work.lock` for that directory. Every checkout that shares `$RUST_TS_DATA`, the gate included, serializes on that lock.
- So any process that matches belongs to this case's own runs.

I tested it with 9 processes: two targets, and seven decoys. The decoys had:
- `HOME=<A>/home/x`;
- `HOME=<A>/homes`;
- `HOME=<A>x/home`;
- `HOME=<parent>/home`;
- `OTHERHOME=<A>/home`;
- `FOO='a HOME=<A>/home b'`;
- the word `HOME=<A>/home` as an argv entry.

Result:
- The 2 targets were killed.
- The 5 near-miss paths and names survived.
- The last two decoys were also killed, because they carry the exact word.
- No other pid on the machine was touched.

So outside the case, only a process whose argv or environment contains this case's exact `HOME=…/home` word could be hit, such as someone's `grep`. The race between `ps` and `kill` (pid reuse) is a few ms.

**Its reach is narrower than the header says** (note 5).

**N3:** `stdio-from.rs` now passes on the oracle (`run-pass: met`), and `process-termination-blocking-io.rs` is skipped with a reason. **N5:** `revision-bad.rs#foo` reads `error-pattern 'bar': not found`, then `should-fail: met (a check failed)`.

## 6. Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/ ./scripts/` | **575 pass, 0 fail**, 97 s, load 2-3 |
| `oracle-self --suite run-pass-native --sample 50 --jobs 6` | 50 equal, 0 unstable, 0 differ |
| `difftest --suite ir-run-pass --sample 100 --jobs 6` (`review-m7b-rc-irrp`) | 94 MATCH, 1 DIFF, 5 UNPORTED; 26 s |
| `difftest --suite mono-ui --sample 200 --jobs 6` (`review-m7b-rc-mono`) | 200 MATCH; 46 s |
| `criteria.ts --run gate-20261114-065555-root-0e2v --milestone M6 / M7`, main and branch | M6 byte-identical; M7a identical in figures (§1) |

The ir-run-pass result:
- **The DIFF**, `sepcomp/sepcomp-statics.rs`, is a port gap: line 6, the oracle's `@vtable.0.llvm.<hash> = hidden` against the port's `@vtable.0 = private`. ir suites are unchanged by this fix.
- **The UNPORTED:** 3 `generic_simd_intrinsic`, 1 `LLVMRustCreateMemoryEffectsAttr`, 1 `rustc_sanitizers` CFI.

## Notes

1. **criteria.ts output for M7 is not byte-identical**, though every M7a figure and verdict is. `mir-o2`/`mono-ui` lines gain `, 0 unstable excluded`, the first round's M7b/M7c lines are added, and the exit status for `--milestone M7` becomes 1 (M7 not met). Root should read the M7a lines, not the exit code, for "M7a met".
2. **Nondeterminism in the compile is invisible to the wrapper's own check.** `runsDiffer` compares two runs of one compiled program, so a nondeterministic compiler output (here `RUSTC_LOG=info` naming the `rustc<random>` link temp dir in `log-backtrace.rs` and `def-path-hash-ice-157238.rs`) is caught only by comparing two invocations, as `oracle-self` does, and is otherwise cached as if stable. The two known cases are listed. A future one would show as a flaky DIFF until it is listed. Consider having the oracle side compare two compiles' stderr too, or note this in `native-run.ts`'s header.
3. **difftest's report-only criterion still counts UNSTABLE** (`criterionOf`, `scripts/difftest.ts:990`), so a full `run-fail-native` run prints at most 282/289 = 97.6% there while criteria.ts reads 282/282. That still clears 95%, so nothing is wrong today, but the two reports disagree. Align it or say so in `Suite.criterion`'s doc.
4. **A commented-out `#[cfg(…)]` counts as a gate** (`libcLoadedOn`, `harness/suites.ts`). `attrsBefore` finds the item's start in the blanked text, but `cfgAttrs` reads the raw text. So `// #[cfg(target_os = "linux")]` or `/* … */` before `extern crate libc;` makes the crate look not loaded, and the case is kept though it would hit E0464. That is the opposite of the "doubtful case is still skipped" intent. No corpus file has this (checked: all 12 gates near an `extern crate libc` are real attributes). Fix: run `cfgAttrs` on the blanked text for positions and take each predicate from the raw text, or blank comments only.
5. **The `HOME` sweep misses escapees that run a system binary.** On this host (macOS 26.7.1), `ps -E` shows no environment for platform binaries. I tested `env -i HOME=… /bin/sleep` and `/usr/bin/perl`: invisible. The same with a non-platform binary (`bun`): visible. So a `setsid()` child that execs `/bin/sh` or `/bin/sleep` survives, still sandboxed. The same is true of a test whose `exec-env` sets `HOME`; none does at the pin. The header's limit says only "clears or changes its environment"; it should name this too. No run-mode test calls `setsid`/`setpgid`/`process_group`/`daemon`, so it remains a nit.
6. **`yield.rs` is listed without being reproduced in this round.** The lane's three-run pass and my six runs saw it stable. The source shows a real race, so the listing is justified. But per the convention ("diagnosed"), its reason could say it was seen once (first review) and is rare on this host, so a later reader does not take it for a measured-every-time case.
