# Review: harness-m8a-build (independent, read-only)

Branch `t3/cargo-project-build`, commits `125ee8fb` (code) and `868fec8c` (handoff), base main `cac26189`; handoff
`docs/handoff/harness-m8a-build.md`. Scope: plan-m8 §4, §6, D8, D15, D17, D19, D20, D21, D23, §8 wave 41 step 6. Fixes claimed: the
harness-m7d re-check notes 1–6, w40t-audit N5 and N6, and review harness-m8a-gate N2.

**Setup.** I checked out a scratch detached worktree of `868fec8c` under `$RUST_TS_DATA/tmp/review-harness-m8a-build/`, with the root
host's `.env.local` and `bun install --frozen-lockfile`.
- **Host:** AC power, 23–24 GiB free, 6.9 GiB of swap in use, load 5–7, no `GATE_RUNNING`. No other ripgrep build ran.
- **Not run:** no cargo build, no `cargo-build` or `cargo-smoke` run, no gate.
- **Heavy runs:** one `rg-build` oracle run (§2.3, interrupted on purpose).
- **Cleanup:** I removed all my scratch and the scratch worktree. The only file I wrote to the tree is this one.

## Verdict: **PASS WITH NOTES, with N1 to be fixed before the merge**

**What holds:**
- `rg-build`'s protected report is byte-identical before and after. So are `rg-behaviour` (63 cases) and `rg-behaviour-rgtest`; I checked
  the lane's files myself.
- No protected suite's command, comparison or baseline changes meaning.
- The sweep cannot reach another build, the gate or the other project.
- The watchdog writes its stop record before it signals, so review harness-m8a-gate N2 is closed.
- D15's configuration and recorded checks are in place, and both new suites are `neverProtect`.

**What to fix:** N1. The split moved the rg-behaviour functions into `scripts/lib/rg-behaviour.ts`, and that file is in neither
behaviour suite's oracle key. On main their old home, `lib/rg-build.ts`, was keyed. A later edit to `maskRgTimes` or `rgtestSections`
would therefore be compared against oracle output cached under the old code. The fix is one line per key. Root can check it without
another review.

N2–N8 are low-risk.

## 1. Ratchet: rg-build, rg-behaviour, rg-behaviour-rgtest

1. **The evidence is there, and I checked it.**
   - **Where:** the lane's scratch directory (`…/t3-3c842022-…/scratchpad/`) holds:
     - `proof.ts`, which runs each suite's own `oracle`/`subject` commands from `SUITES` with `cwdOf(s)` and `caseEnv`, as difftest
       does;
     - `before/` (main `cac26189`, in a detached worktree) and `after/` (the branch).
   - **My comparison**, with my own `cmp` loop over every `.stdout`, `.stderr` and `.exit` file, both sides:

     | Suite | Files per side | Before vs after | After: oracle vs subject |
     |---|---|---|---|
     | rg-build | 3 | 0 differ | 0 differ |
     | rg-behaviour | 189 | 0 differ | 0 differ |
     | rg-behaviour-rgtest | 3 | 0 differ | 0 differ |

   - The after-run's `.cmd` files name `scripts/cargo-project-build.ts run --project ripgrep`.
   - The after-run started at 03:06:23, just after commit `125ee8fb` (03:06:19); its oracle stdout is stamped 03:06:45. So it ran on
     the committed code, as the handoff says.
   - The rg-build report has 752 lines, `cargo exit 0`, `rg built`, exit 0.
2. **No protected suite changed meaning.**
   - `harness/baseline/` is untouched.
   - `rg-build`'s argv gains `--project ripgrep`, and its script path changes. Nothing else changes: the header, the cargo argv, the
     tree, the lock, the wrapper name, the denylist environment and the `NO_RESULT_MARK` hook.
   - The behaviour suites' commands are unchanged.
   - ripgrep has no `headroom`, so `preconditionRefusal` returns undefined after its built-PATH branch, which only cargo uses. The
     watchdog does not start for it either. So `rg-build` can never be refused or stopped by D20, which is correct: D20 puts it outside.
   - The oracle keys change because the harness files changed. The first gate re-runs the rg oracle sides once (about 25 s) and
     rebuilds the kept `rg`. That is a re-key, not a change of meaning.
