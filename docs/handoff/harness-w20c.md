# Handoff: harness-w20c (harness batch: unstable cases, clean upstream checkout, scrubbed env, Windows PATH pin; needs an independent review)

Branch `lane/harness-w20c`, base `67c4d7c6` (lane/harness-w20b + its review). There is no ported upstream code, so there
are no coverage numbers, no `// rustc:` markers, no `unported(...)` and no `// PORT:`. Baselines, oracle outputs, probes
and MATCH logic are unchanged. No probe was rebuilt.

## Exact list of changed case definitions: none
Every suite's `cases()` (`{id, file, args, env, oracle([c]), subject([c])}` per case) and `skipped()` were loaded from
the base tree (`git archive 67c4d7c6`) and from the lane, each in its own process, with the shared `RUST_TS_DATA`:
all 26 suites are identical, case by case (25,780 lex/tokens/escape, ~21.5k for each ui-corpus suite, 1849/1860 for
tydump-ui/thirdump-ui including their aux paths). The only suite-level addition is `unstable()` on tydump-ui and
thirdump-ui. Cache keys (`cachePath`) are unchanged: same inputs, same function. So no oracle entry is invalidated.

- The PATH pin (task 4) adds `RUSTUP_WINDOWS_PATH_ADD_BIN=0` on Windows only; on macOS/Linux `pinSessionEnv` and
  `auxEnv` build exactly the same objects (same keys, same order) as before.
- The env scrub (task 3) is a harness constant applied at run time, not part of `Case.env` or the key.

## Files touched
- `scripts/lib/env.ts` (new): scrubbed variables, `caseEnv`, `mergeEnv` (Windows case-insensitive), `getEnv`,
  `pinnedPathEnv`.
- `scripts/lib/unstable.ts` (new): `UNSTABLE_ORACLE_PATTERNS`, `unstableOracleReason`.
- `scripts/lib/upstream.ts` (new): `upstreamStatus`, `upstreamChanges`, `upstreamError`.
- `scripts/lib/common.ts`: `run()` merges env through `mergeEnv` (identical off Windows).
- `scripts/lib/oracle.ts`: `oraclePinnedPathEnv()`.
- `scripts/difftest.ts`: UNSTABLE status, unstable handling in `runOracle`, scrubbed env for both sides, upstream check.
- `scripts/gate.ts`: clean-upstream precondition, upstream-change failure, unstable-in-baseline failure, accept refusal
  (and accept now validates every suite before writing any baseline).
- `scripts/phase-diff.ts`: `--out-dir`, `--emit=metadata=-`, env, upstream check.
- `harness/suites.ts`: `Suite.unstable`, `UnstableCase`, the M3 ui list; `pinSessionEnv` via `oraclePinnedPathEnv`;
  `oracleAuxRmeta` env scrubbed.
- `harness/compiletest.ts`: `auxEnv` via `getEnv` + `oraclePinnedPathEnv`.
- Tests: `scripts/lib/env.test.ts` (new, 14 tests), `scripts/unstable.test.ts` (new, child process).
- `docs/state/*`: two decisions.

## 1. Unstable cases
**Why each varies (measured: the same probe binary, argv, env and cwd, run twice; both probes).**

| case (tydump-ui and thirdump-ui) | varying part | cause |
|---|---|---|
| `traits/error-reporting/conditionally-implemented-trait-long-type.rs` | `...long-type-<hash>.txt` in a note | hash of an interned type's address |
| `traits/on_unimplemented_long_types.rs` | same | same |
| `traits/next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old` | `thread 'rustc' (<tid>) panicked` | ICE; OS thread id |
| `traits/next-solver/normalize/old-solver-caching-bug-151069.rs#old` | same | same |
| `traits/next-solver/normalize/success-results-in-unconstrained-infer.rs#old` | same | same |
| `traits/next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs#old` | same | same |
| `traits/projection-cache-rematch-impl-122529.rs#old` | same | same |
| `traits/projection-cache-rematch-impl-141124.rs#old` | same | same |

