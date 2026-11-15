PASS WITH NOTES

**Wave 40s's accept stands.** No protected case was lost, removed or tampered with. All 67 suites ran. I checked each of the
555,887 protected ids in the 67 `harness/baseline/*.txt` files at `da1c0393` against this gate's jsonl. Every one is `MATCH`.

The accept commit (`5195eab9`, parent `da1c0393`) only adds ids, and only to five baselines: `ir-host` +107, `run-pass-native` +112,
`ir-run-pass-o0` +56, `ir-run-pass` +53 and `run-fail-native` +1. That is 329, which equals `gained`. Each grown baseline is exactly its
suite's MATCH set in this gate. Each added id is in that suite's `gained` list.

I compared every row of the 114 jsonl files with wave 40r's, on every field. The files, ids and order are the same. **The only status
moves are the 329 gains, all `UNPORTED → MATCH`.** None was a DIFF before. No DIFF, TIMEOUT or UNSTABLE row changed status. Besides the gains,
62 rows changed, none in a protected outcome:
- 45 `unported` messages. 27 are fat-LTO stops in the IR suites, now the by-name stop from the recorded decision. 18 are asm stops,
  now deeper, in the IR model.
- 13 `attempts`/`retried` rows: the retries.
- 4 UNSTABLE rows: 3 `subject` changes, and `yield.rs`'s reason text.

**The newly protected cases are sound** (N3–N6). 104 of the 113 new native cases also MATCH as aarch64 IR text in `ir-host`. Every
newly protected `-g` IR case carries `DICompileUnit` and `identifier:` strings that are compared at N1, so the hand-written
`UniqueTypeId` StableHash is checked as text. Nine native cases have no IR twin: eight fat-LTO cases whose IR stops by name, as decided
(N3), and one `-g` run-fail case whose debuginfo is never compared (N4). After the masks, no native oracle output shows an address,
time, thread id or temp path.

**Two notes for root:**
- **N1:** the `yield1.rs` decision rests on a wrong premise. The gate re-runs only subject timeouts. A `2\n1` from that program would
  be counted lost at once.
- **N2:** the power supply dropped for 3 seconds during `ir-run-pass`, and the gate's 60 s samples missed it. It had no effect.

Regression audit, 2026-11-15. Gate `gate-20261115-021222-root-rgng`, tested `da1c0393`, accepted `5195eab9`, `RUST_TS_SUBJECT=binary`,
Bun 1.4.4. Previous accept: wave 40r, gate `gate-20261114-162816-root-vc2v`, tested `241df65f`, accepted `4ec9a565`. I ran no gate, no
difftest and no full suite. What I ran:
- **Rows:** every row of the 114 jsonl files against 40r's, on every field. Every baseline id at `da1c0393` (`git show`) against this
  gate's jsonl. Every grown baseline at `5195eab9` against its suite's MATCH rows and `gained`.
