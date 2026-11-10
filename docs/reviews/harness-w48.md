APPROVE WITH NITS

# Review: harness batch harness-w48 (wave 40h)

Reviewer: independent, read-only. Branch `t3/harness-w48-runner-fixes`, commit `3789f879`, against merge-base `bbde79e5`
(12 files, +437 −18). Handoff: `docs/handoff/harness-w48.md`. Items: root-w47-check N1–N3, harness-w46 review N1–N3.

No must-fix findings. Four nits, none blocking.

## What I checked, with evidence

### 1. The refusal (`UNIT_ENV_REFUSED`, `unitEnvRefusal`)

- **No legitimate gate use needs a refused variable from the gate's environment.** `RUST_TS_IMPL` is set per subject by
  difftest (`scripts/difftest.ts:562`, `:853`), miri-diff (`scripts/miri-diff.ts:166`), phase-diff (`scripts/phase-diff.ts:58`)
  and ctfe-sample (`:101`). The subject build check removes it (`scripts/lib/subject-bin.ts:385`). Frozen lists calls `difftest()`
  with the default `port`. The oracle side is rustc or a probe, and neither reads it. `REGEN`, `RUST_TS_WRITE_ORACLE`, `TY*_WRITE`
  and `TY*_PROBE` are read only by test files and by the test helper `src/rust_ts/typeck_oracle_fixtures.ts:23` (git grep over
  src/scripts/harness/tools outside `*.test.ts`). No suite's subject or oracle command, no wrapper and no subject build reads
  them. The root host's `.env.local` (which `scripts/lib/common.ts:47` loads into `process.env`) holds only `RUST_TS_DATA` and
  `RUST_TS_HOST_TUPLE`. The shell profiles set none of the refused variables, and no doc tells anyone to run the gate with one.
- **Shared code paths:** only `gateRun` calls `unitEnvRefusal` (`scripts/gate.ts:588`). `gate.ts accept` goes to
  `gateAccept`, which does not use it (`scripts/gate.ts:763-775`). Importing `unit-steps.ts` has no side effects.
- **Order:** the check runs right after the suite names resolve. That is before `sampleHost` and the battery check, before
  `HostLog`, provenance, `prepareSubject`, the oracle pin, the probes and the static steps (`scripts/gate.ts:587-595`).
  `die` prints one `ERROR:` line (`scripts/lib/common.ts:64`), and no reason text contains a newline.
  `scripts/gate-static-stop.test.ts` pins this for `RUST_TS_IMPL=shim`, `REGEN=1` and `TYREPR_WRITE=`: exit 1, exactly one
  `ERROR:` line naming the variable, the static checks did not run, and there is no gate.json.

### 2. Do the scan tests keep the list complete?

To test the scans, I added one line to a file in this worktree (detached at `3789f879`), ran `scripts/lib/unit-steps.test.ts`,
then restored the file with `git checkout --`:

| mutation | result |
|---|---|
| `process.env.NEW_KNOB` in a test file | fails ("every variable a test file reads…") |
| `process.env["FOO_UPDATE"]` in a test file | fails (both scans) |
| `process.env.UPDATE_FIXTURES` in the helper `typeck_oracle_fixtures.ts` | fails (fixture-writer scan) |
| `var_os("TYNEW_WRITE")` in the helper | fails (fixture-writer scan) |
| `Bun.env.TYNEW_WRITE` in a test file | **passes** (not seen) |
| `const { TYNEW_WRITE: _w } = process.env` in a test file | **passes** (not seen; the handoff says so) |
| `process.env[NAME]` with `NAME = "TYNEW_WRITE"` | **passes** (not seen) |
| `process.env.RUST_TS_USE_FIXTURE_DIR` in the helper (not a writer-shaped name) | **passes** (not seen) |

No variable in the repo today escapes the scans: `Bun.env` and `import.meta.env` have no reads, and the only destructuring
reads are the two gate tests that strip `NODE_ENV`. Every writer- or probe-shaped name in any `.ts` file is either in the list
or is not an environment variable (`PROT_WRITE`, `SHF_WRITE`, …). See N1 and N2 for the gaps.

