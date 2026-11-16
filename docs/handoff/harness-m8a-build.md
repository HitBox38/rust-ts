# Handoff: harness-m8a-build (M8 wave 41, step 6; harness/scripts batch, needs its own independent review)

Branch `t3/cargo-project-build`, based on main `cac26189`. Plan: `docs/plan-m8.md` §4, §6, D8, D15, D17, D19, D20, D21, D23, §8 wave 41 step 6;
`docs/handoff/harness-m8a-gate.md` for the interfaces built on. No ported upstream code: no coverage numbers, no `// rustc:` markers, no
`unported(...)`. Nothing under `src/`, `tools/` or `harness/scope.json` is touched. Baselines, oracle outputs and every existing suite's
cases are unchanged; no `upstream.ts fetch`, no change to the oracle toolchain.

## Files touched

| File | What |
|---|---|
| `scripts/cargo-project-build.ts` (was `scripts/rg-build.ts`) | the project-build harness (D8): `PROJECTS` (`ripgrep`, `cargo`), `run`/`check`, keys, lock, sweep, kept binaries, preconditions, watchdog wiring, `runInGroup` |
| `scripts/cargo-project-build-rustc.ts` (was `scripts/rg-build-rustc.ts`) | the `RUSTC` wrapper; records a compiler's signal (note 4) |
| `scripts/lib/cargo-project-build.ts` (new; the build half of `scripts/lib/rg-build.ts`) | pure parts: report lines, `-sys` and `otool` sections, `builtPathRefusal`, `cargoConfigsAbove`, `markedPids`, `signalNumber`, both no-result marks |
| `scripts/lib/cargo-smoke.ts` (new, review fix N1) | `normaliseSmokeStream`, keyed by `cargo-smoke` only |
| `scripts/lib/input-dirs.ts` (new, re-check fix R1) | `inputDirsText`: what `Suite.inputDirs` adds to the oracle cache key; a symlink to a directory is keyed by its link text. `scripts/difftest.ts` `inputDirsHash` calls it |
| `scripts/lib/rg-behaviour.ts` (the behaviour half of `scripts/lib/rg-build.ts`) | unchanged functions, moved |
| `scripts/lib/watchdog.ts` (new) | D20's watchdog |
| `scripts/cargo-smoke.ts` (new) | `cargo-smoke`'s two sides |
| `scripts/rg-behaviour.ts` | uses the harness; notes 2, 3, 5, 6 |
| `harness/suites.ts` | `Suite.runFirst`; rg suites point to the harness; `cargo-build`, `cargo-smoke` registered; N5 comments |
| `scripts/gate.ts` | `gateSuiteOrder` (`runFirst`), `oracleRuns` for the new scripts, `RUST_TS_GATE_RUN` |
| `scripts/criteria.ts` | header comment only (N5) |
| `scripts/lib/headroom.ts` | `recordWatchdogStop`'s doc states N2's contract (no code change) |
| Tests | `scripts/lib/cargo-project-build.test.ts` (new, takes the build tests of `rg-build.test.ts`), `scripts/lib/rg-behaviour.test.ts` (the rest of `rg-build.test.ts`), `scripts/lib/watchdog.test.ts` (new), `harness/m8a-suites.test.ts` (new), `harness/m7d-suites.test.ts` (rg-build's argv gains `--project ripgrep`; the `uncachedOracle` list gains the two cargo suites) |

## 1. D8: one project-build harness

`bun scripts/cargo-project-build.ts run --project ripgrep|cargo --side oracle|subject -- <compiler argv>`. A `Project` names what differs:
cargo's argv, profile, binary, header, root and its name in the report, environment (inherited minus the scrubbed variables, or built),
whether the tree is kept, the D15 report sections, the D20 headroom class and the no-result mark. Everything else is one code path: the
report format, the key (`binKey`, `projectOracleKey`), the lock (`<root>/<suite>.lock`), the sweep and the kept-binary rules
(`bin/<side>/<key>/<binary>` + `stamp.json`, `ensureBinary`).

**ripgrep keeps every path and every byte of its report**: tree `$RUST_TS_DATA/ripgrep/target/rg-build`, lock `rg-build.lock`, wrapper
`rustc-wrap-build.sh`, kept tree `kept/rg-build/<side>`, cargo argv, header line, environment (the caller's minus `SCRUBBED`). Its keys
change, since the harness's files changed: see §6.

### harness-m7d re-check notes 1-6 and w40t-audit N5, N6

1. **The sweep** (`killBuildProcesses`, lib `markedPids`; also w40t N6). The tag is `CPB_TREE=<tree>#<nonce>`, with a nonce made per build.
   - It is kept in `<lock>.nonce`, so the next build's start can sweep a dead build's leftovers.
   - Matching uses two `ps` listings, with `-E` and without. The argv prefix is cut off, and the tag must be one whole entry of what is
     left, so the argv alone never matches (a Bun process, or a platform binary such as `/bin/sh`).
   - A pid whose argv changed between the two listings is "unsure". The sweep lists again, up to three times, and never kills an unsure pid.
   - **Limit:** `FOO='a CPB_TREE=<tag> b'` still matches, because `ps -E` text cannot tell it from two variables. With the nonce, only a copy
     of a live build's exact tag does that.
2. **Prune by last use.** `ensureBinary` and `ensureRgtestBinary` touch a kept key directory when they hand it out (`touchKey`).
   `pruneKeys` counts age from the mtime, so it now measures time since last use. It also skips an entry that vanished mid-scan.
3. **The uncached-error race.** These no longer surface as an uncaught `ENOENT`:
   - `readStamp` that cannot read is "no stamp", so the caller takes the lock and looks again;
   - a failed spawn of `rg` in a query, or a failed copy of `rg` or the test binary in rgtest, is `NO_RESULT_MARK`.
4. **Signal exit.** The wrapper records a killed compiler's `signal`, and still exits 101 for cargo.
   - SIGKILL, SIGTERM, SIGINT or SIGHUP (killed from outside) makes the build *interrupted*: no report, no stamp, tree deleted, exit 128 + n.
   - **Decision:** SIGSEGV, SIGABRT, SIGBUS and the like stay a crash (the call's 101, a stamp). They are the compiler's own fault and
     deterministic, so "interrupted" would rebuild them every time.
   - Unchanged: the call line in the report does not show the signal.
5. **SIGHUP** is handled with SIGTERM and SIGINT. **rgtest's two `Bun.spawnSync`** calls (the oracle's test-binary build, and each side's
   run) now go through `runInGroup`:
   - the program runs in its own process group (`perl setpgrp; exec`);
   - on a timeout or a signal the group gets SIGTERM, then SIGKILL after 3 s;
   - whatever is left of the group is killed once the program ends;
   - an interrupted run exits 128 + n with the mark.
6. **Signal numbers** come from `os.constants.signals` (`signalNumber`), so SIGHUP is 129, not 128 + 0.

- **N5:** the stale "report only" text is fixed in `harness/suites.ts` (the M7d block comment; `rg-behaviour-rgtest` and `pm-self`
  descriptions) and in `scripts/criteria.ts`'s header. Every M7a–M7d suite named there now has a baseline (checked), so no `--suites` is needed.
- **N6:** note 1 above.

## 2. D15 (project `cargo`)

- **Command:** `cargo build --locked --offline -j1 --features all-static --target-dir $RUST_TS_DATA/cargo-src/target/cargo-build`. It runs
  in `cargo-src/cargo-<commit>` with `CARGO_HOME=cargo-src/cargo-home` (tools-prep-m8's setup), dev profile, binary `debug/cargo`.
- **Built environment:**
  - Only these pass from the caller: `HOME`, `TMPDIR`, `USER`, `LOGNAME`; `SDKROOT` and `DEVELOPER_DIR` (both keyed in
    `builtHostToolsId`); `RUST_TS_*` and `BUN_*` (the port's own). `LIBRARY_PATH` no longer passes (review N5, §9).
  - `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
  - Set as for ripgrep: `CARGO_INCREMENTAL=0` and `GIT_CEILING_DIRECTORIES`.
  - So no `CARGO_*`, `OPENSSL_*`, `PKG_CONFIG*`, `CC`/`CFLAGS`, `LIBGIT2_*` or deployment target reaches a `-sys` build script.
  - **Decision:** an allowlist rather than rg's denylist, because D15 is about host inputs leaking in. ripgrep keeps its denylist (its
    report must not change).
- **`builtPathRefusal`:** the built `PATH` must hold no `pkg-config`, and no `curl-config` except the OS's `/usr/bin/curl-config`. Checked
  before every cargo build. This host has neither (`/opt/homebrew/bin` has no `pkg-config`; Homebrew's curl is keg-only).
- **Report additions** (after rg's sections):
  - `-sys build scripts:` gives, for each `build/<pkg>-sys/<hash>/run/stdout` (and the old layout), its `cargo:` lines with roots named. It
    drops `rerun-if-*`, which name what a script watches, not what it found. Link lines and `DEP_*` metadata are kept.
  - `otool -L cargo:` lists the built binary's dylibs.
- **Key:**
  - both: the harness's sources and the project's host tools (`Project.hostTools`);
  - for cargo (after review N5, §9) that is `builtHostToolsId`. For `cc`, `ld`, `xcrun`, `make` and `perl` it takes the path the built
    `PATH` resolves and the tool's output; it also takes the SDK version, the OS build, and `SDKROOT`/`DEVELOPER_DIR`, all run with the
    built environment. The caller's `PATH` never enters it. `projectOracleKey` and `binKey` also take the cargo commit;
  - ripgrep keeps `hostToolsId` (the caller's tools, which its inherited environment uses).
- **Report:** the header names `--features all-static`, `-j1`, `CARGO_INCREMENTAL=0` and the built `PATH`.
- **D17:** the target tree is deleted after the report. Only the binary (`cargo-src/bin/<side>/<key>/cargo`) and the logs
  (`cargo-src/kept/cargo-build/<side>-logs`) stay.

## 3. D20: preconditions and the watchdog

- **Preconditions** (`preconditionRefusal`; only for a project with a headroom class, so cargo):
  - AC power (`batteryRefusal`);
  - no `$RUST_TS_DATA/tmp/GATE_RUNNING` unless `RUST_TS_GATE_RUN` is set;
  - `headroomRefusal("heavy-build")`: 20 GiB free, swap under 4 GiB, pressure not critical.

  A refusal builds nothing and returns `{ refused }`. The command prints `cargo-harness: no result: the build was not started: …` and exits 1;
  the mark means it is never cached.
  - `bun scripts/cargo-project-build.ts check --project cargo` runs only these checks. Here it prints:
    `ERROR: cargo-build: host headroom (… heavy-build …): 6.9 GiB of swap in use, not under 4 GiB`.
  - `RUST_TS_GATE_RUN` is set by `gate.ts run` on its own environment right before the suites, after the static steps, so no unit test
    inherits it.
- **The watchdog** (`scripts/lib/watchdog.ts`) runs **inside** the harness process, beside cargo:
  - It polls every 5 s through `readHeadroom` with the real `HostReaders`.
  - It stops the build at once if free disk is under 4 GiB, or once pressure has been critical (4) for 60 s.
  - **It writes the stop through `recordWatchdogStop` before it signals cargo's group.** The record therefore exists before the build process
    exits, and so before the process difftest waits on exits (review harness-m8a-gate N2). The gate's post-suite read cannot miss it.
  - The group then gets SIGTERM, then SIGKILL after 3 s, then the sweep. The build returns `{ stopped, record }`: no report, no stamp, tree
    deleted, the mark, exit 1.
  - **Decision:** a rule it cannot read is no stop at first, but 60 s of unreadable readings in a row is a stop (fail closed, slowly). One
    hung `sysctl` is not a full disk, and a blind watchdog protects nothing.
  - **Decision:** ripgrep gets no watchdog or preconditions, since D20 puts rg-build outside it. Adding them would let rg-build stop a gate.
- **`Suite.runFirst`** (D20 "cargo-build runs first"): `gateSuiteOrder` runs the `runFirst` suites first, then the others, then the heavy
  ones. `--skip-heavy` still drops a heavy `runFirst` suite.

## 4. The suites (both `neverProtect`, D19, D23; neither has a baseline, so a gate runs them only via `--suites`)

| | `cargo-build` | `cargo-smoke` |
|---|---|---|
| Command | `cargo-project-build.ts run --project cargo --side …` | `cargo-smoke.ts --step <id> --side … --dir <tmp>/rust-ts-cargo-smoke/<hash> -- <compiler>` |
| Cases | 1 (`cargo-<commit>`) | 12 |
| Fields | heavy (`rssBudgetMb` 14 GiB: the `cargo` crate took 12,450 MiB), `headroom: "heavy-build"`, `runFirst`, `inputDirs` = the source tree and `cargo-home/registry/src` (review N6, §9) | `caseLock` per case; no `headroom` (not in D20's table) |
| Limits | subject 4 h, oracle 1 h | subject 30 min, oracle 1 h (it may build the oracle's cargo) |
| Mark | `cargo-harness: no result:` (`cargoNoResultReason`, `uncachedOracle`) | same |
| Criterion | 100% (report) | 100% (report) |

- **`neverProtect` text:** "plan-m8 D19, D23 (root's decision 2026-11-15 "M8 kept caches vs headroom"): a report until …; root clears it
  in a reviewed harness batch".
- **cargo-smoke (§4b)**:
  - **The cargos:**
    - The oracle side runs the cargo **the oracle's rustc built from the pinned source**: `ensureBinary(cargo, "oracle")`. If none is
      kept, it builds one, under D20's preconditions and watchdog.
    - The subject side runs `cargo-build`'s kept port-built cargo. It **never builds it**, since that is heavy; with none kept it exits 1
      with a line naming the key.
    - A port `unported` stamp gives exit 70.
  - `RUSTC` is the oracle's rustc on both sides.
  - **Steps:** `--version`, `-vV`, `new --bin hello`, `build`, `run`, `test -- --test-threads=1`, `build --release`, `metadata
    --format-version 1`, `tree`, `clean` (after a build), then ripgrep's `check --locked --offline -j4` and `tree --locked --offline`.
  - **Decision: `-vV` added.** It names the libgit2, libcurl and OpenSSL the binary carries, which is D15's point.
  - **Decision:** `--test-threads=1`, so libtest's order is fixed.
  - **Decision:** `CARGO_INCREMENTAL=0`, so no session-dir names leak into the listings.
  - **Environment:**
    - The case directory is in the temp directory, outside any git repository (so `cargo new` inits its own repository with libgit2);
      `refuseGitAbove` checks this.
    - The built `PATH`; `HOME`, `CARGO_HOME` and `TMPDIR` in the case directory.
    - ripgrep's steps use rg's `CARGO_HOME` while holding `rg-build.lock`.
  - **Normalised** (`normaliseSmokeStream`):
    - roots named: `realpath` of the case directory, since cargo prints `/private/var/…`;
    - thread id and libtest time masked (`maskProgramOutput`);
    - the `Finished` time masked;
    - `Compiling`/`Checking` lines sorted in place.
  - **Listings:** names only for target directories; names and bytes for what `cargo new` made.
- **Mechanics run with the oracle component's cargo as a stand-in** (`runStep`, scratch script; not a suite run):
  - all 12 steps ran in 0.0–3.7 s each;
  - `test` exits 101 with one passing and one failing test;
  - `-vV` shows `libgit2: 1.9.6 (sys:0.21.0 vendored)`, `libcurl: 8.7.1 (… system ssl:(SecureTransport) LibreSSL/3.3.6)` and `ssl: OpenSSL 3.6.3`;
  - no `/private` path is left after normalisation.

## 5. Tests (all in the runner unit step; D13)

| File | Tests | Wall |
|---|---|---|
| `scripts/lib/cargo-project-build.test.ts` | 17 | 2.5 s alone |
| `scripts/lib/watchdog.test.ts` | 8 | 0.1 s |
| `harness/m8a-suites.test.ts` | 1 | 0.4 s |

The four child processes of `cargo-project-build.test.ts` start when the file loads. Total added: about 3 s, within D13's 10 s.

- **`scripts/lib/cargo-project-build.test.ts`:**
  - the moved build tests (cargo stderr, calls and exit, artifacts);
  - the no-result marks: each suite's own only;
  - `signalNumber`;
  - `sysBuildScriptLines`, `otoolLines`, `builtPathRefusal`, `normaliseSmokeStream`;
  - `markedPids` on fake `ps` text: argv-only, platform binary, longer value, other nonce, prefixed name, unsure pid, self;
  - in children:
    - pruning by last use;
    - an unreadable stamp;
    - the preconditions on fake hosts: AC, gate running, under the gate, each headroom rule, the built `PATH`; ripgrep never checked;
    - the real sweep: only the tagged environment entry is killed; another nonce, a longer value, the old `RGB_TREE` name, the argv-only
      Bun and `/bin/sh` all survive;
    - `runInGroup`: SIGHUP to the runner kills a backgrounded grandchild;
    - **a real oracle build of a tiny `-sys` project through `buildSide`**:
      - with room: the report's `-sys` and `otool` sections, the kept binary, `ok` stamp, tree deleted, logs kept;
      - with fake free disk at 1 GiB: the build is stopped, one stop record, no tree.
- **`scripts/lib/watchdog.test.ts`:**
  - D20's numbers;
  - each rule at its edge, and a dip resets the pressure timer;
  - unreadable for 60 s;
  - `startWatchdog`:
    - **the record exists when `kill` is called (N2)**, the gate's `watchdogStopsSince` finds it, and there is one kill;
    - pressure stops at the 13th 5 s poll;
    - `end()` ends a calm one;
    - throwing or hanging readers don't crash it.
- **`harness/m8a-suites.test.ts`:**
  - the two suites' fields and no baseline file;
  - their commands, `inputDirs`, cwd, case locks, steps and keys;
  - `undeclaredRuns` is empty and `oracleRuns` is `rustc`;
  - the cargo mark is UNSTABLE for the cargo suites only;
  - `gateSuiteOrder` on fakes and on real suites (`cargo-build` first, `rg-build` heavy last).
- **Checks:**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test ./scripts ./harness` (`RUST_TS_REQUIRE_PROBES=1 CI=true`, one process): 676 pass, 1 fail, which is not this batch's:
    `tool-oracles.test.ts` reads `RUST_TS_DATA`, which `bun test` does not load from `.env.local`. With `RUST_TS_DATA` set, as the gate
    sets it, it gives 13/13.

## 6. Proof: rg-build, rg-behaviour and rg-behaviour-rgtest, before and after

**Method.** `proof.ts` (scratch) runs each suite's own `oracle` and `subject` commands from `SUITES`, as difftest does: the suite's cwd,
`caseEnv`, every case, in turn. It keeps stdout, stderr and exit per case.
- **Before:** main's code (`cac26189`) in a scratch detached worktree.
- **After:** this branch's commit in this worktree.

Results are under the scratch directory (`before/`, `after/`).

| | before (main) | after (branch) |
|---|---|---|
| rg-build oracle / subject | 23 s / 328 s; oracle = subject byte for byte (752-line report, exit 0) | 22 s / 340 s; oracle = subject byte for byte |
| rg-behaviour (63 queries) | 9 s / 41 s; 63/63 oracle = subject | 9 s / 40 s; 63/63 oracle = subject |
| rg-behaviour-rgtest | 2 s / 2 s (kept test binary); oracle = subject | 17 s (the oracle test binary rebuilt for the new key, through `runInGroup`) / 2 s; oracle = subject |

**Before against after, every file (stdout, stderr, exit) of every case, both sides: 0 differ** (rg-build 1 case, rg-behaviour 63,
rg-behaviour-rgtest 1). rg-build's protected report is byte-identical. The after run was on the committed tree (`125ee8fb`), clean. An
earlier after run that I stopped with SIGTERM during the port's build of rg (to rerun on final code) left no process with the tag, no tree,
and no lock: the interruption path on a real build. Free disk stayed at 24-25 GiB throughout.

**Why the keys change, and what that costs.**
- **Oracle cache.** Every rg suite's oracle key hashes the harness's sources, which are now different files. The first difftest or gate
  after the merge re-runs the rg oracle sides once (rg-build about 25 s; rg-behaviour builds nothing new). No cached output is wrong, only
  re-keyed.
- **Kept binaries.** The kept `rg` and rgtest-binary keys change the same way:
  - the first run builds the oracle `rg` (about 25 s) and the oracle test binary (about 1 min, `-j4`);
  - and the port's `rg` for the root checkout's compiler path (about 5 min), as after any harness change;
  - old keys are pruned after 3 days unused.

## 7. What waits on host (D20: needs 20 GiB free and swap under 4 GiB; this host has 24 GiB free and 6.9-7.2 GiB of swap in use)

Run each from the root checkout, on AC power, with nothing else heavy running. Run one at a time, in this order. Each step needs
`bun scripts/cargo-project-build.ts check --project cargo` to print `ok` first.

1. **`all-static`'s first oracle build, timed** (D15: `openssl-src`'s C build via `make` is unmeasured):

   ```sh
   S=$(bun -e 'const o = await import("./scripts/lib/oracle.ts"); console.log(o.oracleSysroot())')
   /usr/bin/time -l bun scripts/cargo-project-build.ts run --project cargo --side oracle -- "$S/bin/rustc" > $RUST_TS_DATA/tmp/cargo-build-oracle.txt
   ```

   - Expect exit 0, a report with `cargo built`, the `-sys build scripts:` lines and `otool -L cargo:`.
   - `otool -L` should show only `/usr/lib` and `/System` dylibs: OpenSSL and libgit2 vendored, libcurl the OS's.
   - Record wall, user and max rss. If it is far over the 1 h `oracleTimeoutMs`, raise that in a reviewed batch.
2. **The `cargo-build` proof on both sides:**
   - Run `bun scripts/difftest.ts --suite cargo-build`. That is the oracle from step 1's cache key or a re-run, then the port at `-j1`, 40-50 min.
   - The watchdog runs. A stop is recorded under `$RUST_TS_DATA/watchdog-stops/`, and is the answer if it happens.
   - Expect `cargo-fix-a`'s three crates to compile through the port.
   - Read the first difference in the run's `diffs/` file.
3. **`cargo-smoke`:**
   - Run `bun scripts/difftest.ts --suite cargo-smoke` after step 2 has kept a port-built cargo of the current key.
   - The oracle side reuses step 1's binary if the key is unchanged.
4. **The slowdown measurement** (D20's risk, re-check2 P4: `cargo-build` first reverses heavy-last):
   - Run a gate with every protected suite plus the two:

     ```sh
     bun scripts/gate.ts run --suites $(ls harness/baseline | sed 's/\.txt$//' | paste -sd, -),cargo-build,cargo-smoke
     ```

   - `cargo-build` runs first, by `runFirst`.
   - Compare each suite's `startedAt`/`endedAt` in its `gate.json` with the last accepted gate's. Above all, compare the heavy suites and
     any case near its limit.
   - The `headroom` record has the reading before `cargo-build`.
   - The run is valid for acceptance like any gate: `neverProtect` suites are skipped by `accept`.

## 8. For root / integration

- **After the merge:** the first gate re-runs the rg oracle sides once and rebuilds the kept rg binaries (§6).
- **New on-disk state:**
  - `$RUST_TS_DATA/ripgrep/rg-build.lock.nonce`, one line;
  - later `$RUST_TS_DATA/cargo-src/{target,kept,bin}/`, `cargo-build.lock`, `cargo-build.lock.nonce`, `rustc-wrap-build.sh`;
  - `<tmp>/rust-ts-cargo-smoke/`.
- **Not done here:**
  - an M8a group in `scripts/criteria.ts`. The suites carry their own criterion lines; the group belongs with the batch that promotes
    them (D23);
  - harness-m8c's `cargo-testsuite`, which will use `cargo-build`'s kept port binary through `ensureBinary(PROJECTS.cargo, "subject", …,
    { build: false })` as cargo-smoke does.
- **Scratch I made and removed:**
  - the detached main worktree (`git worktree remove`);
  - my `<tmp>/rust-ts-cargo-smoke` case directories;
  - the subject `rg` keys my runs built with this worktree's and the scratch worktree's compiler paths. No other agent can reuse them,
    because the key has the compiler path.

  Removed: subject keys `0474ce9fadda8742` and `e4b02082b00c59ba`, and oracle key `8ae4ebd65d702133` (from the stopped run, on
  intermediate code). After the review fixes the keys changed again (§9). I removed the then-stale oracle key `9c619b629b2f2665` and
  rgtest-binary key `8ceb12502bdcbf83`. I kept `bin/oracle/4f4206ec6f471206` (the review fixes' code, from §9's oracle run), which root's
  first run after the merge reuses. The rgtest binary is rebuilt there (about 1 min).

## 9. Review fixes (docs/reviews/harness-m8a-build.md at `2b21b205`, branch `t3/review-harness-m8a-build`: PASS WITH NOTES)

### N1 (fixed): every module the split made is keyed by every suite whose output it shapes
- **`scripts/lib/rg-behaviour.ts`** (`maskRgTimes`, `rgtestSections`, `corpusBytes`, `ancestorIgnoreFiles`) is now in the oracle keys of
  `rg-behaviour` and `rg-behaviour-rgtest`. On main it was in `lib/rg-build.ts`, which `RG_BUILD_SOURCES` keyed for all three rg suites.
- **Audit of the split's files:**
  - `lib/cargo-project-build.ts`: in `PROJECT_BUILD_SOURCES`, so it is in all five suites' keys (each key includes `projectOracleKey`).
  - `lib/rg-behaviour.ts`: the two behaviour suites, as above. It shapes nothing in `rg-build`.
  - `lib/unstable.ts` was imported by `lib/cargo-project-build.ts` only for cargo-smoke's normaliser. That put it in rg-build's import
    closure unkeyed. The normaliser moved to a new `lib/cargo-smoke.ts`, and `cargo-smoke`'s key has both files.
- **Keys are now declared once.** `harness/suites.ts` `ORACLE_KEY_FILES` lists, per project-build suite, every file its key hashes. Since
  re-check R2 (§10), all five keys are computed from it.
- **The new test** (`harness/m8a-suites.test.ts`, "every module a project-build suite's command loads is in its oracle key…"):
  - It walks each command's import closure from its script, plus the `RUSTC` wrapper for any command that builds.
  - It fails on any module that is neither in that suite's `ORACLE_KEY_FILES` nor on a short `UNKEYED` list, each entry with a reason:
    `common`, `env`, `case-lock`, `host-state`, `oracle`, `toolchain`, `tool-oracles`, `llvm-tools`, `rg-check.ts`, `tools-src.ts`,
    `lib/tools-src.ts`.
  - It names the split's three modules explicitly, and fails on a stale `UNKEYED` entry.
  - **Checked:** with `lib/rg-behaviour.ts` removed from `rg-behaviour-rgtest`'s list, it fails naming
    `rg-behaviour-rgtest: scripts/lib/rg-behaviour.ts`.
  - **By hand:** appending one line to `lib/rg-behaviour.ts` changed both behaviour keys and left `rg-build`'s alone.

### N2 (fixed): a stop record that cannot be written still stops the build
- `startWatchdog` catches a failed `recordWatchdogStop` and still kills the group. `stopped.reason` carries the error, and
  `stopped.file` is `(not written)`.
- Nothing else in the loop throws, so `done` never rejects. `buildLocked` guards the `await` anyway: if it ever threw, the build counts as
  stopped, and the handler removal, the group kill, the sweep and the tree's removal all still run. The command ends by
  `exitWithoutReport`, with the mark and exit 1, so nothing is cached.
- **What is left:** a stop that was never recorded is not seen by the gate. The suite's case is still non-MATCH (or UNSTABLE on the oracle
  side), so nothing is lost or protected wrongly.
- **Tests:**
  - `watchdog.test.ts`: the stop directory is blocked by a file, there is one kill, and the reason names the error;
  - `cargo-project-build.test.ts`: a real tiny build with the stop directory blocked ends `stopped`, with `(not written)` and no tree.

### N5 (fixed): host inputs
- **`LIBRARY_PATH`** is gone from cargo's built environment. No other linker or search-path variable passes: the environment is an
  allowlist, and `DYLD_*`, `CPATH`, `C_INCLUDE_PATH`, `PKG_CONFIG_PATH` and the like were never on it. `SDKROOT` and `DEVELOPER_DIR` stay:
  they pick the SDK and developer directory that `xcrun` and `cc` use, and both are keyed.
- **Host tools keyed as the build finds them.** `Project.hostTools`: cargo uses `builtHostToolsId` (§2, Key); ripgrep keeps `hostToolsId`,
  since its build inherits the caller's `PATH`, and its value is unchanged. `buildToolsId` is folded into `builtHostToolsId`.
- **Cargo config outside the pinned source.**
  - `preconditionRefusal` now refuses both projects while any `.cargo/config.toml` or `.cargo/config` exists in a directory above the
    source directory, or a `config.toml`/`config` exists in the project's CARGO_HOME (lib `cargoConfigsAbove`).
  - The source tree's own `.cargo/config.toml` (ripgrep and cargo both have one) is pinned source, so it is not refused.
  - cargo-smoke checks the same for the directory each step runs in.
  - None exists on this host. `~/.cargo` holds `credentials.toml` and no config.
- **Tests:**
  - `cargoConfigsAbove` (pure);
  - both projects refused with a config above the source or in CARGO_HOME (fake host);
  - with a fake `cc` first on the caller's `PATH`, `builtHostToolsId` is unchanged while `hostToolsId` changes;
  - the tiny real build's `-sys` script, run with `LIBRARY_PATH=/opt/leak/lib` in the caller's environment, prints
    `cargo:library_path=None`.

### N6 (fixed)
- `cargo-build`'s `inputDirs` is the source tree plus `cargo-home/registry/src`, as `rg-build` keys ripgrep's crates. `requireCargo`
  creates the directory if it is missing, so a fresh setup can be keyed.
- Cost: hashing about 560 MiB once per difftest process. The first oracle build unpacks any missing crates, so the key may change once
  after it, as rg-build's did.

Left as root directed: N3 and N4 (root's queue), N7 and N8 (information).

### Keys, and the rg proof after these fixes
| Suite | before the fixes (`868fec8c`) | after |
|---|---|---|
| `rg-build` | `c82ca82d2dc4f64624d252b4fbc80ecb47a65cf2` | `a21ffa4a9302a30f3ee833846e9ee0325377a9c6` |
| `rg-behaviour` | `daff9d601bcc4c8d279e161213c51a62ddcfdd09` | `0a082fa19d34a1dacac4b7fe7852f22e281e3455` |
| `rg-behaviour-rgtest` | `3e31a61fc3e2f32b518cffacc81e0157852db2a0` | `7416af8e0bec21a69266a5ab9e3c91e7ddcde64e` |
| `cargo-build` | `5b3fcc566f9367f72c23dd1f60fb1d56aac96a21` | `d3bb989051792c9e76b3f35eb77765d5f84aee6a` |
| `cargo-smoke` | `8facb13ed9cad781bb118f881cf9b81de66acab3` | `c39bf499890d8ae0cd07350d821bf54741c95fbc` |
| kept oracle `rg` (`binKey`) | `9c619b629b2f2665` | `4f4206ec6f471206` |

- **Why every key moves:**
  - `rg-build` and both cargo keys move only because the harness's own files changed: `PROJECT_BUILD_SOURCES` contents. The cargo keys
    also move because their host-tools part changed (N5).
  - The two behaviour keys also gain `lib/rg-behaviour.ts` (N1).
- **What could change rg's output:** only the new config refusal, which every rg build now passes through. No config exists, and the report
  code, ripgrep's environment and `hostToolsId` are unchanged. So I re-ran **rg-build's oracle side only**, through the suite's own command
  (32 s, exit 0). Its stdout, stderr and exit are **byte-identical** to main's (`cac26189`) from §6.
- **Checks:**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test ./scripts ./harness` (`RUST_TS_DATA` set, as the gate sets it; `RUST_TS_REQUIRE_PROBES=1 CI=true`): **680 pass, 0 fail**.
  - The touched test files take 3.3 s, 0.2 s and 0.4 s alone.

## 10. Re-check fixes (docs/reviews/harness-m8a-build-recheck.md at `3519d3d7`, branch `t3/recheck-harness-m8a-build`: PASS WITH NOTES)

### R1 (fixed): `cargo-build`'s oracle cache key threw `EISDIR`
- **Cause:** `scripts/difftest.ts` `inputDirsHash` read every non-directory entry. cargo's pinned source tree has 121 symlinks, and 93 of
  them point at directories (`tests/testsuite/cargo_remove/dry_run/in -> ../remove-basic.in/`, …). So `difftest --suite cargo-build`, and
  any gate reaching it, died before building.
- **Fix:** the walk moved to `scripts/lib/input-dirs.ts` `inputDirsText`, and `inputDirsHash` hashes what it returns.
  - A symlink that resolves to a directory, or to nothing, is keyed by its link text as `<path>\0-> <target>`, and never followed.
  - A symlink to a file is keyed by the file's contents, as before.
  - Both changed cases threw before, so only paths that could not be keyed change.
- **Every existing suite's key is byte-identical.** In a scratch worktree of main (`a591abc3`) I ran `bun scripts/oracle-keys.ts` over
  every registered suite, before and after applying only the R1 patch (the `difftest.ts` diff and `lib/input-dirs.ts`). Both dumps hold
  391,641 keys over all 85 suites, with no suite unlisted, and both have sha1 `709292dbcf918cb58021c15b834b1ce1427e8c9f`. `cmp` finds them
  identical. That includes every `inputDirs` suite: `check-core`, `check-core-bin`, `mir-core`, `check-alloc`, `rmeta-alloc`,
  `check-rg-host`, `check-rg-encode-mir` and the three rg suites. It is also the same sha1 as harness-m8a-gate's dump.
- **`cargo-build`'s key computes,** dry, with no build: `bun scripts/oracle-keys.ts --suite cargo-build` on this branch gives 1 key, no
  error, `27ec0fd679a5401624d5ccde54d90a43c0f93802`, in 7.2 s. That is mostly hashing the source tree and `cargo-home/registry/src`.
- **Test:** `scripts/lib/input-dirs.test.ts`.
  - A tree with files and a link to a file gives exactly the old walk's text (reimplemented in the test).
  - A link to a directory and a dangling link make the old walk throw. They are now keyed by link text, and retargeting a link changes
    its line.

### R2 (fixed): `ORACLE_KEY_FILES` feeds all five keys
- `tableKey(name, base, tail)` builds every project-build key from the table. It starts from `base` (`projectOracleKey`, memoized per
  project), adds the hashes of the entry's files beyond `PROJECT_BUILD_SOURCES` and any `tail`, and hashes them together. When there are
  neither, the key is just `base`.
- That is exactly how each key was built before: rg-build and cargo-build were `projectOracleKey` alone; rg-behaviour, rg-behaviour-rgtest
  (tail `"rgtest"`) and cargo-smoke were `hash([base, ...extra])`. **So no key's value changed:** all five oracle keys and the kept oracle
  `rg` key were the same before and after R1 + R2 (checked before R3's edit).
- **New test** in `harness/m8a-suites.test.ts`: "ORACLE_KEY_FILES feeds all five keys…".
  - Every entry starts with `PROJECT_BUILD_SOURCES`, so the table is each key's whole file list, which the module walk test reads.
  - For `rg-build` and `cargo-build` it changes the table in memory (no repo file is edited). Adding `lib/common.ts` (the re-check's
    demonstration), adding a temp file, and changing one byte of that temp file each give a new key. Restoring gives the original.
  - **Checked:** with `rgBuildOracleKey` put back to `projectOracleKey` alone, the test fails. With the fix it passes.

### R3 (fixed): the config refusal covers `rg-behaviour-rgtest`'s own cargo build
- `ensureRgtestBinary` checks `cargoConfigsAbove(<ripgrep source>, <its CARGO_HOME>)` before the oracle's `cargo test --no-run`. If a
  config exists it ends through `noResult`: the mark and exit 1, so nothing is cached. None exists here.

### Keys after this round
| Suite | after review fixes (`6245f5f6`) | now |
|---|---|---|
| `rg-build` | `a21ffa4a9302a30f3ee833846e9ee0325377a9c6` | unchanged |
| `rg-behaviour` | `0a082fa19d34a1dacac4b7fe7852f22e281e3455` | `32fda38317868a7fc6d9dcb38aca5cff30545c9e` |
| `rg-behaviour-rgtest` | `7416af8e0bec21a69266a5ab9e3c91e7ddcde64e` | `f3a2d768ab15a4da9ba96b6d97f8b8b2c5625ed4` |
| `cargo-build` | `d3bb989051792c9e76b3f35eb77765d5f84aee6a` | unchanged |
| `cargo-smoke` | `c39bf499890d8ae0cd07350d821bf54741c95fbc` | unchanged |
| kept oracle `rg` (`binKey`) | `4f4206ec6f471206` | unchanged |

- **Why two keys move:** only the behaviour keys change, because R3 edits `scripts/rg-behaviour.ts`, which both hash. Neither R1 nor R2
  moves a value. The kept rgtest binary's key also moves, for the same reason. Root's first run builds it (about 1 min, oracle, `-j4`).
- **Not re-run:** nothing in this round can change rg output. `cargo-project-build.ts`, its library and its wrapper are untouched, so
  rg-build's code is as at `6245f5f6`. The re-check ran rg-build's oracle side there and found it byte-identical to main (R4). R3's check
  ends the rgtest build only when a config exists, and none does. So I did not re-run rg-build.
- **Checks:**
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test ./scripts ./harness` (`RUST_TS_DATA` set, `RUST_TS_REQUIRE_PROBES=1 CI=true`): **683 pass, 0 fail**.
  - The new and changed test files take 0.4 s (`m8a-suites`) and 0.02 s (`input-dirs`).
  - The scratch main worktree is removed.
