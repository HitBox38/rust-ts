verdict: REQUEST CHANGES

Independent re-check of root's own commits on `integ-w39`, head `cf309f3a`, and of the merged whole, before wave 39's gate.

**One blocker, B1: the gate cannot pass on this head.** A unit test now leaves a new untracked directory in the source tree on every run, so `scripts/gate.ts:409` reports "the tree changed" and the gate ends in FAIL, after all of its roughly 11 hours. The same bug is how three binary files got into `cf309f3a`. The fix is one `try`/`catch` plus `git rm`, and I tested it.

**One must-fix before or with the accept, M1:** accepting the new suites makes the next gate fail on `harness/m7-suites.test.ts:65`.

Everything else root asked about holds, or is low severity. No protected case was lost: the samples have 0 DIFF and 0 CRASH, and the seven new suites are ready once B1 and M1 are dealt with.

I edited no code. Plants and reverts were in two scratch worktrees, since removed. This file is all I wrote to the tree. I did not run the gate. Load reached 25 during the samples, and fell from about 19 to about 5 early in the unit run, which then ran alone.

| # | Severity | Where | Finding |
|---|---|---|---|
| B1 | **BLOCKER** | `src/rustc_interface/passes.ts:1431`; `src/rustc_hir_analysis/check/compare_impl_item_oracle/cases/rmeta{40EnCW,6wE19E,Fb6TAe}` (`cf309f3a`) | Each unit run writes `cases/rmeta*/` in the tree, which fails the gate; three such files are committed |
| M1 | **MEDIUM, before or with the accept** | `harness/m7-suites.test.ts:65-68` | The test requires that the new suites have no baseline, so the gate after the accept fails |
| L1 | LOW | `src/rust_ts/codegen_backend.ts:245` | W1's condition does not match upstream's: `-Zoffload=Test` stops where upstream goes on |
| L2 | LOW | `src/rustc_data_structures/jobserver.oracle.test.ts` | Nothing tests F1: reverting `fd > 2 &&` leaves 29 of 29 green |
| L3 | LOW | `harness/suites.ts:2204`, `harness/compiletest.ts:1273` | H9 is still open: the record will say level 4 for cases that are not at level 4 |
| L4 | LOW | `docs/next.md:459,462,465`, `docs/plan-m7.md` | False or stale statements, listed in section 8 |
| N1-N6 | nit | Section 9 | |

## 1. B1: the unit step dirties the tree, and the gate fails at the end

**Mechanism.** Before mono-wire, this program stopped inside `encode_and_write_metadata`, whose unwind drops the temp dir (`src/rustc_metadata/fs.ts:10-14`). Since mono-wire, `refine_rpitit.rs` gets past that and stops at `LlvmCodegenBackend.codegen_crate`. By then the `rmetaXXXXXX` dir belongs to `EncodedMetadata`, and only `Linker::link`'s `finally` drops it (`src/rustc_interface/queries.ts:147`). The stop never gets there, so the dir stays. Upstream's unwind drops it.

`compare_impl_item.oracle.test.ts` runs `main.ts` with its cwd in the source tree (`CASES_DIR`). The `.rlib` is in `.gitignore`; `rmeta*/` is not.

**Reproduced:**

| Run | `git status --short` after it |
|---|---|
| `compare_impl_item.oracle.test.ts -t refine_rpitit`, `d1bb28f3` (before mono-wire) | clean |
| The same, `cf309f3a`, three separate runs | `?? .../cases/rmetaMa2Bua/`, then `rmeta9rEOmK/`, then `rmeta3qJGEd/`: a new name each time |
| Both unit steps exactly as `scripts/gate.ts:270` runs them, `cf309f3a` | `?? .../cases/rmetay2Y8SY/`, the only change |

**Failing scenario.** Root commits and runs the gate on a clean tree. The unit step, which is first, writes the directory. At the end, `after.dirty` differs from `prov.dirty` (`scripts/gate.ts:409`), so it prints `ERROR: the tree changed while the gate was running`, and `pass` is false (`:413`). `accept` could not take the run. Removing the three committed files alone cannot help: each run makes a directory with a new random name.

