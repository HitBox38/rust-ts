**Verdict: APPROVE WITH NITS.** Every claim I tested holds: no protected suite's oracle key or case list moves, the new gate step passes and is cheap, the IR case lock touches only IR paths and cannot deadlock or wait without bound, and each sampled mutation fails its test. One medium finding, F1: the N4 refusal is not reached when the checkout has no `.env.local`, as a lane worktree may not. The batch does not cause it and does not make it worse, but its "never runs `rustc` there" is not true yet. Fix it in a small follow-up.

# Review of `harness-w43`

Independent review of branch `t3/f6733898`, head `fb9ce9f4`, 7 commits on `main` at `26e61959`. Line numbers are at `fb9ce9f4`. The tests ran in detached scratch worktrees of `fb9ce9f4` and `26e61959`, and in a third worktree with no `.env.local`. Every patch, stub and temp data root was under my scratchpad. This file is my only change to the tree. I ran no gate, no full suite and no difftest of a real suite.

## Findings

| # | Severity | Where | Failing scenario | Evidence |
|---|---|---|---|---|
| F1 | **Medium** | `scripts/lib/miri.ts:99-101`, `:109-114` | The checkout has no `.env.local`, `RUST_TS_HOST_TUPLE` is unset, and `RUSTUP_HOME` names the real Miri home, for example copied from a case's env. `MIRI_RUSTUP_HOME` then comes from that checkout's own `.data`, so `sameDir` is false, the refusal returns undefined, and `oracleHost()` runs `rustc +nightly -vV` under the real Miri home. With the real rustup proxy and auto-install on, that is fixers-43 F1 again | **Reproduced**, with only a logging fake `rustc` on `PATH` |
| F2 | Low | `scripts/miri-sysroot-run.ts:78`, `:113-119` | A SIGKILLed run leaves `<crate>/<side>.run-<pid>`. Before this batch the next run reclaimed the fixed `<side>` directory; now only a later run with the same pid does. A run whose `differs` rename loses a race also stays under its own name | **Reproduced** (SIGKILL); rename race read only |
| F3 | Low | `scripts/criteria.ts:37` (with `groupResult`) | `ir-hello` with 1 MATCH and 1 ORACLE_TIMEOUT reads `met`: of = 2 - 1. plan-m7 §6 says "`ir-hello` MATCH", and the suite has only 2 cases | **Reproduced** with `groupResult` |
| F4 | Nit, docs | `harness/suites.ts:1728`, `:1945` | The M6b descriptions say "the figure: `bun scripts/criteria.ts --run <gate run>`". That command now exits 1 on every gate, because of `ir-hello`, while it prints M6b as met | Read; exit code reproduced |
| F5 | Nit | `scripts/lib/marker-check.ts:141-144` | `--require-clean ./src/rustc_monomorphize/`, or a misspelled or deleted prefix, matches no file and passes ("no inversions"). The gate's literal is right | **Reproduced** (`./src/...`: exit 0) |
| F6 | Nit, possible flake | `scripts/lib/case-lock.test.ts:228`; `scripts/ir-normal.test.ts:213`, `:224` | (a) The re-run subject must start `bun` and print within `timeoutMs: 3000`. At the loads this project has seen (100-300), that can TIMEOUT and fail the test. (b) `expect(alive(orphanPid)).toBe(true)` needs the SIGKILL to land within the orphan's `sleep 3`, which a starved test process can miss | Read only; both passed at loads 4-10 |
| F7 | Nit, process | `scripts/gate.ts:310` | A static step does not stop the gate, so a lane that inverts a marker in `src/rustc_monomorphize/` (a new file, or an inversion PORTING section 8 allows elsewhere) learns of it at the end of a ~10 h gate. The step is not in `docs/agent-brief.md` or PORTING | Read |

### F1: the refusal and the other `rustc +nightly` paths

Reproduction, in a detached worktree of `fb9ce9f4` with no `.env.local`. `PATH` held only a logging `rustc`; `bun` ran by absolute path:

