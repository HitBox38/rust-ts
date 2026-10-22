ACCEPT-WITH-NOTES

# Review: harness-w23 (`lane/harness-w23`, `f5de3f15..418e0553`)

Reviewer: review-harness-w23 (independent, read-only on `.data/lanes/harness-w23`, HEAD `418e0553`, clean tree).

All scratch work is under `.data/scratch/review-hw23/`:
- `base/` and `head/` are `git archive` copies of the two trees.
- `data/` is a private data dir with its own fresh oracle cache (2236 entries after the runs). `rust`, `aux`, `probes`
  and `target` are symlinks to the shared dirs.
- `probe-build/` and `probe-target/` hold my own build of the ckdump probe.
- The tools are in `tools/`: `hash.ts`, `cmp-rustc.ts`, `analyze.ts`, `blessed-spot.ts`.
- Per-case results are in `cmp/*.jsonl`, and the difftest runs are in `data/runs/rv-*`.
- Nothing was written to the shared probes, the shared target or the shared oracle cache.

**Scope:** 10 files.
- New: `tools/probes/ckdump/{main.rs,Cargo.toml.in}` and `src/rust_ts/ckdump.ts`.
- Changed: `harness/suites.ts` (one appended block), `scripts/lib/mir-dump.ts` with its test, and `scripts/phase-diff.ts`.
- Also the handoff and 3 decisions.
- No baseline, oracle output, existing probe, existing suite or ported `src/` file changed.

## 1. Existing suites unchanged: verified
- **Method:** `tools/hash.ts` imports `<tree>/harness/suites.ts` in its own bun process, once for base and once for
  head. Both used the same data dir.
- **What it hashes, per suite:**
  - metadata: milestone, description, mode, timeouts, cwd, probes, `readsOnlyCaseFile`, key set and subset names;
  - `skipped()`, `unstable()` and the case order;
  - for batch suites, the batch commands;
  - per case: `{case, oracle([c]), subject([c]), subset membership, blessed(c)}`, with the tree root normalised.
- **Result:** all 28 existing suites are identical (331,220 cases). The only additions are `borrowck-ui` (960 cases)
  and `borrowck-ui-report` (1276 cases).

## 2. The ckdump probe is faithful to D2: verified
- **Source.** `main.rs` is rustc_driver_impl `main` (lib.rs:1677) minus a few things, with one callback set:
  - It keeps `init_rustc_env_logger`, `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())` and
    `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), ..))`.
  - It leaves out time-passes, `signal_handler::install` (a private module) and the ctrl-c handler. This is the same
    setup as tydump, thirdump and mirdump.
  - `config` sets only `trimmed_def_paths = true`, as `TimePassesCallbacks::config` (lib.rs:161) does.
  - `after_analysis` returns `Stop`.
  - At the pin, `compiler_entrypoint` (lib.rs:172) is D2's `run_compiler`. `interface::run_compiler` is the inner one.
  - No upstream code is copied. The stop is lib.rs:327, right after `tcx.ensure_ok().analysis(())`. That is
    passes.rs:1209 `analysis` in full, including `run_required_analyses`, the `has_errors_excluding_lint_errors`
    abort and misc_checking_3.
  - What the stop leaves out is everything after lib.rs:327: `emit_mir`, `codegen_and_build_linker`, metrics,
    `report_unused_features` and linking. The header lists exactly that.
- **The binary matches the source.** I built the probe from head's source into a private target dir, with the same
  cargo invocation and rpath as `scripts/probes.ts`. My binary is byte-identical (`cmp`) to the shared
  `target/probes/release/ckdump`.
- **Probe vs plain rustc (`tools/cmp-rustc.ts`, every case of both suites):**
  - For each case I ran my probe on the suite's exact argv, env and cwd, twice.
  - I also ran plain `rustc +nightly <same argv> -Zno-codegen`, with `--out-dir` / `-o` redirected to a private temp
    dir.

  | suite | cases | probe run 1 = run 2 | probe = rustc `-Zno-codegen` (stderr, stdout, exit) | probe stdout non-empty |
  |---|---|---|---|---|
  | borrowck-ui | 960 | 960 | 959 | 0 |
  | borrowck-ui-report | 1276 | 1276 | 1218 | 0 |

  - All 59 differences are of one kind: plain rustc adds `error: crate `<aux>` required to be available in rlib
    format, but was not found in this form`.
  - That error is emitted after `analysis`. It appears because the harness builds aux crates as rmeta, and these are
    run-pass/build-pass tests.
  - After that error block and the summary lines are removed, all 59 are equal.
  - So, on the whole corpus, the probe's stderr is exactly plain rustc's analysis diagnostics.
  - I found no case that hits `report_unused_features`, `--emit=mir` or `-Ztime-passes`.