**How it got in.** The three files in `cf309f3a` are this leak: each is `full.rmeta`, 3,057 bytes, one blob (`2930c174`). They are the only binaries the wave adds. They are a test run's output, not fixtures, and nothing reads them.

**Fix, tested in scratch:**

```ts
// src/rustc_interface/passes.ts:1431, in start_codegen
try {
  return codegen_backend.codegen_crate(tcx);
} catch (e) {
  metadata.drop(); // as Rust's unwinding drop of EncodedMetadata
  throw e;
}
```

With this, 43 of 43 pass and no directory is left. `git rm` the three files as well. Also update `fs.ts:10-14`, which describes this exit only inside `encode_and_write_metadata`.

**A `.gitignore` line would pass the gate but is worse.** The leak is real for users too: any `rust-ts foo.rs` that reaches codegen leaves `rmetaXXXXXX/` in the output directory, where the oracle leaves nothing. By reading, fatal errors from `CpuRequired`, `CpuUnsupported` or the collector take the same path.

**After the fix,** rerun the two unit steps and check `git status` before starting the gate. Rerun `mono-ui --sample 200` too: `MonoOnly` catches its stop inside `codegen_crate`, so the new `catch` should not see it, but it is on that path.

**No other unit test leaves anything in the tree:** this directory was the only change after the full run. The upstream checkout stays clean (section 7).

## 2. `fa410d8b`: mono-ui and the harness fixes (H1, H2, H6, H7)

**`monoArgs(id)` is what the review tested:** no `-o`, and `--out-dir $DATA/tmp/mono-ui-out/<id hash>`.

| Question | Answer |
|---|---|
| Does the hash collide? | No. `hash` is SHA-1 and 16 hex digits are kept. `mono-ui-out` holds 3,479 directories for 3,479 cases |
| Are the outputs read? | No. Only `harness/suites.ts` and `harness/m7-suites.test.ts` name the path; nothing opens a file in it |
| Disk? | **281 MB, 3,507 `.ll` files.** The plan's figure was 230 MB. Written only when the oracle runs. `mono-run` leaves its `--out-dir` empty (lib crate, fresh dir: exit 0, identical to the oracle) |
| Does a test's own flag conflict? | No. Among all 3,479 cases: 0 with two `--out-dir`, 0 with two `--emit`, 0 `incremental`, 0 `save-temps` |
| Is the oracle right now? | **Yes.** Every case's oracle command ran twice at 8 jobs, the second pass in reverse order: **0 of 3,479 differ.** One nonzero exit, `randomize.rs#randomize-layout`, as the review's table has it |

Free disk is 19 GB (96% used), not the plan's 25 GB. This suite is not the problem, but watch it.

**Root's 4 DIFFs (`20261105-052818-root-yxut`): confirmed, including the part root presumed.** Each has stdout byte-identical to the oracle by script, so **their mono items match**, and exit 0 on both sides. Stderr is where they differ.

| Case | Oracle stderr the port lacks | Where it comes from |
|---|---|---|
| `attributes/log-backtrace.rs` | `INFO rustc_metadata::creader ...` | `rustc-env:RUSTC_LOG=info`, the known case in `docs/next.md` |
| `rustc-env/def-path-hash-ice-157238.rs` | `some trace filter directives would enable traces...` | `rustc-env:RUSTC_LOG=trace`, the known case |
| `explicit-tail-calls/callee_is_track_caller.rs` | `tail calling a function marked with #[track_caller]...` | `compiler/rustc_codegen_ssa/src/mir/block.rs:1125`, in codegen |
| `..._polymorphic.rs` | The same | The same |

So the warning is emitted in `rustc_codegen_ssa`, after `collect_and_partition_mono_items`, where `mono-ui`'s subject has stopped. The tests say so themselves: `//@ no-pass-override (checks for a warning produced by codegen)`. These two stay DIFF until codegen lands, which is correct. They are not protected, so they cost nothing.

