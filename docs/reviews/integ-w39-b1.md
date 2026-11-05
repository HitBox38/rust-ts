verdict: APPROVE WITH NITS

Independent review of root's commit `60e9ec65` on `integ-w39`, which answers `docs/reviews/integ-w39-recheck.md` B1, M1, L1 and L2.

**B1 is fixed for the gate, and the gate can start from this head.** Both unit steps pass and leave the tree clean. The `catch` is right for what it covers, and it changes no exit code, stdout or stderr except where L1 meant to.

**The answer to "does a run leave nothing, on all exits" is no (F1).** Other exits, after `metadata` exists and before `Linker::link`, still leave `rmetaXXXXXX/` where the oracle leaves nothing. None is new, none is in the tree, and no suite compares them. It need not hold the gate.

I edited no code. Plants, reverts and injections were in two scratch worktrees, since removed. This file is all I wrote to the tree. I did not run the gate.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | LOW | `src/rustc_interface/passes.ts:1421,1425,1448,1451`; `src/rustc_driver_impl/lib.ts:326-329` | The drop covers `codegen_crate` only; other exits after `metadata` exists still leak the temp dir |
| N1 | nit | `harness/m7-suites.test.ts:11` | `NEW` is now unused |
| N2 | nit | `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts:122` (the second `rmeta` assertion) | Dead code: `IN_PROCESS_PENDING` is empty |
| N3 | nit | `src/rustc_interface/passes.ts:1434` | A judgment call without the `// PORT:` that PORTING section 3 asks for, and that `queries.ts:44` has for the same drop |

**One note for the gate, not a finding of this commit.** My `src`/`tools` unit step took **1,846 s, with 0 failures, under load up to about 21** from other work on the host. `scripts/gate.ts` gives a step 1,800 s, and plan-m7 records 1,266 s quiet. No test timed out, and I did not rerun it alone, as it passed. Start the gate on a quiet host: the step's limit is what contention would hit first, and a failed step shows only as FAIL at the end.

## 1. The `catch` in `start_codegen`

**Against upstream.** `metadata` is a local of `start_codegen` (`passes.rs:1323`) until it moves into the returned tuple, so any unwind in `codegen_crate` drops it. Its `_temp_dir` then removes the dir, or keeps it under `-C save-temps` (`temp_dir.rs:14-23`). The `catch` does this, on the one call it wraps. `throw e` rethrows the same object.

| Question | Answer |
|---|---|
| Can `metadata.drop()` run twice? | Not on any path. A throw out of `codegen_crate` never reaches `Linker`, so `queries.ts:147` does not run. It would be harmless anyway: `drop` clears `_temp_dir`, and `MaybeTempDir.drop` is idempotent |
| Can it throw and mask the error? | No. `full_metadata = undefined` cannot, and `TempDir.drop` swallows `rmSync`'s errors. `TempDir.keep` only returns a string. A stack overflow has unwound to `start_codegen` by then, which is shallow |
| `-C save-temps` | Keeps the dir, as the oracle: `lpm.rs -C save-temps` leaves `d/rmetaX/full.rmeta` on both sides, and `foo.rs -C save-temps` too |
| Dropped too soon? | No. The `catch` only runs on a throw, and nothing reads the dir after the throw. Success, `--emit=metadata` and `CompiledModules` go on to `Linker::link`'s `finally`, with the same files as the oracle |
| A stop other than `refine_rpitit.rs`? | Every library crate stopping in `codegen_crate` gains from it, whatever the output flags: section 3 |
| Miri | Not on this path. `after_analysis` (`src/miri/bin/miri.ts:114`, upstream `bin/miri.rs:138`) runs first and exits by `MiriExit`, so `start_codegen` is never reached and no temp dir exists. Upstream's comment says the same: "We never reach codegen anyway" |
| `MonoOnly` | Works. It catches its stop inside `super.codegen_crate`, so the new `catch` sees nothing and `Linker::link` drops. `mono-run` on `libfoo.rs` and `foo.rs` exits 0 with an empty `--out-dir` |