```
env -i HOME=$HOME PATH=<fakebin> RUSTUP_AUTO_INSTALL=0 RUSTUP_HOME=/Users/tomernorman/Documents/personal/rust-ts/.data/rustup-miri RUST_TS_IMPL=shim \
  bun -e 'const m = await import("./scripts/lib/miri.ts"); console.log(m.MIRI_RUSTUP_HOME); console.log(m.miriBinary())'
MIRI_RUSTUP_HOME=<scratch>/noenv/.data/rustup-miri
ERROR: cannot run oracle rustc +nightly -vV
fake rustc log: rustc +nightly -vV RUSTUP_HOME=/Users/tomernorman/Documents/personal/rust-ts/.data/rustup-miri
```

This is root-w41-check N4's own scenario: a hand run, no tuple, no `.env.local`. It is now caught only in the root checkout, where `.data` is the real data root. Lanes work in worktrees.

**Fix (choose one; each is a few lines):**
- Spawn `oracleHost()` and `oracleSysroot()` (`scripts/lib/oracle.ts:94`, `:101`) with `RUSTUP_AUTO_INSTALL=0`. The oracle is immutable (decision 2026-10-31), so an auto-install is never wanted. That closes the host lookup, `rustcDriverHash()` and every caller. The lane left this to root, rightly; I recommend it.
- Or, in `hostLookupRefusal`, refuse whenever the tuple is unset and `RUSTUP_HOME` is set and is not the oracle's home, rather than only when it equals this checkout's `MIRI_RUSTUP_HOME`.

**Other unguarded `rustc +nightly` call sites:** `scripts/lib/oracle.ts:94` (`oracleSysroot`, reached by `rustcDriverHash`, `miriOracleProblem`), `src/rust_ts/main.ts:22` (the rustc shim), and `harness/compiletest.ts:305`, `:535`. By reading, none runs under `MIRI_CASE_ENV` in any suite today. The Miri suites' subjects are `src/miri/bin/miri.ts`, whose shim goes through `miriBinary()` → `host()`. `miri-sysroot-run.ts` imports only `harness/miri-sysroot.ts` and `lib/miri.ts`. The first fix above would cover the `oracle.ts` sites too.

**The lane's N4 test is safe as described.** The child's `PATH` is only the logging `rustc`, with `RUSTUP_AUTO_INSTALL=0`, and `bun` runs by absolute path. With the refusal removed, the test fails with `ERROR: cannot run oracle rustc +nightly -vV`, and only the fake `rustc` ran. Both rustup homes' toolchain mtimes were the same before and after all my runs.

## The checks asked for

### 1. Oracle keys: verified independently

I wrote my own script, not the lane's. For all 70 suites in each tree it records `oracleKey()`, the case list (id, args, env, file, with the repo path masked), and a hash of `caseOracleCacheKey` for every 100th case. `diff` of `main` against `fb9ce9f4`:

- **All 60 protected suites (60 baseline files, run-pass-aux-miri included): identical** on all three.
- Changed: `ir-hello` (oracle key and cache keys; case list the same) and `miri-sysroot-core`, `-alloc`, `-std` (one shared key changed, so their cache keys changed; case lists the same). Exactly the lane's list.
- No baseline file changed.

### 2. The gate

- **`marker order`.** It passes on `fb9ce9f4` in 0.66 s, exit 0, with two lines of output. A planted inversion (a duplicate `rustc-skip` of `statics.rs:17` at the end of `statics.ts`) gives one `ERROR:` row and exit 1. An empty prefix is refused. Markers are grouped by (TS file, upstream path), and a descent is strict (`<`), so a new file in upstream order passes. So do equal lines, and two upstream files interleaved in one TS file. The test files under `src/rustc_monomorphize/` hold no markers. It fails only on a real descent. Note that such a descent includes the inversions PORTING section 8 allows elsewhere, which is the intended policy (F7). It reads the upstream checkout, which `markers` already needs. No vendor fetch and no network. It writes `$RUST_TS_DATA/coverage-order.txt`, never the tree. A concurrent `--order` by a lane rewrites that report too; harmless.
- **The IR case lock.** `caseLock` is defined only in `irSuite` (`harness/suites.ts:2117`). `withSuiteCaseLock` (`difftest.ts:916`) is a plain `fn()` call when it is undefined, so the retry path at `:1075` is unchanged for every other suite, and the heavy `MIRI_TEMP` branch is unchanged.
  - **Lock order** is always `<out>.case.lock` (difftest), then `<out>/work.lock` (`ir-run`): no cycle. A hand-run `ir-run` holds only the inner lock.
  - **Per process.** Every case has its own `<out>`, and the retry runs after the pool has released.
  - **A difftest killed by SIGTERM or SIGKILL** leaves a lock whose dead pid has no holders, so it is stale at once. A reused pid waits at most `caseLockHoldMs` (`difftest.ts:913`), a bounded multiple of the suite's limits.
  - **One left case:** a killed gate whose `ir-run` compiler lives on. The next run's inner wait counts against its own limit: a possible false TIMEOUT, never a hang. The lane documents this.