- **Determinism:**
  - My two probe runs agree on 2236/2236 cases.
  - A third run (difftest's fresh oracle) and a fourth (`--impl shim`) give MATCH on 2236/2236, with 0 UNSTABLE.
  - Together with the lane's own double run, no `unstable` list is needed.
- **Blessed agreement:** I ran a full `--impl shim --report blessed` with a fresh private oracle cache.
  - borrowck-ui: PASS 959, NOT_COVERED 1.
  - report suite: PASS 1270, NOT_COVERED 5, N/A 1.
  - These are exactly the lane's numbers.
- **My own spot check** (`tools/blessed-spot.ts`) used my own naive normalisation: `<test dir>/` → `$DIR/` and
  `//~` annotations stripped. On 70 random cases (40 borrowck-ui, 30 report; 44 of them with a non-empty `.stderr`),
  68 are equal. The other 2:
  - `closures/issue-90871.rs` needs compiletest's `$SRC_DIR` normalisation, which the harness does and reports as
    PASS.
  - `coroutine-print-verbose-1.rs` is one of the lane's listed NOT_COVERED cases.
- **The 1 borrowck-ui mismatch** is `nll/ty-outlives/impl-trait-captures.rs`.
  - The E0700 message prints `-Zverbose-internals` crate hash `[2da6]`, where the blessed file has `[aeb9]`.
  - The probe output is byte-identical to plain rustc's on this case, so the difference is in compiletest's
    compiler/build (the crate hash inputs), not in the probe. The lane's specific explanation ("different
    argv/paths") is plausible but unverified; it does not matter here.

## 3. Port driver `src/rust_ts/ckdump.ts`: verified
- **Structure.** It has main.ts's shim/stub/port structure, `ensure_stack`, and the same exit-code and
  stack-overflow handling as tydump.ts and mirdump.ts.
- **Port path.** The port path mirrors the probe's `main` line by line: `EarlyDiagCtxt::new`,
  `init_rustc_env_logger`, `install_ice_hook`, then `catch_with_exit_code(compiler_entrypoint(raw_args, callbacks))`.
- **Callbacks.**
  - `config` sets `trimmed_def_paths` and nothing else.
  - `after_analysis` returns `"Stop"`.
  - The other hooks fall back to `Callbacks_provided` (`Continue`).
- **The stop is reached.** The ported `compiler_entrypoint` (lib.ts:305–309) calls `tcx.ensure_ok().analysis(null)`
  and then `Callbacks_provided.after_analysis`. The `codegen_and_build_linker` `unported` after it is never reached.
- **The seam is clear.** `analysis` is `unported("rustc_interface::passes::analysis (M3+)")`.
- **Samples** (`--sample 40`, seed `review-harness-w23`, with `RUST_TS_HOST_TUPLE` set):

  | suite | shim | port | stub |
  |---|---|---|---|
  | borrowck-ui | 40/40 MATCH | 40 UNPORTED | 0 MATCH |
  | borrowck-ui-report | 40/40 MATCH | 40 UNPORTED | 0 MATCH |

  - All 80 port stops have one reason: `rustc_interface::passes::analysis (M3+)`.
  - My first port sample without `RUST_TS_HOST_TUPLE` stopped at `CFG_COMPILER_HOST_TRIPLE`, as every port suite
    does. That is an environment issue, not a lane issue.

## 4. Suites: verified; I agree with the split
- **Corpus.**
  - borrowck-ui is 870 files plus 1 skipped (`move-error-snippets-ext.rs`, `ignore-auxiliary`), which is all 871
    non-aux `.rs` files of ui/borrowck and ui/nll. 153 cases are revision cases.
  - The subsets are borrowck 521 and nll 439, which matches plan §4 (522 with the skip; 439).
  - There are no duplicate ids.
- **Argv per D14.** All 960 borrowck-ui cases have the same `{file, args, env}` as the same ids in `mirdump-ui`, and
  its skip is in `mirdump-ui`'s skips.
  - So the argv is compiletest's, with `-Znext-solver=coherence`, revisions and aux.
  - `-o`/`--out-dir` stay, which is right for a probe that stops before output.
  - Only one file in these directories asks for `--emit`/`-Zunpretty`/`-Zdump-mir`/`--print`:
    `coroutine/auxiliary/metadata-sufficient-for-layout.rs`, an aux crate. borrowck/nll have no build-fail tests.
- **Report suite.** It has 1276 cases plus 34 skips, all with existing compiletest.ts reasons.
- **Agree with the split:**
  - Plan §4's M4b gate is "borrowck-ui ≥ 85% on ui/borrowck + ui/nll".
  - A single 2236-case suite would put 57% non-gate cases into the suite's headline match% and its protected set.
  - The split keeps that number equal to the gate's.
  - The decision is recorded.
- **Unstable handling.** There is no `unstable` list, and the evidence in §2 supports that. difftest's pattern
  detection still applies.
- **Clean checkout.** The upstream checkout was clean after all my runs (`git status --ignored` minus `build/`: empty;
  difftest reported `upstreamChanges` null).

## 5. phase-diff L1–L3: verified
- **L1.** On tests/ui/nll/constant.rs, plain rustc with `-Zdump-mir=all` writes 174 files, and with
  `-Zdump-mir-exclude-pass-number` it writes 170.
  - Every stripped name of the 174 is one of the 170.
  - There are 174 unique match keys, 4 of them `#1` repeats: `RemoveNoopLandingPads` and `AddCallGuards`, before and
    after.
  - `PASS_NUM` matches upstream `dump_path` (pretty.rs:210–217: `.{d}-{p}-{:03}` or `.-------`).
- **L2.** Two concurrent `--impl shim` runs, with different `RUST_TS_AGENT` values and different files, both printed
  "all phases match". Afterwards `phase-diff/mir-dump/` was empty, so each run dir was removed.
  - On divergence, the code keeps the dir and prints it. I inspected the code but did not run it.
  - There is no `rmSync` of any shared path.
- **L3.** For equal mtimes, the order within a body is by `[dialect, phase, count]`, then before ahead of after. This
  is consistent with pass_manager.rs, where `pass_count` is shared by before and after and incremented after the pass.
- **Clean checkout.** The upstream checkout was clean after the runs.

## 6. Checks
- On a head copy:
  - `bunx tsc --noEmit -p .` is clean.
  - `bun test scripts harness`: 43 pass, 0 fail. Base has 39, so 4 are new.
  - `bun test tools`: 50 pass, 0 fail.
  - `coverage.ts --check`: markers ok.
  - No `ERROR:` lines in any run.

## Findings (ranked; none blocking)
- **N1 (root decision): protection of `borrowck-ui-report`.**
  - Under plan §4's merged design, accepting borrowck-ui would have protected the report directories' MATCHes too.
  - After the split, the report suite has no gate share, so nothing says when (or whether) it gets a baseline.
  - Recommendation: record that it is protected from its first accepted run regardless of share (the ratchet does
    not need a share). Otherwise regressions in the lifetimes, closures, moves, coroutine and async-await
    directories go unprotected through M4.
- **N2 (informational): rmeta aux and post-analysis errors.**
  - 59 run-pass/build-pass cases produce a post-analysis "required to be available in rlib format" error under real
    rustc, because the harness builds aux crates as rmeta.
  - The probe stops first, so both suites are unaffected.
  - Any future real-CLI suite that continues past `analysis` with these aux crates (codegen/metadata) would hit it.
- **N3 (low): shared probe manifest path.** The shared `probes/ckdump/Cargo.toml` points `path` at the lane worktree
  (`.data/lanes/harness-w23/...`). Rebuild once from main after the merge, as the handoff says.
- **N4 (low, acknowledged by the lane): tie fallback on coarse clocks.**
  - Across bodies, and for `.-------` dumps against numbered ones, the order falls back to the name. `-` sorts before
    digits.
  - So on equal mtimes (NTFS), a body's `renumber`/`nll` dumps would sort ahead of its pass-manager dumps.
  - It cannot happen on APFS (nanosecond mtimes). The Windows one-off check stays open.
- **N5 (low, outside L1–L3): shared phase-diff outputs.** phase-diff's `<phase>.{oracle,subject}.txt` and `out/` are
  still shared between concurrent runs; my two concurrent runs overwrote each other's `.txt` files.
- **N6 (informational): stack overflow.** Neither the probe nor ckdump.ts installs rustc's stack-overflow signal
  handler (it lives in a private module).
  - So an overflow differs from plain rustc on both sides: std abort vs ICE/CRASH.
  - This is the same as tydump and mirdump, and no case in either suite overflows.
