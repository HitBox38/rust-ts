PASS WITH NOTES

**Wave 40p's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `03e9e796` is `MATCH` in this gate's jsonl. The accept commit (`c23a6bd2`) changed no
baseline. I compared every row of all 102 jsonl files with wave 40o's gate, on every field. The ids and their order are the same in every
file. **Only 15 rows moved, all only in `attempts` (and, for 3 of them, `retried`).** They are this gate's 15 retries. Every one of them is
`MATCH` in both gates. Status counts did not change: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1. UNPORTED rows carry their
stop reason (`unported`), so **no case's stop moved either**.

**`harness/` and `scripts/` changed in exactly the two files the brief names, and `tools/` did not change.** The `ir-normal.ts` edit is
comments only (N3). The manifest gains 18 pinned LLVM sources (N2). No protected suite reads either file, and neither is in a build.

**Both binaries were rebuilt, and they are the tested tree.** I recomputed both keys from a `git archive` of `03e9e796`: `a38b56e9…`
(main.ts, 2,114 inputs) and `674d0f30…` (miri.ts, 2,301). Both equal `gate.json`. **Only two changed files are in either build, the same two
in both** (N4): `rustc_codegen_ssa/back/lto.ts` (one `import type` removed) and `rustc_error_messages/diagnostic_impls.ts` (`CString` and
`SmallCStr` `into_diag_arg` hash text where they used to stop at `unported`). No input was added or removed. **None of the new or changed
`src/rust_ts/llvm/*` or `src/rustc_codegen_llvm/*` code is an input of either build**: not `target.ts`, `triple.ts`, `subtarget_table.ts`,
`tools.ts`, not `llvm_util.ts`, `debuginfo/metadata.ts`, `back/lto.ts`, `back/write.ts`, nor either `record.ts` (N5). So the new
`initialize_available_targets()` call in `llvm_util::init` cannot run in any protected case. The protected compiles use the stand-in backend
`src/rust_ts/codegen_backend.ts`, which did not change. The subject scripts that run from source (the dumps and `scripts/mono-run.ts`) reach
the same two changed files and nothing else (N6).

**Host:** on AC power the whole run. Load was lower than in wave 40o (median 42.5 against 75.9). There were 15 retries against 40o's 12:
40o's 12 plus three cases that were also retried in seven gates from 2026-11-10 to 2026-11-12 (N7). Every alone time is within ±0.7 s of
its earlier value. None is above 45 s: the largest is `dynamic-drop.rs` at 38.6 s. The pool suites took 4–8% longer at the lower load, but the
solo and heavy cases did not, so the code is not the cause (N8).

Regression audit, 2026-11-14. Gate `gate-20261113-233839-root-yszn`, tested `03e9e796`, accepted `c23a6bd2`
(`git log -1 -- docs/state/history.jsonl`), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. The previous accept is wave 40o: gate
`gate-20261113-154022-root-ghh7`, tested `e488e464`, accepted `c6e3b895`. I ran no gate, no difftest and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files against wave 40o's, on every field. I checked every id of the 60 baselines at `03e9e796`
  (`git show`) against this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept entry, the gate log
  (`.data/tmp/gate-w56.log`) and the three junit files;