- **Records:** `gate.json`, the accept and milestone entries of `history.jsonl`, the gate log (`.data/tmp/gate-w59.log`), the summaries
  (diffed with 40r's) and the three junit files.
- **Oracle cache:**
  - every file written during the gate, found by mtime;
  - the cached oracle output of each of the 329 new cases, by difftest's own `caseOracleCacheKey` in this tree, scanned after the
    suite's masks.
- **Binaries:** both subject-bin keys, recomputed from a `git archive` of `da1c0393`. Their inputs compared with 40r's builds.
- **Diffs:**
  - `git diff 241df65f 5195eab9` over `harness/`, `scripts/` and `tools/`;
  - the changed sources that a compile without codegen can reach.
- **Power:** `gate.json` samples and `pmset -g log`.
- **Criteria:** `bun scripts/criteria.ts --run gate-20261115-021222-root-rgng --milestone M7`.

AC power throughout my work (`pmset -g batt`), and `RUSTUP_AUTO_INSTALL=0`. No gate was running (no `.data/tmp/GATE_RUNNING`). I
changed no code.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The `yield1.rs` decision assumes a retry that the gate does not make.** The decision (history 2026-11-15T00:35, w40r-audit N2) says it "stays protected for now: the gate retries a failing case alone before counting it lost", and that it is withdrawn "if it ever needs a retry or fails". **But only subject timeouts are re-run alone.** The pool's `TIMEOUT` rows go back through `SUBJECT_TIMEOUT_RETRY_CAP` (`difftest.ts:1180-1203`); a DIFF is final. native-run runs the subject's program once (`--runs 1`, `suites.ts:2341`). The oracle side is cached, and the cache holds its `1\n2`. So if the program prints `2\n1`, the case is a DIFF, `lost` gets 1 and the gate fails. "Needs a retry" can never fire for this case: its first sign of trouble is a failed gate. **In this gate** `yield1.rs` is `MATCH` with no `retried` or `attempts`, as in 40r. That is its second clean gate. `NATIVE_UNSTABLE` still lists `yield.rs` only. **Recommendation:** correct the decision's text, so that a `yield1.rs` loss is read as a known race (withdraw it and list it, as decided) and not as a regression. Or list it now. | `difftest.ts:98-99,1180-1203`; `suites.ts:2341`; jsonl; history:715 |
| N2 | low | **A 3-second battery spell during `ir-run-pass`, which the gate did not record.** `pmset -g log`: `Using Batt(Charge: 100)` at 05:18:10 +0200 and `Using AC` at 05:18:13 (03:18:10Z to 03:18:13Z), then PowerChime's `chimeOnAttach`. That is the adapter being re-attached. `ir-run-pass` ran from 03:15:08Z to 03:22:11Z. `host.powerLost` is `[]`, and all 157 samples and every suite's `hostStart`/`hostEnd` read AC. A 60 s sample cannot see 3 s, as AGENTS.md §2 says. **No effect:** `ir-run-pass` has no retry and no TIMEOUT, its 3,369 protected cases are MATCH, and its rows equal 40r's apart from the 53 gains and 17 stop messages. Slowness can turn a case into a timeout, but it cannot make a case MATCH. No other `Using Batt` falls in the gate's window (02:12:22Z to 08:38:22Z). | `pmset -g log`; `gate.json` `host` |
| N3 | info | **Fat LTO: 10 newly protected `run-pass-native` cases. Eight of them are behaviour-only parity, as decided.** Under the decision of 2026-11-15T01:19 (option a), a fat-LTO module whose `llvm-link` merged a named struct type stops by name when it is printed or written (`assert_types_unmerged`, `tools.ts:1116`). The flag is set only when a destination `%T = type` line is missing after the link (`tools.ts:1210`). Objects and binaries go on. **In the IR suites** every such case stays UNPORTED: 27 rows (9 per suite) moved from `LLVMRustModuleCost` to the by-name stop. No IR case with merged types is MATCH. **The eight** are `issue-64655-allow-unwind-when-calling-panic-directly.rs#fat`, `issue-64655-extern-rust-must-allow-unwind.rs#fat0`–`#fat3`, `lto/lto-still-runs-thread-dtors.rs`, `panic-runtime/lto-abort.rs` and `lto-unwind.rs`. They MATCH in `run-pass-native`, which compares program behaviour, and stop by name in all three IR suites. Merging look-alike named types renames types and does not change code, so their MATCHes are parity of behaviour, which is all that suite claims. **The other two,** `lto/fat-lto.rs` and `lto/lto-many-codegen-units.rs`, merge no type. They MATCH as IR text in all three IR suites too, so they are text parity, including `restoreDestinationOrder`'s reordering. | jsonl; `tools.ts:1090-1117,1210`; history 01:19 |
| N4 | info | **`-g`: the hand-written StableHash is checked as text. One run-fail case's debuginfo is not compared at all.** 99 of the 329 were stopped at `LLVMCreateDIBuilder`. **IR suites (74 = 24 + 25 + 25):** every oracle output contains `DICompileUnit` and `identifier: "…"`. N1 keeps metadata content and drops only numbering and unused nodes (`ir-normal.ts` header), so each MATCH compares the `identifier:` hashes byte for byte. That is the check the decision of 01:33 relies on. **`run-pass-native` (24):** each id also MATCHes in `ir-host`. **`run-fail-native` (1):** `tests/ui/panics/location-detail-unwrap-multiline.rs` (`-Cdebuginfo=line-tables-only`, `RUST_BACKTRACE=1`). It has no IR twin, since the IR suites take run-pass tests only. Its line tables would show only in the backtrace, which native-run cuts on both sides (`stack backtrace: <cut>` in the oracle output). The verdict line uses the panic location (`:11:10`), which comes from `#[track_caller]`, not from debuginfo. So the MATCH is sound, but it says nothing about debuginfo. | oracle cache; `ir-normal.ts`; history 01:33 |
| N5 | info | **SIMD, asm, folds and aarch64 intrinsics: every new native case has a host IR twin that MATCHes.** The 329 by previous stop: aarch64 intrinsic table 109, `LLVMCreateDIBuilder` 99, `generic_simd_intrinsic` 65, `codegen_inline_asm` 21, `LLVMRustModuleCost` 16, `codegen_global_asm` 9, `FoldBitCast scalar-to-vector` 8, `getABITypeAlign of Struct` 3. Of the 113 native cases, 53 intrinsic, 16 SIMD, 7 asm, 2 fold, 24 `-g` and 2 fat-LTO cases are MATCH in `ir-host` (aarch64 IR text at N1). That is 104. The other nine are N3's eight and N4's one. So outside N3, the native MATCHes do not rest on luck: their IR is the oracle's. | `gained` × `ir-host.jsonl` |
| N6 | info | **No nondeterminism in the new native oracle outputs.** For the 113 cases (112 + 1), I read the cached entry, applied `maskedTexts` with `maskProgramOutput`, and searched for: `0x` + 6 or more hex digits; `ThreadId(`; `thread '…' (<digits>)`; `finished in <digit>`; `/var/folders`, `/tmp`, `/private/tmp` and `.data/` paths; `rustc` + 6 characters (a temp dir); time units, `Duration`, `Instant` and `elapsed`; `pid`; and `timed out after`. **No hits.** Every one of the 329 has a cache entry, with exit 0 from the wrapper. 319 of them were written in 40r's gate window (21–22Z on 11-14). The other 10 were written earlier the same day, under the same key. | oracle cache |
| N7 | info | **The 61 earlier suites' definitions are unchanged, by this gate's own evidence.** No oracle cache entry was written between 02:12Z and 08:38:30Z, or since. So every case of all 67 suites hit the cache, and its key was unchanged: pin, oracle version, suite, id, args, file hash, env, deps, `oracleKey`, and for the native suites `nativeOracleKey`, which hashes all of `native-run.ts`. The same ids are in the same order in all 114 files, including `.skipped` and `.extra`. **The summaries** equal 40r's apart from timings, with three exceptions: `run-pass-miri` has one retry fewer; `mir-o2` and `mono-ui` gain `criterion.unstable: 0`; the five gaining suites have new counts. | oracle-cache mtimes; summaries |
| N8 | info | **No earlier front-end suite reaches the new debuginfo, asm, SIMD or LTO code.** The LLVM model and `rustc_codegen_llvm` are loaded only by `ported_backend`'s `require` (`codegen_backend.ts:319-331`). It runs at `codegen_crate`, `join_codegen`, `link` and the statistics forwards. Outside those two trees, the only static import of either is `codegen_backend.ts:34`, `import type`, which is erased. `mono-run.ts` overrides `codegen_crate`, `link` and `join_codegen`. **The non-comment changes to code a compile without codegen loads** are three. `filesearch.ts` `default_sysroot` now calls `oracle_sysroot_env.ts` `spawn_print_sysroot`, with the same toolchain string, env, stdin and newline strip (equivalent). `rustc_interface/util.ts` gives the dummy backend's `create_dll_import_lib`, which only `link_rlib` reaches, on Windows targets. `raw_dylib.ts` and `apple.ts` changed link-time code only. `base.ts` and `codegen_backend.ts` changed only comments. So only codegen compiles reach the new code: `ir-*`, `native-hello`, `run-pass-native` and `run-fail-native`. Every earlier row is unchanged (N7). **Still open from w40r N3:** `filesearch.ts:177` still says "Every protected suite passes `--sysroot`", and the decision of 00:35 queues that fix. | `codegen_backend.ts`; `git diff 241df65f da1c0393`; `git grep` |
| N9 | info | **A quieter host than 40r, and faster.** Load (1-min, 40r → 40s): median 82.5 → **58.9**, p90 150.1 → **93.1**, max 215.8 → **148.4**. Samples above 100: 49 → **11**. Above 150: 18 → **0**. Swap 4.8–8.0 → **6.1–7.9 GB**. The 61 earlier suites took 23,619 → **20,298 s** in total (−14%). The six M7b suites took 3,119 → 2,311 s; 40r also ran their oracles. Heavy cases (wall s): `check-core` 156.2 → 88, `mir-core` 158.7 → 92.3, `rmeta-core` 160.1 → 87, `check-rg*` 110–115 → 56–77. Max RSS is 7,042 MB (`mir-core`), against the 12,288 MB budget. `heavyErrors` is empty. | `gate.json`; summaries |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Protected ids (`da1c0393`) against this gate's jsonl | **555,887 in 67 files, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its file's line count |
| `5195eab9` (parent `da1c0393`) | Changes `README.md`, `docs/next.md`, `docs/state/current.json` and `history.jsonl` (+1). **Adds ids to five baselines, removes none**, and touches no other baseline. Each is exactly its suite's MATCH set, and its additions are exactly `gained` |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `da1c0393`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 67 suites, the six M7b suites now in the alphabetical baseline group. Sums: `lost` 0, `gained` 329, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0, `retried` 12, `unstable` 26 (1 + 18 + 7), `heavyErrors` 0. Baseline 555,887, match 556,216, total 556,722. `host.powerLost` `[]`, `allowBattery: false` |
| Gate log (`gate-w59.log`) | 62 `ok … lost=0 gained=0` lines and five `ok … lost=0 gained=<n>` lines. IR tier N1 notes for the four IR suites. Unstable notes for `miri-pass` (1), `run-fail-native` (7) and `run-pass-native` (18). Retry notes for `mir` (4) and `run-pass-miri` (8). Then `gate PASS run=gate-20261115-021222-root-rgng`. No `ERROR` |
| `history.jsonl` accept entry (08:39:21Z) | `runId` and `head` match. 67 suites. Each `protected` equals its baseline's line count at `5195eab9` (0 mismatches, sum 556,216). The four IR suites carry `irTier: "N1"` |

**Every row against 40r.** The same 114 files, with the same ids in the same order.

| Status | 40r | 40s |
|---|---:|---:|
| MATCH | 555,887 | **556,216** |
| UNPORTED | 757 | **428** |
| DIFF | 50 | 50 |
| UNSTABLE | 26 | 26 |
| TIMEOUT | 2 | 2 |
| skipped/extra rows | 6,435 | 6,435 |

**Status moves:** `UNPORTED → MATCH` ×329. There are no others.

**Other rows that changed** (status unchanged):

| Suite | Rows | Change |
|---|---|---|
| `ir-host`, `ir-run-pass`, `ir-run-pass-o0` | 10 + 17 + 17 | `unported`. 27 `LLVMRustModuleCost` stops (9 per suite) became `llir: fat LTO merged named struct types (…)` (N3). 17 `cg-asm: … codegen_inline_asm`/`codegen_global_asm`/`mangled_name` stops (1 + 8 + 8) became `llir: LLVMBuildCallBr` or `llir: LLVMRustGetMangledName` |
| `run-pass-native` | 1 | `asm/label-operand.rs#aarch64`: `unported` became `llir: LLVMBuildCallBr` |
| `run-pass-native` | 4 UNSTABLE | `subject` (`stack-probes-lto.rs#aarch64`, `task-comm-14.rs` and `task-comm-3.rs`, now `exit 0`), and `yield.rs`'s reason text (§2) |
| `mir` | 4 | `attempts` (the same 4 retries as 40r) |
| `run-pass-miri` | 9 | `attempts` (8 retries). `macro-comma-support-rpass.rs#core` was not retried this time |

**`git diff --stat 241df65f 5195eab9 -- harness/ scripts/ tools/`** (22 files). The range includes 40r's accept, `4ec9a565`:

| File | Change | Effect on protected suites |
|---|---|---|
| `harness/baseline/{ir-host,ir-run-pass,ir-run-pass-o0,native-hello,run-pass-native,run-fail-native}.txt` | created by 40r's accept (`4ec9a565`); five grown by this accept | The protected set grows by 329 |
| `harness/suites.ts` | (a) comments: the `criterion` doc, and the native wrapper's two limits (harness-w40s note on compile-time instability and the `HOME` sweep). (b) `cfgAttrs`/`libcLoadedOn` find `#[cfg(` in `blankRustNoise` text, so a commented-out cfg is no gate. (c) `yield.rs`'s `NATIVE_UNSTABLE` reason text | (a) none. (b) case selection only: every `.skipped` file and case list is identical to 40r's. (c) §2 |
| `harness/m7-suites.test.ts` | six `libcLoadedOn` cases; the baseline check flips from "none" to "all six have one" | Tests only |
| `harness/llvm-manifest.json` | +19 pins (Dwarf, DIBuilder, DebugInfoMetadata, IntrinsicsAArch64, Linker/IRMover/LinkModules, llvm-link, Internalize, …): 115 now | Coverage and llvm-src tooling only |
| `scripts/difftest.ts` | imports `GROUPS` from `criteria.ts`; `criterionOf` leaves UNSTABLE out of `of` for an M7 group's suite (`criterionExcludesUnstable`). Help text | Summary report only, never a status (N7) |
| `scripts/criteria.ts`, `criteria.test.ts` | `milestoneVerdicts` lines after the group lines | Reporting |
| `scripts/miri.test.ts` | tests of `criterionOf`/`criterionExcludesUnstable` | Tests only |
| `scripts/coverage.test.ts` | the "nothing ported yet" example moves from `Linker.cpp` (now ported by ir-fix-b) to `SymbolWrapper.cpp` | Test only. The example had to move because its file got ported; no expectation was weakened |
| `scripts/probes.ts` | `sysroot_extern` for rustc-dev probes (`compilerCrateFile`, `--extern` flags in `CARGO_ENCODED_RUSTFLAGS`); the `objwrite` fixture | Probe builds only (§2) |
| `tools/probes/fixtures.test.ts`, `tools/probes/objwrite/*` (6 files) | the new `objwrite` probe: the oracle's `object` writer on `cases.txt`, its fixture, the port's twin, tests | Unit tests only |

`UPSTREAM.json`, `harness/corpus/`, `harness/compiletest.ts`, `scripts/native-run.ts`, `scripts/ir-run.ts`, `scripts/lib/ir-normal.ts`,
`scripts/lib/unstable.ts`, `scripts/gate.ts`, the config files and the runtime C files did not change. The config and runtime C inputs
of both builds equal 40r's.

## 2. Harness and tools changes

- **The 61 non-M7b suites are unchanged:** not one oracle cache write during the gate (N7). Their rows equal 40r's except the retries'
  `attempts`.
- **`run-pass-native`'s only definition change is `yield.rs`'s reason text** (harness-w40s note 6). It adds "rare on this host: …, a
  real race". The reason is only the message on the UNSTABLE row. Membership comes from the `NATIVE_UNSTABLE` keys (`unstableOf`,
  `difftest.ts:436-438`), and no key changed: still 18 + 7. No cache key reads the reason, and `nativeOracleKey` hashes `native-run.ts`,
  which did not change. The `libcLoadedOn` fix changed no case selection, so the `.skipped` rows are identical.
