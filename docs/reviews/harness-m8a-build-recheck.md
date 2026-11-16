# Re-check: harness-m8a-build review fixes (independent, read-only)

Branch `t3/cargo-project-build`. The reviewed state was `868fec8c`; the review is `docs/reviews/harness-m8a-build.md` at `2b21b205`
(PASS WITH NOTES, N1 before the merge). This re-check covers the fixes in `6245f5f6` (`git diff 868fec8c 6245f5f6`, handoff §9).

**Setup.**
- I made two detached scratch worktrees, `868fec8c` and `6245f5f6`, under `$RUST_TS_DATA/tmp/recheck-harness-m8a-build/`. Each got the root
  host's `.env.local` and `bun install --frozen-lockfile`. "main" below means this worktree at `a591abc3`.
- `main`'s `harness/` and `scripts/` are identical to the batch's merge base `f80818b6`: `git diff --stat f80818b6 main` touches neither.
- **Host:** AC power, 24 GiB free, about 6.8 GiB of swap in use, load 9–12, no `GATE_RUNNING`, no other ripgrep build running.
- **Not run:** no cargo builds, no `cargo-build` or `cargo-smoke` runs, no gate.
- **Heavy runs:** one `rg-build` oracle-side run (§3).
- **Cleanup:** I removed all scratch and both scratch worktrees. This file is the only one I wrote to the tree.

## Verdict: **PASS WITH NOTES, with R1 to be fixed before the merge**

**N1, N2, N5 and N6 are fixed as the handoff describes.**
- **Keys:**
  - Every oracle key moves only where it should, and for the stated reasons.
  - The other 83 suites' keys and `inputDirs` are byte-identical to main's.
  - The new module-walk test is real and fails when a keyed module is dropped.
  - My own `rg-build` oracle run on the committed `6245f5f6` is byte-identical to main's.

**R1 is not caused by the fixes, but this batch adds it.** `cargo-build`'s oracle cache key cannot be computed at all, at `868fec8c` or at
`6245f5f6`. difftest's `inputDirsHash` reads each of the 93 symlinks to directories in cargo's source tree as a file and throws `EISDIR`.
No protected suite is affected, and it fails closed. But the batch's own suite cannot run, and a gate on a host with heavy-build headroom
would crash at its first suite.

R2 and R3 are low.

## 1. N1: oracle keys

1. **Every suite's key, computed three times.**
   - **How:** a script imported each checkout's `harness/suites.ts` and called `oracleKey()` for all 88 suites, and recorded `inputDirs`.
     The checkouts were main, `868fec8c` and `6245f5f6`.
   - **Result:** no suite threw.

   | Comparison | Suites identical | Moved |
   |---|---|---|
   | main → `868fec8c` | 83 of 88 | `rg-build`, `rg-behaviour`, `rg-behaviour-rgtest`; `cargo-build` and `cargo-smoke` are new |
   | `868fec8c` → `6245f5f6` | 83 of 88 | the same five; `cargo-build`'s `inputDirs` gains `cargo-home/registry/src` |
   | main → `6245f5f6` | 83 of 88 | the same five |

   - All ten before/after values match the handoff's §9 table exactly. For example, `rg-build` goes from `c82ca82d…` to `a21ffa4a…`, and
     `cargo-build` from `5b3fcc56…` to `d3bb9890…`.
   - The other 37 suites with an `oracleKey` are unchanged. So `ORACLE_KEY_FILES` and `extraKeyFiles` reproduce every other key exactly.