3. **The rename is complete.** `git grep` on the branch finds no `rg-build.ts`, `rg-build-rustc`, `lib/rg-build`, `RG_BUILD`,
   `RG_BUILD_SOURCES`, `ensureRg`, `RG_BIN`, `RgBuildCall` or `RGB_COMPILER`/`RGB_LOG` in `scripts/`, `harness/`, `tools/` or `src/`.
   The only mentions left are history: `docs/plan-m8.md`, older handoffs and reviews, and comments that say "generalising lane
   harness-m7d's scripts/rg-build.ts". The gate (`oracleRuns`), `harness/suites.ts`, `scripts/criteria.ts` (header only) and both
   test files point at the new paths.

## 2. Process safety

1. **The sweep** (`killBuildProcesses`, lib `markedPids`). It cannot kill a process that is not the build's.
   - **What matches.** The tag is `CPB_TREE=<tree>#<nonce>`: 8 random bytes per build, kept in `<lock>.nonce`.
     - Only the environment part of a `ps -E` line is searched: the argv from the plain `ps` listing is cut off first.
     - The tag must be one whole space-delimited entry.
     - A pid whose plain line is not a prefix of its `-E` line counts as "unsure" and is never killed. The sweep re-lists up to 3
       times.
     - Its own pid is excluded.
   - **Who is safe:**
     - **Another lane's build:** a different nonce, or a different tree under another `RUST_TS_DATA`.
     - **The gate:** its environment never holds the tag. The harness process sets it only in cargo's environment.
     - **PitchCrew:** it has neither the tree path nor the nonce.
   - **The start-of-build sweep** reads the previous nonce while holding the lock. A live previous build would hold the lock too,
     because cargo is a lock holder. The lock's 8 h stale limit is above `rg-build`'s 6 h and `cargo-build`'s 4 h limits.
   - **The admitted gap** is `FOO='… CPB_TREE=<tag> …'`. Only a descendant of the build can know the nonce, and such a process is the
     build's in all but name. Acceptable.
   - **What `ps -E` shows.** I checked visibility on this host (Darwin 25.6):
     - visible: the oracle `cargo` under `perl setpgrp; exec`, `rustc`, a cargo build-script binary and Bun;
     - not visible: platform binaries (`/bin/sleep`, `/usr/bin/perl`, and so `make`/`cc`/`/bin/sh`). These are covered by the group
       kill, since nothing in the build calls `setsid`.
   - **A false alarm of mine:** a mid-build probe first showed no tagged process. That was my own `grep -v grep`: the tree path
     contains "ripgrep".
   - **Residual risk:** pid reuse between the listing and `kill`. It is the usual milliseconds window and not new.
2. **The watchdog** (`scripts/lib/watchdog.ts`).
   - **The record comes before the kill.** `startWatchdog` calls `recordWatchdogStop` and then `o.kill`. `buildLocked` awaits
     `proc.exited`, then `watchdog.done`, and only then returns. So the record exists before the process difftest waits on exits, and
     N2 is closed. The unit test checks that the record exists when `kill` runs.
   - **Thresholds:** a 5 s poll, the 4 GiB floor at once, 60 s at pressure ≥ 4, and 60 s of unreadable readings, each counted
     separately. The first poll comes at once.
   - **A kill before `setpgrp`** fails with ESRCH and is ignored. The escalation 3 s later (SIGKILL to the group, then the sweep)
     covers it.
   - **Stale records** cannot fail a later gate. `watchdogStopsSince` counts only records at or after the suite's start, and an
     unreadable one falls back to its file's mtime. A live risk remains in N3.
   - **Gap:** if writing the record throws, the watchdog dies without killing. See N2.
3. **Signals.**
   - **Handlers:** SIGTERM, SIGINT and SIGHUP are handled from the spawn of cargo until it has exited. Each sends SIGTERM to the group,
     then SIGKILL after 3 s, then sweeps. After any exit, the group gets SIGKILL and the sweep runs.
   - **Exit codes:** 128 + `os.constants.signals[n]`, so SIGHUP gives 129.
   - **Compiler signals:** the wrapper records a compiler's signal and still exits 101 for cargo. A compiler killed by SIGKILL,
     SIGTERM, SIGINT or SIGHUP makes the build interrupted: no stamp. SIGSEGV and SIGABRT stay a crash. That is a reasonable decision.
   - **rgtest's two spawns** now run through `runInGroup`. Their output is unchanged per §1.1.
   - **My scratch interruption.** I ran the branch's `rg-build` oracle side and sent the harness SIGTERM 12 s in, after 26 compiler
     calls. Result:
     - exit 143, with stderr `rg-harness: no result: the build was interrupted (SIGTERM)`;
     - empty stdout;
     - no process with the tag afterwards, no `target/rg-build`, no `rg-build.lock`.

     Side effect: it removed `kept/rg-build/oracle`, the lane's diagnostic tree, and left `kept/rg-build/oracle-logs` from the
     interrupted run. The next oracle build rewrites both.
   - **Outside the handlers.** A signal while waiting on the lock, during preconditions or during report writing gets the default
     action. No cargo is running at those points. The report phase leaves the tree for the next build's `rmSync`. Fine.

