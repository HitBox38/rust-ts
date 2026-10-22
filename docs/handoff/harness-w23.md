# Handoff: harness-w23 (M4b suites `borrowck-ui`, `borrowck-ui-report`; ckdump probe; phase-diff L1-L3; harness batch, needs an independent review)

Branch `lane/harness-w23`, base `f5de3f15`. No ported upstream code: no coverage numbers, no `// rustc:` markers, no
`// PORT:`, no `unported(...)` added (`src/rust_ts/ckdump.ts` is our own driver shell; it reaches the existing
`unported("rustc_interface::passes::analysis (M3+)")`). Baselines, oracle outputs, existing probes and existing suites
are unchanged (proof in §5). The two new suites start unprotected.

## Files touched
- `tools/probes/ckdump/{Cargo.toml.in,main.rs}` (new rustc-dev probe; built in the shared data dir, new and unused by
  any existing suite; no other probe rebuilt).
- `src/rust_ts/ckdump.ts` (new): the port-side driver.
- `harness/suites.ts`: new block "M4b" (`M4B_UI_DIRS`, `M4B_REPORT_DIRS`, `m4bUiSuite`, two suites). Nothing else.
- `scripts/lib/mir-dump.ts`, `scripts/lib/mir-dump.test.ts` (+4 tests), `scripts/phase-diff.ts`: review-w21 L1-L3.
- `docs/state/{current.json,history.jsonl}`: 3 decisions (suites, probe, phase-diff). Expect the usual merge conflict.

## 1. ckdump (plan-m4 D2)
- **Probe** (`tools/probes/ckdump/main.rs`, header documents it): `init_rustc_env_logger`, `install_ice_hook`,
  `catch_with_exit_code(|| compiler_entrypoint(raw_args, &mut CkDump))` (at the pin `compiler_entrypoint` is D2's
  `run_compiler`). `CkDump::config` = `TimePassesCallbacks::config` minus time-passes (`trimmed_def_paths = true`);
  `after_analysis` returns `Compilation::Stop`. No upstream code copied. Left out vs a real rustc run: `--emit=mir`,
  `codegen_and_build_linker` (metadata encoding, §1e), `-Zmetrics-dir`, `report_unused_features` (the `unused_features`
  lint), linking. stdout empty (no case printed anything), stderr = all of `analysis` + the end-of-session summary.