- **Probe step: passed, with `objwrite`.**
  - `checkProbes` (`gate.ts:192-227`) runs before the static steps and kills the gate on any missing or stale probe (`gate.ts:690`).
    It prints nothing when everything is fine, so the log has no line for it, and the gate went on to PASS.
  - `objwrite` is required: `oracleTestProbes` finds `probeBinary("objwrite")` in `tools/probes/fixtures.test.ts`, under
    `RUST_TS_REQUIRE_PROBES=1`.
  - The binary is `.data/target/probes/release/objwrite`, `probeStaleness` `current`. `tools/probes/objwrite` is unchanged since
    `da1c0393`.
  - In the junit, `tools/probes/objwrite/objwrite.oracle.txt equals the objwrite probe's output` ran (5 assertions, not skipped). So did
    the five `objwrite.test.ts` tests.
- **`criteria.ts` verdict lines and the `difftest.ts` UNSTABLE denominator:** report only. `run-pass-native`'s summary now reads 3,389
  of 3,396 with `unstable: 18`, which agrees with `criteria.ts`.

## 3. Newly protected cases

| Suite | Gained | Previous stops |
|---|---:|---|
| `ir-host` | 107 | aarch64 intrinsics 56, DI 24, SIMD 16, asm 7, fold 2, fat LTO 2 |
| `run-pass-native` | 112 | aarch64 intrinsics 53, DI 24, SIMD 16, fat LTO 10, asm 7, fold 2 |
| `ir-run-pass-o0` | 56 | DI 25, SIMD 16, asm 8, `getABITypeAlign` 3, fold 2, fat LTO 2 |
| `ir-run-pass` | 53 | DI 25, SIMD 16, asm 8, fold 2, fat LTO 2 |
| `run-fail-native` | 1 | DI 1 |