- **Tree writes during a gate.** None that I found. The lock files are under `$DATA/ir/<suite>/`, the order report and the sysroot run directories are under `$DATA`, and the tests use `mkdtemp` or a temp `RUST_TS_DATA`. After my runs of the 7 changed test files, `git status` was clean. `$DATA/runs` held no `run-case-lock-ir`, and `$DATA/rmeta/miri-sysroot` held no `.run-*`.

### 3. `criteria.ts`

- **Callers.** `grep` over `scripts/`, `harness/`, `tools/`, `package.json` and `.github/`: only `criteria.test.ts`, which imports `groupResult` and `GROUPS` and never checks the CLI's exit code. `gate.ts` and `state.ts` (accept, record) do not call it. Docs (`docs/next.md:451`, the `suites.ts` descriptions, plan-m6, plan-m7) tell a human to run it. So exit 1 breaks nothing automated (F4 covers the docs).
- **On `gate-20261106-224720-root-i68w`.** With no `--milestone`, M6b is met (3473/3478, 294/294, 350/360), M7a's `mir-o2`, `mono-ui` and `check-rg` (34 of 34) are met, `ir-hello` is "not in this gate", and the exit is 1. With `--milestone M6b`, exit 0. `--milestone M` and `--milestone ""` select every group.
- **Against `docs/plan-m7.md` §6.** M7a is "`ir-hello` MATCH; `mir-o2` ≥ 99%; `mono-ui` ≥ 99%; `check-rg` ≥ 33 of 34", and the groups match that. `ir-hello` is counted only under that name: a report tier is `ir-hello@N2`, another suite name, which also answers harness-m7a H3's "N3 used silently" for this group. The one gap is F3. The `check-rg` count: base − lost + gained is gate.ts's own MATCH set. Oracle timeouts count against it, which is conservative. Seeing more than 34 crate cases is a problem, not a pass, as the plan's count would be stale.

### 4. `ir-run`'s lock with the compiler's pid

Run with stub compilers and a stub `opt`, in my scratchpad.