- **Validation:** `--report blessed` on the full runs: the oracle's ckdump stderr equals compiletest's blessed `.stderr`
  (after compiletest normalization) in **959/960** borrowck-ui cases and 1270/1276 report cases. The 7 others:
  `nll/ty-outlives/impl-trait-captures.rs`, `coroutine/print/coroutine-print-verbose-1.rs` (`-Zverbose-internals` prints
  the crate hash `[2da6]` vs blessed `[aeb9]`: compiletest's different argv/paths), 3 `post-mono-higher-ranked-hang*`
  (post-mono error from codegen, excluded by design), `lifetimes/unusual-rib-combinations.rs` (compiletest's
  future-incompat report), 1 N/A (`dont-check-compiler-stderr`). So the probe is the real `analysis`.
- **Port side** (`src/rust_ts/ckdump.ts`): main.ts's shim/stub/port structure; port = the same callbacks on the ported
  `compiler_entrypoint` (which already calls `tcx.ensure_ok().analysis(null)` and `Callbacks_provided.after_analysis`).
  `--impl shim --sample 40`: 40/40 MATCH on both suites; `--impl stub`: 0/40.

### How far the port's `analysis` is wired (for root)
- `passes.rs:1100 run_required_analyses` and `:1209 analysis` are **not ported** (passes.rs 25/29; the `analysis`
  provider is `unported("rustc_interface::passes::analysis (M3+)")`). Every case that gets past expansion stops there
  (§4). Porting those two fns is the next step and unblocks everything below.
- Providers/functions `analysis` needs that ARE ported: `hir_crate_items`, misc_checking_1 queries, `emit_delayed_lints`,
  `rustc_hir_analysis::check_crate` (lib.rs 5/5), `check_unsafety`, `trivial_const`, `check_transmutes`,
  `check_offloads`, `has_ffi_unwind_calls`, `check_liveness` (37/37), `mir_drops_elaborated_and_const_checked`
  (mir_transform lib.rs 20/20), `layout_of`, `layout_test`/`abi_test` (7/7, 5/5), `effective_visibilities`,
  `check_private_in_public`, `check_mod_deathness` (dead.rs 49/49), `rustc_lint::check_crate` (late.rs 38/38),
  `clashing_extern_declarations`, `check_mod_privacy`, `check_expectations`, `all_diagnostic_items`,
  `all_canonical_symbols`, `instance_mir`/`optimized_mir`/`mir_for_ctfe` providers.
- **Gaps:** `mir_borrowck` (rustc_borrowck 0/46 in lib.rs, 0/8 nll.rs; **the crate is not in `harness/scope.json`**,
  so it is not in the coverage table); CTFE providers `eval_static_initializer`, `eval_to_const_value_raw`,
  `eval_to_allocation_raw` (eval_queries.rs 0/18) and `eval_to_valtree`; `coroutine_by_move_body_def_id` (by_move_body.rs
  0/5); `fn_abi_of_fn_ptr` / rustc_ty_utils abi.rs 0/16 (only `#[rustc_abi]` tests); `EarlyBinder::instantiate_identity`
  stub in binder.ts on some coroutine paths; `Decodable for mir::CoroutineLayout` (rmeta, 1 case).
- **Scratch measurement** (not committed; `.data/scratch/hw23/tools/ck-experiment.ts`): ckdump.ts plus an `analysis`
  provider assembled from the ported pieces in passes.rs order, on 200-case samples:
  - as upstream: every sampled borrowck-ui case stops at `mir_borrowck provider (not ported)`;
  - with the loop's `mir_borrowck` call skipped (other callers still reach it): borrowck-ui 37 MATCH / 121 DIFF / 42
    UNPORTED (28 `mir_borrowck` via opaque types/drop elaboration, 7 `eval_static_initializer`, 4
    `eval_to_const_value_raw`, 3 `eval_to_valtree`); 119 of the DIFFs are oracle exit 1 vs port 0, i.e. the missing
    borrowck errors. borrowck-ui-report: 48 MATCH / 35 DIFF / 117 UNPORTED (96 `mir_borrowck`, 10
    `EarlyBinder::instantiate_identity`, 5 `eval_to_valtree`, 4 CTFE, 1 `CoroutineLayout` decode; 12 ICEs were a bug in
    my scratch glue's coroutine `layout_of` line, not port gaps).
  - So once `analysis` is ported, misc_checking_3 / drop elaboration / late lints already match on the cases they
    reach; borrowck (+ CTFE) is what M4b needs.

## 2. Suites
| suite | cases | revision cases | skipped | oracle | subject | timeouts (subject/oracle) |
|---|---|---|---|---|---|---|
| `borrowck-ui` | 960 (borrowck 521, nll 439) | 153 | 1 | probe ckdump | src/rust_ts/ckdump.ts | 60 s / 300 s |
| `borrowck-ui-report` | 1276 (lifetimes 202, closures 339, moves 66, coroutine 165, async-await 504) | 188 | 34 | same | same | same |

- Argv/env/aux/skips: `m3UiCorpus(dirs, false)` as mirdump-ui (compiletest argv, human, `-Znext-solver=coherence`,
  revisions, env, aux crates by the oracle as rmeta, session-env pinning). D14: `-o`/`--out-dir` stay (nothing is
  written after the stop; no test in these dirs uses `-Zunpretty`, `-Zdump-mir` or `--emit`; grep-checked).
- **Corpus decision (recorded):** `borrowck-ui` is exactly ui/borrowck + ui/nll (brief, §4's case column and the M4b gate
  population); §4's "report subsets" dirs are a separate report-only suite so the gate suite's population stays the
  gate's. Merging them into one suite with a `borrowck+nll` subset is a one-line change if root prefers.
- Subsets per directory; `--report blessed`. Skips: borrowck-ui 1 (`move-error-snippets-ext.rs`, compiletest "ignored
  used by another main test file"); report 18 needs-unwind, 6 incremental, 5 needs-threads, 2
  needs-deterministic-layouts, 2 proc-macro aux, 1 ignored always. All existing compiletest.ts reasons.
- **Oracle** (every case run twice, `.data/scratch/hw23/tools/oracle2.ts`, 10 jobs):

  | suite | exit 0 | exit 1 | exit 101 | stdout non-empty | timeouts | unstable | max time |
  |---|---|---|---|---|---|---|---|
  | borrowck-ui | 254 | 706 | 0 | 0 | 0 | 0 | 0.96 s |
  | borrowck-ui-report | 583 | 693 | 0 | 0 | 0 | 0 | 4.25 s (closures/deeply-nested_closures.rs) |

  No unstable case, so neither suite has an `unstable` list (difftest's pattern detection still applies).
- Upstream checkout clean after every run (difftest's check printed no `ERROR:`; `git status --ignored` minus `build/`
  empty).

## 3. phase-diff MIR stage (review-w21 L1-L3)
- **L1:** `-Zdump-mir-exclude-pass-number` dropped. Names keep `.<dialect>-<phase>-<count>` (`.-------` for non-pass-manager
  dumps). Matching key = name without that component + `#k` for repeats, so a pass running twice keeps both dumps and an
  extra/missing pass in the subject is reported as one extra/missing file instead of renaming every later dump. On a test
  file: 489 dump files with pass numbers vs 473 with the old flag (16 overwrites); `DumpDifference.subjectFile` names the
  subject's file when its pass number differs.
- **L2:** dump dirs are a fresh `mkdtemp` per run, `$RUST_TS_DATA/phase-diff/mir-dump/<RUST_TS_AGENT>-XXXXXX`, removed
  on match, kept and printed on divergence (no `rmSync` of shared dirs). The `.txt` outputs and `phase-diff/out` are
  still shared (unchanged; not part of the review notes).
- **L3:** mtime ties fall back to pass-number order within a body (`before` ahead of `after`), else name; tested with
  equal mtimes. Cross-body order on a coarse clock (NTFS) still falls back to names; a one-off check on Windows remains.
- Checked: `--impl shim` on tests/ui/nll/constant.rs: all phases ok, `mir-dump (174 files)`, run dir removed; two oracle
  dump dirs of a file and a one-constant variant: `t1.c.1-1-000.built.after.mir` differs at line 12 after 54 matching
  files; identical runs: no difference. `--impl port` still stops at `expand` on that file.

## 4. Full runs (port)
| suite | MATCH | DIFF | UNPORTED | CRASH/TIMEOUT | UNSTABLE | run |
|---|---|---|---|---|---|---|
| borrowck-ui | 0 | 0 | 960 | 0 | 0 | `hw23-borrowck-ui-full` |
| borrowck-ui-report | 3 (coroutine, fatal before analysis) | 0 | 1273 | 0 | 0 | `hw23-borrowck-ui-report-full` |

Top port-side stops: there is only one: `rustc_interface::passes::analysis (M3+)` (960 and 1273). The stops behind it
are in §1 (scratch measurement). Blessed (report only): borrowck-ui PASS 0 / FAIL 959 / NOT_COVERED 1; report PASS 3 /
FAIL 1267 / NOT_COVERED 5 / N/A 1.

## 5. Existing suites unchanged (proof)
`.data/scratch/hw23/tools/hash.ts` loads `harness/suites.ts` of the base tree (`git archive f5de3f15`) and of the lane
head (`git archive` of the final commit), each in its own bun process with the shared data dir, and hashes per suite:
metadata (milestone, description, mode, timeouts, cwd, probes, readsOnlyCaseFile, key set, subset names, batch
commands), `skipped()`, `unstable()`, case order, and per case `{case, oracle([c]), subject([c]), subset membership,
blessed(c)}` (tree root normalized). `tools/cmp.ts`: **all 28 existing suites IDENTICAL** (331,220 case records); added
only `borrowck-ui` (960) and `borrowck-ui-report` (1276).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun test scripts harness`: 43 pass, 0 fail (39 + 4 new). `bun test tools`: 50 pass,
  0 fail.
- `bun scripts/probes.ts build ckdump` built only the new probe (`target/probes/release/ckdump`); on another machine run
  it once after merging.

## Notes for root
- Port passes.rs `run_required_analyses` / `analysis` (driver-m4 in plan §5) and add `rustc_borrowck` (and later
  polonius vendor crates) to `harness/scope.json`.
- The blessed agreement (959/960) makes `--report blessed` on borrowck-ui a near-complete check of the port's stderr
  against the upstream expectations once it runs.