**`rgOracleKey`** (`harness/suites.ts:2131`) now hashes `scripts/lib/rg-check.ts`, by reading. That file holds the environment and output format H2 named.

**`RG_SCRUBBED_ENV` applies equally to both sides,** as `runSide` builds one `env` for both (`scripts/rg-check.ts:91`). `rg`'s MIR step reuses the recorded env, so it inherits the scrub.

**Is the list right? Yes, for what H6 named.** Tested with the oracle side, at one private label, comparing whole outputs:

| Environment | Output against a clean run |
|---|---|
| All 7 scrubbed variables poisoned (`GIT_DIR` at this repository, `RUSTC_WRAPPER=/nonexistent`, `RUSTFLAGS`, ...) | Identical |
| Not on the list: `RUSTDOCFLAGS`, `GIT_CONFIG_*` (`core.abbrev=4`), `GIT_INDEX_FILE` | Identical |

Other `CARGO_*` variables are difftest's overlay's job (`scripts/lib/env.ts`), and I did not poison those. H6's third point is not done: the header does not state the limit on ancestor `.cargo/config.toml`. None exists on this host's path to `$RUST_TS_DATA/ripgrep` or in `~/.cargo`, so nothing is wrong today (N3).

**`requireUpstream`:** with no `RUST_TS_DATA` and no `.env.local`, difftest prints `ERROR: RUST_TS_DATA is not set and <repo> has no .env.local: copy .env.local from the main checkout`. Correct.

## 3. The mono-wire merge (`b1eabca5`) and W1

**Nothing was lost.** Checked mechanically: for both conflicted files and both sides against the merge base `24d2c786`, every line either side added is in the merge. One line one side removed is still there:

- `collector_oracle/run.ts:34`, `const { Fingerprint } = ...`: mono-wire removed it, and abi-vtable's side still had it. It is unused (N1).

`partitioning.oracle.test.ts` has empty `STOPS` with mono-wire's result type. `vtable-through-const` and its `-nonincr` have `.cgus.txt` fixtures, and they are compared. Results: `collector.oracle.test.ts` 61 pass, `partitioning.oracle.test.ts` 65, `wire.test.ts` 3, alone and together.

**W1's position is right, its condition is not (L1).** Upstream, `back/llvm_backend.rs:336-357`:

```rust
if tcx.sess.opts.unstable_opts.offload.iter().any(|o| matches!(o, Offload::Device(_)))
    || tcx.sess.opts.unstable_opts.offload.iter().any(|o| matches!(o, Offload::Host(_)))
```

The citation is correct, and the check is the first statement of `codegen_crate`, before `base::codegen_crate`. `offload.length > 0` also catches `Test` and `HostMetadata`, the other two variants (`config.rs:218`). So it does not match.

| Flag, hello, through `mono-run` | Oracle | Port |
|---|---|---|
| `-Zoffload=Test` | exit 0, 9 items | **exit 70, the offload stop, 0 items** |
| `-Zoffload=HostMetadata=/tmp/m` | exit 0, 9 items | exit 70, an earlier stop, `write_host_metadata_offload_manifest` (not this line) |
| `-Zoffload=Host=/nonexistent`, `Device` | exit 1, 0 items, `rust offload backend not found` | exit 70, the offload stop, 0 items, as W1 asked |

**Failing scenario:** `-Zoffload=Test` makes no use of the wrapper upstream, and the port refuses it. It is a stop, so never a false MATCH, and no suite reaches `codegen_crate` with it: `tests/ui/offload` has no `run-pass` test, and `mono-ui` takes only those.

**Fix, tested:** `.some((o) => o.$ === "Device") || .some((o) => o.$ === "Host")`. `-Zoffload=Test` is then byte-identical to the oracle, and `Host` still stops.

**W1's other request is half done:** the comment at `:239` still gives `base::codegen_crate` three arguments, and at this pin it takes `(backend, tcx)` (`llvm_backend.rs:357`).