- `git diff` over `harness/`, `scripts/`, `tools/`, `UPSTREAM.json`, the config files and the runtime C files, from `e488e464` to `c23a6bd2`;
- both subject-bin keys, recomputed in a `git archive` tree of `03e9e796` with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`.
  The key was taken over `meta.spec`, the gate's own spec. Separately, the archive's spec, rebased onto the gate's paths, equals `meta.spec`;
- the inputs of both builds against wave 40o's (`meta.json`), and `git diff` of each changed input;
- an in-memory `Bun.build` (metafile only) of the 26 other subject and runner entries named in `harness/suites.ts`, to see which changed files
  each one loads (N6);
- a `git grep` for callers of each changed or new function;
- an in-memory `Bun.build` of both entries from the archive tree, with no sourcemap, searched for the changed and new functions (N4, N5);
- `gate.json` `retried`/`attempts`, `host.samples`, per-suite times and the gate log's heavy lines against wave 40o, and the retried cases
  in every gate since 2026-11-10.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the
host was quiet (1-minute load about 2). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **Three of the brief's facts are off; none changes the verdict.** **(a)** This is not the first gate run on Bun 1.4.4. Wave 40k's gate `gate-20261111-141426-root-vl2w` was (`95ba28aa`, "Bun 1.4.4"), and wave 40o's gate ran on the same Bun: version 1.4.4, revision `38afee6c…`, file sha1 `7c1f29cd…`, the same as this gate's `bun`, `bunExec` and both builds' `meta.json`. **(b)** `src/rust_ts/llvm/intrinsics.ts` and `apfloat.ts` are not new in this wave. They did not change in `e488e464..03e9e796`. They came in with earlier lanes (`963e0d55`, `1b35c787`). The new IR-model modules are `target.ts`, `triple.ts`, `subtarget_table.ts`, `tools.ts` and `tm_fixture.ts` (plus fixtures under `proof/` and `tools_oracle/`). **(c)** `step_overflowing.rs` is not the only heavy timeout. `hashset-connected-border-12860.rs` timed out at 1,800 s too, as in every gate since the suite began (N9). | `git log`; `gate.json` both gates; `git diff --diff-filter=A` |
| N2 | info | **`harness/` and `scripts/` changed in two files; `tools/` did not change.** `git diff --stat e488e464 c23a6bd2 -- harness/ scripts/ tools/` lists `harness/llvm-manifest.json` (+19 −1) and `scripts/lib/ir-normal.ts` (+7 −4), as `git diff --stat e488e464 03e9e796 -- harness/ scripts/` does. The manifest gains the 18 LLVM sources llir-init cites (`75dce129`: `TargetRegistry.h/.cpp`, `TargetMachine.h/.cpp`, `Triple.h/.cpp`, `TripleName.def`, `SubtargetFeature.h/.cpp`, `MCSubtargetInfo.cpp`, `ErrorHandling.cpp`, `TargetDataLayout.cpp`, and six AArch64/X86 target files). The −1 line is `TargetMachineC.cpp`'s entry, which only gains a trailing comma; its hash is unchanged. No entry was removed or rehashed. Readers at `03e9e796`: `scripts/coverage.ts`, `scripts/llvm-src.ts`, `scripts/lib/{llvm-src,cpp-fns}.ts` and tests. The hits in `src/rust_ts/llvm/{ir,tools}.ts` are comments. | `git diff`; `git grep llvm-manifest 03e9e796` |
| N3 | info | **The `ir-normal.ts` change is comments only and reaches no protected suite or build.** Both hunks rewrite lines of the header comment (`ef204833`, review n1-name-anon N1–N3): `NeedThinLTOBufferPasses` and when it is cleared, and how the anonymous-name hash joins names. No code line changed. Readers are those w40o N2 listed: `harness/suites.ts` (a `type` import, plus a file hash in `irToolsKey`, reached only through `irSuite`'s `oracleKey`), `scripts/gate.ts` (`type` import), `scripts/difftest.ts` (`isIrTier`), and IR tools and tests. `irSuite`'s only user, `ir-hello`, has no baseline and did not run. Changing a comment does change `irToolsKey`, but only for `ir-hello`'s oracle cache. Neither build's inputs include any `scripts/` file but `scripts/lib/{common,env}.ts`, plus `miri,oracle,toolchain` for miri.ts. | `git diff`; `git grep ir-normal 03e9e796`; `meta.json` inputs |
| N4 | info | **The reachable changes are two files, the same in both builds, and their changed code is tree-shaken out.** **(a)** `rustc_codegen_ssa/back/lto.ts`: one `import type { Lto }` line deleted (fixers-56, `34010c94`). Type imports compile to nothing. **(b)** `rustc_error_messages/diagnostic_impls.ts` (cg-lto-diag, `15e35af8`): `CString_into_diag_arg` and `SmallCStr_into_diag_arg` used to stop at `unported(…to_string_lossy…)`. Now they return `{ $: "Str", _0: to_string_lossy(self) }`, using `std/env.ts`'s existing function (that file did not change). Their only callers are in `rustc_codegen_llvm/diagnostics.gen.ts` (`triple` and `name` args), which is not an input of either build. Neither function, nor the `os_str_to_string_lossy` alias, occurs in either bundle. A protected `MATCH` case cannot have reached the old stop, and no row names it in either gate. No input was added or removed: 2,114 and 2,301, as in 40o. `CONFIG_FILES` and `RUNTIME_C_FILES` match 40o's builds. | `git diff e488e464 03e9e796`; bundle search; `meta.json` |
| N5 | info | **The wave's new code (IR-model targets, `llvm_util` init, cg-di-a, cg-lto-diag, `record.ts`) is in neither binary.** Of the 96 files changed in `e488e464..03e9e796`, only the two of N4 are build inputs. No path under `src/rust_ts/llvm/` or `src/rustc_codegen_llvm/` is an input of either build. In both bundles (no sourcemap), these names occur 0 times: `initialize_available_targets`, `reset_llvm_options_for_tests`, `TargetRegistry`, `subtarget_table`, `build_global_var_di_node`, `apply_vcall_visibility_metadata`, `create_vtable_di_node`, `find_vtable_behind_cast`, `LtoModuleCodegen`, `fat_lto`, `run_pass_manager`, `check_lto_allowed`, `print_target_cpus`, `LLVMRustGetHostCPUName`. The 8 `llvm_util` hits are `src/rust_ts/codegen_backend.ts`'s stand-in backend. They are its `unported("rustc_codegen_llvm::llvm_util::configure_llvm …")` and `target_config …` messages, its own `llvm_util_target_cpu` and the `--print backend-has-mnemonic` stop, plus one doc comment. **So `llvm_util::init` and its new `initialize_available_targets()` call cannot run in a protected case.** `--print target-cpus`, `target-features` and `-Ctarget-cpu=help` go through that stand-in and its oracle tables. `--print target-list` goes through `rustc_driver_impl`. Neither `codegen_backend.ts` nor `rustc_driver_impl/`, `rustc_target/` or `rustc_interface/` changed. No baseline holds a `tests/ui/print-request` case. `tests/ui/codegen/target-cpus.rs` is protected only in front-end suites (lex … mir, tydump-nocore), where it is `MATCH` with the row unchanged. The `write_stderr` hits (23 and 31) are `std/io.ts`'s existing users; `target.ts`'s new call to it is not in the bundle. | `meta.json` inputs; bundle search; `git diff --stat` |
| N6 | info | **The subject scripts that run from source reach the same two changed files and nothing else.** Binary mode covers only `main.ts` and `miri.ts`. The other subject entries run from source in the gate (`subject-bin.ts` `BINARY_ENTRIES`), so I bundled each one's import graph from the archive tree. `resdump`, `tydump`, `thirdump`, `mirdump`, `ckdump` and `scripts/mono-run.ts` load `diagnostic_impls.ts` and `back/lto.ts`. `fluentdump`, `emitdump` and `tokdump` load `diagnostic_impls.ts` only. `lexdump`, `escapedump`, `symdump`, `miri_stack_first`, `stack` and the runner wrappers (`rmeta-run`, `rg-check`, `mir-dump-run`, `host-rlib-run`, `rlib-native-run`, `rg-rustc`, `chain-run`, `miri`, `miri-sysroot-run`) load no changed file. `difftest.ts`, `gate.ts` and `miri-diff.ts` load `ir-normal.ts` (N3). No entry loads any `src/rust_ts/llvm/` or `src/rustc_codegen_llvm/` file. N4 covers both changes for these entries too. | `Bun.build` metafiles, `03e9e796` archive |
| N7 | low | **Retries rose from 12 to 15. The three extra cases are known recurring retries, with alone times in their usual range.** The 15 are 40o's 12 (unchanged list) plus mir `const-eval/infinite_loop.rs` (alone 14.9 s), mir `projection-cache-rematch-impl-141124.rs` (14.1 s) and run-pass-miri `macro-comma-support-rpass.rs#core` (12.0 s). All three were retried in every gate from `gate-20261110-023454` to `gate-20261112-061907` (7 gates, 15–20 retries each), with alone times 15.4–15.5, 14.4–14.7 and 12.2–12.8 s. 40n and 40o happened not to retry them. Pool load at this gate's 15 timeouts was 59.3–260.1 (40o 93.8–226.1). **No alone time is above 45 s.** The largest are `dynamic-drop.rs` 38.6 s (40o 39.2) and `issue-8827.rs` 38.1 s (40o 37.8). | jsonl `attempts`, all gates since 2026-11-10 |
| N8 | low | **The pool suites took 4–8% longer at lower load; the solo and heavy cases did not, so the binary is not the cause.** Summed suite time was 20,891 s against 20,350 s (+2.7%). `mir` 1,399 → 1,507 s (+7.7%, start load 146 → 88), `run-pass-miri` 980 → 1,059 s (+8.1%), `mono-ui` 685 → 740 s (+8.0%), `resdump` 2,262 → 2,353 s (+4.0%). Load fell: median 75.9 → 42.5. The cases that run one at a time match 40o: the 12 shared retries' alone runs are within ±0.7 s, and every heavy case's wall is within ±3.1 s, except `mir-core`, which was 11.8 s faster; user time held or fell in every compiler-heavy case. The binaries differ from 40o's only in the dead code of N4, so the change lies in the host's handling of the pool. I did not find its cause. Nothing came near a timeout because of it: batch-only failures and timeouts are 0. | `gate.json` per-suite times and `host.samples`; gate logs w55/w56 |
| N9 | info | **The unstable case and the two heavy timeouts are the usual ones.** `miri-pass` `tests/panic/panic1.rs` is the only `UNSTABLE` row (the `gettid` shim), and no baseline has ever held it. `run-pass-miri-heavy` `hashset-connected-border-12860.rs` (1,849.9 s user, 2,029 MB) and `step_overflowing.rs` (1,850.9 s, 2,017 MB) hit the 1,800 s limit with exit 143. Both did so in 40o and in every gate since `gate-20261110-192312`. Neither is among the suite's 6 protected ids at `e488e464` or `03e9e796`. `git log -S'step_overflowing' -- harness/baseline` finds only wave 39 adding it to `mir-o2` and `mono-ui`, where it is `MATCH`. It is also protected in 15 front-end suites, all `MATCH`. | jsonl; `git show`, `git log -S` |
| N10 | info | **Heavy RSS stays far under the 12,288 MB budget.** Max RSS 40o → 40p: `mir-core` 6,577 → 7,041 MB, `rmeta-core` 6,680 → 6,923, `check-core` 6,525 → 6,428, `check-rg-encode-mir` 3,173 → 3,457, `check-rg` 3,259 → 3,028. `rmeta-core` is inside the binary-mode range w40n N7 recorded (6,102–7,261). `heavyErrors` is empty in every suite. | gate logs w55/w56 |
| N11 | info | **Housekeeping.** The gate polls power every 60 s and keeps a sample on a change of source, every 600 s and at suite edges (w40o N11). `powerLost: []` covers all polls. **Disk:** 12 GiB free (98% used). `subject-bin/` holds four builds: 40o's two and this gate's two. `.data/gate-bun/` is empty. | `df`, `ls` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `e488e464` = `03e9e796` = `c23a6bd2` | `git diff --shortstat e488e464 c23a6bd2 -- harness/baseline`: empty. 60 files |
| Protected ids (`03e9e796`) against this gate's jsonl | **542,304, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its baseline's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `03e9e796`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 60 suites, the same 60 in the same order as 40o. Summed over suites: `lost` 0, `gained` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0, `retried` 15, `unstable` 1. Baseline 542,304, match 542,304, total 542,643, all equal to 40o |
| Gate log (`.data/tmp/gate-w56.log`) | 60 `ok … lost=0 gained=0` lines, then `gate PASS run=gate-20261113-233839-root-yszn`. No `ERROR`, no power note |
| `history.jsonl` accept entry (2026-11-14T05:36:18Z) | `runId` `gate-20261113-233839-root-yszn`, `head` `03e9e796`, 60 suites. Each `protected` equals its baseline's line count at `c23a6bd2` (0 mismatches, sum 542,304) |
| `c23a6bd2` | parent `03e9e796`. Changes only `README.md`, `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` (+1 line). **0 gained, no baseline file touched** |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before (N9) |