The harmless list holds up. I read the questionable entries: `BUN_JSC_useTailCalls` (`src/rust_ts/track_caller.test.ts:40`
asserts the mode it runs in and sets the variable itself in the other tests), `CARGO_CRATE_NAME`
(`src/rustc_session/diagnostics.test.ts:310`) and `RUSTC_FORCE_RUSTC_VERSION` (`src/rustc_span/stable_hash.oracle.test.ts:52`
fails while it is set). None of them can make a failing test pass. Possible false positives are cheap: a new variable read in
a test file needs one line in `UNIT_ENV_HARMLESS`. The writer regex does not flag any current non-writer name, and its own
self-test checks `WRITER` and `REGENERATE_X`.

### 3. The locks in `rlib-native-run.ts` and `host-rlib-run.ts`

- Both run their body under `withCaseLock(<case dir>/work.lock, 2 h, …, () => {}, 50)` (`scripts/host-rlib-run.ts:142`,
  `scripts/rlib-native-run.ts:153`). They register each compiler with `addLockHolder` right after `Bun.spawn`, as
  `scripts/ir-run.ts:97` does. The lock is in the case directory, not in `work` or `tmp`, so the `rmSync(work)` at the start
  of a run never deletes it. It also sits apart from difftest's `<dir>.case.lock`.
- **A SIGKILLed run's orphan compiler:** I reproduced the false output on the base and its absence on the branch with a scratch
  script. Run 1's compiler is an orphan that writes `<dir>/work/out/orphan.rlib` by absolute path once a flag file exists. Run 1
  is SIGKILLed. Run 2's compiler creates the flag, then sleeps 0.5 s.
  - base `host-rlib-run.ts`: run 2 printed `orphan.rlib: 7 bytes, sha256 2b2d2fa0…`. Its report includes another run's file,
    which is a false DIFF.
  - branch: run 2 waited for the orphan, emptied `work`, and printed `out: none`. The case directory then held only
    `subject.out` and `work`, so the lock was released.
  - With a relative path, the orphan's writes fail on both base and branch: its cwd was deleted, which gives ENOENT, not a
    corrupted next run. So on Unix the hazard is writes by absolute path, such as rlib-native's `TMPDIR=<dir>/tmp` or a
    canonicalised out dir. The fix covers both.
  - The branch's own orphan tests (`harness/host-rlib.test.ts`, `harness/rlib-native.test.ts`) pass 12/12. With the base's two
    wrappers checked out over the branch, both orphan tests fail (the base takes no lock).
- **Two concurrent runs of one case** (outside difftest; second started 0.2 s after the first). On the base, run A's compiler
  got `sh: out/a.rlib: No such file or directory`, and its report died with `ENOENT … scandir …/work/out` because B emptied
  `work` under it. On the branch, A printed only `a.rlib` and B printed only `b.rlib`: the runs were serialised. Inside
  difftest, `Suite.caseLock` (`harness/suites.ts:2348`, `:2492`) already serialises them, so the work lock waits only for an
  orphan.
- **A stale lock from a dead pid** (`<dead pid>\n99998\n`, both dead) was taken over at once by both wrappers. host-rlib printed
  `out: none`; rlib-native printed `out: none\ntmp: none` and exited 0. Takeover is `isStaleLock` in `scripts/lib/case-lock.ts`,
  which `ir-run` uses too: owner and holders dead, older than the boot, empty for over 10 s, or older than 2 h.
- **SIGTERM:** a signal that arrives during `child()` is passed to the compiler. `child()` then returns, and `withCaseLock`'s
  `finally` releases the lock. A signal outside `child()` kills the wrapper with no handler, and the dead-owner takeover
  covers that case.
- **Oracle keys:** I ran `bun scripts/oracle-keys.ts` over all registered cases on `bbde79e5` and on `3789f879`. Both dumps
  have 372181 keys, aligned line by line (sha1 `5d076642…` and `6d1b393c…`). The keys that changed are host-rlib's 222 of 222
  and rlib-native's 58 of 58, and nothing else. Neither suite has a file in `harness/baseline/`, so both are report-only.

### 4. `crashedLine` and `outputTail`

- `crashedLine(file, timedOut)` (`scripts/gate.ts:418`) is correct, and `runStaticStep` passes it `r.timedOut`
  (`scripts/gate.ts:486`). `run()` returns that field (`scripts/lib/common.ts:82`). `scripts/gate-unit.test.ts` pins both
  wordings. The crash wording is pinned through a real step; the timed-out wording only by a direct call (N4).
