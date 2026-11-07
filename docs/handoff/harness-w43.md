# Lane `harness-w43`: queued harness findings, and unit-step time

Branch `t3/f6733898`, from `26e61959` (main). This is a batch of changes to `scripts/` and `harness/`, so it needs its own review
(AGENTS.md section 2). I did not run the gate. No file under `src/` changed, so there are no coverage numbers, `unported(...)`
calls or `// PORT:` decisions to report.

**Everything assigned is fixed.** No protected suite's oracle key or case list changed (below). The keys of `ir-hello` and the three
`miri-sysroot-*` suites changed, as their wrappers are hashed into them; none has a baseline.

## What changed

| Finding | Fix | Where | Commit |
|---|---|---|---|
| harness-w42 N1 | `ir-run` names its compiler in `work.lock` (`addLockHolder`). A lock whose owner is dead is not taken over while a holder lives, so a compiler left by a SIGKILLed run cannot write into the next run's `work` | `case-lock.ts`, `ir-run.ts` | `0d394151` |
| harness-w42 N2 | `ir-run` handles SIGTERM/SIGINT for the whole run. While the compiler runs, the signal is passed on, as before. At any other time, `work` and the lock are removed (`releaseHeldLocks`) and the run exits 128 + the signal | `ir-run.ts`, `case-lock.ts` | `0d394151` |
| harness-w42 N4 | A test that a read which ends removes its exit listener, by identity over 20 reads | `host-state.test.ts` | `afcf937d` |
| harness-w42 N6 | The three deadlines, and a fourth of the same kind at `:90`, widened: see below | `host-state.test.ts` | `afcf937d` |
| root-w41-check N3 | **Fixed, not only re-commented.** An IR suite has `Suite.caseLock`, `<out>.case.lock` beside the case's `--out`. difftest holds it around both sides and around a subject's re-run, so a second difftest of the case waits outside every limit. `withCaseLock`'s comment now says its wait does count against a limit on the waiting process itself | `harness/suites.ts`, `difftest.ts`, `case-lock.ts` | `0d394151` |
| root-w41-check N4 | With `RUST_TS_HOST_TUPLE` unset and `RUSTUP_HOME` the isolated Miri home (compared through `realpath`), `host()` dies with one `ERROR:` line. It never runs `rustc` there | `scripts/lib/miri.ts` `hostLookupRefusal` | `f7e50db8` |
| fixers-44 W5 | `coverage.ts --order --require-clean <prefix>`: one `ERROR:` line per order row of a TS file under the prefix, and exit 1. An empty prefix is refused. A new gate static step, `marker order`, runs it on `src/rustc_monomorphize/` | `coverage.ts`, `marker-check.ts` `orderErrors`, `gate.ts` | `2605a928` |
| miri-sysroot F2 | Each run compiles into `<crate>/<side>.run-<pid>`. A run with a `differs` line keeps its directory as `<crate>/<side>`, as before | `miri-sysroot-run.ts` | `859a570a` |
| harness-m7a H3 (M7 group) | M7a groups: `ir-hello` MATCH, `mir-o2` and `mono-ui` ≥ 99%, `check-rg` ≥ 33 of 34 crates. `--milestone <prefix>` selects groups | `criteria.ts` | `5cdf8e95` |

### N6: the deadlines

| Test | Was | Now | Why that is safe |
|---|---|---|---|
| "not started again..." (`:138`) | 5 samples < 2 s, limit 5 s | 5 samples < 15 s, limit 15 s | A held-back reader answers at once. One that is not held back waits out its limit, so a single such sample already fails the bound. The test's timeout is 120 s |
| "a real command that outlives the limit" (`:177`) | pid seen within 2 s; `sleep 20` | 20 s; `sleep 60`, limit 60 s | The loop ends as soon as the pid is written |
| "a process.exit during a read" (`:220`) | reaped within 1.5 s; marker within 10 s; `sleep 20` | 30 s; 30 s; `sleep 120` | Only the kill can end the command inside 30 s. The loop ends once it is gone |
| "ignores SIGTERM" (`:90`, not in the review) | reaped within 1.5 s | 30 s | The command loops for ever, so the same argument holds |

One timing bound is left as it was, `sampled`'s `limit * 2 + 1_600` (`:72`). It already retries with a longer limit when the shell had not started.

