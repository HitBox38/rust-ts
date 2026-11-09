# Handoff: harness-w46 (gate notes, unit-step leftovers, and the `rlib-native` report suite)

Branch `t3/harness-gate-notes`, on `main` at `74f215e6`. This is a reviewed batch of `scripts/` and `harness/` changes (AGENTS.md §2),
plus the two `src/` oracle tests of item 4, changed only to move their output. Settings: `.env.local` from `integ-w39` with
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=harness-w46`, on AC power. I ran no gate and no protected suite.

**No protected suite's cases, baselines or oracle keys change.** For all 60 suites in `harness/baseline/`, on `main` (a detached
worktree at `74f215e6`) and on this branch, I dumped `oracleKey()` (19 suites have one), a hash of the case list (`id`, `file`, `args`,
`env`, the suite's `cwd` with the repo path masked), and a hash of every case's `caseOracleCacheKey`. The two dumps are identical: 60
suites, 370,160 cases. `git diff main -- harness/baseline` is empty. Report-only suites: the `miri-sysroot-core`/`-alloc`/`-std` key
changes (it hashes `scripts/miri-sysroot-run.ts`, item 3), `rlib-native` is new, and `host-rlib`'s key does not change.

## 1. Notes of a passing static step (review root-w44-check N1)

`scripts/gate.ts` `runStaticStep`: a step **without a junit report** now returns the `note:` lines it printed (`notes`), and prints
them after its `ok` line. If it fails, it prints those not already in the 15-line tail. `staticChecks` collects them as
`{ step, note }`, and both gate.json records (stopped and finished) have `staticNotes` (`[]` when there are none). So the frozen lists
step's notes (a missing or unreadable `gate.json`, a malformed history line) now show in the gate log and gate.json. `pass` is still the
exit code. A `bun test` step's notes are not taken: its output holds its tests' own output, and the runner tests print plenty of
`note:` lines of their own.

Tests: `scripts/gate-unit.test.ts` (`notesPass`, `notesFail`, `notesFailTail`: printed after `ok`, returned, not printed twice, pass by
exit code); `scripts/gate-static-stop.test.ts` (`staticNotes` in both records). **Without the fix:** with the print line removed,
gate-unit fails at `notesPass`; with `staticNotes` removed from the records, gate-static-stop fails 2 of 6.

## 2. A process that ends in a one-process unit pass (review harness-w45 N1)

**Bun's output names the file, once one thing is changed.** Bun 1.4.3 prints each file's name (`src/x.test.ts:`) on stderr as it
starts the file, before loading it, but **not** when `CLAUDECODE`, `AGENT` or `REPL_ID` is set. I measured that one variable at a time.
With one of them set, as when the gate runs from a Claude Code shell, Bun prints only failures, and that is why the review saw nothing.
- `scripts/lib/unit-steps.ts`: `BUN_QUIET_VARS` and `oneProcessEnv`, which unsets those variables.
- `scripts/gate.ts` `unitStaticSteps` gives the two one-process passes `oneProcessEnv`: the alone pass, and `runner unit tests` (no
  workers). The workers keep their env, since Bun already names a file whose worker dies. Nothing in the repo reads these variables.
- When no report was written, `crashedIn` takes the last file name on stderr and prints
  `failed: <file>: the last test file bun test started; the process ended in it with no report (process.exit, an abort or a crash, at
  load or in a test)`. If Bun printed none, it says so and names the variables.
- The hint now covers any exit code ("exited N: a test that called process.exit, an abort or a crash?"), or says "timed out".
- Bun now also prints passing tests in those passes. So the tail printed for a failed step (`outputTail`) leaves out `(pass)` lines and
  file names with nothing under them. Reporting only.

I checked by hand that Bun names the file for `process.exit(0)`, `exit(3)` under `--isolate`, `process.abort()` (exit 134) and an exit
at load. Tests in `scripts/gate-unit.test.ts`, whose child sets `CLAUDECODE=1` and `AGENT=1` as the gate's shell would:
`aloneExit0`, `aloneExit1` (the crashing file is first of two), `aloneAbort` (an abort at load, middle of three), and `oneExit` (a pass
without workers). `out.real` now expects `oneEnv` on the two one-process steps. **Without the fix:** with `crashedIn` disabled, the test
fails at `exit0[1]`. With `oneProcessEnv` a no-op (and the `out.real` check bypassed), it fails at the same line, where the step
printed "bun test printed no test file's name". With the old gate.ts it fails at `out.real`.

Limit: this relies on Bun's current behaviour. If a future Bun adds another quiet variable, the step says so ("printed no test file's
name ... none of CLAUDECODE, AGENT, REPL_ID is set") instead of naming a wrong file.

## 3. An unknown pid namespace (review harness-w45 N6)

`scripts/miri-sysroot-run.ts`: `pidNamespace` returns `undefined` on Linux when `/proc/self/ns/pid` cannot be read. Two containers with
one boot and one host name could not be told apart then. The run then takes a random tag, through `runDirOf`:
`<side>.run-r<12 random hex>-<pid>`. No namespace's tag can equal it (those are 12 hex digits, and `r` is not one), so no run of any
namespace ever judges or removes it. The run itself removes nothing. A killed run's directory then leaks, which the header documents.
Off Linux, and on Linux with a readable link, nothing changes. `miriSysrootRun` takes the namespace as a function
(`namespace = pidNamespace`), so a test can pass `() => undefined` (a default parameter would swallow `undefined`).

Test: `harness/miri-sysroot.test.ts` "a pid namespace that cannot be known". It covers fake readers (Linux unreadable → none; two
Linux namespaces → two tags; darwin → a tag), `runDirOf` (fixed and random), and `staleRunDirs` of four namespaces never matching an
`r…` name. A whole run with the namespace unknown keeps every leftover, including a dead pid's directory of the host's own tag.
**Without the fix:** with the `undefined` return removed, it fails (`expect(...).toBeNull()`, received a tag). The `if (ns !== undefined)`
guard around the cleanup is belt and braces: `staleRunDirs` with no tag matches nothing anyway, so removing the guard alone fails no
test.

## 4. The `.rlib` files beside tests (review unit-parallel N5)

The writers are the oracle runs in `src/rustc_hir_analysis/check/check.oracle.test.ts` (`libabi_cdecl.rlib`, `libabi_direct.rlib`) and
`compare_impl_item.oracle.test.ts` (`librefine_rpitit.rlib`). Each runs `rustc` with cwd `CASES_DIR` and no out dir. The oracle command
now has `--out-dir <mkdtemp>`, removed in `afterAll`. The cwd and the relative source path are unchanged, so every diagnostic is as
before, and all cases still equal the subject. A new test in each file checks that `CASES_DIR` is unchanged after the oracle runs and
that the scratch dir got the rlibs. **Without the fix** (the `--out-dir` removed, leftovers deleted first), both new tests fail and the
three files come back. With it: 59 pass, and `git status --short --ignored` shows only `.env.local`.

Whole-run check: `bun test ./src ./tools --parallel=4` (`RUST_TS_REQUIRE_PROBES=1 CI=true`, 470 s) gave 7,420 pass, 1 skip and 5 fail.
`git status --short --ignored` was identical before and after: only `.env.local`, and no `.rlib`. The 5 failures were in 5 files
(io_error, rustc_log, late_b, resolver_new, tools/probes/fixtures). They failed only because a bare `bun test` lacks the gate's
`RUST_TS_DATA` and `RUST_TS_HOST_TUPLE`, so the probes could not be found. Re-run with those set, as `unitStepEnv` sets them, all 5
files pass: 69 tests, 0 fail.

`.gitignore` still lists the two `cases/*.rlib` patterns. It is not my file, so root may drop them.

## 5. The `rlib-native` report suite (docs/handoff/link-rlib-native.md; review link-rlib-native §6)

Report only: no `harness/baseline/rlib-native.txt`, so it is not in the gate's default set (`protectedSuites`). Files:
- `harness/corpus/rlib-native/`
  - `c/`: the C sources.
  - `src/`: the crates. `nc.rs` (no_core), `nc_link.rs` (`#[link(kind = "static")]`), `nc_cfg.rs` (`link_cfg`), `nc_user.rs` (uses
    `nc_link` through `--extern`), `std_link.rs`.
  - `libs/{host,elf,x86}/`: **the checked-in static libraries.**
- `harness/corpus/gen-rlib-native.ts` builds them, **outside the comparison, never with the port**. It uses the host's `clang`, `ar`
  (under `ZERO_AR_DATE=1`, so no time is stored, and uid/gid are 0) and `lipo`, and the oracle toolchain's `llvm-ar` (GNU, thin, BSD with
  ELF objects, and the empty archive). The host's `ar` silently drops ELF objects, so the BSD-on-Linux input comes from llvm-ar.
  Re-running it gave identical bytes twice.
- `scripts/rlib-native-run.ts`, the wrapper of both sides. **Fixed cwd:** `$RUST_TS_DATA/rlib-native/<16 hex of the id>/work`, the same
  for both sides, under the suite's case lock (as `host-rlib`). Sources are named by base name, and every case's `.rs` arguments are
  relative (tested). **Own `TMPDIR` per case:** `<case dir>/tmp`, emptied before each side. It prints, even after a failed step:
  - `host-rlib-run.ts`'s `outReport` (dep-info masked, other files by size and sha256);
  - each rlib's members, in order, each with its name, size and sha256, so a DIFF names the member (§6.3);
  - the temp files left, with tempfile's 6 random characters masked.
- `harness/suites.ts`: `RLIB_NATIVE_RUN` and the suite, 58 cases. The cache key covers both wrappers, the oracle rustc build, every file
  under `harness/corpus/rlib-native`, the case directories' root and the oracle sysroot.
- `scripts/gate.ts` `oracleRuns` reads the new wrapper (`undeclaredRuns` is `[]`, tested).
- `harness/rlib-native.test.ts` has 6 tests: the suite's shape, the command line, the directory refusal, member parsing on the real
  archives (BSD `#1/`, GNU `//` table), the temp masking, and a stub run.

The cases are the handoff's host and ELF tables plus x86_64-apple-darwin. Nearly all use `#![no_core]` crates, so they need no sysroot.
One std case uses `--sysroot <oracle>`, and two cases use a consumer through `--extern`. Left out (§6.2):
- any case whose diagnostics name the extracted temp file: there is no universal library whose slice is not a Darwin archive;
- the three x86_64-apple-darwin std cases (no such std in the oracle sysroot);
- the directory-as-library case (review N1, an `unported` today).

Results (`RUST_TS_AGENT=harness-w46`):
- `bun scripts/difftest.ts --suite rlib-native`: **58/58 MATCH**, in 8 s, on two runs (`20261109-072714-harness-w46-0bfd`, then
  `harness-w46-rlib-native-clean` after the per-member sha was added). Before the suite existed, I ran each case's
  oracle uncached through the wrapper (scratch, not difftest), and each gave the subject's output. The two `--extern` cases were run
  with an earlier `nc_user.rs`, before an unused feature was dropped from it.
- **Planted difference.** In `ArArchiveBuilder::build_inner`, I flipped the last byte of every bundled `bar.o`
  (`src/rustc_codegen_ssa/back/archive.ts`, temporary and reverted; `git status` clean there).
  - Result: **31 DIFF, 27 MATCH** (`harness-w46-rlib-native-planted`).
  - The 31 are exactly the cases that bundle an unpacked `bar.o`. The 27 bundle nothing unpacked: packed, `-bundle`, dylib, errors,
    empty.
  - Each diff file's first difference is the rlib's sha256 line, and its `bar.o` member line differs while the other members' lines are
    equal.

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun test ./scripts ./harness` (`RUST_TS_REQUIRE_PROBES=1 CI=true`): **424 pass, 0 fail**, 42 files.
- `bun test` of the two item-4 files: 59 pass.
- Coverage: no upstream file is ported in this lane, so there is nothing to report from `coverage.ts --missing`.
- No `unported(...)` added, no `// PORT:` decision. Nothing under `src/` changed except the two test files of item 4.

## For root

- `docs/next.md` items to close: root-w44-check N1; harness-w45 N1 and N6; unit-parallel N5; the `rlib-native` proposal (now a report
  suite).
- The miri-sysroot report suites will re-run their oracle once (key change), as after harness-w45.
- Optional: drop the two `cases/*.rlib` lines from `.gitignore`.