2. **The keys rebuilt by hand, to check the stated reasons.** I rebuilt each key from its parts in the fix checkout.
   - **`rg-build`:**
     - Built from `868fec8c`'s six `PROJECT_BUILD_SOURCES` contents plus the fix's `hostToolsId`, it gives exactly `c82ca82d…`, the old key.
     - So `rg-build` moves only because the harness's file contents changed.
     - `hostToolsId()` is identical in both checkouts, so ripgrep's host-tools part is unchanged.
     - The files that changed are `scripts/cargo-project-build.ts`, `scripts/lib/cargo-project-build.ts` and `scripts/lib/watchdog.ts`.
   - **The behaviour suites:**
     - The old formula over the old files reproduces `daff9d60…` and `3e31a61f…`.
     - The new formula reproduces `0a082fa1…` and `7416af8e…`: `rg-build`'s key, then `rg-behaviour.ts`, then the new
       `lib/rg-behaviour.ts`, then corpus and queries for `rg-behaviour`, and `"rgtest"` for `rg-behaviour-rgtest`.
     - `scripts/rg-behaviour.ts` itself also changed: one added export, `RG_BEHAVIOUR_LIB`. That is a third reason these keys move. It is
       covered by "the harness's own files changed".
   - **`cargo-build`:** the new formula reproduces `d3bb9890…`.
     - With the old files and the new host part, the key would be `2f765990…`, so both causes contribute.
     - The old key part `buildToolsId` (`7f889a7c…`) is gone from `keyParts`. It is folded into `builtHostToolsId`.
3. **The cargo-smoke normaliser move changes no rg output.**
   - `normaliseSmokeStream` and `STARTED` in `scripts/lib/cargo-smoke.ts` are byte-identical to the old code in
     `lib/cargo-project-build.ts`.
   - Only `cargo-smoke.ts` and its test use it.
   - `lib/cargo-project-build.ts` otherwise only drops the `unstable.ts` import, exports `CARGO_TIME` and adds `cargoConfigsAbove`. No
     report function changes.
4. **The module-walk test** (`harness/m8a-suites.test.ts`):
   - **It walks the imports.** It parses `from`, `import(…)` and bare `import` of relative paths, transitively, from each suite's
     oracle-command script.
     - It adds `scripts/cargo-project-build-rustc.ts` whenever the closure holds `scripts/cargo-project-build.ts`. That covers all five
       suites: the behaviour and smoke suites through `ensureBinary`.
     - No command starts another repository script by path except that wrapper. `rg-check.ts`'s `RG_WRAPPER_TS` belongs to the
       `rg-check` suite's build, which is not in these closures.
   - **Mutations,** run on the scratch copy and then reverted:
     - With `lib/watchdog.ts` dropped from `rg-build`'s entry, it fails with `rg-build: scripts/lib/watchdog.ts`.
     - With `cargo-project-build-rustc.ts` dropped, it fails with `rg-build: scripts/cargo-project-build-rustc.ts`. So the wrapper really
       is walked.
     - With `lib/cargo-project-build.ts` dropped, it fails.
   - **The `UNKEYED` allowlist:**
     - Each entry has a reason, and the test fails on a stale entry.
     - The entries carried over from main are `common.ts`, `case-lock.ts`, `llvm-tools.ts`, `oracle.ts` and `scripts/rg-check.ts`. On
       main, `RG_BUILD_SOURCES` (`scripts/rg-build.ts:61`) did not key them either.
     - The entries that are new imports are `host-state.ts`, `tools-src.ts` and `lib/tools-src.ts`, plus `env.ts`, `toolchain.ts` and
       `tool-oracles.ts`, which come in through `common.ts` and `oracle.ts`.
     - Each reason holds:
       - `RG_VERSION` from `scripts/rg-check.ts` is printed, but it also names `RG_SRC`, which is in `inputDirs`.
       - `host-state.ts` and the precondition texts reach output only with the no-result mark, which is never cached.
       - `tools-src.ts` gives paths, and cargo's pin commit is a key part.
   - **The gap:** the test checks the declared table, not the computed key. See R2.

## 2. N2: a throwing stop-record write

- **`startWatchdog` (`lib/watchdog.ts`):**
  - It catches a failed `recordWatchdogStop` and sets `stopped` with `file: "(not written)"` and the error in the reason.
  - It still calls `o.kill`, then breaks.
  - Nothing else in the loop throws, so `done` resolves.