**Every row, this gate against wave 40o's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | `attempts` (the 6 mir retries); `retried` added on `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs` |
| `run-pass-miri` | 9 | `attempts` (the 9 run-pass-miri retries); `retried` added on `macro-comma-support-rpass.rs#core` |

Every moved row is `MATCH` in both gates and protected.

**`harness/`, `scripts/` and `tools/`, `e488e464..c23a6bd2`:**

| File | Change | Effect on protected suites |
|---|---|---|
| `scripts/lib/ir-normal.ts` | Header comment only (fixers-56, `ef204833`) | None: no code changed; only IR suites use it (`ir-hello`, report-only); not in a build (N3) |
| `harness/llvm-manifest.json` | +18 pinned LLVM sources (`75dce129`); one trailing comma | Read by coverage `--check`, `llvm-src.ts` and their tests only (N2) |

No change in `harness/baseline`, `harness/suites.ts`, `harness/corpus/`, oracle outputs, any runner script, `tools/`, `UPSTREAM.json`,
`tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`, `src/std/thread.c` or `src/rust_ts/proc_macro_host.c`. With no runner or suite change,
no protected suite's oracle key or runner behaviour can have moved.

## 2. Static steps

From the gate log: `note: subject binary (src/rust_ts/main.ts a38b56e9…, src/miri/bin/miri.ts 674d0f30…)`, then `ok` for typecheck,
unit tests, unit test skips (1, allowlisted, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`), unit tests (alone, 0 skips), runner unit tests
(0 skips), markers, marker order, info sites and frozen lists. `gate.json`: `staticOk: true`, `skipStatic: false`, `unitTestSkips`
`{skipped: 1, allowed: 1, unexpected: []}`, `frozenLists.runId` `gate-20261113-233839-root-yszn-frozen-lists`.

Junit counts, 40o → 40p: unit tests 7,815 → **7,892 tests, 1 skipped, 0 failures (7,891 pass)**; unit tests (alone) 39 → **39**, 0 failures;
runner unit tests 561 → **561**, 0 failures. That is the 7,891 + 39 + 561 of the pre-gate check. The +77 unit tests are the wave's new tests
(`target.oracle`, `tools`, `record.oracle`, `back/lto`, `debuginfo/mod`, `diagnostics` and others), with `skeleton.test.ts` changed.

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged from 40o (and 40k, N1a) |
| `bunExec.start` / `.end` | both at `.data/gate-bun/run-3889-fsSWp0/bun`, sha1 `7c1f29cd…`, `1.4.4`, `38afee6c8`; `goodAt` 05:35:44.168Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 3889 |
| Clone removed | `.data/gate-bun/` is empty |
| Builds' `meta.json` | both: `bun` 1.4.4, full revision, sha1 `7c1f29cd…`; `builtAt` 2026-11-13T23:38:43.599Z / 23:38:48.179Z (built by this gate, which started 23:38:39Z) |

## 4. Subject binaries and the reachable changes

| Entry | Recomputed at `03e9e796` | `gate.json` | inputs (40o) | `inputs` / `config` / `runtimeC` / spec vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `a38b56e930aeba9ef4257933090732ba2f9e1c2e` | equal | 2,114 (2,114) | all identical |
| `src/miri/bin/miri.ts` | `674d0f3012ea5ef2ccba245b9736b4e96a720f42` | equal | 2,301 (2,301) | all identical |

**Inputs against wave 40o's builds**: 2 changed in both, none added, none removed.

| File | What changed | Why protected output cannot move |
|---|---|---|
| `rustc_codegen_ssa/back/lto.ts` | `import type { Lto }` removed | Type-only; no emitted code changes (N4a) |
| `rustc_error_messages/diagnostic_impls.ts` | `CString`/`SmallCStr` `into_diag_arg`: `unported` stop → `Str` of the lossy text; value import of `to_string_lossy` | Only callers are in `rustc_codegen_llvm/diagnostics.gen.ts`, not an input; both absent from both bundles (N4b) |

**Not in either build** (94 of the 96 changed files): 31 under `src/rust_ts/llvm/` (new `target.ts`, `triple.ts`, `subtarget_table.ts`, `tools.ts`,
`tm_fixture.ts`; changed `core`, `ffi`, `fold`, `handles`, `impl_modules`, `record`, `replay`; tests and fixtures), 26 under `src/rustc_codegen_llvm/`
(`llvm_util.ts`, `back/{lto,write}.ts`, `back/write_oracle/record.ts`, `debuginfo/*` including `metadata.ts` and `mod.ts`, `diagnostics.ts`,
`llvm/diagnostic.ts`, `skeleton.test.ts`, oracle fixtures), 8 under `src/rustc_codegen_ssa/` (`back/write.ts`, `mir/*`, tests), the two
runner files of §1, `README.md` and 26 docs. The bundle search in N5 shows the new functions are absent. All of this matches the jsonl: no row's
status or stop reason moved (§1).

## 5. Margins

**Solo retries** (alone wall / user s; pool load at the timeout, 40o → 40p):

| Case | wave 40o | wave 40p | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.2 / 48.1 | **38.6 / 47.6** | −0.6 | 191 → 203 |
| `issue-8827.rs` | 37.8 / 45.4 | **38.1 / 45.6** | +0.3 | 226 → 260 |
| `error-tainting-issue-122904.rs` | 28.0 / 32.2 | 28.5 / 32.8 | +0.5 | 94 → 59 |
| `recursive-drop-elaboration.rs` | 28.0 / 32.1 | 28.0 / 32.3 | 0.0 | 108 → 60 |
| `recursive-drop-elaboration-2.rs` | 28.0 / 32.2 | 27.8 / 32.1 | −0.2 | 108 → 60 |
| `move-3-unique.rs` | 26.7 / 31.8 | 26.2 / 31.4 | −0.5 | 210 → 189 |
| `issue-52475.rs` | 20.6 / 21.4 | 20.6 / 21.3 | 0.0 | 203 → 114 |
| `repeated-vector-syntax.rs` | 20.3 / 26.1 | 20.0 / 26.0 | −0.3 | 132 → 128 |
| `recursion-etc.rs` | 17.0 / 18.9 | 16.3 / 18.4 | −0.7 | 191 → 195 |
| `unique-send-2.rs` | 16.1 / 22.4 | 15.8 / 22.2 | −0.3 | 144 → 155 |
| `infinite_loop.rs` | — | 14.9 / 15.6 | (11-10..11-12: 15.4–15.5) | — → 114 |
| `macro-comma-support-rpass.rs#std` | 14.8 / 23.7 | 14.6 / 23.6 | −0.2 | 177 → 169 |
| `projection-cache-rematch-impl-141124.rs` | — | 14.1 / 18.3 | (14.4–14.7) | — → 83 |
| `let-else-drop-order.rs` | 13.3 / 20.3 | 13.2 / 20.2 | −0.1 | 180 → 168 |
| `macro-comma-support-rpass.rs#core` | — | 12.0 / 20.5 | (12.2–12.8) | — → 169 |

No case is above 45 s alone. The largest, `dynamic-drop.rs` at 38.6 s, leaves 21.4 s of the 60 s limit.

**Heavy suites**, one case at a time: every miri-heavy case is within ±3.0 s of 40o, wall (`dynamic-drop-async.rs` 76.9 → 76.9,
`task-comm-6.rs` 159.1 → 158.5, `issue-94923.rs` 86.4 → 83.4). Compiler-heavy wall: `check-core` 104.8 → 104.2 s, `rmeta-core` 90.8 → 90.8,
`mir-core` 101.3 → 89.5 (user 145.7 → 145.3). RSS is in N10.

## 6. Power and host

| Check | Result |
|---|---|
| `host.powerLost` | `[]` |
| `host.allowBattery` / `gate.json` `allowBattery` | `false` / not set |
| Samples | 144 kept (23:38:39Z → 05:35:44Z), **all `AC Power`, `onBattery: false`, 100%**. Every suite's `hostStart` and `hostEnd` read AC |
| Load (1-min), 40o → 40p | median 75.9 → **42.5**, p90 160.9 → **94.0**, max 239.6 → **211.2**; samples above 100: 43 → **9**; above 200: 5 → **1** (02:52Z) |
| Suite start load, 40o → 40p | mir 146 → 88, miri-pass 76 → 119, run-fail-miri 103 → 66, run-pass-miri 134 → 93, tydump-nocore 72 → 42, resdump 222 → 85, run-pass-miri-heavy 3 → 3 |
| Swap | 6.1–6.5 GB (40o: 5.0–7.0) |
| Suite time | 20,891 s against 20,350 s (+2.7%); see N8 |

## 7. Unstable and unprotected

- **Unstable:** `miri-pass` `tests/panic/panic1.rs`, the only `UNSTABLE` row. `gate.json` `unstableOk: true` (N9).
- **Unprotected timeouts:** `run-pass-miri-heavy` `hashset-connected-border-12860.rs` and `step_overflowing.rs`, both `TIMEOUT` at 1,800 s,
  as in 40o and every gate since 2026-11-10 (N9). These are the gate's only 2 `TIMEOUT` rows.
- **Other unprotected statuses** (UNPORTED 308, DIFF 28) are row-for-row identical to 40o's, stop reasons included.

## 8. Suites not run (report-only)

`harness/suites.ts` at `03e9e796` registers 75 suites. 60 have a baseline, and the gate ran exactly those 60. The other 15 have no file in
`harness/baseline/` and **did not run**: `check-chain`, `check-core-bin`, `cli`, `host-rlib`, `ir-hello`, `mir-heavy`, `miri-fail`,
`miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`, `rlib-native`, `stats-ui`, `target-specs`.
The list is the same as 40o's. None protects anything, so nothing about them can be a loss. The wave's IR-model and `rustc_codegen_llvm`
code is exercised only by the unit step (its oracle tests passed), not by any suite.

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case. Statuses come from the jsonl, compared row by row with 40o's.
- **The oracle-key dump.** I did not run `scripts/oracle-keys.ts`, which would touch the shared `aux/` cache. No runner or protected
  suite's definition changed (§1).
- **The lanes' code.** That covers the fidelity of the target registry, triple parser, `initialize_available_targets`, the cg-di-a
  functions, the LTO port, the `into_diag_arg` lossy decoding and `record.ts`. Those belong to their reviews. I checked reachability, not
  correctness.
- **Dynamic reachability.** N4–N6 rely on the bundler's input lists, its tree-shaking (seen directly in the bundled JS) and `git grep`.
  I ran no case with a tracer.
- **The cause of N8's pool slowdown.** I compared timings only.
- **Coverage numbers.** I did not run `scripts/coverage.ts`, which rewrites `$RUST_TS_DATA/coverage.json`. The gate's `markers` step passed.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log and junit files.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked `node_modules`.
  Both are gitignored.
- I wrote nothing under the main checkout's `.data`: no run dir, no subject build, no oracle cache entry, no coverage file. The key
  recomputation, the import-graph checks and the bundle search ran `Bun.build` in memory, with no output file, over a `git archive` tree in my
  scratchpad. I deleted that tree afterwards.
- This file is the only tracked change.