## 3. D15 (project `cargo`)

- **Environment allowlist:**
  - passed: `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `SDKROOT`, `DEVELOPER_DIR`, `LIBRARY_PATH`, `RUST_TS_*` and `BUN_*`;
  - set: `PATH=/usr/bin:/bin:/usr/sbin:/sbin`;
  - dropped as a result: `CC`, `CFLAGS`, `PKG_CONFIG*`, `OPENSSL_*`, `LIBGIT2_*`, `MACOSX_DEPLOYMENT_TARGET` and every `CARGO_*`.
  - See N5 for `LIBRARY_PATH`.
- **`builtPathRefusal`:**
  - refuses `pkg-config` in any built directory, and `curl-config` anywhere but `/usr/bin`;
  - is checked before every cargo build (`preconditionRefusal`, `p.builtEnv`);
  - is unit-tested for `/usr/sbin/pkg-config` and `/usr/bin/curl-config`.
  - On this host there is no `pkg-config` in the four directories, and `/usr/bin/curl-config` exists, which is allowed.
- **Both sides get the same flags.** `cargoArgs` is one function, so `--features all-static` and `-j1` are on both sides. `-j1` is
  also on `rg-build`.
- **The report:**
  - `-sys build scripts:` lists each `build/<pkg>-sys/<hash>/run/stdout`, and the old layout's `build/<pkg>-sys-<hash>/output`;
  - it keeps the `cargo:` lines minus `rerun-if-*`, with roots named;
  - `otool -L cargo:` follows when the binary was built;
  - both are exercised by the unit test's real build of a tiny `-sys` project.
- **Keys:**
  - `hostToolsId` (cc, ld, SDK, OS and the three variables) is in `projectOracleKey` and `binKey`;
  - `buildToolsId` (`/usr/bin/make --version` and `/usr/bin/perl`'s `$^V`, run with the built `PATH`) is in cargo's `keyParts`, so in
    both keys.

## 4. Suites

- **`neverProtect`:** both `cargo-build` and `cargo-smoke` carry the same text, citing D19, D23 and root's decision. Neither has a
  baseline file, which `harness/m8a-suites.test.ts` checks.
- **`cargo-build`'s fields:** `headroom: "heavy-build"` (D20's row), `runFirst: true` and heavy with `rssBudgetMb` 14 GiB.
  - `gateSuiteOrder` puts the `runFirst` suites first, then the light ones, then the heavy ones.
  - `--skip-heavy` drops a heavy `runFirst` suite, consistent with `notRun`.
- **`cargo-smoke`'s subject side** calls `ensureBinary(cargo, "subject", …, { build: false })`, so it never builds. With no kept binary
  it prints `cargo-smoke: no port-built cargo: no port-built cargo is kept for this key (<key>); the cargo-build suite builds it` and
  exits 1, with no mark: a DIFF in a report suite, which is correct for a subject. A port stamp with an `unported` line exits 70.
- **`cargo-smoke`'s oracle side** builds under the same preconditions and watchdog. A refusal or stop prints the cargo mark, which makes
  the case UNSTABLE and keeps it out of the cache.
- **`RUST_TS_GATE_RUN`.**
  - `gate.ts` sets it on its own `process.env` after the static steps, so the unit step does not inherit it. `gateRun`'s own tests run
    it in child processes, so it does not leak into the test runner.
  - `isScrubbedEnvVar("RUST_TS_GATE_RUN")` is false, so it reaches the suites' processes. `KEPT_IN_BUILT_ENV` keeps `RUST_TS_*`.
  - **Outside a gate** it bypasses only the `GATE_RUNNING` check, and only if someone exports it on purpose. The headroom and battery
    checks still apply. With it set, `check --project cargo` still refused here, on swap. It cannot touch scoring. See N4.
- **`check --project cargo` on this host:** `ERROR: cargo-build: host headroom (plan-m8 D20, heavy-build: 20 GiB free, swap under 4 GiB,
  memory pressure not critical): 6.9 GiB of swap in use, not under 4 GiB`, exit 1. `check --project ripgrep` prints `ok`.

## 5. Tests

- **Typecheck:** `bunx tsc --noEmit -p .` is clean (9.5 s).
- **Test runs**, with `RUST_TS_DATA` set, `RUST_TS_REQUIRE_PROBES=1` and `CI=true`, one file at a time:

  | File | Result | Wall |
  |---|---|---|
  | `scripts/lib/cargo-project-build.test.ts` | 17 pass | 2.21 s |
  | `scripts/lib/watchdog.test.ts` | 8 pass | 0.10 s |
  | `harness/m8a-suites.test.ts` | 1 pass | 0.16 s |
  | `scripts/lib/rg-behaviour.test.ts` | 6 pass | 0.01 s |
  | `harness/m7d-suites.test.ts` | 2 pass | 0.14 s |
  | `scripts/lib/tool-oracles.test.ts` | 13 pass | 0.60 s |
  | `scripts/lib/unit-steps.test.ts` | 10 pass | — |

  The new files add about 2.5 s, within D13's 10 s.
- **Environment reads:** `unit-steps.test.ts`'s scan of every test file's reads passes. The new tests read none by name; they only
  spread `process.env` into children.
- **Where the tests write:** they build only under their own temp root, and record stops into a temp `build-stops` directory, never
  into `$RUST_TS_DATA/watchdog-stops`. So a unit run during a gate cannot stop it.
- **`tool-oracles.test.ts` without `RUST_TS_DATA`:** the one real-tool test is skipped unless `RUST_TS_REQUIRE_PROBES=1`, which is when
  it fails. The gate's unit step sets `RUST_TS_DATA` (`unitStepEnv`), and lanes don't normally set `REQUIRE_PROBES`. Not a real problem
  (N7).

## 6. Fixes claimed

| Note | Status |
|---|---|
| m7d re-check 1 (sweep) / w40t N6 | Fixed: environment-only, whole entry, per-build nonce (§2.1) |
| m7d re-check 2 (prune by build date) | Fixed: `touchKey` in `ensureBinary` and `ensureRgtestBinary`; `pruneKeys` skips a vanished entry |
| m7d re-check 3 (uncached-error race) | Fixed: `readStamp` failure means no stamp; a failed `rg` spawn or rgtest copy gives `NO_RESULT_MARK` |
| m7d re-check 4 (signal leaves stamp) | Fixed: `BuildCall.signal`; an external-kill signal means interrupted, with no stamp |
| m7d re-check 5 (SIGHUP, rgtest spawns) | Fixed: `INTERRUPTS` includes SIGHUP; `runInGroup` for both rgtest spawns |
| m7d re-check 6 (128 + 0) | Fixed: `signalNumber` |
| w40t N5 (stale "report only" text) | Fixed in `harness/suites.ts` (block comment and two descriptions) and the `criteria.ts` header |
| m8a-gate N2 (record after the gate's read) | Fixed (§2.2), with the contract in `recordWatchdogStop`'s doc |

## Findings

**N1 (fix before the merge). `scripts/lib/rg-behaviour.ts` is in neither behaviour suite's oracle key.**
- **Where:**
  - `harness/suites.ts`: `rgBehaviourOracleKey` = `rgBuildOracleKey` + `RG_BEHAVIOUR`, `RG_CORPUS`, `RG_QUERIES`;
  - `rg-behaviour-rgtest`'s key = `rgBuildOracleKey` + `RG_BEHAVIOUR`;
  - `rgBuildOracleKey` = `projectOracleKey(ripgrep)`, whose `PROJECT_BUILD_SOURCES` lists `lib/cargo-project-build.ts`, not
    `lib/rg-behaviour.ts`.
- **What the file does:** it holds `maskRgTimes`, which shapes every query's output, and `rgtestSections`, which is the whole
  rgtest report. Also `corpusBytes` and `ancestorIgnoreFiles`.
- **The regression:** on main these lived in `scripts/lib/rg-build.ts`, which `RG_BUILD_SOURCES` keyed (`git show
  main:scripts/rg-build.ts:61`).
- **Failure:** edit `maskRgTimes`, and difftest keeps serving oracle outputs masked the old way to a subject masked the new way. That
  is spurious DIFFs on 63 + 1 protected cases, so false losses. In principle it is also a match against a stale answer.
- **Fix:** add `join(REPO, "scripts", "lib", "rg-behaviour.ts")` to both keys, or to `PROJECT_BUILD_SOURCES`. Ideally add a test that a
  byte change to that file changes `suite("rg-behaviour").oracleKey()`.
- **Cost:** none beyond the re-key this batch already causes.

**N2 (low). If writing the stop record throws, the watchdog fails open and the harness dies uncleanly.**
- **What happens:** `startWatchdog` calls `recordWatchdogStop` with no `try`. An error there (a permission problem, ENOSPC) rejects
  `done` before `o.kill` runs, so the build runs on unwatched.
- **Then:** after cargo exits, `await watchdog?.done` (`scripts/cargo-project-build.ts:551`) throws. That skips the handler removal,
  the post-exit `killGroup`/`killBuildProcesses` and the tree's removal. The process exits on an uncaught error, with no mark.
- **Why it matters:** an oracle side's error output would then be cacheable. I confirmed that Bun 1.4.4 reports the rejection and goes
  on running until the `await`.
- **Likelihood:** at a 4 GiB floor a small write rarely fails.
- **Fix:** catch the record error, kill anyway, and return `stopped` with the error in the reason (fail closed).

**N3 (low). Any watchdog stop on the host during a gate suite stops the gate.**
- **Why:** records carry no gate identity, and `watchdogStopsSince` filters by time only.
- **How it happens:** a `cargo-build` or `cargo-smoke` oracle build that a lane started before root created `GATE_RUNNING`, or one
  started with `RUST_TS_GATE_RUN` exported (N4), can be stopped mid-gate. The gate then stops with "watchdog stop" at whatever suite
  is running.
- **Impact:** this fails closed and costs only a re-run. Writing `RUST_TS_GATE_RUN` into the record's `what` would let a later batch
  name the source; the gate should still count unknown stops.

**N4 (low). The `GATE_RUNNING` exception trusts any `RUST_TS_GATE_RUN` value, and `GATE_RUNNING` is a manual marker.**
- `gate.ts` never creates `GATE_RUNNING`; only root does, by hand, as `subject-bin-bench.ts` assumes. So "one heavy build at a time"
  against a lane holds only when root made the file.
- `underGate` is `RUST_TS_GATE_RUN !== undefined`, not a comparison with a run id or pid.
- **Impact:** host safety only. Headroom and battery still apply, and nothing scores differently.
- **Suggestion:** have `gate.ts run` write `GATE_RUNNING` with its run id and pid, and remove it at the end. The harness then compares
  `RUST_TS_GATE_RUN` with it.

**N5 (low). Host inputs D15 does not fully close.** None is present on this host today.
- **`LIBRARY_PATH` is passed** into cargo's built environment. It is a library search path for the linker, which is exactly the
  kind of host leak D15 is about. It is keyed (`hostToolsId`), and a Homebrew dylib would show in `otool -L`, but dropping it is
  simpler (SDK libraries come through `xcrun`).
- **`hostToolsId` runs `cc -v`** with the caller's `PATH`, while `cargo-build` builds with `/usr/bin/cc`. A caller with another `cc`
  first on `PATH` keys the wrong compiler. Here `cc` is `/usr/bin/cc`.
- **cargo's config discovery walks the ancestors of the source directory.** So a future `~/.cargo/config.toml` (or one in
  `~/Documents/`, `…/personal/` or `…/rust-ts/`) would change both projects' builds without changing any key. `CARGO_HOME`'s own
  config is the isolated one. This was already true for `rg-build`; none of those files exists now.

**N6 (low). `cargo-build`'s `inputDirs` holds only the source tree.**
- `rg-build` also keys `cargo/registry/src`, the unpacked crate sources. cargo does not re-check an extracted crate against
  `Cargo.lock`, so a change there is unkeyed for `cargo-build`.
- This may be a deliberate saving (cargo's lock has hundreds of crates). If so, say so in the suite's comment.

**N7 (info). `tool-oracles.test.ts`** (merged with harness-m8a-gate) reads `process.env.RUST_TS_DATA` directly.
- Without it, the real-tool test skips; with `RUST_TS_REQUIRE_PROBES=1`, it fails.
- The gate always sets `RUST_TS_DATA`, so this is not a lane problem.
- Falling back to `common.ts`'s `DATA` (which reads `.env.local`) would remove the surprise.

**N8 (info). Re-keying cost.** `PROJECT_BUILD_SOURCES` includes `lib/headroom.ts` and `lib/watchdog.ts`. So any change to the gate's
headroom code now re-keys `rg-build`'s oracle and every kept `rg`, and costs a port rebuild of rg (about 5 min) at the next run. That is
a safe over-approximation; noted so root expects it.