### N3: what the lock covers now

- **Two difftests of one IR case:** the second waits on `<out>.case.lock`, outside both limits. Inside, `ir-run`'s own `work.lock` is then uncontended.
- **Left:** a hand-run `ir-run` on a suite's `--out` still contends with a difftest of that case inside a limit. `scripts/ir-diff.ts` uses another `--out`, so it does not.
- **Cost:** one file create and remove per IR case, cached or not.

### N1: what is left

- **The window.** The compiler is named in the lock right after `Bun.spawn` returns. A SIGKILL between those two statements still leaves a lock without its holder.
- **A reused pid.** A holder's pid reused by another live process keeps the lock until `maxHoldMs` (2 h) or a reboot, the same as a reused owner pid already does.
- **Leftover `opt`.** After a signal during the normal form, the `opt` or `llvm-as` child is not killed. It writes only to its stdout pipe, and dies when that closes.

### N4: the refusal

It is in `host()`, so every caller is covered: `miriBinary`, `miriToolchainDir`, `miriOracleProblem` and the shim. Outside the Miri home, `oracleHost()` is called as before. I did not change `oracleHost()` itself. Adding `RUSTUP_AUTO_INSTALL=0` there would also stop the oracle toolchain from auto-installing under the real home; that is root's call.

### M7a in `criteria.ts`

- **Only what a gate can compute today.** M7b–d's suites do not exist yet, so they have no groups. `ir-hello` has a group but is in no gate, as it has no baseline: name it with `gate.ts run --suites`. Until then M7a reads "not met (ir-hello: not in this gate)".
- **The exit code.** It now says "not met" whenever M7a is not met. For M6b alone, use `--milestone M6b` (or `M6`).
- **On `gate-20261106-224720-root-i68w`:** M6b is unchanged, all met. M7a reads `mir-o2` 3474/3479 = 99.86% (met), `mono-ui` 3475/3479 = 99.89% (met), `check-rg` 34 of 34 crates (met), and `ir-hello` not in the gate.
- **The crate count.** `gate.json` has no per-case statuses, so the count is the baseline at the gate's commit (`git show <head>:harness/baseline/check-rg.txt`) less `lost`, plus `gained`. That is exactly `gate.ts`'s MATCH set.
- **What counts as a crate.** The pattern `^ripgrep-[^|]+\|\w+$` gives the 34 crates of the baseline. It leaves out the run's own case and the build script's probe; a test holds both.
- **A changed case list.** More crate cases than the plan's 34 is a problem, not a pass, so another ripgrep needs a new target.

## Oracle keys: `main` (`26e61959`) against this branch

I computed each protected suite's key in a scratch worktree of `main` and in this tree. For all **60 protected suites**, three things matched:
- `oracleKey()`;
- the case list (id, args, env, file) of all **370,160 cases**, with the repo path masked;
- the full oracle cache key (`caseOracleCacheKey`) of every 100th case, **3,742 keys**.

**60 of 60 are identical.**

Of the unprotected suites, only these keys changed, all as expected:

| Suite | `main` | Here |
|---|---|---|
| `ir-hello` | `3fdbf326f5` | `0421e4784d` (`ir-run.ts` is hashed) |
| `miri-sysroot-core`, `-alloc`, `-std` | `10d75f329e` | `9aab28b720` (`miri-sysroot-run.ts` is hashed) |

`check-chain`, `miri-fail` and `miri-pass-tb` are unchanged. No baseline file changed.

## Each fix's test fails without it

Each mutation was run against the named test only, then reverted.