- All 329 were UNPORTED in 40r and are MATCH now. None was a DIFF.
- Model shortcuts: fat LTO is N3, `-g` is N4, SIMD/asm/intrinsics are N5. Nondeterminism: N6.
- **`yield1.rs`:** MATCH, no `retried` or `attempts`, as in 40r. In `history.jsonl`, "yield1" appears only in the decision of 00:35.
  See N1.

## 4. Subject binaries and reachability

| Entry | Recomputed at `da1c0393` | `gate.json` | inputs (40r) | added / removed / changed |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `1c1d2985727a14abf5e5b4ee293340bcedbb1c10` | equal | 2,217 (2,208) | 9 / 0 / 22 |
| `src/miri/bin/miri.ts` | `11f3adaba9e728aedfc1dae4c0f24f7bef0abe2c` | equal | 2,403 (2,394) | 9 / 0 / 22 |

**How:** `buildSpec`/`subjectBinKey` on the archive, then `subjectBinKeyOf(meta.spec, …)` with the build's Bun record. Rebased onto
the gate's repo path, the archive's spec equals `meta.spec`. The inputs, config and runtime C equal each build's `meta.json`.
`scripts/lib/subject-bin.ts` (the builder hash) is the same at `da1c0393` and in this tree. Both builds: Bun 1.4.4, sha1 `7c1f29cd…`,
built at 02:12:26Z and 02:12:31Z by this gate, which started at 02:12:22Z.

