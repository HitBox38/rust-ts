# Handoff: harness-m6b (harness batch, M6 wave 36; plan-m6 §3/§4, D7, A2, A9, A11; needs an independent review)

Branch `t3/b7211e9e`, base main `06fa2c65`. This is harness/scripts work only (A2). No port code under `src/` changed,
so there are no coverage changes, `// rustc:` markers, `unported(...)` calls or `// PORT:` decisions. No baseline, oracle
output, existing suite definition or existing oracle cache key changed; the proof is in "Verification". The two new
suites have no baseline file, so they are unprotected.

## Files touched

| file | change |
|---|---|
| `harness/compiletest.ts` | Proc-macro aux crates, built as host dylibs by the oracle, behind a new `uiFileCases(.., { aux: true, procMacro: true })`. Also: `auxTreeHasProcMacro` (case-set membership), `dylibName`/`getLibName` (runtest.rs `dylib_name`/`get_lib_name`), `CompileKind.hostTarget` (force_host's `--target`), `AuxStep.host`/`.procMacro`, `auxKey` (extracted unchanged from `buildAux`, exported for tests), `auxSteps` in the result, `uiOutputBaseDir` (runtest.rs `output_base_dir`), and the linker directory in host builds' `PATH`. The header has a new "Proc-macro aux crates" section. |
| `harness/suites.ts` | New M6 block: `pmCorpus`, `pmUiArgs`, `PM_UI_UNSTABLE`, and the suites `pm-ui` and `pm-expanded` |
| `harness/pm.test.ts` (new) | 10 tests, listed below |
| `scripts/unstable.test.ts` | Its pinned list of suites with an `unstable()` list gains `pm-ui` (one comment line plus the expected array) |

## 1. Proc-macro aux crates (task 1)

Existing machinery is reused: `planAllAux`/`planAux`/`buildAux`, the `$RUST_TS_DATA/aux/ui/<key>` cache, the
`.tmp-<pid>` build-and-rename, the `ERROR:` on a failed aux build, and `auxFiles` for `pinSessionEnv`. A new
`AuxCtx { procMacro, host }` is threaded through the planner. Its default (`NO_PROC_MACRO`) reproduces the old planning
exactly, including the order of rejects and the reject messages.

**Argv** follows compiletest at the pin (`src/tools/compiletest/src/runtest.rs`):
- `build_all_auxiliary` (runtest.rs:1274) handles builds, then bins, then `aux-crate`s, then `proc-macro`s last.
- For each `proc-macro:` crate, `build_auxiliary(.., Some(AuxType::ProcMacro))` (runtest.rs:1393) sets `force_host = true`.
- `make_compile_args` then builds the argv as follows:
  - `Emit::None`, `AllowUnused::No`, `LinkToAux::No`.
  - `--target=<config.host>`.
  - `-C prefer-dynamic`, unless the crate says `no-prefer-dynamic`.
  - `--out-dir <aux dir>`.
  - `host_rustcflags`. bootstrap passes the same `-Crpath -Cdebuginfo=0` for host and target, since lld is not
    overridden; `-Lnative=` is dropped, as for every ui suite.
- `build_auxiliary` then appends `--crate-type proc-macro`, `--extern proc_macro` and `-L <aux dir>`.
- No `--emit=metadata`: a proc-macro crate has to be a real dylib.
- The main compile, and an aux crate that uses the proc macro, gets `--extern <crate>=<aux dir>/<dylib_name>`. This is
  `get_lib_name(.., AuxType::ProcMacro)` with `std::env::consts` of the machine compiletest runs on: `lib<c>.dylib` on
  macOS, `lib<c>.so` on Linux, `<c>.dll` on Windows. `extern_modifiers` are kept.
- The main compile still gets `-L <aux dir>` (`has_aux_dir` counts proc macros).

`pm.test.ts` pins the full argv of one proc-macro aux build. It was checked by hand against the code above.

**Deviations from compiletest.** All of them come from running compiletest "as on x86_64-unknown-linux-gnu"
(plan-m2 D1: host = target = COMPILETEST_TARGET) on a different machine. A proc-macro dylib has to load into this
machine's rustc, and into the port under D7:
1. **force_host's target is the oracle's real host tuple** (`oracleHost()`, here `aarch64-apple-darwin`), not
   COMPILETEST_TARGET. The main compile still targets `x86_64-unknown-linux-gnu`, which makes it a cross-compile with a
   host proc macro, the normal rustc setup. Conditions such as `cross-compile` stay as before (false).
2. **Host-built crates.** These aux crates are built for the real host, and also without `--emit=metadata`:
   - an aux crate that is a proc-macro crate by its own `#![crate_type = "proc-macro"]` / `--crate-type proc-macro`;
   - every aux crate in a proc-macro crate's own aux tree (the dependencies it links);
   - in `procMacro` mode only, an aux crate with its own `//@ force-host`. compiletest builds that one for
     `config.host` too.

   The `force-host` rule was needed. In `tests/ui/proc-macro/meta-macro-hygiene.rs`, the proc macro `meta-macro.rs`
   does `extern crate make_macro`, which is a sibling `aux-build` with `//@ force-host`. Without the rule, the oracle
   failed with E0461 ("couldn't find crate `make_macro` with expected target triple aarch64-apple-darwin").

   A host-built `aux-crate` is named in `--extern` by compiletest's `get_lib_name` (`lib<c>.rlib` or the dylib name),
   not by the rmeta. Every other aux crate of the test stays a COMPILETEST_TARGET rmeta, as before. Example:
   `hygiene_example.rs` (a lib whose own aux is a proc macro) is an x86_64 rmeta, built with
   `--extern hygiene_example_codegen=<dir>/libhygiene_example_codegen.dylib`.
3. **`PATH` for host builds.** `auxEnv` uses the pinned `PATH` (`~/.cargo/bin`) plus the directory of `cc`, which is
   rustc's default linker driver on unix. Here that is `/usr/bin`. With only `~/.cargo/bin`, macOS cannot find `xcrun`
   or `cc` and the link fails. It is part of the aux key, like the rest of the environment. On Windows nothing is added:
   rustc finds the MSVC linker itself. That is untested; see §5.

**Cache key.** The key is unchanged: `auxKey` = the oracle build (`rustcDriverHash()`), the case id, and per step the
source path, argv (now including `--target=<host>`), whole environment (including the linker dir), source hash and the
files the source pulls in. The case argv names the aux dir, so the oracle cache key of every pm case follows any aux
change. Host builds run in `<key>.tmp-<pid>` and are renamed to the sibling `<key>`. `-Crpath`'s
`@loader_path`-relative path stays valid because both have the same parent; `otool -l` shows only the relative rpath.

**Case-set membership** (`auxTreeHasProcMacro`, directives only, never builds). A test (or revision) is in the set if
any of these holds:
- it has a `proc-macro:` directive;
- one of its `aux-build`/`aux-crate`/`aux-bin` crates is a proc-macro crate by crate type;
- such a crate appears anywhere in a nested aux tree.

Tests that match none of these are left out silently, so the pm suites' skip lists hold only proc-macro tests.

**Output base dir.** compiletest's `run` creates `output_base_dir` before any compile (runtest.rs:147). Build and run
modes compile with `-o build/…/<stem>/a`, and rustc's metadata temp dir needs that directory to exist. Without it, both
sides fail with `couldn't create a temp dir … rmeta<random>`. The random name made 50 of the 272 cases look
non-reproducible in my first oracle run. `pmCorpus` now creates `uiOutputBaseDir(id)` under the upstream checkout's
`build/` for each case. difftest's checkout check excludes `build/`, as it already does for the thir-print cases'
dep-info.

## 2. Suites (task 2): `pm-ui` and `pm-expanded`

Both suites are `milestone: "M6"`, single mode, cwd the upstream checkout, subject timeout 60 s, oracle timeout 300 s
(aux builds also 300 s, plus the usual retry). They have the subset `tests/ui/proc-macro` and the report-only `blessed`
(`uiBlessed`). Neither is heavy: the oracle takes p50 48 ms and max 120 ms per case on pm-ui, and RSS is small, so A11
needs no heavy/serial marking.

- **Cases** (`pmCorpus`, shared by both suites): `uiFileCases(collectUiTests("tests/ui"), "human", { aux, procMacro })`.
  The argv is compiletest's main compile with the parse-ui `-Zparse-crate-root-only` dropped (as `m3UiCorpus` does).
  The env is `NOCORE_ENV` plus the test's `rustc-env`/`unset-rustc-env`, with session variables pinned by
  `pinSessionEnv`, which scans the aux sources too.
- **`pm-ui`** (gate M6, `criterion` ≥ 95%, report only per A9):
  - The argv gets `--emit=metadata` (`pmUiArgs`), unless compiletest already passes `--emit metadata` (the check
    modes). It is appended for build and run modes, so nothing reaches codegen.
  - It compares stdout (proc macros print, e.g. `PRINT-ATTR`), stderr and exit.
  - One unstable case is listed (`PM_UI_UNSTABLE`): `tests/ui/resolve/proc_macro_generated_packed.rs`. It is a
    `known-bug` with `failure-status: 101` that ICEs in MIR building, and the message carries the OS thread id.
    difftest's own pattern would catch it too.
- **`pm-expanded`** (report only, the progress signal for pm-ui):
  - The same cases, with compiletest's argv plus `-Zunpretty=expanded`. No `--emit=metadata` is appended; the check
    modes still carry compiletest's own `--emit metadata`.
  - The appended `-Zunpretty=expanded` comes last, so it wins over a test's own `-Zunpretty` (e.g.
    `meta-macro-hygiene.rs`'s `expanded,hygiene`).
  - Nothing is written. No unstable cases.

**Case counts**:

| | count |
|---|---|
| cases (both suites) | **272** (264 files; 191 under tests/ui/proc-macro) |
| skipped | **12**: 10 `needs-unwind` (not evaluated by compiletest.ts; all in tests/ui/proc-macro: expand-with-a-macro, invalid-punct-ident-1/2/3, issue-36935, issue-59191-replace-root-with-fn, issue-76270-panic-in-libproc-macro, load-panic-backtrace, load-panic, nonfatal-parsing) and 2 `ignore-enzyme` (autodiff/visibility.rs, both revisions) |
| aux builds | 301 steps: 285 proc-macro crates, 2 other host-built crates, 14 COMPILETEST_TARGET rmetas. 183 distinct aux sources, 169 of them proc-macro crates. 272 aux dirs (one per case, keyed by case id as before), **139 MB** on disk |
| aux builds the oracle fails | **0** |
| making the cases | ≈ 13–18 s with a warm aux cache (it reads every tests/ui test's directives); the first build of all 272 aux dirs took ≈ 1–2 min |

The plan's figure was 272 files. This count is 264 files that yield 272 cases, plus 12 skips. The plan counted files
with `proc-macro` text; this count uses compiletest's revisions and ignores.

**Oracle outcomes**: every case was run twice on the oracle with the suite's argv, env and cwd. Scripts and outputs are
in `$RUST_TS_DATA/tmp/harness-m6b/oracle2*`.

| suite | outcome by declared mode | reproducible |
|---|---|---|
| pm-ui | check-pass 112 × exit 0, run-pass 51 × exit 0, build-pass 2 × exit 0, check-fail 106 × exit 1, check-fail 1 × exit 101 (the ICE above) | 271/272 (all but the listed ICE) |
| pm-expanded | check-pass 112, run-pass 51 and build-pass 2 × exit 0; check-fail: 81 × exit 1, 26 × exit 0 (errors from later phases, which `-Zunpretty=expanded` does not reach) | 272/272 |

No pass-mode test fails on the oracle, so the oracle builds and expands every case as compiletest expects.

## 3. Tests (task 3): `harness/pm.test.ts`

The tests run in a child process, as compiletest.test.ts does. All of them are skipped with a reason
(`test.skip("… (skipped: the oracle toolchain … is not installed …)")`) when `rustc +<pin>` is absent.

1. `proc-macro:` argv: the exact full argv of `test-macros.rs`'s aux build, with host and procMacro marks; the dylib and
   `.ok` exist; the main compile's `-L`, `--extern test_macros=<dir>/libtest_macros.dylib` and target. Without
   `procMacro`, the test is still skipped ("deferred to M6").
2. `dylibName` for darwin/linux/win32.
3. A `force-host` sibling aux plus a proc macro (`meta-macro-hygiene.rs`): both are host-built full builds;
   make-macro gets `--crate-type dylib`.
4. A proc-macro crate by `#![crate_type]` via `aux-build` (`missing-derive-1.rs` → `serde.rs`): host-built, no
   `--crate-type` (no-prefer-dynamic), no `--extern`.
5. A lib aux with a nested proc macro (`hygiene_example.rs`): the lib is an x86_64 rmeta with `--extern
   <codegen>=<dylib>`; the proc macro is a host dylib.
6. Membership: a non-pm aux test and a pm crate without aux produce no case and no skip.
7. `auxKey`: deterministic. It changes with the case id, argv, env and host step (the linker `PATH`); the `procMacro`
   label alone does not change it.
8. `uiOutputBaseDir`.
9. The suite definitions and `pmUiArgs`.
10. **A real one-case build in a temp dir**: the oracle builds `test-macros.rs` with the planned argv into a
    `mkdtemp` dir (empty stderr, exit 0, dylib present). Then the main compile, with `-Zunpretty=expanded` and the
    temp dylib, loads and runs it: exit 0, `PRINT-ATTR INPUT (DISPLAY): fn foo<…>() {}` on stdout.

## 4. Verification (`RUST_TS_AGENT=harness-m6b`)

- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=120000`: **120 pass, 0 fail**, 17 files. It was
  110 + 10 new; the one existing test needing a change was unstable.test.ts's pinned list.
- **Existing suites unchanged.** For all 51 existing suites I dumped, at base `06fa2c65` (a temporary worktree, since
  removed) and on this branch:
  - the fields (name, milestone, description, mode, timeouts, heavy, inputDirs, cwd, probes, criterion, miri,
    readsOnlyCaseFile, subset names);
  - `cases()` and `skipped()` in full;
  - `unstable()`;
  - the oracle and subject command of the first case (repo path normalised);
  - `oracleKey()`.

  Result: **0 differences** over 362,124 cases. No existing aux dir was re-keyed, since the aux-using suites'
  argv, which hold the aux keys, are identical.
- `bun scripts/difftest.ts --suite pm-ui --sample 50` (run `20261101-125158-harness-m6b-hw47`): **UNPORTED 49,
  UNSTABLE 1** (`proc_macro_generated_packed.rs`, listed); MATCH 0, DIFF 0, CRASH 0, TIMEOUT 0. All 49 UNPORTED stop
  at `rustc_metadata::host_dylib::dlsym_proc_macros (proc-macro dylibs, M6)`, so the port finds the dylib through
  `--extern` and reads its metadata, then stops where lane pm-host takes over. Criterion line printed: 0/50, "not met
  [sample/filter run]".
- `bun scripts/difftest.ts --suite pm-expanded --sample 50` (run `20261101-125235-harness-m6b-c4g5`): **UNPORTED 50/50**,
  all at the same `dlsym_proc_macros`.
- `bun scripts/difftest.ts --suite expanded --sample 200` (run `20261101-125312-harness-m6b-m5a4`): **MATCH 200/200**,
  identical statuses to gate-20261101-002620-root-q9z7 for all 200 cases.
- Neither pm run reported upstream-checkout changes (`upstreamChanges` absent); they only wrote under `build/`.

## 5. For root

1. **Decisions to record** (harness batch; please record with `state.ts record decision` if accepted):
   - (a) pm aux crates use force_host = the oracle's real host tuple, not COMPILETEST_TARGET;
   - (b) proc-macro crates by crate type, everything in a proc-macro's aux tree, and (pm mode only) `//@ force-host`
     aux crates are host-built full builds; other aux crates stay x86_64 rmetas;
   - (c) host builds get the `cc` directory appended to the pinned `PATH`;
   - (d) pm suites create compiletest's output base dir under the checkout's `build/`;
   - (e) pm-ui appends `--emit=metadata` only for non-check modes, and pm-expanded appends `-Zunpretty=expanded` to
     compiletest's argv.
2. **Not done here (outside the lane):**
   - `needs-unwind` is still not evaluated by compiletest.ts, so 10 pm tests are skipped. Evaluating it changes other
     suites' case lists and needs its own batch; harness-m6a noted the same for `needs-*`.
   - Windows: proc-macro dylibs there are `<c>.dll`, and a `-C prefer-dynamic` dll needs `std-*.dll` on the loader's
     search path (compiletest adds the host lib path to `PATH`). Untested here: there is no Windows host in this
     session. Plan-m6 A4 already asks for a Windows FFI check before pm-host.
   - A proc macro can read arbitrary env vars at expansion time (`tests/ui/proc-macro/env.rs` reads `THE_CONST` and
     `ANOTHER` through `proc_macro::tracked::env_var`). Both sides of one run see the same env, but the oracle cache key
     covers only `Case.env`. A caller that exports `ANOTHER` would change that case's output across sessions. This is
     the same class as harness-w20b's session variables; I did not extend `pinSessionEnv` to arbitrary names.
3. **Cost (A11):**
   - Not heavy. Per gate: about 272 oracle runs at ≈ 50 ms (cached after the first) plus the port's 272 runs.
   - Making the cases reads all tests/ui directives, ≈ 13–18 s per difftest process.
   - Disk: 139 MB of aux dylibs, one dir per case as with every aux suite. Sharing dirs across cases with the same
     plan would need the case id out of the key, which is a cache-wide change I did not make.
4. **When pm-host lands**, nothing changes in the harness: the port side receives the same `--extern <dylib>` argv as
   the oracle.