- **`buildLocked`:**
  - It wraps `await watchdog?.done` in a `try`. Then it always runs, in order: the handler removal, `clearTimeout`, `killGroup(SIGKILL)`,
    `killBuildProcesses(tag)` (the sweep), the log closes and the call parsing, which skips a half-written record.
  - It then returns `stopped` before any stamp or report, after `rmSync(tree)`.
  - The result reaches `exitWithoutReport`, both from `run` (`if (!("report" in r))`) and from `ensureBinary` (line 750). That prints
    `CARGO_NO_RESULT_MARK…the build was stopped: … (record (not written))` and exits 1.
  - The cargo suites set `uncachedOracle: cargoNoResultReason`, so nothing is cached.
- **Tests:**
  - `watchdog.test.ts` blocks the stop directory with a file and expects one kill, a reason naming the error and `(not written)`.
  - `cargo-project-build.test.ts` runs a real tiny build with the stop directory blocked, and expects `stopped`, `(not written)` and no
    tree.
  - Both pass.
- **The stated remaining gap holds.** Only `headroom` projects get a watchdog, and that is cargo only, never ripgrep. So only `cargo-build`
  and `cargo-smoke`'s builds can be stopped. Both are `neverProtect` and have no baseline.
  - **A stopped oracle side** carries the mark, so it is uncached and never MATCH.
  - **A stopped subject side** has empty stdout and the mark, so it is never MATCH.
  - **What it costs:** an unrecorded stop only means the gate does not stop on it, which is host safety, not the ratchet. Nothing is lost or
    protected wrongly.

## 3. N5: host inputs

- **`LIBRARY_PATH` is dropped.** It is gone from `KEPT_IN_BUILT_ENV`, which keeps `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `SDKROOT`,
  `DEVELOPER_DIR`, `RUST_TS_*` and `BUN_*`.
  - The tiny `-sys` build, run with `LIBRARY_PATH=/opt/leak/lib` in the caller's environment, prints `cargo:library_path=None`.
  - ripgrep keeps the caller's environment and the `hostToolsId` that keys it, which is unchanged as its protected report requires.
- **The host tools are keyed from the built `PATH`.** `builtHostToolsId` runs `cc -v`, `ld -v`, `xcrun --show-sdk-version`, `sw_vers`,
  `make --version` and `perl -e 'print $^V'`. It runs them with only `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `SDKROOT` and
  `DEVELOPER_DIR`, and adds `Bun.which`'s resolution of each tool on that `PATH`.
  - The test puts a fake `cc` that prints `fake cc` first on the caller's `PATH`.
  - `builtHostToolsId` stays equal and `hostToolsId` changes (`cargo-project-build.test.ts:403–404`).
  - So Bun's spawn resolves the tool on the child's `PATH`, as intended.
- **The `.cargo/config` refusal:**
  - **What `cargoConfigsAbove` checks:**
    - `.cargo/config.toml` and `.cargo/config` in every parent of the source directory, up to `/`;
    - `config.toml` and `config` in `CARGO_HOME`;
    - not the source tree's own `.cargo`.
  - **That is the right directory.** cargo is spawned with `cwd: join(p.root, p.src())`, the same directory, so the ancestors it reads
    are exactly these.
  - **Where it runs:** `preconditionRefusal` runs it first, for both projects, and the pure test covers the parents, `CARGO_HOME`, the
    source's own config and `credentials.toml`.
  - **On this host it finds nothing for either project.**
    - `~/.cargo` holds `credentials.toml` and no config.
    - Both source trees have their own `.cargo/config.toml`, which is allowed.
    - `preconditionRefusal(ripgrep)` returns undefined. `preconditionRefusal(cargo)` refuses on swap, not on a config.
  - **R3:** one cargo invocation is not covered.