- **Long-type hash, not a harness cause.** The tests pass `-Zwrite-long-types-to-disk=yes` themselves (after
  compiletest's `=no`). rustc_middle `ty/error.rs` `short_string_namespace` names the file
  `long-type-{DefaultHasher(t)}`, and `Hash` of an interned value hashes its address, which varies with ASLR. The note
  is printed even when the file cannot be created: the out dir (`build/.../<stem>`) does not exist in these runs. So no
  out dir, `-o` or temp dir makes it reproducible; compiletest normalizes it (`$LONG_TYPE_HASH`). The harness's out dir
  is already compiletest's deterministic `build/<target>/test/ui/<dir>/<stem>`.
- **Thread id, not a harness cause.** std's panic message has the OS thread id; compiletest's env
  (`RUST_BACKTRACE=short`) is faithful; compiletest normalizes the id (`$TID`).
- **Root decision (lane ui-diffs-20):** for 5 of the 6 ICE cases the port ICEs at the same point. Their reason is
  "both sides ICE at the same point; rustc's ICE report (thread id, backtrace) is not reproducible".
  `old-solver-caching-bug-151069.rs#old` is listed for the thread id.

**Mechanism.**
- `Suite.unstable(): {id, reason}[]` (harness/suites.ts `M3_UI_UNSTABLE`, on both M3 ui suites).
- difftest: a listed case's oracle runs on every run. Its cache entry is never read or written, and its status is
  `UNSTABLE`. That status comes after ORACLE_TIMEOUT and before everything else, so it is never MATCH.
  - The result carries `unstable` (the reason) and `subject` (what the subject did, as for ORACLE_TIMEOUT).
- Detection: a single-mode case outside the list is also UNSTABLE (`detected: ...`) when its oracle stderr matches
  `UNSTABLE_ORACLE_PATTERNS`. The patterns:
  - `^thread '..' ((rtid )?N) panicked`;
  - `.long-type-N.txt'`;
  - `rustc-ice-<time>-<pid>.txt`.

  Its output is not cached. A cached entry that matches is removed and re-run.
- Gate:
  - `gate run` fails (`ERROR:`) if any baseline lists an id from its suite's `unstable()`;
  - `gate accept` refuses (dies before writing any baseline) if it would protect one;
  - UNSTABLE results are never MATCH, so they are never added anyway.
- **No normalization.** Normalizing `$TID` or `$LONG_TYPE_HASH` would change MATCH logic, so it is left to a separate decision.

**Detection vs list, measured.** An oracle-only scan of every case of 16 suites (below) found the patterns in exactly these 8 cases
of tydump-ui and of thirdump-ui, and in no case of any other suite. So no protected case changes status.

## 2. Upstream checkout stays clean
**Who wrote the strays.**
- `libcrate_type.rs`, `liblang_item.rs` (2026-10-14 06:07):
  - These are sdylib interface files (`passes::write_interface`, `<out_dir>/lib<crate>.rs`) of
    `tests/ui/attributes/export/{crate-type,lang-item}.rs`.
  - `write_interface` runs only after `after_expansion` returns Continue, so no `-Zunpretty` mode reaches it, and no
    probe does either (all stop in `after_expansion`).
  - Only a full compile with cwd = the checkout root and no `--out-dir` writes them there. No suite does that.
  - The time matches the lang-items lane's commit (`2de122ea`, 06:07:58), so this was most likely an ad-hoc rustc run in that lane.
- `tests/ui/location-insensitive-scopes-issue-117146.long-type-*.txt` (2026-10-21 11:18):
  - The content names `{closure@location-insensitive-scopes-issue-117146.rs:11:13}` (short file name), and the test
    is `tests/ui/nll/polonius/...`. That fits a typeck/borrowck run with cwd or out dir `tests/ui` and long types on (rustc's default).
  - No suite, script or unit test in this tree or any branch runs that test that way. I grepped every branch for the
    test name and for `tests/ui` working directories. The only `tests/ui`-cwd user is `src/rustc_ast_passes/oracle.test.ts`,
    which uses `-Zunpretty=expanded` (no typeck).
  - So this was most likely an ad-hoc command too.
- **Scan.** I ran the oracle of every case of tydump-nocore, tydump-ui, thirdump-ui, tydump-minicore,
  thirdump-minicore, resdump, resdump-nocore, hir-tree-nocore, hir-tree, unpretty-hir, unpretty-expanded,
  unpretty-expanded-nocore, expanded, expanded-nocore, parse-ui and parse-ui-json. Each used its argv, env and cwd, with
  `git status --ignored` checked before and after.
  - **Result:** no suite changed the checkout. The patterns occurred only in the 8 + 8 listed cases.
  - expanded and expanded-nocore were not finished: the scan was stopped at its time limit. They take the same
    `-Zunpretty` path as unpretty-expanded(-nocore), which was clean; only the print mode differs.
  - The tool is `.data/scratch/hw20c/tools/oracle-scan.ts`.
- **The one real harness writer: `scripts/phase-diff.ts`.**
  - It runs full compiles (`-Zunpretty=thir-tree`, `mir`, `--emit=metadata -o -`) in the test's own directory with
    no out dir. So long-type files, sdylib interfaces and (without `RUSTC_ICE=0`) ICE reports landed next to the test.
  - Now every phase gets `--out-dir $RUST_TS_DATA/phase-diff/out`, and the check phase uses `--emit=metadata=-`
    (stdout, out dir respected; checked by hand that the interface goes to the out dir).
  - Both sides get the scrubbed env plus `RUSTC_ICE=0 RUST_BACKTRACE=0`.
  - phase-diff is a tool, not a suite: no cases or keys change.

**Check (scripts/lib/upstream.ts).**
- What it compares: `git --no-optional-locks status --porcelain --ignored --untracked-files=all` of the checkout,
  except `build/`.
  - `build/` holds compiletest's out dirs, which upstream's `.gitignore` ignores.
  - Ignored files are included because `rustc-ice-*.txt` is ignored upstream.
- difftest takes it before and after every run.
  - It prints `ERROR:` if the checkout is dirty at the start, and `ERROR:` with `<suite>.upstream-changes.txt` if the
    run changed it (this run or a concurrent process).
  - It also returns `upstreamDirty`/`upstreamChanges`, and the summary records them.
- The gate dies at the start on a dirty checkout and fails the run if any suite changed it (`upstreamOk` in gate.json).
- phase-diff prints `ERROR:` on a change.
- I checked that the checkout is clean after all the runs below.

## 3. Scrubbed environment (review harness-w20b MED M1, L1)
- **The env both sides run with.**
  - Both sides of every difftest case run with the caller's env minus the scrubbed variables, then `Case.env`, which wins.
  - Batch oracles, phase-diff and `oracleAuxRmeta` get the same scrub.
  - Aux builds (`auxEnv`) were already built from an allowlist.
- **The audit.** I checked the pinned sources' run-time `env::var` reads in compiler/ and library/std (outside build
  scripts, codegen backends and tests), anstream/anstyle-query, rustup and Bun. Each scrubbed variable and why is in
  `scripts/lib/env.ts`:
  - `RUSTC_LOG*` (all rustc_log companions);
  - `RUST_BACKTRACE`, `RUST_LIB_BACKTRACE`, `RUSTC_ICE`, `RUSTC_BREAK_ON_ICE`, `RUSTC_CTFE_BACKTRACE`;
  - `RUSTC_BOOTSTRAP`, `RUSTC_FORCE_RUSTC_VERSION`, `RUSTC_OVERRIDE_VERSION_STRING`, `RUST_MIN_STACK`,
    `RUST_TARGET_PATH`, `RAYON_*`, `RUST_DEP_GRAPH*`, `RUSTC_GRAPHVIZ_FONT`;
  - `CLICOLOR_FORCE`, `CLICOLOR`, `NO_COLOR`, `FORCE_COLOR`, `COLORTERM`, `TERM`. `COLORTERM=truecolor` +
    `TERM=xterm-256color` turn on `-Zterminal-urls`.
  - `CARGO`, `CARGO_*` except `CARGO_HOME`. These are cargo-run variables that tests read through `env!`.
  - `Malloc*`, macOS libmalloc debug variables, some of which print to stderr.
- Not scrubbed: `PATH`, `HOME`, `TMPDIR`, `RUSTUP_*`, `CARGO_HOME`, `RUST_TS_*`, loader paths.
- **Why not keyed.** The scrub is a harness constant, so nothing is keyed. In a caller env with none of these set (as in
  this lane, apart from `MallocNanoZone`, which changes no output), nothing changes.
- **Residual.** Oracle entries cached earlier under a polluted env cannot be detected. The PATH-pinned env cases
  (below) show that polluted and clean runs now produce byte-identical entries.

## 4. Windows PATH pin (review harness-w20b HIGH H1)
- `pinnedPathEnv(dir, platform)`: on `win32` it gives `{ PATH: dir, RUSTUP_WINDOWS_PATH_ADD_BIN: "0" }`. rustup's
  `set_ldpath` appends `<toolchain>\bin` only when that variable is `1`, so `0` turns it off in old and new releases.
  Elsewhere it gives `{ PATH: dir }`, as before.
  - It is used by `pinSessionEnv` (keyed through `Case.env`, Windows only; a case's own value wins) and `auxEnv`
    (keyed through the aux key).
- **`Path`/`PATH`.**
  - `mergeEnv` (used by `run()`): on `win32`, setting or removing a name first drops every other spelling, so the
    child gets one `PATH`. Elsewhere it is the old plain overlay, with key order preserved.
  - `scrubbedEnv`/`isScrubbedEnvVar` match case-insensitively on win32.
  - `auxEnv` reads inherited names with `getEnv` (case-insensitive on win32).
- Unit-tested with explicit platform arguments (`scripts/lib/env.test.ts`). The tests cover a Windows env with
  `Path`, a lower-case `rustc_log` and an inherited `Rustup_Windows_Path_Add_Bin=1`: the result has exactly one
  `PATH` (the pin), `RUSTUP_WINDOWS_PATH_ADD_BIN=0` and no `RUSTC_LOG`. Not run on Windows.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts harness`: 34 pass, 0 fail. `bun test tools`: 50 pass, 0 fail.
- **The 8 listed cases × 2 suites, run twice.** I used a private data dir (`.data/scratch/hw20c/data`) with its own
  empty oracle cache and aux dir. All 32 results were UNSTABLE, and the oracle cache had 0 entries afterwards.
- **The 50 PATH-pinned env cases (45 protected).** These are the 5 files × the 10 suites of harness-w20b. They are not
  changed cases; this checks the scrub.
  - Run A: clean env, private cache. Run B: polluted env, a second private cache. Run B's env was `RUSTC_LOG=debug
    RUSTC_LOG_COLOR=always CLICOLOR_FORCE=1 RUST_BACKTRACE=full RUSTC_BOOTSTRAP=-1 CARGO_PKG_NAME=x
    COLORTERM=truecolor TERM=xterm-256color`.
  - Both runs gave 50/50 MATCH, and the 50 cache entries are byte-identical between the two caches.
- **`--sample 300`, seed harness-w20c, shared data.** None printed an `ERROR:` line. The upstream checkout was clean
  afterwards (`git status --ignored`, `build/` excluded: 0 paths).

| suite | result |
|---|---|
| hir-tree | 299 MATCH, 0 DIFF, 1 UNPORTED |
| expanded | 299 MATCH, 0 DIFF, 1 UNPORTED |
| resdump | 299 MATCH, 0 DIFF, 1 UNPORTED |
| tydump-minicore | all 46: 41 MATCH, 0 DIFF, 5 UNPORTED |
| tydump-ui | 152 MATCH, 4 DIFF, 144 UNPORTED, 0 UNSTABLE (none of the 8 in this sample) |

  The 4 tydump-ui DIFFs are subject-side port bugs. They are trait-error choice or order differences:
  - `next-solver/fn-trait.rs` (known);
  - `foreach-partial-eq-next-solver.rs` (known);
  - `normalize/dont-ice-on-normalization-failure.rs`;
  - `trivial-unsized-projection.rs#bad_new`.

## Notes for root
- The two M3 ui suites now report 8 UNSTABLE each, instead of DIFF/UNPORTED/CRASH, for those cases. The subject's
  outcome is in `subject` (`.jsonl`).
- The gate now needs a clean upstream checkout. If an agent leaves a stray, move it to `$RUST_TS_DATA/tmp/upstream-strays/`.
- Merge: `docs/state/{current.json,history.jsonl}` get 2 decisions (the usual conflict).