## 4. `e95d1def`: jobserver (real-crates F1, F2)

- **F1 is fixed.** `0,0 <&-`, `1,1 >&-` and `1,0 <&- >&-`: stderr byte-identical to the oracle, exit 0 on both. This is root's test plus the two others from the review.
- **F1 has no test (L2).** The review asked for the 3 cases in `CASES`. Reverting `fd > 2 &&` leaves 29 pass, 0 fail.
- **Coverage now checks the markers, for real:**

| Plant | `coverage.ts --check --offline` |
|---|---|
| `unix.rs:9999 nonsense` | `ERROR: ... matches no fn in the crate source` |
| `unix.rs:91 open` (right name, wrong line) | The same `ERROR:` |
| Marker removed | `markers ok`, vendor 5,086 to 5,085, and `--missing` lists it at 3/28 |
| Unplanted | `markers ok (24844; vendor 5086; library 590)` |

No `crate-pending:` is left, and the header clauses the review flagged are gone. `--offline` found the source in cargo's cache.

## 5. `a3087db7`, `cf309f3a`

**Each clone reverted alone, `alias_check.test.ts -t 'fixed aliasing'`:**

| Revert | Result |
|---|---|
| Control | 2 pass |
| `unify_by_eq_op`, `unify_by_int_to_int`, `unify_by_copy` dest, `unify_by_copy` src | **each fails** |
| `by_move_body.ts:246` (3a), `promote_consts.ts:1179` (6) | **each fails** |
| `shim.ts:1215`, `async_destructor_ctor.ts:417`, `:434` | **each fails** |
| `rustc_borrowck/lib.ts:366-367`, to `clone_Body` | **fails** |
| `unify_if_equal_const` dest | **passes** |

So F1 and F3 are closed as the review proposed, and the one survivor is the one it said to leave to the sweep. I did not revert `lib.ts:697`: the review showed it cannot have a test.

**N1's rename is correct:** `build_fn_ptr_as_ptr_shim`. **Unit budget: fine.** The two tests take 4.3-5.1 s of CPU at head (user + sys, 2 runs each, sys is noisy) and 4.1-5.0 s before the commit: about 0.1-0.2 s of user time added, and 1.9 s wall.

**`cf309f3a`'s pin is right:** 43 pass. It is the stop mono-wire gives. Its three binaries are B1.

## 6. `harness/scope.json`: root's note

**Accurate on everything I could check.**

| Claim | Checked |
|---|---|
| First line needs the owner's approval | Yes |
| `virtual_socket.rs`'s exclusion removed in `4dc9de69`, on main | Yes, one line. `docs/next.md` says "narrows D2" |
| Moves coverage only, Miri 1483/1514 to 1504/1535 | +21/+21 agrees: upstream's file has 21 fns, the port 21 markers |
| 10 cases protected | All 10 named in `docs/handoff/miri-tail-b.md` are in `harness/baseline/run-pass-miri.txt` |
| Vendor entries follow PORTING 5b, with precedent | Yes: `rand_xoshiro` (`825f1948`), twox-hash, polonius, rand |
| Other changes this wave | **Only `jobserver`, `e95d1def`.** `main..cf309f3a` has that one commit on the file. `harness-m7a` and the others did not touch it |
| Root reported it to the owner | **Not checkable from here** |

**One thing the note leaves open:** "needs the owner's approval" has no exception for vendor entries, and F2's reviewer pointed that out. PORTING 5b makes a good case, but `jobserver` was added on root's reading of the two together. The comment also says "see AGENTS.md", which never mentions the file, and PORTING section 1 forbids lanes to edit `harness/` while 5b tells them to record entries there. This is worth one line to the owner with the D4 question (N4).

## 7. The merged whole

**Samples at `cf309f3a`, one at a time, `RUST_TS_AGENT=review-integ-w39-recheck`, `RUST_TS_REQUIRE_PROBES=1`. No DIFF or CRASH anywhere, and every non-MATCH is unprotected:**