**Added:** `rust_ts/llvm/{di_builder,di_nodes,dwarf,inline_asm,intrinsics_aarch64}.ts`, `rustc_codegen_llvm/debuginfo/metadata/type_map.ts`
and `…/enums/{mod,native,cpp_like}.ts`.

**Changed:**
- 9 `rust_ts/llvm/*` files and 5 `rustc_codegen_llvm/*` files (asm, `debuginfo/{metadata,mod}`, intrinsic, va_arg). All of them sit inside the lazy
  `ported_backend` require;
- `codegen_backend.ts` and `rustc_codegen_ssa/base.ts`, comments only;
- `back/{apple,archive}.ts` and `back/link/raw_dylib.ts`, link-time code;
- `rustc_interface/util.ts`, `rustc_session/filesearch.ts` and `rust_ts/oracle_sysroot_env.ts`.

The reachability of each change is in N8.

## 5. Retries, timeouts, power and load

**Solo retries** (alone wall / user s, 40r → 40s): 12, against 40r's 13.

| Case | wave 40r | wave 40s |
|---|---|---|
| `dynamic-drop.rs` | 39.2 / 48.1 | **38.4 / 47.4** |
| `issue-8827.rs` | 38.4 / 46.1 | 38.3 / 46.1 |
| `recursive-drop-elaboration-2.rs` | 28.1 / 32.4 | 28.2 / 32.5 |
| `error-tainting-issue-122904.rs` | 28.4 / 32.6 | 28.0 / 32.3 |
| `recursive-drop-elaboration.rs` | 27.8 / 32.4 | 27.9 / 32.1 |
| `move-3-unique.rs` | 26.5 / 31.7 | 25.9 / 31.1 |
| `issue-52475.rs` | 20.4 / 21.2 | 20.4 / 21.2 |
| `repeated-vector-syntax.rs` | 20.2 / 26.0 | 19.7 / 25.4 |
| `recursion-etc.rs` | 16.6 / 18.8 | 16.4 / 18.5 |
| `unique-send-2.rs` | 16.1 / 22.5 | 15.8 / 22.3 |
| `macro-comma-support-rpass.rs#std` | 14.8 / 23.7 | 14.9 / 23.6 |
| `let-else-drop-order.rs` | 13.4 / 20.4 | 13.6 / 20.6 |
| `macro-comma-support-rpass.rs#core` | 12.4 / 20.7 | not retried |

