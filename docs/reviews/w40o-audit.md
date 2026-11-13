PASS WITH NOTES

**Wave 40o's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `e488e464` is `MATCH` in this gate's jsonl. The accept commit (`c6e3b895`) changed no
baseline. I compared every row of all 102 jsonl files with wave 40n's gate, on every field. The ids and their order are the same in every
file. **Only 12 rows moved, all only in `attempts`.** They are the 12 retries, the same 12 cases that wave 40n retried, and every one is
`MATCH` in both gates. Status counts did not change: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1. UNPORTED rows carry their
stop reason, so **no case's stop moved either**.

**`harness/` and `scripts/` changed in five files, not the three the brief names (N1).** The extra two are `scripts/ir-tiers.ts` and
`scripts/lib/ir-mutations.ts`, from the same n1-name-anon commit. `tools/codegen/` also changed (stable-hash-alloc's generator config).
No protected suite reads any of them, and none is in either binary (N2).

**Both binaries were rebuilt, and they are the tested tree.** I recomputed both keys from a `git archive` of `e488e464`: `838025c7…`
(main.ts, 2,114 inputs) and `7ff0c366…` (miri.ts, 2,301). Both equal `gate.json`. **Eight changed files are in both builds** (N3). The
input set itself did not change: no file was added or removed. Three of the changes alter existing code, not just add to it:
- `stable_hash_AllocId` now hashes, where before it always stopped at `unported`;
- `resolve_instance_raw`'s query value hash went from `undefined` to a real function;
- the `ssa_write` table and `into_compiled_module` now forward to the port instead of stopping at `unported`.

None of the three can reach protected output. I bundled both entries without a sourcemap and searched the JS for each function. **The new
codegen and stable-hash code is absent from both bundles**: `stable_hash_AllocId`, `stable_hash_GlobalAlloc`, `stable_hash_ConstAllocation`,
`lazy_write`, `start_async_codegen`, `into_compiled_module` and `check_lto_allowed` (N5, N6). The new query hash is in the bundle, but only
feedable queries or incremental mode call it, and `resolve_instance_raw` is not feedable (N5). The new `OutputFilenames` methods are in the
bundle as class members, but no live code calls them (N4).

**Host:** on AC power the whole run. Load was higher than in wave 40n (median 75.9 against 55.1), and the same 12 cases were retried, with
alone times within ±0.6 s of 40n's. No alone time is above 45 s: the largest is `dynamic-drop.rs` at 39.2 s.

Regression audit, 2026-11-13. Gate `gate-20261113-154022-root-ghh7`, tested `e488e464`, accepted `c6e3b895`
(`git log -1 -- docs/state/history.jsonl`), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. The previous accept is wave 40n: gate
`gate-20261112-150635-root-u4a3`, tested `66149ab3`, accepted `b2aeb1f5`. I ran no gate, no difftest and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files against wave 40n's, on every field. I checked every id of the 60 baselines at `e488e464`
  (`git show`) against this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept entry and the gate log (`.data/tmp/gate-w55.log`);
- `git diff` over `harness/`, `scripts/`, `UPSTREAM.json`, `tools/`, the config files and the runtime C files, from `66149ab3` to `c6e3b895`;
- both subject-bin keys, recomputed in a `git archive` tree of `e488e464` with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`.
  The key was taken over `meta.spec`, the gate's own spec. Separately, the archive's spec, rebased onto the gate's paths, equals `meta.spec`;
- the inputs of both builds against wave 40n's (`meta.json`), and `git diff` of each changed input, hunk by hunk;
- a `git grep` for callers of each changed or new function;
- an in-memory `Bun.build` of both entries from the archive tree, with no sourcemap, searched for the changed and new functions (N5, N6);
- `gate.json` `retryTimes`, `heavy`, `host.samples` and per-suite times against wave 40n.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the
host was quiet (1-minute load about 2). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The brief's list of `harness/`/`scripts/` changes is short by two files, and `tools/` changed too.** `git diff --stat 66149ab3 c6e3b895 -- harness/ scripts/` shows five files. Besides `scripts/lib/ir-normal.ts`, `scripts/ir-normal.test.ts` and `harness/llvm-manifest.json`, it lists `scripts/ir-tiers.ts` (2 lines: it now imports `OPT_PASSES` for its bitcode check) and `scripts/lib/ir-mutations.ts` (+9: three mutations for `name-anon-globals`). Both come from the same commit `421de575` as the rest of n1-name-anon, which review `n1-name-anon.md` covered (PASS WITH NOTES). `ir-tiers.ts` is a hand-run tool ("Not a suite, not a gate; oracle only"). `ir-mutations.ts` is read only by it and by `ir-normal.test.ts`. The llvm-manifest gains seven pinned LLVM sources from llir-folder (`APInt.h`, `Attributes.h`, `CallingConv.h`, `DataLayout.h`, `IntrinsicsARM.td`, `Operator.h`, `ConstantRange.cpp`): +7 lines, none removed or rehashed (commit `1abfdf09`). Only `scripts/coverage.ts --check`, `scripts/llvm-src.ts` and the `llvm-src` unit test read it. Outside the brief's paths, `tools/codegen/{stable_hash.json,types.sets.json}` changed (+25 −3, `ba68406f`). That is stable-hash-alloc's generator config. Its output is the regenerated `.gen.ts` files in N5, so its effect on the builds is fully covered there. | `git diff --stat`, `git log` per file |
| N2 | info | **`ir-normal.ts` changes how no protected suite is compared, and is in neither build.** Readers at `e488e464`: `harness/suites.ts` (a `type` import, plus a file hash in `irToolsKey`), `scripts/gate.ts` (a `type` import) and `scripts/difftest.ts` (`isIrTier`, a run-time import used only to check `--ir-tier`; unchanged). `ir-run.ts`, `ir-diff.ts`, `ir-tiers.ts` and a few tests read it too. `irToolsKey` is reached only through `irOracleKey`, which only `irSuite`'s `oracleKey` calls. `irSuite` has one user, `ir-hello`, which has no baseline and did not run. No suite in `gate.json` carries an `irTier`. The module still imports only `node:path`, so loading it from `difftest.ts` has no new side effect: the change only adds an exported const. Both builds' non-`src/` inputs are `scripts/lib/{common,env}.ts`, plus `miri,oracle,toolchain` for miri.ts. No `ir-*` file is among them. | `git grep ir-normal e488e464`; `meta.json` inputs |
| N3 | low | **The reachable changes are eight files, the same in both builds.** They are `rustc_session/config.ts` (ssa-write); `rustc_codegen_ssa/{base,lib,back/lto}.ts` (integ-w55's "wire ssa-write", `7565c468`); and `rustc_abi/stable_hash.gen.ts`, `rustc_middle/{mir_stable_hash.gen,queries.gen,ty/impls_ty}.ts` (stable-hash-alloc, `ba68406f`). The brief names three of these four groups; it does not mention `queries.gen.ts` or `impls_ty.ts`. No input was added or removed: 2,114 and 2,301, as in 40n. `CONFIG_FILES` and `RUNTIME_C_FILES` match 40n's builds. Of the 106 files changed in `66149ab3..e488e464`, the other 98 are in neither build. They are 11 under `src/rustc_codegen_llvm/`, 17 under `src/rust_ts/llvm/`, 14 under `src/rustc_codegen_ssa/` (`back/write.ts`, `mir/*`, `debuginfo/*`, `mono_item.ts`, `traits/builder.ts`), 30 tests and fixtures, 20 docs, and the 7 files of N1. | both `meta.json` input lists, 40n → 40o |
| N4 | info | **The `OutputFilenames` additions are reachable only from codegen.** `config.ts` (+126 −3) adds four module consts: `RLINK_EXT`, `RUST_CGU_EXT`, `DWARF_OBJECT_EXT` and `MAX_FILENAME_LENGTH`. It adds two module functions, `maybe_strip_file_name` and `path_set_file_name`, and four methods: `temp_path_for_cgu`, `temp_path_dwo_for_cgu`, `temp_path_ext_for_cgu` and `split_dwarf_path`. The three `-` lines are a header comment and two imports. `StableHasher` went from a `type` import to a value import, and `Str` and `str_ceil_char_boundary` were added. Both source modules were already inputs. No existing method body changed. Callers of the new methods are `rustc_codegen_ssa/lib.ts` `into_compiled_module` (absent from both bundles, N6), `rustc_codegen_ssa/back/write.ts` and `rustc_codegen_llvm/back/write.ts`, neither of which is an input. The methods stay in the bundle because a class is kept whole, but nothing live calls them. | `git diff -U0`; `git grep`; bundle search |
| N5 | info | **The stable-hash regeneration is unreachable; two of its edits are not pure additions.** **(a)** `rustc_abi/stable_hash.gen.ts` adds `stable_hash_Size` only. It is in the bundle because `ty/adt.ts` loads the module through a lazy `require`, which keeps every export. But `adt.ts` calls only `stable_hash_ReprOptions`, and the only callers of `stable_hash_Size` are new functions in `mir_stable_hash.gen.ts`. **(b)** `mir_stable_hash.gen.ts` adds eight functions, from `GlobalAlloc` and `Allocation` to `ProvenanceMap`, plus imports, with no other change. None of them is in either bundle. **(c)** `ty/impls_ty.ts` `stable_hash_AllocId` used to stop at `unported("…GlobalAlloc: StableHash (derive not generated)")` on every path. Now it hashes `Option<GlobalAlloc>`. A protected `MATCH` case cannot have reached the old stop, and no row in either gate names it. `stable_hash_AllocId` and its only caller, `stable_hash_CtfeProvenance`, are absent from both bundles. **(d)** `queries.gen.ts` sets `resolve_instance_raw`'s `stable_hash_value`, where it was `undefined`. Before, `hash_value_fn` (`query_vtables.ts:76`) wrapped `undefined` as an `unported` stop; now it is a real hash. `hash_value_fn` is called only by `query_feed` (`calls.ts:222`), by `check_feedable_consistency` (`execution.ts:215`, which runs only `if (query.feedable)`) and by `execute_query_incr_inner`, which is `unported` (no dep graph, D3). The disabled graph's `with_task` and `with_feed_task` ignore it. `resolve_instance_raw` has `feedable: false`, and no `feed_resolve_instance_raw` exists. So the new closure is in the bundle, inside `QUERY_DECLS`, but nothing calls it. | `git diff`; bundle search; `query_vtables.ts`, `execution.ts`, `calls.ts` |
| N6 | info | **The codegen_ssa wiring is tree-shaken out of both binaries.** `base.ts`'s `ssa_write` table used to stop at `unported("ssa-write: …")` in every entry. Now each entry forwards to `back/write.ts` through `lazy_write()`, a literal `require("./back/write.ts")`. `back/write.ts` is not an input of either build, and `lazy_write` and `start_async_codegen` do not occur in either bundle. That is the same tree-shaking wave 40n's audit showed (w40n N5): no live path reaches `codegen_crate`. The six `codegen_crate` hits in the bundle are the `rustc_interface` call site and stand-in backends' methods, not `base.ts`'s function. In `lib.ts`, `into_compiled_module` now calls the new `OutputFilenames` methods instead of two local `unported` stubs, which were deleted. It is absent from both bundles. In `back/lto.ts`, `check_lto_allowed` loses a TS-only cast (`as unknown as CodegenContext_lto_fields`), which compiles to nothing. It is absent from both bundles too. The functions that are live, such as `CrateInfo_new` and `exported_symbols_for_lto`, did not change. The other hunks are comments and `type` imports. | `git diff 66149ab3 e488e464 -- src/rustc_codegen_ssa`; bundle search |
| N7 | info | **The module graph changed, which can move module init order; nothing shows that it did harm.** There are two new value imports: `mir_stable_hash.gen.ts` ↔ `ty/impls_ty.ts` (a new cycle) and `config.ts` → `rustc_data_structures/stable_hash.ts`. The new top-level code is a `const GlobalAlloc__discriminant`, which is dropped with its function, and `config.ts`'s four literal consts. Init order is covered by the unit step's contract test "the crate root and every module load as a fresh entry point (init order)", which passed (18.8 s). A broken init would crash every case, and all 542,304 are `MATCH`. | gate log; `git diff` imports |
| N8 | low | **Retries are the same 12 cases as wave 40n, with alone times within ±0.6 s. None is above 45 s.** The 12 are mir: `issue-52475.rs`, `error-tainting-issue-122904.rs` and both `recursive-drop-elaboration*.rs`; and run-pass-miri: `repeated-vector-syntax.rs`, `unique-send-2.rs`, `dynamic-drop.rs`, `recursion-etc.rs`, `let-else-drop-order.rs`, `macro-comma-support-rpass.rs#std`, `move-3-unique.rs` and `issue-8827.rs`. **`dynamic-drop.rs` took 39.2 s alone** (40n 38.6), inside its binary-mode range of 38.6–39.9 s. That leaves 20.8 s of the 60 s limit, 5.8 s under the 45 s line. **`issue-8827.rs` took 37.8 s** (40n 38.4), below its earlier range of 38.4–39.3 s. Pool load at the 12 timeouts was 93.8–226.1 (40n: 62.8–219.8). The same retries under higher load, on a binary that differs from 40n's only in code these cases cannot run (N3–N6), point to load as the cause of the retries. | `gate.json` `retryTimes`, both gates; w40n-audit §5 |
| N9 | info | **Heavy-suite peak RSS moved both ways; every case stays far under the 12,288 MB budget.** Max RSS 40n → 40o: `check-core` 5,993 → 6,525 MB, `check-rg` 2,691 → 3,259, `rmeta-core` 6,548 → 6,680, `mir-core` 6,472 → 6,577, `check-rg-encode-mir` 3,333 → 3,173, `check-rg-host` 2,947 → 2,843. `check-core` and `rmeta-core` are inside the binary-mode ranges w40n N7 recorded (5,741–6,860 and 6,102–7,261). I did not collect `check-rg`'s range. `check-core` wall rose 92.8 → 104.8 s, at user time 140.6 → 145.3 s. Every miri-heavy case is within ±1.7 s of 40n, wall. `heavyErrors` is empty in every suite. | `gate.json` `heavy`, both gates; gate log |
| N10 | info | **The unstable case and the two heavy timeouts are the usual ones.** `miri-pass` `tests/panic/panic1.rs` is the only `UNSTABLE` row (the `gettid` shim reads the real pid). It is unstable in every gate since 2026-11-04, and `git log -S'tests/panic/panic1.rs' -- harness/baseline` finds no commit. `run-pass-miri-heavy` `hashset-connected-border-12860.rs` (1,849.6 s user, 2,010 MB) and `step_overflowing.rs` (1,849.7 s, 2,023 MB) hit the 1,800 s limit, exit 143, as in every gate since the suite began. They are not among its 6 protected ids. | `miri-pass.jsonl`, `run-pass-miri-heavy.jsonl`; w40n N8 |
| N11 | info | **The kept host samples are up to about 10 minutes apart, as the sampler is built to keep them.** The gate polls power every 60 s. It keeps a poll only on a change of source, or once 600 s have passed, and it always keeps suite edges (w40n N9). So `powerLost: []` covers all 60 s polls, not just the 144 kept samples. A battery spell shorter than one poll would not show. **Disk:** 9.3 GiB free (98% used). `subject-bin/` holds four builds, 40n's two and this gate's two. `.data/gate-bun/` is empty. | `scripts/gate.ts`, `scripts/lib/host-state.ts`; `df`, `ls` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `66149ab3` = `e488e464` = `c6e3b895` | `git diff --shortstat 66149ab3 c6e3b895 -- harness/baseline`: empty. 60 files |
| Protected ids (`e488e464`) against this gate's jsonl | **542,304, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its baseline's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `e488e464`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 60 suites, the same 60 in the same order as 40n. Summed over suites: `lost` 0, `gained` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0. Baseline 542,304, match 542,304, total 542,643, all equal to 40n |
| Gate log | 60 `ok … lost=0 gained=0` lines, then `gate PASS run=gate-20261113-154022-root-ghh7`. No `ERROR`, no power note |
| `history.jsonl` accept entry (21:28:58Z) | `runId` `gate-20261113-154022-root-ghh7`, `head` `e488e464`, 60 suites. Each `protected` equals its baseline's line count at `c6e3b895` (0 mismatches, sum 542,304) |
| `c6e3b895` | parent `e488e464`. Changes only `README.md`, `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` (+1 line). **0 gained, no baseline file touched** |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before (N10) |

**Every row, this gate against wave 40n's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 4 | `attempts` only (the 4 mir retries, both gates) |
| `run-pass-miri` | 8 | `attempts` only (the 8 run-pass-miri retries, both gates) |

Every moved row is `MATCH` in both gates.

**`harness/` and `scripts/`, `66149ab3..c6e3b895`:**

| File | Change | Effect on protected suites |
|---|---|---|
| `scripts/lib/ir-normal.ts` | N1, N2, N3 now run `name-anon-globals` before `assign-guid`; `OPT_PASSES` exported; header comments | None: only IR suites use it (`ir-hello`, report-only); not in a build (N2) |
| `scripts/ir-normal.test.ts` | Expectations follow the new pass list; reads `OPT_PASSES` | Runner unit test; passed |
| `scripts/lib/ir-mutations.ts` | +3 mutations (two must stay visible, one always absorbed) | Read by `ir-normal.test.ts` and `ir-tiers.ts` only (N1) |
| `scripts/ir-tiers.ts` | Reads `OPT_PASSES` for its bitcode check | Hand-run tool, not a suite or gate step (N1) |
| `harness/llvm-manifest.json` | +7 pinned LLVM sources | Read by coverage `--check`, `llvm-src.ts` and its test only (N1) |

No change in `harness/baseline`, `harness/suites.ts`, `harness/corpus/`, oracle outputs, any runner script, `UPSTREAM.json`, `tsconfig.json`,
`package.json`, `bunfig.toml`, `bun.lock`, `src/std/thread.c` or `src/rust_ts/proc_macro_host.c`. In `tools/`, only the codegen config of N1
changed. With no runner or suite change outside the IR path, no protected suite's oracle key or runner behaviour can have moved.

## 2. Static steps

From the gate log `.data/tmp/gate-w55.log`: `note: subject binary (src/rust_ts/main.ts 838025c7…, src/miri/bin/miri.ts 7ff0c366…)`, then
`ok` for typecheck, unit tests, unit test skips (1, allowlisted, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`), unit tests (alone, 0 skips),
runner unit tests (0 skips), markers, marker order, info sites and frozen lists. `gate.json`: `staticOk: true`, `skipStatic: false`,
`unitTestSkips` `{skipped: 1, allowed: 1, unexpected: []}`, `frozenLists.runId` `gate-20261113-154022-root-ghh7-frozen-lists`.

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged |
| `bunExec.start` / `.end` | both at `.data/gate-bun/run-84462-CmzZBw/bun`, sha1 `7c1f29cd…`, `1.4.4`, `38afee6c8`; `goodAt` 21:28:41.112Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 84462 |
| Clone removed | `.data/gate-bun/` is empty |
| Builds' `meta.json` | both: `bun` 1.4.4, full revision, sha1 `7c1f29cd…`; `builtAt` 2026-11-13T15:40:27.533Z / 15:40:32.366Z (built by this gate, which started 15:40:22Z) |

## 4. Subject binaries and the reachable changes

| Entry | Recomputed at `e488e464` | `gate.json` | inputs (40n) | `inputs` / `config` / `runtimeC` / spec vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `838025c749509bed8140c264f060eeaf8bd13c1e` | equal | 2,114 (2,114) | all identical |
| `src/miri/bin/miri.ts` | `7ff0c36656085f1f9b69b5b8f0fe07e82dc6d8ac` | equal | 2,301 (2,301) | all identical |

The key (`subjectBinKeyOf`, v4) hashes the spec (with the Bun path replaced by a placeholder), the Bun (version, revision, sha1), the builder
source (`subject-bin.ts`, unchanged), every bundled input's path and sha1, `CONFIG_FILES` and `RUNTIME_C_FILES` (both identical to 40n's
builds).

**Inputs against wave 40n's builds**: 8 changed in both, none added, none removed.

| File | What changed | Why protected output cannot move |
|---|---|---|
| `rustc_session/config.ts` | +4 consts, +2 module fns, +4 `OutputFilenames` methods; `StableHasher` value import; comment | Additions only; callers are dead or outside the builds (N4) |
| `rustc_codegen_ssa/base.ts` | `ssa_write` entries forward to `back/write.ts` instead of `unported`; placeholder `OngoingCodegen`/`Coordinator` interfaces replaced by `back/write.ts`'s types; comments | `ssa_write` and `lazy_write` are tree-shaken out; `back/write.ts` is not an input (N6) |
| `rustc_codegen_ssa/lib.ts` | `into_compiled_module` calls the session methods; two `unported` stubs removed; comment | `into_compiled_module` is absent from both bundles (N6) |
| `rustc_codegen_ssa/back/lto.ts` | TS-only cast removed from `check_lto_allowed`; local interface and comment removed | No run-time change; absent from both bundles (N6) |
| `rustc_abi/stable_hash.gen.ts` | +`stable_hash_Size`; imports | Called only from dropped code (N5a) |
| `rustc_middle/mir_stable_hash.gen.ts` | +8 derive functions; imports | All absent from both bundles (N5b) |
| `rustc_middle/ty/impls_ty.ts` | `stable_hash_AllocId`: `unported` stop → hash of `Option<GlobalAlloc>` | Absent from both bundles; no row stopped there (N5c) |
| `rustc_middle/queries.gen.ts` | `resolve_instance_raw` `stable_hash_value`: `undefined` → hash fn; import | Only feedable queries or incremental mode hash; this query is neither (N5d) |

All of this matches the jsonl: no row's status or stop reason moved (§1).

## 5. Margins

**Solo retries** (alone wall / user s; pool load at the timeout, 40n → 40o):

| Case | wave 40n | wave 40o | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 38.6 / 47.6 | **39.2 / 48.1** | +0.6 | 112 → 191 |
| `issue-8827.rs` | 38.4 / 46.0 | **37.8 / 45.4** | −0.6 | 208 → 226 |
| `error-tainting-issue-122904.rs` | 28.3 / 32.6 | 28.0 / 32.2 | −0.3 | 100 → 94 |
| `recursive-drop-elaboration.rs` | 28.2 / 32.4 | 28.0 / 32.1 | −0.2 | 107 → 108 |
| `recursive-drop-elaboration-2.rs` | 28.0 / 32.4 | 28.0 / 32.2 | 0.0 | 107 → 108 |
| `move-3-unique.rs` | 26.4 / 31.4 | 26.7 / 31.8 | +0.3 | 220 → 210 |
| `issue-52475.rs` | 20.3 / 21.0 | 20.6 / 21.4 | +0.3 | 127 → 203 |
| `repeated-vector-syntax.rs` | 20.1 / 26.0 | 20.3 / 26.1 | +0.2 | 63 → 132 |
| `recursion-etc.rs` | 16.8 / 18.8 | 17.0 / 18.9 | +0.2 | 111 → 191 |
| `unique-send-2.rs` | 15.9 / 22.2 | 16.1 / 22.4 | +0.2 | 74 → 144 |
| `macro-comma-support-rpass.rs#std` | 14.6 / 23.5 | 14.8 / 23.7 | +0.2 | 175 → 177 |
| `let-else-drop-order.rs` | 13.2 / 20.2 | 13.3 / 20.3 | +0.1 | 139 → 180 |

No case is above 45 s alone. The largest, `dynamic-drop.rs` at 39.2 s, leaves 20.8 s of the 60 s limit. Every retry started its alone run
on a host that was still busy: load 135 at the first mir retry, 218 at the first run-pass-miri one.

**Heavy suites**, one case at a time: every miri-heavy case is within ±1.7 s of 40n, wall (`dynamic-drop-async.rs` 77.3 → 76.9,
`task-comm-6.rs` 157.4 → 159.1, `issue-94923.rs` 85.6 → 86.4). These cases are over 45 s, but they run in the heavy suites, under their
1,800 s limit and outside the 45 s rule. Compiler-heavy RSS is in N9.

## 6. Power and host

| Check | Result |
|---|---|
| `host.powerLost` | `[]` |
| `host.allowBattery` / `gate.json` `allowBattery` | `false` / not set |
| Samples | 144 kept (15:40:22Z → 21:28:41Z), **all `AC Power`, `onBattery: false`, 100%**. Every suite's `hostStart` and `hostEnd` read AC |
| Load (1-min), 40n → 40o | median 55.1 → **75.9**, p90 96.8 → **160.9**, max 202.5 → **239.6**; samples above 100: 13 → **43**; above 200: 1 → **5** (4 during `resdump-nocore`/`resdump` 17:42–17:55Z, 1 during `run-pass-miri` 18:47Z) |
| Suite start load, 40n → 40o | mir 71 → 146, miri-pass 69 → 76, run-fail-miri 90 → 103, run-pass-miri 87 → 134, tydump-nocore 81 → 72, run-pass-miri-heavy 3 → 3 |
| Swap | 4.9–6.8 GB (40n: 6.0–7.3) |
| Suite time | 20,350 s against 20,093 s (+1.3%). `mir` 1,396 → 1,399 s, `run-pass-miri` 987 → 980 s, `tydump-nocore` 2,057 → 2,189 s |
| Polling | power every 60 s; kept on change or every 600 s, plus suite edges (N11) |

## 7. Unstable and unprotected

- **Unstable:** `miri-pass` `tests/panic/panic1.rs`, the only `UNSTABLE` row in the gate. No baseline has ever held it (N10).
  `gate.json` `unstableOk: true`.
- **Unprotected timeouts:** `run-pass-miri-heavy` `hashset-connected-border-12860.rs` and `step_overflowing.rs`, both `TIMEOUT` at 1,800 s,
  as in every gate since the suite began (N10). These are the gate's only 2 `TIMEOUT` rows.
- **Other unprotected statuses** (UNPORTED 308, DIFF 28) are row-for-row identical to 40n's, stop reasons included.

## 8. Suites not run (report-only)

`harness/suites.ts` at `e488e464` registers 75 suites. 60 have a baseline, and the gate ran exactly those 60. The other 15 have no file in
`harness/baseline/` and **did not run**: `check-chain`, `check-core-bin`, `cli`, `host-rlib`, `ir-hello`, `mir-heavy`, `miri-fail`,
`miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`, `rlib-native`, `stats-ui`, `target-specs`.
The list is the same as 40n's. None protects anything, so nothing about them can be a loss. `ir-hello` is the only suite that reads
`ir-normal.ts`, and it did not run, so the n1-name-anon change was not exercised by this gate beyond the runner unit tests.

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case. Statuses come from the jsonl, compared row by row with 40n's.
- **The oracle-key dump.** I did not dump keys with `scripts/oracle-keys.ts`, which would touch the shared `aux/` cache. No runner or
  protected suite's definition changed (§1, N2).
- **The lanes' code.** That covers the fidelity of the `OutputFilenames` methods, the generated `StableHash` derives, `stable_hash_AllocId`,
  the `ssa_write` forwarding, and n1-name-anon's IR normal form. Those belong to their reviews. I checked reachability, not correctness.
- **Dynamic reachability.** N4–N6 rely on static import graphs, the bundler's tree-shaking (seen directly in the bundled JS) and `git grep`.
  I ran no case with a tracer. Because the gate ran in binary mode, the bundles hold all the code `main.ts` and `miri.ts` can run.
  The query-hash argument (N5d) is about call sites, not the bundle.
- **Coverage numbers.** I did not run `scripts/coverage.ts`, which rewrites `$RUST_TS_DATA/coverage.json`. The gate's `markers` step passed.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked `node_modules`.
  Both are gitignored.
- I wrote nothing under the main checkout's `.data`: no run dir, no subject build, no oracle cache entry, no coverage file. The key
  recomputation and the bundle search ran `Bun.build` in memory, with no output file, over a `git archive` tree in my scratchpad. I deleted
  that tree afterwards.
- This file is the only tracked change.