| Suite | Result | In its baseline | Not MATCH |
|---|---|---|---|
| `run-pass-miri` | 200/200 | 200 | |
| `run-fail-miri` | 200/200 | 200 | |
| `miri-pass` | 197 | 191 | UNSTABLE `panic/mir-validation.rs`; UNPORTED `socket-address.rs`, `socket.rs` (D2 sockets) |
| `mir` | 200/200 | 200 | |
| `check-ui` | 200/200 | 200 | |
| `rmeta-ui` | 200/200 | 200 | |
| `pm-ui` | 198 | 198 | UNPORTED `expand-expr.rs`; UNSTABLE `load-panic-backtrace.rs` |
| `mirdump-ui` | 200/200 | 200 | |
| `tydump-ui` | 199 | 199 | UNSTABLE `on_unimplemented_long_types.rs` |
| `borrowck-ui` | 200/200 | 200 | |
| `miri-hello` | 1/1 | 1 | |
| `mir-o2` | 200/200 | new | |
| `mono-ui` | 200/200 | new | |
| `mir-opt-o4` | 200/200 | new | |
| `check-ui-encode-mir` | **146/146, the whole suite** | new | |
| `ir-hello` | 0/2 | new | UNPORTED: `codegen_crate` after collection, correct, as there is no codegen. Not on the list to protect |
| `check-rg`, `-host`, `-encode-mir` (each a sample of all 36, so a full run) | **36/36 each** | new | Not on your sample list; I added them as they had not run at this head. 68, 70, 89 s; 3.8, 3.8, 4.9 GB, in budget |

**Unit steps, as the gate runs them:**

| Step | Result | Wall |
|---|---|---|
| `./src ./tools` | 7,281 tests, 0 fail, 1 skip (`read_binary_file_handles_lying_stat`, on the allowlist) | **1,230 s** |
| `./scripts ./harness` | 273 tests, 0 fail | 22 s |

`tsc` clean, markers ok.

**Merges.** `harness/suites.ts` and `harness/compiletest.ts` were changed by one lane only, `harness-m7a`, plus root's `fa410d8b`, so no two lanes' edits met there. `src/rustc_monomorphize` by `mono-wire` only, apart from the two files in section 3.

**Suite list:** 66 suites, 52 baselines, no duplicate name, no baseline without a suite. **Every protected id of every non-split suite is still generated;** I did not expand the split suites' sections. 14 suites have no baseline, and they are the expected ones.

**Running order:** each of the wave's 27 changed test files passes alone, and `src/rustc_monomorphize`'s three pass together, listed in reverse (I did not confirm that Bun kept that order). I found no test that depends on an earlier one. I did not shuffle the other 600 files.

**Upstream checkout:** after each sample and the sweep, `git status --short --ignored` is `!! build/`, nothing else. `build/` is excluded by design; 112 files in it changed during this review, the aux output it exists for.

## 8. Are the new suites ready?

**Yes for all seven, once B1 and M1 are dealt with.** No suite on the list has a defect of its own.