| Mutation | Test, and how it fails |
|---|---|
| N4: `process.off("exit", ...)` removed | "a read that ends removes its exit listener": a listener is left after a read |
| N1: `addLockHolder` not called | "a SIGKILLed run whose compiler lives on...": the next run prints the orphan's IR, not `ir: none` |
| N2: no SIGTERM handler | "a SIGTERM while the normal form is made...": exit and the leftover `work.lock`/`work` differ |
| N3: no case lock in the pool | "difftest takes a suite's caseLock...": the oracle prints `unlocked`, so DIFF |
| N3: no case lock on the re-run | Same test: the re-run subject prints `unlocked`, so DIFF |
| root-w41 N4: refusal removed | "with no RUST_TS_HOST_TUPLE, under the isolated home...": the logging `rustc` runs, `ERROR: cannot run oracle rustc +nightly -vV` |
| F2: back to one shared out dir | "two runs of one crate and side at once...": the first run's output differs from the second's |
| W5 | **A swap planted** in `partitioning.ts`, with `partition` and `place_mono_items` exchanged: one `ERROR:` row, exit 1. **Today's tree:** `order: no inversions under src/rustc_monomorphize/`, exit 0, in about 0.4 s. A unit test covers `orderErrors` |
| H3 group | Unit tests: lost and gained arithmetic, the pattern against the real baseline, the missing-data and too-many-cases problems |

**Safety of the N4 test.** The first form of this test let a mutated run reach the real `rustc` proxy. That proxy went to the real home, nothing was installed, and both homes were checked by mtime afterwards. The test now spawns its child with `PATH` holding only the logging `rustc`, and with `RUSTUP_AUTO_INSTALL=0`. With the fix removed, it reaches only the logging `rustc`.

## Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | Clean |
| `bun test ./scripts ./harness --timeout=60000` | **392 pass, 0 fail**, 56 s at load 12-17. Tree clean afterwards |
| `bun scripts/coverage.ts --order --require-clean src/rustc_monomorphize/` | Exit 0 |
| `bun scripts/criteria.ts --run gate-20261106-224720-root-i68w` | M6b met; M7a as above |

## Unit-step time (item 6)

**Method.**
- **Candidates:** the 40 slowest files of the last gate's junit report (`gate-20261106-224720-root-i68w`, 1,225.6 s over 619 files).
- **Runs:** each file alone with `/usr/bin/time -p bun test ./<file> --timeout=60000`, with `RUST_TS_REQUIRE_PROBES=1 CI=true`, one at a time.
- **Load:** the 1-minute load average at each start is in the table. It began at 2 and rose to 15 as other lanes started.
- **Cut-off:** a file outside the junit top 40 had at most 8.4 s there. Standalone runs came out 1.0-1.5x the junit times, so none of those should reach #25's 13.9 s.

**One caveat for root.** `bun test` loads `.env.test`, not `.env.local`. Run by hand, `src/rustc_log/lib.test.ts` therefore fails under `RUST_TS_REQUIRE_PROBES=1`: "tydump probe missing". The gate is not affected, because it passes `RUST_TS_DATA` on from `common.ts`. Its row below is a re-run with the variable exported: it passes.

