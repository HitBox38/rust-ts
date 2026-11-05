# Handoff: harness-m7a (harness batch, plan-m7 wave 39)

Branch `t3/m7-harness-ir-suites`. No port code: nothing under `src/` or `harness/baseline/` is changed by this lane's commits (`git diff integ-w39 HEAD -- src`, empty).

## Result

| Item | State |
|---|---|
| 1. `time.rs` to `miri-pass-heavy`, A12 amended | Done, first and alone (`a5afe72c`). Exactly one case moved |
| 2. `llvm-tools` guard | Done. Nothing installed |
| 3. `ir-run.ts`, normal form N1, N2, N3 | Done. Review's bugs stay visible, measured on 150 real programs |
| 4. `ir-diff.ts` with the call-level diff | Done. The port side of the call trace waits for `llir-core` |
| 5. Suites | Done. `check-rg` 36/36 in both modes and on the host; `mono-ui`'s subject needs mono-wire |
| 6. Nits | Done, except where a review advised leaving one |

**Not asked for, added:** `ir-hello` (2 cases, gate M7a names it and no lane owned it) and `check-ui-encode-mir` (review's amendment table, D13). Say if either should go.

## For root

1. **After merging, with no gate running: `bun scripts/upstream.ts fetch`,** which applies the sparse additions to the shared checkout. I did not touch the shared checkout. Until then `mir-opt-o4` says so in one `ERROR:` line and stops.
2. **`bun scripts/rg-check.ts setup` has already run on `$RUST_TS_DATA`** (`ripgrep/`, 345 MB with its kept trees). It verifies the crate's and `Cargo.lock`'s pinned SHA-256.
3. **Upstream checkout:** `rustc-ice-2026-11-05T03_03_40-5497.txt` and `..._41-5508.txt` are still there, ignored by git, from before this lane. difftest prints `ERROR:` on every run, and the gate refuses to start on them (`scripts/gate.ts:346`). They need moving out before the next gate.
4. **mono-wire against abi-vtable: `src/rustc_monomorphize/collector_oracle/run.ts` and `partitioning.oracle.test.ts` conflict.** abi-vtable is on `integ-w39` now, so mono-wire's merge has to resolve them. Both are test files. My scratch merge took one side only to get results, so it is no model for the resolution.
5. **Merge order:** `mono-ui` reports 0 of its cases until mono-wire merges (below). Nothing else here depends on it.
6. **Stale text:** D1's hash in `docs/plan-m7.md` §1d, `b7a4d6261326`, should be `468b56993bc4`. The plan's count of 3,470 for `mir-o2` and `mono-ui` is 3,479. `run-pass-aux-native`'s planned 356 leaves out the 52 of item 6.
7. **`harness/scope.json`:** `"jobserver": "=0.1.34"` is already on `integ-w39`; I added nothing.
8. **Decision wanted (`docs/reviews/m6-audit.md` F2):** the 52 run-pass programs with proc-macro aux crates. I recommend `run-pass-aux-native` in `harness-m7c`, with the macro built by the oracle for the host, as `pm-ui` does, because under Miri they would need its driver to load a host dylib during expansion, which no plan asks for. The skip reason now says what they need, and "proposed".

## 1. `time.rs`

Dump of cases, skips, unstable lists, limits and the first case's commands, on the merge base `b74a0659` against this commit:

```
SUITE miri-pass        cases 353 -> 352;  C tests/pass/shims/time.rs removed, K added with the reason
SUITE miri-pass-heavy  cases   7 ->   8;  C tests/pass/shims/time.rs added
```

No baseline changes: `harness/baseline/miri-pass.txt` holds `time-with-isolation.rs`, not `time.rs`. A test pins that the first is in the heavy list and the second is not.

## 2. `llvm-tools`

Already installed and already in `rust.components` (`llvm-tools-preview-aarch64-apple-darwin` in `lib/rustlib/components`). I read that list and ran `--version`, and no `rustup component add` was involved. `LLVM version 23.1.3-rust-1.101.0-nightly`, matching `rustc -vV`'s 23.1.3.

Under `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin/`:

| File | SHA-256 |
|---|---|
| `lib/rustlib/aarch64-apple-darwin/bin/opt` | `08fbe6994221b032254a35d87296801b4eea608182ec76c7fdb585a06b726455` |
| `lib/rustlib/aarch64-apple-darwin/bin/llc` | `3eebf5569ca0fedff6caf82adced7a06521b68fb1919480d8fbfec9065059f19` |
| `lib/rustlib/aarch64-apple-darwin/bin/llvm-as` | `68685dbe2881239b5c67e6e139054cb922876da12092f33ad2ba2d3d6a7fe046` |
| `lib/libLLVM.dylib` and `lib/rustlib/aarch64-apple-darwin/lib/libLLVM.dylib` | `468b56993bc4e1cacb5dd0b3972da21a36ffcf8ab52aba2ae92e421be2a55910` |

`scripts/lib/llvm-tools.test.ts` pins each on the root host, and checks the two library copies are one build.

## 3. Normal form

`scripts/lib/ir-normal.ts`'s header is the statement of what is discarded and why. Summary:

| Tier | Commands | Absorbs | Keeps |
|---|---|---|---|
| **N1** | `opt -passes=assign-guid,verify -S`, then the strips | Comment lines; `; preds =` tails **on block label lines only**; attribute and metadata numbering; unused attribute groups and metadata; attributes on intrinsic declarations; default alignments; implied `dso_local`; constexprs the parser folds; a missing `!guid` | Order of everything; local names with collision suffixes; every flag, attribute and non-default alignment; a wrong `!guid`; folded constants; datalayout, triple, `source_filename`, module flags |
| **N2** | `llvm-as`, then N1 with `--discard-value-names`, and the input's own `target` lines first | N1, and every local name | The rest of N1. Global names stay |
| **N3** | N2 with `function(instsimplify)` | N2, and whatever instsimplify folds or deletes | What survives the pass |

**A finding beyond the review: as the review wrote them, N2 and N3 absorbed a wrong `target datalayout`.** The bitcode reader runs `UpgradeDataLayoutString`, so a missing `-i128:128` comes back, and the text parser does not. They now start with the input's own target lines. On 150 programs a bitcode round trip with names kept gives N1's text byte for byte, so names are all that path gives up.

**N3 is a real blind spot, as designed.** It absorbs a wrong flag or operand when the instruction folds away or is dead. Measured below; a wrong instruction whose result is unused is absorbed on every program. That is why it stays a fallback under review F1's rule, and it needs that rule's recorded decision.

### Proof on real oracle IR

`bun scripts/ir-tiers.ts --sample 150 --sites 2 --jobs 3`: 150 run-pass programs (0 failed to build), oracle's pre-pass text for x86_64-linux at compiletest's argv. "Whole" is every site at once. "One site" is 2 sites each, alone, so one wrong site cannot hide behind the rest. Caught / tried, exit 0.

| Must stay visible | Programs | Whole N1, N2, N3 | One site N1 | N2 | N3 |
|---|---:|---|---:|---:|---:|
| `noalias` on every pointer parameter (F1) | 150 | all caught | 300/300 | 300/300 | 300/300 |
| `nuw nsw` on `add`, `sub`, `mul` (F1) | 49 | all caught | 76/76 | 76/76 | **70/76** |
| Integer loads and stores claim `align 16` (F1) | 91 | all caught | 168/168 | 168/168 | **159/168** |
| Signed compares become unsigned (F1) | 9 | all caught | 12/12 | 12/12 | 12/12 |
| `eq` and `ne` swapped (F1) | 82 | all caught | 142/142 | 142/142 | 142/142 |
| `!nonnull` on loaded pointers (F1) | 60 | all caught | 108/108 | 108/108 | **107/108** |
| `inbounds nuw` on inbounds GEPs (F1) | 76 | 76, 76, **75** | 144/144 | 144/144 | **131/144** |
| `sub i64` becomes `add` (F1) | 39 | all caught | 60/60 | 60/60 | **56/60** |
| `store i64` deleted (F1) | 63 | all caught | 108/108 | 108/108 | 108/108 |
| Lifetime markers dropped (F1) | 142 | all caught | 284/284 | 284/284 | 284/284 |
| `readonly` on pointer parameters (F1) | 150 | all caught | 300/300 | 300/300 | 300/300 |
| `noalias` dropped (tier table) | 145 | all caught | 288/288 | 288/288 | 288/288 |
| `align 8` becomes 4 (tier table) | 149 | all caught | 298/298 | 298/298 | **292/298** |
| `!noundef` dropped (tier table) | 142 | all caught | 284/284 | 284/284 | **258/284** |
| `nuw` dropped on a variable-index GEP | 12 | all caught | 8/8 | 8/8 | 8/8 |

Swapped declarations, globals, definitions and blocks, an extra declaration, a wrong triple, a wrong datalayout (at N2 and N3 too, after the fix) and a wrong `!guid`: caught at every tier on every program that has them. Swapped allocas: every program at N1 and N2, 148 of 149 at N3 (dead allocas).

| What a tier gives up | Programs | N1 | N2 | N3 |
|---|---:|---|---|---|
| Every local name wrong (F1) | 150 | 150 caught | absorbed | absorbed |
| Builder folds missed (F1) | 52 | 52 caught | 52 caught | absorbed |
| `nuw` dropped on a zero-index GEP (F1) | 31 | 31 caught | 31 caught | absorbed |
| A wrong instruction whose result is unused | 150 | 150 caught | 150 caught | absorbed |

Absorbed at every tier, on every program that has them: comments, reordered preds tails, removed `!guid`, renumbered attributes and metadata, attributes dropped from intrinsic declarations, default load alignment, an unused attribute group or metadata node.

**F10's hole, closed:** on `static S: &str = "abc  ; preds = %bb1, %bb2"`, a wrong `align 64`, an added `section` and a changed byte after that text are caught at all three tiers, and so is a byte after `\n; ` in a string. These are on the test's program (`scripts/fixtures/ir/mut.rs`): no corpus program holds that text, so the sample's row is 0.

**The first version of this proof reported three problems at N1 and N2. All three were my mutators,** not the normal form: `noalias` on an intrinsic declaration (the parser replaces those), a rename that hit an unquoted struct type, and a metadata id that collided in a large module. Each is fixed in the mutator with its reason in the commit, and `scripts/ir-normal.test.ts` runs every row on one real program, in about 1.5 s.

### `scripts/ir-run.ts`

Prints the compiler's own output, then `ir: <file> <tier>` and the normal form per `.ll`, in name order. `--out-dir`, not `-o`, because `-o` forces one CGU. A module that does not parse or verify prints `ir: normal form failed: ...` and exits 102, a difference from any oracle that succeeded (D16). D12's gzipped cache already exists: difftest gzips oracle entries over 4 KiB (`GZIP_OVER`), so no new cache.

**Unchecked:** `--out-dir` differs per side and per pid. A path written into IR would show as a difference, and with `-Cdebuginfo` the split file name may be one. Nothing in M7a's suites has debuginfo. `harness-m7b` should check it, and fix the path rather than mask it.

**Outside any IR comparison:** the allocator shim, as review F9 says.

## 4. `scripts/ir-diff.ts`

`bun scripts/ir-diff.ts <file.rs> [--calls]` or `--suite <IR suite> --case <id>`. It prints the first differing function and line, each tier's result with F1's class (`differs at N1 only: local names`, and so on), and with `--calls` the first differing C API call, classed as "the port called something else" or "the model answered differently".

The oracle's trace is a dylib interposing on the 349 C functions the driver imports, built with `cc` and cached in `$RUST_TS_DATA/llvm-trace/`, loaded through `env` into rustc alone. A test pins that traced IR is byte-identical to untraced. On `prog.rs` it recorded 89,853 calls, including real collisions (`self` to `self1`) and folds.

**The port's side is a contract, not a result.** `scripts/lib/llvm-trace.ts`'s header gives the format, and `llir-core` writes it to `RUST_TS_LLVM_TRACE`. Until then ir-diff says the port wrote no trace. Since no port IR exists, the end-to-end test uses a fake port that mutates the oracle's text.

## 5. Suites

All report only: no baseline, so none is in the gate's defaults (a test pins that). `--jobs 3`, load 14-48 from other lanes. Results at the branch head unless marked.

| Suite | Cases | Oracle CPU (user) | Current port result | Notes |
|---|---:|---:|---|---|
| `mir-o2` | 3,479 (488 skipped) | 89 s | **120/120** on a sample | About 1.9 s of CPU per case on both sides together |
| `mono-ui` | 3,479 (488 skipped) | 102 s | **0/40, all UNPORTED at head** until mono-wire merges. **200/200** on a scratch merge with mono-wire | Subject below |
| `ir-hello` | 2 | 0.1 s | 0/2 UNPORTED: `codegen_crate (codegen; M7)`, as expected | First port IR at wave 41 |
| `mir-opt-o4` | 406 (10 skipped) | 10 s | **405/406**, on a private checkout | The miss is `dump_dataflow.rs`: UNPORTED, `write_graphviz_results` |
| `check-ui-encode-mir` | 146 | 3.6 s | **120/120 and 60/60** on samples | No other suite encodes optimized MIR |
| `check-rg` | 36 | 7.8 s | **36/36** | Port 449 s CPU, 3.3 GB. See below |
| `check-rg-encode-mir` | 36 | 11.5 s | **36/36** | Port 624 s CPU, 4.8 GB. `rg`'s MIR is 6,927,138 bytes, identical |
| `check-rg-host` | 36 | 8.6 s | **36/36** | Port 435 s CPU, 3.3 GB. Needed abi-vtable: 7/36 without it |

No suite had a full port run but the three `check-rg*` and `mir-opt-o4`: the rest are samples.

### `check-rg*`, per root and lane real-crates

- **One absolute target path.** `$RUST_TS_DATA/ripgrep/target/<suite>`, one side at a time under a lock, emptied before and moved aside after. Nothing is normalised.
- **`CARGO_INCREMENTAL=0`.**
- **`rg`'s MIR is compared,** as a bin's `.rmeta` is 0 bytes: its recorded argv and environment, `-Zunpretty=mir`, against that side's own `.rmeta`s.
- **Compiles that emit `link` go to the oracle on both sides,** stated in each suite's description.
- **36 cases, not 34:** the run's own case, ripgrep's 34 crates, and anyhow's build script's own compile probe (`--crate-name=anyhow`, no `-C metadata`), which goes to the side's compiler and is compared. M7a's "33 of 34" reads the crate sections.
- **The run's case also hashes every other file of the tree** (`.d`, fingerprints, build script output). `.cargo-lock` and `.rustc_info.json` are left out.
- **A port stop is a DIFF of that crate, not UNPORTED:** the script exits 0 so that one stop does not overwrite every crate's result, and the section names the stop.
- **It uses the existing `rmetadump` splitter** (`== <key>` sections), so `scripts/lib/split.ts`, and every split suite's cache key, are unchanged.

**A harness bug this found, fixed: ripgrep's `build.rs` reads `git rev-parse HEAD`, and `$RUST_TS_DATA` sits inside this repository.** The hash went into `rg`'s MIR and the tree, so each commit on `main` made the cached oracle a false difference: `check-rg-host` came back UNSTABLE on all 36, the oracle's re-run not reproducing its entry, with a port tree identical to the re-run's. `GIT_CEILING_DIRECTORIES` keeps any repository out of reach (`rgCargoEnv`, tested), and the build now reports `output from git rev-parse is empty`, on both sides. Six further oracle runs on the host before the fix were identical, because HEAD had stopped moving; that is what pointed at it.

### `mono-ui`'s subject

`scripts/mono-run.ts`, root's decision on mono-wire's recommendation: the real driver with `config.make_codegen_backend`, as Miri's driver does, catching only the `Unported` that says collection finished. `main.ts` stays honest, and difftest has no new rule. I added this after the first version of the suite, so it is one commit, with the check-rg fix.

**It needs mono-wire.** At head `codegen_crate` stops with the older text, which the catch does not match, so every case is UNPORTED: honest, and what the table shows. On a scratch merge of this branch, `t3/wire-monomorphize-providers` `8617e37e` and abi-vtable: **200/200 MATCH**, exit codes and warning summaries included. Earlier, with the plan's `partitioning_oracle/run.ts` as subject, 119/120, with the miss being the vtable stop abi-vtable fixes.

The oracle emits pre-pass IR over one discarded file, `$RUST_TS_DATA/tmp/mono-ui-discard.ll`, since `-o /dev/null` fails (rustc makes its temp dir beside the output). **Limit:** whatever codegen does after partitioning, LLVM warnings and link errors, is not compared.

### `mir-opt-o4`

`-Copt-level=1 -Zvalidate-mir -Zlint-mir -Zmir-include-spans=false --crate-type=rlib -Zmir-opt-level=4 -Zmir-enable-passes=+ReorderBasicBlocks,+ReorderLocals`, each test's `test-mir-pass` enabled, each test's flags, `-Zunpretty=mir`. **Not compiletest's mode:** that runs a `test-mir-pass` test at level 0 with that pass alone and compares `.diff` files. F7 asks for the level-4 pipeline, and the name says so. Skips: 8 compiletest would reject with this harness's configuration, 1 aux crate, 1 ignored.

**`dump_dataflow.rs` cannot dirty the checkout.** Each side gets its own `-Zdump-mir-dir` under `$RUST_TS_DATA/tmp`, last on the command line, for every case. On the private checkout: the checkout's status is unchanged, and no `mir_dump` exists in it, with 138 files in the oracle's dump directory. A test runs that test's own flags through the oracle both ways, and pins the cwd stays clean only with the flag.

### Sparse additions

`UPSTREAM.json` adds `tests/codegen-llvm` and `tests/mir-opt`; `tests/codegen-llvm` is for `harness-m7b`. **Nothing else changes.** I applied them through `bun scripts/upstream.ts fetch` to a private clone of the checkout, with a private `RUST_TS_DATA`, then removed it:

- Every suite's dump against that clone: 368,445 lines, **0 differ** apart from aux directory names, whose keys hash the checkout's path.
- `git grep` finds no `tests/ui` file naming `../mir-opt` or `../codegen-llvm`.

### Existing suites' case lists

Merge base `b74a0659` against head, all 58 existing suites, 364,386 cases:

- **Exactly the `time.rs` move:** 3 lines removed, 3 added (the case, and two `cases=` counts), plus its 1 new skip line.
- **58 skip reasons** change wording, item 6: 52 in `run-pass-aux-miri`, 6 in others. No case.
- **Oracle cache keys:** 952 sampled across all suites, 0 differ.

### `RUST_TS_HOST_TUPLE`

`verifyOraclePin` now stops with one `ERROR:` if it is unset or is not the oracle's host, so difftest, the gate, phase-diff and ir-diff say so before any case. `bun src/rust_ts/main.ts` run directly still exits 70: fixing that means editing `src/`.

## 6. Nits

| Nit | Result |
|---|---|
| `harness-w39` N2 | `checkProbes` prints `ERROR:` for a stale probe. **Checked by hand on a fake data root, no unit test:** a real one needs a stale stamp in shared `probes/` |
| `harness-w39` N3 | A test runs fake heavy suites through the real `difftest()`: the oracle sees the lock only in the heavy suite |
| `harness-w39` N4 | Child spin has an inner loop, so reading `sysMs` as `userMs` fails |
| `integ-w38-recheck` N1 | A per-process set of held locks: two calls in one process take turns, and a leftover with this pid is still taken over at once |
| `integ-w38-recheck` N2 | **Left,** as the review advises |
| `integ-w38-recheck` N3 | `criteria.ts` requires every protected suite at the gate's own commit, read with `git ls-tree` |
| `m6-audit` F2 | The skip reason states what the 52 need. Root's decision is item 8 above |

## Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24843; vendor 5086; library 590)` |
| `bun test ./scripts` | 226 pass, 0 fail, 26.6 s |
| `bun test ./harness` | 47 pass, 0 fail, 4.0 s |
| `bun test ./tools` | 67 pass, 0 fail, 11.9 s |

All with `RUST_TS_REQUIRE_PROBES=1`, each root alone.

**Unit step budget (F5, 5 s per lane):** this lane adds **about 4.9 s of wall at load 38, about 5.6 s of CPU.** `ir-normal.test.ts` 1.6 s (3.0 s CPU across 6 parallel tool runs); `ir-diff.test.ts` 1.7 s; `m7-suites.test.ts` 0.8 s; the lock test 0.5 s; `llvm-tools.test.ts` 0.4 s. It is at the limit. The first `ir-diff` test in a fresh `RUST_TS_DATA` also builds the tracer once with `cc`, about a second.

## Not done, not checked

- **The gate and any full run of `mir-o2` or `mono-ui` on the port side.** They are samples. Going by them a full `mir-o2` is about 110 min of CPU.
- **No port IR exists.** Every tier result is on the oracle's text and my mutations, what a port bug might look like, not a port bug. F1's rule and M7c's 95% have no measurement yet.
- **`mono-ui` on the merged tree** is a scratch merge. The two test-file conflicts of item 4 above were resolved for that run only.
- **`check-rg` on a `--sample`:** every sample still runs the whole cargo, as for any split suite.
- Windows, and the tracer anywhere but aarch64 macOS (it stops with an error).

## `unported(...)` and `// PORT:`

None: no port code.

## Files

Added: `scripts/ir-run.ts`, `ir-diff.ts`, `ir-tiers.ts`, `mono-run.ts`, `rg-check.ts`, `rg-rustc.ts`; `scripts/lib/llvm-tools.ts`, `llvm-trace.ts`, `ir-normal.ts`, `ir-mutations.ts`, `ir-diff.ts`, `rg-check.ts`; tests for each; `harness/m7-suites.test.ts`; `scripts/fixtures/ir/mut.rs`.
Changed: `harness/suites.ts`, `harness/compiletest.ts`, `UPSTREAM.json`, `scripts/gate.ts`, `scripts/criteria.ts`, `scripts/lib/case-lock.ts`, `scripts/lib/oracle.ts`, `scripts/lib/toolchain.ts`, `docs/plan-m6.md` (A12).
New under `$RUST_TS_DATA`: `ripgrep/`, `llvm-trace/`. Runs: `runs/harness-m7a-*`.