| Scenario | Result |
|---|---|
| SIGKILL of `ir-run` while its compiler (`sleep 6`, then writes a `.ll`) lives | `work.lock` held `<ir-run pid>\n<compiler pid>\n`. The next run **waited about 6 s**, until the orphan ended, then printed `ir: none` and exited 0. `<out>` was empty afterwards |
| SIGTERM while the normal form is made (stub `opt` sleeping) | Exit 143, `<out>` empty: no `work`, no lock. The stub `opt` was still alive 1 s later, as the handoff says. A real `opt` loses its pipes and dies; it is no holder, and writes nothing under `work` |
| SIGTERM while the compiler runs | Passed on (the compiler's trap fired), exit 143, `<out>` empty |
| SIGTERM while waiting for another live holder's lock | Exit 143, and the other process's lock was left untouched |
| A holder pid reused by an unrelated live process (simulated: dead owner, holder = a live `sleep 5`) | The next run **waited 5 s**, exactly as long as that process lived |

**The bound.** The age limit is `LOCK_MAX_HOLD_MS` = 2 h. `ageMs` reads the mtime, which the holder append refreshes once. Under difftest, the inner wait also counts against the side's own limit, so a reused pid costs a TIMEOUT or ORACLE_TIMEOUT for that case while the unrelated process lives, never an endless wait. On a machine that spawns thousands of processes, a reuse that lasts is possible but needs a long-lived process to take that exact pid. The same was already true of owner pids. Acceptable.

Signals are delivered as event-loop callbacks, so `running.compiler` and `running.work` cannot be seen half-set. `difftest`'s timeout sends only SIGTERM (`common.ts` `run`, `proc.kill()`), never SIGKILL, so the N1 window needs an outside `kill -9`, an OOM kill or a crash.

### 5. The shim with no host tuple

See F1 for what still gets through. The lane's test is safe: I removed the refusal, the test failed, and only the logging `rustc` ran.

### 6. `miri-sysroot-run`'s per-run directory

Run with a stub compiler and a temp `RUST_TS_DATA`:
- **Success** (no `differs`): removed.
- **`differs`**: renamed to `<side>`, replacing the last one kept.
- **SIGTERM**: passed on to the compiler. The run then finishes, prints, and removes or keeps the directory as above (exit 143, kept as `oracle` because the partial rmeta differed).
- **SIGKILL**: `subject.run-<pid>` is left, and nothing but a run with the same pid ever removes it (F2).

Pile-up needs an outside SIGKILL, a crash or a reboot during a heavy sysroot run. Each one leaves tens to hundreds of MB (core's rmeta is 69 MB). Slow, but unbounded. **Fix:** at start, remove sibling `<side>.run-<pid>` directories whose pid is not alive.

### 7. Tests

**Mutations sampled: 8, and all 8 fail their test.**

| Mutation | Test, and how it fails |
|---|---|
| N4 refusal removed | Fails, and only the fake `rustc` ran |
| N1 `addLockHolder` removed | Fails |
| N2 SIGTERM handler removed | Fails |
| N3 pool case lock removed | Fails |
| F2 shared out dir restored | Fails |
| N4 exit listener's `process.off` removed | Fails |
| W5 `orderErrors` made to match nothing | The marker-check test fails |
| H3 count ignoring lost and gained | 2 criteria tests fail |

**Added unit time,** each changed runner file alone, `fb9ce9f4` against `main`, at load 4-10:

| File | `main` | `fb9ce9f4` | Added |
|---|---|---|---|
| `case-lock.test.ts` | 0.8 s | 4.2 s | +3.4 s |
| `ir-normal.test.ts` | 1.1 s | 8.7 s | +7.6 s, mostly the N1 test's fixed `sleep 3` + `sleep 4` |
| `miri.test.ts` | 3.3 s | 4.3 s | +1.0 s |
| `miri-sysroot.test.ts` | 0.03 s | 1.4 s | +1.3 s |
| `host-state.test.ts` | 1.4 s | 1.4 s | 0 |

That is about +13 s, all in the "runner unit tests" step (scripts/, harness/), not the src/tools step that is near its limit. The N1 test's sleeps could be halved.

**Load.**
- The widened host-state deadlines are sound. Each loop ends as soon as its condition holds. The "not started again" bound (`< LIMIT_MS`, limit 15 s) still fails a reader that is not held back, since that one waits out the whole limit.
- The N4 listener test is deterministic: `.finally` is attached before `Promise.all` awaits `p.exited`.
- The two timing-sensitive spots I found are F6.

### 8. The slowest-tests list and `--parallel`

**The measurement.**
- **Usable for ranking, not for savings.** Each file ran once, alone, while load rose from 2 to 15. The rows agree with the gate's junit times (1.0-1.5x), and junit is the better source for the ranking.
- **The 409 s against 152 s** compares a sum of alone runs at load 2-7 with one parallel run at load 4-14, part of which the run itself caused. It is roughly fair, perhaps conservative.
- **The extrapolation to "under 600 s" is unmeasured.** It assumes the other 611 files gain as the 8 heaviest did.

**What I measured on top** (small runs only):

| Run | Result |
|---|---|
| 60 small src files (junit total 1.8 s), at load 7-10 | `--no-isolate` 3.7 s; `--isolate` 9.9 s; `--parallel=4` 3.5 s; all 591 tests pass in each |
| junit under `--parallel=4` (5 files, each with a skip and a `skipIf`) | Lists the same 10 `<skipped>` entries as serial, so the `ALLOWED_SKIPS` check still sees them |
| `CI=true` with a `.only` | Still fails the run under `--parallel` |
| A per-test timeout | Still fails the test under `--parallel` |

So `--isolate` (implied by `--parallel`) costs about 0.1 s per file to reload modules. Over 619 files that is about 60 s of CPU, about 15 s of wall at 4 workers: small next to the gain.

**Risks I can name, most likely first:**
1. **The 60 s per-test timeout under contention.**
   - `rustc_ast_passes/oracle.test.ts` runs two tests of about 12 s each, 9 cores wide. `collector.oracle`'s `type_length_wraps` takes 8.5 s, and `fd_ops.oracle` runs the real Miri for 4-5 s a test.
   - Four of these at once on 12 cores, with lanes running too (load 30 and more), can push one test toward 60 s.
   - A flake there costs a gate. Pair the change with `--timings` (the slowest files start first, so they do not overlap at the end) or a longer `--timeout`.
2. **Different per-process state.**
   - Serial `bun test` evaluates each module once per process. Under `--isolate`, each file re-evaluates its modules but shares `process.env` and the cwd with the files before it in the same worker.
   - The src/tools files that change the env (`src/std/env.test.ts`, `src/vendor/anstyle_query/lib.test.ts`, which also sets `CI=""`) restore it.
   - The two `process.chdir` users (`late_b.test.ts`, `mir/debug.oracle.test.ts`) restore in `finally`.
   - Do **not** extend `--parallel` to the runner step without an audit. Some of those files point `RUST_TS_DATA` at temp dirs in the test process itself (`scripts/lib/deps.test.ts:13`, at top level, restored in `afterAll`). Under `--isolate`, a later file in the same worker loads `common.ts` again, so whatever env a file leaves behind becomes that file's data root. In serial mode `common.ts` loads once, so this cannot happen.
3. **Shared paths.**
   - 38 fixed `tmpdir()` names in src tests (e.g. `rust-ts-solve-probe`) and the `$DATA/tmp/<name>/<agent>` work dirs are distinct per file. The one shared directory, `interp-validity-intern/<agent>`, holds different file names (`intern.rs`, `validity.rs`) compiled in-process.
   - So two workers do not collide. All of them already collide with a lane that runs the same file at the same moment with the same `RUST_TS_AGENT`. That is not new, but parallel runs make it twice as likely in wall time.
4. **Memory.** The host has 24 GB. Four workers that each load the port, each spawning port processes, plus lanes, could swap. Not measured.
5. **Ports and case locks.** I found no fixed port in src tests (no `listen`, `Bun.serve` or `createServer`). No src test takes a case lock or a `MIRI_TEMP` lock.

**My read.** Worth a trial, src/tools step only, as the lane proposes: three full runs in a quiet window with `--timings`, compared with a serial junit for failures and skips, before the gate uses it.

## What I did not check

- A gate, any difftest of a real suite, or two real difftests of `ir-hello` at once. The case lock was checked by reading and by the lane's stub-suite test.
- A real `miri-sysroot` build (stub compiler only). By reading, `$OUT` masking makes the per-run path invisible in compared bytes, as the fixed `<side>` path already had to be.
- The whole unit step under `--parallel`. I measured only 60 small files and 5 synthetic ones.
- Real pid reuse: I simulated it with a live unrelated process.
- The rename race in F2 (read only), and the F6 flakes at load 100 or more.
- Linux and Windows.

## Housekeeping

- **Scratch.** Three detached worktrees (`fb9ce9f4` twice, `26e61959` once) and temp data roots, all in my scratchpad. Worktrees removed afterwards.
- **`$RUST_TS_DATA`.** Untouched except `coverage-order.txt`, which `--order` rewrites on every run.
- **Rustup homes.** I set `RUSTUP_AUTO_INSTALL=0` in every shell, and never ran `+nightly` under the Miri home. Both homes' toolchain mtimes were unchanged.
- **Processes.** No `pkill` or `killall`. I killed only the pids I started, and none is left.