- No case is above 45 s alone. The largest leaves 21.6 s of the 60 s limit.
- Every alone run finished. Pool load at the timeouts was 69–108 (40r: 170–239).
- The six M7b suites retried nothing and had no subject TIMEOUT.
- The two `run-pass-miri-heavy` timeouts are as before: `hashset-connected-border-12860.rs` and `step_overflowing.rs`, 1,800 s at
  1,850.1 and 1,844.2 s user. Neither is protected.

**Power:** all 157 samples (02:12:22Z to 08:38:22Z) and every suite's start and end read `AC Power`. `pmset -g log` shows one 3 s spell
on battery, at 03:18:10Z (N2).

**Load:** see N9.

## 6. Unstable and unprotected

- **Unstable, earlier suites:** `miri-pass` `tests/panic/panic1.rs`, as before.
- **Unstable, M7b suites:** `run-pass-native` 18 and `run-fail-native` 7. These are exactly the ids in `NATIVE_UNSTABLE`, and none is
  protected.
- **Unprotected timeouts:** the two in `run-pass-miri-heavy`, as in 40r.
- **Other unprotected rows of the 61 earlier suites** are row for row identical to 40r's, their `unported` and `first` fields included.
  The M7b suites' remaining UNPORTED rows (`ir-host` 17, `ir-run-pass` 48, `ir-run-pass-o0` 48, `run-pass-native` 7) and DIFF rows
  (9, 9, 4) are 40r's rows minus the gains. They moved only as listed in §1.