- **The refusal can't trip on today's ripgrep build.**
  - **By the code:** for ripgrep, the fix changes only the refusal (empty here), `p.hostTools()`, which is `hostToolsId()` and identical,
    and the watchdog-error branch, which ripgrep never reaches. No report code changes.
  - **The lane's evidence:** its scratch `after2/rg-build/oracle/*` (03:38) is byte-identical to `before/` (main) for stdout, stderr and
    exit. It ran two minutes before the commit at 03:40.
  - **My own run:** one `rg-build` oracle side, run on the clean committed `6245f5f6` through the suite's own command, `cwdOf` and
    `caseEnv`.
    - It took 30 s and exited 0, with 752 lines.
    - stdout, stderr and exit are byte-identical to main's.
    - Side effects: it left no tree, no lock and no tagged process. It rewrote `kept/rg-build/oracle`.

## 4. N6: `cargo-home/registry/src` in `cargo-build`'s inputs

- `inputDirs` is now `[cargo-<commit>, "cargo-home/registry/src"]`, relative to `PROJECTS.cargo.root`, as `rg-build` keys
  `cargo/registry/src`.
- `requireCargo`, which `cases()` calls before difftest computes any key, creates the directory.
- **Cost:** the directory is 561 MiB in 30,024 files. A symlink-tolerant copy of `inputDirsHash` took 5.2 s at load 10, and the source
  tree took 0.6 s.
  - difftest memoises the hash per process (`inputDirsMemo`), so it is paid once per difftest process.
  - Beside a build of up to an hour, that is acceptable for a `neverProtect` heavy suite.
- **But difftest cannot hash `cargo-build`'s inputs at all.** See R1. The source tree, keyed since `125ee8fb`, causes it, not the new
  directory: the registry has no symlinks.

## 5. Basics

- **Typecheck:** `bunx tsc --noEmit -p .` on `6245f5f6` is clean (11.8 s).
- **Tests:** `bun test ./scripts ./harness` on `6245f5f6`, with `RUST_TS_DATA` set, `RUST_TS_REQUIRE_PROBES=1`, `CI=true` and
  `RUSTUP_AUTO_INSTALL=0`, gives **680 pass, 0 fail**, across 65 files in 108 s.
- **Environment reads:**
  - The touched tests read one variable by name, `process.env.PATH` (`cargo-project-build.test.ts:59`). It is listed in
    `scripts/lib/unit-steps.test.ts` with the reason "where programs are found".
  - The other new reads only spread `process.env` into children.
  - `unit-steps.test.ts` passes (10 tests).
- **Time per touched file,** wall time, alone:

  | File | Result | Wall |
  |---|---|---|
  | `harness/m8a-suites.test.ts` | 2 pass | 0.24 s |
  | `scripts/lib/cargo-project-build.test.ts` | 18 pass | 2.56 s |
  | `scripts/lib/watchdog.test.ts` | 9 pass | 0.10 s |

  That is within D13's 10 s.

## Findings

**R1 (fix before the merge; already in the reviewed batch, not caused by the fixes). `cargo-build`'s oracle cache key throws `EISDIR`, so
difftest cannot run the suite.**
- **Where:**
  - `scripts/difftest.ts:330` `inputDirsHash` walks each input directory. Anything that is not `isDirectory()` goes on the file list,
    including a symlink to a directory, and is then read with `readFileSync`.
  - cargo's pinned source tree (`cargo-29c5daa1…`, in `cargo-build`'s `inputDirs` since `125ee8fb`) has 121 symlinks. 93 of them point
    at directories, for example `tests/testsuite/cargo_info/not_found/in -> ../within_workspace.in` and
    `tests/testsuite/cargo_remove/dry_run/in -> ../remove-basic.in/`.
