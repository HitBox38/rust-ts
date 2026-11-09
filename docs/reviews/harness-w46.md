**Verdict: APPROVE WITH NITS.** No finding blocks the merge. Pass/fail is decided as before, every protected suite's keys are unchanged, and every plant was caught and named.

# Review: lane `harness-w46` (gate notes, unit-step leftovers, `rlib-native` report suite)

Reviewed: branch `t3/harness-gate-notes`, head `90045ea7` (one commit with the handoff), against `main` at `74f215e6`. Independent, read-only
on code. Settings: `.env.local` from `integ-w39`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=w46-review`, on AC
power, Bun 1.4.3. I ran everything in a scratch detached worktree at `90045ea7`, with a second one at `74f215e6` for timing, and removed
both. No gate and no protected suite was run. The only difftests were of the report suite `rlib-native`.

## Findings

All are nits. None changes a pass or fail.

- **N1 (nit; reproduced): `scripts/gate.ts:469`. The crashed-file line can name an innocent file, and it gives a crash as the cause even
  after a timeout.** Scenario: in the runner pass, I put `afterAll(() => setTimeout(() => process.exit(3), 300))` in
  `scripts/lib/split.test.ts`. The gate printed `failed: scripts/lib/unit-steps.test.ts: the last test file bun test started; the process
  ended in it ...`. The file named is two files later, because the timer fired while that file ran. The step still fails, so only the
  diagnosis is wrong. Also, when `r.timedOut` is set, the same line still says "(process.exit, an abort or a crash, ...)", though the
  gate's 30-minute limit killed the process. Suggested wording: "the file Bun was running when the process ended (async work left by an
  earlier file can also end it)". On a timeout: "the file it was running when the limit killed it".
- **N2 (nit; read only): `scripts/gate.ts:413` and `:453-455`. On Windows, `\r` breaks two small things.** `outputTail` splits on `"\n"`,
  but the notes split on `/\r?\n/`. On Windows, a note already in a failed step's tail is then printed twice, and Bun's file-name lines
  keep their `\r`, so `BUN_FILE_LINE` does not filter them. Only the display is affected (`crashedIn` splits on `/\r?\n/`), and Windows is
  unchecked (AGENTS.md §5). Splitting `outputTail` on `/\r?\n/` too would fix both.
- **N3 (nit; read only; inherited from `host-rlib`): `scripts/rlib-native-run.ts:157`. The compiler is not added to the case lock's
  holders.** `scripts/ir-run.ts` adds its compiler with `addLockHolder` (review harness-w42 N1); this wrapper does not, and neither does
  `host-rlib-run.ts`. Scenario: a difftest is killed with SIGKILL while a case compiles. The wrapper and its compiler live on, and the
  lock is taken over once its owner is dead. The next run of that case then empties `work/` while the orphan still writes there, which
  can give a false DIFF. This is a report-only suite, and the gap is the same one `host-rlib` already has. Worth one line in the header,
  or the same fix as ir-run's.
- **N4 (for root; confirmed): `.gitignore:7-8`.** It still lists `check_oracle/cases/*.rlib` and `compare_impl_item_oracle/cases/*.rlib`.
  After item 4 nothing writes there, as I checked below, so root may drop both lines. Keeping them does no harm.

## 1. Notes from a passing static step

- **Pass/fail is decided as before (read).** In `runStaticStep`, `pass = r.code === 0` and the rest of the junit path are unchanged.
  `tail` and `notes` are only printed and returned. The no-report branch still returns `{ pass: false }`. `staticChecks` decides `ok`
  exactly as before, and `notes` only collects. `gateRun` writes `staticNotes: st.notes ?? []` into both records (`:619`, `:683`). With
  `--skip-static` the field is `[]`. Nothing reads `staticNotes`, so `accept` and frozen-lists' `RetryGate` reader do not change.
- **Size and JSON (read).** The steps without a report are typecheck, markers, marker order, info sites and frozen lists. Only
  `frozen-lists.ts` prints `note:` lines in the gate's mode (`:146`). Those notes come from `nearLimitCases`: at most one for each
  malformed line of `history.jsonl` (658 lines today), plus three single notes. So in the worst case they are tens of kilobytes. In the
  modes the gate uses, `coverage.ts` prints no `note:` line (those are in `--missing` and `--report`). `tsc` lines never start with
  `note:`. `JSON.stringify` escapes every string, including control characters and lone surrogates, so no note can break the file.
- **`bun test` steps excluded: right.** Their output is the tests' own output, which is arbitrary. A test that prints rustc's stderr would
  flood `staticNotes` with diagnostic `note:` lines. A clean runner pass printed 0 `note:` lines today, but nothing guarantees that. The
  unit steps' own slow-test notes, which `runStaticStep` prints, go to the gate log but not into `staticNotes`. That matches the
  documented scope ("a step without a junit report").

## 2. The quiet variables

- **Bun behaviour: confirmed by measurement.** With one variable set at a time, Bun 1.4.3 prints no file names when `CLAUDECODE`, `AGENT`
  or `REPL_ID` is set to `1`, and prints them when the value is empty or `0`. Each of these did not make Bun quiet: `CI`, `CURSOR_AGENT`,
  `GEMINI_CLI`, `CODEX_SANDBOX`, `CODEX_CI`, `OPENCODE`, `AI_AGENT`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_AGENT_RULE_DISABLED`,
  `CLAUDE_AGENT_SDK_VERSION`, `AUGMENT_AGENT` and `CLINE_ACTIVE`. `strings` on the binary shows only the three names as whole entries.
  Bun prints file names on stderr, which is what `crashedIn` reads.
- **Nothing else changes (measured).**
  - On a fixture with pass, fail, skip, todo and console output, the junit reports with and without the variables are identical except
    for times, and the exit code is the same. Without them, Bun adds `(pass)`, `(skip)` and `(todo)` lines and file names. Test console
    output appears in both.
  - `bun test ./scripts ./harness` gave 424 pass, 0 fail, both with the variables set and with all three unset (as the gate's step runs
    it).
  - No file in the repo reads any of the three (`git grep`, outside the new code and its test).
  - Children that tests start inherit the unset env. The only ones that care are gate-unit's child `bun test` runs, and the test sets
    `CLAUDECODE=1` and `AGENT=1` for those itself.
  - The worker pass keeps its env, which is right: under `CLAUDECODE=1 --parallel=2`, Bun still printed
    `✗ b.test.ts (worker crashed: exit code 0)`.
- **Planted in the real one-process passes,** through the real `unitStaticSteps(...)` and `runStaticStep`, from a shell with
  `CLAUDECODE=1 AGENT=1`:

  | Pass | Plant | Gate output |
  |---|---|---|
  | runner unit tests | `process.exit(0)` in a test of `scripts/lib/split.test.ts` (mid-run) | no report, `exited 0`, names split.test.ts ✔ |
  | runner unit tests | `process.abort()` in `afterAll` of split.test.ts (after its last test) | `exited 134`, names split.test.ts ✔ |
  | runner unit tests | `process.exit(0)` at load (top level) of `scripts/lib/common.test.ts` (between files) | names common.test.ts ✔ (the name is printed before load) |
  | runner unit tests | `throw` at load of split.test.ts | report written; `errorsOutsideTests` names split.test.ts ✔ |
  | runner unit tests | timer from split.test.ts `afterAll` fires 2 files later | names unit-steps.test.ts ✘ (N1) |
  | unit tests (alone), `--isolate` | `process.exit(0)` in a test of `virtual_socket.test.ts` (2nd of 4) | names it ✔ |
  | unit tests (alone) | `process.abort()` at load of `src/miri/contract.test.ts` (4th) | `exited 134`, names it ✔ |
  | unit tests (alone) | `throw` at load of `inputs.oracle.test.ts` (3rd) | report written; named as an error outside any test ✔; the other 3 files passed with the variables unset |

  Every plant gave `pass=false`. Before the last test of a file, after it, and at load of the next file, the name is right. Only async
  work that outlives its file can misname (N1).
- **Leaving `(pass)` lines out of the tail: nothing that matters is hidden (read and measured).** The tail is only printed for a failed
  step, and `errorsOutsideTests` and `crashedIn` read the full output, not the tail. Lines that are kept: `(fail)`, error text, `(skip)`
  and `(todo)`, and Bun's closing failure summary. A file-name line is dropped only when the next kept line is another file name or the
  closing ` N pass`. A crashing file's name is the last line, so it is always kept, as the alone-pass plants show. The only thing it
  could hide is a test's own output line that starts with `(pass) `, which is negligible.

## 3. The random run-directory tag (read; not run on Linux)

`pidNamespace` (`miri-sysroot-run.ts:129`) returns `undefined` only on Linux with an empty or unreadable `/proc/self/ns/pid`.
`runDirOf` then gives `<kept>.run-r<12 hex>-<pid>`. `staleRunDirs` matches only `<side>.run-<ns>-<digits>`, where `<ns>` is 12 hex
digits, so it can never match `r…`. The cleanup at `:159` is skipped completely. Removing nothing is right. Without a known namespace, a
directory whose pid is gone may belong to a live run in another container whose pids repeat ours. Deleting it would lose that run, while
the cost of keeping it is a leak, the same trade-off root-w42-check N6 settled. The own-pid `rmSync(out)` is not needed either, since the
random tag cannot be a leftover. As before, the run still removes or keeps its own `out` at the end and replaces the shared `kept`. Not
checked: an actual Linux container with a restricted `/proc`. The test uses fake readers.

## 4. `.rlib` files beside the tests

- **Same oracle output (measured).** I copied both case directories to scratch and ran the oracle on each of the 20 cases twice, once
  without `--out-dir` and once with `--out-dir <tmp>`, using the test's `ARGS`, env filter and cwd. Stderr and exit code were
  byte-identical for 20 of 20. Without `--out-dir`, the copies got `libabi_cdecl.rlib`, `libabi_direct.rlib` and `librefine_rpitit.rlib`;
  with it, those went to the out dir only.
- **They compare the same things (read).** The cwd and the relative `${c}.rs` are unchanged, and the comparison is still stderr plus exit
  code against the subject. The subject's command line does not change.
- **Removed (measured).** Run with `TMPDIR` pointed at an empty scratch dir, both files gave 59 pass, 0 fail. The dir was empty afterward
  (`afterAll` removes each `mkdtemp`), and `git status --short --ignored` showed nothing new.
- Small note: the new test runs before the subject's tests, so it checks only the oracle's writes. The status check above covers the
  subject too: nothing was written.

## 5. `rlib-native`

- **Report only (read).** There is no `harness/baseline/rlib-native.txt`, and `protectedSuites()` is the baseline listing. `milestone:
  "M7"` selects nothing: `criteria.ts` uses its own `GROUPS`.
- **The libraries are reproducible (measured) and built without the port (read).** Running `bun harness/corpus/gen-rlib-native.ts` in my
  scratch worktree, at a different absolute path from the lane's, left `git status` clean, so every byte is identical. The script runs
  only `clang`, `ar` (`ZERO_AR_DATE=1`), `lipo` and the oracle toolchain's `llvm-ar`, with no import from `src/`.
- **Independent reproduction, all 58 cases (measured).** I ran both sides of every case directly, not through difftest and with no
  oracle cache, in my own scratch `<...>/rlib-native/<16 hex>` dirs: 58 MATCH, 0 DIFF. The output has real content: for example, the
  universal-library case lists the rlib's `__.SYMDEF`, `lib.rmeta`, `lib.rmeta-link`, `foo.o` and `bar.o` with sha256s, and
  `tmp: .tmpXXXXXXlibfat.a: 1504 bytes`. `bun scripts/difftest.ts --suite rlib-native` also gave 58/58
  (`20261109-080405-w46-review-hyiy`).
- **Planted member difference (measured).** This plant differs from the lane's byte flip: it swaps the order of the `foo.o` and `bar.o`
  entries in the subject's `ArArchiveBuilder::build_inner`, so every member's bytes, the member count and the total size stay the same.
  Result: 33 DIFF, 25 MATCH (`20261109-080334-w46-review-13p0`). Each diff shows the member lines in swapped order, which names the
  member. Reverted, and the tree was clean.
- **Two difftests at once (measured).** Two `--suite rlib-native` runs started together from different `RUST_TS_AGENT` values both gave
  58/58, and the log shows one waiting on `<case dir>.case.lock`. `withSuiteCaseLock` holds the lock around both sides and around the
  solo retry of a timed-out subject (`difftest.ts` ~1090 and ~1129). Both use the same `$RUST_TS_DATA`, so two worktrees serialize too.
  The SIGKILL case is N3.
- `rlibNativeDirRefusal` guards both `rmSync` calls. `.gitignore`: see N4.

## 6. Oracle keys, unit tests, trial merge

- **Keys unchanged (measured independently).** I wrote my own script: for each of the 60 suites in `harness/baseline`, `oracleKey()`, a
  sha256 of the case list (`id`, `file`, `args`, `env`, `cwd` with the repo path masked), and a sha256 of every case's
  `caseOracleCacheKey`. I ran it on `74f215e6` and on `90045ea7`, both checked out at the same worktree path. The two dumps are
  identical: 60 suites, 370,160 cases, 19 with an `oracleKey`. `git diff main -- harness/baseline` is empty.
- **`bun test ./scripts ./harness`:** 424 pass, 0 fail on the branch, with and without the quiet variables; main had 417. Unit time
  added: about 0.3 s. `harness/rlib-native.test.ts` takes 0.15-0.27 s, `miri-sysroot.test.ts` +0.1 s, and `gate-unit.test.ts` stays at
  ~4.9 s. The whole pass's wall time was within noise: 58-60 s, against 63 s on main under load 7-9.
- **Trial merge with `t3/fix-module-cycles-tests-markers` (`be37c102`, fixers-49): clean.** No file is touched by both branches, and
  `git merge --no-ff` made no conflict. On the merged tree: `bunx tsc --noEmit -p .` was clean, `coverage.ts --check --offline` printed
  `markers ok`, `bun test ./scripts ./harness` (quiet variables unset) gave 424 pass, 0 fail, and `rlib-native` gave 58/58. fixers-49's
  tempfile/memmap2 work adds only vendor entries and markers, and the suite's temp-file case still matches.

## Not checked

- Linux, including item 3 in a real restricted-`/proc` container and `rlib-native`'s ELF cases on a Linux host (they ran here with
  `--target`), and Windows (N2).
- A full `bun test ./src ./tools` worker pass with the branch: I ran only the alone files, with plants, and the two item-4 files. No
  gate.
- Bun versions other than 1.4.3 (the code says so when no file name is printed), and other quiet variables beyond the ones listed in §2.
- Whether `gen-rlib-native.ts` reproduces with other clang or ar versions (the header says it may not).
- The lane's "Without the fix" mutation claims: I did not repeat them. I planted my own failures instead.