| # | File | Wall s | CPU s (user+sys) | CPU/wall | Gate junit s | Tests | Load |
|---|---|---|---|---|---|---|---|
| 1 | `src/rustc_driver_impl/print.oracle.test.ts` | 82.3 | 126.9 | 1.5 | 75.7 | 140 | 2.1 |
| 2 | `src/rustc_monomorphize/collector.oracle.test.ts` | 60.5 | 120.3 | 2.0 | 57.9 | 61 | 3.8 |
| 3 | `src/miri/intrinsics/x86/x86.test.ts` | 57.6 | 112.6 | 2.0 | 52.9 | 25 | 4.2 |
| 4 | `src/rustc_errors/json.oracle.test.ts` | 52.5 | 76.7 | 1.5 | 46.7 | 85 | 6.1 |
| 5 | `src/miri/shims/unix/fd_ops.oracle.test.ts` | 45.7 | 89.6 | 2.0 | 38.3 | 19 | 4.9 |
| 6 | `src/rustc_parse/parser/diagnostics.test.ts` | 43.5 | 66.9 | 1.5 | 34.7 | 150 | 5.8 |
| 7 | `src/rustc_ast_passes/oracle.test.ts` | 34.3 | 309.5 | 9.0 | 24.9 | 2 | 6.5 |
| 8 | `src/rustc_parse/parser/item.test.ts` | 32.7 | 51.6 | 1.6 | 29.3 | 56 | 6.8 |
| 9 | `src/rustc_session/output.oracle.test.ts` | 31.6 | 49.3 | 1.6 | 29.1 | 52 | 6.6 |
| 10 | `src/rustc_driver_impl/driver.oracle.test.ts` | 28.3 | 41.8 | 1.5 | 25.4 | 47 | 7.0 |
| 11 | `src/rustc_driver_impl/inputs.oracle.test.ts` | 25.6 | 41.9 | 1.6 | 22.4 | 6 | 14.6 |
| 12 | `src/miri/shims/unix/virtual_socket.test.ts` | 23.4 | 41.3 | 1.8 | 20.8 | 23 | 12.6 |
| 13 | `src/rustc_monomorphize/partitioning.oracle.test.ts` | 22.5 | 118.3 | 5.3 | 20.6 | 66 | 9.8 |
| 14 | `src/rustc_metadata/locator.oracle.test.ts` | 21.4 | 32.8 | 1.5 | 20.2 | 35 | 9.5 |
| 15 | `src/rustc_lint/late_passes_e1.oracle.test.ts` | 21.1 | 37.5 | 1.8 | 19.5 | 27 | 8.2 |
| 16 | `src/rustc_symbol_mangling/symbol_names.oracle.test.ts` | 20.9 | 35.9 | 1.7 | 19.2 | 28 | 7.0 |
| 17 | `src/miri/contract.test.ts` | 19.7 | 28.0 | 1.4 | 18.5 | 8 | 6.7 |
| 18 | `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` | 19.7 | 31.7 | 1.6 | 18.3 | 43 | 5.3 |
| 19 | `src/rustc_mir_build/check_unsafety.oracle.test.ts` | 19.1 | 30.8 | 1.6 | 17.6 | 24 | 5.6 |
| 20 | `src/rustc_lint/late_e2.oracle.test.ts` | 18.6 | 26.3 | 1.4 | 11.8 | 16 | 11.3 |
| 21 | `src/vendor/unicode_width/oracle.test.ts` | 18.4 | 13.7 | 0.7 | 11.9 | 8 | 4.7 |
| 22 | `src/rustc_metadata/creader.oracle.test.ts` | 14.9 | 21.9 | 1.5 | 13.7 | 28 | 5.7 |
| 23 | `src/rustc_passes/entry.oracle.test.ts` | 14.6 | 26.9 | 1.8 | 13.5 | 22 | 5.7 |
| 24 | `src/rustc_resolve/macros_oracle.test.ts` | 13.9 | 22.2 | 1.6 | 11.8 | 21 | 14.8 |
| 25 | `src/rustc_lint/late_builtin.oracle.test.ts` | 13.9 | 26.5 | 1.9 | 12.8 | 18 | 5.7 |

**The 25 together:** 756 s wall and 1,581 s CPU, alone. In the gate's junit the same files took 668 s of the step's 1,225.6 s. Below #25, `rustc_log/lib.test.ts` took 11.1 s wall and 22.9 s CPU.

### Where the time goes

- **Starting the port, once per test.** 35 files under `src/` spawn `src/rust_ts/main.ts` (or another port entry) per test: 864 tests, 444 s of the gate's step (36%). 674 of those tests take ≥ 0.25 s, 441 s in all. At load 10, one `bun src/rust_ts/main.ts -Zunpretty=ast-tree x.rs` took 0.55-0.58 s wall, against 0.02 s for the oracle `rustc` on the same file. So nearly all of such a test is the port's startup. Files 1, 4, 6, 8, 9 and 10 are of this kind.
- **Uncached oracle runs.** `print.oracle` and `json.oracle` run the oracle `rustc` in every test. That is cheap, about 0.02 s each. `fd_ops.oracle` runs the real Miri on every program, every time (5.2 s and 4.0 s for its two largest tests).
- **Single long tests.**
  - `collector.oracle`'s `type_length_wraps`: 8.5 s.
  - `x86.test`'s `values:` cases: about 4.5 s each. The four `.det` fixtures rerun a program another fixture already runs, with `-Zmiri-deterministic-floats`.
  - `rustc_ast_passes/oracle`: two tests, 25 s, already 9 cores wide.

### Proposals (root decides; I changed nothing under `src/`)