- **Seen:** `oracleCacheKey(suite("cargo-build"), its case, …)`, difftest's own exported function, throws
  `EISDIR: illegal operation on a directory, read` at both `868fec8c` and `6245f5f6`. `rg-build`'s key computes fine in both.
- **Effect:**
  - `runOracle` calls `cachePath` outside any `try`, so `bun scripts/difftest.ts --suite cargo-build` dies on an uncaught error before
    any build.
  - `gate.ts` awaits `difftest({ suite })` unguarded, and `cargo-build` is the gate's first suite (`runFirst`). So once the host passes the
    heavy-build headroom check, the gate crashes at its start.
  - Today the gate's per-suite headroom check refuses `cargo-build` on swap and records it as not run, so today's gates are unaffected.
  - No protected suite is involved, and it fails closed: nothing is accepted wrongly.
- **Why nobody saw it:** no `cargo-build` difftest has run yet. The unit tests check the suite's fields and call its `oracleKey()`, but
  never `inputDirsHash`.
- **Fix,** a harness change in this batch or the next:
  - **Option 1 (difftest):** have `inputDirsHash` hash a symlink that resolves to a directory as its link text, say
    `${rel}\0-> ${readlinkSync(…)}`, instead of reading it. Paths that throw today are the only ones affected, so every existing suite's key
    stays byte-identical.
  - **Option 2 (cargo-build):** key the source tree some other way.
  - **Either way,** add a test that computes `caseOracleCacheKey` for `cargo-build` when cargo is set up, or a unit test of the walk with a
    directory symlink.

**R2 (low). `ORACLE_KEY_FILES` is the key's source for three suites only, so the new test can pass while `rg-build`'s or `cargo-build`'s key
misses a file.**
- **How the keys are built:**
  - `rg-behaviour`, `rg-behaviour-rgtest` and `cargo-smoke` hash `extraKeyFiles(name)` on top of `projectOracleKey`.
  - `rg-build` (`rgBuildOracleKey`) and `cargo-build` (`() => projectOracleKey(PROJECTS.cargo)`) hash only `PROJECT_BUILD_SOURCES`.
  - Their table entries are declarations the key never reads.
  - So the handoff's "the keys are computed from it" is true for three of the five.
- **Shown:** I added `lib/common.ts` to `ORACLE_KEY_FILES["rg-build"]` and appended a line to `common.ts`.
  - The walk test passes, 2 of 2.
  - `rg-build`'s key stays `a21ffa4a…`.
  - Someone answering a future walk-test failure by adding the module to the `rg-build` entry, and not to `PROJECT_BUILD_SOURCES`, would
    silently leave it unkeyed.
- **Today:** every listed file is hashed, as the reconstruction in §1.2 shows, so this is a guard gap, not a live miss.
- **Fix:**
  - Build `rg-build`'s and `cargo-build`'s keys from the table: `projectOracleKey` plus `extraKeyFiles`, which is key-neutral today
    because the extra list is empty.
  - Or have the test assert that those two entries equal `PROJECT_BUILD_SOURCES` exactly.
  - Better still, add the byte-change test the review suggested: changing any listed file changes the suite's `oracleKey()`.

**R3 (low). The N5 config refusal does not cover `rg-behaviour-rgtest`'s own cargo build.**
- `ensureRgtestBinary` (`scripts/rg-behaviour.ts:158`) runs `cargo test --release --no-run …` in ripgrep's source directory. It does not
  call `preconditionRefusal` or `cargoConfigsAbove`.
- So the handoff's "refuses both projects" holds for builds through `buildSide`/`ensureBinary` and for cargo-smoke's steps, but not here.
- **Impact:** small. No config exists. The binary is built once per `rgtestKey` and shared by both sides, and this was already true before
  N5.
- **Fix:** a one-line check before that spawn, ending through the existing `noResult`.

**R4 (info).** The lane's post-fix `rg-build` evidence ran on the working tree two minutes before the commit. My own run (§3) on the
committed `6245f5f6` closes that window.
