APPROVE WITH NITS

# Review: harness-w38 (`t3/preserve-unported-reasons-probes` at c3a2d5d7)

Independent reviewer, read-only on the lane. Compared with the merge base c9d3c553.

**Summary.** The batch cannot change a case's status, a suite's case list or a protected result in any state where the
gate can pass. All claims I tested reproduce, including the port matching the oracle on `miriepoll`. There are four
low-severity findings, none blocking. Nothing needs fixing before merge, and L1 and L2 are worth queueing.

File:line references are to c3a2d5d7.

## Findings

| id | severity | where | finding |
|---|---|---|---|
| L1 | LOW | `scripts/probes.ts:74`, `:290` | `probes.ts fixture` undoes the Miri environment scrub |
| L2 | LOW | `scripts/probes.ts:165`, `:102` | `build miriepoll` stack-traces; `path miriepoll` advises a build that cannot work |
| L3 | LOW | `tools/probes/fixtures.test.ts:32`, `:79` | a changed `miripaths/main.rs` goes unnoticed until someone rebuilds |
| L4 | LOW (not reproduced) | `harness/compiletest.test.ts:65`, `:164` | the shared-tmp check can fail on another process's scratch dir |

**L1. `probes.ts fixture` undoes the Miri environment scrub.**
- `probeFixtureCmd` returns an already merged environment, with `MIRI_*` and the scrubbed variables deleted. `run()` then
  does `mergeEnv(process.env, env)`, an overlay on `process.env`, so every deleted variable comes back.
- `Bun.spawnSync` in the fixture test takes the environment as given, so the test is correct and the two paths differ.
- Measured with `MIRI_BE_RUSTC=host MIRI_LOG=debug RUSTC_LOG=debug`: the child of `run()` has all three, the test's child
  has none. `RUSTUP_HOME` is the isolated home in both.
- Failing scenario: `MIRI_BE_RUSTC=host bun scripts/probes.ts fixture miriepoll`. Miri acts as a plain rustc and dies at
  the link, leaving `main.*.rcgu.o` in the repo root. The fixture is not rewritten.
- Isolation holds and a wrong fixture would be caught: the test passes with the same variable set, because it scrubs.
- Fix: have `probeFixtureCmd` return the overlay (`caseEnv(MIRI_CASE_ENV)`) and merge it only for `Bun.spawnSync`.

**L2. The probe CLI on a Miri probe.**
- `bun scripts/probes.ts build miriepoll` ends in an uncaught ENOENT on `Cargo.toml.in`, with a stack trace and no `ERROR:`
  line (AGENTS.md §4).
- `path miriepoll` prints `run: bun scripts/probes.ts build miriepoll`, which is the command above.
- An unknown name already behaved this way, but `miriepoll` is a registered fixture name, so it is more likely to be tried.
- The fixture test's title gives the right advice (`bun scripts/miri.ts setup`).

**L3. A stale `miripaths` binary.**
- The test runs the built binary and the gate only checks that it exists.
- Mutation: I removed the first input from `tools/probes/miripaths/main.rs` without rebuilding. The test still passes.
- Every cargo probe has this property, so it is not a regression. `miriepoll` does not, because it runs from source (item 4).

**L4. A shared-tmp race, older than this batch and widened by it (not reproduced).**
- The test fails if `$RUST_TS_DATA/tmp` holds any `needs-layouts-*` directory, and worktrees share that directory.
- Scenario: a lane's difftest evaluates `needs` while the gate's runner step reads the directory. The static step then
  fails with no fault in the tree.
- The check now does two rounds of compiles when the sysroot is built, so the window is about twice as long.
- Fix: have the check report its own directory and test that one.

**Outside this batch: `scripts/lib/common.test.ts:23`.** `userMs > 100` failed on head 3 of 3 and on base 2 of 3 at load
100-200 (for example 87.7 and 50.5). The test file and `scripts/lib/common.ts` are unchanged here. It was the only failure
in my runner step, and at that load it would fail the gate's static step. Root may want to queue it.

## 1. No status, case list or protected result can change

Own dump (`SUITES`, every suite's `cases()`, `skipped()`, `oracleKey`, metadata, and `oracle`/`subject` of its first case;
tree path normalized):

| tree | suites | cases | differences from base |
|---|---|---|---|
| base c9d3c553 | 53 | 362,928 | |
| head c3a2d5d7 | 53 | 362,928 | 0 |