- `outputTail` splits on `/\r?\n/`. `tailCrlf` pins it: CRLF file-name lines are dropped, and `" 3 pass"` still matches.
  `notesFailCrlf` checks that a note in the tail is printed once. I checked by hand that `split("\n")` would leave `\r` on
  each line, so `BUN_FILE_LINE` would not match and the file-name lines would stay.

### 5. Unit steps as the gate runs them, and tsc

I ran these through a scratch driver that imports `unitStaticSteps` and `runStaticStep` from `scripts/gate.ts`, one step at a
time. The parent environment had only `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0` on top of the session's
(`CLAUDECODE=1`, which `oneProcessEnv` strips as in a gate). No refused variable was set. AC power, no `GATE_RUNNING`.

| step | tests | fail | skipped | time |
|---|---|---|---|---|
| runner unit tests | 434 | 0 | 0 | 63 s |
| unit tests (src/tools, 4 workers) | 7396 | 0 | 1 (allowlisted) | 401 s |
| unit tests (alone) | 39 | 0 | 0 | 100 s |

The skip checks passed: 1 allowlisted skip, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`. These match the handoff's counts.

`bunx tsc --noEmit -p .`: clean (exit 0, no output).

### 6. Scope

`git diff --stat bbde79e5 3789f879` lists only the 12 files in the handoff. Nothing changed under `harness/suites.ts`,
`harness/baseline/`, any corpus, case or expectation, `scripts/lib/subject-bin.ts` or `scripts/subject-bin*`. After every run and
mutation, `git status --short` was empty: the tests left no files in the tree.

## Nits

- **N1** `scripts/lib/unit-steps.test.ts:103` (`envReads`), `:153`. The test-file scan sees only `process.env.X`,
  `process.env["X"]` and `var_os("X")`. `Bun.env.X`, destructuring and computed names pass unseen (mutations above). None
  exists in a test file today. The handoff names destructuring only, so the header comment of `UNIT_ENV_REFUSED`
  (`scripts/lib/unit-steps.ts:123`, "checks that every variable a test file reads") claims more than the scan delivers.
  Either widen the regex (`(?:process|Bun)\.env`, and fail on `} = process.env` in a test file outside an allowlist), or
  reword the comment to name the forms the scan sees.
- **N2** `scripts/lib/unit-steps.test.ts:168-169`. Code outside test files is scanned only for writer-shaped names. A
  helper or driver that a test starts can read any other knob unseen, and a gate-environment value would reach it through
  `{ ...process.env }`. Examples today: `RUST_TS_ALIAS_MONO` (`src/rustc_mir_transform/alias_check_oracle/driver.ts:32`,
  set only for the mono cases of `alias_check.test.ts:262`), `RUST_TS_CREADER_MODE`, `LOWER_TYS`, `THIRDUMP_FORMAT`. I
  found none that can make a test pass falsely: tests set them, or a wrong value fails. Also, the writer regex leaves out
  `PROBE`, so a future helper-only `X_PROBE` switch, the class of `TY*_PROBE`, would not be caught. Add `PROBE` to the
  regex's suffixes (today it would match only the three refused ones plus non-env constants such as `PENDING_PROBE`,
  `LAYOUT_PROBES`). Then either list the knobs helper modules read in `UNIT_ENV_HARMLESS` as well, or state this boundary
  in the header comment.
- **N3** `scripts/gate.ts:588`. `freezeEnvRefusal() ?? unitEnvRefusal(process.env)` names only the first family. With both
  `NODE_ENV` and `REGEN` set, the user fixes one, re-runs, and is refused again. Joining the two messages, or listing every
  offending variable, would save a round trip. Cosmetic.
- **N4** `scripts/gate-unit.test.ts` (`crashTimedOut`). The timed-out wording is tested by calling `crashedLine` directly,
  not through `runStaticStep`, so a call site that always passed `false` would go unnoticed. The step's hard 30-minute limit
  (`scripts/gate.ts:461`) is what makes an end-to-end test costly. Making it a `StaticStep` field, for example `timeoutMs`,
  would allow a 1 s test. Low value; only if the file is touched again.