1. **Share one port process per test file (largest).** A test helper that runs the port in one process and takes the argv vectors of a file's cases over IPC, instead of one `bun` start each.
   - **Saving:** up to about 0.5 s × 674 starts, so 300-370 s at gate load.
   - **Cost:** a new helper under `src/rust_ts/`, and changes to the 35 files.
   - **Risk:** state carried between cases. Session globals are reset per run, but any module-level cache is not. `unported` exits 70 and an ICE exits 101, so the helper must restart its process after either.
   - **Lower risk first:** a pilot on `print.oracle` and `json.oracle` (122 s together). They run `main.ts` with nothing but argv and a fixed file.
2. **Cache Miri oracle outputs in `fd_ops.oracle`**, keyed like difftest's cache (toolchain identity plus program).
   - **Saving:** the oracle's share of 46 s, perhaps half.
   - **Cost:** a cache path under `$RUST_TS_DATA`; the test must still fail when the oracle changes, and keying it on `miriOracleKey` does that.
3. **Drop or merge the `.det` value fixtures in `x86.test`.** Saving about 13 s. Cost: coverage of the deterministic-float paths, unless one program prints both forms. This is a coverage decision, not mine.
4. **`collector.oracle`'s `type_length_wraps`.** 8.5 s in one test; cut its size if the wrap is reached sooner. Saving up to about 8 s; it needs someone who knows the case.

### Parallelism and the limit

- **The limit.** It is a fixed 1,800,000 ms per static step (`scripts/gate.ts` `staticChecks`, `run(cmd, { timeoutMs: 1_800_000 })`), not derived from measurements. I changed nothing about it.
- **The step runs one file at a time.** `bun test` without `--parallel`. Bun 1.4.3 has `--parallel=<N>` (worker processes, which implies `--isolate`) and `--timings` (slowest files first).
- **Measured on the 8 slowest files, not the whole step:**

  | | Wall | CPU | Result |
  |---|---|---|---|
  | One at a time (sum of the alone runs) | 409 s | 954 s | All pass |
  | `--parallel=4` | **152 s** | 984 s | 538 pass, 0 fail, junit report written (8 files) |

  That is 2.7x faster for 3% more CPU. Load went from 4 to 14 during the run.
- **Can the step use it safely? Probably, but measure the whole step first.** What I did not test:
  - all 619 files together, which may share temp paths or `$RUST_TS_DATA` files;
  - `--isolate` across every file;
  - the gate's load. At load 30, several 9-core oracle tests running at once could push single tests toward the 60 s per-test timeout.
- **A safe trial:** one by-hand `bun test ./src ./tools --parallel=4 --timeout=60000 --reporter=junit ...` with `RUST_TS_REQUIRE_PROBES=1` in a quiet window, run 3 times, compared with the serial junit report for failures and skips.
- **What it would buy:** if that holds, the step should drop from about 1,225 s to under 600 s, scaling from the 8-file figure. The fixed 1,800 s limit then has room again without being changed.

## Things root should know

- The new gate step `marker order` costs about 0.4 s and prints two lines. It writes `$RUST_TS_DATA/coverage-order.txt` (not the tree), as `--order` already did.
- `miri-sysroot-run.ts`: a run killed by SIGKILL leaves `<crate>/<side>.run-<pid>` behind. The next run with that pid removes it; nothing else does.
- `ir-hello`'s and `miri-sysroot-*`'s next runs re-run their oracles: their keys changed.

## What I did not check

- A gate, or any difftest of a real suite. The case lock is tested on stub suites and the real `ir-run.ts` with stub compilers.
- Two real difftests of `ir-hello` at once.
- A real `miri-sysroot` crate build: the F2 test uses a stub compiler. By reading, the out dir's path does not reach the compared bytes: the review found the oracle reproduces the sysroot from a different out path, and `$OUT` masks the dep-info.
- The whole unit step under `--parallel`, as the brief says not to run the whole step.
- Linux and Windows.

## Housekeeping

- **`$RUST_TS_DATA`.** Untouched except `coverage-order.txt` (rewritten by `--order`, as the tool always does), and the oracle-cache reads of the timing runs. All tests used temp directories. Both rustup homes are unchanged, checked by mtime.
- **Processes.** No `pkill` or `killall`. The tests kill only the pids they start.
- **Scratch.** A detached worktree of `main` in my scratchpad for the key comparison, removed. `.env.local` is copied with `RUST_TS_REQUIRE_PROBES=1`; it is gitignored. `node_modules` came from `bun install --frozen-lockfile`.