- The comparison covers each case's full content by hash, the case ids, and the skipped ids with their reasons.
- The handoff's five `cwd` differences are the repo path, which my normalization removes, so 0 is consistent with it.
- **`difftest.ts`:** the diff only adds to the summary. `head.unported` is set as before, `SplitRunResult.unported` is
  written to no row, and nothing parses `<suite>.summary.json` (only `gate.ts:393` names it, in a message).
- **Same case on both trees:** `tests/ui/cfg/crt-static-off-works.rs` gives the same UNPORTED row. Only head has the bucket:
  `{"rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)":1}`.
- **Other files:** `git diff` shows no change under `harness/baseline`, `harness/suites.ts` or `src/`.

## 2. `harness/compiletest.ts` and `needs-deterministic-layouts`

**Necessary and correct.** Both layout nits live only in this file. The review asked for the Miri sysroot, and the oracle's
std must stay because the proc-macro suites run on it. `needs` are memoized per target, so one answer must cover both.
Going outside the assigned paths was justified.

I evaluated the head tree in each sysroot state, using a symlink copy of `$RUST_TS_DATA` so the shared data stayed untouched:

| Miri sysroot | check | need | `type-sizes.rs` | `miriOracleProblem` |
|---|---|---|---|---|
| built | oracle 0/64 (control 29/64), Miri 0/64 (control 29/64): false | true | case | none |
| absent | oracle 0/64 only: false | true | case | no libcore |
| lib dir empty | undecided (E0463) | undefined | skipped with reason | no libcore |
| no libstd | undecided (E0463) | undefined | skipped with reason | no libstd |
| truncated libcore | undecided (metadata error) | undefined | skipped with reason | **none** |

- **Which case sets depend on it:** full dumps in the built, absent and empty states show exactly one difference. In the
  empty state `run-pass-miri` goes 3470 to 3469, losing `tests/ui/structs-enums/type-sizes.rs`, which is protected (line
  2918). The other 52 suites do not change.
- **The other four files with the directive:** `print_type_sizes/async.rs`, `future-sizes/large-arg.rs`,
  `future-sizes/async-awaiting-fut.rs` and `stats/input-stats.rs` are in many protected suites, but those suites do not
  evaluate `needs`. No case set changes with them, so the handoff's proc-macro dependency exists only in principle today.
- **Loud at the gate, in three independent ways:**
  1. `compiletest.test.ts` fails when the check is undecided (run with `.env.local` on the empty and truncated states,
     `Expected: false, Received: undefined`). So does `scripts/miri.test.ts` (run on the truncated state).
  2. `gate.ts:356` counts the skipped case as lost, and `:444` refuses to accept. `lostSkipped` is informational.
  3. A missing or partial sysroot stops every Miri suite at `difftest.ts:916`.
