**Verdict: APPROVE WITH NITS.** No finding blocks the merge. The two-pass step fails on every failure, crash, load error and `.only` I planted. It reproduces the lane's figures (447 s and 448 s, 0 failures). Real compiles keep their module order and output. It merges cleanly into `integ-w43`, and passes there too.

# Review: lane `unit-parallel` (independent)

Batch: `t3/parallel-unit-tests` at `d3c84620` (`35de7226`, `b0ad7466`, `11150a71`, handoff), against `main` at `5c884ab9`.
Reviewer worktrees were detached checkouts of `d3c84620`, of `5c884ab9`, and a trial merge into `integ-w43` (`2409d0b4`). Each had
`.env.local` from `integ-w39` plus `RUST_TS_REQUIRE_PROBES=1`. `RUSTUP_AUTO_INSTALL=0` was set everywhere, and I never set `RUSTUP_HOME`.
Host: AC power, 12 cores, otherwise quiet (load 1.4-3 before each run). No gate was run.

## 1. The cycle fixes

| Check | Result | How |
|---|---|---|
| Module order of a real `bun src/rust_ts/main.ts --edition 2021 --crate-type lib --sysroot <oracle> --emit=metadata hello.rs` (main.ts, then the driver's dynamic import) | **identical**, 2,092 lines on both sides | reproduced: a `BUN_OPTIONS=--preload` Bun plugin prepends a log call to every repo module, so it logs each module body as it starts (post-order evaluation) |
| Module order of `bun src/miri/bin/miri.ts --version` (stack.ts, then miri.ts) | **identical**, 2,274 lines | reproduced, same preload |
| Where the two touched modules evaluate | `rustc_target/lib.ts` #361 before `back/apple.ts` #1422; `rustc_hir/def.ts` #489 before `outlives_for_liveness.ts` #999. Their imports are no-ops there, as the handoff says | reproduced |
| `.rmeta` of that compile | **byte-identical** (md5 `f0625c43…`, from the same cwd; it embeds the cwd, so a run from each worktree differs at byte 25 on both sides) | reproduced |
| `difftest --suite mir-o2 --sample 150` | 149 MATCH, 1 DIFF: `simd/intrinsic/inlining-issue67557-ice.rs`. It is not protected, and it DIFFs on `main` too (JS stack vs Rust backtrace) | reproduced |
| `difftest --suite rmeta-ui --sample 60` | 60/60 MATCH | reproduced |
| `bunx tsc --noEmit -p .` | clean | reproduced |
| coverage of the two files | unchanged: only imports changed, no fn and no marker moved | read |

**The hazards the handoff leaves.** I imported each of the 9 `def.gen.ts` and 21-22 `spec/mod.ts` value importers as the first module of a
fresh `bun -e` process. Several fail: `fn_queries.ts` and `ty/inhabitedness/mod.ts` (`MacroKinds`), `coroutine/mod.ts` and
`remove_noop_landing_pads.ts` (`Os`). So the hazard is real and live. It is the same on `main`, so the lane did not cause it. Is it a hazard the
new step catches? Yes. Under `--parallel` every worker file is isolated (`--isolate`), so a test whose first import enters one of these
cycles throws at load. Bun then exits 1 (shown in section 2), so the step fails. The old serial step would have hidden it behind whichever file
loaded the cycle first. One correction to the handoff: it fails loudly, but it is **not named** in the report (N3). It also misses a third cycle (N2).

## 2. The two-pass step

**Every failure mode I planted fails the step.** These are fixture trees run through the gate's own `unitStaticSteps` and `runStaticStep`
(reproduced; `bun test` 1.4.3):

| Planted | Among the workers | In the alone pass |
|---|---|---|
| a failing `expect` | FAIL, named `failed: src/x.test.ts: fails` | FAIL, named |
| `process.exit(0)` inside a test | FAIL: Bun reports `(worker crashed: exit code 0)` as a junit `<failure>`, named `(worker crashed)`; the worker's other files were re-dispatched, and none was lost | FAIL: Bun exits 0 and writes no report, so the gate prints `ERROR: … wrote no junit report` (but `ok` first: N3) |
| `throw` at module top level, a bad import, a throwing `describe` | FAIL (exit 1, `1 error`). **The file is absent from the junit report**, so nothing is named (N3) | FAIL, same |
| top-level `process.exit(0)`, `SIGKILL` from inside a test, `setTimeout(() => process.exit(0))` | FAIL, a `(worker crashed)` failure | (serial: no report, FAIL) |
| `process.abort()` | FAIL. Bun aborts the whole run ("sibling worker panicked"); 3 files are missing from junit, but exit 1 | — |
| an unhandled async throw | FAIL, a junit `<failure>` | — |
| `.only` under `CI=true` | FAIL by exit code; junit has 0 failures (the lane's fixture test, which passed in my run) | as before the lane |
| a test over `--timeout` | FAIL (the lane's fixture uses `parallel: 3`, so it is the workers' timeout) | the same flag |

In no case did a crash or load failure leave exit 0 together with a complete-looking report. The junit report alone is not a complete list
of what ran, though: files that fail to load, and files a `SIGABRT` aborted, are missing from it. The exit code is the real check, and
`runStaticStep` keeps it.

**Hung worker at the 1,800 s limit.** `run()` sends SIGTERM to the `bun test` coordinator. I reproduced this with a spinning test and
`proc.kill()`: the coordinator exits 143, **no `--test-worker` process survives**, and no report is written, so the step fails.

**`ALLOWED_SKIPS` across both reports.** Each report goes through `runStaticStep` → `junitTests` → `classifySkips`, and `staticChecks`
sums them into one `SkipReport` (read). Each allowlist entry is used at most once *per report*. That is harmless: the reports cover disjoint files.
In r1 the four alone files appear only in the alone report, and none of them in the workers' report.

**The 60 s per-test timeout.** `--timeout=60000` is on both commands. The worker command line Bun spawns carries it (seen in `pgrep`:
`bun test --test-worker --isolate --timeout=60000 --reporter=junit …`).

**The four-file list** is static (N4).

**Environment.** Gate step env = `mergeEnv(process.env, step.env)`. The gate's `process.env` already holds `.env.local`
(scripts/lib/common.ts:44-47), so before this lane the children inherited `RUST_TS_DATA` and `RUST_TS_HOST_TUPLE` anyway. Root's trial
missed them only because it ran `bun test` from a shell.

| Variable | Before (`5c884ab9`) | Now |
|---|---|---|
| `RUST_TS_REQUIRE_PROBES` | `1` (step env) | `1` (step env) |
| `CI` | `true` (step env) | `true` (step env) |
| `RUST_TS_DATA` | inherited, from `.env.local` through common.ts | step env, `DATA` (resolved; same value) |
| `RUST_TS_HOST_TUPLE` | inherited, from `.env.local` | step env, if the gate has one |
| `NODE_ENV` | `test`, set by Bun | `test` in every `--parallel` worker (reproduced). integ-w43's frozen lists read it (`list.ts` `FREEZE_LISTS`) |
| everything else | inherited | inherited |

The lane's fixture test checks the first four inside workers, after deleting the parent's copies.

## 3. Shared state between parallel files

Read: every `join(DATA, "tmp", …)` under src/ and tools/ (94 sites), `test_scratch_dir` (mkdtemp, per process), `fresh_dir`,
probe use, `process.chdir`, sockets and servers.
- Only one fixed directory is shared by two files: `$DATA/tmp/interp-validity-intern/agent-<hash>`, used by `interpret/intern.test.ts` and
  `validity.test.ts`. They write different files (`intern.rs`, `validity.rs`) after a recursive `mkdirSync`, so there is no race.
- `partitioning_oracle/common.ts` `WORK` is used by `partitioning.oracle.test.ts` and `wire.test.ts`. The `fresh_dir` names are distinct, and
  `wire.test.ts` builds no aux crate and reads none.
- Every other fixed path (`metadata-temp-dir`, `long-type-oracle`, `apfloat-oracle-input.txt`, `serialize-fixture`, `target-config`,
  `$DATA/cache/objread`, `$DATA/probes/target-config`) has a single test file writing it.
- Tests only read probes (`probePath`/`probeBinary`). No unit test binds a port. `process.chdir` is per process and restored in `finally`.
- Pre-existing, not new: per-agent paths (`…/<RUST_TS_AGENT ?? "default">`) are shared between a gate and any concurrent `bun test` with no
  `RUST_TS_AGENT`. `--parallel` does not change that.

**Two full runs** (reproduced). Each runs the step as the gate builds it: a script imports `scripts/gate.ts` and runs `unitStaticSteps(UNIT_STEPS[0])` then
`runStaticStep` for each, with `RUST_TS_*`, `CI` and `RUST_TS_AGENT` unset in the shell. Load is the 1-minute average every 10 s; RSS is the sum over `bun` processes.

| Run | Tree | Workers | Alone | **Step** | Tests | Fail | Skip | Slowest (s) | Load | Peak RSS |
|---|---|---|---|---|---|---|---|---|---|---|
| r1 | lane `d3c84620` | 352.3 s | 95.1 s | **447 s** | 7,388 (7,349 + 39) | 0 | 1 (allowlisted) | 19.1 `ast_passes` ui, 18.8 `miri/contract`, 15.3 `inputs.oracle`; worst among workers below 10.7 | 2.9-11.9 | 5.8 GB, 11 procs |
| r2 | merge into `integ-w43` | 352.8 s | 95.2 s | **448 s** | 7,407 (7,368 + 39) | 0 | 1 (allowlisted) | 19.0, 19.0, 15.3 | 1.5-18.5 | 5.5 GB, 12 procs |

- Test sets: r1 matches the lane's figures exactly. r2's differences are integ-w43's own test changes (`rlib_macho.oracle.test.ts` renamed to `rlib_macho.test.ts`,
  `info_sites_check.test.ts` and `rlib_native.oracle.test.ts` new, and others).
- Files on disk vs. in the reports: 625 vs 622 (r1). The three missing files have no tests: `rustc_passes/abi_test.ts` and `layout_test.ts`, ported modules that
  match Bun's `*_test.*` pattern, and `graph/tests.test.ts`. The serial report listed them as empty suites; `--parallel` leaves them out. Harmless.
- `git status --porcelain`: unchanged both times. With `--ignored`, three gitignored files appear beside tests (N5).
- `$DATA/tmp`: 591 entries before and after.

## 4. The lane's figures

Reproduced: 447 s and 448 s against the lane's 441-450 s, 0 failures, slowest test 19.0-19.1 s (lane: 19.5-20.2 s). Load is in the table above.
I did not reproduce the burner runs (load 30-90).

## 5. Junit failure names

Reproduced in both passes (section 2 table): a failing test and a worker crash are named, `failed: <file>: <path>`. A load error and an
alone-pass `exit(0)` are not (N3).

## 6. Oracle keys

Reproduced. For all **60** protected suites (`harness/baseline/*.txt`) on `main` and on the lane: the same `oracleKey()` (19 suites define one)
and the same case list (a hash of `JSON.stringify(cases)` with the worktree path masked), **370,160 cases**. This holds by construction anyway:
the batch touches no `harness/` file, and no oracle key hashes `scripts/gate.ts` or `scripts/lib/unit-steps.ts`.
`bun test ./scripts ./harness --timeout=60000`: 397 pass, 0 fail.

## 7. Merge with `harness-w44` (`integ-w43`, `2409d0b4`)

Reproduced:
- `git merge --no-ff d3c84620` into a detached `2409d0b4`: **clean**, with no conflict in `scripts/gate.ts`. harness-w44's two new static steps
  (`info sites`, `frozen lists`) use the `StaticStep` shape and run through `runStaticStep`.
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./scripts ./harness --timeout=60000`: 414 pass, 0 fail.
- The full unit step on the merge: r2 above, passing.

harness-w44's "a failed static step stops the run" (F7) also caps what N2 can cost: a new load-order failure stops the gate at the
static steps, not hours later.

## Findings

**N1 (nit): the alone pass does not isolate its files.** `scripts/lib/unit-steps.ts:69` (`aloneStepArgs`) runs the four files in one plain `bun test`.
- Scenario: a change makes `virtual_socket.test.ts`, `inputs.oracle.test.ts` or `contract.test.ts` enter a cycle from the unsafe side. The
  file that ran before it in that process has already loaded the cycle, so nothing fails. Handoff lines 63-64 ("the step runs every file
  isolated") overstate it for these three files.
- Reproduced: two files in one plain `bun test` share `globalThis` (same pid, same value); with `--isolate` each gets fresh globals. All four files load
  first today: each, alone with `-t <no match>`, loads without error.
- Fix: add `--isolate` to `aloneStepArgs`. It keeps the serial crash handling: an `exit(0)` still leaves no report, which the gate catches. (`--parallel=1` behaves the same.)

**N2 (nit, doc): a third live cycle the handoff does not list.** `Cannot access 'Printer' before initialization` (`rustc_middle/ty/print/pretty.ts:388`)
when `rustc_codegen_ssa/back/symbol_export.ts` or `rustc_monomorphize/partitioning.ts` is the first import.
- Scenario: a new unit test that imports either first fails at load under the new step.
- Reproduced on the lane and on `main`.
- The new step fails loudly here, which is the point. But root should record the three cycles (`Os`, `MacroKinds`, `Printer`) and their unsafe
  entry modules in `docs/next.md`, so the next lane that trips one knows the fix pattern.

**N3 (nit): some failures are not named, and one prints `ok` first.** `scripts/gate.ts:326` and `:342`.
- (a) A test file that throws at load is absent from the junit report, so a failed step lists no `failed:` line. Only the 15-line tail
  shows it, and under `--parallel` that tail is not guaranteed to hold it once other files print.
- (b) `process.exit(0)` in the alone pass makes Bun exit 0, so the gate prints `ok    unit tests (alone)` and then
  `ERROR: unit tests (alone) wrote no junit report`. The step fails, but the first line says ok.
- Both reproduced.
- Suggestion: when the exit code is non-zero and the report holds no failed test, print one `ERROR:` line saying so (a load error, `.only`,
  or a crash; see the output above). Print `ok` only after the report checks pass.

**N4 (nit): the alone list is static.** `scripts/lib/unit-steps.ts:44`.
- Scenario: a new heavy oracle file (several processes at once, or a 30 s+ test) lands among the workers with no signal. It flakes at 60 s
  only under load, which is when a gate is expensive.
- `unit-steps.test.ts` checks only that the four listed files exist.
- Read only.
- Suggestion: have `runStaticStep` print the slowest test of each report, and a `note:` above, say, 30 s among the workers. A drift then
  shows in every gate log before it flakes.

**N5 (nit, handoff accuracy): three files are written beside tests.**
- Each run leaves three gitignored files beside tests: `check/check_oracle/cases/libabi_cdecl.rlib`, `libabi_direct.rlib`, and
  `check/compare_impl_item_oracle/cases/librefine_rpitit.rlib`. The oracle rustc writes them (`Bun.spawn(..., { cwd: CASES_DIR })`) in
  `check.oracle.test.ts` and `compare_impl_item.oracle.test.ts`.
- The handoff's "tree unchanged" used `git status --porcelain` without `--ignored`.
- Each file has a single writer, so there is no race under `--parallel`. It is pre-existing and unrelated to this lane.
- Reproduced (r1, r2).

## Not checked

- Runs under heavy load (the lane's 12-burner and load-90 runs), and memory under load. I measured peak RSS only on quiet runs.
- Flake rate beyond two full runs.
- Windows.
- The `runner unit tests` step: unchanged, and run here only as `bun test ./scripts ./harness`.
- A full gate on the merge.
- Whether Bun's `--path-ignore-patterns` is ever a prefix or glob match on other paths. I checked only that the four files are excluded from the workers and that nothing else went missing (622 of 625 files, the three with no tests).