## 7. Static steps

From the gate log:
- `note: subject binary (src/rust_ts/main.ts 1c1d2985…, src/miri/bin/miri.ts 11f3adab…)`;
- then `ok` for typecheck, unit tests, unit test skips (1, allowlisted), unit tests (alone, 0 skips), runner unit tests (0 skips),
  markers, marker order, info sites and frozen lists;
- `gate.json`: `unitTestSkips {skipped: 1, allowed: 1, unexpected: []}`.

Junit, 40r → 40s:
- unit tests 7,985 → **8,036 tests, 1 skipped, 0 failures (8,035 pass)**. The skip is `read_binary_file_handles_lying_stat`;
- unit tests (alone) 39 → **39**, 0 failures;
- runner unit tests 575 → **577**, 0 failures.

That is the pre-gate step's 8,035 + 39 + 577.

**Bun:** `gate.json` `bun` is `1.4.4` / `38afee6c…`. `bunExec.start` and `bunExec.end` are both the private clone
`.data/gate-bun/run-34798-wKW48G/bun`, sha1 `7c1f29cd…`. `bunClone` came `from` `~/.bun/bin/bun` by clonefile.

## 8. Criteria

`bun scripts/criteria.ts --run gate-20261115-021222-root-rgng --milestone M7`, **exit 0**:

```
gate gate-20261115-021222-root-rgng at da1c03933f: pass=true
plan-m7 M7a ir-hello: MATCH 2/2 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7a mir-o2: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a mono-ui: MATCH 3475/3479 = 99.89% vs >= 99%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7a check-rg: MATCH 34 of 34 crates vs >= 33, 0 oracle timeouts: met
plan-m7 M7b native-hello: MATCH 1/1 = 100% vs >= 100%, 0 oracle timeouts counted: met
plan-m7 M7b run-pass-native: MATCH 3389/3396 = 99.79% vs >= 80%, 0 oracle timeouts excluded, 18 unstable excluded: met
plan-m7 M7b ir-run-pass: MATCH 3422/3479 = 98.36% vs >= 70%, 0 oracle timeouts excluded, 0 unstable excluded: met
plan-m7 M7c run-pass-native: MATCH 3389/3396 = 99.79% vs >= 98%, 0 oracle timeouts excluded, 18 unstable excluded: met
plan-m7 M7c run-fail-native: MATCH 282/282 = 100% vs >= 95%, 0 oracle timeouts excluded, 7 unstable excluded: met
plan-m7 M7c ir-run-pass: MATCH 3422/3479 = 98.36% vs >= 95%, 0 oracle timeouts excluded, 0 unstable excluded: met
milestone M7a: met (4 of 4 groups met)
milestone M7b: met (3 of 3 groups met)
milestone M7c: met (3 of 3 groups met)
exit 0: every selected milestone is met (M7a, M7b, M7c)
```

**M7a, M7b and M7c are met, as recorded** (history 2026-11-15T08:39:47Z). If `yield1.rs` is listed (N1), `run-pass-native` becomes
3,388/3,395 = 99.79%, still met.

## What I did not check

- **Subject outputs of MATCH rows.** The run data keeps none, and re-running the subject would be a difftest. N4–N6 cover the oracle
  side of all 329 new cases and their IR twins.
- **The lanes' code**: the fidelity of the IR model, debuginfo, asm, SIMD and fat-LTO ports. That belongs to their reviews and
  `root-w59-check.md`. I checked reachability and evidence, not correctness.
- **Subject commands of the earlier suites.** They are not in the run data. I rely on the unchanged oracle keys, case lists and rows
  (N7), and on the harness diff above, which changes no command.
- **Program run times of the native cases**, against native-run's 30 s per-run limit. They are not recorded. No new oracle output
  contains `timed out after`, and no subject process timed out.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked
  `node_modules`. Both are gitignored.
- `RUST_TS_SUBJECT` stayed unset, and I built no binary. The key recomputation ran `Bun.build` in memory over a `git archive` tree in my
  scratchpad, which I then deleted.
- My cache reads imported `harness/suites.ts` and called `cases()` for the five gaining suites. Nothing under `.data/crate-fetch`,
  `.data/subject-bin`, `.data/oracle-cache` or `.data/native` changed after I started. Directory mtimes under `.data/aux` changed, with
  no file changed, as in w40r N10(c). Other sessions (`llir-cbm` lanes) were also writing to `.data/runs` and `.data/tmp` meanwhile.
- I read cache entries directly, not through `readCached`, which can remove an unreadable entry.
- This file is the only tracked change.