**Which throws reach it, as of this commit.** On a library crate, the collector normally runs inside `encode_metadata` (fs.ts's own `finally` handles that), so `lrec.rs` and `lpm.rs` left nothing even before this commit: the re-check's "by reading, ... the collector take the same path" does not hold for those. `CpuRequired` and `CpuUnsupported` need a target the port stops on first (`--target x.json`, `nvptx64`). So real programs reach the `catch` with `Unported` only. To cover the rest, I injected both other kinds at the top of `codegen_crate`, scratch only:

| Injected | `-C save-temps` | Exit | Left in `--out-dir` |
|---|---|---|---|
| `tcx.dcx().fatal(..)` | no | 1, `error: injected fatal` | nothing |
| `tcx.dcx().fatal(..)` | yes | 1 | `rmetaX/full.rmeta` |
| `throw new Error(..)` | no | 101 | nothing |
| `throw new Error(..)` | yes | 101 | `rmetaX/full.rmeta` |

**Stderr and exit against `cf309f3a`, byte for byte: identical on all programs but the intended ones.**

- Same: `libfoo.rs`, `w.rs` (a warning), with `-o`, `--out-dir` (existing and new), `--emit=obj|asm|mir|link,metadata|link=path|dep-info|dep-info,metadata`, `--crate-type dylib|staticlib`, `-C save-temps`, `-Zprint-mono-items=yes`, `-Zno-link`, `-Zno-codegen`, `lrec.rs`, `lpm.rs`, also at `-C opt-level=3`.
- Differ, as L1 intends: `-Zoffload=Test` (section 4).
- Differ only in paths: `-Ztreat-err-as-bug`, an ICE whose backtrace names the worktree. With paths and line numbers normalized the two are identical.

**Samples of 200, `--jobs 4`, at this commit:**

| Suite | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT |
|---|---|---|---|---|---|
| `mono-ui` | 200 | 0 | 0 | 0 | 0 |
| `run-pass-miri` | 200 | 0 | 0 | 0 | 0 |
| `run-fail-miri` | 200 | 0 | 0 | 0 | 0 |
| `mir` | 200 | 0 | 0 | 0 | 0 |

## 2. F1: what still leaks

Each row was run from a scratch directory on the oracle, this commit and `cf309f3a`. `cf309f3a` and this commit leave the same files on all of them, so **F1 is not a regression**.

| Command (library crate) | Oracle leaves | `60e9ec65` leaves | Stop, at |
|---|---|---|---|
| `--emit=metadata -o -` at a terminal | nothing, exit 1 | **`rmetaX/` in the cwd**, exit 1, with the oracle's error | `abort_if_errors`, `passes.ts:1421` |
| `-Zoffload=HostMetadata=<path>` | the manifest | `d/rmetaX/full.rmeta` | `unported`, `passes.ts:1425` |
| `-Zprint-type-sizes --emit=metadata` | `d/lib.rmeta` | `d/lib.rmeta`, `d/rmetaX/` | `unported`, `passes.ts:1448` |
| `-Zprint-type-sizes -Zno-codegen` | `d/lib.rlib` | `d/rmetaX/full.rmeta` | `unported`, `passes.ts:1448` |
| `-Zmetrics-dir=d/m --emit=metadata` | `d/lib.rmeta` | `d/lib.rmeta`, `d/rmetaX/` | `unported`, `lib.ts:326-329`, once `Linker` exists |

The first row is the plain failing scenario: a compile error whose stderr and exit equal the oracle's, and a directory in the user's cwd. `mono-run` has the third row's leak too, on `-Zprint-type-sizes`.

By reading, not run:

- `CrateInfo_new`, `passes.ts:1451`, on a panic, or its MSVC-only `unported`.
- `tcx.crate_hash`, `queries.ts:35`, with `-C incremental`.

Run, but not a difference in this respect: a failing `copy_to_stdout` reaches `passes.ts:1421` too. `-o - | true` leaves `rmetaX/` in the cwd, and so does the oracle (see "Noticed, outside this commit").

**Why LOW.** No unit test or suite sees any of these. No `rmeta*` directory is under `$RUST_TS_DATA/rust` (`git status` there is clean) or `$RUST_TS_DATA/tmp/mono-ui-out`. Nearly all are already stops.

**Fix, untested, for root to queue or take:** in `start_codegen`, put the `try` around everything from `const is_host_metadata` to the `return`, so the whole time `start_codegen` owns `metadata` is covered, as Rust's is. The `Linker` case needs a catch in `run_compiler` around `lib.ts:323-335`, or a `Linker.drop()`. If only the first is done, `fs.ts:14` should say which exits are left. **Do this as a separate change if the gate is due:** the code is small, but this review covers the commit as it is.

## 3. Output directory: the rest

From a scratch directory, library crate, with no `-o`, with `-o`, `-o d/sub.rlib`, `--out-dir d`, `--out-dir newdir`, and `--emit` as in section 1: **no `rmeta*` is left, in the cwd or the output directory.** Before this commit, each one that stops in codegen left `rmetaX/` in the same place, with `full.rmeta` in it unless `--emit=metadata` had moved it out. On exit 70 the only files are those the oracle also wrote by then: `--emit=metadata` output, `.mir`, `.d`.

Without `--sysroot` a program with `std` stops earlier, at `default_sysroot`, with nothing left. A `bin` never leaked, as an empty `full.rmeta` drops the dir in `from_path`.

**The tree after the unit steps.** Both ran as `scripts/gate.ts:270` runs them, with `RUST_TS_REQUIRE_PROBES=1 CI=true`:

| Step | Pass | Fail | Skip | Seconds | `git status --short` after it |
|---|---|---|---|---|---|
| `./src ./tools` | 7,281 | 0 | 1 | 1,846 | empty |
| `./scripts ./harness` | 273 | 0 | 0 | 22 | empty |

The skip is `read_binary_file_handles_lying_stat`, which is linux-only and in `ALLOWED_SKIPS`. The other two static steps also pass at this commit: `tsc --noEmit -p .` and `coverage.ts --check --offline`.

## 4. The test and the offload stop

**`harness/m7-suites.test.ts` (M1).** Planted one baseline line for each of the seven suites:

- `m7-suites.test.ts`: 4 pass, 0 fail.
- The whole runner unit step, `./scripts ./harness`: 273 pass, 0 fail. No file under `src` or `tools` reads `harness/baseline`.
- With an eighth for `ir-hello`: `(fail) ir-hello is not protected...`, as it should.

`NEW` has no effect (N1): only line 11 names it, and `tsconfig.json` has no `noUnusedLocals`, so `tsc --noEmit -p .` is silent at this commit. Delete it when next touched.

**`src/rust_ts/codegen_backend.ts` (L1).** The condition is `back/llvm_backend.rs:339-340` word for word, and line 336 is the `fn`. `HostMetadata` does not get here (`passes.rs:1339`). Upstream goes on for `Test`:

| Command | Oracle | `60e9ec65` | `cf309f3a` |
|---|---|---|---|
| `-Zunstable-options -Zoffload=Test -Zprint-mono-items=yes`, `libfoo.rs` and `foo.rs` | exit 0 | same stdout (1 and 9 lines), stops after collection, exit 70 | stops at `-Zoffload` |
| The same through `mono-run`, `libfoo.rs` | exit 0 | stdout identical, exit 0 | not run |
| `-Zoffload=Device=<path>`, `Host=<path>` | exit 1, backend not in the sysroot | stops at `-Zoffload`, exit 70 | same |

**`jobserver.oracle.test.ts` (L2).** With `fd > 2 &&` reverted: `(fail) --jobserver-auth=0,0 [exec 0<&-]`, 29 pass, 1 fail, the new case alone. As committed: 30 pass, 5 runs of 5.

**`compare_impl_item.oracle.test.ts`.**

- With `passes.ts` reverted to `cf309f3a`: `(fail) end to end: refine_rpitit`, naming `rmetaBiRqIO`; 42 pass. As committed: 43 pass, and a clean tree.
- **Order.** The file's tests run one at a time, and `beforeAll`'s oracle runs finish before any test. `refine_rpitit` is the only pending case, and the others stop before metadata.
- **A leftover.** A planted empty `cases/rmetaZZZZZZ/` fails this same test. So a killed run can fail it for another reason, but the message names the directory, and that directory is untracked, so the tree is dirty anyway and the gate could not be accepted. I do not count that as a defect: remove the directory.
- **What it cannot catch.** Two `bun test` runs in one worktree could see each other's live directory. The gate runs its steps one after another, so this is only for someone running by hand.
- The second assertion is dead (N2). `IN_PROCESS_PENDING` is `{}`, and the in-process runner stops before metadata in any case.

## 5. The three removed files

They were the only such binaries. `cf309f3a` added them and is the only commit that did. No `*.rmeta` or `*.rlib` is tracked at `60e9ec65`, and `git diff --numstat` from `main` to this commit lists no binary. `git grep` for the three names finds nothing. `CASES` reads only `*.rs`, and `region.oracle.test.ts` uses the runner, not those directories.

## Noticed, outside this commit

`rust-ts libfoo.rs --emit=metadata -o - | true`: the oracle dies of SIGPIPE, status 141, and leaves `rmetaX/`, since nothing unwinds. The port exits 1 with `error: failed to copy ...`, and leaves `rmetaX/` as well. Queue it if `-o -` matters.

## What I did not check

- The gate, and the full suites. The samples are 200 cases each, chosen for `RUST_TS_AGENT=review-integ-w39-b1`.
- The unit step alone on a quiet host, so I have no quiet time for it. Load fell from about 21 to about 3 by the end.
- A fatal error or an ICE from a real program through the `catch`: I found none today, so those two rows are injections.
- The rows of section 2 marked "by reading". The terminal row was through `script`, on macOS.
- Windows and Linux. The temp-dir mode and `non_durable_rename` differ on those; this commit touches neither.