- **Absent sysroot:** no Miri case can run, so the oracle-only answer cannot give a wrong result.
- **Quiet in one place:** a lane's sample run. `difftest --filter type-sizes` on the truncated state prints `total=0 ...
  skipped=1`, with the reason only in `<suite>.skipped.jsonl`. This cannot affect the gate.
- **Change from base:** a failed check used to throw when the suite's cases were generated. Now a transient failure in the
  gate's own process (a killed rustc, say) fails the gate at the end of the run, naming the case. The result is the same,
  but later.
- **Wording:** in this state `gate.ts:380` says "not applicable on this host" before the reason. This is existing text, and
  the reason that follows is accurate.

## 3. The probe pre-check and `miripaths`

- **The required list:** `oracleTestProbes` over `UNIT_STEPS` on base and head differs by `+miripaths` only. Nothing was
  dropped.
- **Spurious failure:** only if the binary is missing, and then `gate.ts:334` stops immediately with one `ERROR:` line and
  the build command. The binary is in the shared target today.
- **A fresh build works:** `miripaths` built in an empty target reproduces its fixture byte for byte.
- **Checks removed:** `expect(built)` became `expect(missing).toBeUndefined()`, which is equivalent. Host detection moved
  from `rustc -vV` to `RUST_TS_HOST_TUPLE`, still guarded: `print.oracle.test.ts`'s host test fails with a wrong tuple
  (run) and passes with the right one, and a host skip is rejected (item 5).
- **`miriepoll`:** the pre-check does not see it. Without a Miri oracle under `RUST_TS_REQUIRE_PROBES=1` its test fails,
  titled `(required, missing: ...)`, so this is late but loud.

## 4. `miri: true` and `miriepoll`

- **Isolated:** `cmd[0]` is `<DATA>/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri` and
  `RUSTUP_HOME`/`CARGO_HOME` are the isolated homes, in both the test and the `fixture` path. Nothing goes through a rustup
  proxy or changes the oracle toolchain. `miriOracleProblem` also pins the commit, components and driver hash.
- **Scrubbed:** in the test path yes, in the `fixture` path no (L1).
- **Reproducible:** `bun scripts/probes.ts fixture` with no names reports all six `unchanged`, and the tree stays clean.
  Three runs from another cwd and a run with `-Zmiri-seed=7` all give the fixture's bytes (sha256 `03a9eda7f3e42a7e`).
- **Stale fixture noticed:** changing `main.rs` or the fixture each fails the test. Changing a row of the `os_str.test.ts`
  table fails the table check.
- **`miripaths` source:** its two fns equal upstream `os_str.rs:274-328` once indentation is stripped, comments included.
- **The port:** `src/miri/bin/miri.ts` on the program gives the same sha256 with empty stderr (16.5 min wall at this load,
  78 s user CPU).
- **Not continuous:** no port test reads `epoll.oracle.txt` yet (0 references in `shims_e.test.ts`), and
  `src/miri/shims/os_str.test.ts:6` still names the gitignored script. The handoff lists both for the file owners.

## 5. Skipping mirimath

The gate cannot skip it silently. I ran `fixtures.test.ts` with `RUST_TS_REQUIRE_PROBES=1 CI=true` and the junit reporter,
then read the report with the real `junitSkips` and `classifySkips`:

| state | skips | not allowed |
|---|---|---|
| normal `.env.local` | 0 | 0 |
| `.env.local` without the tuple | 1 | mirimath |
| no `.env.local`, data from the environment | 1 | mirimath |
| wrong tuple | 1 | mirimath |

`bun test` itself exits 0 in the skip states, so the rejection rests on `gate.ts:300`, as designed. A lane worktree without
`.env.local` gets 8 pass, 1 skip with the reason printed, as the handoff says.

## 6. The seven nits

| nit | verdict | evidence |
|---|---|---|
| ctfe-sample CLI test reads `RUST_TS_DATA` from the environment | fixed | plain `bun test`, both variables unset: 10 pass, 0 skip |
| host decided two ways | fixed | item 5. `probes.ts fixture` still uses `oracleHost()`, the real host, which is right for a guard on rewriting |
| ctfe-sample `--file` on a missing file | fixed | one `ERROR:` line, exit 1 |
| layout check throws if its own compiles fail | fixed | undecided, no throw, in the three broken states; the tmp dir is removed |
| checks the standard toolchain's std only | fixed | both are checked when the sysroot is built |
| `probes.ts fixture` with no names exits 1 on another host | fixed | `fixtureSelection` unit test with a fake host. Such a host without Miri set up still exits 1 at `miriepoll`, a real missing prerequisite |
| a missing probe's title says skipped when it fails | fixed | own run: `(required, missing: ...)`, and `(skipped: ...)` without the requirement |

## Verification

- `bunx tsc --noEmit -p .`: exit 0.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness`: 150 pass, 1 fail (`common.test.ts`, above), 151 tests.
  The tree was clean afterwards, and `.no-such-data-dir` is not created.
- `git merge-tree --write-tree main c3a2d5d7`: clean.
- No open STOP.

## Not checked

- The gate and full suites, as instructed, and the full `src` unit step and marker check.
- **`type-sizes.rs` MATCH on head.** The sample gave TIMEOUT after the alone re-run on both base and head at load 100-200,
  so this says nothing either way. Its presence and case hash are checked; its result is not.
- `print.oracle.test.ts` in full with a wrong tuple: stopped at its time limit, so I ran only the host test. With no tuple,
  that file and `math.test.ts` gave 14 pass, 3 skip, 124 fail, which is loud.
- A real sysroot built with `-Zrandomize-layout`: the swap detection rests on the control crate (29/64 on that target and
  sysroot) and the stubbed unit tests.
- Buckets on a real split suite: unit test with stub suites and reading the code only.
- `probes.ts fixture` on an actual other host, and Windows.
- A merge with harness-m6c. Its committed history does not touch `harness/compiletest.ts`; its uncommitted work is unseen.
- L4 was not reproduced.

Shared data: nothing was written except normal sample run directories under `runs/` (`*review-harness-w38*`).