| Suite | Evidence at or near head | Oracle twice | Risk |
|---|---|---|---|
| `mono-ui` | 3475/3479 full (root); 200/200 | 0 of 3,479 differ | Low |
| `mir-o2` | 200/200; earlier 120/120 twice. **Never run in full** | 3 of 3,479 differ, below | Low, but the gate is its first full run |
| `mir-opt-o4` | 200/406; earlier 40 and 60. **Never run in full** | 0 of 406 | Low; H9 below |
| `check-ui-encode-mir` | 146/146 full | 0 of 146 | Low |
| `check-rg`, `check-rg-encode-mir`, `check-rg-host` | 36/36 at head, and twice each before (the lane's final runs) | `check-rg`: 3 oracle runs identical (scrub test). The other two: the earlier review's raw diffs only | Low |

**Flaking:**

- **UNSTABLE not yet listed: 3, all in `mir-o2`, all safe.** `simd/shuffle.rs#noopt`, `#opt` and `simd/intrinsic/inlining-issue67557-ice.rs`: the oracle ICEs with exit 101 at `-Zunpretty=mir` at this argv, and its panic message holds the thread id. `UNSTABLE_ORACLE_PATTERNS` catches them, so they are never cached or protected, and `gate.ts` requires no listing. My sample missed them by chance. Listing them is documentation, as `MIR_UNSTABLE` does (N2). The denominator is 3,476.
- **Absolute paths:** `--out-dir` is in `mono-ui`'s key, so moving `$RUST_TS_DATA` re-runs the oracle rather than giving false results. `check-rg`'s tree is one absolute path on both sides, by design.
- **Timing and load:** oracles are far from their limits: the slowest case took 429 ms at 8 jobs, on any of the four suites. Subject limits are 240 s (`mir-o2`, `mono-ui`), 120 s (`mir-opt-o4`, `check-ui-encode-mir`) and 3,600 s (`check-rg*`). `mono-ui`'s full run hit none. **What I cannot rule out** is a subject near its limit in `mir-o2` or `mir-opt-o4`, since neither has had a full run and rows record no per-case time. A TIMEOUT gets its serial retry.
- **Same case, two difftest processes:** one `--out-dir` per case, not per process, so two oracle runs of one case at once could still collide and cache the failure, as in H1. It needs a cache miss during a concurrent run; the cache is full now and the gate runs alone (N5).
- **Port determinism:** two full runs exist for no suite. If a subject's output varied between runs, a case that matched at this gate would read as lost at the next. **Recommendation, not a requirement:** run `mir-o2` and `mir-opt-o4` once in full before the gate, about 10 minutes on a quiet host. That gives each a second result and shows any near-limit case before it costs a gate.

**`docs/reviews/plan-m7.md` F5 (at most 5 s of unit time per lane, or split the step).** This wave is within the point of it: 1,230 s here, 1,195 s root's, against 1,266 s at wave 38, so no net growth. Per lane, from the junit report:

| Lane | Tests it added | Wall |
|---|---|---|
| fixers-39 | `blocking_io`, `oracle_e2e`, `inline.oracle` | 5.3 s, a little over |
| mir-alias | `fixed aliasing` tests | 1.9 s, 4.3-5.1 s of CPU |
| real-crates | `jobserver`, `out_dir_path` | 2.2 s |
| harness-m7a | `m7-suites`, `ir-diff`, `ir-normal`, `llvm-tools`, `rg-check` | 2.2 s |
| mono-wire | `wire` | 1.7 s (and trims) |
| abi-vtable | `aarch64.oracle` | 1.0 s |

Nothing records this per wave, although the amendment says "checked per wave"; wave 40 should have an owner for it. `docs/plan-m7.md:470,641` still say 15 s, which the plan's header overrides.

**Is 1,800 s safe? Yes, on a quiet host.** The limit is per step (`scripts/gate.ts:281`). 1,230 s leaves 570 s. The plan recorded 2,005 s under load, so that margin depends on what `docs/next.md` already says: nothing else on the host.

**H9.** `mir-opt-o4` is ready, but its description and `compiletest.ts:1273` say level 4 where 53 of 406 are not, and the description goes into the record. Correct the words before the accept (L3). The review's other point, 207 `test-mir-pass` cases seeing that pass after the whole pipeline, stays root's call; I found nothing that changes it.

### M1: the accept breaks the next gate

`harness/m7-suites.test.ts:65` asserts that no suite in `NEW` has a file in `harness/baseline/`. `accept` writes those files (`scripts/gate.ts`, `writeFileSync(join(BASELINE, ...))`).

**Failing scenario, tested with one planted baseline file:** `(fail) no new suite is protected, so none is in the gate's defaults`. After wave 39's accept commit, wave 40's gate fails its runner unit step. `gateRun` carries on after a static failure (`:361`), so that also shows only as FAIL at the end.

**Fix:** in the batch with B1, take the seven suites out of `NEW`, leaving `ir-hello`, or delete the test. Doing it before the gate means the gate tests the file the accept keeps. Also, `gate.ts run` defaults to `protectedSuites()`, so the seven must be named in `--suites` along with all 52.

### False or stale statements (L4)

| Where | Says | Now |
|---|---|---|
| `docs/next.md:459` on `integ-w39` | M7 preflight "running" | On `main`'s copy "on integ-w39 except mir-alias (lanes done; its review running)". All are on `integ-w39`, mir-alias included, reviewed |
| `docs/next.md:462` | `compiletest.ts:982 still says "deferred to M6"` | Reworded by `6c76a8cc`. The programs still run in no suite, which is the true half |
| `docs/next.md:465` | Queued: "harness-w39 N2-N4; re-check N1-N3" | N2-N4 and re-check N1, N3 are fixed (`docs/reviews/harness-m7a.md` section 7). Re-check N2 remains |
| `docs/plan-m7.md:436-438` | `mir-o2`, `mono-ui` 3,470 cases; `check-rg` 34 | 3,479 (3,476 for `mir-o2` once the unstable are out); 36 reported cases, of 34 crates |
| `docs/plan-m7.md:344,425` | "29 of 34", O6 a port difference | `docs/reviews/real-crates.md`: the comparison's artifact, 34 of 34 at one path. As that review listed |
| `docs/plan-m7.md:10,453,639` | 25 GB free | 19 GB |
| `docs/plan-m7.md:567`, `:470`, `:641` | `o2-inline`; 15 s | Overridden by the header's amendments, so not false as read. Worth fixing when next touched |
| `PLAN.md:44,60` | "system clang", "→ clang" | Plan-m7 found Apple clang cannot parse the IR. Held for the owner and said so, so it is a known gap |

## 9. Nits

- **N1.** `collector_oracle/run.ts:34`: unused `Fingerprint` import.
- **N2.** `mir-o2` has no `unstable` list. The three in section 8 could be listed, as `MIR_UNSTABLE` lists its own.
- **N3.** `scripts/rg-check.ts`'s header: H6 asked it to state that cargo reads ancestors' `.cargo/config.toml`.
- **N4.** `harness/scope.json:2`: "see AGENTS.md" points at nothing. Section 6.
- **N5.** `monoArgs` is per case, not per process (section 8). Not worth a lock.
- **N6.** Stale words in the suites: `harness/suites.ts:2093` "until it merges, every case is UNPORTED"; `:2230` "waits for lane abi-vtable"; `check-rg`'s criterion is 97% of 36 reported cases, where its text says 33 of 34; `check-ui-encode-mir` carries `milestone: "M5"` from `rmetaSuite`. `src/vendor/jobserver/unix.ts:58`: real-crates F4's wrong comment on `99999999999x` is still there.

## What I did not check

- **The gate, or full port runs of `mir-o2`, `mir-opt-o4` and the protected suites.** `mir-opt-o4`'s other 206 cases, including `dump_dataflow.rs`, I ran only on the oracle.
- **Whether root told the owner** about `scope.json`.
- **The fixes as root will write them.** B1's and L1's are my scratch edits, tested on the cases above only, with no full run. B1's should get its own look, as it is on the path of every codegen stop.
- **Other unit tests' effect outside the tree,** such as temp directories in `/tmp` or `$RUST_TS_DATA` left the same way as B1's.
- **Linux and Windows.** x86_64-linux only as a compile target, on this host.
- **Other `CARGO_*` poison** for `rg-check`, and H6's ancestor config in a tree that has one.
- **Port determinism beyond the repeats named above,** and any shuffle of test order outside the wave's changed files.
- **Reasoning of the lanes' code beyond what root's commits touched.** Each has its own review under `docs/reviews/`.

**Side effects on shared data:** `.data/runs/recheck-w39-*`; `.data/tmp/mono-ui-out` rewritten by the sweep with the same files; `.data/ripgrep/kept/*` rewritten by the `check-rg` runs; oracle entries for the three `check-rg` suites at their current key. The label I used for the scrub test is removed. The upstream checkout is unchanged.
